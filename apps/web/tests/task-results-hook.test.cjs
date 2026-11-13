const test = require("node:test"),
  assert = require("node:assert/strict");
const { compile } = require("./resource-library-helpers.cjs"),
  inbox = compile("../lib/inbox-types.ts"),
  cache = compile("../lib/workspace-cache.ts"),
  reader = compile("../lib/task-result-reader.ts", { "./inbox-types": inbox }),
  links = compile("../lib/inbox-link.ts", {}, { window: { location: { hash: "" } } });
const C = reader.RESULT_CONTRACT,
  tick = () => new Promise((r) => setTimeout(r, 3));
const meta = () => ({
  resultId: "presult_A",
  taskId: "task_A",
  runId: "run_A",
  connectionId: "connection_A",
  receivedAt: 1000,
  stateVersion: 0,
  read: false,
  starred: false,
  archived: false,
});
function harness({ transport } = {}) {
  let owner = "owner_A",
    index = 0,
    dirty = false,
    active = true,
    visible = true,
    metadata = meta();
  const cells = [],
    effects = [],
    calls = [],
    events = new Map(),
    docEvents = new Map();
  let signs = 0,
    decrypts = 0,
    hash = "";
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
          const v = typeof next === "function" ? next(cells[n].value) : next;
          dirty ||= !Object.is(v, cells[n].value);
          cells[n].value = v;
        },
      ];
    },
    useCallback(v, deps) {
      const n = index++;
      if (!cells[n] || changed(cells[n].deps, deps)) cells[n] = { value: v, deps };
      return cells[n].value;
    },
    useEffect(f, deps) {
      const n = index++;
      if (!cells[n] || changed(cells[n].deps, deps)) effects.push({ n, f, deps });
    },
  };
  const content = {
    title: "PRIVATE_REPORT",
    summary: "PRIVATE_SUMMARY",
    sections: [],
    limitations: [],
  };
  const workspace = {
    owner,
    phase: "unlocked",
    vaultGeneration: 1,
    canWriteState: true,
    vault: { vaultId: "vault_A", rootKeyId: "root_A", registryHistory: [] },
    openPersistentResult: async () => {
      decrypts++;
      return content;
    },
    signPersistentResultState: async ({ metadata, changes }) => {
      signs++;
      return {
        operationId: "original_state_operation_0001",
        authorKeyId: "author_A",
        command: { metadata, changes },
      };
    },
  };
  const model = {
    selected: { taskId: "task_A", taskVersion: 1 },
    busy: false,
    dirty: false,
    pending: null,
    async openTask(task) {
      model.selected = { taskId: task, taskVersion: 1 };
    },
    async reloadTasks() {},
  };
  const requestPrivate = async (_s, path, _o, o) => {
    calls.push({ path, options: o });
    const v = await transport?.(path, o, metadata);
    if (v !== undefined) return v;
    if (path.startsWith("/api/v3/task-center/")) return Response.json({ rules: null });
    if (path.startsWith("/api/v2/tasks/"))
      return Response.json({ metadata: { taskId: path.split("/").at(-1) } });
    if (path.startsWith("/api/v2/results?"))
      return Response.json({ contractVersion: C, items: [], nextCursor: null });
    if (path.includes("?limit="))
      return Response.json({
        contractVersion: C,
        profile: "folioview.persistent-content.v1",
        items: [metadata],
        nextCursor: null,
      });
    if (o.method === "PATCH") {
      assert.equal(o.headers["Idempotency-Key"], "original_state_operation_0001");
      metadata = {
        ...metadata,
        ...o.json.command.changes,
        stateVersion: metadata.stateVersion + 1,
      };
      return Response.json(metadata);
    }
    return Response.json({
      metadata,
      envelope: { ciphertext: "opaque" },
      manifest: {},
      identity: {},
      binding: {},
      receipt: {},
    });
  };
  const window = {
    location: {
      get hash() {
        return hash;
      },
      pathname: "/tasks",
      search: "",
    },
    history: {
      replaceState() {
        hash = "";
      },
    },
    addEventListener: (k, f) => events.set(k, f),
    removeEventListener: (k) => events.delete(k),
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: (k, f) => docEvents.set(k, f),
    removeEventListener: (k) => docEvents.delete(k),
  };
  const module = compile(
    "../components/useTaskResults.ts",
    {
      react,
      "./AuthProvider": {
        useAuth: () => ({ status: "authenticated", sessionKey: owner, requestPrivate }),
      },
      "@/lib/workspace-cache": cache,
      "@/lib/inbox-link": {
        ...links,
        clearInboxResultLink: () => {
          hash = "";
        },
      },
      "@/lib/inbox-types": inbox,
      "@/lib/task-result-reader": reader,
    },
    {
      window,
      document,
      Response,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      AbortController,
      setTimeout,
      clearTimeout,
      Date,
    },
  );
  function render() {
    let result,
      n = 0;
    do {
      assert.ok(n++ < 50, "render loop");
      dirty = false;
      index = 0;
      result = module.useTaskResults(
        workspace,
        {
          views: [
            { connection: { connectionId: "connection_A", provider: "muse", status: "revoked" } },
          ],
        },
        model,
        active,
      );
      for (const e of effects.splice(0)) {
        cells[e.n]?.cleanup?.();
        cells[e.n] = { deps: e.deps, cleanup: e.f() };
      }
    } while (dirty);
    return result;
  }
  return {
    render,
    workspace,
    model,
    calls,
    events,
    async ready() {
      for (let i = 0; i < 10; i++) {
        render();
        await tick();
      }
      return render();
    },
    stats: () => ({ signs, decrypts }),
    active(v) {
      active = v;
    },
    owner(v) {
      owner = v;
      workspace.owner = v;
      workspace.vaultGeneration++;
    },
    link(v) {
      hash = v;
      events.get("hashchange")?.();
    },
    hidden() {
      visible = false;
      docEvents.get("visibilitychange")?.();
    },
    close() {
      for (const c of cells) c?.cleanup?.();
    },
  };
}
test("title preload never marks read; presentation performs exactly one signed update, and history retains the original Agent", async () => {
  const h = harness();
  let m = await h.ready();
  assert.equal(m.title(m.rows[0]), "PRIVATE_REPORT");
  assert.equal(h.stats().signs, 0);
  assert.equal(m.unreadCounts.task_A, 1);
  assert.equal(m.providerFor(m.rows[0]), "muse");
  await m.open(m.rows[0]);
  m = h.render();
  assert.equal(h.stats().signs, 0);
  m.presented(m.detail);
  m = await h.ready();
  assert.equal(h.stats().signs, 1);
  assert.equal(m.unreadCounts.task_A, undefined);
  assert.equal(m.detail.row.metadata.read, true);
  assert.equal(h.stats().decrypts, 1);
  h.close();
});
test("returning to a loaded task preserves filters and avoids reloading metadata or decrypting titles", async () => {
  const h = harness();
  let m = await h.ready();
  m.setFilter({ actor: "muse", filter: "unread", query: "PRIVATE" });
  m = h.render();
  const calls = h.calls.length,
    decrypts = h.stats().decrypts;
  h.active(false);
  m = h.render();
  assert.equal(m.rows.length, 0);
  h.active(true);
  m = await h.ready();
  assert.equal(m.filters.query, "PRIVATE");
  assert.equal(h.calls.filter((c) => c.path.includes("?limit=")).length, 3);
  assert.equal(h.stats().decrypts, decrypts);
  assert.ok(h.calls.length >= calls);
  h.close();
});
test("unknown result-state writes retain the original signature and do not allow a replacement mutation", async () => {
  let lost = true;
  const h = harness({
    transport: async (path, o, metadata) => {
      if (o.method === "PATCH" && lost) {
        lost = false;
        throw Error("lost response");
      }
    },
  });
  let m = await h.ready();
  await m.open(m.rows[0]);
  m = h.render();
  await m.change(m.detail.row, { starred: true });
  m = h.render();
  assert.equal(m.pending, true);
  assert.equal(h.stats().signs, 1);
  await m.change(m.detail.row, { archived: true });
  assert.equal(h.stats().signs, 1);
  m.retryState();
  m = await h.ready();
  assert.equal(m.pending, false);
  assert.equal(h.stats().signs, 1);
  const writes = h.calls.filter((c) => c.options.method === "PATCH");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].options.json, writes[1].options.json);
  h.close();
});
test("lock and owner changes mask private titles/details immediately and ignore late work", async () => {
  const h = harness();
  let m = await h.ready();
  const row = m.rows[0];
  await m.open(row);
  h.workspace.phase = "locked";
  m = h.render();
  assert.equal(m.detail, null);
  assert.equal(m.rows.length, 0);
  assert.equal(m.title(row), null);
  h.owner("owner_B");
  m = h.render();
  assert.equal(m.detail, null);
  h.close();
});
test("legacy report links resolve the owning visible task before opening a modal", async () => {
  const h = harness();
  await h.ready();
  h.model.selected = { taskId: "task_B", taskVersion: 1 };
  h.link("#inbox/result/presult_A");
  const m = await h.ready();
  assert.equal(h.model.selected.taskId, "task_A");
  assert.equal(m.detail.row.metadata.resultId, "presult_A");
  assert.equal(h.stats().signs, 0);
  m.close();
  h.close();
});

test("read-only presentation does not consume the later ability to acknowledge a report", async () => {
  const h = harness();
  let m = await h.ready();
  await m.open(m.rows[0]);
  h.workspace.canWriteState = false;
  m = h.render();
  m.presented(m.detail);
  assert.equal(h.stats().signs, 0);
  h.workspace.canWriteState = true;
  m = h.render();
  m.presented(m.detail);
  await h.ready();
  assert.equal(h.stats().signs, 1);
  h.close();
});
