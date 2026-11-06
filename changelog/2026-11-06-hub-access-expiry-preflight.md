# Renew expiring foreground access without losing the approved session

Date: 2026-11-06

## Summary

Long foreground reads can cross a short-lived access token's expiry. The 1.3.0 helper now stops
before a request when the installed token cannot cover the existing request budget, allowing
explicit same-grant renewal while retaining the approved in-memory session.

## Changes

- Check the authenticated access expiry before each HTTP request using the installed token,
  reserving the existing 20-second request budget. Clear an unusable token and return
  `access_token_refresh_required` before sending the request.
- Keep the exact grant identity, independent delivery pin, Worker keys, Run and encrypted outbox
  within their original lifetimes. A new trusted authentication must match the same scope.
- Show renewal guidance and preserve the original analysis/report operation across reconnects.
  Resume partially read frozen inputs on the existing Run, protecting an already loaded draft.
- Preserve server 401/403/409 handling, Worker validation and both existing Worker hashes.

## Validation

- Real Worker/controller/OAuth/Hub tests cover stopping between registry pages, renewal and
  continuation, original Run/outbox receipt recovery, and server denials that still end sessions.
- Page regression covers renewal guidance and retrying the original report after reconnecting.
- Reproducible helper build and complete repository `npm run check`.
