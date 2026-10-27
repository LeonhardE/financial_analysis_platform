"""Select affected CI targets and enforce the required aggregate check."""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from service_targets import (  # noqa: E402
    Registry,
    RegistryError,
    load_registry,
    parse_registry_document,
    validate_registry_transition,
)

# Compatibility exports for existing callers; operations load the current registry.
SERVICES = load_registry(ROOT).backend_ids
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


def full_plan(registry: Registry) -> Plan:
    return Plan(web=True, services=registry.backend_ids, infra=True, terraform=True)


def select(paths: list[str], registry: Registry | None = None) -> Plan:
    """Known leaf targets stay isolated; unknown executable paths fail conservatively."""
    registry = registry if registry is not None else load_registry(ROOT)
    # Check every path before an early FULL return can hide an unregistered target.
    for path in paths:
        parts = path.split("/")
        if len(parts) > 2 and parts[0] in {"services", "apps"} and not path.endswith(".md"):
            owner = "/".join(parts[:2])
            if owner != "services/common" and owner not in registry.by_directory:
                raise RegistryError("Changed executable target is not registered: " + owner)
    web = infra = terraform = False
    services = set()
    for path in paths:
        if path.startswith("local-docs/"):
            continue
        if path.startswith((".github/", "scripts/ci/")) or path in {
            "package.json",
            "scripts/service-targets.json",
            "scripts/service_targets.py",
        }:
            return full_plan(registry)
        if path.endswith(".md"):
            continue
        if path == ".dockerignore":
            web = True
            services.update(registry.backend_ids)
        elif path == "package-lock.json" or path.startswith(registry.web.directory + "/"):
            web = True
        elif path == "services/market-data-service/pyproject.toml":
            # Root Python quality commands use this Ruff configuration for every target.
            services.update(registry.backend_ids)
            infra = True
        elif path == "scripts/test_services.py":
            services.update(registry.backend_ids)
            infra = True
        elif path.startswith("services/common/") or path == "services/requirements-dev.txt":
            services.update(registry.backend_ids)
        elif any(path.startswith(target.directory + "/") for target in registry.backends):
            services.add(
                next(
                    target.id
                    for target in registry.backends
                    if path.startswith(target.directory + "/")
                )
            )
        elif path in registry.cloudbuild_targets:
            target = registry.target(registry.cloudbuild_targets[path])
            if target.kind == "web":
                web = True
            else:
                services.add(target.id)
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
            return full_plan(registry)
        elif path in REPOSITORY_FILES:
            continue
        else:
            return full_plan(registry)
    return Plan(
        web=web,
        services=tuple(item for item in registry.backend_ids if item in services),
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


def detect(event_name: str, event_path: str, registry: Registry | None = None) -> Plan:
    # Registry/inventory errors must fail CI, never enter diff's conservative fallback.
    registry = registry if registry is not None else load_registry(ROOT)
    try:
        event = json.loads(Path(event_path).read_text())
        if event_name == "pull_request":
            base = event["pull_request"]["base"]["sha"]
            head = event["pull_request"]["head"]["sha"]
        elif event_name == "push":
            base, head = event["before"], event["after"]
        else:
            raise ValueError
        if not all(
            isinstance(sha, str) and SHA.fullmatch(sha) and int(sha, 16) for sha in (base, head)
        ):
            raise ValueError
    except (OSError, ValueError, KeyError, TypeError):
        raise RegistryError("Unable to establish the registration comparison base") from None
    try:
        subprocess.run(
            ["git", "cat-file", "-e", f"{base}^{{commit}}"], check=True, capture_output=True
        )
        validate_base_registration(event_name, event, registry)
    except (OSError, subprocess.CalledProcessError):
        raise RegistryError("Unable to verify registration against the comparison base") from None
    # RegistrationError is deliberately outside this fallback: adding existing
    # mode or removing a target cannot be hidden by forcing git diff to fail.
    try:
        paths = changed_paths(event_name, event)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError):
        print("Comparison unavailable; checking every target.")
        return full_plan(registry)
    print(f"Compared {len(paths)} changed paths.")
    return select(paths, registry)


def validate_base_registration(event_name: str, event: dict, registry: Registry) -> None:
    """Compare reviewed registration with the real base, including first bootstrap.

    New registrations begin build_only. During introduction of the registry,
    only source/build files already present at the comparison base can retain
    existing mode. Invalid registration/history is not a diff fallback.
    """
    base = event["pull_request"]["base"]["sha"] if event_name == "pull_request" else event["before"]
    path = "scripts/service-targets.json"
    listed = subprocess.run(
        ["git", "ls-tree", "--name-only", base, "--", path],
        check=True,
        capture_output=True,
    )
    if listed.stdout.strip():
        previous = subprocess.run(
            ["git", "show", f"{base}:{path}"],
            check=True,
            capture_output=True,
        )
        validate_registry_transition(parse_registry_document(previous.stdout), registry)
    else:
        legacy = []
        for target in registry.targets:
            if all(
                subprocess.run(
                    ["git", "cat-file", "-e", f"{base}:{filename}"],
                    check=False,
                    capture_output=True,
                ).returncode
                == 0
                for filename in (target.dockerfile, target.cloudbuild)
            ):
                legacy.append(target.id)
        validate_registry_transition(None, registry, legacy_existing_ids=legacy)


def validate_gate(needs: dict, registry: Registry | None = None) -> None:
    """Reject missing output or an unexpectedly skipped, failed, or cancelled check."""
    registry = registry if registry is not None else load_registry(ROOT)
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
        or any(
            not isinstance(service, str) or service not in registry.backend_ids
            for service in services
        )
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
    parser.add_argument("--verify-matrix", action="store_true")
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
            needs = json.loads(os.environ.get("NEEDS_JSON", "null"))
            validate_gate(needs)
            if args.verify_matrix:
                from service_job import verify_backend_jobs

                verify_backend_jobs(tuple(json.loads(needs["changes"]["outputs"]["services"])))
        except (ValueError, TypeError) as error:
            print(f"Quality checks failed: {error}")
            return 1
        print("All selected quality checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
