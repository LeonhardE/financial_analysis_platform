# Cloud key archive removal and recovery

Settings offers a separate review of cloud key archive removal. The user must confirm that a
current independent recovery file and its separate code are saved before submitting. Removal
locks the workspace and removes only the server's Passkey-encrypted key archive. It preserves
the root identity, registry, encrypted holdings/tasks/results, receipts, approved devices,
Agent connections and independent recovery files. It does not erase existing copies or revoke
their access. The old Passkey alone cannot restore an absent cloud archive.

## Request and proof boundaries

Three fixed Google-owner BFF POST routes consume the released Hub producer:

- `archive-deletions`: the root-signed original removal, with its stable idempotency key.
- `archive-deletion-checks`: read-only check of that exact signed request; no idempotency key.
- `archive-deletion-withdrawals`: a new root-signed withdrawal bound to the original request's
  identifier, fingerprint and lifecycle version, with its own stable idempotency key.

The BFF forwards public root signatures only, without author-key selection or delegation.
Command bodies are bounded to 8 KiB; withdrawals are bounded to 24 KiB with each of their two
signed commands independently bounded to 8 KiB.

The crypto Worker independently verifies complete root-signed lifecycle history, registry pins,
archive digests and monotonically advancing local pins. A response claiming removal or
withdrawal is insufficient by itself. The controller also matches the check response to the
verified operation fingerprint, outcome and snapshot versions. A racing snapshot is reread
within a bounded retry. Missing receipts, timeouts, an expired command, forged null archives or
inconsistent snapshots never authorize local cleanup.

Before HTTP, one atomic IndexedDB transition retains the exact public signed removal request
and excludes unresolved device/Agent operations, source operations, upload outboxes and active
task drafts. The Worker drops content/private device/recovery material and retains root signing
only for withdrawal. Other tabs cannot stage another archive transition or write private
records. Once the archive binding advances, stale sessions cannot write using its predecessor.
Local device ciphertext is preserved by removal; deletion itself does not revoke device keys.

## Unknown outcomes

An unresolved request survives lock, logout, reload and response loss. The page offers read-only
checking, explicit retry of the original request and a separate withdrawal review. Checking and
ordinary rendering never start a Passkey prompt or automatically retry a mutation.

Withdrawal explicitly requests the original Passkey in a restricted Worker, retains the exact
withdrawal before HTTP and races the original deletion transaction. Once a withdrawal is
retained, retry sends that withdrawal only; it cannot switch back to removal. If deletion won,
the page shows the deleted-archive recovery state. If withdrawal won or a verified higher
fence superseded the original request, the page locks normally. Only verified terminal proof
and an exact saved-record comparison can remove the local pending request.

Lifecycle history remains bounded to 32 operations. Removal requires a version below 30,
reserving two slots for recovery authorization and replacement. Withdrawals consume one slot.
Exhausted history fails closed; the UI does not promise unlimited recovery retries.

## Independent recovery after removal

A null archive must have a verified signed removal history. It is distinct from a missing
library: ordinary unlock/create and content actions are hidden, and Settings exposes the
independent recovery form. Google login establishes the same owner but cannot recreate a root.

The recovery file and code are decrypted locally. The Worker checks owner/root, current recovery
certificate and saved pins, then the user creates and verifies a fresh Passkey. The restored
archive retains the same root and historical readers. It is saved through the existing
root-signed recovery authorization/replacement protocol. A new browser key still requires
explicit approval before access to the old encrypted resources; recovery never approves it.
Interrupted recovery retains its encrypted candidate and can resume with that new Passkey,
including when the cloud archive is still null. Verified cancellation preserves the null
archive and never discards an unresolved candidate on expiry alone.

## Validation and acceptance

Automated tests use synthetic keys/content, the actual Web Worker/bridge, an IndexedDB test
implementation and the released Hub Python services with SQLite. They cover removal/recovery
of holdings, tasks and results, explicit device registration, deletion/withdrawal races,
expiry, replay, forged history, two-tab fences and interrupted recovery completion/cancellation.
Transport and controller/UI tests cover fixed routes, lost replies, readonly checks, backup
confirmation, localization and account/session invalidation.

Native Passkey and remote failure-injection acceptance remain separate. Use a dedicated test
Google account/library with synthetic holdings: export a current recovery kit, review and
confirm removal in Settings, verify the removed state, restore with the file/code and a new
Passkey, explicitly approve the intended browser, then read the original synthetic holdings.
Do not remove the user's established library merely to smoke-test a deployment. Real recovery
files/codes stay with the user and must never be copied into tickets or logs.

This slice does not implement reset, historical-data rekey or revocation of exported material.
