# Persistent Agent identity and session recovery v1

This additive foundation defines `folioview.persistent-agent-identity.v1` under
the exact existing `folioview.agent-workspace.v2.0` contract. It separates a
stable, explicitly approved public Agent identity from short-lived transport
credentials. Nothing imports or enables it in a service or Web client yet.

The existing P1 task grant, OAuth family, certificate deadlines, Run and result
contracts are unchanged. An old connection, signed grant or expired helper
session is not upgraded by loading this module. There is no automatic migration.

## Public records and controls

`persistent_agents.json` contains five closed DTOs. The Python loader composes
local packaged primitive definitions with these DTOs without modifying or
registering names in the legacy schema validator. JSON Schema consumers in other
languages must resolve the same local definitions and enforce the semantic checks
below; a structural schema pass never authorizes anything.

| DTO                                | Purpose                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PersistentAgentBindingPayload`    | Fresh owner-device-signed approval of one already root-certified Agent signing/encryption key pair, connection, client and principal. Initial identity epoch is exactly 1. |
| `PersistentAgentIdentity`          | Stable public binding, original signing-input fingerprint, registration time and active/revoked state. No OAuth family, bearer, content permission or expiry field.        |
| `PersistentAgentRevocationPayload` | Fresh owner-device control matching the exact current binding fingerprint and epoch.                                                                                       |
| `AgentSessionChallenge`            | One persisted, audience-bound challenge to recover this same identity, valid for at most 120 seconds.                                                                      |
| `AgentSessionProofPayload`         | Agent signature over the exact challenge, with a distinct artifact type and `resume_session` purpose.                                                                      |

Identity bindings include owner, vault, pinned root, connection, Agent principal,
OAuth client, identity epoch and both certified Agent key IDs. This is not a
deduplication key based only on a client ID, email, model name or provider. Two
independent connections remain separate even for the same owner and provider.

All signed controls use the existing closed ES256 `fv-control+jws` format, with
canonical JCS payloads and explicit artifact/profile discriminators. The legacy
grant/Begin/control verifiers do not accept the new payloads. Full signed messages
and extension DTOs are capped at 16 KiB; IDs and integers retain the existing bounds.
There are no arbitrary public-key URLs, private keys, PRF outputs, content bodies,
scope selectors or resource permissions in an identity record or recovery proof.

## Enrollment

`verify_agent_identity_binding` requires the caller's authenticated owner/vault,
selected connection, Agent principal, preregistered client and current root-pinned
`VerifiedRegistry`. The owner-device control must reference that current checkpoint,
have `control_write`, be currently certified and have been issued within 300 seconds.
Both Agent keys must be active, unexpired and certified to the same selected
principal/connection with their distinct signing/encryption roles.

This verifies an explicit owner approval and public key binding. It does **not**
prove that keys originated in a trusted Muse process or that the runtime protects
them. First-pairing provenance and the protected-runtime lifecycle are separate
production gates. Model-transcribed public keys are not a trusted enrollment path.

`initial_agent_identity` derives the public record from the verification snapshot.
It refuses every occupied slot, including an active record and a revoked tombstone.
The consuming service must perform create-only CAS and keep the original signed
binding and operation receipt atomically. Exact unknown-outcome recovery uses that
original operation/receipt under fresh owner authorization; it must not manufacture
a second connection or overwrite a tombstone. Verification objects are in-process
snapshots, not capabilities to deserialize from HTTP or use as authorization caches.

## Recovering a short-lived session

`verify_agent_session_proof` takes the **authoritative stored** identity, challenge,
used flag, current registry and trusted route/configuration bindings. None of these
expectations may be copied from the incoming proof to make it self-verifying.

1. Check the current owner/vault/root, selected connection and preregistered client.
2. Require an active identity and an unused challenge. Compare every immutable
   identity field, identity epoch and original binding fingerprint.
3. Require the exact configured HTTPS audience, without credentials, query or
   fragment. No network request or discovery follows this value.
4. Check a canonical 32-byte nonce, bounded operation ID, nonfuture issue time,
   expiry after now and lifetime at most 120 seconds. The challenge cannot predate
   registration. The producer must generate ID/nonce using a CSPRNG.
5. Verify the exact proof with the current root-certified Agent signing key, and
   recheck the current Agent encryption key, roles, principal, connection, expiry
   and revocation. Neither root nor owner-device signatures can replace this proof.
6. Inside the consuming service's same commit transaction, reread current identity,
   challenge and revocation state, verify, consume the challenge and record any
   resulting narrow session. A copied `challenge_used=False` outside that transaction
   is not replay protection. Concurrent proofs must yield at most one issuance.

The returned proof authenticates recovery of that identity only. It does not grant
access to tasks, sources, ciphertext, Run creation or result writes. Those require
their own explicit current consent, execution/source fences, scopes, expiry and
transaction checks. A downstream issuer must not turn recovery into broader rights
or reuse an authorization snapshot after a revocation. No token issuer, refresh
endpoint, persistent store, challenge generator or HTTP route is supplied here.

An OAuth expiry or ordinary owner sign-out does not delete this public binding.
An expired original enrolling owner-device certificate is not rechecked during
Agent recovery, so enrollment does not depend on a user staying online. Current
Agent certificates still bound use: expiry/loss stops execution, leaves the stable
identity intact and requires a separately approved repair/renewal path. This slice
does not implement key rotation or extend any existing certificate. A signing proof
alone is not proof that an encryption private key survived a process restart.

## Revocation

`revoke_agent_identity` verifies a fresh owner-device control against the exact
current record. It returns a terminal revoked record with identity epoch advanced
by one; overflow is rejected. Revocation does not require the Agent to be online or
its keys to remain usable. Old challenges, old signatures and newly issued
challenges against a revoked record cannot recover it. There is no restore action.

The producer must atomically persist that tombstone with its original immutable
receipt and invalidate future connection capabilities. It must recheck this fence
at each protected operation. Removing a Muse connector or expiring a refresh token
is not a substitute for explicit Hub revocation. Previously disclosed plaintext
cannot be remotely recalled; owner access to historical ciphertext is separate.

## Validation and adoption order

Synthetic real-signature tests cover owner/Agent separation, both key bindings,
wrong owner/vault/root/client/audience, expiry and replay, nonce substitution,
revocation fencing, immutable verification snapshots and legacy-profile rejection.
Run shared tests and the repository's complete `npm run check` before delivery.
The packaged wheel must include this JSON file and resolve its local primitives.

Adopt in separate, independently checked PRs:

1. This shared identity/recovery foundation.
2. Shared persistent resource consent and version/revocation policy contracts.
3. Hub identity storage, explicit enrollment/revocation, original receipts and
   atomic recovery producer; then the resource-consent and narrow execution APIs.
4. A separately selected trusted runtime, then Web consumers and actual scheduling.

VAL-005 observed actual OAuth refresh and ordinary native scheduled REST read/write,
but did not establish protected process-restart persistence, trustworthy first
pairing or real encrypted cross-day delivery. Those gates remain open. This
foundation does not turn the current foreground helper into background execution.
The provider's [connector permission rules](https://platform.muse.ai/docs) and
[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
remain separate from content decryption consent.
