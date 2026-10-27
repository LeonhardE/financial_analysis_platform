"""Pinned Google workload identity and strict RS256 compact JWT verification.

No token, key, credential or cloud connection is created at import/construction.
Google key discovery is pinned to its documented JWKS endpoint, never a token
header. Callers still authorize the resulting service identity for each route.
"""

import math
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from jwcrypto import jwk, jws

from .delegated_keys import InvalidTokenKey, KeyCache, KeyUnavailable, UnknownKey
from .encrypted.errors import ContractError
from .encrypted.jsonutil import b64url_decode, strict_json_loads

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})
MAX_IDENTITY_TOKEN_BYTES = 16_384
MAX_GOOGLE_TOKEN_LIFETIME = 3_600
_MAX_TIME = 9_007_199_254_740_991
_KID = re.compile(r"[A-Za-z0-9._-]{1,128}\Z")
_SUBJECT = re.compile(r"[0-9]{1,128}\Z")
_SERVICE_EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com\Z")


class InvalidIdentityToken(ValueError):
    status_code = 401

    def __init__(self):
        super().__init__("A valid signed identity token is required.")


class UntrustedServiceCaller(PermissionError):
    status_code = 403

    def __init__(self):
        super().__init__("The service caller is not authorized.")


class IdentityVerificationUnavailable(RuntimeError):
    status_code = 503

    def __init__(self):
        super().__init__("Identity verification is temporarily unavailable.")


@dataclass(frozen=True)
class ServiceCaller:
    """Verified workload identity, without the bearer token or mutable claims."""

    subject: str
    email: str
    audience: str
    issuer: str
    issued_at: int
    expires_at: int


def verify_signed_jwt(
    token: str,
    *,
    keys: KeyCache,
    expected_typ: str,
    maximum_bytes: int = MAX_IDENTITY_TOKEN_BYTES,
    require_typ: bool = True,
) -> dict:
    """Verify strict compact RS256 against an independently configured key cache.

    This authenticates a signature, not the JWT's issuer/audience/time/purpose or
    any business authorization. The caller must check those claims separately.
    Token headers cannot supply a key, URL, algorithm or unsupported extension.
    Missing typ is allowed only when explicitly requested for Google OIDC; the
    internal delegation profile must retain the strict default.
    """
    if (
        type(maximum_bytes) is not int
        or not 0 < maximum_bytes <= 65_536
        or type(require_typ) is not bool
        or not isinstance(expected_typ, str)
        or not 0 < len(expected_typ) <= 64
        or any(char.isspace() or not char.isascii() for char in expected_typ)
    ):
        raise ValueError("Invalid JWT verification configuration.")
    try:
        if not isinstance(token, str) or len(token.encode("ascii")) > maximum_bytes:
            raise InvalidIdentityToken
        parts = token.split(".")
        if len(parts) != 3:
            raise InvalidIdentityToken
        header = strict_json_loads(b64url_decode(parts[0], max_bytes=1024), max_bytes=1024)
        claims = strict_json_loads(
            b64url_decode(parts[1], max_bytes=maximum_bytes), max_bytes=maximum_bytes
        )
        signature = b64url_decode(parts[2], max_bytes=512)
        if (
            type(header) is not dict
            or not {"alg", "kid"} <= header.keys()
            or not header.keys() <= {"alg", "kid", "typ"}
            or header["alg"] != "RS256"
            or not isinstance(header["kid"], str)
            or _KID.fullmatch(header["kid"]) is None
            or (require_typ and "typ" not in header)
            or ("typ" in header and header["typ"] != expected_typ)
            or type(claims) is not dict
        ):
            raise InvalidIdentityToken
    except (ContractError, UnicodeError, TypeError, ValueError):
        raise InvalidIdentityToken from None
    try:
        public_key = keys.get_key(header["kid"])
    except KeyUnavailable:
        raise IdentityVerificationUnavailable from None
    except (UnknownKey, InvalidTokenKey):
        raise InvalidIdentityToken from None
    try:
        if (
            public_key["kty"] != "RSA"
            or public_key["kid"] != header["kid"]
            or public_key["alg"] != "RS256"
            or public_key["use"] != "sig"
            or "d" in public_key
            or len(signature) != len(b64url_decode(public_key["n"], max_bytes=512))
        ):
            raise InvalidIdentityToken
        message = jws.JWS()
        message.allowed_algs = ["RS256"]
        message.deserialize(token)
        message.verify(jwk.JWK(**public_key), alg="RS256")
    except Exception:
        raise InvalidIdentityToken from None
    return claims


class GoogleCallerVerifier:
    """Authenticate pinned Google service-account subject/email pairs.

    This accepts signed Google ID tokens, not a self-signed service-account JWT,
    Firebase user token, access token or Cloud Run's signature-stripped header.
    Default network reads go only to GOOGLE_JWKS_URL and use bounded KeyCache.
    Production configuration must pin numeric service-account IDs as well as
    emails; recreating an account with the same email must not silently trust it.
    """

    def __init__(
        self,
        audience: str,
        allowed_callers: Mapping[str, str],
        *,
        keys: KeyCache | None = None,
        clock=time.time,
        clock_skew_seconds: int = 30,
    ):
        if (
            not isinstance(audience, str)
            or not 0 < len(audience) <= 2048
            or any(char.isspace() or ord(char) < 32 for char in audience)
            or not isinstance(allowed_callers, Mapping)
            or not allowed_callers
            or type(clock_skew_seconds) is not int
            or not 0 <= clock_skew_seconds <= 60
            or not callable(clock)
        ):
            raise ValueError("Invalid Google caller verifier configuration.")
        callers = dict(allowed_callers)
        if any(
            not isinstance(subject, str)
            or _SUBJECT.fullmatch(subject) is None
            or not isinstance(email, str)
            or len(email) > 254
            or _SERVICE_EMAIL.fullmatch(email) is None
            for subject, email in callers.items()
        ):
            raise ValueError("Invalid Google caller verifier configuration.")
        if keys is not None and keys.url != GOOGLE_JWKS_URL:
            raise ValueError("Invalid Google key source configuration.")
        self._audience = audience
        self._allowed_callers = MappingProxyType(callers)
        self._keys = keys if keys is not None else KeyCache(GOOGLE_JWKS_URL)
        self._clock = clock
        self._clock_skew_seconds = clock_skew_seconds

    def verify(self, token: str) -> ServiceCaller:
        claims = verify_signed_jwt(token, keys=self._keys, expected_typ="JWT", require_typ=False)
        try:
            now = self._clock()
            if type(now) not in (int, float) or not math.isfinite(now) or not 0 <= now <= _MAX_TIME:
                raise ValueError
        except Exception:
            raise IdentityVerificationUnavailable from None
        issued, expires = claims.get("iat"), claims.get("exp")
        not_before = claims.get("nbf", issued)
        issuer, audience = claims.get("iss"), claims.get("aud")
        if (
            not isinstance(issuer, str)
            or issuer not in GOOGLE_ISSUERS
            or not isinstance(audience, str)
            or audience != self._audience
            or any(
                type(value) is not int or not 0 <= value <= _MAX_TIME
                for value in (issued, expires, not_before)
            )
            or not issued < expires
            or not issued <= not_before < expires
            or expires - issued > MAX_GOOGLE_TOKEN_LIFETIME
            or not issued - self._clock_skew_seconds <= now < expires + self._clock_skew_seconds
            or not_before > now + self._clock_skew_seconds
        ):
            raise InvalidIdentityToken
        subject, email = claims.get("sub"), claims.get("email")
        if (
            not isinstance(subject, str)
            or _SUBJECT.fullmatch(subject) is None
            or not isinstance(email, str)
            or len(email) > 254
            or _SERVICE_EMAIL.fullmatch(email) is None
            or claims.get("email_verified") is not True
            or ("azp" in claims and claims["azp"] != subject)
        ):
            raise InvalidIdentityToken
        if self._allowed_callers.get(subject) != email:
            raise UntrustedServiceCaller
        return ServiceCaller(subject, email, audience, issuer, issued, expires)
