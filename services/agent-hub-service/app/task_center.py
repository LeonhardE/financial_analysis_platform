"""Additive, Owner-reviewed task assignments; no dispatch, scheduler or key custody.

Persisted enrollment is a permanent execution fence, independent of rollout flags.
Old manifests/receipts keep their wire format; attribution is an immutable sidecar.
"""

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.encrypted.task_center import (
    TASK_CENTER_PROFILE,
    aggregate_progress,
    assignment_id,
    assignment_trigger_id,
    bind_task_run,
    plan_assignment,
    plan_task_lifecycle,
    plan_task_rules,
    require_assignment_current,
    require_run_current,
    validate_assignment,
    validate_definition,
)
from folioview_shared.identity import owner_key

from .persistent_agents import snapshot
from .persistent_execution import PersistentExecutionService
from .persistent_publications import (
    PersistentPublicationService,
    authority_head,
    authority_path,
    stored_authority,
)
from .provider_connections import stored_slot
from .store import StoreUnavailable, document_path
from .tasks import _head, _index
from .vaults import _current

VERSIONS = ("taskVersion", "executionEpoch", "ruleVersion", "lifecycleEpoch")


def task_path(owner, vault, task):
    return document_path("hub_center_tasks", owner, vault, task)


def assignment_path(owner, vault, task, ident):
    return document_path("hub_center_assignments", owner, vault, task, ident)


def preparation_path(owner, vault, task, ident, base, *, kind="legacy_unknown"):
    # Credential/rule changes cannot turn retrying one intent into a second Run.
    if kind != "legacy_unknown":
        return document_path("hub_center_preparations", owner, vault, task, ident, kind, base)
    return document_path("hub_center_preparations", owner, vault, task, ident, base)


def trigger_path(owner, vault, task, trigger):
    return document_path("hub_center_triggers", owner, vault, task, trigger)


def enrolled(unit, owner, vault, task):
    return authority_head(unit, owner, vault, task) == {"taskCenter": True}


def definition_row(unit, owner, vault, task):
    row = unit.get(task_path(owner, vault, task))
    if row is None:
        return None
    try:
        if set(row) - {"lifecycleControls", "cleanup"} != {
            "definition",
            "control",
            "assignmentIds",
            "legacyHead",
        }:
            raise StoreUnavailable
        d = validate_definition(row["definition"])
        if (d["ownerSubject"], d["vaultId"], d["taskId"]) != (owner, vault, task):
            raise StoreUnavailable
        ids = row["assignmentIds"]
        if type(ids) is not list or len(ids) > 32 or ids != sorted(set(ids)):
            raise StoreUnavailable
        for ident in ids:
            validate_schema("Identifier", ident)
    except (ContractError, KeyError, TypeError):
        raise StoreUnavailable from None
    return row


def assigned_row(unit, owner, vault, task, ident):
    row = unit.get(assignment_path(owner, vault, task, ident))
    if row is None:
        return None
    try:
        if set(row) != {"assignment", "control"}:
            raise StoreUnavailable
        a = validate_assignment(row["assignment"])
        if (a["ownerSubject"], a["vaultId"], a["taskId"], a["assignmentId"]) != (
            owner,
            vault,
            task,
            ident,
        ):
            raise StoreUnavailable
    except (ContractError, KeyError, TypeError):
        raise StoreUnavailable from None
    return row


def current_assignment(unit, owner, vault, task, connection, fingerprint):
    if not enrolled(unit, owner, vault, task):
        return None
    row = definition_row(unit, owner, vault, task)
    conn = unit.get(document_path("hub_oauth_connections", owner, connection))
    if row is None:
        raise StoreUnavailable
    if conn is None or conn.get("provider") not in {"muse", "chatgpt"}:
        raise ContractError("insufficient_scope")
    slot = stored_slot(unit, owner, vault, conn["provider"])
    if slot is None:
        raise ContractError("insufficient_scope")
    ident = assignment_id(owner, vault, task, slot["slot"]["slotId"])
    assigned = assigned_row(unit, owner, vault, task, ident)
    if assigned is None or assigned["assignment"]["credential"]["connectionId"] != connection:
        raise ContractError("insufficient_scope")
    a = require_assignment_current(
        row["definition"], assigned["assignment"], slot["slot"], authority_fingerprint=fingerprint
    )
    return row["definition"], a, slot["slot"]


def bind_prepared_run(unit, owner, vault, connection, manifest):
    task, trigger = manifest["taskId"], manifest["triggerId"]
    if not enrolled(unit, owner, vault, task):
        if trigger.startswith("tc_"):
            raise ContractError("insufficient_scope")
        return None
    d, a, slot = current_assignment(
        unit, owner, vault, task, connection, manifest["taskPublicationFingerprint"]
    )
    lookup = unit.get(trigger_path(owner, vault, task, trigger))
    if lookup is None or set(lookup) - {"kind"} != {"assignmentId", "baseTriggerId"}:
        raise ContractError("insufficient_scope")
    p = unit.get(
        preparation_path(
            owner,
            vault,
            task,
            lookup["assignmentId"],
            lookup["baseTriggerId"],
            kind=lookup.get("kind", "legacy_unknown"),
        )
    )
    if p is None or p["request"]["operationId"] != manifest["stableOperationId"]:
        raise ContractError("idempotency_conflict")
    expected = center_reference(d, a)
    if p["request"]["binding"] != expected or p["triggerId"] != trigger:
        raise ContractError("version_conflict")
    kind = lookup.get("kind", "legacy_unknown")
    manual = None
    if kind == "manual":
        from .manual_intents import manual_for_run

        manual = manual_for_run(unit, d, a, p, manifest)
    binding = bind_task_run(
        d,
        a,
        slot,
        manifest,
        base_trigger_id=lookup["baseTriggerId"],
        kind=kind,
        manual_intent=manual,
    )
    unit.put(
        preparation_path(owner, vault, task, a["assignmentId"], lookup["baseTriggerId"], kind=kind),
        {**p, "runId": manifest["runId"], "stage": "running"},
    )
    return binding


def check_center_run(unit, owner, vault, connection, run, manifest):
    current = current_assignment(
        unit, owner, vault, manifest["taskId"], connection, manifest["taskPublicationFingerprint"]
    )
    binding = run.get("taskCenter")
    if current is None:
        if binding is not None:
            raise StoreUnavailable
        return
    if binding is None:
        raise ContractError("version_conflict")
    d, a, slot = current
    require_run_current(
        binding, d, a, slot, authority_fingerprint=manifest["taskPublicationFingerprint"]
    )


def observe_center_result(unit, binding, result):
    owner, vault, task, ident = (
        binding[k] for k in ("ownerSubject", "vaultId", "taskId", "assignmentId")
    )
    path = preparation_path(
        owner,
        vault,
        task,
        ident,
        binding["trigger"]["baseTriggerId"],
        kind=binding["trigger"]["kind"],
    )
    row = unit.get(path)
    if row is None or row["runId"] != binding["runId"]:
        raise StoreUnavailable
    unit.put(path, {**row, "stage": "result_received", "resultId": result})
    if binding["trigger"]["kind"] == "manual":
        from .manual_intents import observe_manual_result

        observe_manual_result(unit, binding, result)


def center_reference(definition, assignment):
    return {
        **{k: definition[k] for k in VERSIONS},
        **{k: assignment[k] for k in ("assignmentId", "assignmentVersion", "slotGeneration")},
    }


class TaskCenterOwnerService(PersistentPublicationService):
    def _owner_task(self, unit, uid, vault, task):
        for value in (vault, task):
            validate_schema("Identifier", value)
        owner = owner_key(uid)
        v, registry = _current(unit, owner, self.now(), vault)
        head = _head(unit, owner, vault, task, _index(unit, owner, vault))
        if head is None:
            raise ContractError("not_found")
        return owner, v, registry, head["metadata"]

    def state(self, uid, vault, task):
        for value in (vault, task):
            validate_schema("Identifier", value)

        def read(unit):
            owner, _, _, meta = self._owner_task(unit, uid, vault, task)
            row = definition_row(unit, owner, vault, task)
            assignments = []
            if row is not None and row["definition"]["status"] == "active":
                for ident in row["assignmentIds"]:
                    record = assigned_row(unit, owner, vault, task, ident)
                    if record is None:
                        raise StoreUnavailable
                    a = record["assignment"]
                    assignments.append(
                        {
                            **record,
                            "authority": stored_authority(
                                unit, owner, vault, task, a["credential"]["connectionId"]
                            ),
                            "plan": center_plan(unit, row["definition"], a, now=self.now()),
                        }
                    )
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": TASK_CENTER_PROFILE,
                "taskId": task,
                "taskVersion": meta["taskVersion"],
                "executionEpoch": meta["executionEpoch"],
                "rules": row,
                "assignments": assignments,
                "dispatchSupported": False,
                "nativeScheduleAttested": False,
            }

        return self.store.transact(read)

    def receipt(self, uid, vault, task, operation):
        for value in (vault, task):
            validate_schema("Identifier", value)
        validate_schema("OperationIdentifier", operation)

        def read(unit):
            owner, *_ = self._owner_task(unit, uid, vault, task)
            old = unit.get(document_path("hub_center_operations", owner, vault, operation))
            if old is None or old["taskId"] != task:
                raise ContractError("not_found")
            return old["receipt"]

        return self.store.transact(read)

    def command(self, uid, vault, task, signed, operation):
        for value in (vault, task):
            validate_schema("Identifier", value)
        validate_schema("OperationIdentifier", operation)
        validate_schema("SignedObject", signed)
        _, payload = _signed_parts(signed)
        action = payload.get("action")
        if action not in {
            "set_rules",
            "set_assignment",
            "remove_assignment",
            "trash",
            "restore",
            "purge",
        }:
            raise ContractError("malformed_request")
        if payload.get("stableOperationId") != operation:
            raise ContractError("recipient_binding_mismatch")
        fp = signing_input_fingerprint(signed)

        def write(unit):
            owner, _, registry, meta = self._owner_task(unit, uid, vault, task)
            op = document_path("hub_center_operations", owner, vault, operation)
            old = unit.get(op)
            if old is not None:
                if old["fingerprint"] != fp or old["taskId"] != task:
                    raise ContractError("idempotency_conflict")
                return old["receipt"]
            if meta["status"] != "active" and action not in {
                "set_rules",
                "trash",
                "restore",
                "purge",
            }:
                raise ContractError("key_authorization_required")
            row = definition_row(unit, owner, vault, task)
            definition = None if row is None else row["definition"]
            args = dict(
                registry=registry,
                owner_subject=owner,
                vault_id=vault,
                task_id=task,
                current_definition=definition,
                now=self.now(),
            )
            assigned = None
            if action in {"trash", "restore", "purge"}:
                if definition is None or (
                    definition["taskVersion"],
                    definition["executionEpoch"],
                ) != (meta["taskVersion"], meta["executionEpoch"]):
                    raise ContractError("version_conflict")
                from .task_lifecycle import lifecycle_index, lifecycle_path

                definition = plan_task_lifecycle(signed, **args, action=action)
                if action in {"trash", "purge"}:
                    from .manual_intents import fence_manuals

                    fence_manuals(unit, owner, vault, task)
                controls = [*row.get("lifecycleControls", []), signed]
                # Same bounded lifetime as task revisions; never silently discard proof.
                if len(controls) > 50:
                    raise ContractError("version_conflict")
                row = {**row, "definition": definition, "lifecycleControls": controls}
                index = lifecycle_index(unit, owner, vault)
                index["tasks"][task] = definition["status"]
                index["version"] += 1
                unit.put(lifecycle_path(owner, vault), index)
            elif action == "set_rules":
                definition = plan_task_rules(
                    signed,
                    **args,
                    task_version=meta["taskVersion"],
                    execution_epoch=meta["executionEpoch"],
                )
                if row is None:
                    old_authority = stored_authority(unit, owner, vault, task)
                    head = unit.get(document_path("hub_persistent_result_indexes", owner, vault))
                    legacy = None
                    if head is not None:
                        from .persistent_results import PersistentResultService

                        page = PersistentResultService._page(
                            self, unit, owner, vault, head["pageId"]
                        )
                        legacy = {"pageId": page["pageId"], "before": len(page["resultIds"])}
                    row = {
                        "definition": definition,
                        "control": signed,
                        "assignmentIds": [],
                        "legacyHead": legacy,
                    }
                    if old_authority is not None:
                        unit.put(
                            authority_path(
                                owner, vault, task, old_authority["context"]["connectionId"]
                            ),
                            old_authority,
                        )
                    unit.put(authority_path(owner, vault, task), {"taskCenter": True})
                else:
                    row = {**row, "definition": definition, "control": signed}
            else:
                if (
                    definition is None
                    or definition["status"] != "active"
                    or (
                        definition["taskVersion"],
                        definition["executionEpoch"],
                    )
                    != (meta["taskVersion"], meta["executionEpoch"])
                ):
                    raise ContractError("version_conflict")
                ident = payload.get("assignmentId")
                validate_schema("Identifier", ident)
                previous = assigned_row(unit, owner, vault, task, ident)
                slot, identity = None, None
                if action == "set_assignment":
                    target = payload.get("assignment")
                    if type(target) is not dict or target.get("provider") not in {
                        "muse",
                        "chatgpt",
                    }:
                        raise ContractError("malformed_request")
                    slotrow = stored_slot(unit, owner, vault, target["provider"])
                    if slotrow is None or slotrow["slot"]["currentCredential"] is None:
                        raise ContractError("key_authorization_required")
                    slot = slotrow["slot"]
                    connection = slot["currentCredential"]["connectionId"]
                    _, _, _, _, identity = self.live(unit, uid, vault, connection)
                assigned = plan_assignment(
                    signed,
                    **args,
                    current_assignment=None if previous is None else previous["assignment"],
                    current_slot=slot,
                    current_identity=identity,
                    remove=action == "remove_assignment",
                )
                ids = sorted(set([*row["assignmentIds"], assigned["assignmentId"]]))
                if len(ids) > 32:
                    raise ContractError("version_conflict")
                row = {**row, "assignmentIds": ids}
                unit.put(
                    assignment_path(owner, vault, task, assigned["assignmentId"]),
                    {"assignment": assigned, "control": signed},
                )
            receipt = {
                "contractVersion": CONTRACT_VERSION,
                "profile": TASK_CENTER_PROFILE,
                "taskId": task,
                "operationId": operation,
                "fingerprint": fp,
                "definition": definition,
                "assignment": assigned,
                "requiresFreshDelivery": assigned is not None and assigned["status"] == "active",
                "nativeScheduleAttested": False,
            }
            unit.put(task_path(owner, vault, task), row)
            unit.put(op, {"taskId": task, "fingerprint": fp, "receipt": receipt})
            return snapshot(receipt)

        return self.store.transact(write)

    def progress(self, uid, vault, task, request):
        if type(request) is not dict or set(request) != {"requestId", "assignmentIds"}:
            raise ContractError("malformed_request")
        validate_schema("OperationIdentifier", request["requestId"])
        ids = request["assignmentIds"]
        if type(ids) is not list or not 1 <= len(ids) <= 32 or len(set(ids)) != len(ids):
            raise ContractError("malformed_request")
        for i in ids:
            validate_schema("Identifier", i)

        def read(unit):
            owner, *_ = self._owner_task(unit, uid, vault, task)
            row = definition_row(unit, owner, vault, task)
            if row is None:
                raise ContractError("not_found")
            entries, dates = [], []
            for ident in ids:
                a = assigned_row(unit, owner, vault, task, ident)
                if a is None:
                    raise ContractError("not_found")
                p = unit.get(preparation_path(owner, vault, task, ident, request["requestId"]))
                entries.append(
                    {
                        "assignmentId": ident,
                        "assignmentVersion": a["assignment"]["assignmentVersion"]
                        if p is None
                        else p["request"]["binding"]["assignmentVersion"],
                        "runId": None if p is None else p["runId"],
                        "resultId": None if p is None else p["resultId"],
                        "stage": "awaiting_confirmation" if p is None else p["stage"],
                    }
                )
                if p is not None:
                    dates.append(p["createdAt"])
            snap = {
                "contractVersion": CONTRACT_VERSION,
                "profile": TASK_CENTER_PROFILE,
                "ownerSubject": owner,
                "vaultId": vault,
                "taskId": task,
                "requestId": request["requestId"],
                "requestedAt": min(dates) if dates else self.now(),
                "executors": entries,
            }
            return {
                "snapshot": snap,
                "aggregate": aggregate_progress(snap),
                "nativeScheduleAttested": False,
            }

        return self.store.transact(read)


class TaskCenterAgentService(PersistentExecutionService):
    from .task_center_transport import verify_center_request

    verify_request = staticmethod(verify_center_request)

    def context(self, owner, vault, connection, proof, path, request):
        if type(request) is not dict or set(request) != {"taskId"}:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["taskId"])

        def read(unit):
            *_, identity = self.authenticate(unit, owner, vault, connection, proof, path, request)
            a = self.task_authority(unit, owner, vault, connection, identity, request["taskId"])
            current = current_assignment(
                unit, owner, vault, request["taskId"], connection, a["fingerprint"]
            )
            if current is None:
                raise ContractError("not_found")
            d, assigned, _ = current
            row = definition_row(unit, owner, vault, request["taskId"])
            original = assigned_row(unit, owner, vault, request["taskId"], assigned["assignmentId"])
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": TASK_CENTER_PROFILE,
                "definition": d,
                "assignment": assigned,
                "ruleControl": row["control"],
                "lifecycleControls": row.get("lifecycleControls", []),
                "assignmentControl": original["control"],
                "binding": center_reference(d, assigned),
                "authority": a,
                "plan": center_plan(unit, d, assigned, now=self.now()),
                "dispatchSupported": False,
                "nativeScheduleAttested": False,
            }

        return self.store.transact(read)

    def prepare(self, owner, vault, connection, proof, path, request):
        if type(request) is not dict or set(request) != {
            "taskId",
            "baseTriggerId",
            "operationId",
            "binding",
            "taskPublicationFingerprint",
        }:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["taskId"])
        for field in ("baseTriggerId", "operationId"):
            validate_schema("OperationIdentifier", request[field])
        validate_schema("Digest", request["taskPublicationFingerprint"])

        def write(unit):
            *_, identity = self.authenticate(unit, owner, vault, connection, proof, path, request)
            task = request["taskId"]
            authority = self.task_authority(unit, owner, vault, connection, identity, task)
            current = current_assignment(
                unit, owner, vault, task, connection, authority["fingerprint"]
            )
            if current is None:
                raise ContractError("not_found")
            d, a, _ = current
            if (
                request["binding"] != center_reference(d, a)
                or authority["fingerprint"] != request["taskPublicationFingerprint"]
            ):
                raise ContractError("version_conflict")
            p = preparation_path(owner, vault, task, a["assignmentId"], request["baseTriggerId"])
            old = unit.get(p)
            if old is not None:
                if old["request"] != request:
                    raise ContractError("idempotency_conflict")
                return {
                    "triggerId": old["triggerId"],
                    "request": old["request"],
                    "triggerKind": "legacy_unknown",
                }
            trigger = assignment_trigger_id(a, request["baseTriggerId"])
            unit.put(
                p,
                {
                    "request": snapshot(request),
                    "triggerId": trigger,
                    "createdAt": self.now(),
                    "runId": None,
                    "resultId": None,
                    "stage": "waiting",
                },
            )
            unit.put(
                trigger_path(owner, vault, task, trigger),
                {"assignmentId": a["assignmentId"], "baseTriggerId": request["baseTriggerId"]},
            )
            return {
                "triggerId": trigger,
                "request": snapshot(request),
                "triggerKind": "legacy_unknown",
            }

        return self.store.transact(write)

    def report_plan(self, owner, vault, connection, proof, path, request):
        from .persistent_plans import MAX_REPORTS_PER_DAY, STATUSES

        if type(request) is not dict or set(request) != {
            "taskId",
            "operationId",
            "binding",
            "expectedVersion",
            "provider",
            "planReferenceHash",
            "reportedStatus",
            "reportedAt",
        }:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["taskId"])
        validate_schema("OperationIdentifier", request["operationId"])
        if request["planReferenceHash"] is not None:
            validate_schema("Digest", request["planReferenceHash"])
        if (
            type(request["reportedStatus"]) is not str
            or request["reportedStatus"] not in STATUSES
            or type(request["expectedVersion"]) is not int
            or not 0 <= request["expectedVersion"] < 9007199254740991
            or type(request["reportedAt"]) is not int
            or request["reportedAt"] < 0
            or (
                request["reportedStatus"] in {"enabled", "paused"}
                and request["planReferenceHash"] is None
            )
        ):
            raise ContractError("malformed_request")

        def write(unit):
            _, _, registry, conn, identity = self.authenticate(
                unit, owner, vault, connection, proof, path, request
            )
            op = document_path(
                "hub_center_plan_operations", owner, vault, connection, request["operationId"]
            )
            old = unit.get(op)
            if old is not None:
                if old["request"] != request:
                    raise ContractError("idempotency_conflict")
                return old
            authority = self.task_authority(
                unit, owner, vault, connection, identity, request["taskId"]
            )
            current = current_assignment(
                unit, owner, vault, request["taskId"], connection, authority["fingerprint"]
            )
            if current is None:
                raise ContractError("not_found")
            d, a, _ = current
            if (
                request["binding"] != center_reference(d, a)
                or request["provider"] != conn["provider"]
            ):
                raise ContractError("version_conflict")
            if request["reportedAt"] > self.now() + 2 or (
                d["schedule"] is None and request["reportedStatus"] in {"enabled", "paused"}
            ):
                raise ContractError("malformed_request")
            state = center_plan(unit, d, a, now=self.now())
            if state["version"] != request["expectedVersion"]:
                raise ContractError("version_conflict")
            qp = document_path(
                "hub_persistent_plan_quotas", owner, connection, str(self.now() // 86400)
            )
            quota = unit.get(qp) or {"count": 0}
            if type(quota.get("count")) is not int or not 0 <= quota["count"] < MAX_REPORTS_PER_DAY:
                raise ContractError("version_conflict")
            result = {
                "binding": center_reference(d, a),
                "version": state["version"] + 1,
                "request": snapshot(request),
                "proof": snapshot(proof),
                "identity": snapshot(identity),
                "registrySequence": registry.registry_sequence,
                "checkpointDigest": registry.checkpoint_digest,
                "receivedAt": self.now(),
                "authority": "agent_statement",
                "nativeScheduleAttested": False,
            }
            self.authenticate(unit, owner, vault, connection, proof, path, request)
            unit.put(
                document_path(
                    "hub_center_plans", owner, vault, request["taskId"], a["assignmentId"]
                ),
                result,
            )
            unit.put(op, result)
            unit.put(qp, {"count": quota["count"] + 1})
            return result

        return self.store.transact(write)


def center_plan(unit, definition, assignment, *, now):
    owner, vault, task = (definition[k] for k in ("ownerSubject", "vaultId", "taskId"))
    path = document_path("hub_center_plans", owner, vault, task, assignment["assignmentId"])
    row = unit.get(path)
    current_assignment_valid = False
    slot = stored_slot(unit, owner, vault, assignment["provider"])
    connection = assignment["credential"]["connectionId"]
    conn = unit.get(document_path("hub_oauth_connections", owner, connection))
    if slot is not None and conn is not None and conn.get("status") == "active":
        from .persistent_agents import require_managed_credential, stored_identity

        identity = stored_identity(unit, owner, vault, connection)
        try:
            require_assignment_current(
                definition,
                assignment,
                slot["slot"],
                authority_fingerprint=assignment["authorityFingerprint"],
            )
            if identity is None or identity["identity"]["status"] != "active":
                raise ContractError("key_authorization_required")
            require_managed_credential(identity, now=now, connection=conn)
            current_assignment_valid = True
        except ContractError:
            pass
    current = (
        current_assignment_valid
        and row is not None
        and row["binding"] == center_reference(definition, assignment)
    )
    return {
        "binding": center_reference(definition, assignment),
        "schedule": definition["schedule"],
        "currentAssignment": current_assignment_valid,
        "version": 0 if row is None else row["version"],
        "status": row["request"]["reportedStatus"] if current else "unconfirmed",
        "reported": row,
        "authority": "agent_statement",
        "nativeScheduleAttested": False,
    }
