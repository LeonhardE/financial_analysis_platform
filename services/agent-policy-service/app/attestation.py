"""Fresh Google Confidential Space proof bound to the exact policy challenge and keys."""

import time
from contextlib import nullcontext

import httpx
from jwcrypto import jwk, jws

from folioview_shared.encrypted.crypto import jwk_thumbprint
from folioview_shared.encrypted.jsonutil import strict_json_loads

from .contracts import Unavailable, closed, deny, digest, number

ISSUER = "https://confidentialcomputing.googleapis.com"
JWKS = "https://www.googleapis.com/service_accounts/v1/metadata/jwk/signer@confidentialspace-sign.iam.gserviceaccount.com"


def validate_workload(value):
    closed(
        value,
        {
            "projectId",
            "projectNumber",
            "zone",
            "instanceName",
            "serviceAccount",
            "imageDigest",
            "args",
            "environment",
            "hwmodel",
            "attestationAudience",
        },
        maximum=16384,
    )
    import re

    for field, pattern in {
        "projectId": r"[a-z][a-z0-9-]{4,61}[a-z0-9]",
        "projectNumber": r"[0-9]{6,20}",
        "zone": r"[a-z]+-[a-z]+[0-9]+-[a-z]",
        "instanceName": r"[a-z][a-z0-9-]{0,61}[a-z0-9]",
        "serviceAccount": r"[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.gserviceaccount\.com",
        "imageDigest": r"sha256:[a-f0-9]{64}",
    }.items():
        if type(value[field]) is not str or re.fullmatch(pattern, value[field]) is None:
            deny("malformed_request")
    if (
        value["hwmodel"] not in {"GCP_AMD_SEV", "GCP_AMD_SEV_ES", "GCP_INTEL_TDX"}
        or type(value["args"]) is not list
        or not 1 <= len(value["args"]) <= 16
        or any(type(a) is not str or len(a) > 256 for a in value["args"])
        or type(value["environment"]) is not dict
        or len(value["environment"]) > 16
        or any(
            type(k) is not str or type(v) is not str or len(k) > 128 or len(v) > 256
            for k, v in value["environment"].items()
        )
        or type(value["attestationAudience"]) is not str
        or not 9 <= len(value["attestationAudience"]) <= 512
    ):
        deny("malformed_request")
    from .contracts import https

    https(value["attestationAudience"])
    return value


class GoogleAttestation:
    """No caller URL/JWKS; fixed Google keys and independently pinned live VM."""

    def __init__(self, *, client=None, credentials=None, clock=time.time):
        self.client, self.credentials, self.clock = client, credentials, clock

    def _client(self):
        return self.client or httpx.Client(
            timeout=httpx.Timeout(4), trust_env=False, follow_redirects=False
        )

    def _get(self, client, url, headers=None, maximum=65536):
        deadline = time.monotonic() + 8
        with client.stream("GET", url, headers=headers or {}) as response:
            if response.status_code != 200:
                raise Unavailable
            body = bytearray()
            for chunk in response.iter_bytes():
                if len(body) + len(chunk) > maximum or time.monotonic() > deadline:
                    raise Unavailable
                body.extend(chunk)
        return strict_json_loads(bytes(body), max_bytes=maximum)

    def verify(self, token, statement, workload, *, allow_finished_creation=False):
        validate_workload(workload)
        statuses = {"RUNNING"}
        if type(allow_finished_creation) is not bool:
            deny()
        if allow_finished_creation:
            # Production Confidential Space stops the VM when the create-only
            # workload exits. This narrow review verifies the just-persisted
            # original identity, not a live capability or secret release.
            closed(
                statement,
                {
                    "profile",
                    "action",
                    "issuer",
                    "permitFingerprint",
                    "offerDigest",
                    "finalizationFingerprint",
                    "binding",
                    "initialStateHead",
                    "wrappedKeyDigest",
                    "csrDigest",
                },
            )
            if (
                statement["profile"] != "folioview.agent-executor.v1"
                or statement["action"] != "finalize"
                or workload["attestationAudience"] != statement["issuer"] + "/enrollment"
            ):
                deny()
            statuses |= {"STOPPING", "TERMINATED"}
        if type(token) is not str or not 1 <= len(token) <= 32768:
            deny()
        now = int(self.clock())
        try:
            with nullcontext(self.client) if self.client is not None else self._client() as client:
                keys = self._get(client, JWKS, maximum=131072)
                import json

                verified = jws.JWS()
                verified.allowed_algs = ["RS256"]
                verified.deserialize(token, key=jwk.JWKSet.from_json(json.dumps(keys)))
                header = verified.jose_header
                if (
                    set(header) != {"alg", "kid", "typ"}
                    or header["alg"] != "RS256"
                    or header["typ"] != "JWT"
                ):
                    deny()
                claims = strict_json_loads(verified.payload, max_bytes=32768)
                if claims["iss"] != ISSUER or claims["aud"] != workload["attestationAudience"]:
                    deny()
                for field in ("iat", "exp", "nbf"):
                    number(claims[field])
                if (
                    not now - 120 <= claims["iat"] <= now + 5
                    or not claims["nbf"] <= now < claims["exp"]
                ):
                    deny()
                nonce = claims["eat_nonce"]
                if nonce != digest(statement) and nonce != [digest(statement)]:
                    deny()
                mods = claims["submods"]
                container = mods["container"]
                gce = mods["gce"]
                space = mods["confidential_space"]
                overrides = container.get("env_override", {})
                # The launcher measures the full OCI environment and every
                # operator-supplied variable separately. Every override must
                # already have its exact value in the Root-approved workload.
                if type(overrides) is not dict or any(
                    key not in workload["environment"] or workload["environment"][key] != value
                    for key, value in overrides.items()
                ):
                    deny()
                if (
                    claims["swname"] != "CONFIDENTIAL_SPACE"
                    or claims["dbgstat"] != "disabled-since-boot"
                    or claims["secboot"] is not True
                    or claims["hwmodel"] != workload["hwmodel"]
                    or "STABLE" not in space["support_attributes"]
                    or space["monitoring_enabled"].get("memory") is not False
                    or container["image_digest"] != workload["imageDigest"]
                    or container["args"] != workload["args"]
                    or container["env"] != workload["environment"]
                    or container.get("cmd_override", []) != []
                    or gce["project_id"] != workload["projectId"]
                    or gce["project_number"] != workload["projectNumber"]
                    or gce["zone"] != workload["zone"]
                    or gce["instance_name"] != workload["instanceName"]
                    or claims["google_service_accounts"] != [workload["serviceAccount"]]
                ):
                    deny()
                instance = gce["instance_id"]
                # The signed evidence must describe the independently selected live VM,
                # not a copied old instance with the same name or service account.
                headers = self._identity_headers()
                base = (
                    "https://compute.googleapis.com/compute/v1/projects/"
                    + workload["projectId"]
                    + "/zones/"
                    + workload["zone"]
                    + "/instances/"
                    + workload["instanceName"]
                )
                vm = self._get(client, base, headers)
                if (
                    str(vm["id"]) != instance
                    or vm["status"] not in statuses
                    or [a["email"] for a in vm["serviceAccounts"]] != [workload["serviceAccount"]]
                ):
                    deny()
                return {
                    "instanceId": instance,
                    "statementDigest": digest(statement),
                    "tokenDigest": digest(token),
                }
        except Unavailable:
            raise
        except Exception:
            deny()

    def _identity_headers(self):
        import google.auth
        from google.auth.transport.requests import Request

        if self.credentials is None:
            self.credentials, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/compute.readonly"]
            )
        if not self.credentials.valid:
            # A bounded Requests transport; ADC is never a client-supplied identity.
            request = Request()
            self.credentials.refresh(lambda *a, **k: request(*a, **{**k, "timeout": 4}))
        return {"Authorization": "Bearer " + self.credentials.token}


def seal_secret(secret, recipient, context):
    """Only random challenge/32-byte recovery material, never analysis content."""
    import json

    from jwcrypto import jwe

    from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json

    key = jwk.JWK(**recipient)
    jwk_thumbprint(recipient)
    message = jwe.JWE(
        canonical_json({"secret": b64url_encode(secret), "context": context}),
        protected={"alg": "ECDH-ES+A256KW", "enc": "A256GCM", "typ": "fv-policy-secret+jwe"},
    )
    message.add_recipient(key)
    return json.loads(message.serialize())
