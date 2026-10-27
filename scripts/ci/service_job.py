"""Registered service job metadata and read-only matrix completion evidence.

The required gate reads jobs from its own Actions run attempt. A successful
matrix aggregate alone cannot stand in for every selected service's test,
image-build and isolated-health steps. No cloud credentials or API are used.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from service_targets import RegistryError, load_registry  # noqa: E402

REQUIRED_STEPS = (
    "Check this service and its shared library",
    "Build independent backend image",
    "Check isolated runtime health",
)
_REPOSITORY = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*\Z")
_NUMBER = re.compile(r"[1-9][0-9]{0,19}\Z")
_MAX_RESPONSE = 2_097_152
_MAX_JOBS = 1_000


class MatrixEvidenceError(ValueError):
    pass


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(req.full_url, code, "Actions API redirect refused", headers, fp)


def _read_jobs_page(path: str, token: str) -> dict:
    request = Request(
        "https://api.github.com" + path,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with build_opener(_NoRedirects()).open(request, timeout=15) as response:
            if response.status != 200:
                raise ValueError
            raw = response.read(_MAX_RESPONSE + 1)
            if len(raw) > _MAX_RESPONSE:
                raise ValueError
            return json.loads(raw)
    except Exception:
        raise MatrixEvidenceError("Unable to read current Actions attempt job evidence") from None


def verify_backend_jobs(
    selected: tuple[str, ...],
    *,
    repository: str | None = None,
    run_id: str | None = None,
    attempt: str | None = None,
    token: str | None = None,
    fetch: Callable[[str], dict] | None = None,
) -> None:
    """Require one completed child and every critical step for each selected target.

    Pagination is bounded; evidence cannot come from another run attempt. Empty
    selection makes no HTTP request, preserving docs-only PRs and skipped jobs.
    Tests inject a page transport, never live GitHub tokens or network calls.
    """
    if not selected:
        return
    if any(not isinstance(s, str) for s in selected) or len(selected) != len(set(selected)):
        raise MatrixEvidenceError("Invalid selected service evidence set")
    repository = repository or os.environ.get("GITHUB_REPOSITORY", "")
    run_id = run_id or os.environ.get("GITHUB_RUN_ID", "")
    attempt = attempt or os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if (
        not _REPOSITORY.fullmatch(repository)
        or not _NUMBER.fullmatch(run_id)
        or not _NUMBER.fullmatch(attempt)
    ):
        raise MatrixEvidenceError("Missing current Actions run identity")
    if fetch is None:
        token = token or os.environ.get("GITHUB_TOKEN", "")
        if (
            not token
            or len(token) > 8192
            or any(char.isspace() or not char.isascii() for char in token)
        ):
            raise MatrixEvidenceError("Missing Actions read credential")

        def fetch(path):
            return _read_jobs_page(path, token)

    jobs, total = [], None
    for page_number in range(1, 11):
        path = (
            f"/repos/{repository}/actions/runs/{run_id}/attempts/{attempt}/jobs"
            f"?per_page=100&page={page_number}"
        )
        try:
            page = fetch(path)
        except MatrixEvidenceError:
            raise
        except Exception:
            raise MatrixEvidenceError(
                "Unable to read current Actions attempt job evidence"
            ) from None
        if (
            not isinstance(page, dict)
            or type(page.get("total_count")) is not int
            or not 0 <= page["total_count"] <= _MAX_JOBS
            or not isinstance(page.get("jobs"), list)
            or not 1 <= len(page["jobs"]) <= 100
            or (total is not None and total != page["total_count"])
        ):
            raise MatrixEvidenceError("Incomplete Actions job pagination")
        total = page["total_count"]
        jobs.extend(page["jobs"])
        if len(jobs) >= total:
            break
    if total is None or len(jobs) != total:
        raise MatrixEvidenceError("Incomplete Actions job pagination")
    ids = [job.get("id") for job in jobs if isinstance(job, dict)]
    if (
        len(ids) != len(jobs)
        or any(type(identifier) is not int for identifier in ids)
        or len(ids) != len(set(ids))
    ):
        raise MatrixEvidenceError("Duplicate or malformed Actions job evidence")
    names = {f"Service checks ({service})" for service in selected}
    children = [job for job in jobs if str(job.get("name", "")).startswith("Service checks (")]
    if len(children) != len(names) or {job.get("name") for job in children} != names:
        raise MatrixEvidenceError("Selected matrix service evidence does not match")
    for child in children:
        if child.get("status") != "completed" or child.get("conclusion") != "success":
            raise MatrixEvidenceError("Selected matrix child did not succeed")
        steps = child.get("steps")
        if not isinstance(steps, list) or any(not isinstance(step, dict) for step in steps):
            raise MatrixEvidenceError("Missing selected matrix step evidence")
        for name in REQUIRED_STEPS:
            matching = [step for step in steps if step.get("name") == name]
            if (
                len(matching) != 1
                or matching[0].get("status") != "completed"
                or matching[0].get("conclusion") != "success"
            ):
                raise MatrixEvidenceError("Selected service test/build/health step did not succeed")


def write_metadata(target_id: str) -> None:
    registry = load_registry(ROOT)
    target = registry.target(target_id)
    if target.kind != "backend":
        raise RegistryError("Backend job requires a registered backend target")
    values = {
        "directory": target.directory,
        "dockerfile": target.dockerfile,
        "requirements_dev": target.requirements_dev,
        "ruff_config": target.ruff_config or "",
        "tests": target.tests,
    }
    # Registry paths are closed, relative, ASCII and shell-safe. No user text or
    # token is appended to the Actions output protocol.
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")


def check_target(target_id: str) -> None:
    registry = load_registry(ROOT)
    target = registry.target(target_id)
    if target.kind != "backend":
        raise RegistryError("Backend job requires a registered backend target")
    configs = ["services/market-data-service/pyproject.toml"]
    if target.ruff_config and target.ruff_config not in configs:
        configs.append(target.ruff_config)
    for config in configs:
        for command in (
            ["check", "--config", config, target.directory, "services/common"],
            ["format", "--check", "--config", config, target.directory, "services/common"],
        ):
            subprocess.run([sys.executable, "-m", "ruff", *command], cwd=ROOT, check=True)
    subprocess.run(
        [sys.executable, "scripts/test_services.py", "--service", "common", "--service", target.id],
        cwd=ROOT,
        check=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("metadata", "check"))
    parser.add_argument("target")
    args = parser.parse_args()
    try:
        if args.command == "metadata":
            write_metadata(args.target)
        else:
            check_target(args.target)
    except (RegistryError, OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f"Registered service job failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
