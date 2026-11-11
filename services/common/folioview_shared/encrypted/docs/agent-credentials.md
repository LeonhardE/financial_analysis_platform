# Agent-owned credential leases

The additive `folioview.agent-credential.v1` profile places a bounded Owner-approved
lease over an immutable `folioview.persistent-agent-identity.v1` binding. It does
not widen the old binding's create-only semantics or authorize any financial
operation by itself. Default duration is 7,776,000 seconds (90 days), maximum is
90 days, and the notice window is 604,800 seconds (7 days). Shorter explicitly
approved lifetimes support controlled acceptance; existing OAuth access-token
refresh is independent of this lifetime.

`approve_credential` / browser `approveCredential` verify the current Root registry,
an authorized Owner device signature, exact identity, audience, setup intent,
previous credential fingerprint, next generation, distinct new Agent identity and
signing/encryption keys, freshness and key-certificate expiry. Generation one
requires an unused logical connection slot. Reauthorization of an existing slot
requires its current record, even when expired or revoked. Never delete that
record to obtain generation one again. Fresh keys are necessary for recovery;
renewal cannot be signed by the Agent itself.

The consumer must independently verify the Owner's identity binding and trusted
first-key handoff. A recommended closed handoff is a reviewed host helper with
separate signing/encryption keys and a random 256-bit pairing secret. The native
OAuth context fixes client/connection/Owner and a short-lived, single-use intent.
The helper encrypts its public-key offer to that secret; the Owner receives the
secret through the authorization URL fragment, decrypts the offer locally, then
certifies those exact keys after Passkey unlock. The server never receives the
fragment secret or private keys. The Owner response, including independently
pinned Root/checkpoint and signed binding, is encrypted back to the same secret.
The helper checks the returned offer/intent/context before persisting activation.
Public-key transcription by a model, a supplied `verified` flag, or an unsigned
server key offer must not substitute for this handoff. This assumes trusted host
helper distribution and an authenticated native authorization context; it is not
hardware attestation or protection from a compromised Agent host.

Replacement must be one transaction: compare current generation/fingerprint,
consume the exact intent, archive the old identity/binding/lease, install the new
lease and return an immutable operation receipt. Preparation failure leaves the
old record intact. Exact retries return the original receipt, without restoring
that credential as current. A concurrent different replacement loses the CAS.
Do not erase revocation high-water marks, consent history or operation receipts.
A new identity needs new Owner-approved content/task grants and ciphertext;
old grants must not transfer merely because the connection ID is unchanged.

Every session, request and final Run write must resolve the authoritative current
lease and exact identity again, enforce expiry, audience and live connection,
and retain existing PoP, resource/task/action, source epoch and replay checks.
Never trust a cached lease or generation claimed by a request. Revocation cannot
erase plaintext or ciphertext already delivered. Owner-only historical reports
remain readable without an old Agent private key.

The UI needs only connection status, expiry/notice and one reauthorization entry.
A missing private file is observable by the host helper on its next execution;
an unauthenticated failure cannot change a server connection's state. Never issue
replacement credentials automatically on a missing-file error. These pure
contracts perform no storage, provisioning, deployment or native scheduling.
