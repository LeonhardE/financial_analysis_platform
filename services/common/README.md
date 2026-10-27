# Shared service foundations

`folioview-shared` contains opt-in identity, private HTTP, bounded persistence and
[encrypted workspace](folioview_shared/encrypted/README.md) foundations. Importing
the package does not register routes, initialize credentials or contact a cloud
service. Each consumer adopts the helpers in its own service PR.

## Internal delegated identity

`folioview_shared.delegation` implements the bounded internal delegation claims
profile. It is separate from existing Firebase sign-in and external opaque agent
OAuth tokens. Both credentials are required on delegated routes:

| Credential                                                | Verification                                                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer <Google service-account ID token>` | RS256 signature from fixed Google JWKS, exact Google issuer and configured Cloud Run audience, pinned numeric service-account subject/email pair and verified email. |
| `X-FolioView-Delegation: <Hub JWT>`                       | RS256, required `folioview-delegation+jwt` type, fixed configured Hub issuer/audience/key source, owner UID, caller, purpose, scope and resource/Run constraints.    |

There is no fallback from one credential to the other, a request UID, browser
Firebase token or external agent token. The Google service identity must match
the Hub JWT's `caller` email. Numeric service-account IDs are pinned as well as
emails, preventing silent trust when an account is recreated with the same name.
The JWT's `sub` is the Firebase UID the trusted Hub already authenticated; use
that verified UID for the data partition, never a UID from an unverified header,
URL or body. `principal.require_owner(...)` compares an independently known owner.

The three identity types remain separate:

- Existing `auth.CurrentUser` authenticates a Firebase Google user, unchanged.
- `service_identity.ServiceCaller` authenticates a workload; it grants no user
  or resource authority by itself.
- `delegation.DelegatedPrincipal` combines workload identity and a bounded
  owner delegation for one explicitly checked operation.

### Purposes and requirements

`CatalogueRequirement` permits only summary discovery. Claims contain exactly
`iss, sub, aud, iat, exp, jti, caller, purpose, resourceKinds, scopes`, with
`purpose=browser_catalog` and `scopes=[resources:catalog]`. It does not need a Run
or pre-discovered resource reference. Run/grant/resource fields are rejected.

`RunRequirement` permits source reads with exact owner, Run/task/grant IDs,
current grant epoch and a nonempty selection of current source bindings. Claims
contain exactly `iss, sub, aud, iat, exp, jti, caller, purpose, scopes, resources,
runId, taskId, grantId, grantEpoch`, with `purpose=agent_run`. Each resource is
`{ref:{kind,sourceService,resourceId,incarnation}, sourceEpoch}`. Empty resources,
duplicate refs, missing Run/grant or mismatched incarnation/epoch are rejected.
There is no missing-Run downgrade to catalogue discovery.

User policies permit only watchlist/channel-follows with their read scopes;
Portfolio policies permit only holdings and `portfolio:read`. Requirements may
select a nonempty subset of the signed Run inputs; they cannot expand them.
The returned principal is a snapshot of the signed authority, not a reusable
authorization token. Consumers must still restrict a response to that operation's
requested subset.

Delegation JWTs last at most 60 seconds. Dates/epochs are strict safe integers,
expiry has no grace period, and future issue time has a configured skew of at
most five seconds. Google workload tokens have their separate one-hour limit
and bounded configured clock tolerance. Issuer, logical audience, key URL and
source-service policy come from deployment configuration, never request Host,
forwarded headers or token-supplied URLs. The Hub issuer is an HTTPS origin and
its only key source is `H/.well-known/jwks.json`.

`delegation_schemas.json` packages the five closed base-profile schema definitions
as Draft 2020-12 JSON Schema. It preserves the frozen base claims without adding
undocumented vault/execution/version fields. A schema pass is not authentication.
Versioned consumers must configure distinct exact logical audiences and perform
their v2 vault/envelope/manifest/execution bindings separately. This foundation
does not enable a v1 plaintext fallback or imply acceptance of a v2 content
profile from a base identity signature alone.

### Configure and opt in

```python
from folioview_shared.delegation import (
    CatalogueRequirement,
    DelegationVerifier,
    make_delegation_dependency,
)
from folioview_shared.http import create_app
from folioview_shared.service_identity import GoogleCallerVerifier

# Values below come from trusted service configuration; none is request-derived.
caller_verifier = GoogleCallerVerifier(
    USER_CLOUD_RUN_AUDIENCE,
    {HUB_SERVICE_ACCOUNT_SUBJECT: HUB_SERVICE_ACCOUNT_EMAIL},
)
verifier = DelegationVerifier(
    issuer=HUB_HTTPS_ORIGIN,
    audience=USER_INTERNAL_DELEGATION_AUDIENCE,
    source_service="user",
    caller_verifier=caller_verifier,
)
catalogue_identity = make_delegation_dependency(
    verifier,
    CatalogueRequirement(frozenset({"watchlist", "channel_follows"})),
)
app = create_app(
    "Private consumer",
    private=True,
    private_prefixes=("/api/", "/internal/"),
)
# The consumer explicitly mounts its route with Depends(catalogue_identity).
```

For Run reads use a requirement factory with signature
`factory(request, verified_principal) -> RunRequirement`. Both signatures,
issuer/audience/time/caller and target-source scopes are authenticated **before**
the factory runs. Use `verified_principal.owner_uid` and its signed Run IDs to
load the correct partition's current authority. Return the actual current
grant/source epochs and requested resources. A forged request must not trigger
the authority-store query or reveal whether a Run exists. For pure code,
`verify(..., requirement=...)` also accepts a one-argument principal factory.

The factory must reject missing/inactive/revoked authority explicitly with
`DelegationError("permission_denied")`; return no catalogue fallback. Report
authority-store outages with `DelegationError("verification_unavailable")`.
Unexpected factory failures are sanitized to 503 by the HTTP adapter. Perform
the consumer's final current-state/fence checks at data access and transaction
commit; short JWTs and cached keys do not replace business revocation.

`make_service_identity_dependency(caller_verifier)` is a separate workload-only
dependency for narrowly authorized service callbacks. It returns only a
`ServiceCaller` and rejects a delegation header. Callback owners must still
restrict actions to that caller's namespace; a valid service identity does not
allow reading user data or arbitrary fence mutation.

The adapters reject missing/duplicate/malformed headers. They never consume
`X-Serverless-Authorization` as application proof: Cloud Run can strip its
signature. Arrange for the application to receive the complete signed token
in `Authorization` and verify it independently; never accept an unsigned
ingress-decoded payload as a substitute. Existing Firebase routes are unchanged.

Enable both private prefixes when mounting internal routes. Dependency success
and authentication errors set `no-store`, while the middleware also covers
endpoint errors, validation, 404/405 and CORS. Existing `create_app(private=True)`
continues protecting only `/api/` by default.

### Keys, failures and operational limits

`delegated_keys.KeyCache` uses one pinned HTTPS/443 URL, rejects credentials,
query/fragment, redirects and token-supplied key locators, and accepts only
bounded public RS256 RSA keys. The Google source is fixed to
`https://www.googleapis.com/oauth2/v3/certs`; no discovery follows a token issuer.
Imports and verifier construction make no network calls.

- At most eight keys and 64 KiB per JWKS; RSA 2048/3072/4096 with exponent65537,
  unique bounded key IDs and no private members or embedded key URLs.
- Maximum/default cache TTL300 seconds; unknown IDs share a30-second refresh
  cooldown by default. Successful refresh replaces the entire key set, including
  removal of retired keys. Fresh known keys remain usable during an unrelated
  unknown-key refresh failure; expired keys never become an outage fallback.
- Fetches have an explicit socket timeout of at most three seconds, bounded
  response bytes and no redirect following. Socket timeout is not a guaranteed
  DNS/scheduler/whole-request deadline; runtime policy must bound total requests.
- Keys are public-only and process-local; no raw tokens, successful principal
  results or unbounded attacker-selected negative-key cache are retained.

| Outcome                                                                                                         | HTTP result                                    |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Missing/invalid credentials, signature, issuer/audience, expiry or unknown key after successful trusted refresh | 401, fixed message, Bearer challenge, no-store |
| Valid identity with unauthorized caller/owner/purpose/scope/Run/resource binding                                | 403, fixed message, no-store                   |
| Trusted-key fetch/parse/expiry outage or authority verification unavailable                                     | 503, fixed message, no-store                   |

No raw token, input claim, key or transport exception appears in these messages.
401/403 do not become success when a key source is unavailable. The cache is
not a key-revocation push mechanism; effective visibility is bounded by its TTL,
and consumers must still enforce current authorization.

This package verifies public signatures only. It implements no KMS signer,
metadata credential acquisition, OAuth/refresh/grant/Run store, broker connector,
content key/decryption service, global JWT replay store or cloud provisioning.
The Hub's future signer must bind these exact claims to an authenticated owner
and a fixed target using its authorized KMS key. Read-only delegation reuse
within its short lifetime is not a one-use mutation guarantee.

### Checks and primary references

Tests use generated in-memory RSA keys and deterministic fake clocks/transports.
They cover real signatures, Google/caller pins, both purposes, resource/owner/Run
substitution, rotation/outages/cooldowns, HTTP failures and private response
headers. Existing service tests cover the unchanged Firebase/public paths.
Run `python scripts/test_services.py --service common` and root `npm run check`.

The workload-token boundary follows Google's
[service-account token claims](https://docs.cloud.google.com/docs/authentication/token-types#service_account_id_tokens),
[fixed OIDC metadata](https://accounts.google.com/.well-known/openid-configuration)
and [Cloud Run header behavior](https://docs.cloud.google.com/run/docs/authenticating/service-to-service).
The application still verifies the signed token; ingress IAM is a separate layer.
