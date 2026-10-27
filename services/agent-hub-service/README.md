# Agent Hub service skeleton

HUB-001 introduces the independently buildable `agent-hub-service` backend and
`agent-hub-api` image. Only `GET /health` is implemented:

```json
{ "status": "ok", "service": "agent-hub" }
```

Startup and health do not require User, Portfolio, Muse, Firebase, Firestore,
brokerage credentials, model keys or network access. OpenAPI lists only health.
There is no task execution, OAuth exchange, MCP adapter, resource read, result
writeback, user authentication or database client in this skeleton.

## Local development and checks

Use Python 3.13 or newer. From the repository root, create an isolated environment:

```bash
python3.13 -m venv services/agent-hub-service/.venv
services/agent-hub-service/.venv/bin/python -m pip install \
  -r services/agent-hub-service/requirements-dev.txt ./services/common
cd services/agent-hub-service
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --no-access-log
```

`PORT` is consumed by the container entrypoint (default `8080`). `CORS_ORIGINS`
uses the existing shared HTTP configuration (localhost development origins when
unset); copy the example's empty value when no browser origins should be allowed.
No provider, brokerage or database
environment settings are required or read by this service.

After registration, use the repository's isolated runner from its root:

```bash
services/agent-hub-service/.venv/bin/python scripts/test_services.py \
  --service common --service agent-hub-service
docker build --file services/agent-hub-service/Dockerfile --tag folioview-agent-hub:test .
docker run --detach --network none --name agent-hub-smoke folioview-agent-hub:test
docker exec agent-hub-smoke python -c \
  'import json, urllib.request; print(json.load(urllib.request.urlopen("http://127.0.0.1:8080/health")))'
docker rm --force agent-hub-smoke
```

The process runs as UID `10001`, with access logging disabled so request paths
and query strings are not automatically emitted. The image contains this service and the shared
library; it does not copy any other backend's application source. CI checks the
registered service independently, builds its Dockerfile and checks health with
container networking disabled.

## Reserved private and connector boundaries

Future browser APIs belong under `/api/`; MCP, OAuth/discovery and connector
adapters retain separate `/mcp`, `/oauth/`, `/.well-known/` and `/connectors/`
boundaries. These paths currently return ordinary `404 {"detail":"Not Found"}`
with `Cache-Control: no-store`, including requests carrying an Authorization
header. No request payload or token is reflected in that response. CORS does
not grant authentication. A health response proves only this process is alive;
it does not establish agent compatibility, authorization, private-data storage
or dependency readiness.

Shared delegated identity and encrypted-envelope foundations will be adopted by
their corresponding Hub feature tickets; this skeleton does not reconstruct or
weaken those contracts.

## Build-only delivery

The source registry marks this target `build_only`.
[`cloudbuild.agent-hub.yaml`](../../infra/gcp/cloudbuild.agent-hub.yaml) builds
and pushes a unique `$BUILD_ID` tag to the existing regional Artifact Registry
repository, with `_DEPLOY_SERVICE=false`. The existing release helper makes no
Cloud Run call in that mode and rejects an attempted `true` override for a
registered build-only target before obtaining cloud credentials.

This configuration creates no build trigger, identity, database or Cloud Run
service. No inference is invoked. A separately authorized build may publish to
existing infrastructure; record the actual registry digest or Cloud Build image
result. A local Docker image ID is not a published manifest digest. Do not
claim private API/agent support or enable release from this skeleton. First
provisioning and its runtime permissions remain INF-006; its reviewed build
provenance and first-provision approval rules still apply.

The build-only configuration starts the exact built image with `--network=none`, verifies health inside the container and removes it before publication. The published digest comes from an image that passed this isolated smoke check.
