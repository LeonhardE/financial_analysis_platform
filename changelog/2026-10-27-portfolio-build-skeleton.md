# Portfolio build-only service skeleton

Date: 2026-10-27

## Summary

Add an independent Portfolio service image before provisioning its private data infrastructure.
This version serves process health only and introduces no holdings or brokerage functionality.

## Changes

- Add a minimal Portfolio application reusing shared private HTTP response boundaries; missing
  private and brokerage APIs refuse requests without exposing simulated business behavior.
- Keep startup independent of credentials, storage, other services and external providers.
- Add isolated dependencies, local environment documentation and a nonroot container image.
- Add Portfolio-only build/push configuration with deployment disabled, protected by the shared
  build-only release guard. No service, database, identity or build trigger is provisioned.

## Validation

- Service tests cover health-only capabilities, private-path refusal and independent cold startup
  while outbound sockets and credential/storage configuration reads are forbidden.
- The registered service runner and CI perform independent image build and isolated health checks.
- Root `npm run check` is required before the scoped implementation commit. Actual remote digest
  publication and any later first provisioning are recorded separately from local test evidence.

The build-only pipeline checks the actual built image health without network before publishing it, and cleans the temporary container on both success and failure.
