"""Public, Root-reviewed configuration. Nothing here is a private key or token."""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from folioview_shared.encrypted.crypto import jwk_thumbprint
from folioview_shared.encrypted.executor_trust import (
    validate_executor_schema,
    verify_executor_approval,
)
from folioview_shared.encrypted.schema import validate_schema

from .contracts import PROFILE, clone, closed, digest, require, safe


@dataclass(frozen=True)
class Config:
    public: dict

    @classmethod
    def parse(cls, value, *, now):
        def parse():
            closed(
                value,
                {
                    "profile",
                    "binding",
                    "rootJwk",
                    "policyJwk",
                    "approval",
                    "workload",
                    "agentSigningJwk",
                    "agentEncryptionJwk",
                    "tlsJwk",
                    "certificateChain",
                    "snapshotBucket",
                    "kmsRecoveryKey",
                    "scope",
                },
                maximum=65536,
            )
            require(value["profile"] == PROFILE)
            b = validate_executor_schema("ExecutorBinding", value["binding"])
            scope = closed(
                value["scope"], {"profile", "purpose", "resultPolicy", "resourceBindings"}
            )
            require(
                scope["profile"] == "folioview.hub-executor-ciphertext-scope.v1"
                and scope["purpose"] == "analysis"
                and scope["resultPolicy"] == "owner_inbox"
                and type(scope["resourceBindings"]) is list
                and 1 <= len(scope["resourceBindings"]) <= 10
                and digest(scope) == b["scopeDigest"]
            )
            for resource in scope["resourceBindings"]:
                validate_schema("ResourceBindingMetadata", resource)
            require(
                len({digest(x) for x in scope["resourceBindings"]})
                == len(scope["resourceBindings"])
            )
            for name, field in {
                "rootJwk": "rootKeyId",
                "policyJwk": "policySigningKeyId",
                "agentSigningJwk": "agentSigningKeyId",
                "agentEncryptionJwk": "agentEncryptionKeyId",
                "tlsJwk": "tlsKeyId",
            }.items():
                validate_schema("PublicJWK", value[name])
                require(jwk_thumbprint(value[name]) == b[field])
            verify_executor_approval(
                value["approval"], expected_binding=b, root_jwk=value["rootJwk"], now=now
            )
            w = closed(
                value["workload"],
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
            )
            require(digest(w) == b["workloadDigest"])
            require(bool(re.fullmatch(r"sha256:[a-f0-9]{64}", w["imageDigest"])))
            require(w["hwmodel"] in {"GCP_AMD_SEV", "GCP_AMD_SEV_ES", "GCP_INTEL_TDX"})
            require(w["args"] == ["python", "-m", "app.main"])
            require(type(w["environment"]) is dict)
            require(w["attestationAudience"] == b["issuer"] + "/attestation")
            origin = urlsplit(b["audience"])
            require(origin.path == "/mcp" and not origin.query and not origin.fragment)
            require(
                type(value["certificateChain"]) is str
                and 1 <= len(value["certificateChain"].encode()) <= 16384
            )
            require(bool(re.fullmatch(r"[a-z0-9][a-z0-9.-]{2,221}", value["snapshotBucket"])))
            require(
                bool(
                    re.fullmatch(
                        r"projects/[a-z][a-z0-9-]+/locations/[a-z0-9-]+/keyRings/[A-Za-z0-9_-]+/"
                        r"cryptoKeys/[A-Za-z0-9_-]+",
                        value["kmsRecoveryKey"],
                    )
                )
            )
            return cls(clone(value))

        return safe(parse)

    @property
    def binding(self):
        return clone(self.public["binding"])

    @property
    def issuer(self):
        return self.public["binding"]["issuer"]

    @property
    def connection(self):
        return self.public["binding"]["connectionId"]
