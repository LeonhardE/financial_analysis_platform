"""Mandatory bounded download checks with the actual pinned foreground Worker."""

import os
import shutil
import subprocess
import unittest
from pathlib import Path


class ControllerBootstrapTests(unittest.TestCase):
    def test_slow_download_timeout_integrity_and_cancellation(self):
        node = shutil.which("node")
        self.assertIsNotNone(node)
        result = subprocess.run(
            [node, "--test", str(Path(__file__).with_name("controller_bootstrap.test.mjs"))],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-2000:])
