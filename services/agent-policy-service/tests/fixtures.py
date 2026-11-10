"""Synthetic independent Root/Agent/TLS keys; no real account or cloud resources."""

import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from jwcrypto import jwe, jwk

from app.config import Config
from app.contracts import CONTROL, PROFILE, copy, digest, token_hash
from app.oauth import OAuth
from app.policy import Policy
from app.store import FileSnapshots, SQLiteWitness, StateStore
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import jwk_thumbprint, sign_jws
from folioview_shared.encrypted.executor_trust import EXECUTOR_TRUST_PROFILE
from folioview_shared.encrypted.jsonutil import b64url_encode, strict_json_loads
from folioview_shared.identity import owner_key

UID = "synthetic_policy_owner"
CONNECTION = "synthetic_policy_connection"
VERIFIER = "v" * 43


def public(key):
    p = key.export(private_key=False, as_dict=True)
    return {k: p[k] for k in ("kty", "crv", "x", "y")}


def open_secret(encrypted, key):
    packet = jwe.JWE()
    packet.deserialize(json.dumps(encrypted))
    packet.decrypt(key)
    return strict_json_loads(packet.payload)


class Signer:
    def __init__(self, key):
        self.key = key
        self.unwrapped = []
        self.dek = b"k" * 32
        self.callback = None

    def sign(self, payload):
        return sign_jws(payload, self.key, typ="fv-control+jws")

    def unwrap_recovery_key(self, encrypted, binding_digest):
        self.unwrapped.append((encrypted, binding_digest))
        if self.callback:
            action, self.callback = self.callback, None
            action()
        return self.dek


class Attestor:
    def __init__(self):
        self.calls = []
        self.callback = None
        self.accept = True

    def verify(self, token, statement, workload):
        from app.contracts import deny

        self.calls.append(copy(statement))
        if self.callback:
            action, self.callback = self.callback, None
            action()
        if token != "synthetic-attestation" or not self.accept:
            deny()
        return {
            "instanceId": "123456789",
            "statementDigest": digest(statement),
            "tokenDigest": digest(token),
        }


class PolicyFixture(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.now = int(time.time())
        self.keys = {
            k: jwk.JWK.generate(kty="EC", crv="P-256")
            for k in (
                "root",
                "policy",
                "agent_sig",
                "agent_enc",
                "tls",
                "ephemeral",
                "device",
                "recovery",
            )
        }
        self.value = {
            "issuer": "https://policy.example",
            "consentUrl": "https://owner.example/policy-consent",
            "ownerSubject": owner_key(UID),
            "vaultId": "synthetic_vault",
            "rootJwk": public(self.keys["root"]),
            "policyJwk": public(self.keys["policy"]),
            "stateEpoch": "synthetic_policy_epoch",
            "provider": "synthetic_provider",
            "providerClientId": "synthetic_provider_client",
            "audience": "https://executor.example/mcp",
            "kmsSigningKeyVersion": (
                "projects/synthetic/locations/global/keyRings/policy/"
                "cryptoKeys/sign/cryptoKeyVersions/1"
            ),
            "kmsRecoveryKey": (
                "projects/synthetic/locations/global/keyRings/policy/cryptoKeys/recovery"
            ),
            "witnessProject": "synthetic-project",
            "witnessDatabase": "policy-witness",
            "snapshotBucket": "synthetic-policy-snapshots",
            "clients": [
                {
                    "clientId": "synthetic_native",
                    "redirectUris": ["https://native.example/callback"],
                    "tokenEndpointAuthMethod": "none",
                    "secretSha256": None,
                }
            ],
        }
        if getattr(self, "CLIENT_METHOD", "none") == "client_secret_basic":
            self.value["clients"][0].update(
                tokenEndpointAuthMethod="client_secret_basic",
                secretSha256=token_hash("synthetic-client-secret"),
            )
        self.config = Config.parse(self.value, enabled=True, release_enabled=True)
        self.witness = self.make_witness()
        self.snapshots = FileSnapshots(self.directory / "backups")
        self.store = StateStore(self.witness, self.snapshots, self.config.domain)
        self.signer = Signer(self.keys["policy"])
        self.attestor = Attestor()
        self.policy = self.new_policy()
        self.serial = 0
        self.policy.bootstrap(
            self.control(
                "bootstrap", connection="policy", parameters={"domain": self.config.domain}
            )
        )
        self.resource = {
            "kind": "holdings",
            "sourceService": "portfolio",
            "resourceId": "synthetic_holdings",
            "incarnation": "synthetic_incarnation",
        }
        self.scope = {
            "profile": "folioview.hub-executor-ciphertext-scope.v1",
            "purpose": "analysis",
            "resultPolicy": "owner_inbox",
            "resourceBindings": [{"ref": self.resource, "sourceEpoch": 1}],
        }
        self.workload = {
            "projectId": "synthetic-project",
            "projectNumber": "123456789012",
            "zone": "us-central1-a",
            "instanceName": "synthetic-executor",
            "serviceAccount": "executor@synthetic-project.iam.gserviceaccount.com",
            "imageDigest": "sha256:" + "a" * 64,
            "args": ["python", "-m", "app.main"],
            "environment": {},
            "hwmodel": "GCP_AMD_SEV",
            "attestationAudience": "https://policy.example/attestation",
        }
        self.enrollment = {
            "agentId": "synthetic_agent",
            "clientId": "synthetic_native",
            "identityEpoch": 1,
            "bindingFingerprint": "b" * 64,
            "agentSigningJwk": public(self.keys["agent_sig"]),
            "agentEncryptionJwk": public(self.keys["agent_enc"]),
            "tlsJwk": public(self.keys["tls"]),
            "scope": self.scope,
            "recipientKeyIds": sorted(
                jwk_thumbprint(public(self.keys[k])) for k in ("device", "recovery")
            ),
            "workload": self.workload,
            "initialStateHead": "c" * 64,
            "certificateDigest": "d" * 64,
            "wrappedStateKey": b64url_encode(b"synthetic-kms-ciphertext"),
        }
        self.binding = self.policy.enrollment_binding(self.enrollment, CONNECTION)
        self.registration = self.register_request()
        self.policy.control(UID, CONNECTION, self.registration)

    def new_policy(self, config=None):
        return Policy(
            config or self.config, self.store, self.signer, self.attestor, clock=lambda: self.now
        )

    def make_witness(self):
        witness = SQLiteWitness(self.directory / "live" / "authority.sqlite3")
        witness.initialize_storage()
        return witness

    def control(
        self,
        action,
        *,
        connection=CONNECTION,
        parameters=None,
        version=0,
        head=None,
        operation=None,
        **changes,
    ):
        self.serial += 1
        payload = {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTROL,
            "action": action,
            "ownerSubject": self.config.owner,
            "connectionId": connection,
            "operationId": operation or f"synthetic_policy_control_{self.serial:04d}",
            "expectedVersion": version,
            "expectedHead": head,
            "parametersDigest": digest(parameters),
            "issuedAt": self.now,
            "expiresAt": self.now + 300,
            **changes,
        }
        return sign_jws(payload, self.keys["root"], typ="fv-control+jws")

    def register_request(self):
        op = "synthetic_policy_register_0001"
        approval = sign_jws(
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_approval",
                "binding": self.binding,
                "operationId": op,
                "issuedAt": self.now,
                "expiresAt": self.now + 86400,
            },
            self.keys["root"],
            typ="fv-control+jws",
        )
        return {
            "action": "register",
            "parameters": self.enrollment,
            "approval": approval,
            "command": self.control(
                "register",
                parameters={"enrollment": self.enrollment, "approval": approval},
                operation=op,
            ),
        }

    def owner_state(self):
        return self.policy.owner_state(UID, CONNECTION)

    def revoke(self):
        state = self.owner_state()
        request = {
            "action": "revoke",
            "parameters": {},
            "approval": None,
            "command": self.control(
                "revoke",
                version=state["stateVersion"],
                head=state["stateHead"],
                parameters={"parameters": {}, "approval": None},
            ),
        }
        return self.policy.control(UID, CONNECTION, request)

    def authorization_data(self, **changes):
        return {
            "response_type": "code",
            "client_id": "synthetic_native",
            "redirect_uri": "https://native.example/callback",
            "scope": "executor:execute executor:recover executor:write_report",
            "resource": self.value["audience"],
            "state": "synthetic_policy_oauth_state_01",
            "code_challenge": b64url_encode(hashlib.sha256(VERIFIER.encode()).digest()),
            "code_challenge_method": "S256",
            **changes,
        }

    def authorize(self, **changes):
        oauth = OAuth(self.policy)
        data = self.authorization_data(**changes)
        pending, cookie = oauth.begin(data)
        current = self.owner_state()
        signed = self.control(
            "oauth_approve",
            version=current["stateVersion"],
            head=current["stateHead"],
            parameters={"pendingId": pending["pendingId"], "requestDigest": digest(data)},
        )
        result = oauth.approve(UID, pending["pendingId"], cookie, CONNECTION, signed)
        self.assertIn(result["status"], (302, 303), result)
        code = parse_qs(urlsplit(result["headers"]["Location"]).query)["code"][0]
        result = oauth.token(
            {
                "grant_type": "authorization_code",
                "client_id": "synthetic_native",
                "code": code,
                "redirect_uri": data["redirect_uri"],
                "code_verifier": VERIFIER,
                "resource": self.value["audience"],
            },
            headers=self.client_headers(),
        )
        self.assertEqual(result["status"], 200, result)
        self.assertEqual(result["body"]["token_type"], "Bearer")
        return result["body"]

    def client_headers(self):
        import base64

        if getattr(self, "CLIENT_METHOD", "none") == "client_secret_basic":
            value = base64.b64encode(b"synthetic_native:synthetic-client-secret").decode()
            return {"Authorization": "Basic " + value}
        return {}

    def proof(self, path, request, *, key="agent_sig", **changes):
        self.serial += 1
        return sign_jws(
            {
                "profile": PROFILE,
                "purpose": "authenticated_request",
                "bindingDigest": digest(self.binding),
                "audience": self.config.issuer,
                "path": path,
                "method": "POST",
                "bodyDigest": digest(request),
                "requestId": f"synthetic_policy_request_{self.serial:04d}",
                "issuedAt": self.now,
                "expiresAt": self.now + 120,
                **changes,
            },
            self.keys[key],
            typ="fv-control+jws",
        )

    def args(self, route, request, *, key="agent_sig", **changes):
        path = f"/v1/connections/{CONNECTION}/" + route
        return (
            CONNECTION,
            self.tokens["access_token"],
            self.proof(path, request, key=key, **changes),
            path,
            request,
        )

    def operation(self, **changes):
        return {
            "bindingDigest": digest(self.binding),
            "runId": "synthetic_run",
            "operationId": "synthetic_policy_operation_0001",
            "requestDigest": "e" * 64,
            **changes,
        }

    def challenge(self, purpose="recover", **changes):
        request = {
            "purpose": purpose,
            "operation": self.operation(),
            "resourceBindings": self.scope["resourceBindings"],
            "bootId": "synthetic_boot_01",
            "releaseRecipientJwk": public(self.keys["ephemeral"]),
            **changes,
        }
        return self.policy.challenge(
            *self.args(
                "challenges", request, key="ephemeral" if purpose == "recover" else "agent_sig"
            )
        )

    def grant_request(self, ch, *, recover=False):
        path = f"/v1/connections/{CONNECTION}/" + ("releases" if recover else "leases")
        answer = open_secret(ch["encryptionChallenge"], self.keys["agent_enc"])["secret"]
        return {
            "challengeId": ch["challenge"]["challengeId"],
            "attestationToken": "synthetic-attestation",
            "encryptionAnswer": None if recover else answer,
            "tlsProof": None
            if recover
            else self.proof(
                path, {"statement": ch["statement"], "encryptionAnswer": answer}, key="tls"
            ),
        }

    def recover(self, *, boot="synthetic_boot_01"):
        ch = self.challenge("recover", bootId=boot)
        response = self.policy.grant(
            *self.args("releases", self.grant_request(ch, recover=True), key="ephemeral"),
            release=True,
        )
        key = open_secret(response["sealedRecoveryKey"], self.keys["ephemeral"])
        self.assertEqual(key["secret"], b64url_encode(self.signer.dek))
        answer = open_secret(ch["encryptionChallenge"], self.keys["agent_enc"])["secret"]
        path = f"/v1/connections/{CONNECTION}/confirm"
        request = {
            "challengeId": ch["challenge"]["challengeId"],
            "encryptionAnswer": answer,
            "tlsProof": self.proof(
                path, {"statement": ch["statement"], "encryptionAnswer": answer}, key="tls"
            ),
        }
        confirmed = self.policy.confirm(*self.args("confirm", request))
        self.assertEqual(confirmed["generation"], response["generation"])
        return response

    def lease(self, purpose="write_report", **changes):
        ch = self.challenge(purpose, **changes)
        request = self.grant_request(ch)
        return self.policy.grant(*self.args("leases", request)), ch, request
