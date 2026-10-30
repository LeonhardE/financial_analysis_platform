# Muse connection review and encrypted delivery

Date: 2026-10-30

## Summary

Add the owner-facing Muse connection, consent and revocation flow to Web, reusing the existing
Passkey workspace, Hub authorization contracts and encrypted task/resource delivery formats.

## Changes

- Add a bilingual Agents view with Muse setup, owner-scoped connection and attempt history,
  immutable task review and explicit connection/grant revocation. Other providers remain disabled
  and Markets remains the default view.
- Keep cookie-bound authorization on its Hub issuer origin. Use a fixed owner-consent port for
  fresh Google owner verification, and a separate public-only foreground helper port with an
  independently pinned Worker release. No OAuth flow endpoint is added to the owner forwarder.
- Require review of one task, API scopes, source versions, key fingerprints/replacement and
  decryption recipients before preparing encrypted resource copies and delivery fingerprints.
- Add typed Passkey Worker operations for agent certificates, grants and preparation copies,
  with owner-bound PRF-sealed retry records, exact ciphertext replay, optimistic concurrency and
  lost-decision recovery through authoritative connection metadata.
- Fence private state and late work across lock, owner changes, lost capabilities and hidden
  views. Clarify the distinction between library lock, helper lifetime, agent revocation and
  third-party retention.
- Preserve existing cloud settings and resource topology; real Muse execution and device
  acceptance remain separate from the synthetic checks delivered here.

## Validation

- `npm run test:web`: 390 tests passed, including fixed-port consent/helper validation, owner and
  session races, encrypted replay recovery, revocation, actual WebCrypto and React text escaping.
- `npm run typecheck:web`: passed.
- Root `npm run check` and the production Web build passed. Four cross-target tests use the shipped
  Hub and Web bridge modules with native MessageChannels and explicit window facades. Physical
  Passkey or real Muse acceptance is not represented by mocked controllers.
