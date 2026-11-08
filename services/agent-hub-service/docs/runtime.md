# Persistent runtime and Muse integration

This is the current implementation route for a lasting Muse connection. Native OAuth retains
account connectivity; the protected runtime retains its restricted Agent identity; Root-approved
resource consent controls financial access. Ordinary token expiry and owner sign-out do not
revoke those permissions. A new login still requires one owner Passkey unlock in supported
browsers. See [persistent APIs](persistent-api.md) and [Web integration](../../../apps/web/docs/agent-integration.md).

The runtime and owner consumers are shipped, with feature gates default off. Native scheduling,
protected-host restart and cross-day encrypted delivery remain real acceptance requirements.
The [legacy foreground path](legacy-foreground.md) retains its original session limits.

## Account transport

This producer is separate from legacy v2 OAuth. Its issuer is
`{configured Hub origin}/oauth/persistent`, protected resource is `/mcp/v3`, and
sole scope is `runtime:connect`. Native account credentials are intended only for
runtime bootstrap/status. Financial reads, Run creation and report publication
still require independent current certified Agent request proofs and Root task/
resource authority; native credentials cannot become a legacy grant.

Authlib owns authorization code, PKCE S256, registered callback/client checking,
refresh rotation and revocation. `NativeUnit` remaps only the five existing Authlib
credential table names to isolated `hub_native_oauth_*` collections; it does not
remap the owner-indexed original parent connection or authority tables. The legacy
scope set, credential namespaces, absolute lifetime and financial verifiers remain
unchanged. Native parents are omitted from the legacy connection DTO and have
their own owner history/disconnect surface.

New access credentials last ten minutes. Refresh credentials rotate and have a
180-day sliding inactivity deadline, rather than a connection-lifetime deadline.
Each transaction checks current registered client, resource, family and original
owner/vault/connection/authorization. Family fields and current refresh hash prevent
forks. Reusing a refresh/code stops the family. Account reauthentication can reuse
the active same-owner/client/vault parent ID and retains already Root-approved
Agent identity and logical-resource consent. It creates no resource approval.

Explicit native revocation/disconnect terminally stops the matching current parent
and therefore current Agent PoP requests. A credential from an older repaired
authorization can stop only its old family. Ordinary expired/replayed account
credentials do not erase Root permission; metadata reports account repair needed.

Public protocol routes are `/oauth/persistent/{authorize,token,revoke}` with
RFC metadata at `/.well-known/oauth-authorization-server/oauth/persistent` and
`/.well-known/oauth-protected-resource/mcp/v3`. Strict bounded form parsing rejects
duplicate/unknown parameters. Native and legacy credentials cannot be exchanged
across their resources or storage namespaces.

Owner consent is `/api/v2/persistent-account-authorizations/{request}` and its
`/approvals` child, authenticated with the existing Google owner and additionally
bound to exact same-origin Hub Origin and one secure HttpOnly SameSite=Lax native
flow cookie. Approval allows only the selected owned vault, never incoming scope,
task, public key, owner or resource overrides. A per-request cookie-derived AES-GCM
cache preserves the original callback for retries without storing plaintext codes
or callbacks. Every candidate encryption, including transaction retries, uses a
fresh nonce. Long-lived credential values are stored only as hashes.

`GET /api/v2/persistent-connections` and `POST .../{connection}/revocations` use
normal Google owner authority and remain available without OAuth issuance/config.
They expose native account state separately from financial permission state.

Issuance requires `HUB_PERSISTENT_TRANSPORT_ENABLED=1` and the existing registered
OAuth configuration. It is off by default. The capabilities endpoint intentionally
reports `runtimeReady: false`. The same-Hub fixed asset
`/agent/v3/runtime/account-consent.html`, native MCP bootstrap and Web consent bridge
are implemented consumers. The actual deployment has a separate owner Web origin;
its existing login/global unlock must be reused through a fixed-origin bridge,
without relying on cross-site cookies. No protected-host lifecycle or trusted
first-pairing production readiness is asserted by this OAuth producer.

## First pairing

The gated `/mcp/v3` surface accepts only the native `runtime:connect` profile and
lists two tools: `open_persistent_runtime` and `confirm_runtime_offer`. It cannot
read financial resources, create Runs, publish reports, return credentials, accept
key/JWS/network parameters or replace the financial Agent proof APIs. Public actor
metadata is explicitly projected; Google owner login IDs do not leave the tool.

Bootstrap reuses one pending 30-minute setup intent per native owner/vault/connection
and current authorization. It generates a server nonce. Existing registered Agent
identities return the canonical resume URL and public descriptor instead of creating
another setup or key. Revoked identity state is terminal. The client must report lost
local private keys explicitly; bootstrap is not permission to generate replacements.

The fixed browser SDK directly submits one ES256 self-proof at
`POST /agent/v3/runtime/setups/{intent}/offers`. Its closed payload binds exact actor,
native authorization, nonce, time, distinct P-256 public signing/encryption keys and
derived Agent ID. Private JWKs and scope overrides are rejected. Exact signed-input
retries return the original offer fingerprint; another offer cannot replace it.

Native MCP confirmation accepts only the opaque intent ID/fingerprint, bound to the
same authenticated client and authorization. It records client association, explicitly
`protectedHostAttested: false`. Self-signature, release labels and client association
are not evidence of protected browser/VM lifecycle or independent first-pairing trust.

Google-owner `GET /api/v2/runtime-setups/{intent}` supplies the public offer for review.
`POST .../{intent}/completion` records an observation only after native confirmation
and an already committed current Root-certified Agent identity with exactly those
keys. Root certificate creation and resource/task approvals stay separate existing
owner cryptographic operations. Completion never issues or broadens authority.

The owner Web reuses its existing Google session and shared login unlock.
The browser runtime is a separate fixed Hub asset; it must preserve nonextractable
keys, monotonic Root/policy pins and original encrypted outboxes. The consumers are implemented; real protected-host/first-pairing/cross-day acceptance
remains pending.

`HUB_PERSISTENT_MCP_ENABLED=1` plus native account configuration enables this producer.
Both default off; activate only through reviewed configuration for owner-led acceptance. Startup
misconfiguration keeps health independent of Firebase/ADC. The exact v3 route is
installed before the legacy `/mcp` mount; legacy v2 transport/auth stays unchanged.
MCP Host/Origin and resource-metadata challenge use the base Hub origin, while the
OAuth issuer retains its separate `/oauth/persistent` path.

## Cryptography and storage

This additive 1.0.0 browser foundation implements the persistent Agent/content/resource
consent contracts. It does not change or reissue any legacy helper release. It has no
HTTP endpoints, OAuth token holder, model-facing RPC, automatic enrollment or permissions.
The fixed runtime Worker and owner Web consume this foundation through the shared
`packages/encrypted-workspace` bundle. Feature gates default off.

### Cryptography and storage: Authority

- Root-signed append-only registry pages, original device-signed identity bindings,
  current Agent certificates and pinned checkpoint digests are independently checked.
- Original signed resource controls and producer source observations reconstruct the
  exact consent aggregate. Current/future version approval is scoped to a logical
  resource/incarnation/epoch; revocation is terminal for that permission ID. A new
  explicit approval uses a new ID. Lower/forked known consent versions are rejected.
- Root task/resource publications and Agent reports bind exact JWE AAD, ciphertext
  digest, signer, recipients, business fields and immutable Run inputs. Structure or
  successful decryption alone is not authority. Historical owner reads are a trusted
  client operation with issuance expectations, never a model-selected HTTP purpose.
- Request proofs bind one fixed HTTPS origin/path/method/body and a fresh 120-second
  nonce window. They do not replace the server's current fences and operation CAS.

### Cryptography and storage: Storage and host boundary

`RuntimeStorage` persists ECDSA/ECDH private **CryptoKey objects with extractable=false**,
public identity/checkpoint pins and original encrypted outbox carriers. It checks both
key pairs after restore. Concurrent first initialization is create-only, and missing
keys cause an explicit lost-profile state instead of silently generating a replacement.
Root/owner keys, CEKs and plaintext task/resource/report content are not persisted.

The closed runtime Worker owns these handles. Internal primitives accept key handles
for composition and are not a public arbitrary-sign/decrypt/storage API. Native client
confirmation is not protected-host attestation. Real Muse isolation, browser/profile
lifecycle and cross-day acceptance remain required before production enablement.

### Cryptography and storage: Reproduce

Use the exact runtime package lock and `npm ci`, then `npm run build` in `runtime/`.
Build-time AJV compilation emits standalone validators; checked browser bundles need
no installed packages, dynamic code generation or CDN modules. `integrity.json` pins
all source, schema, lockfile and bundle bytes. The bundled schemas are a collision-checked
snapshot of the four corresponding shared schema documents at this release.

The Hub tests verify live Python↔Node encryption/signatures for all five content types,
original approval/revocation/reapproval chains, current proof binding, storage restart,
concurrent initialization, nonexportability, immutable encrypted retry and isolated
bundle import. No real account data or private key fixtures are stored in the repository.

## Execution and schedules

The opt-in 1.0.0 runtime consumes the existing native account-link, identity,
resource-consent, publication, frozen-Run and encrypted-result producers. It is
additive to the byte-unchanged legacy foreground helper releases. It does not
create a native Muse schedule, grant resource rights or attest protected-host
lifecycle by itself. New feature gates default off; reviewed activation and real owner-led acceptance are required.

### Execution and schedules: First connection and daily use

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
   copies. The Web consumer performs the reviewed enrollment and encrypted publication; Root keys
   remain in the owner Worker.
4. Later runtime instances restore the same profile. A fresh signed session
   independently verifies registry history, original identity binding and the
   complete signed consent chain. Ordinary OAuth expiry is not a permission reset.
   Lost private keys produce repair state; no implicit replacement or reapproval.

### Execution and schedules: Closed API and retries

The checked controller exposes `window.folioview`: `status`, `refreshConnection`, `pairingStatus`,
`listTasks`, `dueTasks`, `beginRun`, `readInput`, `saveReport`, `resultReceipt` and
`clearPlaintext`, `planStatus`, `reportPlan` and `retryPlanReport`. The actual Worker accepts only the corresponding closed domain
requests. There is no raw key, generic signature/decryption/storage/fetch endpoint
or caller-selected authority mode. Root/owner credentials never reach that Worker.

Every HTTP request includes `X-FolioView-Contract`, including public setup/config
reads. Actual FastAPI routing is exercised by the synthetic Node runtime peer.
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

### Execution and schedules: Browser controls

The fixed `controller.html` also exposes semantic buttons, selects and forms for protected
browsers that support DOM interaction but cannot execute page JavaScript. It calls only the
same closed Worker operations; native credentials, private keys, Root enrollment and resource
approval are absent. Initial pairing creates or restores the existing profile once. “Check
connection status” reads pairing completion or refreshes the certified session, without rerunning
bootstrap or replacing keys.

After owner approval, read the approved task list and select a task. For manual execution, use
a stable Muse execution identifier (22–128 URL-safe characters); retry with the same identifier.
“Check due tasks” binds its execution buttons to the original verified slot trigger. Read only
the selected Run's listed inputs, fill the report sections requested by its frozen task, then
save the encrypted report and check its receipt. Report retries retain the original frozen draft;
a pending save blocks a second Run until the original result is reconciled. Clearing the page's
plaintext or leaving it clears visible private fields and ignores late responses, preserving
identity and encrypted outboxes.

The scheduling controls report an actual Muse plan reference/status and recover the original
pending observation. They never install a native plan or run a page timer. Desired task schedules,
Agent statements and Hub run/result receipts remain distinct; a successful observation does
not attest native schedule installation or a protected-host restart.

For native first-pairing association, the public setup status GET requires
`X-FolioView-Contract: folioview.agent-workspace.v2.0` and rejects Authorization,
idempotency/delegation headers and query parameters. It does not use cookie authority. Read `offerFingerprint` from
the original setup response; use native credentials only on the separate MCP confirmation
request. Bootstrap returns the connection under `actor.connectionId`, the fixed URL under
`runtimeUrl` and the original intent under `setup.intentId`.

### Execution and schedules: Scheduling

`dueTasks` computes calendar slots from the verified encrypted task. Daily,
weekday and weekly schedules use an explicit IANA time zone and grace period.
A slot's trigger ID excludes retries, task version, connection and UTC offset.
DST folds therefore use one stable Run trigger; nonexistent local times are skipped.
No open-page timer stands in for native scheduling. Desired schedules, actual Muse
installation and observed run/result receipts must remain distinct in the Web UI.
`reportPlan` records a signed Agent statement only after Muse actually creates,
pauses or removes its native plan. It hashes a bounded opaque native plan reference
inside the Worker, never transmitting the raw ID, schedule, URL or credentials.
`planStatus` verifies the original statement against its Root-issued identity and
shows it separately from current desired task authority and Hub run/result receipts.
An unknown response keeps the exact self-signed statement across restart; retry uses
a fresh request proof and preserves operation ID/body. Per-connection reporting
quota does not consume run budget. Reports cannot enable or expand financial rights.
No response claims native schedule attestation. Native plan creation,
isolation/lifecycle and real cross-day checks await the owner.

### Execution and schedules: Distribution and rollout

Fixed `/agent/v3/runtime/...` routes serve only the allowlist. Source/session/core
files are not generic public endpoints. Versioned Worker bytes are checked against
the local integrity manifest before creating a blob Worker; CSP, same-origin resource
policy, no-store and no-referrer apply. Public config exposes only the configured
Hub issuer, owner origins, registered callback URLs, clock and distribution hashes.

`HUB_PERSISTENT_RUNTIME_ENABLED`, native transport and native MCP gates are required
to serve the runtime. Financial calls retain all existing independent identity,
resource, publication, execution and result gates. No real account permission,
connection, task or schedule changes occur as part of a code deployment.

The owner frontend, approved-version publication hooks and persistent Inbox reader are
implemented. Infrastructure declares opaque-field exemptions and a default-off activation
input. Actual provider plan installation, protected-host lifecycle and cross-day results
still require real acceptance; code delivery does not close those checks.
