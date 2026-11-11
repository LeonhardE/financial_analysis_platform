"""Optional account admission fence; never a replacement for signed resource consent."""

import os
import re

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.identity import owner_key

ENVIRONMENT = "HUB_AGENT_OWNED_ALLOWED_OWNER_SUBJECTS_JSON"


def owner_allowed(subject):
    # Preserve compatibility for installations without an admission restriction.
    # The managed production target always supplies an explicit list (default []).
    raw = os.getenv(ENVIRONMENT)
    if raw is None:
        return True
    try:
        owners = strict_json_loads(raw, max_bytes=4096)
        if (
            type(owners) is not list
            or len(owners) > 32
            or any(type(o) is not str or re.fullmatch(r"[a-f0-9]{64}", o) is None for o in owners)
            or len(set(owners)) != len(owners)
        ):
            return False
        return subject in owners
    except ContractError:
        return False


def require_owner_allowed(subject):
    if not owner_allowed(subject):
        raise ContractError("authorization_unavailable")


def uid_allowed(uid):
    return owner_allowed(owner_key(uid))
