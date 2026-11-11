"""Fixed default-off host client distribution; no caller-selected code or origin."""

import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request

from folioview_shared.encrypted.jsonutil import strict_json_loads

from .agent_credential_routes import agent_owned_enabled
from .helper_assets import _asset_response

ROOT = Path(__file__).resolve().parents[1] / "agent-client"
FILES = {
    "client.mjs": ("dist/cli.mjs", "text/javascript; charset=utf-8", 2097152),
    "integrity.json": ("integrity.json", "application/json", 131072),
    "THIRD_PARTY_NOTICES.md": ("THIRD_PARTY_NOTICES.md", "text/plain; charset=utf-8", 131072),
}


def require_client():
    if not agent_owned_enabled():
        raise HTTPException(503, "Agent client unavailable")


def client_metadata():
    try:
        manifest = strict_json_loads((ROOT / "integrity.json").read_bytes(), max_bytes=131072)
        digest = manifest["files"]["dist/cli.mjs"]
        if (
            manifest["clientVersion"] != "1.0.0"
            or manifest["nodeMinimum"] != "24.12.0"
            or hashlib.sha256((ROOT / "dist/cli.mjs").read_bytes()).hexdigest() != digest
        ):
            raise ValueError
        return {
            "version": "1.0.0",
            "nodeMinimum": "24.12.0",
            "path": "/agent/v3/client/1.0.0/client.mjs",
            "sha256": digest,
            "integrityPath": "/agent/v3/client/1.0.0/integrity.json",
            "retention": "personal_host_files_not_guaranteed",
        }
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(503, "Agent client unavailable") from None


router = APIRouter(dependencies=[Depends(require_client)])


@router.get("/agent/v3/client/1.0.0/{asset}", include_in_schema=False)
def client_asset(asset: str, request: Request):
    if request.query_params:
        raise HTTPException(400, "Invalid request")
    metadata = client_metadata()
    response = _asset_response(asset, ROOT, FILES)
    if asset == "client.mjs":
        response.headers["ETag"] = '"sha256-' + metadata["sha256"] + '"'
    return response
