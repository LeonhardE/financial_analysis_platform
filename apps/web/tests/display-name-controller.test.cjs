const test = require("node:test"),
  assert = require("node:assert/strict");
const { hooks } = require("./resource-ui-harness.cjs"),
  { compile, response, settle, deferred, ref } = require("./resource-library-helpers.cjs");
const C = "folioview.agent-workspace.v2.0",
  P = "folioview.private-display-name.v1";
const wrap = (data) => ({ contractVersion: C, profile: P, ...data });
function harness(transport) {
  const h = hooks(),
    calls = [],
    events = new Map(),
    packets = new Map();
  let owner = "A",
    active = true,
    configured = true,
    visible = true,
    locked = false,
    names = [{ state: { ref: ref("holdings", "source_synthetic") }, name: "FIRST" }],
    head = { name: "LATEST" };
  const r = ref("holdings", "source_synthetic");
  const workspace = () => ({
    owner,
    phase: locked ? "locked" : "unlocked",
    canWriteState: true,
    vault: { vaultId: "vault", rootKeyId: "root" },
    vaultGeneration: 1,
    sources: [{ resourceRef: r, sourceEpoch: 1 }],
    async refreshVault() {
      calls.push({ root: true });
    },
    async openDisplayNames(refs, items) {
      return items.map((item) => ({ ref: item.state.ref, name: item.name, state: item.state }));
    },
    async openDisplayName(ref, item) {
      return { ref, name: item?.name, state: item?.state };
    },
    async loadDisplayNamePending() {
      return packets.get(owner) ?? null;
    },
    async prepareDisplayName({ ref, name }) {
      const packet = { ref, operationId: "op", body: { CIPHERTEXT: true } };
      packets.set(owner, packet);
      calls.push({ prepared: name });
      return packet;
    },
    async discardDisplayNamePending(_ref, operationId) {
      assert.equal(packets.get(owner)?.operationId, operationId);
      packets.delete(owner);
      calls.push({ discarded: operationId });
    },
    async finishDisplayNamePending(_ref, value) {
      assert.equal(value.item.state.stableOperationId, "op");
      packets.delete(owner);
    },
  });
  const { useDisplayNames } = compile(
    "../components/useDisplayNames.ts",
    {
      react: h.react,
      "./AuthProvider": {
        useAuth: () => ({
          status: "authenticated",
          agentHubConfigured: configured,
          sessionKey: owner,
          requestPrivate: async (service, path, key, options) => {
            const call = { service, path, key, options };
            calls.push(call);
            const custom = transport && (await transport(call));
            if (custom !== undefined) return custom;
            if (path.endsWith("capabilities"))
              return response(wrap({ enabled: true, maxSources: 10, maxNameLength: 80 }));
            if (path.endsWith("commands") || path.includes("operations/"))
              return response(
                wrap({ item: { name: "ORIGINAL", state: { stableOperationId: "op" } } }),
              );
            if (path.endsWith("/holdings")) return response(wrap({ items: names }));
            return response(wrap({ item: head }));
          },
        }),
      },
    },
    {
      document: {
        get visibilityState() {
          return visible ? "visible" : "hidden";
        },
        addEventListener: (k, v) => events.set(k, v),
        removeEventListener: (k) => events.delete(k),
      },
      setTimeout,
      clearTimeout,
      Object,
      JSON,
      Date,
    },
  );
  const render = () => h.render(() => useDisplayNames(workspace(), active));
  return {
    render,
    calls,
    packets,
    r,
    close: h.close,
    active: (v) => (active = v),
    owner: (v) => (owner = v),
    capability: (v) => (configured = v),
    lock: (v) => (locked = v),
    visibility(v) {
      visible = v;
      events.get("visibilitychange")?.();
    },
    head: (v) => (head = v),
    async ready() {
      render();
      for (let i = 0; i < 8; i++) {
        await settle();
        render();
      }
      return render();
    },
  };
}
test("names load once across navigation, remain scoped to unlocked visible Owner, and never auto-submit", async () => {
  const h = harness();
  try {
    let m = await h.ready();
    assert.equal(m.name(h.r), "FIRST");
    const reads = h.calls.length;
    h.active(false);
    h.render();
    h.active(true);
    await h.ready();
    assert.equal(h.calls.length, reads);
    h.visibility(false);
    assert.equal(h.render().name(h.r), null);
    h.visibility(true);
    await h.ready();
    h.owner("B");
    assert.equal(h.render().name(h.r), null);
    await h.ready();
    assert.ok(h.calls.filter((c) => c.key === "B").length);
    h.lock(true);
    assert.equal(h.render().name(h.r), null);
    assert.equal(h.calls.filter((c) => c.options?.method === "POST").length, 0);
  } finally {
    h.close();
  }
});
test("unknown save keeps the original packet; explicit recovery labels from latest head instead of old original receipt", async () => {
  let reject = true;
  const h = harness((call) => {
    if (call.path.endsWith("commands") && reject) throw Error("lost response");
  });
  try {
    let m = await h.ready();
    assert.equal(await m.rename(h.r, "NEW"), false);
    m = h.render();
    assert.equal(m.pending(h.r), true);
    const packet = h.packets.get("A");
    assert.equal(await m.rename(h.r, "OTHER"), false);
    assert.equal(h.packets.get("A"), packet);
    reject = false;
    assert.equal(await h.render().recover(h.r), true);
    m = h.render();
    assert.equal(m.name(h.r), "LATEST");
    assert.equal(m.pending(h.r), false);
    assert.equal(h.calls.filter((c) => c.options?.method === "POST").length, 1);
    assert.equal(h.calls.filter((c) => c.prepared).length, 1);
  } finally {
    h.close();
  }
});
test("late reads cannot overwrite a completed rename or escape an account change", async () => {
  const gate = deferred();
  let delay = false;
  const h = harness((call) =>
    delay && call.path.endsWith("/holdings") ? gate.promise : undefined,
  );
  try {
    await h.ready();
    delay = true;
    const old = h.render().reload();
    await settle();
    const renamed = h.render().rename(h.r, "NEW");
    await renamed;
    gate.resolve(response(wrap({ items: [{ name: "STALE", state: { ref: h.r } }] })));
    await old;
    assert.equal(h.render().name(h.r), "LATEST");
    delay = false;
    h.owner("B");
    assert.equal(h.render().name(h.r), null);
  } finally {
    h.close();
  }
});
test("closed response contracts and missing capability prevent names without breaking holdings", async () => {
  const h = harness((call) =>
    call.path.endsWith("capabilities")
      ? response(wrap({ enabled: true, maxSources: 10, maxNameLength: 80, plaintext: "BAD" }))
      : undefined,
  );
  try {
    const m = await h.ready();
    assert.equal(m.error, "invalid_response");
    assert.equal(m.enabled, false);
    h.capability(false);
    const before = h.calls.length;
    await h.ready();
    assert.equal(h.calls.length, before);
    assert.equal(h.render().scope, null);
  } finally {
    h.close();
  }
});

test("explicit local recovery checks original result first, clears only that packet, and reads current without a POST", async () => {
  const h = harness((call) => {
    if (call.path.endsWith("commands")) throw Error("lost");
    if (call.path.includes("/operations/")) return response({}, 404);
  });
  try {
    await h.ready();
    await h.render().rename(h.r, "Unknown");
    assert.equal(h.render().pending(h.r), true);
    const writes = h.calls.filter((c) => c.options?.method === "POST").length;
    assert.equal(await h.render().discard(h.r), true);
    assert.equal(h.render().pending(h.r), false);
    assert.equal(h.render().name(h.r), "LATEST");
    assert.equal(h.calls.filter((c) => c.discarded).length, 1);
    assert.equal(h.calls.filter((c) => c.options?.method === "POST").length, writes);
  } finally {
    h.close();
  }
});
