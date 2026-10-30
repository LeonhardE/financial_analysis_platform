import test from "node:test";
import assert from "node:assert/strict";
import { OwnerConsentBridge, checkedCallback } from "../helper/dist/consent.mjs";
import { OwnerHelperBridge } from "../helper/dist/owner-helper.mjs";
const PROFILE = "folioview.owner-consent-bridge.v1",
  OWNER = "folioview.foreground-owner.v1",
  CONTRACT = "folioview.agent-workspace.v2.0";
const config = {
  profile: PROFILE,
  contractVersion: CONTRACT,
  issuer: "https://hub.example",
  ownerOrigins: ["https://web.example"],
  clients: [
    {
      clientId: "synthetic_muse",
      redirectUris: ["https://agent.meta.ai/api/hatch/oauth/callback"],
    },
  ],
};
const pending = {
  contractVersion: CONTRACT,
  provider: "muse",
  status: "pending",
  clientId: "synthetic_muse",
  scopes: ["tasks:read"],
  connectionId: "connection_synthetic_A",
  authorizationId: "authorization_synthetic_A",
  expiresAt: 1600,
  prepared: null,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fakeHost() {
  const listeners = new Map(),
    posted = [];
  const peer = { closed: false, postMessage: (...args) => posted.push(args) };
  const host = {
    location: { origin: config.issuer },
    opener: peer,
    open(url) {
      this.opened = url;
      return peer;
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name, fn) {
      if (listeners.get(name) === fn) listeners.delete(name);
    },
    emit(name, value) {
      listeners.get(name)?.({ isTrusted: true, ...value });
    },
  };
  host.top = host;
  return { host, peer, posted };
}
function receive(port) {
  return new Promise((resolve) => {
    port.onmessage = ({ data }) => resolve(data);
    port.start();
  });
}
async function consent(fetchImpl) {
  const f = fakeHost(),
    states = [],
    navigations = [];
  const bridge = new OwnerConsentBridge({
    config,
    requestId: "request_synthetic_A",
    host: f.host,
    fetchImpl,
    navigate: (url) => navigations.push(url),
    onState: (state) => states.push(state),
  });
  bridge.open(config.ownerOrigins[0]);
  const nonce = new URL(f.host.opened).searchParams.get("agent_nonce");
  f.host.emit("message", {
    origin: "https://attacker.example",
    source: f.peer,
    data: { type: "fv-owner-consent-ready", requestId: "request_synthetic_A", nonce },
    ports: [],
  });
  assert.equal(f.posted.length, 0);
  f.host.emit("message", {
    isTrusted: false,
    origin: config.ownerOrigins[0],
    source: f.peer,
    data: { type: "fv-owner-consent-ready", requestId: "request_synthetic_A", nonce },
    ports: [],
  });
  assert.equal(f.posted.length, 0);
  f.host.emit("message", {
    origin: config.ownerOrigins[0],
    source: f.peer,
    data: { type: "fv-owner-consent-ready", requestId: "request_synthetic_A", nonce },
    ports: [],
  });
  assert.equal(f.posted.length, 1);
  const port = f.posted[0][2][0];
  assert.deepEqual(f.posted[0][0], {
    type: "fv-owner-consent-attached",
    profile: PROFILE,
    requestId: "request_synthetic_A",
    nonce,
  });
  return { ...f, bridge, port, nonce, states, navigations };
}
function send(f, id, op, json, authorization = "aaa.bbb.ccc") {
  const response = receive(f.port);
  f.port.postMessage({
    id,
    profile: PROFILE,
    requestId: "request_synthetic_A",
    op,
    authorization,
    json,
  });
  return response;
}
test("actual consent MessageChannel adds one Bearer prefix to a raw JWT; wrong source/nonce cannot pair", async () => {
  const requests = [],
    f = await consent(async (url, options) => {
      requests.push({ url, options });
      return Response.json(pending);
    });
  try {
    const response = await send(f, "call_A", "claim", { contractVersion: CONTRACT });
    assert.deepEqual(Object.keys(response).sort(), ["data", "id", "ok"]);
    assert.equal(response.ok, true);
    assert.equal(response.data.connectionId, pending.connectionId);
    assert.equal(requests[0].url, "/api/v2/agent-authorizations/request_synthetic_A/claim");
    assert.equal(requests[0].options.headers.Authorization, "Bearer aaa.bbb.ccc");
    assert.equal(requests[0].options.credentials, "same-origin");
    assert.equal(requests[0].options.redirect, "error");
    const rejected = await send(
      f,
      "call_B",
      "claim",
      { contractVersion: CONTRACT },
      "Bearer aaa.bbb.ccc",
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.data.code, "invalid_message");
    assert.equal(requests.length, 1);
    f.host.emit("message", {
      origin: config.ownerOrigins[0],
      source: f.peer,
      data: { type: "fv-owner-consent-ready", requestId: "request_synthetic_A", nonce: f.nonce },
      ports: [],
    });
    assert.equal(f.posted.length, 1);
  } finally {
    f.bridge.close();
    f.port.close();
  }
});
test("401/403 reply immediately with closed safe data before the consent channel closes", async () => {
  for (const [status, code] of [
    [401, "session_expired"],
    [403, "insufficient_scope"],
  ]) {
    const f = await consent(async () =>
      Response.json({ debug: "DO_NOT_EXPOSE_TOKEN_OR_DIAGNOSTIC" }, { status }),
    );
    try {
      const result = await send(f, "call_A", "claim", { contractVersion: CONTRACT });
      assert.deepEqual(result, { id: "call_A", ok: false, data: { code } });
      assert.ok(f.states.includes("authorization_denied"));
      assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EXPOSE|aaa\.bbb/);
    } finally {
      f.bridge.close();
      f.port.close();
    }
  }
});
test("encrypted bridge requires exactly one signed grant and keeps OAuth code out of the Web port", async () => {
  const destination =
    "https://agent.meta.ai/api/hatch/oauth/callback?code=synthetic_code&state=synthetic_state&iss=https%3A%2F%2Fhub.example";
  const requests = [],
    f = await consent(async (url, options) => {
      requests.push({ url, options });
      return Response.json(url.endsWith("/decision") ? { redirectUri: destination } : pending);
    });
  try {
    await send(f, "call_A", "claim", { contractVersion: CONTRACT });
    const empty = await send(f, "call_B", "decision", {
      contractVersion: CONTRACT,
      decision: "approve",
      signedGrants: [],
    });
    assert.equal(empty.ok, false);
    assert.equal(requests.length, 1);
    const response = await send(f, "call_C", "decision", {
      contractVersion: CONTRACT,
      decision: "approve",
      signedGrants: [{ protected: "a", payload: "b", signature: "c" }],
    });
    assert.deepEqual(response, { id: "call_C", ok: true, data: { completed: true } });
    assert.equal(f.navigations[0], destination);
    assert.doesNotMatch(JSON.stringify(response), /code|redirectUri|synthetic_state/);
  } finally {
    f.bridge.close();
    f.port.close();
  }
});
test("registered callbacks reject open redirects, duplicate response fields and wrong issuers", () => {
  for (const url of [
    "https://attacker.example/callback?code=x&state=s&iss=https%3A%2F%2Fhub.example",
    "https://agent.meta.ai/api/hatch/oauth/callback?code=x&code=y&state=s&iss=https%3A%2F%2Fhub.example",
    "https://agent.meta.ai/api/hatch/oauth/callback?code=x&state=s&iss=https%3A%2F%2Fevil.example",
    "https://agent.meta.ai/api/hatch/oauth/callback?error=access_denied&state=s&iss=https%3A%2F%2Fhub.example#extra",
  ])
    assert.throws(() => checkedCallback(url, config, "synthetic_muse"));
});
test("busy consent calls remain single flight after a malformed concurrent request", async () => {
  let release;
  const first = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const f = await consent(async () => {
    calls++;
    return first;
  });
  try {
    const responses = [];
    f.port.onmessage = ({ data }) => responses.push(data);
    f.port.start();
    const message = (id) => ({
      id,
      profile: PROFILE,
      requestId: "request_synthetic_A",
      op: "claim",
      authorization: "aaa.bbb.ccc",
      json: { contractVersion: CONTRACT },
    });
    f.port.postMessage(message("call_A"));
    await tick();
    f.port.postMessage(message("call_B"));
    await tick();
    f.port.postMessage(message("call_C"));
    await tick();
    assert.equal(calls, 1);
    release(Response.json(pending));
    await tick();
    await tick();
    assert.equal(responses.filter((row) => row.ok === false).length, 2);
  } finally {
    f.bridge.close();
    f.port.close();
  }
});
test("owner-helper channel exposes only four public owner operations, keeps auth/receipt/model roles disjoint", async () => {
  const f = fakeHost(),
    calls = [],
    controller = {
      initialize: async (value) => {
        calls.push(["initialize", value]);
        return { publicOnly: true };
      },
      confirmDelivery: async (value) => {
        calls.push(["confirm", value]);
        return { state: "READY" };
      },
      status: () => ({ state: "READY", privateKeysPersistent: false }),
      lock: (reason) => calls.push(["lock", reason]),
    };
  const nonce = "A".repeat(43),
    bridge = new OwnerHelperBridge({
      host: f.host,
      config,
      controller,
      ownerOrigin: config.ownerOrigins[0],
      nonce,
    });
  const channel = new MessageChannel();
  try {
    assert.deepEqual(f.posted[0][0], { type: "fv-helper-owner-ready", profile: OWNER, nonce });
    f.host.emit("message", {
      origin: config.ownerOrigins[0],
      source: {},
      data: { type: "fv-helper-owner-attached", profile: OWNER, nonce },
      ports: [channel.port2],
    });
    f.host.emit("message", {
      isTrusted: false,
      origin: config.ownerOrigins[0],
      source: f.peer,
      data: { type: "fv-helper-owner-attached", profile: OWNER, nonce },
      ports: [channel.port2],
    });
    assert.notEqual(f.host.opener, null);
    f.host.emit("message", {
      origin: config.ownerOrigins[0],
      source: f.peer,
      data: { type: "fv-helper-owner-attached", profile: OWNER, nonce },
      ports: [channel.port2],
    });
    assert.equal(f.host.opener, null);
    const response = receive(channel.port1);
    channel.port1.postMessage({ id: "owner_A", profile: OWNER, op: "status", args: {} });
    assert.deepEqual(await response, {
      id: "owner_A",
      ok: true,
      data: { state: "READY", privateKeysPersistent: false },
    });
    for (const op of ["authenticate", "accept_receipt", "fetch", "privateKeyExport"]) {
      const answer = receive(channel.port1);
      channel.port1.postMessage({ id: "owner_" + op, profile: OWNER, op, args: {} });
      assert.equal((await answer).ok, false);
    }
    assert.equal(calls.length, 0);
  } finally {
    bridge.close();
    channel.port1.close();
    channel.port2.close();
  }
});
