# Read and manage private agent results in Inbox

Date: 2026-10-30

## Summary

Add a responsive English/Chinese Inbox for authenticated local report decryption, result details,
revision history and signed read/star/archive changes. Markets stays the default, and the Inbox
reuses the same Passkey and crypto Worker as Resources without requiring Portfolio configuration.

## Changes

- Authenticate original historical evidence, grant, frozen Run/manifest, receipt, carrier and
  recipient before exposing report content. Keep retained historical reads separate from current
  device authorization for state writes and preserve another tab's sealed device during pin updates.
- Bound metadata pagination, revision history, in-memory decrypted search and visible-only polling.
  Lock, logout, account/capability changes and background transitions fence private data and replies.
- Use signed CAS state changes, explicit original-packet recovery and monotonic current metadata;
  viewing historical revisions does not implicitly mark newer content read.
- Render a safe React-text Markdown subset, explicit HTTPS citations and plaintext-copy confirmation.
  Keep encrypted report content and search indexes off backend/plaintext persistence surfaces.
- Preserve existing Market, Resources, Web forwarding and crypto contracts; no cloud changes.

## Validation

- All288 Web tests passed locally, including real WebCrypto/Python interoperability and IndexedDB races.
- Independent review passed78 focused cases and3 additional asynchronous/adversarial probes.
- Final production build and full root `npm run check` passed, including 337 Hub/174 shared
  tests and every other service, infrastructure, CI-tooling, security, type, lint and format suite.
