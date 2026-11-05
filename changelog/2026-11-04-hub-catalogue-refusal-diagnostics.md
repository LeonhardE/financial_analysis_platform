# Identify resource discovery refusal stages without private data

Date: 2026-11-04

## Summary

Production metadata requests can return HTTP 200 while Hub still refuses the source.
The existing unavailable state hid which transport or contract check failed.

## Changes

- Record fixed source-service names, operation stages and closed failure codes when discovery
  rejects a producer response. Successful reads emit no diagnostic.
- Exclude response bodies, exception messages, owner/reference identifiers and credentials.
- Preserve the existing bounded requests, validation, unavailable response and public contract.

## Validation

- Source discovery tests verify projection and HTTP refusal stages while proving private
  canaries and identifiers never appear in logs.
- Full root `npm run check`.
