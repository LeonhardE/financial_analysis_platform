# Agent Hub build-only service skeleton

Date: 2026-10-27

## Summary

Introduce an independently buildable Agent Hub process without inference,
private data operations or dependency availability requirements.

## Changes

- Add health-only FastAPI application, isolated service dependencies, environment
  example and nonroot Docker image using the existing shared HTTP foundation.
- Keep future browser, MCP, OAuth/discovery and connector routes unimplemented;
  they return safe uncached missing-route responses rather than mock successes.
- Add service-specific build/push configuration with deployment disabled. The
  existing source registry's build-only release guard prevents Cloud Run access.
- Document separate published-digest evidence and later first provisioning.
  No trigger, identity, database, cloud service or provider connection is created.

## Validation

- Service boundary tests cover health-only OpenAPI, uncached missing private/
  connector paths, untrusted origins and fresh startup/health without cloud
  credentials or network access.
- Ruff checks/formatting, isolated service tests and root `npm run check` are
  required before commit; CI builds and checks the container with network disabled.

The build-only pipeline verifies the built image health without network before pushing it and removes the temporary container on both success and failure.
