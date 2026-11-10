"""Real RS256 evidence against fixed Google JWKS/Compute fixtures, no cloud calls."""

import copy
import json
from types import SimpleNamespace

import httpx
from fixtures import PolicyFixture
from jwcrypto import jwk, jws

from app.attestation import ISSUER, JWKS, GoogleAttestation
from app.contracts import Unavailable, digest
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json


class AttestationTests(PolicyFixture):
    def setUp(self):
        super().setUp()
        self.google = jwk.JWK.generate(kty="RSA", size=2048, kid="synthetic-google-key")
        self.statement = {"profile": "synthetic-binding", "nonce": "a" * 64, "keys": self.binding}
        self.claims = {
            "iss": ISSUER,
            "aud": self.workload["attestationAudience"],
            "iat": self.now,
            "nbf": self.now - 1,
            "exp": self.now + 300,
            "eat_nonce": digest(self.statement),
            "swname": "CONFIDENTIAL_SPACE",
            "dbgstat": "disabled-since-boot",
            "secboot": True,
            "hwmodel": "GCP_AMD_SEV",
            "google_service_accounts": [self.workload["serviceAccount"]],
            "submods": {
                "confidential_space": {
                    "support_attributes": ["STABLE"],
                    "monitoring_enabled": {"memory": False},
                },
                "container": {
                    "image_digest": self.workload["imageDigest"],
                    "args": self.workload["args"],
                    "env": {},
                    "cmd_override": [],
                    "env_override": {},
                },
                "gce": {
                    "project_id": self.workload["projectId"],
                    "project_number": self.workload["projectNumber"],
                    "zone": self.workload["zone"],
                    "instance_name": self.workload["instanceName"],
                    "instance_id": "123456789",
                },
            },
        }
        self.vm = {
            "id": "123456789",
            "status": "RUNNING",
            "serviceAccounts": [{"email": self.workload["serviceAccount"]}],
        }
        self.calls = []
        self.bad_status = False
        self.large = False

        def respond(request):
            self.calls.append(request)
            if self.bad_status:
                return httpx.Response(503)
            if self.large:
                return httpx.Response(200, content=b"x" * 140000)
            if str(request.url) == JWKS:
                return httpx.Response(200, json={"keys": [self.google.export_public(as_dict=True)]})
            if str(request.url).startswith("https://compute.googleapis.com/"):
                self.assertEqual(
                    request.headers["authorization"], "Bearer synthetic-compute-identity"
                )
                return httpx.Response(200, json=self.vm)
            raise AssertionError("Unexpected network destination")

        client = httpx.Client(transport=httpx.MockTransport(respond))
        self.addCleanup(client.close)
        self.attestor = GoogleAttestation(
            client=client,
            credentials=SimpleNamespace(valid=True, token="synthetic-compute-identity"),
            clock=lambda: self.now,
        )

    def token(self, claims=None, *, key=None):
        signed = jws.JWS(canonical_json(claims or self.claims))
        signed.add_signature(
            key or self.google,
            protected=json.dumps({"alg": "RS256", "kid": "synthetic-google-key", "typ": "JWT"}),
        )
        return signed.serialize(compact=True)

    def verify(self, claims=None):
        return self.attestor.verify(self.token(claims), self.statement, self.workload)

    def test_real_signature_nonce_claims_and_current_vm_are_all_checked(self):
        result = self.verify()
        self.assertEqual(result["instanceId"], self.vm["id"])
        self.assertEqual(result["statementDigest"], digest(self.statement))
        self.assertEqual(len(self.calls), 2)
        self.verify()

    def test_wrong_signer_audience_time_nonce_and_debug_environment_are_rejected(self):
        for path, value in [
            (("iss",), "https://hub.example"),
            (("aud",), "https://wrong.example"),
            (("exp",), self.now),
            (("iat",), self.now - 121),
            (("nbf",), self.now + 1),
            (("eat_nonce",), "f" * 64),
            (("dbgstat",), "enabled"),
            (("secboot",), False),
            (("hwmodel",), "GCP_SHIELDED_VM"),
            (("submods", "confidential_space", "monitoring_enabled", "memory"), True),
            (("submods", "confidential_space", "support_attributes"), ["EXPERIMENTAL"]),
            (("submods", "container", "image_digest"), "sha256:" + "f" * 64),
            (("submods", "container", "args"), ["sh"]),
            (("submods", "container", "env_override"), {"DEBUG": "1"}),
            (("submods", "gce", "project_id"), "other-project"),
            (("submods", "gce", "instance_name"), "other-vm"),
            (("google_service_accounts",), ["hub@synthetic-project.iam.gserviceaccount.com"]),
        ]:
            claims = copy.deepcopy(self.claims)
            node = claims
            for field in path[:-1]:
                node = node[field]
            node[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(ContractError):
                self.verify(claims)
        wrong = jwk.JWK.generate(kty="RSA", size=2048)
        with self.assertRaises(ContractError):
            self.attestor.verify(self.token(key=wrong), self.statement, self.workload)

    def test_old_instance_same_name_and_missing_latest_compute_state_are_rejected(self):
        self.vm["id"] = "987654321"
        with self.assertRaises(ContractError):
            self.verify()
        self.bad_status = True
        with self.assertRaises(Unavailable):
            self.verify()

    def test_unbounded_keys_response_is_an_outage_without_following_caller_urls(self):
        self.large = True
        with self.assertRaises(Unavailable):
            self.verify()
        self.assertEqual(str(self.calls[0].url), JWKS)

    def test_exact_root_pinned_environment_allows_measured_operator_subset(self):
        expected = {
            "EXECUTOR_ENABLED": "1",
            "EXECUTOR_CREATION_ENABLED": "0",
            "EXECUTOR_CONFIG_OBJECT": "gs://synthetic-state/executor-config/runtime.json",
            "PYTHONUNBUFFERED": "1",
        }
        self.workload["environment"] = expected
        container = self.claims["submods"]["container"]
        container["env"] = copy.deepcopy(expected)
        container["env_override"] = {k: v for k, v in expected.items() if k != "PYTHONUNBUFFERED"}
        self.assertEqual(self.verify()["instanceId"], "123456789")
        container["env_override"] = {}
        self.assertEqual(self.verify()["instanceId"], "123456789")

    def test_changed_extra_or_malformed_overrides_fail_before_current_vm_access(self):
        self.workload["environment"] = {"EXECUTOR_ENABLED": "1"}
        self.claims["submods"]["container"]["env"] = {"EXECUTOR_ENABLED": "1"}
        for overrides in [
            {"EXECUTOR_ENABLED": "0"},
            {"EXECUTOR_ENABLED": 1},
            {"EXECUTOR_ENABLED": "1", "DEBUG": "1"},
            {"PATH": "/attacker"},
            [],
            None,
        ]:
            claims = copy.deepcopy(self.claims)
            claims["submods"]["container"]["env_override"] = overrides
            self.calls.clear()
            with self.subTest(overrides=overrides), self.assertRaises(ContractError):
                self.verify(claims)
            self.assertFalse(
                any(str(r.url).startswith("https://compute.googleapis.com/") for r in self.calls)
            )

    def test_matching_override_subset_cannot_hide_changed_full_environment_or_cmd(self):
        self.workload["environment"] = {"EXECUTOR_ENABLED": "1"}
        self.claims["submods"]["container"].update(
            env={"EXECUTOR_ENABLED": "1"}, env_override={"EXECUTOR_ENABLED": "1"}
        )
        for changes in [
            {"env": {"EXECUTOR_ENABLED": "1", "PYTHONPATH": "/attacker"}},
            {"env": {}},
            {"cmd_override": ["python", "-m", "app.main"]},
            {"args": ["python", "-m", "app.initialize"]},
        ]:
            claims = copy.deepcopy(self.claims)
            claims["submods"]["container"].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.verify(claims)
