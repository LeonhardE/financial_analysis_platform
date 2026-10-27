"""Run selected service suites in separate processes so app packages cannot mask each other."""

import argparse
import os
import subprocess
import sys
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
    selected = parser.parse_args().service or services
    failed = False
    for service in dict.fromkeys(selected):
        relative = "services/common" if service == "common" else registry.target(service).directory
        directory = ROOT / relative
        environment = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join((str(ROOT / "services" / "common"), str(directory))),
        }
        print(f"Running {service} tests", flush=True)
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
