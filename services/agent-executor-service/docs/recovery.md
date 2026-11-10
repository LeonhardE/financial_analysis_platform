# Recovery and encrypted state

## Independently pinned authority

`Config.parse` accepts a closed `folioview.agent-executor.v1` public object:
`{profile, binding, rootJwk, policyJwk, approval, workload, scope,
agentSigningJwk, agentEncryptionJwk, tlsJwk, certificateChain,
snapshotBucket, kmsRecoveryKey}`. Private fields, different keys, unapproved
scope, issuer/audience/provider/epoch changes and expired Root approval fail.
The shared executor-trust v1 binding independently pins all five public keys,
owner/vault/connection, exact provider/client, scope/recipient ceiling and measured
workload. The scope is the Hub ciphertext analysis/owner-inbox profile.

Configuration is deployment input reviewed together with the Root enrollment,
not an agent-supplied request. The image and Policy both pin the exact measured
command/environment. A replacement public config cannot extract the original
keyring: actual Policy release independently checks its enrolled Root binding,
measured image, current VM and ephemeral release key. The separate deployment
must protect the public config location and restrict its sources/permissions.

## Restore before native TLS

1. Generate a new ephemeral P-256 key and random boot/operation identifiers in
   measured memory. This is never a replacement Agent/TLS identity.
2. Ask the fixed independent Policy `/workload/v1/connections/{connection}/challenges`
   path for keyring-only recovery. Send no native bearer/refresh token. Verify
   the signed current checkpoint and the complete statement against this boot,
   exact binding, operation, ephemeral recipient, current head/epoch, empty
   resource set and approved certificate bytes.
3. Send only that complete statement's SHA-256 nonce and the fixed Policy audience
   to `/run/container_launcher/teeserver.sock`, `http://localhost/v1/token`,
   with `token_type=OIDC`. No HTTP API accepts caller nonce/attestation/decrypt
   requests. The Policy independently verifies Google's token, approved workload
   and current VM. A fresh Root boot window or existing recover family is required.
4. Verify the Root approval, Policy signature, current recovery lease/challenge,
   next generation and exact sealed-key context. Only that ephemeral key can
   decrypt the 32-byte state DEK. Download **only** the digest selected by that
   current checkpoint. Missing, corrupt, wrong-key or historical state stops.
5. Decrypt the state and validate all original private/public key correspondences.
   Answer the Policy's encrypted random challenge with the original encryption
   key, and sign exact-path confirmation with both original Agent and TLS keys.
   Verify the confirmed current head/generation before making TLS available.

TLS recovery itself grants no financial authority. Policy revocation, outage,
wrong image/debug/overrides, changed active VM or wrong original keys prevent
new operation leases. The production runtime has no direct KMS decrypt call.
The attestation request follows [Google's custom audience/nonce protocol](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/connect-external-resources).
Live hardware proof is separate from the synthetic local tests.

## Current permission and state CAS

Every internal `authorize` call requires a current native bearer passed by its
trusted caller; it is never stored in state. It first fetches the current Policy
checkpoint, binds the purpose/operation/resource subset to a new challenge,
proves all original keys and obtains a fresh attested execute/write lease. It
fetches the current checkpoint again after the grant. Old boot/generation/head,
wrong account/scope, expired leases or revocation cannot become cached authority.
A business consumer must recheck immediately before each new plaintext access
or external submission; returning a lease does not make permission permanent.

Snapshots are AES-256-GCM with a random 96-bit nonce and canonical associated
identity metadata. Their SHA-256 content address is the Policy state head.
The plaintext contains only the original executor keys, monotonic sequence,
bounded private outbox and original receipt metadata. There is no Owner Root,
Passkey or token field. AAD excludes only the workload digest, preserving the
original keyring for an explicit Root-approved code upgrade; an epoch/key
migration changes AAD and cannot relabel or open the old keyring.

`persist` accepts only the same original keys and the next sequence, obtains a
current write lease, uploads a new immutable encrypted snapshot and then commits
its head/receipt with Policy CAS. GCS writes use generation zero; reads pin both
the requested digest and captured object generation, with size/CRC32C checks.
Objects are not searched/listed to choose a head. Uploads before failed CAS are
inert orphan ciphertext. A failed/unknown commit clears the process state and
requires restore from the live Policy head. It never resumes from a local pointer.

Outbox operation IDs and exact bytes survive a new process/backup copy. Historical
operations/receipts remain inert across code upgrades; they do not authorize a
new binding or replay an old head. Business integration must validate the encrypted
report carrier and recheck Hub/source/Run/recipient fences before transmitting
those bytes. It must persist before first submission and distinguish staging,
report and acknowledgement operations. This core has no report generator or
financial network destination.

Limits: 2 MiB encrypted snapshot, 16 outbox items (589,824 bytes each within the
overall snapshot limit), 32 receipts, 64 KiB public config/request, 128 KiB Policy
response, 32 KiB attestation token, bounded HTTP timeouts and no redirects or
environment proxies. Capacity exhaustion stops; it does not delete authority or
silently reset keys. An administrator with control over the independently trusted
Policy authority is outside the untrusted executor-operator boundary.
