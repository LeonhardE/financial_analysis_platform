"""Measured native channel configuration and independently reviewed Root directory anchor."""

import re
from dataclasses import dataclass

from folioview_shared.encrypted.authority import verify_registry

from .contracts import clone, closed, require, safe

NATIVE = "folioview.executor-native-mcp.v1"
PROVIDER = "openai_chatgpt"


@dataclass(frozen=True)
class NativeConfig:
    public: dict

    @classmethod
    def parse(cls, value, core, *, now):
        def parse():
            closed(
                value,
                {"profile", "hubAudience", "providerClientId", "registryAnchor"},
                maximum=262144,
            )
            binding = core.binding
            require(
                value["profile"] == NATIVE
                and binding["provider"] == PROVIDER
                and value["providerClientId"] == binding["providerClientId"] == binding["clientId"]
                and binding["identityEpoch"] == 1
            )
            require(
                bool(re.fullmatch(r"https://[a-z0-9]+(?:[.-][a-z0-9]+)*", value["hubAudience"]))
            )
            require(bool(re.fullmatch(r"[a-f0-9]{64}", binding["ownerSubject"])))
            registry = verify_registry(
                value["registryAnchor"],
                root_jwk=core.public["rootJwk"],
                pinned_root_key_id=binding["rootKeyId"],
                owner_subject=binding["ownerSubject"],
                vault_id=binding["vaultId"],
                now=now,
            )
            for key, role in [
                ("agentSigningKeyId", "agent_sig"),
                ("agentEncryptionKeyId", "agent_enc"),
            ]:
                registry.cert(binding[key], role=role, connection_id=core.connection, now=now)
            return cls(clone(value))

        return safe(parse)

    def anchor(self, core, now):
        return verify_registry(
            self.public["registryAnchor"],
            root_jwk=core.public["rootJwk"],
            pinned_root_key_id=core.binding["rootKeyId"],
            owner_subject=core.binding["ownerSubject"],
            vault_id=core.binding["vaultId"],
            now=now,
        )
