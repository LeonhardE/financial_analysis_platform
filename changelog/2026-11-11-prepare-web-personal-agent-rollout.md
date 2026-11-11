# Prepare Web configuration for personal Agent authorization

Date: 2026-11-11

## Summary

Use only the existing six Owner settings and Hub origin for personal Agent authorization, refusing retired Policy/Executor selection.

## Changes

- Remove the independent Agent environment projection and trust configuration consumer.
- Remove the obsolete executor-trust package filter from the existing Web release trigger.
- Retain Web identity, invocation, capacity, image/traffic ownership and existing build values; document separate rollout and acceptance.

## Validation

- Root `npm run check` via the normal commit hook.
- Native Web and bootstrap Terraform mock-provider plan tests without cloud API calls.
- No apply, deployment or online validation was performed.
