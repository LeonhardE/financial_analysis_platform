"""Select affected CI targets and enforce the required aggregate check."""

import argparse
import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

SERVICES = ("market-data-service", "user-service", "config-service")
CLOUDBUILD_TARGETS = {
    "infra/gcp/cloudbuild.api.yaml": "market-data-service",
    "infra/gcp/cloudbuild.user.yaml": "user-service",
    "infra/gcp/cloudbuild.config.yaml": "config-service",
    "infra/gcp/cloudbuild.web.yaml": "web",
}
REPOSITORY_FILES = {
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".prettierignore",
    ".prettierrc.json",
    "LICENSE",
    "LICENSE.txt",
}
SHA = re.compile(r"[0-9a-fA-F]{40}\Z")


@dataclass(frozen=True)
class Plan:
    web: bool = False
    services: tuple[str, ...] = ()
    infra: bool = False
    terraform: bool = False

    def outputs(self) -> dict[str, str]:
        return {
            "web": str(self.web).lower(),
            "backend": str(bool(self.services)).lower(),
            "services": json.dumps(self.services, separators=(",", ":")),
            "infra": str(self.infra).lower(),
            "terraform": str(self.terraform).lower(),
        }


FULL = Plan(web=True, services=SERVICES, infra=True, terraform=True)


def select(paths: list[str]) -> Plan:
    """Known leaf targets stay isolated; unknown executable paths fail conservatively."""
    web = infra = terraform = False
    services = set()
    for path in paths:
        if path.startswith("local-docs/"):
            continue
        if path.startswith((".github/", "scripts/ci/")) or path == "package.json":
            return FULL
        if path.endswith(".md"):
            continue
        if path == ".dockerignore":
            web = True
            services.update(SERVICES)
        elif path == "package-lock.json" or path.startswith("apps/web/"):
            web = True
        elif path == "services/market-data-service/pyproject.toml":
            # Root Python quality commands use this Ruff configuration for every target.
            services.update(SERVICES)
            infra = True
        elif path == "scripts/test_services.py":
            services.update(SERVICES)
            infra = True
        elif path.startswith("services/common/") or path == "services/requirements-dev.txt":
            services.update(SERVICES)
        elif any(path.startswith(f"services/{service}/") for service in SERVICES):
            services.add(path.split("/")[1])
        elif path in CLOUDBUILD_TARGETS:
            target = CLOUDBUILD_TARGETS[path]
            if target == "web":
                web = True
            else:
                services.add(target)
            infra = True
        elif (
            path.startswith("infra/gcp/terraform/")
            or path
            in (
                "infra/gcp/terraform_tools.py",
                "infra/gcp/terraform_pipeline.py",
                "infra/gcp/cloudbuild.terraform-plan.yaml",
                "infra/gcp/cloudbuild.terraform-apply.yaml",
            )
            or (path.startswith("infra/gcp/tests/test_terraform") and path.endswith(".py"))
        ):
            infra = terraform = True
        elif path.startswith("infra/gcp/"):
            infra = True
        elif path.startswith(("apps/", "services/", "scripts/")):
            return FULL
        elif path in REPOSITORY_FILES:
            continue
        else:
            return FULL
    return Plan(
        web=web,
        services=tuple(item for item in SERVICES if item in services),
        infra=infra,
        terraform=terraform,
    )


def changed_paths(event_name: str, event: dict) -> list[str]:
    """Use the actual PR base (including stacked PRs), or the full pushed commit range."""
    if event_name == "pull_request":
        pull_request = event["pull_request"]
        base, head = pull_request["base"]["sha"], pull_request["head"]["sha"]
        comparison = "..."
    elif event_name == "push":
        base, head = event["before"], event["after"]
        comparison = ".."
    else:
        raise ValueError("Unsupported event")
    if not all(
        isinstance(sha, str) and SHA.fullmatch(sha) and int(sha, 16) for sha in (base, head)
    ):
        raise ValueError("Missing or invalid comparison commit")
    # Disabling rename detection exposes both sides as delete/add, preserving both owners.
    result = subprocess.run(
        [
            "git",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--name-only",
            "--no-renames",
            "-z",
            f"{base}{comparison}{head}",
            "--",
        ],
        check=True,
        capture_output=True,
    )
    return [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]


def detect(event_name: str, event_path: str) -> Plan:
    try:
        event = json.loads(Path(event_path).read_text())
        paths = changed_paths(event_name, event)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError):
        print("Comparison unavailable; checking every target.")
        return FULL
    print(f"Compared {len(paths)} changed paths.")
    return select(paths)


def validate_gate(needs: dict) -> None:
    """Reject missing output or an unexpectedly skipped, failed, or cancelled check."""
    if not isinstance(needs, dict) or set(needs) != {
        "changes",
        "repository",
        "web",
        "backend",
        "terraform",
    }:
        raise ValueError("Missing or unexpected aggregate dependency")
    for job in ("changes", "repository"):
        if not isinstance(needs[job], dict) or needs[job].get("result") != "success":
            raise ValueError(f"{job} did not succeed")
    outputs = needs["changes"].get("outputs")
    if not isinstance(outputs, dict) or set(outputs) != {
        "web",
        "backend",
        "services",
        "infra",
        "terraform",
    }:
        raise ValueError("Missing or unexpected selection output")
    if any(
        outputs[key] not in ("true", "false") for key in ("web", "backend", "infra", "terraform")
    ):
        raise ValueError("Invalid selection flag")
    if outputs["terraform"] == "true" and outputs["infra"] != "true":
        raise ValueError("Terraform checks require repository infrastructure checks")
    try:
        services = json.loads(outputs["services"])
    except (TypeError, ValueError) as error:
        raise ValueError("Invalid service selection") from error
    if (
        not isinstance(services, list)
        or any(not isinstance(service, str) or service not in SERVICES for service in services)
        or len(services) != len(set(services))
        or (outputs["backend"] == "true") != bool(services)
    ):
        raise ValueError("Inconsistent service selection")
    for job in ("web", "backend", "terraform"):
        expected = "success" if outputs[job] == "true" else "skipped"
        if not isinstance(needs[job], dict) or needs[job].get("result") != expected:
            raise ValueError(f"{job} must be {expected}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("detect", "gate"))
    args = parser.parse_args()
    if args.command == "detect":
        outputs = detect(
            os.environ.get("GITHUB_EVENT_NAME", ""), os.environ.get("GITHUB_EVENT_PATH", "")
        ).outputs()
        print(json.dumps(outputs, sort_keys=True))
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            for key, value in outputs.items():
                output.write(f"{key}={value}\n")
    else:
        try:
            validate_gate(json.loads(os.environ.get("NEEDS_JSON", "null")))
        except (ValueError, TypeError) as error:
            print(f"Quality checks failed: {error}")
            return 1
        print("All selected quality checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
