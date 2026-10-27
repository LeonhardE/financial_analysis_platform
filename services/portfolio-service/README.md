# Portfolio service skeleton

Independent build-only target for future encrypted holdings APIs. This version exposes only
`GET /health`, returning `{"status":"ok","service":"portfolio"}`. It has no persistence,
brokerage connection, inference call, credential loading or upstream client. Unimplemented private
and brokerage paths return 404 with `Cache-Control: no-store`; they do not simulate successful
imports or connections. Authentication, delegation and actual holdings behavior belong to later
Portfolio tickets. Shared private HTTP handling provides response boundaries, not authentication
for future routes.

## Local development

From this directory, using Python 3.13:

```bash
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt ../common
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8080 --no-access-log
```

The optional `.env.example` documents `PORT` and `CORS_ORIGINS`; load variables explicitly in your
shell if needed. Uvicorn does not automatically load that file. No account, Firebase, database or
brokerage credentials are required. Health describes process readiness, not dependency readiness.

From the repository root, after registration:

```bash
services/market-data-service/.venv/bin/python scripts/test_services.py --service portfolio-service
docker build --file services/portfolio-service/Dockerfile --tag portfolio-smoke .
docker run --rm --network none --name portfolio-smoke portfolio-smoke
```

The container runs as UID 10001 and honors Cloud Run's `PORT` environment variable. CI builds the
image independently and checks its health through container-local loopback with networking
disabled. Tests also exercise cold import/startup with outbound sockets and credential-configuration
reads forbidden, without loading another service's application package.

## Build-only release boundary

`infra/gcp/cloudbuild.portfolio.yaml` builds and pushes `portfolio-api:$BUILD_ID` to the existing
Artifact Registry repository. `_DEPLOY_SERVICE` defaults to `false`, so the shared release helper
returns without credentials or Cloud Run calls. The target registry uses `release_mode=build_only`;
setting deployment to true is rejected before credentials/API calls while that mode remains.
The configuration does not create a build trigger, identity, database, service or infrastructure
target. Publishing requires the existing approved build identity and registry; retain the actual
registry `sha256:` digest as evidence. A local image ID is not a remote immutable image reference.

The service-specific CI and Cloud Build file are configuration only. First provisioning and later
release enablement belong to INF-005, after the separate legacy IAM rollout prerequisites. An
approved source build or later first-provision request must still meet the shared provenance and
digest checks; this skeleton does not grant approval or bypass them.

The build-only configuration also starts the exact built image with `--network=none`, verifies its health inside the container and removes that temporary container before publication. The published digest therefore comes from a build that passed this isolated-image smoke check.
