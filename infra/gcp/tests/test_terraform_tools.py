"""The Terraform installer must verify content before installing executable code."""

import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "terraform_tools.py"
SPEC = importlib.util.spec_from_file_location("terraform_tools", SCRIPT)
TOOLS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOLS)


class ToolchainTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("terraform", b"verified binary")
            bundle.writestr("../escaped", b"must not be extracted")
        self.archive = archive.getvalue()
        self.metadata = {
            "terraform_version": "1.16.7",
            "archives": {"linux_amd64": hashlib.sha256(self.archive).hexdigest()},
        }
        self.destination = self.root / "tools"

    def install(self):
        (self.root / "toolchain.json").write_text(json.dumps(self.metadata))
        with (
            patch.object(TOOLS, "DIRECTORY", self.root),
            patch.object(TOOLS.platform, "system", return_value="Linux"),
            patch.object(TOOLS.platform, "machine", return_value="x86_64"),
            patch.object(TOOLS, "urlopen", return_value=io.BytesIO(self.archive)),
        ):
            return TOOLS.install(self.destination)

    def test_verified_archive_installs_only_the_executable(self):
        executable = self.install()
        self.assertEqual(executable.read_bytes(), b"verified binary")
        self.assertTrue(executable.stat().st_mode & 0o111)
        self.assertEqual(list(self.destination.iterdir()), [executable])
        self.assertFalse((self.root / "escaped").exists())

    def test_checksum_mismatch_never_installs_unverified_code(self):
        self.metadata["archives"]["linux_amd64"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.install()
        self.assertFalse(self.destination.exists())

    def test_pipeline_and_installer_pin_the_same_version(self):
        directory = SCRIPT.parent / "terraform"
        policy = json.loads((directory / "pipeline.json").read_text())
        toolchain = json.loads((directory / "toolchain.json").read_text())
        self.assertEqual(policy["terraform_version"], toolchain["terraform_version"])
        self.assertEqual(
            set(toolchain["archives"]),
            {"linux_amd64", "linux_arm64", "darwin_amd64", "darwin_arm64"},
        )


if __name__ == "__main__":
    unittest.main()
