# Snapshot and receipt read path

Normal latest and explicit snapshot reads use two Firestore BatchGet phases:
current authority/lifecycle (and the head when resolving latest), followed by the
selected ciphertext record. Current owner/source authorization is validated before
fetching ciphertext; retained proof, receipt, epoch and lifecycle checks remain.
A pending lifecycle mutation can require its additional current record.

Original upload receipt reads batch authority/lifecycle, then the vault-bound
operation and cancellation ledger. Cancellation associations still load and verify
all required original records; batching does not waive any fence or proof.

Repeated full-document reads share only the current transaction attempt's snapshot,
including confirmed absence. The detached cache is bounded to128 entries/8MiB;
complete response validation precedes admission. Pending writes retain the original
read snapshot. Every request and conflict retry starts with empty read state, so
new revocation/deletion cannot be masked by an earlier successful read. Read-only
prefetch views are not used as write authority or retained across transactions.

Real Firestore SDK tests use synthetic RPCs to check batch counts, unchanged
responses, current revocation, conflict retry, malformed streams and cache limits.
They make no cloud or business request and cannot establish production latency.
API500ms/UI2s remain upper acceptance bounds to measure end to end in a later
user-authorized window. No background worker, keep-warm, resource or capacity
change is needed.

## Combined owner read with matching public preconditions

`POST /api/v3/holdings/sources/{sourceId}/view/query` combines the original owner
metadata and selected snapshot DTOs in one transaction. The request is exactly
`{contractVersion,expected}`. `expected` contains exactly `vaultId`, `rootJwk`,
`rootKeyId`, `registrySequence`, `checkpointDigest`, `keyEpoch`, `resourceRef`,
`sourceEpoch` and sorted distinct `recipientKeyIds` (at most eight). The JSON body
is limited to 16 KiB and the existing five-second receive deadline. The existing
Google owner identity alone selects storage; delegation, authority-installation,
author and idempotency headers are refused. Responses and errors are `no-store`.
The BFF's Cloud Run identity header remains compatible with platform admission;
it does not replace the independent Google owner check or select storage.

A consuming client may attempt this read only immediately after its original
Worker has accepted a fresh Hub vault read, using that exact verified vault/source
and its current Worker owner-key selection. The server fully verifies the local
authority and reads authority/head/lifecycle in one batch. It compares the full
public Root and all checkpoint/source preconditions, recalculates live device
writers and device/recovery recipients, and requires the replica's ACL to match.
Caller values are read preconditions, never authority enrollment or an instruction
to update an epoch, Root, ACL, lifecycle or snapshot. The endpoint performs no
Hub synchronization or writes.

The exact response is `{contractVersion,profile,vaultId,sourceId,mode,metadata,snapshot}`,
with profile `folioview.owner-holdings-view.v1`:

- `complete` includes the original metadata and original snapshot response, using
  the same snapshot validation helper as the existing GET. A genuinely empty
  source has revision zero, null snapshot pointer and `snapshot:null`. A retained
  historical owner snapshot keeps its original receipt epoch; it is never promoted
  into a current-epoch agent projection.
- `sync_required` has both DTOs null. A valid but mismatched precondition, live ACL
  mismatch, non-active lifecycle or pending mutation requires the original
  metadata-first recovery/synchronization flow. In particular, Portfolio may be
  one epoch ahead of Hub while revoking; a client must inspect that state before
  attempting the old sync, exactly as before.
- `separate` has both DTOs null and is allowed only when both original DTOs are
  individually valid and within their original budgets but too large together.
  The client uses the original reads. Storage, Root, schema and snapshot failures
  are errors and cannot be hidden as this size hint.

Normal complete reads use one authority/head/lifecycle batch and one snapshot
read, with one authority-history verification. Empty sources and transport hints
do not fetch ciphertext. Every transaction retry re-reads current data and repeats
verification. Clients must retain the original journal/outbox recovery, receipt,
scope/cancellation and Worker decryption checks before publishing either result;
a local false `hasPending` flag alone does not prove that journals are empty.
Read-only or unapproved-device flows, writes, unknown acknowledgements and other
legacy callers retain their original protocol. Existing routes remain available,
so the producer can be deployed before a separate Web consumer.

[Service entry](../README.md)
