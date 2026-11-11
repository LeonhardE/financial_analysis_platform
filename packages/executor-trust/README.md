# Retired independent executor trust package

The Policy/TEE executor route and its consumers are retired. This directory retains
its entry point and required [third-party notices](THIRD_PARTY_NOTICES.md); it no longer
contains an installable package, verifier, build script or distribution.

Current personal Agent credentials use the existing
[encrypted workspace contract](../encrypted-workspace/README.md) and
[90-day credential profile](../../services/common/folioview_shared/encrypted/docs/agent-credentials.md).
Original public protocol snapshots and validation evidence are archived locally and
remain in Git history. Generic historical identity, content, revocation and receipt
formats remain supported; this retirement does not delete user ciphertext or cloud resources.
