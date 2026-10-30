# Root-approved owner key renewal

The Hub-owned `folioview.vault-key-renewal.v1` profile renews operational owner keys by
issuing a new key generation. The pinned `rootJwk`/`rootKeyId` is an independent trust anchor
with no expiration. An optional `root_sig` certificate is not that anchor. This API does not
replace the root, reset a vault or modify an existing certificate's validity.

The shared registry deliberately treats each certificate payload as immutable for its key ID.
A renewal therefore uses newly generated public keys and higher role-local epochs. The trusted
client generates, tests and retains the private keys; the Hub never receives them.

## Endpoints

All endpoints start with `/api/v2/vaults/{vaultId}` and retain verified Google owner authentication,
`X-FolioView-Contract: folioview.agent-workspace.v2.0`, private-route deadlines and `no-store`.
Queries, device-author overrides and authority-delegation overrides are rejected. GET has no body
or Idempotency-Key. POST requires an Idempotency-Key matching both signed stable operation IDs.

| Method | Path                                    | Result                                                                             |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/key-renewal-state`                    | Current public fences, owner certificate validity and root-anchor expiry semantics |
| POST   | `/key-renewals`                         | Atomic registry/archive/history update and immutable original renewal receipt      |
| GET    | `/key-renewal-operations/{operationId}` | Original receipt, or owner-scoped 404                                              |

The POST body has exactly `contractVersion`, `registryBundle`, `archive`, `command` and
`archiveCommand`. The existing HTTP write budget applies. Each flattened root command has an
independent 8192-byte budget. Existing registry, archive, canonical JSON/base64url and response
budgets remain in force; no new shared format or generic proxy is introduced.

## Root approvals

`command` is an ES256 `fv-control+jws` signed by the vault's pinned root. Its closed payload is:

- `profile`, `contractVersion`, `action` (`key_renewal`).
- `ownerSubject`, `vaultId`, `rootKeyId`, `stableOperationId`.
- `expectedVaultVersion`, `registrySequence`, `checkpointDigest`, `keyEpoch`.
- `expectedLifecycleVersion`, `expectedArchiveRevision`, `expectedArchiveDigest`.
- `newCheckpointDigest`, `newArchiveDigest`, `archiveCommandFingerprint`.
- `renewals`, `issuedAt`, `expiresAt`.

The new checkpoint/archive digests are SHA-256 of their canonical JSON payloads. The archive
command fingerprint is SHA-256 of the flattened JWS signing input, excluding signature bytes.
Both approvals bind the same owner/root/vault, operation, current fences and target archive.
Their signed validity windows are at most five minutes; all integer fields reject booleans.

`archiveCommand` uses the existing `folioview.vault-lifecycle.v1` `archive_replace` action with
`mode=rewrap` and `authorizationId=null`. The protecting credential ID and PRF salt stay fixed;
IV and ciphertext must change. Reusing the existing action keeps archive-history verification
compatible with existing validators. The lifecycle stores this command's ordinary archive
receipt; the renewal receipt also binds the new directory. Pending recovery approval must be
resolved explicitly before a fresh renewal.

## Allowed directory changes

Each sorted `renewals` item has exactly `role`, `principalId`, `priorKeyId`, `newKeyId`,
`priorKeyEpoch` and `newKeyEpoch`. An operation may replace a recovery key, a matching device
signing/encryption pair, or that pair together with one recovery key.

- Roles are limited to `device_sig`, `device_enc` and `recovery_enc`. The device pair keeps the
  same principal; each successor keeps its prior role, principal, connection and capabilities.
- Targets must be the current active local generation and not revoked. A certificate may be
  expired: possession of the pinned root plus Google owner identity authorizes renewal, without
  allowing an expired device or agent to sign it.
- Successors use fresh key IDs, local epoch `prior + 1`, current validity and a later expiration,
  with a maximum one-year certificate lifetime. Historical key reuse is rejected.
- Retain every existing certificate payload. Replaced keys become inactive and explicitly revoked;
  unrelated entries, agent keys, grants, connections and existing revocations stay unchanged.
- The checkpoint advances by one. The global content `keyEpoch`, root epoch and root identity stay
  fixed. The resulting directory must still contain an eligible writer, device recipient and
  recovery recipient under the existing owner-selection limits.

A grant that references a replaced/revoked key does not acquire its successor automatically.
The user must explicitly authorize new recipients where needed. Unrelated grants keep their
existing rules; this endpoint neither widens their scope nor issues replacement grants.

## Atomicity, receipts and bounded history

One transaction reads the current vault, signed registry chain, archive lifecycle and operation
record, then saves the new registry/archive, existing lifecycle history and renewal proof/receipt.
Renewal records reuse the existing `hub_operations` namespace. The vault version and operation
count advance once, registry sequence advances once, and archive lifecycle/revision advance once.
The legacy vault/current DTO shape and version-count rule remain unchanged.

The receipt contains the owner/vault/root, operation, resulting vault/registry/lifecycle/archive
fences, exact renewal mapping, both command fingerprints and accepted time. Persisted proofs are
revalidated against the pinned root and historical registry/lifecycle entries. Exact replay returns
that original receipt after expiration or later updates; it cannot reinstall an older archive,
reactivate old keys or repeat a write. Valid ES256 signature-byte variants share an operation
identity. Changed signed input or substituted candidate material is rejected.

The existing 32-bundle registry history, 32-operation archive lifecycle, 64-operation vault and
byte budgets continue to fail closed. No history is pruned, no pin is reset and no new cloud
resource, database, IAM role, KMS key, index or cleanup schedule is created.

## Client rollout and limits

This is a producer-only delivery. Existing clients do not call these new routes; Web BFF and
browser admission, Worker generation, local persistence and renewal UX remain a separate Web PR.

The current Web Master contains one recovery private key. A future client must use an explicit,
versioned encrypted keyring that retains the old recovery/device material needed for historical
content, and decrypt-test the new archive before authorizing this operation. It must also provide
a root-only renewal entry when operational certificates have expired. The backend cannot inspect
an opaque archive to prove that its contents preserve the right private keys.

New-key renewal does not cryptographically recall old archives, exported recovery kits, private
keys or plaintext copies. Historical ciphertext, task versions and accepted results are not
rewritten. Same-key certificate extensions, root replacement, reset/delete and historical rekey
are outside this API. Real browser acceptance and production identity/IAM remain separately scoped.
