# Confidential Executor infrastructure preparation

Date: 2026-11-09

## Summary

INF-012 D2 now has an inert target-owned Terraform root for ordered build/network/
recovery preparation and an explicitly selected single Confidential Space VM.
Original provider TLS remains inside the measured executor through TCP ingress.

## Changes

- Separate build/creation/runtime identities, private immutable state and separate read-only public config,
  exact Policy current-VM read and build-only repository permissions; no KMS decrypt,
  Policy administration, impersonation or broad storage grant.
- Add production SEV/Secure Boot VM configuration with closed measured metadata,
  fixed command, off native/runtime creation mode and restore-only runtime mode.
  Image/mode changes require reviewed replacement in one fixed VM slot.
- Forward encrypted TCP 443 to original TEE TLS 8443 without SSL/HTTPS termination,
  certificate keys, injected headers or content logs; restrict backend ingress to
  Google proxy/health ranges and keep probes distinct from authority evidence.
- Document independent saved-plan approval prerequisites, exact D3/Root bindings,
  protected recovery/replacement, costs and actual acceptance still outstanding.

## Validation

- Pinned Terraform init/validate and 13 full provider-mocked plans passed, including
  default zero resources, phase/permission/TLS boundaries and invalid launch inputs.
- Full root `npm run check` and required commit checks precede publication.
- No real project, billing change, resource apply or online validation occurred.
