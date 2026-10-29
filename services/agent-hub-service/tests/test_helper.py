"""Checked browser helper cross-language authority and memory-session regressions."""

import copy
import hashlib
import json
import os
import re
import selectors
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import test_preparations as preparation_fixtures
from fixtures import UID
from jwcrypto import jwk
from test_encrypted_schema import resource_content, wrapper
from test_oauth import TASK
from test_preparations import PreparationFixture

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    _signed_parts,
    encrypt_jwe,
    sign_jws,
    signing_input_fingerprint,
)

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "helper"


class Peer:
    def __init__(self):
        node = shutil.which("node")
        if not node:
            raise AssertionError(
                "Browser helper tests require Node >=20.19; refusing a skipped suite."
            )
        version = subprocess.check_output([node, "--version"], text=True).strip()
        match = re.fullmatch(r"v(\d+)\.(\d+)\.\d+", version)
        if not match or tuple(map(int, match.groups())) < (20, 19):
            raise AssertionError("Browser helper tests require Node >=20.19.")
        self.process = subprocess.Popen(
            [node, str(ROOT / "tests" / "helper_peer.mjs")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.counter = 0
        self.generation = 1

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)
        self.process.stdout.close()
        self.process.stderr.close()

    def message(self, op, args=None):
        self.counter += 1
        return {
            "id": f"request_{self.counter}",
            "sessionId": "synthetic_helper_session",
            "generation": self.generation,
            "op": op,
            "args": args or {},
        }

    def raw(self, value):
        self.process.stdin.write(json.dumps(value) + "\n")
        self.process.stdin.flush()
        selector = selectors.DefaultSelector()
        try:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=8):
                raise AssertionError("Browser helper did not complete a bounded request.")
            result = self.process.stdout.readline()
        finally:
            selector.close()
        if not result:
            raise AssertionError("Browser helper process exited before a response.")
        return json.loads(result)

    def call(self, op, args=None, *, trusted=False, ok=True):
        result = self.raw({"trusted": trusted, "message": self.message(op, args)})
        if ok and not result["ok"]:
            raise AssertionError("Helper rejected synthetic operation: " + result["error"])
        return result["value"] if ok else result


class BrowserHelperTests(unittest.TestCase):
    def setUp(self):
        self.peer = Peer()
        self.addCleanup(self.peer.close)
        peer = self.peer
        three = (
            self._testMethodName
            == "test_three_resource_kinds_decrypt_and_reject_private_semantic_errors"
        )
        extra_refs = [
            {
                "kind": kind,
                "sourceService": "user",
                "resourceId": kind + "_A",
                "incarnation": "user_incarnation_A",
            }
            for kind in ("watchlist", "channel_follows")
        ]

        class WorkerFixture(PreparationFixture):
            def task_body(self, *args, **kwargs):
                if three:
                    kwargs["resources"] = [
                        *kwargs["resources"],
                        *({"ref": ref, "sourceEpoch": 1} for ref in extra_refs),
                    ]
                value = super().task_body(*args, **kwargs)
                self.locally_created_task = copy.deepcopy(value["envelope"])
                return value

            def sign(self, payload, *args, **kwargs):
                value = super().sign(payload, *args, **kwargs)
                if payload.get("artifactType") == "agent_key_grant":
                    self.locally_approved_grant = copy.deepcopy(payload)
                return value

            def pair(self, connection):
                self.initial_anchor = {
                    "ownerSubject": self.owner,
                    "vaultId": self.vault,
                    "rootJwk": self.root_public,
                    "rootKeyId": self.root_id,
                    "rootEpoch": 1,
                    "registrySequence": self.registry.registry_sequence,
                    "checkpointDigest": self.registry.checkpoint_digest,
                    "connectionId": connection,
                    "agentPrincipalId": "synthetic_agent",
                    "taskId": TASK,
                }
                self.worker_keys = peer.call(
                    "initialize",
                    {"anchor": self.initial_anchor, "now": 1000, "ttlSeconds": 600},
                    trusted=True,
                )
                for role, public_field, kid_field in (
                    ("agent_sig", "agentSigningPublicJwk", "agentSigningKeyId"),
                    ("agent_enc", "agentEncryptionPublicJwk", "agentEncryptionKeyId"),
                ):
                    name = "A1_sig" if role == "agent_sig" else "A1_enc"
                    self.add_key(name, role, "synthetic_agent", connection)
                    self.certificates[name]["publicJwk"] = self.worker_keys[public_field]
                    self.certificates[name]["keyId"] = self.worker_keys[kid_field]
                    self.keys[name] = jwk.JWK(**self.worker_keys[public_field])
                self.bundle = self.make_bundle(previous=self.registry, issued_at=1000)
                self.registry = self.verify(self.bundle, previous=self.registry)

        self.case = preparation_fixtures.PreparationTests()

        class AllSources(preparation_fixtures.Sources):
            def read(self, uid):
                value = super().read(uid)
                if three:
                    value["groups"].append(
                        {
                            "items": [
                                {
                                    "ref": ref,
                                    "sourceEpoch": self.epoch,
                                    "revision": self.revision,
                                    "snapshotId": None,
                                    "state": "ready",
                                }
                                for ref in extra_refs
                            ]
                        }
                    )
                return value

        original_params = preparation_fixtures.authorization_params

        def requested(**kwargs):
            if three:
                kwargs["scope"] += " watchlist:read channel_follows:read"
            return original_params(**kwargs)

        with (
            patch("test_preparations.PreparationFixture", WorkerFixture),
            patch("test_preparations.Sources", AllSources),
            patch("test_preparations.authorization_params", requested),
        ):
            self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.intent, self.envelopes, _, _ = self.case.publish()
        self.metadata = self.case.service.metadata(self.case.tokens["access_token"], TASK)
        from app.preparations import preparation_id

        locally_signed = self.case.fix.locally_approved_grant
        local_context = _signed_parts(self.envelopes[TASK][0]["signedObject"])[1]["context"]
        self.pin = {
            "preparationId": preparation_id(
                {k: locally_signed[k] for k in ("ownerSubject", "connectionId", "authorizationId")},
                locally_signed,
            ),
            "taskVersion": local_context["revision"],
            "objects": sorted(
                (
                    {
                        "objectId": obj,
                        "envelopeFingerprint": signing_input_fingerprint(carrier["signedObject"]),
                    }
                    for obj, (carrier, _) in self.envelopes.items()
                ),
                key=lambda r: r["objectId"],
            ),
            "taskEnvelopeFingerprint": signing_input_fingerprint(
                self.case.fix.locally_created_task["signedObject"]
            ),
            "taskDeliveryFingerprint": signing_input_fingerprint(
                self.envelopes[TASK][0]["signedObject"]
            ),
            "deliveryRevision": local_context["deliveryRevision"],
            "priorEnvelopeFingerprint": local_context["priorEnvelopeFingerprint"],
            **{
                k: locally_signed[k]
                for k in ("authorizationId", "grantId", "grantEpoch", "executionEpoch")
            },
        }
        # These are trusted owning-device publication facts in this synthetic
        # fixture, not automatic confirmation of a server-returned root or hash.
        self.bundles = self.case.vaults.current(UID)["vault"]["registryHistory"]

    def ready(self, *, metadata=None):
        for bundle in self.bundles:
            self.peer.call("registry", {"bundles": [bundle]})
        self.peer.call("confirmDelivery", {"pin": self.pin}, trusted=True)
        return self.peer.call("install", {"metadata": metadata or self.metadata})

    def test_python_encrypted_current_task_and_holdings_open_in_real_memory_keys(self):
        self.assertTrue(self.case.fix.worker_keys["keyExportRejected"])
        self.assertFalse(self.case.fix.worker_keys["privateKeysExtractable"])
        status = self.ready()
        self.assertEqual(status["state"], "ACTIVE")
        for row in self.metadata["objects"]:
            carrier = self.envelopes[row["objectId"]][0]
            content = self.peer.call("decrypt", {"objectId": row["objectId"], "envelope": carrier})
            self.assertEqual(content["revision"], row["revision"])
            self.assertEqual(content["provenance"], row["provenance"])
            if row["objectType"] == "holdings_snapshot":
                self.assertEqual(
                    content["payload"]["data"]["accounts"][0]["positions"][0]["quantity"],
                    "1.000000000001",
                )
            else:
                self.assertEqual(content["payload"]["goal"], "Review my resources.")

    def test_agent_port_cannot_initialize_confirm_or_import_export_private_keys(self):
        for op, args in (
            (
                "initialize",
                {"anchor": self.case.fix.initial_anchor, "now": 1000, "ttlSeconds": 600},
            ),
            ("confirmDelivery", {"pin": self.pin}),
            ("importPrivateKey", {"privateJwk": {"d": "synthetic"}}),
            ("exportPrivateKey", {}),
            ("sealResult", {"content": "synthetic"}),
        ):
            denied = self.peer.call(op, args, ok=False)
            self.assertFalse(denied["ok"])
            self.assertEqual(denied["error"], "unsupported_operation")
        self.assertEqual(self.peer.call("status")["state"], "READY")

    def test_backend_metadata_never_auto_confirms_root_or_delivery(self):
        for bundle in self.bundles:
            self.peer.call("registry", {"bundles": [bundle]})
        response = self.peer.call("install", {"metadata": self.metadata}, ok=False)
        self.assertEqual(response["error"], "trusted_pin_required")
        self.peer.call("confirmDelivery", {"pin": self.pin}, trusted=True)
        bad = copy.deepcopy(self.metadata)
        bad["rootKeyId"] = "A" * 43
        self.assertFalse(self.peer.call("install", {"metadata": bad}, ok=False)["ok"])
        bad = copy.deepcopy(self.metadata)
        bad["objects"][0]["envelopeFingerprint"] = "0" * 64
        self.assertFalse(self.peer.call("install", {"metadata": bad}, ok=False)["ok"])

    def test_lock_during_crypto_await_never_releases_late_plaintext(self):
        self.ready()
        row = self.metadata["objects"][0]
        result = self.peer.raw(
            {
                "race": True,
                "read": self.peer.message(
                    "decrypt",
                    {"objectId": row["objectId"], "envelope": self.envelopes[row["objectId"]][0]},
                ),
                "lock": self.peer.message("lock"),
            }
        )["value"]
        self.assertFalse(result["read"]["ok"])
        self.assertEqual(result["locked"]["state"], "LOCKED")
        self.assertFalse(result["locked"]["privateKeysPresent"])

    def test_invalid_aead_tag_is_rejected_even_with_valid_owner_signature(self):
        row = next(x for x in self.metadata["objects"] if x["objectType"] != "task")
        bad = copy.deepcopy(self.envelopes[row["objectId"]][0])
        _, message = _signed_parts(bad["signedObject"])
        tag = message["jwe"]["tag"]
        message["jwe"]["tag"] = ("A" if tag[0] != "A" else "B") + tag[1:]
        bad["signedObject"] = sign_jws(
            message, self.case.fix.keys["device_sig"], typ="fv-object+jws"
        )
        row["envelopeFingerprint"] = signing_input_fingerprint(bad["signedObject"])
        next(x for x in self.pin["objects"] if x["objectId"] == row["objectId"])[
            "envelopeFingerprint"
        ] = row["envelopeFingerprint"]
        self.ready()
        result = self.peer.call("decrypt", {"objectId": row["objectId"], "envelope": bad}, ok=False)
        self.assertFalse(result["ok"])

    def test_current_signed_key_revocation_locks_only_this_worker_session(self):
        self.ready()
        fixture = self.case.fix
        next_bundle = fixture.make_bundle(
            previous=fixture.registry, revoked=("A1_enc",), issued_at=1000
        )
        rejected = self.peer.call("registry", {"bundles": [next_bundle]}, ok=False)
        self.assertFalse(rejected["ok"])
        self.peer.generation += 1
        self.assertEqual(self.peer.call("status")["state"], "REVOKED")
        self.assertFalse(self.peer.call("status")["privateKeysPresent"])

    def test_uncommitted_valid_resource_candidate_cannot_replace_confirmed_copy(self):
        candidate = self.case.fix.envelopes(self.intent, salt="uncommitted")
        changed = copy.deepcopy(self.metadata)
        row = next(x for x in changed["objects"] if x["objectType"] != "task")
        row["envelopeFingerprint"] = signing_input_fingerprint(
            candidate[row["objectId"]][0]["signedObject"]
        )
        for bundle in self.bundles:
            self.peer.call("registry", {"bundles": [bundle]})
        self.peer.call("confirmDelivery", {"pin": self.pin}, trusted=True)
        denied = self.peer.call("install", {"metadata": changed}, ok=False)
        self.assertEqual(denied["error"], "delivery_binding_mismatch")

    def test_grant_issuer_revocation_clears_cached_authority(self):
        self.ready()
        fixture = self.case.fix
        next_bundle = fixture.make_bundle(
            previous=fixture.registry, revoked=("device_sig",), issued_at=1000
        )
        denied = self.peer.call("registry", {"bundles": [next_bundle]}, ok=False)
        self.assertFalse(denied["ok"])
        self.peer.generation += 1
        self.assertEqual(self.peer.call("status")["state"], "REVOKED")
        self.assertFalse(self.peer.call("status")["privateKeysPresent"])

    def test_global_key_epoch_advance_clears_cached_authority(self):
        self.ready()
        fixture = self.case.fix
        bundle = fixture.make_bundle(previous=fixture.registry, key_epoch=2, issued_at=1000)
        denied = self.peer.call("registry", {"bundles": [bundle]}, ok=False)
        self.assertFalse(denied["ok"])
        self.peer.generation += 1
        self.assertEqual(self.peer.call("status")["state"], "REVOKED")
        self.assertFalse(self.peer.call("status")["privateKeysPresent"])

    def test_agent_message_queue_is_bounded_while_crypto_is_pending(self):
        self.ready()
        row = self.metadata["objects"][0]
        results = self.peer.raw(
            {
                "flood": True,
                "messages": [
                    self.peer.message(
                        "decrypt",
                        {
                            "objectId": row["objectId"],
                            "envelope": self.envelopes[row["objectId"]][0],
                        },
                    )
                    for _ in range(24)
                ],
            }
        )["value"]
        self.assertTrue(
            any(not result["ok"] and result["error"]["code"] == "queue_limit" for result in results)
        )
        self.assertEqual(self.peer.call("status")["state"], "ACTIVE")

    def test_closed_metadata_cannot_accept_extra_secrets_or_foreign_owner_connection(self):
        for bundle in self.bundles:
            self.peer.call("registry", {"bundles": [bundle]})
        self.peer.call("confirmDelivery", {"pin": self.pin}, trusted=True)
        for field, value in (
            ("privateJwk", {"d": "synthetic"}),
            ("ownerSubject", "other_owner"),
            ("connectionId", "connection_A2"),
        ):
            bad = {**self.metadata, field: value}
            self.assertFalse(self.peer.call("install", {"metadata": bad}, ok=False)["ok"])

    def test_three_resource_kinds_decrypt_and_reject_private_semantic_errors(self):
        self.ready()
        kinds = set()
        for descriptor in self.metadata["objects"]:
            if descriptor["objectType"] == "task":
                continue
            value = self.peer.call(
                "decrypt",
                {
                    "objectId": descriptor["objectId"],
                    "envelope": self.envelopes[descriptor["objectId"]][0],
                },
            )
            kinds.add(value["payload"]["data"]["kind"])
        self.assertEqual(kinds, {"holdings", "watchlist", "channel_follows"})
        row = next(
            x for x in self.metadata["objects"] if x["objectType"] == "channel_follows_evidence"
        )
        original = self.envelopes[row["objectId"]][0]
        _, message = _signed_parts(original["signedObject"])
        context = message["context"]
        private = wrapper(context, resource_content("channel_follows", row["objectId"]))
        private["payload"]["data"]["items"][0]["handleOrUrl"] = "javascript:synthetic"
        recipients = {
            c["keyId"]: c["publicJwk"]
            for c in self.case.fix.certificates.values()
            if c["keyId"] in {r["keyId"] for r in context["recipients"]}
        }
        # Simulate an honest-encryption/valid-signature but buggy owner writer;
        # only the receiving client can inspect these private semantics.
        with patch("folioview_shared.encrypted.private.validate_private_payload"):
            message["jwe"] = encrypt_jwe(private, recipients, context=context)
        malformed = {
            "contractVersion": CONTRACT_VERSION,
            "signedObject": sign_jws(
                message, self.case.fix.keys["device_sig"], typ="fv-object+jws"
            ),
        }
        row["envelopeFingerprint"] = signing_input_fingerprint(malformed["signedObject"])
        next(x for x in self.pin["objects"] if x["objectId"] == row["objectId"])[
            "envelopeFingerprint"
        ] = row["envelopeFingerprint"]
        self.peer.call("confirmDelivery", {"pin": self.pin}, trusted=True)
        self.peer.call("install", {"metadata": self.metadata})
        denied = self.peer.call(
            "decrypt", {"objectId": row["objectId"], "envelope": malformed}, ok=False
        )
        self.assertEqual(denied["error"], "private_schema_invalid")


class HelperDistributionTests(unittest.TestCase):
    def test_foreground_ttl_discards_private_key_handles(self):
        peer = Peer()
        self.addCleanup(peer.close)
        fixture = PreparationFixture()
        peer.call(
            "initialize",
            {
                "anchor": {
                    "ownerSubject": fixture.owner,
                    "vaultId": fixture.vault,
                    "rootJwk": fixture.root_public,
                    "rootKeyId": fixture.root_id,
                    "rootEpoch": 1,
                    "registrySequence": 1,
                    "checkpointDigest": fixture.registry.checkpoint_digest,
                    "connectionId": "synthetic_ttl_connection",
                    "agentPrincipalId": "synthetic_agent",
                    "taskId": TASK,
                },
                "now": 1000,
                "ttlSeconds": 1,
            },
            trusted=True,
        )
        time.sleep(1.1)
        peer.generation += 1
        status = peer.call("status")
        self.assertEqual(status["state"], "LOCKED")
        self.assertFalse(status["privateKeysPresent"])

    def test_fixed_distribution_hashes_schema_copy_and_no_dynamic_runtime_dependencies(self):
        manifest = json.loads((HELPER / "integrity.json").read_text())
        self.assertEqual(manifest["contractVersion"], CONTRACT_VERSION)
        for path, digest in manifest["files"].items():
            self.assertEqual(hashlib.sha256((HELPER / path).read_bytes()).hexdigest(), digest, path)
        shared = ROOT.parent / "common" / "folioview_shared" / "encrypted" / "schemas.json"
        self.assertEqual((HELPER / "schemas.json").read_bytes(), shared.read_bytes())
        bundle = (HELPER / manifest["assets"]["worker"]).read_text()
        for pattern in (
            r"\bimport\s*\(",
            r"\beval\s*\(",
            r"\bnew\s+Function\b",
            r"\bfetch\s*\(",
            r"\bXMLHttpRequest\b",
            r"\blocalStorage\b",
            r"\bindexedDB\b",
        ):
            self.assertIsNone(re.search(pattern, bundle), pattern)
        protocol = json.loads((HELPER / "protocol.json").read_text())
        self.assertEqual(protocol["executionProfile"], "BH-M-E")
        self.assertNotIn("initialize", protocol["agentOperations"])
        self.assertNotIn("confirmDelivery", protocol["agentOperations"])

    def test_browser_distribution_runs_without_installed_build_dependencies(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node is required; this test must not silently skip.")
        with tempfile.TemporaryDirectory() as directory:
            worker = Path(directory) / "worker.mjs"
            shutil.copyfile(HELPER / "dist" / "worker.mjs", worker)
            code = (
                f"import {{ForegroundSession}} from {json.dumps(worker.as_uri())}; "
                "console.log(new ForegroundSession().status().state);"
            )
            result = subprocess.run(
                [node, "--input-type=module"], input=code, capture_output=True, text=True, timeout=8
            )
        self.assertEqual(result.returncode, 0, result.stderr[:500])
        self.assertEqual(result.stdout.strip(), "ABSENT")
