"""Run selected service suites in separate processes so app packages cannot mask each other."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ("common", "market-data-service", "user-service", "config-service")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--service",
        action="append",
        choices=SERVICES,
        help="Run only this suite; repeat to select more. Defaults to every suite.",
    )
    selected = parser.parse_args().service or SERVICES
    failed = False
    for service in dict.fromkeys(selected):
        directory = ROOT / "services" / service
        environment = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join((str(ROOT / "services" / "common"), str(directory))),
        }
        print(f"Running {service} tests", flush=True)
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            cwd=directory,
            env=environment,
            check=False,
        )
        failed = failed or result.returncode != 0
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
