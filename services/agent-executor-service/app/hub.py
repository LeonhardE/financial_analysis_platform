"""Bounded ciphertext-only Hub client, with original-key proofs and no bearer proxy."""

import secrets
import time

import httpx

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import sign_jws
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json, strict_json_loads
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    CONTENT_PROFILE,
    validate_content_schema,
)

from .contracts import Stopped, digest, operation_id, require

SUFFIXES = frozenset(
    {
        "session",
        "consent-receipts",
        "tasks",
        "runs/begin",
        "runs/receipt",
        "runs/input",
        "runs/submit",
        "runs/result-receipt",
    }
)


class HubMissing(Stopped):
    pass


class HubClient:
    def __init__(self, executor, native, *, client=None, clock=time.time):
        self.executor, self.native, self.clock = executor, native, clock
        self.client = client or httpx.Client(timeout=8, follow_redirects=False, trust_env=False)
        self.deadline = None

    def call(self, suffix, request):
        """Authenticated metadata is not permission to decrypt; the consumer rechecks Policy."""
        require(suffix in SUFFIXES and self.executor._keys is not None)
        binding = self.executor.config.binding
        path = (
            "/agent/v3/persistent/executor/owners/"
            + binding["ownerSubject"]
            + "/vaults/"
            + binding["vaultId"]
            + "/connections/"
            + binding["connectionId"]
            + "/"
            + suffix
        )
        now = int(self.clock())
        payload = {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "artifactType": "persistent_agent_request",
            "purpose": "authenticated_request",
            **{k: binding[k] for k in BINDING_FIELDS},
            "audience": self.native.public["hubAudience"],
            "method": "POST",
            "path": path,
            "bodyDigest": digest(request),
            "requestId": operation_id(),
            "nonce": b64url_encode(secrets.token_bytes(32)),
            "issuedAt": now,
            "expiresAt": now + 120,
        }
        validate_content_schema("PersistentAgentRequestPayload", payload)
        body = {
            "contractVersion": CONTRACT_VERSION,
            "proof": sign_jws(payload, self.executor._keys["signing"], typ="fv-control+jws"),
            "request": request,
        }
        raw = canonical_json(body)
        require(len(raw) <= (557056 if suffix == "runs/submit" else 65536))

        def fetch():
            require(self.deadline is None or time.monotonic() < self.deadline)
            with self.client.stream(
                "POST",
                self.native.public["hubAudience"] + path,
                headers={
                    "X-FolioView-Contract": CONTRACT_VERSION,
                    "Content-Type": "application/json",
                },
                content=raw,
                follow_redirects=False,
            ) as response:
                if response.status_code == 404 and suffix in {
                    "runs/receipt",
                    "runs/result-receipt",
                }:
                    raise HubMissing
                require(response.status_code == 200)
                require(
                    response.headers.get("content-type", "").split(";")[0] == "application/json"
                )
                data = bytearray()
                deadline = min(time.monotonic() + 12, self.deadline or float("inf"))
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    require(len(data) <= 1048576 and time.monotonic() <= deadline)
            result = strict_json_loads(bytes(data), max_bytes=1048576)
            require(type(result) is dict and result.get("contractVersion") == CONTRACT_VERSION)
            return result

        try:
            return fetch()
        except HubMissing:
            raise
        except Exception:
            raise Stopped from None

    def close(self):
        self.client.close()
