"""Packaged, closed v2 schemas usable without a service or a key store.

Schema references are local package resources only. Cryptographic authenticity,
current authorization and cross-object relationships are checked by the envelope
and authority APIs, rather than inferred from a schema pass.
"""

import copy
import json
import re
from datetime import datetime
from functools import lru_cache
from importlib.resources import files
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from jsonschema import Draft202012Validator, FormatChecker

from .constants import MAX_READ_BYTES
from .errors import ContractError
from .jsonutil import canonical_json

_FORMATS = FormatChecker()


@_FORMATS.checks("date-time")
def _utc_timestamp(value: object) -> bool:
    if not isinstance(value, str):
        return True
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value):
        return False
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


@_FORMATS.checks("iana-timezone")
def _timezone(value: object) -> bool:
    if not isinstance(value, str):
        return True
    try:
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        return False
    return True


def safe_https_url(value: str) -> bool:
    """Require a navigation URL, never a credential, script or local key URL."""
    if not isinstance(value, str) or any(char.isspace() or ord(char) < 32 for char in value):
        return False
    if "\\" in value:
        return False
    try:
        parsed = urlsplit(value)
        return (
            parsed.scheme == "https"
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
        )
    except ValueError:
        return False


@_FORMATS.checks("uri")
def _https_uri(value: object) -> bool:
    return not isinstance(value, str) or safe_https_url(value)


@lru_cache(maxsize=1)
def _document() -> dict:
    document = json.loads(files(__package__).joinpath("schemas.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(document)
    return document


def load_schema(name: str) -> dict:
    """Return an independent schema copy; callers cannot mutate cached validation."""
    if not isinstance(name, str) or name not in _document()["$defs"]:
        raise ContractError("malformed_request")
    document = copy.deepcopy(_document())
    document["$ref"] = "#/$defs/" + name
    return document


@lru_cache(maxsize=128)
def _validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(load_schema(name), format_checker=_FORMATS)


def validate_schema(name: str, value: object) -> dict:
    """Validate bounded JSON shape and return a detached copy, without raw errors.

    Specific carrier/control/plaintext budgets are also enforced by their
    corresponding APIs. This ceiling bounds general response DTO validation.
    """
    try:
        if len(canonical_json(value)) > MAX_READ_BYTES:
            raise ContractError("payload_too_large")
        if next(_validator(name).iter_errors(value), None) is not None:
            raise ContractError("malformed_request")
        return copy.deepcopy(value)
    except ContractError:
        raise
    except (TypeError, ValueError, RecursionError):
        raise ContractError("malformed_request") from None
