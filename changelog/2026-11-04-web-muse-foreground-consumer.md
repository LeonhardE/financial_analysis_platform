# Pin the authenticated Muse foreground helper

Date: 2026-11-04

## Summary

The Web approval flow now uses the separately delivered Hub helper 1.3.0 and shows the fixed
helper address and encrypted connection steps needed by a real Muse foreground session.

## Changes

- Pin the reviewed 1.3.0 Worker bytes and open the explicit versioned controller path.
- Retain legacy 1.2.0 offer verification and exact version/hash pairing without accepting
  arbitrary Hub-provided release hashes.
- Show a copyable helper URL for manual Muse setup and bilingual guidance after publishing
  the approved encrypted task. Continue requiring explicit recipient and content approval.

## Validation

- Root `npm run check` and production Web build.
- Compare both approved release pins against actual bundled Worker bytes and reject mixed pairs.
- Exercise the complete encrypted approval flow using the actual 1.3.0 Worker, while retaining
  legacy crypto coverage; check bilingual setup guidance and locked-state masking.
- Actual Muse configuration and user-approved production acceptance remain separate.
