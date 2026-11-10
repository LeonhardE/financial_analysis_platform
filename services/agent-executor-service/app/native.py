"""Narrow native analysis workflow: frozen ciphertext in, owner-encrypted report out."""

import hashlib
import time
from datetime import datetime

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    CONTENT_PROFILE,
    PersistentEnvelopeExpectation,
    inspect_persistent_carrier,
    open_persistent_content,
    persistent_manifest_fingerprint,
    persistent_run_id,
    seal_persistent_content,
    validate_persistent_manifest,
    verify_persistent_carrier,
)
from folioview_shared.encrypted.schema import validate_schema

from .contracts import closed, digest, operation_id, require, safe
from .hub import HubMissing
from .hub_trust import consent_chain, directory

RESOURCE_TYPES = {
    "holdings": "holdings_snapshot",
    "watchlist": "watchlist_evidence",
    "channel_follows": "channel_follows_evidence",
}


class NativeEngine:
    def __init__(self, executor, native, hub, *, clock=time.time):
        self.executor, self.native, self.hub, self.clock = executor, native, hub, clock

    def _op(self, run, intent):
        return {
            "bindingDigest": digest(self.executor.config.binding),
            "runId": run,
            "operationId": operation_id(),
            "requestDigest": digest(intent),
        }

    def _save(self, access, state, run, reason):
        old = self.executor.snapshot_state(access)
        state["sequence"] = old["sequence"] + 1
        operation = self._op(
            run,
            {
                "reason": reason,
                "stateSequence": state["sequence"],
                "outboxDigest": digest(state["outbox"]),
                "pins": state.get("hubPins"),
            },
        )
        receipt = {
            "operation": operation,
            "receiptId": "state_" + operation["operationId"],
            "resultDigest": operation["requestDigest"],
        }
        self.executor.persist(access, operation, state, receipt)

    def _package(self, item):
        return strict_json_loads(b64url_decode(item["bytes"], max_bytes=589824), max_bytes=589824)

    def _record(self, state, operation, package):
        raw = canonical_json(package)
        require(len(raw) <= 589824)
        state["outbox"][operation["operationId"]] = {
            "operation": operation,
            "bytes": b64url_encode(raw),
            "digest": hashlib.sha256(raw).hexdigest(),
        }

    def _find(self, state, run, kind):
        matches = [
            (key, item, self._package(item))
            for key, item in state["outbox"].items()
            if item["operation"]["runId"] == run
        ]
        matches = [row for row in matches if row[2].get("kind") == kind]
        require(len(matches) <= 1)
        return matches[0] if matches else None

    def _trust(self, access):
        e = self.executor
        state = e.snapshot_state(access)
        session = self.hub.call("session", {})
        registry, registries, identity = directory(
            session, e.config, self.native, state.get("hubPins"), int(self.clock())
        )
        consent, pins = consent_chain(
            self.hub,
            session,
            registries,
            registry,
            identity,
            e.config,
            state.get("hubPins"),
            int(self.clock()),
        )
        if pins != state.get("hubPins"):
            state["hubPins"] = pins
            self._save(access, state, "registry_pins", "advance_verified_hub_pins")
        return {"registry": registry, "identity": identity, "consent": consent, "pins": pins}

    def _gate(self, access, purpose, operation, resources):
        trust = self._trust(access)
        current_operation = {**operation, "bindingDigest": digest(self.executor.config.binding)}
        trust["_grant"] = self.executor.authorize(access, purpose, current_operation, resources)
        require(self.hub.deadline is None or time.monotonic() < self.hub.deadline)
        return trust

    def _recheck(self, access, trust, purpose, operation):
        # One lease authorizes this logical operation. Reread authority after I/O
        # without minting an unrelated second lease for the same plaintext use.
        current = self._trust(access)
        _, checkpoint = self.executor.current(access)
        grant = trust["_grant"]
        payload = verify_jws(
            grant["lease"], self.executor.config.public["policyJwk"], typ="fv-control+jws"
        )
        expected = {**operation, "bindingDigest": digest(self.executor.config.binding)}
        verified = self.executor.policy.verify_lease(grant, payload["challenge"], expected, purpose)
        require(checkpoint == verified)
        current["_grant"] = grant
        return current

    def _manifest(self, response, *, task=None, trigger=None, run=None):
        closed(
            response,
            {"contractVersion", "profile", "manifest", "manifestFingerprint", "state", "resultId"},
        )
        require(
            response["contractVersion"] == CONTRACT_VERSION
            and response["profile"] == CONTENT_PROFILE
        )
        m = validate_persistent_manifest(response["manifest"])
        b = self.executor.config.binding
        require(
            all(m[k] == b[k] for k in BINDING_FIELDS)
            and m["purpose"] == "analysis"
            and m["resultPolicy"] == "owner_inbox"
            and response["manifestFingerprint"] == persistent_manifest_fingerprint(m)
            and response["state"] in {"ready", "submitted"}
        )
        if task is not None:
            require(m["taskId"] == task and m["triggerId"] == trigger)
        if run is not None:
            require(m["runId"] == run)
        allowed = self.executor.config.public["scope"]["resourceBindings"]
        require(
            all({"ref": i["ref"], "sourceEpoch": i["sourceEpoch"]} in allowed for i in m["inputs"])
        )
        return m

    def _resources(self, manifest):
        return [{"ref": i["ref"], "sourceEpoch": i["sourceEpoch"]} for i in manifest["inputs"]]

    def _begin(self, access, task, trigger):
        validate_schema("Identifier", task)
        validate_schema("OperationIdentifier", trigger)
        b = self.executor.config.binding
        run = persistent_run_id(
            owner_subject=b["ownerSubject"], vault_id=b["vaultId"], task_id=task, trigger_id=trigger
        )
        self._trust(access)
        state = self.executor.snapshot_state(access)
        pending = self._find(state, run, "begin")
        if pending is None:
            try:
                existing = self.hub.call("runs/receipt", {"runId": run})
            except HubMissing:
                existing = None
            # An existing unknown Run must not become a newly generated intent.
            require(existing is None)
            tasks = self.hub.call("tasks", {})
            closed(tasks, {"contractVersion", "profile", "tasks"})
            require(type(tasks["tasks"]) is list and len(tasks["tasks"]) <= 100)
            selected = [t for t in tasks["tasks"] if t.get("taskId") == task]
            require(len(selected) == 1)
            selected = closed(
                selected[0],
                {"taskId", "taskVersion", "executionEpoch", "publicationId", "fingerprint"},
            )
            validate_schema("Digest", selected["fingerprint"])
            operation = self._op(
                run,
                {
                    "taskId": task,
                    "triggerId": trigger,
                    "taskPublicationFingerprint": selected["fingerprint"],
                },
            )
            body = {
                "taskId": task,
                "triggerId": trigger,
                "operationId": operation["operationId"],
                "taskPublicationFingerprint": selected["fingerprint"],
            }
            package = {"kind": "begin", "body": body, "manifest": None, "manifestFingerprint": None}
            self._record(state, operation, package)
            self._save(access, state, run, "stage_original_begin")
            pending = (operation["operationId"], state["outbox"][operation["operationId"]], package)
        key, item, package = pending
        closed(package, {"kind", "body", "manifest", "manifestFingerprint"})
        operation = item["operation"]
        if package["manifest"] is None:
            self._gate(access, "execute", operation, [])
        else:
            self.executor.current(access)
        response = self.hub.call(
            "runs/begin" if package["manifest"] is None else "runs/receipt",
            package["body"] if package["manifest"] is None else {"runId": run},
        )
        m = self._manifest(response, task=task, trigger=trigger, run=run)
        require(
            m["stableOperationId"] == package["body"]["operationId"]
            and m["taskPublicationFingerprint"] == package["body"]["taskPublicationFingerprint"]
        )
        if package["manifest"] is None:
            state = self.executor.snapshot_state(access)
            package.update(manifest=m, manifestFingerprint=persistent_manifest_fingerprint(m))
            self._record(state, operation, package)
            self._save(access, state, run, "pin_original_manifest")
        else:
            require(
                package["manifest"] == m
                and package["manifestFingerprint"] == response["manifestFingerprint"]
            )
        return m

    def _carrier(self, response, manifest, publication, trust):
        require(
            response.get("contractVersion") == CONTRACT_VERSION
            and response.get("profile") == CONTENT_PROFILE
        )
        closed(
            response,
            {"contractVersion", "profile", "manifestFingerprint", "envelope"},
            maximum=1048576,
        )
        require(response["manifestFingerprint"] == persistent_manifest_fingerprint(manifest))
        carrier, c = inspect_persistent_carrier(response["envelope"])
        task = publication == manifest["taskPublicationId"]
        item = (
            None
            if task
            else next((i for i in manifest["inputs"] if i["publicationId"] == publication), None)
        )
        require(task or item is not None)
        expected_fingerprint = (
            manifest["taskPublicationFingerprint"] if task else item["publicationFingerprint"]
        )
        # The durably frozen artifact fingerprint selects every signed context
        # byte. Dynamic authorization below still uses independently verified pins.
        require(signing_input_fingerprint(carrier["proof"]) == expected_fingerprint)
        fields = (
            {
                k: manifest[k]
                for k in (
                    "taskId",
                    "taskVersion",
                    "executionEpoch",
                    "authorityId",
                    "authorityVersion",
                )
            }
            if task
            else {
                k: item[k]
                for k in ("ref", "sourceEpoch", "sourceRevision", "permissionId", "permissionEpoch")
            }
        )
        if task:
            fields.update(
                {
                    k: c[k]
                    for k in (
                        "expectedAuthorityVersion",
                        "expectedAuthorityDigest",
                        "ownerTaskFingerprint",
                    )
                }
            )
            fields.update(resultPolicy="owner_inbox", resourceBindings=self._resources(manifest))
            kind, ident = "task", manifest["taskId"]
        else:
            # A persistent copy ID differs from its producer resource ID.
            kind, ident = RESOURCE_TYPES[item["ref"]["kind"]], item["objectId"]
            consent = trust["consent"]
            require(consent is not None)
            permissions = [
                p for p in consent["permissions"] if p["permissionId"] == item["permissionId"]
            ]
            require(len(permissions) == 1)
            p = permissions[0]
            require(
                p["status"] == "active"
                and p["permissionEpoch"] == item["permissionEpoch"]
                and p["ref"] == item["ref"]
                and p["sourceEpoch"] == item["sourceEpoch"]
                and (
                    item["sourceRevision"] >= p["fromRevision"]
                    or item["sourceRevision"] in p["selectedHistory"]
                )
            )
        registry = trust["registry"]
        recovery = sorted(
            k
            for k in registry.active_key_ids
            if registry.certificates[k]["role"] == "recovery_enc"
            and registry.certificates[k]["connectionId"] is None
        )
        require(len(recovery) == 1)
        recipients = tuple(
            sorted([self.executor.config.binding["agentEncryptionKeyId"], recovery[0]])
        )
        b = self.executor.config.binding
        verified = verify_persistent_carrier(
            carrier,
            registry=registry,
            root_jwk=self.executor.config.public["rootJwk"],
            current_identity=trust["identity"],
            expectation=PersistentEnvelopeExpectation(
                b["ownerSubject"],
                b["vaultId"],
                b["connectionId"],
                b["clientId"],
                kind,
                ident,
                c["revision"],
                recipients,
                fields,
            ),
            now=int(self.clock()),
            purpose="agent_read",
        )
        require(verified.context["stableOperationId"] == publication)
        return verified

    def input(self, access, task, trigger, publication):
        m = self._begin(access, task, trigger)
        require(m["createdAt"] <= int(self.clock()) < m["expiresAt"])
        publication = m["taskPublicationId"] if publication is None else publication
        validate_schema("OperationIdentifier", publication)
        require(
            publication == m["taskPublicationId"]
            or any(i["publicationId"] == publication for i in m["inputs"])
        )
        op = self._op(
            m["runId"],
            {"manifest": persistent_manifest_fingerprint(m), "publicationId": publication},
        )
        trust = self._gate(access, "execute", op, self._resources(m))
        task_response = None
        if publication != m["taskPublicationId"]:
            task_response = self.hub.call(
                "runs/input", {"runId": m["runId"], "publicationId": m["taskPublicationId"]}
            )
        response = self.hub.call("runs/input", {"runId": m["runId"], "publicationId": publication})
        trust = self._recheck(access, trust, "execute", op)
        verified = self._carrier(response, m, publication, trust)
        self.executor.current(access)
        private = open_persistent_content(
            verified.carrier["jwe"], self.executor._keys["encryption"], context=verified.context
        )
        if task_response is not None:
            task_verified = self._carrier(task_response, m, m["taskPublicationId"], trust)
            task_private = open_persistent_content(
                task_verified.carrier["jwe"],
                self.executor._keys["encryption"],
                context=task_verified.context,
            )["payload"]
            policy, resource = task_private["inputPolicy"], private["payload"]
            require(
                resource["state"] == "ready"
                and (resource["coverage"]["state"] == "complete" or policy["allowPartial"])
            )
            fetched = datetime.fromisoformat(resource["fetchedAt"]).timestamp()
            require(-30 <= self.clock() - fetched <= policy["maxFetchedAgeSeconds"])
            require(policy["allowUnknownAsOf"] or resource["sourceAsOf"] is not None)
        self.executor.current(access)
        return {
            "runId": m["runId"],
            "manifestFingerprint": persistent_manifest_fingerprint(m),
            "taskId": m["taskId"],
            "publicationId": publication,
            "sourceVersion": verified.context.get("sourceRevision"),
            "availableInputs": [
                {
                    "publicationId": i["publicationId"],
                    "kind": i["ref"]["kind"],
                    "sourceRevision": i["sourceRevision"],
                }
                for i in m["inputs"]
            ],
            "data": private["payload"],
        }

    def tasks(self, access):
        self._gate(access, "execute", self._op("task_catalogue", {"purpose": "list_tasks"}), [])
        result = self.hub.call("tasks", {})
        closed(result, {"contractVersion", "profile", "tasks"})
        require(type(result["tasks"]) is list and len(result["tasks"]) <= 100)
        self.executor.current(access)
        return {"tasks": result["tasks"]}

    def profile(self, access):
        self._gate(access, "execute", self._op("connection_profile", {"purpose": "profile"}), [])
        return {
            "connectionId": self.executor.config.connection,
            "provider": "openai_chatgpt",
            "status": "connected",
            "nativeScheduleStatus": "not_observed",
            "reportDestination": "owner_inbox",
        }

    def _report_receipt(self, receipt, package):
        closed(
            receipt,
            {
                "contractVersion",
                "profile",
                "resultId",
                "runId",
                "taskId",
                "connectionId",
                "revision",
                "publicationId",
                "fingerprint",
                "manifestFingerprint",
                "receivedAt",
            },
        )
        body, m = package["body"], package["manifest"]
        b = self.executor.config.binding
        expected = {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "resultId": "presult_" + digest([b["ownerSubject"], b["vaultId"], m["runId"]]),
            "runId": m["runId"],
            "taskId": m["taskId"],
            "connectionId": b["connectionId"],
            "revision": 1,
            "publicationId": body["operationId"],
            "fingerprint": signing_input_fingerprint(body["envelope"]["proof"]),
            "manifestFingerprint": persistent_manifest_fingerprint(m),
        }
        require(
            all(receipt[k] == v for k, v in expected.items())
            and type(receipt["receivedAt"]) is int
            and receipt["receivedAt"] >= 0
        )
        return receipt

    def report(self, access, run, report):
        validate_schema("Identifier", run)
        validate_schema("ResultContent", report)
        require(len(canonical_json(report)) <= 65536)
        intent = digest({"kind": "report", "runId": run, "reportDigest": digest(report)})
        state = self.executor.snapshot_state(access)
        prior = [r for r in state["receipts"] if r["operation"]["runId"] == run]
        require(len(prior) <= 1)
        if prior:
            require(prior[0]["operation"]["requestDigest"] == intent)
            self._gate(access, "write_report", prior[0]["operation"], [])
            receipt = self.hub.call("runs/result-receipt", {"runId": run})
            require(digest(receipt) == prior[0]["resultDigest"])
            return {"status": "saved", "receipt": receipt, "original": True}
        pending = self._find(state, run, "report")
        if pending is None:
            begin = self._find(state, run, "begin")
            require(
                begin is not None
                and begin[2]["manifest"] is not None
                and len(state["receipts"]) < 32
            )
            response = self.hub.call("runs/receipt", {"runId": run})
            m = self._manifest(response, run=run)
            require(
                m == begin[2]["manifest"]
                and response["state"] == "ready"
                and m["createdAt"] <= int(self.clock()) < m["expiresAt"]
            )
            operation = {**self._op(run, {}), "requestDigest": intent}
            trust = self._gate(access, "execute", operation, self._resources(m))
            task = self.hub.call(
                "runs/input", {"runId": run, "publicationId": m["taskPublicationId"]}
            )
            trust = self._recheck(access, trust, "execute", operation)
            verified = self._carrier(task, m, m["taskPublicationId"], trust)
            self.executor.current(access)
            task_private = open_persistent_content(
                verified.carrier["jwe"], self.executor._keys["encryption"], context=verified.context
            )["payload"]
            require(
                sorted(s["sectionId"] for s in report["sections"])
                == sorted(s["sectionId"] for s in task_private["outputSpec"]["sections"])
            )
            registry = trust["registry"]
            b = self.executor.config.binding
            recipients, public_keys = [], {}
            for kid in b["recipientKeyIds"]:
                cert = registry.cert(kid, connection_id=None, now=int(self.clock()))
                require(cert["role"] in {"device_enc", "recovery_enc"})
                recipients.append({"keyId": kid, "role": cert["role"]})
                public_keys[kid] = cert["publicJwk"]
            ident = "presult_" + digest([b["ownerSubject"], b["vaultId"], run])
            context = {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                **{k: b[k] for k in BINDING_FIELDS},
                "registrySequence": registry.registry_sequence,
                "checkpointDigest": registry.checkpoint_digest,
                "keyEpoch": registry.key_epoch,
                "stableOperationId": operation["operationId"],
                "issuedAt": int(self.clock()),
                "objectId": ident,
                "revision": 1,
                "expectedRevision": 0,
                "recipients": recipients,
                "objectType": "result_revision",
                "purpose": "save_report",
                **{
                    k: m[k]
                    for k in (
                        "taskId",
                        "taskVersion",
                        "executionEpoch",
                        "authorityId",
                        "authorityVersion",
                        "runId",
                    )
                },
                "manifestFingerprint": persistent_manifest_fingerprint(m),
            }
            envelope = seal_persistent_content(
                {
                    "privateSchemaVersion": 1,
                    "profile": CONTENT_PROFILE,
                    "objectId": ident,
                    "objectType": "result_revision",
                    "revision": 1,
                    "payload": report,
                },
                public_keys,
                context=context,
                signing_private_key=self.executor._keys["signing"],
            )
            task_private = None
            self.executor.current(access)
            package = {
                "kind": "report",
                "body": {
                    "runId": run,
                    "operationId": operation["operationId"],
                    "envelope": envelope,
                },
                "reportDigest": digest(report),
                "manifest": m,
            }
            state = self.executor.snapshot_state(access)
            self._record(state, operation, package)
            self._save(access, state, run, "stage_original_encrypted_report")
            pending = (operation["operationId"], state["outbox"][operation["operationId"]], package)
        key, item, package = pending
        closed(package, {"kind", "body", "reportDigest", "manifest"}, maximum=589824)
        require(
            package["reportDigest"] == digest(report)
            and item["operation"]["requestDigest"] == intent
        )
        m = package["manifest"]
        validate_persistent_manifest(m)
        self._gate(access, "write_report", item["operation"], self._resources(m))
        self.executor.current(access)
        receipt = self._report_receipt(self.hub.call("runs/submit", package["body"]), package)
        self.executor.current(access)
        state = self.executor.snapshot_state(access)
        require(self._find(state, run, "report")[0] == key)
        del state["outbox"][key]
        begin = self._find(state, run, "begin")
        if begin is not None:
            del state["outbox"][begin[0]]
        state["receipts"].append(
            {
                "operation": item["operation"],
                "receiptId": receipt["resultId"],
                "resultDigest": digest(receipt),
            }
        )
        self._save(access, state, run, "record_original_hub_receipt")
        return {"status": "saved", "receipt": receipt, "original": False}

    def execute(self, name, args, access):
        with self.executor._lock:

            def invoke():
                self.hub.deadline = time.monotonic() + 45
                if self.executor.head is None:
                    # Same-key attested recovery, never identity generation or OAuth reconnection.
                    self.executor.restore()
                self.executor.current(access)
                if name == "executor_profile":
                    closed(args, set())
                    result = self.profile(access)
                elif name == "executor_tasks":
                    closed(args, set())
                    result = self.tasks(access)
                elif name == "executor_input":
                    closed(args, {"taskId", "triggerId", "publicationId"})
                    result = self.input(
                        access, args["taskId"], args["triggerId"], args["publicationId"]
                    )
                elif name == "executor_report":
                    closed(args, {"runId", "report"})
                    result = self.report(access, args["runId"], args["report"])
                else:
                    require(False)
                require(
                    time.monotonic() <= self.hub.deadline and len(canonical_json(result)) <= 1048576
                )
                self.executor.current(access)
                return result

            return safe(invoke)
