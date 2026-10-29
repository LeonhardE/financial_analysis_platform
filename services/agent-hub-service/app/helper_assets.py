"""A fixed public distribution allowlist, never a helper execution or decrypt API."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response

from .preparations import require_adapter

ROOT = Path(__file__).resolve().parents[1] / "helper"
FILES = {
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
            "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'none'",
        },
    )
