# Shared delegated identity verification

Date: 2026-10-26

## Summary

Add opt-in shared verification for internal workload and owner-delegated resource
requests. Existing Firebase sign-in, public routes and service consumers retain
their current behavior.

## Changes

- Verify Google-signed workload ID tokens against fixed Google keys, exact
  issuer/audience and pinned service-account subject/email pairs. Require an
  independent bounded Hub RS256 delegation for owner/resource authority.
- Package closed browser-catalogue and agent-Run claims, keeping purposes,
  scopes, owner, target service, Run/grant IDs and resource incarnation/epochs
  distinct. Authenticate both proofs before any current-authority lookup.
- Add bounded HTTPS JWKS retrieval/cache with rotation, unknown-key refresh
  throttling, strict public RSA keys and no expired-key outage fallback.
- Provide immutable principals and opt-in FastAPI adapters with fixed
  401/403/503 errors. Extend private-response prefix configuration so consumers
  can protect internal routes while preserving the existing `/api/` default.
- Add synthetic real-signature, isolation, malformed-token, cache/rotation/outage
  and HTTP integration tests, plus consumer documentation. No consumer, KMS
  signer, business authorization store or infrastructure resource is added.

## Validation

- Shared identity/delegation tests use in-memory generated keys and fake key
  transports/clocks, without real user credentials or cloud provisioning.
- Root `npm run check` covers existing service/Web/infra/CI regressions and
  formatting. PR CI builds and health-checks the three existing backend images.
