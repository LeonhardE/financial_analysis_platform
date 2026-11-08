# Rebuild Web for shared browser contract changes

Date: 2026-11-07

## Summary

Include the Web frontend's shared encrypted-workspace dependency in the existing
Web Cloud Build trigger's file filter.

## Changes

- Watch `packages/encrypted-workspace/**` alongside the existing Web build inputs.
- Preserve the selected trigger ID, repository binding, main branch, substitutions,
  execution identity, approval behavior and deployment configuration.

## Validation

- Native bootstrap mock plans assert the exact Web filter and unchanged settings.
- Full repository `npm run check` before commit.
- Actual changes require a reviewed complete bootstrap plan with only the Web
  trigger filter update, followed by exact-plan apply and live metadata verification.
