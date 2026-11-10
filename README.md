# FolioView

FolioView combines US market browsing with a private, encrypted workspace for holdings, tasks,
agent permissions and reports. This repository is
[`LeonhardE/folioview-mono`](https://github.com/LeonhardE/folioview-mono).

Anonymous visitors can browse markets and charts. Google sign-in enables private watchlists and
preferences. The resource library imports holdings locally and saves encrypted snapshots; a Passkey
unlocks the private workspace. Resources, Tasks, Agent and Inbox share that unlock within the same
signed-in browser session, including supported refreshes and tabs. Explicit sign-out clears it.

The persistent Muse integration is implemented behind separate feature gates that default to off and
require explicit activation for each deployment instance. Its intended
experience is one lasting connection, explicit permission for selected resources and their future
versions, and reports in Inbox. Native schedules and real Muse execution require separate acceptance;
merging code or passing synthetic tests does not establish real Muse or cross-day acceptance.
The gated flow distinguishes requested schedules, Muse-reported plan state and actual run/report receipts.
Approved resource updates synchronize encrypted while the owner is signed in and unlocked; native
execution can use already synchronized, approved versions after sign-out.

## Workspace

| Page              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `/` and `/market` | Public instruments, search, daily charts and market data status |
| `/resources`      | Local holdings import, encrypted save and history retrieval     |
| `/tasks`          | Versioned analysis instructions and selected resource inputs    |
| `/agents`         | Connections, resource permissions and activity                  |
| `/inbox`          | Encrypted reports and evidence, with read/star/archive controls |
| `/settings`       | Preferences, Passkey recovery, library keys and devices         |

Daily prices come from yfinance with explicit cache freshness and unavailable states. They are not
exchange-grade real-time quotes. Mock data requires explicit local configuration and never silently
replaces a failed real-data request.

Holdings are parsed and encrypted in the browser. Portfolio and Agent Hub store encrypted content
and public authorization metadata. Google login identifies the owner; it does not reconstruct the
library key. Keep an independent recovery file and its recovery code in separate safe locations.
See the [encrypted workspace documentation](services/agent-hub-service/README.md) for the trust model
and feature boundaries. Ordinary Web delivery still trusts the frontend publisher.

## Repository structure

```text
apps/web/                        Next.js frontend and private owner request forwarding
packages/encrypted-workspace/    Shared browser cryptographic contracts
services/market-data-service/    Public instruments, prices, charts and shared market cache
services/user-service/           Verified identity and private watchlist membership
services/config-service/         Versioned private preferences
services/portfolio-service/      Encrypted holdings snapshots and source lifecycle
services/agent-hub-service/      Vaults, tasks, agent authority, Runs, results and Inbox
services/agent-policy-service/   Independent Root-approved OAuth, leases and key-release policy (build-only)
services/agent-executor-service/ Measured original-key recovery and encrypted state (Confidential VM, build-only)
services/common/                 Shared Python authentication and encrypted wire contracts
scripts/                         Registered targets, isolated tests and CI/security tooling
infra/gcp/                       Independent Cloud Build releases and reviewed Terraform execution
changelog/                       Records for material tracked changes
```

Every backend has its own application, dependencies, image, health endpoint and runtime identity.
Services communicate through explicit HTTP contracts and do not import each other's applications.
Private endpoints independently verify the configured Firebase Google identity. Database access uses
attached server identities; browsers receive no Firestore credentials or service-account keys.

## Local development

Use Node.js 24.12 or newer and Python 3.13. From the repository root:

```bash
npm ci
python3 -m venv services/market-data-service/.venv
services/market-data-service/.venv/bin/pip install \
  -r services/requirements-dev.txt \
  -r services/portfolio-service/requirements-dev.txt \
  -r services/agent-hub-service/requirements-dev.txt \
  -e ./services/common
# Install the new independent policy target dependencies into the check environment.
services/market-data-service/.venv/bin/pip install -r services/agent-policy-service/requirements-dev.txt
services/market-data-service/.venv/bin/pip install -r services/agent-executor-service/requirements-dev.txt
```

The shared development environment retains its established path. Production images install their
own target's dependencies. Copy the required backend `.env.example` files to service-local `.env`
files and `apps/web/.env.example` to `apps/web/.env.local`. Never commit populated environment files.

Start each needed backend in a separate terminal, changing the service directory and port:

```bash
PYTHONPATH=services/common services/market-data-service/.venv/bin/uvicorn app.main:app --app-dir services/market-data-service --env-file services/market-data-service/.env --reload --port 8000
```

| Backend directory      | Suggested local port | Details                                                              |
| ---------------------- | -------------------- | -------------------------------------------------------------------- |
| `market-data-service`  | 8000                 | [Market](services/market-data-service/README.md)                     |
| `user-service`         | 8001                 | [User](services/user-service/README.md)                              |
| `config-service`       | 8002                 | [Config](services/config-service/README.md)                          |
| `portfolio-service`    | 8003                 | [Portfolio](services/portfolio-service/README.md)                    |
| `agent-hub-service`    | 8004                 | [Agent Hub](services/agent-hub-service/README.md)                    |
| `agent-policy-service` | 8005                 | [Agent Policy](services/agent-policy-service/README.md) (build-only) |

The [Confidential VM executor](services/agent-executor-service/README.md) is build-only.
Its offline probe runs without cloud credentials; normal startup restores the original keys
and binds TLS inside the measured workload on port 8443. It is not a local Cloud Run API.

```bash
npm run dev:web
```

The frontend runs at `http://localhost:3000`. Each backend exposes `/health`; its API docs
are available at `/docs`. The Web environment example documents the independent Market, User and
Config origins, Firebase public values, local-only Portfolio/Hub development origins, and server-only
owner forwarding settings. Local development does not enable production agent gates.

For anonymous offline browsing, explicitly set `MARKET_DATA_SOURCE=mock`. Real Google sign-in
requires the four public Firebase Web values, Google sign-in enabled in Firebase, an authorized
frontend hostname and matching backend Firebase project settings. Local use of a real cloud project
also needs separately configured Application Default Credentials. Do not download service-account
keys. See the service examples and guides for storage and optional trust settings.

## Checks and contributions

Run the required complete check before every commit:

```bash
npm run check
```

It runs the pinned secret scanner, types, lint, browser behavior, shared browser contracts, isolated
backend suites, infrastructure/CI guard tests and formatting checks. Useful focused commands include:

```bash
npm run test:web
npm run test:contracts
npm run test:api
npm run test:infra
npm run test:ci
npm run build:web
```

GitHub Actions selects affected targets from the actual PR comparison. Repository checks always run;
backend jobs independently test, build and check isolated image health. **Quality checks** is the
required aggregate and rejects missing or unsuccessful selected checks. See the
[CI and delivery guide](infra/gcp/README.md#ci-target-selection).

Follow [AGENTS.md](AGENTS.md): each implementation PR targets one backend or `apps/web`; shared
contracts, tooling and infrastructure foundations use separate PRs. Add a dated
[change record](changelog/README.md), use scoped Conventional Commits, the required author identity
and the Codex collaborator footer. [CODEOWNERS](.github/CODEOWNERS) names the repository owner;
GitHub branch protection controls required owner approval and authorized bypass.

## Deployment and configuration

Production uses independent regional Cloud Build triggers and Cloud Run services. A successful PR
check validates source; it is not deployment evidence. After a relevant merge, verify the Cloud Build
source commit, image digest, ready revision and traffic before considering the release deployed.

Terraform follows a per-target complete saved-plan, review and exact-plan apply flow. Normal cloud
pipelines additionally enforce their approval gates. A merge
does not automatically apply infrastructure. Real deployment profiles and state remain in private,
ignored operator storage. See the [Terraform guide](infra/gcp/terraform/README.md),
[deployment profiles](infra/gcp/deployment-profiles/README.md) and
[target registration guide](scripts/README.md).

Repository names are separate from cloud project, service and image repository names. A GitHub
rename requires checking Cloud Build repository links, trigger sources and source-bound deployment
configuration digests. Preserve service identities, existing trigger IDs, approval policies and
historical provenance. Follow the [delivery guide](infra/gcp/README.md) rather than recreating running
services to match the repository name.

The Hub's explicit `persistent_mode_enabled` input defaults to `false` and preserves the current
runtime environment. Enabling its native basic flow requires reviewed client registration and producer
trust, then owner approval of the actual Muse connection and selected resource scope. See the
[Hub rollout guide](infra/gcp/terraform/envs/prod/agent-hub/README.md#persistent-basic-flow-activation)
and [Web owner flow](apps/web/docs/agent-integration.md#persistent-owner-flow). No repository or image release grants that access.
