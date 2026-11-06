# Versioned foreground browser handoff

Date: 2026-11-06

## Summary

Muse's file permission and browser operation latency can exceed the existing 60-second encrypted
connection handoff. Add an independently versioned path suitable for that browser flow.

## Changes

- Add the closed `get_foreground_transport_v3` tool, packet profile v2 and helper 1.4.0 with
  a maximum five-minute handoff, capped by existing token, grant and connection expiry.
- Preserve helper 1.2.0/1.3.0 Worker bytes, distribution paths and the legacy v2 tool's
  sixty-second profile; mismatched profiles are rejected.
- Keep the same recipient, issuer, signed task/resource approval, model-port isolation,
  ephemeral keys, foreground lifetime and authenticated report/receipt APIs.
- Publish fixed assets and integrity metadata for a subsequent, separately scoped Web pin update.

## Validation

- Actual OAuth/JOSE/Worker/controller HTTP coverage includes a delayed handoff followed by
  encrypted report save and owner decryption, exact expiry, same-key retry and closed inputs.
- Repository checks and exact-head CI are required before merge; deployment is verified separately.
