# Persistent Agent browser runtime

The opt-in 1.0.0 runtime consumes the existing native account-link, identity,
resource-consent, publication, frozen-Run and encrypted-result producers. It is
additive to the byte-unchanged legacy foreground helper releases. It does not
create a native Muse schedule, grant resource rights or attest protected-host
lifecycle by itself. All new deployment gates remain off until real acceptance.

## First connection and daily use

1. Native OAuth links only `runtime:connect`. Its same-Hub-origin account page
   uses an explicitly configured owner origin, original window source, random
   nonce and one MessageChannel for two fixed account-link operations. A transient
   Google credential goes only to the exact first-party cookie-bound API. The
   native callback code stays in that Hub page and is never returned to the model.
2. The native bootstrap returns a fixed runtime URL with the public actor/root
   descriptor. The Worker creates or restores nonexportable ECDSA/ECDH CryptoKey
   handles and signs one immutable nonce-bound offer. Native confirmation proves
   client association, not financial authority or protected-host attestation.
3. The owner Web consumer must explicitly Root-certify/register the offered
   keys, approve selected logical resources and publish selected task/resource
   copies. This release does not automate those owner decisions or carry Root keys.
4. Later runtime instances restore the same profile. A fresh signed session
   independently verifies registry history, original identity binding and the
   complete signed consent chain. Ordinary OAuth expiry is not a permission reset.
   Lost private keys produce repair state; no implicit replacement or reapproval.

## Closed API and retries

The checked controller exposes `window.folioview`: `status`, `pairingStatus`,
`listTasks`, `dueTasks`, `beginRun`, `readInput`, `saveReport`, `resultReceipt` and
`clearPlaintext`. The actual Worker accepts only the corresponding closed domain
requests. There is no raw key, generic signature/decryption/storage/fetch endpoint
or caller-selected authority mode. Root/owner credentials never reach that Worker.

Each request proof binds the actual fixed HTTPS origin, path, method and canonical
business body. Public server time plus a monotonic elapsed clock avoids client
wall-clock skew. An authorization failure permits one time refresh and fresh proof
with the same business request; it never deletes keys or prompts owner Passkey.

Root task authority and exact resource permissions are checked before decryption.
Runs freeze the task authority and exact input versions. Report output follows the
decrypted task's output specification, is encrypted to the current owner recipients,
and is persisted as original ciphertext before submitting. Concurrent retries and
a restart reuse that ciphertext. Receipt matching is independent of readable inputs,
so an already committed result remains recoverable after resource revocation.

## Scheduling

`dueTasks` computes calendar slots from the verified encrypted task. Daily,
weekday and weekly schedules use an explicit IANA time zone and grace period.
A slot's trigger ID excludes retries, task version, connection and UTC offset.
DST folds therefore use one stable Run trigger; nonexistent local times are skipped.
No open-page timer stands in for native scheduling. Desired schedules, actual Muse
installation and observed run/result receipts must remain distinct in the Web UI.
Native plan creation, isolation/lifecycle and real cross-day checks await the owner.

## Distribution and rollout

Fixed `/agent/v3/runtime/...` routes serve only the allowlist. Source/session/core
files are not generic public endpoints. Versioned Worker bytes are checked against
the local integrity manifest before creating a blob Worker; CSP, same-origin resource
policy, no-store and no-referrer apply. Public config exposes only the configured
Hub issuer, owner origins, registered callback URLs, clock and distribution hashes.

`HUB_PERSISTENT_RUNTIME_ENABLED`, native transport and native MCP gates are required
to serve the runtime. Financial calls retain all existing independent identity,
resource, publication, execution and result gates. No real account permission,
connection, task or schedule changes occur as part of a code deployment.

The owner frontend, current encrypted publication hooks, historical persistent Inbox
reader, actual provider plan setup and final deployment index prerequisites are
separate single-target follow-ups; this producer alone does not complete HUB-009.
