"""Owner-only discovery of existing source metadata, never encrypted Run evidence.

Context and upstream calls share one read budget and at most two joined workers.
Neither upstream content nor credentials are cached or persisted by this module.
"""

import logging
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urlencode
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_SAFE_INTEGER
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key

from .api import Owner, Service, _invoke, transport
from .fences import _state, fence_path
from .signing import _EMAIL, get_signer, origin
from .store import document_path
from .vaults import _verify_row

PROFILE = "folioview.owner-resource-discovery.v1"
PORTFOLIO_DISCOVERY_PROFILE = "folioview.portfolio-discovery.v1"
MAX_SOURCE_BYTES = 16_384
TOTAL_SECONDS = 10
FINALIZE_SECONDS = 1
_JWT = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\Z")
_USER_KINDS = ("watchlist", "channel_follows")
_SOURCE_STATES = {"active", "revoking", "disconnected", "deleted"}
_USER_FIELDS = {"kind", "sourceService", "state", "ref", "revision", "sourceEpoch", "updatedAt"}
_LOGGER = logging.getLogger(__name__)
# The MCP SDK configures the root logger at CRITICAL. These closed diagnostics
# must still be emitted without enabling SDK request or exception logging.
_LOGGER.setLevel(logging.WARNING)
_TIMING_LOGGER = logging.getLogger("uvicorn.error.hub_catalogue")


class _ProducerRefusal(ContractError):
    def __init__(self, status):
        super().__init__("source_unavailable")
        self.status = status


def _refusal(service, stage, error):
    # Only fixed operation stages and a closed code are observable. Never log
    # exception messages, upstream bodies, identities, references or credentials.
    code = (
        error.code
        if isinstance(error, ContractError)
        and error.code
        in {
            "source_unavailable",
            "authorization_unavailable",
            "malformed_request",
            "payload_too_large",
            "not_found",
            "insufficient_scope",
        }
        else "transport_error"
        if isinstance(error, httpx.HTTPError)
        else "invalid_metadata"
    )
    _LOGGER.warning("Resource discovery refused: service=%s stage=%s code=%s", service, stage, code)


def remaining(deadline, clock, *, maximum=4.0):
    value = deadline - clock()
    if not math.isfinite(value) or value <= 0:
        raise ContractError("source_unavailable")
    return min(maximum, value)


def timestamp(value):
    if (
        type(value) is not str
        or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value) is None
    ):
        raise ContractError("source_unavailable")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ContractError("source_unavailable") from None


def number(value, *, zero=False):
    if type(value) is not int or not int(not zero) <= value <= MAX_SAFE_INTEGER:
        raise ContractError("source_unavailable")


def reference(value, kind, *, expected=None):
    validate_schema("ResourceRef", value)
    service = "portfolio" if kind == "holdings" else "user"
    if value["kind"] != kind or value["sourceService"] != service:
        raise ContractError("source_unavailable")
    if expected is not None and value != expected:
        raise ContractError("source_unavailable")


def bounded_bytes(response, deadline, clock, *, maximum=MAX_SOURCE_BYTES):
    if response.headers.get("content-encoding", "identity") != "identity":
        raise ContractError("source_unavailable")
    raw = bytearray()
    for chunk in response.iter_bytes():
        remaining(deadline, clock)
        if len(chunk) > maximum - len(raw):
            raise ContractError("source_unavailable")
        raw.extend(chunk)
    remaining(deadline, clock)
    return bytes(raw)


def workload_token(audience, *, deadline, clock=time.monotonic, transport=None):
    """One bounded keyless metadata request, without ADC files or SDK retry chains."""
    try:
        url = (
            "http://metadata.google.internal/computeMetadata/v1/instance/"
            "service-accounts/default/identity?"
            + urlencode({"audience": audience, "format": "full"})
        )
        with httpx.Client(
            timeout=remaining(deadline, clock),
            trust_env=False,
            follow_redirects=False,
            transport=transport,
        ) as client:
            with client.stream(
                "GET", url, headers={"Metadata-Flavor": "Google", "Accept-Encoding": "identity"}
            ) as response:
                if (
                    response.status_code != 200
                    or response.headers.get("metadata-flavor") != "Google"
                ):
                    raise ContractError("authorization_unavailable")
                token = bounded_bytes(response, deadline, clock).decode("ascii")
        if _JWT.fullmatch(token) is None:
            raise ContractError("authorization_unavailable")
        return token
    except Exception:
        raise ContractError("authorization_unavailable") from None


def item(
    ref, *, state, revision=None, epoch=None, snapshot=None, updated=None, evidence="not_checked"
):
    return {
        "ref": ref,
        "revision": revision,
        "sourceEpoch": epoch,
        "state": state,
        "snapshotId": snapshot,
        "updatedAt": updated,
        "encryptedEvidence": evidence,
    }


def failure(ref=None, *, evidence="not_checked"):
    return item(ref, state="unavailable", evidence=evidence)


class CatalogueSources:
    """Fixed source origins and fresh request-scoped credentials; no owner cache."""

    def __init__(
        self,
        *,
        issuer,
        caller,
        user_origin,
        portfolio_origin,
        signer_factory=get_signer,
        token_factory=workload_token,
        transport=None,
        clock=time.monotonic,
        wall_clock=time.time,
    ):
        self.issuer, self.caller = issuer, caller
        self.origins = {"user": user_origin, "portfolio": portfolio_origin}
        self.signer_factory, self.token_factory, self.transport = (
            signer_factory,
            token_factory,
            transport,
        )
        self.clock, self.wall_clock = clock, wall_clock

    def discover(self, uid, sources, *, deadline=None):
        deadline = min(
            self.clock() + TOTAL_SECONDS,
            deadline if deadline is not None else self.clock() + TOTAL_SECONDS,
        )
        credentials, failures = {}, set()
        locks = {name: threading.Lock() for name in self.origins}
        with httpx.Client(
            trust_env=False,
            follow_redirects=False,
            transport=self.transport,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        ) as client:

            def prepare(service):
                if not locks[service].acquire(timeout=remaining(deadline, self.clock)):
                    raise ContractError("source_unavailable")
                try:
                    remaining(deadline, self.clock)
                    if service in failures:
                        raise ContractError("source_unavailable")
                    if service not in credentials:
                        try:
                            issuer, upstream = origin(self.issuer), origin(self.origins[service])
                            if (
                                type(self.caller) is not str
                                or _EMAIL.fullmatch(self.caller) is None
                                or upstream == issuer
                                or self.origins["user"] == self.origins["portfolio"]
                            ):
                                raise ContractError("authorization_unavailable")
                            token = self.token_factory(
                                upstream, deadline=deadline, clock=self.clock
                            )
                            remaining(deadline, self.clock)
                            if (
                                type(token) is not str
                                or len(token) > 16_384
                                or _JWT.fullmatch(token) is None
                            ):
                                raise ContractError("authorization_unavailable")
                            now = self.wall_clock()
                            if type(now) not in (float, int) or not math.isfinite(now) or now < 0:
                                raise ContractError("authorization_unavailable")
                            claims = {
                                "iss": issuer,
                                "aud": upstream + "/internal/v2",
                                "sub": uid,
                                "iat": int(now),
                                "exp": int(now) + 60,
                                "jti": uuid4().hex,
                                "caller": self.caller,
                                "purpose": "browser_catalog",
                                "scopes": ["resources:catalog"],
                                "resourceKinds": list(_USER_KINDS)
                                if service == "user"
                                else ["holdings"],
                            }
                            delegation = self.signer_factory().sign(
                                claims, deadline=deadline, budget_clock=self.clock
                            )
                            remaining(deadline, self.clock)
                            if (
                                type(delegation) is not str
                                or len(delegation) > 16_384
                                or _JWT.fullmatch(delegation) is None
                            ):
                                raise ContractError("authorization_unavailable")
                            credentials[service] = {
                                "Authorization": "Bearer " + token,
                                "X-FolioView-Delegation": delegation,
                                "X-FolioView-Contract": CONTRACT_VERSION,
                                "Cache-Control": "no-store",
                                "Accept-Encoding": "identity",
                            }
                        except Exception:
                            failures.add(service)
                            raise ContractError("source_unavailable") from None
                    return credentials[service]
                finally:
                    locks[service].release()

            def request(service, path, body=None):
                stage = "credentials"
                try:
                    headers = prepare(service)
                    kwargs = {}
                    if body is not None:
                        headers = {**headers, "Content-Type": "application/json"}
                        kwargs["content"] = canonical_json(body)
                    stage = "producer_request"
                    read_budget = remaining(deadline, self.clock, maximum=8.0)
                    with client.stream(
                        "GET" if body is None else "POST",
                        self.origins[service] + path,
                        headers=headers,
                        timeout=httpx.Timeout(min(4.0, read_budget), read=read_budget),
                        **kwargs,
                    ) as response:
                        stage = "response_status"
                        if response.status_code != 200:
                            # Never read, persist or forward a producer's error body.
                            raise _ProducerRefusal(response.status_code)
                        stage = "response_media_type"
                        if (
                            response.headers.get("content-type", "").split(";", 1)[0]
                            != "application/json"
                        ):
                            raise ContractError("source_unavailable")
                        stage = "response_bytes"
                        raw = bounded_bytes(response, deadline, self.clock)
                        stage = "response_json"
                        value = strict_json_loads(raw, max_bytes=MAX_SOURCE_BYTES)
                    return value
                except Exception as error:
                    _refusal(service, stage, error)
                    raise

            def user():
                stage = "catalogue_read"
                try:
                    value = request("user", "/internal/v2/resources/catalogue")
                    stage = "catalogue_shape"
                    if (
                        type(value) is not dict
                        or set(value) != {"contractVersion", "items", "readAt"}
                        or value["contractVersion"] != CONTRACT_VERSION
                        or type(value["items"]) is not list
                        or len(value["items"]) != 2
                    ):
                        raise ContractError("source_unavailable")
                    stage = "catalogue_timestamp"
                    timestamp(value["readAt"])
                    result = {}
                    for source in value["items"]:
                        stage = "catalogue_item"
                        if type(source) is not dict or set(source) != _USER_FIELDS:
                            raise ContractError("source_unavailable")
                        kind = source["kind"]
                        if (
                            kind not in _USER_KINDS
                            or kind in result
                            or source["sourceService"] != "user"
                        ):
                            raise ContractError("source_unavailable")
                        state = source["state"]
                        if state == "uninitialized":
                            if any(
                                source[k] is not None
                                for k in ("ref", "revision", "sourceEpoch", "updatedAt")
                            ):
                                raise ContractError("source_unavailable")
                        elif state in {"ready", "empty"}:
                            reference(source["ref"], kind)
                            number(source["revision"], zero=True)
                            if state == "ready" and source["revision"] == 0:
                                raise ContractError("source_unavailable")
                            number(source["sourceEpoch"])
                            timestamp(source["updatedAt"])
                        else:
                            raise ContractError("source_unavailable")
                        result[kind] = item(
                            source["ref"],
                            state=state,
                            revision=source["revision"],
                            epoch=source["sourceEpoch"],
                            updated=source["updatedAt"],
                            evidence="not_prepared",
                        )
                    return result
                except Exception as error:
                    _refusal("user", stage, error)
                    return {kind: failure(evidence="not_prepared") for kind in _USER_KINDS}

            def portfolio_read(refs):
                if not refs:
                    return {}, {}
                stage = "discovery_read"
                try:
                    value = request(
                        "portfolio",
                        "/internal/v2/resources/discovery/read",
                        {"contractVersion": CONTRACT_VERSION, "refs": refs},
                    )
                    stage = "discovery_contract"
                    return validate_portfolio_discovery(value, refs)
                except Exception as error:
                    _refusal("portfolio", stage, error)
                    # The unchanged producer contract fails a whole batch for a
                    # missing/fenced source. Isolate only those bounded refusals;
                    # malformed payloads/auth/transport errors never fan out.
                    if (
                        isinstance(error, _ProducerRefusal)
                        and error.status in {403, 404, 503}
                        and len(refs) > 1
                    ):
                        middle = len(refs) // 2
                        left_states, left_projections = portfolio_read(refs[:middle])
                        right_states, right_projections = portfolio_read(refs[middle:])
                        return left_states | right_states, left_projections | right_projections
                    return {}, {}

            def portfolio():
                result, active = {}, []
                live = []
                for source in sources:
                    ref, fence = source["ref"], source["fence"]
                    key = canonical_json(ref)
                    if fence["state"] in {"disconnected", "deleted"}:
                        result[key] = item(ref, state=fence["state"], epoch=fence["sourceEpoch"])
                    else:
                        live.append(ref)
                states, projections = portfolio_read(live)
                for source in sources:
                    ref, fence = source["ref"], source["fence"]
                    key = canonical_json(ref)
                    if key in result:
                        continue
                    state = states.get(key)
                    if state is None:
                        result[key] = failure(ref)
                        continue
                    if state["sourceEpoch"] != fence["sourceEpoch"]:
                        result[key] = item(ref, state="pending", epoch=fence["sourceEpoch"])
                    elif state["state"] != "active":
                        result[key] = item(
                            ref,
                            state=state["state"],
                            revision=state["revision"],
                            epoch=state["sourceEpoch"],
                        )
                    else:
                        active.append(ref)
                for ref in active:
                    key = canonical_json(ref)
                    state, projection = states[key], projections.get(key)
                    if projection is None or any(
                        projection[k] != state[k]
                        for k in ("ref", "revision", "sourceEpoch", "state")
                    ):
                        result[key] = failure(ref)
                        continue
                    result[key] = item(
                        ref,
                        state="active",
                        revision=state["revision"],
                        epoch=state["sourceEpoch"],
                        snapshot=projection["snapshotId"],
                        evidence="not_prepared"
                        if projection["snapshotId"] is None
                        else "not_checked",
                    )
                return [result[canonical_json(source["ref"])] for source in sources]

            try:
                with ThreadPoolExecutor(
                    max_workers=2, thread_name_prefix="hub-catalogue"
                ) as workers:
                    user_future = workers.submit(user)
                    holdings = workers.submit(portfolio)
                    result = {
                        "user": user_future.result(),
                        "portfolio": holdings.result(),
                    }
            finally:
                credentials.clear()
                failures.clear()
        return result


def validate_portfolio_discovery(value, refs):
    if (
        type(value) is not dict
        or set(value) != {"contractVersion", "profile", "states", "projections"}
        or value["contractVersion"] != CONTRACT_VERSION
        or value["profile"] != PORTFOLIO_DISCOVERY_PROFILE
    ):
        raise ContractError("source_unavailable")
    states = validate_portfolio_batch(value["states"], refs, states=True)
    projections = value["projections"]
    if (
        type(projections) is not dict
        or set(projections) != {"contractVersion", "items"}
        or projections["contractVersion"] != CONTRACT_VERSION
        or type(projections["items"]) is not list
        or len(projections["items"]) > len(refs)
    ):
        raise ContractError("source_unavailable")
    expected = {canonical_json(ref): ref for ref in refs}
    selected = []
    for row in projections["items"]:
        if type(row) is not dict or type(row.get("ref")) is not dict:
            raise ContractError("source_unavailable")
        key = canonical_json(row["ref"])
        if key not in expected or states[key]["state"] != "active":
            raise ContractError("source_unavailable")
        selected.append(expected[key])
    # Missing active projections are not success: the original per-source
    # comparison below still marks those refs unavailable, including stale heads.
    return states, validate_portfolio_batch(projections, selected, states=False)


def validate_portfolio_batch(value, refs, *, states):
    if (
        type(value) is not dict
        or set(value) != {"contractVersion", "items"}
        or value["contractVersion"] != CONTRACT_VERSION
        or type(value["items"]) is not list
        or len(value["items"]) != len(refs)
    ):
        raise ContractError("source_unavailable")
    expected = {canonical_json(ref): ref for ref in refs}
    result = {}
    for row in value["items"]:
        if type(row) is not dict or type(row.get("ref")) is not dict:
            raise ContractError("source_unavailable")
        key = canonical_json(row["ref"])
        if key not in expected or key in result:
            raise ContractError("source_unavailable")
        result[key] = validate_portfolio(
            {"contractVersion": CONTRACT_VERSION, "items": [row]}, expected[key], states=states
        )
    return result


def validate_portfolio(value, ref, *, states):
    if (
        type(value) is not dict
        or set(value) != {"contractVersion", "items"}
        or value["contractVersion"] != CONTRACT_VERSION
        or type(value["items"]) is not list
        or len(value["items"]) != 1
    ):
        raise ContractError("source_unavailable")
    current = value["items"][0]
    fields = {"ref", "revision", "sourceEpoch", "state", "observedAt" if states else "snapshotId"}
    if type(current) is not dict or set(current) != fields:
        raise ContractError("source_unavailable")
    reference(current["ref"], "holdings", expected=ref)
    number(current["revision"], zero=True)
    number(current["sourceEpoch"])
    if current["state"] not in _SOURCE_STATES or (not states and current["state"] != "active"):
        raise ContractError("source_unavailable")
    if states:
        timestamp(current["observedAt"])
    elif current["snapshotId"] is not None:
        validate_schema("Identifier", current["snapshotId"])
        if current["revision"] == 0:
            raise ContractError("source_unavailable")
    elif current["revision"] != 0:
        raise ContractError("source_unavailable")
    return current


class CatalogueService:
    def __init__(self, vaults, sources):
        self.vaults, self.sources = vaults, sources

    def context(self, uid, *, registry_cache=None):
        owner = owner_key(uid)

        def read(unit):
            row = unit.get(document_path("hub_vaults", owner))
            if row is None:
                return {"vault": None, "sources": []}
            registry = _verify_row(
                row, owner, self.vaults.now(), unit=unit, registry_cache=registry_cache
            )
            fences = unit.get_many(
                [fence_path(owner, source["resourceRef"]) for source in row["sources"]]
            )

            class Snapshot:
                def get(self, path):
                    return fences[path]

            snapshot = Snapshot()
            sources = [
                {
                    "ref": source["resourceRef"],
                    "fence": _state(snapshot, owner, source["resourceRef"]),
                }
                for source in row["sources"]
            ]
            return {
                "vault": {
                    "id": row["vaultId"],
                    "version": row["version"],
                    "checkpoint": registry.checkpoint_digest,
                    "keyEpoch": registry.key_epoch,
                },
                "sources": sources,
            }

        return self.vaults.store.transact(read)

    def read(self, uid):
        clock = self.sources.clock
        started = clock()
        deadline = started + TOTAL_SECONDS
        registry_cache = {}
        timing = dict.fromkeys(("before", "discover", "after"), 0.0)
        complete, source_count = False, 0
        stage_name, stage = None, started
        try:
            stage_name = "before"
            stage = started
            before = self.context(uid, registry_cache=registry_cache)
            timing["before"] = clock() - stage
            source_count = len(before["sources"])
            stage_name = None
            remaining(deadline - FINALIZE_SECONDS, clock)
            stage_name = "discover"
            stage = clock()
            result = self.sources.discover(
                uid, before["sources"], deadline=deadline - FINALIZE_SECONDS
            )
            timing["discover"] = clock() - stage
            stage_name = None
            remaining(deadline, clock)
            # No network in a database transaction. This post-read check prevents a
            # changed local authority/fence being presented as active discovery.
            stage_name = "after"
            stage = clock()
            after = self.context(uid, registry_cache=registry_cache)
            timing["after"] = clock() - stage
            stage_name = None
            remaining(deadline, clock)
            if canonical_json(after) != canonical_json(before):
                raise ContractError("version_conflict")
            holdings = result["portfolio"]
            states = {row["state"] for row in holdings}
            status = (
                "uninitialized"
                if not holdings
                else "unavailable"
                if states == {"unavailable"}
                else "partial"
                if "unavailable" in states
                else "available"
            )
            groups = [
                {
                    "kind": "holdings",
                    "sourceService": "portfolio",
                    "status": status,
                    "items": holdings,
                }
            ]
            for kind in _USER_KINDS:
                row = result["user"][kind]
                groups.append(
                    {
                        "kind": kind,
                        "sourceService": "user",
                        "status": "unavailable" if row["state"] == "unavailable" else "available",
                        "items": [row],
                    }
                )
            value = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "readAt": datetime.fromtimestamp(self.vaults.now(), UTC)
                .isoformat()
                .replace("+00:00", "Z"),
                "groups": groups,
            }
            check_read_response(value)
            remaining(deadline, clock)
            complete = True
            return value
        finally:
            if stage_name is not None:
                timing[stage_name] += clock() - stage
            _TIMING_LOGGER.info(
                "hub_catalogue sources=%d complete=%s before_ms=%.3f discover_ms=%.3f "
                "after_ms=%.3f total_ms=%.3f",
                source_count,
                complete,
                *(timing[name] * 1000 for name in ("before", "discover", "after")),
                (clock() - started) * 1000,
            )


def get_sources():
    return CatalogueSources(
        issuer=os.getenv("HUB_SERVICE_AUDIENCE", ""),
        caller=os.getenv("HUB_CATALOGUE_CALLER_EMAIL", ""),
        user_origin=os.getenv("HUB_USER_ORIGIN", ""),
        portfolio_origin=os.getenv("HUB_PORTFOLIO_ORIGIN", ""),
    )


router = APIRouter(prefix="/api/v2/resources", route_class=PrivateRoute)
Sources = Annotated[CatalogueSources, Depends(get_sources)]


@router.get("/catalogue")
async def catalogue(request: Request, user: Owner, vaults: Service, sources: Sources):
    def validate():
        transport(request)
        if request.headers.getlist("x-folioview-delegation") or request.headers.getlist(
            "x-serverless-authorization"
        ):
            raise ContractError("insufficient_scope")

    _invoke(validate)
    return await run_in_threadpool(
        _invoke, lambda: CatalogueService(vaults, sources).read(user.uid)
    )
