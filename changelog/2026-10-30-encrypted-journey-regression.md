# Encrypted workspace journey and result bookmarks

Date: 2026-10-30

## Summary

Validate Resources, Tasks, Muse consent and Inbox as one synthetic product journey, and make
verified results and historical revisions bookmarkable without placing private text in URLs.

## Changes

- Add closed result/revision fragments that retain normal owner, Passkey and encrypted-evidence
  checks. Preserve pending links through login/unlock, clear prior-session intent on logout or
  account changes, keep consent handoffs authoritative and return Market navigation to its default.
- Compose actual CSV/WebCrypto/helper operations across both templates and all three resources,
  including frozen inputs, reports, revisions, receipt recovery and multiple owners/agents.
- Join the actual authenticated client and Next forwarding routes to controlled signed synthetic
  responses, preserving original ciphertext and separating owner identity from Portfolio IAM.
- Cover cross-view and interrupted-link behavior alongside existing Market, source and session
  regressions. No test authentication mode or cloud configuration is added to the product.

## Validation

- All 410 local Web tests passed, including 20 new cross-module cases, with no skips.
- Root `npm run check` passed, including 351 existing Hub tests; production Web build passed.
- The actual anonymous build was checked at desktop and phone widths for default/brand Market,
  guarded links, keyboard navigation, mobile-menu isolation, both languages and light/dark themes.
- Synthetic upstreams, browser facades and Passkey material are explicitly distinguished from
  real Muse host, native device and production IAM acceptance.
