# Portfolio consumes selected operator deployment configuration

Date: 2026-10-28

## Summary

Move Portfolio's existing project, region, runtime, image, CORS and adoption
inputs into its verified deployment projection while preserving its private,
build-only, disabled-execution posture and existing state/resource ownership.

## Changes

- Require the seven-field typed deployment input without original-author
  defaults; constrain the optional legacy image alias to the selected digest.
- Add a read-only adopted-service UID/private-invocation/service-cap boundary.
  Retain service-wide maximum 12 and revision maximum 1.
- Parameterize only Portfolio's bootstrap runtime/artifact/build identity
  references, preserve stages and block a mismatched existing trigger UUID.
- Opt only Portfolio into the trigger deployment contract, retaining
  `enabled=false`; clear Cloud Build region/repository defaults and keep
  `_DEPLOY_SERVICE=false`.
- Replace creation-oriented documentation/examples with existing-instance
  adoption guidance and add synthetic portability/negative tests.

## Validation

- Offline provider-mocked root and bootstrap tests cover two selected instances,
  existing access/identity/cap boundaries and restricted configuration inputs.
- No cloud operation, first provisioning, new resource, state migration or
  normal-execution activation is performed.
