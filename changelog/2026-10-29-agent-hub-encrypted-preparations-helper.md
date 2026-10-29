# Agent Hub encrypted preparations and foreground helper

Date: 2026-10-29

## Summary

Prepare encrypted task and resource deliveries for an explicitly authorized agent while retaining
the owner's original task. Reuse current OAuth, root-signed keys and version/fence checks; keep
decryption in a bounded foreground client helper.

## Changes

- Add explicit selected-current-version encrypted sharing without expanding existing OAuth grants.
- Add bounded encrypted preparation storage and public verification, with per-object transfer and
  atomic publication. Prepared evidence is client-attested, not a backend claim about private
  financial contents or an implemented Run.
- Deliver a versioned Hub-owned helper with memory-only agent keys and independently pinned trust.
- Keep Run/result APIs, real Muse acceptance and cloud activation separate. Do not change shared
  contracts, other services, frontend or deployed infrastructure configuration.

## Validation

- All 197 Hub tests pass, including 41 new cases: 15 domain, 8 production HTTP, 3 real Firestore
  SDK and 15 actual Worker/message-channel tests. Formal Python-encrypted task/three-resource
  copies decrypt through the memory-only helper; invalid private semantics and AEAD tags fail.
- Independent review passed the same 41 new cases and three additional integrity/isolation
  probes. Full root `npm run check` passes; helper builds twice to identical checked artifacts.
  No real accounts, cloud calls, local servers or tunnels are used.
