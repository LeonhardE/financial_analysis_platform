# Policy Owner administrator preparation

This root owns only Policy's independent execution lane and infrastructure access.
Default `enabled=false` means no resources or grants. It is not registered in the
ordinary operator catalog. The workload root stays at `envs/prod/agent-policy`.
Never run it as the lane's plan/apply identities or reuse prototype state/keys.

Before future use, select an independently controlled billed Policy project,
existing regional source connection and an already-created Owner-only remote
administrator backend (the synthetic backend example is not a bootstrap command).
Project creation, billing, API readiness, backend bootstrap and budget approval are
separate explicit administrator events, not side effects of a source merge.
Use complete saved plans reviewed by the Owner; no empty local state or `-target`.

Prepare `enabled=true` with execution/workload/actAs gates off first. Separately
review the custom workload metadata-read/apply roles and enable workload access
before a resources-only workload plan. The apply role can create the selected
project's resources and update project IAM, so it is a trusted Owner administrator
within that dedicated project. It is not resistant to a malicious Owner; restrict
actual submit/actAs/approval rights and never grant routine Hub/executor operators
access to this identity. It has no direct content sign/decrypt, object data read,
database entity read, Cloud Build submit/trigger edit or token minting permission.

After the actual runtime account exists, separately enable exact runtime actAs
before Cloud Run base provisioning. A canonical public lane contract must pass
`owner_lane.py inspect` against the workload's closed source schema. Actual
trigger metadata pins that contract; a caller cannot substitute a variable file.
Only then may a separate full administrator plan explicitly enable execution.
The workload still keeps issuance/release/public invocation off until its own
independent Root and identity gates pass. Root bootstrap/enrollment are never
performed by this root. Keep execution off during preparation-only work.

Validate with pinned `init -backend=false -lockfile=readonly`, `validate` and
provider-mocked `test`. Actual IAM inheritance, custom-role permission support,
protected-lane behavior and recovery require later authorized cloud evidence.
See [lane contract](../../../docs/owner-lane.md) and
[Policy deployment](../../envs/prod/agent-policy/README.md).
