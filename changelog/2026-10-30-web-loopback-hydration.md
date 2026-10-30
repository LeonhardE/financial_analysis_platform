# Keep local encrypted-workspace capabilities stable during hydration

Date: 2026-10-30

## Summary

A development page on localhost previously reported encrypted-workspace capabilities differently
on the server and on the browser's first render. Resources could therefore render a warning
paragraph on the server and a sign-in container during hydration, producing a hydration error.

## Changes

- Enable the existing browser-only development origins in visible capability flags only after
  the client has mounted, keeping server and first client render inputs identical.
- Preserve production capability loading, exact private routes, owner authentication and the
  strict development/loopback request conditions.

## Validation

- AuthProvider tests: 42/42 passed. New tests compare actual no-window/no-effect server state with
  initial localhost client state, then confirm local capabilities appear after mounting.
- Production and public-host pages remain disabled by mounting alone. Existing authenticated
  route, cancellation and account-isolation regressions pass.
- Web typecheck passed. No backend, cloud configuration or resources changed.
