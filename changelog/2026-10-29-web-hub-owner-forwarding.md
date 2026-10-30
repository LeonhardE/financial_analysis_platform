# Web forwarding for Hub owner APIs

Date: 2026-10-29

## Summary

Add independently gated same-origin Hub owner forwarding for vaults, resources, encrypted tasks,
Inbox and connection/preparation controls. Preserve Firebase owner identity and encrypted bytes
while keeping Portfolio workload identity confined to its private service.

## Changes

- Reuse server-only Firebase verification, strict bounded JSON/response handling and admission limits.
- Restrict Hub forwarding to fixed paths, methods, queries, body fields and required control headers.
- Validate formal encrypted responses and the exact existing stage/state acknowledgement profiles.
- Keep agent protocols and cookie-bound consent endpoints outside the owner forwarder.
- Expose independent feature booleans; retain only the existing loopback development exception.
- Leave cloud settings/resources, private keys, encryption and backend authorization unchanged.

## Validation

- All 11 focused Hub transport tests and 17 existing Portfolio transport regressions passed.
- All 242 Web tests and the final root `npm run check` passed, including shared/backend,
  infrastructure, CI-tooling, security, type, lint and formatting checks.
- Independent review passed 52 client cases, 28 server cases and three adversarial probes.
- Production build and 11 final loopback runtime checks passed.
