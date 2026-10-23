"""Run every service suite in its own process so app packages cannot mask each other."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ("common", "market-data-service", "user-service", "config-service")


def main() -> int:
    failed = False
    for service in SERVICES:
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
