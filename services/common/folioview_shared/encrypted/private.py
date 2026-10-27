"""Client-side plaintext checks, kept separate from backend envelope validation.

This module never decrypts, renders or fetches content. A frontend must still
render Markdown with a safe renderer; schema acceptance is not a rendering API.
"""

import html
import re

from .constants import PRIVATE_BYTE_LIMITS
from .errors import ContractError
from .jsonutil import canonical_json
from .schema import safe_https_url, validate_schema

_RESOURCE_KINDS = {
    "holdings_snapshot": "holdings",
    "watchlist_evidence": "watchlist",
    "channel_follows_evidence": "channel_follows",
}


def _require(value: bool) -> None:
    if not value:
        raise ContractError("private_schema_invalid")


def _unique(values: list) -> None:
    _require(len(values) == len(set(values)))


def _markdown(value: str) -> None:
    # No raw HTML/attachments. Validate inline/reference/autolink destinations;
    # clients must not mistake this conservative input guard for a sanitizer.
    text = html.unescape(value)
    _require(re.search(r"<\s*(?:/?[A-Za-z][A-Za-z0-9-]*(?:\s|/?>)|!|\?)", text) is None)
    _require(re.search(r"!\s*\[", text) is None)
    destinations = re.findall(r"\]\(\s*(<[^>]+>|[^\s)]+)", text)
    destinations += re.findall(r"(?m)^\s*\[[^\]]+\]:\s*(\S+)", text)
    destinations += re.findall(r"<([^<>\s]+:[^<>\s]*)>", text)
    for destination in destinations:
        _require(safe_https_url(destination.strip("<>")))


def _task(payload: dict, context: dict) -> None:
    _unique([section["sectionId"] for section in payload["outputSpec"]["sections"]])
    if payload["template"] == "brief":
        _require(bool(context["resourceBindings"]))


def _result(payload: dict) -> None:
    _unique([section["sectionId"] for section in payload["sections"]])
    _unique([citation["citationId"] for citation in payload["citations"]])
    for section in payload["sections"]:
        _markdown(section["markdown"])
    for citation in payload["citations"]:
        _require(safe_https_url(citation["url"]))


def _resource(payload: dict, context: dict) -> None:
    expected = _RESOURCE_KINDS[context["objectType"]]
    reference = context["binding"]["resourceRef"]
    _require(isinstance(reference, dict) and reference["kind"] == expected)
    data = payload["data"]
    _require(data["kind"] == expected)
    if expected == "holdings":
        _require(data["snapshotId"] == context["objectId"])
        _unique([account["accountId"] for account in data["accounts"]])
        _require(sum(len(account["positions"]) for account in data["accounts"]) <= 1000)
        for account in data["accounts"]:
            _unique([balance["currency"] for balance in account["balances"]])
            _unique([position["assetId"] for position in account["positions"]])
            for position in account["positions"]:
                _require(
                    position["marketValue"] is None
                    or position["marketValue"]["currency"] == position["currency"]
                )
    elif expected == "watchlist":
        _unique([item["symbol"] for item in data["items"]])
    else:
        _unique([item["followId"] for item in data["items"]])
        for item in data["items"]:
            value = item["handleOrUrl"]
            is_handle = (
                value.startswith("@")
                and len(value) > 1
                and not any(char.isspace() or ord(char) < 32 for char in value)
            )
            _require(is_handle or safe_https_url(value))


def validate_private_payload(value: object, *, context: dict) -> dict:
    """Bind decrypted content to its verified public context and validate its type.

    Call only on a trusted decrypting endpoint. Backends cannot run this check
    against ciphertext or treat a storage receipt as proof it succeeded.
    """
    try:
        checked_context = validate_schema("Context", context)
        result = validate_schema("PrivatePayload", value)
        for field in ["objectId", "objectType", "revision", "binding"]:
            _require(canonical_json(result[field]) == canonical_json(checked_context[field]))
        _require(len(canonical_json(result)) <= PRIVATE_BYTE_LIMITS[result["objectType"]])
        payload = result["payload"]
        if result["objectType"] == "task":
            _task(payload, checked_context)
        elif result["objectType"] == "result_revision":
            _result(payload)
        else:
            _resource(payload, checked_context)
        return result
    except (ContractError, KeyError, TypeError, ValueError):
        raise ContractError("private_schema_invalid") from None
