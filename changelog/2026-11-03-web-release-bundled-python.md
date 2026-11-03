# Restore the automatic Web deployment interpreter

Date: 2026-11-03

## Summary

The automatic Web build could publish an image but fail before its deployment guard started
because the moving Cloud CLI `slim` image no longer supplied a system `python3` executable.

## Changes

- Pin only the Web deployment step to a specific official Google Cloud CLI image digest and run
  its bundled Python through an absolute path.
- Keep the existing deployment arguments, guard, service identity, IAM and trigger behavior.

## Validation

- Existing infrastructure and guarded deployment regression tests.
- YAML and documentation formatting checks; the subsequent automatic build verifies the actual
  pinned image and interpreter before production release is considered complete.
