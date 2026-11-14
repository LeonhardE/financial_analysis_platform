"""Frozen packaged schema integrity is separate from untrusted input validation."""

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from importlib.resources import files
from unittest.mock import patch

from jsonschema import Draft202012Validator

from folioview_shared.encrypted import schema
from folioview_shared.encrypted.errors import ContractError


class PackagedSchemaIntegrityTests(unittest.TestCase):
    def setUp(self):
        schema._document.cache_clear()
        schema._validator.cache_clear()
        self.raw = files("folioview_shared.encrypted").joinpath("schemas.json").read_bytes()

    def tearDown(self):
        schema._document.cache_clear()
        schema._validator.cache_clear()

    def test_exact_packaged_bytes_pass_the_complete_meta_schema_independently(self):
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(), schema._PACKAGED_SCHEMA_SHA256)
        # This direct check is mandatory in the common suite. Do not replace it
        # with _document/load_schema: runtime intentionally does not repeat it.
        document = json.loads(self.raw.decode("utf-8"))
        Draft202012Validator.check_schema(document)
        self.assertEqual(schema.load_schema("PublicJWK")["$defs"], document["$defs"])

    def test_changed_bytes_fail_before_json_parsing_or_validator_creation(self):
        altered = json.loads(self.raw.decode("utf-8"))
        altered["$defs"]["PublicJWK"]["additionalProperties"] = True
        candidates = (
            self.raw + b" ",  # Same JSON meaning still requires the exact packaged bytes.
            json.dumps(altered).encode("utf-8"),  # Valid JSON with weakened input constraints.
            self.raw[:-3],
            b"\xff" + self.raw,
            b"",
        )
        for raw in candidates:
            schema._document.cache_clear()
            schema._validator.cache_clear()
            with (
                self.subTest(length=len(raw)),
                patch.object(schema, "files") as resources,
                patch.object(schema.json, "loads") as parse,
                patch.object(schema, "Draft202012Validator") as validator,
            ):
                resources.return_value.joinpath.return_value.read_bytes.return_value = raw
                with self.assertRaises(ContractError) as failure:
                    schema._validator("PublicJWK")
                self.assertEqual(failure.exception.code, "authorization_unavailable")
                self.assertEqual(failure.exception.status, 503)
                parse.assert_not_called()
                validator.assert_not_called()

    def test_unreadable_package_fails_with_a_fixed_diagnostic_before_validation(self):
        with (
            patch.object(schema, "files") as resources,
            patch.object(schema.json, "loads") as parse,
            patch.object(schema, "Draft202012Validator") as validator,
        ):
            resources.return_value.joinpath.return_value.read_bytes.side_effect = OSError(
                "synthetic private path"
            )
            with self.assertRaises(ContractError) as failure:
                schema._validator("PublicJWK")
            self.assertEqual(str(failure.exception), "authorization_unavailable")
            parse.assert_not_called()
            validator.assert_not_called()

    def test_verified_runtime_definition_does_not_repeat_the_meta_schema_check(self):
        public = {"kty": "EC", "crv": "P-256", "x": "A" * 43, "y": "B" * 43}
        with patch.object(Draft202012Validator, "check_schema") as meta:
            self.assertEqual(schema.validate_schema("PublicJWK", public), public)
            with self.assertRaises(ContractError):
                schema.validate_schema("PublicJWK", public | {"extra": "rejected"})
            meta.assert_not_called()

    def test_integrity_failure_does_not_cache_an_unverified_definition(self):
        with patch.object(schema, "files") as resources:
            resources.return_value.joinpath.return_value.read_bytes.return_value = self.raw + b" "
            with self.assertRaises(ContractError):
                schema.load_schema("PublicJWK")
        self.assertEqual(schema._document.cache_info().currsize, 0)
        self.assertEqual(schema.load_schema("PublicJWK")["$ref"], "#/$defs/PublicJWK")

    def test_public_schema_and_checked_input_copies_remain_detached(self):
        public = {"kty": "EC", "crv": "P-256", "x": "A" * 43, "y": "B" * 43}
        loaded = schema.load_schema("PublicJWK")
        loaded["$defs"]["PublicJWK"]["required"] = []
        loaded["$defs"]["PublicJWK"]["additionalProperties"] = True
        with self.assertRaises(ContractError):
            schema.validate_schema("PublicJWK", {"extra": "rejected"})
        original = copy.deepcopy(public)
        checked = schema.validate_schema("PublicJWK", public)
        checked["x"] = "changed"
        self.assertEqual(public, original)
        self.assertEqual(schema.validate_schema("PublicJWK", public), original)

    def test_installed_package_resource_has_the_same_pinned_bytes(self):
        # CI installs the actual wheel before the common suite. -I removes its
        # source PYTHONPATH, so this also checks the independently installed data.
        # The development environment's existing editable install is supported.
        script = """\
import hashlib, json, sys
from importlib.resources import files
from jsonschema import Draft202012Validator
raw = files('folioview_shared.encrypted').joinpath('schemas.json').read_bytes()
assert hashlib.sha256(raw).hexdigest() == sys.argv[1]
Draft202012Validator.check_schema(json.loads(raw.decode('utf-8')))
print(hashlib.sha256(raw).hexdigest())
"""
        with tempfile.TemporaryDirectory(prefix="folioview-schema-package-") as directory:
            result = subprocess.run(
                [sys.executable, "-I", "-c", script, schema._PACKAGED_SCHEMA_SHA256],
                cwd=directory,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        self.assertEqual(result.returncode, 0, "Isolated packaged schema verification failed.")
        self.assertEqual(result.stdout.strip(), schema._PACKAGED_SCHEMA_SHA256)


if __name__ == "__main__":
    unittest.main()
