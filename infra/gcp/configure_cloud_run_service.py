"""Reconcile owned Cloud Run configuration without replaying planned releases.

Terraform supplies desired settings through JSON in the environment. Images,
traffic, revision names and deployment ordering are read at execution time.
Every write is conditional on the service etag. No secret payload is fetched.
"""

import copy
import json
import os
import re
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from deploy_existing_service import (
    BUILD_ANNOTATION,
    CONFIG_BASE_BUILD_ANNOTATION,
    CONFIG_REVISION_ANNOTATION,
    RunAPI,
)

FIELDS = {
    "runtime_service_account",
    "timeout_seconds",
    "concurrency",
    "min_instances",
    "max_instances",
    "port",
    "memory",
    "startup_cpu_boost",
    "ingress",
    "environment",
    "secret_environment",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def configuration(service):
    """Return only owned fields, excluding all release identity and routes."""
    template = service["template"]
    containers = template.get("containers", [])
    require(len(containers) == 1, "Configuration requires exactly one HTTP container.")
    container = containers[0]
    env, secrets = {}, {}
    for entry in container.get("env", []):
        if "valueSource" in entry:
            ref = entry["valueSource"]["secretKeyRef"]
            secrets[entry["name"]] = {"secret": ref["secret"], "version": ref["version"]}
        else:
            env[entry["name"]] = entry.get("value", "")
    scaling = template.get("scaling", {})
    resources = container.get("resources", {})
    # API omits false booleans and zero minimums on read.
    return {
        "runtime_service_account": template.get("serviceAccount"),
        "timeout_seconds": int(template.get("timeout", "300s").removesuffix("s")),
        "concurrency": template.get("maxInstanceRequestConcurrency", 80),
        "min_instances": scaling.get("minInstanceCount", 0),
        "max_instances": scaling.get("maxInstanceCount", 0),
        "port": container.get("ports", [{}])[0].get("containerPort", 8080),
        "memory": resources.get("limits", {}).get("memory"),
        "startup_cpu_boost": resources.get("startupCpuBoost", False),
        "ingress": service.get("ingress"),
        "environment": env,
        "secret_environment": secrets,
    }


def matches(service, desired):
    resources = service["template"]["containers"][0].get("resources", {})
    return (
        configuration(service) == desired
        and resources.get("limits", {}).get("cpu") == "1"
        and resources.get("cpuIdle") is True
    )


def configuration_body(service, desired):
    require(bool(service.get("etag")), "Missing etag; refusing an unconditional config write.")
    template = copy.deepcopy(service["template"])
    require(len(template.get("containers", [])) == 1, "Only one HTTP container is supported.")
    service_id = service["name"].rsplit("/", 1)[-1]
    # At most 62 characters for the module's maximum 49-character service ID.
    revision = f"{service_id}-cfg-{uuid.uuid4().hex[:8]}"
    template.update(
        revision=revision,
        serviceAccount=desired["runtime_service_account"],
        timeout=f"{desired['timeout_seconds']}s",
        maxInstanceRequestConcurrency=desired["concurrency"],
    )
    template.setdefault("scaling", {}).update(
        minInstanceCount=desired["min_instances"], maxInstanceCount=desired["max_instances"]
    )
    container = template["containers"][0]
    container.setdefault("resources", {}).update(
        limits={"cpu": "1", "memory": desired["memory"]},
        cpuIdle=True,
        startupCpuBoost=desired["startup_cpu_boost"],
    )
    ports = container.get("ports") or [{}]
    require(len(ports) == 1, "Only one HTTP port is supported.")
    container["ports"] = [{**ports[0], "containerPort": desired["port"]}]
    container["env"] = [
        {"name": name, "value": value} for name, value in sorted(desired["environment"].items())
    ] + [
        {"name": name, "valueSource": {"secretKeyRef": ref}}
        for name, ref in sorted(desired["secret_environment"].items())
    ]
    annotations = dict(service.get("annotations", {}))
    annotations[CONFIG_REVISION_ANNOTATION] = revision
    if annotations.get(BUILD_ANNOTATION):
        annotations[CONFIG_BASE_BUILD_ANNOTATION] = annotations[BUILD_ANNOTATION]
    else:
        annotations.pop(CONFIG_BASE_BUILD_ANNOTATION, None)
    return {
        "name": service["name"],
        "etag": service["etag"],
        "template": template,
        "ingress": desired["ingress"],
        "annotations": annotations,
    }


def configure(api, resource, uid, desired, wait_seconds=600):
    require(set(desired) == FIELDS, "Unexpected or missing owned configuration fields.")
    deadline = time.monotonic() + wait_seconds
    submitted = False
    submitted_generation = None
    while time.monotonic() < deadline:
        service = api.request("GET", resource)
        require(
            bool(uid) and service.get("uid") == uid, "Service identity changed; refusing write."
        )
        if submitted and service.get("generation") == submitted_generation:
            # An accepted write can briefly be followed by its old settled GET.
            # Never duplicate the write or report that old snapshot as failure.
            time.sleep(3)
            continue
        if service.get("reconciling"):
            time.sleep(3)
            continue
        condition = service.get("terminalCondition", {}).get("state")
        if submitted and condition == "CONDITION_FAILED":
            raise RuntimeError("Configuration revision failed; inspect private Cloud Run logs.")
        if matches(service, desired):
            if (
                condition == "CONDITION_SUCCEEDED"
                and service.get("generation")
                and service.get("observedGeneration") == service["generation"]
            ):
                pinned = any(
                    entry.get("type") != "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
                    and entry.get("percent", 0) > 0
                    for entry in service.get("traffic", [])
                )
                print(
                    "Configuration verified; pinned traffic is preserved. Serving older revisions "
                    "retain their previous configuration until an explicit release."
                    if pinned
                    else "Configuration verified on the current template; release state preserved.",
                    flush=True,
                )
                return service
            time.sleep(3)
            continue
        require(not submitted, "Owned configuration changed after submission; review a fresh plan.")
        body = configuration_body(service, desired)
        try:
            operation = api.request(
                "PATCH", f"{resource}?updateMask=template,ingress,annotations", body
            )
        except HTTPError as error:
            if error.code in (409, 412):
                time.sleep(3)
                continue
            raise
        require(not operation.get("error"), "Cloud Run rejected the configuration update.")
        submitted = True
        submitted_generation = service.get("generation")
        print("Conditional configuration update accepted; waiting for readiness.", flush=True)
        time.sleep(3)
    raise TimeoutError("Configuration did not become ready within the bounded wait.")


class FixtureAPI:
    """Explicit localhost-only subprocess transport for CI; never uses credentials."""

    def __init__(self, endpoint):
        parsed = urlsplit(endpoint)
        require(
            parsed.scheme == "http"
            and parsed.hostname == "127.0.0.1"
            and parsed.port
            and parsed.path == "/v2/"
            and not parsed.username
            and not parsed.query
            and not parsed.fragment,
            "Test transport must use an explicit 127.0.0.1 Cloud Run fixture.",
        )
        self.endpoint = endpoint

    def request(self, method, resource, body=None):
        request = Request(
            self.endpoint + resource,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "Authorization": "Bearer offline-fixture-token",
                "Content-Type": "application/json",
            },
        )
        with build_opener(ProxyHandler({})).open(request, timeout=30) as response:
            return json.load(response)


def main():
    resource = os.environ["FOLIOVIEW_SERVICE_RESOURCE"]
    require(
        re.fullmatch(
            r"projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/locations/[a-z]+-[a-z]+[0-9]+/"
            r"services/[a-z]([a-z0-9-]{0,47}[a-z0-9])?",
            resource,
        ),
        "Invalid Cloud Run service resource.",
    )
    endpoint = os.environ.get("FOLIOVIEW_TEST_CLOUD_RUN_ENDPOINT")
    configure(
        FixtureAPI(endpoint) if endpoint else RunAPI(),
        resource,
        os.environ["FOLIOVIEW_SERVICE_UID"],
        json.loads(os.environ["FOLIOVIEW_CONFIGURATION"]),
    )


if __name__ == "__main__":
    main()
