# Unified owner resource discovery

Date: 2026-10-29

## Summary

Add an owner-only resource catalogue over existing holdings, watchlist and YouTube-follow metadata.
Resources stay owned by their original services, with explicit uninitialized, partial and unavailable
states instead of treating failures as empty data.

## Changes

- Add `GET /api/v2/resources/catalogue` with verified Firebase ownership, a closed discovery DTO
  and minimal metadata. User list evidence remains not prepared; holdings pointers do not prove
  recipient authorization or decryption readiness.
- Consume existing producer APIs through fixed HTTPS origins, fresh workload identity and narrow
  Hub-signed owner catalogue delegation. Reject private/unknown metadata, redirects and oversized
  responses without forwarding browser credentials or upstream diagnostics.
- Bound upstream work with one cooperative deadline and at most four joined request workers;
  recheck current vault/registry/fences after RPCs without network calls inside database transactions.
- Add optional remaining-budget KMS timeouts while keeping existing signing defaults. No other
  service, shared contract, cloud configuration, resource or deployment consumer changes.

## Validation

- Synthetic tests cover signed downstream identity/delegation, three-source metadata, owner
  isolation, partial outages, strict privacy fields, current fences, registry races, deadlines,
  maximum source concurrency, and missing configuration.
- All 76 Agent Hub tests passed, including 22 new cases. Full root `npm run check` passed, including
  security scanning, lint/type checks, Web/service/infra/CI tests and formatting. No cloud calls.
