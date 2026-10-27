"""Validate target ownership against complete synthetic source repositories."""

import copy
import json
import shutil
import sys
import tempfile
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from service_targets import (  # noqa: E402
    MAX_REGISTRY_BYTES,
    MAX_TARGETS,
    REGISTRY_PATH,
    ROOT,
    RegistryError,
    load_registry,
    parse_registry_document,
    validate_registry_transition,
)


def write_registry_fixture(root: Path, *, extra_backend: bool = False) -> dict:
    """Create marker files without starting a service, image build or cloud client."""
    document = json.loads((ROOT / REGISTRY_PATH).read_text())
    if extra_backend:
        document["targets"].append(
            {
                "id": "synthetic-service",
                "kind": "backend",
                "directory": "services/synthetic-service",
                "service": "synthetic-api",
                "cloudbuild": "infra/gcp/cloudbuild.synthetic.yaml",
                "release_mode": "build_only",
            }
        )
    for row in document["targets"]:
        directory = root / row["directory"]
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "Dockerfile").write_text("FROM scratch\n")
        test_directory = directory / "tests"
        test_directory.mkdir()
        if row["kind"] == "backend":
            (directory / "app").mkdir()
            (directory / "app/main.py").write_text('"""Synthetic application."""\n')
            (directory / "requirements.txt").write_text("# fixture\n")
            (directory / "requirements-dev.txt").write_text("# fixture\n")
            (test_directory / "test_ready.py").write_text(
                "import unittest\nclass Ready(unittest.TestCase):\n"
                "    def test_ready(self):\n        self.assertTrue(True)\n"
            )
        else:
            (directory / "package.json").write_text('{"private": true}\n')
            (test_directory / "ready.test.cjs").write_text("// Synthetic fixture\n")
        build = root / row["cloudbuild"]
        build.parent.mkdir(parents=True, exist_ok=True)
        build.write_text("steps: []\n")
    common = root / "services/common"
    (common / "tests").mkdir(parents=True)
    (common / "pyproject.toml").write_text("[project]\nname='synthetic-shared'\n")
    (common / "tests/test_common.py").write_text("# Synthetic shared test\n")
    destination = root / REGISTRY_PATH
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(document))
    return document


class RegistryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.document = write_registry_fixture(self.root)

    def save(self, document=None):
        (self.root / REGISTRY_PATH).write_text(json.dumps(document or self.document))

    def load(self):
        return load_registry(self.root)

    def reject(self):
        with self.assertRaises(RegistryError):
            self.load()

    def test_actual_registry_contains_only_existing_source_ownership_and_preserves_order(self):
        registry = load_registry()
        document = json.loads((ROOT / REGISTRY_PATH).read_text())
        self.assertEqual(
            registry.backend_ids,
            tuple(row["id"] for row in document["targets"] if row["kind"] == "backend"),
        )
        self.assertEqual(registry.web.directory, "apps/web")
        for target in registry.targets:
            self.assertTrue((ROOT / target.dockerfile).is_file())
            self.assertTrue((ROOT / target.cloudbuild).is_file())
            self.assertIs(registry.by_service[target.service], target)
            self.assertEqual(registry.cloudbuild_targets[target.cloudbuild], target.id)

    def test_new_backend_registration_participates_in_immutable_views_without_hardcoded_list(self):
        new = copy.deepcopy(self.document["targets"][0])
        new.update(
            id="fourth-service",
            directory="services/fourth-service",
            service="fourth-api",
            cloudbuild="infra/gcp/cloudbuild.fourth.yaml",
            release_mode="build_only",
        )
        source = self.root / self.document["targets"][0]["directory"]
        destination = self.root / new["directory"]
        shutil.copytree(source, destination)
        (self.root / new["cloudbuild"]).write_text("steps: []\n")
        (destination / "pyproject.toml").write_text("[tool.ruff]\nline-length=100\n")
        self.document["targets"].append(new)
        self.save()
        registry = self.load()
        target = registry.target("fourth-service")
        self.assertIn(target, registry.backends)
        self.assertIn(target.id, registry.backend_ids)
        self.assertEqual(target.requirements_dev, new["directory"] + "/requirements-dev.txt")
        self.assertEqual(target.tests, new["directory"] + "/tests")
        self.assertEqual(target.ruff_config, new["directory"] + "/pyproject.toml")
        self.assertEqual(registry.by_directory[new["directory"]], target)
        with self.assertRaises(FrozenInstanceError):
            target.release_mode = "existing"
        with self.assertRaises(TypeError):
            registry.by_id["unregistered"] = target
        with self.assertRaises(RegistryError):
            registry.target("unregistered")

    def test_build_only_fixture_is_registration_not_resource_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            write_registry_fixture(root, extra_backend=True)
            target = load_registry(root).target("synthetic-service")
        self.assertEqual(target.release_mode, "build_only")
        self.assertEqual(target.service, "synthetic-api")

    def test_unregistered_service_markers_and_nonstandard_code_fail_closed(self):
        cases = [
            "app/main.py",
            "Dockerfile",
            "requirements.txt",
            "requirements-dev.txt",
            "tests/test_new.py",
            "pyproject.toml",
            "worker.py",
            "docs/hidden.py",
        ]
        for marker in cases:
            with self.subTest(marker=marker):
                path = self.root / "services/unregistered" / marker
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("# unregistered executable source\n")
                self.reject()
                shutil.rmtree(self.root / "services/unregistered")

    def test_unregistered_frontend_sources_fail_while_documentation_only_plans_are_allowed(self):
        docs = self.root / "services/future/docs"
        docs.mkdir(parents=True)
        (docs / "plan.md").write_text("# Future design\n")
        (docs / "diagram.json").write_text("{}\n")
        self.load()
        mobile = self.root / "apps/mobile"
        mobile.mkdir()
        (mobile / "index.ts").write_text("export {};\n")
        self.reject()

    def test_common_exception_applies_only_to_shared_python_and_hidden_sources_are_not_a_bypass(
        self,
    ):
        for directory in ("apps/common", "services/.hidden-source", "apps/.hidden-source"):
            with self.subTest(directory=directory):
                path = self.root / directory
                path.mkdir(parents=True)
                (path / "main.py").write_text("# executable source\n")
                self.reject()
                shutil.rmtree(path)

    def test_registered_target_missing_required_file_or_discoverable_tests_cannot_pass(self):
        directory = self.root / self.document["targets"][0]["directory"]
        for relative in (
            "Dockerfile",
            "app/main.py",
            "requirements.txt",
            "requirements-dev.txt",
            "tests/test_ready.py",
        ):
            with self.subTest(relative=relative):
                path = directory / relative
                original = path.read_bytes()
                path.unlink()
                self.reject()
                path.write_bytes(original)
        build = self.root / self.document["targets"][0]["cloudbuild"]
        build.unlink()
        self.reject()

    def test_registered_web_and_common_suites_are_required(self):
        paths = [
            "apps/web/package.json",
            "apps/web/tests/ready.test.cjs",
            "services/common/pyproject.toml",
            "services/common/tests/test_common.py",
        ]
        for relative in paths:
            with self.subTest(relative=relative):
                path = self.root / relative
                original = path.read_bytes()
                path.unlink()
                self.reject()
                path.write_bytes(original)

    def test_duplicate_source_target_service_or_build_owner_is_rejected(self):
        for field in ("id", "directory", "service", "cloudbuild"):
            with self.subTest(field=field):
                document = copy.deepcopy(self.document)
                document["targets"][1][field] = document["targets"][0][field]
                self.save(document)
                self.reject()

    def test_closed_fields_versions_and_release_modes_reject_unknown_state(self):
        for change in (
            {"schema_version": True},
            {"schema_version": 2},
            {"unknown": "ignored"},
            {"targets": []},
        ):
            with self.subTest(change=change):
                document = copy.deepcopy(self.document)
                document.update(change)
                self.save(document)
                self.reject()
        for field, value in (
            ("unknown", "ignored"),
            ("kind", "worker"),
            ("release_mode", "enabled"),
        ):
            document = copy.deepcopy(self.document)
            document["targets"][0][field] = value
            self.save(document)
            self.reject()

    def test_backend_ids_and_directories_cannot_escape_source_ownership(self):
        cases = [
            ("id", "$(echo injected)"),
            ("service", "service;exit"),
            ("service", "a" * 50),
            ("id", "common"),
            ("id", "web"),
            ("id", "Uppercase"),
            ("directory", "services/../outside"),
            ("directory", "/services/elsewhere"),
            ("directory", "services/user-service/"),
            ("directory", "services//user-service"),
            ("directory", "services\\user-service"),
            ("directory", "services/another"),
            ("cloudbuild", "infra/gcp/../../outside.yaml"),
            ("cloudbuild", "infra/gcp/cloudbuild.x.yaml\nsecond"),
        ]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                document = copy.deepcopy(self.document)
                document["targets"][0][field] = value
                self.save(document)
                self.reject()

    def test_cloud_run_service_name_accepts49_characters_but_target_ids_remain_separate(self):
        self.document["targets"][0]["service"] = "a" * 49
        self.save()
        target = self.load().backends[0]
        self.assertEqual(len(target.service), 49)
        self.assertEqual(target.id, self.document["targets"][0]["id"])

    def test_symlinked_registration_files_source_directories_and_tests_are_rejected(self):
        for relative in (
            REGISTRY_PATH,
            "services/user-service",
            "services/market-data-service/tests/test_ready.py",
        ):
            with self.subTest(relative=relative):
                path = self.root / relative
                original = path.with_name(path.name + "-actual")
                path.rename(original)
                path.symlink_to(original, target_is_directory=original.is_dir())
                self.reject()
                path.unlink()
                original.rename(path)

    def test_missing_or_multiple_web_registrations_are_invalid(self):
        document = copy.deepcopy(self.document)
        document["targets"] = [row for row in document["targets"] if row["kind"] != "web"]
        self.save(document)
        self.reject()
        document["targets"].extend([copy.deepcopy(self.document["targets"][-1])] * 2)
        self.save(document)
        self.reject()

    def test_missing_registry_bad_json_duplicate_keys_and_size_limits_are_rejected(self):
        path = self.root / REGISTRY_PATH
        path.unlink()
        self.reject()
        for raw in (
            b"{}",
            b"{",
            b"\xff",
            b'{"schema_version":1,"schema_version":1,"targets":[]}',
            b" " * (MAX_REGISTRY_BYTES + 1),
        ):
            path.write_bytes(raw)
            self.reject()
        document = copy.deepcopy(self.document)
        document["targets"] = [document["targets"][0]] * (MAX_TARGETS + 1)
        self.save(document)
        self.reject()


class RegistryTransitionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.document = write_registry_fixture(self.root, extra_backend=True)
        self.path = self.root / REGISTRY_PATH
        self.previous = parse_registry_document(self.path.read_bytes())

    def current(self):
        self.path.write_text(json.dumps(self.document))
        return load_registry(self.root)

    def test_historical_parser_needs_no_files_but_cannot_construct_a_runnable_registry(self):
        metadata = parse_registry_document(json.dumps(self.document))
        self.assertIs(type(metadata), tuple)
        self.assertEqual(metadata[-1].id, "synthetic-service")
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(RegistryError):
                load_registry(Path(folder))
        for invalid in (None, {}, b"{", b'{"schema_version":true,"targets":[]}'):
            with self.subTest(invalid=invalid), self.assertRaises(RegistryError):
                parse_registry_document(invalid)

    def test_initial_adoption_requires_base_source_proof_for_each_existing_target(self):
        current = self.current()
        legacy = {target.id for target in self.previous if target.release_mode == "existing"}
        validate_registry_transition(None, current, legacy_existing_ids=legacy)
        with self.assertRaises(RegistryError):
            validate_registry_transition(None, current)
        with self.assertRaises(RegistryError):
            validate_registry_transition(
                None, current, legacy_existing_ids=legacy | {"unregistered"}
            )
        with self.assertRaises(RegistryError):
            validate_registry_transition(None, current, legacy_existing_ids="web")
        self.document["targets"][-1]["release_mode"] = "existing"
        with self.assertRaises(RegistryError):
            validate_registry_transition(None, self.current(), legacy_existing_ids=legacy)

    def test_new_target_must_enter_build_only_even_if_legacy_proof_argument_is_supplied(self):
        previous = tuple(target for target in self.previous if target.id != "synthetic-service")
        validate_registry_transition(previous, self.current())
        self.document["targets"][-1]["release_mode"] = "existing"
        with self.assertRaises(RegistryError):
            validate_registry_transition(
                previous, self.current(), legacy_existing_ids={"synthetic-service"}
            )

    def test_deleting_or_renaming_an_existing_backend_requires_explicit_separate_lifecycle(self):
        deleted = self.document["targets"].pop(0)
        shutil.rmtree(self.root / deleted["directory"])
        with self.assertRaises(RegistryError):
            validate_registry_transition(self.previous, self.current())

    def test_service_identity_cannot_change_under_the_same_target_id(self):
        self.document["targets"][0]["service"] = "different-api"
        with self.assertRaises(RegistryError):
            validate_registry_transition(self.previous, self.current())

    def test_owned_cloudbuild_relocation_and_reviewed_mode_promotion_are_metadata_changes_only(
        self,
    ):
        original = self.document["targets"][0]["cloudbuild"]
        replacement = "infra/gcp/cloudbuild.renamed.yaml"
        shutil.copyfile(self.root / original, self.root / replacement)
        self.document["targets"][0]["cloudbuild"] = replacement
        self.document["targets"][-1]["release_mode"] = "existing"
        validate_registry_transition(self.previous, self.current())
        self.document["targets"][0]["release_mode"] = "build_only"
        validate_registry_transition(self.previous, self.current())


if __name__ == "__main__":
    unittest.main()
