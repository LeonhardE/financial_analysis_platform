# Persistent runtime shared verification and private input policy

Date: 2026-11-07

## Summary

Use the shared browser contract implementation in the Hub runtime and enforce the decrypted task's
input policy before exposing resources or publishing a new report.

## Changes

- Replace copied cryptographic and authority modules with shared-library exports. Pin the shared
  integrity manifest and bundle in the independently built, self-contained runtime assets.
- Reject disallowed partial coverage, unknown as-of information, stale or overly old inputs, and
  fetched timestamps beyond the bounded clock tolerance.
- Independently recheck every frozen input before a first report submission, including callers that
  skipped reading inputs. Preserve original-ciphertext retries after an uncertain response.
- Keep persistent runtime gates disabled by default and retain existing helper distributions.

## Validation

- Independent Node/Python runtime, storage, authority, report and policy-boundary checks.
- Full repository `npm run check` and selected-target CI before merge.
