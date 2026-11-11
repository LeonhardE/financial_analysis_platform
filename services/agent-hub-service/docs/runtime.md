# Personal Agent runtime and native integration

The current execution host is the user's Muse or ChatGPT environment. Use the
[reviewed private client](agent-client.md), [credential lifecycle](persistent-api.md#agent-owned-credential-lifecycle)
and [Web authorization](../../../apps/web/docs/agent-integration.md). The old fixed
browser runtime is retired, including its Worker, IndexedDB key profile, controller
page, setup bridge and recovery API.

## Account transport

Native OAuth grants only `runtime:connect`, with a preregistered client/provider and
fixed callback. A dependency-free account-link page at `/agent/v3/account/consent.html`
opens the original trusted Owner page. Its source/origin/request/nonce-bound channel
permits only account `pending`/`approve`; it never stores Agent credentials. The old
account-consent page URL is a narrow alias for finishing an already-issued window.
All browser Agent runtime/config/setup URLs remain absent.

## First pairing

Only explicit user connection or reauthorization creates a ten-minute setup. The
private host creates fresh signing/encryption keys and a temporary pairing secret,
submits an opaque encrypted public offer, and shows the Owner its authorization link.
The existing Owner login and decryption Passkey approve the exact client/provider,
vault, generation and reviewed scope. The Agent verifies the encrypted Root anchor
and current lease before activating its locally stored keys.

## Cryptography and storage

See [private client storage](agent-client.md) for Node/POSIX prerequisites, private
permissions and load-only failures. Private keys stay on the host; Hub stores public
records and ciphertext. Host tools can read the host's private files under the accepted
personal trust model. File retention and native schedule availability are not guaranteed
by the platform and require live host validation.

## Execution and schedules

Native Agent schedules invoke the fixed client operations to fetch/decrypt approved
inputs, run analysis and return Owner-encrypted reports. No browser tab, platform VM,
TCP proxy or scheduler is required. A stored plan statement is the Agent's signed report;
actual Hub Run/result receipts are separate evidence and do not attest a native task.

Missing/corrupt/expired/rejected credentials stop execution and ask the user to authorize
again in FolioView. Reauthorization restores only still-approved scope and original
assignments after verifying the signed lineage. No recovery codes/files are given to
users for Agent credentials. Original Owner history and revocations remain intact.

## Distribution and rollout

`account-link/build.mjs` copies only reviewed first-party account modules and produces
a hash manifest. No crypto SDK or browser key worker is bundled there. The separately
pinned private client is distributed by the existing Hub image. Feature gates default
off; the service scales to zero under the existing deployment structure. Deployment,
real host compatibility and cross-day/native acceptance require a separate approved window.
