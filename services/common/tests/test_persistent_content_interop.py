"""Public Node fixture and optional bidirectional independent JOSE verification."""

import json
import os
import subprocess
import unittest
from pathlib import Path

from test_encrypted_interop import public_test_key
from test_persistent_content import PersistentContentFixture

from folioview_shared.encrypted.authority import verify_registry
from folioview_shared.encrypted.crypto import jwk_thumbprint
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.persistent_agents import (
    initial_agent_identity,
    verify_agent_identity_binding,
)
from folioview_shared.encrypted.persistent_content import (
    PersistentEnvelopeExpectation,
    open_persistent_content,
    verify_persistent_carrier,
)

HERE = Path(__file__).resolve().parent


class PersistentContentInteropTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vector = json.loads((HERE / "fixtures/persistent_content_node.json").read_text())

    def verified(self):
        v = self.vector
        c = v["context"]
        registry = verify_registry(
            v["registryBundle"],
            root_jwk=v["rootPublicJwk"],
            pinned_root_key_id=jwk_thumbprint(v["rootPublicJwk"]),
            owner_subject=c["ownerSubject"],
            vault_id=c["vaultId"],
            now=1000,
        )
        identity = initial_agent_identity(
            verify_agent_identity_binding(
                v["identityBinding"],
                registry=registry,
                owner_subject=c["ownerSubject"],
                vault_id=c["vaultId"],
                connection_id=c["connectionId"],
                agent_id=c["agentId"],
                client_id=c["clientId"],
                now=1000,
            )
        )
        self.assertEqual(identity, v["identity"])
        bindings = {
            k: c[k]
            for k in (
                "ref",
                "sourceEpoch",
                "sourceRevision",
                "permissionId",
                "permissionEpoch",
                "ownerEnvelopeFingerprint",
            )
        }
        expectation = PersistentEnvelopeExpectation(
            c["ownerSubject"],
            c["vaultId"],
            c["connectionId"],
            c["clientId"],
            c["objectType"],
            c["objectId"],
            c["revision"],
            tuple(r["keyId"] for r in c["recipients"]),
            bindings,
        )
        return verify_persistent_carrier(
            v["carrier"],
            registry=registry,
            root_jwk=v["rootPublicJwk"],
            current_identity=identity,
            expectation=expectation,
            now=1000,
        )

    def test_public_fixture_contains_no_private_jwk_and_python_verifies_its_node_signature(self):
        def public(value):
            if isinstance(value, dict):
                self.assertNotIn("d", value)
                for item in value.values():
                    public(item)
            elif isinstance(value, list):
                for item in value:
                    public(item)

        public(self.vector)
        self.assertFalse(self.vector["generatedBy"]["privateKeysStored"])
        self.assertEqual(self.verified().context, self.vector["context"])

    def test_python_decrypts_node_jwe_with_the_publicly_known_synthetic_test_scalar(self):
        checked = self.verified()
        opened = open_persistent_content(
            checked.carrier["jwe"],
            public_test_key(self.vector["recipientTestScalar"]),
            context=checked.context,
        )
        self.assertEqual(canonical_json(opened), canonical_json(self.vector["privatePayload"]))

    @unittest.skipUnless(
        os.getenv("FOLIOVIEW_INTEROP_MODULES"),
        "Optional live Node needs fixture dependencies; static Node fixture always runs.",
    )
    def test_node_verifies_and_decrypts_python_output_for_every_content_type(self):
        f = PersistentContentFixture()
        for kind in (
            "task",
            "holdings_snapshot",
            "watchlist_evidence",
            "channel_follows_evidence",
            "result_revision",
        ):
            with self.subTest(kind=kind):
                context = f.content_context(kind)
                signer = "A1_sig" if kind == "result_revision" else "root"
                recipient = "recovery_enc" if kind == "result_revision" else "A1_enc"
                request = {
                    "carrier": f.seal(context),
                    "context": context,
                    "privatePayload": f.private_content(context),
                    "signerPublicJwk": f.root_public
                    if signer == "root"
                    else f.certificates[signer]["publicJwk"],
                    "recipientPrivateJwk": f.keys[recipient].export(private_key=True, as_dict=True),
                }
                result = subprocess.run(
                    [
                        os.getenv("FOLIOVIEW_NODE_BIN", "node"),
                        str(HERE / "interop/persistent_content.mjs"),
                        "--verify-python",
                    ],
                    input=json.dumps(request),
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                self.assertEqual(
                    result.returncode, 0, "Independent Node verification/decryption failed"
                )
                self.assertTrue(all(value is True for value in json.loads(result.stdout).values()))
