# Keep local retry cleanup available in Agent history

Date: 2026-11-06

## Summary

Retained local Agent retry records still participate in the existing key-renewal safety checks.
Owners therefore need the original discard action inside revoked-connection history as well.

## Changes

- Keep the existing two-step local discard action available for historical records. It removes
  only the selected original local operation, using the existing operation-ID comparison.
- Continue to omit replay and new-consent controls for revoked connections. Retain the original
  renewal checks and server audit, resources and reports.
- Explain the local-record cleanup effect in English and Chinese.

## Validation

- Agent UI tests verify historical discard availability without replay or immediate deletion,
  including mixed unresolved and revoked records in both languages.
- `npm run check` from the repository root.
