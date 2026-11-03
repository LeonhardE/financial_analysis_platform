"""Synthetic root-only upload cancellation inputs; keys remain in memory."""

import hashlib

from fixtures import OPERATION, HoldingsFixture

from app.upload_cancellations import PROFILE
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.jsonutil import canonical_json

CANCEL = "synthetic_upload_cancellation_0001"


class CancellationFixture(HoldingsFixture):
    def cancellation(
        self,
        *,
        cancellation=CANCEL,
        operation=OPERATION,
        snapshot="snapshot_1",
        revision=1,
        target=None,
        **overrides,
    ):
        carrier, _ = self.message(snapshot=snapshot, revision=revision, operation=operation)
        pending = {
            "snapshotId": snapshot,
            "operationId": operation,
            "authorKeyId": self.kid("device_sig"),
            "expectedRevision": revision - 1,
            "carrier": carrier,
            "source": {"resourceRef": self.resource, "sourceEpoch": 1},
        }
        selected = {
            "resourceRef": self.resource,
            "sourceEpoch": 1,
            "snapshotId": snapshot,
            "operationId": operation,
            "expectedRevision": revision - 1,
            "authorKeyId": self.kid("device_sig"),
            "envelopeFingerprint": signing_input_fingerprint(carrier["signedObject"]),
            "packetDigest": hashlib.sha256(canonical_json(pending)).hexdigest(),
        }
        if target is not None:
            selected.update(target)
        payload = {
            "artifactType": "holdings_upload_cancellation_intent",
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "ownerSubject": self.owner,
            "vaultId": self.vault,
            "rootKeyId": self.root_id,
            "rootEpoch": 1,
            "cancellationId": cancellation,
            "target": selected,
            **overrides,
        }
        return {"contractVersion": CONTRACT_VERSION, "command": self.sign(payload, "root")}, carrier
