# Preserve formal Owner credential errors

Date: 2026-11-11

## Summary

Initial Agent authorization checks for an existing operation receipt before
submitting the sealed approval. The v3 Owner credential namespace was missing from
the error boundary, so its normal missing receipt returned a framework error and
Web correctly refused it as an unavailable service.

## Changes

- Apply the existing closed error envelope to the Owner credential namespace.
- Preserve status, contract code, retry flag and bounded request ID for missing
  receipts, authentication and invalid transport; sanitize unexpected failures.
- Keep authentication, approvals, OAuth and all storage behavior unchanged.

## Validation

- Missing-receipt and invalid-transport HTTP regressions fail before the fix.
- Credential route tests cover formal 400/401/404, sanitized unexpected 503 and
  an unknown v3 route without leaking diagnostics.
- Full root `npm run check` and normal pre-commit checks.
