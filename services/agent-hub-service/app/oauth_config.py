"""Explicit preregistration for the disabled-by-default Muse OAuth resource."""

import hashlib
import os
import re
import secrets
from dataclasses import dataclass
from urllib.parse import urlsplit

from authlib.oauth2.rfc6749.models import ClientMixin

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads

SCOPES = frozenset(
    {
        "tasks:read",
        "runs:create",
        "runs:read",
        "results:create",
        "results:revise",
        "receipts:read",
        "watchlist:read",
        "channel_follows:read",
        "portfolio:read",
    }
)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def https_url(value, *, origin=False):
    if type(value) is not str or len(value) > 2048 or any(ord(c) <= 32 for c in value):
        raise ValueError
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or "\\" in value
        or "*" in value
        or parsed.port == 0
        or (origin and (parsed.path or parsed.query or value != f"https://{parsed.netloc}"))
    ):
        raise ValueError
    return parsed


class Client(ClientMixin):
    def __init__(self, client_id, redirects, method="none", secret_sha256=None):
        if (
            type(client_id) is not str
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", client_id) is None
            or type(redirects) not in (list, tuple)
            or not 1 <= len(redirects) <= 4
            or len(set(redirects)) != len(redirects)
            or method not in {"none", "client_secret_basic"}
            or (method == "none" and secret_sha256 is not None)
            or (
                method == "client_secret_basic"
                and (
                    type(secret_sha256) is not str
                    or re.fullmatch(r"[a-f0-9]{64}", secret_sha256) is None
                )
            )
        ):
            raise ValueError
        for uri in redirects:
            parsed = https_url(uri)
            if parsed.query:
                # No ambiguity with protocol response fields in registered callbacks.
                raise ValueError
        self.client_id, self.redirects = client_id, tuple(redirects)
        self.method, self.secret_hash = method, secret_sha256

    def get_client_id(self):
        return self.client_id

    def get_default_redirect_uri(self):
        return self.redirects[0]

    def get_allowed_scope(self, scope):
        return " ".join(sorted(set((scope or "").split()) & SCOPES))

    def check_redirect_uri(self, uri):
        return uri in self.redirects

    def check_client_secret(self, value):
        return bool(
            self.secret_hash and value and secrets.compare_digest(self.secret_hash, digest(value))
        )

    def check_endpoint_auth_method(self, method, endpoint):
        return method == self.method

    def check_response_type(self, value):
        return value == "code"

    def check_grant_type(self, value):
        return value in {"authorization_code", "refresh_token"}


@dataclass(frozen=True)
class OAuthConfig:
    issuer: str
    consent_url: str
    clients: tuple[Client, ...]

    def __post_init__(self):
        parsed = https_url(self.issuer, origin=True)
        consent = https_url(self.consent_url)
        if (
            consent.netloc != parsed.netloc
            or consent.query
            or not consent.path
            or not 1 <= len(self.clients) <= 8
            or len({c.client_id for c in self.clients}) != len(self.clients)
        ):
            raise ValueError

    @property
    def resource(self):
        return self.issuer + "/mcp/v2"

    @classmethod
    def environment(cls):
        try:
            if os.getenv("HUB_OAUTH_ENABLED") != "1":
                raise ValueError
            values = strict_json_loads(os.getenv("HUB_OAUTH_CLIENTS_JSON", ""), max_bytes=16384)
            if type(values) is not list:
                raise ValueError
            clients = []
            for row in values:
                if (
                    type(row) is not dict
                    or set(row)
                    != {
                        "provider",
                        "clientId",
                        "redirectUris",
                        "tokenEndpointAuthMethod",
                        "secretSha256",
                    }
                    or row["provider"] != "muse"
                ):
                    raise ValueError
                clients.append(
                    Client(
                        row["clientId"],
                        row["redirectUris"],
                        row["tokenEndpointAuthMethod"],
                        row["secretSha256"],
                    )
                )
            return cls(
                os.getenv("HUB_OAUTH_ISSUER", ""),
                os.getenv("HUB_OAUTH_CONSENT_URL", ""),
                tuple(clients),
            )
        except (ValueError, TypeError, KeyError, ContractError):
            raise ContractError("authorization_unavailable") from None


def owner_agent_capabilities():
    """Configuration capability only; does not probe storage or prove Muse interop."""
    enabled = False
    if all(
        os.getenv(flag) == "1" for flag in ("HUB_OAUTH_ENABLED", "HUB_ENCRYPTED_ADAPTER_ENABLED")
    ):
        try:
            OAuthConfig.environment()
            enabled = True
        except ContractError:
            pass
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": "folioview.owner-agent-capabilities.v1",
        "ownerConnections": True,
        "museConnectionEnabled": enabled,
    }
