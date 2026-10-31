# Distinguish Agent rollout state from connection-list failures

Date: 2026-10-31

## Summary

The Agent page treated owner Hub configuration as proof that Muse was enabled and
showed an empty list alongside a real request error. Consume Hub's independent
owner capability API so disabled Muse has a clear neutral state while existing
owner connections remain readable and revocable.

## Changes

- Add a single read-only capability route to the closed authenticated Hub bridge,
  validating its profile, booleans, response status and exact fields.
- Load connection history and capabilities independently. Capability failure or
  timeout cannot delay successful history or revocation; stale account responses
  cannot reopen the connection entry.
- Pause new consent steps during capability revalidation without replacing the trusted
  destination or clearing existing consent drafts, paired bridges and sealed pending
  operations. Keep the consent card mounted but hidden/inert while unavailable,
  preserve its same-owner draft during display masking, and key it by owner so
  real account changes still clear private state and local offer text.
- Show empty connections and authorization-attempt history only after a successful list read. Preserve actionable
  real errors, and offer new Muse connection/consent/address actions only when its
  explicit capability is enabled. Provide both English and Chinese states.
- Align the existing archive-operation read allowlist with producer operation IDs,
  including valid leading hyphens/underscores and the actual 22–128 character
  bound; keep the route and all identity/body checks closed.

## Validation

- Targeted owner/controller/consent/AuthProvider tests pass, including disabled
  rollout, independent timeout/revocation, real failures, malformed profiles,
  account races and read-only boundary checks.
- Full root check and exact-head CI run before delivery. No deployment inputs,
  cloud permissions or Muse rollout gates are changed by this Web PR.
