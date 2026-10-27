# Pin Portfolio's audited first-creation image

Date: 2026-10-27

## Summary

Replace the manual-build planning candidate with the immutable digest of Portfolio's
successful dedicated main-only build, so first creation can use reviewed source evidence.

## Changes

- Pin the creation-only default and example to the audited Portfolio digest.
- Document the exact build/source and unchanged first-provision guard.
- Keep normal image deployment disabled and Hub unchanged; resource creation remains a
  separately reviewed complete administrator saved-plan operation.

## Validation

- Existing first-provision prepare/validate passed against official build/trigger captures.
- Artifact Registry independently confirmed the exact digest; all four image build steps passed.
- Root repository checks and target native plan tests are required before merge.
