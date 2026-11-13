"""Owner trash review and resumable, request-driven retirement of expired copies."""

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.identity import owner_key

from .task_center import definition_row, task_path
from .task_center_results import TaskCenterResultService
from .task_lifecycle import CLEANUP_FIELDS, cleanup_page, lifecycle_index
from .tasks import _index, _response
from .vaults import _current


class TaskLifecycleService(TaskCenterResultService):
    def trash(self, uid, vault, *, cursor=None):
        if cursor is not None:
            from folioview_shared.encrypted.schema import validate_schema

            validate_schema("Identifier", cursor)

        def read(unit):
            owner = owner_key(uid)
            v, _ = _current(unit, owner, self.now(), vault)
            index = _index(unit, owner, vault)
            items = []
            states = lifecycle_index(unit, owner, vault)["tasks"]
            ids = sorted(t for t, status in states.items() if status != "active")
            if cursor is not None and cursor not in ids:
                raise ContractError("unsupported_query")
            start = 0 if cursor is None else ids.index(cursor) + 1
            chosen = ids[start : start + 1]
            for task in chosen:
                status = states[task]
                if status == "active":
                    continue
                row = definition_row(unit, owner, vault, task)
                d = row["definition"]
                cleanup = row.get("cleanup", {})
                expired = self.now() >= d["purgeAfter"]
                items.append(
                    {
                        "taskId": task,
                        "definition": d,
                        "canRestore": status == "trashed" and not expired,
                        "cleanupState": "review_required"
                        if cleanup.get("unresolved")
                        else "complete"
                        if cleanup.get("phase") == len(CLEANUP_FIELDS)
                        else "pending",
                        "envelope": _response(
                            unit, owner, v, task, index["tasks"][task]["taskVersion"]
                        )
                        if not expired
                        else None,
                    }
                )
            return {
                "contractVersion": CONTRACT_VERSION,
                "items": items,
                "nextCursor": chosen[-1] if start + len(chosen) < len(ids) else None,
            }

        return self.store.transact(read)

    def maintenance(self, uid, vault, task):
        def write(unit):
            owner, *_ = self._owner_task(unit, uid, vault, task)
            row = definition_row(unit, owner, vault, task)
            d = None if row is None else row["definition"]
            if (
                d is None
                or d["status"] not in {"trashed", "purged"}
                or self.now() < d["purgeAfter"]
            ):
                raise ContractError("version_conflict")
            updated = cleanup_page(unit, owner, uid, vault, task, row)
            unit.put(task_path(owner, vault, task), updated)
            state = updated["cleanup"]
            return {
                "contractVersion": CONTRACT_VERSION,
                "complete": state["phase"] == len(CLEANUP_FIELDS) and not state["unresolved"],
                "reviewRequired": state["unresolved"],
                "phase": state["phase"],
            }

        return self.store.transact(write)
