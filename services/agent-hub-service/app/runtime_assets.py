"""Fixed opt-in persistent runtime distribution; no caller-selected file or URL."""

import os
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads

from .helper_assets import _asset_response, _owner_origins
from .native_transport_routes import get_native_transport

ROOT = Path(__file__).resolve().parents[1] / "runtime"
FILES = {
    "controller.html": ("static/controller.html", "text/html; charset=utf-8", 65536),
    "account-consent.html": ("static/account-consent.html", "text/html; charset=utf-8", 65536),
    "runtime.css": ("static/runtime.css", "text/css; charset=utf-8", 65536),
    "controller.mjs": ("dist/controller.mjs", "text/javascript; charset=utf-8", 131072),
    "controller-page.mjs": ("dist/controller-page.mjs", "text/javascript; charset=utf-8", 131072),
    "account-consent-page.mjs": (
        "dist/account-consent-page.mjs",
        "text/javascript; charset=utf-8",
        131072,
    ),
    "worker.mjs": ("dist/worker.mjs", "text/javascript; charset=utf-8", 2097152),
    "integrity.json": ("integrity.json", "application/json", 131072),
    "THIRD_PARTY_NOTICES.md": ("THIRD_PARTY_NOTICES.md", "text/plain; charset=utf-8", 131072),
}


def require_runtime():
    if (
        os.getenv("HUB_PERSISTENT_RUNTIME_ENABLED") != "1"
        or os.getenv("HUB_PERSISTENT_MCP_ENABLED") != "1"
    ):
        raise HTTPException(503, "Persistent runtime unavailable")
    return get_native_transport()


router = APIRouter(dependencies=[Depends(require_runtime)])


@router.get("/agent/v3/runtime/1.0.0/{asset}", include_in_schema=False)
def runtime_asset(asset: str):
    return _asset_response(asset, ROOT, FILES)


@router.get("/agent/v3/runtime/controller.html", include_in_schema=False)
def controller_page():
    return _asset_response("controller.html", ROOT, FILES)


@router.get("/agent/v3/runtime/account-consent.html", include_in_schema=False)
def account_page():
    return _asset_response("account-consent.html", ROOT, FILES)


@router.get("/agent/v3/runtime/config", include_in_schema=False)
def runtime_configuration(request: Request):
    try:
        if request.query_params:
            raise ValueError
        native = get_native_transport()
        origins = _owner_origins()
        manifest = strict_json_loads((ROOT / "integrity.json").read_bytes(), max_bytes=131072)
        worker_hash = manifest["files"]["dist/worker.mjs"]
        if len(worker_hash) != 64 or any(c not in "0123456789abcdef" for c in worker_hash):
            raise ValueError
    except (OSError, ValueError, KeyError, TypeError, ContractError):
        raise HTTPException(503, "Persistent runtime unavailable") from None
    return JSONResponse(
        {
            "contractVersion": CONTRACT_VERSION,
            "runtimeVersion": "1.0.0",
            "issuer": native.config.base.issuer,
            "ownerOrigins": origins,
            "workerPath": "/agent/v3/runtime/1.0.0/worker.mjs",
            "workerSha256": worker_hash,
            "serverNow": int(time.time()),
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
