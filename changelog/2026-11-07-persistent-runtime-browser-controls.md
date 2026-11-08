# Persistent runtime controls for Muse Browser

Date: 2026-11-07

## Summary

Muse's protected Browser can navigate pages and use semantic controls, but its supported
interface does not provide arbitrary page JavaScript calls. The persistent runtime now offers
visible controls for its existing closed operations so the approved connection can execute tasks
and return encrypted reports through that Browser.

## Changes

- Add task, due-slot, frozen input, report and receipt controls to the fixed Hub runtime page.
- Add certified session refresh without reinitializing the Worker or replacing its stored identity.
- Bind Run inputs and scheduled triggers to original verified responses. Preserve the original
  report on uncertain saves, and keep native plan reporting separate from actual installation.
- Clear private page content on exit, ignore late responses, and preserve keys/encrypted outboxes.
- Rebuild the fixed assets and integrity manifest; the cryptographic Worker remains unchanged.

## Validation

- DOM workflow regressions cover pairing, lost profiles, input binding, uncertain save recovery,
  scheduled triggers, plan observations and late plaintext responses.
- Full repository checks and browser verification are recorded in the PR.
- Real holdings and native recurring execution remain subject to owner-led online acceptance.
