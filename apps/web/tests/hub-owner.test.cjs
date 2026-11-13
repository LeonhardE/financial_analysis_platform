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
const LIFECYCLE = "folioview.vault-lifecycle.v1";
const ARCHIVE = {
  profile: "folioview.passkey-vault.v1",
  ownerSubject: "a".repeat(64),
  vaultId: "vault_A",
  rootKeyId: AUTHOR,
  credentialId: Buffer.from("synthetic_credential").toString("base64url"),
  prfSalt: Buffer.alloc(32, 1).toString("base64url"),
  iv: Buffer.alloc(12, 2).toString("base64url"),
  ciphertext: Buffer.alloc(64, 3).toString("base64url"),
};
function lifecycleReceipt(action = "archive_replace", extra = {}) {
  return {
    profile: LIFECYCLE,
    ownerSubject: ARCHIVE.ownerSubject,
    vaultId: ARCHIVE.vaultId,
    rootKeyId: AUTHOR,
    operationId: OP,
    action,
    lifecycleVersion: 1,
    archiveRevision: action === "archive_replace" ? 1 : 0,
    archiveDigest: "b".repeat(64),
    commandFingerprint: "c".repeat(64),
    acceptedAt: NOW / 1000,
    ...extra,
  };
}
function lifecycleAck(action = "archive_replace", extra = {}) {
  return {
    contractVersion: CONTRACT,
    profile: LIFECYCLE,
    receipt: lifecycleReceipt(action, extra),
  };
}
function lifecycleState(extra = {}) {
  return {
    contractVersion: CONTRACT,
    profile: LIFECYCLE,
    vaultId: ARCHIVE.vaultId,
    rootKeyId: AUTHOR,
    vaultVersion: 1,
    registrySequence: 1,
    checkpointDigest: "d".repeat(64),
    keyEpoch: 1,
    lifecycleVersion: 0,
    archiveRevision: 0,
    archiveDigest: "b".repeat(64),
    archive: ARCHIVE,
    pendingAuthorization: null,
    history: [],
    ...extra,
  };
}
let api, caps, common, jose, privateKey, jwk, tokenA, hubImports;

function compile(name, imports, globals = {}) {
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
    Buffer,
    AbortSignal,
    AbortController,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
    ...globals,
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
  { method = "GET", auth = tokenA, json, raw, headers = {}, signal, site = SITE } = {},
) {
  const body = raw ?? (json === undefined ? undefined : JSON.stringify(json));
  return new Request(site + PREFIX + route, {
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
      url.startsWith(ORIGIN + "/api/v2/") || url.startsWith(ORIGIN + "/api/v3/agent-credentials/"),
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

function savedTaskOperation(operation = OP, taskId = "task_A") {
  return {
    contractVersion: CONTRACT,
    metadata: { ...TASK, taskId },
    signedObject: {
      ...SIGNED,
      payload: Buffer.from(
        JSON.stringify({ context: { objectId: taskId, stableOperationId: operation } }),
      ).toString("base64url"),
    },
    keyProofs: { checkpoint: SIGNED, certificates: [SIGNED] },
  };
}

test("task operation reads use the fixed owner route, including leading underscore and dash operation identifiers", async () => {
  for (const operation of [OP, "_" + "a".repeat(21), "-" + "b".repeat(127)]) {
    const route = `/api/v2/tasks/task_A/operations/${operation}`;
    const original = savedTaskOperation(operation);
    const h = harness({ upstream: () => response(original) });
    const result = await h.proxy(request(route));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), original);
    assert.equal(h.hub()[0].url, ORIGIN + route);
    assert.equal(h.hub()[0].init.method, "GET");
    assert.deepEqual([...h.hub()[0].init.headers.keys()].sort(), [
      "authorization",
      "x-folioview-contract",
    ]);
  }
});

test("task original-operation reads reject selector headers, queries, alternate methods and malformed IDs before upstream access", async () => {
  const route = `/api/v2/tasks/task_A/operations/${OP}`;
  for (const headers of [
    { "Idempotency-Key": OP },
    { "X-FolioView-Author-Key": AUTHOR },
    { "X-FolioView-Delegation": "synthetic" },
    { "X-Serverless-Authorization": "Bearer synthetic" },
    { "X-FolioView-Contract": CONTRACT + "," + CONTRACT },
  ]) {
    const h = harness();
    const result = await h.proxy(request(route, { headers }));
    assert.equal(
      result.status,
      400 + (headers["X-FolioView-Delegation"] || headers["X-Serverless-Authorization"] ? 3 : 0),
    );
    assert.equal(h.calls.length, 0);
  }
  for (const path of [
    route + "?owner=other",
    route + "?",
    route + "/synchronize",
    route.replace(OP, "x".repeat(21)),
    route.replace(OP, "x".repeat(129)),
    route.replace("task_A", "bad%2Ftask"),
  ]) {
    const h = harness();
    const result = await h.proxy(request(path));
    assert.equal(result.status, 400);
    assert.equal(h.calls.length, 0);
  }
  for (const method of ["POST", "PUT", "DELETE"]) {
    const h = harness();
    assert.equal((await h.proxy(request(route, { method }))).status, 400);
    assert.equal(h.calls.length, 0);
  }
});

test("task-operation responses are closed, path-bound and never replace missing evidence with a latest task", async () => {
  const route = `/api/v2/tasks/task_A/operations/${OP}`;
  for (const value of [
    savedTaskOperation("another_synthetic_operation_0001"),
    savedTaskOperation(OP, "task_B"),
    { ...savedTaskOperation(), privateTitle: "synthetic-private-canary" },
    { ...savedTaskOperation(), signedObject: SIGNED },
  ]) {
    const h = harness({ upstream: () => response(value) });
    const result = await h.proxy(request(route));
    await error(result, 503, "authorization_unavailable");
    assert.equal(h.hub().length, 1);
  }
  const missing = {
    contractVersion: CONTRACT,
    error: { code: "not_found", retryable: false, requestId: "synthetic_request" },
  };
  const h = harness({ upstream: () => response(missing, 404) });
  const result = await h.proxy(request(route));
  assert.equal(result.status, 404);
  assert.equal(h.hub().length, 1);
  assert.equal(h.hub()[0].url, ORIGIN + route);
});

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
  const cancellation = compile("upload-cancellation", {
    "server-only": {},
    "node:crypto": require("node:crypto"),
    "./owner-transport": common,
  });
  const contracts = compile("hub-owner-contracts", {
    "server-only": {},
    "ajv/dist/2020": require("ajv/dist/2020"),
    "ajv-formats": require("ajv-formats"),
    "../encrypted-schemas.json": require("../lib/encrypted-schemas.json"),
    "./owner-transport": common,
  });
  const persistentRoutes = compile("../persistent-owner-routes", {});
  const persistentContracts = compile("persistent-owner-contracts", {
    "server-only": {},
    "ajv/dist/2020": require("ajv/dist/2020"),
    "ajv-formats": require("ajv-formats"),
    "../../../../packages/encrypted-workspace/schemas.json": require("../../../packages/encrypted-workspace/schemas.json"),
    "./owner-transport": common,
  });
  hubImports = {
    "../persistent-owner-routes": persistentRoutes,
    "./persistent-owner-contracts": persistentContracts,
    "./upload-cancellation": cancellation,
    "server-only": {},
    "./owner-transport": common,
    "./hub-owner-contracts": contracts,
    "./task-center-owner": compile("task-center-owner", {
      "../persistent-owner-routes": persistentRoutes,
      "server-only": {},
      "./owner-transport": common,
    }),
  };
  api = compile("hub-owner", hubImports);
  const portfolio = compile("portfolio-owner", {
    "./upload-cancellation": cancellation,
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
      "/api/v2/agent-capabilities",
      {
        contractVersion: CONTRACT,
        profile: "folioview.owner-agent-capabilities.v1",
        ownerConnections: true,
        museConnectionEnabled: false,
      },
    ],
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

test("same-origin browser writes use the public Host behind a standalone container", async () => {
  const raw = JSON.stringify({
    contractVersion: CONTRACT,
    vaultId: "vault_A",
    rootJwk: { kty: "EC", crv: "P-256", x: AUTHOR, y: AUTHOR },
    rootKeyId: AUTHOR,
    registryBundle: REGISTRY,
    archive: ARCHIVE,
  });
  for (const host of [new URL(SITE).host, new URL(SITE).host + ":443"]) {
    const h = harness();
    const result = await h.proxy(
      request("/api/v2/vaults", {
        method: "POST",
        raw,
        site: "https://0.0.0.0:8080",
        headers: {
          "Idempotency-Key": OP,
          Host: host,
          Origin: SITE,
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": "evil.test",
        },
      }),
    );
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal(new TextDecoder().decode(h.hub()[0].init.body), raw);
    for (const name of ["host", "origin", "x-forwarded-host"])
      assert.equal(h.hub()[0].init.headers.has(name), false);
  }
});

test("public Host origin checks reject cross-origin, ambiguous hosts and forwarded-host spoofing before authentication", async () => {
  const publicHost = new URL(SITE).host;
  for (const headers of [
    { Host: publicHost, Origin: "https://evil.test", "X-Forwarded-Host": "evil.test" },
    { Host: publicHost, Origin: "https://0.0.0.0:8080" },
    { Host: publicHost, Origin: SITE.replace("https:", "http:") },
    { Host: publicHost, Origin: SITE + ":8443" },
    { Host: publicHost, Origin: "null" },
    { Host: publicHost, Origin: "" },
    { Host: publicHost, Origin: SITE, "Sec-Fetch-Site": "cross-site" },
    ...[
      "",
      publicHost + ", evil.test",
      publicHost + "/ignored",
      "user@" + publicHost,
      publicHost + "#ignored",
      publicHost + "%2f",
      publicHost + ":99999",
    ].map((Host) => ({ Host, Origin: SITE })),
  ]) {
    const h = harness();
    await error(
      await h.proxy(
        request("/api/v2/tasks", {
          method: "POST",
          site: "https://0.0.0.0:8080",
          headers,
          json: taskBody,
        }),
      ),
      403,
      "insufficient_scope",
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
  const timedOut = await h.proxy(request());
  assert.equal(timedOut.headers.get("x-folioview-read-failure"), "deadline");
  await error(timedOut, 503, "authorization_unavailable");
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
  const cancelledReply = await cancelled.proxy(request(undefined, { signal: controller.signal }));
  assert.equal(cancelledReply.headers.get("x-folioview-read-failure"), null);
  await error(cancelledReply, 503, "authorization_unavailable");
  assert.equal(cancelled.hub().length, 0);
  const over = harness({
    upstream: () =>
      new Response(" ".repeat(1048577), { headers: { "Content-Type": "application/json" } }),
  });
  await error(await over.proxy(request()), 503, "authorization_unavailable");
});

test("owner rate bound is per UID and independent of Portfolio", async () => {
  let now = NOW;
  const h = harness({ now: () => now });
  for (let n = 0; n < 30; n++) assert.equal((await h.proxy(request())).status, 200);
  const blocked = await h.proxy(request());
  assert.equal(blocked.headers.get("retry-after"), "60");
  assert.equal(blocked.headers.get("x-folioview-admission-retry"), "safe");
  await error(blocked, 503, "authorization_unavailable");
  assert.equal(h.hub().length, 30);
  now += 30000;
  const stillBlocked = await h.proxy(request());
  assert.equal(stillBlocked.headers.get("retry-after"), "30");
  await error(stillBlocked, 503, "authorization_unavailable");
  assert.equal(h.hub().length, 30);
  assert.equal(
    (await h.proxy(request(undefined, { auth: await token({ sub: "owner_B" }) }))).status,
    200,
  );
  assert.equal(h.hub().length, 31);
  now += 30000;
  const resumed = await h.proxy(request());
  assert.equal(resumed.status, 200);
  assert.equal(resumed.headers.get("x-folioview-admission-retry"), null);
  assert.equal(h.hub().length, 32);
});

test("upstream errors cannot forge a safe pre-forward admission retry", async () => {
  const h = harness({
    upstream: () =>
      response(
        {
          contractVersion: CONTRACT,
          error: { code: "source_unavailable", retryable: true, requestId: "synthetic_request" },
        },
        503,
        {
          "X-FolioView-Admission-Retry": "safe",
          "Retry-After": "60",
          "X-FolioView-Read-Failure": "deadline",
        },
      ),
  });
  const reply = await h.proxy(request());
  assert.equal(reply.headers.get("x-folioview-admission-retry"), null);
  assert.equal(reply.headers.get("x-folioview-read-failure"), null);
  assert.equal(reply.headers.get("retry-after"), null);
  await error(reply, 503, "source_unavailable");
  assert.equal(h.hub().length, 1);
});

test("connection attempt count matches the existing bounded 64-attempt producer", async () => {
  for (const count of [33, 64]) {
    const h = harness({
      upstream: () =>
        response({
          contractVersion: CONTRACT,
          items: [],
          authorizationAttempts: Array.from({ length: count }, (_, index) => ({
            requestId: `request_${index}`,
          })),
        }),
    });
    assert.equal((await h.proxy(request("/api/v2/agent-connections"))).status, 200);
  }
  const h = harness({
    upstream: () =>
      response({
        contractVersion: CONTRACT,
        items: [],
        authorizationAttempts: Array.from({ length: 65 }, (_, index) => ({
          requestId: `request_${index}`,
        })),
      }),
  });
  await error(
    await h.proxy(request("/api/v2/agent-connections")),
    503,
    "authorization_unavailable",
  );
});

test("vault lifecycle uses only its named owner routes and preserves original operation bytes", async () => {
  const base = "/api/v2/vaults/vault_A";
  const authorization = lifecycleReceipt("recovery_authorize");
  const pending = {
    authorizationId: "authorization_A",
    newArchiveDigest: "e".repeat(64),
    expiresAt: NOW / 1000 + 120,
    status: "active",
    command: SIGNED,
  };
  for (const [route, method, json, result, status] of [
    [base + "/archive", "GET", undefined, lifecycleState(), 200],
    [
      base + "/archive",
      "GET",
      undefined,
      lifecycleState({
        lifecycleVersion: 1,
        pendingAuthorization: pending,
        history: [{ command: SIGNED, receipt: authorization }],
      }),
      200,
    ],
    [base + "/archive-operations/" + OP, "GET", undefined, lifecycleAck(), 200],
    [
      base + "/archive",
      "PUT",
      { contractVersion: CONTRACT, archive: ARCHIVE, command: SIGNED },
      lifecycleAck(),
      200,
    ],
    [
      base + "/recovery-authorizations",
      "POST",
      { contractVersion: CONTRACT, command: SIGNED },
      lifecycleAck("recovery_authorize"),
      201,
    ],
    [
      base + "/recovery-authorizations/authorization_A/revoke",
      "POST",
      { contractVersion: CONTRACT, command: SIGNED },
      lifecycleAck("recovery_revoke"),
      200,
    ],
  ]) {
    const h = harness({ upstream: () => response(result, status) });
    const raw = json && JSON.stringify(json, null, 2);
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await h.proxy(
        request(route, {
          method,
          raw,
          headers: {
            ...(method === "GET" ? {} : { "Idempotency-Key": OP }),
            Cookie: "local=never-forwarded",
            "X-FolioView-Owner": "never-forwarded",
            Origin: SITE,
          },
        }),
      );
      assert.equal(reply.status, status, route + (await reply.clone().text()));
      assert.equal(reply.headers.get("cache-control"), "no-store");
      assert.equal(await reply.text(), JSON.stringify(result));
    }
    assert.equal(h.hub().length, 2);
    for (const call of h.hub()) {
      assert.equal(call.url, ORIGIN + route);
      assert.equal(call.init.headers.get("authorization"), "Bearer " + tokenA);
      assert.equal(call.init.headers.get("x-folioview-contract"), CONTRACT);
      assert.equal(call.init.headers.get("x-folioview-author-key"), null);
      assert.equal(call.init.headers.get("cookie"), null);
      assert.equal(call.init.headers.get("x-folioview-owner"), null);
      assert.equal(call.init.headers.get("origin"), null);
      assert.equal(call.init.credentials, "omit");
      assert.equal(
        call.init.body === undefined ? undefined : new TextDecoder().decode(call.init.body),
        raw,
      );
    }
  }
});

test("lifecycle requests reject selectors, author overrides, malformed ciphertext and command budgets before upstream", async () => {
  const base = "/api/v2/vaults/vault_A";
  const body = { contractVersion: CONTRACT, archive: ARCHIVE, command: SIGNED };
  const controls = { contractVersion: CONTRACT, command: SIGNED };
  for (const [route, options, status = 400, code = "malformed_request"] of [
    [base + "/archive?owner=other", {}, 400, "unsupported_query"],
    [base + "/archive?", {}, 400, "unsupported_query"],
    [base + "/archive-operations/short", {}],
    [base + "/archive-operations/" + OP + "/extra", {}],
    [base + "/archive", { method: "POST", json: body }],
    [base + "/recovery-authorizations", { method: "GET" }],
    [base + "/recovery-authorizations/authorization_A", { method: "DELETE" }],
    [base + "/archive", { method: "PUT", json: body }],
    [base + "/archive", { method: "PUT", json: body, headers: write }],
    [
      base + "/archive",
      {
        method: "PUT",
        json: { ...body, privateKey: "PRIVATE_CANARY" },
        headers: { "Idempotency-Key": OP },
      },
    ],
    ...[
      { ...ARCHIVE, vaultId: "vault_B" },
      { ...ARCHIVE, plaintext: "PRIVATE_CANARY" },
      { ...ARCHIVE, ownerSubject: "not-a-hash" },
      { ...ARCHIVE, rootKeyId: "A".repeat(42) + "B" },
      { ...ARCHIVE, credentialId: "" },
      { ...ARCHIVE, credentialId: Buffer.alloc(1537).toString("base64url") },
      { ...ARCHIVE, prfSalt: "A".repeat(42) + "B" },
      { ...ARCHIVE, iv: Buffer.alloc(11).toString("base64url") },
      { ...ARCHIVE, ciphertext: Buffer.alloc(15).toString("base64url") },
    ].map((archive) => [
      base + "/archive",
      { method: "PUT", json: { ...body, archive }, headers: { "Idempotency-Key": OP } },
    ]),
    [
      base + "/archive",
      {
        method: "PUT",
        json: { ...body, command: { ...SIGNED, payload: "A".repeat(8200) } },
        headers: { "Idempotency-Key": OP },
      },
    ],
    [
      base + "/archive",
      { method: "PUT", raw: " ".repeat(65537), headers: { "Idempotency-Key": OP } },
      413,
      "payload_too_large",
    ],
    [
      base + "/recovery-authorizations",
      {
        method: "POST",
        json: { ...controls, ownerSubject: ARCHIVE.ownerSubject },
        headers: { "Idempotency-Key": OP },
      },
    ],
    [
      base + "/recovery-authorizations/authorization_A/revoke",
      { method: "POST", json: controls, headers: write },
    ],
    [
      base + "/recovery-authorizations",
      { method: "POST", raw: " ".repeat(8193), headers: { "Idempotency-Key": OP } },
      413,
      "payload_too_large",
    ],
  ]) {
    const h = harness();
    await error(await h.proxy(request(route, options)), status, code);
    assert.equal(h.calls.length, 0, route);
  }
});

test("lifecycle responses are closed, bounded, bound to their route and never accept legacy aggregates as receipts", async () => {
  const base = "/api/v2/vaults/vault_A";
  const receipt = lifecycleReceipt();
  const state = lifecycleState({
    lifecycleVersion: 1,
    archiveRevision: 1,
    history: [{ command: SIGNED, receipt }],
  });
  for (const [route, method, body] of [
    [base + "/archive", "GET", VAULT],
    [base + "/archive", "GET", { ...state, plaintext: "PRIVATE_CANARY" }],
    [base + "/archive", "GET", { ...state, vaultId: "vault_B" }],
    [base + "/archive", "GET", { ...state, archive: { ...ARCHIVE, rootKeyId: "B".repeat(43) } }],
    [base + "/archive", "GET", { ...state, lifecycleVersion: true }],
    [base + "/archive", "GET", { ...state, lifecycleVersion: 2 }],
    [base + "/archive", "GET", { ...state, archiveRevision: 2 }],
    [
      base + "/archive",
      "GET",
      {
        ...state,
        history: [{ command: SIGNED, receipt: { ...receipt, privateKey: "PRIVATE_CANARY" } }],
      },
    ],
    [
      base + "/archive",
      "GET",
      {
        ...state,
        history: [{ command: SIGNED, receipt: { ...receipt, ownerSubject: "e".repeat(64) } }],
      },
    ],
    [
      base + "/archive",
      "GET",
      {
        ...state,
        history: [{ command: SIGNED, receipt: { ...receipt, archiveDigest: "e".repeat(64) } }],
      },
    ],
    [
      base + "/archive",
      "GET",
      { ...state, lifecycleVersion: 33, history: Array(33).fill({ command: SIGNED, receipt }) },
    ],
    [
      base + "/archive",
      "GET",
      {
        ...state,
        pendingAuthorization: {
          authorizationId: "authorization_A",
          newArchiveDigest: "e".repeat(64),
          expiresAt: 1,
          status: "approved",
          command: SIGNED,
        },
      },
    ],
    [
      base + "/archive-operations/" + OP,
      "GET",
      lifecycleAck("archive_replace", { operationId: OP + "other" }),
    ],
    [
      base + "/archive-operations/" + OP,
      "GET",
      lifecycleAck("archive_replace", { vaultId: "vault_B" }),
    ],
    [
      base + "/archive-operations/" + OP,
      "GET",
      lifecycleAck("archive_replace", { lifecycleVersion: 33 }),
    ],
    [
      base + "/archive-operations/" + OP,
      "GET",
      { ...lifecycleAck(), privateKey: "PRIVATE_CANARY" },
    ],
    [base + "/archive", "PUT", lifecycleAck("recovery_authorize")],
    [base + "/recovery-authorizations", "POST", lifecycleAck("archive_replace")],
    [
      base + "/recovery-authorizations/authorization_A/revoke",
      "POST",
      lifecycleAck("recovery_authorize"),
    ],
  ]) {
    const h = harness({ upstream: () => response(body) });
    const reply = await h.proxy(
      request(route, {
        method,
        ...(method === "GET"
          ? {}
          : {
              json: {
                contractVersion: CONTRACT,
                ...(method === "PUT" ? { archive: ARCHIVE } : {}),
                command: SIGNED,
              },
              headers: { "Idempotency-Key": OP },
            }),
      }),
    );
    const raw = await reply.clone().text();
    await error(reply, 503, "authorization_unavailable");
    assert.ok(!raw.includes("PRIVATE_CANARY"));
    assert.equal(h.hub().length, 1);
  }
});

test("capabilities are read-only, closed and do not forward private fields or false rollout claims", async () => {
  const base = {
    contractVersion: CONTRACT,
    profile: "folioview.owner-agent-capabilities.v1",
    ownerConnections: true,
    museConnectionEnabled: false,
  };
  for (const patch of [
    { museConnectionEnabled: "true" },
    { ownerConnections: false },
    { profile: "other" },
    { secret: "PRIVATE_CANARY" },
  ]) {
    const h = harness({ upstream: () => response({ ...base, ...patch }) });
    const r = await h.proxy(request("/api/v2/agent-capabilities"));
    await error(r, 503, "authorization_unavailable");
  }
  for (const req of [
    request("/api/v2/agent-capabilities", { method: "POST", json: { contractVersion: CONTRACT } }),
    request("/api/v2/agent-capabilities?enabled=true"),
  ]) {
    const h = harness();
    const r = await h.proxy(req);
    assert.equal(r.status, 400);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ upstream: () => response(base, 201) });
  await error(
    await h.proxy(request("/api/v2/agent-capabilities")),
    503,
    "authorization_unavailable",
  );
});

test("Root upload cancellation POST/GET keeps the exact profile and rejects selectors or mismatched receipts", async () => {
  const fixture = require("./upload-cancellation-fixture.cjs")("task", "task_A"),
    base = "/api/v2/tasks/task_A/operation-cancellations",
    write = { method: "POST", json: fixture.body, headers: { "Idempotency-Key": fixture.id } };
  const h = harness({ upstream: () => Response.json(fixture.response) });
  for (const [route, opts] of [
    [base, write],
    [base + "/" + fixture.id, {}],
  ]) {
    const reply = await h.proxy(request(route, opts));
    assert.equal(reply.status, 200, await reply.clone().text());
    assert.deepEqual(await reply.json(), fixture.response);
  }
  const upstream = h.hub()[0],
    headers = new Headers(upstream.init.headers);
  assert.equal(headers.has("x-folioview-author-key"), false);
  assert.equal(headers.has("x-folioview-authority-delegation"), false);
  assert.equal(headers.has("x-serverless-authorization"), false);
  for (const [route, options] of [
    [base + "?owner=other", write],
    ...[
      "X-FolioView-Author-Key",
      "X-FolioView-Authority-Delegation",
      "X-Serverless-Authorization",
    ].map((k) => [base, { ...write, headers: { ...write.headers, [k]: "forged" } }]),
    [base, { ...write, json: { ...fixture.body, ownerSubject: "chosen" } }],
    [base, { ...write, headers: { "Idempotency-Key": fixture.id + "_different" } }],
  ]) {
    const denied = harness();
    const result = await denied.proxy(request(route, options));
    assert.ok([400, 403, 404, 405].includes(result.status), await result.clone().text());
    assert.equal(denied.hub().length, 0);
  }
  for (const change of [
    (v) => (v.receipt.target.operationId = "wrong"),
    (v) => (v.receipt.cancellationId = "synthetic_other_cancellation_1"),
    (v) => (v.receipt.commandFingerprint = "0".repeat(64)),
    (v) => (v.receipt.extra = "PRIVATE_CANARY"),
    (v) => (v.profile = "wrong"),
  ]) {
    const value = structuredClone(fixture.response);
    change(value);
    const bad = harness({ upstream: () => Response.json(value) });
    const reply = await bad.proxy(request(base + "/" + fixture.id));
    assert.equal(reply.status, 503);
    assert.ok(!(await reply.text()).includes("PRIVATE_CANARY"));
  }
});

test("persistent owner routes exclude cookie OAuth approvals and arbitrary Agent transports", async () => {
  const auth = await token();
  for (const route of [
    "/api/v2/persistent-account-authorizations/request_A/approvals",
    "/api/v2/persistent-account-authorizations/request_A/pending",
    "/agent/v3/persistent/owners/owner_A/vaults/vault_A/connections/connection_A/tasks",
    "/api/v2/persistent-agents/vault_A/connection_A/sign",
  ]) {
    const h = harness();
    const r = await h.proxy(
      request(route, { method: "POST", auth, json: { contractVersion: CONTRACT } }),
    );
    assert.equal(r.status, 400, route);
    assert.equal(h.calls.length, 0);
  }
});
test("persistent list uses its bounded opaque pagination and rejects plaintext upstream fields", async () => {
  const auth = await token();
  const body = {
    contractVersion: CONTRACT,
    profile: "folioview.persistent-content.v1",
    items: [],
    nextCursor: null,
  };
  const route =
    "/api/v2/persistent-results/vault_A?cursor=" +
    encodeURIComponent("a".repeat(43) + ":20") +
    "&limit=20";
  const h = harness({ upstream: () => response(body) });
  assert.equal((await h.proxy(request(route, { auth }))).status, 200);
  assert.equal(h.hub().length, 1);
  for (const cursor of ["../other", "a:20", "a".repeat(43) + ":0", "a".repeat(43) + ":1000"]) {
    const x = harness();
    assert.equal(
      (
        await x.proxy(
          request("/api/v2/persistent-results/vault_A?cursor=" + encodeURIComponent(cursor), {
            auth,
          }),
        )
      ).status,
      400,
    );
    assert.equal(x.calls.length, 0);
  }
  const x = harness({ upstream: () => response({ ...body, plaintext: "CANARY" }) });
  const r = await x.proxy(request("/api/v2/persistent-results/vault_A", { auth }));
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /CANARY/);
});

test("retired executor and browser pairing routes are refused before any upstream request", async () => {
  for (const [path, method] of [
    ["/api/v2/executor-connections/vault_A/connection_A/bindings", "POST"],
    ["/api/v2/executor-connections/vault_A/connection_A", "GET"],
    ["/api/v2/runtime-setups/setup_A", "GET"],
    ["/api/v2/runtime-setups/setup_A/completion", "POST"],
    ["/api/v2/persistent-agents/vault_A/connection_A/bindings", "POST"],
  ]) {
    const h = harness();
    const r = await h.proxy(
      request(path, {
        method,
        ...(method === "POST"
          ? {
              json: { contractVersion: CONTRACT },
              headers: { Origin: SITE, "Idempotency-Key": OP },
            }
          : {}),
      }),
    );
    assert.equal(r.status, 400);
    assert.equal(h.hub().length, 0);
  }
});

test("Agent credential Owner routes preserve opaque activation, fixed namespace and strict packets", async () => {
  const capsValue = {
    contractVersion: CONTRACT,
    profile: "folioview.agent-credential.v1",
    enabled: true,
    defaultValiditySeconds: 7776000,
    noticeSeconds: 604800,
  };
  const state = {
    ...capsValue,
    identity: null,
    binding: null,
    lease: null,
    approval: null,
    status: "reauthorization_required",
  };
  delete state.enabled;
  const base = "/api/v3/agent-credentials/vault_A/connection_A";
  const h = harness({ upstream: () => response(state) });
  assert.equal((await h.proxy(request(base))).status, 200);
  const packet = { version: 1, iv: "A".repeat(16), ciphertext: "A".repeat(43) };
  const command = { binding: SIGNED, approval: SIGNED, activation: packet };
  for (const bad of [
    { contractVersion: CONTRACT, command: { ...command, privateKey: "DO_NOT_EXPOSE" } },
    {
      contractVersion: CONTRACT,
      command: { ...command, activation: { ...packet, secret: "DO_NOT_EXPOSE" } },
    },
  ]) {
    const value = await h.proxy(
      request(base + "/approvals", {
        method: "POST",
        json: bad,
        headers: { "Idempotency-Key": OP },
      }),
    );
    assert.equal(value.status, 400);
    assert.equal((await value.text()).includes("DO_NOT_EXPOSE"), false);
  }
  assert.equal(h.hub().length, 1);
  assert.equal((await h.proxy(request(base + "?owner=other"))).status, 400);
  const setup = {
    setupIntentId: OP,
    ownerSubject: "a".repeat(64),
    vaultId: "vault_A",
    connectionId: "connection_A",
    clientId: "chatgpt_A",
    authorizationId: "auth_A",
    issuedAt: 1000,
    expiresAt: 1600,
    expectedGeneration: 0,
    expectedCredentialFingerprint: null,
    offer: packet,
    consumedBy: null,
    issuer: ORIGIN,
    provider: "chatgpt",
    predecessorConnectionId: null,
  };
  const read = harness({ upstream: () => response(setup) });
  assert.equal((await read.proxy(request(base + "/setups/" + OP))).status, 200);
  const wrong = harness({ upstream: () => response({ ...setup, connectionId: "other" }) });
  assert.equal((await wrong.proxy(request(base + "/setups/" + OP))).status, 503);
});

test(
  "the unchanged 12-second proxy deadline wins over a non-cooperative late Hub success",
  { timeout: 10000 },
  async () => {
    const timers = new Map();
    let finish,
      reached,
      forwarded = 0;
    const forwarding = new Promise((resolve) => {
      reached = resolve;
    });
    const late = new Promise((resolve) => {
      finish = resolve;
    });
    const clocked = compile("hub-owner", hubImports, {
      setTimeout(callback, delay) {
        const id = {};
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    });
    const proxy = clocked.createHubProxy({
      env: ENV,
      now: () => NOW,
      fetch: async (url) => {
        if (url === JWKS) return response({ keys: [jwk] });
        forwarded++;
        reached();
        return late;
      },
    });
    const pending = proxy(request());
    await Promise.race([
      forwarding,
      pending.then(() => assert.fail("proxy completed before reaching Hub")),
    ]);
    assert.equal(forwarded, 1);
    const deadline = [...timers.values()].find((entry) => entry.delay === 12000);
    assert.ok(deadline, "production deadline remains 12 seconds");
    deadline.callback();
    const reply = await pending;
    assert.equal(reply.headers.get("x-folioview-read-failure"), "deadline");
    assert.equal(reply.headers.get("x-folioview-admission-retry"), null);
    await error(reply, 503, "authorization_unavailable");
    finish(response());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reply.status, 503);
    assert.equal(forwarded, 1);
    assert.equal(timers.size, 0);
  },
);
