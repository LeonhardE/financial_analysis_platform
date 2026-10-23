# Financial Analysis Platform

A monorepo for a US-stock watchlist and portfolio risk tracking product.

The MVP shows daily market data through yfinance in Lightweight Charts. Anonymous visitors can
browse the S&P 500, Nasdaq Composite, Dow Jones Industrial Average and Magnificent Seven, or search
for other US stocks. Optional Google sign-in uses Firebase Authentication, with the API independently
verifying identity before returning a profile. Signed-in users can save a personal watchlist that
survives refreshes and sign-in on another device. YouTube summaries remain planned follow-up work.

## Service boundaries

| Service               | Responsibility                                                   | Routes                             | Local port |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------- | ---------- |
| Market (`market-api`) | Public US instruments, search, cached prices, charts and metrics | `/api/stocks*`                     | 8000       |
| User (`user-api`)     | Verified Google profile and private stock-watchlist membership   | `/api/v1/me`, `/api/v1/watchlist*` | 8001       |
| Config (`config-api`) | Private UI preferences and version-fenced saves                  | `/api/v1/preferences`              | 8002       |

Each backend has its own app, image, requirements, health endpoint, runtime identity and deployment
configuration. All private endpoints verify Firebase tokens independently; Config does not call User
or load stock-watchlist code. User validates genuinely new watchlist instruments through the public
Market HTTP contract, without forwarding user tokens. Listing, deletion and duplicate additions still
work when Market is unavailable. Market cannot serve private routes.

The shared Python package contains authentication, HTTP policy, stable document ownership, bounded
Firestore transactions and public instrument contracts. It contains no provider clients, user data
stores or business routers. Services do not import each other's Python apps. Existing Firestore
collections, UID hashes, document schemas and preference versions are preserved; no data migration is
required. Separate runtime identities sharing the same Firestore database are not collection-level IAM
isolation; application ownership checks remain necessary.

Future YouTube research will have its own Research API and private worker. Portfolio behavior will
also have its own domain service when implemented. Market-related APIs remain in Market; domain-specific
settings and user-owned research data need not become generic User/Config endpoints.

## Repository structure

```text
apps/
  web/                         Next.js web client
services/
  market-data-service/         Public market API; retains its existing deployment path
  user-service/                Verified identity and private stock watchlists
  config-service/              Private account preferences
  common/folioview_shared/     Shared infrastructure and wire contracts
  requirements-dev.txt         Combined local/CI development dependencies
scripts/test_services.py        Isolated test processes for each backend
infra/gcp/                     Independent builds and guarded Cloud Run releases
.github/workflows/             PR quality checks and backend-image smoke tests
changelog/                     One Markdown record per material tracked change
```

## Local setup

Use Node.js 24.12 or newer and Python 3.13. Install the web workspace and a single development
Python environment from the repository root. Its established location is retained for existing tools;
each production image installs only its own requirements.

```bash
npm install
python3 -m venv services/market-data-service/.venv
services/market-data-service/.venv/bin/pip install -r services/requirements-dev.txt
```

Copy each backend's `.env.example` into its own `.env` and set the desired configuration. Start each
backend from the repository root in a separate terminal. Uvicorn explicitly loads that service's
environment; the apps do not implicitly read files or borrow another service's configuration.

```bash
PYTHONPATH=services/common services/market-data-service/.venv/bin/uvicorn app.main:app --app-dir services/market-data-service --env-file services/market-data-service/.env --reload --port 8000
```

```bash
PYTHONPATH=services/common services/market-data-service/.venv/bin/uvicorn app.main:app --app-dir services/user-service --env-file services/user-service/.env --reload --port 8001
```

```bash
PYTHONPATH=services/common services/market-data-service/.venv/bin/uvicorn app.main:app --app-dir services/config-service --env-file services/config-service/.env --reload --port 8002
```

Copy `apps/web/.env.example` into `apps/web/.env.local` so its three origins target those ports, then
start the frontend:

```bash
npm run dev:web
```

The frontend runs at `http://localhost:3000`; each service exposes `/docs` and `/health` on its own
port. Set the same `FIREBASE_PROJECT_ID` on User and Config for sign-in. User also needs
`MARKET_API_BASE_URL=http://127.0.0.1:8000` for new watchlist entries. SQLite is local-only. No
Google credentials are required for anonymous mock browsing; set `MARKET_DATA_SOURCE=mock` to use
fictional fixtures explicitly. Real-data failures never silently become mock prices.

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

Set `FIREBASE_PROJECT_ID` in both User and Config to the same Firebase project ID. Both use
Application Default Credentials (ADC); on Cloud Run, attach each dedicated runtime service account.
Grant each account
**Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) on the project so it can check whether
users have been disabled, deleted, or their tokens revoked. Do not download a service-account JSON key.
For local real-project testing, configure local ADC separately; the API does not automatically load
`.env` files. For example, use Uvicorn's `--env-file .env` when starting inside the service directory.

The browser signs in with Google's popup and sends a Firebase ID token in the Authorization header to
`GET /api/v1/me` on User. Only the backend-verified profile is shown as signed in. Invalid identities return
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

## Personal watchlist

The separate **My watchlist** section saves up to 50 validated US stocks or default indices. Open an
instrument and choose **Add to watchlist**, or remove it from the chart or saved list. Public indices,
the Magnificent Seven and search stay available without signing in. Saved rows contain metadata;
opening a row uses the existing cached market endpoint rather than fetching prices for every saved
instrument.

Private routes require a Firebase token and derive ownership exclusively from its verified UID:

| Method | Route                        | Result                                                 |
| ------ | ---------------------------- | ------------------------------------------------------ |
| GET    | `/api/v1/watchlist`          | Read this account's saved instruments.                 |
| PUT    | `/api/v1/watchlist/{symbol}` | Add once; repeated additions do not create duplicates. |
| DELETE | `/api/v1/watchlist/{symbol}` | Remove if present.                                     |

User stores one bounded document per account in the existing Firestore `user_watchlists`
collection, using a hash of the UID as its key. The cap is checked inside an atomic transaction.
Set `USER_STORE_BACKEND=firestore` and `FIRESTORE_DATABASE` on User, with its own runtime database
permissions. The old `MARKET_CACHE_BACKEND` / `MARKET_FIRESTORE_DATABASE` values remain fallback
configuration during migration. No new database or browser Firestore permission is required. Local SQLite storage uses
`WATCHLIST_DB_PATH`, defaulting to `/tmp/financial-analysis/watchlists.sqlite3`, and is refused on
Cloud Run.

Private responses, including errors, use `Cache-Control: no-store`. The page clears private data on
logout or account changes, obtains tokens from the Firebase SDK for each request, and rejects late
responses from a previous session. Lists load on verified session changes or explicit retry, with no
polling or persistent listeners. Removing or reading saved items does not depend on Yahoo being
available. A failed write requires reloading the list before editing again, because the server may
have completed a request whose response was lost.

## Quality checks

Run every check from the repository root:

```bash
npm run check
npm run build:web
```

`check` includes frontend types, formatting and request/session race tests, backend Ruff checks, and
API tests for authentication, private watchlist isolation, market validation, caching and refresh
limits. Infrastructure tests exercise deployment ordering, conflicts and runtime-setting
preservation. Unit tests mock external providers; live Yahoo access, Firestore IAM and the Google
popup require deployment smoke tests as well.

Format TypeScript/CSS/Markdown and Python code with `npm run format`. The local pre-commit hook runs
`npm run check`.

## Cloud Run deployment and migration

**This refactor removes private routes from the new Market image. Follow the staged migration in
[the Console deployment guide](infra/gcp/README.md#market-user-and-config-service-migration) before enabling
Market image updates.** Existing production runs the retained combined revision until cutover; the
new code does not carry a second compatibility copy of the User/Config handlers.

All three backend Cloud Build files default to `_DEPLOY_SERVICE=false`: they build/push uniquely
tagged images without replacing a running service. This is the one-time migration gate, not a permanent
replacement for CD. Web still deploys normally. The new frontend User/Config origins are optional only
during migration: empty values target the existing combined API, while configured services never
fall back to Market after a network or server failure.

| Cloud Run service | Build configuration                | Frontend/runtime routing                               |
| ----------------- | ---------------------------------- | ------------------------------------------------------ |
| `market-api`      | `infra/gcp/cloudbuild.api.yaml`    | Web `_API_BASE_URL`; User `MARKET_API_BASE_URL`        |
| `user-api`        | `infra/gcp/cloudbuild.user.yaml`   | Web `_USER_API_BASE_URL`                               |
| `config-api`      | `infra/gcp/cloudbuild.config.yaml` | Web `_CONFIG_API_BASE_URL`                             |
| `market-web`      | `infra/gcp/cloudbuild.web.yaml`    | All origins and Firebase values compiled at build time |

Console rollout: publish initial images; create/configure User and Config with their own runtime
identities, Firebase project, original Firestore database and frontend CORS origin; verify both private
APIs; rebuild Web with both new origins; verify real sign-in, two-account watchlist isolation and saved
preferences; only then set Market `_DEPLOY_SERVICE=true` and deploy the Market-only image. Enable
`_DEPLOY_SERVICE=true` separately on User and Config after their bootstrap configuration is complete.
Check trigger-level overrides: a preexisting `true` overrides YAML defaults and must be cleared for
this migration. The deployment helper updates existing services; it does not create resources or grant
IAM permissions.

After Market cutover, an old frontend with empty User/Config URLs cannot use the Market-only service.
Rollback must preserve explicit User/Config origins, or restore the retained combined Market revision
before rolling Web back. Do not delete retained revisions until the migration is verified.

Each release preserves Console-owned runtime configuration, uses a build creation-time ordering guard
and etag checks, and waits for the expected ready revision receiving all traffic. Use dedicated
runtime identities, minimum instances zero and bounded maximums. No API gateway, load balancer, GPU,
VM, Redis or new database is introduced. Build/storage/logging/runtime charges remain subject to usage;
scale-to-zero and application limits are not whole-project spending caps.

GitHub Actions checks types, lint, format, isolated service tests, deployment guards and the frontend
production build. It also builds and starts all three independent backend Docker images in a matrix,
without Google Cloud credentials. Cloud Build main triggers publish/deploy their own domain only;
shared-package changes must be included by every backend trigger. Configure included-file filters and
service-scoped deployment IAM using the Console guide. Firebase ID tokens, service-account keys and
other secrets must never be public build arguments. `NEXT_PUBLIC_*` origins and Firebase Web config
are public, compiled values: changing runtime variables alone does not update the browser bundle.

The paired local-only Console runbook and future Research plan remain excluded from Git in
`local-docs/`.

## Change records

Every material change outside `local-docs/` should add one file under `changelog/`. Local-only
documentation changes do not require a change record. See `changelog/README.md` for the convention.
