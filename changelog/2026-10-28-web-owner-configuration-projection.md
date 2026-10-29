# Add offline Web owner configuration projection

Date: 2026-10-28

## Summary

Add a closed configuration foundation for future Portfolio and Agent Hub owner forwarding in
the existing Web service. This produces reviewable offline candidates; current applications,
Cloud Build, Terraform inputs, IAM and runtime configuration remain unchanged.

## Changes

- Add explicit deployment profile v2 owner flags while preserving the closed v1 profile/schema
  and existing target-instance, compiler, rendering and public-build contracts.
- Add the separate `compile-web-owner` action, fixed server settings, minimal public flags and
  manifest hashes. Origins and Firebase project derive from the selected profile; the first
  Portfolio consumer supports its numbered Cloud Run origin as the default token audience.
- Require exact selected-Web and independently pinned server hashes when parsing future consumer
  input. Keep both routes disabled by default, with Hub independently absent or disabled.
- Document the consumer and separate-target rollout boundaries without introducing a proxy,
  service credentials, cloud resources or deployment actions.

## Validation

- Web-owner configuration tests cover pre-change projection/input digests, v1/v2 compatibility,
  independent enablement, missing Hub, malformed/mixed inputs, server/public bindings and private
  CLI output.
- All 16 owner-configuration tests and the 251-test infrastructure suite passed.
- Full root `npm run check` passed, including secret scan, type/lint checks, Web and service tests,
  infrastructure and CI tooling tests, and formatting.
