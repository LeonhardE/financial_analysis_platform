# Measured executor startup inputs and explicit creation mode

Date: 2026-11-09

## Summary

The executor can read reviewed public configuration inside Confidential Space
without assuming populated host file mounts. The same fixed image command now
supports explicit fresh-Root-authorized creation and normal restore-only modes.

## Changes

- Read only bounded JSON from the fixed GCS public-config namespace, with captured
  generation, CRC/size checks, independent Root key pins and exact Root-approved
  source URIs. Keep native-config SHA pinned without a circular core-config hash.
- Declare a closed Confidential Space launch-policy environment allowlist, disable
  command/mount/logging/memory overrides and require nonroot host isolation.
- Dispatch creation only through an explicit mode with runtime/native off and the
  existing fresh Root permit/finalization. Missing normal recovery state never
  initializes or replaces keys; image/arguments remain fixed.
- Validate exact IP address SANs and generate matching original-key CSRs, retaining
  exact DNS checks and Root-approved certificate-byte replacement.

## Validation

- All 80 executor tests passed, including bounded remote JSON/root/source negatives,
  real same-image creation flow over synthetic cloud objects, restore-only failure,
  native startup with approved sources and real TLS 1.3 IP SAN verification.
- Full root `npm run check` and required commit checks precede publication.
- Cloud transport/attestation remains synthetic in these tests. No deployment,
  native installation or online validation was started.
