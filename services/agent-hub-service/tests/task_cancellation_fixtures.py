"""Synthetic, fully bound root commands for one original PendingTask."""

import copy
import hashlib

from test_task_operations import OperationFixture
from test_tasks import OP, TASK

from app.task_upload_cancellations import PROFILE
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.jsonutil import canonical_json

CANCEL = "synthetic_task_cancellation_0001"


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


class CancellationFixture(OperationFixture):
    def target(self, body, *, task=TASK, operation=OP, mode="create", author="device_sig"):
        fingerprint = signing_input_fingerprint(body["envelope"]["signedObject"])
        return {
            "taskId": task,
            "operationId": operation,
            "mode": mode,
            "expectedVersion": body["expectedVersion"],
            "authorKeyId": self.kid(author),
            "envelopeFingerprint": fingerprint,
            "requestFingerprint": digest(
                {
                    "mode": mode,
                    "taskId": task,
                    "expectedVersion": body["expectedVersion"],
                    "resourceBindings": body["resourceBindings"],
                    "envelopeFingerprint": fingerprint,
                    "transitionFingerprint": signing_input_fingerprint(body["transitionIntent"])
                    if mode == "transition"
                    else None,
                    "authorKeyId": self.kid(author),
                }
            ),
            "packetDigest": digest(
                {
                    "taskId": task,
                    "operationId": operation,
                    "mode": mode,
                    "body": body,
                    "authorKeyId": self.kid(author),
                }
            ),
        }

    def cancellation(self, target, cancellation=CANCEL, *, signer="root", **changes):
        payload = {
            "artifactType": "task_upload_cancellation_intent",
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "ownerSubject": self.owner,
            "vaultId": self.vault,
            "rootKeyId": self.root_id,
            "rootEpoch": 1,
            "cancellationId": cancellation,
            "target": copy.deepcopy(target),
        }
        payload.update(changes)
        return {"contractVersion": CONTRACT_VERSION, "command": self.sign(payload, signer)}
