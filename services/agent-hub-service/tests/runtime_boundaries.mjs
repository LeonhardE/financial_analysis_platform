import assert from "node:assert/strict";
import { dueSlot } from "../runtime/dist/session.mjs";
import { NativeAccountBridge, checkedNativeCallback } from "../runtime/dist/account-bridge.mjs";
const actor = { ownerSubject: "synthetic_owner", vaultId: "synthetic_vault" };
const seconds = (value) => Date.parse(value) / 1000;
const delivery = {
  cadence: "daily",
  localTime: "23:55",
  timeZone: "America/Toronto",
  graceMinutes: 20,
};
const late = await dueSlot(actor, "task_A", delivery, seconds("2026-11-08T05:05:00Z"));
assert.equal(late.slot.localDate, "2026-11-07");
assert.equal(
  (await dueSlot(actor, "task_A", delivery, seconds("2026-11-08T05:10:00Z"))).triggerId,
  late.triggerId,
);
assert.equal(await dueSlot(actor, "task_A", delivery, seconds("2026-11-08T05:16:00Z")), null);
const fold = { ...delivery, localTime: "01:30", graceMinutes: 0 };
const first = await dueSlot(actor, "task_A", fold, seconds("2026-11-01T05:30:00Z"));
const second = await dueSlot(actor, "task_A", fold, seconds("2026-11-01T06:30:00Z"));
assert.equal(first.triggerId, second.triggerId);
assert.equal(
  await dueSlot(
    actor,
    "task_A",
    { ...delivery, cadence: "weekdays" },
    seconds("2026-11-08T04:55:00Z"),
  ),
  null,
);
assert.equal(
  await dueSlot(
    actor,
    "task_A",
    { ...fold, localTime: "02:30", graceMinutes: 120 },
    seconds("2026-03-08T08:00:00Z"),
  ),
  null,
);
await assert.rejects(() =>
  dueSlot(actor, "task_A", { ...delivery, timeZone: "Unknown/Invalid" }, 1000),
);
const handlers = new Map(),
  attached = [],
  requests = [],
  navigated = [];
const peer = {
  closed: false,
  postMessage: (message, origin, ports) => attached.push({ message, origin, ports }),
};
const host = {
  location: { origin: "https://synthetic-hub.example" },
  addEventListener: (name, fn) => handlers.set(name, fn),
  removeEventListener: (name) => handlers.delete(name),
  open: () => peer,
};
const config = {
  contractVersion: "folioview.agent-workspace.v2.0",
  runtimeVersion: "1.0.0",
  issuer: host.location.origin,
  ownerOrigins: ["https://synthetic-owner.example"],
  clients: [
    { clientId: "muse_synthetic", redirectUris: ["https://synthetic-muse.example/callback"] },
  ],
};
const callback =
  "https://synthetic-muse.example/callback?code=synthetic_code&iss=https%3A%2F%2Fsynthetic-hub.example%2Foauth%2Fpersistent&state=synthetic_state";
for (const bad of [
  callback.replace("synthetic-muse", "evil-muse"),
  callback + "&code=second",
  callback.replace("oauth%2Fpersistent", "oauth%2Fwrong"),
  callback.replace("https://synthetic-muse", "https://user@synthetic-muse"),
])
  assert.throws(() => checkedNativeCallback(bad, config, "muse_synthetic"));
const bridge = new NativeAccountBridge({
  config,
  requestId: "synthetic_native_request",
  host,
  navigate: (url) => navigated.push(url),
  fetchImpl: async (path, options) => {
    requests.push({ path, authorization: options.headers.Authorization });
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    const value = path.endsWith("/pending")
      ? {
          contractVersion: config.contractVersion,
          profile: "folioview.persistent-account.v1",
          requestId: "synthetic_native_request",
          clientId: "muse_synthetic",
          scope: "runtime:connect",
          authority: "account_link_only",
          vaultId: "synthetic_vault",
          status: "pending",
          expiresAt: 2000,
        }
      : { redirectTo: callback };
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  },
});
bridge.open(config.ownerOrigins[0]);
// Extract only the public request/nonce from the opened owner's URL.
bridge.close();
// Fresh bridge with the actual captured URL and strict source/origin/nonce handshake.
let opened;
host.open = (url) => {
  opened = new URL(url);
  return peer;
};
const secondBridge = new NativeAccountBridge({
  config,
  requestId: "synthetic_native_request",
  host,
  navigate: (url) => navigated.push(url),
  fetchImpl: async (path, options) => {
    requests.push({ path, authorization: options.headers.Authorization });
    assert.equal(options.credentials, "same-origin");
    return new Response(
      JSON.stringify(
        path.endsWith("/pending")
          ? {
              contractVersion: config.contractVersion,
              profile: "folioview.persistent-account.v1",
              requestId: "synthetic_native_request",
              clientId: "muse_synthetic",
              scope: "runtime:connect",
              authority: "account_link_only",
              vaultId: "synthetic_vault",
            }
          : { redirectTo: callback },
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  },
});
secondBridge.open(config.ownerOrigins[0]);
const data = {
  type: "fv-native-owner-ready",
  requestId: opened.searchParams.get("native_request"),
  nonce: opened.searchParams.get("native_nonce"),
};
const event = { isTrusted: true, source: peer, origin: config.ownerOrigins[0], ports: [], data };
handlers.get("message")({ ...event, isTrusted: false });
handlers.get("message")({ ...event, source: {} });
handlers.get("message")({ ...event, origin: "https://evil.example" });
assert.equal(attached.length, 0);
handlers.get("message")(event);
assert.equal(attached.length, 1);
const port = attached[0].ports[0];
port.start();
let serial = 0;
const invoke = (op, json) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("bridge_timeout")), 3000);
    port.once("message", (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    port.postMessage({
      id: "request_" + ++serial,
      profile: "folioview.native-account-bridge.v1",
      requestId: data.requestId,
      op,
      authorization: "synthetic.synthetic.synthetic",
      json,
    });
  });
const rejected = await invoke("tasks", { contractVersion: config.contractVersion });
assert.equal(rejected.ok, false);
assert.equal(requests.length, 0);
const pending = await invoke("pending", { contractVersion: config.contractVersion });
assert.equal(pending.ok, true);
const approval = await invoke("approve", {
  contractVersion: config.contractVersion,
  vaultId: "synthetic_vault",
});
assert.equal(approval.ok, true);
assert.equal(approval.value.authority, "account_link_only");
assert.equal(navigated[0], callback);
assert.equal(
  requests[0].path,
  "/api/v2/persistent-account-authorizations/synthetic_native_request/pending",
);
assert.equal(requests[1].path, requests[0].path.replace(/\/pending$/, "/approvals"));
assert.equal(JSON.stringify([pending, approval]).includes("synthetic_code"), false);
assert.equal(JSON.stringify([pending, approval]).includes("synthetic.synthetic.synthetic"), false);
secondBridge.close();
port.close();

// Exercise the actual checked Worker dispatcher, including malformed messages and
// attempts to call internal crypto/storage/network primitives.
const { IDBFactory } = await import("./fixtures/idb-runtime.mjs");
globalThis.indexedDB = new IDBFactory();
const replies = new Map();
let network = 0;
globalThis.fetch = async (url, options) => {
  network++;
  assert.equal(url, "https://synthetic-hub.example/agent/v3/runtime/config");
  assert.equal(options.credentials, "omit");
  return new Response(
    JSON.stringify({
      contractVersion: config.contractVersion,
      runtimeVersion: "1.0.0",
      issuer: "https://synthetic-hub.example",
      serverNow: 1000,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};
globalThis.self = {
  location: { origin: "https://synthetic-hub.example" },
  postMessage: (value) => {
    const resolve = replies.get(value.id);
    if (resolve) {
      replies.delete(value.id);
      resolve(value);
    }
  },
};
await import("../runtime/dist/worker.mjs");
let rpc = 0;
const dispatch = (op, args = {}) =>
  new Promise((resolve, reject) => {
    const id = "worker_" + ++rpc,
      timer = setTimeout(() => reject(Error("worker_timeout")), 2000);
    replies.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    self.onmessage({ data: { id, op, args } });
  });
for (const op of ["sign", "decrypt", "fetch", "exportKey", "profile", "transact"])
  assert.equal((await dispatch(op)).error, "invalid_operation");
assert.equal(network, 0);
assert.equal(
  (await dispatch("initialize", { ownerSubject: "unbound", url: "https://evil.example" })).error,
  "invalid_fields",
);
assert.equal(network, 1);
assert.equal((await dispatch("initialize", {})).error, "already_initialized");
assert.equal((await dispatch("tasks", { path: "https://evil.example" })).error, "invalid_fields");
console.log(JSON.stringify({ schedule: true, bridge: true, worker: true }));
