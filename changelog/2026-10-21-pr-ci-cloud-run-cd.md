# PR checks and Cloud Run deployment after merge

Date: 2026-10-21

## Summary

Pull requests receive a single required-quality-check candidate. Existing Cloud Build pipelines can
build and deploy both Cloud Run services after a change reaches `main`, once the documented Console
permissions, branch protection, and trigger events are configured.

## Changes

- Add GitHub Actions checks for PRs targeting `main` and pushes to `main`, using pinned official
  actions, Node 24, Python 3.13, the repository checks, and a production frontend build.
- Push each built image before deploying it to the existing Cloud Run service. Preserve its
  environment, secrets, service identity, resources, and scaling settings.
- Guard deployments with Cloud Run etags and Cloud Build creation timestamps so an earlier-created
  build that finishes late cannot overwrite a newer accepted deployment. Failed revisions fail the
  build. This guard does not establish Git ancestry or webhook delivery order.
- Include infrastructure lint, format, and deployment tests in the root quality checks. Document
  the Console IAM roles, path filters, trigger setup, branch protection, and rollback process.
- Reuse existing services and service accounts; no new cloud services or long-lived keys are added.

## Validation

- `npm run check`: 30 web tests, 70 backend tests, and 8 infrastructure tests pass, including
  configuration preservation, concurrent updates, deployment ordering, and failure handling.
- `npm run build:web`: production frontend build passes.
- Cloud IAM, trigger events, branch protection, and production deployment are not changed by this
  commit; the first merged PR will validate the configured cloud deployment path.
