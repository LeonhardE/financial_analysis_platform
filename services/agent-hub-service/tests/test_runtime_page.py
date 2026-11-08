"""DOM-only native Browser compatibility over the closed persistent runtime API."""

import os
import shutil
import subprocess
import unittest
from pathlib import Path


class PersistentRuntimePageTests(unittest.TestCase):
    def test_browser_controls_and_original_retry_boundaries(self):
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        self.assertIsNotNone(node, "Node is required; this suite cannot silently skip")
        result = subprocess.run(
            [node, "--test", str(Path(__file__).with_name("runtime_page.test.mjs"))],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.assertEqual(result.returncode, 0, result.stdout[-10000:] + result.stderr[-2000:])
