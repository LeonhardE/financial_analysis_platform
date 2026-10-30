"""Root-approved successor owner certificates plus one atomic opaque archive rewrap.

Certificate payloads and shared registry verification stay immutable. No private
key is accepted here; a later trusted client must retain historical reader keys.
"""

import math
import time
from collections.abc import Mapping

from folioview_shared.encrypted.authority import verify_registry
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .store import StoreUnavailable, document_path
from .vault_lifecycle import (
    MAX_COMMAND_BYTES,
    MAX_LIFECYCLE_OPERATIONS,
    VaultLifecycleService,
    _advance,
    _digest,
    _history_state,
)
from .vault_lifecycle import (
    _payload as archive_payload,
)
from .vault_lifecycle import (
    _receipt as archive_receipt,
)
from .vaults import (
    MAX_HISTORY,
    MAX_OPERATIONS,
    _archive,
    _fingerprint,
    _selection,
    _verify_row,
    identifier,
    positive,
)

PROFILE = "folioview.vault-key-renewal.v1"
MAX_CERTIFICATE_SECONDS = 31_536_000
_OWNER_ROLES = frozenset({"device_sig", "device_enc", "recovery_enc"})
_TARGET_FIELDS = frozenset(
    {"role", "principalId", "priorKeyId", "newKeyId", "priorKeyEpoch", "newKeyEpoch"}
)
_FIELDS = frozenset(
    {
        "profile",
        "contractVersion",
        "action",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "stableOperationId",
        "expectedVaultVersion",
        "registrySequence",
        "checkpointDigest",
        "keyEpoch",
        "expectedLifecycleVersion",
        "expectedArchiveRevision",
        "expectedArchiveDigest",
        "newCheckpointDigest",
        "newArchiveDigest",
        "archiveCommandFingerprint",
        "renewals",
        "issuedAt",
        "expiresAt",
    }
)
_COMMON = (
    "ownerSubject",
    "vaultId",
    "rootKeyId",
    "stableOperationId",
    "expectedVaultVersion",
    "registrySequence",
    "checkpointDigest",
    "keyEpoch",
    "expectedLifecycleVersion",
    "expectedArchiveRevision",
    "expectedArchiveDigest",
    "newArchiveDigest",
)
_RECORD_FIELDS = frozenset(
    {"profile", "ownerSubject", "vaultId", "rootKeyId", "command", "archiveCommand", "receipt"}
)


def _plain(value):
    if isinstance(value, Mapping):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [_plain(v) for v in value]
    return value


def _payload(command, row):
    if len(canonical_json(command)) > MAX_COMMAND_BYTES:
        raise ContractError("payload_too_large")
    p = verify_jws(command, row["rootJwk"], typ="fv-control+jws", expected_kid=row["rootKeyId"])
    if set(p) != _FIELDS:
        raise ContractError("malformed_request")
    if p["profile"] != PROFILE:
        raise ContractError("unsupported_profile")
    if p["contractVersion"] != CONTRACT_VERSION:
        raise ContractError("unsupported_contract")
    if p["action"] != "key_renewal":
        raise ContractError("malformed_request")
    if any(p[f] != row[f] for f in ("ownerSubject", "vaultId", "rootKeyId")):
        raise ContractError("recipient_binding_mismatch")
    validate_schema("OperationIdentifier", p["stableOperationId"])
    for f in ("expectedVaultVersion", "registrySequence", "keyEpoch", "expiresAt"):
        positive(p[f])
    for f in ("expectedLifecycleVersion", "expectedArchiveRevision", "issuedAt"):
        positive(p[f], zero=True)
    for f in (
        "checkpointDigest",
        "expectedArchiveDigest",
        "newCheckpointDigest",
        "newArchiveDigest",
        "archiveCommandFingerprint",
    ):
        _digest(p[f])
    if not p["issuedAt"] < p["expiresAt"] <= p["issuedAt"] + 300:
        raise ContractError("malformed_request")
    targets = p["renewals"]
    if type(targets) is not list or not 1 <= len(targets) <= 3:
        raise ContractError("malformed_request")
    roles, old, new, order = set(), set(), set(), []
    for t in targets:
        if (
            type(t) is not dict
            or set(t) != _TARGET_FIELDS
            or type(t["role"]) is not str
            or t["role"] not in _OWNER_ROLES
        ):
            raise ContractError("malformed_request")
        identifier(t["principalId"])
        for f in ("priorKeyId", "newKeyId"):
            validate_schema("KeyId", t[f])
        for f in ("priorKeyEpoch", "newKeyEpoch"):
            positive(t[f])
        if t["newKeyEpoch"] != t["priorKeyEpoch"] + 1:
            raise ContractError("stale_key_epoch")
        if t["role"] in roles or t["priorKeyId"] in old or t["newKeyId"] in new:
            raise ContractError("malformed_request")
        roles.add(t["role"])
        old.add(t["priorKeyId"])
        new.add(t["newKeyId"])
        order.append((t["role"], t["principalId"], t["priorKeyId"]))
    if (
        old & new
        or order != sorted(order)
        or roles not in ({"recovery_enc"}, {"device_sig", "device_enc"}, set(_OWNER_ROLES))
    ):
        raise ContractError("key_authorization_required")
    devices = [t["principalId"] for t in targets if t["role"].startswith("device_")]
    if len(set(devices)) > 1:
        raise ContractError("recipient_binding_mismatch")
    return p


def _commands(p, command, row):
    ap = archive_payload(command, row)
    if (
        ap["action"] != "archive_replace"
        or ap["mode"] != "rewrap"
        or ap["authorizationId"] is not None
    ):
        raise ContractError("recipient_binding_mismatch")
    if any(p[f] != ap[f] for f in _COMMON) or p[
        "archiveCommandFingerprint"
    ] != signing_input_fingerprint(command):
        raise ContractError("recipient_binding_mismatch")
    return ap


def _registries(row, now):
    result = []
    for bundle in row["registryHistory"]:
        result.append(
            verify_registry(
                bundle,
                root_jwk=row["rootJwk"],
                pinned_root_key_id=row["rootKeyId"],
                owner_subject=row["ownerSubject"],
                vault_id=row["vaultId"],
                now=now,
                previous=result[-1] if result else None,
            )
        )
    return result


def _fresh_keys(payload, registries):
    known = {kid for registry in registries for kid in registry.certificates}
    if any(target["newKeyId"] in known for target in payload["renewals"]):
        raise ContractError("registry_conflict")


def _delta(p, previous, next_registry, at):
    if (
        previous.registry_sequence != p["registrySequence"]
        or previous.checkpoint_digest != p["checkpointDigest"]
        or previous.key_epoch != p["keyEpoch"]
        or next_registry.registry_sequence != previous.registry_sequence + 1
        or next_registry.key_epoch != previous.key_epoch
        or next_registry.root_epoch != previous.root_epoch
        or next_registry.checkpoint_digest != p["newCheckpointDigest"]
    ):
        raise ContractError("registry_conflict")
    old_ids = {t["priorKeyId"] for t in p["renewals"]}
    new_ids = {t["newKeyId"] for t in p["renewals"]}
    if set(next_registry.certificates) != set(previous.certificates) | new_ids or new_ids & set(
        previous.certificates
    ):
        raise ContractError("registry_conflict")
    if (
        set(next_registry.revoked_key_ids) != set(previous.revoked_key_ids) | old_ids
        or set(next_registry.active_key_ids) != (set(previous.active_key_ids) - old_ids) | new_ids
    ):
        raise ContractError("key_authorization_required")
    for kid, old in previous.certificates.items():
        if canonical_json(_plain(old)) != canonical_json(_plain(next_registry.certificates[kid])):
            raise ContractError("registry_conflict")
    for t in p["renewals"]:
        old = previous.certificates.get(t["priorKeyId"])
        new = next_registry.certificates.get(t["newKeyId"])
        if (
            old is None
            or new is None
            or t["priorKeyId"] not in previous.active_key_ids
            or t["priorKeyId"] in previous.revoked_key_ids
        ):
            raise ContractError("key_authorization_required")
        identity = (t["principalId"], t["role"], None)
        if (
            old["keyEpoch"] != previous.local_key_epochs.get(identity)
            or old["keyEpoch"] != t["priorKeyEpoch"]
            or new["keyEpoch"] != t["newKeyEpoch"]
        ):
            raise ContractError("stale_key_epoch")
        if (
            any(old[f] != new[f] for f in ("role", "principalId", "connectionId", "capabilities"))
            or old["role"] != t["role"]
            or old["principalId"] != t["principalId"]
            or old["connectionId"] is not None
        ):
            raise ContractError("recipient_binding_mismatch")
        if not (
            p["issuedAt"] - 300 <= new["notBefore"] <= p["issuedAt"] <= at < new["expiresAt"]
            and new["expiresAt"] > old["expiresAt"]
            and new["expiresAt"] - new["notBefore"] <= MAX_CERTIFICATE_SECONDS
        ):
            raise ContractError("key_authorization_required")
    _selection(next_registry, at)


def _result(receipt):
    result = {"contractVersion": CONTRACT_VERSION, "profile": PROFILE, "receipt": receipt}
    check_read_response(result)
    return result


def _receipt(row, p, registry, state, command, at):
    return {
        "profile": PROFILE,
        "ownerSubject": row["ownerSubject"],
        "vaultId": row["vaultId"],
        "rootKeyId": row["rootKeyId"],
        "operationId": p["stableOperationId"],
        "vaultVersion": p["expectedVaultVersion"] + 1,
        "registrySequence": registry.registry_sequence,
        "checkpointDigest": registry.checkpoint_digest,
        "keyEpoch": registry.key_epoch,
        "lifecycleVersion": state["version"],
        "archiveRevision": state["revision"],
        "archiveDigest": state["digest"],
        "renewals": p["renewals"],
        "commandFingerprint": signing_input_fingerprint(command),
        "archiveCommandFingerprint": p["archiveCommandFingerprint"],
        "acceptedAt": at,
    }


class VaultKeyRenewalService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock

    def now(self):
        value = self.clock()
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or (isinstance(value, float) and not math.isfinite(value))
            or value < 0
        ):
            raise StoreUnavailable
        return int(value)

    @staticmethod
    def _path(owner, operation):
        return document_path("hub_operations", owner, "key-renewal", operation)

    def state(self, uid, vault):
        identifier(vault)
        owner = owner_key(uid)

        def read(unit):
            now = self.now()
            row, registry, _, state = VaultLifecycleService._read(unit, owner, vault, now)
            certificates = []
            for kid in sorted(registry.certificates):
                c = registry.certificates[kid]
                if c["role"] not in _OWNER_ROLES:
                    continue
                status = "active"
                if kid in registry.revoked_key_ids:
                    status = "revoked"
                elif c["keyEpoch"] != registry.local_key_epochs.get(
                    (c["principalId"], c["role"], None)
                ):
                    status = "superseded"
                elif now < c["notBefore"]:
                    status = "not_yet_valid"
                elif now >= c["expiresAt"]:
                    status = "expired"
                certificates.append(
                    {
                        "keyId": kid,
                        "role": c["role"],
                        "principalId": c["principalId"],
                        "keyEpoch": c["keyEpoch"],
                        "notBefore": c["notBefore"],
                        "expiresAt": c["expiresAt"],
                        "status": status,
                    }
                )
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "vaultId": vault,
                "rootKeyId": row["rootKeyId"],
                "rootAnchorExpiresAt": None,
                "vaultVersion": row["version"],
                "registrySequence": registry.registry_sequence,
                "checkpointDigest": registry.checkpoint_digest,
                "keyEpoch": registry.key_epoch,
                "lifecycleVersion": state["version"],
                "archiveRevision": state["revision"],
                "archiveDigest": state["digest"],
                "pendingRecoveryAuthorization": state["pending"] is not None,
                "certificates": certificates,
            }
            check_read_response(result)
            return result

        return self.store.transact(read)

    def _stored(self, saved, row, state, registries, operation):
        try:
            if (
                type(saved) is not dict
                or set(saved) != _RECORD_FIELDS
                or saved["profile"] != PROFILE
                or any(saved[f] != row[f] for f in ("ownerSubject", "vaultId", "rootKeyId"))
            ):
                raise StoreUnavailable
            p = _payload(saved["command"], row)
            ap = _commands(p, saved["archiveCommand"], row)
            if p["stableOperationId"] != operation or not 1 <= p["registrySequence"] < len(
                registries
            ):
                raise StoreUnavailable
            at = saved["receipt"]["acceptedAt"]
            positive(at, zero=True)
            if not (
                p["issuedAt"] <= at < p["expiresAt"] and ap["issuedAt"] <= at < ap["expiresAt"]
            ):
                raise StoreUnavailable
            previous, next_registry = registries[
                p["registrySequence"] - 1 : p["registrySequence"] + 1
            ]
            _fresh_keys(p, registries[: p["registrySequence"]])
            _delta(p, previous, next_registry, at)
            item = state["operations"].get(operation)
            if (
                item is None
                or signing_input_fingerprint(item["command"]) != p["archiveCommandFingerprint"]
                or item["receipt"]["acceptedAt"] != at
            ):
                raise StoreUnavailable
            expected_state = {
                "version": item["receipt"]["lifecycleVersion"],
                "revision": item["receipt"]["archiveRevision"],
                "digest": item["receipt"]["archiveDigest"],
            }
            if saved["receipt"] != _receipt(
                row, p, next_registry, expected_state, saved["command"], at
            ):
                raise StoreUnavailable
            return p, _result(saved["receipt"])
        except (ContractError, KeyError, TypeError, ValueError, IndexError):
            raise StoreUnavailable from None

    def receipt(self, uid, vault, operation):
        identifier(vault)
        validate_schema("OperationIdentifier", operation)
        owner = owner_key(uid)

        def read(unit):
            now = self.now()
            row, _, _, state = VaultLifecycleService._read(unit, owner, vault, now)
            saved = unit.get(self._path(owner, operation))
            if saved is None:
                raise ContractError("not_found")
            return self._stored(saved, row, state, _registries(row, now), operation)[1]

        return self.store.transact(read)

    def renew(self, uid, vault, body, operation):
        identifier(vault)
        validate_schema("OperationIdentifier", operation)
        if (
            type(body) is not dict
            or set(body)
            != {"contractVersion", "registryBundle", "archive", "command", "archiveCommand"}
            or body["contractVersion"] != CONTRACT_VERSION
        ):
            raise ContractError("malformed_request")
        owner = owner_key(uid)

        def update(unit):
            now = self.now()
            row, current, lifecycle, state = VaultLifecycleService._read(unit, owner, vault, now)
            p = _payload(body["command"], row)
            ap = _commands(p, body["archiveCommand"], row)
            if p["stableOperationId"] != operation:
                raise ContractError("idempotency_conflict")
            _archive(body["archive"], owner=owner, vault=vault, root=row["rootKeyId"])
            if _fingerprint(body["archive"]) != p["newArchiveDigest"]:
                raise ContractError("recipient_binding_mismatch")
            saved = unit.get(self._path(owner, operation))
            registries = _registries(row, now)
            if saved is not None:
                prior, response = self._stored(saved, row, state, registries, operation)
                if (
                    signing_input_fingerprint(body["command"])
                    != signing_input_fingerprint(saved["command"])
                    or p["archiveCommandFingerprint"] != prior["archiveCommandFingerprint"]
                ):
                    raise ContractError("idempotency_conflict")
                previous = registries[p["registrySequence"] - 1]
                proposed = verify_registry(
                    body["registryBundle"],
                    root_jwk=row["rootJwk"],
                    pinned_root_key_id=row["rootKeyId"],
                    owner_subject=owner,
                    vault_id=vault,
                    now=now,
                    previous=previous,
                )
                _delta(p, previous, proposed, saved["receipt"]["acceptedAt"])
                return response
            if operation in state["operations"]:
                raise ContractError("idempotency_conflict")
            if row["version"] != p["expectedVaultVersion"]:
                raise ContractError("version_conflict")
            if (
                p["registrySequence"] != current.registry_sequence
                or p["checkpointDigest"] != current.checkpoint_digest
                or p["keyEpoch"] != current.key_epoch
            ):
                raise ContractError("registry_conflict")
            if (
                p["expectedLifecycleVersion"] != state["version"]
                or p["expectedArchiveRevision"] != state["revision"]
                or p["expectedArchiveDigest"] != state["digest"]
            ):
                raise ContractError("version_conflict")
            if state["pending"] is not None:
                raise ContractError("key_authorization_required")
            if (
                len(row["registryHistory"]) >= MAX_HISTORY
                or row["operationCount"] >= MAX_OPERATIONS
                or state["version"] >= MAX_LIFECYCLE_OPERATIONS
            ):
                raise ContractError("version_conflict")
            proposed = verify_registry(
                body["registryBundle"],
                root_jwk=row["rootJwk"],
                pinned_root_key_id=row["rootKeyId"],
                owner_subject=owner,
                vault_id=vault,
                now=now,
                previous=current,
            )
            _fresh_keys(p, registries)
            _delta(p, current, proposed, now)
            old, new = row["archive"], body["archive"]
            if any(new[f] != old[f] for f in ("credentialId", "prfSalt")) or any(
                new[f] == old[f] for f in ("iv", "ciphertext")
            ):
                raise ContractError("recipient_binding_mismatch")
            next_row = {
                **row,
                "archive": new,
                "registryHistory": [*row["registryHistory"], body["registryBundle"]],
                "version": row["version"] + 1,
                "operationCount": row["operationCount"] + 1,
            }
            _verify_row(next_row, owner, now)
            advanced = _advance(state, ap, body["archiveCommand"], now)
            ar = archive_receipt(row, ap, advanced, body["archiveCommand"], now)
            next_lifecycle = {
                "ownerSubject": owner,
                "vaultId": vault,
                "rootKeyId": row["rootKeyId"],
                "initialArchiveDigest": state["digest"]
                if lifecycle is None
                else lifecycle["initialArchiveDigest"],
                "history": [
                    *([] if lifecycle is None else lifecycle["history"]),
                    {"command": body["archiveCommand"], "receipt": ar},
                ],
            }
            _history_state(next_row, proposed, next_lifecycle)
            # All signatures/history and buffered-read work finish before the final
            # clock fence. Rebuild only the final acceptance timestamp afterwards.
            accepted_at = self.now()
            if not (
                now <= accepted_at
                and p["issuedAt"] <= accepted_at < p["expiresAt"]
                and ap["issuedAt"] <= accepted_at < ap["expiresAt"]
            ):
                raise ContractError("key_authorization_required")
            _delta(p, current, proposed, accepted_at)
            advanced = _advance(state, ap, body["archiveCommand"], accepted_at)
            next_lifecycle["history"][-1]["receipt"] = archive_receipt(
                row, ap, advanced, body["archiveCommand"], accepted_at
            )
            receipt = _receipt(row, p, proposed, advanced, body["command"], accepted_at)
            response = _result(receipt)
            record = {
                "profile": PROFILE,
                "ownerSubject": owner,
                "vaultId": vault,
                "rootKeyId": row["rootKeyId"],
                "command": body["command"],
                "archiveCommand": body["archiveCommand"],
                "receipt": receipt,
            }
            unit.put(document_path("hub_vaults", owner), next_row)
            unit.put(document_path("hub_vault_lifecycle", owner, vault), next_lifecycle)
            unit.put(self._path(owner, operation), record)
            return response

        return self.store.transact(update)
