"""Fresh in-memory synthetic JOSE fixtures shared with foundation conformance tests."""

import copy
import sys
from pathlib import Path

COMMON_TESTS = Path(__file__).resolve().parents[2] / "common" / "tests"
sys.path.insert(0, str(COMMON_TESTS))
from test_encrypted_envelope import EnvelopeFixture  # noqa: E402

from folioview_shared.encrypted.constants import CONTRACT_VERSION  # noqa: E402
from folioview_shared.identity import owner_key  # noqa: E402

SOURCE = "holdings_A"
UID = "synthetic_owner_A"
OTHER_UID = "synthetic_owner_B"
OPERATION = "synthetic_operation_000001"


class HoldingsFixture(EnvelopeFixture):
    def __init__(self, uid=UID):
        super().__init__(owner=owner_key(uid))
        self.uid = uid

    def install(self, service, *, version=0, active=True, epoch=1, bundle=None, writer=None):
        return service.install_authority(
            self.uid,
            SOURCE,
            expected_version=version,
            vault_id=self.vault,
            root_jwk=self.root_public,
            bundle=bundle if bundle is not None else self.bundle,
            resource_ref=self.resource,
            source_epoch=epoch,
            writer_key_ids=sorted([self.kid(writer or "device_sig")]),
            recipient_key_ids=sorted([self.kid("device_enc"), self.kid("recovery_enc")]),
            active=active,
        )

    def message(self, *, snapshot="snapshot_1", revision=1, operation=OPERATION, writer=None):
        context = self.context("holdings_snapshot")
        context.update(
            objectId=snapshot,
            revision=revision,
            expectedRevision=revision - 1,
            stableOperationId=operation,
        )
        if writer:
            context["authorSigningKeyId"] = self.kid(writer)
        context["binding"]["sourceRevision"] = revision
        return self.carrier(context, signer=writer), context

    def write(
        self,
        service,
        *,
        snapshot="snapshot_1",
        revision=1,
        operation=OPERATION,
        carrier=None,
        writer=None,
    ):
        if carrier is None:
            carrier, _ = self.message(
                snapshot=snapshot, revision=revision, operation=operation, writer=writer
            )
        return service.commit(
            self.uid,
            SOURCE,
            snapshot,
            expected_revision=revision - 1,
            writer_key_id=self.kid(writer or "device_sig"),
            operation_id=operation,
            carrier=copy.deepcopy(carrier),
            contract_header=CONTRACT_VERSION,
        )
