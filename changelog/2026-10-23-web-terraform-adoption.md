# Adopt existing Web infrastructure without rebuilding the client

Date: 2026-10-23

## Summary

Give the existing Web service an independent Terraform state and approved apply
boundary while retaining the deployed client, runtime identity and image pipeline.

## Changes

- Import `market-web` and its dedicated runtime account, with blocking service UID,
  public invocation and service-wide cost-cap checks.
- Retain the existing Web image trigger ID, public build-time configuration and file
  filters exactly; leave shared build identities and other target resources alone.
- Add Web-only plan/apply accounts, approval execution and scoped configuration,
  runtime attachment and existing-image read grants. No database grant is added.
- Reuse the existing etag-aware configuration controller so saved plans preserve
  live release images and rollback traffic.

## Validation

- Focused Web root and bootstrap mocked plans exercise the adoption and permission
  boundaries without credentials or provisioner execution.
- Repository checks run before the infrastructure commit; production import plans,
  approval and a fresh no-change plan are reviewed separately during rollout.
