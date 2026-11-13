"""Small Owner-only aliases in the existing store; never financial or Agent state."""

import threading
import time
from collections import OrderedDict

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.private_display_names import (
    DISPLAY_NAME_PROFILE,
    check_display_name_replay,
    plan_display_name_update,
    validate_display_name_envelope,
    validate_display_name_schema,
    validate_display_name_state,
)
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .fences import _state, fence_path
from .store import StoreUnavailable, document_path
from .vaults import _verify_row, identifier


def name_path(owner, vault, root, ref):
    return document_path(
        "hub_private_display_names",
        owner,
        vault,
        root,
        ref["sourceService"],
        ref["kind"],
        ref["resourceId"],
        ref["incarnation"],
    )


def operation_path(owner, vault, root, ref, operation):
    validate_schema("OperationIdentifier", operation)
    return document_path(
        "hub_private_display_name_operations",
        owner,
        vault,
        root,
        ref["sourceService"],
        ref["kind"],
        ref["resourceId"],
        ref["incarnation"],
        operation,
    )


class _Prefetched:
    def __init__(self, rows):
        self.rows = rows

    def get(self, path):
        if path not in self.rows:
            raise StoreUnavailable
        return self.rows[path]


def _item(value, *, owner, vault, root, ref):
    if value is None:
        return None
    try:
        if type(value) is not dict or set(value) != {"state", "command"}:
            raise StoreUnavailable
        _, p = _signed_parts(value["command"])
        p = validate_display_name_schema("DisplayNameControl", p)
        if (p["ownerSubject"], p["vaultId"], p["rootKeyId"], p["ref"]) != (owner, vault, root, ref):
            raise StoreUnavailable
        state = validate_display_name_state(value["state"], context=p)
        if (state["revision"], state["stableOperationId"], state["recipientKeyId"]) != (
            p["revision"],
            p["stableOperationId"],
            p["recipientKeyId"],
        ):
            raise StoreUnavailable
        if (
            state["operationFingerprint"] != signing_input_fingerprint(value["command"])
            or not p["issuedAt"] <= state["acceptedAt"] <= p["issuedAt"] + 300
            or p["revision"] != p["expectedRevision"] + 1
        ):
            raise StoreUnavailable
        validate_display_name_envelope(p["envelope"], context=p)
        return {"state": state, "command": value["command"]}
    except (ContractError, KeyError, TypeError, ValueError):
        raise StoreUnavailable from None


class PrivateDisplayNameService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock
        # Only static Root signatures are memoized, keyed by fresh complete history.
        # No source, authority, lifecycle, name or authentication response is cached.
        self.registry_cache = OrderedDict()
        self.cache_lock = threading.Lock()

    def _current(self, unit, owner, vault, now):
        identifier(vault)
        row = unit.get(document_path("hub_vaults", owner))
        if row is None:
            raise ContractError("not_found")
        with self.cache_lock:
            registry = _verify_row(row, owner, now, unit=unit, registry_cache=self.registry_cache)
            while len(self.registry_cache) > 4:
                self.registry_cache.popitem(last=False)
        if row["vaultId"] != vault or row["archive"] is None:
            raise ContractError("not_found")
        return row, registry

    @staticmethod
    def _source(row, source):
        identifier(source)
        match = next(
            (s["resourceRef"] for s in row["sources"] if s["resourceRef"]["resourceId"] == source),
            None,
        )
        if match is None:
            raise ContractError("not_found")
        return match

    @staticmethod
    def _response(item):
        value = {"contractVersion": CONTRACT_VERSION, "profile": DISPLAY_NAME_PROFILE, "item": item}
        check_read_response(value)
        return value

    def listing(self, uid, vault):
        owner = owner_key(uid)
        now = int(self.clock())

        def read(unit):
            row, _ = self._current(unit, owner, vault, now)
            refs = [s["resourceRef"] for s in row["sources"]]
            paths = [
                (name_path(owner, vault, row["rootKeyId"], ref), fence_path(owner, ref))
                for ref in refs
            ]
            loaded = unit.get_many([p for pair in paths for p in pair]) if paths else {}
            projected = _Prefetched(loaded)
            items = []
            for ref, (path, _) in zip(refs, paths, strict=True):
                if _state(projected, owner, ref)["state"] == "deleted":
                    continue
                item = _item(loaded[path], owner=owner, vault=vault, root=row["rootKeyId"], ref=ref)
                if item is not None:
                    items.append(item)
            value = {
                "contractVersion": CONTRACT_VERSION,
                "profile": DISPLAY_NAME_PROFILE,
                "items": items,
            }
            check_read_response(value)
            return value

        return self.store.transact(read)

    def read(self, uid, vault, source, operation=None):
        owner = owner_key(uid)
        now = int(self.clock())

        def read(unit):
            row, _ = self._current(unit, owner, vault, now)
            ref = self._source(row, source)
            if operation is None:
                if _state(unit, owner, ref)["state"] == "deleted":
                    raise ContractError("not_found")
                path = name_path(owner, vault, row["rootKeyId"], ref)
            else:
                # Owner history only, even after source deletion; never an Agent grant.
                path = operation_path(owner, vault, row["rootKeyId"], ref, operation)
            item = _item(unit.get(path), owner=owner, vault=vault, root=row["rootKeyId"], ref=ref)
            if operation is not None and (
                item is None or item["state"]["stableOperationId"] != operation
            ):
                raise ContractError("not_found")
            return self._response(item)

        return self.store.transact(read)

    def write(self, uid, vault, source, signed, operation):
        owner = owner_key(uid)
        now = int(self.clock())
        validate_schema("OperationIdentifier", operation)
        _, p = _signed_parts(signed)
        p = validate_display_name_schema("DisplayNameControl", p)
        if p["stableOperationId"] != operation:
            raise ContractError("idempotency_conflict")

        def write(unit):
            row, registry = self._current(unit, owner, vault, now)
            ref = self._source(row, source)
            path = name_path(owner, vault, row["rootKeyId"], ref)
            op_path = operation_path(owner, vault, row["rootKeyId"], ref, operation)
            # Read every dependency before staging writes (including absent fence).
            previous = unit.get(path)
            saved = _item(
                unit.get(op_path), owner=owner, vault=vault, root=row["rootKeyId"], ref=ref
            )
            if saved is not None:
                # Original admission already verified the signature. Match exact
                # signing input/current scope; age cannot replace an unknown commit.
                check_display_name_replay(saved["state"], signed, context=p)
                return self._response(saved)
            if _state(unit, owner, ref)["state"] == "deleted":
                raise ContractError("not_found")
            previous = _item(previous, owner=owner, vault=vault, root=row["rootKeyId"], ref=ref)
            state = plan_display_name_update(
                signed,
                registry=registry,
                owner_subject=owner,
                vault_id=vault,
                resource_ref=ref,
                current_state=previous["state"] if previous else None,
                now=now,
            )
            item = {"state": state, "command": signed}
            unit.put(path, item)
            unit.put(op_path, item)
            return self._response(item)

        return self.store.transact(write)
