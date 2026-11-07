# Native runtime bootstrap and first-pairing observation

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

The fixed browser SDK will directly submit one ES256 self-proof at
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

The owner Web will reuse its existing Google session and WEB-012 global unlock.
The browser runtime is a separate fixed Hub asset; it must preserve nonextractable
keys, monotonic Root/policy pins and original encrypted outboxes. Those consumers
and real protected-host/first-pairing/cross-day acceptance are not supplied here.

`HUB_PERSISTENT_MCP_ENABLED=1` plus native account configuration enables this producer.
Both stay off in production until consumers and acceptance gates are ready. Startup
misconfiguration keeps health independent of Firebase/ADC. The exact v3 route is
installed before the legacy `/mcp` mount; legacy v2 transport/auth stays unchanged.
MCP Host/Origin and resource-metadata challenge use the base Hub origin, while the
OAuth issuer retains its separate `/oauth/persistent` path.
