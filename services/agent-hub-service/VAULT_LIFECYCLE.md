# Root-approved vault archive lifecycle

This Hub-owned API profile is `folioview.vault-lifecycle.v1`. It reuses the existing flattened
ES256 `fv-control+jws` primitive and opaque `folioview.passkey-vault.v1` archive. It does not add
an action to the shared `ControlCommandPayload`, change a registry role or replace the root.
Every endpoint requires the existing verified Firebase Google owner and the exact
`X-FolioView-Contract: folioview.agent-workspace.v2.0` header. Responses and errors are `no-store`.

## Endpoints

All paths below start with `/api/v2/vaults/{vaultId}`. No query parameters, body-selected owner,
root public key, upstream URL or `X-FolioView-Author-Key` override is accepted. GET requests have
no body. Mutations require one `Idempotency-Key` containing the signed stable operation ID.

| Method | Path                                                | Body / result                                                                                      |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/archive`                                          | Current ciphertext, lifecycle/archive versions, public fences, pending approval and signed history |
| PUT    | `/archive`                                          | `{contractVersion,archive,command}`; root-approved replacement and original receipt                |
| POST   | `/archive-deletions`                                | `{contractVersion,command}`; root-approved removal of the cloud archive, HTTP 201                  |
| POST   | `/archive-deletion-checks`                          | Original signed deletion; read-only outcome and matching snapshot versions                         |
| POST   | `/archive-deletion-withdrawals`                     | Fresh root command plus original deletion command; retain archive and invalidate original CAS      |
| POST   | `/recovery-authorizations`                          | `{contractVersion,command}`; approve one exact replacement digest, HTTP 201                        |
| POST   | `/recovery-authorizations/{authorizationId}/revoke` | `{contractVersion,command}`; explicitly revoke that pending approval                               |
| GET    | `/archive-operations/{operationId}`                 | The immutable original operation receipt, or 404                                                   |

The total archive PUT body is at most 65536 bytes. Authorization/revocation bodies and each
serialized signed command are at most 8192 bytes. Strict JSON rejects unknown/duplicate fields,
invalid canonical base64url, booleans as integers and unsupported signatures or profiles.
The existing private-route timeout, error vocabulary and response/document budgets remain in use.

## Signed commands

The service chooses `rootJwk` and `rootKeyId` from the authenticated owner's existing vault.
The current root is an independent trust anchor; an initial directory need not contain a
`root_sig` certificate. Device keys, agent keys and a request-supplied public key cannot replace it.

Every payload has exactly these common fields:

| Field                                              | Meaning                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `profile`, `contractVersion`                       | Exact lifecycle profile above and existing workspace v2.0 contract                                        |
| `action`                                           | `archive_replace`, `archive_delete`, `archive_delete_withdraw`, `recovery_authorize` or `recovery_revoke` |
| `ownerSubject`, `vaultId`, `rootKeyId`             | Existing owner hash, vault and pinned root                                                                |
| `stableOperationId`                                | Exact `Idempotency-Key`; use a fresh client-generated operation ID                                        |
| `expectedVaultVersion`                             | Existing directory/source aggregate version                                                               |
| `expectedLifecycleVersion`                         | Current independent lifecycle version; starts at 0                                                        |
| `expectedArchiveRevision`                          | Current independent archive revision; starts at 0                                                         |
| `expectedArchiveDigest`                            | SHA-256 hex of the canonical current archive JSON                                                         |
| `registrySequence`, `checkpointDigest`, `keyEpoch` | Exact current verified registry fence                                                                     |
| `issuedAt`, `expiresAt`                            | Integer Unix seconds; `issuedAt <= now < expiresAt <= issuedAt + 300`                                     |

Each action adds only the following fields:

| Action                    | Additional fields                                                               |
| ------------------------- | ------------------------------------------------------------------------------- |
| `archive_replace`         | `mode`, `newArchiveDigest`, `authorizationId`                                   |
| `archive_delete`          | None                                                                            |
| `archive_delete_withdraw` | `deletionOperationId`, `deletionCommandFingerprint`, `deletionLifecycleVersion` |
| `recovery_authorize`      | `authorizationId`, `newArchiveDigest`                                           |
| `recovery_revoke`         | `authorizationId`                                                               |

`newArchiveDigest` is SHA-256 hex of the complete canonical proposed archive, including its
randomized ciphertext and public binding metadata. It is not a digest of private holdings,
tasks or recovery plaintext. The client must create, decrypt-test and retain the exact proposed
archive before signing its digest. The backend cannot establish that the ciphertext contains
the right private keys or that a new authenticator completed UV/PRF successfully.

For `archive_replace`:

- `rewrap` keeps the current credential ID. It can refresh its wrapping material.
- `passkey_change` requires a different credential ID and PRF salt.
- `recovery` also requires a different credential ID and PRF salt, plus the matching active
  `authorizationId`.
- The IV and ciphertext must differ from the currently stored archive. All public owner, vault
  and root bindings stay fixed. The archive's existing closed eight-field format is unchanged.
- `authorizationId` must be null for `rewrap` and `passkey_change`.

All modes require root possession. Rewrapping is not revocation of an exposed root or a copy of
an old Passkey and archive already held elsewhere. Full root renewal/rekey and historical-data
policy require their own contracts; these endpoints cannot promise cryptographic recall.

## Cloud archive removal

### Checking and withdrawing an unknown deletion

`POST /archive-deletion-checks` accepts `{contractVersion,command}`, where `command` is the
original root-signed `archive_delete`. It is read-only, requires the Google owner, disallows
`Idempotency-Key` and selected-author headers, and has an 8192-byte body limit. It returns
`{contractVersion,profile,vaultId,operationId,commandFingerprint,outcome,vaultVersion,lifecycleVersion,receipt}`.
The outcome is `deleted` for the original accepted deletion, `withdrawn` for its signed withdrawal,
`superseded` when a later immutable CAS fence prevents the original command, or `unresolved`.
Expiry alone always remains unresolved. A future counter is rejected rather than declared safe.
An original deletion remains `deleted` even if a later recovery restored the current archive.
The optional receipt is the immutable original deletion/withdrawal receipt. Clients independently
verify `/archive` signed history and match the returned snapshot versions; a check response alone
does not replace root proof or permit discarding a still viable command.

`POST /archive-deletion-withdrawals` accepts `{contractVersion,command,deletionCommand}` with a
24576-byte body limit and an idempotency key for the new withdrawal. Both commands remain bounded
by 8192 bytes. `deletionCommand` is the original signed deletion; `command` is a fresh root-signed
`archive_delete_withdraw` with all common current lifecycle fences, plus exactly
`deletionOperationId`, `deletionCommandFingerprint` and `deletionLifecycleVersion` (the original
expected lifecycle version). Its signature and all three target fields must match the original.

Withdrawal advances lifecycle version once, retains the archive and its revision/digest, and
preserves the pending recovery approval and all other state. The target version cannot be in the
future. The signed history permanently records that exact deletion identity and invalidates its
old CAS, including for late or rolling-old requests; its operation ID cannot be reused to delete
later. Deletion and withdrawal compete in one transaction, so only one wins. A committed deletion
cannot be undone by withdrawal, and repeated/different withdrawals cannot consume more slots for
the same target. Exact retries recover the original withdrawal receipt after expiry or capacity.
No client-clock or 404 inference, new collection, cloud permission, TTL or background job is used.

`archive_delete` requires a fresh pinned-root signature binding the exact current archive digest,
archive/lifecycle versions and directory fence, in the same five-minute window as other commands.
The deletion transaction replaces only the stored archive with JSON `null`, advances the archive
revision and lifecycle version once, and clears any pending recovery approval. Its resulting
archive digest is SHA-256 of canonical JSON `null`. The existing owner/vault/root, directory,
sources, task/result ciphertext and operation receipts remain. The vault itself stays present;
first-enrollment APIs cannot install a new root or restore an old archive, including on retries.

`current` and `/archive` return `archive:null` after deletion, with the existing surrounding fields.
This is an explicitly deleted key archive, not an empty resource library. Every read of a null
archive verifies the complete signed deletion history. Missing, inconsistent or forged history
fails closed. Older validators that do not implement this action reject the new state; ordinary
clients that never request deletion keep their existing non-null response shape and behavior.

The signed deletion proof and immutable receipt contain no archive ciphertext, credential ID,
PRF salt or IV. No old archive is copied into the lifecycle history. An exact deletion retry returns
its original receipt even after restoration; it never deletes a newer archive. A competing
replacement/deletion rereads the winning archive inside the transaction and cannot both commit
against one revision. Old replacement, bootstrap and renewal retries cannot resurrect the archive.

Restoration requires independent root-capable recovery material, a **new** recovery authorization
bound to the deleted state, and a root-signed `archive_replace` in `recovery` mode targeting that
exact approval. Rewrap, ordinary Passkey change and key renewal cannot recreate a deleted archive.
There is no prior credential/salt left to compare after deletion; the new archive's owner/root
bindings, complete target digest and fresh recovery approval remain mandatory. Deletion is refused
at lifecycle versions 30 or later, leaving two slots for approval and restoration. This is not a
new lifecycle quota or an unlimited recovery guarantee.

Removing the cloud archive does not recall downloaded archives, recovery kits, backups, local keys
or prior access grants. It does not revoke devices, reset the library, re-encrypt historical data or
guarantee physical erasure from storage-provider backups. A later client must show these effects,
require explicit confirmation and preserve independent recovery material. This producer delivery
does not add a Web button or modify a real user's archive during deployment.

## Recovery approval and revocation

Recovery approval binds one fresh authorization ID to the exact target archive digest, original
archive revision/digest and current vault/registry fence. The ID is not a bearer credential.
The replacement still requires a root signature and the same Google owner. This provides a
short-lived, single-use approval for a root holder recovering from independently retained
material; it does not delegate a new signing role or ask the server to recover a private key.

There is at most one pending approval. An unexpired approval must be explicitly revoked before
another is issued. An expired one may be superseded with a new ID; IDs cannot be reused anywhere
in the retained lifecycle. A pending approval is reported as `active`, `expired` or `stale`.
Directory/source changes make its fence stale. A recovery replacement must match the approval's
target and original fence, be accepted before its expiry, and not request a later expiry.

Every successful archive replacement consumes/invalidates the pending approval, including
routine replacement. Revocation is itself root-approved and can clear an expired or stale
approval. Replaying an old authorization or revocation returns only its original receipt and
cannot reactivate approval or undo a later operation.

`recovery_enc` remains an ECDH recipient key. It cannot sign a recovery approval. Independent
lost-Passkey recovery therefore still requires a previously retained root-capable backup or
another unlocked trusted client. Losing every usable copy cannot be repaired by Google login,
an administrator, an authorization ID or a server nonce. Client recovery-kit creation/import
and actual Passkey replacement UX are delivered separately.

## Versions, history and persistence

The existing vault row keeps its exact fields and version rule:
`version == len(registryHistory) + len(sources)`. Archive replacement changes only its `archive`
field; it does not change the root, directory, source references or that aggregate version.
The legacy `current` endpoint keeps its original six-field vault DTO and projects the new archive.

A separate `hub_vault_lifecycle` document in the existing configured Hub store contains only
`ownerSubject`, `vaultId`, `rootKeyId`, `initialArchiveDigest` and `history`. Before the first
lifecycle mutation, reads derive version/revision 0 without creating a document. The history
contains at most 32 pairs of root-signed command and original receipt. The lifecycle version is
the history length; archive revision counts replacements and deletions. No old archive ciphertext is retained
in this history or in receipts. An authorization reserves one final slot for consumption or
revocation, so no new approval is issued at lifecycle version 31.

Each load verifies the full bounded root-signed history, digest/version transitions, operation
uniqueness, original receipt fingerprints and historical registry references. Its final digest
must match the current vault archive. Persisted corruption fails closed. Versions, root/owner
bindings and directory fences are reread inside the same transaction as the write. Archive
replacement atomically writes the current archive and lifecycle record; authorization/revocation
writes only the lifecycle record. No new database, KMS key, cloud configuration, scheduled cleanup
or TTL/index provisioning is performed by this change.

The backend history cannot establish globally latest state against deletion or complete rollback
of database documents. The future trusted client must pin lifecycle high-water marks and verify
root proofs. First-use root trust and protection against a malicious replacement frontend keep
their existing limitations.

## Receipts and retries

Mutation responses have exactly `{contractVersion,profile,receipt}`. A receipt contains
`profile`, `ownerSubject`, `vaultId`, `rootKeyId`, `operationId`, `action`, `lifecycleVersion`,
`archiveRevision`, `archiveDigest`, `commandFingerprint` and `acceptedAt`.
`acceptedAt` is server metadata checked against the root-signed validity window and monotonic
history; it is not a root-signed timestamp or an independently trusted clock.

An exact root-verified signing input replay returns its original receipt, even after its command
expires or a newer archive is saved. It never reapplies the archive or restores authorization.
ES256 signature-byte variants with the same signing input share one operation identity. A
different signed payload under the same operation ID produces `idempotency_conflict`.
Receipt recovery remains available at capacity. An old receipt is not the current archive state;
read `/archive` and compare the retained candidate and signed history before resolving a lost
response. Do not generate new keys or discard the original candidate merely because a request
timed out. Google owner checks and pinned-root signature verification remain mandatory on writes.

## Client rollout

This producer change does not enable the new APIs in the Web BFF allowlist or add buttons.
Existing clients that never call these APIs retain their behavior. An unlocked old client that
observes an archive change correctly fails closed; a later Web PR must deliberately lock,
discard stale wrapping/device-session state and unlock against the verified new archive.
Real Google login, authenticator compatibility, recovery-kit handling and production enablement
remain separate acceptance work. Tests for this producer use synthetic keys, ciphertext and
local stores/Firestore SDK RPC substitutes only.
