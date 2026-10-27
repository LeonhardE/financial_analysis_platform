"""Untrusted wire boundaries and byte budgets; optional SDK encoding needs no cloud."""

import copy
import hashlib
import unittest
from unittest.mock import patch

from test_encrypted_envelope import EnvelopeFixture
from test_encrypted_schema import manifest_descriptor, wrapper

try:
    from google.cloud.firestore_v1 import _helpers as firestore_helpers
    from google.cloud.firestore_v1.types import Document
except ImportError:
    firestore_helpers = None
    Document = None

from folioview_shared.encrypted.budgets import (
    check_carrier_budget,
    check_document_budget,
    check_manifest_budget,
    check_read_response,
    check_size,
    check_write_body,
    read_bounded,
    require_contract,
    require_metadata_query,
)
from folioview_shared.encrypted.constants import (
    CONTRACT_VERSION,
    MAX_CARRIER_BYTES,
    MAX_HTTP_WRITE_BYTES,
    MAX_JSON_DEPTH,
    MAX_MANIFEST_BYTES,
    MAX_READ_BYTES,
    MAX_SAFE_INTEGER,
    MAX_STORED_DOCUMENT_BYTES,
    PRIVATE_BYTE_LIMITS,
)
from folioview_shared.encrypted.crypto import (
    decrypt_jwe,
    encrypt_jwe,
    sign_jws,
    signing_input_fingerprint,
    verify_jws,
)
from folioview_shared.encrypted.errors import CLIENT_ERRORS, ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    new_operation_id,
    strict_json_loads,
)
from folioview_shared.encrypted.private import validate_private_payload
from folioview_shared.encrypted.schema import validate_schema


def sized_document(size):
    """Include JSON field/quote overhead in an exactly sized ASCII fixture."""
    overhead = len(canonical_json({"payload": ""}))
    return {"payload": "a" * (size - overhead)}


class ContractBoundaryTestCase(unittest.TestCase):
    def rejects(self, code, function, *args, **kwargs):
        with self.assertRaises(ContractError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn("SyntheticSecret", str(caught.exception))
        return caught.exception


class StrictWireTests(ContractBoundaryTestCase):
    def test_duplicate_decoded_member_names_fail_even_inside_nested_objects(self):
        for raw in [
            b'{"a":1,"a":2}',
            b'{"outer":[{"SyntheticSecret":"one","SyntheticSecret":"two"}]}',
            b'{"a":1,"\\u0061":2}',
        ]:
            with self.subTest(raw=raw):
                self.rejects("malformed_request", strict_json_loads, raw)
        # Equal names in distinct objects are ordinary JSON, not duplicate members.
        self.assertEqual(strict_json_loads(b'[{"a":1},{"a":2}]'), [{"a": 1}, {"a": 2}])

    def test_utf8_validation_rejects_bad_sequences_and_surrogates_in_keys_or_values(
        self,
    ):
        for raw in [
            b'"\xff"',
            b'"\xe4\xb8"',
            b'"\\ud800"',
            b'{"\\udfff":"SyntheticSecret"}',
            '"\ud800"',
            b'\xef\xbb\xbf{"a":1}',
        ]:
            self.rejects("malformed_request", strict_json_loads, raw)
        value = {"title": "合成数据 😀", "decomposed": "e\u0301"}
        self.assertEqual(strict_json_loads(canonical_json(value)), value)
        for value in [{"key": "\ud800"}, {"\udfff": "value"}]:
            self.rejects("malformed_request", canonical_json, value)

    def test_depth_limit_handles_nested_containers_without_counting_quoted_brackets(
        self,
    ):
        allowed = "[" * MAX_JSON_DEPTH + '"SyntheticSecret"' + "]" * MAX_JSON_DEPTH
        self.assertEqual(canonical_json(strict_json_loads(allowed)), allowed.encode())
        too_deep = "[" + allowed + "]"
        self.rejects("malformed_request", strict_json_loads, too_deep)
        value = "SyntheticSecret"
        for _ in range(MAX_JSON_DEPTH + 1):
            value = [value]
        self.rejects("malformed_request", canonical_json, value)
        quoted = {"text": '[{]} " escaped \\ bracket ' * 100}
        self.assertEqual(strict_json_loads(canonical_json(quoted)), quoted)

    def test_unsafe_numbers_and_non_json_python_values_never_reach_canonical_bytes(
        self,
    ):
        for raw in [
            b"NaN",
            b"Infinity",
            b"-Infinity",
            b"1e9999",
            b"9007199254740992",
            b"-9007199254740992",
            b'{"SyntheticSecret":9007199254740992.0}',
            b"99999999999999999999999999999999999999999999999999",
        ]:
            self.rejects("malformed_request", strict_json_loads, raw)
        for value in [
            float("nan"),
            float("inf"),
            float("-inf"),
            MAX_SAFE_INTEGER + 1,
            -MAX_SAFE_INTEGER - 1,
            {1: "SyntheticSecret"},
            {"x": (1, 2)},
            b"SyntheticSecret",
        ]:
            self.rejects("malformed_request", canonical_json, value)
        self.assertEqual(strict_json_loads(str(MAX_SAFE_INTEGER)), MAX_SAFE_INTEGER)
        self.assertEqual(strict_json_loads(str(-MAX_SAFE_INTEGER)), -MAX_SAFE_INTEGER)
        self.assertEqual(
            canonical_json({"fraction": 1.25, "negativeZero": -0.0}),
            b'{"fraction":1.25,"negativeZero":0}',
        )

    def test_jcs_uses_utf16_property_order_and_preserves_unicode_instead_of_normalizing(
        self,
    ):
        # UTF-16 compares the astral character's surrogate before U+E000. Python's
        # ordinary Unicode sort orders these keys differently.
        value = {"\ue000": 3, "😀": 2, "a": "e\u0301"}
        self.assertEqual(canonical_json(value), '{"a":"é","😀":2,"\ue000":3}'.encode())
        self.assertNotEqual(canonical_json({"x": "e\u0301"}), canonical_json({"x": "é"}))
        self.assertEqual(canonical_json({"z": 1e-7, "a": 1.0}), b'{"a":1,"z":1e-7}')

    def test_raw_http_budget_precedes_parsing_and_counts_whitespace_and_utf8(self):
        self.assertEqual(strict_json_loads(b"  {} \n", max_bytes=6), {})
        self.rejects("payload_too_large", strict_json_loads, b"  {} \n", max_bytes=5)
        self.assertEqual(strict_json_loads('"合"', max_bytes=5), "合")
        self.rejects("payload_too_large", strict_json_loads, '"合"', max_bytes=4)
        # Invalid JSON must still be bounded before the parser looks at it.
        self.rejects("payload_too_large", strict_json_loads, b"{" * 100, max_bytes=10)
        self.rejects("malformed_request", strict_json_loads, bytearray(b"{}"))

    def test_base64url_requires_canonical_unpadded_encoding_and_valid_pad_bits(self):
        self.assertEqual(b64url_decode("_w", exact_bytes=1), b"\xff")
        for encoded in ["_w==", "/w", "+w", "_x", "A", "_w\n", " _w", "é", ""]:
            self.rejects("invalid_envelope", b64url_decode, encoded)
        self.assertEqual(b64url_decode("", allow_empty=True, exact_bytes=0), b"")
        self.rejects("invalid_envelope", b64url_decode, "_w", exact_bytes=2)

    def test_base64url_budget_applies_to_decoded_bytes_before_unbounded_allocation(
        self,
    ):
        raw = bytes(range(255))
        encoded = b64url_encode(raw)
        self.assertEqual(b64url_decode(encoded, max_bytes=255), raw)
        self.rejects("payload_too_large", b64url_decode, encoded, max_bytes=254)
        self.rejects("payload_too_large", b64url_decode, "A" * 100000, max_bytes=16)
        # Three decoded bytes need exactly four characters, with no '='.
        self.assertEqual(b64url_decode("YWJj", max_bytes=3), b"abc")

    def test_operation_ids_are_new_canonical_128_bit_values_and_round_trip_unchanged(
        self,
    ):
        operations = [new_operation_id() for _ in range(64)]
        self.assertEqual(len(set(operations)), len(operations))
        for operation in operations:
            self.assertEqual(len(operation), 22)
            self.assertEqual(len(b64url_decode(operation, exact_bytes=16)), 16)
            saved = {
                "stableOperationId": operation,
                "originalCiphertext": "SyntheticSecret",
            }
            self.assertEqual(
                strict_json_loads(canonical_json(saved))["stableOperationId"], operation
            )


class MessageBudgetTests(ContractBoundaryTestCase):
    @unittest.skipUnless(
        Document is not None,
        "Optional Firestore SDK is required for protobuf size integration.",
    )
    def test_maximum_holdings_with_eight_recipients_fit_real_wire_and_firestore_budgets(
        self,
    ):
        fixture = EnvelopeFixture()
        for agent in ("A3", "A4", "A5", "A6"):
            fixture.add_key(agent + "_enc", "agent_enc", agent, "connection_" + agent)
        previous = fixture.registry
        fixture.bundle = fixture.make_bundle(previous=previous)
        fixture.registry = fixture.verify(fixture.bundle, previous=previous)
        readers = tuple(f"A{i}_enc" for i in range(1, 7))
        context = fixture.context("holdings_snapshot", readers=readers)
        self.assertEqual(len(context["recipients"]), 8)
        self.assertEqual(sum(row["role"] == "agent_enc" for row in context["recipients"]), 6)
        # Every synthetic reader has a verified root certificate. No current task
        # grant is asserted: this test checks trusted-client encryption budgets.
        for recipient in context["recipients"]:
            fixture.registry.cert(recipient["keyId"], role=recipient["role"], now=1000)
        public_keys = {
            fixture.kid(name): fixture.public(fixture.keys[name])
            for name in ("device_enc", "recovery_enc", *readers)
        }
        private = wrapper(context)
        account = private["payload"]["data"]["accounts"][0]
        position = account["positions"][0]
        account["positions"] = [
            {
                **position,
                "assetId": f"asset_{i:04}",
                "brokerAssetId": f"broker_asset_{i:04}",
                "name": "x",
            }
            for i in range(500)
        ]
        limit = PRIVATE_BYTE_LIMITS["holdings_snapshot"]
        remaining = limit - len(canonical_json(private))
        self.assertGreater(remaining, 0)
        for position in account["positions"]:
            amount = min(179, remaining)
            position["name"] += "x" * amount
            remaining -= amount
        self.assertEqual(remaining, 0)
        self.assertEqual(len(canonical_json(private)), 196608)
        validate_private_payload(private, context=context)

        over_limit = copy.deepcopy(private)
        over_limit["payload"]["data"]["accounts"][0]["positions"][-1]["name"] += "x"
        self.assertEqual(len(canonical_json(over_limit)), limit + 1)
        with patch("folioview_shared.encrypted.crypto.jwe.JWE") as encryptor:
            self.rejects(
                "private_schema_invalid",
                encrypt_jwe,
                over_limit,
                public_keys,
                context=context,
            )
            encryptor.assert_not_called()

        encrypted = encrypt_jwe(private, public_keys, context=context)
        signed = sign_jws(
            {"context": context, "jwe": encrypted},
            fixture.keys["device_sig"],
            typ="fv-object+jws",
        )
        carrier = {"contractVersion": CONTRACT_VERSION, "signedObject": signed}
        self.assertEqual(
            verify_jws(signed, fixture.public(fixture.keys["device_sig"]), typ="fv-object+jws"),
            {"context": context, "jwe": encrypted},
        )
        self.assertEqual(
            decrypt_jwe(encrypted, fixture.keys["device_enc"], context=context), private
        )
        # Snapshot commits use the versioned SignedObject carrier as the HTTP
        # body, including its outer contractVersion and nested JOSE/base64 bytes.
        http_body = canonical_json(carrier)
        decoded = strict_json_loads(read_bounded([http_body[:1000], http_body[1000:]]))
        require_contract(CONTRACT_VERSION, decoded)
        carrier_bytes, http_bytes = (
            check_carrier_budget(carrier),
            check_write_body(decoded),
        )
        fingerprint = signing_input_fingerprint(signed)
        task_context = fixture.context("task", readers=("A1_enc",))
        task_carrier = fixture.carrier(task_context)
        task_fingerprint = signing_input_fingerprint(task_carrier["signedObject"])
        selected_version = {
            "ref": fixture.resource,
            "revision": 1,
            "sourceEpoch": 1,
            "envelopeFingerprint": fingerprint,
        }
        intent = fixture.sign(
            fixture.begin(
                taskEnvelopeFingerprint=task_fingerprint,
                resourceVersions=[selected_version],
            ),
            "A1_sig",
        )
        manifest = manifest_descriptor()
        manifest.update(
            vaultId=fixture.vault,
            taskId="task_A1",
            connectionId="connection_A1",
            grantId="grant_A1",
            signedBeginIntent=intent,
            beginIntentFingerprint=signing_input_fingerprint(intent),
        )
        manifest["taskEnvelope"].update(objectId="task_A1", envelopeFingerprint=task_fingerprint)
        manifest["entries"] = [
            {
                **selected_version,
                "objectId": context["objectId"],
                "objectType": "holdings_snapshot",
                "deliveryRevision": 1,
                "keyEpoch": 1,
            }
        ]
        page = {
            "contractVersion": CONTRACT_VERSION,
            "manifest": manifest,
            "manifestFingerprint": hashlib.sha256(canonical_json(manifest)).hexdigest(),
            "componentIndex": 1,
            "component": {
                "kind": "resource",
                "objectId": context["objectId"],
                "revision": 1,
                "deliveryRevision": 1,
                "signedObject": signed,
            },
            "nextCursor": None,
        }
        validate_schema("ManifestComponentPage", page)
        page_bytes = check_read_response(page)
        metadata = {
            "contractVersion": CONTRACT_VERSION,
            "items": [
                {
                    "ref": fixture.resource,
                    "revision": 1,
                    "sourceEpoch": 1,
                    "state": "ready",
                    "keyEpoch": 1,
                    "envelopeFingerprint": fingerprint,
                }
            ],
            "readAt": "2026-10-26T12:00:00Z",
        }
        validate_schema("ResourceCatalogueMetadata", metadata)
        metadata_bytes = check_read_response(metadata)
        application_document = {
            "contractVersion": CONTRACT_VERSION,
            "ownerSubject": fixture.owner,
            "vaultId": fixture.vault,
            "objectId": context["objectId"],
            "objectType": "holdings_snapshot",
            "revision": 1,
            "sourceEpoch": 1,
            "deliveryRevision": 1,
            "resourceRef": fixture.resource,
            "envelopeFingerprint": fingerprint,
            "signedObject": signed,
            "createdAt": "2026-10-26T12:00:00Z",
            "keyProofs": {
                "checkpoint": fixture.bundle["checkpoint"],
                "certificates": [entry["certificate"] for entry in fixture.bundle["entries"]],
            },
        }
        document_name = (
            "projects/synthetic-budget-test/databases/(default)/documents/"
            "vaults/vault_A/snapshots/synthetic_object/revisions/1/deliveries/1"
        )
        document = Document(
            name=document_name,
            fields=firestore_helpers.encode_dict(application_document),
        )
        encoded_document = Document.serialize(document)
        application_bytes, protobuf_bytes = check_document_budget(
            application_document, encoded_document=encoded_document
        )
        self.assertEqual(Document.deserialize(encoded_document).name, document_name)
        self.assertGreater(protobuf_bytes, carrier_bytes)
        self.integration_sizes = {
            "private": limit,
            "recipients": 8,
            "carrier": carrier_bytes,
            "httpBody": http_bytes,
            "manifestPage": page_bytes,
            "metadata": metadata_bytes,
            "applicationDocument": application_bytes,
            "firestoreDocumentProtobuf": protobuf_bytes,
        }

    def test_whole_message_limits_include_json_overhead_at_each_transport_boundary(
        self,
    ):
        for check, maximum in [
            (check_carrier_budget, MAX_CARRIER_BYTES),
            (check_write_body, MAX_HTTP_WRITE_BYTES),
            (check_manifest_budget, MAX_MANIFEST_BYTES),
            (check_read_response, MAX_READ_BYTES),
        ]:
            with self.subTest(check=check.__name__):
                self.assertEqual(check(sized_document(maximum)), maximum)
                self.rejects("payload_too_large", check, sized_document(maximum + 1))

    def test_canonical_byte_budgets_include_multibyte_text_and_escaping(self):
        value = {"title": '合\n"'}
        expected = b'{"title":"\xe5\x90\x88\\n\\""}'
        self.assertEqual(canonical_json(value), expected)
        self.assertEqual(check_size(value, len(expected)), len(expected))
        self.rejects("payload_too_large", check_size, value, len(expected) - 1)

    def test_streaming_body_stops_at_first_overflow_without_consuming_more_chunks(self):
        seen = []

        def chunks():
            seen.append(1)
            yield b"1234"
            seen.append(2)
            yield b"5"
            self.fail("A rejected body consumed another chunk")

        self.rejects("payload_too_large", read_bounded, chunks(), maximum=4)
        self.assertEqual(seen, [1, 2])
        self.assertEqual(read_bounded(iter([b"12", b"", b"34"]), maximum=4), b"1234")
        self.assertEqual(read_bounded([], maximum=0), b"")
        self.rejects("malformed_request", read_bounded, [b"12", "SyntheticSecret"], maximum=10)

    def test_document_budget_requires_real_wire_bytes_and_checks_both_sizes_independently(
        self,
    ):
        application = {"ciphertext": "SyntheticSecret", "metadata": {"revision": 1}}
        original = copy.deepcopy(application)
        # Bytes stand in for a caller's SDK Document protobuf here. The helper
        # requires that exact encoding; it cannot infer SDK overhead from JSON.
        encoded = b"x" * MAX_STORED_DOCUMENT_BYTES
        self.assertEqual(
            check_document_budget(application, encoded_document=encoded),
            (len(canonical_json(application)), MAX_STORED_DOCUMENT_BYTES),
        )
        self.assertEqual(application, original)
        self.rejects(
            "payload_too_large",
            check_document_budget,
            application,
            encoded_document=encoded + b"x",
        )
        self.rejects(
            "payload_too_large",
            check_document_budget,
            sized_document(MAX_STORED_DOCUMENT_BYTES + 1),
            encoded_document=b"small",
        )
        self.rejects(
            "malformed_request",
            check_document_budget,
            application,
            encoded_document="SyntheticSecret",
        )
        self.rejects(
            "malformed_request",
            check_document_budget,
            application,
            encoded_document=bytearray(b"x"),
        )
        self.rejects(
            "payload_too_large",
            check_document_budget,
            application,
            encoded_document=b"",
        )


class RoutingAndErrorTests(ContractBoundaryTestCase):
    def test_http_header_and_body_must_both_explicitly_select_the_same_stable_contract(
        self,
    ):
        body = {
            "contractVersion": CONTRACT_VERSION,
            "signedObject": {"payload": "SyntheticSecret"},
        }
        require_contract(CONTRACT_VERSION, body)
        for header in [
            None,
            "",
            "folioview.agent-workspace.v1",
            "folioview.agent-workspace.v2-candidate",
        ]:
            self.rejects("unsupported_contract", require_contract, header, body)
        for invalid_body in [
            {},
            {"contractVersion": "folioview.agent-workspace.v1"},
            [],
            None,
        ]:
            self.rejects("unsupported_contract", require_contract, CONTRACT_VERSION, invalid_body)

    def test_metadata_query_allowlist_rejects_private_search_without_echoing_inputs(
        self,
    ):
        allowed = frozenset({"taskId", "read", "cursor"})
        query = {"taskId": "task_1", "read": "false", "cursor": "opaque"}
        require_metadata_query(query, allowed=allowed)
        require_metadata_query({}, allowed=allowed)
        for field in [
            "title",
            "summary",
            "search",
            "holdings",
            "sourceAsOf",
            "SyntheticSecret",
        ]:
            error = self.rejects(
                "unsupported_query",
                require_metadata_query,
                {**query, field: "SyntheticSecret"},
                allowed=allowed,
            )
            self.assertNotIn(field, str(error))
        self.rejects(
            "malformed_request",
            require_metadata_query,
            [("taskId", "task_1")],
            allowed=allowed,
        )
        self.assertEqual(query, {"taskId": "task_1", "read": "false", "cursor": "opaque"})

    def test_error_responses_are_fixed_versioned_metadata_and_only_503_is_retryable(
        self,
    ):
        for code, status, retryable in [
            ("invalid_token", 401, False),
            ("insufficient_scope", 403, False),
            ("not_found", 404, False),
            ("idempotency_conflict", 409, False),
            ("payload_too_large", 413, False),
            ("invalid_signature", 422, False),
            ("authorization_unavailable", 503, True),
            ("source_unavailable", 503, True),
        ]:
            with self.subTest(code=code):
                error = ContractError(code)
                self.assertEqual(error.status, status)
                self.assertEqual(
                    error.response("request_public_1"),
                    {
                        "contractVersion": CONTRACT_VERSION,
                        "error": {
                            "code": code,
                            "retryable": retryable,
                            "requestId": "request_public_1",
                        },
                    },
                )
        unknown = ContractError("SyntheticSecret raw crypto exception")
        self.assertEqual(str(unknown), "malformed_request")
        self.assertEqual(unknown.response("request_1")["error"]["code"], "malformed_request")

    def test_server_errors_cannot_claim_client_decryption_or_use_raw_input_as_request_id(
        self,
    ):
        for code in CLIENT_ERRORS:
            self.rejects("malformed_request", ContractError(code).response, "request_1")
        for request_id in ["", "SyntheticSecret\n", "request one", "x" * 129, None]:
            self.rejects(
                "malformed_request",
                ContractError("invalid_envelope").response,
                request_id,
            )


if __name__ == "__main__":
    unittest.main()
