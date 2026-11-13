"""Bounded, metadata-only task history over new and existing result stores.

Enrollment captures a legacy page boundary. One query examines at most one old
page, so sparse legacy tasks remain pageable without unbounded scans or workers.
Old actors stay historical; no assignment or scheduler provenance is invented.
"""

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)
from folioview_shared.encrypted.persistent_content import digest
from folioview_shared.encrypted.task_center import TASK_CENTER_PROFILE, validate_task_center_schema

from .inbox import InboxService
from .persistent_results import PAGE_SIZE, PersistentResultService, result_path, stored_result
from .store import StoreUnavailable, document_path
from .task_center import TaskCenterOwnerService, definition_row


def index_path(owner, vault, task):
    return document_path("hub_center_result_indexes", owner, vault, task)


def page_path(owner, vault, task, page):
    return document_path("hub_center_result_pages", owner, vault, task, page)


def append_result(unit, binding, result):
    owner, vault, task = (binding[k] for k in ("ownerSubject", "vaultId", "taskId"))
    path = index_path(owner, vault, task)
    head = unit.get(path)
    page = None if head is None else stored_page(unit, owner, vault, task, head["pageId"])
    if page is None or len(page["resultIds"]) == PAGE_SIZE:
        ident = "ctidx_" + digest([owner, vault, task, result])
        if unit.get(page_path(owner, vault, task, ident)) is not None:
            raise StoreUnavailable
        page = {
            "pageId": ident,
            "previous": None if head is None else head["pageId"],
            "resultIds": [],
        }
    if result in page["resultIds"]:
        raise StoreUnavailable
    page = {**page, "resultIds": [*page["resultIds"], result]}
    unit.put(page_path(owner, vault, task, page["pageId"]), page)
    unit.put(path, {"pageId": page["pageId"]})


def stored_page(unit, owner, vault, task, ident):
    import re

    if type(ident) is not str or re.fullmatch(r"ctidx_[a-f0-9]{64}", ident) is None:
        raise ContractError("unsupported_query")
    page = unit.get(page_path(owner, vault, task, ident))
    if page is None:
        raise ContractError("not_found")
    if (
        set(page) != {"pageId", "previous", "resultIds"}
        or page["pageId"] != ident
        or type(page["resultIds"]) is not list
        or not 1 <= len(page["resultIds"]) <= PAGE_SIZE
        or len(set(page["resultIds"])) != len(page["resultIds"])
        or page["previous"] == ident
    ):
        raise StoreUnavailable
    return page


def validate_attribution(value, context):
    value = validate_task_center_schema("CenterRunBinding", value)
    if any(
        value[k] != context[k]
        for k in ("ownerSubject", "vaultId", "taskId", "runId", "manifestFingerprint")
    ):
        raise StoreUnavailable
    if value["credential"]["connectionId"] != context["connectionId"]:
        raise StoreUnavailable
    return value


class _Batch:
    def __init__(self, rows):
        self.rows = rows

    def get(self, path):
        return self.rows[path]


class TaskCenterResultService(TaskCenterOwnerService):
    def results(self, uid, vault, task, request):
        if type(request) is not dict or set(request) != {"limit", "cursor"}:
            raise ContractError("malformed_request")
        limit, cursor = request["limit"], request["cursor"]
        if type(limit) is not int or not 1 <= limit <= 50:
            raise ContractError("malformed_request")
        selected = None
        if cursor is not None:
            if type(cursor) is not str or len(cursor) > 4096:
                raise ContractError("unsupported_query")
            try:
                selected = strict_json_loads(b64url_decode(cursor), max_bytes=3072)
                if set(selected) != {"scope", "phase", "page", "before"} or selected[
                    "phase"
                ] not in {"current", "legacy", "foreground"}:
                    raise ValueError
            except (ContractError, ValueError, TypeError):
                raise ContractError("unsupported_query") from None

        def read(unit):
            owner, *_ = self._owner_task(unit, uid, vault, task)
            from .task_lifecycle import require_visible

            require_visible(unit, owner, vault, task)
            row = definition_row(unit, owner, vault, task)
            if row is None:
                raise ContractError("not_found")
            scope = digest([owner, vault, task])

            def encode(phase, page, before):
                return b64url_encode(
                    canonical_json({"scope": scope, "phase": phase, "page": page, "before": before})
                )

            if selected is not None and selected["scope"] != scope:
                raise ContractError("unsupported_query")
            legacy = row["legacyHead"]
            head = unit.get(index_path(owner, vault, task)) if selected is None else None
            if selected is None:
                if head is not None:
                    phase, ident, before = "current", head["pageId"], None
                elif legacy is not None:
                    phase, ident, before = "legacy", legacy["pageId"], legacy["before"]
                else:
                    phase, ident, before = "foreground", None, None
            else:
                phase, ident, before = (selected[k] for k in ("phase", "page", "before"))
            if phase == "foreground":
                if before is not None or (ident is not None and type(ident) is not str):
                    raise ContractError("unsupported_query")
                return {"foreground": ident, "scope": scope}
            page = (
                stored_page(unit, owner, vault, task, ident)
                if phase == "current"
                else PersistentResultService._page(self, unit, owner, vault, ident)
            )
            before = len(page["resultIds"]) if before is None else before
            if type(before) is not int or not 1 <= before <= len(page["resultIds"]):
                raise ContractError("unsupported_query")
            if (
                phase == "legacy"
                and legacy is not None
                and ident == legacy["pageId"]
                and before > legacy["before"]
            ):
                raise ContractError("unsupported_query")
            begin = max(0, before - limit)
            ids = list(reversed(page["resultIds"][begin:before]))
            batch = _Batch(unit.get_many([result_path(owner, vault, r) for r in ids]))
            items = []
            for ident in ids:
                result = stored_result(batch, owner, vault, ident)
                meta, c = result["metadata"], result["context"]
                if meta["taskId"] != task:
                    if phase == "current":
                        raise StoreUnavailable
                    continue
                binding = result.get("taskCenter")
                items.append(
                    {
                        "kind": "persistent",
                        "metadata": meta,
                        "actor": {
                            "connectionId": c["connectionId"],
                            "agentId": c["agentId"],
                            "clientId": c["clientId"],
                        },
                        "attribution": binding,
                        "triggerKind": "legacy_unknown"
                        if binding is None
                        else binding["trigger"]["kind"],
                    }
                )
            if begin:
                following = encode(phase, page["pageId"], begin)
            elif page["previous"] is not None:
                following = encode(phase, page["previous"], None)
            elif phase == "current" and legacy is not None:
                following = encode("legacy", legacy["pageId"], legacy["before"])
            else:
                following = encode("foreground", None, None)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": TASK_CENTER_PROFILE,
                "items": items,
                "nextCursor": following,
                "total": None,
                "historyScanPending": True,
                "ordering": "new_assignments_then_legacy",
                "nativeScheduleAttested": False,
            }

        result = self.store.transact(read)
        if "foreground" not in result:
            return result
        # Existing foreground history shares its current bounded metadata cache;
        # this adapter supplies a single task feed without changing old storage.
        old = InboxService(self.store, clock=self.clock).list(
            uid, limit=limit, cursor=result["foreground"], task_id=task
        )
        self.store.transact(lambda unit: self._owner_task(unit, uid, vault, task))
        following = (
            None
            if old["nextCursor"] is None
            else b64url_encode(
                canonical_json(
                    {
                        "scope": result["scope"],
                        "phase": "foreground",
                        "page": old["nextCursor"],
                        "before": None,
                    }
                )
            )
        )
        return {
            "contractVersion": CONTRACT_VERSION,
            "profile": TASK_CENTER_PROFILE,
            "items": [
                {
                    "kind": "foreground",
                    "metadata": item,
                    "attribution": None,
                    "triggerKind": "legacy_unknown",
                }
                for item in old["items"]
            ],
            "nextCursor": following,
            "total": None,
            "historyScanPending": following is not None,
            "ordering": "new_assignments_then_legacy",
            "nativeScheduleAttested": False,
        }
