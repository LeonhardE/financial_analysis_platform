"""Independent synthetic wire authority; no cloud/Owner credentials or production data."""

import hashlib
import json
import secrets
import tempfile
import time
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID
from jwcrypto import jwe, jwk

from app.config import Config
from app.contracts import POLICY, PROFILE, clone, digest, identity_digest
from app.policy import PolicyClient
from app.runtime import Executor
from app.state import FileSnapshots, public, seal
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    jwk_thumbprint,
    sign_jws,
    signing_input_fingerprint,
    verify_jws,
)
from folioview_shared.encrypted.executor_trust import EXECUTOR_TRUST_PROFILE
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json, strict_json_loads

ACCESS = "synthetic_executor_access"


def cert_for(key, hostname="executor.example", *, start=-60, end=86400):
    private = serialization.load_pem_private_key(
        key.export_to_pem(private_key=True, password=None), None
    )
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])
    now = datetime.now(UTC)
    return (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(private.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now + timedelta(seconds=start))
        .not_valid_after(now + timedelta(seconds=end))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(hostname)]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(private, hashes.SHA256())
        .public_bytes(serialization.Encoding.PEM)
        .decode()
    )


def secret_packet(secret, recipient, context):
    packet = jwe.JWE(
        canonical_json({"secret": b64url_encode(secret), "context": context}),
        protected={"alg": "ECDH-ES+A256KW", "enc": "A256GCM", "typ": "fv-policy-secret+jwe"},
    )
    packet.add_recipient(jwk.JWK(**recipient))
    return json.loads(packet.serialize())


class Attestor:
    def __init__(self):
        self.statements = []
        self.allowed = True

    def issue(self, statement):
        from app.contracts import require

        require(self.allowed)
        self.statements.append(clone(statement))
        return "synthetic.attestation.token"

    def issue_creation(self, statement):
        return {"statement": statement, "token": self.issue(statement)}


class Authority:
    """Hand-authored protocol fixture, independent of Policy implementation/storage."""

    def __init__(self, config, policy_key, dek, head, clock):
        self.config, self.key, self.dek, self.head, self.clock = (
            config,
            policy_key,
            dek,
            head,
            clock,
        )
        self.epoch, self.version = 1, 1
        self.challenges, self.receipts, self.calls = {}, {}, []
        self.confirmed, self.revoked, self.unavailable = False, False, False
        self.boot = None
        self.tamper = None
        self.after_lease = None
        self.drop_commit_response = False
        self.commit_request = None

    def cp(self):
        return {
            "contractVersion": CONTRACT_VERSION,
            "profile": EXECUTOR_TRUST_PROFILE,
            "artifactType": "executor_checkpoint",
            "bindingDigest": digest(self.config.binding),
            "approvalFingerprint": signing_input_fingerprint(self.config.public["approval"]),
            "stateVersion": self.version,
            "stateHead": self.head,
            "authorizationEpoch": self.epoch,
            "revoked": self.revoked,
            "issuedAt": int(self.clock()),
            "expiresAt": int(self.clock()) + 120,
        }

    def signed(self, payload):
        return sign_jws(payload, self.key, typ="fv-control+jws")

    def handle(self, request):
        self.calls.append(request.url.path)
        if self.revoked or self.unavailable:
            return httpx.Response(503, json={"error": "unavailable"})
        body = strict_json_loads(request.content)
        assert set(body) == {"contractVersion", "proof", "request"}
        assert body["contractVersion"] == CONTRACT_VERSION
        assert request.headers["x-folioview-contract"] == CONTRACT_VERSION
        assert str(request.url).startswith(self.config.issuer + "/")
        assert not request.url.query
        workload = request.url.path.startswith("/workload/")
        if workload:
            assert "authorization" not in request.headers
        else:
            assert request.headers["authorization"] == "Bearer " + ACCESS
        suffix, value = request.url.path.rsplit("/", 1)[-1], body["request"]
        if suffix == "challenges" and value["purpose"] == "recover":
            proofkey = value["releaseRecipientJwk"]
        elif suffix == "releases":
            proofkey = self.challenges[value["challengeId"]]["statement"]["releaseRecipientJwk"]
        else:
            proofkey = self.config.public["agentSigningJwk"]
        proof = verify_jws(body["proof"], proofkey, typ="fv-control+jws")
        assert proof["bodyDigest"] == digest(value) and proof["path"] == request.url.path
        assert proof["audience"] == self.config.issuer and proof["bindingDigest"] == digest(
            self.config.binding
        )
        assert proof["issuedAt"] <= int(self.clock()) < proof["expiresAt"]
        if suffix == "challenges":
            ch = {
                "bindingDigest": digest(self.config.binding),
                "challengeId": secrets.token_urlsafe(24),
                "nonce": b64url_encode(secrets.token_bytes(32)),
                "purpose": value["purpose"],
                "issuedAt": int(self.clock()),
                "expiresAt": int(self.clock()) + 120,
            }
            statement = {
                "profile": POLICY,
                "binding": self.config.binding,
                "challenge": ch,
                "operation": value["operation"],
                "resourceBindings": value["resourceBindings"],
                "bootId": value["bootId"],
                "releaseRecipientJwk": value["releaseRecipientJwk"],
                "stateHead": self.head,
                "authorizationEpoch": self.epoch,
                "certificateDigest": hashlib.sha256(
                    self.config.public["certificateChain"].encode()
                ).hexdigest(),
                "authorizationMode": "workload_recovery" if workload else "account",
            }
            secret = secrets.token_bytes(32)
            self.challenges[ch["challengeId"]] = {"statement": clone(statement), "secret": secret}
            result = {
                "profile": POLICY,
                "challenge": ch,
                "statement": statement,
                "checkpoint": self.signed(self.cp()),
                "encryptionChallenge": secret_packet(
                    secret, self.config.public["agentEncryptionJwk"], statement
                ),
            }
            if self.tamper:
                result = self.tamper(result)
        elif suffix in {"releases", "leases"}:
            row = self.challenges[value["challengeId"]]
            statement = row["statement"]
            assert value["attestationToken"] == "synthetic.attestation.token"
            if suffix == "releases":
                assert workload and statement["challenge"]["purpose"] == "recover"
                assert value["encryptionAnswer"] is value["tlsProof"] is None
                self.epoch += 1
                self.version += 1
                self.boot = statement["bootId"]
                self.confirmed = False
            else:
                assert self.confirmed and statement["bootId"] == self.boot
                assert value["encryptionAnswer"] == b64url_encode(row["secret"])
                tls = verify_jws(
                    value["tlsProof"], self.config.public["tlsJwk"], typ="fv-control+jws"
                )
                assert tls["bodyDigest"] == digest(
                    {"statement": statement, "encryptionAnswer": value["encryptionAnswer"]}
                )
            cp = self.cp()
            lease = {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_lease",
                "bindingDigest": digest(self.config.binding),
                "checkpointDigest": digest(cp),
                "challenge": statement["challenge"],
                "operation": statement["operation"],
                "issuedAt": int(self.clock()),
                "expiresAt": min(int(self.clock()) + 120, statement["challenge"]["expiresAt"]),
            }
            result = {
                "profile": POLICY,
                "approval": self.config.public["approval"],
                "checkpoint": self.signed(cp),
                "lease": self.signed(lease),
                "generation": self.epoch,
                "stateHead": self.head,
                "sealedRecoveryKey": None,
            }
            if suffix == "releases":
                result["sealedRecoveryKey"] = secret_packet(
                    self.dek,
                    statement["releaseRecipientJwk"],
                    {
                        "bindingDigest": digest(self.config.binding),
                        "stateHead": self.head,
                        "generation": self.epoch,
                        "challengeId": value["challengeId"],
                    },
                )
            else:
                if self.after_lease:
                    self.after_lease()
            row["lease"] = result["lease"]
        elif suffix == "confirm":
            row = self.challenges[value["challengeId"]]
            assert value["encryptionAnswer"] == b64url_encode(row["secret"])
            tls = verify_jws(value["tlsProof"], self.config.public["tlsJwk"], typ="fv-control+jws")
            assert tls["bodyDigest"] == digest(
                {"statement": row["statement"], "encryptionAnswer": value["encryptionAnswer"]}
            )
            self.confirmed = True
            result = {
                "profile": POLICY,
                "generation": self.epoch,
                "stateHead": self.head,
                "checkpoint": self.signed(self.cp()),
            }
        elif suffix == "checkpoint":
            result = {
                "profile": POLICY,
                "approval": self.config.public["approval"],
                "binding": self.config.binding,
                "checkpoint": self.signed(self.cp()),
                "stateHead": self.head,
                "receipts": list(self.receipts.values()),
            }
        elif suffix == "commits":
            assert self.confirmed and value["expectedHead"] == self.head
            self.commit_request = clone(value)
            self.head = value["nextHead"]
            self.epoch += 1
            self.version += 1
            result = {k: value[k] for k in ("receipt", "expectedHead", "nextHead")}
            self.receipts[value["receipt"]["operation"]["operationId"]] = value["receipt"]
            if self.drop_commit_response:
                raise httpx.ReadTimeout("synthetic unknown acknowledgement")
        else:
            raise AssertionError("Unexpected fixture route")
        return httpx.Response(200, json=result)


class Fixture(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="executor-core-")
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.now = int(time.time())
        self.keys = {
            name: jwk.JWK.generate(kty="EC", crv="P-256")
            for name in ("root", "policy", "signing", "encryption", "tls", "device", "recovery")
        }
        scope = {
            "profile": "folioview.hub-executor-ciphertext-scope.v1",
            "purpose": "analysis",
            "resultPolicy": "owner_inbox",
            "resourceBindings": [
                {
                    "ref": {
                        "kind": "holdings",
                        "sourceService": "portfolio",
                        "resourceId": "synthetic_holdings",
                        "incarnation": "synthetic_incarnation",
                    },
                    "sourceEpoch": 1,
                }
            ],
        }
        workload = {
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
        binding = {
            "ownerSubject": "synthetic_owner",
            "vaultId": "synthetic_vault",
            "connectionId": "synthetic_connection",
            "agentId": "synthetic_agent",
            "clientId": "synthetic_native",
            "provider": "synthetic_provider",
            "providerClientId": "synthetic_provider_client",
            "identityEpoch": 1,
            "bindingFingerprint": "b" * 64,
            "issuer": "https://policy.example",
            "audience": "https://executor.example/mcp",
            "scopeDigest": digest(scope),
            "workloadDigest": digest(workload),
            "recipientKeyIds": sorted(
                jwk_thumbprint(public(self.keys[k])) for k in ("device", "recovery")
            ),
        }
        for name, field in {
            "root": "rootKeyId",
            "policy": "policySigningKeyId",
            "signing": "agentSigningKeyId",
            "encryption": "agentEncryptionKeyId",
            "tls": "tlsKeyId",
        }.items():
            binding[field] = jwk_thumbprint(public(self.keys[name]))
        approval = sign_jws(
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_approval",
                "binding": binding,
                "operationId": "synthetic_root_approval_0001",
                "issuedAt": self.now - 1,
                "expiresAt": self.now + 86400,
            },
            self.keys["root"],
            typ="fv-control+jws",
        )
        self.value = {
            "profile": PROFILE,
            "binding": binding,
            "approval": approval,
            "rootJwk": public(self.keys["root"]),
            "policyJwk": public(self.keys["policy"]),
            "agentSigningJwk": public(self.keys["signing"]),
            "agentEncryptionJwk": public(self.keys["encryption"]),
            "tlsJwk": public(self.keys["tls"]),
            "scope": scope,
            "workload": workload,
            "certificateChain": cert_for(self.keys["tls"]),
            "snapshotBucket": "synthetic-executor-state",
            "kmsRecoveryKey": (
                "projects/synthetic-project/locations/global/keyRings/policy/cryptoKeys/recovery"
            ),
        }
        self.config = Config.parse(self.value, now=self.now)
        self.dek = secrets.token_bytes(32)
        self.state = {
            "profile": PROFILE,
            "identityDigest": identity_digest(binding),
            "sequence": 1,
            "keys": {
                name: self.keys[name].export(private_key=True, as_dict=True)
                for name in ("signing", "encryption", "tls")
            },
            "outbox": {},
            "receipts": [],
        }
        self.snapshots = FileSnapshots(self.directory / "encrypted")
        self.head = self.snapshots.put(seal(self.state, self.dek, binding))
        self.authority = Authority(
            self.config, self.keys["policy"], self.dek, self.head, lambda: self.now
        )
        self.attestor = Attestor()
        self.runtime = self.new_runtime()

    def new_runtime(self, config=None):
        client = httpx.Client(transport=httpx.MockTransport(self.authority.handle), trust_env=False)
        self.addCleanup(client.close)
        policy = PolicyClient(config or self.config, client=client, clock=lambda: self.now)
        return Executor(
            config or self.config, policy, self.attestor, self.snapshots, clock=lambda: self.now
        )

    def operation(self, **changes):
        return {
            "bindingDigest": digest(self.config.binding),
            "runId": "synthetic_run",
            "operationId": "synthetic_executor_operation_0001",
            "requestDigest": "c" * 64,
            **changes,
        }

    def receipt(self, operation):
        return {"operation": operation, "receiptId": "synthetic_receipt", "resultDigest": "d" * 64}
