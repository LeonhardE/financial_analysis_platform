# Establish Terraform state and reviewed execution foundations

Date: 2026-10-23

## Summary

Infrastructure can be reviewed as code and executed through separate plan/apply identities, starting
with a repository-only state contract. This foundation does not import, recreate or change existing
services. Cloud activation remains a one-time administrator step after the PR is reviewed and merged.

## Changes

- Add an administrator bootstrap root for separate private administrative state, execution state and
  short-lived plan/recovery buckets, plus two restricted execution accounts and repo-only Cloud Build
  triggers. Enable state versioning, bounded old-version cleanup and deletion protection.
- Pin Terraform 1.16.7 with official archive checksums and Google provider 7.28.0 with a committed
  dependency lock. Ignore state, plans, private variables and local caches in Git/build contexts.
- Run plans only through the registered trusted trigger; store immutable private binary/text plans
  bound to resolved source provenance, target, toolchain, configuration and state generation. Require
  a separate native-approved apply build, applying exactly the saved plan within six hours.
- Reject stale, tampered, destructive or mismatched plans. Preserve private diagnostics and emergency
  state on ordinary apply failures; document recovery and hard-termination limitations.
- Register only a built-in `terraform_data` repo contract. Normal execution cannot manage its own
  bootstrap or business resources, queue builds, approve execution or impersonate another account.
- Extend scoped CI and the existing required `Quality checks` aggregate with credential-free
  Terraform format/init/validate/native mock checks. Terraform-only changes skip application checks.
- Document browser Cloud Shell bootstrap, remote-state migration, saved-plan review/approval, first
  live acceptance, cost boundaries and the later shared/single-target adoption sequence.

## Validation

- Full root `npm run check` passed, including 32 CI routing tests and 65 infrastructure tests.
- Terraform format, backend-disabled initialization, validation and eight native mocked tests passed
  across both roots.
- `actionlint` v1.7.12 passed for the updated scoped workflow.
- No cloud import, plan or apply was executed; actual IAM/source metadata and live state recovery
  require the documented post-merge acceptance steps.
