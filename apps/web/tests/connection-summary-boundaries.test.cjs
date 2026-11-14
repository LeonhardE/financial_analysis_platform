const assert = require("node:assert/strict"),
  test = require("node:test");
const { stack, response, CONTRACT, HUB } = require("./full-flow-boundaries-helpers.cjs");
const { displayBody } = require("./connection-display-fixtures.cjs");
const path = "/api/v3/provider-connections/vault_A/summary";
const provider = () => ({
  contractVersion: CONTRACT,
  profile: "folioview.provider-connection-slot.v1",
  slot: null,
  retainedSelections: [],
  retirementCandidates: [],
  legacyBlockers: [],
  requiresFreshGrants: true,
});
function summary() {
  return {
    contractVersion: CONTRACT,
    profile: "folioview.provider-connection-summary.v1",
    vaultId: "vault_A",
    connections: [
      {
        connectionId: "connection_A",
        clientId: "client_A",
        vaultId: "vault_A",
        provider: "muse",
        status: "active",
        accountState: "connecting",
        linkedAt: 1000,
      },
    ],
    providers: { muse: provider(), chatgpt: provider() },
    credentials: [
      {
        connectionId: "connection_A",
        state: {
          contractVersion: CONTRACT,
          profile: "folioview.agent-credential.v1",
          identity: null,
          binding: null,
          lease: null,
          approval: null,
          status: "reauthorization_required",
          defaultValiditySeconds: 7776000,
          noticeSeconds: 604800,
        },
      },
    ],
  };
}
test("one actual signed browser GET crosses the Next proxy with unchanged nested DTOs and no private selectors", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_summary_owner");
  const expected = summary();
  b.setUpstream((url, init) => {
    assert.equal(url, HUB + path);
    assert.equal(b.subject(init), "synthetic_summary_owner");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get("x-folioview-contract"), CONTRACT);
    return response(expected);
  });
  const r = await owner.value.requestPrivate("agent-hub", path, owner.value.sessionKey, {
    headers: { "X-FolioView-Contract": CONTRACT },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), expected);
  assert.equal(b.producerCalls().length, 1);
  const sent = b.producerCalls().length;
  for (const [route, options] of [
    [path + "?owner=other", {}],
    [path, { method: "POST", json: {} }],
    [path, { headers: { "X-FolioView-Delegation": "foreign" } }],
  ])
    await assert.rejects(
      owner.value.requestPrivate("agent-hub", route, owner.value.sessionKey, options),
    );
  assert.equal(b.producerCalls().length, sent);
  assert.equal(b.logs.length, 0);
});
test("the actual proxy refuses partial, foreign, duplicate and nested malformed summary replies", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_summary_owner");
  for (const mutate of [
    (v) => v.credentials.pop(),
    (v) => v.credentials.push(structuredClone(v.credentials[0])),
    (v) => v.connections.push(structuredClone(v.connections[0])),
    (v) => (v.vaultId = "foreign_vault"),
    (v) => (v.providers.muse.privateKey = "FORBIDDEN"),
    (v) =>
      v.providers.chatgpt.retainedSelections.push({
        taskId: "task_A",
        taskVersion: 1,
        executionEpoch: 1,
        grantFingerprint: "a".repeat(64),
        resourceIds: [],
        secret: "FORBIDDEN",
      }),
    (v) => (v.credentials[0].state.extra = "FORBIDDEN"),
    (v) => {
      v.credentials[0].state.identity = {
        ownerSubject: "owner_A",
        vaultId: "vault_A",
        connectionId: "connection_A",
        clientId: "client_A",
        secret: "FORBIDDEN",
      };
      v.credentials[0].state.binding = { protected: "YQ", payload: "Yg", signature: "Yw" };
    },
  ]) {
    const value = summary();
    mutate(value);
    b.setUpstream(() => response(value));
    const r = await owner.value.requestPrivate("agent-hub", path, owner.value.sessionKey, {
      headers: { "X-FolioView-Contract": CONTRACT },
    });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.ok(!JSON.stringify(await r.json()).includes("FORBIDDEN"));
  }
});

test("the actual Owner proxy preserves complete display and the closed separate hint", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_display_owner");
  const route = path.replace(/summary$/, "display");
  for (const mode of ["complete", "separate"]) {
    const expected = displayBody(summary(), mode);
    b.setUpstream((url, init) => {
      assert.equal(url, HUB + route);
      assert.equal(init.method, "GET");
      return response(expected);
    });
    const r = await owner.value.requestPrivate("agent-hub", route, owner.value.sessionKey, {
      headers: { "X-FolioView-Contract": CONTRACT },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), expected);
  }
});

test("display rejects partial hints foreign vaults unknown capability fields and invalid nested vault DTOs", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_display_owner");
  const route = path.replace(/summary$/, "display");
  for (const mutate of [
    (v) => (v.mode = "invented"),
    (v) => (v.summary = null),
    (v) => {
      v.mode = "separate";
      v.vaultResponse = null;
    },
    (v) => (v.vaultResponse.vault.vaultId = "foreign_vault"),
    (v) => (v.vaultResponse.vault.rootJwk.d = "FORBIDDEN"),
    (v) => (v.vaultResponse.vault.archive.privateKey = "FORBIDDEN"),
    (v) => (v.capabilities.agents.nativeScheduleAttested = true),
    (v) => (v.capabilities.account.runtimeReady = true),
    (v) => (v.capabilities.credentials.defaultValiditySeconds = 900),
    (v) => v.summary.credentials.pop(),
  ]) {
    const value = displayBody(summary());
    mutate(value);
    b.setUpstream(() => response(value));
    const r = await owner.value.requestPrivate("agent-hub", route, owner.value.sessionKey, {
      headers: { "X-FolioView-Contract": CONTRACT },
    });
    assert.equal(r.status, 503);
    assert.ok(!JSON.stringify(await r.json()).includes("FORBIDDEN"));
  }
});
