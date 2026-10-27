"""Authenticated public envelopes, trusted routing comparisons and stable receipts.

This module has no user/OAuth/database state. Callers derive expectations from
authenticated ownership, immutable Run manifests and current grants. Never copy
untrusted envelope fields into an expectation to make a comparison succeed.
"""

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .budgets import check_carrier_budget, require_contract
from .constants import CONTRACT_VERSION, MAX_CARRIER_BYTES, PROFILE_ID
from .crypto import _signed_parts, signing_input_fingerprint, validate_jwe, verify_jws
from .errors import ContractError
from .jsonutil import canonical_json, strict_json_loads
from .schema import validate_schema


@dataclass(frozen=True)
class EnvelopeExpectation:
    """Every routing/security binding is supplied independently by the consumer."""

    owner_subject: str
    vault_id: str
    object_id: str
    object_type: str
    revision: int
    expected_revision: int
    operation_type: str
    author_signing_key_id: str
    binding: Mapping
    resource_bindings: Sequence
    recipient_key_ids: tuple[str, ...]


@dataclass(frozen=True)
class VerifiedEnvelope:
    """Canonical immutable bytes; property reads return independent mutable copies."""

    _carrier_bytes: bytes
    _context_bytes: bytes
    _jwe_bytes: bytes
    fingerprint: str

    @property
    def context(self) -> dict:
        return strict_json_loads(self._context_bytes)

    @property
    def jwe(self) -> dict:
        return strict_json_loads(self._jwe_bytes)

    @property
    def carrier(self) -> dict:
        return strict_json_loads(self._carrier_bytes)


def parse_carrier(value: bytes | str | dict, *, contract_header: str | None) -> dict:
    """Bounded structural parse only; no successful signature/authorization claim."""
    if isinstance(value, (bytes, str)):
        value = strict_json_loads(value, max_bytes=MAX_CARRIER_BYTES)
    else:
        # Snapshot caller dictionaries before validation to avoid later mutation.
        check_carrier_budget(value)
        value = strict_json_loads(canonical_json(value), max_bytes=MAX_CARRIER_BYTES)
    require_contract(contract_header, value)
    validate_schema("Carrier", value)
    check_carrier_budget(value)
    _, message = _signed_parts(value["signedObject"])
    validate_schema("ObjectMessage", message)
    validate_jwe(message["jwe"], context=message["context"])
    validate_context_semantics(message["context"])
    return value


def validate_context_semantics(context: dict) -> dict:
    validate_schema("Context", context)
    if context["contractVersion"] != CONTRACT_VERSION:
        raise ContractError("unsupported_contract")
    if context["profileId"] != PROFILE_ID:
        raise ContractError("unsupported_profile")
    binding = context["binding"]
    kind, operation = context["objectType"], context["operationType"]
    resources = context["resourceBindings"]
    refs = [canonical_json(x["ref"]) for x in resources]
    if len(refs) != len(set(refs)):
        raise ContractError("recipient_binding_mismatch")
    delivery = context["deliveryRevision"]
    if (delivery == 1) != (context["priorEnvelopeFingerprint"] is None):
        raise ContractError("recipient_binding_mismatch")
    if operation == "reshare_delivery":
        if delivery <= 1 or context["expectedRevision"] != context["revision"]:
            raise ContractError("version_conflict")
    elif delivery != 1 or context["revision"] != context["expectedRevision"] + 1:
        raise ContractError("version_conflict")
    if kind == "task":
        if operation not in {"create_task", "update_task", "transition_task", "reshare_delivery"}:
            raise ContractError("recipient_binding_mismatch")
        if (
            context["objectId"] != binding["taskId"]
            or context["revision"] != binding["taskVersion"]
        ):
            raise ContractError("recipient_binding_mismatch")
        if any(binding[x] is not None for x in set(binding) - {"taskId", "taskVersion"}):
            raise ContractError("recipient_binding_mismatch")
        if (operation == "create_task") != (context["expectedRevision"] == 0):
            if operation != "reshare_delivery":
                raise ContractError("version_conflict")
    elif kind == "result_revision":
        if operation not in {"submit_result", "revise_result", "reshare_delivery"}:
            raise ContractError("recipient_binding_mismatch")
        if any(
            binding[x] is None
            for x in set(binding) - {"resourceRef", "sourceRevision", "sourceEpoch"}
        ):
            raise ContractError("recipient_binding_mismatch")
        if any(binding[x] is not None for x in ["resourceRef", "sourceRevision", "sourceEpoch"]):
            raise ContractError("recipient_binding_mismatch")
        if operation == "submit_result" and context["expectedRevision"] != 0:
            raise ContractError("initial_result_exists")
        if operation == "revise_result" and context["expectedRevision"] < 1:
            raise ContractError("version_conflict")
    else:
        expected = "commit_snapshot" if kind == "holdings_snapshot" else "commit_evidence"
        if operation not in {expected, "reshare_delivery"}:
            raise ContractError("recipient_binding_mismatch")
        if any(
            binding[x] is not None
            for x in set(binding) - {"resourceRef", "sourceRevision", "sourceEpoch"}
        ):
            raise ContractError("recipient_binding_mismatch")
        if binding["resourceRef"] is None or binding["sourceEpoch"] is None:
            raise ContractError("recipient_binding_mismatch")
        if binding["sourceRevision"] != context["revision"] or resources:
            raise ContractError("recipient_binding_mismatch")
        ref_kind = {
            "holdings_snapshot": "holdings",
            "watchlist_evidence": "watchlist",
            "channel_follows_evidence": "channel_follows",
        }[kind]
        if binding["resourceRef"]["kind"] != ref_kind:
            raise ContractError("recipient_binding_mismatch")
    return context


def verify_carrier(
    value: bytes | str | dict,
    *,
    registry,
    expectation: EnvelopeExpectation,
    now: int,
    contract_header: str | None,
    grant=None,
    read_grants: Sequence = (),
) -> VerifiedEnvelope:
    """Validate a *new write* against current certified keys and trusted bindings.

    Stored-history clients verify the retained author signature against historical
    root proofs separately; this current-write gate must not authorize history
    merely because a caller supplies an old operation ID or fingerprint.
    """
    from .authority import VerifiedRegistry

    if type(now) is not int or now < 0:
        raise ContractError("malformed_request")
    if not isinstance(registry, VerifiedRegistry) or not isinstance(
        expectation, EnvelopeExpectation
    ):
        raise ContractError("key_authorization_required")
    carrier = parse_carrier(value, contract_header=contract_header)
    _, untrusted = _signed_parts(carrier["signedObject"])
    context = untrusted["context"]
    expected = {
        "ownerSubject": expectation.owner_subject,
        "vaultId": expectation.vault_id,
        "rootKeyId": registry.root_key_id,
        "rootEpoch": registry.root_epoch,
        "keyEpoch": registry.key_epoch,
        "objectId": expectation.object_id,
        "objectType": expectation.object_type,
        "revision": expectation.revision,
        "expectedRevision": expectation.expected_revision,
        "operationType": expectation.operation_type,
        "authorSigningKeyId": expectation.author_signing_key_id,
        "binding": dict(expectation.binding),
        "resourceBindings": list(expectation.resource_bindings),
    }
    if (
        registry.owner_subject != expectation.owner_subject
        or registry.vault_id != expectation.vault_id
    ):
        raise ContractError("recipient_binding_mismatch")
    if any(canonical_json(context[k]) != canonical_json(v) for k, v in expected.items()):
        raise ContractError("recipient_binding_mismatch")
    if registry.checkpoint_history.get(context["registrySequence"]) != context["checkpointDigest"]:
        raise ContractError("registry_conflict")
    result_author = (
        context["objectType"] == "result_revision"
        and context["operationType"] != "reshare_delivery"
    )
    if result_author:
        _result_grant(grant, registry, context, now)
    author = registry.cert(
        expectation.author_signing_key_id,
        role="agent_sig" if result_author else "device_sig",
        connection_id=context["binding"]["connectionId"] if result_author else None,
        now=now,
    )
    if ("result_write" if result_author else "object_write") not in author["capabilities"]:
        raise ContractError("key_authorization_required")
    message = verify_jws(
        carrier["signedObject"],
        author["publicJwk"],
        typ="fv-object+jws",
        expected_kid=expectation.author_signing_key_id,
    )
    context = message["context"]
    ids = [row["keyId"] for row in context["recipients"]]
    if ids != list(expectation.recipient_key_ids):
        raise ContractError("recipient_binding_mismatch")
    roles = set()
    for row in context["recipients"]:
        certificate = registry.cert(row["keyId"], now=now)
        if certificate["role"] not in {"device_enc", "agent_enc", "recovery_enc"}:
            raise ContractError("key_authorization_required")
        if any(
            row[k] != certificate[k] for k in ["role", "principalId", "connectionId", "keyEpoch"]
        ):
            raise ContractError("recipient_binding_mismatch")
        if certificate["role"] == "agent_enc":
            _reader_grant(read_grants, registry, context, row["keyId"], now)
        roles.add(certificate["role"])
    if not {"device_enc", "recovery_enc"} <= roles:
        raise ContractError("recipient_binding_mismatch")
    return VerifiedEnvelope(
        canonical_json(carrier),
        canonical_json(context),
        canonical_json(message["jwe"]),
        signing_input_fingerprint(carrier["signedObject"]),
    )


def _current_grant(grant, registry, now: int) -> None:
    from .authority import VerifiedGrant

    if (
        not isinstance(grant, VerifiedGrant)
        or grant.registry_digest != registry.checkpoint_digest
        or not grant["notBefore"] <= now < grant["expiresAt"]
        or grant["ownerSubject"] != registry.owner_subject
        or grant["vaultId"] != registry.vault_id
    ):
        raise ContractError("key_authorization_required")


def _result_grant(grant, registry, context: dict, now: int) -> None:
    _current_grant(grant, registry, now)
    binding = context["binding"]
    if (
        "encrypt_result" not in grant["capabilities"]
        or context["authorSigningKeyId"] != grant["agentSigningKeyId"]
        or binding["taskVersion"] != grant.task_version
        or any(
            binding[k] != grant[k]
            for k in ["taskId", "connectionId", "grantId", "grantEpoch", "executionEpoch"]
        )
        or [r["keyId"] for r in context["recipients"]] != grant["writebackRecipientKeyIds"]
        or any(r["role"] not in {"device_enc", "recovery_enc"} for r in context["recipients"])
    ):
        raise ContractError("recipient_binding_mismatch")


def _reader_grant(grants: Sequence, registry, context: dict, key_id: str, now: int) -> None:
    # A root-certified agent key identifies an agent; it is not content consent.
    for grant in grants:
        _current_grant(grant, registry, now)
        if grant["agentEncryptionKeyId"] != key_id:
            continue
        if context["operationType"] == "reshare_delivery" and grant["historyPolicy"] != "selected":
            continue
        if context["objectType"] == "task":
            refs = [
                {"ref": b["ref"], "sourceEpoch": b["sourceEpoch"]}
                for b in grant["resourceBindings"]
            ]
            if (
                "decrypt_task" in grant["capabilities"]
                and grant["taskId"] == context["binding"]["taskId"]
                and grant.task_version == context["revision"]
                and canonical_json(refs) == canonical_json(context["resourceBindings"])
            ):
                return
        elif (
            context["objectType"] != "result_revision"
            and "decrypt_resources" in grant["capabilities"]
        ):
            for binding in grant["resourceBindings"]:
                selected = binding["versionAccess"] == "selected"
                if (
                    binding["ref"] == context["binding"]["resourceRef"]
                    and binding["sourceEpoch"] == context["binding"]["sourceEpoch"]
                    and (not selected or context["revision"] in binding["selectedVersions"])
                    and (context["operationType"] != "reshare_delivery" or selected)
                ):
                    return
    raise ContractError("key_authorization_required")


def validate_write_transition(
    context: dict,
    *,
    current_revision: int,
    current_delivery_revision: int = 0,
    prior_envelope_fingerprint: str | None = None,
) -> None:
    """CAS predicate only. The consuming store must recheck and commit atomically."""
    validate_context_semantics(context)
    if type(current_revision) is not int or current_revision < 0:
        raise ContractError("malformed_request")
    if context["operationType"] == "reshare_delivery":
        if (
            type(current_delivery_revision) is not int
            or current_delivery_revision < 1
            or context["revision"] != current_revision
            or context["deliveryRevision"] != current_delivery_revision + 1
            or context["priorEnvelopeFingerprint"] != prior_envelope_fingerprint
        ):
            raise ContractError("version_conflict")
    elif context["operationType"] == "submit_result" and current_revision:
        raise ContractError("initial_result_exists")
    elif context["expectedRevision"] != current_revision:
        raise ContractError("version_conflict")


def operation_namespace(context: dict) -> tuple:
    validate_context_semantics(context)
    binding = context["binding"]
    return (
        context["ownerSubject"],
        context["vaultId"],
        binding["connectionId"],
        binding["grantId"],
        binding["taskId"],
        binding["runId"],
        context["operationType"],
        context["stableOperationId"],
    )


def check_operation_replay(
    signed_object: dict, *, stored_fingerprint: str, stored_receipt: dict
) -> dict:
    """After current authorization/signature checks, return the *original* receipt.

    This does not bypass revocation or perform a transaction. Stores must key the
    lookup by the complete operation_namespace, not operation ID or latest Run.
    """
    validate_schema("ResultReceipt", stored_receipt)
    if signing_input_fingerprint(signed_object) != stored_fingerprint:
        raise ContractError("idempotency_conflict")
    if stored_receipt["envelopeFingerprint"] != stored_fingerprint:
        raise ContractError("idempotency_conflict")
    _, message = _signed_parts(signed_object)
    validate_schema("ObjectMessage", message)
    validate_jwe(message["jwe"], context=message["context"])
    validate_context_semantics(message["context"])
    validate_result_receipt(
        stored_receipt, context=message["context"], fingerprint=stored_fingerprint
    )
    return strict_json_loads(canonical_json(stored_receipt))


def validate_result_receipt(receipt: dict, *, context: dict, fingerprint: str) -> dict:
    receipt = validate_schema("ResultReceipt", receipt)
    validate_context_semantics(context)
    binding = context["binding"]
    expected = {
        "contractVersion": CONTRACT_VERSION,
        "vaultId": context["vaultId"],
        "runId": binding["runId"],
        "taskId": binding["taskId"],
        "resultId": context["objectId"],
        "revision": context["revision"],
        "deliveryRevision": context["deliveryRevision"],
        "stableOperationId": context["stableOperationId"],
        "envelopeFingerprint": fingerprint,
        "resultPath": f"/results/{context['objectId']}?revision={context['revision']}",
    }
    if context["objectType"] != "result_revision" or any(
        receipt[k] != v for k, v in expected.items()
    ):
        raise ContractError("recipient_binding_mismatch")
    return receipt


def manifest_fingerprint(value: dict) -> str:
    """Hash a closed, visible descriptor; never accept arbitrary private payloads."""
    from .budgets import check_manifest_budget

    validate_schema("ManifestDescriptor", value)
    check_manifest_budget(value)
    return hashlib.sha256(canonical_json(value)).hexdigest()
