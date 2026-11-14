"""Operation-local certificate verification reuse, using fresh synthetic keys."""

import copy
import unittest
from unittest.mock import patch

from test_encrypted_authority import AuthorityFixture

from folioview_shared.encrypted.authority import RegistryCertificateMemo
from folioview_shared.encrypted.crypto import verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode, canonical_json
from folioview_shared.encrypted.schema import validate_schema


def retain_certificates(bundle, previous):
    """Mirror clients retaining complete, already-signed certificates in history."""
    known = {entry["certificate"]["payload"]: entry["certificate"] for entry in previous["entries"]}
    for entry in bundle["entries"]:
        entry["certificate"] = copy.deepcopy(
            known.get(entry["certificate"]["payload"], entry["certificate"])
        )
    return bundle


class RegistryCertificateMemoTests(unittest.TestCase):
    def setUp(self):
        self.f = AuthorityFixture()
        self.memo = RegistryCertificateMemo()

    def check_signature(self, signed, **changes):
        arguments = {
            "public_jwk": self.f.root_public,
            "typ": "fv-control+jws",
            "expected_kid": self.f.root_id,
        }
        arguments.update(changes)
        return self.memo._verify(signed, **arguments)

    def test_23_generation_history_reuses_only_exact_certificates(self):
        f = self.f
        f.certificates = {
            name: value for name, value in f.certificates.items() if not name.startswith("A")
        }
        f.bundle = f.make_bundle()
        f.registry = f.verify(f.bundle)
        history = [f.bundle]
        for generation in range(1, 23):
            principal, connection = f"synthetic_{generation}", f"connection_{generation}"
            for role in ("agent_sig", "agent_enc"):
                f.add_key(f"{principal}_{role}", role, principal, connection)
            bundle = retain_certificates(f.make_bundle(previous=f.registry), history[-1])
            f.registry = f.verify(bundle, previous=f.registry)
            history.append(bundle)

        def verify_history(memo):
            previous = None
            with (
                patch(
                    "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
                ) as signatures,
                patch(
                    "folioview_shared.encrypted.authority.validate_schema", wraps=validate_schema
                ) as schemas,
            ):
                for bundle in history:
                    previous = f.verify(bundle, previous=previous, signature_memo=memo)
            return previous, signatures.call_count, schemas.call_count

        baseline, baseline_signatures, baseline_schemas = verify_history(None)
        reused, reused_signatures, reused_schemas = verify_history(self.memo)
        self.assertEqual(baseline, reused)
        self.assertEqual(598, baseline_signatures)
        self.assertEqual(70, reused_signatures)  # 23 checkpoints plus 47 unique certificates.
        self.assertEqual(621, baseline_schemas)
        self.assertEqual(baseline_schemas, reused_schemas)
        # A separate operation starts with an empty memo, even for the same history.
        self.assertEqual(70, verify_history(RegistryCertificateMemo())[1])

    def test_complete_signature_root_and_profile_are_part_of_the_key(self):
        f = self.f
        signed = f.bundle["entries"][0]["certificate"]
        payload = f.certificates["device_sig"]
        resigned = f.sign(payload, "root")
        self.assertNotEqual(signed["signature"], resigned["signature"])
        broken = copy.deepcopy(signed)
        raw = b64url_decode(broken["signature"])
        broken["signature"] = b64url_encode(bytes([raw[0] ^ 1]) + raw[1:])
        changed_payload = copy.deepcopy(signed)
        changed_payload["payload"] = b64url_encode(canonical_json(payload | {"keyEpoch": 2}))
        changed_header = copy.deepcopy(signed)
        changed_header["protected"] = resigned["payload"]
        other = AuthorityFixture()
        with patch(
            "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
        ) as signatures:
            self.check_signature(signed)
            self.check_signature(copy.deepcopy(signed))
            self.assertEqual(1, signatures.call_count)
            self.check_signature(resigned)
            self.assertEqual(2, signatures.call_count)
            invalid = [
                (broken, {}),
                (broken, {}),  # Failures are never cached.
                (changed_payload, {}),
                (changed_header, {}),
                (signed, {"public_jwk": other.root_public}),
                (signed, {"typ": "fv-object+jws"}),
                (signed, {"expected_kid": other.root_id}),
                (signed, {"public_jwk": f.root_public | {"extra": "rejected"}}),
            ]
            for candidate, changes in invalid:
                with self.subTest(changes=changes), self.assertRaises(ContractError):
                    self.check_signature(candidate, **changes)
            self.assertEqual(2 + len(invalid), signatures.call_count)

    def test_even_an_identical_checkpoint_signature_is_verified_again(self):
        f = self.f
        with patch(
            "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
        ) as signatures:
            first = f.verify(f.bundle, signature_memo=self.memo)
            repeated = f.verify(f.bundle, previous=first, signature_memo=self.memo)
        self.assertEqual(first, repeated)
        self.assertEqual(len(f.bundle["entries"]) + 2, signatures.call_count)
        self.assertEqual(
            2,
            sum(call.args[0] == f.bundle["checkpoint"] for call in signatures.call_args_list),
        )

    def test_results_and_constructor_cannot_prefill_or_mutate_the_memo(self):
        signed = self.f.bundle["entries"][0]["certificate"]
        original = self.check_signature(signed)
        original["capabilities"].append("forged")
        original["publicJwk"]["x"] = "forged"
        second = self.check_signature(signed)
        self.assertNotIn("forged", second["capabilities"])
        self.assertNotEqual("forged", second["publicJwk"]["x"])
        second["capabilities"].clear()
        self.assertTrue(self.check_signature(signed)["capabilities"])
        with self.assertRaises(TypeError):
            RegistryCertificateMemo({"unverified": original})
        with self.assertRaises(AttributeError):
            self.memo.entries = {"unverified": original}
        with self.assertRaises(ContractError):
            self.f.verify(self.f.bundle, signature_memo={})

    def test_entry_limit_falls_back_to_verification_without_rejecting(self):
        f = self.f
        certificates = [
            f.sign(f.certificates["device_sig"] | {"certificateId": f"synthetic_{index}"}, "root")
            for index in range(129)
        ]
        with patch(
            "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
        ) as signatures:
            for signed in certificates:
                self.check_signature(signed)
            self.check_signature(certificates[0])
            self.assertEqual(129, signatures.call_count)
            self.check_signature(certificates[-1])
            self.assertEqual(130, signatures.call_count)

    def test_encoded_byte_limit_falls_back_before_the_entry_limit(self):
        # These are valid bounded JWS payloads, independent of certificate schema.
        # The memo verifies signatures only; verify_registry still checks schemas.
        signed_objects = [
            self.f.sign({"padding": "x" * 24_000, "index": i}, "root") for i in range(22)
        ]
        with patch(
            "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
        ) as signatures:
            for signed in signed_objects:
                self.check_signature(signed)
            self.check_signature(signed_objects[0])
            self.assertEqual(22, signatures.call_count)
            self.check_signature(signed_objects[-1])
            self.assertEqual(23, signatures.call_count)

    def test_current_identity_time_active_and_history_checks_still_run(self):
        f = self.f
        first = f.verify(f.bundle, signature_memo=self.memo)
        for changes in ({"now": 499}, {"owner_subject": "other"}, {"vault_id": "other"}):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                f.verify(f.bundle, signature_memo=self.memo, **changes)
        bad_active = copy.deepcopy(f.bundle)
        bad_active["entries"][0]["active"] = False
        with self.assertRaises(ContractError):
            f.verify(bad_active, signature_memo=self.memo)
        for changes in (
            {"entriesDigest": "0" * 64},
            {"previousDigest": "0" * 64},
            {"registrySequence": 3},
            {"issuedAt": 499},
        ):
            bundle = retain_certificates(
                f.make_bundle(previous=first, checkpoint_overrides=changes), f.bundle
            )
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                f.verify(bundle, previous=first, signature_memo=self.memo)
        with self.assertRaises(ContractError):
            first.cert(f.kid("device_sig"), now=5000)

    def test_revocations_epoch_floors_and_schema_checks_still_run(self):
        f = self.f
        first = f.verify(f.bundle, signature_memo=self.memo)
        revoked_bundle = retain_certificates(
            f.make_bundle(previous=first, revoked=("A1_sig",)), f.bundle
        )
        revoked = f.verify(revoked_bundle, previous=first, signature_memo=self.memo)
        with self.assertRaises(ContractError):
            revoked.cert(f.kid("A1_sig"), now=1000)
        restored = retain_certificates(f.make_bundle(previous=revoked), revoked_bundle)
        with self.assertRaises(ContractError):
            f.verify(restored, previous=revoked, signature_memo=self.memo)
        f.add_key("replacement", "agent_sig", "A1", "connection_A1", epoch=1)
        stale = retain_certificates(
            f.make_bundle(previous=revoked, revoked=("A1_sig",)), revoked_bundle
        )
        with self.assertRaises(ContractError):
            f.verify(stale, previous=revoked, signature_memo=self.memo)
        malformed = f.sign(f.certificates["device_sig"] | {"unexpected": True}, "root")
        self.check_signature(malformed)  # Signature validity is insufficient for a certificate.
        invalid_bundle = copy.deepcopy(f.bundle)
        invalid_bundle["entries"][0]["certificate"] = malformed
        for _ in range(2):
            with self.assertRaises(ContractError):
                f.verify(invalid_bundle, signature_memo=self.memo)


if __name__ == "__main__":
    unittest.main()
