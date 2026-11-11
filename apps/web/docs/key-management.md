# Owner keys and recovery

Settings uses the same owner Worker and shared login unlock as Resources, Tasks, Agents and
Inbox. Google identity does not derive content keys. Passkey replacement, operational renewal
and archive removal are explicit transitions; required post-transition verification is distinct
from an unexpected repeated-unlock bug. See the [Hub producer](../../../services/agent-hub-service/docs/key-management.md).

First-use device approval, current certified writer checks and encrypted original outboxes remain
independent safeguards. Device revocation does not revoke a Passkey or recall disclosed data.

New holdings snapshots and tasks select only currently valid, unrevoked Owner device and
recovery recipients. Public Agent history may contain expired certificates; those unrelated
entries do not block Owner-only encryption and are never added as recipients. The current
writer and the required device/recovery recipients must still be eligible. Historical public
records remain intact and cannot make an expired or revoked credential valid again.

## Passkey replacement

The Web client consumes the Hub-owned `folioview.vault-lifecycle.v1` API through
explicit, bounded owner BFF routes. Google login establishes the owner. Root signatures approve
archive changes. The service receives public bindings, signatures and ciphertext only.

Cloud archive removal and its three fixed routes are documented below.

### Passkey replacement: User flows

Settings → encrypted library offers three separate operations:

- Verify that the current Passkey still opens the existing library.
- Create and confirm a new Passkey, then replace the encrypted key archive. The original root,
  recovery and eligible local device keys are retained. The library locks after success; the user
  unlocks using the new Passkey. Credentials in a password manager are never deleted automatically.
- Export an independent encrypted recovery file and a separate random recovery code. Store them
  separately. While locked, the same Google owner can import both, create and confirm a new
  Passkey, and approve the exact archive replacement. A new device needs explicit registration
  before writing; recovery does not revive revoked devices or agent grants.

Replacement uses a fresh opaque WebAuthn user handle to avoid overwriting the old discoverable
credential before the encrypted archive is saved. A second assertion against the exact new
credential verifies its PRF before a signed change is prepared. Browser PRF buffers are cleared
and secrets are transferred to the existing isolated Worker.

Private JWKs stay in the Worker. Recovery files use AES-GCM with a random 256-bit recovery code,
not a user-chosen password. Public owner/vault/root bindings and saved registry/lifecycle pins
are authenticated as associated data. Neither the code nor plaintext key material is sent to
the BFF, stored in IndexedDB or put in logs. The code is transient user-visible export material;
locking, logout and account changes remove it from the UI and terminate private sessions.
JavaScript strings cannot promise physical erasure from browser memory.

### Passkey replacement: Durable operations and local state

Before sending any archive mutation, retain the exact signed request and encrypted candidate in
IndexedDB. A routine replacement retains a candidate sealed under both old and new PRF material;
independent recovery can use only the new PRF. If the browser reloads while the server still has
the old archive, the unfinished-update action verifies the candidate's root signature before
requesting the new Passkey. Retries reuse the original operation, ciphertext and authorization.

Read the original receipt and the current signed lifecycle history before promoting a candidate.
A receipt for an earlier operation never authorizes reinstalling its archive over a later one.
Pin the complete signed-input fingerprint prefix and archive boundary, so authorization-only
forks and deletion of known history fail closed. Ordinary vault acceptance remains archive-strict.

The current device's encrypted key seal is rewrapped while preserving its identifiers. Unresolved
PRF-encrypted device operations, agent operations and task drafts block a new replacement; finish
or explicitly discard them using their existing workflows first. They are never silently deleted.
An atomic IndexedDB fence prevents other tabs from creating private records during a transition;
the persisted archive binding rejects writes from sessions using the previous Passkey afterward.
Public ciphertext outboxes do not need PRF rewrapping.

### Passkey replacement: Limits

Changing a Passkey does not change the root or re-encrypt all historical resources. Anyone who
already retained an old archive and its working Passkey, or an independent recovery file and
code, may still possess the same root. Root renewal, historical-data rekey and cryptographic
revocation of exported recovery material need separate contracts and are not represented as done.

Recovery requires an existing independent root-capable copy. Google login, an administrator or
an authorization identifier cannot recreate a lost private root. Recovery files do not back up
local task drafts or pending agent/device operations. Their pins establish a minimum known state;
a new device cannot detect every complete backend rollback after that saved point.

The producer retains at most 32 lifecycle operations and recovery approval lasts at most five
minutes. Unknown outcomes retain the original request. Expiry alone is not a safe reason to erase
an unresolved operation or generate a replacement request. Explicit cancellation first revokes
the matching approval, or signs an authorization/revocation witness pair that advances the
server's lifecycle without changing the archive. Only a verified higher-version history that
excludes the original operation permits deleting its local candidate. Cancellation requests are
retained before HTTP as well. Capacity is reserved before starting a new change; an exhausted
history or bounded cancellation-attempt budget fails closed and preserves the encrypted packet.

The opaque replacement handle follows the authenticator's discoverable-credential mapping in
the [WebAuthn specification](https://www.w3.org/TR/webauthn-3/).

Automated checks use synthetic resources and simulated authenticator material. Native
Passkey compatibility, real recovery and cloud identity acceptance remain separate evidence.

## Operational renewal

Settings → Library keys and devices offers explicit review, renewal, original-receipt recovery
and cancellation. It consumes the Hub's fixed owner endpoints through the existing same-origin
BFF. Google identity remains separate from Passkey content-key access. No cloud configuration,
shared schema, new service or dependency is needed.

### Operational renewal: Crypto and retained history

The outer `folioview.passkey-vault.v1` archive keeps its existing exact public shape. The Worker
accepts the legacy five-field Master and the versioned `folioview.historical-keyring.v1` plaintext
inside that encrypted archive. New generations retain the old recovery and local device private
material; every retained key must match a root-signed certificate of the same owner, vault, role
and principal. The existing archive byte limit and bounded key/history counts fail closed.

New operational device and recovery keys are random fresh keys with higher local epochs. The
pinned root, content key epoch, protecting Passkey credential and PRF salt stay unchanged. A new
archive IV/ciphertext is required and decrypt-tested before root approval. Ordinary current
writes use the new active keys. Historical reads still verify the original signed object,
recipient scope, certificate validity at its original time and accepted evidence; retaining a
private reader does not grant current signing or agent authority.

Recovery kits exported after renewal include the retained keyring. Export a fresh independent
recovery kit after renewing: an older kit does not contain the new private keys and cannot
recover newer content. A stale kit must not replace the current archive. Keep prior recovery
materials under the owner's control until the replacement kit is safely retained.

### Operational renewal: Expired certificates and restricted sessions

An explicit Passkey operation can open a renewal-only session even if the registered browser's
operational certificates have expired. Worker and bridge both deny ordinary content access,
drafts, device changes and agent operations in this mode. The owner reviews the eligible local
pair and recovery certificate, then confirms one root-approved successor directory/archive.
Revoked or superseded keys never become eligible merely because the owner unlocks a Passkey.

The resulting registry, archive and original receipt must be verified before local promotion.
Promotion commits device seal, registry pin, lifecycle pin and pending deletion atomically, then
terminates the Worker. The user unlocks again with the same Passkey to continue. Expiration alone
never removes the registered local identity needed to retry renewal.

### Operational renewal: Outbox, races and cancellation

The candidate is AES-GCM sealed using a Worker-only, domain-separated HKDF key derived from the
root secret and bound to owner/vault/root/operation. Its inner archive and device private keys
remain PRF-encrypted. Only public packets and ciphertext leave the Worker. This pending seal can
be reopened after a legitimate Passkey replacement while the root remains the same; it does not
authorize reinstalling an older archive.

Original candidate bytes and operation IDs survive lock, logout, lost HTTP responses and reload.
The client checks the original receipt before resubmission. A cancellation submits a root-signed
archive rewrap with the original version fences, so renewal or cancellation can win the race.
The client retains its candidate until the signed history proves the outcome. Conflicted
candidates can be removed only after that proof. A stop button terminates memory while retaining
the encrypted pending request.

IndexedDB transactions fence competing tabs, archive changes and ordinary pending writes. The
archive IV is included in the local binding so stale tabs are rejected even when the credential
and PRF salt remain the same. Owner/session generations prevent late replies from returning data
or promoting keys after lock, logout or account change.

### Operational renewal: Current limits and acceptance

- Renewal needs this browser's previously registered device identity. A clean browser does not
  silently adopt another device's identity. Separate enrollment/recovery remains explicit.
- Resolve pending uploads and device/agent/archive changes before renewing. Drafts stay encrypted.
  The renewal review can check a holdings upload after its certificates expire: authenticated GETs
  read the original operation receipt and exact saved snapshot, then the Worker verifies owner,
  source, operation, complete carrier and root-trusted historical proofs at the saved time.
  Review does not decrypt or delete anything. A separate confirmation rereads the evidence and
  atomically clears only the unchanged local retry row. The saved snapshot stays on the server.
  Lock, account changes, competing archive/renewal changes and packet replacements fence cleanup.
  Missing receipts/snapshots and unknown results preserve the original packet and block renewal;
  a 404 is not a cancellation fence. This path never resubmits, resigns or re-encrypts an upload.
  Task uploads have the corresponding original-receipt and historical-proof reconciliation
  described below. Sources no longer returned by the current
  owner catalogue remain blocked rather than being recreated or silently discarded.
- Agent grants are not automatically reauthorized. Changed/revoked recipient keys can require
  fresh explicit consent.
- Root replacement, reset/delete, pruning history and historical content rekey remain separately
  scoped. Renewal does not recall old copies or plaintext already released.

Synthetic coverage executes WebCrypto, the production Worker dispatch, IndexedDB transactions,
controllers and fixed BFF contracts. Local actual-Hub SQLite fixtures verify producer acceptance
and old holdings/tasks/reports after multiple renewals. Physical Passkey/PRF providers, native
renewal acceptance and production IAM remain separate; unsupported providers still fail closed.

## Cloud archive removal

Settings offers a separate review of cloud key archive removal. The user must confirm that a
current independent recovery file and its separate code are saved before submitting. Removal
locks the workspace and removes only the server's Passkey-encrypted key archive. It preserves
the root identity, registry, encrypted holdings/tasks/results, receipts, approved devices,
Agent connections and independent recovery files. It does not erase existing copies or revoke
their access. The old Passkey alone cannot restore an absent cloud archive.

### Cloud archive removal: Request and proof boundaries

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

### Cloud archive removal: Unknown outcomes

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

### Cloud archive removal: Independent recovery after removal

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

### Cloud archive removal: Validation and acceptance

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

Reset, historical-data rekey and revocation of exported material require separate contracts.

## Device review and trust

A new browser first opens read-only and requires explicit approval before its public keys are
registered for writes. Revoked local keys are never reactivated; reauthorization creates a new
principal/pair. Current Passkey possession carries Root authority, so removing a device key does
not revoke that Passkey or erase a computer.

Settings displays public fingerprints and certificate eligibility, with explicit review before
rotation/revocation. Seal the exact candidate and Root-signed registry packet before sending.
Unknown outcomes retain original bytes. An unchanged-version read is not proof of cancellation;
an applied proposal promotes its matching seal before cleanup, and a conflicting later version
must be verified. Enrollment and device changes share atomic cross-tab fences. Retained
historical readers do not automatically grant new write rights or reauthorize Agent recipients.

The separate current-Passkey check opens a short-lived Worker, tests existing Root/recovery
signing and ECDH, and returns public facts only. It does not register a device or substitute for
an independent recovery kit. Unsupported PRF providers fail closed. Trust failures lock private
consumers; owner/session/vault generations reject late replies.

## Task upload reconciliation during renewal

The restricted key-renewal view can check task uploads using the owner's original-operation GET.
It authenticates the old public packet and historical saved `EncryptedTask` inside the Worker,
including transition intent/status/execution epoch, without decrypting or re-signing content.
Missing or invalid evidence never triggers a write replay, a latest-version fallback or local cleanup.

A separate explicit confirmation rereads the trusted directory and exact original result before
replacing only the matching local outbox row with a revision-advanced tombstone. The transaction
compares the complete row, archive context and session cancellation, so another tab's newer packet
or lock/account change cannot be overwritten. Server tasks and local encrypted drafts stay intact.
Checks operate one task at a time and remain available without Portfolio. Other pending uploads
or key/device/agent changes still block renewal through their existing guards. Ordinary task cleanup
cannot bypass this restricted flow. The original Google account and Passkey are reused.

Task reconciliation uses the Hub original-task-operation API and does not change broker
connections, cloud permission or Muse activation.
Synthetic expired-certificate checks do not require changing live credentials or their expiry.

## Safe cancellation of unknown uploads during renewal

An owner with expired operational certificates can separately review and confirm cancellation of one
unknown task or holdings upload in the restricted renewal view. The Root signs only a permanent deny
for the exact original encrypted request; this grants no device write authority and never decrypts
content. Browser admission and both owner BFFs allow only the fixed producer-owned cancellation
routes, closed 8 KiB commands and original idempotency key. Portfolio still uses the Web workload's
separate server identity.

The signed cancellation and complete original encrypted outbox row are atomically persisted before
submission. Reload and lost acknowledgements resume the identical command. A cancellation receipt
must match the Root command, owner, vault, complete target and fingerprints. If cancellation won,
local cleanup uses an atomic full-row comparison; task outboxes receive a revision tombstone and
holdings outboxes are removed. A newer tab's upload survives and continues blocking renewal. If the
upload won, the original saved encrypted result must additionally pass historical signature checks
before cleanup. A missing, hidden or deleted original result preserves both local requests and keeps
renewal blocked; cancellation never deletes already saved server data.

Each producer retains at most 32 permanent cancellation decisions per owner/vault. Exact retries
reuse their slot; capacity, missing receipts, corruption, lock/account changes and stale archive
bindings retain the original requests. Cancellation does not expire, prune old fences, reset the
vault, revoke the Root, reactivate sources, or enable Muse. This Web slice depends on the separately
merged Hub and Portfolio cancellation producer PRs. Physical device acceptance remains separate
from synthetic expired-certificate and interrupted-network verification.
