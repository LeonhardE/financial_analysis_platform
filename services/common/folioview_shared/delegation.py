"""Bounded internal owner delegation, separate from Firebase and agent OAuth.

Both the Google workload token and Hub JWT are verified for each operation.
This module stores no OAuth/grant/Run state and never signs, forwards or logs a
token. Requirements must come from trusted routing and current source/Run state.
"""

import json
import math
import re
import time
from collections.abc import Callable, Collection
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, Response
from jsonschema import Draft202012Validator

from .delegated_keys import KeyCache, validate_jwks_url
from .encrypted.errors import ContractError
from .encrypted.jsonutil import canonical_json
from .service_identity import (
    GoogleCallerVerifier,
    IdentityVerificationUnavailable,
    InvalidIdentityToken,
    ServiceCaller,
    UntrustedServiceCaller,
    verify_signed_jwt,
)

DELEGATION_TYPE = "folioview-delegation+jwt"
MAX_DELEGATION_SECONDS = 60
MAX_DELEGATION_BYTES = 16_384
_SAFE_INTEGER = 9_007_199_254_740_991
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
_BEARER = re.compile(r"Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\Z", re.I)
_SOURCE_KINDS = {
    "user": frozenset({"watchlist", "channel_follows"}),
    "portfolio": frozenset({"holdings"}),
}
_READ_SCOPES = {
    "watchlist": "watchlist:read",
    "channel_follows": "channel_follows:read",
    "holdings": "portfolio:read",
}
_DETAILS = {
    "credentials_required": (401, "Signed service identity and delegation are required."),
    "invalid_credentials": (401, "A valid signed identity and delegation are required."),
    "permission_denied": (403, "This delegated operation is not authorized."),
    "verification_unavailable": (503, "Delegated authentication is temporarily unavailable."),
}


class DelegationError(ValueError):
    """Fixed public failures, without token/owner/key/transport diagnostics."""

    def __init__(self, code: str):
        if code not in _DETAILS:
            code = "invalid_credentials"
        self.code = code
        self.status_code, detail = _DETAILS[code]
        super().__init__(detail)

    def http_exception(self) -> HTTPException:
        headers = {"Cache-Control": "no-store"}
        if self.status_code == 401:
            headers["WWW-Authenticate"] = "Bearer"
        return HTTPException(self.status_code, str(self), headers=headers)


def _identifier(value: str) -> None:
    if not isinstance(value, str) or _ID.fullmatch(value) is None:
        raise ValueError("Invalid delegated operation configuration.")


def _owner(value: str | None) -> None:
    if value is not None and (
        not isinstance(value, str)
        or not 0 < len(value) <= 256
        or any(ord(c) < 32 or ord(c) == 127 for c in value)
    ):
        raise ValueError("Invalid delegated operation configuration.")


def _positive(value: int) -> None:
    if type(value) is not int or not 1 <= value <= _SAFE_INTEGER:
        raise ValueError("Invalid delegated operation configuration.")


@dataclass(frozen=True)
class ResourceRef:
    kind: str
    source_service: str
    resource_id: str
    incarnation: str

    def __post_init__(self):
        if (
            self.source_service not in _SOURCE_KINDS
            or self.kind not in _SOURCE_KINDS[self.source_service]
        ):
            raise ValueError("Invalid resource binding configuration.")
        _identifier(self.resource_id)
        _identifier(self.incarnation)

    def as_claim(self) -> dict:
        return {
            "kind": self.kind,
            "sourceService": self.source_service,
            "resourceId": self.resource_id,
            "incarnation": self.incarnation,
        }


@dataclass(frozen=True)
class ResourceBinding:
    ref: ResourceRef
    source_epoch: int

    def __post_init__(self):
        if not isinstance(self.ref, ResourceRef):
            raise ValueError("Invalid resource binding configuration.")
        _positive(self.source_epoch)

    def as_claim(self) -> dict:
        return {"ref": self.ref.as_claim(), "sourceEpoch": self.source_epoch}


def _bindings(values: Collection[ResourceBinding]) -> tuple[ResourceBinding, ...]:
    if isinstance(values, (str, bytes)) or not isinstance(values, Collection):
        raise ValueError("Invalid delegated operation configuration.")
    result = tuple(values)
    if not 1 <= len(result) <= 10 or any(not isinstance(v, ResourceBinding) for v in result):
        raise ValueError("Invalid delegated operation configuration.")
    if len({v.ref for v in result}) != len(result):
        raise ValueError("Invalid delegated operation configuration.")
    return result


@dataclass(frozen=True)
class CatalogueRequirement:
    """Route-selected summary kinds; owner is optional for first discovery.

    Without an independent owner pin, use principal.owner_uid as the only data
    partition. Never choose a partition from a request UID/header/body instead.
    """

    resource_kinds: frozenset[str]
    owner_uid: str | None = None

    def __post_init__(self):
        if isinstance(self.resource_kinds, (str, bytes)) or not isinstance(
            self.resource_kinds, Collection
        ):
            raise ValueError("Invalid delegated operation configuration.")
        kinds = frozenset(self.resource_kinds)
        if not kinds or not kinds <= _READ_SCOPES.keys():
            raise ValueError("Invalid delegated operation configuration.")
        object.__setattr__(self, "resource_kinds", kinds)
        _owner(self.owner_uid)


@dataclass(frozen=True)
class RunRequirement:
    """Current trusted Run/grant/source values, never request-self-reported authority.

    resources may select a nonempty subset of signed inputs. Every requested ref,
    incarnation and *current* source epoch must match a signed binding. Consumers
    still check active grants/Run expiry, connection/execution fences and state.
    """

    owner_uid: str
    run_id: str
    task_id: str
    grant_id: str
    grant_epoch: int
    resources: tuple[ResourceBinding, ...]

    def __post_init__(self):
        _owner(self.owner_uid)
        if self.owner_uid is None:
            raise ValueError("Invalid delegated operation configuration.")
        for value in (self.run_id, self.task_id, self.grant_id):
            _identifier(value)
        _positive(self.grant_epoch)
        object.__setattr__(self, "resources", _bindings(self.resources))


@dataclass(frozen=True)
class DelegatedPrincipal:
    """Verified identity snapshot, not a reusable grant or a content-decryption key."""

    owner_uid: str
    caller: ServiceCaller
    purpose: str
    scopes: frozenset[str]
    delegation_id: str
    issued_at: int
    expires_at: int
    resource_kinds: frozenset[str]
    resources: tuple[ResourceBinding, ...]
    run_id: str | None = None
    task_id: str | None = None
    grant_id: str | None = None
    grant_epoch: int | None = None

    def require_owner(self, owner_uid: str) -> None:
        """Compare a route/store owner against the signed UID before data access."""
        if self.owner_uid != owner_uid:
            raise DelegationError("permission_denied")


@lru_cache(maxsize=1)
def _claims_validator() -> Draft202012Validator:
    schema = json.loads(
        files(__package__).joinpath("delegation_schemas.json").read_text(encoding="utf-8")
    )
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _claims(value: dict) -> None:
    try:
        canonical_json(value)
        if next(_claims_validator().iter_errors(value), None) is not None:
            raise ValueError
        # JSON Schema treats 1.0 as an integer; JWT dates/epochs are strict ints.
        if any(type(value[key]) is not int for key in ("iat", "exp")):
            raise ValueError
        if value["purpose"] == "agent_run" and type(value["grantEpoch"]) is not int:
            raise ValueError
        _owner(value["sub"])
    except (ContractError, ValueError, TypeError, KeyError):
        raise DelegationError("invalid_credentials") from None


def _parsed_resources(values: list[dict]) -> tuple[ResourceBinding, ...]:
    try:
        result = [
            ResourceBinding(
                ResourceRef(
                    item["ref"]["kind"],
                    item["ref"]["sourceService"],
                    item["ref"]["resourceId"],
                    item["ref"]["incarnation"],
                ),
                item["sourceEpoch"],
            )
            for item in values
        ]
        return _bindings(result)
    except (ValueError, TypeError, KeyError):
        raise DelegationError("invalid_credentials") from None


class DelegationVerifier:
    """Verify both signed credentials and one explicit operation requirement.

    Configured issuer is a Hub HTTPS origin; only its fixed /.well-known/jwks.json
    is fetched. The delegation audience is separate from GoogleCallerVerifier's
    Cloud Run audience. Versioned consumers configure distinct logical audiences;
    this verifier never tries a v1 alias or plaintext fallback.
    """

    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        source_service: str,
        caller_verifier: GoogleCallerVerifier,
        keys: KeyCache | None = None,
        clock=time.time,
        clock_skew_seconds: int = 5,
    ):
        validate_jwks_url(issuer)
        validate_jwks_url(audience)
        parsed = urlsplit(issuer)
        if (
            parsed.path
            or issuer.endswith("/")
            or source_service not in _SOURCE_KINDS
            or not isinstance(caller_verifier, GoogleCallerVerifier)
            or not callable(clock)
            or type(clock_skew_seconds) is not int
            or not 0 <= clock_skew_seconds <= 5
        ):
            raise ValueError("Invalid delegation verifier configuration.")
        key_url = issuer + "/.well-known/jwks.json"
        if keys is not None and keys.url != key_url:
            raise ValueError("Invalid delegation key source configuration.")
        self._issuer, self._audience = issuer, audience
        self._source_service = source_service
        self._caller = caller_verifier
        self._keys = keys if keys is not None else KeyCache(key_url)
        self._clock, self._skew = clock, clock_skew_seconds

    def verify(
        self,
        service_token: str,
        delegation_token: str,
        *,
        requirement: CatalogueRequirement
        | RunRequirement
        | Callable[[DelegatedPrincipal], CatalogueRequirement | RunRequirement],
    ) -> DelegatedPrincipal:
        if not (
            isinstance(requirement, (CatalogueRequirement, RunRequirement)) or callable(requirement)
        ):
            raise ValueError("An explicit delegated operation requirement is required.")
        try:
            caller = self._caller.verify(service_token)
            value = verify_signed_jwt(
                delegation_token,
                keys=self._keys,
                expected_typ=DELEGATION_TYPE,
                maximum_bytes=MAX_DELEGATION_BYTES,
            )
        except InvalidIdentityToken:
            raise DelegationError("invalid_credentials") from None
        except UntrustedServiceCaller:
            raise DelegationError("permission_denied") from None
        except IdentityVerificationUnavailable:
            raise DelegationError("verification_unavailable") from None
        _claims(value)
        try:
            now = self._clock()
            if (
                type(now) not in (float, int)
                or not math.isfinite(now)
                or not 0 <= now <= _SAFE_INTEGER
            ):
                raise ValueError
        except Exception:
            raise DelegationError("verification_unavailable") from None
        if (
            value["iss"] != self._issuer
            or value["aud"] != self._audience
            or not 0 < value["exp"] - value["iat"] <= MAX_DELEGATION_SECONDS
            or value["iat"] > now + self._skew
            or value["exp"] <= now
        ):
            raise DelegationError("invalid_credentials")
        if value["caller"] != caller.email:
            raise DelegationError("permission_denied")
        kinds_allowed = _SOURCE_KINDS[self._source_service]
        if value["purpose"] == "browser_catalog":
            kinds = frozenset(value["resourceKinds"])
            if not kinds <= kinds_allowed:
                raise DelegationError("permission_denied")
            resources = ()
        else:
            resources = _parsed_resources(value["resources"])
            kinds = frozenset(item.ref.kind for item in resources)
            scopes = frozenset(value["scopes"])
            if (
                not kinds <= kinds_allowed
                or not scopes <= {_READ_SCOPES[kind] for kind in kinds_allowed}
                or not {_READ_SCOPES[kind] for kind in kinds} <= scopes
            ):
                raise DelegationError("permission_denied")
        principal = DelegatedPrincipal(
            value["sub"],
            caller,
            value["purpose"],
            frozenset(value["scopes"]),
            value["jti"],
            value["iat"],
            value["exp"],
            kinds,
            resources,
            value.get("runId"),
            value.get("taskId"),
            value.get("grantId"),
            value.get("grantEpoch"),
        )
        # Authenticate *both* proofs before any caller-supplied authority lookup.
        # The lookup receives the signed owner partition, never an untrusted UID.
        expected = requirement(principal) if callable(requirement) else requirement
        if not isinstance(expected, (CatalogueRequirement, RunRequirement)):
            raise ValueError("An explicit delegated operation requirement is required.")
        purpose = "browser_catalog" if isinstance(expected, CatalogueRequirement) else "agent_run"
        if principal.purpose != purpose:
            raise DelegationError("permission_denied")
        if expected.owner_uid is not None:
            principal.require_owner(expected.owner_uid)
        if isinstance(expected, CatalogueRequirement):
            if not expected.resource_kinds <= kinds:
                raise DelegationError("permission_denied")
        elif any(item not in resources for item in expected.resources) or any(
            actual != wanted
            for actual, wanted in (
                (principal.run_id, expected.run_id),
                (principal.task_id, expected.task_id),
                (principal.grant_id, expected.grant_id),
                (principal.grant_epoch, expected.grant_epoch),
            )
        ):
            raise DelegationError("permission_denied")
        return principal


def _authorization(request: Request) -> str:
    values = request.headers.getlist("authorization")
    if not values:
        raise DelegationError("credentials_required")
    if len(values) != 1 or len(values[0]) > 16_400:
        raise DelegationError("invalid_credentials")
    matched = _BEARER.fullmatch(values[0])
    if matched is None:
        raise DelegationError("invalid_credentials")
    return matched[1]


def make_delegation_dependency(
    verifier: DelegationVerifier,
    requirement: CatalogueRequirement
    | RunRequirement
    | Callable[[Request, DelegatedPrincipal], CatalogueRequirement | RunRequirement],
):
    """Opt-in FastAPI dependency; no route or default auth chain is registered.

    Use create_app(private=True, private_prefixes=("/api/", "/internal/")) to
    protect validation/missing-route/CORS errors too. A requirement factory gets
    (request, verified_principal) only after both credentials authenticate. It
    loads trusted current state in that owner partition, without Run fallback.
    """
    if not isinstance(verifier, DelegationVerifier) or not (
        isinstance(requirement, (CatalogueRequirement, RunRequirement)) or callable(requirement)
    ):
        raise ValueError("Invalid delegated dependency configuration.")

    def dependency(request: Request, response: Response) -> DelegatedPrincipal:
        response.headers["Cache-Control"] = "no-store"
        try:
            service_token = _authorization(request)
            values = request.headers.getlist("x-folioview-delegation")
            if not values:
                raise DelegationError("credentials_required")
            if len(values) != 1 or not values[0] or len(values[0]) > MAX_DELEGATION_BYTES:
                raise DelegationError("invalid_credentials")
            expected = (
                (lambda principal: requirement(request, principal))
                if callable(requirement)
                else requirement
            )
            return verifier.verify(service_token, values[0], requirement=expected)
        except DelegationError as error:
            raise error.http_exception() from None
        except Exception:
            raise DelegationError("verification_unavailable").http_exception() from None

    return dependency


def make_service_identity_dependency(verifier: GoogleCallerVerifier):
    """Workload-only routes get a ServiceCaller, without delegated user authority."""
    if not isinstance(verifier, GoogleCallerVerifier):
        raise ValueError("Invalid service identity dependency configuration.")

    def dependency(request: Request, response: Response) -> ServiceCaller:
        response.headers["Cache-Control"] = "no-store"
        try:
            token = _authorization(request)
            if request.headers.getlist("x-folioview-delegation"):
                raise DelegationError("permission_denied")
            return verifier.verify(token)
        except DelegationError as error:
            raise error.http_exception() from None
        except InvalidIdentityToken:
            raise DelegationError("invalid_credentials").http_exception() from None
        except UntrustedServiceCaller:
            raise DelegationError("permission_denied").http_exception() from None
        except IdentityVerificationUnavailable:
            raise DelegationError("verification_unavailable").http_exception() from None
        except Exception:
            raise DelegationError("verification_unavailable").http_exception() from None

    return dependency
