# Accept native OAuth language hints

Date: 2026-11-11

## Summary

ChatGPT adds `ui_locales=en-US` to its actual OAuth authorization request. The
native account transport previously rejected that request before consent.

## Changes

- Accept a bounded optional locale list only on native authorization.
- Discard the display hint before consent persistence and protocol processing.
- Preserve exact callbacks, resource and bootstrap scope, S256 PKCE, cookie and
  Owner binding, and rejection of duplicate or unrelated parameters.

## Validation

- The new native service and HTTP regressions fail before the fix and pass after.
- Actual authorization-code exchange keeps bootstrap-only authority with the hint.
- Invalid hints and attempts to alter callback, scope, resource or PKCE still fail.
- Full root `npm run check` and normal pre-commit checks.
