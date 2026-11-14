# Combine the complete Agent connection display

Date: 2026-11-14

## Summary

Connection discovery still refreshed the complete vault before separate capability
and summary requests. Add a compatible Owner display envelope so an upgraded Web
client can load all required public authority and connection state together.

## Changes

- Add body-free `GET /api/v3/provider-connections/{vault}/display`, combining the
  existing vault, connection summary and three unchanged capability projections.
- Verify one current vault history in one transaction and batch source fences with
  connections, preserving original identity, lifecycle and credential checks.
- Keep the existing response limit. Oversized combinations return an explicit
  separate-read hint with no partial vault or connection snapshot; existing
  endpoints remain available for that bounded fallback and older clients.

## Validation

- Real Firestore SDK tests cover equivalent original DTOs, one verification,
  source-fence batching, 32 connections, conflict retry and current revocation.
- Tests cover combined-budget fallback without partial data, foreign identities,
  malformed storage, original feature gates and closed HTTP transport.
- The existing full repository check remains the required pre-commit gate.
