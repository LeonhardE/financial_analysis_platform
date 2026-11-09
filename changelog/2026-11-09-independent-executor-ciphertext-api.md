# Independent executor ciphertext API

Date: 2026-11-09

## Summary

Agent Hub can route approved ciphertext to an independent executor and retain its original
encrypted report receipt without a Muse OAuth parent. The adapter defaults off and preserves
existing native, foreground and owner Inbox formats.

## Changes

- Add Google-owner registration requiring current device enrollment and an exact Root-signed
  executor-trust approval against deployment-pinned public channel values and a bounded scope.
- Add separate Agent proof routes for public session state, current tasks, frozen Run manifests,
  exact task/resource ciphertext, encrypted report submission and original receipts.
- Reuse current source/task/consent fences, complete owner recipients, quotas and transactional
  create-only report CAS. Require exact original envelope strings for independent retries.
- Keep owner history and terminal narrowing available when disabled. Store public authority and
  encrypted artifacts only; add no keys, plaintext proxy, OAuth tokens or cloud activation.
- Extend the maintained persistent API guide and service example configuration.

## Validation

- Real Root/Agent JOSE fixtures with synthetic encrypted inputs and reports.
- SQLite concurrency and actual Firestore SDK serialization, atomic commits and collision retries.
- HTTP gates, closed fields, ambient credential refusal and input/output byte budgets.
- All 46 targeted checks and 830 Agent Hub regression tests passed.
- Repository `npm run check` passed with Node 24.12.0, including existing service/frontend
  regressions, security scanning, infrastructure/CI tests and formatting.
