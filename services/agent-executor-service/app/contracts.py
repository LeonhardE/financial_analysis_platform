"""Closed executor inputs and deliberately non-sensitive failure messages."""

import hashlib
import secrets

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads

PROFILE = "folioview.agent-executor.v1"
POLICY = "folioview.agent-policy.v1"
MAX_SNAPSHOT = 2_097_152


class Stopped(RuntimeError):
    def __init__(self):
        super().__init__("Executor unavailable.")


class AccessDenied(Stopped):
    pass


class ScopeDenied(Stopped):
    pass


def require(condition):
    if condition is not True:
        raise Stopped


def closed(value, fields, *, maximum=65536):
    require(type(value) is dict and set(value) == set(fields))
    require(len(canonical_json(value)) <= maximum)
    return value


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def identity_digest(binding):
    # A Root-approved code upgrade must retain the original encrypted keyring.
    return digest({k: v for k, v in binding.items() if k != "workloadDigest"})


def clone(value):
    return strict_json_loads(canonical_json(value), max_bytes=MAX_SNAPSHOT)


def operation_id():
    return secrets.token_urlsafe(24)


def safe(action):
    try:
        return action()
    except Stopped:
        raise
    except ContractError:
        raise Stopped from None
    except Exception:
        raise Stopped from None
