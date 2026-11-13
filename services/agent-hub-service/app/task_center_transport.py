"""Hub-local additive PoP profile; the frozen persistent request schema stays closed."""

from functools import lru_cache

from jsonschema import Draft202012Validator

from folioview_shared.encrypted.crypto import verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json
from folioview_shared.encrypted.persistent_agents import _agent_keys
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    digest,
    load_content_schema,
)
from folioview_shared.encrypted.task_center import TASK_CENTER_PROFILE

REQUEST_PATH = (
    r"^/agent/v3/persistent/owners/[A-Za-z0-9_-]{1,128}"
    r"/vaults/[A-Za-z0-9_-]{1,128}/connections/[A-Za-z0-9_-]{1,128}"
    r"/task-center/(context|prepare|plans/report)$"
)


@lru_cache(maxsize=1)
def request_validator():
    schema = load_content_schema("PersistentAgentRequestPayload")
    payload = schema["$defs"]["PersistentAgentRequestPayload"]
    payload["properties"]["profile"] = {"const": TASK_CENTER_PROFILE}
    payload["properties"]["artifactType"] = {"const": "task_center_agent_request"}
    payload["properties"]["path"] = {"type": "string", "pattern": REQUEST_PATH}
    return Draft202012Validator(schema)


def verify_center_request(
    signed,
    *,
    registry,
    current_identity,
    owner_subject,
    vault_id,
    connection_id,
    client_id,
    audience,
    method,
    path,
    body,
    now,
):
    identity = current_identity
    if len(canonical_json(signed)) > 16384:
        raise ContractError("payload_too_large")
    if any(
        identity[k] != value
        for k, value in {
            "ownerSubject": owner_subject,
            "vaultId": vault_id,
            "connectionId": connection_id,
            "clientId": client_id,
        }.items()
    ):
        raise ContractError("recipient_binding_mismatch")
    cert = _agent_keys(identity, registry, now)
    payload = verify_jws(
        signed, cert["publicJwk"], typ="fv-control+jws", expected_kid=cert["keyId"]
    )
    if not request_validator().is_valid(payload):
        raise ContractError("malformed_request")
    if any(payload[k] != identity[k] for k in BINDING_FIELDS) or (
        payload["audience"],
        payload["method"],
        payload["path"],
        payload["bodyDigest"],
    ) != (audience, method, path, digest(body)):
        raise ContractError("recipient_binding_mismatch")
    if (
        method != "POST"
        or not max(identity["registeredAt"], cert["notBefore"])
        <= payload["issuedAt"]
        <= now
        < payload["expiresAt"]
        <= payload["issuedAt"] + 120
    ):
        raise ContractError("key_authorization_required")
    b64url_decode(payload["nonce"], exact_bytes=32)
    return payload
