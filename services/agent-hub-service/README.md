# Agent Hub encrypted vault authority

The build-only Hub stores one opaque, passkey-sealed vault archive and its root-signed public
key directory per verified Google owner. It owns up to ten public holdings-source references.
Portfolio holds the encrypted snapshots; Hub never receives CSV, positions, account labels,
content keys, passkey PRF output or private JWKs. This is the local-integration prerequisite for
encrypted CSV persistence, not agent authorization, Run execution, broker login or inbox delivery.

`GET /health` remains `{ "status": "ok", "service": "agent-hub" }`. Import, startup and health
need no Firebase/Firestore/KMS credentials, clients or network. Those dependencies are lazy.

## Owner APIs

Every owner request requires the existing verified Firebase Google identity and exact
`X-FolioView-Contract: folioview.agent-workspace.v2.0`. Bodies are closed strict JSON;
requests cannot supply an owner UID or overwrite an existing root/archive. Write operations also
require one bounded `Idempotency-Key`; source creation requires `X-FolioView-Author-Key`.

| Endpoint                                                    | Behavior                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/v2/vaults/current`                                | Current owner vault and public sources, or `vault:null`                                |
| `POST /api/v2/vaults`                                       | First enrollment only: public root, signed initial registry and opaque archive         |
| `PUT /api/v2/vaults/{vaultId}/registry`                     | Root-pinned, consecutive signed registry CAS                                           |
| `POST /api/v2/vaults/{vaultId}/holdings-sources/{sourceId}` | Current owner-device `manual_source_create` control; derived incarnation, epoch 1      |
| `POST /api/v2/vaults/current/authority-token`               | Fixed Portfolio caller/Hub audience, holdings metadata delegation valid for 60 seconds |

Bootstrap and registry writes return `{contractVersion,vault,sources}`. An exact operation replay
returns the current verified aggregate, never an old directory or archive replacement; these are
not immutable historical response receipts. Source-create replay returns its stable source.
Every replay still authorizes the current owner/root, and source replay rechecks the current
signing device/directory before returning. Account separation uses the shared owner hash, not body
fields or filenames.

The initial directory must have root/registry/key epochs `1/1/1`. Public roots are authenticated
owner enrollment on first use. The client independently protects its root pin within its
passkey archive and must refuse substitution. Ordinary Web delivery still trusts its publisher;
this does not claim protection against a malicious replacement frontend.

The archive has exactly `profile`, `ownerSubject`, `vaultId`, `rootKeyId`, `credentialId`,
`prfSalt`, `iv`, `ciphertext`. Profile is `folioview.passkey-vault.v1`; credential ID is canonical
base64url at most 2048 characters, PRF salt is 32 bytes, IV 12 bytes, and opaque ciphertext is
16–24576 decoded bytes / at most 32768 encoded characters. AES-GCM and WebAuthn PRF derivation are
client responsibilities. The backend cannot decrypt or establish whether a client encrypted
honestly; it validates bounds and public bindings only. Private keys and PRF outputs have no
accepted plaintext fields. There is no password/backup-key override, platform recovery key,
archive replacement/reset, second vault, device management UI or broad key-recovery endpoint.

## Public authority and signing

`POST /internal/v2/portfolio-authorities/read` accepts exactly
`{contractVersion,sourceId}` behind both the configured Google Portfolio workload identity and
existing FND-001 `browser_catalog`/`resources:catalog` delegation for `portfolio/holdings`.
It derives owner from the verified delegation. Agent Run tokens, other scopes, caller substitution
and self-reported root/owner fields are refused.

The response is `{contractVersion,authority}` using Portfolio's existing exact public replica
fields. Writers and device/recovery recipients derive from the current active signed directory,
maximum eight each. No archive, key packet or private data is included. Source epoch stays 1 in
this slice. Portfolio must preserve its independently advanced local source fence and compare Hub
projection version separately from its local replica version; this API cannot reset that fence.

Current owner registry updates must retain an authorized device writer plus device and recovery
encryption recipients within the budget. Replacing/revoking an old device alongside a valid new
device is supported. Revoke-all, vault locks, global fence/ACK propagation, archive rewrap and
server-side retention/reset are not implemented by this CSV prerequisite. Missing those behaviors
must not be represented as full WEB-010/HUB-008 acceptance.

The owner authority-token endpoint accepts only `{contractVersion}` and signs a fixed claim set:
verified UID, configured Portfolio caller, configured Hub issuer/audience, holdings metadata only,
random operation ID and 60-second lifetime. No caller/audience/scope overrides exist.
`/.well-known/jwks.json` exposes only RSA verification fields. HTTP caching stays `no-store`;
KMS public material is cached in process for at most 60 seconds.

Production signing uses only the explicitly configured existing KMS asymmetric key **version**,
RSA PKCS1 SHA256 with a 2048/3072/4096-bit key. No private signing key is loaded from environment or
files. Public-key/signature resource names, CRC32C, digest acknowledgement and the final signature
are verified; KMS RPCs have `timeout=4,retry=None`. Missing configuration/dependency access returns
fixed 503. Tests inject fresh synthetic signing RPCs; no deployed signer or KMS key is created.
See [Google KMS integrity guidelines](https://docs.cloud.google.com/kms/docs/data-integrity-guidelines)
and [asymmetric signing](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign).

## Storage, bounds and local verification

SQLite is local-only: private file mode 0600, immediate atomic transactions and bounded lock wait.
Cloud Run requires Firestore and an explicitly selected named database; `(default)`, SQLite and
Firestore emulator configuration are refused. `hub_vaults` contains the public directory, opaque
archive and bounded source list. `hub_operations` stores only owner/kind/fingerprint metadata.
No background workers, post-response tasks or database scans are used.

A vault allows at most 32 consecutive registry bundles, ten sources and 64 operation records.
There is no automatic root reset when capacity is reached; writes fail closed. Actual serialized
Firestore document/name overhead is checked against the shared storage budget, so the byte ceiling
can be reached before the count ceiling. Private success/error bodies use `no-store`; v2 errors
follow the closed shared error DTO, with no token, key, body or SDK diagnostic reflection.

From repository root:

```bash
services/market-data-service/.venv/bin/python scripts/test_services.py --service agent-hub-service
npm run check
docker build --file services/agent-hub-service/Dockerfile --tag folioview-agent-hub:test .
```

Local runtime settings are documented in `.env.example`. Health needs none of the private settings.
Tests use freshly generated synthetic keys, actual SQLite restart/concurrency and actual Firestore
SDK serialization/retry against an in-memory RPC boundary. They do not use cloud credentials,
real broker data, a live KMS signer or an authentication bypass environment setting.

## Build-only delivery

The source registry keeps this target `build_only`. Its existing Cloud Build configuration
publishes an image and invokes the shared release helper with `_DEPLOY_SERVICE=false`; it refuses
an attempted deployment override. The container runs as UID 10001 with access logging disabled.
Its health smoke check runs with networking disabled and removes its test container.

No Cloud Run service, database, KMS key, IAM grant or trigger is created here. INF-006 and explicit
future trust/configuration approval still govern any cloud activation. MCP, OAuth, agent grants,
Tasks/Runs/Results/Inbox and broker access remain unimplemented and fail closed.
