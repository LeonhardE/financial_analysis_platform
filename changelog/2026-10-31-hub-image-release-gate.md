# Gate Agent Hub existing-service image deployment explicitly

Date: 2026-10-31

## Summary

Allow a separately reviewed Hub image release after its service has been provisioned,
while keeping ordinary Terraform execution, public invocation and application rollout
independent and preserving build-only defaults.

## Changes

- Add an administrator-only, default-false image-deployment flag requiring a retained Hub
  service stage; ordinary profile compilation cannot silently supply the flag.
- Give the dedicated Hub builder only the existing service's get/update role, attachment
  of its own runtime, and the existing build-metadata read role when explicitly enabled.
- Order trigger deployment after those exact bindings and report the image opt-in in
  preparation metadata, without creating another service or broadening content access.
- Document the separate catalog prerequisite and complete-plan review boundary.

## Validation

- Native bootstrap mock plans cover inert/default stages, retained service ownership,
  exact service/runtime/build-metadata grants, and rejection before the service stage.
- Infrastructure tests verify the closed compiler excludes the administrator override.
- Root `npm run check` runs before commit; no cloud operations are part of these tests.
