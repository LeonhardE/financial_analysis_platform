"""Authenticated native bootstrap for personal host-owned credentials.

OAuth associates the public setup with a preregistered provider. It cannot read
financial resources, mint Agent keys, or grant/recover execution authority.
"""

from urllib.parse import urlsplit

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.schema import safe_https_url

from .agent_credentials import AgentCredentialService, operation_path
from .native_transport import NativeUnit
from .persistent_agents import snapshot, stored_identity
from .store import StoreUnavailable


class NativeCredentialService:
    def __init__(self, native, *, owner_url):
        if (
            not safe_https_url(owner_url)
            or urlsplit(owner_url).path != "/agents"
            or urlsplit(owner_url).query
            or urlsplit(owner_url).fragment
        ):
            raise ContractError("authorization_unavailable")
        self.native, self.store, self.owner_url = native, native.store, owner_url
        self.credentials = AgentCredentialService(
            self.store,
            audience=native.config.base.issuer,
            client_ids=[c.client_id for c in native.config.clients],
            clock=native.clock,
        )

    def _principal(self, token):
        return self.native.authenticate(token)

    def _context(self, token):
        def read(unit):
            p = self.native.principal(NativeUnit(unit), token)
            owner, _, _, conn = self.credentials._native(unit, p)
            identity = stored_identity(unit, owner, p.vault_id, p.connection_id)
            return p, conn, identity

        return self.store.transact(read)

    def inspect(self, token):
        p, conn, identity = self._context(token)
        state = self.credentials.state(p.owner_uid, p.vault_id, p.connection_id)
        from .agent_client_assets import client_metadata

        lease = state["lease"]
        return {
            "contractVersion": CONTRACT_VERSION,
            "profile": "folioview.agent-credential.v1",
            "issuer": self.native.config.base.issuer,
            "provider": conn["provider"],
            "client": client_metadata(),
            "actor": {
                "ownerSubject": p.owner_subject,
                "vaultId": p.vault_id,
                "connectionId": p.connection_id,
                "clientId": p.client_id,
            },
            "credentialStatus": state["status"],
            "credentialExpiresAt": None if lease is None else lease["expiresAt"],
            "hostInstructions": (
                "Keep credentials only in this Agent's private persistent directory. "
                "Load the existing profile for every later task. If missing, corrupt, expired "
                "or rejected, stop and tell the user to authorize again in FolioView. "
                "Never print private keys, upload credentials, or silently replace active keys. "
                "Use the reviewed local client for PoP requests, local ciphertext decryption "
                "and Owner-encrypted reports. Native OAuth is bootstrap only."
            ),
        }

    def prepare(self, token):
        p = self._principal(token)
        setup = self.credentials.begin_setup(p)
        context = self.inspect(token)
        return {**context, "setup": setup, "ownerUrl": self.owner_url}

    def offer(self, token, intent, packet):
        p = self._principal(token)
        setup = self.credentials.put_offer(p, intent, packet)
        return {"setupIntentId": setup["setupIntentId"], "state": "awaiting_owner_approval"}

    def activation(self, token, intent):
        def read(unit):
            p = self.native.principal(NativeUnit(unit), token)
            owner, _, _, conn = self.credentials._native(unit, p)
            setup = self.credentials._setup(
                unit, intent, owner, p.vault_id, p.connection_id, conn, live=False
            )
            if setup["authorizationId"] != p.authorization_id:
                raise ContractError("key_authorization_required")
            operation = setup["consumedBy"]
            if operation is None:
                return {
                    "setupIntentId": intent,
                    "state": "awaiting_owner_approval",
                    "activation": None,
                }
            saved = unit.get(operation_path(owner, p.vault_id, operation))
            if saved is None:
                raise StoreUnavailable
            receipt = self.credentials._receipt(
                saved, owner, p.vault_id, p.connection_id, operation
            )
            current = stored_identity(unit, owner, p.vault_id, p.connection_id)
            if (
                current is None
                or current.get("credentialLease", {}).get("credentialFingerprint")
                != receipt["fingerprint"]
            ):
                raise ContractError("key_authorization_required")
            return {
                "setupIntentId": intent,
                "state": "approved",
                "activation": snapshot(saved["command"].get("activation")),
            }

        return self.store.transact(read)
