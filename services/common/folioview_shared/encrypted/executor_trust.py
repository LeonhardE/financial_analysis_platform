"""Opt-in public executor trust contracts; no keys, issuance, storage or attestation.

Every expected binding/checkpoint/challenge/operation is independently trusted
current state, reread atomically by the consumer. Returned dicts are detached
verification snapshots, never cached authorization or caller-supplied capabilities.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from functools import lru_cache
from importlib.resources import files

from jsonschema import Draft202012Validator

from .crypto import jwk_thumbprint, signing_input_fingerprint, verify_jws
from .errors import ContractError
from .jsonutil import b64url_decode, canonical_json

EXECUTOR_TRUST_PROFILE = "folioview.executor-trust.v1"
MAX_EXECUTOR_CONTROL_BYTES = 32_768
MAX_EXECUTOR_LEASE_SECONDS = 120
MAX_EXECUTOR_APPROVAL_SECONDS = 30 * 86400
_NAMES = frozenset(
    {
        "ExecutorBinding",
        "ExecutorApprovalPayload",
        "ExecutorCheckpointPayload",
        "ExecutorChallenge",
        "ExecutorOperation",
        "ExecutorReceipt",
        "ExecutorLeasePayload",
        "ExecutorRecoveryPayload",
        "ExecutorTransitionPayload",
    }
)


@lru_cache(maxsize=1)
def _document():
    document = json.loads(files(__package__).joinpath("executor_trust.json").read_text())
    Draft202012Validator.check_schema(document)
    return document


def load_executor_schema(name):
    if type(name) is not str or name not in _NAMES:
        raise ContractError("malformed_request")
    document = copy.deepcopy(_document())
    document["$ref"] = "#/$defs/" + name
    return document


@lru_cache(maxsize=16)
def _validator(name):
    return Draft202012Validator(load_executor_schema(name))


def validate_executor_schema(name, value):
    if type(name) is not str or name not in _NAMES:
        raise ContractError("malformed_request")
    if len(canonical_json(value)) > MAX_EXECUTOR_CONTROL_BYTES:
        raise ContractError("payload_too_large")
    if next(_validator(name).iter_errors(value), None) is not None:
        raise ContractError("malformed_request")
    return copy.deepcopy(value)


def _deny():
    raise ContractError("key_authorization_required")


def _digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _clock(now):
    if type(now) is not int or not 1 <= now <= 9007199254740991:
        _deny()


def _binding(value):
    value = validate_executor_schema("ExecutorBinding", value)
    # One ASCII spelling, no credentials, alternate port, query, fragment,
    # dot segments or percent-encoded path. Values are compared, never fetched.
    origin = r"https://[a-z0-9]+(?:[.-][a-z0-9]+)*"
    if not re.fullmatch(origin, value["issuer"]):
        _deny()
    if not re.fullmatch(origin + r"(?:/[A-Za-z0-9_-]+)*/?", value["audience"]):
        _deny()
    names = (
        "rootKeyId",
        "policySigningKeyId",
        "agentSigningKeyId",
        "agentEncryptionKeyId",
        "tlsKeyId",
    )
    keys = [value[k] for k in names]
    recipients = value["recipientKeyIds"]
    for key in keys + recipients:
        b64url_decode(key, exact_bytes=32)
    if (
        len(set(keys)) != len(keys)
        or recipients != sorted(set(recipients))
        or set(keys) & set(recipients)
    ):
        _deny()
    return value


def _window(payload, now, maximum):
    _clock(now)
    if not payload["issuedAt"] <= now < payload["expiresAt"] <= payload["issuedAt"] + maximum:
        _deny()


def _signed(signed, public_key, name):
    if len(canonical_json(signed)) > MAX_EXECUTOR_CONTROL_BYTES:
        raise ContractError("payload_too_large")
    payload = verify_jws(signed, public_key, typ="fv-control+jws")
    return validate_executor_schema(name, payload)


def verify_executor_approval(signed, *, expected_binding, root_jwk, now):
    """Root approval of an exact, caller-selected independent trust/content scope."""
    binding = _binding(expected_binding)
    if jwk_thumbprint(root_jwk) != binding["rootKeyId"]:
        _deny()
    payload = _signed(signed, root_jwk, "ExecutorApprovalPayload")
    if payload["binding"] != binding:
        _deny()
    _window(payload, now, MAX_EXECUTOR_APPROVAL_SECONDS)
    return payload


def _checkpoint(approval, approval_signed, signed, current, policy_jwk, now):
    binding = approval["binding"]
    if jwk_thumbprint(policy_jwk) != binding["policySigningKeyId"]:
        _deny()
    cp = _signed(signed, policy_jwk, "ExecutorCheckpointPayload")
    validate_executor_schema("ExecutorCheckpointPayload", current)
    if (
        cp != current
        or cp["revoked"]
        or cp["bindingDigest"] != _digest(binding)
        or cp["approvalFingerprint"] != signing_input_fingerprint(approval_signed)
        or cp["issuedAt"] < approval["issuedAt"]
        or cp["expiresAt"] > approval["expiresAt"]
    ):
        _deny()
    _window(cp, now, MAX_EXECUTOR_LEASE_SECONDS)
    return cp


def verify_executor_lease(
    approval_signed,
    checkpoint_signed,
    lease_signed,
    *,
    expected_binding,
    root_jwk,
    policy_jwk,
    current_checkpoint,
    challenge,
    challenge_used,
    expected_operation,
    purpose,
    now,
):
    """Fresh one-use lease, not OAuth, attestation or a substitute for source/Run fences."""
    approval = verify_executor_approval(
        approval_signed, expected_binding=expected_binding, root_jwk=root_jwk, now=now
    )
    cp = _checkpoint(
        approval, approval_signed, checkpoint_signed, current_checkpoint, policy_jwk, now
    )
    ch = validate_executor_schema("ExecutorChallenge", challenge)
    operation = validate_executor_schema("ExecutorOperation", expected_operation)
    _window(ch, now, MAX_EXECUTOR_LEASE_SECONDS)
    b64url_decode(ch["nonce"], exact_bytes=32)
    bd = _digest(approval["binding"])
    if (
        challenge_used is not False
        or ch["bindingDigest"] != bd
        or operation["bindingDigest"] != bd
        or purpose not in ("execute", "write_report", "recover")
        or ch["purpose"] != purpose
        or ch["issuedAt"] < approval["issuedAt"]
    ):
        _deny()
    lease = _signed(lease_signed, policy_jwk, "ExecutorLeasePayload")
    _window(lease, now, MAX_EXECUTOR_LEASE_SECONDS)
    if (
        lease["bindingDigest"] != bd
        or lease["checkpointDigest"] != _digest(cp)
        or lease["challenge"] != ch
        or lease["operation"] != operation
        or lease["issuedAt"] < max(cp["issuedAt"], ch["issuedAt"])
        or lease["expiresAt"] > min(cp["expiresAt"], ch["expiresAt"], approval["expiresAt"])
    ):
        _deny()
    return lease


def verify_executor_recovery(
    proof_signed,
    *,
    agent_jwk,
    expected_receipts,
    approval_signed,
    checkpoint_signed,
    lease_signed,
    **lease_expectations,
):
    """Bind a same-key recovery statement to current state and original receipts.

    An Agent signature proves signing-key possession only. Runtime adoption must
    separately challenge encryption/TLS possession and verify actual attestation.
    """
    if lease_expectations.get("purpose") != "recover":
        _deny()
    verify_executor_lease(approval_signed, checkpoint_signed, lease_signed, **lease_expectations)
    binding = _binding(lease_expectations["expected_binding"])
    if jwk_thumbprint(agent_jwk) != binding["agentSigningKeyId"]:
        _deny()
    proof = _signed(proof_signed, agent_jwk, "ExecutorRecoveryPayload")
    cp = lease_expectations["current_checkpoint"]
    if (
        proof["recoveredBinding"] != binding
        or proof["leaseFingerprint"] != signing_input_fingerprint(lease_signed)
        or proof["checkpointDigest"] != _digest(cp)
        or proof["stateHead"] != cp["stateHead"]
        or proof["receipts"] != expected_receipts
    ):
        _deny()
    operations, receipts = set(), set()
    for receipt in proof["receipts"]:
        op = receipt["operation"]
        if op["operationId"] in operations or receipt["receiptId"] in receipts:
            _deny()
        operations.add(op["operationId"])
        receipts.add(receipt["receiptId"])
    return proof


def verify_executor_transition(
    transition_signed,
    *,
    approval_signed,
    checkpoint_signed,
    expected_binding,
    expected_next_binding,
    root_jwk,
    policy_jwk,
    current_checkpoint,
    now,
):
    """Root-approved upgrade/migration. Consumer atomically fences the old state.

    This does not activate a next identity or extend any existing approval/lease.
    Permanent key loss has no recovery fallback; it requires explicit migration.
    """
    approval = verify_executor_approval(
        approval_signed, expected_binding=expected_binding, root_jwk=root_jwk, now=now
    )
    cp = _checkpoint(
        approval, approval_signed, checkpoint_signed, current_checkpoint, policy_jwk, now
    )
    nxt = _binding(expected_next_binding)
    p = _signed(transition_signed, root_jwk, "ExecutorTransitionPayload")
    _window(p, now, 300)
    if (
        p["previousApprovalFingerprint"] != signing_input_fingerprint(approval_signed)
        or p["previousCheckpointDigest"] != _digest(cp)
        or p["nextBinding"] != nxt
        or p["issuedAt"] < cp["issuedAt"]
        or p["expiresAt"] > approval["expiresAt"]
    ):
        _deny()
    old = approval["binding"]
    if p["transitionType"] == "code_upgrade":
        if old == nxt or {**old, "workloadDigest": nxt["workloadDigest"]} != nxt:
            _deny()
    else:
        changed = {
            "identityEpoch",
            "agentSigningKeyId",
            "agentEncryptionKeyId",
            "tlsKeyId",
            "workloadDigest",
            "bindingFingerprint",
        }
        if (
            any(old[k] != nxt[k] for k in old if k not in changed)
            or nxt["identityEpoch"] != old["identityEpoch"] + 1
            or any(old[k] == nxt[k] for k in ("agentSigningKeyId", "agentEncryptionKeyId"))
        ):
            _deny()
    return p


def check_executor_retry(operation, original_receipt, *, expected_operation):
    """Exact original retry only, under separately rechecked current authorization."""
    op = validate_executor_schema("ExecutorOperation", operation)
    expected = validate_executor_schema("ExecutorOperation", expected_operation)
    receipt = validate_executor_schema("ExecutorReceipt", original_receipt)
    if op != expected or receipt["operation"] != expected:
        _deny()
    return receipt
