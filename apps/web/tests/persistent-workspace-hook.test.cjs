const assert = require("node:assert/strict"),
  test = require("node:test");
const { compile, contracts: resources } = require("./resource-library-helpers.cjs");
const types = compile("../lib/task-types.ts"),
  controller = compile(
    "../lib/persistent-experience-controller.ts",
    { "./resource-library": resources, "./task-types": types },
    { Map, Set, Date },
  );
const tick = () => new Promise((r) => setImmediate(r));
function harness() {
  let owner = "owner_A:login1",
    visible = true,
    index = 0,
    dirty = false;
  const cells = [],
    effects = [],
    events = new Map(),
    timers = new Map();
  let nextTimer = 0;
  const changed = (a, b) => !a || b.some((v, i) => v !== a[i]);
  const react = {
    useState(initial) {
      const n = index++;
      cells[n] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        cells[n].value,
        (v) => {
          const next = typeof v === "function" ? v(cells[n].value) : v;
          dirty ||= !Object.is(next, cells[n].value);
          cells[n].value = next;
        },
      ];
    },
    useRef(value) {
      const n = index++;
      cells[n] ??= { current: value };
      return cells[n];
    },
    useCallback(f, deps) {
      const n = index++;
      if (!cells[n] || changed(cells[n].deps, deps)) cells[n] = { deps, value: f };
      return cells[n].value;
    },
    useEffect(f, deps) {
      const n = index++;
      if (!cells[n] || changed(cells[n].deps, deps)) effects.push({ n, f, deps });
    },
  };
  const calls = [];
  let unlocks = 0;
  const workspace = {
    owner,
    phase: "unlocked",
    vaultGeneration: 1,
    vault: { vaultId: "vault_A" },
    canWriteState: true,
    refreshVault: async () => workspace.vault,
    unlock: async () => {
      unlocks++;
    },
  };
  const requestPrivate = async (_service, path, _key, options) => {
    calls.push({ path, options });
    return Response.json(
      path.endsWith("/persistent-connections")
        ? { connections: [] }
        : path.includes("persistent-agents")
          ? { enrollmentEnabled: false, resourceConsentEnabled: false, executionEnabled: false }
          : { accountLinkEnabled: false },
    );
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: (e, f) => events.set(e, f),
    removeEventListener: (e) => events.delete(e),
  };
  const timer = (f) => {
    const n = ++nextTimer;
    timers.set(n, f);
    return n;
  };
  const hook = compile(
    "../components/usePersistentWorkspace.ts",
    {
      react,
      "./AuthProvider": {
        useAuth: () => ({
          status: owner ? "authenticated" : "anonymous",
          sessionKey: owner,
          agentHubConfigured: true,
          requestPrivate,
        }),
      },
      "@/lib/persistent-experience-controller": controller,
    },
    {
      document,
      setTimeout: timer,
      clearTimeout: (n) => timers.delete(n),
      setInterval: timer,
      clearInterval: (n) => timers.delete(n),
      Map,
      Set,
      Date,
    },
  );
  let model;
  function render(flush = true) {
    do {
      dirty = false;
      index = 0;
      model = hook.usePersistentWorkspace(
        workspace,
        "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
      );
      if (flush)
        for (const e of effects.splice(0)) {
          cells[e.n]?.cleanup?.();
          cells[e.n] = { deps: e.deps, cleanup: e.f() };
        }
    } while (flush && dirty);
    return model;
  }
  return {
    workspace,
    calls,
    cells,
    get unlocks() {
      return unlocks;
    },
    render,
    async settle() {
      for (let i = 0; i < 6; i++) {
        await tick();
        render();
      }
      return model;
    },
    setOwner(v, flush = false) {
      owner = v;
      workspace.owner = v;
      workspace.vaultGeneration++;
      return render(flush);
    },
    hide(flush = false) {
      visible = false;
      events.get("visibilitychange")?.();
      return render(flush);
    },
    close() {
      for (const c of cells) c?.cleanup?.();
      timers.clear();
    },
  };
}
test("late private work is rejected on logout/login generation change before effects run, without another unlock", async () => {
  const h = harness();
  try {
    h.render();
    await h.settle();
    let release;
    const waiting = new Promise((r) => (release = r));
    const original = h.render();
    let finished = false;
    const operation = original.execute(async (_controller, _api, assertCurrent) => {
      await waiting;
      assertCurrent();
      finished = true;
      return "PRIVATE_CANARY";
    });
    h.setOwner("owner_A:login2", false);
    release();
    assert.equal(await operation, null);
    assert.equal(finished, false);
    assert.equal(h.unlocks, 0);
    await h.settle();
    assert.equal(h.render().error, "");
  } finally {
    h.close();
  }
});
test("hidden pages mask private connection and task state immediately, abort work, and never prompt Passkey", async () => {
  const h = harness();
  try {
    h.render();
    await h.settle();
    const state = h.cells.find((c) => c?.value && Array.isArray(c.value.views));
    state.value = {
      ...state.value,
      scope: "owner_A:login1:1",
      tasks: [{ title: "PRIVATE_CANARY" }],
      views: [
        {
          connection: { connectionId: "connection_A" },
          identity: { private: "PRIVATE_CANARY" },
          policy: { permissions: [] },
          tasks: [{ title: "PRIVATE_CANARY" }],
          pending: true,
        },
      ],
    };
    assert.match(JSON.stringify(h.render(false).tasks), /PRIVATE_CANARY/);
    const hidden = h.hide(false);
    assert.equal(hidden.unlocked, false);
    assert.deepEqual(Array.from(hidden.tasks), []);
    assert.doesNotMatch(JSON.stringify(hidden.views), /PRIVATE_CANARY/);
    assert.equal(await hidden.execute(async () => assert.fail("hidden work")), null);
    assert.equal(h.unlocks, 0);
  } finally {
    h.close();
  }
});
