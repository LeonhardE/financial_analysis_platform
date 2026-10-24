"""Install a checksum-pinned Terraform CLI or validate roots without cloud credentials."""

import argparse
import hashlib
import io
import json
import os
import platform
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / "infra/gcp/terraform"


def install(destination: Path) -> Path:
    toolchain = json.loads((DIRECTORY / "toolchain.json").read_text())
    system = platform.system().lower()
    machine = {"x86_64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine())
    archive_key = f"{system}_{machine}"
    if archive_key not in toolchain["archives"]:
        raise ValueError("Supported platforms: Linux/macOS, amd64/arm64.")
    version = toolchain["terraform_version"]
    name = f"terraform_{version}_{archive_key}.zip"
    with urlopen(
        f"https://releases.hashicorp.com/terraform/{version}/{name}", timeout=120
    ) as response:
        archive = response.read()
    if hashlib.sha256(archive).hexdigest() != toolchain["archives"][archive_key]:
        raise ValueError("Terraform archive checksum does not match the committed toolchain.")
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        binary = bundle.read("terraform")
    with tempfile.NamedTemporaryFile(dir=destination, delete=False) as output:
        temporary = Path(output.name)
        output.write(binary)
    try:
        temporary.chmod(0o755)
        temporary.replace(destination / "terraform")
    finally:
        temporary.unlink(missing_ok=True)
    return destination / "terraform"


def check(terraform: str) -> None:
    toolchain = json.loads((DIRECTORY / "toolchain.json").read_text())
    actual = json.loads(subprocess.check_output([terraform, "version", "-json"], text=True))
    if actual["terraform_version"] != toolchain["terraform_version"]:
        raise ValueError("Terraform version must match terraform/toolchain.json.")
    environment = {**os.environ, "TF_IN_AUTOMATION": "1", "CHECKPOINT_DISABLE": "1"}
    subprocess.run([terraform, "fmt", "-check", "-recursive", str(DIRECTORY)], check=True)
    # Every independently initialized root/module declares its toolchain in versions.tf.
    roots = sorted(
        path.parent for path in DIRECTORY.rglob("versions.tf") if ".terraform" not in path.parts
    )
    for root in roots:
        print(
            f"Validating {root.relative_to(ROOT)} without a backend or cloud credentials",
            flush=True,
        )
        for arguments in (
            ["init", "-backend=false", "-input=false", "-lockfile=readonly", "-no-color"],
            ["validate", "-no-color"],
        ):
            subprocess.run([terraform, *arguments], cwd=root, env=environment, check=True)
        if list((root / "tests").glob("*.tftest.hcl")):
            subprocess.run([terraform, "test", "-no-color"], cwd=root, env=environment, check=True)

    # Exercise the pinned provider's real HTTP serialization, not only mocked
    # schemas. These localhost regressions must reproduce the adoption blockers.
    subprocess.run(
        [
            sys.executable,
            str(DIRECTORY / "compatibility/provider_check.py"),
            "--terraform",
            terraform,
        ],
        env=environment,
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    setup = subparsers.add_parser("install")
    setup.add_argument("--directory", type=Path, required=True)
    validate = subparsers.add_parser("check")
    validate.add_argument("--terraform", default="terraform")
    args = parser.parse_args()
    if args.command == "install":
        print(install(args.directory).resolve())
    else:
        check(args.terraform)


if __name__ == "__main__":
    main()
