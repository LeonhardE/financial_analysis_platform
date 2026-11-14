const test = require("node:test"),
  assert = require("node:assert/strict");
const { compile } = require("./resource-library-helpers.cjs"),
  { hooks, jsx } = require("./resource-ui-harness.cjs");
const { types, overview, reader, inbox, providers } = require("./task-overview-helpers.cjs"),
  fixtures = require("./task-overview-fixtures.cjs");
const tick = () => new Promise((r) => setImmediate(r));
function harness({ count = 2, respond, open } = {}) {
  const ui = hooks(),
    calls = [],
    opens = [],
    events = new Map(),
    docEvents = new Map();
  let owner = "owner_A",
    active = true,
    visible = true,
    clock = Date.now(),
    current;
  class Clock extends Date {
    static now() {
      return clock;
    }
  }
  const workspace = {
    authenticated: true,
    owner,
    phase: "unlocked",
    vaultConfigured: true,
    vaultGeneration: 1,
    canWriteState: true,
    needsDeviceApproval: false,
    vault: { vaultId: "vault_A", version: 1 },
    listTaskDrafts: async () => [],
    listTaskOutbox: async () => [],
    openTask: async (p) => {
      opens.push(p.metadata.taskId);
      return open ? open(p) : { name: `Name ${p.metadata.taskId}` };
    },
  };
  const requestPrivate = async (service, path, key, options = {}) => {
    calls.push({ service, path, key, options });
    const custom = respond?.(path, options);
    if (custom !== undefined) return custom;
    const full = fixtures.body(options.json?.knownPacketVersions ? options.json : undefined, count);
    if (path.endsWith("/overview/query")) return Response.json(full);
    if (path === types.TASK_PACKET_QUERY)
      return Response.json(fixtures.batch(options.json.taskIds, full.tasks.items));
    if (path.includes("/tasks?")) return Response.json(full.tasks);
    if (path.endsWith("/persistent-connections")) return Response.json(full.connections);
    if (path.includes("persistent-results")) return Response.json(full.feeds.persistent);
    if (path.includes("results?"))
      return Response.json(path.includes("archived") ? full.feeds.archived : full.feeds.foreground);
    if (path.endsWith("capabilities")) return Response.json(full.capabilities);
    throw Error(`unexpected ${path}`);
  };
  const auth = {
    useAuth: () => ({
      status: "authenticated",
      profile: { uid: "uid_A" },
      sessionKey: owner,
      agentHubConfigured: true,
      requestPrivate,
    }),
  };
  const window = {
    location: { hash: "", pathname: "/tasks", search: "" },
    history: { replaceState() {} },
    setTimeout,
    clearTimeout,
    addEventListener: (n, f) => events.set(n, f),
    removeEventListener: (n) => events.delete(n),
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: (n, f) => {
      if (!docEvents.has(n)) docEvents.set(n, new Set());
      docEvents.get(n).add(f);
    },
    removeEventListener: (n, f) => docEvents.get(n)?.delete(f),
  };
  const globals = {
    window,
    document,
    Date: Clock,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto: require("node:crypto").webcrypto,
  };
  const localOverview = compile(
    "../lib/task-overview.ts",
    {
      "./task-types": types,
      "./task-overview-request": require("./task-overview-helpers.cjs").request,
      "./task-result-reader": reader,
      "./report-provider-attribution": providers,
      "./workspace-cache": compile("../lib/workspace-cache.ts"),
    },
    globals,
  );
  const tasks = compile(
    "../components/useTasks.ts",
    {
      react: ui.react,
      "@/components/AuthProvider": auth,
      "@/lib/task-overview": localOverview,
      "@/lib/task-types": types,
      "@/lib/task-forms": compile("../lib/task-forms.ts", { "./task-types": types }),
    },
    globals,
  );
  const center = compile(
    "../components/useTaskCenter.ts",
    { react: ui.react, "./AuthProvider": auth },
    globals,
  );
  const results = compile(
    "../components/useTaskResults.ts",
    {
      react: ui.react,
      "./AuthProvider": auth,
      "@/lib/report-provider-attribution": providers,
      "@/lib/inbox-link": { readInboxResultLink: () => null, clearInboxResultLink() {} },
      "@/lib/inbox-types": inbox,
      "@/lib/task-result-reader": reader,
    },
    globals,
  );
  const t = (key) => key;
  t.has = () => false;
  const view = compile(
    "../components/TaskCenterPanel.tsx",
    {
      react: ui.react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next-intl": { useLocale: () => "en", useTranslations: () => t },
      "@/lib/task-forms": compile("../lib/task-forms.ts", { "./task-types": types }),
      "@/lib/task-center-schedule": { nextCenterOccurrence: () => null },
      "@/lib/task-types": types,
      "./ReportDialog": { ReportDialog: () => null },
      "./WorkspaceFeedback": { InlineError: () => null, LoadingIndicator: () => null },
      "./TaskCenterPanel.module.css": { __esModule: true, default: {} },
    },
    globals,
  );
  const render = () =>
    ui.render(() => {
      const m = tasks.useTasks(workspace, { active, catalogueOnDemand: true, overview: true });
      const c = center.useTaskCenter(workspace, active, m.selected, m.overview);
      const r = results.useTaskResults(workspace, undefined, m, active, "", c, m.overview);
      const tree = view.TaskCenterView({ workspace, model: m, center: c, resultState: r, active });
      return (current = { m, c, r, tree });
    });
  return {
    workspace,
    calls,
    opens,
    render,
    async ready() {
      for (let i = 0; i < 8; i++) {
        render();
        await tick();
      }
      return render();
    },
    active(v) {
      active = v;
      return render();
    },
    owner(v) {
      owner = v;
      workspace.owner = v;
      workspace.vaultGeneration++;
      return render();
    },
    advance(ms) {
      clock += ms;
    },
    hide(v) {
      visible = !v;
      for (const set of docEvents.values()) for (const f of [...set]) f();
      return render();
    },
    close() {
      ui.close();
    },
    get current() {
      return current;
    },
  };
}
test("three real task hooks share one overview and inline names preserve true unread/provider attribution", async () => {
  const h = harness();
  try {
    const { m, c, r } = await h.ready();
    assert.equal(h.calls.length, 1);
    assert.ok(h.calls[0].path.endsWith("/overview/query"));
    assert.equal(h.calls[0].options.json.packetLimit, 4);
    assert.equal(h.opens.length, 2);
    assert.equal(m.listReady, true);
    assert.equal(Object.keys(m.taskNames).length, 2);
    assert.equal(c.capabilityState, "ready");
    assert.equal(r.complete, true);
    assert.equal(h.current.tree.props["data-load-state"], "ready");
    assert.equal(r.unreadCounts.task_1, 1);
    assert.equal(
      r.providerFor({ kind: "persistent", metadata: fixtures.body().feeds.persistent.items[0] }),
      "muse",
    );
  } finally {
    h.close();
  }
});
test("fresh route reentry uses zero requests and expired reentry sends known names without a new packet read", async () => {
  const h = harness();
  try {
    await h.ready();
    h.active(false);
    h.active(true);
    await h.ready();
    assert.equal(h.calls.length, 1);
    h.active(false);
    h.advance(30001);
    h.active(true);
    await h.ready();
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].options.json.knownPacketVersions.length, 2);
    assert.equal(h.opens.length, 2);
  } finally {
    h.close();
  }
});
test("explicit list refresh remains one request and report refresh four requests", async () => {
  const h = harness();
  try {
    let x = await h.ready();
    let start = h.calls.length;
    await x.m.reloadTasks();
    await h.ready();
    assert.equal(h.calls.length - start, 1);
    start = h.calls.length;
    await h.current.r.reload();
    await h.ready();
    assert.equal(h.calls.length - start, 4);
    assert.equal(h.calls.filter((c) => c.path.endsWith("/overview/query")).length, 1);
  } finally {
    h.close();
  }
});
test("budget null falls back only to the original packet query and slow local verification cannot finish names", async () => {
  const releases = [];
  const h = harness({
    respond: (path, o) => {
      if (path.endsWith("/overview/query")) {
        const b = fixtures.body(o.json);
        b.packets = null;
        return Response.json(b);
      }
    },
    open: (p) => new Promise((r) => releases.push(() => r({ name: `Name ${p.metadata.taskId}` }))),
  });
  try {
    let x = await h.ready();
    assert.equal(h.calls.length, 2);
    assert.equal(releases.length, 1);
    assert.equal(Object.keys(x.m.taskNames).length, 0);
    releases.shift()();
    await h.ready();
    releases.shift()();
    x = await h.ready();
    assert.equal(Object.keys(x.m.taskNames).length, 2);
    assert.equal(h.calls.length, 2);
  } finally {
    releases.forEach((f) => f());
    h.close();
  }
});
module.exports = { harness };

test("thirty-two names retain two verification workers and fetch only the seven non-inline four-packet suffixes", async () => {
  const h = harness({ count: 32 });
  try {
    let x = await h.ready();
    for (let i = 0; i < 16 && Object.keys(x.m.taskNames).length < 32; i++) x = await h.ready();
    assert.equal(Object.keys(x.m.taskNames).length, 32);
    assert.equal(h.opens.length, 32);
    assert.equal(h.calls.filter((c) => c.path === types.TASK_PACKET_QUERY).length, 7);
    assert.equal(h.calls.length, 8);
  } finally {
    h.close();
  }
});
test("receipt replay cannot extend freshness and new tasks are included despite all earlier names being known", async () => {
  let count = 2;
  const h = harness({
    respond: (path, o) =>
      path.endsWith("/overview/query") ? Response.json(fixtures.body(o.json, count)) : undefined,
  });
  try {
    await h.ready();
    for (let i = 0; i < 2; i++) {
      h.active(false);
      h.advance(10000);
      h.active(true);
      await h.ready();
    }
    assert.equal(h.calls.length, 1);
    count = 3;
    h.active(false);
    h.advance(11000);
    h.active(true);
    const x = await h.ready();
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].options.json.packetLimit, 4);
    assert.equal(h.calls[1].options.json.knownPacketVersions.length, 2);
    assert.equal(Object.keys(x.m.taskNames).length, 3);
    assert.equal(h.opens.length, 3);
  } finally {
    h.close();
  }
});
test("a bad nested packet rejects the entire overview before metadata capabilities feeds or names can complete", async () => {
  const h = harness({
    respond: (path, o) => {
      if (path.endsWith("/overview/query")) {
        const b = fixtures.body(o.json);
        b.packets.items[1].packet.metadata.taskId = "foreign_task";
        return Response.json(b);
      }
    },
  });
  try {
    const x = await h.ready();
    assert.equal(h.calls.length, 1);
    assert.equal(x.m.listReady, false);
    assert.equal(x.c.capabilityState, "error");
    assert.equal(x.r.ready, false);
    assert.notEqual(x.tree.props["data-load-state"], "ready");
    assert.equal(h.opens.length, 0);
  } finally {
    h.close();
  }
});
test("a feed cursor preserves partial real unread totals and all other cursors remain independent", async () => {
  const h = harness({
    respond: (path, o) => {
      if (path.endsWith("/overview/query")) {
        const b = fixtures.body(o.json);
        b.feeds.persistent.nextCursor = "pidx_" + "a".repeat(64) + ":1";
        return Response.json(b);
      }
    },
  });
  try {
    const x = await h.ready();
    assert.equal(x.r.ready, true);
    assert.equal(x.r.complete, false);
    assert.equal(x.r.partial, true);
    assert.notEqual(x.tree.props["data-load-state"], "ready");
    assert.equal(x.r.unreadCounts.task_1, 1);
    assert.equal(h.calls.length, 1);
    assert.equal(x.m.listReady, true);
  } finally {
    h.close();
  }
});
test("late overview responses cannot publish across an Owner switch or a hidden generation", async () => {
  for (const boundary of ["owner", "hidden"]) {
    let release,
      calls = 0;
    const gate = new Promise((r) => (release = r));
    const h = harness({
      respond: (path) =>
        path.endsWith("/overview/query")
          ? ++calls === 1
            ? gate
            : new Promise(() => {})
          : undefined,
    });
    try {
      h.render();
      await tick();
      assert.equal(h.calls.length, 1);
      if (boundary === "owner") h.owner("owner_B");
      else h.hide(true);
      release(Response.json(fixtures.body()));
      const x = await h.ready();
      assert.equal(x.m.listReady, false);
      assert.equal(x.r.ready, false);
      assert.equal(h.opens.length, 0);
    } finally {
      h.close();
    }
  }
});
test("slow original Worker verification remains globally bounded to two and cannot signal complete names", async () => {
  const releases = [];
  const h = harness({
    count: 8,
    open: (p) => new Promise((r) => releases.push(() => r({ name: p.metadata.taskId }))),
  });
  try {
    const x = await h.ready();
    assert.equal(releases.length, 2);
    assert.equal(Object.keys(x.m.taskNames).length, 0);
    assert.equal(x.m.loading, false);
    assert.equal(x.r.complete, true);
    assert.equal(x.tree.props["data-load-state"], "loading");
    assert.equal(h.calls.filter((c) => c.path.endsWith("/overview/query")).length, 1);
  } finally {
    h.active(false);
    releases.forEach((f) => f());
    await tick();
    h.close();
  }
});

test("explicit metadata refresh during an overview cannot replay old metadata or cancel independent report completion", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({ respond: (path) => (path.endsWith("/overview/query") ? gate : undefined) });
  try {
    h.render();
    await tick();
    const latest = h.current.m.reloadTasks();
    await latest;
    release(Response.json(fixtures.body()));
    const x = await h.ready();
    assert.equal(x.m.listReady, true);
    assert.equal(x.r.complete, true);
    assert.equal(x.c.capabilityState, "ready");
    assert.equal(h.calls.filter((c) => c.path.endsWith("/overview/query")).length, 1);
    assert.equal(h.calls.filter((c) => c.path.includes("/tasks?")).length, 1);
    assert.equal(x.m.overview.receipt, null, "superseded overview is not reusable cache");
  } finally {
    h.close();
  }
});
