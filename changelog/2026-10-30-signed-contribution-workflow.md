# Signed contribution and merge workflow

Date: 2026-10-30

## Summary

Document how contributors configure local SSH signing and verify both the pushed commit and
the final merged commit on GitHub.

## Changes

- Keep private keys and machine-specific signing configuration outside tracked source.
- Distinguish author metadata, local trust, GitHub signature verification and CI.
- Explain SSH-agent reload, fail-closed signing and checking the final merge's author and footer.
- Avoid GitHub rebase-and-merge when verified signatures must survive the merge workflow.

## Validation

- Complete root `npm run check` passes, including all 458 Web tests and the existing backend,
  infrastructure and CI suites.
- This documentation-only change does not alter application behavior or deployment configuration.
