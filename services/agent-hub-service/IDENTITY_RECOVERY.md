# Atomic Agent identity recovery proofs

The Hub producer adopts the existing shared
`folioview.persistent-agent-identity.v1` challenge/proof contract. It proves
possession of the **current enrolled Agent signing key**, consumes the challenge
atomically, and returns an original identity-only recovery receipt. It does not
issue an OAuth bearer, resource permission, Run grant or decryption capability.
The new receipt is not a `VerifiedGrant` or an authentication cache for later writes.
Existing OAuth, foreground and content consumers do not accept it.

## Closed Agent API

Both POSTs use `/agent/v2/persistent/identity-recovery`, exact
`X-FolioView-Contract`, no query and no caller Authorization/author/delegation/
idempotency selectors. Cloud Run workload ingress remains a separate front-door
control; it cannot substitute for an Agent proof. These calls do not take an
owner Google token or UID.

| Suffix        | Closed JSON fields                                             | Response                                                                               |
| ------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/challenges` | contractVersion, ownerSubject, vaultId, connectionId, clientId | Current shared `AgentSessionChallenge`.                                                |
| `/proofs`     | The preceding fields plus proof                                | `folioview.agent-identity-recovery.v1` receipt with authority exactly `identity_only`. |

Challenge requests are bounded to 4 KiB and proof requests to 32 KiB, with the
shared closed DTO/signature budgets enforced afterward. IDs are public routing
metadata, not proof. No private task/resource data is returned. Public challenges
contain only the stable public binding, audience and random nonce.

Both `HUB_PERSISTENT_AGENTS_ENABLED=1` and
`HUB_PERSISTENT_IDENTITY_RECOVERY_ENABLED=1` plus the existing valid preregistered
Muse OAuth configuration are required. Both default off. Disabled recovery loads
neither storage nor OAuth configuration. Deployment does not activate the flags.
The fixed audience is the configured issuer plus the recovery base path; callers
cannot select a key URL, callback, audience or transport expiry.

## Atomicity and bounds

Each transaction resolves the current root-pinned vault/registry, original owner
OAuth index, matching client and original connection, stable identity, both active
Agent certificates and recovery bucket. Parent disconnect or terminal identity
revocation denies even an old valid signature. Ordinary OAuth/family expiry and
the original enrolling owner device's expiry do not erase the stable identity or
require an owner unlock. Current Agent key expiry/revocation still stops recovery.

The service generates the ID and canonical 32-byte nonce with a CSPRNG outside a
retrying callback. Each identity has at most one unconsumed live challenge; repeated
public requests reuse it. Challenges last at most 120 seconds. The proof uses the
exact shared canonical ES256 control with its distinct artifact and purpose.
Only a verified Agent signature over the stored challenge can consume it.

`hub_agent_recoveries` keeps at most eight bounded entries per stable identity.
Inside the **same** Firestore transaction, the producer checks the current challenge
is unconsumed, verifies the signature/current fences, records the complete original
public proof and immutable receipt, then consumes that entry. Concurrent proofs
produce one original receipt. Invalid proofs leave the entry unconsumed; a winning
revocation/disconnect prevents a racing proof from committing after retry.
No producer network RPC, KMS operation or credential exchange occurs in the callback.

Receipts contain the public exact identity binding, challenge ID, proof fingerprint,
acceptance time, original expiry and `identity_only`. Expiry is at most five minutes,
and no later than either current Agent certificate's expiry. A retry authenticates
the current Agent signer and returns the unchanged original receipt, including an
already elapsed deadline; it never extends authority or consumes a second challenge.
The signing-input fingerprint treats valid signature-byte variants as the same proof.

Unused expired challenges are pruned when issuing another challenge. Consumed
entries retain their original short receipt through expiry plus two minutes of
retry grace, then may be pruned. Capacity exhaustion fails unavailable. This bounded
**authentication handshake state** is not the permanent identity/policy/Run audit
history; those stores and their original operation receipts remain unchanged. Once
a handshake has expired or been pruned, a fresh proof can recover the same identity
without recreating a connection or content consent. It cannot create a second Run.

## Adoption boundary

This producer does not establish that a public key originated in a protected Muse
runtime, or that its encryption private key survived a process/VM restart. Trusted
first pairing and protected runtime lifecycle remain separate production gates.
No real connection, resource selection, SDK session or schedule is enabled here.

Future narrow execution consumers must authenticate their own requests, recheck
current identity, permissions, task/Run/source fences and immutable delivery evidence
inside the committing transaction, and keep durable original Run/result receipts.
Do not authorize execution by deserializing this public receipt or by extending a
legacy foreground grant. Owner historical Inbox access remains independent.

Validation uses real synthetic signatures, an already expired enrolling owner
certificate and transport, SQLite and actual Firestore SDK retries, exact-receipt
replay, challenge expiry/capacity, identity/disconnect races and strict HTTP gates.
No real user key, credential or resource is used.
