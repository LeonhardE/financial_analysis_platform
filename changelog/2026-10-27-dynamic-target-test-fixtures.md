# Keep target fixtures valid as backend registration grows

Date: 2026-10-27

## Summary

The dynamic target registry supports new services, but two fixture suites still assumed exactly
three existing backends. Derive their expected suite counts from the current validated registry so
independent new-service registrations can pass the existing repository checks.

## Changes

- Make the default isolated-runner assertion use its registered suite list, and allocate one
  additional subprocess result for the synthetic backend fixture.
- Compare the synthetic first-provision fixture against the actual registry plus one backend.
  Preserve exact image digest, unapproved request, secret exclusion and request-validation checks.
- Change no production registry rules, CI selection, approval boundaries or cloud resources.

## Validation

- Root `npm run check` passed with both new targets temporarily registered in the working tree;
  focused fixture assertions preserve isolation and digest/approval boundaries. The foundation
  commit itself changes no registrations or service code.
