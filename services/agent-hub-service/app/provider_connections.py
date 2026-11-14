"""Reviewed unique-provider cutover in the existing Hub transaction/store.

No automatic account migration, permission union, content rewrite or scheduling.
The write gate is independent of permanent fences on already installed slots.
"""

import copy

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.persistent_agents import validate_persistent_schema
from folioview_shared.encrypted.provider_connections import (
    PROVIDER_CONNECTION_PROFILE,
    check_provider_operation_replay,
    prepare_provider_activation,
    prepare_provider_disconnect,
    provider_slot_id,
    require_current_provider_credential,
    validate_provider_connection_schema,
    validate_provider_slot,
)
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .agent_credentials import AgentCredentialService
from .native_transport import NativeConnectionOwnerService
from .oauth import MAX_CONNECTIONS
from .persistent_agents import identity_path, linked_connection, snapshot, stored_identity
from .store import StoreUnavailable, document_path
from .vaults import _current, identifier

SUMMARY_PROFILE = "folioview.provider-connection-summary.v1"


def _provider_projection(row, records, blockers):
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": PROVIDER_CONNECTION_PROFILE,
        "slot": None if row is None else row["slot"],
        "retainedSelections": [] if row is None else row["retainedSelections"],
        "retirementCandidates": [r["reference"] for r in records],
        "legacyBlockers": blockers,
        "requiresFreshGrants": True,
    }


def slot_path(owner, provider):
    return document_path("hub_provider_slots", owner, provider_slot_id(owner, provider))


def operation_path(owner, vault, provider, operation):
    validate_schema("OperationIdentifier", operation)
    return document_path("hub_provider_slot_operations", owner, vault, provider, operation)


def command_identity(command):
    """JWS signature variants keep identity; opaque activation/review stay exact."""
    value = snapshot(command)
    value["approval"] = signing_input_fingerprint(value["approval"])
    child = value.get("credential")
    if type(child) is dict:
        for field in ("binding", "approval"):
            if field in child:
                child[field] = signing_input_fingerprint(child[field])
    return canonical_json(value)


def stored_slot(unit, owner, vault, provider):
    row = unit.get(slot_path(owner, provider))
    if row is None:
        return None
    if type(row) is dict and type(row.get("slot")) is dict and row["slot"].get("vaultId") != vault:
        raise ContractError("version_conflict")
    try:
        if type(row) is not dict or set(row) != {"slot", "retainedSelections", "operationId"}:
            raise StoreUnavailable
        validate_provider_slot(row["slot"], owner_subject=owner, vault_id=vault, provider=provider)
        validate_schema("OperationIdentifier", row["operationId"])
        if type(row["retainedSelections"]) is not list or len(row["retainedSelections"]) > 100:
            raise StoreUnavailable
        for selection in row["retainedSelections"]:
            validate_provider_connection_schema("ProviderTaskSelection", selection)
    except (ContractError, KeyError, TypeError):
        raise StoreUnavailable from None
    return row


def require_provider_current(unit, owner, vault, connection, conn, row, now):
    """No extra read for unmigrated connections; installed markers never fail open."""
    marker = conn.get("providerSlotId")
    if marker is None:
        return
    if marker != provider_slot_id(owner, conn["provider"]):
        raise StoreUnavailable
    current = stored_slot(unit, owner, vault, conn["provider"])
    if current is None or "credentialLease" not in row:
        raise StoreUnavailable
    require_current_provider_credential(
        current["slot"],
        row["credentialLease"],
        identity=row["identity"],
        owner_subject=owner,
        vault_id=vault,
        provider=conn["provider"],
        audience=row["credentialLease"]["audience"],
        now=now,
    )


class _ReadSnapshot:
    """Prefetch independent display reads in this same transaction only."""

    def __init__(self, unit, paths):
        self.unit = unit
        self.rows = unit.get_many(paths)

    def get(self, path):
        return copy.deepcopy(self.rows[path]) if path in self.rows else self.unit.get(path)

    def get_many(self, paths, *, field_paths=None):
        if field_paths is not None:
            return self.unit.get_many(paths, field_paths=field_paths)
        missing = [path for path in paths if path not in self.rows]
        values = self.unit.get_many(missing) if missing else {}
        return {
            path: copy.deepcopy(self.rows[path] if path in self.rows else values[path])
            for path in paths
        }

    def __getattr__(self, name):
        return getattr(self.unit, name)


class ProviderConnectionService(AgentCredentialService):
    def inventory(self, unit, owner, vault, provider, current, *, batch=False):
        index = unit.get(document_path("hub_oauth_owners", owner))
        if index is None or index.get("ownerSubject") != owner:
            raise ContractError("not_found")
        ids = index.get("connectionIds")
        if type(ids) is not list or len(ids) > MAX_CONNECTIONS or len(set(ids)) != len(ids):
            raise StoreUnavailable
        records, blockers = [], []
        last = None if current is None else current["slot"]["currentCredential"]
        for connection in ids:
            identifier(connection)
        if batch and ids:
            unit = _ReadSnapshot(
                unit,
                [document_path("hub_oauth_connections", owner, connection) for connection in ids],
            )
        candidates = []
        for connection in ids:
            conn = unit.get(document_path("hub_oauth_connections", owner, connection))
            if (
                conn is None
                or conn.get("ownerSubject") != owner
                or conn.get("connectionId") != connection
            ):
                raise StoreUnavailable
            if conn.get("provider") != provider:
                continue
            retain_current = last is not None and last["connectionId"] == connection
            if conn.get("status") != "active" and not retain_current:
                continue
            if conn.get("vaultId") != vault:
                blockers.append(connection)
                continue
            candidates.append(connection)
        if batch and candidates:
            unit = _ReadSnapshot(
                unit, [identity_path(owner, vault, connection) for connection in candidates]
            )
        for connection in candidates:
            linked_connection(unit, owner, vault, connection)
            row = stored_identity(unit, owner, vault, connection)
            if row is None:
                continue  # Native bootstrap without an identity is not content authority.
            if "credentialLease" not in row:
                blockers.append(
                    connection
                )  # Explicit existing disconnect/regrant, never synthetic leases.
                continue
            lease = row["credentialLease"]
            records.append(
                {
                    "ownerSubject": owner,
                    "vaultId": vault,
                    "provider": provider,
                    "reference": {
                        "connectionId": connection,
                        "clientId": lease["clientId"],
                        "credentialGeneration": lease["generation"],
                        "credentialFingerprint": lease["credentialFingerprint"],
                    },
                }
            )
        return sorted(records, key=lambda r: r["reference"]["connectionId"]), sorted(blockers)

    def state(self, uid, vault, provider):
        owner = owner_key(uid)
        provider_slot_id(owner, provider)
        identifier(vault)

        def read(unit):
            unit = _ReadSnapshot(
                unit,
                [
                    document_path("hub_vaults", owner),
                    slot_path(owner, provider),
                    document_path("hub_oauth_owners", owner),
                ],
            )
            _current(unit, owner, self.now(), vault)
            return self._provider_state(unit, owner, vault, provider)

        return self.store.transact(read)

    def _provider_state(self, unit, owner, vault, provider):
        row = stored_slot(unit, owner, vault, provider)
        records, blockers = self.inventory(unit, owner, vault, provider, row, batch=True)
        return _provider_projection(row, records, blockers)

    def summary(self, uid, vault):
        """One read-only transaction; no task/content scan or cross-request cache."""
        identifier(vault)
        owner = owner_key(uid)
        native = NativeConnectionOwnerService(self.store, clock=self.clock)

        def read(unit):
            unit = _ReadSnapshot(
                unit,
                [
                    document_path("hub_vaults", owner),
                    document_path("hub_oauth_owners", owner),
                    slot_path(owner, "muse"),
                    slot_path(owner, "chatgpt"),
                ],
            )
            _current(unit, owner, self.now(), vault)
            index = native._owner(unit, uid)
            ids = index["connectionIds"]
            for connection in ids:
                identifier(connection)
            if len(set(ids)) != len(ids):
                raise StoreUnavailable
            unit = _ReadSnapshot(
                unit,
                [document_path("hub_oauth_connections", owner, connection) for connection in ids],
            )
            slots = {
                provider: stored_slot(unit, owner, vault, provider)
                for provider in ("muse", "chatgpt")
            }
            connections, candidates = [], []
            for connection in ids:
                conn = unit.get(document_path("hub_oauth_connections", owner, connection))
                if (
                    conn is None
                    or conn.get("ownerSubject") != owner
                    or conn.get("connectionId") != connection
                    or conn.get("provider") not in slots
                    or conn.get("status") not in {"active", "revoked"}
                ):
                    raise StoreUnavailable
                if conn.get("transportKind") == "persistent_runtime":
                    connections.append(native._view(conn))
                slot = slots[conn["provider"]]
                current = None if slot is None else slot["slot"]["currentCredential"]
                if conn.get("vaultId") == vault and (
                    conn["status"] == "active"
                    or (current is not None and current["connectionId"] == connection)
                ):
                    candidates.append(connection)
            unit = _ReadSnapshot(unit, [identity_path(owner, vault, c) for c in candidates])
            providers = {
                provider: (
                    self._provider_state(unit, owner, vault, provider)
                    if ids
                    else _provider_projection(None, [], [])
                )
                for provider in ("muse", "chatgpt")
            }
            if not ids and any(slots.values()):
                raise StoreUnavailable
            credentials = []
            for connection in connections:
                if connection["status"] != "active" or connection["vaultId"] != vault:
                    continue
                slot = providers[connection["provider"]]["slot"]
                ref = None if slot is None else slot["currentCredential"]
                if slot is not None and (
                    ref is None
                    or ref["connectionId"] != connection["connectionId"]
                    or ref["clientId"] != connection["clientId"]
                ):
                    continue
                conn = linked_connection(unit, owner, vault, connection["connectionId"])
                state = self._credential_state(unit, owner, vault, connection["connectionId"], conn)
                if slot is not None:
                    lease = state["lease"]
                    if lease is None or any(
                        ref[key] != lease[field]
                        for key, field in (
                            ("connectionId", "connectionId"),
                            ("clientId", "clientId"),
                            ("credentialGeneration", "generation"),
                            ("credentialFingerprint", "credentialFingerprint"),
                        )
                    ):
                        raise StoreUnavailable
                credentials.append(
                    {
                        "connectionId": connection["connectionId"],
                        "state": state,
                    }
                )
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": SUMMARY_PROFILE,
                "vaultId": vault,
                "connections": connections,
                "providers": providers,
                "credentials": credentials,
            }
            check_read_response(result)
            return result

        return self.store.transact(read)

    def _receipt(self, saved, owner, vault, provider, operation):
        try:
            if type(saved) is not dict or set(saved) != {"command", "operation", "receipt"}:
                raise StoreUnavailable
            result = saved["receipt"]
            fingerprint = signing_input_fingerprint(saved["command"]["approval"])
            check_provider_operation_replay(
                saved["operation"],
                owner_subject=owner,
                vault_id=vault,
                provider=provider,
                stable_operation_id=operation,
                fingerprint=fingerprint,
            )
            validate_provider_slot(
                result["slot"], owner_subject=owner, vault_id=vault, provider=provider
            )
            if (
                result["operation"] != saved["operation"]
                or result["slot"]["slotVersion"] != saved["operation"]["slotVersion"]
            ):
                raise StoreUnavailable
            return snapshot(result)
        except (ContractError, KeyError, TypeError):
            raise StoreUnavailable from None

    def receipt(self, uid, vault, provider, operation):
        owner = owner_key(uid)
        provider_slot_id(owner, provider)
        path = operation_path(owner, vault, provider, operation)

        def read(unit):
            _current(unit, owner, self.now(), vault)
            saved = unit.get(path)
            if saved is None:
                raise ContractError("not_found")
            return self._receipt(saved, owner, vault, provider, operation)

        return self.store.transact(read)

    def _review_tasks(self, unit, owner, vault, review):
        from .persistent_publications import authority_head, stored_authority
        from .tasks import _head, _index

        if not review["tasks"]:
            return
        index = _index(unit, owner, vault)
        old_connections = {r["connectionId"] for r in review["retiredCredentials"]}
        for selection in review["tasks"]:
            head = _head(unit, owner, vault, selection["taskId"], index)
            if authority_head(unit, owner, vault, selection["taskId"]) == {"taskCenter": True}:
                matches = []
                for connection in sorted(old_connections):
                    candidate = stored_authority(
                        unit, owner, vault, selection["taskId"], connection
                    )
                    if (
                        candidate is not None
                        and candidate["fingerprint"] == selection["grantFingerprint"]
                    ):
                        matches.append(candidate)
                if len(matches) != 1:
                    raise ContractError("version_conflict")
                authority = matches[0]
            else:
                authority = stored_authority(unit, owner, vault, selection["taskId"])
            if head is None or authority is None:
                raise ContractError("version_conflict")
            meta, c = head["metadata"], authority["context"]
            if (
                meta["status"] != "active"
                or meta["taskVersion"] != selection["taskVersion"]
                or meta["executionEpoch"] != selection["executionEpoch"]
                or c["taskVersion"] != selection["taskVersion"]
                or c["executionEpoch"] != selection["executionEpoch"]
                or authority["fingerprint"] != selection["grantFingerprint"]
                or c["connectionId"] not in old_connections
                or not set(selection["resourceIds"])
                <= {b["ref"]["resourceId"] for b in meta["resourceBindings"]}
            ):
                raise ContractError("version_conflict")

    def command(self, uid, vault, provider, command, operation):
        from .agent_rollout import require_owner_allowed

        owner = owner_key(uid)
        require_owner_allowed(owner)
        identifier(vault)
        provider_slot_id(owner, provider)
        validate_schema("OperationIdentifier", operation)
        if (
            type(command) is not dict
            or set(command) not in ({"approval"}, {"approval", "review", "credential"})
            or len(canonical_json(command)) > 131072
        ):
            raise ContractError("malformed_request")
        _, payload = _signed_parts(command["approval"])
        payload = validate_provider_connection_schema("ProviderSlotApproval", payload)
        if payload["stableOperationId"] != operation:
            raise ContractError("recipient_binding_mismatch")
        activate = payload["action"] == "activate"
        if activate != ("credential" in command):
            raise ContractError("malformed_request")

        def write(unit):
            _, registry = _current(unit, owner, self.now(), vault)
            path = operation_path(owner, vault, provider, operation)
            saved = unit.get(path)
            if saved is not None:
                if command_identity(saved["command"]) != command_identity(command):
                    raise ContractError("idempotency_conflict")
                return self._receipt(saved, owner, vault, provider, operation)
            current = stored_slot(unit, owner, vault, provider)
            slot = None if current is None else current["slot"]
            args = dict(
                registry=registry,
                owner_subject=owner,
                vault_id=vault,
                provider=provider,
                current_slot=slot,
                now=self.now(),
            )
            credential = None
            if activate:
                legacy, blockers = self.inventory(unit, owner, vault, provider, current)
                if blockers:
                    raise ContractError("version_conflict")
                review = validate_provider_connection_schema(
                    "ProviderConnectionReview", command["review"]
                )
                self._review_tasks(unit, owner, vault, review)
                child = command["credential"]
                if type(child) is not dict or set(child) not in (
                    {"binding", "approval"},
                    {"binding", "approval", "activation"},
                ):
                    raise ContractError("malformed_request")
                _, credential_payload = _signed_parts(child["approval"])
                credential_payload = validate_persistent_schema(
                    "AgentCredentialApproval", credential_payload
                )
                connection = credential_payload.get("connectionId")
                conn = linked_connection(unit, owner, vault, connection)
                if (
                    conn["provider"] != provider
                    or credential_payload.get("stableOperationId") != operation
                ):
                    raise ContractError("recipient_binding_mismatch")
                credential = AgentCredentialService(
                    self.store, audience=self.audience, client_ids=self.client_ids, clock=self.clock
                ).command(uid, vault, connection, command["credential"], operation, _unit=unit)
                plan = prepare_provider_activation(
                    command["approval"],
                    **args,
                    candidate_lease=credential["lease"],
                    candidate_identity=credential["identity"],
                    audience=self.audience,
                    review=review,
                    legacy_credentials=legacy,
                )
            else:
                plan = prepare_provider_disconnect(command["approval"], **args)
            marker = provider_slot_id(owner, provider)
            for prior in plan.retire:
                old_connection = prior["connectionId"]
                if (
                    credential is not None
                    and old_connection == credential["identity"]["connectionId"]
                ):
                    continue
                old = linked_connection(unit, owner, vault, old_connection)
                unit.put(
                    document_path("hub_oauth_connections", owner, old_connection),
                    {**old, "status": "revoked", "providerSlotId": marker},
                )
            if credential is not None:
                unit.put(
                    document_path("hub_oauth_connections", owner, connection),
                    {
                        **{k: v for k, v in conn.items() if k != "predecessorConnectionId"},
                        "credentialMode": "agent_owned",
                        "providerSlotId": marker,
                    },
                )
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROVIDER_CONNECTION_PROFILE,
                "slot": plan.slot,
                "operation": plan.operation,
                "credentialReceipt": credential,
                "retainedSelections": list(plan.tasks),
                "requiresFreshGrants": True,
            }
            unit.put(
                slot_path(owner, provider),
                {
                    "slot": plan.slot,
                    "retainedSelections": list(plan.tasks),
                    "operationId": operation,
                },
            )
            unit.put(
                path,
                {
                    "command": snapshot(command),
                    "operation": plan.operation,
                    "receipt": snapshot(result),
                },
            )
            return snapshot(result)

        return self.store.transact(write)
