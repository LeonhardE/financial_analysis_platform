# Review a new connection without replacing the unlocked owner page

Date: 2026-11-06

## Summary

The Agent page can open a new public Muse connection request from the existing unlocked
workspace. This keeps the in-memory library Worker in its original page while starting a
fresh task, resource and recipient-key review. The corresponding Hub attachment mode is a
separate, backward-compatible consumer change; an older Hub times out without replacing the
owner page.

## Changes

- Add an unlocked-only request-link entry point restricted to the configured Hub's exact
  consent page and one public request identifier. OAuth authorize/callback URLs, credentials,
  extra parameters, fragments and other destinations are rejected.
- Bind the new public handoff to the actual opened Hub window, origin, request and random
  nonce before accepting its owner-only MessagePort. Retain opener isolation and existing
  credential transport boundaries. Abort, timeout, account change and lock invalidate reuse.
- Reset the prior connection review and helper when switching requests. Reload saved encrypted
  pending operations without deleting them, transferring private keys, changing grants or
  unlocking the library again. Ignore late responses from the previous request.

## Validation

- Targeted bridge and consent-controller tests cover exact destinations, forged messages,
  source-bound port attachment, cancellation, timeout, pending-work preservation and late replies.
- Root `npm run check` and the production Web build pass.
