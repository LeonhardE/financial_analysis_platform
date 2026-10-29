"""Explicit owner-triggered replication of Hub's public authority.

Only a fixed configured Hub endpoint is contacted. The request body never
supplies a root or owner; the Hub verifies workload identity and its narrow
delegation, and Portfolio independently binds the returned owner/source.
"""

import json
import os
import re
import time
from functools import lru_cache
from typing import Annotated
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_READ_BYTES
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key

from .api import _invoke, _read_json, _transport, get_service
from .holdings import PortfolioService

MAX_AUTHORITY_BYTES = MAX_READ_BYTES
_TOKEN = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\Z")


def _origin(value):
    try:
        if (
            type(value) is not str
            or not 1 <= len(value) <= 2048
            or any(ord(c) < 33 or ord(c) > 126 for c in value)
            or "\\" in value
        ):
            raise ValueError
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.path
            or url.query
            or url.fragment
            or url.port not in (None, 443)
        ):
            raise ValueError
        return value
    except (ValueError, TypeError, AttributeError):
        raise ContractError("authorization_unavailable") from None


def workload_token(audience):
    """Use runtime identity, with bounded metadata calls; never persist it."""
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2.id_token import fetch_id_token

    class BoundedRequest(GoogleRequest):
        def __call__(self, *args, **kwargs):
            kwargs["timeout"] = 4
            return super().__call__(*args, **kwargs)

    try:
        return fetch_id_token(BoundedRequest(), audience)
    except Exception:
        raise ContractError("authorization_unavailable") from None


class HubAuthorityClient:
    def __init__(
        self, origin, *, token_factory=workload_token, transport=None, clock=time.monotonic
    ):
        self.origin = _origin(origin)
        self.token_factory = token_factory
        self.transport = transport
        self.clock = clock

    def read(self, uid, source, delegation):
        if (
            not isinstance(delegation, str)
            or len(delegation) > 16_384
            or _TOKEN.fullmatch(delegation) is None
        ):
            raise ContractError("invalid_token")
        try:
            deadline = self.clock() + 12
            token = self.token_factory(self.origin)
            if self.clock() > deadline:
                raise ContractError("source_unavailable")
            if not isinstance(token, str) or _TOKEN.fullmatch(token) is None:
                raise ContractError("authorization_unavailable")
            # No ambient proxies, redirects, arbitrary destination or retry loop.
            with httpx.Client(
                timeout=4,
                follow_redirects=False,
                trust_env=False,
                transport=self.transport,
            ) as client:
                with client.stream(
                    "POST",
                    self.origin + "/internal/v2/portfolio-authorities/read",
                    headers={
                        "Authorization": "Bearer " + token,
                        "X-FolioView-Delegation": delegation,
                        "X-FolioView-Contract": CONTRACT_VERSION,
                        "Content-Type": "application/json",
                        "Cache-Control": "no-store",
                        "Accept-Encoding": "identity",
                    },
                    content=canonical_json(
                        {"contractVersion": CONTRACT_VERSION, "sourceId": source}
                    ),
                ) as response:
                    if response.status_code in (401, 403, 404):
                        raise ContractError(
                            {401: "invalid_token", 403: "insufficient_scope", 404: "not_found"}[
                                response.status_code
                            ]
                        )
                    if response.status_code != 200:
                        raise ContractError("source_unavailable")
                    if (
                        response.headers.get("content-type", "").split(";", 1)[0]
                        != "application/json"
                    ):
                        raise ContractError("source_unavailable")
                    if response.headers.get("content-encoding", "identity") != "identity":
                        raise ContractError("source_unavailable")
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        if self.clock() > deadline:
                            raise ContractError("source_unavailable")
                        if len(chunk) > MAX_AUTHORITY_BYTES - len(body):
                            raise ContractError("payload_too_large")
                        body.extend(chunk)
            value = strict_json_loads(bytes(body), max_bytes=MAX_AUTHORITY_BYTES)
            if (
                type(value) is not dict
                or set(value) != {"contractVersion", "authority"}
                or value["contractVersion"] != CONTRACT_VERSION
                or type(value["authority"]) is not dict
                or value["authority"].get("ownerSubject") != owner_key(uid)
                or value["authority"].get("sourceId") != source
            ):
                raise ContractError("recipient_binding_mismatch")
            return value["authority"]
        except ContractError:
            raise
        except (httpx.HTTPError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            raise ContractError("source_unavailable") from None


@lru_cache(maxsize=1)
def configured_client(origin):
    return HubAuthorityClient(origin)


def get_authority_client():
    return _invoke(lambda: configured_client(os.getenv("PORTFOLIO_HUB_AUTHORITY_ORIGIN", "")))


router = APIRouter(prefix="/api/v2/holdings/sources", route_class=PrivateRoute)
Owner = Annotated[CurrentUser, Depends(require_google_user)]
Service = Annotated[PortfolioService, Depends(get_service)]
Client = Annotated[HubAuthorityClient, Depends(get_authority_client)]


@router.post("/{source_id}/authority-sync")
async def synchronize(
    source_id: str, request: Request, user: Owner, service: Service, client: Client
):
    _invoke(lambda: _transport(request))
    if request.headers.getlist("content-type") != ["application/json"]:
        raise HTTPException(415, {"code": "unsupported_media_type"})
    values = request.headers.getlist("x-folioview-authority-delegation")
    if len(values) != 1:
        raise HTTPException(401, {"code": "invalid_token"})
    body = await _read_json(request, max_bytes=1024)
    if body != {"contractVersion": CONTRACT_VERSION} or type(body) is not dict:
        raise HTTPException(400, {"code": "malformed_request"})

    def sync():
        # Validate routing before a credential-bearing network request.
        from .holdings import _identifier

        _identifier(source_id)
        authority = client.read(user.uid, source_id, values[0])
        return service.synchronize_authority(user.uid, source_id, authority)

    return await run_in_threadpool(_invoke, sync)
