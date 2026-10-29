# Agent Hub encrypted Runs and immutable manifests

Date: 2026-10-29

## Summary

Create an explicitly authorized Run from committed encrypted preparation inputs and retain the
exact task/resource deliveries used by that Run. Later ordinary edits must not rewrite its inputs.

## Changes

- Reuse formal signed Begin intents, Run/manifest/component contracts and current authorization
  fences; bind IDs independently to the original operation and selected ciphertext fingerprints.
- Freeze opaque inputs and retained public author proofs atomically, with bounded idempotency,
  storage, rate limits and component reads.
- Extend the existing foreground helper to sign restricted Begin requests and verify/decrypt
  frozen Run inputs without exposing private keys or adding arbitrary signing/result operations.
- Keep results, model/scheduled execution, trusted UI/real Muse acceptance and production activation
  separate. Do not change shared contracts, other services, frontend or deployed cloud settings.

## Validation

- All 237 Hub tests pass, including 40 new cases: 17 domain, 8 production HTTP, 4 real Firestore
  SDK and 11 actual Worker/message-channel cases. Tests cover frozen historical inputs, current
  authority and quotas, races, signing-input replay identity, retained authors, private policies,
  independent IDs, cursor binding and locked-session late results.
- Full root `npm run check` passes on the final source. Independent review passed all 40 new cases
  and three additional adversarial probes, then separately reran the final chronology and
  order-only resource-update regressions. Helper builds are reproducible; all data is synthetic.
- No real accounts, cloud calls, listening services or tunnels are used.
