# Persistent report writeback and owner history

`/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/runs/submit`
consumes the same exact current request-proof transport as persistent inputs.
The business body is `{runId, operationId, envelope}`; the shared result envelope
must match the deterministic result ID, Run manifest, exact task authority and all
current owner device/recovery recipients. A new report also requires the current
Root task output policy `owner_inbox`, active parent and Agent keys, live resource
permission epochs/source fences, and a non-expired Run. It never interprets
private report content or accepts a plaintext fallback.

The first report is immutable. Report revisions are not provided in this basic
producer. A second distinct initial publication is rejected. Original-operation
retries return the unchanged receipt before producer RPCs, including after Run
expiry or resource revocation; they do not authorize new writes or disclose
plaintext. `runs/result-receipt` retrieves the saved metadata receipt under the
current Agent identity. Disconnecting/revoking that identity stops Agent requests.

The receipt, opaque content, metadata head, linked index page and submitted Run
state commit atomically. Request proof and recipient validity are checked again
at the committing write. Index pages hold at most 64 report IDs and point to the
previous page. Pagination uses owner/vault-bound page/offset selectors; no query
is performed on ciphertext, and there is no lifetime owner report array limit.

Google-owner history is deliberately a separate service with no Agent submit or
authentication method and no OAuth configuration dependency:

- `GET /api/v2/persistent-results/{vault}`: metadata and bounded pagination.
- `GET /api/v2/persistent-results/{vault}/{result}`: exact original envelope,
  receipt, manifest, issuance Agent snapshot/binding and public Root registry history.
- `PATCH .../{result}/state`: existing device-signed `result_state_update` control,
  exact operation identity and metadata CAS for read/star/archive state.

History does not require a current Agent connection, permission or unexpired Run.
Trusted owner clients must independently pin Root, verify the public authority
chain and select the exact issuance checkpoint/Agent snapshot before historical
signature/decryption checks. A historical receipt or issuance snapshot never
becomes current Agent authority. Original task/resource publication proofs can be
read through the existing owner operation endpoints without reauthorizing an Agent.

Writes require `HUB_PERSISTENT_RESULTS_ENABLED=1` and all execution prerequisites;
they remain disabled by default. Firestore indexing exemptions for opaque content,
Run manifests and linked index arrays must precede activation. Real runtime and
cross-day acceptance remains separate from synthetic producer checks.
