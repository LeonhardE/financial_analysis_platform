# Agent Hub

Agent Hub owns encrypted library archives, public key directories, tasks, Agent authority,
Runs and encrypted reports. It stores public authorization metadata and ciphertext; holdings,
private rules, report bodies and content keys stay outside the backend. Google identity and
content decryption authority are separate. Market, User and Portfolio remain independent services.

## Documentation

| Guide                                          | Contents                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Owner API](docs/owner-api.md)                 | Vaults, resource discovery, encrypted tasks, source fences and owner Inbox          |
| [Key management](docs/key-management.md)       | Root trust, archive replacement/removal, recovery and operational renewal           |
| [Persistent API](docs/persistent-api.md)       | Credentials, consent, publications, encrypted reports and plans                     |
| [Personal Agent host](docs/agent-client.md)    | Private credentials, Node/POSIX client and native schedule contract                 |
| [Account transport](docs/runtime.md)           | Native bootstrap, reviewed Owner handoff and retired browser route                  |
| [Legacy foreground](docs/legacy-foreground.md) | Retained P1/v2 OAuth, preparations, helper releases, Runs and receipt compatibility |

Shared wire formats belong to [the encrypted contract](../common/folioview_shared/encrypted/README.md).
Owner UI behavior belongs to [Web](../../apps/web/README.md). Keep endpoint/security details in
these guides and update them with the relevant implementation, rather than adding per-PR topic
files to this directory. Commit history and changelog retain delivery history.

## Current implementation and activation

The current route uses personal Agent-owned credentials with a 90-day maximum,
seven-day notice and explicit reauthorization after loss/expiry. Muse and ChatGPT
have separate logical connections. Owner approval uses the existing login and Passkey;
private Agent keys stay on the host. Hub stores public authority and ciphertext only.

The additive [task assignment API](docs/persistent-api.md#task-assignments-and-task-history-additive-default-off)
adds zero/multiple executors and task history behind a default-off gate. The
[private client](docs/agent-client.md#opt-in-task-center-client-110) retains prior
pinned releases and uses explicit opt-in methods; it installs no native plans.

New capability flags default off. The default path has no browser Agent runtime,
Policy service, dedicated executor, VM, TCP proxy or new project. The service's actual
MCP surface is bootstrap-only `/mcp/v3`; financial requests require a current Agent
proof and managed lease. Legacy financial OAuth/MCP and helper/runtime entry points
are not mounted. Historical Owner Inbox, immutable receipts and narrowing controls remain.

Real host retention, native plans, Owner-offline execution and cross-day encrypted
results require the separate live acceptance stage. Native plan statements and actual
Hub reports are different evidence; source tests do not claim native schedule attestation.

## Local development and verification

Use the repository [setup instructions](../../README.md#local-development), then configure
[.env.example](.env.example). From the repository root:

```bash
services/market-data-service/.venv/bin/uvicorn app.main:app --app-dir services/agent-hub-service --env-file services/agent-hub-service/.env --reload --port 8004
services/market-data-service/.venv/bin/python scripts/test_services.py --service agent-hub-service
npm run check
docker build --file services/agent-hub-service/Dockerfile --tag folioview-agent-hub:test .
```

`GET /health` returns `{ "status": "ok", "service": "agent-hub" }` without credentials or network.
Private dependencies are lazy; an invalid optional adapter fails closed independently of health.
Tests use synthetic keys/resources and SQLite or the actual Firestore SDK against a controlled
RPC boundary. Automated interoperability tests do not replace physical Passkey or Muse acceptance.

## Storage and deployment

SQLite is local-only, with private file mode and atomic transactions. Cloud Run requires the
explicit named Firestore database; default DB, SQLite and emulator configuration are refused.
Opaque fields use declared index exemptions. Per-object/document budgets and bounded histories
fail closed without deleting revocations or resetting trust pins. See the guides for exact limits.

The container runs as UID 10001 with access logging disabled. It distributes the checked private client, account window
and required third-party notices, never a backend decrypting process. No application endpoint
provisions cloud resources or grants IAM. [Hub infrastructure](../../infra/gcp/terraform/envs/prod/agent-hub/README.md)
owns per-target deployment, storage and the default-off `persistent_mode_enabled` input.

The existing Cloud Build pipeline uses its pinned Cloud CLI builder's bundled Python and the
guarded existing-service release helper. `_DEPLOY_SERVICE` defaults to `false` in source; the
reviewed deployed trigger controls actual image release. Verify source commit, image digest,
ready revision and traffic through the [delivery guide](../../infra/gcp/README.md).

The private-client distribution locks its shared dependency in
`agent-client/shared-contract.integrity.json`. The account-link window contains
first-party modules only. Historical helper source/releases and required notices
remain for supported-format fixtures, and are not copied into the production image.

The default-off [Agent-owned credential lifecycle](docs/persistent-api.md#agent-owned-credential-lifecycle)
adds 90-day Owner-approved replacement without a separate runtime service. The
Hub stores public authority and ciphertext; personal Agent private keys remain in
the Agent host. Existing report history retains its original signed binding.

Personal Agent credential delivery: [host client and pairing](docs/agent-client.md).
