const test = require("node:test"),
  assert = require("node:assert/strict");
const { compile, settle } = require("./resource-library-helpers.cjs");
const CONTRACT = "folioview.agent-workspace.v2.0";
function harness({ pending = new Map(), transport, timers } = {}) {
  let owner = "owner_A",
    index = 0,
    dirty = false;
  const cells = [],
    effects = [],
    calls = [];
  const changed = (a, b) => !a || b.some((v, i) => v !== a[i]);
  const react = {
    useRef(v) {
      const n = index++;
      return (cells[n] ??= { current: v });
    },
    useState(v) {
      const n = index++;
      cells[n] ??= { value: typeof v === "function" ? v() : v };
      return [
        cells[n].value,
        (next) => {
          const value = typeof next === "function" ? next(cells[n].value) : next;
          dirty ||= !Object.is(value, cells[n].value);
          cells[n].value = value;
        },
      ];
    },
    useCallback(v, deps) {
      const n = index++;
      if (!cells[n] || changed(cells[n].deps, deps)) cells[n] = { deps, value: v };
      return cells[n].value;
    },
    useEffect(f, deps) {
      const n = index++;
      if (!cells[n] || changed(cells[n].deps, deps)) effects.push({ n, f, deps });
    },
  };
  const requestPrivate = async (_s, path, _o, options) => {
    calls.push({ path, options });
    const special = await transport?.(path, options, pending);
    if (special) return special;
    return Response.json(
      path.endsWith("capabilities")
        ? { enabled: true }
        : path.endsWith("/manual")
          ? { items: [] }
          : { contractVersion: CONTRACT, taskId: "task_A", rules: null, assignments: [] },
    );
  };
  const workspace = {
    owner,
    phase: "unlocked",
    canWriteState: true,
    vault: { vaultId: "vault_A" },
    vaultGeneration: 1,
    verifyTaskCenterState: async (s) => s,
    loadTaskCenterPending: async (t) => pending.get(t) ?? null,
    prepareTaskCenterControl: async (args) => {
      const p = {
        taskId: args.state.taskId,
        operationId: "center_01234567890123456789012345678901",
        action: args.action,
        body: {
          contractVersion: CONTRACT,
          command: { protected: "p", payload: "q", signature: "s" },
        },
      };
      pending.set(p.taskId, p);
      return p;
    },
    finishTaskCenterPending: async (t) => pending.delete(t),
  };
  const m = compile(
    "../components/useTaskCenter.ts",
    {
      react,
      "./AuthProvider": {
        useAuth: () => ({ status: "authenticated", sessionKey: owner, requestPrivate }),
      },
    },
    {
      Response,
      AbortController,
      setTimeout: timers
        ? (fn, ms) => {
            const id = {};
            timers.set(id, { fn, ms });
            return id;
          }
        : setTimeout,
      clearTimeout: timers ? (id) => timers.delete(id) : clearTimeout,
      setInterval,
      clearInterval,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      Date,
      document: { visibilityState: "visible" },
      crypto: require("node:crypto").webcrypto,
    },
  );
  const selected = { taskId: "task_A", taskVersion: 1 };
  function render() {
    let result,
      n = 0;
    do {
      assert.ok(n++ < 30, "render loop");
      dirty = false;
      index = 0;
      result = m.useTaskCenter(workspace, true, selected);
      for (const e of effects.splice(0)) {
        cells[e.n]?.cleanup?.();
        cells[e.n] = { deps: e.deps, cleanup: e.f() };
      }
    } while (dirty);
    return result;
  }
  return {
    pending,
    calls,
    workspace,
    render,
    async ready() {
      for (let n = 0; n < 4; n++) {
        render();
        await settle();
      }
      return render();
    },
    owner(v) {
      owner = v;
      workspace.owner = v;
      workspace.vaultGeneration++;
    },
    close() {
      for (const c of cells) c?.cleanup?.();
    },
  };
}
test("unknown task saves survive remount without an automatic replacement or resend", async () => {
  const pending = new Map();
  const transport = async (path, o, p) => {
    if (o.method === "POST") {
      assert.ok(p.has("task_A"), "encrypted outbox must precede transport");
      throw Error("lost response");
    }
  };
  const h = harness({ pending, transport });
  let m = await h.ready();
  await assert.rejects(m.command("task_A", "set_rules", null));
  assert.equal(pending.size, 1);
  h.close();
  const restored = harness({
    pending,
    transport: async (path) =>
      path.includes("/operations/") ? Response.json({ original: true }) : undefined,
  });
  m = await restored.ready();
  assert.ok(m.pending);
  assert.equal(restored.calls.filter((c) => c.options.method === "POST").length, 0);
  await m.recover("task_A");
  m = await restored.ready();
  assert.equal(m.pending, null);
  assert.equal(pending.size, 0);
  restored.close();
});
test("safe abandonment addresses the original operation with its signing-input fingerprint", async () => {
  const h = harness({
    transport: async (path, o) => {
      if (path.endsWith("/commands")) throw Error("offline");
      if (path.endsWith("/cancel")) {
        assert.match(o.json.fingerprint, /^[a-f0-9]{64}$/);
        return Response.json({ state: "cancelled" });
      }
    },
  });
  let m = await h.ready();
  await assert.rejects(m.command("task_A", "set_rules", null));
  m = await h.ready();
  await m.recover("task_A", false, true);
  assert.equal(h.pending.size, 0);
  assert.equal(h.calls.filter((c) => c.path.endsWith("/commands")).length, 1);
  h.owner("owner_B");
  m = h.render();
  assert.deepEqual(Object.keys(m.records), []);
  assert.equal(m.pending, null);
  h.close();
});

test("ignored command abort settles the UI and keeps its original pending packet without replay", async () => {
  const timers = new Map();
  const h = harness({
    timers,
    transport: async (_path, options) =>
      options.method === "POST" ? new Promise(() => {}) : undefined,
  });
  const model = await h.ready();
  const saving = model.command("task_A", "set_rules", null);
  const rejected = assert.rejects(saving, /request_timeout/);
  await settle();
  assert.equal(h.pending.size, 1);
  const timer = [...timers.values()].find((v) => v.ms === 14000);
  assert.ok(timer);
  timer.fn();
  await rejected;
  assert.equal(h.render().busy, false);
  assert.equal(h.pending.size, 1);
  await assert.rejects(h.render().command("task_A", "set_rules", null), /operation_pending/);
  await h.ready();
  assert.equal(h.calls.filter((c) => c.options.method === "POST").length, 1);
  h.close();
});

test("task state and manual progress read together but publish only after state verification", async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness({
    transport: async (path) => (path.endsWith("/tasks/task_A") ? blocked : undefined),
  });
  h.render();
  await settle();
  assert.ok(
    h.calls.some((call) => call.path.endsWith("/manual")),
    "independent progress read must not wait for the state body",
  );
  assert.equal(h.render().records.task_A, undefined);
  release(
    Response.json({ contractVersion: CONTRACT, taskId: "task_A", rules: null, assignments: [] }),
  );
  const m = await h.ready();
  assert.ok(m.records.task_A);
  h.close();
});
