# Persistent native account transport

Date: 2026-11-07

## Summary

Add a separate opt-in OAuth profile for a persistent Muse account connection.
The only scope is `runtime:connect`: account status and runtime bootstrap. It does
not grant financial input, Run or report authority.

## Changes

- Reuse Authlib code/PKCE S256, registered client authentication, refresh and
  revocation checks with five isolated native credential tables. Keep legacy
  OAuth scopes, credentials and absolute deadlines unchanged.
- Issue ten-minute access credentials and rotating refresh credentials with a
  180-day sliding inactivity deadline. Account repair reuses the active original
  connection ID and existing Root identity/resource consent.
- Bind private consent to exact Google owner, same-origin flow cookie, registered
  callback and PKCE. Cache only a cookie-encrypted original callback for safe
  approval retries; refresh/access credential values are stored as hashes.
- Keep native history/disconnect separate from legacy connection DTOs. Refresh
  replay stops the account family; explicit disconnect stops the current parent
  and PoP access. A stale family cannot disconnect a repaired authorization.
- Disable issuance by default and report runtime readiness as false. The fixed
  runtime consent asset, native MCP bootstrap and protected-runtime acceptance
  remain subsequent consumers; no real connection or resource access is enabled.

## Validation

- Synthetic real Authlib code/client/PKCE, long-window refresh, replay, owner
  binding, Root permission preservation, native/legacy isolation and HTTP checks.
- Full root `npm run check` before delivery.
