"""Checksum-pinned, redacted Gitleaks scanning of history, index and worktree."""

import argparse
import hashlib
import io
import json
import os
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from git_environment import isolated_git_environment  # noqa: E402

TOOLCHAIN = Path(__file__).with_name("gitleaks-toolchain.json")
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_BINARY_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024
MAX_FILES = 20_000
MAX_INDEX_BYTES = 32 * 1024 * 1024


class SecurityScanError(ValueError):
    """Fixed diagnostic only; subprocess output and matching values stay private."""


def toolchain():
    value = json.loads(TOOLCHAIN.read_text())
    if (
        set(value) != {"version", "release_url", "checksums_url", "platforms"}
        or re.fullmatch(r"\d+\.\d+\.\d+", value["version"]) is None
        or set(value["platforms"]) != {"linux_x64", "linux_arm64", "darwin_x64", "darwin_arm64"}
    ):
        raise SecurityScanError("Invalid secret-scanner toolchain.")
    for row in value["platforms"].values():
        if set(row) != {"archive_sha256", "binary_sha256"} or any(
            re.fullmatch(r"[a-f0-9]{64}", digest) is None for digest in row.values()
        ):
            raise SecurityScanError("Invalid secret-scanner digest.")
    return value


def platform_key():
    system = platform.system().lower()
    machine = {"x86_64": "x64", "AMD64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(
        platform.machine()
    )
    key = f"{system}_{machine}"
    if key not in toolchain()["platforms"]:
        raise SecurityScanError("Gitleaks supports Linux/macOS on x64/arm64 here.")
    return key


def verify_binary(executable):
    executable = Path(executable)
    if executable.is_symlink() or not executable.is_file():
        raise SecurityScanError("A regular checksum-pinned scanner executable is required.")
    if executable.stat().st_size > MAX_BINARY_BYTES:
        raise SecurityScanError("Scanner executable exceeds the toolchain budget.")
    actual = hashlib.sha256(executable.read_bytes()).hexdigest()
    if actual != toolchain()["platforms"][platform_key()]["binary_sha256"]:
        raise SecurityScanError("Scanner executable checksum does not match its pinned toolchain.")
    return executable.resolve()


def install(directory):
    metadata = toolchain()
    key = platform_key()
    directory = Path(directory)
    executable = directory / "gitleaks"
    if executable.exists():
        return verify_binary(executable)
    name = f"gitleaks_{metadata['version']}_{key}.tar.gz"
    url = f"https://github.com/gitleaks/gitleaks/releases/download/v{metadata['version']}/{name}"
    with urlopen(
        Request(url, headers={"User-Agent": "FolioView-security-toolchain"}), timeout=60
    ) as r:
        archive = r.read(MAX_ARCHIVE_BYTES + 1)
    if (
        len(archive) > MAX_ARCHIVE_BYTES
        or hashlib.sha256(archive).hexdigest() != metadata["platforms"][key]["archive_sha256"]
    ):
        raise SecurityScanError("Scanner archive checksum or size does not match its toolchain.")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        member = bundle.getmember("gitleaks")
        if not member.isfile() or member.size > MAX_BINARY_BYTES:
            raise SecurityScanError("Invalid scanner archive member.")
        binary = bundle.extractfile(member).read(MAX_BINARY_BYTES + 1)
    if hashlib.sha256(binary).hexdigest() != metadata["platforms"][key]["binary_sha256"]:
        raise SecurityScanError("Scanner binary checksum does not match its pinned toolchain.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as output:
        temporary = Path(output.name)
        output.write(binary)
    try:
        temporary.chmod(0o755)
        temporary.replace(executable)
    finally:
        temporary.unlink(missing_ok=True)
    return verify_binary(executable)


def git(root, *arguments, index=None):
    environment = isolated_git_environment()
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    if index is not None:
        environment["GIT_INDEX_FILE"] = str(index)
    result = subprocess.run(
        ["git", *arguments],
        cwd=root,
        env=environment,
        capture_output=True,
        check=False,
        timeout=60,
    )
    if result.returncode:
        raise SecurityScanError("Git source discovery failed; no successful scan is claimed.")
    return result.stdout


def repository_index(root, directory):
    """Bind hook/alternate indexes to the caller's selected repository, then copy.

    An explicit different --root intentionally ignores the caller's index. Within
    the same repository an invalid active index fails, never silently falls back.
    Only ls-files receives this private copy; object/history commands stay clean.
    """
    selected = Path(os.fsdecode(git(root, "rev-parse", "--show-toplevel")).strip()).resolve()
    if selected != root:
        raise SecurityScanError("Select the repository root for complete secret scanning.")
    active = os.environ.get("GIT_INDEX_FILE")
    caller = None
    if active is not None:
        try:
            caller = Path(
                os.fsdecode(git(Path.cwd(), "rev-parse", "--show-toplevel")).strip()
            ).resolve()
        except SecurityScanError:
            pass
    if active is not None and caller == root:
        git_directory = Path(
            os.fsdecode(git(root, "rev-parse", "--absolute-git-dir")).strip()
        ).resolve()
        for variable, expected in [("GIT_DIR", git_directory), ("GIT_WORK_TREE", root)]:
            supplied = os.environ.get(variable)
            if supplied is not None and (not supplied or Path(supplied).resolve() != expected):
                raise SecurityScanError("Active index does not match the selected repository.")
        if not active:
            raise SecurityScanError("A nonempty active index path is required.")
        original = Path(active)
        required = True
    else:
        original = Path(os.fsdecode(git(root, "rev-parse", "--git-path", "index")).strip())
        if not original.is_absolute():
            original = root / original
        required = False
    output = directory / "selected-index"
    if not original.exists() and not original.is_symlink() and not required:
        # An uninitialized default index is an empty staged source, as in Git.
        return output
    if original.is_symlink() or not original.is_file():
        raise SecurityScanError("The selected Git index must be a regular file.")
    if original.stat().st_size > MAX_INDEX_BYTES:
        raise SecurityScanError("The selected Git index exceeds its scan budget.")
    with original.open("rb") as source:
        content = source.read(MAX_INDEX_BYTES + 1)
    if len(content) > MAX_INDEX_BYTES:
        raise SecurityScanError("The selected Git index exceeds its scan budget.")
    output.write_bytes(content)
    return output


def relative_path(value):
    path = PurePosixPath(os.fsdecode(value))
    if path.is_absolute() or not path.parts or any(part in {"..", ".git"} for part in path.parts):
        raise SecurityScanError("Invalid repository file path.")
    return path


def write_snapshot_file(destination, path, content, budget):
    if len(content) > MAX_FILE_BYTES or budget[0] + len(content) > MAX_SNAPSHOT_BYTES:
        raise SecurityScanError("Repository snapshot exceeds the secret-scan byte budget.")
    budget[0] += len(content)
    output = destination.joinpath(*path.parts)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(content)


def snapshots(root, directory):
    """Scan staged bytes independently of the working copy; never follow symlinks."""
    index = directory / "index"
    current = directory / "worktree"
    index.mkdir()
    current.mkdir()
    budget = [0]
    selected_index = repository_index(root, directory)
    entries = git(root, "ls-files", "--stage", "-z", index=selected_index).split(b"\0")
    if len(entries) > MAX_FILES + 1:
        raise SecurityScanError("Repository snapshot exceeds the secret-scan file budget.")
    for entry in filter(None, entries):
        identity, filename = entry.split(b"\t", 1)
        mode, digest, stage = identity.split()
        if stage != b"0" or re.fullmatch(rb"[a-f0-9]{40,64}", digest) is None:
            raise SecurityScanError("Resolve index conflicts before scanning or committing.")
        if mode == b"160000":
            raise SecurityScanError("Submodule content requires its own secret-scan policy.")
        path = relative_path(filename)
        size = int(git(root, "cat-file", "-s", digest.decode("ascii")))
        if size > MAX_FILE_BYTES or budget[0] + size > MAX_SNAPSHOT_BYTES:
            raise SecurityScanError("Repository snapshot exceeds the secret-scan byte budget.")
        content = git(root, "cat-file", "blob", digest.decode("ascii"))
        write_snapshot_file(index, path, content, budget)
    files = git(
        root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", index=selected_index
    ).split(b"\0")
    if len(files) > MAX_FILES + 1:
        raise SecurityScanError("Repository snapshot exceeds the secret-scan file budget.")
    for filename in filter(None, files):
        path = relative_path(filename)
        source = root.joinpath(*path.parts)
        # An index symlink's target text is scanned above; external targets never are.
        if source.is_symlink() or any(
            parent.is_symlink() for parent in source.parents if parent != root
        ):
            continue
        if not source.exists():
            continue
        if not source.is_file() or source.stat().st_size > MAX_FILE_BYTES:
            raise SecurityScanError("Repository file exceeds the secret-scan size/type budget.")
        write_snapshot_file(current, path, source.read_bytes(), budget)
    return index, current


def _scan(executable, mode, target, temporary, policy):
    report = temporary / f"{mode}-{target.name}.json"
    no_ignores = temporary / "empty-ignore"
    no_ignores.mkdir(exist_ok=True)
    arguments = [
        str(executable),
        mode,
        ".",
        "--config=" + str(policy),
        "--redact=100",
        "--no-banner",
        "--log-level=error",
        "--ignore-gitleaks-allow",
        "--gitleaks-ignore-path=" + str(no_ignores),
        "--report-format=json",
        "--report-path=" + str(report),
        "--timeout=120",
        "--max-target-megabytes=0",
    ]
    if mode == "git":
        arguments.append("--log-opts=--all")
    result = subprocess.run(
        arguments, cwd=target, env=isolated_git_environment(), capture_output=True, timeout=150
    )
    if result.returncode not in {0, 1} or not report.is_file() or report.stat().st_size > 4_194_304:
        raise SecurityScanError(
            "Secret scanner failed; raw diagnostics are intentionally suppressed."
        )
    try:
        rows = json.loads(report.read_bytes())
        if not isinstance(rows, list) or len(rows) > 10_000:
            raise ValueError
        locations = []
        for row in rows:
            path = str(row["File"])
            if mode == "dir":
                path = str(Path(path).relative_to(target)) if Path(path).is_absolute() else path
            locations.append(
                {
                    "rule": str(row["RuleID"])[:128],
                    "path": path[:1024],
                    "line": int(row["StartLine"]),
                }
            )
    except (ValueError, KeyError, TypeError):
        raise SecurityScanError("Invalid scanner report; no successful scan is claimed.") from None
    if bool(rows) != (result.returncode == 1):
        raise SecurityScanError("Inconsistent scanner exit status/report.")
    return locations


def scan(executable, root=ROOT, policy=None):
    executable = verify_binary(executable)
    root = Path(root).resolve()
    policy = Path(policy) if policy is not None else ROOT / ".gitleaks.toml"
    if not policy.is_file():
        raise SecurityScanError("Explicit repository secret-scanning policy is required.")
    if git(root, "rev-parse", "--is-shallow-repository").strip() != b"false":
        raise SecurityScanError("Fetch complete history before running the required secret scan.")
    with tempfile.TemporaryDirectory(prefix="folioview-secret-scan-") as name:
        temporary = Path(name)
        index, current = snapshots(root, temporary)
        findings = []
        for mode, target in [("git", root), ("dir", index), ("dir", current)]:
            findings.extend(_scan(executable, mode, target, temporary, policy.resolve()))
    # Only rule/location metadata crosses the boundary. Never forward Match/Secret/Line.
    unique = {json.dumps(row, sort_keys=True): row for row in findings}
    for key in sorted(unique):
        print(json.dumps(unique[key], ensure_ascii=True, sort_keys=True))
    print(f"Secret scan completed: history, index and worktree; {len(unique)} unique finding(s).")
    return 1 if unique else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("install")
    command.add_argument("--directory", required=True)
    for action in ("scan", "check"):
        command = commands.add_parser(action)
        command.add_argument("--root", type=Path, default=ROOT)
        if action == "scan":
            command.add_argument("--gitleaks", required=True)
        else:
            command.add_argument("--directory", required=True)
    args = parser.parse_args()
    try:
        if args.command == "install":
            install(Path(args.directory))
            print("Checksum-pinned Gitleaks installed.")
            return 0
        executable = install(Path(args.directory)) if args.command == "check" else args.gitleaks
        return scan(executable, args.root)
    except Exception:
        print(
            "Secret scanning could not complete; check the pinned tool, history and configuration.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
