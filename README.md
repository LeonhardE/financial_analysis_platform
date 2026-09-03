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

## Change records

Every material change should add one file under `changelog/`. See `changelog/README.md` for the
format and naming convention.
