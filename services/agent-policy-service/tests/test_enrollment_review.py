"""Synthetic enrollment review binds real Root controls, original CSR and exact proof."""

from types import SimpleNamespace
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from fixtures import CONNECTION, UID, PolicyFixture, public

from app.config import Config
from app.contracts import Unavailable, copy, digest
from app.enrollment_review import EXECUTOR, certificate_review, review
from app.main import app, get_policy
from folioview_shared.auth import require_google_user
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import sign_jws, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.errors import ContractError


class EnrollmentReviewTests(PolicyFixture):
    def request(self):
        draft = {
            k: self.binding[k]
            for k in [
                "ownerSubject",
                "vaultId",
                "connectionId",
                "agentId",
                "clientId",
                "provider",
                "providerClientId",
                "identityEpoch",
                "issuer",
                "audience",
                "recipientKeyIds",
            ]
        }
        draft.update(
            policyJwk=self.value["policyJwk"],
            scope=self.scope,
            workload=self.workload,
            kmsRecoveryKey=self.value["kmsRecoveryKey"],
            snapshotBucket=self.workload["projectId"] + "-executor-state",
            creationWorkload={
                **self.workload,
                "serviceAccount": "creator@synthetic-project.iam.gserviceaccount.com",
                "attestationAudience": self.config.issuer + "/enrollment",
            },
        )
        permit = self.signed(
            {"profile": EXECUTOR, "action": "initialize", "draftDigest": digest(draft)}
        )
        tls = serialization.load_pem_private_key(
            self.keys["tls"].export_to_pem(private_key=True, password=None), None
        )
        csr = (
            x509.CertificateSigningRequestBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "executor.example")]))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("executor.example")]), False)
            .sign(tls, hashes.SHA256())
            .public_bytes(serialization.Encoding.PEM)
            .decode()
        )
        offer = {
            "profile": EXECUTOR,
            "enrollmentId": digest(
                {k: draft[k] for k in ["ownerSubject", "vaultId", "connectionId", "identityEpoch"]}
            ),
            "draft": draft,
            "permit": permit,
            **{
                k: public(self.keys[n])
                for k, n in [
                    ("agentSigningJwk", "agent_sig"),
                    ("agentEncryptionJwk", "agent_enc"),
                    ("tlsJwk", "tls"),
                ]
            },
            "certificateRequest": csr,
        }
        statement = {
            "profile": EXECUTOR,
            "action": "offer",
            "issuer": self.config.issuer,
            "permitFingerprint": signing_input_fingerprint(permit),
            "offerDigest": digest(offer),
        }
        offer["creationAttestation"] = {"statement": statement, "token": "synthetic-attestation"}
        return {"pendingOffer": offer, "finalOffer": None, "certificateChain": None}

    def signed(self, value):
        return sign_jws(
            {
                **value,
                "operationId": "synthetic_enrollment_control_001",
                "issuedAt": self.now,
                "expiresAt": self.now + 300,
            },
            self.keys["root"],
            typ="fv-control+jws",
        )

    def final(self, request):
        p = request["pendingOffer"]
        command = self.signed(
            {
                "profile": EXECUTOR,
                "action": "finalize",
                "offerDigest": digest(p),
                "bindingFingerprint": self.binding["bindingFingerprint"],
                "workload": self.workload,
            }
        )
        final = {
            "profile": EXECUTOR,
            "binding": self.binding,
            "workload": self.workload,
            **{
                k: p[k]
                for k in [
                    "agentSigningJwk",
                    "agentEncryptionJwk",
                    "tlsJwk",
                    "certificateRequest",
                    "permit",
                ]
            },
            "initialStateHead": self.enrollment["initialStateHead"],
            "wrappedStateKey": self.enrollment["wrappedStateKey"],
            "offerDigest": digest(p),
            "finalization": command,
        }
        statement = {
            "profile": EXECUTOR,
            "action": "finalize",
            "issuer": self.config.issuer,
            "permitFingerprint": signing_input_fingerprint(p["permit"]),
            "offerDigest": digest(p),
            "finalizationFingerprint": signing_input_fingerprint(command),
            "binding": self.binding,
            "initialStateHead": final["initialStateHead"],
            "wrappedKeyDigest": digest(final["wrappedStateKey"]),
            "csrDigest": digest(final["certificateRequest"]),
        }
        final["creationAttestation"] = {"statement": statement, "token": "synthetic-attestation"}
        request["finalOffer"] = final
        return request

    def test_pending_and_final_review_are_fixed_signed_public_artifacts_without_state_changes(self):
        state_before = self.store.load()
        for request, stage in [(self.request(), "pending"), (self.final(self.request()), "final")]:
            result = review(self.policy, UID, request)
            payload = verify_jws(result["review"], self.value["policyJwk"], typ="fv-control+jws")
            self.assertEqual(payload["stage"], stage)
            self.assertEqual(payload["domain"], self.config.domain)
            self.assertEqual(payload["pendingOfferDigest"], digest(request["pendingOffer"]))
            self.assertEqual(
                payload["offerDigest"], digest(request["finalOffer"] or request["pendingOffer"])
            )
            self.assertEqual(payload["expiresAt"] - payload["issuedAt"], 120)
            self.assertNotIn("wrappedStateKey", payload)
        self.assertEqual(self.store.load(), state_before)
        self.assertEqual(self.signer.unwrapped, [])

    def test_owner_root_domain_and_actual_attestation_are_mandatory(self):
        with self.assertRaises(ContractError):
            review(self.policy, "other_owner", self.request())
        self.attestor.accept = False
        with self.assertRaises(ContractError):
            review(self.policy, UID, self.request())
        self.attestor.accept = True
        request = self.request()
        request["pendingOffer"]["draft"]["ownerSubject"] = "a" * 64
        with self.assertRaises(ContractError):
            review(self.policy, UID, request)
        different = Config.parse({**self.value, "stateEpoch": "other_epoch"})
        with self.assertRaises(Unavailable):
            review(self.new_policy(different), UID, self.request())

    def test_tampered_original_keys_csr_statement_and_final_head_cannot_be_reviewed(self):
        for mutate in [
            lambda x: x["pendingOffer"].update(tlsJwk=public(self.keys["device"])),
            lambda x: x["pendingOffer"]["creationAttestation"]["statement"].update(
                offerDigest="a" * 64
            ),
            lambda x: x.update(privateKey={"d": "private"}),
            lambda x: x["finalOffer"].update(initialStateHead="a" * 64),
            lambda x: x["finalOffer"]["binding"].update(bindingFingerprint="a" * 64),
            lambda x: x["finalOffer"].update(wrappedStateKey="changed_ciphertext"),
        ]:
            request = copy(self.final(self.request()))
            mutate(request)
            with self.assertRaises(ContractError):
                review(self.policy, UID, request)

    def test_review_works_with_issuance_release_off_but_requires_bootstrapped_domain(self):
        inactive = self.new_policy(Config.parse(self.value, enabled=False, release_enabled=False))
        self.assertIn("review", review(inactive, UID, self.request()))
        self.witness.path.unlink()
        with self.assertRaises(Unavailable):
            review(inactive, UID, self.request())

    def test_http_requires_owner_contract_closed_bounded_body_and_has_no_store_write(self):
        app.dependency_overrides[get_policy] = lambda: self.policy
        app.dependency_overrides[require_google_user] = lambda: SimpleNamespace(uid=UID)
        self.addCleanup(app.dependency_overrides.clear)
        with TestClient(app, base_url=self.config.issuer) as client:
            path = "/api/v1/enrollment-reviews"
            body = {"contractVersion": CONTRACT_VERSION, "request": self.request()}
            response = client.post(
                path, json=body, headers={"X-FolioView-Contract": CONTRACT_VERSION}
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(client.post(path, json=body).status_code, 400)
            app.dependency_overrides[require_google_user] = lambda: SimpleNamespace(
                uid="other_owner"
            )
            self.assertEqual(
                client.post(
                    path, json=body, headers={"X-FolioView-Contract": CONTRACT_VERSION}
                ).status_code,
                403,
            )

    def test_certificate_review_pins_current_original_key_version_and_exact_chain(self):
        request = {"certificateChain": "synthetic-public-chain"}
        with patch("app.enrollment_review.certificate_digest", return_value="e" * 64) as check:
            result = certificate_review(self.policy, UID, CONNECTION, request)
            payload = verify_jws(result["review"], self.value["policyJwk"], typ="fv-control+jws")
            self.assertEqual(payload["bindingDigest"], digest(self.binding))
            self.assertEqual(payload["certificateDigest"], "e" * 64)
            check.assert_called_once_with(
                request["certificateChain"],
                self.enrollment["tlsJwk"],
                self.binding["audience"],
                now=self.now,
            )
        with self.assertRaises(ContractError):
            certificate_review(self.policy, UID, CONNECTION, {"certificateChain": "invalid"})
        self.revoke()
        with self.assertRaises(ContractError):
            certificate_review(self.policy, UID, CONNECTION, request)
