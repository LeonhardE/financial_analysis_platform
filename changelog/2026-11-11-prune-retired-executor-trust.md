# Prune retired executor trust foundations

## Summary

Remove the independent Policy/TEE trust extension after its consumers retire, retaining current personal credentials and supported historical data contracts.

## Changes

- Remove the unused executor-trust Python verifier/schema, separate browser package/distribution/build dependencies and dedicated cross-language tests/vectors.
- Keep package entry-point documentation and required third-party notices; consolidate shared guidance around current 90-day Agent credentials.
- Preserve generic historical identity, content, consent, Run/report and immutable receipt formats. No user data or live cloud resources are deleted.

## Validation

- Root `npm run check`.
- Consumer/import inventory; shared contract, historical format, current credential and Owner/Agent crypto regression suites.
