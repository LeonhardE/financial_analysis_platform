const test = require("node:test"),
  assert = require("node:assert/strict");
const { compile } = require("./resource-library-helpers.cjs"),
  { hooks } = require("./resource-ui-harness.cjs");
const tick = () => new Promise(setImmediate);
function harness() {
  const h = hooks(),
    pending = [];
  const auth = {
    status: "authenticated",
    sessionKey: "owner_A",
    requestPrivate: (_s, _p, _o, options) =>
      new Promise((resolve) => pending.push({ resolve, options })),
  };
  const workspace = {
    owner: "owner_A",
    phase: "unlocked",
    vault: { vaultId: "vault_A" },
    vaultGeneration: 1,
  };
  const { useProviderConnections } = compile(
    "../components/useProviderConnections.ts",
    { react: h.react, "./AuthProvider": { useAuth: () => auth } },
    { setTimeout, clearTimeout },
  );
  const render = (active = true) => h.render(() => useProviderConnections(workspace, active));
  const resolve = (requests, ok = true) =>
    requests.forEach((p) =>
      p.resolve(
        Response.json(ok ? { profile: "folioview.provider-connection-slot.v1", slot: null } : {}, {
          status: ok ? 200 : 503,
        }),
      ),
    );
  return { ...h, render, pending, workspace, auth, resolve };
}
test("provider slots distinguish unloaded, completed empty, cached refresh, failure and retry", async () => {
  const h = harness();
  try {
    let m = h.render();
    assert.equal(m.loaded, false);
    assert.equal(m.loading, true);
    assert.equal(h.pending.length, 2);
    h.resolve(h.pending, false);
    await tick();
    m = h.render();
    assert.equal(m.loaded, false);
    assert.equal(m.error, true);
    assert.equal(m.loading, false);
    let retry = m.reload();
    h.resolve(h.pending.slice(2));
    await retry;
    m = h.render();
    assert.equal(m.loaded, true);
    assert.equal(m.error, false);
    const previous = m.states;
    retry = m.reload();
    m = h.render();
    assert.equal(m.loaded, true);
    assert.equal(m.loading, true);
    assert.equal(m.states, previous);
    h.resolve(h.pending.slice(4), false);
    await retry;
    m = h.render();
    assert.equal(m.loaded, true);
    assert.equal(m.error, true);
    assert.equal(m.states, previous);
    h.render(false);
    h.render(true);
    assert.equal(h.pending.length, 6, "revisiting does not refetch a fresh display snapshot");
  } finally {
    h.close();
  }
});
test("an old provider read cannot restore readiness across an unlock generation change", async () => {
  const h = harness();
  try {
    h.render();
    h.workspace.vaultGeneration++;
    let m = h.render();
    assert.equal(m.loaded, false);
    assert.equal(m.loading, true);
    assert.equal(h.pending[0].options.signal.aborted, true);
    h.resolve(h.pending.slice(0, 2));
    await tick();
    m = h.render();
    assert.equal(m.loaded, false);
    assert.equal(m.error, false);
    assert.equal(Object.keys(m.states).length, 0);
    h.resolve(h.pending.slice(2));
    await tick();
    m = h.render();
    assert.equal(m.loaded, true);
    assert.equal(m.error, false);
  } finally {
    h.close();
  }
});
