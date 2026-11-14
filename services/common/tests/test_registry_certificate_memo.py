"""Operation-local certificate verification reuse, using fresh synthetic keys."""

import copy
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from test_encrypted_authority import AuthorityFixture

from folioview_shared.encrypted.authority import RegistryCertificateMemo
from folioview_shared.encrypted.crypto import jwk_thumbprint, verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
)
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
            principal, connection = (
                f"synthetic_{generation}",
                f"connection_{generation}",
            )
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
                    "folioview_shared.encrypted.authority.validate_schema",
                    wraps=validate_schema,
                ) as schemas,
                patch(
                    "folioview_shared.encrypted.authority.jwk_thumbprint",
                    wraps=jwk_thumbprint,
                ) as thumbprints,
            ):
                for bundle in history:
                    previous = f.verify(bundle, previous=previous, signature_memo=memo)
            return (
                previous,
                signatures.call_count,
                schemas.call_count,
                thumbprints.call_count,
            )

        baseline, baseline_signatures, baseline_schemas, baseline_thumbs = verify_history(None)
        reused, reused_signatures, reused_schemas, reused_thumbs = verify_history(self.memo)
        self.assertEqual(baseline, reused)
        self.assertEqual(598, baseline_signatures)
        self.assertEqual(70, reused_signatures)  # 23 checkpoints plus 47 unique certificates.
        self.assertEqual(621, baseline_schemas)
        self.assertEqual(93, reused_schemas)  # 23 bundle/checkpoint pairs plus 47 certificates.
        self.assertEqual(598, baseline_thumbs)
        self.assertEqual(70, reused_thumbs)  # Root per bundle plus 47 full certificate keys.
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
            f.sign(
                f.certificates["device_sig"] | {"certificateId": f"synthetic_{index}"},
                "root",
            )
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
        for changes in (
            {"now": 499},
            {"owner_subject": "other"},
            {"vault_id": "other"},
        ):
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

    def check_certificate(self, signed, **changes):
        arguments = {"public_jwk": self.f.root_public, "expected_kid": self.f.root_id}
        arguments.update(changes)
        return self.memo._certificate(signed, **arguments)

    def test_static_evidence_is_isolated_and_signature_only_hits_require_full_promotion(
        self,
    ):
        f = self.f
        signed = f.bundle["entries"][0]["certificate"]
        expected = copy.deepcopy(f.certificates["device_sig"])
        with (
            patch(
                "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
            ) as signatures,
            patch(
                "folioview_shared.encrypted.authority.validate_schema",
                wraps=validate_schema,
            ) as schemas,
            patch(
                "folioview_shared.encrypted.authority.jwk_thumbprint",
                wraps=jwk_thumbprint,
            ) as thumbs,
        ):
            self.check_signature(signed)
            first, thumb = self.check_certificate(signed)
            self.assertEqual(expected["keyId"], thumb)
            first["publicJwk"]["x"] = "forged"
            first["capabilities"].append("forged")
            second, second_thumb = self.check_certificate(signed)
            self.assertEqual(expected, second)
            self.assertEqual(thumb, second_thumb)
            self.assertEqual(
                (1, 1, 1),
                (signatures.call_count, schemas.call_count, thumbs.call_count),
            )
            self.check_signature(signed)["capabilities"].clear()
            self.assertEqual(expected, self.check_certificate(signed)[0])
            self.assertEqual(
                expected,
                RegistryCertificateMemo()._certificate(
                    signed, f.root_public, expected_kid=f.root_id
                )[0],
            )
            self.assertEqual(
                (2, 2, 2),
                (signatures.call_count, schemas.call_count, thumbs.call_count),
            )

    def test_schema_missing_extra_private_and_invalid_curve_never_gain_static_success(
        self,
    ):
        f = self.f
        original = f.certificates["device_sig"]
        missing = copy.deepcopy(original)
        del missing["principalId"]
        candidates = [
            missing,
            original | {"extra": True},
            original | {"publicJwk": original["publicJwk"] | {"extra": True}},
            original | {"publicJwk": original["publicJwk"] | {"d": "private"}},
            original | {"publicJwk": original["publicJwk"] | {"x": "A" * 43, "y": "A" * 43}},
            original | {"publicJwk": original["publicJwk"] | {"x": "malformed"}},
        ]
        for payload in candidates:
            signed = f.sign(payload, "root")
            with (
                self.subTest(payload_fields=tuple(payload)),
                patch(
                    "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
                ) as signatures,
            ):
                for _ in range(2):
                    with self.assertRaises(ContractError):
                        self.check_certificate(signed)
                self.assertEqual(2, signatures.call_count)
        # A generic signature-only success still cannot confer certificate evidence.
        signed = f.sign(original | {"extra": True}, "root")
        self.check_signature(signed)
        with patch(
            "folioview_shared.encrypted.authority.validate_schema",
            wraps=validate_schema,
        ) as schemas:
            for _ in range(2):
                with self.assertRaises(ContractError):
                    self.check_certificate(signed)
            self.assertEqual(2, schemas.call_count)

    def test_private_snapshots_prevent_thread_mutation_from_poisoning_static_or_signature_hits(
        self,
    ):
        f = self.f
        for static in (False, True):
            with self.subTest(static=static):
                memo = RegistryCertificateMemo()
                a = copy.deepcopy(f.bundle["entries"][0]["certificate"])
                b = f.sign(f.certificates["device_sig"] | {"keyEpoch": 2}, "root")
                mutable, root = copy.deepcopy(a), copy.deepcopy(f.root_public)
                other = AuthorityFixture()
                entered, release = threading.Event(), threading.Event()

                def paused(signed, public_jwk, *, _entered=entered, _release=release, **options):
                    _entered.set()
                    if not _release.wait(5):
                        raise AssertionError("mutation test barrier timed out")
                    return verify_jws(signed, public_jwk, **options)

                def check(signed, public_jwk, *, _static=static, _memo=memo):
                    if _static:
                        return _memo._certificate(signed, public_jwk, expected_kid=f.root_id)[0]
                    return _memo._verify(
                        signed, public_jwk, typ="fv-control+jws", expected_kid=f.root_id
                    )

                with patch(
                    "folioview_shared.encrypted.authority.verify_jws",
                    side_effect=paused,
                ) as signatures:
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        pending = pool.submit(check, mutable, root)
                        try:
                            self.assertTrue(entered.wait(5))
                            mutable.update(b)
                            root.update(other.root_public)
                        finally:
                            release.set()
                        self.assertEqual(f.certificates["device_sig"], pending.result(timeout=5))
                    self.assertEqual(f.certificates["device_sig"], check(a, f.root_public))
                    self.assertEqual(1, signatures.call_count)
                    self.assertEqual(2, check(b, f.root_public)["keyEpoch"])
                    self.assertEqual(2, signatures.call_count)

    def test_static_item_overflow_repeats_full_schema_and_key_checks(self):
        f = self.f
        signed = [
            f.sign(f.certificates["device_sig"] | {"certificateId": f"static_{n}"}, "root")
            for n in range(129)
        ]
        with (
            patch(
                "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
            ) as signatures,
            patch(
                "folioview_shared.encrypted.authority.validate_schema",
                wraps=validate_schema,
            ) as schemas,
            patch(
                "folioview_shared.encrypted.authority.jwk_thumbprint",
                wraps=jwk_thumbprint,
            ) as thumbs,
        ):
            for item in signed:
                self.check_certificate(item)
            self.check_certificate(signed[0])
            self.assertEqual(
                (129, 129, 129),
                (signatures.call_count, schemas.call_count, thumbs.call_count),
            )
            self.check_certificate(signed[-1])
            self.assertEqual(
                (130, 130, 130),
                (signatures.call_count, schemas.call_count, thumbs.call_count),
            )

    def test_static_metadata_cannot_exceed_shared_byte_budget_on_promotion(self):
        f = self.f
        signed = f.bundle["entries"][0]["certificate"]

        # Signature-only entries and promoted static entries share the same budget.
        def encoded_size(item, payload):
            return (
                len(canonical_json(f.root_public))
                + len(canonical_json(item))
                + len(b"fv-control+jws")
                + len(f.root_id.encode())
                + len(canonical_json(payload))
            )

        self.check_signature(signed)
        total = encoded_size(signed, f.certificates["device_sig"])
        for n in range(18):
            payload = {"index": n, "padding": "x" * 24000}
            item = f.sign(payload, "root")
            total += encoded_size(item, payload)
            self.check_signature(item)
        remaining = 1_048_576 - total
        self.assertGreater(remaining, 0)

        # Land within one static metadata record of the bound using a legal JWS.
        def padding_size(padding):
            payload = {"index": 99, "padding": "x" * padding}
            # Signatures have fixed encoded length, so this sizes actual wire bytes.
            template = dict(signed, payload=b64url_encode(canonical_json(payload)))
            return encoded_size(template, payload)

        low, high = 0, 24000
        while low < high:
            middle = (low + high) // 2
            if padding_size(middle) <= remaining:
                low = middle + 1
            else:
                high = middle
        padding = low - 1
        self.assertGreaterEqual(padding, 0)
        self.assertLess(
            remaining - padding_size(padding),
            len(canonical_json({"publicKeyId": f.kid("device_sig")})),
        )
        self.check_signature(f.sign({"index": 99, "padding": "x" * padding}, "root"))
        with (
            patch(
                "folioview_shared.encrypted.authority.validate_schema",
                wraps=validate_schema,
            ) as schemas,
            patch(
                "folioview_shared.encrypted.authority.jwk_thumbprint",
                wraps=jwk_thumbprint,
            ) as thumbs,
        ):
            self.assertEqual(f.kid("device_sig"), self.check_certificate(signed)[1])
            self.assertEqual(f.kid("device_sig"), self.check_certificate(signed)[1])
            self.assertEqual(
                (2, 2),
                (schemas.call_count, thumbs.call_count),
                "valid overflow is checked again, not retained",
            )

    def test_concurrent_same_input_successes_do_not_double_count_bounded_entries(self):
        f = self.f
        signed = f.bundle["entries"][0]["certificate"]
        barrier = threading.Barrier(2)

        def concurrent(signed, public_jwk, **options):
            barrier.wait(timeout=5)
            return verify_jws(signed, public_jwk, **options)

        with patch(
            "folioview_shared.encrypted.authority.verify_jws", side_effect=concurrent
        ) as signatures:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(self.check_certificate, signed)
                second = pool.submit(self.check_certificate, signed)
                self.assertEqual(first.result(timeout=5), second.result(timeout=5))
            self.assertEqual(2, signatures.call_count, "pending verification is not a cache hit")
        # Unique signed bytes still have room for all 127 remaining entries.
        rest = [
            f.sign(f.certificates["device_sig"] | {"certificateId": f"parallel_{n}"}, "root")
            for n in range(128)
        ]
        with patch(
            "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
        ) as signatures:
            for item in rest:
                self.check_certificate(item)
            self.check_certificate(rest[-2])
            self.assertEqual(128, signatures.call_count)
            self.check_certificate(rest[-1])
            self.assertEqual(129, signatures.call_count)
            self.check_certificate(signed)
            self.assertEqual(129, signatures.call_count)

    def test_static_hits_do_not_replace_each_entry_identity_and_role_checks(self):
        f = self.f
        cert = f.certificates["device_sig"]
        changes = [
            {"ownerSubject": "other"},
            {"vaultId": "other"},
            {"issuerKeyId": f.kid("device_enc")},
            {"keyId": f.kid("device_enc")},
            {"expiresAt": cert["notBefore"]},
            {"connectionId": "other"},
            {"capabilities": ["result_write"]},
            {"role": "root_sig", "capabilities": []},
        ]
        for change in changes:
            with self.subTest(change=change):
                payload = cert | change
                signed = f.sign(payload, "root")
                self.check_certificate(signed)  # Static integrity alone is insufficient.
                bundle = copy.deepcopy(f.bundle)
                bundle["entries"][0]["certificate"] = signed
                for _ in range(2):
                    with self.assertRaises(ContractError):
                        f.verify(bundle, signature_memo=self.memo)


if __name__ == "__main__":
    unittest.main()
