# Register the provisioned Hub for existing-service image release

Date: 2026-10-31

## Summary

Agent Hub has completed first provisioning, but source policy still rejects every
existing-service image release. Promote only its release registration so a later,
separately reviewed Hub target change can publish owner-management fixes.

## Changes

- Change the existing Agent Hub registry entry from build-only to existing-service release.
- Preserve new-target build-only admission, fail-on-missing-service behavior and all
  trigger, IAM, OAuth, adapter and normal infrastructure execution gates.
- Keep the Hub-specific deployment opt-in and service/runtime grants in a subsequent
  target-only infrastructure PR.

## Validation

- Registry transition, release admission and complete root checks run before commit.
