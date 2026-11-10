"""Small, closed public policy controls; executor trust wire types stay shared."""

import hashlib
import re
import secrets

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema

PROFILE = "folioview.agent-policy.v1"
CONTROL = "folioview.agent-policy-control.v1"
SCOPES = frozenset({"executor:execute", "executor:write_report", "executor:recover"})


class Unavailable(RuntimeError):
    def __init__(self):
        super().__init__("Policy authority is unavailable.")


class Conflict(RuntimeError):
    pass


def deny(code="key_authorization_required"):
    raise ContractError(code)


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def recovery_aad(binding):
    return digest({k: v for k, v in binding.items() if k != "workloadDigest"})


def token_hash(value):
    if type(value) is not str or not 1 <= len(value) <= 16384:
        deny("malformed_request")
    return hashlib.sha256(value.encode()).hexdigest()


def copy(value):
    return strict_json_loads(canonical_json(value))


def random(prefix=""):
    return prefix + secrets.token_urlsafe(32)


def closed(value, fields, *, maximum=65536):
    if len(canonical_json(value)) > maximum:
        deny("payload_too_large")
    if type(value) is not dict or set(value) != set(fields):
        deny("malformed_request")
    return value


def identifier(value):
    validate_schema("Identifier", value)
    return value


def number(value, minimum=1):
    if type(value) is not int or not minimum <= value <= 9007199254740991:
        deny("malformed_request")
    return value


def https(value, *, origin=False):
    if type(value) is not str or not 9 <= len(value) <= 2048:
        deny("malformed_request")
    pattern = r"https://[a-z0-9]+(?:[.-][a-z0-9]+)*"
    if not origin:
        pattern += r"(?:/[A-Za-z0-9_-]+)*/?"
    if not re.fullmatch(pattern, value):
        deny("malformed_request")
    return value


def scope(value):
    closed(value, {"profile", "purpose", "resultPolicy", "resourceBindings"}, maximum=16384)
    if (
        value["profile"] != "folioview.hub-executor-ciphertext-scope.v1"
        or value["purpose"] != "analysis"
        or value["resultPolicy"] != "owner_inbox"
        or type(value["resourceBindings"]) is not list
        or not 1 <= len(value["resourceBindings"]) <= 10
    ):
        deny("malformed_request")
    for binding in value["resourceBindings"]:
        validate_schema("ResourceBindingMetadata", binding)
    refs = [canonical_json(b["ref"]) for b in value["resourceBindings"]]
    if refs != sorted(set(refs)):
        deny("malformed_request")
    return copy(value)


def root_control(signed, config, *, action, connection, version, head, parameters, now):
    p = verify_jws(signed, config.root_jwk, typ="fv-control+jws")
    closed(
        p,
        {
            "contractVersion",
            "profile",
            "action",
            "ownerSubject",
            "connectionId",
            "operationId",
            "expectedVersion",
            "expectedHead",
            "parametersDigest",
            "issuedAt",
            "expiresAt",
        },
        maximum=32768,
    )
    validate_schema("OperationIdentifier", p["operationId"])
    number(p["expectedVersion"], minimum=0)
    if (
        p["contractVersion"] != CONTRACT_VERSION
        or p["profile"] != CONTROL
        or p["action"] != action
        or p["ownerSubject"] != config.owner
        or p["connectionId"] != connection
        or p["expectedVersion"] != version
        or p["expectedHead"] != head
        or p["parametersDigest"] != digest(parameters)
        or type(p["issuedAt"]) is not int
        or type(p["expiresAt"]) is not int
        or not p["issuedAt"] <= now < p["expiresAt"] <= p["issuedAt"] + 300
    ):
        deny()
    return p
