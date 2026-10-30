const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

const CONTRACT = "folioview.agent-workspace.v2.0";
const ORIGIN = "https://agent-hub-api-123456789.northamerica-northeast2.run.app";
const SITE = "https://folioview.example.test",
  PREFIX = "/api/private/agent-hub";
const JWKS =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const NOW = Date.parse("2026-10-30T00:00:00Z");
const ENV = {
  FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID: "fixture-project",
  FOLIOVIEW_HUB_OWNER_ENABLED: "true",
  FOLIOVIEW_HUB_ORIGIN: ORIGIN,
};
const OP = "synthetic_hub_operation_0001",
  AUTHOR = "A".repeat(43);
const SIGNED = { protected: "cHJvdGVjdGVk", payload: "cGF5bG9hZA", signature: "A".repeat(86) };
const CARRIER = { contractVersion: CONTRACT, signedObject: SIGNED };
const REGISTRY = {
  contractVersion: CONTRACT,
  checkpoint: SIGNED,
  entries: [{ certificate: SIGNED, active: true }],
};
const TASK = {
  contractVersion: CONTRACT,
  vaultId: "vault_A",
  taskId: "task_A",
  taskVersion: 1,
  executionEpoch: 1,
  status: "active",
  resourceBindings: [],
  objectRevision: 1,
  deliveryRevision: 1,
  envelopeFingerprint: "a".repeat(64),
  keyEpoch: 1,
  createdAt: "2026-10-30T00:00:00Z",
  updatedAt: "2026-10-30T00:00:00Z",
};
const RESULT = {
  resultId: "result_A",
  taskId: "task_A",
  runId: "run_A",
  revision: 1,
  deliveryRevision: 1,
  envelopeFingerprint: "a".repeat(64),
  connectionId: "connection_A",
  receivedAt: "2026-10-30T00:00:00Z",
  taskVersion: 1,
  stateVersion: 0,
  read: false,
  starred: false,
  archived: false,
  manifestId: "manifest_A",
  keyEpoch: 1,
};
const DESCRIPTOR = {
  objectId: "task_A",
  objectType: "task",
  revision: 1,
  deliveryRevision: 2,
  priorEnvelopeFingerprint: "b".repeat(64),
  resourceRef: null,
  sourceRevision: null,
  sourceEpoch: null,
  producerSnapshotId: null,
  provenance: "task_reshare",
  envelopeFingerprint: "a".repeat(64),
  path: "/agent/v2/preparations/preparation_A/objects/task_A",
};
const STAGE = "/api/v2/agent-connections/connection_A/tasks/task_A/preparation/objects/task_A";
const VAULT = { contractVersion: CONTRACT, vault: null, sources: [] };
let api, caps, common, jose, privateKey, jwk, tokenA;

function compile(name, imports) {
  const { code } = transformSync(
    readFileSync(path.join(__dirname, "../lib/server/" + name + ".ts"), "utf8"),
    {
      filename: name + ".ts",
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" },
    },
  );
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), "Unexpected import " + name);
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
async function token(overrides = {}, key = privateKey) {
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
    .setProtectedHeader({ alg: "RS256", kid: "fixture-google-key" })
    .sign(key);
}
function response(value = VAULT, status = 200, headers = {}) {
  return Response.json(value, { status, headers });
}
function request(
  route = "/api/v2/vaults/current",
  { method = "GET", auth = tokenA, json, raw, headers = {}, signal } = {},
) {
  const body = raw ?? (json === undefined ? undefined : JSON.stringify(json));
  return new Request(SITE + PREFIX + route, {
    method,
    headers: {
      Authorization: "Bearer " + auth,
      "X-FolioView-Contract": CONTRACT,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body, duplex: "half" }),
    ...(signal ? { signal } : {}),
  });
}
function harness({ env = ENV, upstream, jwks, now = () => NOW, deadlineMs = 1000 } = {}) {
  const calls = [];
  const send = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === JWKS) return jwks ? jwks(init) : response({ keys: [jwk] });
    assert.ok(
      url.startsWith(ORIGIN + "/api/v2/"),
      "Hub cannot acquire metadata identity or select a different upstream",
    );
    return upstream ? upstream(url, init) : response();
  };
  return {
    proxy: api.createHubProxy({ env, fetch: send, now, deadlineMs }),
    calls,
    hub: () => calls.filter((c) => c.url.startsWith(ORIGIN)),
    keys: () => calls.filter((c) => c.url === JWKS),
  };
}
async function error(value, status, code) {
  assert.equal(value.status, status);
  assert.equal(value.headers.get("cache-control"), "no-store");
  const body = await value.json();
  assert.equal(body.error.code, code);
  assert.equal(body.error.retryable, status === 503);
  return body;
}
const write = { "Idempotency-Key": OP, "X-FolioView-Author-Key": AUTHOR };
const taskBody = {
  contractVersion: CONTRACT,
  expectedVersion: 0,
  taskId: "task_A",
  resourceBindings: [],
  envelope: CARRIER,
};

test.before(async () => {
  jose = await import("jose");
  const pair = await jose.generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  privateKey = pair.privateKey;
  jwk = {
    ...(await jose.exportJWK(pair.publicKey)),
    kid: "fixture-google-key",
    alg: "RS256",
    use: "sig",
  };
  common = compile("owner-transport", {
    "server-only": {},
    "node:crypto": require("node:crypto"),
    jose,
  });
  const contracts = compile("hub-owner-contracts", {
    "server-only": {},
    "ajv/dist/2020": require("ajv/dist/2020"),
    "ajv-formats": require("ajv-formats"),
    "../encrypted-schemas.json": require("../lib/encrypted-schemas.json"),
    "./owner-transport": common,
  });
  api = compile("hub-owner", {
    "server-only": {},
    "./owner-transport": common,
    "./hub-owner-contracts": contracts,
  });
  const portfolio = compile("portfolio-owner", {
    "server-only": {},
    jose,
    "./owner-transport": common,
  });
  caps = compile("owner-config", {
    "server-only": {},
    "./portfolio-owner": portfolio,
    "./hub-owner": api,
  });
  tokenA = await token();
});

test("Hub capability is independent, fixed canonical HTTPS, and contains only booleans", async () => {
  for (const env of [
    {},
    { ...ENV, FOLIOVIEW_HUB_OWNER_ENABLED: "false" },
    { ...ENV, FOLIOVIEW_HUB_ORIGIN: ORIGIN + "/" },
    { ...ENV, FOLIOVIEW_HUB_ORIGIN: "https://evil.test" },
    { ...ENV, FOLIOVIEW_HUB_ORIGIN: ORIGIN + "/oauth" },
    { ...ENV, FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID: "wrong/project" },
  ]) {
    const h = harness({ env });
    await error(await h.proxy(request()), 503, "authorization_unavailable");
    assert.equal(h.calls.length, 0);
    assert.equal(caps.ownerCapabilities(env).flags.agentHub, false);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(caps.ownerCapabilities(ENV))), {
    schemaVersion: 1,
    flags: { portfolio: false, agentHub: true },
  });
});

test("named owner reads preserve Firebase and strip cookies, identity, delegation, Origin and upstream headers", async () => {
  for (const [route, body] of [
    ["/api/v2/vaults/current", VAULT],
    [
      "/api/v2/tasks?limit=1&cursor=abc_DEF",
      { contractVersion: CONTRACT, items: [], nextCursor: null },
    ],
    [
      "/api/v2/tasks/task_A/versions/50",
      {
        contractVersion: CONTRACT,
        metadata: TASK,
        signedObject: SIGNED,
        keyProofs: { checkpoint: SIGNED, certificates: [SIGNED] },
      },
    ],
    [
      "/api/v2/results?filter=unread&limit=1&taskId=task_A",
      { contractVersion: CONTRACT, items: [RESULT], nextCursor: null },
    ],
    [
      "/api/v2/results/result_A?revision=1&deliveryRevision=1",
      {
        contractVersion: CONTRACT,
        metadata: RESULT,
        signedObject: SIGNED,
        keyProofs: { checkpoint: SIGNED, certificates: [SIGNED] },
      },
    ],
    [
      "/api/v2/results/result_A/revisions?cursor=abc&limit=50",
      { contractVersion: CONTRACT, items: [RESULT], nextCursor: null },
    ],
    ["/api/v2/results/result_A/revisions/32/registries/32", REGISTRY],
    [
      "/api/v2/results/counts?taskId=task_A",
      {
        contractVersion: CONTRACT,
        profile: "folioview.owner-result-counts.v1",
        asOf: "2026-10-30T00:00:00Z",
        counts: { all: 1, unread: 1, starred: 0, archived: 0, total: 1 },
      },
    ],
    [
      "/api/v2/agent-connections",
      { contractVersion: CONTRACT, items: [], authorizationAttempts: [] },
    ],
  ]) {
    const h = harness({
      upstream: () =>
        response(body, 200, {
          "Set-Cookie": "secret=never",
          "X-Debug": "PRIVATE_CANARY",
          Location: "https://evil.test",
        }),
    });
    const result = await h.proxy(
      request(route, {
        headers: {
          Origin: SITE,
          Cookie: "secret=never",
          "X-Serverless-Authorization": "Bearer forged",
          "X-FolioView-Delegation": "forged",
          "X-Owner-Uid": "other",
        },
      }),
    );
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal(await result.text(), JSON.stringify(body));
    assert.equal(result.headers.get("set-cookie"), null);
    assert.equal(result.headers.get("x-debug"), null);
    assert.equal(result.headers.get("location"), null);
    const call = h.hub()[0];
    assert.equal(call.url, ORIGIN + route);
    assert.equal(call.init.headers.get("authorization"), "Bearer " + tokenA);
    assert.deepEqual([...call.init.headers.keys()].sort(), [
      "authorization",
      "x-folioview-contract",
    ]);
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.init.cache, "no-store");
  }
});

test("closed paths, methods and canonical query bounds deny all agent and cookie consent entry points", async () => {
  for (const route of [
    "/oauth/token",
    "/mcp/v2",
    "/.well-known/jwks.json",
    "/internal/v2/source-fences",
    "/agent/v2/runs/run_A",
    "/agent/helper/v1",
    "/api/v2/agent-authorizations/request_A",
    "/api/v2/vaults/current?uid=other",
    "/api/v2/tasks?limit=01",
    "/api/v2/tasks?limit=51",
    "/api/v2/tasks?cursor=a&cursor=b",
    "/api/v2/results?filter=private",
    "/api/v2/results?taskId=bad%0a",
    "/api/v2/results/result_A?revision=33",
    "/api/v2/results/result_A?deliveryRevision=9007199254740992",
    "/api/v2/results/result_A/revisions/01/evidence",
    "/api/v2/results/result_A/revisions/1/registries/33",
    "/api/v2/vaults%2fcurrent",
    "/api/v2/tasks?",
  ]) {
    const h = harness();
    const result = await h.proxy(request(route));
    assert.equal(result.status, 400, route);
    assert.equal(h.calls.length, 0, route);
  }
  for (const key of ["constructor", "toString", "__proto__"]) {
    const inherited = harness();
    await error(
      await inherited.proxy(request(`/api/v2/tasks?${key}=all`)),
      400,
      "unsupported_query",
    );
    assert.equal(inherited.calls.length, 0, key);
  }
  const h = harness();
  await error(
    await h.proxy(request("/api/v2/vaults/current", { headers: { Origin: "https://evil.test" } })),
    403,
    "insufficient_scope",
  );
  assert.equal(h.calls.length, 0);
  for (const action of ["claim", "prepare", "prepare-encrypted", "decision"]) {
    const h = harness();
    assert.equal(
      (
        await h.proxy(
          request("/api/v2/agent-authorizations/request_A/" + action, {
            method: "POST",
            json: { contractVersion: CONTRACT },
          }),
        )
      ).status,
      400,
    );
    assert.equal(h.calls.length, 0);
  }
});

test("signed owner writes and the two bare ACK profiles preserve original bytes without retry", async () => {
  const archive = {
    profile: "folioview.passkey-vault.v1",
    ownerSubject: "owner",
    vaultId: "vault_A",
    rootKeyId: AUTHOR,
    credentialId: "opaque",
    prfSalt: "opaque",
    iv: "opaque",
    ciphertext: "opaque",
  };
  const rootJwk = { kty: "EC", crv: "P-256", x: AUTHOR, y: AUTHOR };
  for (const [route, method, body, headers, result] of [
    [
      "/api/v2/vaults",
      "POST",
      {
        contractVersion: CONTRACT,
        vaultId: "vault_A",
        rootJwk,
        rootKeyId: AUTHOR,
        registryBundle: REGISTRY,
        archive,
      },
      { "Idempotency-Key": OP },
      VAULT,
    ],
    [
      "/api/v2/vaults/vault_A/registry",
      "PUT",
      { contractVersion: CONTRACT, expectedVersion: 1, registryBundle: REGISTRY },
      { "Idempotency-Key": OP },
      VAULT,
    ],
    [
      "/api/v2/vaults/vault_A/holdings-sources/source_A",
      "POST",
      { contractVersion: CONTRACT, command: SIGNED },
      write,
      { contractVersion: CONTRACT, source: { ref: {}, fence: {} } },
    ],
    [
      "/api/v2/vaults/current/authority-token",
      "POST",
      { contractVersion: CONTRACT },
      {},
      { contractVersion: CONTRACT, token: "a.b.c", expiresAt: NOW / 1000 + 60 },
    ],
    [
      "/api/v2/tasks",
      "POST",
      taskBody,
      write,
      {
        contractVersion: CONTRACT,
        metadata: TASK,
        signedObject: SIGNED,
        keyProofs: { checkpoint: SIGNED, certificates: [SIGNED] },
      },
    ],
    [
      "/api/v2/results/result_A/state",
      "PATCH",
      { contractVersion: CONTRACT, command: SIGNED },
      write,
      RESULT,
    ],
    [STAGE, "PUT", { contractVersion: CONTRACT, envelope: CARRIER }, write, DESCRIPTOR],
    [
      "/api/v2/agent-connections/connection_A/tasks/task_A/preparation/commit",
      "POST",
      {
        contractVersion: CONTRACT,
        objects: [{ objectId: "task_A", envelopeFingerprint: "a".repeat(64) }],
      },
      { "Idempotency-Key": OP },
      {
        contractVersion: CONTRACT,
        profile: "folioview.agent-preparation.v1",
        preparationId: "preparation_A",
        status: "committed",
        objects: [DESCRIPTOR],
      },
    ],
    [
      "/api/v2/agent-connections/connection_A/revoke",
      "POST",
      { contractVersion: CONTRACT },
      {},
      { contractVersion: CONTRACT, connection: {} },
    ],
    [
      "/api/v2/agent-connections/connection_A/grants/grant_A/revoke",
      "POST",
      { contractVersion: CONTRACT },
      {},
      { contractVersion: CONTRACT, connection: {} },
    ],
  ]) {
    const raw = JSON.stringify(body, null, 2);
    const h = harness({ upstream: () => response(result) });
    for (let n = 0; n < 2; n++) {
      const reply = await h.proxy(request(route, { method, raw, headers }));
      assert.equal(reply.status, 200, route + (await reply.clone().text()));
      assert.equal(await reply.text(), JSON.stringify(result));
    }
    assert.equal(h.hub().length, 2);
    assert.ok(h.hub().every((call) => new TextDecoder().decode(call.init.body) === raw));
  }
});

test("closed bodies reject private fields, duplicate JSON and over-budget controls before any upstream", async () => {
  for (const json of [
    { ...taskBody, ownerUid: "foreign" },
    { ...taskBody, envelope: { ...CARRIER, plaintext: "PRIVATE_CANARY" } },
    { ...taskBody, expectedVersion: 1.5 },
    { ...taskBody, resourceBindings: [{ ref: { url: "https://evil.test" }, sourceEpoch: 1 }] },
  ]) {
    const h = harness();
    await error(
      await h.proxy(request("/api/v2/tasks", { method: "POST", json, headers: write })),
      400,
      "malformed_request",
    );
    assert.equal(h.calls.length, 0);
  }
  for (const raw of [
    '{"contractVersion":"' + CONTRACT + '","contractVersion":"duplicate","command":{}}',
    " ".repeat(65537),
  ]) {
    const h = harness();
    const result = await h.proxy(
      request("/api/v2/results/result_A/state", { method: "PATCH", raw, headers: write }),
    );
    assert.ok([400, 413].includes(result.status));
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  await error(
    await h.proxy(
      request(STAGE, {
        method: "PUT",
        json: { contractVersion: CONTRACT, envelope: CARRIER },
        headers: { ...write, "X-FolioView-Authority-Delegation": "forged" },
      }),
    ),
    400,
    "malformed_request",
  );
  assert.equal(h.calls.length, 0);
});

test("real Google signature/project/provider/times/UID checks precede Hub access and key faults stay503", async () => {
  const other = await jose.generateKeyPair("RS256", { modulusLength: 2048 });
  for (const auth of [
    await token({}, other.privateKey),
    await token({ aud: "other" }),
    await token({ firebase: { sign_in_provider: "password" } }),
    await token({ sub: 7 }),
    await token({ iat: NOW / 1000 + 1 }),
    await token({ exp: NOW / 1000 - 1 }),
  ]) {
    const h = harness();
    await error(await h.proxy(request(undefined, { auth })), 401, "invalid_token");
    assert.equal(h.hub().length, 0);
  }
  const h = harness({
    jwks: () => {
      throw new Error("PRIVATE_NETWORK_CANARY");
    },
  });
  const reply = await h.proxy(request());
  await error(reply, 503, "authorization_unavailable");
  assert.equal(h.hub().length, 0);
});

test("two verified owners share public JWKS only and preserve their own bearer and result bytes", async () => {
  const tokenB = await token({ sub: "owner_B" });
  const h = harness({
    upstream: (_url, init) =>
      response({
        contractVersion: CONTRACT,
        items: init.headers.get("authorization") === "Bearer " + tokenA ? [RESULT] : [],
        nextCursor: null,
      }),
  });
  const first = await h.proxy(request("/api/v2/results"));
  const second = await h.proxy(request("/api/v2/results", { auth: tokenB }));
  assert.equal((await first.json()).items.length, 1);
  assert.equal((await second.json()).items.length, 0);
  assert.equal(h.keys().length, 1);
  assert.deepEqual(
    h.hub().map((call) => call.init.headers.get("authorization")),
    ["Bearer " + tokenA, "Bearer " + tokenB],
  );
});

test("malformed upstreams, redirects, private diagnostics and false ACKs are fixed503", async () => {
  for (const upstream of [
    () => new Response("PRIVATE_CANARY", { status: 502 }),
    () => response({ contractVersion: CONTRACT, plaintext: "PRIVATE_CANARY" }),
    () => response(VAULT, 302, { Location: "https://evil.test" }),
    () =>
      new Response('{"contractVersion":"' + CONTRACT + '","vault":null,"vault":null,"sources":[]}'),
    () =>
      response(
        { contractVersion: CONTRACT, error: { code: "internal", detail: "PRIVATE_CANARY" } },
        500,
      ),
  ]) {
    const h = harness({ upstream });
    const reply = await h.proxy(request());
    const raw = await reply.clone().text();
    await error(reply, 503, "authorization_unavailable");
    assert.ok(!raw.includes("PRIVATE_CANARY"));
    assert.equal(h.hub().length, 1);
  }
  const h = harness({ upstream: () => response({ ...DESCRIPTOR, privateKey: "PRIVATE_CANARY" }) });
  await error(
    await h.proxy(
      request(STAGE, {
        method: "PUT",
        json: { contractVersion: CONTRACT, envelope: CARRIER },
        headers: write,
      }),
    ),
    503,
    "authorization_unavailable",
  );
});

test("formal Hub401 and conflicts preserve exact application evidence without headers or retry", async () => {
  for (const [status, code] of [
    [401, "invalid_token"],
    [403, "insufficient_scope"],
    [409, "version_conflict"],
    [503, "source_unavailable"],
  ]) {
    const value = {
      contractVersion: CONTRACT,
      error: { code, retryable: status === 503, requestId: "synthetic_request" },
    };
    const raw = JSON.stringify(value);
    const h = harness({
      upstream: () =>
        new Response(raw, {
          status,
          headers: { "Content-Type": "application/json", "Set-Cookie": "bad=never" },
        }),
    });
    const reply = await h.proxy(request());
    assert.equal(reply.status, status);
    assert.equal(await reply.text(), raw);
    assert.equal(reply.headers.get("set-cookie"), null);
    assert.equal(h.hub().length, 1);
  }
});

test("deadline includes upstream body; cancellation and response overrun remain bounded", async () => {
  const h = harness({ deadlineMs: 10, upstream: () => new Promise(() => {}) });
  await error(await h.proxy(request()), 503, "authorization_unavailable");
  const body = harness({
    deadlineMs: 10,
    upstream: () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { "Content-Type": "application/json" },
      }),
  });
  await error(await body.proxy(request()), 503, "authorization_unavailable");
  const controller = new AbortController();
  controller.abort();
  const cancelled = harness();
  await error(
    await cancelled.proxy(request(undefined, { signal: controller.signal })),
    503,
    "authorization_unavailable",
  );
  assert.equal(cancelled.hub().length, 0);
  const over = harness({
    upstream: () =>
      new Response(" ".repeat(1048577), { headers: { "Content-Type": "application/json" } }),
  });
  await error(await over.proxy(request()), 503, "authorization_unavailable");
});

test("owner rate bound is per UID and independent of Portfolio", async () => {
  const h = harness();
  for (let n = 0; n < 30; n++) assert.equal((await h.proxy(request())).status, 200);
  await error(await h.proxy(request()), 503, "authorization_unavailable");
  assert.equal(
    (await h.proxy(request(undefined, { auth: await token({ sub: "owner_B" }) }))).status,
    200,
  );
  assert.equal(h.hub().length, 31);
});
