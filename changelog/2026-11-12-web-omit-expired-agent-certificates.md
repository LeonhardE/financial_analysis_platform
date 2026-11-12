# Omit expired Agent certificates from new checkpoints

Date: 2026-11-12

## Summary

Repeated authorization copied expired Agent certificates into every later checkpoint,
unnecessarily exhausting the existing stored-history budget. Fresh Agent certification
now leaves expired Agent entries in their immutable historical bundles and omits them
from the new checkpoint.

## Changes

- Remove only Agent signing/encryption certificates already expired at the new
  checkpoint's issuance time, before checking its entry limit.
- Preserve all still-valid keys, including the previous credential during replacement
  and every other connection's valid keys. Leave non-Agent certificates, revocation
  high-water marks and all earlier signed bundles unchanged.
- Keep existing storage/transport/history limits and cloud resources unchanged.

## Validation

- A regression fails before the change and passes afterward: expired Agent pairs are
  omitted while another connection's valid keys remain usable and original historical
  bindings remain verifiable.
- Renewal before expiry retains the old valid certificates before lease replacement.
- Owner credential/real Worker storage tests and repository checks.
