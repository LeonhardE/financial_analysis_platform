"""Bounded Owner intents and authenticated pickup; never a background dispatcher."""

from folioview_shared.encrypted.authority import verify_registry
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.encrypted.task_center import (
    aggregate_progress,
    assignment_trigger_id,
    validate_task_center_schema,
    verify_manual_intent,
)

from .persistent_agents import snapshot
from .store import document_path
from .task_center import (
    TaskCenterAgentService,
    assigned_row,
    center_reference,
    current_assignment,
    definition_row,
    preparation_path,
    trigger_path,
)
from .task_lifecycle import require_visible
from .task_lifecycle_service import TaskLifecycleService
from .vaults import _current

MAX_PENDING = 16


def intent_path(owner, vault, task, request):
    return document_path("hub_center_intents", owner, vault, task, request)


def queue_path(owner, vault, task):
    return document_path("hub_center_intent_queues", owner, vault, task)


def _queue(unit, owner, vault, task):
    return unit.get(queue_path(owner, vault, task)) or {"ids": []}


def _intent(unit, owner, vault, task, request):
    validate_schema("OperationIdentifier", request)
    row = unit.get(intent_path(owner, vault, task, request))
    if row is None:
        raise ContractError("not_found")
    return row


def fence_manuals(unit, owner, vault, task):
    for request in _queue(unit, owner, vault, task)["ids"]:
        row = _intent(unit, owner, vault, task, request)
        progress = {
            i: {**p, "stage": "cancelled" if p["claimedAt"] is None else "failed"}
            if p["stage"] in {"waiting", "running", "awaiting_confirmation"}
            else p
            for i, p in row["progress"].items()
        }
        unit.put(
            intent_path(owner, vault, task, request),
            {**row, "progress": progress, "cancelled": True},
        )
    unit.put(queue_path(owner, vault, task), {"ids": []})


def _active(progress, expires, now):
    if progress["stage"] in {"result_received", "failed", "cancelled"}:
        return False
    return now < (progress.get("runExpiresAt") or expires)


def _verified(unit, owner, vault, task, row, definition, now):
    require_visible(unit, owner, vault, task)
    v, registry = _current(unit, owner, now, vault)
    _, payload = _signed_parts(row["control"])
    if not now < payload["intent"]["expiresAt"]:
        raise ContractError("key_authorization_required")
    # Admission freshness was checked when the durable intent was accepted.
    # Pickup uses the original accepted proof plus today's revocation high water;
    # it must not accidentally shorten the ten-minute window to control admission's
    # five-minute freshness limit, or widen it after a registry update.
    cert = registry.cert(
        payload["deviceSigningKeyId"], role="device_sig", connection_id=None, now=now
    )
    if not {"control_write", "task_grant"} <= set(cert["capabilities"]):
        raise ContractError("key_authorization_required")
    original = registry
    if payload["registrySequence"] != registry.registry_sequence:
        original = None
        for bundle in v["registryHistory"][: payload["registrySequence"]]:
            original = verify_registry(
                bundle,
                root_jwk=v["rootJwk"],
                pinned_root_key_id=v["rootKeyId"],
                owner_subject=owner,
                vault_id=vault,
                now=row["createdAt"],
                previous=original,
            )
    return verify_manual_intent(
        row["control"],
        registry=original,
        owner_subject=owner,
        vault_id=vault,
        task_id=task,
        current_definition=definition,
        assignments=row["assignments"],
        now=row["createdAt"],
    )


def manual_for_run(unit, definition, assignment, prepared, manifest):
    owner, vault, task = (definition[k] for k in ("ownerSubject", "vaultId", "taskId"))
    request = prepared["request"]["manualIntentId"]
    row = _intent(unit, owner, vault, task, request)
    progress = row["progress"][assignment["assignmentId"]]
    if row["cancelled"] or progress["stage"] != "waiting" or progress["claimedAt"] is None:
        raise ContractError("version_conflict")
    proof = _verified(unit, owner, vault, task, row, definition, manifest["createdAt"])
    progress = {
        **progress,
        "stage": "running",
        "runId": manifest["runId"],
        "runExpiresAt": manifest["expiresAt"],
    }
    unit.put(
        intent_path(owner, vault, task, request),
        {**row, "progress": {**row["progress"], assignment["assignmentId"]: progress}},
    )
    return proof


def observe_manual_result(unit, binding, result):
    owner, vault, task = (binding[k] for k in ("ownerSubject", "vaultId", "taskId"))
    request = binding["trigger"]["baseTriggerId"]
    row = _intent(unit, owner, vault, task, request)
    ident = binding["assignmentId"]
    progress = {**row["progress"][ident], "stage": "result_received", "resultId": result}
    unit.put(
        intent_path(owner, vault, task, request),
        {**row, "progress": {**row["progress"], ident: progress}},
    )


def _read_once(unit, key, read):
    # Transaction-local only: no stale authority survives a commit or retry.
    cache = getattr(unit, "_manual_authority_reads", None)
    if cache is None:
        cache = unit._manual_authority_reads = {}
    if key not in cache:
        try:
            cache[key] = (read(), None)
        except ContractError as error:
            cache[key] = (None, error.code)
    value, failure = cache[key]
    if failure:
        raise ContractError(failure)
    return value


def _summary(unit, owner, vault, task, row, now):
    definition = _read_once(
        unit, ("definition", owner, vault, task), lambda: definition_row(unit, owner, vault, task)
    )["definition"]
    from .tasks import _index

    meta = _read_once(unit, ("task-index", owner, vault), lambda: _index(unit, owner, vault))[
        "tasks"
    ].get(task)
    task_current = (
        meta is not None
        and meta["status"] == "active"
        and all(meta[k] == definition[k] for k in ("taskVersion", "executionEpoch"))
    )
    entries, reasons = [], {}
    for a in row["assignments"]:
        ident = a["assignmentId"]
        progress = row["progress"][ident]
        stage, reason = progress["stage"], None
        if stage not in {"result_received", "cancelled", "failed"}:
            try:
                if not task_current:
                    raise ContractError("version_conflict")
                current = _read_once(
                    unit,
                    (
                        "assignment",
                        owner,
                        vault,
                        task,
                        a["credential"]["connectionId"],
                        a["authorityFingerprint"],
                    ),
                    lambda a=a: current_assignment(
                        unit,
                        owner,
                        vault,
                        task,
                        a["credential"]["connectionId"],
                        a["authorityFingerprint"],
                    ),
                )
                if current is None or center_reference(*current[:2]) != row["bindings"][ident]:
                    raise ContractError("version_conflict")
                if not _active(progress, row["expiresAt"], now):
                    stage, reason = "failed", "timed_out"
            except ContractError:
                stage, reason = "failed", "authorization_changed"
        if reason:
            reasons[ident] = reason
        entries.append(
            {
                "assignmentId": ident,
                "assignmentVersion": a["assignmentVersion"],
                "runId": progress["runId"],
                "resultId": progress["resultId"],
                "stage": stage,
            }
        )
    value = {
        "contractVersion": CONTRACT_VERSION,
        "profile": definition["profile"],
        "ownerSubject": owner,
        "vaultId": vault,
        "taskId": task,
        "requestId": row["requestId"],
        "requestedAt": row["createdAt"],
        "executors": entries,
    }
    return {
        "snapshot": value,
        "aggregate": aggregate_progress(value),
        "reasons": reasons,
        "expiresAt": row["expiresAt"],
        "canCancel": not row["cancelled"]
        and now < row["expiresAt"]
        and all(v["claimedAt"] is None for v in row["progress"].values()),
        "dispatchSupported": False,
        "continuation": "open_agent",
        "nativeScheduleAttested": False,
    }


class ManualOwnerService(TaskLifecycleService):
    def cancel_operation(self, uid, vault, task, operation, fingerprint):
        """Fence a never-committed request atomically; never undo a committed grant."""
        import re

        validate_schema("OperationIdentifier", operation)
        if not isinstance(fingerprint, str) or not re.fullmatch(r"[a-f0-9]{64}", fingerprint):
            raise ContractError("malformed_request")

        def write(unit):
            owner, *_ = self._owner_task(unit, uid, vault, task)
            path = document_path("hub_center_operations", owner, vault, operation)
            command = unit.get(path)
            intent = unit.get(intent_path(owner, vault, task, operation))
            old = command or intent
            if old is not None and (
                old.get("taskId", task if intent is old else None) != task
                or old["fingerprint"] != fingerprint
            ):
                raise ContractError("idempotency_conflict")
            cancelled = old is None or old.get("cancelled", False) and command is not None
            if old is None:
                unit.put(
                    path,
                    {
                        "taskId": task,
                        "fingerprint": fingerprint,
                        "cancelled": True,
                        "receipt": None,
                    },
                )
            return {
                "contractVersion": CONTRACT_VERSION,
                "taskId": task,
                "operationId": operation,
                "fingerprint": fingerprint,
                "state": "cancelled" if cancelled else "committed",
                "receipt": None if cancelled else old["receipt"],
            }

        return self.store.transact(write)

    def manual(self, uid, vault, task, signed, operation):
        validate_schema("SignedObject", signed)
        validate_schema("OperationIdentifier", operation)
        _, payload = _signed_parts(signed)
        validate_task_center_schema("CenterOwnerControl", payload)
        if payload.get("action") != "manual_intent" or type(payload.get("intent")) is not dict:
            raise ContractError("malformed_request")
        if payload.get("stableOperationId") != operation:
            raise ContractError("recipient_binding_mismatch")
        fingerprint = signing_input_fingerprint(signed)

        def write(unit):
            owner, _, registry, meta = self._owner_task(unit, uid, vault, task)
            command = unit.get(document_path("hub_center_operations", owner, vault, operation))
            if command is not None:
                raise ContractError("idempotency_conflict")
            require_visible(unit, owner, vault, task)
            path = intent_path(owner, vault, task, operation)
            old = unit.get(path)
            if old is not None:
                if old["fingerprint"] != fingerprint:
                    raise ContractError("idempotency_conflict")
                return old["receipt"]
            row = definition_row(unit, owner, vault, task)
            if row is None or meta["status"] != "active":
                raise ContractError("not_found")
            definition = row["definition"]
            if (definition["taskVersion"], definition["executionEpoch"]) != (
                meta["taskVersion"],
                meta["executionEpoch"],
            ):
                raise ContractError("version_conflict")
            refs = payload.get("intent", {}).get("assignments", [])
            assignments = []
            for ref in refs:
                record = assigned_row(unit, owner, vault, task, ref.get("assignmentId"))
                if record is None:
                    raise ContractError("not_found")
                a = record["assignment"]
                self.live(unit, uid, vault, a["credential"]["connectionId"])
                current_assignment(
                    unit,
                    owner,
                    vault,
                    task,
                    a["credential"]["connectionId"],
                    a["authorityFingerprint"],
                )
                assignments.append(a)
            verified = verify_manual_intent(
                signed,
                registry=registry,
                owner_subject=owner,
                vault_id=vault,
                task_id=task,
                current_definition=definition,
                assignments=assignments,
                now=self.now(),
            )
            queue = _queue(unit, owner, vault, task)
            active = []
            for request in queue["ids"]:
                previous = _intent(unit, owner, vault, task, request)
                summary = _summary(unit, owner, vault, task, previous, self.now())
                if any(
                    e["stage"] in {"waiting", "running", "awaiting_confirmation"}
                    for e in summary["snapshot"]["executors"]
                ):
                    active.append(request)
            if len(active) >= MAX_PENDING:
                raise ContractError("version_conflict")
            receipt = {
                "contractVersion": CONTRACT_VERSION,
                "requestId": operation,
                "taskId": task,
                "fingerprint": verified.fingerprint,
                "acceptedAt": self.now(),
                "expiresAt": payload["intent"]["expiresAt"],
                "dispatchSupported": False,
                "continuation": "open_agent",
                "nativeScheduleAttested": False,
            }
            stored = {
                "taskId": task,
                "requestId": operation,
                "control": signed,
                "fingerprint": fingerprint,
                "createdAt": self.now(),
                "expiresAt": receipt["expiresAt"],
                "assignments": assignments,
                "bindings": {
                    a["assignmentId"]: center_reference(definition, a) for a in assignments
                },
                "progress": {
                    a["assignmentId"]: {
                        "stage": "waiting",
                        "claimedAt": None,
                        "runId": None,
                        "resultId": None,
                    }
                    for a in assignments
                },
                "cancelled": False,
                "receipt": receipt,
            }
            unit.put(path, stored)
            unit.put(queue_path(owner, vault, task), {"ids": [*active, operation]})
            return snapshot(receipt)

        return self.store.transact(write)

    def manual_state(self, uid, vault, task, request):
        def read(unit):
            owner, *_ = self._owner_task(unit, uid, vault, task)
            require_visible(unit, owner, vault, task)
            row = _intent(unit, owner, vault, task, request)
            return {
                "receipt": row["receipt"],
                **_summary(unit, owner, vault, task, row, self.now()),
            }

        return self.store.transact(read)

    def manual_list(self, uid, vault, task):
        def read(unit):
            owner, *_ = self._owner_task(unit, uid, vault, task)
            require_visible(unit, owner, vault, task)
            return {
                "contractVersion": CONTRACT_VERSION,
                "items": [
                    _summary(
                        unit,
                        owner,
                        vault,
                        task,
                        _intent(unit, owner, vault, task, request),
                        self.now(),
                    )
                    for request in _queue(unit, owner, vault, task)["ids"]
                ],
            }

        return self.store.transact(read)

    def cancel_manual(self, uid, vault, task, request):
        def write(unit):
            owner, *_ = self._owner_task(unit, uid, vault, task)
            require_visible(unit, owner, vault, task)
            row = _intent(unit, owner, vault, task, request)
            if row["cancelled"]:
                return {"requestId": request, "cancelled": True}
            if any(v["claimedAt"] is not None for v in row["progress"].values()):
                raise ContractError("version_conflict")
            unit.put(
                intent_path(owner, vault, task, request),
                {
                    **row,
                    "cancelled": True,
                    "progress": {
                        i: {**p, "stage": "cancelled"} for i, p in row["progress"].items()
                    },
                },
            )
            return {"requestId": request, "cancelled": True}

        return self.store.transact(write)


class ManualAgentService(TaskCenterAgentService):
    def pending_manual(self, owner, vault, connection, proof, path, request):
        if type(request) is not dict or set(request) != {"taskId"}:
            raise ContractError("malformed_request")

        def read(unit):
            *_, identity = self.authenticate(unit, owner, vault, connection, proof, path, request)
            authority = self.task_authority(
                unit, owner, vault, connection, identity, request["taskId"]
            )
            _, a, _ = current_assignment(
                unit, owner, vault, request["taskId"], connection, authority["fingerprint"]
            )
            items = []
            for rid in _queue(unit, owner, vault, request["taskId"])["ids"]:
                row = _intent(unit, owner, vault, request["taskId"], rid)
                summary = _summary(unit, owner, vault, request["taskId"], row, self.now())
                current = next(
                    (
                        p
                        for p in summary["snapshot"]["executors"]
                        if p["assignmentId"] == a["assignmentId"]
                    ),
                    None,
                )
                state = row["progress"].get(a["assignmentId"])
                if (
                    current is not None
                    and current["stage"] == "waiting"
                    and state
                    and _active(state, row["expiresAt"], self.now())
                    and state["stage"] == "waiting"
                ):
                    items.append(
                        {
                            "requestId": rid,
                            "expiresAt": row["expiresAt"],
                            "claimed": state["claimedAt"] is not None,
                        }
                    )
            return {"items": items[:4], "dispatchSupported": False}

        return self.store.transact(read)

    def prepare(self, owner, vault, connection, proof, path, request):
        if type(request) is dict and "manualIntentId" not in request:
            return super().prepare(owner, vault, connection, proof, path, request)
        if type(request) is not dict or set(request) != {
            "taskId",
            "baseTriggerId",
            "operationId",
            "binding",
            "taskPublicationFingerprint",
            "manualIntentId",
        }:
            raise ContractError("malformed_request")
        if request["manualIntentId"] != request["baseTriggerId"]:
            raise ContractError("recipient_binding_mismatch")
        for key in ("manualIntentId", "operationId"):
            validate_schema("OperationIdentifier", request[key])

        def write(unit):
            *_, identity = self.authenticate(unit, owner, vault, connection, proof, path, request)
            task = request["taskId"]
            authority = self.task_authority(unit, owner, vault, connection, identity, task)
            d, a, _ = current_assignment(
                unit, owner, vault, task, connection, authority["fingerprint"]
            )
            if (
                request["binding"] != center_reference(d, a)
                or request["taskPublicationFingerprint"] != authority["fingerprint"]
            ):
                raise ContractError("version_conflict")
            rid, ident = request["manualIntentId"], a["assignmentId"]
            row = _intent(unit, owner, vault, task, rid)
            state = row["progress"].get(ident)
            if (
                row["cancelled"]
                or state is None
                or state["stage"] == "cancelled"
                or row["bindings"].get(ident) != center_reference(d, a)
            ):
                raise ContractError("version_conflict")
            p = preparation_path(owner, vault, task, ident, rid, kind="manual")
            old = unit.get(p)
            if old is not None:
                if old["request"] != request:
                    raise ContractError("idempotency_conflict")
                if old["runId"] is None:
                    _verified(unit, owner, vault, task, row, d, self.now())
                return {
                    "triggerId": old["triggerId"],
                    "request": old["request"],
                    "triggerKind": "manual",
                    "manualControl": row["control"],
                    "runId": old["runId"],
                }
            _verified(unit, owner, vault, task, row, d, self.now())
            # FIFO per actor, independent across actors and from the scheduled domain.
            for previous in _queue(unit, owner, vault, task)["ids"]:
                if previous == rid:
                    break
                earlier = _intent(unit, owner, vault, task, previous)
                summary = _summary(unit, owner, vault, task, earlier, self.now())
                progress = next(
                    (v for v in summary["snapshot"]["executors"] if v["assignmentId"] == ident),
                    None,
                )
                if progress and progress["stage"] in {
                    "waiting",
                    "running",
                    "awaiting_confirmation",
                }:
                    raise ContractError("version_conflict")
            trigger = assignment_trigger_id(a, rid, kind="manual")
            unit.put(
                p,
                {
                    "request": snapshot(request),
                    "triggerId": trigger,
                    "createdAt": self.now(),
                    "runId": None,
                    "resultId": None,
                    "stage": "waiting",
                    "kind": "manual",
                },
            )
            unit.put(
                trigger_path(owner, vault, task, trigger),
                {"assignmentId": ident, "baseTriggerId": rid, "kind": "manual"},
            )
            unit.put(
                intent_path(owner, vault, task, rid),
                {**row, "progress": {**row["progress"], ident: {**state, "claimedAt": self.now()}}},
            )
            return {
                "triggerId": trigger,
                "request": snapshot(request),
                "triggerKind": "manual",
                "manualControl": row["control"],
                "runId": None,
            }

        return self.store.transact(write)
