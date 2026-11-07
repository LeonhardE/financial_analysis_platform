# Persistent Agent execution inputs

This opt-in producer consumes persistent Root publications and resource consent.
It does not reinterpret a legacy grant, extend an OAuth family, decrypt content,
create a scheduler or use an identity-recovery receipt as a bearer capability.

All endpoints are POSTs under
`/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}`.
The closed body is `{contractVersion, proof, request}`. `proof` is the shared
current Agent request proof over the actual POST path and JCS SHA-256 of the exact
business `request`. Ambient Authorization, delegation and idempotency headers are
rejected; operation identity belongs inside the signed business body. Existing
Cloud Run workload ingress is a separate platform concern.

`session`, `consent-receipts`, `tasks` and `task-input` supply public identity,
Root authority history and assigned task ciphertext for independent trusted-client
verification. Root bundles are public proofs, never a Passkey or private key.
Persisted clients must pin Root and monotonic checkpoints/consent heads. A server
response alone must not establish a fresh trust anchor.

`runs/begin` accepts task ID, trigger ID, operation ID and the expected task
publication fingerprint. It authenticates before the source RPC, then repeats all
current checks in the allocation transaction. It selects current trusted source
versions and current published ciphertext, checks exact task authority, current
resource permission epochs and reverse invalidation fences, and freezes the
manifest. The Run ID is deterministic across connection reassignment for the same
owner/vault/task/trigger. Operation reuse with different intent is a conflict.

`runs/receipt` retrieves the original manifest without producer RPCs. It does not
extend the Run deadline or grant input access. `runs/input` reauthenticates and
rechecks current task authority, parent, permission epochs and source fences before
returning one exact frozen publication. Normal source version advances do not
rewrite old input or invalidate an otherwise still-authorized in-flight Run.
Unpublished newer source versions block a new Run until the owner client publishes
the corresponding approved encrypted copy.

Every Run is limited to two hours and allocation to 20 per connection/minute and
200 per owner/day. Original-operation replay does not consume another quota slot.
Native schedule occurrence IDs must be stable across retries; this producer does
not assert a native plan has been installed or observed.

Execution requires `HUB_PERSISTENT_EXECUTION_ENABLED=1` plus publication, consent,
identity and registered-client readiness. All flags remain off in production until
runtime/owner consumers and real lifecycle acceptance are ready. Firestore must
exempt the opaque Run manifest and authority-history fields before activation.
Result writeback is deliberately a following independently verifiable change.
