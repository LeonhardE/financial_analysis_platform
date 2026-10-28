# Explicit target-instance configuration for reviewed infrastructure execution

Date: 2026-10-28

## Summary

Provide the shared contract for single-target deployment configuration migration
without moving a production resource, changing target activation or creating
cloud resources. Existing targets retain their committed-policy execution until
their own reviewed migration opts into trigger-managed inputs.

## Changes

- Compile validated private operator profiles into closed canonical target
  projections, bounded to 4000 bytes with typed Terraform inputs and restricted
  Web public build settings. Exclude unrelated target inputs from the digest.
- Add a credential-free compile command producing four fixed private candidate
  files and unapproved manifests; include adopted projections in the optional
  bootstrap configuration map without wiring resource instances here.
- For explicit `trigger-v1` targets, compare actual Build and Trigger configuration
  pins, adopted trigger identities, exact repository/main provenance and target
  identities before infrastructure execution. No missing-input legacy fallback.
- Bind projection and generated input digests into source fingerprints and private
  saved-plan manifests. Only plan generates a private temporary variable file;
  apply still uses the exact approved saved binary and existing state/age checks.
- Preserve rejection of ad-hoc tfvars, symlinks and Terraform environment overrides;
  include the new executable dependency in fingerprints/read-only source evidence.

## Validation

- Offline synthetic projection/CLI and actual-runner tests cover canonical parsing,
  private output permissions, unrelated-target independence, actual server pins,
  exact repository/trigger identity, mixed legacy/instance execution, saved-plan
  tampering, disabled targets, native approval and temporary variable-file cleanup.
- Existing profile, saved-plan and per-target isolation tests remain required.
- All 104 targeted tests passed: 29 profile/instance, 44 saved-plan and 31 target
  isolation tests. Ruff lint/format and scoped Markdown/YAML formatting passed.
- No credentials, GCP API calls, cloud resources or database migration.
