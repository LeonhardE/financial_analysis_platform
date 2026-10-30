"""Root-approved opaque archive maintenance and single-use recovery approvals.

This is a Hub-owned transport profile, not a new shared ControlCommand action.
Only public root proofs, ciphertext digests and immutable receipts are retained.
The owner must already possess the pinned root, through an unlocked archive or
an independently retained recovery copy; Google identity cannot recreate it.
"""

import re
import time

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .store import StoreUnavailable, document_path
from .vaults import _archive, _current, _fingerprint, identifier, positive

PROFILE = "folioview.vault-lifecycle.v1"
MAX_LIFECYCLE_OPERATIONS = 32
MAX_AUTHORIZATION_SECONDS = 300
MAX_COMMAND_BYTES = 8192
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_BASE_FIELDS = frozenset(
    {
        "profile",
        "contractVersion",
        "action",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "stableOperationId",
        "expectedVaultVersion",
        "expectedLifecycleVersion",
        "expectedArchiveRevision",
        "expectedArchiveDigest",
        "registrySequence",
        "checkpointDigest",
        "keyEpoch",
        "issuedAt",
        "expiresAt",
    }
)
_ACTION_FIELDS = {
    "archive_replace": frozenset({"mode", "newArchiveDigest", "authorizationId"}),
    "recovery_authorize": frozenset({"authorizationId", "newArchiveDigest"}),
    "recovery_revoke": frozenset({"authorizationId"}),
}
_RECEIPT_FIELDS = frozenset(
    {
        "profile",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "operationId",
        "action",
        "lifecycleVersion",
        "archiveRevision",
        "archiveDigest",
        "commandFingerprint",
        "acceptedAt",
    }
)
_ROW_FIELDS = frozenset({"ownerSubject", "vaultId", "rootKeyId", "initialArchiveDigest", "history"})
_FENCE_FIELDS = (
    "expectedVaultVersion",
    "registrySequence",
    "checkpointDigest",
    "keyEpoch",
)


def _digest(value):
    if type(value) is not str or _DIGEST.fullmatch(value) is None:
        raise ContractError("malformed_request")


def _payload(command, vault):
    if len(canonical_json(command)) > MAX_COMMAND_BYTES:
        raise ContractError("payload_too_large")
    value = verify_jws(
        command, vault["rootJwk"], typ="fv-control+jws", expected_kid=vault["rootKeyId"]
    )
    action = value.get("action")
    if (
        type(action) is not str
        or action not in _ACTION_FIELDS
        or set(value) != _BASE_FIELDS | _ACTION_FIELDS[action]
    ):
        raise ContractError("malformed_request")
    if value["profile"] != PROFILE:
        raise ContractError("unsupported_profile")
    if value["contractVersion"] != CONTRACT_VERSION:
        raise ContractError("unsupported_contract")
    if any(value[field] != vault[field] for field in ("ownerSubject", "vaultId", "rootKeyId")):
        raise ContractError("recipient_binding_mismatch")
    validate_schema("OperationIdentifier", value["stableOperationId"])
    for field in ("expectedVaultVersion", "registrySequence", "keyEpoch", "expiresAt"):
        positive(value[field])
    for field in ("expectedLifecycleVersion", "expectedArchiveRevision", "issuedAt"):
        positive(value[field], zero=True)
    _digest(value["expectedArchiveDigest"])
    _digest(value["checkpointDigest"])
    if not value["issuedAt"] < value["expiresAt"] <= value["issuedAt"] + MAX_AUTHORIZATION_SECONDS:
        raise ContractError("malformed_request")
    if action != "recovery_revoke":
        _digest(value["newArchiveDigest"])
    if action == "archive_replace":
        if value["mode"] not in ("rewrap", "passkey_change", "recovery"):
            raise ContractError("malformed_request")
        if value["mode"] != "recovery":
            if value["authorizationId"] is not None:
                raise ContractError("malformed_request")
        else:
            identifier(value["authorizationId"])
    else:
        identifier(value["authorizationId"])
    return value


def _advance(state, payload, command, accepted_at):
    """Apply signed public semantics both on new writes and on persisted history."""
    if not payload["issuedAt"] <= accepted_at < payload["expiresAt"]:
        raise ContractError("key_authorization_required")
    if accepted_at < state["lastAcceptedAt"]:
        raise ContractError("version_conflict")
    if (
        payload["expectedLifecycleVersion"] != state["version"]
        or payload["expectedArchiveRevision"] != state["revision"]
        or payload["expectedArchiveDigest"] != state["digest"]
    ):
        raise ContractError("version_conflict")
    action = payload["action"]
    pending = state["pending"]
    next_state = {
        **state,
        "version": state["version"] + 1,
        "lastAcceptedAt": accepted_at,
        "lastVaultVersion": payload["expectedVaultVersion"],
        "lastRegistrySequence": payload["registrySequence"],
    }
    if action == "recovery_authorize":
        # A newly granted approval must retain one slot to consume or revoke it.
        # The same rule is checked while authenticating stored history.
        if state["version"] >= MAX_LIFECYCLE_OPERATIONS - 1:
            raise ContractError("version_conflict")
        if payload["newArchiveDigest"] == state["digest"]:
            raise ContractError("recipient_binding_mismatch")
        if payload["authorizationId"] in state["authorizationIds"]:
            raise ContractError("version_conflict")
        if pending is not None and accepted_at < pending["payload"]["expiresAt"]:
            raise ContractError("version_conflict")
        next_state["pending"] = {"payload": payload, "command": command}
        next_state["authorizationIds"] = state["authorizationIds"] | {payload["authorizationId"]}
    elif action == "recovery_revoke":
        if pending is None or pending["payload"]["authorizationId"] != payload["authorizationId"]:
            raise ContractError("key_authorization_required")
        next_state["pending"] = None
    else:
        if payload["newArchiveDigest"] == state["digest"]:
            raise ContractError("recipient_binding_mismatch")
        if payload["mode"] == "recovery":
            if pending is None:
                raise ContractError("key_authorization_required")
            grant = pending["payload"]
            if (
                grant["authorizationId"] != payload["authorizationId"]
                or grant["newArchiveDigest"] != payload["newArchiveDigest"]
                or grant["expectedArchiveRevision"] != payload["expectedArchiveRevision"]
                or grant["expectedArchiveDigest"] != payload["expectedArchiveDigest"]
                or any(grant[field] != payload[field] for field in _FENCE_FIELDS)
                or not grant["issuedAt"] <= payload["issuedAt"] <= accepted_at < grant["expiresAt"]
                or payload["expiresAt"] > grant["expiresAt"]
            ):
                raise ContractError("key_authorization_required")
        next_state.update(
            revision=state["revision"] + 1,
            digest=payload["newArchiveDigest"],
            pending=None,
        )
    return next_state


def _receipt(vault, payload, state, command, accepted_at):
    return {
        "profile": PROFILE,
        "ownerSubject": vault["ownerSubject"],
        "vaultId": vault["vaultId"],
        "rootKeyId": vault["rootKeyId"],
        "operationId": payload["stableOperationId"],
        "action": payload["action"],
        "lifecycleVersion": state["version"],
        "archiveRevision": state["revision"],
        "archiveDigest": state["digest"],
        "commandFingerprint": signing_input_fingerprint(command),
        "acceptedAt": accepted_at,
    }


def _history_state(vault, registry, row):
    """Reverify the complete bounded root-approved history; corruption is unavailable."""
    current_digest = _fingerprint(vault["archive"])
    initial = (
        current_digest
        if row is None
        else row.get("initialArchiveDigest")
        if type(row) is dict
        else None
    )
    state = {
        "version": 0,
        "revision": 0,
        "digest": initial,
        "pending": None,
        "authorizationIds": set(),
        "operations": {},
        "lastAcceptedAt": 0,
        "lastVaultVersion": 0,
        "lastRegistrySequence": 0,
    }
    if row is None:
        return state
    try:
        if (
            type(row) is not dict
            or set(row) != _ROW_FIELDS
            or any(row[field] != vault[field] for field in ("ownerSubject", "vaultId", "rootKeyId"))
            or type(row["history"]) is not list
            or not 1 <= len(row["history"]) <= MAX_LIFECYCLE_OPERATIONS
        ):
            raise StoreUnavailable
        _digest(initial)
        # _current has already verified every bundle against this pinned root.
        checkpoints = {
            index: strict_json_loads(b64url_decode(bundle["checkpoint"]["payload"]))
            for index, bundle in enumerate(vault["registryHistory"], 1)
        }
        for item in row["history"]:
            if type(item) is not dict or set(item) != {"command", "receipt"}:
                raise StoreUnavailable
            payload = _payload(item["command"], vault)
            receipt = item["receipt"]
            if type(receipt) is not dict or set(receipt) != _RECEIPT_FIELDS:
                raise StoreUnavailable
            positive(receipt["acceptedAt"], zero=True)
            positive(receipt["lifecycleVersion"])
            positive(receipt["archiveRevision"], zero=True)
            if (
                not state["lastVaultVersion"] <= payload["expectedVaultVersion"] <= vault["version"]
                or not state["lastRegistrySequence"]
                <= payload["registrySequence"]
                <= registry.registry_sequence
            ):
                raise StoreUnavailable
            checkpoint = checkpoints[payload["registrySequence"]]
            if (
                payload["checkpointDigest"] != _fingerprint(checkpoint)
                or payload["keyEpoch"] != checkpoint["keyEpoch"]
                or payload["stableOperationId"] in state["operations"]
            ):
                raise StoreUnavailable
            advanced = _advance(state, payload, item["command"], receipt["acceptedAt"])
            if receipt != _receipt(
                vault, payload, advanced, item["command"], receipt["acceptedAt"]
            ):
                raise StoreUnavailable
            advanced["operations"] = {**state["operations"], payload["stableOperationId"]: item}
            state = advanced
        if state["digest"] != current_digest:
            raise StoreUnavailable
        return state
    except (ContractError, KeyError, TypeError, ValueError):
        raise StoreUnavailable from None


def _mutation_response(receipt):
    value = {"contractVersion": CONTRACT_VERSION, "profile": PROFILE, "receipt": receipt}
    check_read_response(value)
    return value


class VaultLifecycleService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock

    def now(self):
        value = self.clock()
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise StoreUnavailable
        return int(value)

    @staticmethod
    def _read(unit, owner, vault, now):
        row, registry = _current(unit, owner, now, vault)
        lifecycle = unit.get(document_path("hub_vault_lifecycle", owner, vault))
        return row, registry, lifecycle, _history_state(row, registry, lifecycle)

    def state(self, uid, vault):
        identifier(vault)
        owner = owner_key(uid)

        def read(unit):
            now = self.now()
            row, registry, lifecycle, state = self._read(unit, owner, vault, now)
            pending = state["pending"]
            if pending is not None:
                payload = pending["payload"]
                status = "active"
                if now >= payload["expiresAt"]:
                    status = "expired"
                elif (
                    payload["expectedVaultVersion"] != row["version"]
                    or payload["registrySequence"] != registry.registry_sequence
                    or payload["checkpointDigest"] != registry.checkpoint_digest
                    or payload["keyEpoch"] != registry.key_epoch
                ):
                    status = "stale"
                pending = {
                    "authorizationId": payload["authorizationId"],
                    "newArchiveDigest": payload["newArchiveDigest"],
                    "expiresAt": payload["expiresAt"],
                    "status": status,
                    "command": pending["command"],
                }
            value = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "vaultId": vault,
                "rootKeyId": row["rootKeyId"],
                "vaultVersion": row["version"],
                "registrySequence": registry.registry_sequence,
                "checkpointDigest": registry.checkpoint_digest,
                "keyEpoch": registry.key_epoch,
                "lifecycleVersion": state["version"],
                "archiveRevision": state["revision"],
                "archiveDigest": state["digest"],
                "archive": row["archive"],
                "pendingAuthorization": pending,
                "history": [] if lifecycle is None else lifecycle["history"],
            }
            check_read_response(value)
            return value

        return self.store.transact(read)

    def receipt(self, uid, vault, operation):
        identifier(vault)
        validate_schema("OperationIdentifier", operation)
        owner = owner_key(uid)

        def read(unit):
            _, _, _, state = self._read(unit, owner, vault, self.now())
            item = state["operations"].get(operation)
            if item is None:
                raise ContractError("not_found")
            return _mutation_response(item["receipt"])

        return self.store.transact(read)

    def replace_archive(self, uid, vault, body, operation):
        return self._mutate(uid, vault, body, operation, "archive_replace")

    def authorize_recovery(self, uid, vault, body, operation):
        return self._mutate(uid, vault, body, operation, "recovery_authorize")

    def revoke_recovery(self, uid, vault, authorization_id, body, operation):
        identifier(authorization_id)
        return self._mutate(
            uid, vault, body, operation, "recovery_revoke", authorization_id=authorization_id
        )

    def _mutate(self, uid, vault, body, operation, action, *, authorization_id=None):
        identifier(vault)
        validate_schema("OperationIdentifier", operation)
        fields = {"contractVersion", "command"}
        if action == "archive_replace":
            fields.add("archive")
        if (
            type(body) is not dict
            or set(body) != fields
            or body["contractVersion"] != CONTRACT_VERSION
        ):
            raise ContractError("malformed_request")
        owner = owner_key(uid)

        def update(unit):
            row, registry, lifecycle, state = self._read(unit, owner, vault, self.now())
            payload = _payload(body["command"], row)
            if payload["action"] != action:
                raise ContractError("malformed_request")
            if payload["stableOperationId"] != operation:
                raise ContractError("idempotency_conflict")
            if authorization_id is not None and payload["authorizationId"] != authorization_id:
                raise ContractError("recipient_binding_mismatch")
            if action == "archive_replace":
                _archive(body["archive"], owner=owner, vault=vault, root=row["rootKeyId"])
                if _fingerprint(body["archive"]) != payload["newArchiveDigest"]:
                    raise ContractError("recipient_binding_mismatch")
            prior = state["operations"].get(operation)
            if prior is not None:
                if (
                    signing_input_fingerprint(body["command"])
                    != prior["receipt"]["commandFingerprint"]
                ):
                    raise ContractError("idempotency_conflict")
                # A receipt is an immutable fact, not permission to restore old state.
                return _mutation_response(prior["receipt"])
            if state["version"] >= MAX_LIFECYCLE_OPERATIONS:
                raise ContractError("version_conflict")
            if payload["expectedVaultVersion"] != row["version"]:
                raise ContractError("version_conflict")
            if (
                payload["registrySequence"] != registry.registry_sequence
                or payload["checkpointDigest"] != registry.checkpoint_digest
                or payload["keyEpoch"] != registry.key_epoch
            ):
                raise ContractError("registry_conflict")
            if action == "archive_replace":
                archive = body["archive"]
                old = row["archive"]
                if archive["iv"] == old["iv"] or archive["ciphertext"] == old["ciphertext"]:
                    raise ContractError("recipient_binding_mismatch")
                if payload["mode"] == "rewrap":
                    if archive["credentialId"] != old["credentialId"]:
                        raise ContractError("recipient_binding_mismatch")
                elif (
                    archive["credentialId"] == old["credentialId"]
                    or archive["prfSalt"] == old["prfSalt"]
                ):
                    raise ContractError("recipient_binding_mismatch")
            now = self.now()
            advanced = _advance(state, payload, body["command"], now)
            receipt = _receipt(row, payload, advanced, body["command"], now)
            item = {"command": body["command"], "receipt": receipt}
            next_lifecycle = {
                "ownerSubject": owner,
                "vaultId": vault,
                "rootKeyId": row["rootKeyId"],
                "initialArchiveDigest": state["digest"]
                if lifecycle is None
                else lifecycle["initialArchiveDigest"],
                "history": [*([] if lifecycle is None else lifecycle["history"]), item],
            }
            response = _mutation_response(receipt)
            # Firestore reads are complete before either buffered write is flushed.
            if action == "archive_replace":
                unit.put(document_path("hub_vaults", owner), {**row, "archive": body["archive"]})
            unit.put(document_path("hub_vault_lifecycle", owner, vault), next_lifecycle)
            return response

        return self.store.transact(update)
