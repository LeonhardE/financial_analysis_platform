# Agent connections and reports

Personal Agents use the host-owned credential route through the existing Hub service.
Muse and ChatGPT have separate connections and independently replaceable credentials.
No Policy service, dedicated Executor service, VM, public TCP proxy or new project is
required. See [transport boundaries](transport.md) and the
[Hub Agent client](../../../services/agent-hub-service/docs/agent-client.md).

## Persistent owner flow

The workspace reuses its ordinary authenticated Owner session and existing unlocked
Worker. Root, device signing and decryption handles stay in that Worker. New Agent
certificates and signed approvals are bounded to 90 days; the seven-day notice is
computed from the verified lease. The Owner explicitly authorizes each connection's
tasks and resource scope. OAuth only links an account and supplies bootstrap metadata.

When certifying fresh Agent keys, the new checkpoint omits Agent certificates whose
expiry is at or before its issuance time. Still-valid certificates, including the
previous credential's keys and other connections' keys, remain eligible until their
existing fences change. Earlier signed bundles and revocation high-water marks stay
intact, so historical report verification does not depend on expired keys remaining
in every new checkpoint. Storage, history and transport limits are unchanged.

### Persistent owner flow: Closed owner transport

The same-origin Firebase-verified BFF admits named credential, restoration, consent,
publication, connection history/revocation, plan and encrypted Inbox endpoints. Request
and response objects are closed and bounded. Root/Agent verification happens in the
Worker, including the historical registry snapshot for the original binding.

Native OAuth approval uses a branded source/origin/request/nonce-bound MessageChannel
to the original Hub window, limited to `pending` and `approve`. It severs the opener
before transporting a transient Google credential, fences account/visibility changes
and returns no OAuth code, token or callback URL to the application or Agent.

### Persistent owner flow: Persistent workspace consumer

The Agents page shows ordinary connection and task controls. Discovery follows visibility
and explicit Owner actions. Shared resources are refreshed explicitly and encrypted for
the current Agent before publication. Plan statements are verified independently and
are distinct from a report received by the Hub; they do not attest a native schedule.
Historical Inbox reads use original signed Run and recipient bindings, including after
reauthorization or permission withdrawal.

## Legacy foreground consent

The foreground connection panel, Owner grant bridge, runtime pairing/setup forwarder
and their creation RPCs are retired from the Web application. Existing signed formats,
Owner ciphertext and historical Inbox verification remain supported. Narrowing and
archive/deletion controls retain their original boundaries.

## Foreground helper release

Frozen helper releases and required third-party notices remain available to compatibility
fixtures for historical signed formats. They do not provide a current authorization UI
or a fallback from failed personal Agent authorization.

## Retired independent executor route

The independent Policy/TEE Owner ceremony, executor-specific BFF mapping and persistent
browser runtime enrollment are removed. Old-route design and execution evidence live in
local archives. No new deployment should recreate those services or infrastructure.

## Agent-owned credential pairing foundation

The Worker verifies the encrypted public offer against the exact Owner, vault, native
client, provider, issuer, setup lifetime and expected credential generation. It produces
an Owner-signed binding/approval and an encrypted activation for the host's temporary
pairing secret. Registry admission precedes the Hub's atomic credential replacement.
The Agent verifies the trusted Root anchor before activation. Preparing a candidate does
not invalidate the current credential. Exact sealed originals and operation receipts
resolve unknown outcomes before another approval is attempted.

## Personal Agent authorization and recovery

The Agents page uses the Agent-owned route for Muse and ChatGPT. The Owner signs in,
unlocks the existing library with their Passkey, reviews the Agent link, and authorizes
tasks. It displays a connection state, expiry date, seven-day reminder and reauthorization
action. Private Agent keys, fingerprints, certificates and recovery files are not part
of the product flow. The temporary pairing fragment is removed from the URL immediately
and retained only in memory for that authorization.

Connection duration defaults to 90 days, with an optional 15-minute temporary
connection. The Owner Worker accepts only these two choices and signs the selected
lifetime within the existing 90-day maximum and certificate expiry. A pending sealed
approval keeps its original duration through retries, lock and resume. The UI freezes
that choice while pending and displays the time for near-term expiry. No recovery
file, key setup or new service is involved.

Reauthorization verifies the original Root bindings, signed leases and immutable consent
receipts across the Hub's bounded predecessor chain. It restores only continuing access
that remains approved, at the current resource incarnation/epoch and an allowed revision.
A newer revocation blocks older approval; restoration never broadens selected history.
Task assignments must still refer to a verified predecessor binding. Assignments to
another Agent are not moved by recovery. Historical Inbox decryption remains available.

An interrupted confirmation first uses its exact sealed original and original operation
receipt. A replacement link can archive an uncommitted local credential journal only
once its original ten-minute setup is expired, after checking its original receipt.
The encrypted original is retained internally; no user-managed recovery artifact is
required. An unfinished approval can also be continued from the connection row.

Agent actions use the same cancellable admission-aware transport for the initial vault
read and refreshes around registry admission. A marked pre-forward denial may wait and
retry once within the original action deadline. Refresh responses still pass the existing
bounded parser, Owner/session fences and Worker verification before approval proceeds.
Generic errors and unknown write outcomes do not acquire retry permission.

Discovery and information sharing run on page visibility or explicit Owner actions;
there is no periodic API polling or automatic background resource publication. A native
plan report is distinct from a report actually received by the Hub. Real Agent host
retention and native schedule execution still require the separate live validation stage.

## Provider connection management

The Agent management page groups each provider into one current card and a folded
history. A canonical slot selects its exact verified credential reference. Before
migration, one live credential may be shown; multiple live legacy credentials
require review and never acquire an arbitrary winner. Expired history does not
contradict the current card. Task links use in-workspace navigation to preserve
the unlocked Worker. Claude and Gemini are explicitly unavailable. Provider badges
are first-party typographic marks with adjacent text, without remote artwork or
third-party logo dependencies.

When the existing provider-slot capability is enabled, a fresh Agent offer is
reviewed against the complete current retirement inventory. The Worker seals the
provider approval and credential approval together under their single original
operation ID. Registry admission precedes the Hub's atomic provider command.
Unknown outcomes recover that original provider receipt; they never fall back to
the old per-connection writer. Reconnecting replaces the current credential while
leaving task selections empty and requiring explicit fresh grants in the task
center. Historical reports and old public verification records remain available.
When the capability is disabled, existing installations retain the compatible
credential flow. This release changes no rollout flags or production records.

Connection display readiness is separate from connection state. Both the verified Owner
snapshot and provider slots must load for the current unlock generation before the UI can
show a connection as absent or offer reconnection. Initial reads show an animated loading
badge; failed reads show an unavailable state with retry. Refreshes retain the last loaded
snapshot and mark it as updating or stale on failure. These display snapshots never grant
access. The four independent capability/listing reads use the existing two-transport display
pool; credential, Root and authorization checks keep their fresh-read requirements. No timer,
background poll, automatic authorization or additional cloud capacity is introduced.
