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

[Service entry](../README.md)
