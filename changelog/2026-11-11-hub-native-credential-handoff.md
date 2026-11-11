# Native Agent credential handoff

Date: 2026-11-11

## Summary

Prepare default-off native pairing for personal Agent-host credentials and
preregistered Muse/ChatGPT connections on the existing Hub.

## Changes

- Replace native browser bootstrap tools with opaque credential setup/activation
  when Agent-owned issuance is enabled; keep financial authority on current PoP.
- Bind providers to client registration, reject mismatched plan statements, and
  expose public managed lease evidence in authenticated sessions.
- Migrate create-only legacy identities through a new slot, preserving the old
  parent until a successful atomic Owner credential approval.

## Validation

- Root `npm run check`.
- Actual Authlib exchange, current-generation activation, atomic migration/retry,
  provider binding and real MCP SDK discovery/closed-input tests.
- No deployment, production migration or live native-schedule validation.
