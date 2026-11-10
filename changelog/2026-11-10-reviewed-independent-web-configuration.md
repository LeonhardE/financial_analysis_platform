# Reviewed independent Web configuration and credential destination

Date: 2026-11-10

## Summary

Consume the reviewed profile-v5 public Agent selection on Web while retaining the
existing default-off configuration, service identity, access and capacity boundaries.

## Changes

- Accept the exact optional independent configuration pair through the existing
  pinned Owner environment. Validate canonical bounded public JSON, keys, identities,
  origins and callbacks; preserve the legacy six-field input unchanged.
- Include the shared executor trust distribution in Web's existing image trigger.
- Verify the Root-approved Policy destination before sending login credentials.
  Pin that issuer through configuration reloads; reject an unapproved or changed
  endpoint before any Policy request. Historical approval supports terminal revocation
  without granting new execution or publication authority.

## Validation

- Web types, production build, complete Web regression suite and six adversarial
  crypto/transport/UI groups, including rejection before a Policy request.
- 41 Web and 49 bootstrap full provider-mocked plans from an isolated source copy
  without local deployment parameter files; no credential or cloud operations.
- Required repository `npm run check` through pre-commit. Online acceptance remains deferred.
