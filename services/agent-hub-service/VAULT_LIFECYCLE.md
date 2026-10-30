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

| Field                                              | Meaning                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `profile`, `contractVersion`                       | Exact lifecycle profile above and existing workspace v2.0 contract    |
| `action`                                           | `archive_replace`, `recovery_authorize` or `recovery_revoke`          |
| `ownerSubject`, `vaultId`, `rootKeyId`             | Existing owner hash, vault and pinned root                            |
| `stableOperationId`                                | Exact `Idempotency-Key`; use a fresh client-generated operation ID    |
| `expectedVaultVersion`                             | Existing directory/source aggregate version                           |
| `expectedLifecycleVersion`                         | Current independent lifecycle version; starts at 0                    |
| `expectedArchiveRevision`                          | Current independent archive revision; starts at 0                     |
| `expectedArchiveDigest`                            | SHA-256 hex of the canonical current archive JSON                     |
| `registrySequence`, `checkpointDigest`, `keyEpoch` | Exact current verified registry fence                                 |
| `issuedAt`, `expiresAt`                            | Integer Unix seconds; `issuedAt <= now < expiresAt <= issuedAt + 300` |

Each action adds only the following fields:

| Action               | Additional fields                             |
| -------------------- | --------------------------------------------- |
| `archive_replace`    | `mode`, `newArchiveDigest`, `authorizationId` |
| `recovery_authorize` | `authorizationId`, `newArchiveDigest`         |
| `recovery_revoke`    | `authorizationId`                             |

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
the history length; archive revision counts replacements. No old archive ciphertext is retained
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
