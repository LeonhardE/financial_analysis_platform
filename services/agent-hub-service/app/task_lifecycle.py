"""Permanent task fences and bounded retention cleanup in the existing Hub.

No process timers or new cloud jobs. An authenticated Owner maintenance request
advances one four-document page; expiry disables restore even before cleanup runs.
"""

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads

from .store import StoreUnavailable, document_path

CLEANUP_FIELDS = {
    "hub_preparation_objects": "ownerSubject",
    "hub_run_components": "ownerSubject",
    "hub_result_revisions": "ownerSubject",
    "hub_persistent_results": "context.ownerSubject",
    "hub_persistent_publications": "context.ownerSubject",
    "hub_task_versions": "ownerSubject",
    "hub_preparations": "ownerSubject",
    "hub_runs": "ownerSubject",
    "hub_persistent_runs": "ownerUid",
}


def lifecycle_path(owner, vault):
    return document_path("hub_center_lifecycle", owner, vault)


def lifecycle_index(unit, owner, vault):
    row = unit.get(lifecycle_path(owner, vault))
    if row is None:
        return {"version": 0, "tasks": {}}
    if (
        set(row) != {"version", "tasks"}
        or type(row["version"]) is not int
        or row["version"] < 0
        or type(row["tasks"]) is not dict
        or any(s not in {"active", "trashed", "purged"} for s in row["tasks"].values())
    ):
        raise StoreUnavailable
    return row


def require_visible(unit, owner, vault, task, *, legacy_writer=False):
    state = lifecycle_index(unit, owner, vault)["tasks"].get(task)
    if state not in {None, "active"} or (legacy_writer and state is not None):
        raise ContractError("not_found")


def visible_metadata(unit, owner, vault, rows):
    states = lifecycle_index(unit, owner, vault)["tasks"]
    return [row for row in rows if states.get(row["taskId"], "active") == "active"]


def _scope(unit, collection, row, owner):
    """Find a copy's parent before retiring any payload; parents are cleaned last."""
    if row.get("retiredTaskContent"):
        return None
    if collection == "hub_preparation_objects":
        if "taskId" in row and "vaultId" in row:
            return row["vaultId"], row["taskId"]
        parent = unit.get(document_path("hub_preparations", owner, row["preparationId"]))
        if parent is not None:
            task_copy = unit.get(
                document_path(
                    "hub_preparation_objects", owner, row["preparationId"], parent["taskId"]
                )
            )
            if task_copy is not None and task_copy.get("retiredTaskContent"):
                return task_copy.get("vaultId", "unresolved"), task_copy.get("taskId")
            if task_copy is not None:
                from folioview_shared.encrypted.crypto import _signed_parts

                c = _signed_parts(strict_json_loads(task_copy["carrierJson"])["signedObject"])[1][
                    "context"
                ]
                return c["vaultId"], parent["taskId"]
            return "unresolved", None
        # Old uncommitted copies must not be guessed/deleted as another task.
        # Owner review can establish this mapping later; never claim full cleanup.
        return "unresolved", None
    if collection == "hub_run_components":
        parent = unit.get(document_path("hub_runs", owner, row["runId"]))
        if parent is None:
            raise StoreUnavailable
        return parent["run"]["vaultId"], parent["run"]["taskId"]
    if collection == "hub_result_revisions":
        parent = unit.get(document_path("hub_results", owner, row["resultId"]))
        if parent is None:
            raise StoreUnavailable
        return parent["vaultId"], parent["metadata"]["taskId"]
    if collection in {"hub_persistent_results", "hub_persistent_publications"}:
        c = row["context"]
        if collection.endswith("publications") and c["objectType"] != "task":
            return None
        return c["vaultId"], c["taskId"]
    if collection == "hub_task_versions":
        return row["metadata"]["vaultId"], row["metadata"]["taskId"]
    if collection == "hub_preparations":
        # Receipts contain descriptors only; no ciphertext to retire.
        return None
    if collection == "hub_runs":
        return row["run"]["vaultId"], row["run"]["taskId"]
    if collection == "hub_persistent_runs":
        m = strict_json_loads(row["manifestJson"])
        return m["vaultId"], m["taskId"]
    raise StoreUnavailable


def cleanup_page(unit, owner, uid, vault, task, row):
    progress = row.get("cleanup", {"phase": 0, "after": None, "unresolved": False})
    collections = list(CLEANUP_FIELDS)
    if progress["phase"] == len(collections):
        return row
    collection = collections[progress["phase"]]
    rows = unit.scan_owner(
        collection,
        CLEANUP_FIELDS[collection],
        uid if collection == "hub_persistent_runs" else owner,
        after=progress["after"],
        limit=4,
    )
    unresolved = progress["unresolved"]
    writes = []
    for path, value in rows:
        scope = _scope(unit, collection, value, owner)
        if scope == ("unresolved", None):
            unresolved = True
        if scope is None or scope[1] != task or scope[0] not in {None, vault}:
            continue
        if collection == "hub_persistent_results":
            # Keep metadata/receipt heads for other task's shared result pages.
            content = document_path(
                "hub_persistent_result_content", owner, vault, value["context"]["objectId"]
            )
            writes.append((content, {"retiredTaskContent": True}))
        else:
            writes.append(
                (
                    path,
                    {
                        "retiredTaskContent": True,
                        "ownerSubject": owner,
                        "vaultId": vault,
                        "taskId": task,
                    },
                )
            )
    for path, value in writes:
        unit.put(path, value)
    next_phase = progress["phase"] + (len(rows) < 4)
    updated = {
        "phase": next_phase,
        "after": rows[-1][0] if len(rows) == 4 else None,
        "unresolved": unresolved,
    }
    return {**row, "cleanup": updated}
