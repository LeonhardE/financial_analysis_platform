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
| [Persistent API](docs/persistent-api.md)       | Stable identity, consent, publications, independent executors, reports and plans    |
| [Persistent runtime](docs/runtime.md)          | Native OAuth, pairing, protected key storage, fixed browser runtime and scheduling  |
| [Legacy foreground](docs/legacy-foreground.md) | Retained P1/v2 OAuth, preparations, helper releases, Runs and receipt compatibility |

Shared wire formats belong to [the encrypted contract](../common/folioview_shared/encrypted/README.md).
Owner UI behavior belongs to [Web](../../apps/web/README.md). Keep endpoint/security details in
these guides and update them with the relevant implementation, rather than adding per-PR topic
files to this directory. Commit history and changelog retain delivery history.

## Current implementation and activation

Persistent producers, the fixed runtime, approved-version publication and owner Inbox consumers
are implemented. The intended flow retains one connection and selected-resource permission,
reuses one unlock per supported login session, and reports exact input versions. Owner resource
updates synchronize while visible and unlocked; native execution uses already synchronized,
approved versions after owner sign-out.

Feature gates default off. Reviewed activation is separate from code delivery. Real Muse pairing,
protected-host restart, actual native plan installation and cross-day encrypted results still
require owner-led acceptance. Agent-reported plan state and actual Run/report receipts are
different evidence. No fixed browser asset or identity-only receipt grants financial access.

The [independent executor ciphertext adapter](docs/persistent-api.md#independent-executor-ciphertext)
has its own default-off gate and public channel configuration. It accepts Root-approved executor
parents without Muse OAuth records, reuses frozen Run inputs and original report receipts, and
keeps the existing owner Inbox format. It supplies no private keys, attestation or plaintext lease.

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

The container runs as UID 10001 with access logging disabled. It distributes checked browser
assets and third-party notices, never a backend decrypting process. No application endpoint
provisions cloud resources or grants IAM. [Hub infrastructure](../../infra/gcp/terraform/envs/prod/agent-hub/README.md)
owns per-target deployment, storage and the default-off `persistent_mode_enabled` input.

The existing Cloud Build pipeline uses its pinned Cloud CLI builder's bundled Python and the
guarded existing-service release helper. `_DEPLOY_SERVICE` defaults to `false` in source; the
reviewed deployed trigger controls actual image release. Verify source commit, image digest,
ready revision and traffic through the [delivery guide](../../infra/gcp/README.md).
