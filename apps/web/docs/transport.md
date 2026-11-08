# Private owner transport

See [.env.example](../.env.example). Portfolio owner requests use the fixed same-origin prefix
`/api/private/portfolio` followed by the canonical `/api/v2/holdings/sources/...` path. An anonymous,
bounded `/api/private/owner-config` response exposes only schema version and feature booleans.
The Hub owner prefix is `/api/private/agent-hub` followed by an explicitly allowed canonical
`/api/v2/...` path. Each target is independently disabled when its configuration is unavailable,
without delaying Google login or Markets. The public capability response contains no origins,
credentials or private configuration.

Portfolio uses the existing REPO-002 **server runtime** projection:
`FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID`, `FOLIOVIEW_PORTFOLIO_OWNER_ENABLED`,
`FOLIOVIEW_PORTFOLIO_ORIGIN`, and `FOLIOVIEW_PORTFOLIO_AUDIENCE`. The flag must be `true`, the
origin must be a canonical `portfolio-api-{projectNumber}.{region}.run.app` HTTPS origin, and the
audience must match it exactly. These are not public build arguments. A deployed browser ignores
`NEXT_PUBLIC_PORTFOLIO_API_BASE_URL`; its direct-API exception is restricted to `next dev` with
both a loopback page and loopback HTTP(S) API for the existing local CSV acceptance setup.

Hub uses `FOLIOVIEW_HUB_OWNER_ENABLED=true` and `FOLIOVIEW_HUB_ORIGIN` with the same server-only
Firebase project setting. Its fixed origin must be a canonical
`agent-hub-api-{projectNumber}.{region}.run.app` HTTPS origin. Hub forwarding adds no metadata or
workload identity token: public Hub retains authoritative Firebase revocation and owner checks.
The independent Portfolio capability and its private IAM flow remain intact. Deployed browsers
ignore both legacy `NEXT_PUBLIC_*_API_BASE_URL` values for these targets; the local exception is
restricted to `next dev` with a loopback page and a loopback HTTP(S) API. Missing values do not
fall back to Market, another target or a production direct connection. This code changes no cloud
configuration, IAM, invoker grants or resources; both rollout gates remain disabled by default.

The Node route verifies the original Firebase JWT against Google's fixed SecureToken JWKS,
including signature, configured project/issuer/audience, timestamps and Google provider. This
precheck does not replace either target's authoritative revoked-user, owner and encrypted-contract
validation. It needs no Firebase user-directory permission. Only for Portfolio,
after the precheck, Web uses its default runtime identity's fixed metadata endpoint to obtain a short-lived ID token for that
Portfolio audience. That service token goes only in `X-Serverless-Authorization`; the original
user `Authorization` reaches Portfolio unchanged. External service-identity headers and cookies
are stripped. No key file, browser service token, new cookie session or private content key is used.

The proxy only accepts named owner routes and their exact methods, body shapes and control
headers. Portfolio queries, encoded paths, internal/agent routes, caller-selected targets and
redirects are rejected. Actual streamed request sizes follow the existing 576 KiB snapshot, 65 KiB mutation
and 1 KiB authority limits; responses are bounded to 1 MiB. Duplicate JSON keys, excessive depth
and unsafe numbers are rejected. Valid ciphertext/signature bytes and operation identifiers are
forwarded unchanged, with no write retries. The total deadline is 12 seconds including bodies,
verification and identity fetches; each shared identity/key fetch has its own 4-second ceiling.
For each target, per-process admission is bounded to 16 requests, four active requests and 30 attempts per minute
per verified UID, with at most 1,024 tracked UID windows. These local bounds do not replace
separate deployment-wide cost controls. Only fixed formal application errors cross the boundary;
metadata/IAM/network/key-fetch failures become retryable service errors, not a user logout.

Browser Origin checks use the incoming `Host` and the request URL's protocol. Next standalone
can give route handlers a URL containing the container's listening hostname instead of the
public destination, so that internal hostname is not the browser origin. `X-Forwarded-Host`
and `Forwarded` do not select an accepted origin. Cross-site requests, mismatched schemes or
ports, opaque origins and malformed/multiple Host values are rejected before identity checks.
Hostless direct Request callers retain the URL-origin check; absent Origin remains permitted
for authenticated non-browser clients.

Hub forwarding covers owner vault enrollment/registry/source controls and authority tokens,
resource catalogue, encrypted tasks and versions/transitions, Inbox lists/counts/details/history/
proofs/state, connection listing/revocation and preparation intent/staging/commit. Only the named
list/history/detail queries (`limit`, `cursor`, `filter`, `taskId`, `revision`, `deliveryRevision`)
are allowed on their corresponding reads, with canonical numbers, duplicates/unknowns rejected and
no encoded path selection. Writes preserve only their required operation/author headers and exact
bounded original JSON. Hub state controls have the actual 65536-byte limit; preparation commit
is limited to 8192 bytes, and other writes never exceed 589824 bytes. Formal task/result responses
use existing shared schemas; custom Hub profiles retain closed top-level fields. The exact stage
descriptor and formal `ResultMetadata` state ACK have no `contractVersion` field in the current
producer and are passed unchanged only for those two named operations. Old state ACKs remain
original operation facts, not an implicit refresh of newer state.

All `/api/v2/agent-authorizations/...` browser-flow endpoints remain excluded: the existing Hub
protocol requires its own exact issuer Origin and `fv_oauth_flow` cookie. Web does not copy that
cookie, forge a Hub Origin or infer user approval. The separate owner-consent handoff is described
below.
OAuth, MCP, agent REST, discovery/JWKS, internal and helper URLs are never exposed through this
owner forwarder. Stripping browser-supplied identity/delegation headers does not make public Hub
private; its application authorization must also hold for direct clients.
Responses use `no-store` and never forward authentication headers, cookies or raw diagnostics.

The authenticated request client restricts each service's exact paths, methods, body fields and
contract headers, rejects arbitrary destinations and identity-header overrides, and fences late
responses when an account changes. Bodies, bearer/delegation tokens, PRF output and private keys
are not placed in URLs, localStorage, analytics or error messages.
