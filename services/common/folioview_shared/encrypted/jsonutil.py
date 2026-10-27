"""Bounded strict JSON, RFC 8785 JCS, and canonical unpadded base64url."""

import base64
import json
import math
import re
import secrets
from typing import Any

import rfc8785

from .constants import MAX_HTTP_WRITE_BYTES, MAX_JSON_DEPTH, MAX_SAFE_INTEGER
from .errors import ContractError


def _walk(value: Any, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH or (type(value) in (list, dict) and depth >= MAX_JSON_DEPTH):
        raise ContractError("malformed_request")
    if value is None or type(value) is bool:
        return
    if type(value) is int:
        if abs(value) > MAX_SAFE_INTEGER:
            raise ContractError("malformed_request")
    elif type(value) is float:
        if not math.isfinite(value) or (value.is_integer() and abs(value) > MAX_SAFE_INTEGER):
            raise ContractError("malformed_request")
    elif type(value) is str:
        value.encode("utf-8", "strict")
    elif type(value) is list:
        for item in value:
            _walk(item, depth + 1)
    elif type(value) is dict:
        for key, item in value.items():
            if type(key) is not str:
                raise ContractError("malformed_request")
            key.encode("utf-8", "strict")
            _walk(item, depth + 1)
    else:
        raise ContractError("malformed_request")


def canonical_json(value: Any) -> bytes:
    try:
        _walk(value)
        return rfc8785.dumps(value)
    except Exception:
        raise ContractError("malformed_request") from None


def _unique(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ContractError("malformed_request")
        result[key] = value
    return result


def _integer(value: str) -> int:
    if len(value.lstrip("-")) > 16:
        raise ContractError("malformed_request")
    number = int(value)
    if abs(number) > MAX_SAFE_INTEGER:
        raise ContractError("malformed_request")
    return number


def _constant(_value: str) -> None:
    raise ContractError("malformed_request")


def strict_json_loads(raw: bytes | str, *, max_bytes: int = MAX_HTTP_WRITE_BYTES) -> Any:
    """Check byte budget before parsing. Whitespace is allowed at HTTP boundaries."""
    try:
        if isinstance(raw, str):
            raw = raw.encode("utf-8", "strict")
        if not isinstance(raw, bytes):
            raise ContractError("malformed_request")
        if len(raw) > max_bytes:
            raise ContractError("payload_too_large")
        text = raw.decode("utf-8", "strict")
        # Reject excessive nesting before the standard parser allocates the object tree.
        quoted = escaped = False
        depth = 0
        for char in text:
            if quoted:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    quoted = False
            elif char == '"':
                quoted = True
            elif char in "[{":
                depth += 1
                if depth > MAX_JSON_DEPTH:
                    raise ContractError("malformed_request")
            elif char in "]}":
                depth -= 1
        value = json.loads(
            text, object_pairs_hook=_unique, parse_int=_integer, parse_constant=_constant
        )
        _walk(value)
        return value
    except ContractError:
        raise
    except Exception:
        raise ContractError("malformed_request") from None


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def new_operation_id() -> str:
    """A fresh 128-bit CSPRNG operation ID. Retain it with the original ciphertext."""
    return secrets.token_urlsafe(16)


def b64url_decode(
    value: str,
    *,
    exact_bytes: int | None = None,
    max_bytes: int = MAX_HTTP_WRITE_BYTES,
    allow_empty: bool = False,
) -> bytes:
    try:
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]*", value):
            raise ValueError
        if not value and not allow_empty:
            raise ValueError
        if len(value) > (max_bytes * 4 + 2) // 3:
            raise ContractError("payload_too_large")
        raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        if len(raw) > max_bytes or b64url_encode(raw) != value:
            raise ValueError
        if exact_bytes is not None and len(raw) != exact_bytes:
            raise ValueError
        return raw
    except ContractError:
        raise
    except Exception:
        raise ContractError("invalid_envelope") from None
