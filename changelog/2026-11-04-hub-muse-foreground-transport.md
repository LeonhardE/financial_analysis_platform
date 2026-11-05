# Connect approved Muse sessions to the foreground helper

Date: 2026-11-04

## Summary

Hub now offers a closed encrypted handoff from an existing Muse OAuth connection to its
root-approved foreground helper, plus a versioned page for reading a task and saving a report.

## Changes

- Seal the existing bearer to the certified agent encryption key after fresh transactional
  authority checks. Expose only ciphertext through MCP, with a 60-second bounded handoff.
- Restrict decryption/setup to the trusted Worker port and immediately authenticate against the
  fixed Hub issuer. Preserve explicit root/delivery pins and the existing non-exportable keys.
- Add an explicit frozen-input/report/save flow; verify actual receipts and retain original
  ciphertext on response loss. Lock/visibility changes clear private views.
- Publish helper 1.3.0 separately, preserving default 1.2.0 paths and Worker bytes. Include only
  runtime release assets in the Hub image. OAuth/client configuration remains separately gated.

## Validation

- Root `npm run check`; reproducible offline helper build and unchanged legacy Worker bytes.
- Actual OAuth/SQLite → Python JWE → real Worker/controller → authenticated HTTP report save,
  independently decrypted by owner/recovery keys; real SDK MCP response contains no bearer.
- Model-port, scope, expiry, integrity, revoked grant, gated assets and basic UI lifecycle tests.
- Native Muse/production connection acceptance remains separate from synthetic execution.
