# Reviewed public independent Web configuration projection

Date: 2026-11-10

## Summary

Add an optional offline projection for Web's independent Agent selection so its
runtime configuration can use the existing pinned managed-target plan workflow.

## Changes

- Add profile v5 with an explicit null-by-default public selection. Profiles v1–v4
  retain their existing output; ordinary service projections and Web build values are unchanged.
- Validate exact identity/origin/callback/public P-256 fields, reject private or extra
  fields, and require the existing Firebase/Hub Owner prerequisites.
- Project the enabled selection as an inseparable pair of public Web environment
  values, included in the existing server/target hash pins. Retain the complete
  4,000-byte target limit and bound the canonical selection to 1,024 bytes.
- Keep this change foundation-only: the Web infrastructure consumer follows separately.

## Validation

- All 324 infrastructure unit tests, including six new adversarial projection groups.
- Required repository `npm run check` through pre-commit. No credentials, cloud apply or online acceptance.
