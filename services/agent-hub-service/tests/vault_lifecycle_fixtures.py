"""Synthetic owner-root lifecycle commands; no browser or real Passkey claim."""

import copy
import hashlib

from fixtures import VaultFixture

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)

PROFILE = "folioview.vault-lifecycle.v1"


def archive_digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


class LifecycleFixture(VaultFixture):
    def archive(self, state, index=1, *, rewrap=False):
        old = state["archive"]
        return {
            **copy.deepcopy(old),
            "credentialId": old["credentialId"]
            if rewrap
            else b64url_encode(f"synthetic-replacement-credential-{index}".encode()),
            "prfSalt": b64url_encode(bytes([index % 250 + 1]) * 32),
            "iv": b64url_encode(index.to_bytes(12, "big")),
            "ciphertext": b64url_encode(f"synthetic-new-opaque-archive-{index:04}".encode()),
        }

    def command(self, state, operation, action, *, signer="root", **changes):
        payload = {
            "profile": PROFILE,
            "contractVersion": CONTRACT_VERSION,
            "action": action,
            "ownerSubject": self.owner,
            "vaultId": self.vault,
            "rootKeyId": self.root_id,
            "stableOperationId": operation,
            "expectedVaultVersion": state["vaultVersion"],
            "expectedLifecycleVersion": state["lifecycleVersion"],
            "expectedArchiveRevision": state["archiveRevision"],
            "expectedArchiveDigest": state["archiveDigest"],
            "registrySequence": state["registrySequence"],
            "checkpointDigest": state["checkpointDigest"],
            "keyEpoch": state["keyEpoch"],
            "issuedAt": 1000,
            "expiresAt": 1200,
        }
        payload.update(changes)
        return self.sign(payload, signer)

    def replace(
        self,
        state,
        operation="synthetic_archive_replace_0001",
        *,
        archive=None,
        mode="passkey_change",
        authorization=None,
        signer="root",
        **changes,
    ):
        archive = self.archive(state, rewrap=mode == "rewrap") if archive is None else archive
        payload = {
            "mode": mode,
            "newArchiveDigest": archive_digest(archive),
            "authorizationId": authorization,
            **changes,
        }
        return {
            "contractVersion": CONTRACT_VERSION,
            "archive": archive,
            "command": self.command(state, operation, "archive_replace", signer=signer, **payload),
        }

    def authorize(
        self,
        state,
        archive,
        operation="synthetic_recovery_authorize_0001",
        *,
        authorization="recovery_authorization_A",
        **changes,
    ):
        return {
            "contractVersion": CONTRACT_VERSION,
            "command": self.command(
                state,
                operation,
                "recovery_authorize",
                authorizationId=authorization,
                newArchiveDigest=archive_digest(archive),
                **changes,
            ),
        }

    def revoke(
        self,
        state,
        authorization="recovery_authorization_A",
        operation="synthetic_recovery_revoke_0001",
        **changes,
    ):
        return {
            "contractVersion": CONTRACT_VERSION,
            "command": self.command(
                state, operation, "recovery_revoke", authorizationId=authorization, **changes
            ),
        }

    def delete(self, state, operation="synthetic_archive_delete_0001", **changes):
        return {
            "contractVersion": CONTRACT_VERSION,
            "command": self.command(
                state, operation, changes.pop("action", "archive_delete"), **changes
            ),
        }

    def withdraw(self, state, deletion, operation="synthetic_deletion_withdraw_0001", **changes):
        original = strict_json_loads(b64url_decode(deletion["command"]["payload"]))
        return {
            "contractVersion": CONTRACT_VERSION,
            "deletionCommand": deletion["command"],
            "command": self.command(
                state,
                operation,
                "archive_delete_withdraw",
                deletionOperationId=original["stableOperationId"],
                deletionCommandFingerprint=signing_input_fingerprint(deletion["command"]),
                deletionLifecycleVersion=original["expectedLifecycleVersion"],
                **changes,
            ),
        }
