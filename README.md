# Financial Analysis Platform

A monorepo for a US-stock watchlist and portfolio risk tracking product.

The MVP shows daily market data through yfinance in Lightweight Charts. Anonymous visitors can
browse the S&P 500, Nasdaq Composite, Dow Jones Industrial Average and Magnificent Seven, or search
for other US stocks. Optional Google sign-in uses Firebase Authentication, with the API independently
verifying identity before returning a profile. Personal watchlists and YouTube summaries are planned
follow-up work.

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
The default data source is yfinance, with a persistent local SQLite cache; Firebase configuration is
optional for anonymous browsing. To work offline with fictional fixtures, explicitly set
`MARKET_DATA_SOURCE=mock` in the API process. The page labels this mode as mock data. Real-data
failures never fall back to fictional prices.

## Daily market data and caching

The API fetches adjusted daily OHLCV from Yahoo Finance using yfinance. It uses the actual index
symbols `^GSPC`, `^IXIC` and `^DJI`, with public IDs `SPX`, `IXIC` and `DJI`. Index levels display as
points; stocks display in USD. The daily percentage change compares the latest bar with the previous
trading day's bar. Historical OHLC is adjusted for splits and dividends.

The latest daily bar can still change during a trading session. The page includes the trading date,
fetch time and a partial-session indicator; it does not promise exchange-grade real-time prices.
Failed refreshes may serve previously fetched data with a stale warning. Without usable cached data,
prices are unavailable and the chart offers a retry.

Cloud Run uses Firestore for shared cached data, refresh leases and an atomic daily upstream budget.
This preserves cache contents and limits across cold starts and multiple instances. Create a
**Standard edition, Native mode** Firestore database named `(default)` in the API's region. Keep
browser Security Rules in production mode (deny all reads and writes); only the API server accesses
the database using its attached identity. Grant the API runtime **Cloud Datastore User**
(`roles/datastore.user`). The browser and web runtime need no Firestore access. No service-account
key is required. Cloud Run refuses to fetch upstream data if its shared cache is unavailable.

The API does not automatically load `.env` files. Set its environment directly, or use Uvicorn's
`--env-file .env` option locally. Relevant settings are:

| Variable                      | Default                                      | Purpose                                                         |
| ----------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `MARKET_DATA_SOURCE`          | `yfinance`                                   | Real daily data; explicit `mock` enables fixtures.              |
| `MARKET_CACHE_BACKEND`        | `firestore` on Cloud Run, otherwise `sqlite` | Shared production storage or local file storage.                |
| `MARKET_CACHE_PATH`           | `/tmp/financial-analysis/market.sqlite3`     | Local SQLite file only.                                         |
| `MARKET_FIRESTORE_DATABASE`   | `(default)`                                  | Firestore database ID.                                          |
| `MARKET_CACHE_TTL_SECONDS`    | `3600`                                       | Cache reuse during trading hours; bounded to 900–86400 seconds. |
| `MARKET_UPSTREAM_DAILY_LIMIT` | `200`                                        | Shared refresh units per UTC day; bounded to 10–1000.           |

A ten-instrument batch consumes ten refresh units; a search or additional-stock refresh consumes
one. Units describe application work, not an exact count of Yahoo HTTP requests. A second shared
limit allows 20 units per minute. Unavailable refreshes cool down for five minutes, or fifteen minutes
for detected provider rate limits. Off-hours reuse can extend until the next weekday at 09:35 New
York time; this approximation does not include an exchange holiday calendar. There is no automatic
polling or paid scheduler. Cached data is usable for up to seven days; this age limit does not delete
stored documents or enable paid TTL deletion.

Local development uses SQLite without Google credentials. The upstream budget limits provider work,
not total Google Cloud charges; public HTTP traffic, database access and Cloud Run usage remain
billable under their own quotas. Keep minimum instances at zero, maximum instances small, and
optional Firestore TTL deletion, backups and point-in-time recovery disabled for this phase.

yfinance is an unofficial Yahoo client intended for personal research. See its
[maintainer documentation](https://github.com/ranaroussi/yfinance) for data-use terms. It requires no
paid stock-data subscription or API key. Cloud IPs may be rate limited; test actual Cloud Run access
after deployment, and retain the explicit unavailable/stale states if that occurs.

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
The shared market cache contains public market data, not user profiles or watchlists. Sign-in
requests no YouTube access.

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

`check` includes frontend types, formatting and request/session race tests, backend Ruff checks, and
API tests for authentication, market data validation, caching and refresh limits. Unit tests mock
external providers; live Yahoo access, Firestore IAM and the Google popup require deployment smoke
tests as well.

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
   the runtime identity with the Firebase Authentication Viewer role described above. Before
   switching to real data, create the Firestore database and grant Cloud Datastore User as described
   in the caching section. Set `MARKET_DATA_SOURCE=yfinance` and `MARKET_CACHE_BACKEND=firestore`.
3. Create a trigger for `infra/gcp/cloudbuild.web.yaml`. Set `_API_BASE_URL` to that API origin,
   without a path or trailing slash. For sign-in, also set `_FIREBASE_API_KEY`, `_FIREBASE_AUTH_DOMAIN`,
   `_FIREBASE_PROJECT_ID` and `_FIREBASE_APP_ID` from the Firebase Web app. All four may remain empty
   for an anonymous-only deployment. Build and deploy the resulting `market-web` image.
4. Set the API's `CORS_ORIGINS` runtime variable to the exact frontend origin, without a trailing
   slash, then redeploy the API. Multiple explicit origins are comma-separated. Add the frontend
   hostname, without protocol or path, to Firebase Authentication's authorized domains.
5. Test all three indices, an additional stock found through search, daily data dates, cache reuse,
   Google sign-in, refresh, sign-out and unauthenticated rejection of `/api/v1/me`. Verify both
   services serve the new revisions. The health endpoint reports the configured source without
   contacting Yahoo; a healthy process alone does not prove that market refreshes succeed.

Frontend `NEXT_PUBLIC_*` values are compiled into the browser bundle. Changing Cloud Run runtime
variables does not update them: rebuild and redeploy the frontend image. Firebase Web configuration
is public, but OAuth client secrets, service-account keys and ID tokens must never be build arguments.

Use dedicated build and runtime service accounts. Only the API runtime needs the Firebase read role;
the web runtime needs no application resource role. Keep minimum instances at zero and a small maximum
instance count. The existing alerts-only budget is not a spending cap. Cloud Run, build, storage and
network charges remain separate from Authentication. Do not enable paid market data, SMS sign-in,
Cloud SQL or Redis for this phase. Firestore has a free usage allowance for one database; it is not
an unlimited free service. See [Firestore pricing](https://firebase.google.com/docs/firestore/pricing).

The local bilingual deployment, authentication and real-data runbooks remain excluded from Git in
`local-docs/`.

## Change records

Every material change outside `local-docs/` should add one file under `changelog/`. Local-only
documentation changes do not require a change record. See `changelog/README.md` for the convention.
