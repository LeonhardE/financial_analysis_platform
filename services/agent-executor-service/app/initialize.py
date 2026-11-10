"""One-shot, explicitly enabled measured creation entry point; never a runtime fallback."""

import os
import time

from folioview_shared.encrypted.jsonutil import canonical_json

from .attestation import CreationAttestation
from .contracts import require
from .provision import EnrollmentObjects, KeyWrapper, initialize
from .public_config import measured_sources, pin_root, read_public, remote
from .state import GCSSnapshots


def main():
    require(os.environ.get("EXECUTOR_CREATION_ENABLED") == "1")
    require(os.environ.get("EXECUTOR_ENABLED", "0") == "0")
    require(os.environ.get("EXECUTOR_NATIVE_ENABLED", "0") == "0")
    require("K_SERVICE" not in os.environ and "FIRESTORE_EMULATOR_HOST" not in os.environ)

    # This public material is mounted/fetched by the separately reviewed creation
    # workflow. Root is pinned independently in its measured environment.
    names = ["EXECUTOR_DRAFT", "EXECUTOR_PERMIT", "EXECUTOR_ROOT_JWK"]
    draft, permit, root = (read_public(name) for name in names)
    pin_root(root, required=any(remote(name) for name in names))
    measured_sources(draft["creationWorkload"], names)
    attestation = CreationAttestation(draft["issuer"])
    pending = None
    try:
        objects = EnrollmentObjects(draft["snapshotBucket"])
        pending = initialize(
            draft,
            permit,
            root_jwk=root,
            enrollment_objects=objects,
            snapshots=GCSSnapshots(draft["snapshotBucket"]),
            wrapper=KeyWrapper(draft["kmsRecoveryKey"]),
            attestation=attestation,
        )
        print(canonical_json(pending.summary()).decode(), flush=True)
        wait = os.environ.get("EXECUTOR_CREATION_WAIT_SECONDS", "600")
        require(wait.isdigit() and 1 <= int(wait) <= 1800)
        deadline = time.monotonic() + int(wait)
        while time.monotonic() < deadline:
            command = objects.read(pending.identity + "-finalization")
            if command is not None:
                print(canonical_json(pending.finalize(command)).decode(), flush=True)
                return
            time.sleep(2)
        require(False)
    finally:
        if pending is not None:
            pending.stop()
        attestation.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Executor unavailable.") from None
