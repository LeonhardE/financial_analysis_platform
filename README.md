# Financial Analysis Platform

A monorepo for a US-stock watchlist and portfolio risk tracking product.

The current MVP renders fixed mock OHLCV data for the Magnificent Seven. Market browsing remains
public. Optional Google sign-in uses Firebase Authentication, with the API independently verifying
identity before returning a profile. Personal watchlists, market search, three-index coverage, real
market data and YouTube summaries are planned follow-up work.

## Repository structure

```text
apps/
  web/                         Next.js web client
services/
  market-data-service/         FastAPI market data and identity API
infra/gcp/                     Build-and-push Cloud Build configurations
changelog/                     One Markdown record per material tracked change
```

## Local setup

Use Node.js 24.12 or newer and Python 3.13. Install the web workspace and repository tooling:

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

The web client runs at `http://localhost:3000`; API documentation is at `http://localhost:8000/docs`.
Neither Firebase nor a database is required to browse the mock market page locally.

## Google sign-in configuration

Add Firebase to the existing Google Cloud project, enable the Google sign-in provider, register a
Firebase Web app, and add your frontend hostname to Authentication's authorized domains. Ensure
`localhost` is listed when testing locally, adding it if absent. No Firebase Hosting deployment is needed.

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in all four public Firebase values from
that Web app's configuration: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
`NEXT_PUBLIC_FIREBASE_PROJECT_ID`, and `NEXT_PUBLIC_FIREBASE_APP_ID`. Keep `authDomain` exactly as
Firebase provides it; it is separate from the frontend's authorized hostname. Leaving all four empty
keeps anonymous browsing available with sign-in unavailable. Restart local Next.js after changes.

Set `FIREBASE_PROJECT_ID` in the API process to the same Firebase project ID. The API uses Application
Default Credentials (ADC); on Cloud Run, use its attached runtime service account. Grant that account
**Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) on the project so it can check whether
users have been disabled, deleted, or their tokens revoked. Do not download a service-account JSON key.
For local real-project testing, configure local ADC separately; the API does not automatically load
`.env` files. For example, use Uvicorn's `--env-file .env` when starting inside the service directory.

The browser signs in with Google's popup and sends a Firebase ID token in the Authorization header to
`GET /api/v1/me`. Only the backend-verified profile is shown as signed in. Invalid identities return
401; missing configuration or upstream failures return 503. Identity responses are not cached. The
existing health, stock list and candle endpoints remain public, even if Firebase is unavailable.
This phase creates no user database and requests no YouTube access.

Firebase's SDK manages session persistence and token refresh; application code does not copy tokens
into custom storage. Sign-out clears this browser's session. It does not revoke sessions on other
devices. Do not configure shared caches to cache authenticated API responses.

For local QA, the official Firebase Authentication emulator can be selected using
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` on the API and
`NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099` on a development frontend, with matching
project IDs. Use a `demo-` project and synthetic accounts. Never set emulator configuration in
production: the frontend rejects it in production and the API rejects it on Cloud Run.

## Quality checks

Run every check from the repository root:

```bash
npm run check
npm run build:web
```

`check` includes frontend types, formatting and session race tests, backend Ruff checks, and API
authentication tests.
The tests cover verified identity, forged or invalid tokens, expiry, revocation, disabled/deleted users,
provider restrictions, configuration failures, CORS, and anonymous market access without Firebase.
They mock Firebase verification; a real Google popup still needs Console setup and a live smoke test.

Format TypeScript/CSS/Markdown and Python code with `npm run format`. The local pre-commit hook runs
`npm run check`.

## Cloud Run deployment

Both public Cloud Run services use port 8080. Build Dockerfiles from the repository root, then deploy
images through the Cloud Run Console. Cloud Build configurations build and push images only; they do
not deploy services or run the full repository quality checks.

1. Create a regional Docker Artifact Registry repository named `financial-analysis`. The build
   configurations default to `northamerica-northeast2` (Toronto).
2. Run a Cloud Build trigger using `infra/gcp/cloudbuild.api.yaml`. Deploy its `market-api` image;
   copy the HTTPS service origin. For sign-in, set the API runtime's `FIREBASE_PROJECT_ID` and attach
   the runtime identity with the Firebase Authentication Viewer role described above.
3. Create a trigger for `infra/gcp/cloudbuild.web.yaml`. Set `_API_BASE_URL` to that API origin,
   without a path or trailing slash. For sign-in, also set `_FIREBASE_API_KEY`, `_FIREBASE_AUTH_DOMAIN`,
   `_FIREBASE_PROJECT_ID` and `_FIREBASE_APP_ID` from the Firebase Web app. All four may remain empty
   for an anonymous-only deployment. Build and deploy the resulting `market-web` image.
4. Set the API's `CORS_ORIGINS` runtime variable to the exact frontend origin, without a trailing
   slash, then redeploy the API. Multiple explicit origins are comma-separated. Add the frontend
   hostname, without protocol or path, to Firebase Authentication's authorized domains.
5. Test anonymous stock browsing, Google sign-in, refresh, sign-out, and unauthenticated rejection
   of `/api/v1/me`. Verify both services serve the new revisions.

Frontend `NEXT_PUBLIC_*` values are compiled into the browser bundle. Changing Cloud Run runtime
variables does not update them: rebuild and redeploy the frontend image. Firebase Web configuration
is public, but OAuth client secrets, service-account keys and ID tokens must never be build arguments.

Use dedicated build and runtime service accounts. Only the API runtime needs the Firebase read role;
the web runtime needs no application resource role. Keep minimum instances at zero and a small maximum
instance count. The existing alerts-only budget is not a spending cap. Cloud Run, build, storage and
network charges remain separate from Authentication. Do not enable paid market data, SMS sign-in,
Cloud SQL or other infrastructure for this phase.

The local bilingual deployment and authentication runbooks remain excluded from Git in `local-docs/`.

## Change records

Every material change outside `local-docs/` should add one file under `changelog/`. Local-only
documentation changes do not require a change record. See `changelog/README.md` for the convention.
