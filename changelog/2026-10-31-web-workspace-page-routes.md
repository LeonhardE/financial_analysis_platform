# Give workspace pages refreshable routes

Date: 2026-10-31

## Summary

Resources, Tasks, Agents, Inbox and Settings now keep their own URL on refresh instead of returning
to Market. `/` and `/market` remain equivalent Market entry points.

## Changes

- Add explicit Next App Router pages under one persistent workspace layout, including the
  `/market`, `/resources`, `/tasks`, `/agents`, `/inbox` and `/settings` paths.
- Derive the selected view from the pathname and use real sidebar links with accessible current
  page state, native modified-click behavior and working history navigation.
- Keep the existing encrypted workspace and Market choices in the shared shell across internal
  navigation; full refresh, logout, account changes and locking retain existing security rules.
- Preserve legacy Inbox fragment links and Agent consent query handoffs through compatible
  path normalization. Unknown paths retain the normal 404.
- Make the existing renewal corruption fixture flip an actual ciphertext byte. Replacing a
  random final base64url character with `A` could leave the ciphertext unchanged and cause a
  random negative-test failure; the encryption implementation is unchanged.

## Validation

- Frontend typecheck and production build passed.
- 33 targeted workspace/navigation/Market/full-flow tests and all 14 renewal crypto tests passed.
- Production HTTP checks: all seven public page URLs returned 200 with the matching selected
  sidebar link; two unknown paths returned 404.
- Anonymous browser checks passed for Settings refresh/back/forward, Market range preservation
  across Resources navigation, 390px mobile navigation closure, legacy Inbox normalization and
  consent precedence. No hydration warning was observed. Real Google/Passkey prompts were not
  automated.
- The full repository root check runs before committing.
