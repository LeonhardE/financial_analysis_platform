"""Independent persistent content uses real synthetic JOSE, never real account keys."""

import copy
import unittest
from dataclasses import replace

from test_encrypted_envelope import EnvelopeFixture
from test_encrypted_schema import wrapper

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import verify_jws
from folioview_shared.encrypted.envelope import parse_carrier
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)
from folioview_shared.encrypted.persistent_agents import (
    PERSISTENT_AGENT_PROFILE,
    initial_agent_identity,
    verify_agent_identity_binding,
)
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    CONTENT_PROFILE,
    PersistentEnvelopeExpectation,
    digest,
    inspect_persistent_carrier,
    load_content_schema,
    open_persistent_content,
    persistent_manifest_fingerprint,
    persistent_run_id,
    seal_persistent_content,
    validate_content_context,
    validate_persistent_manifest,
    verify_persistent_carrier,
    verify_persistent_request,
)
from folioview_shared.encrypted.schema import validate_schema


class PersistentContentFixture(EnvelopeFixture):
    def __init__(self, recipient_private_jwk=None):
        super().__init__()
        if recipient_private_jwk is not None:
            from jwcrypto import jwk

            self.keys["A1_enc"] = jwk.JWK(**recipient_private_jwk)
            public = self.public(self.keys["A1_enc"])
            from folioview_shared.encrypted.crypto import jwk_thumbprint

            self.certificates["A1_enc"].update(publicJwk=public, keyId=jwk_thumbprint(public))
            self.bundle = self.make_bundle()
            self.registry = self.verify(self.bundle)
        self.client = "muse_synthetic"
        payload = {
            **self.base("persistent_agent_binding"),
            "profile": PERSISTENT_AGENT_PROFILE,
            "rootKeyId": self.root_id,
            "connectionId": "connection_A1",
            "agentId": "A1",
            "clientId": self.client,
            "identityEpoch": 1,
            "agentSigningKeyId": self.kid("A1_sig"),
            "agentEncryptionKeyId": self.kid("A1_enc"),
            "deviceSigningKeyId": self.kid("device_sig"),
            "stableOperationId": "synthetic_identity_content_01",
            "registrySequence": 1,
            "checkpointDigest": self.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": 950,
        }
        self.identity_binding = self.sign(payload)
        self.identity = initial_agent_identity(
            verify_agent_identity_binding(
                self.sign(payload),
                registry=self.registry,
                owner_subject=self.owner,
                vault_id=self.vault,
                connection_id="connection_A1",
                agent_id="A1",
                client_id=self.client,
                now=1000,
            )
        )

    def content_context(self, kind="task"):
        old = self.context(kind)
        result = {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            **{k: self.identity[k] for k in BINDING_FIELDS},
            "registrySequence": 1,
            "checkpointDigest": self.registry.checkpoint_digest,
            "keyEpoch": 1,
            "stableOperationId": "synthetic_content_publication_01",
            "issuedAt": 1000,
            "objectId": old["objectId"],
            "objectType": kind,
            "revision": 1,
            "expectedRevision": 0,
            "recipients": sorted(
                [
                    {"keyId": self.kid("A1_enc"), "role": "agent_enc"},
                    {"keyId": self.kid("recovery_enc"), "role": "recovery_enc"},
                ],
                key=lambda row: row["keyId"],
            ),
        }
        authority = {
            "taskId": "task_A1",
            "taskVersion": 1,
            "executionEpoch": 1,
            "authorityId": "task_authority_A",
            "authorityVersion": 1,
        }
        if kind == "task":
            result.update(
                **authority,
                purpose="execute_task",
                resultPolicy="owner_inbox",
                expectedAuthorityVersion=0,
                expectedAuthorityDigest=None,
                ownerTaskFingerprint="1" * 64,
                resourceBindings=[{"ref": self.resource, "sourceEpoch": 1}],
            )
        elif kind == "result_revision":
            result.update(
                **authority,
                purpose="save_report",
                runId="run_A",
                manifestFingerprint="2" * 64,
                recipients=sorted(
                    [
                        {"keyId": self.kid(name), "role": name}
                        for name in ("device_enc", "recovery_enc")
                    ],
                    key=lambda r: r["keyId"],
                ),
            )
        else:
            ref = copy.deepcopy(self.resource)
            ref["kind"] = {
                "holdings_snapshot": "holdings",
                "watchlist_evidence": "watchlist",
                "channel_follows_evidence": "channel_follows",
            }[kind]
            ref["sourceService"] = "portfolio" if kind == "holdings_snapshot" else "user"
            result.update(
                purpose="analysis",
                ref=ref,
                sourceEpoch=1,
                sourceRevision=1,
                permissionId="permission_A",
                permissionEpoch=1,
                ownerEnvelopeFingerprint="3" * 64,
            )
        return result

    def private_content(self, context):
        old = self.context(context["objectType"])
        return {
            "privateSchemaVersion": 1,
            "profile": CONTENT_PROFILE,
            **{k: context[k] for k in ("objectId", "objectType", "revision")},
            "payload": wrapper(old)["payload"],
        }

    def public_keys(self, context):
        return {
            row["keyId"]: next(
                c["publicJwk"] for c in self.certificates.values() if c["keyId"] == row["keyId"]
            )
            for row in context["recipients"]
        }

    def seal(self, context, value=None, signer=None):
        signer = signer or ("A1_sig" if context["objectType"] == "result_revision" else "root")
        return seal_persistent_content(
            value or self.private_content(context),
            self.public_keys(context),
            context=context,
            signing_private_key=self.root if signer == "root" else self.keys[signer],
        )

    def expected(self, context):
        common = set(BINDING_FIELDS) | {
            "contractVersion",
            "profile",
            "registrySequence",
            "checkpointDigest",
            "keyEpoch",
            "stableOperationId",
            "issuedAt",
            "objectId",
            "objectType",
            "purpose",
            "revision",
            "expectedRevision",
            "recipients",
        }
        return PersistentEnvelopeExpectation(
            self.owner,
            self.vault,
            "connection_A1",
            self.client,
            context["objectType"],
            context["objectId"],
            context["revision"],
            tuple(r["keyId"] for r in context["recipients"]),
            {k: copy.deepcopy(v) for k, v in context.items() if k not in common},
        )

    def verify_content(self, carrier, context, **changes):
        values = {
            "registry": self.registry,
            "root_jwk": self.root_public,
            "current_identity": self.identity,
            "expectation": self.expected(context),
            "now": 1000,
        }
        return verify_persistent_carrier(carrier, **(values | changes))


class PersistentContentTests(unittest.TestCase):
    def setUp(self):
        self.f = PersistentContentFixture()
        self.context = self.f.content_context()
        self.carrier = self.f.seal(self.context)

    def test_all_content_types_use_independent_authenticated_encryption(self):
        for kind in (
            "task",
            "holdings_snapshot",
            "watchlist_evidence",
            "channel_follows_evidence",
            "result_revision",
        ):
            with self.subTest(kind=kind):
                context = self.f.content_context(kind)
                sealed = self.f.seal(context)
                checked = self.f.verify_content(sealed, context)
                recipient = "recovery_enc" if kind == "result_revision" else "A1_enc"
                self.assertEqual(
                    open_persistent_content(
                        checked.carrier["jwe"], self.f.keys[recipient], context=checked.context
                    ),
                    self.f.private_content(context),
                )
                header = strict_json_loads(b64url_decode(sealed["jwe"]["protected"]))
                self.assertEqual(header["typ"], "fv-persistent-private+jwe")
                self.assertLess(len(canonical_json(sealed["proof"])), 16384)

    def test_large_resource_ciphertext_does_not_expand_the_signed_control_budget(self):
        context = self.f.content_context("holdings_snapshot")
        value = self.f.private_content(context)
        account = value["payload"]["data"]["accounts"][0]
        sample = copy.deepcopy(account["positions"][0])
        account["positions"] = [{**sample, "assetId": f"synthetic_asset_{i}"} for i in range(420)]
        self.assertGreater(len(canonical_json(value)), 65536)
        carrier = self.f.seal(context, value)
        self.assertGreater(len(canonical_json(carrier)), 65536)
        self.assertLess(len(canonical_json(carrier["proof"])), 16384)
        checked = self.f.verify_content(carrier, context)
        self.assertEqual(
            open_persistent_content(
                checked.carrier["jwe"], self.f.keys["recovery_enc"], context=context
            ),
            value,
        )

    def test_publisher_expectation_must_include_current_task_authority_and_output_policy(self):
        expected = self.f.expected(self.context)
        for field in ("authorityId", "authorityVersion", "expectedAuthorityDigest", "resultPolicy"):
            bindings = dict(expected.bindings)
            del bindings[field]
            with self.assertRaises(ContractError):
                self.f.verify_content(
                    self.carrier, self.context, expectation=replace(expected, bindings=bindings)
                )
        readonly = {**self.context, "resultPolicy": "none"}
        sealed = self.f.seal(readonly)
        self.assertEqual(self.f.verify_content(sealed, readonly).context["resultPolicy"], "none")
        with self.assertRaises(ContractError):
            self.f.verify_content(sealed, self.context)

    def test_resource_producer_kind_mismatch_and_extra_agent_recipient_are_rejected(self):
        context = self.f.content_context("holdings_snapshot")
        bad = {**context, "ref": {**context["ref"], "sourceService": "user"}}
        with self.assertRaises(ContractError):
            self.f.seal(bad)
        bad = copy.deepcopy(context)
        bad["recipients"].append({"keyId": self.f.kid("A2_enc"), "role": "agent_enc"})
        bad["recipients"].sort(key=lambda row: row["keyId"])
        with self.assertRaises(ContractError):
            self.f.seal(bad)

    def test_structural_inspection_is_detached_and_does_not_claim_signature_authority(self):
        value = copy.deepcopy(self.carrier)
        value["proof"]["signature"] = "A" * 86
        carrier, context = inspect_persistent_carrier(value)
        self.assertEqual(context, self.context)
        carrier["jwe"]["ciphertext"] = "A"
        self.assertNotEqual(carrier["jwe"]["ciphertext"], value["jwe"]["ciphertext"])
        with self.assertRaises(ContractError):
            self.f.verify_content(value, self.context)

    def test_task_and_resource_publications_require_root_not_device_or_agent(self):
        for kind in ("task", "holdings_snapshot"):
            for signer in ("device_sig", "A1_sig"):
                with self.assertRaises(ContractError):
                    self.f.seal(self.f.content_context(kind), signer=signer)

    def test_result_requires_current_agent_writer_and_owner_recovery_recipient(self):
        context = self.f.content_context("result_revision")
        with self.assertRaises(ContractError):
            self.f.seal(context, signer="root")
        bad = {**context, "recipients": [{"keyId": self.f.kid("A1_enc"), "role": "agent_enc"}]}
        with self.assertRaises(ContractError):
            validate_content_context(bad)

    def test_ciphertext_or_metadata_changes_cannot_reuse_an_old_proof(self):
        for mutate in (
            lambda v: v["jwe"].update(tag="A" * 22),
            lambda v: v["jwe"].update(ciphertext="A" * 40),
        ):
            value = copy.deepcopy(self.carrier)
            mutate(value)
            with self.assertRaises(ContractError):
                self.f.verify_content(value, self.context)
        value = copy.deepcopy(self.carrier)
        payload = verify_jws(value["proof"], self.f.root_public, typ="fv-control+jws")
        payload["context"]["authorityVersion"] = 2
        value["proof"]["payload"] = b64url_encode(canonical_json(payload))
        with self.assertRaises(ContractError):
            self.f.verify_content(value, self.context)

    def test_independent_owner_vault_client_object_and_binding_expectations_are_mandatory(self):
        expected = self.f.expected(self.context)
        for changes in (
            {"owner_subject": "other_owner"},
            {"vault_id": "other_vault"},
            {"client_id": "other_client"},
            {"object_id": "other_task"},
            {"revision": 2},
            {"bindings": {**expected.bindings, "authorityVersion": 2}},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.f.verify_content(
                    self.carrier, self.context, expectation=replace(expected, **changes)
                )

    def test_expectation_snapshot_and_verification_output_do_not_alias_input(self):
        expected = self.f.expected(self.context)
        checked = self.f.verify_content(self.carrier, self.context, expectation=expected)
        expected.bindings["resourceBindings"].clear()
        self.f.verify_content(self.carrier, self.context, expectation=expected)
        copy_out = checked.context
        copy_out["resourceBindings"].clear()
        self.assertTrue(checked.context["resourceBindings"])
        self.assertTrue(self.context["resourceBindings"])

    def test_context_bindings_cannot_override_trusted_owner_fields(self):
        bad = replace(self.f.expected(self.context), bindings={"ownerSubject": self.f.owner})
        with self.assertRaises(ContractError):
            self.f.verify_content(self.carrier, self.context, expectation=bad)

    def test_current_key_revocation_blocks_agent_read_but_owner_history_uses_issuance_snapshot(
        self,
    ):
        old = self.f.registry
        new = self.f.make_bundle(previous=old, revoked=("A1_sig", "A1_enc"), issued_at=1100)
        from folioview_shared.encrypted.authority import verify_registry

        current = verify_registry(
            new,
            root_jwk=self.f.root_public,
            pinned_root_key_id=self.f.root_id,
            owner_subject=self.f.owner,
            vault_id=self.f.vault,
            now=1100,
            previous=old,
        )
        with self.assertRaises(ContractError):
            self.f.verify_content(
                self.carrier, self.context, registry=current, now=1100, purpose="agent_read"
            )
        self.f.verify_content(
            self.carrier, self.context, registry=old, now=2000, purpose="owner_history"
        )
        with self.assertRaises(ContractError):
            self.f.verify_content(self.carrier, self.context, registry=old, now=2000)

    def test_valid_envelopes_are_rejected_by_legacy_p1_schema_and_parser(self):
        with self.assertRaises(ContractError):
            parse_carrier(self.carrier, contract_header=CONTRACT_VERSION)
        with self.assertRaises(ContractError):
            validate_schema("Context", self.context)
        with self.assertRaises(ContractError):
            validate_schema("PersistentContentCarrier", self.carrier)
        self.assertIn(
            "PersistentContentCarrier", load_content_schema("PersistentContentCarrier")["$defs"]
        )

    def test_private_validation_rejects_unsafe_markdown_and_wrong_resource_snapshot(self):
        context = self.f.content_context("result_revision")
        value = self.f.private_content(context)
        value["payload"]["sections"][0]["markdown"] = "<script>synthetic</script>"
        with self.assertRaises(ContractError):
            self.f.seal(context, value)
        context = self.f.content_context("holdings_snapshot")
        value = self.f.private_content(context)
        value["payload"]["data"]["snapshotId"] = "other_snapshot"
        with self.assertRaises(ContractError):
            self.f.seal(context, value)

    def test_wrong_private_key_and_recipient_aad_substitution_fail_closed(self):
        checked = self.f.verify_content(self.carrier, self.context)
        with self.assertRaises(ContractError):
            open_persistent_content(
                checked.carrier["jwe"], self.f.keys["A2_enc"], context=checked.context
            )
        bad = copy.deepcopy(checked.context)
        bad["objectId"] = "other_task"
        bad["taskId"] = "other_task"
        with self.assertRaises(ContractError):
            open_persistent_content(checked.carrier["jwe"], self.f.keys["A1_enc"], context=bad)

    def test_nonce_freshness_is_not_a_claim_of_resource_authority_or_once_only_storage(self):
        context = self.f.content_context()
        request = {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "artifactType": "persistent_agent_request",
            "purpose": "authenticated_request",
            **{k: context[k] for k in BINDING_FIELDS},
            "audience": "https://hub.example/agent/v3/persistent",
            "method": "POST",
            "path": "/agent/v3/persistent/runs",
            "bodyDigest": digest({"synthetic": True}),
            "requestId": "synthetic_request_operation_01",
            "nonce": "A" * 43,
            "issuedAt": 1000,
            "expiresAt": 1120,
        }
        signed = self.f.sign(request, "A1_sig")
        values = {
            "registry": self.f.registry,
            "current_identity": self.f.identity,
            "owner_subject": self.f.owner,
            "vault_id": self.f.vault,
            "connection_id": "connection_A1",
            "client_id": self.f.client,
            "audience": request["audience"],
            "method": "POST",
            "path": request["path"],
            "body": {"synthetic": True},
            "now": 1000,
        }
        self.assertEqual(verify_persistent_request(signed, **values), request)
        for changes in (
            {"body": {}},
            {"method": "GET"},
            {"path": "/agent/v3/persistent/other"},
            {"now": 1120},
            {"audience": "https://other.example/agent/v3/persistent"},
        ):
            with self.assertRaises(ContractError):
                verify_persistent_request(signed, **(values | changes))
        with self.assertRaises(ContractError):
            verify_persistent_request(self.f.sign(request, "device_sig"), **values)

    def test_manifest_freezes_exact_ordered_inputs_and_stable_trigger_run_identity(self):
        context = self.f.content_context()
        value = {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "purpose": "analysis",
            "resultPolicy": context["resultPolicy"],
            **{k: context[k] for k in BINDING_FIELDS},
            **{
                k: context[k]
                for k in (
                    "taskId",
                    "taskVersion",
                    "executionEpoch",
                    "authorityId",
                    "authorityVersion",
                )
            },
            "stableOperationId": "synthetic_run_operation_001",
            "triggerId": "synthetic_daily_slot_000001",
            "taskPublicationId": context["stableOperationId"],
            "taskPublicationFingerprint": "4" * 64,
            "createdAt": 1000,
            "expiresAt": 8200,
            "inputs": [
                {
                    "ref": self.f.resource,
                    "sourceRevision": 1,
                    "sourceEpoch": 1,
                    "permissionId": "permission_A",
                    "permissionEpoch": 1,
                    "publicationId": "synthetic_resource_publication_01",
                    "publicationFingerprint": "5" * 64,
                    "objectId": "snapshot_A",
                }
            ],
        }
        value["runId"] = persistent_run_id(
            owner_subject=self.f.owner,
            vault_id=self.f.vault,
            task_id=context["taskId"],
            trigger_id=value["triggerId"],
        )
        self.assertEqual(validate_persistent_manifest(value), value)
        original = persistent_manifest_fingerprint(value)
        bad = copy.deepcopy(value)
        bad["inputs"][0]["sourceRevision"] = 2
        self.assertNotEqual(persistent_manifest_fingerprint(bad), original)
        for change in (
            {"runId": "other_run"},
            {"expiresAt": 8201},
            {"inputs": value["inputs"] * 2},
        ):
            with self.assertRaises(ContractError):
                validate_persistent_manifest(value | change)
