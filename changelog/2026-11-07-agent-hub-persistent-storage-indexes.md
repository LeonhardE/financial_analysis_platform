# Gated persistent Hub rollout prerequisites

Date: 2026-11-07

## Summary

Disable single-field indexes for implemented persistent Hub opaque fields before
activating continuing resource access and native execution.

## Changes

- Exempt signed identity/consent histories, native credential/setup maps, encrypted
  publications, frozen Run history, report storage and plan statement evidence.
- Add a closed, default-off persistent basic-flow opt-in with producer-trust and
  client-registration prerequisites. False preserves the exact existing environment.
- Preserve the dedicated Hub database, all existing exemptions, histories and TTL
  policy. No IAM, database replacement or live feature activation changes.

## Validation

- Native Terraform mock plans verify exact exemption count, empty indexes, no TTL,
  default-off environment preservation and explicit rollout prerequisites.
- Full repository `npm run check` before commit.
- Actual changes require a reviewed complete saved plan and exact-plan apply.
