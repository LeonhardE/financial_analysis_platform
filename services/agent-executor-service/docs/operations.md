# Creation, TLS and operation

## Separate first-key ceremony

Normal `python -m app.main` only restores. It never invokes initialization.
First keys require the separate `python -m app.initialize` command, an explicitly
enabled measured creation workload and a fresh Root-signed creation permit. Its
public draft fixes owner/vault/connection, agent/native/provider client, epoch,
Root scope/recipients, final workload, Policy key/domain, recovery CryptoKey and
snapshot bucket. Root is pinned independently in the creation environment.

The permit is `fv-control+jws` over exactly
`{profile: "folioview.agent-executor.v1", action: "initialize", draftDigest,
operationId, issuedAt, expiresAt}` and lives at most 300 seconds. It approves
creation only, not the yet-unknown keys or financial service. The command takes
public files through `EXECUTOR_DRAFT`, `EXECUTOR_PERMIT`, `EXECUTOR_ROOT_JWK`,
requires `EXECUTOR_CREATION_ENABLED=1`, and requires `EXECUTOR_ENABLED=0`.
No Root/Passkey secret is supplied to the workload.

Before generating original keys it creates an exclusive enrollment reservation
for the owner/vault/connection/epoch. Creation IAM must allow create-only access
to this namespace and deny overwrite/delete/restore. A crashed reservation cannot
silently regenerate; review a separate new ceremony/identity epoch. Generate three
distinct original P-256 private keys and a random 32-byte DEK only inside the
approved boundary. A fixed KMS Encrypt-only role wraps that DEK with the exact
identity AAD. The real SDK request/response CRCs and returned key version are
checked. The runtime receives no KMS Encrypt/Decrypt permission.

The encrypted genesis state, public key baseline, original TLS CSR, wrapped DEK,
permit and data-bound creation attestation become an exclusive public enrollment
offer. The token audience is the fixed Policy origin plus `/enrollment`, and its
nonce covers the full offer statement. The stdout summary contains only public
IDs/digests and explicitly says `enrolled=false`, `contentServiceEnabled=false`.
The offer is not a Policy release credential. The owner must independently verify
its Google claims, approved creation workload/current instance, nonce, Root permit
and first keys, obtain a certificate for that CSR, then Root-sign the exact final
Policy/Hub enrollment. Losing genesis state after enrollment requires explicit
migration; never delete its reservation to recreate the same identity.

Actual creation-workload pins, KMS/IAM restrictions and owner review are mandatory
INF-012/INF-011 deployment evidence, not inferred from a CLI/fixture success.

## Original TLS and certificate replacement

Normal production config requires an unexpired public certificate chain with
an exact executor hostname SAN, a non-CA leaf and the enrolled original P-256 TLS
public key. Policy's current recovery statement must approve the SHA-256 of the
exact certificate-chain bytes. A renewed certificate requires an explicit Root
Policy certificate control plus reviewed public configuration and restart; it
cannot replace the TLS key or silently expand financial permissions.

The original private TLS key is materialized with mode 0600 only in `/dev/shm`,
whose Linux filesystem type must actually be tmpfs. It is loaded into the TLS
context and removed before serving. The server binds port 8443 inside the measured
process, requires TLS 1.3, disables proxy/forwarded-header trust, access logs, API
schema and debug output. Configure network forwarding without terminating TLS
outside this boundary. No ordinary Cloud Run deployment path is supported.
Python/OpenSSL do not guarantee deterministic zeroization; process termination
is the final memory boundary. Swap, debug access, remote shells, writable code,
unaudited mounts and broad operator IAM must be denied by the deployment.

`/health` reports locked/keyring-restored metadata and never claims continuing
financial permission. `/api/v1/executor/identity` returns the enrolled public
keys/head only after recovery. `/mcp` fails closed in this core. There are no key
export, arbitrary sign/decrypt, Root bootstrap or attestation relay endpoints.
Diagnostics omit request bodies, private state, tokens, paths containing content
and raw exception details. Health/probe success does not imply live attestation.

## Build and verification

The registry runtime is `confidential_vm`, release mode `build_only`. Cloud Build
builds/pushes a Linux x86_64 image only; it provisions/updates no VM or Cloud Run
service. The production requirements lock covers all 46 runtime distributions
with exact wheel hashes, forbids source builds and installs with `--no-deps`.
The image contains repository-owned common modules; it downloads no runtime code.
Review and pin the resulting **final image digest**, launch arguments and exact
environment in Policy before allowing secrets. Hashes pin dependencies, not a
live workload or cloud authorization.

Regenerate the production lock only after downloading/resolving Python 3.13 Linux
x86_64 binary wheels and reviewing every runtime version. Keep the complete
version list in `requirements.txt` consistent so local/CI target installs exercise
the same versions on their platform. Run target tests, the offline probe, full
root `npm run check` and the commit hook. CI additionally builds the image and
runs the REPO-003 network-disabled/read-only probe.

Tests include real subprocess recovery from a backup copy, real TLS 1.3 handshake,
JOSE/AES tampering and original-key challenges, wrong authority/scope, old boot
fencing, unknown-CAS response recovery, code upgrade versus epoch migration,
Google KMS protobuf/CRC boundaries and immutable cloud-object conditions. The
independent wire fixture is synthetic. Local cross-process integration with the
merged Policy implementation is evidence recorded under ignored `local-docs/`;
this target's CI does not require another service's source or dependencies.

Cloud provisioning, actual attested creation/restoration/negative IAM tests,
native client installation, synthetic financial loop and later private/offline/
overnight acceptance remain separately scoped. Default gates stay disabled.
