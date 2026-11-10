# Agent executor

A build-only Confidential VM target that restores the original Agent signing,
Agent encryption and TLS keys inside the measured workload. It stores only
authenticated encrypted snapshots outside that boundary. Runtime startup never
initializes or replaces an identity, chooses a backup head or uses ordinary KMS
Decrypt. Root/Passkey secrets and native refresh tokens are absent.

The optional ChatGPT native MCP surface verifies the actual provider TLS client,
independent Policy OAuth account and current Root directory/consent before
returning approved frozen inputs. It encrypts reports to the Owner before Hub
submission and retains exact original bytes through uncertain responses and
same-key restart. Native tools stay disabled unless their configuration digest
is also pinned in the Root-approved measured environment. Infrastructure, actual
provider installation and live attestation acceptance remain separate work.

- [Recovery, state and trust protocol](docs/recovery.md)
- [Creation, TLS and operation](docs/operations.md)
- [Native MCP, frozen inputs and original reports](docs/native-mcp.md)
- [Shared trust contracts](../common/folioview_shared/encrypted/README.md)
- [Independent Policy protocol](../agent-policy-service/docs/protocol.md)
- [Confidential VM delivery boundary](../../infra/gcp/docs/confidential-vm-releases.md)

Use Python 3.13. From the repository root, install this target's development
requirements and `services/common` into a test environment, then run:

```sh
python scripts/test_services.py --service agent-executor-service
FOLIOVIEW_EXECUTION_MODE=offline_probe PYTHONPATH=services/common \
  python services/agent-executor-service/app/health_check.py
```

The production image uses the complete Python 3.13/Linux x86_64 wheel hash lock;
all 46 runtime versions are pinned. Build it from the repository root with
`services/agent-executor-service/Dockerfile`. CI's network-disabled, read-only
probe checks crypto and contracts without obtaining any cloud credential,
releasing a key or claiming attestation. The final image digest must be reviewed
and pinned by the separate Confidential Space deployment workflow.

`EXECUTOR_ENABLED=0`, `EXECUTOR_CREATION_ENABLED=0` and
`EXECUTOR_NATIVE_ENABLED=0` are the image defaults.
Normal startup requires reviewed public configuration and a live Policy recovery
path; only then does original-key TLS listen on port 8443. Production public JSON is
read inside the TEE from exact Root-pinned GCS sources, with generation/CRC/size
checks and no host-file dependency. Explicit creation uses the same image command
with a separate Root-approved mode and fresh permit. Local fixture stores
and mock attestors are never selectable through production environment options.
