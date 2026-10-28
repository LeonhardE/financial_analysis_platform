# Optional deployment projection pins for target execution

Date: 2026-10-28

## Summary

Allow a target's administrator-owned plan/apply triggers to carry an explicitly
selected deployment projection and byte digest without adding infrastructure or
IAM permissions. Existing callers keep null configuration and their original
substitution maps.

## Changes

- Add optional `deployment_config`, bounded to canonical printable ASCII JSON
  of at most 4000 bytes, schema version 1 and the same target/project/region.
- Reject dollar substitutions and malformed, noncanonical or mismatched values;
  defer full closed-schema/provenance validation to the consuming runtime loader.
- Pin the same raw JSON and SHA-256 in both trigger substitution maps when opted
  in; add `deployment_profile.py` to plan dependency filters only for those
  opted-in targets. Null retains the full original filter list unchanged.
- Add module-only provider-mocked positive/default and rejection tests. No
  bootstrap instance, Cloud Build YAML or pipeline tooling is changed.

## Validation

- Pinned Terraform 1.16.7: offline init with the existing locked provider mirror,
  module validation, and all 23 provider-mocked tests pass.
- Module Terraform format, changed Markdown Prettier checks and Git diff
  whitespace checks pass; no cloud credentials or resource operations are used.
