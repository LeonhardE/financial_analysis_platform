const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { MessageChannel, MessagePort } = require("node:worker_threads");
const { compile, contracts, deferred, settle } = require("./agent-connections-helpers.cjs");
const ORIGIN = "https://agent-hub-api-123456789.northamerica-northeast2.run.app";
const PROFILE = "folioview.owner-consent-bridge.v1",
  CONTRACT = contracts.CONNECTION_CONTRACT;
function loadOwner({ fixedOpener = false } = {}) {
  const listeners = new Set(),
    ready = [],
    opener = { postMessage: (...args) => ready.push(args) };
  const window = {
    opener,
    addEventListener: (_event, callback) => listeners.add(callback),
    removeEventListener: (_event, callback) => listeners.delete(callback),
  };
  if (fixedOpener)
    Object.defineProperty(window, "opener", {
      get: () => opener,
      set: () => {
        throw Error("fixed opener");
      },
    });
  const bridge = compile(
    "../lib/owner-consent-bridge.ts",
    { "./agent-connections": contracts },
    { window, MessagePort, URLSearchParams, setTimeout, clearTimeout },
  );
  return {
    bridge,
    ready,
    window,
    opener,
    listeners,
    attach(port, patch = {}) {
      for (const listener of [...listeners])
        listener({
          isTrusted: true,
          origin: ORIGIN,
          source: opener,
          data: {
            type: "fv-owner-consent-attached",
            profile: PROFILE,
            requestId: "request_A",
            nonce: "n".repeat(43),
          },
          ports: [port],
          ...patch,
        });
    },
  };
}
test("owner handoff permits only exact public request/nonce query fields", () => {
  const { bridge } = loadOwner();
  assert.equal(bridge.consentHandoff(""), null);
  assert.equal(
    bridge.consentHandoff(`?agent_request=request_A&agent_nonce=${"n".repeat(43)}`).requestId,
    "request_A",
  );
  for (const value of [
    "?agent_request=request_A",
    `?agent_request=request_A&agent_nonce=${"n".repeat(43)}&token=CANARY`,
    `?agent_request=request_A&agent_request=request_B&agent_nonce=${"n".repeat(43)}`,
    "?agent_request=../other&agent_nonce=bad",
  ])
    assert.throws(
      () => bridge.consentHandoff(value),
      (error) => error.code === "invalid_handoff",
    );
});
test("origin/source/nonce-bound owner attachment severs opener before a bridge can receive a credential", async () => {
  const h = loadOwner(),
    channel = new MessageChannel();
  const connecting = h.bridge.connectOwnerConsentBridge(
    { requestId: "request_A", nonce: "n".repeat(43) },
    ORIGIN,
  );
  h.attach(channel.port1, { origin: "https://attacker.example" });
  h.attach(channel.port1, { source: {} });
  h.attach(channel.port1, { isTrusted: false });
  assert.equal(h.listeners.size, 1);
  assert.equal(h.ready[0][1], ORIGIN);
  h.attach(channel.port1);
  const bridge = await connecting;
  assert.equal(h.window.opener, null);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.bridge.verifiedOwnerBridge(bridge), true);
  const captured = [];
  channel.port2.onmessage = ({ data }) => {
    captured.push(data);
    channel.port2.postMessage({ id: data.id, ok: true, data: { provider: "muse" } });
  };
  channel.port2.start();
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await bridge.request("claim", { contractVersion: CONTRACT }, "RAW.JWT.fixture"),
      ),
    ),
    { provider: "muse" },
  );
  assert.equal(captured[0].authorization, "RAW.JWT.fixture");
  assert.equal(captured[0].profile, PROFILE);
  assert.equal(captured[0].requestId, "request_A");
  assert.equal(captured[0].op, "claim");
  assert.doesNotMatch(JSON.stringify(h.ready), /RAW.JWT|token|privateKey/);
  bridge.close();
  channel.port2.close();
});
test("failure to sever opener rejects before branding or credential transport", async () => {
  const h = loadOwner({ fixedOpener: true }),
    channel = new MessageChannel();
  const connecting = h.bridge.connectOwnerConsentBridge(
    { requestId: "request_A", nonce: "n".repeat(43) },
    ORIGIN,
  );
  h.attach(channel.port1);
  await assert.rejects(connecting, (error) => error.code === "invalid_handoff");
  channel.port2.close();
});
test("a constructed arbitrary port and OAuth-only approval cannot use the owner credential API", async () => {
  const h = loadOwner(),
    channel = new MessageChannel(),
    bridge = new h.bridge.OwnerConsentBridge(channel.port1, "request_A", ORIGIN);
  assert.equal(h.bridge.verifiedOwnerBridge(bridge), false);
  await assert.rejects(bridge.request("claim", { contractVersion: CONTRACT }, "RAW.JWT.fixture"));
  assert.throws(() =>
    h.bridge.validateConsentCommand("decision", {
      contractVersion: CONTRACT,
      decision: "approve",
      signedGrants: [],
    }),
  );
  assert.throws(() =>
    h.bridge.validateConsentCommand("claim", {
      contractVersion: CONTRACT,
      url: "https://attacker.example",
    }),
  );
  assert.throws(() => h.bridge.validateConsentCommand("initialize", { contractVersion: CONTRACT }));
  bridge.close();
  channel.port2.close();
});
test("malformed error diagnostics are reduced to a closed code and closed ports reject late work", async () => {
  const h = loadOwner(),
    channel = new MessageChannel(),
    connecting = h.bridge.connectOwnerConsentBridge(
      { requestId: "request_A", nonce: "n".repeat(43) },
      ORIGIN,
    );
  h.attach(channel.port1);
  const bridge = await connecting;
  channel.port2.onmessage = ({ data }) =>
    channel.port2.postMessage({
      id: data.id,
      ok: false,
      data: { code: "insufficient_scope", privateDiagnostic: "PRIVATE_CANARY" },
    });
  channel.port2.start();
  await assert.rejects(
    bridge.request("claim", { contractVersion: CONTRACT }, "RAW.JWT.fixture"),
    (error) => error.code === "request_failed" && !error.message.includes("PRIVATE_CANARY"),
  );
  bridge.close();
  await assert.rejects(bridge.request("claim", { contractVersion: CONTRACT }, "RAW.JWT.fixture"));
  channel.port2.close();
});
test("helper owner messages allow only public initialization and sorted minimal delivery pins", () => {
  const helper = compile("../lib/helper-owner-bridge.ts", { "./agent-connections": contracts });
  const anchor = {
    ownerSubject: "o".repeat(43),
    vaultId: "vault_A",
    rootJwk: { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43) },
    rootKeyId: "r".repeat(43),
    rootEpoch: 1,
    registrySequence: 1,
    checkpointDigest: "a".repeat(64),
    connectionId: "connection_A",
    agentPrincipalId: "agent_A",
    taskId: "task_A",
  };
  helper.validateHelperOwnerCommand("initialize", {
    helperVersion: helper.HELPER_VERSION,
    workerSha256: helper.HELPER_WORKER_SHA256,
    anchor,
    ttlSeconds: 900,
  });
  for (const [version, workerPath] of [
    ["1.2.0", "dist/worker.mjs"],
    ["1.3.0", "releases/1.3.0/dist/worker.mjs"],
  ]) {
    const digest = createHash("sha256")
      .update(
        readFileSync(resolve(__dirname, "../../../services/agent-hub-service/helper", workerPath)),
      )
      .digest("hex");
    helper.validateHelperOwnerCommand("initialize", {
      helperVersion: version,
      workerSha256: digest,
      anchor,
      ttlSeconds: 900,
    });
    assert.throws(() =>
      helper.validateHelperOwnerCommand("initialize", {
        helperVersion: version === "1.2.0" ? "1.3.0" : "1.2.0",
        workerSha256: digest,
        anchor,
        ttlSeconds: 900,
      }),
    );
    if (version === helper.HELPER_VERSION) assert.equal(digest, helper.HELPER_WORKER_SHA256);
  }
  assert.equal(helper.HELPER_CONTROLLER_PATH, "/agent/v2/helper/1.3.0/controller.html");
  assert.throws(() =>
    helper.validateHelperOwnerCommand("initialize", {
      helperVersion: helper.HELPER_VERSION,
      workerSha256: helper.HELPER_WORKER_SHA256,
      anchor: { ...anchor, rootJwk: { ...anchor.rootJwk, d: "PRIVATE_CANARY" } },
      ttlSeconds: 900,
    }),
  );
  assert.throws(() =>
    helper.validateHelperOwnerCommand("status", { authorization: "RAW.JWT.fixture" }),
  );
  const pin = {
    preparationId: "preparation_A",
    taskVersion: 1,
    taskEnvelopeFingerprint: "a".repeat(64),
    taskDeliveryFingerprint: "b".repeat(64),
    objects: [
      { objectId: "copy_A", envelopeFingerprint: "c".repeat(64) },
      { objectId: "task_A", envelopeFingerprint: "b".repeat(64) },
    ],
    deliveryRevision: 2,
    priorEnvelopeFingerprint: "a".repeat(64),
    authorizationId: "authorization_A",
    grantId: "grant_A",
    grantEpoch: 1,
    executionEpoch: 1,
  };
  helper.validateHelperOwnerCommand("confirm_delivery", { pin });
  assert.throws(() =>
    helper.validateHelperOwnerCommand("confirm_delivery", {
      pin: { ...pin, objects: [...pin.objects].reverse() },
    }),
  );
  assert.throws(() =>
    helper.validateHelperOwnerCommand("confirm_delivery", {
      pin: { ...pin, objects: [{ ...pin.objects[0], path: "/other" }] },
    }),
  );
});

function reconnectHarness() {
  const listeners = new Set(),
    opened = [],
    ready = [],
    timers = new Map();
  let serial = 0;
  const peer = {
    closed: false,
    close() {
      this.closed = true;
    },
    postMessage: (...args) => ready.push(args),
  };
  const window = {
    opener: null,
    open: (...args) => {
      opened.push(args);
      return peer;
    },
    addEventListener: (_name, fn) => listeners.add(fn),
    removeEventListener: (_name, fn) => listeners.delete(fn),
  };
  const api = compile(
    "../lib/owner-consent-bridge.ts",
    { "./agent-connections": contracts },
    {
      window,
      URL,
      URLSearchParams,
      MessagePort,
      setTimeout: (fn) => {
        timers.set(++serial, fn);
        return serial;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const offer = (patch = {}) => {
    for (const listener of [...listeners])
      listener({
        isTrusted: true,
        origin: ORIGIN,
        source: peer,
        ports: [],
        data: {
          type: "fv-owner-consent-offer",
          profile: PROFILE,
          requestId: "request_B",
          nonce: "b".repeat(43),
        },
        ...patch,
      });
  };
  return { api, window, peer, opened, ready, timers, listeners, offer };
}
const requestLink = `${ORIGIN}/agent/v2/helper/consent.html?request=request_B`;
test("reconnect accepts only the configured Hub public request locator", () => {
  const { api } = reconnectHarness();
  assert.equal(api.ownerReconnectUrl(requestLink, ORIGIN).href, requestLink + "&owner_reuse=1");
  for (const value of [
    requestLink.replace(ORIGIN, "https://attacker.example"),
    requestLink + "&token=CANARY",
    requestLink + "&request=request_C",
    requestLink + "#code=CANARY",
    requestLink + "&owner_reuse=1",
    requestLink.replace("consent.html", "controller.html"),
    ORIGIN + "/oauth/authorize?request=request_B",
    requestLink.replace("request_B", "../other"),
    "not a URL",
    requestLink.replace("https://", "https://user@"),
  ])
    assert.throws(() => api.ownerReconnectUrl(value, ORIGIN));
});
test("reconnect authenticates the actual opened Hub source before retaining its public handoff", async () => {
  const h = reconnectHarness();
  const pending = h.api.openOwnerReconnect(requestLink, ORIGIN);
  assert.equal(h.opened.length, 1);
  assert.equal(h.window.opener, null);
  for (const patch of [
    { source: {} },
    { origin: "https://attacker.example" },
    { isTrusted: false },
    { ports: [{}] },
    {
      data: {
        type: "fv-owner-consent-offer",
        profile: PROFILE,
        requestId: "request_C",
        nonce: "b".repeat(43),
      },
    },
    {
      data: {
        type: "fv-owner-consent-offer",
        profile: PROFILE,
        requestId: "request_B",
        nonce: "b".repeat(43),
        token: "CANARY",
      },
    },
  ]) {
    h.offer(patch);
    assert.equal(h.listeners.size, 1);
  }
  h.offer();
  const handoff = await pending;
  assert.equal(handoff.requestId, "request_B");
  assert.equal(h.listeners.size, 0);
  const channel = new MessageChannel();
  const connecting = h.api.connectOwnerConsentBridge(handoff, ORIGIN);
  assert.deepEqual(JSON.parse(JSON.stringify(h.ready[0])), [
    { type: "fv-owner-consent-ready", requestId: "request_B", nonce: "b".repeat(43) },
    ORIGIN,
  ]);
  h.offer({
    data: {
      type: "fv-owner-consent-attached",
      profile: PROFILE,
      requestId: "request_B",
      nonce: "b".repeat(43),
    },
    ports: [channel.port1],
  });
  const bridge = await connecting;
  assert.equal(h.api.verifiedOwnerBridge(bridge), true);
  bridge.close();
  channel.port2.close();
  h.api.releaseConsentHandoff(handoff);
  h.window.opener = h.peer;
  await assert.rejects(
    h.api.connectOwnerConsentBridge(handoff, ORIGIN),
    (e) => e.code === "invalid_handoff",
  );
});
test("reconnect abort and unsupported-Hub timeout close only the newly opened popup", async () => {
  for (const abort of [true, false]) {
    const h = reconnectHarness(),
      signal = new AbortController();
    const pending = h.api.openOwnerReconnect(requestLink, ORIGIN, signal.signal);
    const rejected = assert.rejects(
      pending,
      (e) => e.code === (abort ? "cancelled" : "request_timeout"),
    );
    if (abort) signal.abort();
    else [...h.timers.values()][0]();
    await rejected;
    assert.equal(h.peer.closed, true);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.window.opener, null);
  }
});
