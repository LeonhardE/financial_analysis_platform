# Trusted foreground controller

This HUB-009 code stage adds fixed browser distribution and orchestration, not a service that
executes with user keys. The existing P1 schemas, helper 1.2.0 Worker, OAuth, preparations, Run,
result/revision and receipt services remain the producers. No cloud resource or configuration is
created or enabled. Actual remote Muse host attachment and real consumer/production acceptance
remain within the existing ticket; same-browser MessageChannels are not a remote transport.

## Fixed surfaces and origin boundary

- `GET /agent/v2/controller/config`: public, bounded first-party metadata. Requires the adapter
  and OAuth flags and an explicit nonempty `CORS_ORIGINS` allowlist. It never constructs a store
  or credential client. Wildcards, duplicate/noncanonical origins, arbitrary query selection and
  non-loopback HTTP origins fail closed. Returned worker hashes describe distribution bytes and
  are not an independent trust source.
- `/agent/v2/helper/consent.html?request=<id>`: top-level transient OAuth consent shell. Future
  `HUB_OAUTH_CONSENT_URL` can select this same-issuer path in a separately authorized deployment.
- `/agent/v2/helper/controller.html`: separate foreground owning page. It stays distinct from
  the transient window that navigates to the registered OAuth callback. Fixed JS/CSS/HTML assets
  use no-store, nosniff, no-referrer and a restrictive CSP. No arbitrary asset/path loader exists.

The consent shell opens an explicitly configured Web origin with `agent_request` and
`agent_nonce`. An exact-origin/source, one-use nonce handshake transfers a MessagePort. The
`folioview.owner-consent-bridge.v1` port accepts only `claim`, `prepare_encrypted` and `decision`,
with the original request ID and closed bodies. This encrypted single-task bridge requires one
signed grant for approval; denial/cancellation require none. Legacy backend flows are unchanged.
Each request supplies a fresh **raw** Firebase ID token, used only as the Bearer for the exact
same-origin existing owner API request. The cookie is the real HttpOnly flow cookie and the
browser supplies Origin; no CORS relaxation, cookie copy or BFF flow-route proxy is introduced.

Requests are exactly `{id,profile,requestId,op,authorization,json}` and responses exactly
`{id,ok,data}`; failure data has only `code`. Credentials never reach URLs, DOM, storage, logs or
the model/helper port. 401/403 send a bounded safe error before closing the channel. The shell
checks the pending client against its configured callbacks and requires the exact success or
denial response fields and issuer. It navigates its own window; only `{completed:true}` reaches
Web, never an OAuth code, state or redirect URL. Web retains login, Passkey and independent pins.

## Owner helper setup and model roles

A Web-opened helper may pair with `owner_origin` and `owner_nonce`. The owner origin must also be
explicitly configured; the URL parameter is not trusted by itself. `folioview.foreground-owner.v1`
accepts only initialize, confirm_delivery, status and lock. Its MessagePort carries no Firebase
credential. After pairing the helper drops its public opener reference; the trusted peer remains
in a private closure for close detection. Paired pages remove manual owner controls from the DOM.
Status heartbeats at most every 30 seconds maintain a 90-second owner-presence lease. Expiry,
owner/window close when observed, explicit lock or page navigation terminates the Worker. This
lease never extends its original at-most-one-hour key TTL. Hidden helper pages clear private
views and pause model work, while owner metadata/setup can operate across ordinary popup focus.

A manual owner-assisted mode accepts a public card copied from an independently trusted Web
library: `{helperVersion,workerSha256,anchor,ttlSeconds}`. Anchor is the existing exact Worker
anchor. The controller verifies the independently supplied Worker digest before constructing a
self-contained Blob Worker. It returns only the closed public key offer with session/generation,
anchor, both public JWKs/key IDs and the key-export-rejected declaration. Web must independently
verify, present and root-register those public keys and sign the exact task/resource grant. A
reported declaration is not remote attestation. The selected-delivery pin is an independent owner
publication fact, never automatically copied from Hub metadata. Manual mode has no live remote
owner-window observer and makes no claim that remote Muse pairing is established.

The model-facing page can verify registry/preparation/Run ciphertext, decrypt approved inputs
and seal a report through the Worker. It cannot initialize pins, import/export keys, choose
arbitrary signing or network targets, supply an owner bearer, or acknowledge a model-pasted
receipt. Decrypted contents are React-free DOM text, never HTML, image or automatic URL loads.
The public manual page records prepared ciphertext locally but never labels it saved remotely.
Authenticated receipt confirmation and revisions require a trusted host integration.

## Authenticated host transport and durable ciphertext recovery

The programmable controller accepts an opaque OAuth access token only through trusted host code
in memory, never its model/public UI operations. Named preparation, registry, object, Run, inputs,
result/revision and receipt methods derive fixed same-issuer paths, bounded bodies and exact
contract/operation headers. It follows no redirects and sends no cookies. Every real HTTP route
still performs its own current OAuth/grant/key/task/source checks; a client metadata snapshot is
not permission. 401/403 and authority conflicts terminate the memory session. An idle host may
replace a short-lived token only after fresh authentication confirms identical connection,
authorization, client, task set and scopes. Refresh is serialized against model/network work and
does not renew the original Worker TTL. A changed identity or scope requires a new owner session.

Before any report POST the controller stores the original signed ciphertext packet in IndexedDB.
Records contain only closed public scope, exact original packet, frozen Run creation time and
verified server receipt. They cannot contain plaintext report/resources, tokens, private keys or
Passkey material. Per-scope 32/global 256 record caps and transaction CAS preserve the first bytes
across tabs. Receipt replacement and mismatched explicit discard are rejected. Uncertain results
are replayed with the original operation/body/signature, never re-encrypted or resigned.

Lock/reload discards private keys and Worker state, while ciphertext may remain. A newly approved
owner scope and current matching host credential may recover an original receipt/replay without
restoring old keys. The result explicitly reports `recoveredWithoutPrivateKeys`; this does not
create a new revision session or revive an old Run. Only a live corresponding Worker outbox is
advanced by a receipt independently fetched by the trusted host. A receipt proves an accepted
server fact, not model correctness, user decryption, analysis quality or physical durability.

## Verification and limitations

Mandatory offline Node checks import the actual checked bundles. Production BrowserEncryptedStorage
uses a pinned fake-indexeddb transaction model for tests, separately from real WebCrypto in the
actual Worker. Python-driven tests attach that Worker to the actual FastAPI OAuth/preparation/Run/
result routes and synthetic SQLite fixtures, then independently decrypt saved results with owner
device/recovery keys. Wire tests use native MessageChannels with Window facades; they do not
claim a physical browser, login, remote Muse or two-person production acceptance. The IDB model
fixture is dev/test-only, license/hash pinned, never a public helper asset or copied into the image.

Run root `npm run check` before committing. The helper builder runs offline after its declared
pinned development dependencies are installed; the image/runtime needs no Node packages.
Published-client trust limitations remain: an operator able to replace the actual owning Web
code could alter its behavior. No independent client or generic validation prerequisite is added.
