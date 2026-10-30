"""Closed MCP v2 projections over the existing encrypted agent domain services.

No tool decrypts, resolves arbitrary URLs, accepts keys, or invents agent authority.
The same transactional domain methods used by REST remain the authorization boundary.
"""

import hashlib
import re

from jsonschema import Draft202012Validator

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_CONTROL_BYTES
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)
from folioview_shared.encrypted.schema import load_schema, validate_schema

from .oauth import OAuthFailure
from .preparations import PreparationService, copy
from .results import ResultService
from .runs import RunService
from .tasks import _proofs

ID = {"type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "maxLength": 128}
CURSOR = {"type": "string", "minLength": 1, "maxLength": 2048}
SIGNED = {"$ref": "#/$defs/SignedObject"}
INPUTS = {
    "list_tasks_v2": (
        {"cursor": CURSOR, "limit": {"type": "integer", "minimum": 1, "maximum": 50}},
        (),
    ),
    "get_task_v2": ({"taskId": ID}, ("taskId",)),
    "begin_run_v2": ({"signedIntent": SIGNED}, ("signedIntent",)),
    "get_run_inputs_v2": ({"runId": ID, "cursor": CURSOR}, ("runId",)),
    "submit_task_result_v2": ({"runId": ID, "signedObject": SIGNED}, ("runId", "signedObject")),
    "get_receipt_v2": (
        {"runId": ID, "stableOperationId": {"$ref": "#/$defs/OperationIdentifier"}},
        ("runId", "stableOperationId"),
    ),
    "revise_task_result_v2": (
        {
            "resultId": ID,
            "expectedRevision": {"type": "integer", "minimum": 1},
            "signedObject": SIGNED,
        },
        ("resultId", "expectedRevision", "signedObject"),
    ),
}
OUTPUTS = {
    "list_tasks_v2": "TaskMetadataPage",
    "get_task_v2": "EncryptedTaskWithKeyProofs",
    "get_run_inputs_v2": "ManifestComponentPage",
    "submit_task_result_v2": "ResultReceipt",
    "revise_task_result_v2": "ResultReceipt",
}
SCOPES = {
    "list_tasks_v2": "tasks:read",
    "get_task_v2": "tasks:read",
    "begin_run_v2": "runs:create",
    "get_run_inputs_v2": "runs:read",
    "submit_task_result_v2": "results:create",
    "get_receipt_v2": "receipts:read",
    "revise_task_result_v2": "results:revise",
}
_URI = re.compile(
    r"folioview://(?:tasks/(?P<task>[A-Za-z0-9][A-Za-z0-9_-]{0,127})/preparation"
    r"|preparations/(?P<prep>[A-Za-z0-9][A-Za-z0-9_-]{0,127})/"
    r"(?:(?:objects/(?P<object>[A-Za-z0-9][A-Za-z0-9_-]{0,127}))"
    r"|(?:registries/(?P<sequence>[1-9][0-9]{0,3}))))"
    r"|folioview://runs/(?P<run>[A-Za-z0-9][A-Za-z0-9_-]{0,127})/registries/"
    r"(?P<run_sequence>[1-9][0-9]{0,3})"
)


def compact_schema(schema):
    """Ship only transitive shared definitions, not the entire foundation per tool."""
    definitions = load_schema("SignedObject")["$defs"]
    used = {}

    def visit(value):
        if type(value) is dict:
            ref = value.get("$ref", "")
            if ref.startswith("#/$defs/"):
                name = ref.removeprefix("#/$defs/")
                if name not in used:
                    used[name] = definitions[name]
                    visit(used[name])
            for item in value.values():
                visit(item)
        elif type(value) is list:
            for item in value:
                visit(item)

    result = copy(schema)
    visit(result)
    if used:
        result["$defs"] = copy(used)
    return result


def input_schema(name):
    properties, required = INPUTS[name]
    return compact_schema(
        {
            "type": "object",
            "properties": {"contractVersion": {"const": CONTRACT_VERSION}, **properties},
            "required": ["contractVersion", *required],
            "additionalProperties": False,
        }
    )


def output_schema(name):
    if name not in OUTPUTS:
        return None
    # Handshake-era MCP requires an explicitly object-shaped schema root.
    return compact_schema(load_schema(OUTPUTS[name])["$defs"][OUTPUTS[name]])


def _task_metadata(meta):
    tasks = [item for item in meta["objects"] if item["objectType"] == "task"]
    if len(tasks) != 1:
        raise ContractError("recipient_binding_mismatch")
    descriptor = tasks[0]
    metadata = copy(meta["taskMetadata"])
    metadata.update(
        deliveryRevision=descriptor["deliveryRevision"],
        envelopeFingerprint=descriptor["envelopeFingerprint"],
        keyEpoch=meta["keyEpoch"],
    )
    validate_schema("TaskMetadata", metadata)
    return metadata, descriptor


class AgentTools:
    def __init__(self, oauth):
        self.oauth, self.store = oauth, oauth.store
        self.preparations = PreparationService(oauth)
        self.runs, self.results = RunService(oauth), ResultService(oauth)
        self.validators = {name: Draft202012Validator(input_schema(name)) for name in INPUTS}

    def list_tasks(self, token, *, limit=20, cursor=None):
        # Metadata enumeration does not call source services or fetch ciphertext.
        # Only active, approved AND committed task deliveries are executable here.
        def read(unit):
            principal = self.oauth.authorize_in_transaction(unit, token, scope="tasks:read")
            items = []
            for task in principal.task_ids:
                try:
                    p, row = self.preparations._agent(unit, token, task_id=task)
                    state = self.preparations._authority(
                        unit, p.owner_uid, p.connection_id, task, verify_original=False
                    )
                    self.preparations._stored(row, p.owner_subject, row["preparationId"], state)
                except OAuthFailure as error:
                    if error.code == "insufficient_scope":
                        continue
                    raise
                except ContractError as error:
                    if error.code == "not_found":
                        continue
                    raise
                meta = copy(state[-1])
                task_objects = [i for i in row["receipt"]["objects"] if i["objectType"] == "task"]
                if len(task_objects) != 1:
                    raise ContractError("recipient_binding_mismatch")
                meta.update(
                    deliveryRevision=task_objects[0]["deliveryRevision"],
                    envelopeFingerprint=task_objects[0]["envelopeFingerprint"],
                    keyEpoch=state[3].key_epoch,
                )
                validate_schema("TaskMetadata", meta)
                items.append(meta)
            snapshot = hashlib.sha256(canonical_json([token, limit, items])).hexdigest()
            start = 0
            if cursor is not None:
                try:
                    value = strict_json_loads(b64url_decode(cursor, max_bytes=512), max_bytes=512)
                    if set(value) != {"snapshot", "after"} or value["snapshot"] != snapshot:
                        raise ValueError
                    start = (
                        next(n for n, item in enumerate(items) if item["taskId"] == value["after"])
                        + 1
                    )
                except (ContractError, ValueError, StopIteration, TypeError):
                    raise ContractError("version_conflict") from None
            page = items[start : start + limit]
            next_cursor = (
                b64url_encode(canonical_json({"snapshot": snapshot, "after": page[-1]["taskId"]}))
                if start + limit < len(items)
                else None
            )
            return {"contractVersion": CONTRACT_VERSION, "items": page, "nextCursor": next_cursor}

        return self.store.transact(read)

    def get_task(self, token, task):
        before = self.preparations.metadata(token, task)
        metadata, descriptor = _task_metadata(before)
        packet = self.preparations.object(token, before["preparationId"], descriptor["objectId"])
        registry = self.preparations.registry(
            token, before["preparationId"], before["registryProofs"][-1]["registrySequence"]
        )
        if (
            self.preparations.metadata(token, task) != before
            or signing_input_fingerprint(packet["envelope"]["signedObject"])
            != descriptor["envelopeFingerprint"]
        ):
            raise ContractError("version_conflict")
        result = {
            "contractVersion": CONTRACT_VERSION,
            "metadata": metadata,
            "signedObject": packet["envelope"]["signedObject"],
            "keyProofs": _proofs(registry["registryBundle"]),
            "sourceVersionCandidates": [
                {
                    "ref": i["resourceRef"],
                    "revision": i["revision"],
                    "sourceEpoch": i["sourceEpoch"],
                    "objectId": i["objectId"],
                    "deliveryRevision": i["deliveryRevision"],
                    "envelopeFingerprint": i["envelopeFingerprint"],
                    "keyEpoch": before["keyEpoch"],
                }
                for i in before["objects"]
                if i["resourceRef"] is not None
            ],
            "agentKeyGrant": before["agentKeyGrant"],
        }
        return validate_schema("EncryptedTaskWithKeyProofs", result)

    def call(self, token, name, arguments):
        if name not in self.validators or next(self.validators[name].iter_errors(arguments), None):
            raise ContractError("malformed_request")
        # This is a scope/token guard only: full new-execution checks here would
        # incorrectly block original saved receipts after a pause or source outage.
        self.oauth.authenticate(token, scope=SCOPES[name])
        a = arguments
        if name == "list_tasks_v2":
            value = self.list_tasks(token, limit=a.get("limit", 20), cursor=a.get("cursor"))
        elif name == "get_task_v2":
            value = self.get_task(token, a["taskId"])
        elif name == "begin_run_v2":
            _, intent = _signed_parts(a["signedIntent"], max_bytes=MAX_CONTROL_BYTES)
            validate_schema("BeginRunIntent", intent)
            value, _ = self.runs.begin(
                token, intent["taskId"], a["signedIntent"], intent["stableOperationId"]
            )
        elif name == "get_run_inputs_v2":
            value = self.runs.inputs(token, a["runId"], a.get("cursor"))
        elif name == "get_receipt_v2":
            value = self.results.receipt(token, a["runId"], a["stableOperationId"])
        else:
            _, message = _signed_parts(a["signedObject"])
            context = message.get("context", {})
            operation = context.get("stableOperationId")
            validate_schema("OperationIdentifier", operation)
            carrier = {"contractVersion": CONTRACT_VERSION, "signedObject": a["signedObject"]}
            if name == "submit_task_result_v2":
                value, _ = self.results.submit(token, a["runId"], carrier, operation)
            else:
                value, _ = self.results.revise(
                    token, a["resultId"], a["expectedRevision"], carrier, operation
                )
        if name in OUTPUTS:
            validate_schema(OUTPUTS[name], value)
        check_read_response(value)
        return value

    def resource(self, token, uri):
        # URI is an authenticated selector for fixed domain methods, never a URL fetch.
        if type(uri) is not str or len(uri) > 512 or (match := _URI.fullmatch(uri)) is None:
            raise ContractError("not_found")
        args = match.groupdict()
        if args["task"]:
            value = self.preparations.metadata(token, args["task"])
        elif args["object"]:
            value = self.preparations.object(token, args["prep"], args["object"])
        elif args["prep"]:
            value = self.preparations.registry(token, args["prep"], int(args["sequence"]))
        else:
            value = self.runs.registry(token, args["run"], int(args["run_sequence"]))
        check_read_response(value)
        return value
