const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

const CONTRACT = "folioview.agent-workspace.v2.0";
const PROFILE = "folioview.vault-key-renewal.v1";
const SITE = "https://folioview.example.test";
const ORIGIN = "https://agent-hub-api-123456789.northamerica-northeast2.run.app";
const PREFIX = "/api/private/agent-hub";
const BASE = "/api/v2/vaults/vault_A";
const OP = "synthetic_renewal_operation_0001";
const JWKS =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const NOW = Date.parse("2026-10-30T00:00:00Z");
const ENV = {
  FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID: "fixture-project",
  FOLIOVIEW_HUB_OWNER_ENABLED: "true",
  FOLIOVIEW_HUB_ORIGIN: ORIGIN,
};
const binary = (bytes, value = 0) => Buffer.alloc(bytes, value).toString("base64url");
const SIGNED = {
  protected: Buffer.from('{"alg":"ES256","typ":"fv-control+jws","kid":"synthetic"}').toString(
    "base64url",
  ),
  payload: Buffer.from('{"synthetic":"opaque-command"}').toString("base64url"),
  signature: binary(64),
};
const ARCHIVE = {
  profile: "folioview.passkey-vault.v1",
  ownerSubject: "a".repeat(64),
  vaultId: "vault_A",
  rootKeyId: binary(32),
  credentialId: binary(32, 1),
  prfSalt: binary(32, 2),
  iv: binary(12, 3),
  ciphertext: binary(64, 4),
};
const BODY = {
  contractVersion: CONTRACT,
  registryBundle: {
    contractVersion: CONTRACT,
    checkpoint: SIGNED,
    entries: [{ certificate: SIGNED, active: true }],
  },
  archive: ARCHIVE,
  command: SIGNED,
  archiveCommand: SIGNED,
};
const ROLES = ["device_enc", "device_sig", "recovery_enc"];
const RENEWALS = ROLES.map((role, index) => ({
  role,
  principalId: role === "recovery_enc" ? "recovery_A" : "device_A",
  priorKeyId: binary(32, index + 1),
  newKeyId: binary(32, index + 11),
  priorKeyEpoch: 1,
  newKeyEpoch: 2,
}));
function state(extra = {}) {
  return {
    contractVersion: CONTRACT,
    profile: PROFILE,
    vaultId: ARCHIVE.vaultId,
    rootKeyId: ARCHIVE.rootKeyId,
    rootAnchorExpiresAt: null,
    vaultVersion: 1,
    registrySequence: 1,
    checkpointDigest: "a".repeat(64),
    keyEpoch: 1,
    lifecycleVersion: 0,
    archiveRevision: 0,
    archiveDigest: "b".repeat(64),
    pendingRecoveryAuthorization: false,
    certificates: RENEWALS.map((item) => ({
      keyId: item.priorKeyId,
      role: item.role,
      principalId: item.principalId,
      keyEpoch: 1,
      notBefore: 100,
      expiresAt: 200,
      status: "expired",
    })),
    ...extra,
  };
}
function ack(extra = {}) {
  return {
    contractVersion: CONTRACT,
    profile: PROFILE,
    receipt: {
      profile: PROFILE,
      ownerSubject: ARCHIVE.ownerSubject,
      vaultId: ARCHIVE.vaultId,
      rootKeyId: ARCHIVE.rootKeyId,
      operationId: OP,
      vaultVersion: 2,
      registrySequence: 2,
      checkpointDigest: "c".repeat(64),
      keyEpoch: 1,
      lifecycleVersion: 1,
      archiveRevision: 1,
      archiveDigest: "d".repeat(64),
      renewals: RENEWALS,
      commandFingerprint: "e".repeat(64),
      archiveCommandFingerprint: "f".repeat(64),
      acceptedAt: NOW / 1000,
      ...extra,
    },
  };
}
let api, jose, privateKey, jwk, tokenA;
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
async function token(extra = {}) {
  return new jose.SignJWT({
    iss: "https://securetoken.google.com/fixture-project",
    aud: "fixture-project",
    sub: "owner_A",
    iat: NOW / 1000 - 10,
    auth_time: NOW / 1000 - 20,
    exp: NOW / 1000 + 3600,
    firebase: { sign_in_provider: "google.com" },
    ...extra,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fixture-google-key" })
    .sign(privateKey);
}
function request(route, { method = "GET", auth = tokenA, json, raw, headers = {} } = {}) {
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
  });
}
function harness({ upstream, deadlineMs = 1000 } = {}) {
  const calls = [];
  return {
    calls,
    proxy: api.createHubProxy({
      env: ENV,
      now: () => NOW,
      deadlineMs,
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === JWKS) return Response.json({ keys: [jwk] });
        assert.ok(url.startsWith(ORIGIN + "/api/v2/"));
        return upstream ? upstream(url, init) : Response.json(state());
      },
    }),
    hub: () => calls.filter((call) => call.url.startsWith(ORIGIN)),
  };
}
async function failure(reply, status = 400, code = "malformed_request") {
  assert.equal(reply.status, status, await reply.clone().text());
  assert.equal(reply.headers.get("cache-control"), "no-store");
  const raw = await reply.text();
  assert.equal(JSON.parse(raw).error.code, code);
  assert.ok(!raw.includes("PRIVATE_CANARY"));
}
const write = { method: "POST", json: BODY, headers: { "Idempotency-Key": OP } };

test.before(async () => {
  jose = await import("jose");
  const keys = await jose.generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  privateKey = keys.privateKey;
  jwk = {
    ...(await jose.exportJWK(keys.publicKey)),
    kid: "fixture-google-key",
    alg: "RS256",
    use: "sig",
  };
  const common = compile("owner-transport", {
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
  tokenA = await token();
});

test("only three named renewal routes forward real owner identity and original retry bytes", async () => {
  for (const [route, method, body, result, status] of [
    [BASE + "/key-renewal-state", "GET", undefined, state(), 200],
    [BASE + "/key-renewal-operations/" + OP, "GET", undefined, ack(), 200],
    [BASE + "/key-renewals", "POST", BODY, ack(), 201],
  ]) {
    const h = harness({
      upstream: () =>
        Response.json(result, { status, headers: { "Set-Cookie": "PRIVATE_CANARY" } }),
    });
    const raw = body && JSON.stringify(body, null, 2);
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await h.proxy(
        request(route, {
          method,
          raw,
          headers: {
            ...(method === "GET" ? {} : { "Idempotency-Key": OP }),
            Cookie: "PRIVATE_CANARY",
            "X-FolioView-Owner": "PRIVATE_CANARY",
            "X-Folioview-Delegation": "PRIVATE_CANARY",
            "X-Serverless-Authorization": "PRIVATE_CANARY",
            Origin: SITE,
          },
        }),
      );
      assert.equal(reply.status, status, await reply.clone().text());
      assert.equal(reply.headers.get("set-cookie"), null);
      assert.equal(reply.headers.get("cache-control"), "no-store");
      assert.deepEqual(await reply.json(), result);
    }
    assert.equal(h.hub().length, 2);
    for (const call of h.hub()) {
      assert.equal(call.url, ORIGIN + route);
      assert.equal(call.init.headers.get("authorization"), "Bearer " + tokenA);
      assert.equal(call.init.headers.get("x-folioview-contract"), CONTRACT);
      assert.equal(call.init.headers.get("idempotency-key"), method === "POST" ? OP : null);
      assert.deepEqual(
        [...call.init.headers.keys()].sort(),
        method === "POST"
          ? ["authorization", "content-type", "idempotency-key", "x-folioview-contract"]
          : ["authorization", "x-folioview-contract"],
      );
      assert.equal(call.init.redirect, "manual");
      assert.equal(call.init.cache, "no-store");
      assert.equal(call.init.credentials, "omit");
      assert.equal(
        call.init.body === undefined ? undefined : new TextDecoder().decode(call.init.body),
        raw,
      );
    }
  }
});

test("renewal state can report fully expired certificates without granting writes or inventing root expiry", async () => {
  const h = harness({
    upstream: () => Response.json(state({ pendingRecoveryAuthorization: true })),
  });
  const reply = await h.proxy(request(BASE + "/key-renewal-state"));
  assert.equal(reply.status, 200);
  const value = await reply.json();
  assert.equal(value.rootAnchorExpiresAt, null);
  assert.ok(value.certificates.every((item) => item.status === "expired"));
  assert.equal(h.hub().length, 1);
  assert.equal(h.hub()[0].init.method, "GET");
});

test("the same BFF preserves different Google owners without manufacturing workload IAM identity", async () => {
  const tokenB = await token({ sub: "owner_B" });
  const h = harness({
    upstream: (url) =>
      Response.json(
        ack(url.includes("/vault_B/") ? { vaultId: "vault_B", ownerSubject: "b".repeat(64) } : {}),
        { status: 201 },
      ),
  });
  for (const [vaultId, auth] of [
    ["vault_A", tokenA],
    ["vault_B", tokenB],
  ]) {
    const reply = await h.proxy(
      request("/api/v2/vaults/" + vaultId + "/key-renewals", {
        ...write,
        auth,
        json: { ...BODY, archive: { ...ARCHIVE, vaultId } },
      }),
    );
    assert.equal(reply.status, 201, await reply.clone().text());
  }
  assert.equal(h.hub()[0].init.headers.get("authorization"), "Bearer " + tokenA);
  assert.equal(h.hub()[1].init.headers.get("authorization"), "Bearer " + tokenB);
  assert.ok(h.calls.every((call) => call.url === JWKS || call.url.startsWith(ORIGIN)));
});

test("renewal cannot be called by anonymous, agent, workload or non-Google credentials", async () => {
  for (const auth of [
    "",
    "synthetic_agent_token",
    await token({ firebase: { sign_in_provider: "password" } }),
    await token({ iss: "https://accounts.google.com", aud: ORIGIN, sub: "workload" }),
    await token({ exp: NOW / 1000 - 1 }),
  ]) {
    const h = harness();
    await failure(
      await h.proxy(request(BASE + "/key-renewals", { ...write, auth })),
      401,
      "invalid_token",
    );
    assert.equal(h.hub().length, 0);
  }
});

test("renewal routes reject methods, identifiers, path aliases and every query selector before upstream", async () => {
  for (const [route, method = "GET", code = "malformed_request"] of [
    [BASE + "/key-renewal-state?owner=other", "GET", "unsupported_query"],
    [BASE + "/key-renewal-state?", "GET", "unsupported_query"],
    [BASE + "/key-renewals?uid=other", "POST", "unsupported_query"],
    [BASE + "/key-renewal-operations/" + OP + "?refresh=1", "GET", "unsupported_query"],
    [BASE + "/key-renewal-operations/short"],
    [BASE + "/key-renewal-operations/" + "a".repeat(129)],
    [BASE + "/key-renewal-operations/" + OP + "/extra"],
    [BASE + "/key-renewal-state/"],
    [BASE + "/key-renewal-state", "POST"],
    [BASE + "/key-renewals", "GET"],
    [BASE + "/key-renewals", "PUT"],
    [BASE + "/key-renewals", "DELETE"],
    [BASE + "/key-renewal-operations/" + OP, "POST"],
    ["/api/v2/vaults/invalid!/key-renewal-state"],
    ["/api/v2/vaults/" + "a".repeat(129) + "/key-renewal-state"],
    [BASE + "/%6bey-renewal-state"],
    [BASE + "%2fkey-renewal-state"],
    [BASE + "/key-renewal-state#fragment"],
    ["/oauth/token", "POST"],
    ["/internal/v2/key-renewals", "POST"],
  ]) {
    const h = harness();
    await failure(
      await h.proxy(
        request(route, {
          ...(method === "POST" ? write : {}),
          method,
        }),
      ),
      400,
      code,
    );
    assert.equal(h.calls.length, 0, route);
  }
});

test("renewal requires exact single operation/contract headers and rejects caller author overrides", async () => {
  for (const [route, options] of [
    [BASE + "/key-renewals", { ...write, headers: {} }],
    [BASE + "/key-renewals", { ...write, headers: { "Idempotency-Key": "short" } }],
    [BASE + "/key-renewals", { ...write, headers: { "Idempotency-Key": OP + ", " + OP } }],
    [
      BASE + "/key-renewals",
      {
        ...write,
        headers: { ...write.headers, "X-FolioView-Contract": CONTRACT + ", " + CONTRACT },
      },
    ],
    [
      BASE + "/key-renewals",
      { ...write, headers: { ...write.headers, "X-FolioView-Author-Key": binary(32) } },
    ],
    [
      BASE + "/key-renewals",
      {
        ...write,
        headers: { ...write.headers, "X-FolioView-Authority-Delegation": "PRIVATE_CANARY" },
      },
    ],
    [BASE + "/key-renewal-state", { headers: { "Idempotency-Key": OP } }],
    [BASE + "/key-renewal-state", { headers: { "X-FolioView-Author-Key": binary(32) } }],
    [
      BASE + "/key-renewal-operations/" + OP,
      { headers: { "X-FolioView-Authority-Delegation": "PRIVATE_CANARY" } },
    ],
  ]) {
    const h = harness();
    const reply = await h.proxy(request(route, options));
    await failure(
      reply,
      400,
      options.headers["X-FolioView-Contract"] ? "unsupported_contract" : "malformed_request",
    );
    assert.equal(h.calls.length, 0);
  }
});

test("closed renewal bodies reject secret and unknown fields at every visible envelope layer", async () => {
  const changes = [
    { ...BODY, privateKey: "PRIVATE_CANARY" },
    { ...BODY, uid: "owner_B" },
    { ...BODY, expectedVersion: 1 },
    { ...BODY, archive: { ...ARCHIVE, vaultId: "vault_B" } },
    { ...BODY, archive: { ...ARCHIVE, privateKey: "PRIVATE_CANARY" } },
    { ...BODY, registryBundle: { ...BODY.registryBundle, privateKey: "PRIVATE_CANARY" } },
    { ...BODY, registryBundle: { ...BODY.registryBundle, entries: [] } },
    {
      ...BODY,
      registryBundle: {
        ...BODY.registryBundle,
        entries: [{ certificate: SIGNED, active: true, privateKey: "PRIVATE_CANARY" }],
      },
    },
    { ...BODY, command: { ...SIGNED, privateKey: "PRIVATE_CANARY" } },
    { ...BODY, archiveCommand: { ...SIGNED, privateKey: "PRIVATE_CANARY" } },
    ...Object.keys(BODY).map((field) =>
      Object.fromEntries(Object.entries(BODY).filter(([k]) => k !== field)),
    ),
  ];
  for (const json of changes) {
    const h = harness();
    await failure(await h.proxy(request(BASE + "/key-renewals", { ...write, json })));
    assert.equal(h.calls.length, 0);
  }
});

test("renewal archive and both root-command encodings are canonical and independently bounded", async () => {
  for (const json of [
    ...[
      { ...ARCHIVE, rootKeyId: "A".repeat(42) + "B" },
      { ...ARCHIVE, ownerSubject: "owner_A" },
      { ...ARCHIVE, credentialId: "" },
      { ...ARCHIVE, credentialId: binary(1537) },
      { ...ARCHIVE, prfSalt: binary(31) },
      { ...ARCHIVE, iv: binary(11) },
      { ...ARCHIVE, ciphertext: binary(15) },
      { ...ARCHIVE, ciphertext: binary(24577) },
    ].map((archive) => ({ ...BODY, archive })),
    ...["command", "archiveCommand"].flatMap((field) =>
      [
        { ...SIGNED, protected: binary(770) },
        { ...SIGNED, payload: "A".repeat(8200) },
        { ...SIGNED, signature: "A".repeat(85) + "B" },
        { ...SIGNED, payload: "AA=" },
      ].map((command) => ({ ...BODY, [field]: command })),
    ),
  ]) {
    const h = harness();
    await failure(await h.proxy(request(BASE + "/key-renewals", { ...write, json })));
    assert.equal(h.calls.length, 0);
  }
});

test("duplicate JSON, advertised sizes, media and read bodies cannot bypass renewal budgets", async () => {
  const raw = JSON.stringify(BODY);
  for (const [options, status = 400, code = "malformed_request"] of [
    [{ ...write, raw: '{"contractVersion":"' + CONTRACT + '",' + raw.slice(1) }],
    [{ ...write, raw: raw.replace('"archive":{', '"archive":{"iv":"' + ARCHIVE.iv + '",') }],
    [{ ...write, raw: new Uint8Array([0xff, 0xfe]) }],
    [
      { ...write, raw: "x".repeat(589825), headers: { ...write.headers, "Content-Length": "1" } },
      413,
      "payload_too_large",
    ],
    [
      { ...write, headers: { ...write.headers, "Content-Encoding": "gzip" } },
      415,
      "unsupported_media_type",
    ],
    [
      { ...write, headers: { ...write.headers, "Content-Type": "text/plain" } },
      415,
      "unsupported_media_type",
    ],
  ]) {
    const h = harness();
    await failure(await h.proxy(request(BASE + "/key-renewals", options)), status, code);
    assert.equal(h.calls.length, 0);
  }
  const readWithBody = request(BASE + "/key-renewal-state", { method: "POST", raw: "{}" });
  Object.defineProperty(readWithBody, "method", { value: "GET" });
  const h = harness();
  await failure(await h.proxy(readWithBody), 413, "payload_too_large");
  assert.equal(h.calls.length, 0);
});

test("renewal state replies are exact, bounded public metadata and never leak unexpected fields", async () => {
  const cert = state().certificates[0];
  const bad = [
    { ...state(), privateKey: "PRIVATE_CANARY" },
    { ...state(), archive: ARCHIVE },
    state({ profile: "folioview.vault-lifecycle.v1" }),
    state({ vaultId: "vault_B" }),
    state({ rootAnchorExpiresAt: 999 }),
    state({ rootKeyId: "A".repeat(42) + "B" }),
    state({ vaultVersion: true }),
    state({ registrySequence: 33 }),
    state({ lifecycleVersion: 33 }),
    state({ archiveRevision: 1 }),
    state({ keyEpoch: Number.MAX_SAFE_INTEGER + 1 }),
    state({ pendingRecoveryAuthorization: "active" }),
    state({ certificates: Array(65).fill(cert) }),
    state({ certificates: [cert, cert] }),
    ...[
      { ...cert, privateKey: "PRIVATE_CANARY" },
      { ...cert, role: "agent_enc" },
      { ...cert, status: "usable" },
      { ...cert, principalId: "../other" },
      { ...cert, keyEpoch: true },
      { ...cert, notBefore: -1 },
      { ...cert, expiresAt: cert.notBefore },
    ].map((item) => state({ certificates: [item] })),
  ];
  for (const body of bad) {
    const h = harness({ upstream: () => Response.json(body) });
    await failure(
      await h.proxy(request(BASE + "/key-renewal-state")),
      503,
      "authorization_unavailable",
    );
    assert.equal(h.hub().length, 1);
  }
});

test("renewal receipts bind both read and POST operations and reject foreign or legacy responses", async () => {
  const result = ack();
  const mapping = RENEWALS[0];
  const bad = [
    { ...result, privateKey: "PRIVATE_CANARY" },
    ack({ privateKey: "PRIVATE_CANARY" }),
    ack({ vaultId: "vault_B" }),
    ack({ operationId: OP + "_other" }),
    ack({ rootKeyId: "A".repeat(42) + "B" }),
    ack({ acceptedAt: true }),
    ack({ vaultVersion: 1 }),
    ack({ registrySequence: 33 }),
    ack({ archiveRevision: 2 }),
    ack({ commandFingerprint: "invalid" }),
    ack({ archiveCommandFingerprint: "invalid" }),
    ack({ renewals: [] }),
    ack({ renewals: Array(4).fill(mapping) }),
    ack({ renewals: [RENEWALS[1]] }),
    ack({ renewals: [RENEWALS[0], RENEWALS[0]] }),
    ack({ renewals: [...RENEWALS].reverse() }),
    ack({ renewals: [{ ...mapping, privateKey: "PRIVATE_CANARY" }, ...RENEWALS.slice(1)] }),
    ack({ renewals: [{ ...mapping, principalId: "other_device" }, ...RENEWALS.slice(1)] }),
    ack({ renewals: [{ ...mapping, newKeyEpoch: 3 }, ...RENEWALS.slice(1)] }),
    ack({ renewals: [{ ...mapping, newKeyId: mapping.priorKeyId }, ...RENEWALS.slice(1)] }),
    { ...result, profile: "folioview.vault-lifecycle.v1" },
    { contractVersion: CONTRACT, vault: null, sources: [] },
    state(),
  ];
  for (const body of bad) {
    for (const [route, options, status] of [
      [BASE + "/key-renewal-operations/" + OP, {}, 200],
      [BASE + "/key-renewals", write, 201],
    ]) {
      const h = harness({ upstream: () => Response.json(body, { status }) });
      await failure(await h.proxy(request(route, options)), 503, "authorization_unavailable");
    }
  }
});

test("recovery-only and device-pair renewal receipts remain valid without weakening the target allowlist", async () => {
  for (const renewals of [[RENEWALS[2]], RENEWALS.slice(0, 2), RENEWALS]) {
    const h = harness({ upstream: () => Response.json(ack({ renewals }), { status: 201 }) });
    const reply = await h.proxy(request(BASE + "/key-renewals", write));
    assert.equal(reply.status, 201, await reply.clone().text());
  }
});

test("named renewal success statuses, response budgets and deadline remain closed", async () => {
  for (const [route, options, wrongStatus, body] of [
    [BASE + "/key-renewal-state", {}, 201, state()],
    [BASE + "/key-renewal-state", {}, 202, state()],
    [BASE + "/key-renewal-operations/" + OP, {}, 201, ack()],
    [BASE + "/key-renewals", write, 200, ack()],
    [BASE + "/key-renewals", write, 202, ack()],
  ]) {
    const h = harness({ upstream: () => Response.json(body, { status: wrongStatus }) });
    await failure(await h.proxy(request(route, options)), 503, "authorization_unavailable");
  }
  let canceled = false;
  const rejectedStream = harness({
    upstream: () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
  });
  await failure(
    await rejectedStream.proxy(request(BASE + "/key-renewal-state")),
    503,
    "authorization_unavailable",
  );
  assert.equal(canceled, true);
  for (const upstream of [
    () => new Response(" ".repeat(1048577), { headers: { "Content-Type": "application/json" } }),
    () => new Response(JSON.stringify(state()), { headers: { "Content-Type": "text/plain" } }),
    () =>
      new Response('{"privateKey":"PRIVATE_CANARY","privateKey":"other"}', {
        headers: { "Content-Type": "application/json" },
      }),
    () => new Promise(() => {}),
  ]) {
    const h = harness({ upstream, deadlineMs: 25 });
    await failure(
      await h.proxy(request(BASE + "/key-renewal-state")),
      503,
      "authorization_unavailable",
    );
  }
});

test("formal Hub renewal failures retain their status without passing private upstream error fields", async () => {
  for (const [status, code] of [
    [403, "key_authorization_required"],
    [409, "registry_conflict"],
    [409, "idempotency_conflict"],
    [422, "invalid_signature"],
  ]) {
    const value = {
      contractVersion: CONTRACT,
      error: { code, retryable: false, requestId: "synthetic" },
    };
    const h = harness({ upstream: () => Response.json(value, { status }) });
    const reply = await h.proxy(request(BASE + "/key-renewals", write));
    await failure(reply, status, code);
    const poison = harness({
      upstream: () => Response.json({ ...value, privateKey: "PRIVATE_CANARY" }, { status }),
    });
    await failure(
      await poison.proxy(request(BASE + "/key-renewals", write)),
      503,
      "authorization_unavailable",
    );
  }
});
