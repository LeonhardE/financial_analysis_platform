# Add offline pinned User/Hub trust configuration

Date: 2026-10-31

## Summary

Provide the repository configuration prerequisite for INF-007 without activating trust or
changing deployed services. A later User-only PR can consume independently reviewed candidates.

## Changes

- Add opt-in profile v3 with closed User/Hub trust settings and an explicit numeric Hub identity.
- Derive fixed User service/delegation audiences, Hub issuer and one exact runtime caller mapping.
- Generate separate private offline candidates and an explicit self-contained User projection,
  bound to both selected deployment anchors and trusted configuration hashes; reject malformed,
  mixed-instance or altered inputs.
- Require a closed source-consumer opt-in before the normal pipeline accepts the new User-only
  trust extension. Existing User source remains unmigrated and fails closed for that extension.
- Retain v1/v2 and existing compile/render/Web-owner projection semantics. No existing deployment
  consumer, target instance, IAM grant, pipeline activation, release mode or private profile changes.

## Validation

- All 20 targeted offline configuration tests and all 271 infrastructure tests pass, including
  legacy projection snapshots, default denial, identity/audience binding, malformed inputs,
  cross-instance rejection, consumer opt-in and CLI output protections.
- Full root `npm run check` runs through the pre-commit hook, covering existing Web/backend,
  infrastructure, repository, security, lint and formatting checks.
- No cloud apply, runtime deployment, permission mutation or operator-profile update is performed.
