# Persistent owner publications

The owner-only `/api/v2/persistent-content` producer accepts the separate shared
`folioview.persistent-content.v1` carrier. Task/resource publications require the
pinned Root signature. The service interprets public routing and fences, never
financial plaintext or a private key.

Publication writes require `HUB_PERSISTENT_PUBLICATIONS_ENABLED=1`, enabled
persistent identities/resource consents, and configured registered clients. They
remain disabled by default. This does not enable execution or extend legacy OAuth.

`/{vault}/connections/{connection}/publications` commits the original carrier and
receipt atomically. `.../operations/{operation}` retrieves that original receipt.
`/{vault}/tasks/{task}/authority` returns the current task authority for owner CAS.
Unknown outcomes must reuse the same operation and carrier; never reseal on retry.

Task authority has one owner/vault/task slot across all Agents. The exact current
task version, active status, execution epoch, source bindings and owner ciphertext
fingerprint are checked. Each replacement retains the authority ID and increments
its version with the prior authority digest. The task content revision remains
the actual producer task version, including explicit reassignment of that version.

Resource publication accepts the current trusted catalogue version only. It checks
the exact reference/incarnation, source epoch, permission ID/epoch and revision
floor under current Root-approved policy, then checks source fences in the same
transaction. A version may skip intermediate revisions. Publishing an older
selected-history version requires a future trusted historical producer API and is
not provided here. Content `revision` equals its source revision.

Publication IDs are globally immutable per owner/vault. Source heads are per
connection/reference; task heads are global across connections. Individual history
documents avoid an ever-growing per-connection array. Opaque `carrierJson` must be
exempted from Firestore indexing before enabling the producer.

Every future Agent consumer must authenticate a current exact request proof and
recheck the parent connection, current identity/certificates, task authority/head,
resource permission epochs and source fences in its own transaction. Historical
receipts, identity recovery receipts and delivery existence are not authority.
