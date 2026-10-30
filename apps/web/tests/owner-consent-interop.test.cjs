const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { MessageChannel, MessagePort } = require("node:worker_threads");
const repository =
  process.env.FOLIOVIEW_TEST_REPOSITORY_ROOT || path.resolve(__dirname, "../../..");
const hubRepository = process.env.FOLIOVIEW_TEST_HUB_ROOT || repository;
const projectRequire = createRequire(path.join(repository, "apps/web/package.json"));
const { transformSync } = projectRequire("next/dist/build/swc");
const CONTRACT = "folioview.agent-workspace.v2.0";
const HUB = "https://agent-hub-api-123456789.northamerica-northeast2.run.app";
const OWNER = "https://owner.synthetic.test";
const RAW_TOKEN = "syntheticHeader.syntheticPayload.syntheticSignature";
function loadWeb(name, imports, globals = {}) {
  const file = path.join(repository, "apps/web/lib", name + ".ts");
  const { code } = transformSync(fs.readFileSync(file, "utf8"), {
    filename: file,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    MessagePort,
    setTimeout,
    clearTimeout,
    require: (key) => {
      assert.ok(key in imports, key);
      return imports[key];
    },
    ...globals,
  });
  return module.exports;
}
function fakeWindow(origin) {
  const listeners = new Map();
  const host = {
    location: { origin },
    closed: false,
    addEventListener: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    emit: (name, event) => {
      for (const listener of [...(listeners.get(name) || [])]) listener(event);
    },
  };
  host.top = host;
  return host;
}
async function wire(fetchImpl) {
  // Real MessagePorts and shipped parsers exercise the shared wire. Window events
  // are explicit test facades; this is not native-browser identity acceptance.
  const hubModule = await import(
    pathToFileURL(path.join(hubRepository, "services/agent-hub-service/helper/dist/consent.mjs"))
      .href
  );
  const owner = fakeWindow(OWNER),
    hub = fakeWindow(HUB),
    replies = [],
    requests = [],
    navigations = [];
  owner.opener = hub;
  hub.open = (url) => {
    owner.openedUrl = new URL(url);
    return owner;
  };
  owner.postMessage = (data, target, ports = []) => {
    assert.equal(target, OWNER);
    queueMicrotask(() =>
      owner.emit("message", { source: hub, origin: HUB, isTrusted: true, data, ports }),
    );
  };
  hub.postMessage = (data, target, ports = []) => {
    assert.equal(target, HUB);
    queueMicrotask(() =>
      hub.emit("message", { source: owner, origin: OWNER, isTrusted: true, data, ports }),
    );
  };
  const config = {
    contractVersion: CONTRACT,
    profile: "folioview.owner-consent-bridge.v1",
    issuer: HUB,
    ownerOrigins: [OWNER],
    clients: [
      { clientId: "client_synthetic", redirectUris: ["https://muse.synthetic.test/callback"] },
    ],
  };
  const server = new hubModule.OwnerConsentBridge({
    config,
    requestId: "request_synthetic",
    host: hub,
    navigate: (url) => navigations.push(url),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return fetchImpl(url, options);
    },
  });
  server.open(OWNER);
  const taskTypes = loadWeb("task-types", {});
  const connectionTypes = loadWeb("agent-connections", { "./task-types": taskTypes });
  const clientModule = loadWeb(
    "owner-consent-bridge",
    { "./agent-connections": connectionTypes },
    { window: owner },
  );
  const handoff = clientModule.consentHandoff(owner.openedUrl.search);
  const client = await clientModule.connectOwnerConsentBridge(handoff, HUB);
  const abort = new AbortController();
  return {
    client,
    server,
    requests,
    replies,
    navigations,
    abort,
    close() {
      abort.abort();
      client.close();
      server.close();
    },
  };
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function pending() {
  return {
    contractVersion: CONTRACT,
    provider: "muse",
    status: "pending",
    clientId: "client_synthetic",
    scopes: ["tasks:read"],
    connectionId: "connection_synthetic",
    authorizationId: "authorization_synthetic",
    expiresAt: 1900000000,
    prepared: null,
  };
}
test("Web and shipped Hub consent bridge exchange raw JWT only on the owner port and use the exact cookie-bound route", async () => {
  const h = await wire(async () => json(pending()));
  try {
    const result = await h.client.request(
      "claim",
      { contractVersion: CONTRACT },
      RAW_TOKEN,
      h.abort.signal,
    );
    assert.equal(result.connectionId, "connection_synthetic");
    assert.equal(h.requests.length, 1);
    const { url, options } = h.requests[0];
    assert.equal(url, "/api/v2/agent-authorizations/request_synthetic/claim");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer " + RAW_TOKEN);
    assert.equal(options.headers.Origin, undefined);
    assert.equal(options.headers["X-FolioView-Contract"], CONTRACT);
    assert.deepEqual(JSON.parse(options.body), { contractVersion: CONTRACT });
    assert.ok(!JSON.stringify(result).includes(RAW_TOKEN));
  } finally {
    h.close();
  }
});
test("Hub authorization denial uses the exact Web error envelope and settles without leaking upstream diagnostics", async () => {
  const h = await wire(async () =>
    json({ internal: "synthetic upstream diagnostic must stay private" }, 403),
  );
  const deadline = setTimeout(() => h.abort.abort(), 2000);
  try {
    await assert.rejects(
      h.client.request("claim", { contractVersion: CONTRACT }, RAW_TOKEN, h.abort.signal),
      (error) => error.code === "insufficient_scope" && !String(error).includes("upstream"),
    );
    assert.equal(h.requests.length, 1);
  } finally {
    clearTimeout(deadline);
    h.close();
  }
});
test("Hub completes only a registered OAuth callback and returns no OAuth code or redirect through the Web port", async () => {
  const callback =
    "https://muse.synthetic.test/callback?code=syntheticCode&state=syntheticState&iss=" +
    encodeURIComponent(HUB);
  const h = await wire(async (url) =>
    json(url.endsWith("/decision") ? { redirectUri: callback } : pending()),
  );
  try {
    await h.client.request("claim", { contractVersion: CONTRACT }, RAW_TOKEN, h.abort.signal);
    const result = await h.client.request(
      "decision",
      {
        contractVersion: CONTRACT,
        decision: "approve",
        signedGrants: [{ protected: "cA", payload: "cA", signature: "cw" }],
      },
      RAW_TOKEN,
      h.abort.signal,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { completed: true });
    assert.equal(h.navigations.length, 1);
    assert.equal(new URL(h.navigations[0]).origin, "https://muse.synthetic.test");
    for (const secret of [RAW_TOKEN, "syntheticCode", "syntheticState", "redirectUri"])
      assert.ok(!JSON.stringify(result).includes(secret));
  } finally {
    h.close();
  }
});

test("the shipped owner/helper bridge accepts minimal independent delivery pins and never carries owner authentication", async () => {
  const helperModule = await import(
    pathToFileURL(
      path.join(hubRepository, "services/agent-hub-service/helper/dist/owner-helper.mjs"),
    ).href
  );
  const owner = fakeWindow(OWNER),
    helper = fakeWindow(HUB),
    calls = [];
  let server, client;
  const status = {
    profile: "folioview.foreground-controller.v1",
    helperVersion: "1.2.0",
    state: "READY",
    sessionId: "session_synthetic",
    generation: 1,
    expiresAt: 1900000000,
    foreground: true,
    authenticatedTransport: false,
    independentDeliveryConfirmed: false,
    privateKeysPersistent: false,
  };
  const controller = {
    initialize: async (card) => {
      calls.push(["initialize", card]);
      return {
        helperVersion: "1.2.0",
        sessionId: "session_synthetic",
        generation: 1,
        anchor: card.anchor,
        agentSigningPublicJwk: card.anchor.rootJwk,
        agentEncryptionPublicJwk: card.anchor.rootJwk,
        agentSigningKeyId: "c".repeat(43),
        agentEncryptionKeyId: "d".repeat(43),
        keyExportRejected: true,
      };
    },
    confirmDelivery: async (args) => {
      calls.push(["confirm_delivery", args]);
      return { ...status, independentDeliveryConfirmed: true };
    },
    status: () => status,
    lock: () => calls.push(["lock"]),
  };
  helper.opener = owner;
  helper.close = () => {
    helper.closed = true;
  };
  owner.postMessage = (data, target, ports = []) => {
    assert.equal(target, OWNER);
    queueMicrotask(() =>
      owner.emit("message", { source: helper, origin: HUB, isTrusted: true, data, ports }),
    );
  };
  helper.postMessage = (data, target, ports = []) => {
    assert.equal(target, HUB);
    queueMicrotask(() =>
      helper.emit("message", { source: owner, origin: OWNER, isTrusted: true, data, ports }),
    );
  };
  owner.open = (raw) => {
    const url = new URL(raw);
    assert.equal(url.origin, HUB);
    assert.equal(url.pathname, "/agent/v2/helper/controller.html");
    server = new helperModule.OwnerHelperBridge({
      host: helper,
      config: { issuer: HUB, ownerOrigins: [OWNER] },
      controller,
      ownerOrigin: url.searchParams.get("owner_origin"),
      nonce: url.searchParams.get("owner_nonce"),
    });
    return helper;
  };
  const types = loadWeb("agent-connections", { "./task-types": loadWeb("task-types", {}) });
  const browser = loadWeb(
    "helper-owner-bridge",
    { "./agent-connections": types },
    {
      window: owner,
      MessageChannel,
      crypto: require("node:crypto").webcrypto,
      btoa,
      setInterval,
      clearInterval,
    },
  );
  try {
    client = await browser.openHelperOwnerBridge(HUB);
    const anchor = {
      ownerSubject: "a".repeat(43),
      vaultId: "vault_synthetic",
      rootJwk: { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) },
      rootKeyId: "b".repeat(43),
      rootEpoch: 1,
      registrySequence: 1,
      checkpointDigest: "a".repeat(64),
      connectionId: "connection_synthetic",
      agentPrincipalId: "agent_synthetic",
      taskId: "task_synthetic",
    };
    await client.request("initialize", {
      helperVersion: "1.2.0",
      workerSha256: browser.HELPER_WORKER_SHA256,
      anchor,
      ttlSeconds: 600,
    });
    const pin = {
      preparationId: "preparation_synthetic",
      taskVersion: 1,
      taskEnvelopeFingerprint: "a".repeat(64),
      taskDeliveryFingerprint: "b".repeat(64),
      objects: [{ objectId: "task_synthetic", envelopeFingerprint: "b".repeat(64) }],
      deliveryRevision: 2,
      priorEnvelopeFingerprint: "a".repeat(64),
      authorizationId: "authorization_synthetic",
      grantId: "grant_synthetic",
      grantEpoch: 1,
      executionEpoch: 1,
    };
    const result = await client.request("confirm_delivery", { pin });
    assert.equal(result.independentDeliveryConfirmed, true);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ["confirm_delivery", { pin }]);
    assert.ok(!JSON.stringify(calls).includes('authorization":"Bearer'));
    assert.ok(!JSON.stringify(calls).includes(RAW_TOKEN));
    await assert.rejects(client.request("authenticate", { token: RAW_TOKEN }));
  } finally {
    client?.close();
    server?.close();
  }
});
