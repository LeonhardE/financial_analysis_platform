"""Update an existing Cloud Run service without replacing its runtime settings.

Only trusted main-branch Cloud Build triggers should execute this script. The
Cloud Run etag makes release ordering atomic across concurrent builds.
"""

import argparse
import copy
import json
import re
import subprocess
import time
from datetime import UTC, datetime
from decimal import Decimal
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BUILD_ANNOTATION = "financial-analysis/deployment-build"
TIME_ANNOTATION = "financial-analysis/deployment-created"
COMMIT_ANNOTATION = "financial-analysis/deployment-commit"


def gcloud(*args):
    return subprocess.check_output(["gcloud", *args], text=True, timeout=60).strip()


class RunAPI:
    def __init__(self):
        self.token = gcloud("auth", "print-access-token")

    def request(self, method, resource, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = Request(
            f"https://run.googleapis.com/v2/{resource}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
        )
        with urlopen(request, timeout=30) as response:
            return json.load(response)


def timestamp(value):
    # Cloud Build emits UTC RFC 3339; retain nanoseconds when ordering releases.
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,9})?Z", value)
    if not match:
        raise ValueError("The deployment timestamp is not a Cloud Build UTC timestamp.")
    second = datetime.strptime(match[1], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=UTC)
    return Decimal(int(second.timestamp())) + Decimal(match[2] or "0")


def deployment_body(service, image, build_id, created, commit):
    if not service.get("etag"):
        raise RuntimeError("Cloud Run did not return an etag; refusing an unguarded update.")
    template = copy.deepcopy(service["template"])
    containers = template.get("containers", [])
    if len(containers) != 1:
        raise RuntimeError("Automatic deployment currently supports one-container services.")
    containers[0]["image"] = image
    service_id = service["name"].rsplit("/", 1)[-1]
    template["revision"] = f"{service_id}-cd-{build_id}"
    annotations = dict(service.get("annotations", {}))
    annotations.update(
        {
            BUILD_ANNOTATION: build_id,
            TIME_ANNOTATION: created,
            COMMIT_ANNOTATION: commit,
        }
    )
    return {
        "name": service["name"],
        "etag": service["etag"],
        "template": template,
        "annotations": annotations,
        "traffic": [{"type": "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", "percent": 100}],
    }


def same_revision(name, revision):
    # Status references may use a full resource name with a canonical project
    # number, whereas our request path uses the project's human-readable ID.
    return isinstance(name, str) and name.rsplit("/", 1)[-1] == revision


def deploy(api, resource, image, build_id, created, commit, wait_seconds=600):
    deadline = time.monotonic() + wait_seconds
    revision = f"{resource.rsplit('/', 1)[-1]}-cd-{build_id}"
    submitted = False
    while time.monotonic() < deadline:
        service = api.request("GET", resource)
        annotations = service.get("annotations", {})
        accepted_time = annotations.get(TIME_ANNOTATION)
        if accepted_time and timestamp(accepted_time) > timestamp(created):
            print("A newer build was already accepted; skipping this older deployment.")
            return "superseded"
        if service.get("reconciling"):
            time.sleep(3)
            continue
        if annotations.get(BUILD_ANNOTATION) == build_id:
            template = service.get("template", {})
            containers = template.get("containers", [])
            if (
                not same_revision(template.get("revision"), revision)
                or len(containers) != 1
                or containers[0].get("image") != image
            ):
                raise RuntimeError(
                    "The service template changed outside this build; refusing to overwrite it."
                )
            condition = service.get("terminalCondition", {})
            # Failed reconciliation leaves observedGeneration and ready revision
            # pointing at the old serving state. Report failure before comparing them.
            if condition.get("state") == "CONDITION_FAILED":
                detail = (
                    condition.get("message") or condition.get("reason") or "See Cloud Run logs."
                )
                raise RuntimeError(
                    f"This build's Cloud Run revision failed to become ready: {detail}"
                )
            traffic = service.get("trafficStatuses", [])
            desired_traffic = service.get("traffic", [])
            if (
                condition.get("state") == "CONDITION_SUCCEEDED"
                and service.get("generation")
                and service.get("observedGeneration") == service["generation"]
                and same_revision(service.get("latestCreatedRevision"), revision)
                and same_revision(service.get("latestReadyRevision"), revision)
                and sum(target.get("percent", 0) for target in desired_traffic) == 100
                and all(
                    target.get("percent", 0) == 0
                    or target.get("type") == "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
                    for target in desired_traffic
                )
                and sum(target.get("percent", 0) for target in traffic) == 100
                and all(
                    target.get("percent", 0) == 0 or same_revision(target.get("revision"), revision)
                    for target in traffic
                )
            ):
                print("This build is deployed and ready, receiving 100% of traffic.")
                return "deployed"
            time.sleep(3)
            continue
        if submitted:
            # A stale read after PATCH must not submit the update again. Keep
            # observing the service until this build, or a newer build, appears.
            time.sleep(3)
            continue
        body = deployment_body(service, image, build_id, created, commit)
        try:
            operation = api.request(
                "PATCH", f"{resource}?updateMask=template,annotations,traffic", body
            )
        except HTTPError as error:
            if error.code in (409, 412):
                # A competing deploy or Console change won the etag. Read again,
                # preserving its config and rechecking accepted release order.
                time.sleep(3)
                continue
            raise
        if operation.get("error"):
            raise RuntimeError(f"Cloud Run deployment failed: {operation['error']}")
        submitted = True
        # Operations are separate regional resources. Poll the service we can
        # already read with service-scoped IAM instead of requiring broader access.
        print(f"Cloud Run accepted build {build_id}; waiting for service readiness.", flush=True)
        time.sleep(3)
    raise TimeoutError(
        "Cloud Run deployment did not become ready with 100% traffic within the time limit."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--build-region", required=True)
    parser.add_argument(
        "--service", choices=("market-api", "user-api", "config-api", "market-web"), required=True
    )
    parser.add_argument("--image", required=True)
    parser.add_argument("--build-id", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument(
        "--deploy-enabled",
        choices=("true", "false"),
        default="true",
        help="Use false to build the first image before the Console creates a service.",
    )
    args = parser.parse_args()
    if args.branch != "main" or not re.fullmatch(r"[a-f0-9]{40}", args.commit):
        raise RuntimeError("Deployments require a main-branch trigger with a full commit SHA.")
    if not re.fullmatch(r"[a-f0-9-]{36}", args.build_id):
        raise RuntimeError("The Cloud Build ID is invalid.")
    if not args.image.endswith(f"/{args.service}:{args.build_id}"):
        raise RuntimeError("The image must use this service and the unique Cloud Build ID tag.")
    if args.deploy_enabled == "false":
        print("Build-only mode: image published; create or configure this service in the Console.")
        return
    build = json.loads(
        gcloud(
            "builds",
            "describe",
            args.build_id,
            f"--region={args.build_region}",
            f"--project={args.project}",
            "--format=json",
        )
    )
    substitutions = build.get("substitutions", {})
    if substitutions.get("BRANCH_NAME") != "main" or substitutions.get("COMMIT_SHA") != args.commit:
        raise RuntimeError("Cloud Build metadata does not match the requested main-branch release.")
    resource = f"projects/{args.project}/locations/{args.region}/services/{args.service}"
    deploy(RunAPI(), resource, args.image, args.build_id, build["createTime"], args.commit)


if __name__ == "__main__":
    main()
