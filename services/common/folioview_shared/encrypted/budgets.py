"""Whole-message byte budgets, including JOSE/base64/JSON and storage overhead."""

from collections.abc import Iterable

from .constants import (
    CONTRACT_VERSION,
    MAX_CARRIER_BYTES,
    MAX_HTTP_WRITE_BYTES,
    MAX_MANIFEST_BYTES,
    MAX_READ_BYTES,
    MAX_STORED_DOCUMENT_BYTES,
)
from .errors import ContractError
from .jsonutil import canonical_json


def check_size(value: object, maximum: int) -> int:
    size = len(canonical_json(value))
    if size > maximum:
        raise ContractError("payload_too_large")
    return size


def read_bounded(chunks: Iterable[bytes], *, maximum: int = MAX_HTTP_WRITE_BYTES) -> bytes:
    """Stop consuming a streaming body as soon as its byte ceiling is exceeded."""
    result = bytearray()
    for chunk in chunks:
        if not isinstance(chunk, bytes):
            raise ContractError("malformed_request")
        if len(chunk) > maximum - len(result):
            raise ContractError("payload_too_large")
        result.extend(chunk)
    return bytes(result)


def check_write_body(body: dict) -> int:
    """Call before decoding nested JWS/JWE fields; no plaintext fallback."""
    return check_size(body, MAX_HTTP_WRITE_BYTES)


def check_carrier_budget(carrier: dict) -> int:
    return check_size(carrier, MAX_CARRIER_BYTES)


def check_read_response(response: dict) -> int:
    return check_size(response, MAX_READ_BYTES)


def check_manifest_budget(manifest: dict) -> int:
    return check_size(manifest, MAX_MANIFEST_BYTES)


def check_document_budget(
    application_document: dict, *, encoded_document: bytes
) -> tuple[int, int]:
    """Require both JSON application size and the caller's actual SDK wire encoding.

    The caller supplies the complete Firestore Document protobuf bytes, including
    document name/field encoding, not a JSON size estimate. Consumers must encode
    the exact document they write. No cloud API or SDK is imported by this helper.
    The 768 KiB ceiling leaves at least 256 KiB below Firestore's 1 MiB total.
    """
    size = check_size(application_document, MAX_STORED_DOCUMENT_BYTES)
    if not isinstance(encoded_document, bytes):
        raise ContractError("malformed_request")
    if not encoded_document or len(encoded_document) > MAX_STORED_DOCUMENT_BYTES:
        raise ContractError("payload_too_large")
    return size, len(encoded_document)


def require_contract(contract_header: str | None, body: dict) -> None:
    if (
        contract_header != CONTRACT_VERSION
        or type(body) is not dict
        or body.get("contractVersion") != CONTRACT_VERSION
    ):
        raise ContractError("unsupported_contract")


def require_metadata_query(query: dict, *, allowed: frozenset[str]) -> None:
    """Unknown/private-search queries are rejected, not silently ignored or logged."""
    if type(query) is not dict:
        raise ContractError("malformed_request")
    if not set(query) <= allowed:
        raise ContractError("unsupported_query")
