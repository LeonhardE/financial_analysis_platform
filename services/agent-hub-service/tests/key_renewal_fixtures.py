"""Synthetic successor owner keys and root-approved atomic renewal packets."""

import copy

from vault_lifecycle_fixtures import LifecycleFixture, archive_digest

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import jwk_thumbprint, signing_input_fingerprint
from folioview_shared.encrypted.jsonutil import b64url_decode, strict_json_loads

PROFILE = "folioview.vault-key-renewal.v1"
RENEW = "synthetic_key_renewal_0001"


class KeyRenewalFixture(LifecycleFixture):
    def renewal(
        self,
        state,
        operation=RENEW,
        *,
        roles=("device_sig", "device_enc", "recovery_enc"),
        now=1000,
        index=1,
        signer="root",
        **changes,
    ):
        original = copy.deepcopy(self.certificates)
        targets = []
        revoked = [n for n, c in original.items() if c["keyId"] in self.registry.revoked_key_ids]
        try:
            for role in roles:
                names = [
                    n
                    for n, c in original.items()
                    if c["role"] == role
                    and c["keyId"] in self.registry.active_key_ids
                    and c["keyEpoch"]
                    == self.registry.local_key_epochs[(c["principalId"], role, c["connectionId"])]
                ]
                old_name = names[0]
                old = original[old_name]
                name = f"renewed_{role}_{index}"
                new = self.add_key(name, role, old["principalId"], epoch=old["keyEpoch"] + 1)
                new["notBefore"] = now
                new["expiresAt"] = max(now + 3600, old["expiresAt"] + 3600)
                new["capabilities"] = copy.deepcopy(old["capabilities"])
                revoked.append(old_name)
                targets.append(
                    {
                        "role": role,
                        "principalId": old["principalId"],
                        "priorKeyId": old["keyId"],
                        "newKeyId": new["keyId"],
                        "priorKeyEpoch": old["keyEpoch"],
                        "newKeyEpoch": new["keyEpoch"],
                    }
                )
            targets.sort(key=lambda t: (t["role"], t["principalId"], t["priorKeyId"]))
            bundle = self.make_bundle(previous=self.registry, revoked=revoked, issued_at=now)
        finally:
            self.certificates = original
        archive = self.archive(state, index, rewrap=True)
        archive["prfSalt"] = state["archive"]["prfSalt"]
        archive_command = self.command(
            state,
            operation,
            "archive_replace",
            mode="rewrap",
            authorizationId=None,
            newArchiveDigest=archive_digest(archive),
            issuedAt=now,
            expiresAt=now + 200,
        )
        payload = {
            "profile": PROFILE,
            "contractVersion": CONTRACT_VERSION,
            "action": "key_renewal",
            "ownerSubject": self.owner,
            "vaultId": self.vault,
            "rootKeyId": self.root_id,
            "stableOperationId": operation,
            "expectedVaultVersion": state["vaultVersion"],
            "registrySequence": state["registrySequence"],
            "checkpointDigest": state["checkpointDigest"],
            "keyEpoch": state["keyEpoch"],
            "expectedLifecycleVersion": state["lifecycleVersion"],
            "expectedArchiveRevision": state["archiveRevision"],
            "expectedArchiveDigest": state["archiveDigest"],
            "newCheckpointDigest": archive_digest(
                strict_json_loads(b64url_decode(bundle["checkpoint"]["payload"]))
            ),
            "newArchiveDigest": archive_digest(archive),
            "archiveCommandFingerprint": signing_input_fingerprint(archive_command),
            "renewals": targets,
            "issuedAt": now,
            "expiresAt": now + 200,
        }
        payload.update(changes)
        return {
            "contractVersion": CONTRACT_VERSION,
            "registryBundle": bundle,
            "archive": archive,
            "command": self.sign(payload, signer),
            "archiveCommand": archive_command,
        }

    def adopt(self, body):
        next_registry = self.verify(body["registryBundle"], previous=self.registry, now=10**9)
        names = {c["keyId"]: n for n, c in self.certificates.items()}
        for name, key in self.keys.items():
            names[jwk_thumbprint(self.public(key))] = name
        # Use parsed public JSON so nested immutable maps/tuples never leak into fixtures.
        self.certificates = {
            names[(c := strict_json_loads(b64url_decode(e["certificate"]["payload"])))["keyId"]]: c
            for e in body["registryBundle"]["entries"]
        }
        self.registry = next_registry
