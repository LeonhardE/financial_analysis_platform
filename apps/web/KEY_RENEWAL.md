# Encrypted library key renewal

Settings → Library keys and devices offers explicit review, renewal, original-receipt recovery
and cancellation. It consumes the Hub's fixed owner endpoints through the existing same-origin
BFF. Google identity remains separate from Passkey content-key access. No cloud configuration,
shared schema, new service or dependency is needed.

## Crypto and retained history

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

## Expired certificates and restricted sessions

An explicit Passkey operation can open a renewal-only session even if the registered browser's
operational certificates have expired. Worker and bridge both deny ordinary content access,
drafts, device changes and agent operations in this mode. The owner reviews the eligible local
pair and recovery certificate, then confirms one root-approved successor directory/archive.
Revoked or superseded keys never become eligible merely because the owner unlocks a Passkey.

The resulting registry, archive and original receipt must be verified before local promotion.
Promotion commits device seal, registry pin, lifecycle pin and pending deletion atomically, then
terminates the Worker. The user unlocks again with the same Passkey to continue. Expiration alone
never removes the registered local identity needed to retry renewal.

## Outbox, races and cancellation

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

## Current limits and acceptance

- Renewal needs this browser's previously registered device identity. A clean browser does not
  silently adopt another device's identity. Separate enrollment/recovery remains explicit.
- Resolve pending holdings/task uploads and device/agent/archive changes before renewing. Drafts
  remain encrypted and can stay. If certificates already expired while uploads are unresolved,
  this version preserves them and pauses renewal; it does not provide an expired-upload resolution
  UI or silently discard possibly accepted work.
- Agent grants are not automatically reauthorized. Changed/revoked recipient keys can require
  fresh explicit consent.
- Root replacement, reset/delete, pruning history and historical content rekey remain separately
  scoped. Renewal does not recall old copies or plaintext already released.

Synthetic coverage executes WebCrypto, the production Worker dispatch, IndexedDB transactions,
controllers and fixed BFF contracts. Local actual-Hub SQLite fixtures verify producer acceptance
and old holdings/tasks/reports after multiple renewals. Physical Passkey/PRF providers, native
renewal acceptance and production IAM remain separate; unsupported providers still fail closed.
