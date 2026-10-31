const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

const CONTRACT = "folioview.agent-workspace.v2.0";
const ORIGIN = "https://portfolio-api-123456789.northamerica-northeast2.run.app";
const SITE = "https://folioview.example.test";
const PREFIX = "/api/private/portfolio";
const SOURCE = "/api/v2/holdings/sources/source_A";
const JWKS =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const METADATA =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const NOW = Date.parse("2026-10-29T23:30:00Z");
const ENV = {
  FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID: "fixture-project",
  FOLIOVIEW_PORTFOLIO_OWNER_ENABLED: "true",
  FOLIOVIEW_PORTFOLIO_ORIGIN: ORIGIN,
  FOLIOVIEW_PORTFOLIO_AUDIENCE: ORIGIN,
};
const OPERATION = "synthetic_operation_000001";
const AUTHOR = "A".repeat(43);
const SIGNED = { protected: "cHJvdGVjdGVk", payload: "cGF5bG9hZA", signature: "c2lnbmF0dXJl" };
const CARRIER = { contractVersion: CONTRACT, signedObject: SIGNED };
let jose;
let moduleApi;
let privateKey;
let jwk;
let tokenA;
let serviceToken;

function compile(file, imports) {
  const { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
    filename: file,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected server import ${name}`);
      return imports[name];
    },
    process: { env: {} },
    fetch,
    Request,
    Response,
    Headers,
    URL,
    AbortSignal,
    AbortController,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
  });
  return module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.ok(predicate(), "expected asynchronous boundary was reached");
}

async function googleToken(overrides = {}, signingKey = privateKey, header = {}) {
  return new jose.SignJWT({
    iss: "https://securetoken.google.com/fixture-project",
    aud: "fixture-project",
    sub: "owner_A",
    iat: NOW / 1000 - 10,
    auth_time: NOW / 1000 - 20,
    exp: NOW / 1000 + 3600,
    firebase: { sign_in_provider: "google.com" },
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic-google-key", ...header })
    .sign(signingKey);
}

function jsonResponse(body = { contractVersion: CONTRACT, synthetic: true }, options = {}) {
  return Response.json(body, options);
}

function metadataResponse(token = serviceToken, options = {}) {
  return new Response(token, { headers: { "Metadata-Flavor": "Google" }, ...options });
}

function request(
  route = SOURCE,
  { method = "GET", token = tokenA, headers = {}, raw, json, signal, site = SITE } = {},
) {
  const body = raw ?? (json === undefined ? undefined : JSON.stringify(json));
  return new Request(site + PREFIX + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-FolioView-Contract": CONTRACT,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body, duplex: "half" }),
    ...(signal ? { signal } : {}),
  });
}

function harness({
  env = ENV,
  clock = () => NOW,
  deadlineMs = 1000,
  jwks,
  metadata,
  upstream,
} = {}) {
  const calls = [];
  const send = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url === JWKS) return jwks ? jwks(options) : jsonResponse({ keys: [jwk] });
    if (url.startsWith(METADATA + "?"))
      return metadata ? metadata(options, url) : metadataResponse();
    assert.ok(
      url.startsWith(ORIGIN + "/api/v2/holdings/sources/"),
      "only the fixed Portfolio origin receives an upstream call",
    );
    return upstream ? upstream(url, options) : jsonResponse();
  };
  const proxy = moduleApi.createPortfolioProxy({ env, fetch: send, now: clock, deadlineMs });
  return {
    proxy,
    calls,
    jwks: () => calls.filter((call) => call.url === JWKS),
    metadata: () => calls.filter((call) => call.url.startsWith(METADATA + "?")),
    upstream: () => calls.filter((call) => call.url.startsWith(ORIGIN + "/")),
  };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.contractVersion, CONTRACT);
  assert.equal(body.error.code, code);
  assert.equal(body.error.retryable, status === 503);
  assert.match(body.error.requestId, /^[A-Za-z0-9_-]{1,128}$/);
  return body;
}

function writeHeaders(extra = {}) {
  return { "Idempotency-Key": OPERATION, "X-FolioView-Author-Key": AUTHOR, ...extra };
}

function snapshot(expectedRevision = 0) {
  return { contractVersion: CONTRACT, expectedRevision, carrier: CARRIER };
}

function mutation() {
  return { contractVersion: CONTRACT, expectedVersion: 1, expectedSourceEpoch: 1, command: SIGNED };
}

test.before(async () => {
  jose = await import("jose");
  const pair = await jose.generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  privateKey = pair.privateKey;
  jwk = {
    ...(await jose.exportJWK(pair.publicKey)),
    kid: "synthetic-google-key",
    alg: "RS256",
    use: "sig",
  };
  const common = compile("../lib/server/owner-transport.ts", {
    "server-only": {},
    "node:crypto": require("node:crypto"),
    jose,
  });
  const portfolio = compile("../lib/server/portfolio-owner.ts", {
    "server-only": {},
    "./owner-transport": common,
    jose,
  });
  const caps = compile("../lib/server/owner-config.ts", {
    "server-only": {},
    "./portfolio-owner": portfolio,
    "./hub-owner": { hubConfiguration: () => null },
  });
  moduleApi = { ...portfolio, ...caps };
  tokenA = await googleToken();
  serviceToken = await new jose.SignJWT({
    iss: "https://accounts.google.com",
    aud: ORIGIN,
    exp: NOW / 1000 + 3600,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(privateKey);
});

test("public capabilities disclose only closed booleans and disable invalid production configuration", () => {
  for (const [env, enabled] of [
    [ENV, true],
    [{}, false],
    [{ ...ENV, FOLIOVIEW_PORTFOLIO_OWNER_ENABLED: "false" }, false],
    [{ ...ENV, FOLIOVIEW_PORTFOLIO_ORIGIN: "https://other.example.test" }, false],
    [{ ...ENV, FOLIOVIEW_PORTFOLIO_AUDIENCE: "https://other.example.test" }, false],
    [{ ...ENV, FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID: "invalid/project" }, false],
    [
      {
        ...ENV,
        FOLIOVIEW_PORTFOLIO_ORIGIN: ORIGIN + "/",
        FOLIOVIEW_PORTFOLIO_AUDIENCE: ORIGIN + "/",
      },
      false,
    ],
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(moduleApi.ownerCapabilities(env))), {
      schemaVersion: 1,
      flags: { portfolio: enabled, agentHub: false },
    });
  }
});

test("Next routes expose only owner methods and anonymous configuration with no caching", async () => {
  const sentinel = async () => jsonResponse();
  const routes = compile("../app/api/private/portfolio/[...path]/route.ts", {
    "@/lib/server/portfolio-owner": { portfolioProxy: sentinel },
  });
  assert.deepEqual(Object.keys(routes).sort(), ["GET", "POST", "PUT", "dynamic", "runtime"]);
  assert.equal(routes.GET, sentinel);
  assert.equal(routes.POST, sentinel);
  assert.equal(routes.PUT, sentinel);
  assert.equal(routes.runtime, "nodejs");
  assert.equal(routes.dynamic, "force-dynamic");
  const config = compile("../app/api/private/owner-config/route.ts", {
    "@/lib/server/owner-config": moduleApi,
  });
  const response = config.GET();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    flags: { portfolio: false, agentHub: false },
  });
});

test("real Firebase verification precedes fixed metadata IAM acquisition and preserves the two bearer audiences", async () => {
  const h = harness({
    upstream: async () =>
      jsonResponse(undefined, {
        headers: {
          "Set-Cookie": "private=never-forward",
          Location: "https://evil.test",
          "X-Private-Debug": "secret",
        },
      }),
  });
  const response = await h.proxy(
    request(SOURCE + "/latest", {
      headers: {
        Origin: SITE,
        "X-Serverless-Authorization": "Bearer attacker",
        "X-Upstream-URL": "https://evil.test",
        Cookie: "caller=private",
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    h.calls.map((call) => call.url),
    [
      JWKS,
      METADATA + "?audience=" + encodeURIComponent(ORIGIN) + "&format=full",
      ORIGIN + SOURCE + "/latest",
    ],
  );
  const keys = h.jwks()[0];
  assert.equal(keys.options.headers?.Authorization, undefined);
  assert.equal(keys.options.redirect, "manual");
  const metadata = h.metadata()[0];
  assert.equal(new Headers(metadata.options.headers).get("metadata-flavor"), "Google");
  assert.equal(new Headers(metadata.options.headers).get("authorization"), null);
  const upstream = h.upstream()[0];
  assert.equal(upstream.options.headers.get("authorization"), "Bearer " + tokenA);
  assert.equal(
    upstream.options.headers.get("x-serverless-authorization"),
    "Bearer " + serviceToken,
  );
  assert.equal(upstream.options.headers.get("x-folioview-contract"), CONTRACT);
  assert.equal(upstream.options.headers.has("cookie"), false);
  assert.equal(upstream.options.headers.has("x-upstream-url"), false);
  assert.equal(upstream.options.redirect, "manual");
  assert.equal(upstream.options.credentials, "omit");
  assert.equal(upstream.options.cache, "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-private-debug"), null);
});

test("same-origin snapshot writes survive the container URL while preserving private identity forwarding", async () => {
  const h = harness();
  const raw = JSON.stringify({ contractVersion: CONTRACT, expectedRevision: 0, carrier: CARRIER });
  const result = await h.proxy(
    request(SOURCE + "/snapshots/snapshot_A", {
      method: "PUT",
      raw,
      site: "https://0.0.0.0:8080",
      headers: {
        ...writeHeaders(),
        Host: new URL(SITE).host,
        Origin: SITE,
        "Sec-Fetch-Site": "same-origin",
        "X-Forwarded-Host": "evil.test",
      },
    }),
  );
  assert.equal(result.status, 200, await result.clone().text());
  const forwarded = h.upstream()[0].options;
  assert.equal(new TextDecoder().decode(forwarded.body), raw);
  assert.equal(forwarded.headers.get("x-serverless-authorization"), "Bearer " + serviceToken);
  assert.equal(forwarded.headers.get("authorization"), "Bearer " + tokenA);
  for (const name of ["host", "origin", "x-forwarded-host"])
    assert.equal(forwarded.headers.has(name), false);
});

test("snapshot writes reject a forged forwarded host and the container origin before acquiring identity", async () => {
  for (const origin of ["https://evil.test", "https://0.0.0.0:8080"]) {
    const h = harness();
    await expectError(
      await h.proxy(
        request(SOURCE + "/snapshots/snapshot_A", {
          method: "PUT",
          site: "https://0.0.0.0:8080",
          headers: {
            ...writeHeaders(),
            Host: new URL(SITE).host,
            Origin: origin,
            "X-Forwarded-Host": new URL(origin).host,
          },
          json: { contractVersion: CONTRACT, expectedRevision: 0, carrier: CARRIER },
        }),
      ),
      403,
      "insufficient_scope",
    );
    assert.equal(h.calls.length, 0);
  }
});

test("wrong signatures, audience, provider and future Firebase claims fail401 before service identity", async () => {
  const other = await jose.generateKeyPair("RS256");
  const invalid = [
    await googleToken({}, other.privateKey),
    await googleToken({ aud: "another-project" }),
    await googleToken({ aud: ["fixture-project", "another-project"] }),
    await googleToken({ iss: "https://accounts.google.com" }),
    await googleToken({ firebase: { sign_in_provider: "password" } }),
    await googleToken({ firebase: { sign_in_provider: "anonymous" } }),
    await googleToken({ firebase: null }),
    await googleToken({ iat: NOW / 1000 + 1 }),
    await googleToken({ auth_time: NOW / 1000 + 1 }),
    await googleToken({ auth_time: 1.5 }),
    await googleToken({ exp: NOW / 1000 - 1 }),
    await googleToken({ exp: NOW / 1000 + 3600.5 }),
    await googleToken({ exp: undefined }),
    await googleToken({ auth_time: undefined }),
    await googleToken({ sub: "" }),
    await googleToken({ sub: 123 }),
    await googleToken({ sub: { synthetic: true } }),
    await googleToken({ sub: ["owner_A"] }),
    await googleToken({ sub: "x".repeat(129) }),
    await googleToken({ nbf: NOW / 1000 + 1 }),
  ];
  for (const token of invalid) {
    const h = harness();
    const response = await h.proxy(request(SOURCE, { token }));
    await expectError(response, 401, "invalid_token");
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal(h.metadata().length, 0);
    assert.equal(h.upstream().length, 0);
  }
});

test("key infrastructure and unknown rotation failures remain503 rather than logging the owner out", async () => {
  for (const jwks of [
    async () => new Response("offline", { status: 503 }),
    async () => {
      throw new Error("network unavailable");
    },
    async () => jsonResponse({ keys: [] }),
    async () =>
      new Response('{"keys":[],"keys":[]}', { headers: { "Content-Type": "application/json" } }),
    async () => new Response("x".repeat(131073)),
  ]) {
    const h = harness({ jwks });
    const response = await h.proxy(request());
    await expectError(response, 503, "authorization_unavailable");
    assert.equal(response.headers.get("www-authenticate"), null);
    assert.equal(h.metadata().length, 0);
    assert.equal(h.upstream().length, 0);
  }
});

test("metadata failure, wrong identity audience and Cloud Run IAM denial return sanitized503", async () => {
  const wrongAudience = await new jose.SignJWT({
    iss: "https://accounts.google.com",
    aud: "https://other.example.test",
    exp: NOW / 1000 + 3600,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(privateKey);
  const wrongIssuer = await new jose.SignJWT({
    iss: "https://evil.test",
    aud: ORIGIN,
    exp: NOW / 1000 + 3600,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(privateKey);
  const expiring = await new jose.SignJWT({
    iss: "https://accounts.google.com",
    aud: ORIGIN,
    exp: NOW / 1000 + 30,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(privateKey);
  for (const metadata of [
    async () => new Response("offline", { status: 403 }),
    async () => new Response(serviceToken),
    async () => metadataResponse("not-a-jwt"),
    async () => metadataResponse(wrongAudience),
    async () => metadataResponse(wrongIssuer),
    async () => metadataResponse(expiring),
    async () => metadataResponse("a".repeat(16385)),
  ]) {
    const h = harness({ metadata });
    await expectError(await h.proxy(request()), 503, "authorization_unavailable");
    assert.equal(h.upstream().length, 0);
  }
  const h = harness({
    upstream: async () => new Response("Google IAM: private stack trace", { status: 403 }),
  });
  const body = await expectError(await h.proxy(request()), 503, "authorization_unavailable");
  assert.ok(!JSON.stringify(body).includes("private stack trace"));
});

test("closed routes, queries, cross-site requests and transport headers are rejected before JWKS or metadata", async () => {
  for (const [route, options, code, status = 400] of [
    [SOURCE + "?owner=other", {}, "unsupported_query"],
    [SOURCE + "?", {}, "unsupported_query"],
    [SOURCE + "/latest?cursor=anything", {}, "unsupported_query"],
    [SOURCE + "/latest?cursor=%2F", {}, "unsupported_query"],
    ["/internal/v2/holdings", {}, "malformed_request"],
    [SOURCE + "/mutations/op_A/ack", {}, "malformed_request"],
    [SOURCE + "/snapshots/snapshot_A/extra", {}, "malformed_request"],
    [SOURCE, { method: "DELETE" }, "malformed_request"],
    [SOURCE, { headers: { Origin: "https://evil.test" } }, "insufficient_scope", 403],
    [SOURCE, { headers: { "Sec-Fetch-Site": "cross-site" } }, "insufficient_scope", 403],
    [SOURCE, { headers: { "X-FolioView-Contract": "old" } }, "unsupported_contract"],
    [SOURCE, { headers: { Authorization: "Bearer malformed" } }, "invalid_token", 401],
    [SOURCE, { headers: { Authorization: "Bearer " + "A".repeat(8193) } }, "invalid_token", 401],
    [SOURCE, { headers: writeHeaders() }, "malformed_request"],
    [SOURCE, { headers: { "Content-Encoding": "gzip" } }, "unsupported_media_type", 415],
    [
      SOURCE + "/authority-sync",
      { method: "POST", json: { contractVersion: CONTRACT } },
      "malformed_request",
    ],
  ]) {
    const h = harness();
    await expectError(await h.proxy(request(route, options)), status, code);
    assert.equal(h.calls.length, 0);
  }
  for (const suffix of ["/snapshots/%2e%2e/other", "/snapshots/a%2Fb", "/snapshots/a%5Cb"]) {
    const h = harness();
    await expectError(await h.proxy(request(SOURCE + suffix)), 400, "malformed_request");
    assert.equal(h.calls.length, 0);
  }
});

test("closed write bodies reject duplicate JSON, plaintext carriers and unsafe numeric or nesting forms", async () => {
  const route = SOURCE + "/snapshots/snapshot_A";
  const good = snapshot();
  const raws = [
    JSON.stringify({ ...good, ownerUid: "another-owner" }),
    JSON.stringify({ ...good, expectedRevision: -1 }),
    JSON.stringify({ ...good, expectedRevision: 0.5 }),
    JSON.stringify(good).replace('"expectedRevision":0', '"expectedRevision":9007199254740992'),
    JSON.stringify(good).replace(
      '"expectedRevision":0',
      '"expectedRevision":0,"expectedRevision":0',
    ),
    JSON.stringify(good).replace(
      '"expectedRevision":0',
      '"expectedRevision":0,"expected\\u0052evision":0',
    ),
    JSON.stringify({ ...good, carrier: { ...CARRIER, plaintext: "private holdings" } }),
    JSON.stringify({
      ...good,
      carrier: { ...CARRIER, signedObject: { ...SIGNED, signature: "bad=" } },
    }),
    JSON.stringify({
      ...good,
      carrier: { ...CARRIER, signedObject: { ...SIGNED, private: "secret" } },
    }),
    JSON.stringify(good).replace(
      '"signature":"c2lnbmF0dXJl"',
      '"signature":"c2lnbmF0dXJl","signature":"c2lnbmF0dXJl"',
    ),
    JSON.stringify({
      ...good,
      carrier: { ...CARRIER, signedObject: { ...SIGNED, payload: "\\ud800" } },
    }),
    JSON.stringify({
      ...good,
      unexpected: Array.from({ length: 25 }).reduce((value) => [value], 0),
    }),
  ];
  for (const raw of raws) {
    const h = harness();
    await expectError(
      await h.proxy(request(route, { method: "PUT", headers: writeHeaders(), raw })),
      400,
      "malformed_request",
    );
    assert.equal(h.calls.length, 0);
  }
  for (const [route, body, headers] of [
    [SOURCE + "/mutations/fence", { ...mutation(), expectedVersion: 0 }, writeHeaders()],
    [SOURCE + "/mutations/delete", { ...mutation(), expectedSourceEpoch: 0 }, writeHeaders()],
    [
      SOURCE + "/mutations/disconnect",
      { ...mutation(), command: { plaintext: "private" } },
      writeHeaders(),
    ],
    [
      SOURCE + "/mutations/fence",
      mutation(),
      writeHeaders({ "Idempotency-Key": OPERATION + ", " + OPERATION }),
    ],
    [SOURCE + "/mutations/fence", mutation(), writeHeaders({ "X-FolioView-Author-Key": "short" })],
    [SOURCE + "/mutations/unknown", mutation(), writeHeaders()],
    [
      SOURCE + "/authority-sync",
      { contractVersion: CONTRACT, ownerUid: "other" },
      { "X-FolioView-Authority-Delegation": "a.b.c" },
    ],
    [
      SOURCE + "/authority-sync",
      { contractVersion: CONTRACT },
      { "X-FolioView-Authority-Delegation": "a.b." + "c".repeat(16384) },
    ],
  ]) {
    const h = harness();
    await expectError(
      await h.proxy(request(route, { method: "POST", json: body, headers })),
      400,
      "malformed_request",
    );
    assert.equal(h.calls.length, 0);
  }
  for (const headers of [
    writeHeaders({ "Content-Type": "text/plain" }),
    writeHeaders({ "Content-Encoding": "br" }),
  ]) {
    const h = harness();
    await expectError(
      await h.proxy(request(route, { method: "PUT", headers, json: good })),
      415,
      "unsupported_media_type",
    );
    assert.equal(h.calls.length, 0);
  }
});

test("all fixed read/write shapes preserve exact request bytes, replay identifiers and receipt recovery", async () => {
  const h = harness();
  const authority = "a.b.c";
  for (const route of [
    SOURCE,
    SOURCE + "/latest",
    SOURCE + "/snapshots/snapshot_A",
    SOURCE + "/operations/" + OPERATION,
    SOURCE + "/mutations/" + OPERATION,
  ]) {
    assert.equal((await h.proxy(request(route))).status, 200);
  }
  const raw =
    ' { "contractVersion" : "' +
    CONTRACT +
    '", "expectedRevision":0, "carrier":' +
    JSON.stringify(CARRIER) +
    " }\n";
  for (let retry = 0; retry < 2; retry++) {
    assert.equal(
      (
        await h.proxy(
          request(SOURCE + "/snapshots/snapshot_A", {
            method: "PUT",
            headers: writeHeaders(),
            raw,
          }),
        )
      ).status,
      200,
    );
    const forwarded = h.upstream().at(-1).options;
    assert.equal(new TextDecoder().decode(forwarded.body), raw);
    assert.equal(forwarded.headers.get("idempotency-key"), OPERATION);
    assert.equal(forwarded.headers.get("x-folioview-author-key"), AUTHOR);
  }
  assert.equal((await h.proxy(request(SOURCE + "/operations/" + OPERATION))).status, 200);
  assert.equal(h.upstream().at(-1).options.body, undefined);
  for (const action of ["fence", "disconnect", "delete"]) {
    assert.equal(
      (
        await h.proxy(
          request(SOURCE + "/mutations/" + action, {
            method: "POST",
            json: mutation(),
            headers: writeHeaders(),
          }),
        )
      ).status,
      200,
    );
  }
  assert.equal(
    (
      await h.proxy(
        request(SOURCE + "/authority-sync", {
          method: "POST",
          json: { contractVersion: CONTRACT },
          headers: { "X-FolioView-Authority-Delegation": authority },
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    h.upstream().at(-1).options.headers.get("x-folioview-authority-delegation"),
    authority,
  );
  assert.equal(h.jwks().length, 1, "verified signing keys may be reused");
  assert.equal(h.metadata().length, 1, "workload identity may be reused for its fixed audience");
});

test("snapshot byte ceiling admits an exact maximum packet and rejects one extra byte before identity", async () => {
  const base = snapshot();
  const overhead = new TextEncoder().encode(JSON.stringify(base)).length - SIGNED.payload.length;
  const large = {
    ...base,
    carrier: { ...CARRIER, signedObject: { ...SIGNED, payload: "A".repeat(589824 - overhead) } },
  };
  const raw = JSON.stringify(large);
  assert.equal(new TextEncoder().encode(raw).byteLength, 589824);
  const h = harness();
  assert.equal(
    (
      await h.proxy(
        request(SOURCE + "/snapshots/snapshot_A", { method: "PUT", raw, headers: writeHeaders() }),
      )
    ).status,
    200,
  );
  assert.equal(h.upstream()[0].options.body.byteLength, 589824);
  const rejected = harness();
  await expectError(
    await rejected.proxy(
      request(SOURCE + "/snapshots/snapshot_A", {
        method: "PUT",
        raw: raw + " ",
        headers: writeHeaders(),
      }),
    ),
    413,
    "payload_too_large",
  );
  assert.equal(rejected.calls.length, 0);
  for (const [route, size, headers] of [
    [SOURCE + "/mutations/fence", 66561, writeHeaders()],
    [SOURCE + "/authority-sync", 1025, { "X-FolioView-Authority-Delegation": "a.b.c" }],
  ]) {
    const oversized = harness();
    await expectError(
      await oversized.proxy(request(route, { method: "POST", raw: " ".repeat(size), headers })),
      413,
      "payload_too_large",
    );
    assert.equal(oversized.calls.length, 0);
  }
});

test("formal upstream errors preserve status and bytes while IAM HTML, redirects and malformed JSON are sanitized", async () => {
  const formal = {
    contractVersion: CONTRACT,
    error: { code: "version_conflict", retryable: false, requestId: "synthetic_request" },
  };
  const raw = JSON.stringify(formal);
  const h = harness({
    upstream: async () =>
      new Response(raw, {
        status: 409,
        headers: { "Content-Type": "application/json", "Set-Cookie": "never" },
      }),
  });
  const response = await h.proxy(request());
  assert.equal(response.status, 409);
  assert.equal(await response.text(), raw);
  assert.equal(response.headers.get("set-cookie"), null);
  for (const upstream of [
    async () =>
      new Response("<html>IAM secret details</html>", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    async () =>
      new Response("{}", {
        status: 302,
        headers: { Location: "https://evil.test", "Content-Type": "application/json" },
      }),
    async () =>
      jsonResponse({ ...formal, error: { ...formal.error, retryable: true } }, { status: 409 }),
    async () =>
      new Response('{"contractVersion":"' + CONTRACT + '","contractVersion":"' + CONTRACT + '"}', {
        headers: { "Content-Type": "application/json" },
      }),
    async () => jsonResponse({ contractVersion: "other", private: "secret" }),
    async () => jsonResponse({ contractVersion: CONTRACT, payload: "A".repeat(1048576) }),
  ]) {
    const rejected = harness({ upstream });
    const body = await expectError(
      await rejected.proxy(request()),
      503,
      "authorization_unavailable",
    );
    assert.ok(!JSON.stringify(body).includes("secret"));
  }
});

test("multiple owners share only workload identity and never each other's raw Firebase bearer", async () => {
  const tokenB = await googleToken({ sub: "owner_B" });
  const seen = [];
  const h = harness({
    upstream: async (_url, options) => {
      seen.push(options.headers.get("authorization"));
      return jsonResponse();
    },
  });
  await Promise.all([h.proxy(request()), h.proxy(request(SOURCE, { token: tokenB }))]);
  assert.deepEqual(new Set(seen), new Set(["Bearer " + tokenA, "Bearer " + tokenB]));
  assert.equal(h.metadata().length, 1, "the fixed audience workload token flight is shared");
  assert.equal(h.upstream()[0].options.headers === h.upstream()[1].options.headers, false);
});

test("deadlines bound incoming streams, noncooperative upstream promises and response cancellation", async () => {
  let incomingCancelled = false;
  const incoming = harness({ deadlineMs: 20 });
  const raw = new ReadableStream({
    cancel() {
      incomingCancelled = true;
      return new Promise(() => {});
    },
  });
  await expectError(
    await incoming.proxy(
      request(SOURCE + "/snapshots/snapshot_A", { method: "PUT", raw, headers: writeHeaders() }),
    ),
    503,
    "authorization_unavailable",
  );
  assert.equal(incomingCancelled, true);
  assert.equal(incoming.calls.length, 0);

  const pending = deferred();
  const downstream = harness({ deadlineMs: 20, upstream: () => pending.promise });
  await expectError(await downstream.proxy(request()), 503, "authorization_unavailable");
  assert.equal(downstream.upstream()[0].options.signal.aborted, true);
  pending.resolve(jsonResponse());

  let responseCancelled = false;
  const body = harness({
    deadlineMs: 20,
    upstream: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            responseCancelled = true;
            return new Promise(() => {});
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  });
  await expectError(await body.proxy(request()), 503, "authorization_unavailable");
  assert.equal(responseCancelled, true);
});

test("caller cancellation fences a pending upstream response without waiting for its body", async () => {
  const pending = deferred();
  const h = harness({ upstream: () => pending.promise });
  const controller = new AbortController();
  const running = h.proxy(request(SOURCE, { signal: controller.signal }));
  await waitFor(() => h.upstream().length === 1);
  controller.abort();
  await expectError(await running, 503, "authorization_unavailable");
  assert.equal(h.upstream()[0].options.signal.aborted, true);
  pending.resolve(jsonResponse());
});

test("per-owner concurrency denial cannot release another live slot and independent owners remain usable", async () => {
  const pending = [];
  const h = harness({
    // This case holds requests to test admission, rather than elapsed time. Use
    // the production ceiling so concurrent crypto/build workers cannot expire it.
    deadlineMs: 12000,
    upstream: () => {
      const reply = deferred();
      pending.push(reply);
      return reply.promise;
    },
  });
  const running = Array.from({ length: 4 }, () => h.proxy(request()));
  await waitFor(() => pending.length === 4);
  for (let i = 0; i < 3; i++)
    await expectError(await h.proxy(request()), 503, "authorization_unavailable");
  assert.equal(pending.length, 4, "denied requests never free somebody else's owner slot");
  const tokenB = await googleToken({ sub: "owner_B" });
  const independent = h.proxy(request(SOURCE, { token: tokenB }));
  await waitFor(() => pending.length === 5);
  pending[0].resolve(jsonResponse());
  // Signature verification can finish in a different order under concurrent
  // crypto tests. The first upstream request need not belong to running[0].
  assert.equal((await Promise.race(running)).status, 200);
  const replacement = h.proxy(request());
  await waitFor(() => pending.length === 6);
  pending.slice(1).forEach((reply) => reply.resolve(jsonResponse()));
  const results = await Promise.all([...running, independent, replacement]);
  assert.ok(results.every((response) => response.status === 200));
});

test("factory global concurrency is bounded at16 and slots are released after requests finish", async () => {
  const pending = [];
  const h = harness({
    deadlineMs: 12000,
    upstream: () => {
      const reply = deferred();
      pending.push(reply);
      return reply.promise;
    },
  });
  const tokens = await Promise.all(
    ["A", "B", "C", "D"].map((owner) => googleToken({ sub: "parallel_" + owner })),
  );
  const running = tokens.flatMap((token) =>
    Array.from({ length: 4 }, () => h.proxy(request(SOURCE, { token }))),
  );
  await waitFor(() => pending.length === 16);
  const calls = h.calls.length;
  await expectError(await h.proxy(request()), 503, "authorization_unavailable");
  assert.equal(h.calls.length, calls);
  pending.forEach((reply) => reply.resolve(jsonResponse()));
  assert.ok((await Promise.all(running)).every((response) => response.status === 200));
  const next = h.proxy(request());
  await waitFor(() => pending.length === 17);
  pending[16].resolve(jsonResponse());
  assert.equal((await next).status, 200);
});

test("owner minute budget limits30 attempts and an idle elapsed window permits another request", async () => {
  let current = NOW;
  const h = harness({ clock: () => current });
  for (let i = 0; i < 30; i++) assert.equal((await h.proxy(request())).status, 200);
  await expectError(await h.proxy(request()), 503, "authorization_unavailable");
  assert.equal(h.upstream().length, 30);
  const tokenB = await googleToken({ sub: "independent_owner" });
  assert.equal((await h.proxy(request(SOURCE, { token: tokenB }))).status, 200);
  current += 60001;
  assert.equal((await h.proxy(request())).status, 200);
  assert.equal(h.upstream().length, 32);
});
