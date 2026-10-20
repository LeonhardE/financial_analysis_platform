# Financial Analysis Platform

A monorepo for a US-stock watchlist and portfolio risk tracking product.

The current local MVP has no authentication and makes no third-party API calls. Its market data
service exposes fixed mock OHLCV data for the Magnificent Seven, and the web app renders one month
of candlesticks.

## Repository structure

```text
apps/
  web/                         Next.js web client
services/
  market-data-service/         FastAPI market data service
changelog/                     One Markdown record per change
```

`apps/web` follows the conventional short name used for a browser application.
`market-data-service` describes the service's current responsibility and leaves room for future
portfolio, risk, and user services to be introduced independently.

## Local setup

Install the web workspace and repository tooling:

```bash
npm install
```

Create the Python environment and install the API dependencies:

```bash
python3 -m venv services/market-data-service/.venv
services/market-data-service/.venv/bin/pip install \
  -r services/market-data-service/requirements-dev.txt
```

Start the API:

```bash
cd services/market-data-service
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Start the web client from another terminal:

```bash
npm run dev:web
```

The web client runs at `http://localhost:3000`; the API documentation is available at
`http://localhost:8000/docs`.

## Quality checks

Run every check from the repository root:

```bash
npm run check
```

Format both TypeScript/CSS/Markdown and Python code:

```bash
npm run format
```

`simple-git-hooks` installs a local pre-commit hook during `npm install`. The hook runs
`npm run check`, so commits are blocked when frontend formatting/type checks or backend Ruff checks
fail.

## Cloud Run deployment

The existing mock MVP can run as two public Cloud Run services. Build both Dockerfiles from the
repository root using the Cloud Build configuration files below, then deploy the resulting images
through the Cloud Run console. These configurations build and push images only; they do not deploy
services or run the full repository quality checks.

1. Create a regional Docker Artifact Registry repository named `financial-analysis`. The default
   region in the build configurations is `northamerica-northeast2` (Toronto).
2. Create a Cloud Build trigger for `infra/gcp/cloudbuild.api.yaml` and run it. Deploy its `market-api`
   image with port 8080 and public access; copy the HTTPS service origin.
3. Create a trigger for `infra/gcp/cloudbuild.web.yaml`. Set its `_API_BASE_URL` substitution to that
   API origin, without a path or trailing slash, then build and deploy the `market-web` image with
   port 8080 and public access.
4. Set the API service's `CORS_ORIGINS` runtime environment variable to the exact frontend origin,
   then deploy that configuration as a new API revision. Multiple explicit origins are comma-separated;
   omitting the variable preserves the local development defaults.

Use dedicated build and runtime service accounts. The build account needs build, registry and logging
permissions; the current runtime accounts need no application resource roles. Keep minimum instances
at zero for this prototype and configure a maximum instance count and billing alerts. An alerts-only
budget is not a spending cap. Public access is suitable for this mock-only version; authentication and
user ownership checks are required before introducing private data.

The frontend API address is compiled into its browser bundle. Changing a Cloud Run runtime variable
does not update it: rebuild and redeploy the frontend image when that API origin changes. Both
containers listen on `0.0.0.0` and Cloud Run's `PORT` (8080 by default). No application API key or
database is needed for this version.

The local-only bilingual runbook is `local-docs/gcp-console-mvp-deployment.cn.md` and
`local-docs/gcp-console-mvp-deployment.en.md`; these files remain excluded from Git.

## Change records

Every material change outside `local-docs/` should add one file under `changelog/`. Changes confined
to local-only documentation do not require a change record. See `changelog/README.md` for the format
and naming convention.
