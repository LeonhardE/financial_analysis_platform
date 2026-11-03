# Restore the Hub automatic release entrypoint

Date: 2026-11-03

## Summary

Hub automatic builds could publish an image but failed to start deployment after the official
Cloud CLI slim image stopped providing a system `python3` on PATH.

## Changes

- Pin only the Hub deployment builder to its verified official immutable digest and invoke its
  bundled Python by absolute path.
- Keep the original release script, arguments, workload identity and deployment guards unchanged.
  Document interpreter verification when updating the builder image.

## Validation

- Inspect and hash the exact official OCI image, including its executable bundled interpreter.
- Run repository-root `npm run check` and the existing deployment-guard/infrastructure tests.
- Verify the merged Hub main-trigger build completes its real deploy step and serves the exact
  reviewed image at 100% traffic, with runtime settings, IAM and Muse flags preserved.
