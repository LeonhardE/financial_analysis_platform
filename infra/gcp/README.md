# Continuous delivery

Pull requests targeting `main` run the GitHub Actions **Quality checks** job. It
checks both applications and builds the frontend without cloud credentials. Make
this check required, require pull requests, and block direct pushes to `main` in
GitHub branch protection before enabling automatic production deployment.

The existing regional Cloud Build triggers deploy production when relevant
changes reach `main`. Both configurations build and explicitly push a unique
`BUILD_ID` image before updating the existing Cloud Run service. They also remain
usable through **Run trigger**, with the `main` branch selected.

## Console configuration

Edit the existing `build-market-api` and `build-market-web` triggers rather than
creating duplicates:

- Event: **Push to a branch**; branch regex: `^main$`.
- Region: `northamerica-northeast2`.
- Repository: the existing connected GitHub repository.
- Configuration: the matching `cloudbuild.api.yaml` or `cloudbuild.web.yaml` file.
- Build service account: the existing `fa-build` account.
- Keep the frontend API URL and Firebase public configuration substitutions.
- Do not create production Cloud Build triggers for pull requests.

Use these included-file filters to avoid builds for documentation-only changes:

| API trigger                            | Web trigger                            |
| -------------------------------------- | -------------------------------------- |
| `services/market-data-service/**`      | `apps/web/**`                          |
| `.dockerignore`                        | `.dockerignore`                        |
| `infra/gcp/cloudbuild.api.yaml`        | `package.json`                         |
| `infra/gcp/deploy_existing_service.py` | `package-lock.json`                    |
|                                        | `infra/gcp/cloudbuild.web.yaml`        |
|                                        | `infra/gcp/deploy_existing_service.py` |

Grant the build service account **Cloud Run Developer** (`roles/run.developer`)
on each existing Cloud Run service and **Service Account User**
(`roles/iam.serviceAccountUser`) on each service's runtime account. Keep the
existing Cloud Build Service Account role. No service account key, GitHub cloud
secret, new database, or deployment orchestrator is required.

## Deployment behavior

`deploy_existing_service.py` verifies the build's main-branch metadata and uses
Cloud Run's etag to update a current snapshot of the revision settings. It changes
the image and revision name, records build metadata in custom service annotations,
and directs traffic to the latest ready revision. Environment variables, secrets,
runtime identity, CPU, memory, scaling, ingress, and IAM remain configured in
Cloud Run. Missing services or missing etags fail the build.

Each service records the accepted build's Cloud Build creation time. An
earlier-created build that finishes late cannot overwrite a later accepted build;
an etag conflict forces a new read and ordering check. This order concerns build
creation time, rather than Git ancestry or webhook delivery order. A manual run
should use current `main`. A newer documentation-only commit does not invalidate
the latest application build. Rollback remains an explicit Cloud Run Console
action; later successful builds can deploy forward again.

The deployment polls the service resource for readiness, using the existing
service-scoped permissions without querying separate regional operation resources.
Success requires the expected revision and image, completed reconciliation, matching
observed and desired generations, and 100% effective traffic on that revision.
Startup failures are reported even when the previous revision remains healthy;
pending or inconsistent status times out rather than reporting success. An accepted
update is not submitted again when a subsequent service read is stale.

Existing traffic keeps serving while a new revision starts. The API and web deploy
independently, so API changes should remain compatible with the currently deployed
frontend. If an older build failed while polling an operation after its update was
accepted, inspect Cloud Run revision history: the revision may already be serving.
Merge the polling fix before starting a new build; retrying the old commit uses the
old deployment script.

## Validation

Run the release ordering and configuration preservation tests without cloud
access:

```sh
python3 -m unittest discover -s infra/gcp/tests -v
```

References: [Cloud Run deployment permissions](https://cloud.google.com/run/docs/reference/iam/roles#deployment_permissions),
[Cloud Run service etag and revision settings](https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.services),
[Cloud Build substitutions](https://cloud.google.com/build/docs/configuring-builds/substitute-variable-values).
