"""Dependency-free persistent browser crypto interoperates with Python authority."""

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

import test_persistent_resource_store as consent_fixtures
from fixtures import UID
from test_persistent_content import PersistentContentFixture

from app.store import document_path
from folioview_shared.encrypted.persistent_content import (
    open_persistent_content,
    verify_persistent_carrier,
    verify_persistent_request,
)

ROOT = Path(__file__).resolve().parents[1]


class PersistentContractInteropTests(unittest.TestCase):
    def peer(self, value):
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        self.assertIsNotNone(node, "Node is required; this suite must not silently skip")
        result = subprocess.run(
            [node, str(ROOT / "tests/persistent_contract_peer.mjs")],
            input=json.dumps(value),
            capture_output=True,
            text=True,
            timeout=20,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.assertEqual(result.returncode, 0, result.stderr[:1500])
        return json.loads(result.stdout)

    def packet(self, kind="task"):
        f = PersistentContentFixture()
        c = f.content_context(kind)
        recipient = "recovery_enc" if kind == "result_revision" else "A1_enc"
        signer = f.keys["A1_sig"] if kind == "result_revision" else f.root
        return (
            f,
            c,
            recipient,
            {
                "mode": "content",
                "context": c,
                "identity": f.identity,
                "rootJwk": f.root_public,
                "bundle": f.bundle,
                "binding": f.identity_binding,
                "carrier": f.seal(c),
                "privatePayload": f.private_content(c),
                "recipientPrivateJwk": f.keys[recipient].export(private_key=True, as_dict=True),
                "signingPrivateJwk": signer.export(private_key=True, as_dict=True),
                "publicKeys": f.public_keys(c),
            },
        )

    def test_every_content_type_verifies_and_decrypts_in_both_independent_implementations(self):
        for kind in (
            "task",
            "holdings_snapshot",
            "watchlist_evidence",
            "channel_follows_evidence",
            "result_revision",
        ):
            with self.subTest(kind=kind):
                f, c, recipient, packet = self.packet(kind)
                carrier = self.peer(packet)["carrier"]
                verified = verify_persistent_carrier(
                    carrier,
                    registry=f.registry,
                    root_jwk=f.root_public,
                    current_identity=f.identity,
                    expectation=f.expected(c),
                    now=1000,
                )
                self.assertEqual(verified.context, c)
                self.assertEqual(
                    open_persistent_content(carrier["jwe"], f.keys[recipient], context=c),
                    f.private_content(c),
                )

    def test_original_signed_approval_revocation_and_reapproval_reconstruct_exact_policy(self):
        case = consent_fixtures.ResourceConsentStoreTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        receipts = []

        def apply(packet, *, revoke=False):
            case.apply(packet, revoke=revoke)
            receipts.append(
                case.service.receipt(UID, case.f.vault, case.identity["connectionId"], packet[1])
            )
            row = case.store.transact(
                lambda unit: unit.get(document_path("hub_vaults", case.f.owner))
            )
            return self.peer(
                {
                    "mode": "consent",
                    "consent": case.state()["consent"],
                    "receipts": receipts,
                    "identity": case.identity,
                    "anchor": {
                        "rootJwk": case.f.root_public,
                        "rootKeyId": case.f.root_id,
                        "rootEpoch": 1,
                        "ownerSubject": case.identity["ownerSubject"],
                        "vaultId": case.identity["vaultId"],
                        "registrySequence": case.f.registry.registry_sequence,
                        "checkpointDigest": case.f.registry.checkpoint_digest,
                    },
                    "history": row["registryHistory"],
                }
            )

        apply(case.command())
        apply(case.command(targets=[case.revoke_target()], author="device_sig"), revoke=True)
        apply(case.command(resources=[case.proposal(ident="permission_new")]))

    def test_node_request_proof_matches_exact_python_http_binding(self):
        f, c, _, packet = self.packet()
        path = (
            f"/agent/v3/persistent/owners/{f.owner}/vaults/{f.vault}"
            "/connections/connection_A1/session"
        )
        proof = self.peer(
            {
                **packet,
                "mode": "proof",
                "path": path,
                "request": {"synthetic": "exact_body"},
                "signingPrivateJwk": f.keys["A1_sig"].export(private_key=True, as_dict=True),
            }
        )["proof"]
        verified = verify_persistent_request(
            proof,
            registry=f.registry,
            current_identity=f.identity,
            owner_subject=f.owner,
            vault_id=f.vault,
            connection_id="connection_A1",
            client_id=f.client,
            audience="https://hub.example",
            method="POST",
            path=path,
            body={"synthetic": "exact_body"},
            now=1000,
        )
        self.assertEqual(verified["expiresAt"], 1120)
