"""Real synthetic Root/Agent crypto over an independent ciphertext-only wire fixture."""

import hashlib
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx

# Reuse the shared contract's public synthetic-key builder, never another service.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "common/tests"))
from fixtures import ACCESS, Authority, Fixture  # noqa: E402
from test_encrypted_schema import report_content  # noqa: E402
from test_persistent_content import PersistentContentFixture  # noqa: E402

from app.config import Config
from app.contracts import clone, digest, identity_digest
from app.hub import HubClient
from app.native import NativeEngine
from app.native_config import NATIVE, NativeConfig
from app.state import public, seal
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import sign_jws, signing_input_fingerprint
from folioview_shared.encrypted.executor_trust import EXECUTOR_TRUST_PROFILE
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.encrypted.persistent_agents import (
    PERSISTENT_AGENT_PROFILE,
    initial_agent_identity,
    verify_agent_identity_binding,
)
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    CONTENT_PROFILE,
    persistent_manifest_fingerprint,
    persistent_run_id,
    verify_persistent_request,
)
from folioview_shared.encrypted.resource_consents import (
    RESOURCE_CONSENT_PROFILE,
    approve_resource_consent,
)

TASK = "task_A1"
TRIGGER = "synthetic_native_occurrence_0001"
TPUB = "synthetic_native_task_publication_01"
RPUB = "synthetic_native_resource_publication_01"


class WireHub:
    def __init__(self, fixture):
        self.f = fixture
        self.runs = {}
        self.results = {}
        self.submissions = []
        self.calls = []
        self.inputs = {}
        self.active = True
        self.source_revision = 1
        self.drop_submit = False
        self.drop_begin = False
        self.after_input = None
        self.change_manifest = None

    def respond(self, request):
        f = self.f
        self.calls.append(request.url.path)
        if not self.active:
            return httpx.Response(403, json={"error": "key_authorization_required"})
        assert "authorization" not in request.headers
        payload = strict_json_loads(request.content)
        value = payload["request"]
        suffix = request.url.path.split("/connections/" + f.config.connection + "/")[1]
        assert request.headers["x-folioview-contract"] == CONTRACT_VERSION
        assert str(request.url).startswith("https://hub.example/agent/v3/persistent/executor/")
        verify_persistent_request(
            payload["proof"],
            registry=f.crypto.registry,
            current_identity=f.crypto.identity,
            owner_subject=f.config.binding["ownerSubject"],
            vault_id=f.config.binding["vaultId"],
            connection_id=f.config.connection,
            client_id=f.config.binding["clientId"],
            audience="https://hub.example",
            method="POST",
            path=request.url.path,
            body=value,
            now=f.now,
        )
        if suffix == "session":
            result = f.session()
        elif suffix == "consent-receipts":
            result = f.consent_receipts[value["operationId"]]
        elif suffix == "tasks":
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "tasks": [
                    {
                        "taskId": TASK,
                        "taskVersion": 1,
                        "executionEpoch": 1,
                        "publicationId": TPUB,
                        "fingerprint": signing_input_fingerprint(f.task_carrier["proof"]),
                    }
                ],
            }
        elif suffix == "runs/begin":
            run = persistent_run_id(
                owner_subject=f.crypto.owner,
                vault_id=f.crypto.vault,
                task_id=value["taskId"],
                trigger_id=value["triggerId"],
            )
            if run not in self.runs:
                c = f.resource_context
                m = {
                    "contractVersion": CONTRACT_VERSION,
                    "profile": CONTENT_PROFILE,
                    "purpose": "analysis",
                    "resultPolicy": "owner_inbox",
                    **{k: f.config.binding[k] for k in BINDING_FIELDS},
                    "taskId": TASK,
                    "taskVersion": 1,
                    "executionEpoch": 1,
                    "authorityId": "task_authority_A",
                    "authorityVersion": 1,
                    "runId": run,
                    "stableOperationId": value["operationId"],
                    "triggerId": value["triggerId"],
                    "taskPublicationId": TPUB,
                    "taskPublicationFingerprint": signing_input_fingerprint(
                        f.task_carrier["proof"]
                    ),
                    "createdAt": f.now,
                    "expiresAt": f.now + 7200,
                    "inputs": [
                        {
                            "ref": f.crypto.resource,
                            "sourceEpoch": 1,
                            "sourceRevision": self.source_revision,
                            "permissionId": "permission_A",
                            "permissionEpoch": 1,
                            "publicationId": c["stableOperationId"],
                            "publicationFingerprint": signing_input_fingerprint(
                                f.resource_carrier["proof"]
                            ),
                            "objectId": c["objectId"],
                        }
                    ],
                }
                self.runs[run] = {
                    "contractVersion": CONTRACT_VERSION,
                    "profile": CONTENT_PROFILE,
                    "manifest": m,
                    "manifestFingerprint": persistent_manifest_fingerprint(m),
                    "state": "ready",
                    "resultId": None,
                }
                self.inputs[(run, TPUB)] = clone(f.task_carrier)
                self.inputs[(run, c["stableOperationId"])] = clone(f.resource_carrier)
            result = clone(self.runs[run])
            if self.drop_begin:
                raise httpx.ReadTimeout("synthetic unknown begin")
        elif suffix == "runs/receipt":
            if value["runId"] not in self.runs:
                return httpx.Response(404, json={"error": "not_found"})
            result = clone(self.runs[value["runId"]])
            if self.change_manifest:
                result = self.change_manifest(result)
        elif suffix == "runs/input":
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "manifestFingerprint": self.runs[value["runId"]]["manifestFingerprint"],
                "envelope": clone(self.inputs[(value["runId"], value["publicationId"])]),
            }
            if self.after_input:
                self.after_input()
        elif suffix == "runs/submit":
            self.submissions.append(clone(value))
            run = value["runId"]
            m = self.runs[run]["manifest"]
            c = f.config.binding
            if run in self.results:
                assert self.results[run]["body"] == value
                result = self.results[run]["receipt"]
            else:
                receipt = {
                    "contractVersion": CONTRACT_VERSION,
                    "profile": CONTENT_PROFILE,
                    "resultId": "presult_" + digest([c["ownerSubject"], c["vaultId"], run]),
                    "runId": run,
                    "taskId": TASK,
                    "connectionId": c["connectionId"],
                    "revision": 1,
                    "publicationId": value["operationId"],
                    "fingerprint": signing_input_fingerprint(value["envelope"]["proof"]),
                    "manifestFingerprint": self.runs[run]["manifestFingerprint"],
                    "receivedAt": f.now,
                }
                self.results[run] = {"body": clone(value), "receipt": receipt}
                self.runs[run].update(state="submitted", resultId=receipt["resultId"])
                result = receipt
            if self.drop_submit:
                raise httpx.ReadTimeout("synthetic unknown report response")
        elif suffix == "runs/result-receipt":
            if value["runId"] not in self.results:
                return httpx.Response(404, json={"error": "not_found"})
            result = self.results[value["runId"]]["receipt"]
        else:
            raise AssertionError("Unexpected Hub route")
        return httpx.Response(200, json=result)


class NativeFixture(Fixture):
    def setUp(self):
        super().setUp()
        f = self.crypto = PersistentContentFixture()
        f.owner = hashlib.sha256(b"synthetic_native_owner").hexdigest()
        f.vault = self.value["binding"]["vaultId"]
        for certificate in f.certificates.values():
            certificate.update(
                ownerSubject=f.owner,
                vaultId=f.vault,
                notBefore=self.now - 100,
                expiresAt=self.now + 86400,
            )
        f.bundle = f.make_bundle(issued_at=self.now - 10)
        f.registry = f.verify(f.bundle, now=self.now)
        f.client = self.value["binding"]["clientId"]
        p = {
            **f.base("persistent_agent_binding"),
            "profile": PERSISTENT_AGENT_PROFILE,
            "rootKeyId": f.root_id,
            "connectionId": "connection_A1",
            "agentId": "A1",
            "clientId": f.client,
            "identityEpoch": 1,
            "agentSigningKeyId": f.kid("A1_sig"),
            "agentEncryptionKeyId": f.kid("A1_enc"),
            "deviceSigningKeyId": f.kid("device_sig"),
            "stableOperationId": "synthetic_native_enrollment_01",
            "registrySequence": 1,
            "checkpointDigest": f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": self.now,
        }
        f.identity_binding = f.sign(p)
        f.identity = initial_agent_identity(
            verify_agent_identity_binding(
                f.identity_binding,
                registry=f.registry,
                owner_subject=f.owner,
                vault_id=f.vault,
                connection_id="connection_A1",
                agent_id="A1",
                client_id=f.client,
                now=self.now,
            )
        )
        self.keys.update(
            root=f.root,
            signing=f.keys["A1_sig"],
            encryption=f.keys["A1_enc"],
            device=f.keys["device_enc"],
            recovery=f.keys["recovery_enc"],
        )
        b = self.value["binding"]
        b.update(
            ownerSubject=f.owner,
            connectionId="connection_A1",
            agentId="A1",
            provider="openai_chatgpt",
            providerClientId=f.client,
            rootKeyId=f.root_id,
            agentSigningKeyId=f.kid("A1_sig"),
            agentEncryptionKeyId=f.kid("A1_enc"),
            bindingFingerprint=signing_input_fingerprint(f.identity_binding),
            recipientKeyIds=sorted([f.kid("device_enc"), f.kid("recovery_enc")]),
        )
        self.value["scope"]["resourceBindings"] = [{"ref": f.resource, "sourceEpoch": 1}]
        b["scopeDigest"] = digest(self.value["scope"])
        self.value.update(
            rootJwk=f.root_public,
            agentSigningJwk=public(self.keys["signing"]),
            agentEncryptionJwk=public(self.keys["encryption"]),
        )
        self.value["approval"] = sign_jws(
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_approval",
                "binding": b,
                "operationId": "synthetic_native_root_approval",
                "issuedAt": self.now - 1,
                "expiresAt": self.now + 86400,
            },
            f.root,
            typ="fv-control+jws",
        )
        self.config = Config.parse(self.value, now=self.now)
        self.state.update(
            identityDigest=identity_digest(b),
            keys={
                n: self.keys[n].export(private_key=True, as_dict=True)
                for n in ["signing", "encryption", "tls"]
            },
        )
        self.head = self.snapshots.put(seal(self.state, self.dek, b))
        self.authority = Authority(
            self.config, self.keys["policy"], self.dek, self.head, lambda: self.now
        )
        self.runtime = self.new_runtime()
        self.runtime.restore()
        self.native_value = {
            "profile": NATIVE,
            "hubAudience": "https://hub.example",
            "providerClientId": f.client,
            "registryAnchor": f.bundle,
        }
        self.native_config = NativeConfig.parse(self.native_value, self.config, now=self.now)
        self.task_context = f.content_context("task")
        self.task_context.update(issuedAt=self.now, stableOperationId=TPUB)
        self.task_private = f.private_content(self.task_context)
        self.task_carrier = f.seal(self.task_context, self.task_private)
        self.resource_context = f.content_context("holdings_snapshot")
        self.resource_context.update(issuedAt=self.now, stableOperationId=RPUB)
        self.resource_private = f.private_content(self.resource_context)
        stamp = datetime.fromtimestamp(self.now, UTC).isoformat().replace("+00:00", "Z")
        self.resource_private["payload"].update(
            fetchedAt=stamp, sourceAsOf=stamp, freshness="fresh"
        )
        self.resource_carrier = f.seal(self.resource_context, self.resource_private)
        sources = [
            {
                "ownerSubject": f.owner,
                "vaultId": f.vault,
                "ref": f.resource,
                "sourceEpoch": 1,
                "currentRevision": 1,
                "state": "active",
            }
        ]
        cp = {
            **{k: b[k] for k in BINDING_FIELDS},
            "contractVersion": CONTRACT_VERSION,
            "profile": RESOURCE_CONSENT_PROFILE,
            "artifactType": "persistent_resource_approval",
            "consentId": "synthetic_native_consent",
            "purpose": "analysis",
            "authorKeyId": f.root_id,
            "stableOperationId": "synthetic_native_consent_01",
            "expectedVersion": 0,
            "expectedConsentDigest": None,
            "issuedAt": self.now,
            "registrySequence": 1,
            "checkpointDigest": f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "resources": [
                {
                    "permissionId": "permission_A",
                    "ref": f.resource,
                    "sourceEpoch": 1,
                    "fromRevision": 1,
                    "versionPolicy": "current_and_future",
                    "selectedHistory": [],
                    "expectedPermissionEpoch": 0,
                }
            ],
        }
        signed = f.sign(cp, "root")
        self.consent = approve_resource_consent(
            signed,
            current_consent=None,
            current_identity=f.identity,
            source_states=sources,
            registry=f.registry,
            root_jwk=f.root_public,
            owner_subject=f.owner,
            vault_id=f.vault,
            connection_id=b["connectionId"],
            client_id=f.client,
            consent_id=cp["consentId"],
            now=self.now,
        )
        self.consent_receipt = {
            "contractVersion": CONTRACT_VERSION,
            "profile": RESOURCE_CONSENT_PROFILE,
            "operationId": cp["stableOperationId"],
            "fingerprint": signing_input_fingerprint(signed),
            "priorDigest": None,
            "consent": self.consent,
            "command": signed,
            "sourceStates": sources,
        }
        self.consent_receipts = {self.consent_receipt["operationId"]: self.consent_receipt}
        self.registry_history = [f.bundle]
        self.wire = WireHub(self)
        self.engine = self.new_engine(self.runtime)
        self.report = report_content()

    def session(self):
        f = self.crypto
        return {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "identity": f.identity,
            "binding": f.identity_binding,
            "rootJwk": f.root_public,
            "registryHistory": self.registry_history,
            "consent": self.consent,
            "consentOperations": list(self.consent_receipts),
            "registrySequence": f.registry.registry_sequence,
        }

    def new_engine(self, runtime):
        client = httpx.Client(transport=httpx.MockTransport(self.wire.respond))
        self.addCleanup(client.close)
        hub = HubClient(runtime, self.native_config, client=client, clock=lambda: self.now)
        return NativeEngine(runtime, self.native_config, hub, clock=lambda: self.now)

    def read(self, publication=None, trigger=TRIGGER):
        return self.engine.execute(
            "executor_input",
            {"taskId": TASK, "triggerId": trigger, "publicationId": publication},
            ACCESS,
        )
