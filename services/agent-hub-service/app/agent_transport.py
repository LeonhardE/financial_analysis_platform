"""Closed PoP request transport; no bearer or caller-selected Owner authority."""

from folioview_shared.encrypted.errors import ContractError

from .api import transport


def recovery_transport(request):
    transport(request)
    if any(
        request.headers.getlist(key)
        for key in (
            "idempotency-key",
            "x-folioview-author-key",
            "x-folioview-delegation",
            "x-folioview-authority-delegation",
            "authorization",
        )
    ):
        raise ContractError("malformed_request")
