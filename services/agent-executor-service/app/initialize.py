"""One-shot, explicitly enabled measured creation entry point; never a runtime fallback."""

import os

from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads

from .attestation import CreationAttestation
from .contracts import require
from .provision import EnrollmentObjects, KeyWrapper, initialize
from .state import GCSSnapshots


def main():
    from pathlib import Path

    require(os.environ.get("EXECUTOR_CREATION_ENABLED") == "1")
    require(os.environ.get("EXECUTOR_ENABLED", "0") == "0")

    # This public material is mounted/fetched by the separately reviewed creation
    # workflow. Root is pinned independently in its measured environment.
    def read(name):
        with Path(os.environ[name]).open("rb") as f:
            return strict_json_loads(f.read(65537), max_bytes=65536)

    draft, permit, root = read("EXECUTOR_DRAFT"), read("EXECUTOR_PERMIT"), read("EXECUTOR_ROOT_JWK")
    attestation = CreationAttestation(draft["issuer"])
    try:
        result = initialize(
            draft,
            permit,
            root_jwk=root,
            enrollment_objects=EnrollmentObjects(draft["snapshotBucket"]),
            snapshots=GCSSnapshots(draft["snapshotBucket"]),
            wrapper=KeyWrapper(draft["kmsRecoveryKey"]),
            attestation=attestation,
        )
        print(canonical_json(result).decode())
    finally:
        attestation.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Executor unavailable.") from None
