"""A fixed public distribution allowlist, never a helper execution or decrypt API."""

import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads

from .oauth_config import OAuthConfig
from .preparations import require_adapter

ROOT = Path(__file__).resolve().parents[1] / "helper"
FILES = {
    "consent.html": ("static/consent.html", "text/html; charset=utf-8", 65_536),
    "controller.html": ("static/controller.html", "text/html; charset=utf-8", 65_536),
    "controller.css": ("static/controller.css", "text/css; charset=utf-8", 65_536),
    "consent.mjs": ("dist/consent.mjs", "text/javascript; charset=utf-8", 262_144),
    "owner-helper.mjs": ("dist/owner-helper.mjs", "text/javascript; charset=utf-8", 262_144),
    "controller.mjs": ("dist/controller.mjs", "text/javascript; charset=utf-8", 1_048_576),
    "controller-page.mjs": (
        "dist/controller-page.mjs",
        "text/javascript; charset=utf-8",
        1_048_576,
    ),
    "worker.mjs": ("dist/worker.mjs", "text/javascript; charset=utf-8", 2_097_152),
    "integrity.json": ("integrity.json", "application/json", 131_072),
    "protocol.json": ("protocol.json", "application/json", 131_072),
    "THIRD_PARTY_NOTICES.md": ("THIRD_PARTY_NOTICES.md", "text/plain; charset=utf-8", 131_072),
}
router = APIRouter(dependencies=[Depends(require_adapter)])


@router.get("/agent/v2/helper/{asset}", include_in_schema=False)
def helper_asset(asset: str):
    configured = FILES.get(asset)
    if configured is None:
        raise HTTPException(404, "Not found")
    relative, content_type, maximum = configured
    try:
        with (ROOT / relative).open("rb") as stream:
            data = stream.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError
    except (OSError, ValueError):
        raise HTTPException(503, "Helper package unavailable") from None
    return Response(
        data,
        headers={
            "Content-Type": content_type,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": (
                "default-src 'none'; script-src 'self'; connect-src 'self'; "
                "style-src 'self'; worker-src blob:; frame-ancestors 'none'; "
                "base-uri 'none'; form-action 'none'; object-src 'none'"
                if asset.endswith(".html")
                else "default-src 'none'; script-src 'self'; connect-src 'none'"
            ),
        },
    )


def _owner_origins():
    # Unlike general CORS's development defaults, cross-window trust must be
    # explicitly configured. Never trust a URL parameter or wildcard as an owner.
    value = os.getenv("CORS_ORIGINS", "")
    if len(value) > 8192:
        raise ValueError
    origins = [entry.strip() for entry in value.split(",") if entry.strip()]
    if not 1 <= len(origins) <= 8 or len(set(origins)) != len(origins):
        raise ValueError
    for origin in origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"https", "http"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
            or "\\" in origin
            or "*" in origin
            or any(ord(c) <= 32 for c in origin)
            or (
                parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            )
        ):
            raise ValueError
        port = parsed.port
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        suffix = f":{port}" if port and port != (443 if parsed.scheme == "https" else 80) else ""
        if origin != f"{parsed.scheme}://{host}{suffix}" or port == 0:
            raise ValueError
    return origins


@router.get("/agent/v2/controller/config", include_in_schema=False)
def controller_configuration(request: Request):
    try:
        if request.query_params:
            raise ValueError
        config = OAuthConfig.environment()
        origins = _owner_origins()
        integrity = strict_json_loads((ROOT / "integrity.json").read_bytes(), max_bytes=131_072)
        worker_hash = integrity["files"]["dist/worker.mjs"]
        if len(worker_hash) != 64 or any(c not in "0123456789abcdef" for c in worker_hash):
            raise ValueError
    except (ValueError, KeyError, TypeError, OSError, ContractError):
        raise HTTPException(503, "Owner controller unavailable") from None
    return JSONResponse(
        {
            "contractVersion": CONTRACT_VERSION,
            "profile": "folioview.owner-consent-bridge.v1",
            "helperVersion": "1.2.0",
            "issuer": config.issuer,
            "ownerOrigins": origins,
            "consentPath": "/agent/v2/helper/consent.html",
            "controllerPath": "/agent/v2/helper/controller.html",
            "workerPath": "/agent/v2/helper/worker.mjs",
            # Distribution metadata, not an independent root or release pin.
            "workerSha256": worker_hash,
            "clients": [
                {"clientId": client.client_id, "redirectUris": list(client.redirects)}
                for client in config.clients
            ],
        },
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )
