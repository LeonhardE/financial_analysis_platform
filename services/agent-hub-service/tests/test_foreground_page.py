"""Mandatory basic page workflow against the released page source and HTML."""

import os
import shutil
import subprocess
import unittest
from pathlib import Path


class ForegroundPageTests(unittest.TestCase):
    def test_extended_release_preserves_page_flow_and_packet_expiry_draft(self):
        node = shutil.which("node")
        self.assertIsNotNone(node)
        result = subprocess.run(
            [node, "--test", str(Path(__file__).with_name("foreground_page.test.mjs"))],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "NODE_OPTIONS": "", "FOLIOVIEW_TEST_HELPER_RELEASE": "1.4.0"},
        )
        self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-2000:])

    def test_explicit_flow_receipts_and_private_view_lifecycle(self):
        node = shutil.which("node")
        self.assertIsNotNone(node)
        result = subprocess.run(
            [node, "--test", str(Path(__file__).with_name("foreground_page.test.mjs"))],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-2000:])
