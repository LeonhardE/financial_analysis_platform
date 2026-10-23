# Accept Cloud Build resolved Git provenance

Date: 2026-10-23

## Summary

The first live repo plan stopped before Terraform initialization because its GitHub trigger returned
`sourceProvenance.resolvedGitSource`. The verifier only accepted `resolvedConnectedRepository`, even
though the resolved Git repository URL and commit were correct.

## Changes

- Support both documented output-only provenance formats. Keep connected repository resource checks;
  validate resolved Git sources against an exact clone URL committed in pipeline policy.
- Preserve exact commit, root-directory, trigger, execution identity, native approval and saved-plan
  checks. Reject missing, mixed, unsupported, malformed and mismatched sources without falling back
  to request source fields or substitution labels.
- Add regression coverage based on the observed live GitHub build shape, mixed plan/apply source
  formats and rejection cases. No IAM, bootstrap resources or business service settings change.

## Validation

- Full root `npm run check` passed, including 71 infrastructure tests and 32 CI routing tests.
- Terraform backend-disabled initialization, validation and eight native tests passed.
- No cloud apply was executed. After merge, the existing main trigger generates a fresh plan with
  the corrected verifier; the failed build cannot be used as an apply producer.
