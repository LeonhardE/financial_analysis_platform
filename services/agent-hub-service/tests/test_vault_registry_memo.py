"""Vault histories reuse identical certificate signatures only within one check."""

import copy
import unittest
from collections import Counter
from unittest.mock import patch

from fixtures import VaultFixture

from app.vaults import _verify_row
from folioview_shared.encrypted import authority
from folioview_shared.encrypted.errors import ContractError


class VaultRegistryMemoTests(unittest.TestCase):
    def setUp(self):
        self.f = VaultFixture()
        history = [self.f.bundle]
        previous = self.f.registry
        for _ in range(2):
            bundle = self.f.make_bundle(previous=previous)
            # Production history retains the exact certificate JWS when a
            # checkpoint changes. Its digest binds the unchanged payload.
            bundle["entries"] = copy.deepcopy(history[0]["entries"])
            previous = self.f.verify(bundle, previous=previous)
            history.append(bundle)
        self.row = {
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "rootJwk": self.f.root_public,
            "rootKeyId": self.f.root_id,
            "registryHistory": history,
            "archive": self.f.bootstrap()["archive"],
            "version": len(history),
            "sources": [],
            "operationCount": len(history),
        }

    def test_same_authority_and_all_checks_with_no_reuse_between_calls(self):
        with (
            patch("app.vaults.RegistryCertificateMemo", return_value=None),
            patch.object(authority, "verify_jws", wraps=authority.verify_jws) as verify,
            patch.object(authority, "validate_schema", wraps=authority.validate_schema) as schema,
        ):
            baseline = _verify_row(self.row, self.f.owner, 1000)
            self.assertEqual(verify.call_count, 12)
            baseline_schema_calls = Counter(call.args[0] for call in schema.call_args_list)
            self.assertEqual(
                baseline_schema_calls,
                {
                    "RegistryBundle": 3,
                    "RegistryCheckpointPayload": 3,
                    "KeyCertificatePayload": 9,
                },
            )
        with (
            patch.object(authority, "verify_jws", wraps=authority.verify_jws) as verify,
            patch.object(authority, "validate_schema", wraps=authority.validate_schema) as schema,
        ):
            self.assertEqual(_verify_row(self.row, self.f.owner, 1000), baseline)
            self.assertEqual(verify.call_count, 6)
            first_schema_calls = Counter(call.args[0] for call in schema.call_args_list)
            self.assertEqual(first_schema_calls["RegistryBundle"], 3)
            self.assertEqual(first_schema_calls["RegistryCheckpointPayload"], 3)
            # Both shared versions are safe: signature-only memo validates all
            # nine certificate visits; static memo validates three unique JWS.
            self.assertIn(first_schema_calls["KeyCertificatePayload"], (3, 9))
            self.assertEqual(_verify_row(self.row, self.f.owner, 1000), baseline)
            self.assertEqual(verify.call_count, 12)
            self.assertEqual(
                Counter(call.args[0] for call in schema.call_args_list),
                Counter({name: 2 * count for name, count in first_schema_calls.items()}),
            )

    def test_changed_history_future_checkpoint_and_corrupt_signature_are_not_reused(self):
        cache = {}
        _verify_row(self.row, self.f.owner, 1000, registry_cache=cache)
        changed = copy.deepcopy(self.row)
        signed = changed["registryHistory"][-1]["entries"][0]["certificate"]
        signed["signature"] = ("A" if signed["signature"][0] != "A" else "B") + signed["signature"][
            1:
        ]
        with self.assertRaises(ContractError):
            _verify_row(changed, self.f.owner, 1000, registry_cache=cache)
        with self.assertRaises(ContractError):
            _verify_row(self.row, self.f.owner, 499, registry_cache=cache)
        self.assertEqual(len(cache), 1)
