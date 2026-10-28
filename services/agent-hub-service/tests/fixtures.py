"""Fresh synthetic root/owner keys and opaque archive fixtures; never real account data."""

import sys
from pathlib import Path

COMMON_TESTS = Path(__file__).resolve().parents[2] / "common" / "tests"
sys.path.insert(0, str(COMMON_TESTS))
from test_encrypted_authority import AuthorityFixture  # noqa: E402

from folioview_shared.encrypted.constants import CONTRACT_VERSION  # noqa: E402
from folioview_shared.encrypted.jsonutil import b64url_encode  # noqa: E402
from folioview_shared.identity import owner_key  # noqa: E402

UID = "synthetic_csv_owner_A"
OTHER_UID = "synthetic_csv_owner_B"
BOOT = "synthetic_vault_bootstrap_0001"
SOURCE = "holdings_csv_A"


class VaultFixture(AuthorityFixture):
    def __init__(self, uid=UID):
        super().__init__(owner=owner_key(uid), vault="vault_csv_A")
        self.uid = uid
        self.certificates = {
            name: value for name, value in self.certificates.items() if not name.startswith("A")
        }
        self.bundle = self.make_bundle()
        self.registry = self.verify(self.bundle)

    def bootstrap(self):
        return {
            "contractVersion": CONTRACT_VERSION,
            "vaultId": self.vault,
            "rootJwk": self.root_public,
            "rootKeyId": self.root_id,
            "registryBundle": self.bundle,
            "archive": {
                "profile": "folioview.passkey-vault.v1",
                "ownerSubject": self.owner,
                "vaultId": self.vault,
                "rootKeyId": self.root_id,
                "credentialId": b64url_encode(b"synthetic-credential"),
                "prfSalt": b64url_encode(b"s" * 32),
                "iv": b64url_encode(b"i" * 12),
                "ciphertext": b64url_encode(b"synthetic-opaque-ciphertext-block"),
            },
        }

    def control(self, source=SOURCE, operation="synthetic_source_create_0001", **changes):
        payload = self.base("control_command") | {
            "stableOperationId": operation,
            "action": "manual_source_create",
            "targetId": source,
            "expectedVersion": 0,
            "expectedSourceEpoch": None,
            "parameters": {},
            "registrySequence": self.registry.registry_sequence,
            "checkpointDigest": self.registry.checkpoint_digest,
            "keyEpoch": self.registry.key_epoch,
        }
        payload.update(changes)
        return {"contractVersion": CONTRACT_VERSION, "command": self.sign(payload)}
