"""Fixed native account-link window; no browser Agent runtime or credential storage."""

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError

from .helper_assets import _asset_response, _owner_origins
from .native_transport_routes import get_native_transport

ROOT = Path(__file__).resolve().parents[1] / "account-link"
FILES = {
    "consent.html": ("static/consent.html", "text/html; charset=utf-8", 65536),
    "account.css": ("static/account.css", "text/css; charset=utf-8", 65536),
    "account-consent-page.mjs": (
        "dist/account-consent-page.mjs",
        "text/javascript; charset=utf-8",
        65536,
    ),
    "account-bridge.mjs": ("dist/account-bridge.mjs", "text/javascript; charset=utf-8", 65536),
    "integrity.json": ("integrity.json", "application/json", 65536),
}


def require_account_link():
    if not all(
        os.getenv(flag) == "1"
        for flag in (
            "HUB_AGENT_OWNED_CREDENTIALS_ENABLED",
            "HUB_PERSISTENT_TRANSPORT_ENABLED",
            "HUB_PERSISTENT_MCP_ENABLED",
        )
    ):
        raise HTTPException(503, "Account connection unavailable")
    return get_native_transport()


router = APIRouter(dependencies=[Depends(require_account_link)])


@router.get("/agent/v3/account/1.0.0/{asset}", include_in_schema=False)
def account_asset(asset: str):
    response = _asset_response(asset, ROOT, FILES)
    response.headers["Content-Security-Policy"] = response.headers[
        "Content-Security-Policy"
    ].replace("worker-src blob:", "worker-src 'none'")
    return response


@router.get("/agent/v3/account/consent.html", include_in_schema=False)
@router.get("/agent/v3/runtime/account-consent.html", include_in_schema=False)
def account_page():
    # A previously issued OAuth window may finish account linking after rollout.
    return account_asset("consent.html")


@router.get("/agent/v3/account/config", include_in_schema=False)
def account_configuration(request: Request):
    try:
        if request.query_params:
            raise ValueError
        native = get_native_transport()
        origins = _owner_origins()
    except (ValueError, ContractError):
        raise HTTPException(503, "Account connection unavailable") from None
    return JSONResponse(
        {
            "contractVersion": CONTRACT_VERSION,
            "accountLinkVersion": "1.0.0",
            "issuer": native.config.base.issuer,
            "ownerOrigins": origins,
            "clients": [
                {"clientId": c.client_id, "redirectUris": list(c.redirects)}
                for c in native.config.base.clients
            ],
        },
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )
