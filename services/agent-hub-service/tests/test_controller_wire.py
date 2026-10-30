"""Mandatory offline wire checks against the actual checked browser distributions."""

import os
import shutil
import subprocess
import unittest
from pathlib import Path


class ControllerWireTests(unittest.TestCase):
    def test_native_message_channel_roles_credentials_callbacks_and_terminal_errors(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "Controller wire tests require Node and must not skip.")
        result = subprocess.run(
            [node, "--test", str(Path(__file__).with_name("controller_wire.test.mjs"))],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-2000:])
