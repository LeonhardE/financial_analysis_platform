# Persistent content and fixed-request proofs v1

`folioview.persistent-content.v1` is a separate, opt-in extension under the exact
`folioview.agent-workspace.v2.0` contract. It depends on the stable Agent identity
and persistent logical-resource policy, and leaves every legacy P1 schema,
primitive, grant and consumer unchanged. No service, runtime or Web consumer is
enabled by importing this module.

## Purpose and authority

The original P1 grammar binds Agent work to short-lived task grants. It cannot be
made persistent by treating a resource policy decision or identity recovery receipt
as a `VerifiedGrant`. This extension authenticates exact Root-approved deliveries
and fixed current Agent requests; consuming producers separately enforce business
authority and atomic fences.

| Object   | Signer and meaning                                                                                                             | Additional current consumer checks                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Task     | Pinned vault Root approves exact task/version, original task fingerprint, selected Agent, resource bindings and output policy. | Current active owner task/head, assignment, authority version/digest CAS and exact original task fingerprint.                 |
| Resource | Pinned Root approves exact logical ref/incarnation, source version/epoch, permission ID/epoch and original source fingerprint. | FND-004 current resource policy, authoritative source/fence and immutable publication slot.                                   |
| Result   | Currently certified Agent signing key authenticates exact Run/manifest, task authority/version and result revision.            | Current identity/task/resource/Run/source fences, allowed report policy, recipient selection and original result/receipt CAS. |

Task `purpose` is `execute_task` and `resultPolicy` is explicitly `none` or
`owner_inbox`. Saving/enabling a task may create this Root authorization inside the
already unlocked owner Worker, without repeating resource permission. The current
per-task authority slot must retain one stable authority ID and advance its version
with expected prior version/digest; changing the assigned Agent replaces that
current binding. A new ID or an old signed task must not reset an occupied slot.
Ordinary resource updates do not change that task authority.

Resource `purpose` is `analysis`; publication is independent of a task. It carries
one exact permission ID/epoch and source revision. A normal future version is
published under the existing FND-004 policy; changed incarnation/account/source
scope still requires explicit new approval. Revocation of B cannot invalidate an
unchanged A. The original source fingerprint is a Root-signed assertion; it does
not prove a historical producer object exists. Consumers verify actual immutable
source evidence and must not copy routing/permission expectations from this claim.

Result `purpose` is `save_report`. A Root task configured with `none` cannot grant
report writes. The consuming producer must check that policy, as well as the frozen
Run and current authority; the signature alone does not make a write authorized.

## Closed wire and cryptography

`persistent_content.json` packages closed DTOs and uses local legacy primitives.
`load_content_schema` composes them without adding names to the legacy validator.
`validate_content_schema` is structural; semantic, signature and current-state
checks remain separate.

A carrier is exactly `{contractVersion, profile, proof, jwe}`. `proof` uses the
existing canonical flattened ES256 `fv-control+jws`, with an explicit independent
artifact/profile and `{context, ciphertextDigest}`. The digest is SHA-256 of the
canonical complete JWE. Large ciphertext is outside the signed-control payload,
so a 196 KiB financial object does not become a 64 KiB control.

The General JSON JWE uses exactly ECDH-ES+A256KW and A256GCM, with `typ` equal to
`fv-persistent-private+jwe`, JSON content type and external AAD equal to JCS(context).
Fresh library-managed CEK, IV and per-recipient ephemeral keys are required.
Headers, key IDs, public P-256 points, canonical base64url, recipient order,
wrapped-key/IV/tag lengths, private byte budgets and the AAD are checked. Key URLs,
private public-JWK fields, compression, unknown headers and algorithm fallback are
not supported. JOSE performs the standard algorithms; no custom KDF/cipher is used.
See [RFC 7518](https://www.rfc-editor.org/rfc/rfc7518) and
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).

Task/resource recipients are exactly the selected Agent encryption key and one
Root-certified owner recovery encryption key. This gives the owner an independent
copy of the delivery and interoperable per-recipient General JWE headers. New
publication checks the current owner recovery certificate. An Agent reading an
original Root-approved delivery does not lose it merely because that old owner
receiver later expires/rotates; current Agent certificates and business fences still
apply. New publications must use the current certified owner recovery key.

Results contain only owner device/recovery recipients, including recovery. Their
current certificates are checked at write time; no temporary foreground session
or original enrolling-device signature authorizes unattended report encryption.
Current Root registry recipient selection is a producer responsibility. This slice
does not extend any certificate's expiry or implement key repair/rotation.

The new private wrapper has schema version 1, explicit profile, object ID/type,
revision and payload. Content fields and their semantic/Markdown/URL checks reuse
the existing private schemas, without forging a P1 context or grant. Backends
verify only public data and cannot claim private schema/AEAD success. Trusted
owner/Agent clients validate the plaintext again after authenticated decryption.

## Public verification snapshots

`PersistentEnvelopeExpectation` requires independently supplied owner/vault/
connection/client, object type/ID/revision, exact recipient IDs and complete current
kind-specific task/permission/Run bindings. Extra binding keys cannot override the
trusted owner or identity. Required authority/output-policy bindings cannot be
omitted. Source-origin fingerprints may be compared to independently verified
producer evidence, or treated as explicit verified Root assertions; they are not
an incoming authorization selector.

`inspect_persistent_carrier` returns detached structural context/ciphertext and
checks their digest/AAD consistency only; it never authenticates a signature or
permission. It is suitable for bounded original-operation lookup before a source
RPC, with current owner authorization and immutable stored fingerprints.

`verify_persistent_carrier` checks the pinned Root, current/issuance identity and
checkpoint, signature, exact bindings, recipient constraints, ciphertext digest and
JWE structure. Returned context/carrier bytes are immutable snapshots, not bearer
capabilities, a `VerifiedGrant` or an authorization cache.

- `new_publication` requires current checkpoint/key epoch, fresh issue time (300
  seconds), active current Agent pair and current certified recipients.
- `agent_read` permits an earlier known Root checkpoint for an original publication,
  but still requires the current active Agent pair and independently current
  resource/task/Run/source authorization in the consumer.
- `owner_history` is trusted decrypting-client-only. It requires independently
  verified issuance registry and original identity snapshots plus immutable owner
  Run/receipt expectations. It verifies keys at issuance; it never authorizes a
  current operation. Never select this mode from an HTTP query or use a supplied
  snapshot as proof of global freshness.

`seal_persistent_content` and `open_persistent_content` are trusted endpoint
primitives, not remotely exposed signing/decryption APIs. Callers verify proof and
purpose before opening. Sealing is randomized: persist the original encrypted
request before transport, and check/replay that original on an unknown outcome.
Never regenerate ciphertext or a Run to resolve uncertainty.

## Fixed current Agent request proof

`PersistentAgentRequestPayload` binds the exact current identity, configured HTTPS
audience, actual method/path, canonical body digest, request ID, canonical 32-byte
nonce and an issue/expiry window of at most 120 seconds. Paths are fixed relative
`/agent/v3/persistent/...` paths without query, credentials, traversal or double slash.
The trusted runtime generates nonces/request IDs with a CSPRNG. No proof/token is
placed in model prompts, URLs or credential files.

`verify_persistent_request` selects the current certified Agent key from trusted
state, verifies the distinct artifact/purpose and compares the actual request
expectations. Root/device signatures cannot replace it. A nonce/time window is
not a one-use store. Writers must atomically retain original business operations
and receipts; readers/writers must recheck current permission and revocation state.
The public identity-only recovery receipt from HUB-013 is not accepted as authority.

## Frozen Run manifest

`PersistentRunManifest` freezes the exact current task publication, task authority
and output policy, ordered source/permission epochs, source versions, publication
IDs and fingerprints. Run lifetime is at most the existing two-hour ceiling.
`persistent_run_id` derives a stable owner/vault/task/trigger identity. A retry of
one trigger must not create a new Run, even if task assignment changes; actual
creation/lookup, current-actor isolation, quotas and durable receipts are producer
responsibilities. The manifest fingerprint is canonical SHA-256, not a signature
or proof that the input is current/authorized.

## Adoption and validation

Deliver separately: this foundation; Hub publication/CAS, narrow execution and
result/receipt producers; the versioned trusted runtime; Web single-review sharing,
normal-version publication and owner Inbox consumers; then real Muse scheduling
and cross-day acceptance. Unknown protected-host lifecycle or first-pairing
capability stays an explicit production gate. No new cloud target, user resource
permission, real connection, native schedule or persistent execution is enabled here.

Tests use real synthetic keys and signatures, every content type, large encrypted
resources, immutable expectations, wrong owner/client/authority, current revocation,
issuance-only owner history, unsafe private content, profile separation and exact
frozen manifests. A public Node-produced vector is always verified/decrypted in
Python using a documented public test scalar; optional live reverse tests verify
all content types with independent Node JOSE. No private JWK is stored in fixtures.
