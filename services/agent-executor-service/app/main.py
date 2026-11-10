"""Restore-only measured runtime with separately gated provider-authenticated MCP."""

import os
import ssl
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from folioview_shared.encrypted.jsonutil import strict_json_loads

from .attestation import Attestation
from .config import Config
from .contracts import PROFILE, digest, require
from .hub import HubClient
from .mcp import handle as handle_mcp
from .mcp import metadata, provider
from .native import NativeEngine
from .native_config import NativeConfig
from .policy import PolicyClient
from .provider_tls import ProviderProtocol, configure_client_trust
from .runtime import Executor
from .state import GCSSnapshots
from .tls import materialize

app = FastAPI(
    title="Agent executor", docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False
)
executor = None
native_engine = None


@app.middleware("http")
async def closed_surface(request: Request, call_next):
    if request.query_params or (
        not (native_engine is not None and request.url.path == "/mcp")
        and (
            request.headers.get("content-length", "0") != "0"
            or request.headers.get("transfer-encoding")
        )
    ):
        return JSONResponse(
            {"error": "unsupported_request"}, status_code=400, headers={"Cache-Control": "no-store"}
        )
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/health")
def health():
    return JSONResponse(
        {
            "profile": PROFILE,
            "status": "locked" if executor is None or executor.head is None else "keyring_restored",
            "contentServiceEnabled": native_engine is not None,
        },
        status_code=503 if executor is None or executor.head is None else 200,
    )


@app.get("/api/v1/executor/identity")
def identity():
    if executor is None or executor.head is None:
        return JSONResponse({"error": "executor_unavailable"}, status_code=503)
    return executor.identity()


@app.api_route("/mcp", methods=["GET", "POST", "DELETE"])
async def native_mcp(request: Request):
    if native_engine is None:
        return JSONResponse({"error": "content_service_disabled"}, status_code=503)
    return await handle_mcp(request, native_engine)


@app.get("/.well-known/oauth-protected-resource")
def protected_resource(request: Request):
    if native_engine is None:
        return JSONResponse({"error": "content_service_disabled"}, status_code=503)
    try:
        provider(request)
    except Exception:
        return JSONResponse({"error": "provider_identity_required"}, status_code=403)
    return metadata(native_engine)


def main():
    global executor, native_engine
    native_engine = None
    require(os.environ.get("EXECUTOR_ENABLED", "0") == "1")
    require(os.environ.get("EXECUTOR_CREATION_ENABLED", "0") == "0")
    require("K_SERVICE" not in os.environ and "FIRESTORE_EMULATOR_HOST" not in os.environ)
    with Path(os.environ["EXECUTOR_CONFIG"]).open("rb") as f:
        config = Config.parse(
            strict_json_loads(f.read(65537), max_bytes=65536), now=int(time.time())
        )
    native_flag = os.environ.get("EXECUTOR_NATIVE_ENABLED", "0")
    require(native_flag in {"0", "1"})
    native = None
    if native_flag == "1":
        with Path(os.environ["EXECUTOR_NATIVE_CONFIG"]).open("rb") as f:
            value = strict_json_loads(f.read(262145), max_bytes=262144)
        expected = os.environ.get("EXECUTOR_NATIVE_CONFIG_SHA256")
        require(
            expected == digest(value)
            and config.public["workload"]["environment"].get("EXECUTOR_NATIVE_CONFIG_SHA256")
            == expected
            and config.public["workload"]["environment"].get("EXECUTOR_NATIVE_ENABLED") == "1"
        )
        native = NativeConfig.parse(value, config, now=int(time.time()))
    policy, attestation = PolicyClient(config), Attestation(config)
    executor = Executor(config, policy, attestation, GCSSnapshots(config.public["snapshotBucket"]))
    try:
        executor.restore()
        if native is not None:
            native_engine = NativeEngine(executor, native, HubClient(executor, native))
        with materialize(config, executor._keys["tls"], now=int(time.time())) as (
            _,
            certfile,
            keyfile,
        ):
            settings = uvicorn.Config(
                app,
                host="0.0.0.0",
                port=8443,
                http=ProviderProtocol if native_engine is not None else "h11",
                ssl_certfile=certfile,
                ssl_keyfile=keyfile,
                ssl_version=ssl.PROTOCOL_TLS_SERVER,
                access_log=False,
                server_header=False,
                log_level="critical",
                proxy_headers=False,
                forwarded_allow_ips="",
                timeout_keep_alive=5,
                limit_concurrency=16,
                h11_max_incomplete_event_size=16384,
            )
            settings.load()
            settings.ssl.minimum_version = ssl.TLSVersion.TLSv1_3
            if native_engine is not None:
                configure_client_trust(settings.ssl)
            # The SSLContext has loaded the original key. Remove RAM files before serving.
            Path(keyfile).unlink()
            Path(certfile).unlink()
            uvicorn.Server(settings).run()
    finally:
        if native_engine is not None:
            native_engine.hub.close()
            native_engine = None
        executor.stop()
        policy.close()
        attestation.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Executor unavailable.") from None
