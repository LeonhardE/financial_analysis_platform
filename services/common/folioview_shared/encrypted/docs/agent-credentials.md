# Agent-owned credential leases

The additive `folioview.agent-credential.v1` profile places a bounded Owner-approved
lease over an immutable `folioview.persistent-agent-identity.v1` binding. It does
not widen the old binding's create-only semantics or authorize any financial
operation by itself. Default duration is 7,776,000 seconds (90 days), maximum is
90 days, and the notice window is 604,800 seconds (7 days). Shorter explicitly
approved lifetimes support controlled acceptance; existing OAuth access-token
refresh is independent of this lifetime.

`approve_credential` / browser `approveCredential` verify the current Root registry,
an authorized Owner device signature, exact identity, audience, setup intent,
previous credential fingerprint, next generation, distinct new Agent identity and
signing/encryption keys, freshness and key-certificate expiry. Generation one
requires an unused logical connection slot. Reauthorization of an existing slot
requires its current record, even when expired or revoked. Never delete that
record to obtain generation one again. Fresh keys are necessary for recovery;
renewal cannot be signed by the Agent itself.

The consumer must independently verify the Owner's identity binding and trusted
first-key handoff. A recommended closed handoff is a reviewed host helper with
separate signing/encryption keys and a random 256-bit pairing secret. The native
OAuth context fixes client/connection/Owner and a short-lived, single-use intent.
The helper encrypts its public-key offer to that secret; the Owner receives the
secret through the authorization URL fragment, decrypts the offer locally, then
certifies those exact keys after Passkey unlock. The server never receives the
fragment secret or private keys. The Owner response, including independently
pinned Root/checkpoint and signed binding, is encrypted back to the same secret.
The helper checks the returned offer/intent/context before persisting activation.
Public-key transcription by a model, a supplied `verified` flag, or an unsigned
server key offer must not substitute for this handoff. This assumes trusted host
helper distribution and an authenticated native authorization context; it is not
hardware attestation or protection from a compromised Agent host.

Replacement must be one transaction: compare current generation/fingerprint,
consume the exact intent, archive the old identity/binding/lease, install the new
lease and return an immutable operation receipt. Preparation failure leaves the
old record intact. Exact retries return the original receipt, without restoring
that credential as current. A concurrent different replacement loses the CAS.
Do not erase revocation high-water marks, consent history or operation receipts.
A new identity needs new Owner-approved content/task grants and ciphertext;
old grants must not transfer merely because the connection ID is unchanged.

Every session, request and final Run write must resolve the authoritative current
lease and exact identity again, enforce expiry, audience and live connection,
and retain existing PoP, resource/task/action, source epoch and replay checks.
Never trust a cached lease or generation claimed by a request. Revocation cannot
erase plaintext or ciphertext already delivered. Owner-only historical reports
remain readable without an old Agent private key.

The UI needs only connection status, expiry/notice and one reauthorization entry.
A missing private file is observable by the host helper on its next execution;
an unauthenticated failure cannot change a server connection's state. Never issue
replacement credentials automatically on a missing-file error. These pure
contracts perform no storage, provisioning, deployment or native scheduling.

## Owner/provider current connection slot

The separate opt-in `folioview.provider-connection-slot.v1` profile defines one
current logical slot per authenticated Owner and preregistered provider. The
packaged `provider_connections.json` and pure `provider_connections` module do
not modify existing identity/credential DTOs, routes, consumers or records.
Supported provider codes are currently `muse` and `chatgpt`; this is not a promise
of native scheduling or additional provider availability. Consumers adopt this
profile in a later, separately scoped change.

`provider_slot_id(owner_subject, provider)` hashes the canonical two-element
array into a deterministic storage key. The slot is unique across an Owner's
vaults but strictly bound to the current vault in all reads and transitions.
Cross-vault reuse/rebinding is rejected. A future vault migration must be an
explicit reviewed protocol, never deletion/recreation to reset a generation.
Provider comes from preregistered native client context, not model output or an
incoming body. The hash is an index key, not proof of identity or permission.

A slot has a monotonically increasing `slotVersion` for CAS and a separate
`slotGeneration` increasing only on activation. `currentCredential` points to
one immutable v1 connection/client/credential generation and fingerprint.
`lastCredential` survives disconnect as a tombstone; reconnect uses the same
logical slot, increments the high-water mark and requires a fresh Owner approval.
Physical v1 connection IDs, Agent bindings, Run actors and original receipts
remain immutable. The slot can serve many independently authorized tasks; it
contains no connection-wide union of task permissions.

### Review and atomic replacement

1. Independently authenticate the Owner, pin the current Root/checkpoint and
   derive Owner/vault/provider from trusted state. Prepare the new identity and
   lease through the existing key handoff and `approve_credential` rules. An
   active-shaped prepared lease is not installed/current authority.
2. Read the slot and **complete current provider credential inventory** inside
   the consuming transaction. Review up to 32 old credentials (including expired
   current records) and select exactly the tasks/resources to retain. Production
   and synthetic scopes are never combined automatically. An empty task selection
   retains no task access. Each selected task names its business version,
   execution epoch, exact grant fingerprint and resource IDs; these references
   need independently verified fresh grants and ciphertext for the candidate.
3. The closed `ProviderConnectionReview` contains sorted, unique old connection
   snapshots and task selections. `provider_review_digest` hashes its exact JCS
   bytes. An authorized current Owner device signs the distinct
   `provider_connection_update` control, binding the review digest, candidate
   credential fingerprint, setup intent, expected slot version/generation and
   previous credential fingerprint. Approval is fresh within 300 seconds and
   bound to the current registry/checkpoint. No title, plaintext or private key
   belongs in these routing contracts.
4. `prepare_provider_activation` verifies that control and returns a pure
   `ProviderSlotPlan`. It compares the exact legacy inventory, rejects omitted,
   duplicated, stale, foreign or changed snapshots and proposes only the reviewed
   task selection. It performs no I/O, revocation, scope transfer or storage.
   Candidate lease/identity arguments must be independently verified, not copied
   from an incoming request or blessed by a caller-supplied `verified` flag.
5. In **one consumer transaction**, compare `expected_slot_version` (including
   create-only version zero) and the full provider inventory against `plan.retire`;
   consume the exact unused setup intent; archive and revoke each old
   **fingerprint/generation**, install the candidate and slot, and persist the
   original operation and immutable receipt. Retiring by connection ID alone
   could revoke a replacement using that same physical connection. All inventory
   creators must share the unique slot/index fence. Preparation/approval failure
   or a failed transaction leaves the previously valid credential current.
   A plan is not an atomic store implementation; callers must not commit it after
   stale reads or treat its mutable dictionaries as verified request objects.

First-connect races use deterministic unique creation; replacement races use
expected-version CAS. Exactly one wins. A legacy physical connection's v1
credential generation and previous fingerprint must also advance correctly;
never discard its independent tombstones when it is not the current slot target.
The consumer must consume activation intent, fence session/refresh families and
check both legacy identity/lease and current slot for every session, Begin,
manifest read and final result write. `require_current_provider_credential` is
that additional exact-pointer/expiry fence, **not** a substitute for PoP,
task/action grants, source epoch, immutable Run binding or final write CAS.
Ciphertext caching does not cache this authority decision.

`prepare_provider_disconnect` requires its own signed action and expected slot
version. It clears only the current pointer and advances the version while
retaining `lastCredential`, slot generation, historical actors and receipts.
Later reconnect needs new reviewed approval and candidate keys; it cannot reuse
an old active credential or reset generation one. Once migrated, the single
logical slot is the connection presented by the UI; no service or UI has adopted
that presentation in this foundation change.

### Unknown commit and compatibility

Store operations under `(Owner, vault, provider, slotId, stableOperationId)` in
the same transaction as the slot. `operationFingerprint` uses the original JWS
signing input, preserving the existing high/low-S signature identity rule.
After independent **current Owner authentication**, an exact uncertain retry can
use `check_provider_operation_replay` against the trusted original operation.
Return the original immutable receipt; never reinstall that operation's slot or
keys after a later replacement/disconnect. A changed packet under the same ID
conflicts. Retain old operations and revocation high-water marks. The replay
predicate does not verify signatures, authenticate a caller or issue authority;
normal new approvals retain current signature/freshness checks. The consuming
service must prove original-operation ordering separately before enabling retries.

Owner history remains readable and attributable to its original physical Agent,
including records not selected for migration. Disconnect/migration does not delete
reports, merge grants or rewrite v1 tombstones. Unsupported legacy/migration
conditions fail without changing the valid current connection. Rollback keeps
current-generation enforcement; it must not reenable a retired legacy path.
The old `folioview.agent-credential.v1` and persistent identity validators remain
unchanged and do not accept this new profile. No migration, consumer feature flag,
new cloud resource, schedule, browser key prompt or production acceptance is
performed by importing or packaging the module.
