# Allow time for foreground Muse review and execution

Date: 2026-11-05

## Summary

The real Muse acceptance flow outlasted the Web client's 15-minute foreground
session before analysis could begin. New helper sessions and their separately
approved agent key registrations now use the existing protocol's one-hour limit.

## Changes

- Use one shared duration for paired and remote public setup cards and agent key
  registration, so a shorter client default does not end the review prematurely.
- Explain the one-hour maximum and close, lock and expiry behavior in both
  consent page languages. Existing sessions and certificates retain their expiry.
- Keep exact recipient and resource approval, volatile private keys, the
  60-second encrypted transport handoff and unattended-execution restrictions.

## Validation

- Consent controller regression checks cover paired and remote setup, matching
  key registration duration and the absence of a content grant at registration.
- `npm run check`.
- `npm run build:web`.
