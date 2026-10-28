"""Exercise scanner integrity, redaction, source layers and temporary Git isolation."""

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from git_environment import isolated_git_environment  # noqa: E402

SPEC = importlib.util.spec_from_file_location("secret_scan", ROOT / "scripts/ci/secret_scan.py")
SCAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCAN)


def command(root, *args):
    return subprocess.run(
        ["git", *args],
        cwd=root,
        env=isolated_git_environment(),
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def repository(root):
    command(root, "init", "--initial-branch=main")
    command(root, "config", "user.name", "Security fixture")
    command(root, "config", "user.email", "security@example.invalid")
    (root / "README.md").write_text("Synthetic temporary repository.\n")
    commit(root)


def commit(root):
    command(root, "add", ".")
    command(root, "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture")


class ToolIntegrityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.binary = b"synthetic verified executable"
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as bundle:
            member = tarfile.TarInfo("gitleaks")
            member.size = len(self.binary)
            bundle.addfile(member, io.BytesIO(self.binary))
            outside = tarfile.TarInfo("../outside")
            outside.size = 1
            bundle.addfile(outside, io.BytesIO(b"x"))
        self.archive = archive.getvalue()
        self.metadata = SCAN.toolchain()
        self.metadata["platforms"]["linux_x64"] = {
            "archive_sha256": hashlib.sha256(self.archive).hexdigest(),
            "binary_sha256": hashlib.sha256(self.binary).hexdigest(),
        }
        self.destination = self.root / "tools"

    def install(self):
        with (
            patch.object(SCAN, "toolchain", return_value=self.metadata),
            patch.object(SCAN, "platform_key", return_value="linux_x64"),
            patch.object(SCAN, "urlopen", return_value=io.BytesIO(self.archive)),
        ):
            return SCAN.install(self.destination)

    def test_archive_and_binary_are_pinned_and_only_regular_binary_is_extracted(self):
        path = self.install()
        self.assertEqual(path.read_bytes(), self.binary)
        self.assertTrue(path.stat().st_mode & 0o111)
        self.assertEqual([p.resolve() for p in self.destination.iterdir()], [path])
        self.assertFalse((self.root / "outside").exists())

    def test_bad_archive_or_binary_never_installs(self):
        for field in ["archive_sha256", "binary_sha256"]:
            original = self.metadata["platforms"]["linux_x64"][field]
            self.metadata["platforms"]["linux_x64"][field] = "0" * 64
            with self.subTest(field=field), self.assertRaises(SCAN.SecurityScanError):
                self.install()
            self.assertFalse(self.destination.exists())
            self.metadata["platforms"]["linux_x64"][field] = original

    def test_cached_binary_is_reverified_before_any_execution(self):
        path = self.install()
        path.write_bytes(b"changed executable")
        with self.assertRaisesRegex(SCAN.SecurityScanError, "checksum"):
            self.install()

    def test_symlinked_binary_and_repository_path_escape_are_rejected(self):
        outside = self.root / "outside"
        outside.write_bytes(self.binary)
        self.destination.mkdir()
        (self.destination / "gitleaks").symlink_to(outside)
        with self.assertRaises(SCAN.SecurityScanError):
            self.install()
        for value in [b"../escape", b"/absolute", b".git/config"]:
            with self.subTest(value=value), self.assertRaises(SCAN.SecurityScanError):
                SCAN.relative_path(value)

    def test_toolchain_has_fixed_upstream_release_and_four_checked_platforms(self):
        metadata = SCAN.toolchain()
        self.assertEqual(metadata["version"], "8.30.1")
        self.assertEqual(len(metadata["platforms"]), 4)
        self.assertEqual(
            metadata["release_url"], "https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1"
        )
        self.assertTrue(
            all(len(row["binary_sha256"]) == 64 for row in metadata["platforms"].values())
        )


class GitIsolationTests(unittest.TestCase):
    def test_all_parent_git_context_and_config_injection_is_removed(self):
        supplied = {
            "PATH": "/synthetic/bin",
            "OTHER": "kept",
            "GIT_DIR": "parent",
            "GIT_WORK_TREE": "parent",
            "GIT_INDEX_FILE": "parent-index",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.bare",
            "GIT_CONFIG_VALUE_0": "true",
            "GIT_FUTURE_CONTEXT": "parent",
        }
        clean = isolated_git_environment(supplied)
        self.assertEqual(clean["PATH"], supplied["PATH"])
        self.assertEqual(clean["OTHER"], "kept")
        self.assertNotIn("GIT_DIR", clean)
        self.assertNotIn("GIT_CONFIG_COUNT", clean)
        self.assertNotIn("GIT_FUTURE_CONTEXT", clean)
        self.assertEqual(clean["GIT_CONFIG_GLOBAL"], os.devnull)
        self.assertEqual(clean["GIT_TERMINAL_PROMPT"], "0")

    def test_real_comparison_fixture_does_not_mutate_parent_hook_repository(self):
        with tempfile.TemporaryDirectory() as name:
            parent = Path(name)
            repository(parent)
            command(parent, "config", "user.name", "Parent owner")
            command(parent, "config", "user.email", "parent@example.invalid")
            parent_git = parent / ".git"
            before = {
                part: (parent_git / part).read_bytes()
                for part in ["config", "index", "HEAD", "refs/heads/main"]
            }
            environment = dict(os.environ)
            environment.update(
                GIT_DIR=str(parent_git),
                GIT_WORK_TREE=str(parent),
                GIT_INDEX_FILE=str(parent_git / "index"),
                GIT_CONFIG_COUNT="1",
                GIT_CONFIG_KEY_0="core.bare",
                GIT_CONFIG_VALUE_0="true",
            )
            script = """
import sys, unittest
sys.path.insert(0, sys.argv[1])
from test_checks import GitComparisonTests
case = GitComparisonTests('test_push_checks_every_commit_not_just_the_last')
result = unittest.TestResult()
case.run(result)
assert result.wasSuccessful(), str(result.errors + result.failures)
"""
            result = subprocess.run(
                [sys.executable, "-c", script, str(Path(__file__).parent)],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            after = {part: (parent_git / part).read_bytes() for part in before}
            self.assertEqual(after, before)


class IgnorePolicyTests(unittest.TestCase):
    def test_real_git_ignore_excludes_local_credentials_but_preserves_public_sources(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            repository(root)
            (root / ".gitignore").write_text((ROOT / ".gitignore").read_text())
            ignored = [
                ".env",
                ".env.local",
                "nested/.env.production",
                "credentials.json",
                "service-account.json",
                "nested/application_default_credentials.json",
                "private-key.pem",
                "nested/credential.key",
                ".deployment/profile.json",
                "deployment-profile.local.json",
                ".security-tools/gitleaks",
            ]
            public = [
                ".env.example",
                "apps/web/.env.example",
                "services/user-service/.env.example",
                "infra/gcp/deployment-profiles/example.json",
                "schemas.json",
                "fixture.json",
                "certificate.public.pem",
                "credentials.example.json",
            ]
            for path in ignored + public:
                with self.subTest(path=path):
                    result = subprocess.run(
                        ["git", "check-ignore", "-q", path],
                        cwd=root,
                        env=isolated_git_environment(),
                        capture_output=True,
                    )
                    self.assertEqual(result.returncode == 0, path in ignored)
            docker = (ROOT / ".dockerignore").read_text()
            for entry in ["**/credentials.json", "**/*.pem", "**/.deployment", ".security-tools"]:
                self.assertIn(entry, docker)


class ScannerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = os.getenv("FOLIOVIEW_GITLEAKS_PATH")
        candidate = Path(path) if path else ROOT / ".security-tools/gitleaks"
        if not candidate.is_file():
            raise unittest.SkipTest(
                "Install pinned Gitleaks with npm run security:scan; CI always installs it."
            )
        cls.executable = SCAN.verify_binary(candidate)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        repository(self.root)
        # This recognizable value is generated only inside an ephemeral fixture.
        self.secret = "ghp_" + "aB3dE5gH7jK9mN1pQ3sT5vW7xY9zA1cD3eF5"

    def write(self, path, value):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(value)

    def scan(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = SCAN.scan(self.executable, self.root)
        value = output.getvalue()
        self.assertNotIn(self.secret, value)
        self.assertNotIn('"Secret"', value)
        self.assertNotIn('"Match"', value)
        return result, value

    def test_staged_secret_is_detected_when_working_copy_is_already_clean(self):
        self.write("candidate.txt", self.secret)
        command(self.root, "add", "candidate.txt")
        self.write("candidate.txt", "clean working copy\n")
        status, output = self.scan()
        self.assertEqual(status, 1)
        self.assertIn('"path": "candidate.txt"', output)

    def test_active_alternate_index_is_scanned_without_parent_mutation(self):
        with tempfile.TemporaryDirectory() as name:
            index = Path(name) / "alternate-index"
            index.write_bytes((self.root / ".git/index").read_bytes())
            environment = isolated_git_environment()
            environment.update(
                GIT_INDEX_FILE=str(index),
                GIT_DIR=str(self.root / ".git"),
                GIT_WORK_TREE=str(self.root),
            )
            self.write("staged-only.txt", self.secret)
            subprocess.run(
                ["git", "add", "staged-only.txt"],
                cwd=self.root,
                env=environment,
                check=True,
                capture_output=True,
            )
            self.write("staged-only.txt", "clean working copy\n")
            before = {
                path: path.read_bytes()
                for path in [self.root / ".git/config", self.root / ".git/index", index]
            }
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts/ci/secret_scan.py"),
                    "scan",
                    "--gitleaks",
                    str(self.executable),
                    "--root",
                    str(self.root),
                ],
                cwd=self.root,
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn('"path": "staged-only.txt"', result.stdout)
            self.assertNotIn(self.secret, result.stdout + result.stderr)
            self.assertEqual({path: path.read_bytes() for path in before}, before)

            # Explicitly selecting another repo does not import the parent's index.
            other = Path(name) / "other"
            other.mkdir()
            repository(other)
            args = result.args[:-1] + [str(other)]
            result = subprocess.run(
                args, cwd=self.root, env=environment, capture_output=True, text=True, timeout=30
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual({path: path.read_bytes() for path in before}, before)

            # An invalid active index in this repo cannot fall back to the clean default.
            environment["GIT_INDEX_FILE"] = str(Path(name) / "missing-index")
            result = subprocess.run(
                args[:-1] + [str(self.root)],
                cwd=self.root,
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            self.assertEqual({path: path.read_bytes() for path in before}, before)

    def test_removed_historical_secret_is_detected(self):
        self.write("previous.txt", self.secret)
        commit(self.root)
        (self.root / "previous.txt").unlink()
        commit(self.root)
        self.assertEqual(self.scan()[0], 1)

    def test_untracked_secret_and_inline_allow_comment_cannot_bypass(self):
        self.write("untracked.txt", self.secret + " # gitleaks:allow\n")
        self.assertEqual(self.scan()[0], 1)

    def test_firebase_assignment_exception_does_not_exempt_other_keys_or_private_material(self):
        path = "infra/gcp/terraform/bootstrap/web.tf"
        key = (
            "AIza"
            + base64.urlsafe_b64encode(
                hashlib.sha256(b"synthetic public config").digest()
            ).decode()[:35]
        )
        public = '_FIREBASE_API_KEY = "' + key + '"\n'
        self.write(path, public)
        self.assertEqual(self.scan()[0], 0)
        private = (
            "-----BEGIN " + "PRIVATE KEY-----\n" + "A" * 128 + "\n-----END " + "PRIVATE KEY-----\n"
        )
        self.write(path, public + private)
        self.assertEqual(self.scan()[0], 1)
        self.write(path, 'backend_key = "' + key + '"\n')
        self.assertEqual(self.scan()[0], 1)
        self.write(path, "")
        self.write("another.tf", public)
        self.assertEqual(self.scan()[0], 1)

    def test_exact_public_payload_fragments_do_not_exempt_unknown_keys(self):
        fixture = (ROOT / "services/common/tests/fixtures/encrypted_v2_node.json").read_text()
        path = "services/common/tests/fixtures/encrypted_v2_node.json"
        self.write(path, fixture)
        self.assertEqual(self.scan()[0], 0)
        unknown = base64.urlsafe_b64encode(bytes(range(64))).decode().rstrip("=")
        self.write(path, json.dumps({"api_key": unknown}, indent=2))
        self.assertEqual(self.scan()[0], 1)

    def test_forced_staged_ignored_file_is_still_scanned(self):
        (self.root / ".gitignore").write_text("credentials.json\n")
        self.write("credentials.json", self.secret)
        command(self.root, "add", "--force", "credentials.json")
        self.assertEqual(self.scan()[0], 1)

    def test_scanner_failure_and_shallow_history_fail_closed_without_raw_output(self):
        with patch.object(SCAN, "git", return_value=b"true\n"):
            with self.assertRaises(SCAN.SecurityScanError):
                self.scan()
        with patch.object(
            SCAN.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 2, b"private raw diagnostic", b"private"),
        ):
            with tempfile.TemporaryDirectory() as temporary:
                with self.assertRaises(SCAN.SecurityScanError):
                    SCAN._scan(
                        self.executable, "dir", self.root, Path(temporary), ROOT / ".gitleaks.toml"
                    )


if __name__ == "__main__":
    unittest.main()
