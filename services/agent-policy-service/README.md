# Agent Policy

Agent Policy is an independent, owner-controlled OAuth and execution authority. It checks Root
approvals, current account authorization for financial operations, a fresh Confidential Space workload proof and original
Agent/TLS key possession. It issues short executor-trust leases and can release one approved
recovery key encrypted to the attested boot's ephemeral recipient. It never holds the owner's
Root/Passkey/recovery secrets or proxies financial inputs, analysis or reports.

The service is registered **build-only**. `POLICY_ENABLED` and `POLICY_KEY_RELEASE_ENABLED` default
off. Provisioning, IAM verification, actual attestation and deployment activation are separate
from this implementation; see [INF-011](../../infra/gcp/README.md). Hub and executor operator
identities must have no policy deployment, live-witness, KMS-sign or recovery-decrypt permissions.
The personal final owner remains trusted; this is not a claim of isolation from that owner.

| Guide                                      | Contents                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [Protocol](docs/protocol.md)               | Public configuration, Root controls, OAuth, recovery, leases and state commits                      |
| [State and operations](docs/operations.md) | Independent latest-state witness, immutable backups, failure behavior, limits and release readiness |

The [shared executor-trust contract](../common/folioview_shared/encrypted/README.md) defines Root
approval, checkpoints, operations, leases and transitions. Agent Hub retains its separate source,
task, ciphertext and report authority; this service imports no other service application.

From the repository root:

```bash
services/market-data-service/.venv/bin/pip install -r services/agent-policy-service/requirements-dev.txt -e ./services/common
services/market-data-service/.venv/bin/python scripts/test_services.py --service agent-policy-service
npm run check
docker build --file services/agent-policy-service/Dockerfile --tag folioview-agent-policy:test .
PYTHONPATH=services/common services/market-data-service/.venv/bin/uvicorn app.main:app --app-dir services/agent-policy-service --port 8005 --no-access-log
```

`GET /health` works without credentials, configuration or cloud state. All authority dependencies
are lazy. The image runs as UID 10001; tests use synthetic keys, real JOSE, Authlib clients and
actual Firestore/KMS serialization boundaries with controlled RPCs, without cloud mutations.
