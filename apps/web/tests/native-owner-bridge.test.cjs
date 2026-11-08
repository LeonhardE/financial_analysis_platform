const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { MessageChannel, MessagePort } = require("node:worker_threads");
const { compile, contracts, deferred, settle } = require("./agent-connections-helpers.cjs");
const ORIGIN = "https://agent-hub-api-123456789.northamerica-northeast2.run.app";
const PROFILE = "folioview.native-account-bridge.v1",
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
    "../lib/native-owner-bridge.ts",
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
            type: "fv-native-owner-attached",
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
  assert.equal(bridge.nativeHandoff(""), null);
  assert.equal(
    bridge.nativeHandoff(`?native_request=request_A&native_nonce=${"n".repeat(43)}`).requestId,
    "request_A",
  );
  for (const value of [
    "?native_request=request_A",
    `?native_request=request_A&native_nonce=${"n".repeat(43)}&token=CANARY`,
    `?native_request=request_A&native_request=request_B&native_nonce=${"n".repeat(43)}`,
    "?native_request=../other&native_nonce=bad",
  ])
    assert.throws(
      () => bridge.nativeHandoff(value),
      (error) => error.code === "invalid_handoff",
    );
});
test("origin/source/nonce-bound owner attachment severs opener before a bridge can receive a credential", async () => {
  const h = loadOwner(),
    channel = new MessageChannel();
  const connecting = h.bridge.connectNativeOwnerBridge(
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
  assert.equal(h.bridge.verifiedNativeBridge(bridge), true);
  const captured = [];
  channel.port2.onmessage = ({ data }) => {
    captured.push(data);
    channel.port2.postMessage({
      id: data.id,
      ok: true,
      value: {
        contractVersion: CONTRACT,
        profile: "folioview.persistent-account.v1",
        requestId: "request_A",
        clientId: "muse_client",
        scope: "runtime:connect",
        status: "pending",
        expiresAt: 1000,
        vaultId: "vault_A",
        authority: "account_link_only",
      },
    });
  };
  channel.port2.start();
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await bridge.request("pending", { contractVersion: CONTRACT }, "RAW.JWT.fixture"),
      ),
    ),
    {
      contractVersion: CONTRACT,
      profile: "folioview.persistent-account.v1",
      requestId: "request_A",
      clientId: "muse_client",
      scope: "runtime:connect",
      status: "pending",
      expiresAt: 1000,
      vaultId: "vault_A",
      authority: "account_link_only",
    },
  );
  assert.equal(captured[0].authorization, "RAW.JWT.fixture");
  assert.equal(captured[0].profile, PROFILE);
  assert.equal(captured[0].requestId, "request_A");
  assert.equal(captured[0].op, "pending");
  assert.doesNotMatch(JSON.stringify(h.ready), /RAW.JWT|token|privateKey/);
  bridge.close();
  channel.port2.close();
});
test("failure to sever opener rejects before branding or credential transport", async () => {
  const h = loadOwner({ fixedOpener: true }),
    channel = new MessageChannel();
  const connecting = h.bridge.connectNativeOwnerBridge(
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
    bridge = new h.bridge.NativeOwnerBridge(channel.port1, "request_A", ORIGIN);
  assert.equal(h.bridge.verifiedNativeBridge(bridge), false);
  await assert.rejects(bridge.request("pending", { contractVersion: CONTRACT }, "RAW.JWT.fixture"));
  assert.throws(() =>
    h.bridge.validateNativeCommand("decision", {
      contractVersion: CONTRACT,
      decision: "approve",
      signedGrants: [],
    }),
  );
  assert.throws(() =>
    h.bridge.validateNativeCommand("pending", {
      contractVersion: CONTRACT,
      url: "https://attacker.example",
    }),
  );
  assert.throws(() => h.bridge.validateNativeCommand("initialize", { contractVersion: CONTRACT }));
  bridge.close();
  channel.port2.close();
});

test("native account approval accepts only a vault locator and never financial scopes or keys", () => {
  const { bridge } = loadOwner();
  assert.doesNotThrow(() =>
    bridge.validateNativeCommand("approve", { contractVersion: CONTRACT, vaultId: "vault_A" }),
  );
  for (const body of [
    { contractVersion: CONTRACT, vaultId: "vault_A", approvedScopes: ["portfolio:read"] },
    { contractVersion: CONTRACT, redirectTo: "https://evil.test" },
    { contractVersion: CONTRACT, vaultId: "../other" },
  ])
    assert.throws(() => bridge.validateNativeCommand("approve", body));
});
