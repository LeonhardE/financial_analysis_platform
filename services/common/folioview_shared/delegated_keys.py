"""Pinned public JWKS loading for internal RS256 identity verification.

Only a caller-configured HTTPS URL is fetched. Token fields never select a URL.
This module has no signer, private key, token cache or authorization store.
"""

import copy
import math
import re
import time
from collections.abc import Callable
from threading import Lock
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from cryptography.hazmat.primitives.asymmetric import rsa

from .encrypted.errors import ContractError
from .encrypted.jsonutil import b64url_decode, strict_json_loads

MAX_JWKS_BYTES = 65_536
MAX_JWKS_KEYS = 8
MAX_CACHE_TTL_SECONDS = 300
MAX_FETCH_TIMEOUT_SECONDS = 3
_KID = re.compile(r"[A-Za-z0-9._-]{1,128}\Z")
_PUBLIC_FIELDS = frozenset({"kty", "n", "e", "kid", "use", "alg"})


class KeyUnavailable(RuntimeError):
    """The configured authority cannot currently supply a usable key set."""

    def __init__(self):
        super().__init__("Trusted verification keys are temporarily unavailable")


class UnknownKey(ValueError):
    """The key ID is absent from a successfully retrieved trusted key set."""

    def __init__(self):
        super().__init__("Unknown verification key")


class InvalidTokenKey(ValueError):
    """A token contains a malformed key identifier, before any network request."""

    def __init__(self):
        super().__init__("Invalid verification key identifier")


def validate_jwks_url(url: str) -> str:
    """Validate trusted configuration, never an untrusted token's key locator."""
    try:
        if (
            type(url) is not str
            or len(url) > 2048
            or any(ord(char) < 33 or ord(char) > 126 for char in url)
            or "\\" in url
            or "?" in url
            or "#" in url
        ):
            raise ValueError
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in (None, 443)
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError
    except (TypeError, ValueError):
        raise ValueError("Invalid trusted JWKS configuration") from None
    return url


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(req.full_url, code, "JWKS redirect refused", headers, fp)


def fetch_jwks(url: str, *, timeout_seconds: float, max_bytes: int) -> bytes:
    """Fetch bounded bytes with explicit socket timeout and no redirect following.

    The URL was selected by trusted deployment configuration. The timeout covers
    socket operations; DNS/scheduler wall-clock deadlines belong to the host's
    HTTP/runtime policy. No cookies, bearer tokens or arbitrary headers are sent.
    """
    validate_jwks_url(url)
    if (
        type(timeout_seconds) not in (int, float)
        or not math.isfinite(timeout_seconds)
        or not 0 < timeout_seconds <= MAX_FETCH_TIMEOUT_SECONDS
        or type(max_bytes) is not int
        or not 1 <= max_bytes <= MAX_JWKS_BYTES
    ):
        raise ValueError("Invalid trusted JWKS configuration")
    try:
        request = Request(url, headers={"Accept": "application/json"}, method="GET")
        with build_opener(_NoRedirects()).open(request, timeout=timeout_seconds) as response:
            if (
                response.status != 200
                or response.headers.get("Content-Encoding", "identity") != "identity"
            ):
                raise KeyUnavailable
            length = response.headers.get("Content-Length")
            if length is not None and (not length.isdecimal() or int(length) > max_bytes):
                raise KeyUnavailable
            raw = response.read(max_bytes + 1)
            if type(raw) is not bytes or len(raw) > max_bytes:
                raise KeyUnavailable
            return raw
    except Exception:
        raise KeyUnavailable() from None


def _key_id(value: str) -> None:
    if type(value) is not str or not _KID.fullmatch(value):
        raise InvalidTokenKey()


def _parse_keys(body: bytes) -> dict[str, dict]:
    try:
        # Callers cannot inject pre-parsed dictionaries that bypass duplicate-key,
        # byte or UTF-8 checks. Public keys are small and validated atomically.
        if type(body) is not bytes:
            raise ValueError
        document = strict_json_loads(body, max_bytes=MAX_JWKS_BYTES)
        if type(document) is not dict or set(document) != {"keys"}:
            raise ValueError
        rows = document["keys"]
        if type(rows) is not list or not 1 <= len(rows) <= MAX_JWKS_KEYS:
            raise ValueError
        keys = {}
        for row in rows:
            if type(row) is not dict or not _PUBLIC_FIELDS <= set(row) <= _PUBLIC_FIELDS | {
                "key_ops"
            }:
                raise ValueError
            if row["kty"] != "RSA" or row["alg"] != "RS256" or row["use"] != "sig":
                raise ValueError
            if "key_ops" in row and row["key_ops"] != ["verify"]:
                raise ValueError
            _key_id(row["kid"])
            if row["kid"] in keys:
                raise ValueError
            modulus = b64url_decode(row["n"], max_bytes=512)
            exponent = b64url_decode(row["e"], max_bytes=4)
            if modulus[0] == 0 or exponent[0] == 0:
                raise ValueError
            n, e = int.from_bytes(modulus, "big"), int.from_bytes(exponent, "big")
            if n.bit_length() not in (2048, 3072, 4096) or n % 2 != 1 or e != 65537:
                raise ValueError
            rsa.RSAPublicNumbers(e, n).public_key()
            keys[row["kid"]] = copy.deepcopy(row)
        return keys
    except (ContractError, InvalidTokenKey, ValueError, TypeError, KeyError, IndexError):
        raise KeyUnavailable() from None


class KeyCache:
    """Bounded, thread-safe public keys from one pinned source.

    Fresh known keys survive unrelated unknown-ID refresh failures. Expired keys
    are never used as outage fallback. Unknown IDs share one refresh cooldown,
    without an unbounded attacker-controlled negative cache. Successful refresh
    replaces the entire set, so removed keys are not retained indefinitely.
    """

    def __init__(
        self,
        url: str,
        *,
        ttl_seconds: float = 300,
        refresh_interval_seconds: float = 30,
        timeout_seconds: float = 3,
        transport: Callable[..., bytes] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._url = validate_jwks_url(url)
        for value, maximum in (
            (ttl_seconds, MAX_CACHE_TTL_SECONDS),
            (refresh_interval_seconds, MAX_CACHE_TTL_SECONDS),
            (timeout_seconds, MAX_FETCH_TIMEOUT_SECONDS),
        ):
            if (
                type(value) not in (int, float)
                or not math.isfinite(value)
                or not 0 < value <= maximum
            ):
                raise ValueError("Invalid trusted JWKS configuration")
        if not callable(clock) or (transport is not None and not callable(transport)):
            raise ValueError("Invalid trusted JWKS configuration")
        self._ttl = ttl_seconds
        self._interval = refresh_interval_seconds
        self._timeout = timeout_seconds
        self._transport = transport or fetch_jwks
        self._clock = clock
        self._lock = Lock()
        self._keys: dict[str, dict] = {}
        self._expires = 0.0
        self._last_attempt: float | None = None
        self._last_refresh_failed = False
        self._last_clock = 0.0

    @property
    def url(self) -> str:
        return self._url

    def _now(self) -> float:
        try:
            now = self._clock()
            if (
                type(now) not in (int, float)
                or not math.isfinite(now)
                or now < self._last_clock
                or now > 9_007_199_254_740_991
            ):
                raise ValueError
        except Exception:
            raise KeyUnavailable() from None
        self._last_clock = now
        return now

    def get_key(self, kid: str) -> dict:
        """Return a detached trusted RSA JWK, never a token-supplied key or URL."""
        _key_id(kid)
        with self._lock:
            now = self._now()
            fresh = bool(self._keys) and now < self._expires
            if fresh and kid in self._keys:
                return copy.deepcopy(self._keys[kid])
            if self._last_attempt is not None and now < self._last_attempt + self._interval:
                if not fresh or self._last_refresh_failed:
                    raise KeyUnavailable()
                raise UnknownKey()
            self._last_attempt = now
            try:
                keys = _parse_keys(
                    self._transport(
                        self._url, timeout_seconds=self._timeout, max_bytes=MAX_JWKS_BYTES
                    )
                )
                fetched_at = self._now()
            except Exception:
                self._last_refresh_failed = True
                raise KeyUnavailable() from None
            self._keys = keys
            self._expires = fetched_at + self._ttl
            self._last_refresh_failed = False
            if kid not in self._keys:
                raise UnknownKey()
            return copy.deepcopy(self._keys[kid])
