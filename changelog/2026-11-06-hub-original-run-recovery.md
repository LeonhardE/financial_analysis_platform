# Continue the original foreground analysis after a Run refusal

Date: 2026-11-06

## Summary

A Run can be created by the Hub before the foreground helper accepts its response. Continuing that
analysis now reuses the original operation instead of allocating a different Run.

## Changes

- The foreground controller retains one original signed Begin Run request and any received Run
  response in memory until acceptance succeeds or the session ends. A received response is rechecked
  unchanged; an unknown request outcome replays the original signed bytes.
- The helper page keeps the analysis operation when beginning the analysis fails and offers
  "Continue the original analysis". Another operation cannot replace an unresolved Run.
- Worker signature, scope, delivery, lifetime and revocation checks remain in force. The existing
  Worker assets and their owner-approved hashes are unchanged. No private input or new credential is
  persisted for recovery.

## Validation

- Real Worker/controller/Hub tests cover a created Run whose acceptance is refused, original-response
  continuation through encrypted report save, unknown POST replay, and repeated lifetime rejection.
- Page tests cover operation identity across continuation and clearing it when a session ends.
- Complete repository checks and reproducible helper asset build.
