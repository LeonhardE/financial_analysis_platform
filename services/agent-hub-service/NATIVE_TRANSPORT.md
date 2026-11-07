# Persistent native account transport

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
are subsequent consumers. The actual deployment has a separate owner Web origin;
its existing login/global unlock must be reused through a fixed-origin bridge,
without relying on cross-site cookies. No protected-host lifecycle or trusted
first-pairing production readiness is asserted by this OAuth producer.
