# Prepare the existing Hub for personal Agent credentials

Date: 2026-11-11

## Summary

Provide an explicit, default-closed rollout configuration for personal Agent credentials on the existing Hub, without the retired browser runtime or independent Executor infrastructure.

## Changes

- Add bounded Muse/ChatGPT preregistrations and an explicit personal-mode switch; refuse old browser-mode activation and the retired financial adapter.
- Configure the account-only consent page and current credential/lineage index exemptions while retaining historical records and exemptions.
- Preserve existing runtime capacity, database, signing key and IAM boundaries; document separate deployment, host acceptance and rollback gates.

## Validation

- Root `npm run check` via the normal commit hook.
- Native Terraform mock-provider plan tests, without a backend or cloud API calls.
- No apply, deployment or online acceptance was performed.
