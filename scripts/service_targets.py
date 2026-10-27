"""Closed source-target registration shared by CI, test runners and release tools.

Only real, registered source trees are eligible. This registry creates no cloud
resource and does not grant permission to provision one. Each new backend joins
in its own target PR with its source/test/build files and build_only release mode.
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection, Mapping
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath
from types import MappingProxyType

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = "scripts/service-targets.json"
MAX_REGISTRY_BYTES = 65_536
MAX_TARGETS = 64
_ID = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")
_PATH = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]*\Z")
_BUILD_PATH = re.compile(r"infra/gcp/cloudbuild\.[a-z0-9-]+\.yaml\Z")
_TARGET_FIELDS = frozenset({"id", "kind", "directory", "service", "cloudbuild", "release_mode"})
_IGNORED_DIRS = frozenset(
    {"__pycache__", "build", "node_modules", "out", ".venv", ".pytest_cache", ".ruff_cache"}
)
_EXECUTABLE_SUFFIXES = frozenset(
    {".py", ".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs", ".sh", ".go", ".rs"}
)


class RegistryError(ValueError):
    """An invalid or incomplete repository registration must not silently pass CI."""


@dataclass(frozen=True)
class Target:
    id: str
    kind: str
    directory: str
    service: str
    cloudbuild: str
    release_mode: str
    ruff_config: str | None = None

    @property
    def dockerfile(self) -> str:
        return self.directory + "/Dockerfile"

    @property
    def requirements_dev(self) -> str | None:
        return self.directory + "/requirements-dev.txt" if self.kind == "backend" else None

    @property
    def tests(self) -> str:
        return self.directory + "/tests"


@dataclass(frozen=True)
class Registry:
    root: Path
    targets: tuple[Target, ...]

    @property
    def backends(self) -> tuple[Target, ...]:
        return tuple(target for target in self.targets if target.kind == "backend")

    @property
    def backend_ids(self) -> tuple[str, ...]:
        return tuple(target.id for target in self.backends)

    @property
    def web(self) -> Target:
        return next(target for target in self.targets if target.kind == "web")

    @property
    def by_id(self) -> Mapping[str, Target]:
        return MappingProxyType({target.id: target for target in self.targets})

    @property
    def by_service(self) -> Mapping[str, Target]:
        return MappingProxyType({target.service: target for target in self.targets})

    @property
    def by_directory(self) -> Mapping[str, Target]:
        return MappingProxyType({target.directory: target for target in self.targets})

    @property
    def cloudbuild_targets(self) -> Mapping[str, str]:
        return MappingProxyType({target.cloudbuild: target.id for target in self.targets})

    def target(self, target_id: str) -> Target:
        try:
            return self.by_id[target_id]
        except (TypeError, KeyError):
            raise RegistryError("Target is not registered") from None


def _closed_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise RegistryError("Duplicate registry field")
        result[key] = value
    return result


def _identifier(value: object, *, maximum: int = 63) -> str:
    if type(value) is not str or not 1 <= len(value) <= maximum or _ID.fullmatch(value) is None:
        raise RegistryError("Invalid target identifier")
    return value


def _relative(value: object) -> str:
    if (
        type(value) is not str
        or not 1 <= len(value) <= 256
        or _PATH.fullmatch(value) is None
        or value.endswith("/")
        or "//" in value
        or any(part in {"", ".", ".."} for part in value.split("/"))
        or PurePosixPath(value).is_absolute()
    ):
        raise RegistryError("Invalid repository-relative target path")
    return value


def _inside(root: Path, value: str) -> Path:
    relative = _relative(value)
    cursor = root
    for part in relative.split("/"):
        cursor = cursor / part
        if cursor.is_symlink():
            raise RegistryError("Target paths must not contain symbolic links")
    if not cursor.resolve().is_relative_to(root):
        raise RegistryError("Target path escapes repository")
    return cursor


def _file(root: Path, value: str) -> Path:
    path = _inside(root, value)
    if not path.is_file():
        raise RegistryError("Registered target is missing a required file: " + value)
    return path


def _test_directory(root: Path, value: str, pattern: str) -> None:
    path = _inside(root, value)
    if not path.is_dir():
        raise RegistryError("Registered target is missing its test directory: " + value)
    matches = list(path.glob(pattern))
    if not matches:
        raise RegistryError("Registered target must contain discoverable tests: " + value)
    for match in matches:
        _file(root, match.relative_to(root).as_posix())


def _is_unregistered_source(path: Path, *, frontend: bool) -> bool:
    """Documentation-only plans may exist before registration, executable sources may not."""
    markers = (
        ("app", "Dockerfile", "tests", "package.json")
        if frontend
        else (
            "app",
            "Dockerfile",
            "tests",
            "requirements.txt",
            "requirements-dev.txt",
            "pyproject.toml",
        )
    )
    if any((path / marker).exists() or (path / marker).is_symlink() for marker in markers):
        return True
    # New nonstandard Python sources are still executable even before a Dockerfile.
    # Markdown, diagrams and documentation data do not register a service. Code
    # stays executable even when placed under a directory named docs.
    for child in path.iterdir():
        if child.name in _IGNORED_DIRS:
            continue
        if child.is_symlink() or (child.is_file() and child.suffix in _EXECUTABLE_SUFFIXES):
            return True
        if child.is_dir() and _is_unregistered_source(child, frontend=frontend):
            return True
    return False


def _inventory(root: Path, targets: tuple[Target, ...]) -> None:
    registered = {target.directory for target in targets}
    for parent, frontend in (("services", False), ("apps", True)):
        directory = _inside(root, parent)
        if not directory.is_dir():
            raise RegistryError("Repository is missing a target source root")
        for path in directory.iterdir():
            if path.name in _IGNORED_DIRS or (parent == "services" and path.name == "common"):
                continue
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                raise RegistryError("Target source roots must not be symbolic links")
            if not path.is_dir() or relative in registered:
                continue
            if _is_unregistered_source(path, frontend=frontend):
                raise RegistryError("Unregistered executable target directory: " + relative)


def parse_registry_document(raw: bytes | str) -> tuple[Target, ...]:
    """Validate bounded registry metadata without consulting any source files.

    This supports comparison against an authenticated Git snapshot whose source
    files may no longer exist. It deliberately returns metadata, not a runnable
    Registry; only load_registry validates current file and inventory ownership.
    """
    try:
        if type(raw) is str:
            raw = raw.encode("utf-8", "strict")
        if type(raw) is not bytes or len(raw) > MAX_REGISTRY_BYTES:
            raise RegistryError("Target registry exceeds its byte budget or has an invalid type")
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=_closed_object)
        if (
            type(document) is not dict
            or set(document) != {"schema_version", "targets"}
            or type(document["schema_version"]) is not int
            or document["schema_version"] != 1
            or type(document["targets"]) is not list
            or not 1 <= len(document["targets"]) <= MAX_TARGETS
        ):
            raise RegistryError("Invalid target registry version or shape")
        targets = []
        seen = {field: set() for field in ("id", "directory", "service", "cloudbuild")}
        for row in document["targets"]:
            if type(row) is not dict or set(row) != _TARGET_FIELDS:
                raise RegistryError("Invalid target registration fields")
            identifier = _identifier(row["id"])
            # Cloud Run serviceId must contain fewer than 50 characters.
            service = _identifier(row["service"], maximum=49)
            directory, cloudbuild = _relative(row["directory"]), _relative(row["cloudbuild"])
            kind, release_mode = row["kind"], row["release_mode"]
            if (
                kind not in {"backend", "web"}
                or release_mode not in {"existing", "build_only"}
                or _BUILD_PATH.fullmatch(cloudbuild) is None
                or (
                    kind == "backend"
                    and (identifier in {"common", "web"} or directory != "services/" + identifier)
                )
                or (kind == "web" and (identifier != "web" or directory != "apps/web"))
            ):
                raise RegistryError("Invalid target kind, source ownership or release mode")
            for field, value in (
                ("id", identifier),
                ("directory", directory),
                ("service", service),
                ("cloudbuild", cloudbuild),
            ):
                if value in seen[field]:
                    raise RegistryError("Duplicate target registration " + field)
                seen[field].add(value)
            targets.append(Target(identifier, kind, directory, service, cloudbuild, release_mode))
        if len([target for target in targets if target.kind == "web"]) != 1:
            raise RegistryError("Exactly one existing web target must be registered")
        return tuple(targets)
    except RegistryError:
        raise
    except (UnicodeError, ValueError, TypeError, KeyError, RecursionError):
        raise RegistryError("Unable to parse valid target registry metadata") from None


def load_registry(root: Path = ROOT) -> Registry:
    """Load immutable source registration and fail closed on missing/unknown targets.

    This strict API intentionally has no skip-inventory/files switch. Synthetic
    tests use complete temporary source roots. The registry is trusted reviewed
    repository configuration, never a runtime request's target selector.
    """
    try:
        root = Path(root).resolve(strict=True)
        with _file(root, REGISTRY_PATH).open("rb") as stream:
            metadata = parse_registry_document(stream.read(MAX_REGISTRY_BYTES + 1))
        targets = []
        for target in metadata:
            directory = target.directory
            _file(root, target.dockerfile)
            _file(root, target.cloudbuild)
            ruff_config = None
            if target.kind == "backend":
                for filename in ("app/main.py", "requirements.txt", "requirements-dev.txt"):
                    _file(root, directory + "/" + filename)
                _test_directory(root, target.tests, "test*.py")
                optional_config = _inside(root, directory + "/pyproject.toml")
                if optional_config.exists():
                    _file(root, directory + "/pyproject.toml")
                    ruff_config = directory + "/pyproject.toml"
            else:
                _file(root, directory + "/package.json")
                _test_directory(root, target.tests, "*.test.cjs")
            targets.append(replace(target, ruff_config=ruff_config))
        result = Registry(root, tuple(targets))
        _file(root, "services/common/pyproject.toml")
        _test_directory(root, "services/common/tests", "test*.py")
        _inventory(root, result.targets)
        return result
    except RegistryError:
        raise
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, RecursionError):
        raise RegistryError("Unable to load a complete valid target registry") from None


def _metadata_bytes(targets: tuple[Target, ...]) -> bytes:
    if type(targets) is not tuple or any(not isinstance(target, Target) for target in targets):
        raise RegistryError("Invalid registry transition metadata")
    return json.dumps(
        {
            "schema_version": 1,
            "targets": [
                {field: getattr(target, field) for field in _TARGET_FIELDS} for target in targets
            ],
        }
    ).encode("utf-8")


def validate_registry_transition(
    previous: tuple[Target, ...] | None,
    current: Registry,
    *,
    legacy_existing_ids: Collection[str] = (),
) -> None:
    """Reject identity deletion/rename and premature deployment of new targets.

    previous is parsed from the trusted base Git snapshot, not request-supplied
    metadata. During initial registry adoption only targets proven to have source
    and build files in that base may be named in legacy_existing_ids. New IDs
    start build_only. A later reviewed target PR may promote build_only to
    existing; that declaration cannot provision anything. Normal runtime deploy
    still requires an existing service and refuses GET404 rather than creating.
    """
    if not isinstance(current, Registry):
        raise RegistryError("Invalid current registry transition metadata")
    current_targets = parse_registry_document(_metadata_bytes(current.targets))
    current_by_id = {target.id: target for target in current_targets}
    if previous is None:
        if isinstance(legacy_existing_ids, (str, bytes)) or not isinstance(
            legacy_existing_ids, Collection
        ):
            raise RegistryError("Invalid legacy source registration proof")
        legacy = {_identifier(item) for item in legacy_existing_ids}
        if not legacy <= current_by_id.keys():
            raise RegistryError("Legacy source proof names an unregistered target")
        for target in current_targets:
            if target.release_mode == "existing" and target.id not in legacy:
                raise RegistryError("New targets must first register as build_only")
        return
    previous_targets = parse_registry_document(_metadata_bytes(previous))
    previous_by_id = {target.id: target for target in previous_targets}
    if not previous_by_id.keys() <= current_by_id.keys():
        raise RegistryError("Registered targets cannot be deleted or renamed implicitly")
    for target in current_targets:
        old = previous_by_id.get(target.id)
        if old is None:
            if target.release_mode != "build_only":
                raise RegistryError("New targets must first register as build_only")
        elif any(
            getattr(old, field) != getattr(target, field)
            for field in ("kind", "directory", "service")
        ):
            raise RegistryError("Registered target identity cannot change implicitly")
