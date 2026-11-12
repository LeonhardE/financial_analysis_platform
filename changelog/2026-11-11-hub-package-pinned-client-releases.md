# Include retained Agent clients in the Hub image

Date: 2026-11-11

## Summary

The Hub image now includes retained client releases so existing versioned download
URLs remain available alongside the current client.

## Changes

- Copy retained client bundles, integrity manifests and notices into the runtime image.
- Verify both published client manifests and bundle hashes during the image build.

## Validation

- Root `npm run check` passed through the normal pre-commit hook.
- The required service CI builds the image and verifies isolated runtime health; the
  image build also checks both client release directories directly.
