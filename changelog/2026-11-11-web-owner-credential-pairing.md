# Owner credential pairing foundation

Date: 2026-11-11

## Summary

Prepare trusted Owner Worker pairing and strict Web transport for the new
Agent-owned credential route, before connecting the simplified user interface.

## Changes

- Verify native-bound encrypted public offers inside the existing unlocked Owner
  Worker, append fresh Agent certificates, sign a maximum 90-day replacement and
  encrypt activation with the Owner Root/checkpoint anchor for that host.
- Add read-only signed lease/expiry and historical policy verification, original
  encrypted pending-packet receipts and closed Owner-only v3 credential transport.
- Accept preregistered Muse/ChatGPT metadata while keeping native account approval
  separate from financial permissions. Agent private keys never enter Web state.

## Validation

- Root `npm run check`.
- Real Owner/Agent AES-GCM and ES256, fresh-key generation replacement without
  early revocation, expiry/history, wrong setup bindings, strict BFF namespace,
  packet budgets and existing Owner memory/storage/interoperability regressions.
- UI integration follows separately; no deployment or online validation.
