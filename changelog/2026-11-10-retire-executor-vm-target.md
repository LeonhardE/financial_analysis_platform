# Remove the unused Confidential VM Executor target

Date: 2026-11-10

## Summary

Remove the unused Executor service and VM/fixed-ingress deployment configuration.
The new personal Agent route requires no additional runtime service.

## Changes

- Remove the application, creation/recovery/certificate utilities, tests, image,
  dependency locks and Cloud Build configuration.
- Remove its Terraform VM/network/TCP-proxy/state/admin roots and target-specific
  tests; keep marked historical protocol/trust references and terminal registry
  metadata.
- Perform no actual cloud destruction or deletion of stored recovery/audit data.

## Validation

- Root `npm run check`.
- Removed executable target is excluded from runnable registration; existing Web,
  five services, infrastructure and CI checks remain available.
