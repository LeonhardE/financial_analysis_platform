"""Closed public contracts and typed private plaintext, with synthetic values only."""

import copy
import unittest

from folioview_shared.encrypted.constants import CONTRACT_VERSION, PRIVATE_BYTE_LIMITS
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.private import validate_private_payload
from folioview_shared.encrypted.schema import load_schema, validate_schema

NOW = "2026-10-26T12:00:00Z"
KEY = "A" * 43
OTHER_KEY = "B" * 43
DIGEST = "a" * 64
BINDING_FIELDS = [
    "taskId",
    "taskVersion",
    "runId",
    "manifestId",
    "taskEnvelopeFingerprint",
    "manifestFingerprint",
    "connectionId",
    "grantId",
    "grantEpoch",
    "executionEpoch",
    "resourceRef",
    "sourceRevision",
    "sourceEpoch",
]


def resource_ref(kind="holdings"):
    return {
        "kind": kind,
        "sourceService": "portfolio" if kind == "holdings" else "user",
        "resourceId": "source_synthetic",
        "incarnation": "incarnation_1",
    }


def context_for(kind="result_revision"):
    binding = dict.fromkeys(BINDING_FIELDS)
    result = {
        "contractVersion": CONTRACT_VERSION,
        "profileId": "P1",
        "ownerSubject": "synthetic_owner",
        "vaultId": "synthetic_vault",
        "rootKeyId": KEY,
        "rootEpoch": 1,
        "registrySequence": 1,
        "checkpointDigest": DIGEST,
        "keyEpoch": 1,
        "objectId": "synthetic_object",
        "objectType": kind,
        "revision": 1,
        "deliveryRevision": 1,
        "priorEnvelopeFingerprint": None,
        "expectedRevision": 0,
        "stableOperationId": "synthetic_operation_000001",
        "operationType": "submit_result",
        "authorSigningKeyId": KEY,
        "binding": binding,
        "resourceBindings": [],
        "recipients": [
            {
                "keyId": KEY,
                "role": "device_enc",
                "principalId": "device_1",
                "connectionId": None,
                "keyEpoch": 1,
            },
            {
                "keyId": OTHER_KEY,
                "role": "recovery_enc",
                "principalId": "recovery_1",
                "connectionId": None,
                "keyEpoch": 1,
            },
        ],
    }
    if kind in {"task", "result_revision"}:
        binding.update(taskId="task_1", taskVersion=1)
    if kind == "task":
        result.update(objectId="task_1", operationType="create_task")
    elif kind == "result_revision":
        binding.update(
            runId="run_1",
            manifestId="manifest_1",
            taskEnvelopeFingerprint=DIGEST,
            manifestFingerprint=DIGEST,
            connectionId="connection_1",
            grantId="grant_1",
            grantEpoch=1,
            executionEpoch=1,
        )
    else:
        resource_kind = {
            "holdings_snapshot": "holdings",
            "watchlist_evidence": "watchlist",
            "channel_follows_evidence": "channel_follows",
        }[kind]
        binding.update(resourceRef=resource_ref(resource_kind), sourceRevision=1, sourceEpoch=1)
        result["operationType"] = (
            "commit_snapshot" if resource_kind == "holdings" else "commit_evidence"
        )
    return result


def report_content():
    return {
        "title": "Synthetic daily report",
        "summary": "Synthetic holdings only.",
        "sections": [{"sectionId": "risks", "markdown": "## Review\n\nNo real holdings."}],
        "citations": [
            {
                "citationId": "source_1",
                "title": "Synthetic source",
                "url": "https://example.com/research",
                "provenance": "agent_provided",
                "publishedAt": None,
            }
        ],
        "limitations": ["Synthetic test data."],
    }


def task_content():
    return {
        "name": "Synthetic daily brief",
        "template": "custom",
        "goal": "Review my resources.",
        "inputPolicy": {
            "allowPartial": True,
            "allowUnknownAsOf": False,
            "maxFetchedAgeSeconds": 86400,
        },
        "outputSpec": {
            "label": "Daily brief",
            "sections": [
                {
                    "sectionId": "risks",
                    "title": "Risks",
                    "instructions": "Use selected resources.",
                }
            ],
            "language": "zh",
            "verbosity": "concise",
        },
        "deliveryExpectation": {
            "cadence": "daily",
            "localTime": "08:30",
            "timeZone": "America/Toronto",
            "graceMinutes": 60,
        },
    }


def resource_content(kind="holdings", object_id="synthetic_object"):
    data = {"kind": kind, "items": []}
    if kind == "holdings":
        data = {
            "kind": kind,
            "snapshotId": object_id,
            "accounts": [
                {
                    "accountId": "account_1",
                    "displayName": "Synthetic account",
                    "balances": [
                        {
                            "currency": "CAD",
                            "cashBalance": "100.000000000001",
                            "buyingPower": None,
                        }
                    ],
                    "positions": [
                        {
                            "assetId": "asset_1",
                            "brokerAssetId": "broker_asset_1",
                            "symbol": "SYN",
                            "exchange": "SYNTHETIC",
                            "name": "Synthetic asset",
                            "assetType": "stock",
                            "quantity": "1.000000000001",
                            "currency": "CAD",
                            "marketValue": {
                                "amount": "42.000000000001",
                                "currency": "CAD",
                            },
                        }
                    ],
                }
            ],
            "excludedAssets": [],
        }
    elif kind == "watchlist":
        data["items"] = [
            {
                "symbol": "SYN",
                "name": "Synthetic asset",
                "instrumentType": "stock",
                "currency": "USD",
                "addedAt": NOW,
            }
        ]
    else:
        data["items"] = [
            {
                "followId": "follow_1",
                "name": "Synthetic analyst",
                "handleOrUrl": "@synthetic",
                "note": "User-selected context.",
                "verification": "user_provided",
                "addedAt": NOW,
            }
        ]
        data["readableMaterialCount"] = 0
    return {
        "state": "ready",
        "coverage": {"state": "complete", "issues": []},
        "sourceAsOf": None,
        "fetchedAt": NOW,
        "freshness": "unknown",
        "data": data,
    }


def wrapper(context, payload=None):
    if payload is None:
        kind = context["objectType"]
        if kind == "task":
            payload = task_content()
        elif kind == "result_revision":
            payload = report_content()
        else:
            resource_kind = {
                "holdings_snapshot": "holdings",
                "watchlist_evidence": "watchlist",
                "channel_follows_evidence": "channel_follows",
            }[kind]
            payload = resource_content(resource_kind, context["objectId"])
    return {
        "privateSchemaVersion": 2,
        "objectId": context["objectId"],
        "objectType": context["objectType"],
        "revision": context["revision"],
        "binding": copy.deepcopy(context["binding"]),
        "payload": payload,
    }


def manifest_descriptor():
    return {
        "contractVersion": CONTRACT_VERSION,
        "vaultId": "synthetic_vault",
        "manifestId": "manifest_1",
        "runId": "run_1",
        "taskId": "task_1",
        "taskVersion": 1,
        "connectionId": "connection_1",
        "grantId": "grant_1",
        "grantEpoch": 1,
        "executionEpoch": 1,
        "keyEpoch": 1,
        "beginIntentFingerprint": DIGEST,
        "signedBeginIntent": {
            "protected": "e30",
            "payload": "e30",
            "signature": "A" * 86,
        },
        "taskEnvelope": {
            "objectId": "task_1",
            "objectType": "task",
            "revision": 1,
            "deliveryRevision": 1,
            "envelopeFingerprint": DIGEST,
            "keyEpoch": 1,
        },
        "entries": [
            {
                "ref": resource_ref(),
                "revision": 1,
                "sourceEpoch": 1,
                "objectId": "snapshot_1",
                "objectType": "holdings_snapshot",
                "deliveryRevision": 1,
                "envelopeFingerprint": DIGEST,
                "keyEpoch": 1,
            }
        ],
        "createdAt": NOW,
        "expiresAt": "2026-10-26T14:00:00Z",
    }


def control_command(action="result_state_update", parameters=None):
    return {
        "artifactType": "control_command",
        "contractVersion": CONTRACT_VERSION,
        "ownerSubject": "synthetic_owner",
        "vaultId": "synthetic_vault",
        "stableOperationId": "synthetic_operation_000001",
        "action": action,
        "targetId": "result_1",
        "expectedVersion": 1,
        "expectedSourceEpoch": None,
        "registrySequence": 1,
        "checkpointDigest": DIGEST,
        "keyEpoch": 1,
        "parameters": {"read": True} if parameters is None else parameters,
    }


class PublicSchemaTests(unittest.TestCase):
    def rejected(self, name, value, code="malformed_request"):
        with self.assertRaises(ContractError) as caught:
            validate_schema(name, value)
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn("Synthetic", str(caught.exception))

    def test_stable_contract_profile_and_unknown_metadata_fail_closed(self):
        context = context_for()
        self.assertEqual(validate_schema("Context", context), context)
        for field, value in [
            ("contractVersion", "folioview.agent-workspace.v2-candidate"),
            ("contractVersion", "folioview.agent-workspace.v1"),
            ("profileId", "P2"),
            ("title", "Synthetic private title"),
            ("contentDigest", DIGEST),
            ("sourceAsOf", NOW),
            ("keyEpoch", 0),
            ("revision", True),
        ]:
            with self.subTest(field=field, value=value):
                self.rejected("Context", {**context, field: value})

    def test_operation_ids_require_128_bit_shaped_length_without_uuid_syntax(self):
        # Length is a shape bound, not proof of entropy. Callers must generate
        # random IDs; URL-safe random encodings and hex do not need UUID syntax.
        for operation_id in [
            "synthetic_operation_000001",
            "a" * 22,
            "0123456789abcdef" * 2,
        ]:
            validate_schema("OperationIdentifier", operation_id)
            validate_schema("Context", {**context_for(), "stableOperationId": operation_id})
        for operation_id in ["short", "a" * 21, "a" * 129]:
            self.rejected("OperationIdentifier", operation_id)
            self.rejected("Context", {**context_for(), "stableOperationId": operation_id})
            self.rejected(
                "ControlCommandPayload",
                {**control_command(), "stableOperationId": operation_id},
            )

    def test_explicit_nulls_and_complete_routing_binding_are_required(self):
        context = context_for("task")
        for field in [
            "priorEnvelopeFingerprint",
            "checkpointDigest",
            "expectedRevision",
        ]:
            value = copy.deepcopy(context)
            del value[field]
            self.rejected("Context", value)
        for field in ["runId", "sourceEpoch", "resourceRef"]:
            value = copy.deepcopy(context)
            del value["binding"][field]
            self.rejected("Context", value)

    def test_public_jwk_excludes_private_parameters_and_external_key_urls(self):
        public = {"kty": "EC", "crv": "P-256", "x": KEY, "y": OTHER_KEY}
        self.assertEqual(validate_schema("PublicJWK", public), public)
        for field, value in [
            ("d", KEY),
            ("jku", "https://example.com/key"),
            ("kid", KEY),
            ("crv", "P-384"),
            ("x", KEY + "="),
        ]:
            with self.subTest(field=field):
                self.rejected("PublicJWK", {**public, field: value})

    def test_service_bound_resource_references_and_connection_bound_recipients(self):
        for kind in ["holdings", "watchlist", "channel_follows"]:
            ref = resource_ref(kind)
            self.assertEqual(validate_schema("ResourceRef", ref), ref)
            self.rejected(
                "ResourceRef",
                {**ref, "sourceService": "user" if kind == "holdings" else "portfolio"},
            )
        recipient = context_for()["recipients"][0]
        self.rejected("Recipient", {**recipient, "connectionId": "connection_1"})
        self.rejected("Recipient", {**recipient, "role": "agent_enc"})
        self.assertEqual(
            validate_schema(
                "Recipient",
                {**recipient, "role": "agent_enc", "connectionId": "connection_1"},
            )["role"],
            "agent_enc",
        )

    def test_full_manifest_and_complete_components_do_not_accept_harness_shortcuts(
        self,
    ):
        manifest = manifest_descriptor()
        self.assertEqual(validate_schema("ManifestDescriptor", manifest), manifest)
        for field in [
            "signedBeginIntent",
            "beginIntentFingerprint",
            "taskEnvelope",
            "grantId",
            "executionEpoch",
        ]:
            value = copy.deepcopy(manifest)
            del value[field]
            self.rejected("ManifestDescriptor", value)
        for private_field in [
            "name",
            "sourceAsOf",
            "positions",
            "title",
            "contentDigest",
        ]:
            self.rejected("ManifestDescriptor", {**manifest, private_field: "Synthetic"})
        page = {
            "contractVersion": CONTRACT_VERSION,
            "manifest": manifest,
            "manifestFingerprint": DIGEST,
            "componentIndex": 0,
            "component": {
                "kind": "task",
                "objectId": "task_1",
                "revision": 1,
                "deliveryRevision": 1,
                "signedObject": manifest["signedBeginIntent"],
            },
            "nextCursor": None,
        }
        self.assertEqual(validate_schema("ManifestComponentPage", page), page)
        self.rejected(
            "ManifestComponentPage",
            {**page, "component": {"ciphertextChunk": "secret"}},
        )

    def test_unsigned_control_extensions_and_empty_state_update_are_rejected(self):
        value = control_command()
        self.assertEqual(validate_schema("ControlCommandPayload", value), value)
        for params in [
            {},
            {"title": "Synthetic"},
            {"read": "true"},
            {"read": True, "key": "secret"},
        ]:
            self.rejected("ControlCommandPayload", control_command(parameters=params))
        self.rejected("ControlCommandPayload", control_command(action="run_shell", parameters={}))
        revoke = control_command(action="connection_revoke", parameters={})
        validate_schema("ControlCommandPayload", revoke)
        self.rejected("ControlCommandPayload", {**revoke, "parameters": {"connectionId": "other"}})
        fence = control_command(
            action="resource_fence_request", parameters={"resourceRef": resource_ref()}
        )
        validate_schema("ControlCommandPayload", fence)

    def test_grant_does_not_accept_unbounded_history_or_unknown_version_access(self):
        base = {
            "ref": resource_ref(),
            "sourceEpoch": 1,
            "versionAccess": "selected",
            "selectedVersions": [1],
        }
        validate_schema("GrantResourceBinding", base)
        validate_schema(
            "GrantResourceBinding",
            {
                **base,
                "versionAccess": "future_within_source_epoch",
                "selectedVersions": [],
            },
        )
        for field, value in [
            ("versionAccess", "all"),
            ("selectedVersions", [0]),
            ("selectedVersions", [1, 1]),
            ("selectedVersions", list(range(1, 52))),
        ]:
            self.rejected("GrantResourceBinding", {**base, field: value})

    def test_key_certificate_timestamps_are_epoch_seconds_and_roles_are_closed(self):
        certificate = {
            "artifactType": "key_certificate",
            "contractVersion": CONTRACT_VERSION,
            "vaultId": "synthetic_vault",
            "ownerSubject": "synthetic_owner",
            "certificateId": "certificate_1",
            "keyId": KEY,
            "role": "agent_sig",
            "publicJwk": {"kty": "EC", "crv": "P-256", "x": KEY, "y": OTHER_KEY},
            "principalId": "agent_1",
            "connectionId": "connection_1",
            "keyEpoch": 1,
            "issuerKeyId": OTHER_KEY,
            "notBefore": 1793016000,
            "expiresAt": 1793102400,
            "capabilities": ["run_request", "result_write"],
        }
        validate_schema("KeyCertificatePayload", certificate)
        for field, value in [
            ("notBefore", NOW),
            ("expiresAt", 1793102400.5),
            ("role", "agent_root"),
            ("capabilities", ["sign_anything"]),
            ("connectionId", ""),
        ]:
            self.rejected("KeyCertificatePayload", {**certificate, field: value})

    def test_run_preserves_existing_lifecycle_and_keeps_period_details_private(self):
        manifest = manifest_descriptor()
        run = {
            name: manifest[name]
            for name in [
                "contractVersion",
                "vaultId",
                "runId",
                "taskId",
                "taskVersion",
                "executionEpoch",
                "connectionId",
                "grantId",
                "grantEpoch",
                "keyEpoch",
                "manifestId",
                "beginIntentFingerprint",
                "createdAt",
                "expiresAt",
            ]
        }
        run.update(authorizationId="authorization_1", state="ready", initialResultId="result_1")
        for state in [
            "preparing",
            "ready",
            "submitted",
            "failed",
            "invalidated",
            "expired",
        ]:
            validate_schema("RunDescriptor", {**run, "state": state})
        for field, value in [
            ("state", "completed"),
            ("periodDate", "2026-10-26"),
            ("periodKey", "daily_1"),
        ]:
            self.rejected("RunDescriptor", {**run, field: value})

    def test_saved_receipt_is_metadata_only_and_paths_cannot_carry_keys(self):
        value = {
            "contractVersion": CONTRACT_VERSION,
            "vaultId": "synthetic_vault",
            "runId": "run_1",
            "taskId": "task_1",
            "resultId": "result_1",
            "revision": 1,
            "deliveryRevision": 1,
            "stableOperationId": "synthetic_operation_000002",
            "envelopeFingerprint": DIGEST,
            "receivedAt": NOW,
            "resultPath": "/results/result_1?revision=1",
        }
        validate_schema("ResultReceipt", value)
        for path in [
            "https://example.com/result",
            "/results/result_1?revision=1#key=secret",
            "/results/../result_1?revision=1",
            "/results/result_1?revision=0",
        ]:
            self.rejected("ResultReceipt", {**value, "resultPath": path})
        self.rejected("ResultReceipt", {**value, "summary": "Synthetic private summary"})

    def test_validation_is_not_cryptographic_authentication(self):
        # Shape acceptance does not verify the algorithm, signature or curve point.
        # Those are independently enforced in crypto/envelope, never in schema.py.
        value = {"protected": "e30", "payload": "e30", "signature": "A" * 86}
        validate_schema("SignedObject", value)
        self.rejected("SignedObject", {**value, "jwk": {"d": "secret"}})

    def test_mutating_loaded_schema_or_checked_value_cannot_change_later_validation(
        self,
    ):
        schema = load_schema("Context")
        schema["$defs"]["Context"]["properties"]["contractVersion"] = {}
        self.rejected("Context", {**context_for(), "contractVersion": "anything"})
        value = context_for()
        checked = validate_schema("Context", value)
        checked["binding"]["taskId"] = "modified"
        self.assertEqual(value["binding"]["taskId"], "task_1")
        self.rejected("Synthetic private schema name", {"secret": "Synthetic"})

    def test_canonical_json_safety_precedes_shape_validation(self):
        for value in [float("nan"), float("inf"), 9007199254740992, "\ud800"]:
            self.rejected("PrivatePayload", value)


class PrivatePayloadTests(unittest.TestCase):
    def rejected(self, value, context):
        with self.assertRaises(ContractError) as caught:
            validate_private_payload(value, context=context)
        self.assertEqual(caught.exception.code, "private_schema_invalid")
        self.assertNotIn("Synthetic", str(caught.exception))

    def test_each_private_object_type_uses_its_real_content_schema(self):
        for kind in [
            "task",
            "holdings_snapshot",
            "watchlist_evidence",
            "channel_follows_evidence",
            "result_revision",
        ]:
            with self.subTest(kind=kind):
                context = context_for(kind)
                value = wrapper(context)
                self.assertEqual(validate_private_payload(value, context=context), value)
                self.rejected({**value, "payload": {"syntheticOnly": True}}, context)
                self.rejected({**value, "privateSchemaVersion": 1}, context)
                self.rejected({**value, "plaintextDigest": DIGEST}, context)

    def test_plaintext_wrapper_cannot_be_rebound_to_a_different_object_or_run(self):
        context = context_for()
        value = wrapper(context)
        for field, replacement in [
            ("objectId", "other"),
            ("revision", 2),
            ("objectType", "task"),
        ]:
            self.rejected({**value, field: replacement}, context)
        for field, replacement in [
            ("taskId", "other"),
            ("connectionId", "other"),
            ("runId", "other"),
            ("grantId", "other"),
            ("grantEpoch", 2),
            ("manifestFingerprint", "b" * 64),
        ]:
            modified = copy.deepcopy(value)
            modified["binding"][field] = replacement
            self.rejected(modified, context)

    def test_task_sections_are_unique_and_brief_requires_selected_resources(self):
        context = context_for("task")
        value = wrapper(context)
        value["payload"]["outputSpec"]["sections"] *= 2
        self.rejected(value, context)
        value = wrapper(context)
        value["payload"]["template"] = "brief"
        self.rejected(value, context)
        context["resourceBindings"] = [{"ref": resource_ref(), "sourceEpoch": 1}]
        validate_private_payload(value, context=context)

    def test_delivery_expectation_is_a_valid_local_time_and_iana_zone(self):
        context = context_for("task")
        value = wrapper(context)
        for field, replacement in [
            ("localTime", "24:00"),
            ("timeZone", "Mars/Olympus"),
            ("cadence", "hourly"),
        ]:
            modified = copy.deepcopy(value)
            modified["payload"]["deliveryExpectation"][field] = replacement
            self.rejected(modified, context)
        value["payload"]["deliveryExpectation"]["cadence"] = "weekly"
        self.rejected(value, context)
        value["payload"]["deliveryExpectation"]["weekday"] = 0
        validate_private_payload(value, context=context)
        value["payload"]["deliveryExpectation"]["cadence"] = "daily"
        self.rejected(value, context)

    def test_source_type_and_snapshot_identity_must_match_signed_routing(self):
        context = context_for("holdings_snapshot")
        value = wrapper(context)
        value["payload"]["data"]["snapshotId"] = "different_snapshot"
        self.rejected(value, context)
        value = wrapper(context, resource_content("watchlist"))
        self.rejected(value, context)

    def test_money_and_quantity_are_precise_bounded_decimal_strings(self):
        context = context_for("holdings_snapshot")
        for field, replacements in [
            ("quantity", [1.25, "1e3", "-1", "01", "1.1234567890123"]),
            ("amount", [42.0, "NaN", "1e6", "01.00", "1.1234567890123"]),
        ]:
            for replacement in replacements:
                with self.subTest(field=field, value=replacement):
                    value = wrapper(context)
                    position = value["payload"]["data"]["accounts"][0]["positions"][0]
                    if field == "amount":
                        position["marketValue"][field] = replacement
                    else:
                        position[field] = replacement
                    self.rejected(value, context)
        value = wrapper(context)
        value["payload"]["data"]["accounts"][0]["positions"][0]["marketValue"]["currency"] = "USD"
        self.rejected(value, context)

    def test_holdings_reject_ambiguous_duplicate_accounts_assets_or_cash_currencies(
        self,
    ):
        context = context_for("holdings_snapshot")
        for location in ["accounts", "positions", "balances"]:
            value = wrapper(context)
            data = value["payload"]["data"]
            values = data["accounts"] if location == "accounts" else data["accounts"][0][location]
            values.append(copy.deepcopy(values[0]))
            self.rejected(value, context)

    def test_holdings_position_limit_is_shared_across_accounts(self):
        context = context_for("holdings_snapshot")
        value = wrapper(context)
        account = value["payload"]["data"]["accounts"][0]
        position = account["positions"][0]
        account["positions"] = [{**position, "assetId": f"asset_{i}"} for i in range(501)]
        value["payload"]["data"]["accounts"].append(
            {**copy.deepcopy(account), "accountId": "account_2"}
        )
        # Each account is individually under 1,000; compact the synthetic value
        # enough that the aggregate count, rather than the byte ceiling, rejects it.
        for row in value["payload"]["data"]["accounts"]:
            for item in row["positions"]:
                item.update(
                    brokerAssetId="s",
                    symbol=None,
                    exchange=None,
                    name="s",
                    quantity="1",
                    marketValue=None,
                )
        self.assertLess(len(canonical_json(value)), PRIVATE_BYTE_LIMITS["holdings_snapshot"])
        self.rejected(value, context)

    def test_watchlist_and_follows_preserve_unique_ids_and_do_not_claim_video_material(
        self,
    ):
        for kind in ["watchlist_evidence", "channel_follows_evidence"]:
            context = context_for(kind)
            value = wrapper(context)
            value["payload"]["data"]["items"] *= 2
            self.rejected(value, context)
        context = context_for("channel_follows_evidence")
        value = wrapper(context)
        value["payload"]["data"]["readableMaterialCount"] = 1
        self.rejected(value, context)
        for url in [
            "javascript:alert(1)",
            "http://example.com/channel",
            "https://u:p@example.com/channel",
            "@",
            "@invalid handle",
        ]:
            value = wrapper(context)
            value["payload"]["data"]["items"][0]["handleOrUrl"] = url
            self.rejected(value, context)

    def test_private_timestamps_are_valid_utc_not_merely_strings_ending_in_z(self):
        context = context_for("watchlist_evidence")
        for timestamp in [
            "2026-02-30T12:00:00Z",
            "2026-10-26T12:00:00+00:00",
            "yesterdayZ",
        ]:
            value = wrapper(context)
            value["payload"]["fetchedAt"] = timestamp
            self.rejected(value, context)

    def test_result_rejects_raw_html_unsafe_links_attachments_and_duplicate_section_ids(
        self,
    ):
        context = context_for()
        for markdown in [
            "<script>alert(1)</script>",
            "&lt;img src=x onerror=alert(1)&gt;",
            "[link](javascript:alert(1))",
            "[link](data:text/html,secret)",
            "[link](https://name:password@example.com)",
            "![remote](https://example.com/img)",
            "[link][x]\n\n[x]: file:///private/key",
        ]:
            value = wrapper(context)
            value["payload"]["sections"][0]["markdown"] = markdown
            self.rejected(value, context)
        for key in ["sections", "citations"]:
            value = wrapper(context)
            value["payload"][key] *= 2
            self.rejected(value, context)

    def test_safe_markdown_and_plain_financial_comparisons_remain_usable(self):
        context = context_for()
        value = wrapper(context)
        value["payload"]["sections"][0]["markdown"] = (
            "## 合成数据\n\n* Exposure <5% and drawdown >2%.\n"
            "* [Read the source](https://example.com/research?q=one#section)\n"
            "* <https://example.com/research>"
        )
        validate_private_payload(value, context=context)

    def test_result_citation_credentials_schemes_and_unknown_provenance_are_rejected(
        self,
    ):
        context = context_for()
        for url in [
            "http://example.com",
            "https://user:password@example.com",
            "https://example.com\\@evil.test",
            "https://example.com/with space",
            "https://example.com:8443/report",
        ]:
            value = wrapper(context)
            value["payload"]["citations"][0]["url"] = url
            self.rejected(value, context)
        value = wrapper(context)
        value["payload"]["citations"][0]["provenance"] = "platform_verified"
        self.rejected(value, context)

    def test_private_limit_counts_canonical_utf8_bytes_not_characters(self):
        context = context_for()
        value = wrapper(context)
        value["payload"]["sections"] = [
            {"sectionId": f"section_{i}", "markdown": "合" * 6000} for i in range(4)
        ]
        self.assertLess(sum(len(row["markdown"]) for row in value["payload"]["sections"]), 65536)
        self.assertGreater(len(canonical_json(value)), PRIVATE_BYTE_LIMITS["result_revision"])
        self.rejected(value, context)

    def test_returned_private_value_is_detached_from_input(self):
        context = context_for()
        value = wrapper(context)
        checked = validate_private_payload(value, context=context)
        checked["payload"]["sections"][0]["markdown"] = "Modified."
        self.assertEqual(
            value["payload"]["sections"][0]["markdown"],
            "## Review\n\nNo real holdings.",
        )


if __name__ == "__main__":
    unittest.main()
