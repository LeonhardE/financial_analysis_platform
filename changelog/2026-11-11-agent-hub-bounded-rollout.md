# Bound personal Agent rollout to reviewed accounts

Date: 2026-11-11

## Summary

Keep production synthetic acceptance within explicitly reviewed accounts instead of
opening personal Agent authorization to every signed-in Owner.

## Changes

- Add a bounded Owner admission list for native approval, existing native tokens,
  credential setup/replacement and managed execution. Invalid configuration denies access.
- Preserve Owner history and disconnect; signed resource consent remains mandatory.
- Make the existing Hub deployment supply an empty list by default and require
  reviewed accounts before enabling personal Agent mode. No cloud resources are added.

## Validation

- Six targeted admission tests cover real OAuth, credential replacement, PoP/report
  rejection, scope removal during source retrieval and retained history.
- All 26 Hub mock-provider deployment tests pass, including empty, duplicate, malformed
  and oversized Owner admission scopes. Full repository and normal pre-commit checks pass.
