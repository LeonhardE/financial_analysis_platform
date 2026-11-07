# Durable Agent identity store

The opt-in owner API stores the shared `folioview.persistent-agent-identity.v1`
binding independently of OAuth family deadlines. It is not an execution API.
No tokens, private keys, plaintext, content permissions or new cloud resources are
created by this slice. Existing foreground OAuth and P1 grant validation stay unchanged.

## Owner API

All paths below start with `/api/v2/persistent-agents`. They require the normal
Google owner, exact `X-FolioView-Contract`, no query, no delegated owner selector,
and no separate author header. Mutations require an `Idempotency-Key` matching the
signed command's `stableOperationId` and closed JSON `{contractVersion, command}`.

| Method and suffix                                  | Behavior                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/capabilities`                                | Explicitly reports enrollment, resource consent and execution readiness separately.                                                    |
| GET `/{vault}/{connection}`                        | Public identity plus original signed binding/revocation and authoritative parent-disconnect status; null identity means no enrollment. |
| POST `/{vault}/{connection}/bindings`              | Fresh device-signed enrollment, matching current root-certified Agent pair and preregistered Muse client.                              |
| POST `/{vault}/{connection}/revocations`           | Fresh device-signed terminal revocation, even when enrollment or the parent OAuth connection is disabled.                              |
| GET `/{vault}/{connection}/operations/{operation}` | Immutable original result for resolving an unknown outcome under current owner authorization.                                          |

Enrollment requires `HUB_PERSISTENT_AGENTS_ENABLED=1` and valid existing Muse OAuth
configuration. It defaults off. Deployment does not set it. Enable only after a
trusted first-pairing path has passed review and validation; possessing a public
key card or a model-transcribed fingerprint is not runtime provenance. History and
revocation remain available without that flag or live OAuth configuration.
The independent [resource-consent producer](RESOURCE_CONSENTS.md) has its own approval
activation gate. Execution readiness remains false.

## Transactions and lifetime

`hub_agent_identities` is create-only per owner/vault/original connection. The
original connection must exist in the same owner's bounded OAuth index, have the
same vault/client and have no disconnect tombstone. An expired transport deadline
is not an identity revocation. This does not extend that deadline or let a legacy
token access tasks, sources, Runs or results.

Each identity has at most two immutable `hub_agent_identity_operations`: enrollment
and terminal revocation. The full signed commands and initial result are committed
with identity state atomically. Firestore retries reread the current vault registry,
OAuth parent, identity and operation slot before any write. No network read occurs
inside the callback. Exact unknown-outcome retries return the original receipt;
changed payloads conflict. Returning a historical active receipt after revocation
never changes current state. Callers must reread current state for any future action.

A new operation cannot overwrite either an active identity or a revoked tombstone.
Disabling enrollment, deployment, owner logout, or absolute OAuth expiry does not
delete history. The old owner disconnect endpoint still denies future use through
the authoritative parent even before a signed child-identity revocation is recorded.
Future session/execution consumers must check both fences in their commit transaction.
Current Agent certificates still bound every new enrollment and later recovery.

The store contains only public signatures and identity metadata. Old connections
are not migrated or silently upgraded. Owner clients must verify the original
signed binding and root-checkpoint history rather than treating an API DTO as
cryptographic authority. The separately gated [atomic identity recovery producer](IDENTITY_RECOVERY.md)
consumes exact Agent proofs and returns identity-only original receipts. Trusted
runtime and resource/Run execution consumers remain separate follow-up changes.

Validation uses real synthetic signatures on SQLite and the actual Firestore SDK
with synthetic RPC conflicts, plus HTTP gate and strict-transport checks. No live
user connection or resource permission is changed by these tests.
