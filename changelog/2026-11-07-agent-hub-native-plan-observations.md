# Persistent native plan observations

Date: 2026-11-07

## Summary

Keep Root-approved desired task schedules, Agent-reported Muse plan state and actual
Hub execution/result receipts distinct. This does not install native plans or enable
persistent feature gates.

## Changes

- Add proof-bound plan state/report APIs and owner-partitioned read history.
- Preserve signed immutable statements and original operation receipts; use CAS and
  a separate reporting quota. Transmit only a hash of the native plan reference.
- Record run/result observations atomically without claiming platform attestation.
- Restore self-signed pending statements after restart and verify issuance history
  before displaying reported state in the closed runtime.
- Send the required contract header for all runtime HTTP calls. Add an actual
  FastAPI/Node synthetic encrypted execution test to cover transport requirements.

## Validation

- Focused plan concurrency, restart/tampering, owner isolation, gate and HTTP tests.
- Full repository `npm run check` before commit.
