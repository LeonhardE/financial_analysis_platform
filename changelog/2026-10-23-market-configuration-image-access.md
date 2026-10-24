# Allow Market configuration updates to validate existing images

Date: 2026-10-23

## Summary

The first authenticated Market adoption imported the existing service and runtime identity,
but Cloud Run rejected the configuration PATCH because its caller could not read the existing
container image. The rejected request left the live service, image and traffic unchanged.

## Changes

- Give only the Market apply identity `artifactregistry.repositories.downloadArtifacts` on the
  existing Toronto image repository through administrator-managed Terraform. The custom role
  contains no upload, deletion, repository administration, IAM-writing or build-running permission.
- Keep the real repository-level boundary explicit: the repository is shared, so this permission
  permits reading its other images too; it cannot deploy another service.
- Extend the adoption verifier and bootstrap contract tests for the two additional administrative
  resources. Document recovery using a fresh controller replacement plan after the partial import.

## Validation

- Cloud Run audit evidence identifies the denied image-download permission and confirms that
  `run.services.update` was already granted; no broader service role is needed.
- The bootstrap correction plan contains exactly two additions and no changes or deletions.
- The nine bootstrap mocked Terraform tests pass with exact permission, repository, region and
  principal checks. Final rollout and repository-check results are recorded with the PR.
