# Distinguish persistent runtime restore failures

Date: 2026-11-08

## Summary

Expose bounded read-only diagnostics when the protected runtime cannot restore its existing
identity, so a missing local record can be distinguished from invalid keys or identity mismatch.

## Changes

- Project only a fixed failure stage, namespace fingerprint and applicable boolean checks
  through the Worker and into the existing connection details.
- Preserve existing failure codes and stored profiles; do not reconnect, replace keys, unlock
  the owner or broaden resource authority.

## Validation

- Synthetic restore failure, profile preservation, diagnostic privacy and DOM regression tests.
- Repository checks and pinned runtime distribution integrity checks.
