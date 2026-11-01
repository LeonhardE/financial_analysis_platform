"""Owner-controlled public authority and opaque passkey archive, never content keys."""

import hashlib
import re
import time

from folioview_shared.encrypted.authority import verify_control_command, verify_registry
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import jwk_thumbprint, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .fences import _state
from .store import StoreUnavailable, document_path

MAX_SOURCES = 10
MAX_HISTORY = 32
MAX_OPERATIONS = 64
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
_VAULT_FIELDS = frozenset(
    {
        "ownerSubject",
        "vaultId",
        "rootJwk",
        "rootKeyId",
        "registryHistory",
        "archive",
        "version",
        "sources",
        "operationCount",
    }
)
_ARCHIVE_FIELDS = frozenset(
    {
        "profile",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "credentialId",
        "prfSalt",
        "iv",
        "ciphertext",
    }
)


def identifier(value):
    if type(value) is not str or _ID.fullmatch(value) is None:
        raise ContractError("malformed_request")


def positive(value, *, zero=False):
    if type(value) is not int or not (0 if zero else 1) <= value <= 9_007_199_254_740_991:
        raise ContractError("malformed_request")


def _archive(value, *, owner, vault, root):
    if type(value) is not dict or set(value) != _ARCHIVE_FIELDS:
        raise ContractError("malformed_request")
    if (
        value["profile"] != "folioview.passkey-vault.v1"
        or value["ownerSubject"] != owner
        or value["vaultId"] != vault
        or value["rootKeyId"] != root
    ):
        raise ContractError("recipient_binding_mismatch")
    for field, minimum, maximum in (
        ("credentialId", 1, 1536),
        ("prfSalt", 32, 32),
        ("iv", 12, 12),
        ("ciphertext", 16, 24576),
    ):
        text = value[field]
        if (
            type(text) is not str
            or (field == "credentialId" and len(text) > 2048)
            or (field == "ciphertext" and len(text) > 32768)
        ):
            raise ContractError("malformed_request")
        raw = b64url_decode(text, max_bytes=maximum)
        if not minimum <= len(raw) <= maximum:
            raise ContractError("malformed_request")
    return value


def _selection(registry, now):
    writers, recipients, roles = [], [], set()
    for kid in sorted(registry.active_key_ids):
        try:
            cert = registry.cert(kid, connection_id=None, now=now)
        except ContractError:
            continue
        if cert["role"] == "device_sig" and "object_write" in cert["capabilities"]:
            writers.append(kid)
        if cert["role"] in {"device_enc", "recovery_enc"}:
            recipients.append(kid)
            roles.add(cert["role"])
    if (
        not 1 <= len(writers) <= 8
        or not 2 <= len(recipients) <= 8
        or roles != {"device_enc", "recovery_enc"}
    ):
        raise ContractError("key_authorization_required")
    return writers, recipients


def _verify_row(row, owner, now):
    if type(row) is not dict or set(row) != _VAULT_FIELDS or row["ownerSubject"] != owner:
        raise StoreUnavailable
    identifier(row["vaultId"])
    positive(row["version"])
    if type(row["operationCount"]) is not int or not 1 <= row["operationCount"] <= MAX_OPERATIONS:
        raise StoreUnavailable
    validate_schema("PublicJWK", row["rootJwk"])
    if jwk_thumbprint(row["rootJwk"]) != row["rootKeyId"]:
        raise StoreUnavailable
    _archive(row["archive"], owner=owner, vault=row["vaultId"], root=row["rootKeyId"])
    history = row["registryHistory"]
    if type(history) is not list or not 1 <= len(history) <= MAX_HISTORY:
        raise StoreUnavailable
    registry = None
    for bundle in history:
        registry = verify_registry(
            bundle,
            root_jwk=row["rootJwk"],
            pinned_root_key_id=row["rootKeyId"],
            owner_subject=owner,
            vault_id=row["vaultId"],
            now=now,
            previous=registry,
        )
    first = verify_registry(
        history[0],
        root_jwk=row["rootJwk"],
        pinned_root_key_id=row["rootKeyId"],
        owner_subject=owner,
        vault_id=row["vaultId"],
        now=now,
    )
    if (first.root_epoch, first.registry_sequence, first.key_epoch) != (1, 1, 1):
        raise StoreUnavailable
    if type(row["sources"]) is not list or len(row["sources"]) > MAX_SOURCES:
        raise StoreUnavailable
    seen = set()
    for source in row["sources"]:
        if (
            type(source) is not dict
            or set(source) != {"resourceRef", "sourceEpoch"}
            or type(source["sourceEpoch"]) is not int
            or source["sourceEpoch"] != 1
        ):
            raise StoreUnavailable
        ref = source["resourceRef"]
        validate_schema("ResourceRef", ref)
        if (
            ref["kind"] != "holdings"
            or ref["sourceService"] != "portfolio"
            or ref["resourceId"] in seen
        ):
            raise StoreUnavailable
        seen.add(ref["resourceId"])
    if (
        row["version"] != len(history) + len(row["sources"])
        or row["operationCount"] != row["version"]
    ):
        raise StoreUnavailable
    return registry


def _current(unit, owner, now, vault=None):
    row = unit.get(document_path("hub_vaults", owner))
    if row is None:
        raise ContractError("not_found")
    registry = _verify_row(row, owner, now)
    if vault is not None and row["vaultId"] != vault:
        raise ContractError("not_found")
    return row, registry


def _source_projection(unit, owner, source):
    # The vault row retains the immutable creation anchor at epoch 1. Source
    # invalidation lives in its own namespace and must be read in this same
    # transaction, including on operation replays and registry-only responses.
    return {
        "resourceRef": source["resourceRef"],
        "sourceEpoch": _state(unit, owner, source["resourceRef"])["sourceEpoch"],
    }


def _response(row, unit):
    if row is None:
        return {"contractVersion": CONTRACT_VERSION, "vault": None, "sources": []}
    value = {
        "contractVersion": CONTRACT_VERSION,
        "vault": {
            field: row[field]
            for field in (
                "vaultId",
                "rootJwk",
                "rootKeyId",
                "registryHistory",
                "archive",
                "version",
            )
        },
        "sources": [
            _source_projection(unit, row["ownerSubject"], source) for source in row["sources"]
        ],
    }
    check_read_response(value)
    return value


def _fingerprint(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _operation(unit, owner, kind, operation, fingerprint):
    validate_schema("OperationIdentifier", operation)
    path = document_path("hub_operations", owner, kind, operation)
    saved = unit.get(path)
    if saved is not None:
        if (
            type(saved) is not dict
            or set(saved) != {"ownerSubject", "kind", "fingerprint"}
            or saved["ownerSubject"] != owner
            or saved["kind"] != kind
        ):
            raise StoreUnavailable
        if saved["fingerprint"] != fingerprint:
            raise ContractError("idempotency_conflict")
    return path, saved is not None


def _record(unit, path, owner, kind, fingerprint):
    unit.put(path, {"ownerSubject": owner, "kind": kind, "fingerprint": fingerprint})


class VaultService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock

    def now(self):
        value = self.clock()
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise StoreUnavailable
        return int(value)

    def current(self, uid):
        owner = owner_key(uid)

        def read(unit):
            row = unit.get(document_path("hub_vaults", owner))
            if row is not None:
                _verify_row(row, owner, self.now())
            return _response(row, unit)

        return self.store.transact(read)

    def bootstrap(self, uid, body, operation):
        owner = owner_key(uid)
        if (
            type(body) is not dict
            or set(body)
            != {"contractVersion", "vaultId", "rootJwk", "rootKeyId", "registryBundle", "archive"}
            or body["contractVersion"] != CONTRACT_VERSION
        ):
            raise ContractError("malformed_request")
        identifier(body["vaultId"])
        validate_schema("PublicJWK", body["rootJwk"])
        validate_schema("KeyId", body["rootKeyId"])
        if jwk_thumbprint(body["rootJwk"]) != body["rootKeyId"]:
            raise ContractError("recipient_binding_mismatch")
        _archive(body["archive"], owner=owner, vault=body["vaultId"], root=body["rootKeyId"])
        registry = verify_registry(
            body["registryBundle"],
            root_jwk=body["rootJwk"],
            pinned_root_key_id=body["rootKeyId"],
            owner_subject=owner,
            vault_id=body["vaultId"],
            now=self.now(),
        )
        if (registry.root_epoch, registry.registry_sequence, registry.key_epoch) != (1, 1, 1):
            raise ContractError("registry_conflict")
        _selection(registry, self.now())
        fingerprint = _fingerprint(body)

        def create(unit):
            path = document_path("hub_vaults", owner)
            existing = unit.get(path)
            op_path, replay = _operation(unit, owner, "bootstrap", operation, fingerprint)
            if existing is not None:
                _verify_row(existing, owner, self.now())
                if (
                    replay
                    and existing["rootKeyId"] == body["rootKeyId"]
                    and existing["vaultId"] == body["vaultId"]
                ):
                    return _response(existing, unit)
                raise ContractError("version_conflict")
            if replay:
                raise StoreUnavailable
            row = {
                "ownerSubject": owner,
                "vaultId": body["vaultId"],
                "rootJwk": body["rootJwk"],
                "rootKeyId": body["rootKeyId"],
                "registryHistory": [body["registryBundle"]],
                "archive": body["archive"],
                "version": 1,
                "sources": [],
                "operationCount": 1,
            }
            result = _response(row, unit)
            unit.put(path, row)
            _record(unit, op_path, owner, "bootstrap", fingerprint)
            return result

        return self.store.transact(create)

    def update_registry(self, uid, vault, body, operation):
        identifier(vault)
        if (
            type(body) is not dict
            or set(body) != {"contractVersion", "expectedVersion", "registryBundle"}
            or body["contractVersion"] != CONTRACT_VERSION
        ):
            raise ContractError("malformed_request")
        positive(body["expectedVersion"])
        owner, fingerprint = owner_key(uid), _fingerprint({"vaultId": vault, **body})

        def update(unit):
            row, current = _current(unit, owner, self.now(), vault)
            op_path, replay = _operation(unit, owner, "registry", operation, fingerprint)
            if replay:
                return _response(row, unit)
            if row["version"] != body["expectedVersion"]:
                raise ContractError("version_conflict")
            if (
                len(row["registryHistory"]) >= MAX_HISTORY
                or row["operationCount"] >= MAX_OPERATIONS
            ):
                raise ContractError("version_conflict")
            next_registry = verify_registry(
                body["registryBundle"],
                root_jwk=row["rootJwk"],
                pinned_root_key_id=row["rootKeyId"],
                owner_subject=owner,
                vault_id=vault,
                now=self.now(),
                previous=current,
            )
            if next_registry.registry_sequence != current.registry_sequence + 1:
                raise ContractError("registry_conflict")
            # No plaintext key/secret input or owner-recipient widening is accepted.
            _selection(next_registry, self.now())
            next_row = {
                **row,
                "version": row["version"] + 1,
                "operationCount": row["operationCount"] + 1,
                "registryHistory": [*row["registryHistory"], body["registryBundle"]],
            }
            result = _response(next_row, unit)
            unit.put(document_path("hub_vaults", owner), next_row)
            _record(unit, op_path, owner, "registry", fingerprint)
            return result

        return self.store.transact(update)

    def create_source(self, uid, vault, source, body, operation, author):
        identifier(vault)
        identifier(source)
        validate_schema("KeyId", author)
        if (
            type(body) is not dict
            or set(body) != {"contractVersion", "command"}
            or body["contractVersion"] != CONTRACT_VERSION
        ):
            raise ContractError("malformed_request")
        owner = owner_key(uid)

        def create(unit):
            row, registry = _current(unit, owner, self.now(), vault)
            certificate = registry.cert(
                author, role="device_sig", connection_id=None, now=self.now()
            )
            verify_jws(
                body["command"], certificate["publicJwk"], typ="fv-control+jws", expected_kid=author
            )
            command = verify_control_command(
                body["command"],
                registry=registry,
                expected_action="manual_source_create",
                expected_target_id=source,
                expected_version=0,
                expected_source_epoch=None,
                expected_parameters={},
                now=self.now(),
            )
            if command["stableOperationId"] != operation:
                raise ContractError("idempotency_conflict")
            digest = signing_input_fingerprint(body["command"])
            fingerprint = _fingerprint(
                {"vaultId": vault, "sourceId": source, "commandFingerprint": digest}
            )
            op_path, replay = _operation(unit, owner, "source", operation, fingerprint)
            existing = next(
                (item for item in row["sources"] if item["resourceRef"]["resourceId"] == source),
                None,
            )
            if replay:
                if existing is None:
                    raise StoreUnavailable
                return {
                    "contractVersion": CONTRACT_VERSION,
                    "source": _source_projection(unit, owner, existing),
                }
            if (
                existing is not None
                or len(row["sources"]) >= MAX_SOURCES
                or row["operationCount"] >= MAX_OPERATIONS
            ):
                raise ContractError("version_conflict")
            ref = {
                "kind": "holdings",
                "sourceService": "portfolio",
                "resourceId": source,
                "incarnation": "inc_" + digest[:32],
            }
            selected = {"resourceRef": ref, "sourceEpoch": 1}
            next_row = {
                **row,
                "version": row["version"] + 1,
                "operationCount": row["operationCount"] + 1,
                "sources": [*row["sources"], selected],
            }
            projected = _source_projection(unit, owner, selected)
            unit.put(document_path("hub_vaults", owner), next_row)
            _record(unit, op_path, owner, "source", fingerprint)
            return {"contractVersion": CONTRACT_VERSION, "source": projected}

        return self.store.transact(create)

    def authority(self, uid, source):
        identifier(source)
        owner = owner_key(uid)

        def read(unit):
            row, registry = _current(unit, owner, self.now())
            selected = next(
                (item for item in row["sources"] if item["resourceRef"]["resourceId"] == source),
                None,
            )
            if selected is None:
                raise ContractError("not_found")
            selected = _source_projection(unit, owner, selected)
            writers, recipients = _selection(registry, self.now())
            value = {
                "version": row["version"],
                "ownerSubject": owner,
                "sourceId": source,
                "vaultId": row["vaultId"],
                "rootJwk": row["rootJwk"],
                "rootKeyId": row["rootKeyId"],
                "registryHistory": row["registryHistory"],
                "resourceRef": selected["resourceRef"],
                "sourceEpoch": selected["sourceEpoch"],
                "active": True,
                "writerKeyIds": writers,
                "recipientKeyIds": recipients,
            }
            check_read_response(value)
            return {"contractVersion": CONTRACT_VERSION, "authority": value}

        return self.store.transact(read)
