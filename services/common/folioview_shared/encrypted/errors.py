"""Fixed diagnostics. Never attach input, keys, ciphertext, or raw crypto errors."""

import re

from .constants import CONTRACT_VERSION

ERROR_STATUS = {
    "malformed_request": 400,
    "unsupported_contract": 400,
    "unsupported_query": 400,
    "invalid_token": 401,
    "insufficient_scope": 403,
    "key_authorization_required": 403,
    "not_found": 404,
    "version_conflict": 409,
    "idempotency_conflict": 409,
    "initial_result_exists": 409,
    "registry_conflict": 409,
    "stale_key_epoch": 409,
    "payload_too_large": 413,
    "unsupported_media_type": 415,
    "invalid_envelope": 422,
    "invalid_signature": 422,
    "recipient_binding_mismatch": 422,
    "unsupported_profile": 422,
    "authorization_unavailable": 503,
    "source_unavailable": 503,
}
CLIENT_ERRORS = frozenset(
    {
        "untrusted_key",
        "rollback_detected",
        "decryption_failed",
        "private_schema_invalid",
        "render_rejected",
    }
)


class ContractError(ValueError):
    """Public, parameter-free contract failure; consumers choose their transport framing."""

    def __init__(self, code: str):
        if code not in ERROR_STATUS and code not in CLIENT_ERRORS:
            code = "malformed_request"
        self.code = code
        self.status = ERROR_STATUS.get(code, 422)
        self.retryable = self.status == 503
        super().__init__(code)

    def response(self, request_id: str) -> dict:
        """Server framing does not misrepresent client-only decryption findings."""
        if self.code not in ERROR_STATUS:
            raise ContractError("malformed_request")
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
            raise ContractError("malformed_request")
        return {
            "contractVersion": CONTRACT_VERSION,
            "error": {"code": self.code, "retryable": self.retryable, "requestId": request_id},
        }
