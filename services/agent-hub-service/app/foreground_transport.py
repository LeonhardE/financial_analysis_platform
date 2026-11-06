"""Seal an existing OAuth bearer to its already root-approved foreground recipient.

The model receives ciphertext only. This does not mint a token, create a grant,
select a recipient, extend authority or decrypt user content.
"""

from jwcrypto import jwe, jwk

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json

from .preparations import PreparationService

PROFILE = "folioview.foreground-transport.v1"
EXTENDED_PROFILE = "folioview.foreground-transport.v2"
HANDOFF_SECONDS = {PROFILE: 60, EXTENDED_PROFILE: 300}
TYPE = "fv-foreground-transport+jwe"
MAX_BYTES = 8192


class ForegroundTransportService:
    def __init__(self, oauth):
        self.oauth, self.store = oauth, oauth.store
        self.preparations = PreparationService(oauth)

    def seal(self, token, task_id, *, profile=PROFILE):
        if profile not in HANDOFF_SECONDS:
            raise ContractError("malformed_request")
        # Read producer/source authority before the transaction, then compare
        # the exact snapshot against fresh token, task, grant and registry state.
        before = self.preparations.metadata(token, task_id)

        def read(unit):
            principal, prepared = self.preparations._agent(unit, token, task_id=task_id)
            state = self.preparations._authority(
                unit, principal.owner_uid, principal.connection_id, task_id
            )
            conn, grant, vault, registry, metadata = state
            self.preparations._stored(
                prepared, principal.owner_subject, prepared["preparationId"], state
            )
            if (
                before["preparationId"] != prepared["preparationId"]
                or before["taskMetadata"] != metadata
                or before["registryProofs"][-1]["registrySequence"] != registry.registry_sequence
                or before["keyEpoch"] != registry.key_epoch
            ):
                raise ContractError("version_conflict")
            recipient_id = grant["agentEncryptionKeyId"]
            recipient = registry.certificates[recipient_id]["publicJwk"]
            now = self.oauth.now()
            expires = min(
                now + HANDOFF_SECONDS[profile],
                principal.expires_at,
                grant["expiresAt"],
                conn["expiresAt"],
            )
            if expires <= now:
                raise ContractError("insufficient_scope")
            value = {
                "profile": profile,
                "contractVersion": CONTRACT_VERSION,
                "issuer": self.oauth.config.issuer,
                "ownerSubject": principal.owner_subject,
                "vaultId": vault["vaultId"],
                "rootKeyId": vault["rootKeyId"],
                "connectionId": principal.connection_id,
                "authorizationId": principal.authorization_id,
                "clientId": principal.client_id,
                "taskId": task_id,
                "preparationId": prepared["preparationId"],
                "grantId": grant["grantId"],
                "grantEpoch": grant["grantEpoch"],
                "executionEpoch": grant["executionEpoch"],
                "keyEpoch": registry.key_epoch,
                "agentEncryptionKeyId": recipient_id,
                "issuedAt": now,
                "expiresAt": expires,
                "accessToken": token,
            }
            header = {
                "alg": "ECDH-ES+A256KW",
                "enc": "A256GCM",
                "typ": TYPE,
                "cty": "application/json",
                "kid": recipient_id,
            }
            message = jwe.JWE(
                canonical_json(value),
                protected=canonical_json(header).decode(),
                recipient=jwk.JWK(**recipient),
                algs=["ECDH-ES+A256KW", "A256GCM"],
            )
            credential = message.serialize(compact=True)
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": profile,
                "taskId": task_id,
                "connectionId": principal.connection_id,
                "preparationId": prepared["preparationId"],
                "credential": credential,
            }
            if len(canonical_json(result)) > MAX_BYTES:
                raise ContractError("payload_too_large")
            return result

        return self.store.transact(read)
