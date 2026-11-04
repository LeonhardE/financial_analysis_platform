"""Run selected service suites in separate processes so app packages cannot mask each other."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from service_targets import RegistryError, load_registry  # noqa: E402

SERVICES = ("common", *load_registry(ROOT).backend_ids)
CHILD_RUNNER = """import sys, unittest
suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern='test*.py')
if suite.countTestCases() == 0:
    print('Refusing an empty service test suite.', file=sys.stderr)
    raise SystemExit(1)
result = unittest.TextTestRunner(verbosity=2).run(suite)
if result.testsRun - len(result.skipped) <= 0:
    print('Refusing an entirely skipped service test suite.', file=sys.stderr)
    raise SystemExit(1)
raise SystemExit(0 if result.wasSuccessful() else 1)
"""

PARALLEL_CHILD_RUNNER = """import json, sys, unittest
def ids(suite):
    return [
        identifier for item in suite
        for identifier in (ids(item) if isinstance(item, unittest.TestSuite) else [item.id()])
    ]
suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern='test*.py')
groups = list(suite)
expected = ids(groups)
index, workers = int(sys.argv[2]), int(sys.argv[3])
selected = unittest.TestSuite(
    group for position, group in enumerate(groups) if position % workers == index
)
assigned = ids(selected)
result = unittest.TextTestRunner(verbosity=2).run(selected)
with open(sys.argv[4], 'w') as output:
    json.dump(dict(
        expected=expected, assigned=assigned, run=result.testsRun,
        skipped=len(result.skipped), successful=result.wasSuccessful()
    ), output)
raise SystemExit(0 if result.wasSuccessful() else 1)
"""


def run_parallel(directory: Path, environment: dict, jobs: int) -> bool:
    """Keep module/class fixtures in one process; prove complete discovery coverage."""
    with tempfile.TemporaryDirectory(prefix="folioview-test-shards-") as scratch:
        reports = [Path(scratch) / f"{index}.json" for index in range(jobs)]

        def run(index):
            return subprocess.run(
                [
                    sys.executable,
                    "-c",
                    PARALLEL_CHILD_RUNNER,
                    str(directory / "tests"),
                    str(index),
                    str(jobs),
                    str(reports[index]),
                ],
                cwd=directory,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )

        with ThreadPoolExecutor(max_workers=jobs) as pool:
            results = list(pool.map(run, range(jobs)))
        for index, result in enumerate(results):
            print(f"Test shard {index + 1}/{jobs}", flush=True)
            print(result.stdout, end="", flush=True)
            print(result.stderr, end="", file=sys.stderr, flush=True)
        try:
            summaries = [json.loads(report.read_text()) for report in reports]
            expected = summaries[0]["expected"]
            complete = (
                bool(expected)
                and all(summary["expected"] == expected for summary in summaries)
                and Counter(
                    identifier for summary in summaries for identifier in summary["assigned"]
                )
                == Counter(expected)
                and all(
                    summary["successful"] is True
                    and summary["run"] == len(summary["assigned"])
                    and 0 <= summary["skipped"] <= summary["run"]
                    for summary in summaries
                )
                and sum(summary["run"] - summary["skipped"] for summary in summaries) > 0
                and all(result.returncode == 0 for result in results)
            )
        except (OSError, ValueError, KeyError, TypeError):
            complete = False
        if not complete:
            print(
                "Parallel test execution failed or discovery coverage was incomplete.",
                file=sys.stderr,
            )
            return False
        print(
            f"Verified {len(expected)} discovered tests across {jobs} isolated shards.",
            flush=True,
        )
        return True


def main() -> int:
    try:
        registry = load_registry(ROOT)
    except RegistryError as error:
        print(f"Service registration failed: {error}", file=sys.stderr)
        return 1
    services = ("common", *registry.backend_ids)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--service",
        action="append",
        choices=services,
        help="Run only this suite; repeat to select more. Defaults to every suite.",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        choices=range(1, 9),
        help="Isolated workers per suite; defaults to 4 for Agent Hub and 1 for other suites.",
    )
    arguments = parser.parse_args()
    selected = arguments.service or services
    failed = False
    for service in dict.fromkeys(selected):
        relative = "services/common" if service == "common" else registry.target(service).directory
        directory = ROOT / relative
        environment = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join((str(ROOT / "services" / "common"), str(directory))),
        }
        print(f"Running {service} tests", flush=True)
        jobs = arguments.jobs or (4 if service == "agent-hub-service" else 1)
        if jobs > 1:
            failed = not run_parallel(directory, environment, jobs) or failed
            continue
        result = subprocess.run(
            [sys.executable, "-c", CHILD_RUNNER, str(directory / "tests")],
            cwd=directory,
            env=environment,
            check=False,
        )
        failed = failed or result.returncode != 0
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
