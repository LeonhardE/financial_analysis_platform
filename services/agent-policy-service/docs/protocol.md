# Independent policy protocol

## Domain and activation

`POLICY_CONFIG` is a closed public JSON object. Its canonical digest is the authority domain.
The offline Root bootstrap approves that digest, including callback, resource, KMS and storage
pins. Changing any field cannot silently adopt an older store or existing authorization.
`POLICY_ENABLED=1` enables issuance; `POLICY_KEY_RELEASE_ENABLED=1` separately enables key-only
recovery. Owner history and signed revocation remain available with issuance disabled.

| Field                                                 | Contract                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `issuer`                                              | Exact independent HTTPS origin; no port, query, fragment or trailing slash.                    |
| `consentUrl`                                          | Fixed HTTPS owner UI endpoint; only the opaque pending request ID is appended.                 |
| `ownerSubject`, `vaultId`                             | Pinned SHA-256 Google UID ownership hash and vault identifier.                                 |
| `rootJwk`, `policyJwk`                                | Distinct public P-256 JWKs, exactly `kty`, `crv`, `x`, `y`. Private fields are rejected.       |
| `stateEpoch`                                          | Explicit authority incarnation, selected during Root bootstrap.                                |
| `provider`, `providerClientId`, `audience`            | Exact independent provider/account identifiers and executor HTTPS resource URL.                |
| `kmsSigningKeyVersion`                                | Fixed `EC_SIGN_P256_SHA256` KMS key version, matching `policyJwk`.                             |
| `kmsRecoveryKey`                                      | Fixed symmetric KMS CryptoKey for the approved wrapped state key.                              |
| `witnessProject`, `witnessDatabase`, `snapshotBucket` | Root-pinned live authority and immutable snapshot resources; a named database is required.     |
| `clients`                                             | 1–8 exact preregistrations: `{clientId, redirectUris, tokenEndpointAuthMethod, secretSha256}`. |

Each client has 1–4 exact HTTPS callbacks with no query/fragment/wildcard. Authentication is
`none` with null secret hash, or `client_secret_basic` with a SHA-256 secret hash. No client-secret
value, Root secret, private JWK, provider API credential or attestation key is accepted in this
public configuration. Actual least-privilege IAM is owned by the deployment ticket.

## Owner Root controls

Owner routes require a server-verified, non-revoked Firebase Google identity from the configured
project whose UID hash equals `ownerSubject`. JSON requests also require
`X-FolioView-Contract: folioview.agent-workspace.v2.0`, exact `application/json`, no query or
caller author/delegation selector. The Root is independently pinned; Google identity and a Hub
assertion cannot replace its signature.

| Method/path                                        | Behavior                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET `/api/v1/connections/{connection}`             | Current public state, scope, approval, active generation, cached checkpoint and bounded audit metadata. |
| POST `/api/v1/connections/{connection}/checkpoint` | `{contractVersion}` obtains the current signed checkpoint for Root review, even if Agent keys are lost. |
| POST `/api/v1/connections/{connection}/controls`   | `{contractVersion, request: {action, parameters, approval, command}}`.                                  |

`command` is a Root-signed `fv-control+jws` over exactly:
`{contractVersion, profile: "folioview.agent-policy-control.v1", action, ownerSubject, connectionId,
operationId, expectedVersion, expectedHead, parametersDigest, issuedAt, expiresAt}`.
Its validity is at most 300 seconds. Version/head are current connection state. Immutable control
receipts reject changed same-operation requests and never replay a former active state.

For `register`, version is 0 and head is null. `parametersDigest` hashes
`{enrollment: parameters, approval}`. The enrollment is exactly:

```text
{agentId, clientId, identityEpoch, bindingFingerprint,
 agentSigningJwk, agentEncryptionJwk, tlsJwk,
 scope, recipientKeyIds, workload, initialStateHead, certificateDigest, wrappedStateKey}
```

The three public JWKs must match the independent Root executor-trust binding. `scope` is the
bounded Hub ciphertext scope v1 (`analysis`, `owner_inbox`, 1–10 canonically ordered unique
resource/epoch references). `recipientKeyIds` is its exact sorted owner recipient set. The policy
constructs the expected binding from these reviewed fields plus the independently configured
owner, vault, issuer, audience, provider and policy key; it never trusts approval claims as their
own expectations. A Root executor-trust approval for the same operation is also required.

`workload` contains exactly `{projectId, projectNumber, zone, instanceName, serviceAccount,
imageDigest, args, environment, hwmodel, attestationAudience}`. Its canonical digest equals the
Root binding's `workloadDigest`. The image digest is immutable. The hardware profile is an exact
approved Confidential Space AMD SEV/SEV-ES or Intel TDX value.

`wrappedStateKey` is a bounded KMS ciphertext of a 32-byte executor-state recovery key, with AAD
equal to the canonical SHA-256 digest of the binding **excluding only `workloadDigest`**. This
preserves the original keyring across a Root-approved code upgrade; an identity migration changes
the AAD. The keyring contains executor keys/state only, never Owner Root/Passkey secrets.

For other controls, `parametersDigest` hashes `{parameters, approval}`:

- `revoke`: empty parameters and null approval, terminal parent revocation and all OAuth families.
- `certificate`: `{certificateDigest}`, null approval; Root approves a new certificate for the
  same original TLS public key. Old generations/families are fenced and fresh adoption is required.
- `transition`: `{transition, enrollment}` plus the next Root approval. The shared Root transition
  must name the exact current approval/checkpoint. Code upgrades preserve keys, certificate,
  wrapped recovery key and current state head. Epoch migrations explicitly change Agent keys and
  advance identity epoch. Neither can revive a terminal parent or implicitly migrate a consumer.

Root controls are audited. Ordinary executor/Hub operators cannot issue them. Consumers and their
current source/task/recipient fences remain separately responsible for adopting a next identity.

## OAuth authorization

Discovery is `/.well-known/oauth-authorization-server`. Only authorization code with S256 and
rotating refresh grants are enabled. All responses are non-cacheable and errors omit input data.
Authorization responses include the exact issuer (`iss`) to prevent issuer mix-up.

GET `/oauth/authorize` requires exactly `response_type=code`, `client_id`, `redirect_uri`, `scope`,
`resource`, `state`, `code_challenge`, `code_challenge_method=S256`. Resource must exactly equal the
pinned executor audience. Supported scopes are `executor:execute`, `executor:write_report` and
`executor:recover`. PKCE and callback validation use Authlib. Pending requests expire in 300 seconds.

The browser receives a Secure, HttpOnly, host-only consent cookie. The explicit owner UI origin
must be in `CORS_ORIGINS`; its requests include credentials and verified Google authorization.
GET `/api/v1/authorizations/{pending}` requires that same cookie and returns reviewed public
request metadata. POST `.../{pending}/approvals` takes
`{contractVersion, connectionId, command}`. The fresh Root `oauth_approve` control binds
`{pendingId, requestDigest}` to current version/head. A request cannot be approved by a different
browser, account, client or Root. The response supplies a validated `redirectUri` for the owner UI
to navigate to, with no tokens or financial content in the UI protocol.

POST `/oauth/token` uses URL-encoded fields for code exchange or refresh, exact resource,
preregistered authentication and a verifier for code exchange. Codes are single-use for 300
seconds. Access lasts at most 300 seconds; refresh authorization is bounded by the original Root
approval and a 30-day family ceiling. Refresh tickets are signed opaque handles bound to the
issuer, client, resource, family, scope and generation. Only their current digest is stored.
Authenticated replay of a prior generation or exchanged code revokes the entire family and
advances the current policy fence. Wrong-client guesses cannot revoke another family. Scope can
narrow and cannot expand. Restart retains the same connection, family and absolute deadlines.

POST `/oauth/revoke` supports RFC 7009 client authentication and family revocation, including
while issuance is disabled. This changes current authority, rather than merely deleting a token
cache. An OAuth token alone cannot release a key or obtain an execution lease.

The design follows [OAuth Security BCP RFC 9700](https://www.rfc-editor.org/info/rfc9700/) and
[Authlib's authorization-server interfaces](https://docs.authlib.org/en/stable/oauth2/authorization-server/).

## Attested recovery, leases and state

Agent routes are POST `/v1/connections/{connection}/{suffix}` with the contract header,
`Authorization: Bearer <current policy access token>` and
`{contractVersion, proof, request}`. Queries, author/delegation/idempotency selectors and unknown
fields are rejected. `proof` is ES256 `fv-control+jws` over exactly:
`{profile: "folioview.agent-policy.v1", purpose: "authenticated_request", bindingDigest,
audience: <policy issuer>, path, method: "POST", bodyDigest, requestId, issuedAt, expiresAt}`.
Its lifetime is at most 120 seconds. Normal proofs use the original Agent signing key.

| Suffix               | Exact `request` fields                                                |
| -------------------- | --------------------------------------------------------------------- |
| `challenges`         | `{purpose, operation, resourceBindings, bootId, releaseRecipientJwk}` |
| `releases`, `leases` | `{challengeId, attestationToken, encryptionAnswer, tlsProof}`         |
| `confirm`            | `{challengeId, encryptionAnswer, tlsProof}`                           |
| `checkpoint`         | `{}`                                                                  |
| `commits`            | `{lease, expectedHead, nextHead, receipt}`                            |

Challenges contain the shared one-use challenge plus the complete public statement to attest,
current checkpoint, and a random challenge encrypted to the original Agent encryption key.
The statement binds Root identity, operation, approved resources, boot, ephemeral release key,
latest state head/authorization epoch and approved certificate. `eat_nonce` must equal its
canonical SHA-256 digest. The service fetches only Google's fixed JWKS endpoint, verifies RS256,
issuer/audience/time, production/debug/security profile, support/memory-monitoring state, exact
image, arguments/environment and overrides, project/zone/instance and service account. It also
checks the independently selected current Compute instance ID and running account. A copied
old VM name/token, wrong image, enabled debug or unavailable current instance is denied.

Google measures the complete OCI environment as `container.env` and every
operator-supplied `tee-env-*` variable separately as `container.env_override`.
The full environment must exactly equal the Root-approved `workload.environment`;
the override object may contain only a subset with identical approved values.
Extra variables, changed/incorrectly typed values and non-object overrides fail.
Command overrides remain empty. This permits reviewed startup configuration
without allowing an operator to alter any unapproved setting. These semantics
follow the [official launcher measurement](https://github.com/google/go-tpm-tools/blob/main/launcher/container_runner.go)
and do not change Root scope, workload digest or authority/release gates.

See [Google's claims](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/token-claims)
and [binding external resources](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/connect-external-resources).

Recovery challenges use `purpose=recover`; request proofs use the ephemeral public key included
in the attested statement. This avoids requiring lost original keys before their protected
keyring can be unsealed. `releases` requires null encryption answer/TLS proof, current OAuth and
Root authority, fresh attestation and the explicit key-release gate. It creates a new single
unconfirmed generation, fences the prior one, unwraps only the stored approved recovery key and
returns it encrypted to that boot's attested ephemeral recipient. No raw key response or arbitrary
KMS key/ciphertext request exists. A release retry must still be within the original fresh,
current generation/checkpoint window; sealed keys are not historical receipt metadata.

The trusted executor image must generate that ephemeral key internally, bind it to the Google
attestation request, verify the current checkpoint and load only the exact latest state head.
It must expose no arbitrary nonce/attestation, decrypt or key-export relay. These consumer duties
are independently tested and deployed with the executor, not inferred from a policy unit test.

`confirm` proves the original Agent signature, decrypted random challenge and original TLS key
signature. TLS proof covers `{statement, encryptionAnswer}` using the same fixed request path.
Only then are `execute`/`write_report` leases available for that exact current boot/instance.
Fresh execution/write grants again verify attestation, all original keys, OAuth, Root scope and
latest head. Source/task/content-recipient checks remain at Hub and executor boundaries.

Checkpoints and leases use executor-trust v1 and live at most 120 seconds. A consumer must fetch
and verify the **current** checkpoint for every new decrypt/submit, rather than treating an old
signed lease or OAuth credential as continuing permission. State/head changes invalidate prior
checkpoints. `commits` requires an exact current write lease and state-head CAS, storing a bounded
original operation/receipt. Identical committed intent returns its receipt after lease expiry;
changed intent or cross-identity binding conflicts. No old retry reapplies authority or a head.
A receipt records executor-observed metadata; it does not attest external schedule or Hub events.

The policy image pins Authlib 1.9.5, including the current [security revisions](https://docs.authlib.org/en/stable/upgrades/changelog.html). Other targets retain their own dependency files.

## Measured workload startup

Restoring the original TLS key must precede receiving a native client's HTTPS request. A separate
`/workload/v1/connections/{connection}` namespace exposes only `challenges`, `releases` and
`confirm`, using the same closed JSON contract and exact-path proofs. It accepts no bearer or
financial execute/write route. Purpose is strictly `recover` and `resourceBindings` must be empty.
The attestation statement explicitly binds `authorizationMode=workload_recovery`.

A fresh Root register/certificate/transition control supplies a locked-keyring boot window ending
at that command's expiry (at most 300 seconds). After that, workload recovery requires an existing,
current non-revoked account family with recover scope for the same Root binding. Native family
revocation clears an initial boot window; terminal Root revocation always denies. A separately
reviewed fresh Root control can authorize a new bounded locked boot for reconnection/migration.

The ephemeral proof and fresh Google/current-instance checks still precede any sealed key
release. Original Agent/encryption/TLS possession must still be confirmed. This startup channel
restores the original keyring and TLS identity without copying native refresh tokens into the VM;
it supplies no account credential and no financial execution authority. The trusted image must
keep all financial tools closed until a normal current OAuth request and operation-specific
current policy lease have been verified. Old checkpoints, missing authority, wrong images and
wrong original keys remain failures on both transports.
