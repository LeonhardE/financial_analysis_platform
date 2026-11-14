"""One bounded Owner task display snapshot, never a generic batch proxy."""

import copy
import re
import secrets
import time
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key

from .api import Owner, _invoke, body
from .inbox import InboxService
from .native_transport import NativeConnectionOwnerService
from .persistent_results import PersistentOwnerResultService
from .persistent_results import result_path as persistent_result_path
from .persistent_routes import control_transport
from .results import result_path
from .store import StoreUnavailable, document_path, get_store
from .task_center_routes import owner_capabilities
from .task_lifecycle import lifecycle_path, visible_metadata
from .tasks import PACKET_BATCH_PROFILE, TaskService, _head, _index, _paths, _protocol, _response
from .vaults import _current, identifier

PROFILE = "folioview.owner-task-overview.v1"
MAX_BODY_BYTES = 16_384
MAX_READ_BYTES = 8 * 1024 * 1024


class _OverviewSnapshot:
    """Bounded detached rows; only explicit prefetches may contact the database."""

    def __init__(self, unit):
        self.unit, self.rows, self.writes = unit, {}, {}
        self.bytes = 0

    def fetch(self, paths):
        paths = list(dict.fromkeys(path for path in paths if path not in self.rows))
        for start in range(0, len(paths), 128):
            group = paths[start : start + 128]
            values = self.unit.get_many(group)
            if set(values) != set(group):
                raise StoreUnavailable
            size = sum(len(canonical_json(value)) for value in values.values())
            if size > MAX_READ_BYTES - self.bytes:
                raise ContractError("payload_too_large")
            self.rows.update(values)
            self.bytes += size

    def get(self, path):
        if path not in self.rows:
            raise StoreUnavailable
        return copy.deepcopy(self.rows[path])

    def get_many(self, paths, *, field_paths=None):
        if field_paths is not None or any(path not in self.rows for path in paths):
            raise StoreUnavailable
        return {path: self.get(path) for path in paths}

    def put(self, path, value):
        self.writes[path] = copy.deepcopy(value)

    def flush(self):
        for path, value in self.writes.items():
            self.unit.put(path, value)

    def __getattr__(self, name):
        return getattr(self.unit, name)


def _request(value):
    if (
        type(value) is not dict
        or set(value) != {"contractVersion", "knownPacketVersions", "packetLimit"}
        or value["contractVersion"] != CONTRACT_VERSION
        or type(value["packetLimit"]) is not int
        or value["packetLimit"] not in {0, 4}
        or type(value["knownPacketVersions"]) is not list
        or len(value["knownPacketVersions"]) > 32
    ):
        raise ContractError("malformed_request")
    known = {}
    for row in value["knownPacketVersions"]:
        if type(row) is not dict or set(row) != {"taskId", "taskVersion", "envelopeFingerprint"}:
            raise ContractError("malformed_request")
        identifier(row["taskId"])
        validate_schema("Digest", row["envelopeFingerprint"])
        if (
            type(row["taskVersion"]) is not int
            or not 1 <= row["taskVersion"] <= 50
            or row["taskId"] in known
        ):
            raise ContractError("malformed_request")
        known[row["taskId"]] = dict(row)
    return known


def _packet_page(view, owner, vault, selected, index):
    # Validate every selected carrier before deciding whether combined delivery
    # fits. A corrupt packet cannot be hidden behind the null delivery hint.
    packets = []
    for task in selected:
        head = _head(view, owner, vault["vaultId"], task, index)
        if head is None:
            raise StoreUnavailable
        packet = _response(view, owner, vault, task, head["metadata"]["taskVersion"])
        if packet["metadata"] != head["metadata"]:
            raise StoreUnavailable
        packets.append(packet)
    result = {
        "contractVersion": CONTRACT_VERSION,
        "profile": PACKET_BATCH_PROFILE,
        "items": [],
        "remainingTaskIds": list(selected),
    }
    for position, packet in enumerate(packets):
        candidate = {
            **result,
            "items": [
                *result["items"],
                {"taskId": selected[position], "status": "ready", "packet": packet},
            ],
            "remainingTaskIds": selected[position + 1 :],
        }
        try:
            check_read_response(candidate)
        except ContractError as error:
            if error.code != "payload_too_large" or not result["items"]:
                raise
            break
        result = candidate
    return result


class TaskOverviewService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock

    def overview(self, uid, vault_id, value):
        identifier(vault_id)
        known = _request(value)
        owner = owner_key(uid)
        issued_token = secrets.token_urlsafe(24)
        capabilities = owner_capabilities(uid)

        def read(unit):
            tasks = TaskService(self.store, clock=self.clock)
            now = tasks.now()
            reports = PersistentOwnerResultService(self.store, clock=lambda: now)
            inbox = InboxService(self.store, clock=lambda: now)
            native = NativeConnectionOwnerService(self.store, clock=lambda: now)
            view = _OverviewSnapshot(unit)
            root_path = document_path("hub_vaults", owner)
            persistent_index = document_path("hub_persistent_result_indexes", owner, vault_id)
            cursor_path = document_path("hub_inbox_cursors", owner, vault_id)
            view.fetch(
                [
                    root_path,
                    document_path("hub_task_indexes", owner, vault_id),
                    persistent_index,
                    document_path("hub_result_indexes", owner),
                    document_path("hub_oauth_owners", owner),
                    lifecycle_path(owner, vault_id),
                    cursor_path,
                ]
            )
            root = view.get(root_path)
            if (
                root is not None
                and root.get("archive", "absent") is None
                and root.get("vaultId") == vault_id
            ):
                view.fetch([document_path("hub_vault_lifecycle", owner, vault_id)])
            vault, _ = _current(view, owner, now, vault_id)
            task_page = tasks._list(
                view, owner, vault, now=now, limit=32, cursor=None, issued_token=issued_token
            )
            pending = [
                row["taskId"]
                for row in task_page["items"]
                if known.get(row["taskId"])
                != {key: row[key] for key in ("taskId", "taskVersion", "envelopeFingerprint")}
            ][: value["packetLimit"]]
            anchor = inbox._anchor(view, owner)
            foreground_ids = inbox._index(view, owner, anchor)
            connection_index = native._owner(view, uid)
            head = view.get(persistent_index)
            page_path = None
            if head is not None:
                if set(head) != {"pageId"}:
                    raise StoreUnavailable
                if (
                    type(head["pageId"]) is not str
                    or re.fullmatch(r"pidx_[a-f0-9]{64}", head["pageId"]) is None
                ):
                    raise ContractError("malformed_request")
                page_path = document_path(
                    "hub_persistent_result_pages", owner, vault_id, head["pageId"]
                )
            view.fetch(
                ([page_path] if page_path else [])
                + [result_path(owner, result) for result in foreground_ids]
                + [
                    document_path("hub_oauth_connections", owner, ident)
                    for ident in connection_index["connectionIds"]
                ]
                + [_paths(owner, vault_id, task) for task in pending]
            )
            index = _index(view, owner, vault_id)
            selected_heads = {task: _head(view, owner, vault_id, task, index) for task in pending}
            if any(row is None for row in selected_heads.values()):
                raise StoreUnavailable
            final_paths = [
                _paths(owner, vault_id, task, row["metadata"]["taskVersion"])
                for task, row in selected_heads.items()
            ]
            if page_path:
                page = reports._page(view, owner, vault_id, head["pageId"])
                final_paths += [
                    persistent_result_path(owner, vault_id, result)
                    for result in page["resultIds"][-20:]
                ]
                if len(page["resultIds"]) <= 20 and page["previous"] is not None:
                    final_paths.append(
                        document_path(
                            "hub_persistent_result_pages", owner, vault_id, page["previous"]
                        )
                    )
            view.fetch(final_paths)
            persistent = reports._list(view, owner, vault_id, limit=20, selected=None)
            rows = visible_metadata(
                view, owner, vault_id, inbox._heads(view, uid, owner, anchor, foreground_ids)
            )
            saved = original_cursors = view.get(cursor_path)
            feeds, protected = {}, set()
            for name, query_filter in (("foreground", "all"), ("archived", "archived")):
                chosen = inbox._select(rows, query_filter, None)
                chosen.sort(
                    key=lambda row: (datetime.fromisoformat(row["receivedAt"]), row["resultId"]),
                    reverse=True,
                )
                feeds[name], saved = inbox._page_values(
                    owner,
                    vault_id,
                    chosen,
                    saved=saved,
                    now=now,
                    limit=20,
                    cursor=None,
                    query={"kind": "list", "filter": query_filter, "taskId": None},
                    protected=protected,
                )
                if feeds[name]["nextCursor"] is not None:
                    protected.add(feeds[name]["nextCursor"])
            if saved != original_cursors and (original_cursors is not None or saved["cursors"]):
                view.put(cursor_path, saved)
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "vaultId": vault_id,
                "tasks": task_page,
                "capabilities": capabilities,
                "feeds": {"persistent": persistent, **feeds},
                "connections": native._native_connections(view, uid),
                "packets": None,
            }
            check_read_response(result)
            if pending:
                result["packets"] = _packet_page(view, owner, vault, pending, index)
                try:
                    check_read_response(result)
                except ContractError as error:
                    if error.code != "payload_too_large":
                        raise
                    result["packets"] = None
            view.flush()
            return result

        return self.store.transact(read)


def get_overview():
    return TaskOverviewService(get_store())


router = APIRouter(prefix="/api/v3/tasks", route_class=PrivateRoute)
Overview = Annotated[TaskOverviewService, Depends(get_overview)]


@router.post("/{vault}/overview/query")
async def overview(vault: str, request: Request, user: Owner, service: Overview):
    def protocol():
        control_transport(request)
        _protocol(request)
        if request.query_params:
            raise ContractError("unsupported_query")

    _invoke(protocol)
    value = await body(
        request, {"contractVersion", "knownPacketVersions", "packetLimit"}, max_bytes=MAX_BODY_BYTES
    )
    return await run_in_threadpool(_invoke, lambda: service.overview(user.uid, vault, value))
