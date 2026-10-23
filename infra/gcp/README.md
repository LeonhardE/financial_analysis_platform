# Continuous delivery

Repository Terraform state/bootstrap and the reviewed saved-plan workflow are documented in
[the Terraform foundation guide](terraform/README.md). That foundation is activated once by an
administrator after review; existing services are adopted separately in later single-target PRs.

**Service-split migration:** all three backend build configurations now default to
`_DEPLOY_SERVICE=false`. They publish images without replacing the running API.
Complete the [ordered migration](#market-user-and-config-service-migration) before
enabling deployment. In particular, the new Market image no longer serves private
identity, watchlist, or preference routes.

Pull requests, including stacked feature-branch PRs, run the GitHub Actions **Quality checks**
aggregate. It requires successful checks for every affected application target and the repository
checks described below. Make this check required, require pull requests, and block direct pushes to `main` in
GitHub branch protection before enabling automatic production deployment.

After migration, the regional Cloud Build triggers deploy production when relevant
changes reach `main`. Each configuration builds and explicitly pushes a unique
`BUILD_ID` image before updating its existing Cloud Run service. They also remain
usable through **Run trigger**, with the `main` branch selected. During migration,
the backend configurations stop after publishing that image.

## CI target selection

The CI workflow runs on every PR and push to `main`. It does not use workflow-level path filters:
the required **Quality checks** result must also complete for documentation-only changes.

| Changed paths                                                                     | Application checks                  |
| --------------------------------------------------------------------------------- | ----------------------------------- |
| `apps/web/**`, root `package-lock.json`                                           | Web                                 |
| `services/market-data-service/**`                                                 | Market                              |
| `services/user-service/**`                                                        | User                                |
| `services/config-service/**`                                                      | Config                              |
| `services/common/**`, `services/requirements-dev.txt`, `scripts/test_services.py` | All backend services                |
| `infra/gcp/cloudbuild.api.yaml`, `.user.yaml`, `.config.yaml`, `.web.yaml`        | The corresponding service or client |
| Root `package.json`, `.dockerignore`, `.github/**`, `scripts/ci/**`               | All targets                         |
| Documentation, changelogs, formatter configuration                                | No application build                |

Every selected backend installs its own dependencies, checks its own code plus `services/common`,
runs the common and selected service suites in separate processes, then builds and starts that
service's Docker image. Web checks do not install service dependencies or build backend images.

**Repository checks** always verifies formatting with root-only Node tooling and tests the CI
selector and result aggregation. Changes to infrastructure, CI tooling, the shared test runner or
root quality commands also check Python tooling and the deployment guard tests. Market's
`pyproject.toml` is an exception to service-local selection: the root quality commands currently use
its Ruff configuration for all Python code, so it selects all backends and repository Python checks.
Service jobs enforce both those root rules and their own Ruff configuration.

PR selection compares the actual base and head with a three-dot diff, so stacked PRs work without
comparing against unrelated `main` changes. Push selection uses the previous and new commit. Renames
include both old and new paths; deletions retain the former target. Missing comparison history,
initial pushes and unrecognized code paths conservatively select all targets. Register new services,
clients and shared contracts in `scripts/ci/checks.py` and its tests when adding them.

The aggregate runs even when dependencies fail or skip. It rejects missing or invalid selection
outputs, failed repository checks and any selected target that fails, is cancelled or unexpectedly
skips. Expected skips, including all application jobs on documentation-only PRs, are accepted. Keep
only **Quality checks** required; target job names and matrix membership vary with each PR.

These rules affect GitHub validation only. Console-managed Cloud Build trigger filters and Cloud Run
deployment settings remain separate and unchanged.

## Console configuration

Edit the existing `build-market-api` and `build-market-web` triggers rather than
creating duplicates:

- Event: **Push to a branch**; branch regex: `^main$`.
- Region: `northamerica-northeast2`.
- Repository: the existing connected GitHub repository.
- Configuration: the matching `cloudbuild.api.yaml` or `cloudbuild.web.yaml` file.
- Build service account: the existing `fa-build` account.
- Keep the frontend API URL and Firebase public configuration substitutions;
  configure the separate User and Config origins during the migration below.
- Do not create production Cloud Build triggers for pull requests.

Use these included-file filters to avoid builds for documentation-only changes:

| API trigger                            | Web trigger                            |
| -------------------------------------- | -------------------------------------- |
| `services/market-data-service/**`      | `apps/web/**`                          |
| `services/common/**`                   | `.dockerignore`                        |
| `.dockerignore`                        | `package.json`                         |
| `infra/gcp/cloudbuild.api.yaml`        | `package-lock.json`                    |
| `infra/gcp/deploy_existing_service.py` | `infra/gcp/cloudbuild.web.yaml`        |
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
Cloud Run. Missing services or missing etags fail an enabled deployment. Explicit
build-only mode does not query Cloud Run or require the service to exist yet.

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

## Market, User, and Config service migration

The three deployable APIs have separate entry points, dependency sets, Dockerfiles,
Cloud Run services, runtime identities, and build configurations. `services/common`
contains the small shared authentication/HTTP/instrument contract package. It does
not start another service or couple one API to another API's Python modules.

| Service      | Responsibility                                                              | Build configuration                | Runtime identity        |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| `market-api` | Public stock/index search, prices, charts, metrics, and shared market cache | `infra/gcp/cloudbuild.api.yaml`    | Keep `fa-api-runtime`   |
| `user-api`   | Verified identity (`/api/v1/me`) and private stock watchlists               | `infra/gcp/cloudbuild.user.yaml`   | New `fa-user-runtime`   |
| `config-api` | Private account preferences and version-fenced writes                       | `infra/gcp/cloudbuild.config.yaml` | New `fa-config-runtime` |
| `market-web` | Browser application with three public API origins                           | `infra/gcp/cloudbuild.web.yaml`    | Keep `fa-web-runtime`   |

The existing Market runtime name is retained to avoid an unnecessary identity
change. User validates a newly added symbol through one bounded public Market
search request; listing, duplicate adds, and removals do not depend on Market.
Config has no service-to-service dependency. None of these changes creates a
research worker, scheduled job, model call, or additional database.

### Ordered Console rollout

1. **Before merging**, open the existing `build-market-api` trigger in Cloud Build.
   Ensure it does not already override `_DEPLOY_SERVICE=true`; set it explicitly
   to `false` for the migration. A trigger substitution overrides the YAML default.
   Record the existing Market image/revision and the existing database ID for
   rollback. Keep the deployed combined API serving traffic.
2. Merge the reviewed PR and wait for CI plus the Market/Web builds. The Market
   build should report **Build-only mode** and publish its new image without
   replacing the combined API. Web's empty private origins retain the existing
   API origin, so the current private routes remain reachable during migration.
3. Create `build-user-api` and `build-config-api` main-branch triggers, using
   `fa-build`, Toronto, the existing repository and the matching YAML above.
   Keep `_DEPLOY_SERVICE=false` and run each trigger on `main` once to publish an
   image. Their included-file filters are their own `services/<name>-service/**`,
   `services/common/**`, `.dockerignore`, their matching build YAML, and
   `infra/gcp/deploy_existing_service.py`. Add `services/common/**` to the existing
   Market trigger as well.
4. Create the two runtime service accounts in IAM. Grant each
   **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) for revoked
   and disabled user verification and **Cloud Datastore User**
   (`roles/datastore.user`) on the existing project's Firestore data. Do not
   download keys. Keep the existing database, `user_watchlists` / `user_preferences`
   collections, UID-derived document keys and stored preference versions. No data
   copying, clearing, or collection recreation is needed. Shared database IAM is
   not collection-level isolation; application ownership checks remain required.
5. Create `user-api` and `config-api` from their just-built images in Cloud Run.
   Select Toronto and their respective runtime identity, port `8080`, request-based
   billing, minimum instances `0`, service-level maximum instances `1`, and a small
   concurrency such as `8`. Start with `1` CPU and `256 MiB`; measure before raising
   resource allocations. Allow browser-reachable ingress and **Allow public
   access** at the Cloud Run layer. Private routes still require a verified
   Firebase ID token in the application and return `Cache-Control: no-store`.
   Requiring a Cloud Run IAM token would reject the browser's Firebase token.
6. Configure the following environment variables before creating the services.
   Copy the current database ID exactly if it is not `(default)`:

   | Variable               | User                                            | Config           |
   | ---------------------- | ----------------------------------------------- | ---------------- |
   | `FIREBASE_PROJECT_ID`  | Existing Firebase project ID                    | Same project ID  |
   | `CORS_ORIGINS`         | Exact production Web origin, no trailing slash  | Same origin      |
   | `USER_STORE_BACKEND`   | `firestore`                                     | Omit             |
   | `CONFIG_STORE_BACKEND` | Omit                                            | `firestore`      |
   | `FIRESTORE_DATABASE`   | Existing database ID                            | Same database ID |
   | `MARKET_API_BASE_URL`  | Current public Market origin, no trailing slash | Omit             |

   Runtime ADC selects the same project as the existing services. Do not set an
   emulator host, SQLite production backend, or JSON-key environment variable.
   Keep all existing Market source/cache/budget settings for its later rollout.

7. Check `/health` on both new origins and confirm a direct unsigned request to
   `/api/v1/me`, `/api/v1/watchlist`, or `/api/v1/preferences`, as applicable,
   returns `401`. Grant `fa-build` **Cloud Run Developer** on each new Cloud Run
   service and **Service Account User** on each corresponding runtime account.
   Then set `_DEPLOY_SERVICE=true` on the User/Config triggers and run each once
   to verify deployment and configuration preservation.
8. In the Web trigger, keep `_API_BASE_URL` and the four existing Firebase values;
   set `_USER_API_BASE_URL` and `_CONFIG_API_BASE_URL` to the two exact new HTTPS
   origins. Run the Web trigger on `main`. These values are baked into the image;
   setting Cloud Run runtime environment variables does not update browser URLs.
   A configured private service failure never falls back to Market.
9. Verify existing watchlist and preferences survive, add/remove a searched stock,
   change a setting, reload, sign out/in, and confirm isolation with a second
   account. Confirm Network requests use User for identity/watchlist, Config for
   preferences and Market for public data. Keep the Market gate closed until
   these checks pass.
10. Set `_DEPLOY_SERVICE=true` on the Market trigger and run it on `main`. This
    deploys the Market-only image and removes the legacy private routes. Verify
    public markets plus private User/Config flows again. Each backend can now
    deploy independently on relevant changes. Once stable, the Market runtime's
    old Firebase Authentication Viewer role can be removed; retain Firestore data
    access for market caching. Do not remove User/Config permissions.

### Rollback and cost controls

Before step 10, the previous combined Market image still supports the old browser
configuration; roll Web back to its prior verified revision if necessary. After
step 10, **do not clear the private origins while Market is Market-only**. Either
roll back User/Config/Web to known compatible revisions with their explicit
origins, or first restore the previous combined Market image and then restore the
old Web revision. Pause the affected build triggers or set their backend deploy
gates to `false` so a later build cannot immediately overwrite a Console rollback.
The deploy script updates images, never creates services or changes IAM/settings.

Use the same existing Firestore database and billing budget. Scale-to-zero avoids
paying to keep idle instances warm, but three services do not multiply the free
tier or guarantee a zero bill. There are extra builds/images, Firebase token
checks, and a Market lookup for a new watchlist item. Included-file filters avoid
unrelated builds; no polling, keep-alive job, realtime database listener, gateway,
load balancer, or private network is required by this split. A maximum instance
setting and a budget alert are controls, not an exact monetary spending cap.

Console references: [deploy an image](https://docs.cloud.google.com/run/docs/deploying),
[service identity](https://docs.cloud.google.com/run/docs/securing/service-identity),
[Firebase Authentication role](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth),
[Firestore data roles](https://docs.cloud.google.com/iam/docs/roles-permissions/firestore),
[maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances).

## Cached-first loading and cost

Public overview/chart requests first probe `cached=true`. A usable dated snapshot
can render immediately; a stale snapshot triggers an ordinary request while the
browser keeps showing it. A missing snapshot returns bodyless 204. Search and
private account data never use this cache path. The overlapping default 1M chart
refresh waits for the overview refresh and then probes its newly populated cache.
There is no periodic polling or background work after the API response, and
existing upstream limits remain in force.

The frontend image runs Next.js standalone output with traced dependencies; the
API imports yfinance only for a download/search. Existing request-based billing
and minimum-instance settings are retained. No new Console configuration is
required. A completely empty cache still needs the upstream source, and Cloud Run
scale-from-zero plus Firestore/network latency must be measured after deployment;
the implementation does not promise a 1–2 second cold-start SLA.

For a repeatable local mechanism benchmark (synthetic provider, temporary SQLite,
no cloud credentials or external requests):

```sh
services/market-data-service/.venv/bin/python infra/gcp/benchmark_market_loading.py
```

For local browser timing, build with `NEXT_PUBLIC_PERFORMANCE_DEBUG=true` and open
that production build. The browser console reports the first populated chart
paint from navigation after two animation frames. This is opt-in local logging,
not external telemetry. Use the same network/device conditions for comparison;
measure empty cache, expired cache, warm cache, and a service idle long enough to
scale to zero separately. Record the source timestamps and refresh status along
with timings so skeletons or undated prices do not count as useful data.
