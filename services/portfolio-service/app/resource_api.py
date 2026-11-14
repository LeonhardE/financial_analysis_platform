"""Metadata-only source producer behind workload identity and owner delegation.

This is discovery/state metadata, not agent ciphertext delivery or a Run/grant
validation fallback. No owner UID, key, recipient, ACK or broker session is taken
from the request. Up to ten sources are re-read in one bounded store transaction.
"""

import os
from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from folioview_shared.delegation import (
    CatalogueRequirement,
    DelegatedPrincipal,
    DelegationVerifier,
    make_delegation_dependency,
)
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute
from folioview_shared.service_identity import GoogleCallerVerifier

from .api import _invoke, _read_json, _transport, get_service
from .holdings import MAX_METADATA_SOURCES, PortfolioService

MAX_METADATA_REFS = MAX_METADATA_SOURCES
MAX_METADATA_BODY_BYTES = 131_072
router = APIRouter(prefix="/internal/v2/resources", route_class=PrivateRoute)


@lru_cache(maxsize=4)
def configured_verifier(configuration):
    service_audience, delegation_audience, issuer, callers = configuration
    try:
        if (
            not service_audience
            or service_audience.endswith("/")
            or delegation_audience != service_audience + "/internal/v2"
        ):
            raise ValueError
        allowed = strict_json_loads(callers, max_bytes=4096)
        if type(allowed) is not dict or not 1 <= len(allowed) <= 8:
            raise ValueError
        return DelegationVerifier(
            issuer=issuer,
            audience=delegation_audience,
            source_service="portfolio",
            caller_verifier=GoogleCallerVerifier(service_audience, allowed),
        )
    except Exception:
        raise ContractError("authorization_unavailable") from None


def get_delegation_verifier():
    return _invoke(
        lambda: configured_verifier(
            tuple(
                os.getenv(key, "")
                for key in (
                    "PORTFOLIO_SERVICE_AUDIENCE",
                    "PORTFOLIO_DELEGATION_AUDIENCE",
                    "PORTFOLIO_DELEGATION_ISSUER",
                    "PORTFOLIO_TRUSTED_HUB_CALLERS",
                )
            )
        )
    )


def delegated_metadata(
    request: Request,
    response: Response,
    verifier: Annotated[DelegationVerifier, Depends(get_delegation_verifier)],
) -> DelegatedPrincipal:
    _invoke(lambda: _transport(request))
    return make_delegation_dependency(verifier, CatalogueRequirement(frozenset({"holdings"})))(
        request, response
    )


Principal = Annotated[DelegatedPrincipal, Depends(delegated_metadata)]
Service = Annotated[PortfolioService, Depends(get_service)]


def _refs(value):
    if (
        type(value) is not dict
        or set(value) != {"contractVersion", "refs"}
        or value["contractVersion"] != CONTRACT_VERSION
        or type(value["refs"]) is not list
        or not 1 <= len(value["refs"]) <= MAX_METADATA_REFS
    ):
        raise ContractError("malformed_request")
    seen = set()
    for ref in value["refs"]:
        validate_schema("ResourceRef", ref)
        if ref["kind"] != "holdings" or ref["sourceService"] != "portfolio":
            raise ContractError("insufficient_scope")
        if ref["resourceId"] in seen:
            raise ContractError("malformed_request")
        seen.add(ref["resourceId"])
    return value["refs"]


def _projection_available(value):
    return value["state"] == "active" and (
        value["snapshotId"] is None or value["snapshotSourceEpoch"] == value["sourceEpoch"]
    )


def _items(service, refs, values, *, states):
    items = []
    for ref, value in zip(refs, values, strict=True):
        if canonical_json(value["resourceRef"]) != canonical_json(ref):
            raise ContractError("not_found")
        if not states:
            if value["state"] != "active":
                raise ContractError("insufficient_scope")
            if (
                value["snapshotId"] is not None
                and value["snapshotSourceEpoch"] != value["sourceEpoch"]
            ):
                # Historical owner pointers are not current-epoch input versions.
                # Legacy heads without an epoch also require a fresh upload.
                raise ContractError("source_unavailable")
        item = {
            "ref": value["resourceRef"],
            "revision": value["revision"],
            "sourceEpoch": value["sourceEpoch"],
            "state": value["state"],
        }
        if states:
            item["observedAt"] = (
                datetime.fromtimestamp(service.now(), UTC).isoformat().replace("+00:00", "Z")
            )
        else:
            item["snapshotId"] = value["snapshotId"]
        items.append(item)
    result = {"contractVersion": CONTRACT_VERSION, "items": items}
    check_read_response(result)
    return result


def _read(service, owner_uid, refs, *, states):
    values = service.metadata_many(owner_uid, [ref["resourceId"] for ref in refs])
    return _items(service, refs, values, states=states)


def _discovery(service, owner_uid, refs):
    # Both views come from the same owner transaction. Unavailable projections
    # are omitted, never promoted from an old epoch or a non-active state.
    values = service.metadata_many(owner_uid, [ref["resourceId"] for ref in refs])
    eligible = [value for value in values if _projection_available(value)]
    result = {
        "contractVersion": CONTRACT_VERSION,
        "profile": "folioview.portfolio-discovery.v1",
        "states": _items(service, refs, values, states=True),
        "projections": _items(
            service, [value["resourceRef"] for value in eligible], eligible, states=False
        ),
    }
    check_read_response(result)
    return result


async def _request_refs(request):
    if request.headers.getlist("content-type") != ["application/json"]:
        raise HTTPException(415, {"code": "unsupported_media_type"})
    value = await _read_json(request, max_bytes=MAX_METADATA_BODY_BYTES)
    return _invoke(lambda: _refs(value))


async def _read_request(request, principal, service, *, states):
    refs = await _request_refs(request)
    return await run_in_threadpool(
        _invoke, lambda: _read(service, principal.owner_uid, refs, states=states)
    )


@router.post("/projections/read")
async def projections(request: Request, principal: Principal, service: Service):
    return await _read_request(request, principal, service, states=False)


@router.post("/states/read")
async def states(request: Request, principal: Principal, service: Service):
    return await _read_request(request, principal, service, states=True)


@router.post("/discovery/read")
async def discovery(request: Request, principal: Principal, service: Service):
    refs = await _request_refs(request)
    return await run_in_threadpool(_invoke, lambda: _discovery(service, principal.owner_uid, refs))
