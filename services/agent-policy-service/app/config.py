"""Pinned independent domain and preregistered OAuth clients. No Root secrets."""

import os
import re
import secrets
from dataclasses import dataclass
from urllib.parse import urlsplit

from authlib.oauth2.rfc6749.models import ClientMixin

from folioview_shared.encrypted.crypto import jwk_thumbprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.encrypted.schema import validate_schema

from .contracts import SCOPES, Unavailable, closed, copy, digest, https, identifier, token_hash


class Client(ClientMixin):
    def __init__(self, value):
        closed(value, {"clientId", "redirectUris", "tokenEndpointAuthMethod", "secretSha256"})
        self.client_id = identifier(value["clientId"])
        self.redirects = value["redirectUris"]
        self.method, self.secret = value["tokenEndpointAuthMethod"], value["secretSha256"]
        if (
            type(self.redirects) is not list
            or not 1 <= len(self.redirects) <= 4
            or len(set(self.redirects)) != len(self.redirects)
            or self.method not in {"none", "client_secret_basic"}
        ):
            raise Unavailable
        if self.method == "none":
            if self.secret is not None:
                raise Unavailable
        else:
            validate_schema("Digest", self.secret)
        for uri in self.redirects:
            if type(uri) is not str or not 9 <= len(uri) <= 2048:
                raise Unavailable
            p = urlsplit(uri)
            if (
                p.scheme != "https"
                or not p.hostname
                or p.username
                or p.password
                or p.query
                or p.fragment
                or "\\" in uri
                or "*" in uri
                or any(ord(c) < 33 or ord(c) > 126 for c in uri)
            ):
                raise Unavailable

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
            self.secret and value and secrets.compare_digest(self.secret, token_hash(value))
        )

    def check_endpoint_auth_method(self, method, endpoint):
        return method == self.method

    def check_response_type(self, value):
        return value == "code"

    def check_grant_type(self, value):
        return value in {"authorization_code", "refresh_token"}


@dataclass(frozen=True)
class Config:
    public: dict
    clients: tuple
    enabled: bool = False
    release_enabled: bool = False

    @classmethod
    def parse(cls, value, *, enabled=False, release_enabled=False):
        try:
            closed(
                value,
                {
                    "issuer",
                    "consentUrl",
                    "ownerSubject",
                    "vaultId",
                    "rootJwk",
                    "policyJwk",
                    "stateEpoch",
                    "provider",
                    "providerClientId",
                    "audience",
                    "kmsSigningKeyVersion",
                    "kmsRecoveryKey",
                    "clients",
                    "witnessProject",
                    "witnessDatabase",
                    "snapshotBucket",
                },
                maximum=16384,
            )
            https(value["issuer"], origin=True)
            https(value["consentUrl"])
            https(value["audience"])
            validate_schema("Digest", value["ownerSubject"])
            for k in ("vaultId", "stateEpoch", "provider", "providerClientId"):
                identifier(value[k])
            for k in ("rootJwk", "policyJwk"):
                validate_schema("PublicJWK", value[k])
            if jwk_thumbprint(value["rootJwk"]) == jwk_thumbprint(value["policyJwk"]):
                raise Unavailable
            resource = (
                r"projects/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+/"
                r"keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+"
            )
            if not re.fullmatch(
                resource + r"/cryptoKeyVersions/[1-9][0-9]*", value["kmsSigningKeyVersion"]
            ):
                raise Unavailable
            if not re.fullmatch(resource, value["kmsRecoveryKey"]):
                raise Unavailable
            for key, pattern in {
                "witnessProject": r"[a-z][a-z0-9-]{4,61}[a-z0-9]",
                "witnessDatabase": r"[a-z][a-z0-9-]{2,62}",
                "snapshotBucket": r"[a-z0-9][a-z0-9.-]{2,221}",
            }.items():
                if type(value[key]) is not str or re.fullmatch(pattern, value[key]) is None:
                    raise Unavailable
            if value["witnessDatabase"] == "default":
                raise Unavailable
            if type(value["clients"]) is not list or not 1 <= len(value["clients"]) <= 8:
                raise Unavailable
            clients = tuple(Client(c) for c in value["clients"])
            if len({c.client_id for c in clients}) != len(clients):
                raise Unavailable
            return cls(copy(value), clients, enabled, release_enabled)
        except (ContractError, TypeError, ValueError):
            raise Unavailable from None

    @classmethod
    def environment(cls, *, active=False):
        enabled = os.getenv("POLICY_ENABLED") == "1"
        if active and not enabled:
            raise Unavailable
        try:
            return cls.parse(
                strict_json_loads(os.getenv("POLICY_CONFIG", ""), max_bytes=16384),
                enabled=enabled,
                release_enabled=os.getenv("POLICY_KEY_RELEASE_ENABLED") == "1",
            )
        except ContractError:
            raise Unavailable from None

    @property
    def issuer(self):
        return self.public["issuer"]

    @property
    def owner(self):
        return self.public["ownerSubject"]

    @property
    def root_jwk(self):
        return self.public["rootJwk"]

    @property
    def policy_jwk(self):
        return self.public["policyJwk"]

    @property
    def domain(self):
        # Callback/resource/key/witness changes require explicit Root adoption.
        return digest(self.public)

    def client(self, ident):
        return next((c for c in self.clients if c.client_id == ident), None)
