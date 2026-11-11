> Archived reference for the retired Confidential VM target. Commands and
> deployment requirements below are historical; use the existing
> [Agent Hub](../../agent-hub-service/README.md).

# Creation, TLS and operation

## Separate first-key ceremony

Normal `python -m app.main` with creation disabled only restores. Missing state
never changes that mode. First keys require explicitly selected creation mode
(`EXECUTOR_CREATION_ENABLED=1`, runtime/native disabled), an approved measured
creation workload and a fresh Root-signed creation permit. The same fixed image
command dispatches this explicit mode to `app.initialize`; the manual
`python -m app.initialize` entry remains available for separately approved use. Its
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
silently regenerate; review a separate new ceremony/identity epoch. The draft
contains no premature `bindingFingerprint`: the actual device command includes
the yet-unknown Agent public keys. Production `creationWorkload` and `workload` both name the fixed
`python -m app.main` image command, with separately approved exact mode environments.
No command override is needed. A manually invoked `app.initialize` command must
be explicitly approved separately; the production image rejects CMD overrides.
Creation audience is exactly the Policy origin plus `/enrollment`; runtime
audience is exactly that origin plus `/attestation`. A mismatched draft fails
before reservation or key generation.
The original three P-256 private keys and random 32-byte DEK remain
inside the measured process while the Owner completes public enrollment.

The first `executor-enrollment/{enrollmentId}-pending.json` object contains the
public keys, original TLS CSR, draft/permit and data-bound creation attestation.
Its audience is the fixed Policy origin plus `/enrollment`; the nonce is the
complete internally constructed statement digest. The Owner verifies actual
Google claims/current creation VM, Root permit and first keys, certifies the Agent
keys in its Root directory, and creates the actual device-signed Hub binding.
Only then can the Owner know the binding fingerprint and independently reviewed
native configuration hash. This order avoids wrapping the DEK to a provisional
identity that Policy could never recover.

The Owner supplies a fresh Root `fv-control+jws` over exactly
`{profile: "folioview.agent-executor.v1", action: "finalize", offerDigest,
bindingFingerprint, workload, operationId, issuedAt, expiresAt}` (at most 300
seconds). `offerDigest` covers the complete pending object, including its
attestation. Finalization fixes the actual binding fingerprint and may finalize
only the runtime environment; image, command, instance, identity, scope and
recipients stay fixed by the draft. The CLI polls only the fixed
`executor-enrollment/{enrollmentId}-finalization.json` public control object,
using generation/CRC-checked bounded reads, for 600 seconds by default
(`EXECUTOR_CREATION_WAIT_SECONDS`, range 1–1800). This inbox is signed public
metadata; it carries no Root secret, plaintext or general-purpose key operation.
The Owner workflow needs its own narrowly scoped create-only inbox permission.

After valid finalization, KMS Encrypt-only wraps the DEK with the **final** identity
AAD. Actual protobuf CRCs/key-version checks apply. The encrypted genesis state,
original public keys/CSR, wrapped DEK, final binding/workload and finalization-bound
attestation become the exclusive `{enrollmentId}-offer.json`. An unknown final
offer write retries the same prepared keys/head/ciphertext and checks existing
bytes on a create-only collision. The process releases private references when
done. Normal runtime receives no KMS Encrypt/Decrypt permission.

Both stdout summaries contain public IDs/digests only and explicitly report
`enrolled=false`, `contentServiceEnabled=false`. Neither offer grants Policy
release authority. The Owner must verify the final attestation against the
approved creation workload and exact statement, obtain the original CSR's server
certificate, then sign the final Policy/Hub enrollment and activation. Losing
genesis after enrollment requires explicit migration; never erase a reservation
to recreate the same identity. WEB-015 owns the Owner-facing ceremony.

Actual creation-workload pins, KMS/IAM restrictions and owner review are mandatory
INF-012/INF-011 deployment evidence, not inferred from a CLI/fixture success.

## Public configuration inside the TEE

Production does not depend on populated host file mounts. Supply fixed
`gs://<bucket>/executor-config/<path>.json` public-object references through
`EXECUTOR_CONFIG_OBJECT` and, when native enabled, `EXECUTOR_NATIVE_CONFIG_OBJECT`.
Creation uses `EXECUTOR_DRAFT_OBJECT`, `EXECUTOR_PERMIT_OBJECT` and
`EXECUTOR_ROOT_JWK_OBJECT`. Each excludes its corresponding local file variable;
there is no remote-to-local fallback, version search, arbitrary HTTP URL, query,
fragment or path traversal. Reads pin the captured GCS generation, check declared
and actual size, use CRC32C and bounded timeouts without application retries.
Emulator endpoints are refused. Inputs are JSON objects, at most 64 KiB each
(native configuration: 256 KiB), and remain public metadata only.

`EXECUTOR_ROOT_KEY_ID` is an independently measured P-256 Root thumbprint. It is
mandatory for remote inputs and must match the loaded public Root; private JWKs
fail. The core public config's existing Root approval is verified, and every
remote source URI plus the Root pin must match the Root-approved workload
environment. The native config canonical SHA-256 must additionally match
`EXECUTOR_NATIVE_CONFIG_SHA256` in that same approved environment. The whole core
config contains its workload, so it cannot pin a hash of itself inside that
workload; independent Root signature/key pin and current Policy release checks
provide that authority. No server/model-selected startup source exists.

Local public-file inputs remain for explicit tooling/tests. They still pass the
same closed config/Root/Policy checks. No environment option selects a mock
attestor, local production state or ordinary KMS decrypt.

The image declares a closed launch-policy allowlist of operational flags, public
object URIs, Root/native pins and creation wait. PATH, Python, proxy, credential
and debug overrides are absent. CMD overrides, additional host mounts, content
log redirection and memory monitoring are disabled. Host user-namespace isolation
requires `tee-nonroot-container=true` and a production Confidential Space image
supporting that policy (261001 or newer); process user remains non-root 10001.
The exact full OCI environment, including base image and launcher values, must
be independently observed/reviewed and Root-approved before activation. Policy
also checks each operator override against its exact approved value. Do not infer
that a synthetic startup fixture proves a particular live launch.

## Original TLS and certificate replacement

Normal production config requires an unexpired public certificate chain with
an exact executor DNS or IP address SAN, a non-CA leaf and the enrolled original P-256 TLS
public key. Policy's current recovery statement must approve the SHA-256 of the
exact certificate-chain bytes. A renewed certificate requires an explicit Root
Policy certificate control plus reviewed public configuration and restart; it
cannot replace the TLS key or silently expand financial permissions.

An IP endpoint requires an actual `IPAddress` SAN and matching original-key CSR;
a DNS spelling of an IP does not qualify. Wrong IPs and wildcards fail. Public
certificate issuance/renewal remains a separate Root-approved deployment action.

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
keys/head only after recovery. The separately enabled [native MCP surface](native-mcp.md) requires provider mTLS
and independent OAuth. There are no key
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

The 80 tests include real subprocess recovery from a backup copy, real TLS 1.3 handshake,
JOSE/AES tampering and original-key challenges, wrong authority/scope, old boot
fencing, unknown-CAS response recovery, code upgrade versus epoch migration,
Google KMS protobuf/CRC boundaries and immutable cloud-object conditions. The
independent wire fixture is synthetic. Local cross-process integration with the
merged Hub and Policy implementations is evidence recorded under ignored `local-docs/`;
this target's CI does not require another service's source or dependencies.

Cloud provisioning, actual attested creation/restoration/negative IAM tests,
native client installation, synthetic financial loop and later private/offline/
overnight acceptance remain separately scoped. Default gates stay disabled.

## Owner public-artifact tools

`tools/owner_prepare.py` runs outside the TEE image. It accepts public artifacts
only and never generates/exports Root or Executor private keys. Set `PYTHONPATH`
to this service root and `services/common`, and use its `--help` for exact arguments.
The independent Root thumbprint and approved draft digest must come from the
unlocked Owner client, not from the offer being reviewed.

1. `review-pending` checks the fresh Root initialization permit, complete draft,
   enrollment ID, three distinct original public keys and signed original CSR/SAN.
   It reports `hardwareProofVerified=false`: local shape/key checks cannot verify
   Google's signature or current VM. Independently verify the exact reconstructed
   creation statement/Google proof/current VM before the Owner certifies any key.
2. The Owner client certifies the original Agent keys, forms the actual signed Hub
   binding, and signs a fresh purpose-limited `finalize` control. No generic signing
   interface or Root private file is used. `publish-finalization` checks that signed
   control against the complete pending offer and independently pinned Root/draft,
   then creates exactly its finalization inbox object with generation-match zero.
   It cannot overwrite a reservation, offer or previous finalization. The creation
   wait is bounded; expired controls need fresh review, never changed keys.
3. `publish-config` accepts only Root, draft, permit, validated core config or
   Root-registry-validated native config. Initial inputs require a fresh creation
   permit. Core/native publication rechecks the Root approval and original TLS
   certificate; native needs `--core`. Use an explicit `--expected-generation`
   (`0` for first creation), fixed project and `executor-config/...json` path.
   All writes use CRC32C, bounded timeout, no automatic retry and CAS. An unknown
   result requires reading the exact generation/bytes before deciding what to do.
4. `certificate-command` validates the original public CSR against the independently
   reviewed TLS JWK and exact hostname/IP, then prints an argument list for Certbot
   (5.4+ with IP/short-lived/manual/CSR support). It does **not** execute it or accept
   CA terms. Use a dedicated ACME account/config directory under explicit Owner
   control when later authorized. Account keys are separate from the original TEE
   TLS key; no TLS private-key input/output option is used. The printed manual hooks
   require the narrow challenge publisher credentials and the exact single expected
   identifier. `acme-auth` creates only its public token with CAS zero/no-store;
   `acme-cleanup` deletes only the returned exact generation. Hooks do perform cloud
   writes when explicitly invoked, including by Certbot; never run a CA dry-run
   during preparation-only work.
5. `verify-certificate` validates the new chain against the system CA bundle (or an
   explicitly independently reviewed trust bundle), original TLS SPKI, exact SAN,
   server policy and validity. Review its digest in the Owner client and send the
   fresh Root certificate control to Policy before publishing that exact chain in
   core config. Successful local validation alone is not Policy approval. Renewal
   repeats the same original CSR; there is no automatic Root approval, new TLS key
   or installed schedule. Record renewal ownership and expiry alerts before live use.

Future explicit publication uses the selected Owner-controlled publisher's keyless
credentials, never the runtime/creator/build identities. The administrator source
supplies its prefix-limited grants separately from workload deployment. No command
in this guide is evidence of actual resource creation, CA trust or live readiness.

## Reproducible public container environment

The image fixes public `HOSTNAME=folioview-executor` so a fresh container does not
introduce a random container ID into the exact Root-approved environment during
initial enrollment or original-key restoration. This is an environment value, not
the trusted VM identity: Policy still verifies Google's current project/number,
zone/name, numeric instance ID and service account independently. HOSTNAME is not
added to the operator override allowlist. No command/mount/debug override or
measurement check is relaxed.

After a future authorized immutable build, inspect that image's complete public
environment, including base-image fields, the fixed hostname and exact selected
operational variables, before preparing the Root draft. The actual Google
`container.env`/override claims must later match it exactly; this source pin is
not evidence that a VM has booted or been verified. See
[Docker environment defaults](https://docs.docker.com/engine/containers/run/#environment-variables)
and [Confidential Space workload environment](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/create-customize-workloads).
