# Persistent resource-consent producer

Agent Hub adopts the separate shared `folioview.persistent-resource-consent.v1`
profile. One aggregate belongs to an already enrolled stable Agent identity.
It grants no bearer, Run or envelope authority and does not enable background
execution. Old foreground grants remain unchanged and are not migrated.

All paths below start with `/api/v2/persistent-agents/{vault}/{connection}` and
require the ordinary authenticated owner, exact contract and no query/author or
delegation selectors. Writes use closed `{contractVersion, command}` JSON with
`Idempotency-Key` equal to the signed `stableOperationId`, bounded to 96 KiB before
shared signature/schema limits. The pinned root public key comes from the current
verified vault, never from the incoming command.

| Method and suffix                      | Result                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET `/resource-consent`                | Current public policy, ordered original operation IDs and effective parent-revoked status.              |
| POST `/resource-approvals`             | Fresh root-approved incremental current/future resource selections, optionally exact earlier revisions. |
| POST `/resource-revocations`           | Fresh root or certified owner-device narrowing of exact current permissions.                            |
| GET `/resource-operations/{operation}` | Immutable original policy result, signed command and originally observed public source states.          |

New approval requires `HUB_PERSISTENT_RESOURCE_CONSENTS_ENABLED=1`, identity
enrollment activation and valid existing preregistered Muse OAuth configuration.
It defaults off, and deployment does not change these flags. History, original
receipt checks and narrowing do not depend on approval activation or source
availability. Capabilities distinguish policy management from execution; the latter
remains false. No live user permission is created by deploying this code.

## Source and transactional authority

Only the existing trusted owner-scoped catalogue supplies source revision/incarnation/
epoch observations. There is no source-state input in the HTTP command. The service
captures vault/checkpoint/client context, reads producer state outside the transaction,
then rechecks that context and current identity, parent connection, policy CAS version/
digest and local reverse-invalidation fences inside the committing transaction.
Producer RPCs are never made from a retrying database callback.

A new selection's revision floor must exactly match the observed current committed
producer revision. Normal later versions need no policy mutation. The observation
is a source read, not a distributed lock on a later producer update. The local epoch
callback fences disconnect/deletion; actual ciphertext publication and Run freezing
must independently recheck producer versions, current consent and immutable evidence.
This endpoint alone does not prove that a historical ciphertext exists or is usable.

A new consent ID cannot reset an occupied slot. Revoked permission IDs remain terminal;
explicit reapproval needs a new permission ID while retaining the old tombstone.
Only selected permissions advance their epoch; other entries remain unchanged.
Aggregate version is CAS/audit metadata, not a global execution fence.

`hub_resource_consents` retains current policy, ordered operation IDs and independent
approval/revocation counts. `hub_resource_consent_operations` retains complete original
controls, observed public source state and original next-state receipts. State and
receipt commit atomically. Exact retries resolve before any source RPC, never
reapply an old action, and remain historical after revocation. A stale approval
cannot use a fresh operation or namespace to overwrite another CAS winner.

Capacity is bounded to 64 approvals and 32 revocation commands per identity. Approval
exhaustion cannot consume the narrowing budget. The shared contract permits only
32 retained permission IDs and each can be revoked once, so this reserve covers
every possible single-permission revocation. Tombstones and audit records are never
deleted to create capacity. Disconnecting the parent blocks all remaining permissions.

## Consumer responsibilities

Owner encrypting clients must independently verify and pin the root-approved original
control chain and corresponding root/checkpoint evidence. Current DTOs, digests and
server-observed source metadata are not substitute cryptographic authority. An
operation receipt is available separately to keep chain reads bounded.

The resource check is only one gate. Future execution consumers must authenticate
the Agent, apply current task/Run/scopes/expiry/source/delivery constraints, and reread
current consent and revocation fences in the same committing transaction. No legacy
`VerifiedGrant` is constructed here, and no content key is sent or decrypted.

Validation covers real root/device signature separation, SQLite and actual Firestore
SDK conflicts, operation collisions, parent/owner isolation, source outages and
invalidation, terminal revocation, unaffected-resource epochs and reserved narrowing
capacity. Tests use only synthetic identities and resources.
