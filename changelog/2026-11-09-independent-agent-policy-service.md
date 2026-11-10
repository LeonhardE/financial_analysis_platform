# Independent Agent Policy service

Date: 2026-11-09

## Summary

Add a build-only Agent Policy service in the trusted owner's separate control domain. OAuth
account authorization, Root approvals, latest-state fences, fresh workload evidence and original
key possession jointly gate short execution/write leases and key-only encrypted recovery.

## Changes

- Use Authlib authorization code/S256, exact callbacks/resources, issuer identification,
  durable rotating refresh families, replay revocation and bounded client preregistration.
- Pin public Root/policy keys, account/provider, resource and independent witness/snapshot/KMS
  configuration. Add Root CAS controls for enrollment, terminal revocation, code upgrades,
  explicit identity migrations and certificate approval.
- Separate the live Firestore CAS pointer from immutable GCS snapshots. Missing/old current
  state stops authority; backup restore cannot select a former pointer or initialize grants.
- Verify Google RS256 evidence, nonce/key/operation/image/environment and the current VM before
  releasing the approved 32-byte recovery key encrypted to the attested boot. Confirm original
  Agent/encryption/TLS possession before execution leases; no general decrypt/sign proxy.
- Add a measured keyring-only startup transport, with a bounded fresh Root boot window or
  current account grant, so original TLS recovery precedes native HTTPS without a financial
  authority bypass. Native revocation clears the boot permission.
- Register only this service with build-only Cloud Build, Docker, tests and maintained guides.
  No cloud resources, identities, production activation or consumer changes are included.

## Validation

- Real JOSE and an actual Authlib client code/refresh exchange, client/resource/PKCE negatives.
- SQLite and actual Firestore SDK CAS/conflict fixtures, snapshot rollback/outage tests,
  generation/lease/receipt and Root transition tests, Google/KMS cryptographic RPC fixtures.
- HTTP Owner separation, same-browser consent, closed errors/fields and streamed byte budgets.
- All 80 targeted tests passed; repository `npm run check` passed, including existing service,
  frontend, security, infrastructure and CI regressions. The final staged version is also checked
  by the required complete pre-commit hook.
