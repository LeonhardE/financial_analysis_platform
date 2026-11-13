# Personal Agent client

The current route keeps credential files in each personal Agent's private host
space. Hub stores public credentials, signed approvals and ciphertext. The user's
login and existing decryption Passkey authorize/reconnect the Agent; no Agent
recovery code, download or manual key configuration is required.

## Host prerequisites and provenance

The reviewed, bundled Node.js client requires **Node 24.12.0 or later**, Web Crypto,
HTTPS egress to the fixed Hub origin and a persistent private host directory.
`node:sqlite` provides local crash-safe, competing-process transactions; it creates
no remote database or paid service. The backend image serves the client as static
bytes and does not execute Node. A missing host prerequisite stops setup and must
be resolved in the later real-host acceptance window; VAL-009's Python feasibility
is not a claim that both hosts already run this packaged Node client.

Native `agent_connection`/`prepare_agent_authorization` responses include a fixed
versioned client path, SHA-256, integrity manifest and minimum Node version. The
Agent checks the downloaded bytes against the reviewed distribution and retains
that version/pin locally. Download only from the configured HTTPS issuer; do not
execute model-supplied alternate URLs or silently update the client on resume.
The bundle is standalone: no runtime npm install or server-side private-key proxy.
Release maintainers reproduce it with `npm ci` then `npm run build` in
`agent-client/`; `integrity.json` freezes the shared contract at build time.

Client 1.0.1 distinguishes input-policy rejection, invalid report formatting,
operation conflicts, run timing and temporary service failures from missing/rejected
credentials. These failures stop the task with a bounded, fixed message; they do not
silently replace credentials. An existing sealed report outbox still takes precedence
over changed retry arguments. New manifests at most two seconds ahead of the host
wait for real monotonic time to catch up before repeating the complete original
verification. No clock is shifted and no expiry or permission check is widened.

The original 1.0.0 download remains byte-identical at its existing versioned URL.
Upgrades require an explicit reviewed version/pin and reuse the same private profile;
downloading a newer client does not grant authority or require new authorization.

Native authorization accepts an optional bounded `ui_locales` display hint used by
ChatGPT. The hint is discarded before consent state or Authlib processing; duplicate
parameters, unknown fields and invalid locale lists remain rejected. Registered
callbacks, resource, bootstrap scope and S256 PKCE checks are unchanged.

## Connect and recover

1. Native OAuth/PKCE associates a preregistered Muse or ChatGPT client with its
   Owner/vault/connection, with only `runtime:connect`. Its automatic refresh is
   separate from the 90-day Agent credential lease.
2. On explicit connect/reauthorize, call `prepare_agent_authorization`. The local
   client `prepare` creates fresh signing/encryption keys and a random pairing
   secret in its private pending profile. It returns only an encrypted public
   offer and an Owner authorization link; submit the opaque offer through MCP.
3. The user follows that link and authorizes with their already-unlocked Owner
   Worker. The secret travels in the URL fragment, never a server query/log.
   The Worker verifies the offer's signature, exact native setup/Owner and public
   keys, certifies them with Root, signs the binding and lease, and returns an
   encrypted activation. Append public certificates before lease CAS; never revoke
   the current keys before a failed or cancelled replacement can be recovered.
   Owner setup metadata includes the server-recorded `predecessorConnectionId`
   (or null) so legacy reauthorization can restore only that prior connection's
   reviewed permissions/tasks. It is never selected by Agent JSON claims.
4. Pass `agent_activation`'s opaque response to local `activate`. It authenticates
   the Root/checkpoint anchor from the Owner-encrypted packet, then uses real PoP
   to independently verify the complete public registry, binding, lease and
   consent chain before installing that local active profile. A backend-supplied
   Root pin alone is insufficient. Unknown outcomes retain the pending profile.
5. All later tasks use load-only commands. Missing, corrupt, expired or rejected
   credentials stop the task and tell the user to authorize again. Only explicit
   `prepare` may replace an unusable local file with fresh **pending** keys; only
   verified Owner activation installs them. No silent key generation on resume.

Directory mode is 0700; the local credential database is 0600, owned by the host
user, with symlink/hard-link checks. The default is the Agent host's private
`~/.local/share/folioview-agent`; host setup may choose its private persistent
location through `FOLIOVIEW_AGENT_DIRECTORY`. Do not show these implementation
paths or ask the user to back up or manage this file. Tools in the personal Agent
can read it, as accepted by the user. This is not a TEE or nonextractable store;
provider retention and a 90-day host lifetime are not guaranteed.

Owner credential controls under `/api/v3/agent-credentials/` use the same closed
error envelope as the existing encrypted API, including authentication, missing
operation receipts and unexpected storage failures. A formal `404 not_found`
receipt allows the Owner to submit its sealed original; it is not a service outage
or permission to generate a second approval. Raw framework/storage errors are never
forwarded to the Web client.

## Pairing wire format

AES-256-GCM packets are closed `{version:1,iv,ciphertext}` objects: base64url,
12-byte random nonce, 128-bit tag, at most 8192 decoded ciphertext bytes. The
additional authenticated data is canonical JSON containing:

`profile="folioview.agent-pairing.v1"`, `phase="offer"|"activation"`, `issuer`,
`provider`, `setupIntentId`, `ownerSubject`, `vaultId`, `connectionId`, `clientId`,
`authorizationId`, `issuedAt`, `expiresAt`, `expectedGeneration` and
`expectedCredentialFingerprint` from the original 10-minute native setup.

The encrypted offer is an ES256 `fv-control+jws` signed object with
`profile="folioview.agent-key-offer.v1"`, `artifactType="agent_key_offer"`, the same
context fields except pairing profile/phase, `contractVersion`,
`agentId="agent_"+signing-key-thumbprint`, and distinct `signingPublicJwk` and
`encryptionPublicJwk`. Keys are closed public P-256 JWKs. The fragment contains a
base64url canonical `{version:1,issuer,vaultId,connectionId,setupIntentId,secret}`
under `agent_authorization`; it is temporary and confers no authority without the
Owner's signed approval.

Activation plaintext is closed `contractVersion`,
`profile="folioview.agent-activation.v1"`, `setupIntentId`, `issuer`, `provider`,
`actor`, `rootJwk`, `rootKeyId`, `anchor`, `identity`, `binding`, `lease`, `approval`
and `previousLease`. `actor` is the four native binding fields; `anchor` has Root
key ID, registry sequence and checkpoint digest. Full registry history travels
only in the authenticated PoP session, avoiding an oversized activation packet.

## Data operations and host scheduling

The CLI reads one closed JSON request from stdin: `origin`, `provider`, `actor`,
`operation`, `arguments`. Private keys never appear in command arguments/stdout.
Operations are `prepare`, `activate`, `status`, `tasks`, `due`, `begin`, `input`,
`submit`, `receipt`, `planStatus`, `reportPlan` and `retryPlanReport`. Each data
operation loads the saved profile, checks local expiry/rollback floors and signs
only fixed same-origin PoP paths. It verifies registry/consent/task/manifest/input
policies before local decryption. Report submission encrypts to current Owner
Device/Recovery recipients and stores the original ciphertext for exact retries.
Decrypted input/report text is never persisted by the credential store or sent as
plaintext to Hub.

Muse uses its own available native plan tools; ChatGPT uses its own available
native task/scheduling tools. In either host, create/read back the actual native
plan first, include this same load-only client in the task instruction, then call
`reportPlan` with that provider's actual plan reference and status. Do not invent
provider API names, create cron, keep a browser tab alive, or count a connection,
Agent statement or Hub receipt as provider scheduling proof. Reports are bound to
the preregistered provider and remain `nativeScheduleAttested=false`. A later
provider failure must be reported accurately and never replaced with a fabricated
plan ID. Actual tool compatibility, host retention, three native cycles and the
Owner-offline cross-day run remain VAL-010/011, not completed by local tests.

The optional [Owner/provider connection API](persistent-api.md#unique-provider-connections-compatible-producer-api)
uses `agent-client/owner-connections.mjs` as a source SDK for authenticated Owner
applications. It accepts pre-signed, durably retained commands and never manages
Agent private files, signs approvals or retries writes automatically. This is
separate from the existing pinned native Agent bundles; those retain their exact
version/integrity and are compatible with server-enforced provider slots.

## Opt-in task-center client 1.1.0

Version 1.1.0 retains the original 1.0.0 and 1.0.1 artifacts byte-for-byte at their
pinned URLs. Existing commands keep their wire formats. Upgrade only via a reviewed
version/hash; new task-center commands require an explicitly enrolled assignment
and enabled server capability, and deployment does not enable them.

- `taskCenterState({taskId})` verifies the signed Owner rule/assignment controls,
  exact actor/current credential, task publication, and monotonic local versions.
- `dueAssigned()` evaluates the approved nullable daily/multi-day weekly rule at
  the user's local time/zone, including skipped DST gaps, first DST fold and grace
  across midnight. Eligibility is not source attestation and creates no native plan.
- `beginAssigned({taskId,baseTriggerId})` persists the original preparation privately,
  obtains its assignment-namespaced trigger, and uses unchanged Begin/manifest
  verification. Process restart/lost acknowledgement retries the same intent;
  changed rules/credential generations stop rather than create a replacement Run.
- `reportPlanAssigned({taskId,status,planReference})` persists the original
  version-bound Agent statement privately until its acknowledgement. Each assignment
  must separately confirm its real native plan; `taskCenterState` reports its state.
  No plan reference, key or credential file needs to be managed by the user.

These are explicit private-CLI/source methods, not OAuth-only MCP financial tools.
They do not automatically change existing native jobs, migrate accounts or trigger
runs. Report submission still uses the original verified manifest and sealed
outbox. Removal of task permission asks for task access review; actual credential
loss/expiry retains the existing reauthorization flow. Complete native-cycle
acceptance remains a later step and cannot be inferred from a Hub result receipt.
