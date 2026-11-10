# Native MCP, frozen inputs and original reports

## Three independent checks

The ChatGPT path uses the original server TLS key inside the measured process.
`ProviderProtocol` reads the **actual** TLS peer from Uvicorn's transport, requires
TLS 1.3 and a verified client chain, then attaches an immutable internal peer
object to ASGI scope. The leaf must be a current non-CA clientAuth certificate
with exact DNS SAN `mtls.prod.connectors.openai.com`. Forwarded headers, bearer
claims, clientInfo and model-supplied provider names cannot establish this identity.
Only the published Connectors mTLS intermediate is trusted, with strict chain
validation and partial-chain support. Leaves can rotate without changing this
trust anchor. Reviewed public CA files, hashes and sources are in
[public-trust](../app/public-trust/README.md).

Provider identity does not identify the end user. Each protected tool independently
checks the native OAuth bearer with the fixed Policy issuer, exact resource,
provider/client/connection and original Agent proof. Native refresh tokens remain
with the provider; no token is persisted in executor state or sent to Hub. Policy
owns preregistered clients, exact HTTPS callbacks, authorization code/S256 PKCE,
refresh rotation and Root approval. Invalid/expired tokens produce a discovery
challenge; insufficient scope produces a distinct 403. Other outages stop the
operation and preserve retry state. Failures never reconnect or expand permission.

Finally, Hub's Root-signed registry history and original consent commands are
verified independently. The active original Agent certificates, historical
device-signed binding, full current Owner device/recovery recipient set and
original Root scope must all agree. Aggregate Hub metadata alone grants no
plaintext authority. Registry and consent high-water marks are persisted through
Policy-selected encrypted state CAS before content use. Rollback, recipient
rotation, epoch changes and missing history stop rather than silently widening
identity. This adapter consumes Hub persistent v1 identity epoch 1; higher-epoch
consumer adoption requires explicit separate work. Root-approved same-key code
upgrades preserve the original ciphertext identity; they do not reinterpret old
outbox operations as new authority.

## Configuration and transport

All three image gates default to zero. With `EXECUTOR_NATIVE_ENABLED=1`, read the
closed public native configuration object (`EXECUTOR_NATIVE_CONFIG_OBJECT` in
production or an explicit local `EXECUTOR_NATIVE_CONFIG` file):

```json
{
  "profile": "folioview.executor-native-mcp.v1",
  "hubAudience": "https://reviewed-hub.example",
  "providerClientId": "preregistered_native_client",
  "registryAnchor": {}
}
```

`registryAnchor` must be a complete independently reviewed Root registry bundle,
not the placeholder above. `EXECUTOR_NATIVE_CONFIG_SHA256` must equal its canonical
JSON SHA-256 **and** the Root-approved `workload.environment` value. Remote public
objects also require the independently measured Root key ID and exact approved
source URI; see [startup inputs](operations.md#public-configuration-inside-the-tee). That environment
must also pin native enabled to `1`. Provider is fixed to `openai_chatgpt`, and
providerClientId equals the binding's preregistered OAuth clientId. The Hub origin
is fixed, HTTPS and request-independent. Registry verification starts from Root
and must contain the reviewed anchor plus all durable prior pins.

`POST /mcp` implements bounded stateless MCP JSON responses (2025-06-18). Initialize,
ping and tool discovery require mTLS; calls additionally require bearer OAuth.
`/.well-known/oauth-protected-resource` advertises the exact executor resource,
fixed independent authorization server and execute/write_report/recover scopes.
There is no MCP session selector, arbitrary issuer, URI fetch or plaintext callback.
JSON batches, duplicate fields, query selectors and unknown arguments are rejected.
Optional bounded client metadata is ignored as authority. HTTP bodies are bounded
at 96 KiB, Hub responses at 1 MiB and complete MCP responses at 2 MiB. Tool work is
serialized with a 45-second deadline and bounded upstream timeouts. Logs contain
no requests, content, tokens or raw exceptions.

## Narrow tools

- `executor_profile`: fresh permission/Root checks and public connection status.
  `nativeScheduleStatus=not_observed` is an observation, never installation proof.
- `executor_tasks`: list only currently assigned task IDs and versions.
- `executor_input`: exact `taskId`, stable occurrence `triggerId` and publicationId.
  A null publicationId returns the frozen task and available input IDs. Each later
  call reads one exact frozen publication, after current Root/Policy/Run/source
  checks. Task freshness, complete/partial coverage and unknown-as-of rules apply.
- `executor_report`: exact runId and shared `ResultContent`; no destination/recipient
  choice. Sections must match the frozen task output specification. Unsafe markup
  and unsupported content fail shared validation. Encrypt only to the complete
  currently verified Owner device/recovery key set before sending to Hub.

Returned content is data, never authority to change scopes, destinations or native
schedules. No API cron substitutes for provider-native scheduling. A stable
triggerId deduplicates a caller occurrence but proves no scheduler installation.
Actual installation, execution and overnight observations remain VAL-008/VAL-003
acceptance, with Muse equivalence separately evidenced.

## Freeze and retry

Before Hub begin, persist the original operation, task fingerprint and trigger
intent. Before any plaintext return, persist the exact immutable Run manifest and
verify original Root publication proof, context, manifest fingerprint, current
permissions and exact publication ID. New source versions within the approved
consent need no new consent, but existing Runs retain their frozen version.
Recheck Root/Policy after network I/O and immediately before new decryption or
report submission. A lease authorizes one logical operation and is checked against
a fresh current checkpoint; it is never cached as permanent permission.

Before the first submit, persist the original encrypted report carrier/body and
operation in the encrypted outbox. Unknown Hub responses retain those exact bytes.
Unknown Policy CAS acknowledgements clear private process state and require the
same attested recovery path to the live current head. Retry uses the same runId
and exact report content, returns the original receipt and never regenerates
ciphertext. Changed content for the same Run conflicts. Successful acknowledgement
records receipt metadata and removes acknowledged pending items in a separate
state CAS operation. No plaintext or native token enters the outbox.

Bounds intentionally fail closed: 16 pending items, 32 receipt metadata records,
256 Policy operations and finite Root/OAuth approval lifetime. There is no implicit
history deletion, renewal, same-slot identity recreation or authority reset.
Deployment/lifecycle acceptance must account for these bounds before activation.

## Evidence boundary

Local tests use real synthetic JOSE/AES, real TLS 1.3/mTLS handshakes and independent
HTTP fixtures. A local cross-process harness additionally exercises the actual
merged Hub producers/routes/store and actual Policy routes/store/Authlib with this
executor: frozen inputs, Owner-only result decryption, lost submit response,
byte-identical restart retry, original receipt and Root revocation denial.
Attestation/KMS remain synthetic there. No live Google attestation, actual ChatGPT
installation, VM provisioning, private inputs or offline/overnight run is implied.

Provider requirements follow the official [authentication guide](https://developers.openai.com/plugins/build/auth)
and [MCP server guide](https://developers.openai.com/plugins/build/mcp-server),
reviewed 2026-11-09. Live deployment must verify the current published CA and provider
behavior; CA replacement is an explicit reviewed code/trust change.
