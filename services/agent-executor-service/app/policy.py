"""Pinned Policy transport and cryptographic verification, without account-token storage."""

import time

import httpx
from jwcrypto import jwe

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import sign_jws, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.executor_trust import (
    validate_executor_schema,
    verify_executor_approval,
    verify_executor_lease,
)
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    canonical_json,
    strict_json_loads,
)

from .contracts import (
    POLICY,
    AccessDenied,
    ScopeDenied,
    closed,
    digest,
    operation_id,
    require,
    safe,
)


class PolicyClient:
    def __init__(self, config, *, client=None, clock=time.time):
        self.config, self.clock = config, clock
        self.client = client or httpx.Client(timeout=8, follow_redirects=False, trust_env=False)

    def close(self):
        self.client.close()

    def proof(self, path, request, key):
        now = int(self.clock())
        return sign_jws(
            {
                "profile": POLICY,
                "purpose": "authenticated_request",
                "bindingDigest": digest(self.config.binding),
                "audience": self.config.issuer,
                "path": path,
                "method": "POST",
                "bodyDigest": digest(request),
                "requestId": operation_id(),
                "issuedAt": now,
                "expiresAt": now + 120,
            },
            key,
            typ="fv-control+jws",
        )

    def call(self, suffix, request, key, *, access=None, workload=False):
        def call():
            require(
                suffix
                in (
                    {"challenges", "releases", "confirm"}
                    if workload
                    else {"challenges", "leases", "confirm", "checkpoint", "commits", "releases"}
                )
            )
            require(
                (access is None) if workload else (type(access) is str and 1 <= len(access) <= 8192)
            )
            path = (
                ("/workload" if workload else "")
                + "/v1/connections/"
                + self.config.connection
                + "/"
                + suffix
            )
            headers = {"X-FolioView-Contract": CONTRACT_VERSION, "Content-Type": "application/json"}
            if access is not None:
                headers["Authorization"] = "Bearer " + access
            body = {
                "contractVersion": CONTRACT_VERSION,
                "proof": self.proof(path, request, key),
                "request": request,
            }
            raw = canonical_json(body)
            require(len(raw) <= 65536)
            with self.client.stream(
                "POST",
                self.config.issuer + path,
                headers=headers,
                content=raw,
                follow_redirects=False,
            ) as response:
                if response.status_code in {401, 403} and not workload:
                    rejected = bytearray()
                    for chunk in response.iter_bytes():
                        rejected.extend(chunk)
                        require(len(rejected) <= 4096)
                    error = strict_json_loads(bytes(rejected), max_bytes=4096)
                    if error == {"error": "insufficient_scope"}:
                        raise ScopeDenied
                    raise AccessDenied
                require(response.status_code == 200)
                require(
                    response.headers.get("content-type", "").split(";")[0] == "application/json"
                )
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    require(len(data) <= 131072)
            value = strict_json_loads(bytes(data), max_bytes=131072)
            require(type(value) is dict)
            if suffix != "commits":
                require(value.get("profile") == POLICY)
            return value

        return safe(call)

    def checkpoint(self, signed, approval=None):
        p = self.config.public
        approval = p["approval"] if approval is None else approval
        a = verify_executor_approval(
            approval,
            expected_binding=self.config.binding,
            root_jwk=p["rootJwk"],
            now=int(self.clock()),
        )
        cp = verify_jws(signed, p["policyJwk"], typ="fv-control+jws")
        validate_executor_schema("ExecutorCheckpointPayload", cp)
        require(
            cp["bindingDigest"] == digest(self.config.binding)
            and cp["approvalFingerprint"] == signing_input_fingerprint(approval)
            and cp["revoked"] is False
            and cp["issuedAt"]
            <= int(self.clock())
            < cp["expiresAt"]
            <= min(cp["issuedAt"] + 120, a["expiresAt"])
        )
        return cp

    def verify_lease(self, response, challenge, operation, purpose):
        closed(
            response,
            {
                "profile",
                "approval",
                "checkpoint",
                "lease",
                "generation",
                "stateHead",
                "sealedRecoveryKey",
            },
            maximum=65536,
        )
        require(response["profile"] == POLICY)
        cp = self.checkpoint(response["checkpoint"], response["approval"])
        verify_executor_lease(
            response["approval"],
            response["checkpoint"],
            response["lease"],
            expected_binding=self.config.binding,
            root_jwk=self.config.public["rootJwk"],
            policy_jwk=self.config.public["policyJwk"],
            current_checkpoint=cp,
            challenge=challenge,
            challenge_used=False,
            expected_operation=operation,
            purpose=purpose,
            now=int(self.clock()),
        )
        require(
            type(response["generation"]) is int
            and response["generation"] == cp["authorizationEpoch"]
            and response["stateHead"] == cp["stateHead"]
        )
        return cp


def open_secret(packet, key, expected_context):
    def decrypt():
        require(type(packet) is dict)
        require(set(packet) == {"protected", "header", "encrypted_key", "iv", "ciphertext", "tag"})
        header = strict_json_loads(
            b64url_decode(packet["protected"], max_bytes=1024), max_bytes=1024
        )
        require(
            header == {"alg": "ECDH-ES+A256KW", "enc": "A256GCM", "typ": "fv-policy-secret+jwe"}
        )
        closed(packet["header"], {"epk"})
        value = jwe.JWE(algs=["ECDH-ES+A256KW", "A256GCM"])
        value.deserialize(canonical_json(packet).decode())
        value.decrypt(key)
        plain = strict_json_loads(value.payload, max_bytes=16384)
        closed(plain, {"secret", "context"})
        require(plain["context"] == expected_context)
        return b64url_decode(plain["secret"], exact_bytes=32)

    return safe(decrypt)
