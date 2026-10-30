const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");
const {
  catalogue,
  channels,
  stocks,
  contracts: resourceContracts,
} = require("./resource-library-helpers.cjs");

const CONTRACT = "folioview.agent-workspace.v2.0";
const settle = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
};
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function compile(file, imports = {}, globals = {}) {
  const filename = path.resolve(__dirname, file);
  const { code } = transformSync(readFileSync(filename, "utf8"), {
    filename,
    jsc: {
      parser: { syntax: "typescript", tsx: filename.endsWith("tsx") },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), "Unexpected flow import " + name);
      return imports[name];
    },
    Response,
    AbortController,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    URLSearchParams,
    Intl,
    ...globals,
  });
  return module.exports;
}
function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return null;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
function eventTarget() {
  const events = new Map();
  return {
    addEventListener(name, callback) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(callback);
    },
    removeEventListener: (name, callback) => events.get(name)?.delete(callback),
    emit(name) {
      for (const callback of [...(events.get(name) || [])]) callback();
    },
  };
}
function hooks() {
  let index = 0;
  const cells = [],
    effects = [];
  const changed = (a, b) => !a || a.length !== b.length || b.some((v, n) => v !== a[n]);
  let dirty = false;
  const react = {
    useState(initial) {
      const slot = index++;
      cells[slot] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        cells[slot].value,
        (next) => {
          const value = typeof next === "function" ? next(cells[slot].value) : next;
          dirty ||= !Object.is(value, cells[slot].value);
          cells[slot].value = value;
        },
      ];
    },
    useRef(value) {
      const slot = index++;
      cells[slot] ??= { current: value };
      return cells[slot];
    },
    useCallback(callback, deps) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].deps, deps)) cells[slot] = { deps, value: callback };
      return cells[slot].value;
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].deps, deps)) effects.push({ slot, effect, deps });
    },
  };
  return {
    react,
    run(action, flush = true) {
      let value;
      for (let n = 0; n < 20; n++) {
        dirty = false;
        index = 0;
        value = action();
        if (flush)
          for (const e of effects.splice(0)) {
            cells[e.slot]?.cleanup?.();
            cells[e.slot] = { deps: e.deps, cleanup: e.effect() };
          }
        if (!flush || !dirty) return value;
      }
      assert.fail("Flow hook effects did not settle");
    },
    close() {
      for (const cell of cells) cell?.cleanup?.();
    },
  };
}
const metadata = (resultId, connectionId, revision = 1) => ({
  resultId,
  taskId: "task_synthetic_daily",
  runId: "run_" + resultId,
  revision,
  deliveryRevision: 1,
  envelopeFingerprint: String(revision).repeat(64),
  connectionId,
  receivedAt: "2026-10-30T10:00:00Z",
  taskVersion: 1,
  stateVersion: 0,
  read: false,
  starred: false,
  archived: false,
  manifestId: "manifest_" + resultId,
  keyEpoch: 1,
});

/**
 * Compose the shipped Dashboard, useWatchlist, useResourceLibrary, InboxPanel and
 * useInbox with one owner workspace. Hooks/window/HTTP and the decryptor are
 * explicit synthetic facades: this checks orchestration, not native React/DOM,
 * Firebase, server authorization or cryptography (covered in the crypto suite).
 */
function flow({ hash = "", search = "", owner = "A:1", locked = false, hidden = false } = {}) {
  const pageHooks = hooks(),
    inboxHooks = hooks(),
    libraryHooks = hooks();
  const windows = eventTarget(),
    documents = eventTarget(),
    intervals = new Map(),
    timers = new Map();
  let serial = 0,
    visible = !hidden,
    active = "markets",
    asyncOpen = null,
    transport = null;
  const location = { origin: "http://localhost", pathname: "/", search, hash };
  const window = {
    ...windows,
    location,
    history: {
      replaceState(_state, _title, value) {
        const url = new URL(value, location.origin);
        Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash });
      },
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout(callback) {
      const id = ++serial;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval(callback) {
      const id = ++serial;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  };
  const document = {
    ...documents,
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
  };
  const shared = {
    owner,
    authenticated: Boolean(owner),
    authStatus: owner ? "authenticated" : "anonymous",
    phase: locked ? "locked" : "unlocked",
    vaultGeneration: 1,
    vaultConfigured: true,
    canWriteState: false,
    busy: null,
    error: "",
    lock() {
      shared.phase = "locked";
      shared.vaultGeneration++;
    },
    async refreshVault() {
      return { registryHistory: [{ checkpoint: {}, entries: [] }] };
    },
    async openResult(input) {
      opens.push({ owner: shared.owner, id: input.result.metadata.resultId });
      return asyncOpen ? asyncOpen(input) : privateContent(input.result.metadata);
    },
  };
  const calls = [],
    opens = [];
  const store = {
    A: {
      rows: [metadata("result_A1", "agent_A1"), metadata("result_A2", "agent_A2")],
      list: stocks(),
    },
    B: { rows: [metadata("result_B1", "agent_B1")], list: stocks("OTHER") },
  };
  function privateContent(meta) {
    return {
      title: `PRIVATE_${meta.resultId}_revision_${meta.revision}`,
      summary: "PRIVATE_SYNTHETIC_SUMMARY",
      sections: [{ sectionId: "risk", markdown: "PRIVATE_SYNTHETIC_BODY" }],
      citations: [],
      limitations: [],
    };
  }
  const requestPrivate = async (service, route, sessionKey, options = {}) => {
    assert.equal(sessionKey, shared.owner, "Only the current owner may start a request");
    calls.push({ service, route, owner: sessionKey, options });
    if (transport) {
      const supplied = await transport({ service, route, sessionKey, options });
      if (supplied !== undefined) return supplied;
    }
    const current = store[sessionKey.split(":")[0]];
    if (service === "user" && route.startsWith("/api/v1/watchlist")) {
      if (options.method === "PUT")
        current.list.items.push(stocks(route.split("/").at(-1)).items[0]);
      return response(current.list);
    }
    if (route === "/api/v1/channel-follows") return response(channels());
    if (route === "/api/v2/resources/catalogue") return response(catalogue());
    const rows = current.rows;
    if (route.startsWith("/api/v2/results?"))
      return response({ contractVersion: CONTRACT, items: rows, nextCursor: null });
    if (route === "/api/v2/results/counts")
      return response({
        contractVersion: CONTRACT,
        profile: "folioview.owner-result-counts.v1",
        asOf: "2026-10-30T10:00:00Z",
        counts: {
          all: rows.length,
          unread: rows.length,
          starred: 0,
          archived: 0,
          total: rows.length,
        },
      });
    const id = /^\/api\/v2\/results\/([^/?]+)/.exec(route)?.[1];
    const row = rows.find((candidate) => candidate.resultId === id);
    if (!row) return response({ code: "not_found" }, 404);
    const revision =
      Number(new URL(route, location.origin).searchParams.get("revision")) || row.revision;
    if (/\/evidence$/.test(route))
      return response({
        contractVersion: CONTRACT,
        profile: "folioview.owner-result-evidence.v1",
        receipt: { receivedAt: row.receivedAt },
        manifest: { entries: [] },
        authorProof: { registrySequence: 1 },
        registryProofs: [
          {
            registrySequence: 1,
            checkpointDigest: "a".repeat(64),
            path: `/api/v2/results/${id}/revisions/${/\/revisions\/(\d+)/.exec(route)[1]}/registries/1`,
          },
        ],
      });
    if (/\/revisions\?/.test(route))
      return response({
        contractVersion: CONTRACT,
        items: [row, { ...row, revision: 2, envelopeFingerprint: "2".repeat(64) }],
        nextCursor: null,
      });
    return response({
      contractVersion: CONTRACT,
      metadata: { ...row, revision, envelopeFingerprint: String(revision).repeat(64) },
      signedObject: { protected: "opaque", payload: "ciphertext", signature: "synthetic" },
      keyProofs: {},
    });
  };
  const auth = {
    useAuth: () => ({
      status: shared.authenticated ? "authenticated" : "anonymous",
      profile: shared.authenticated ? { uid: shared.owner?.split(":")[0] } : null,
      sessionKey: shared.owner,
      agentHubConfigured: true,
      requestPrivate,
    }),
  };
  const watchlistTypes = compile("../lib/watchlist.ts");
  const links = compile("../lib/inbox-link.ts", {}, { window });
  const inboxTypes = compile("../lib/inbox-types.ts");
  const useWatchlist = compile(
    "../components/useWatchlist.ts",
    {
      react: pageHooks.react,
      "@/components/AuthProvider": auth,
      "@/lib/watchlist": watchlistTypes,
    },
    { window },
  ).useWatchlist;
  const useResourceLibrary = compile(
    "../components/useResourceLibrary.ts",
    {
      react: libraryHooks.react,
      "@/components/AuthProvider": auth,
      "@/lib/resource-library": resourceContracts,
    },
    { window, document },
  ).useResourceLibrary;
  const useInbox = compile(
    "../components/useInbox.ts",
    { react: inboxHooks.react, "@/components/AuthProvider": auth, "@/lib/inbox-types": inboxTypes },
    { window, document },
  ).useInbox;
  const jsx = (type, props, key) => ({ type, props, key });
  const ResourcePanel = () => null,
    TasksPanel = () => null,
    AgentsPanel = () => null,
    Sidebar = () => null,
    WatchlistAction = () => null;
  const InboxPanel = compile(
    "../components/InboxPanel.tsx",
    {
      react: inboxHooks.react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next-intl": { useLocale: () => "en", useTranslations: () => (key) => key },
      "./useInbox": { useInbox },
      "./SafeReportMarkdown": { SafeReportMarkdown: () => null, reportLink: () => false },
      "@/lib/inbox-link": links,
      "./InboxPanel.module.css": { __esModule: true, default: {} },
      "./PasskeyHelp": { PasskeyHelp: () => null },
    },
    { window, document },
  ).default;
  const noData = () => ({ data: null, loading: false, hasSettled: true, error: "" });
  const Dashboard = compile(
    "../app/page.tsx",
    {
      react: pageHooks.react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next-intl": { useLocale: () => "en", useTranslations: () => (key) => key },
      "@/components/PreferencesProvider": {
        usePreferences: () => ({ preferences: { defaultChartRange: "1m" }, resolvedTheme: "dark" }),
      },
      "@/components/SettingsPanel": { __esModule: true, default: () => null },
      "@/components/ResourcesPanel": { __esModule: true, default: ResourcePanel },
      "@/components/TasksPanel": { __esModule: true, default: TasksPanel },
      "@/components/AgentsPanel": { __esModule: true, default: AgentsPanel },
      "@/components/InboxPanel": { __esModule: true, default: InboxPanel },
      "@/components/useHoldingsWorkspace": { useHoldingsWorkspace: () => shared },
      "@/lib/ui-messages": { localizeMessage: (message) => message ?? "" },
      "@/lib/inbox-link": links,
      "@/components/CandlestickChart": { CandlestickChart: () => null },
      "@/components/InstrumentMetrics": { InstrumentMetrics: () => null },
      "@/components/WorkspaceSidebar": { WorkspaceSidebar: Sidebar },
      "@/components/useCachedMarketResource": { useCachedMarketResource: noData },
      "@/components/useMarketResource": { useMarketResource: noData },
      "@/components/PersonalWatchlist": { PersonalWatchlist: () => null, WatchlistAction },
      "@/components/useWatchlist": { useWatchlist },
      "@/components/useWatchlistQuotes": { useWatchlistQuotes: () => ({ quotes: {} }) },
      "@/components/WatchlistNotification": { WatchlistNotification: () => null },
      "@/lib/market-data": compile("../lib/market-data.ts"),
    },
    { window },
  ).default;
  let page, inbox, resources;
  const render = (flush = true) => {
    page = pageHooks.run(() => Dashboard(), flush);
    active = find(page, (n) => n.type === Sidebar).props.activeView;
    const props = find(page, (n) => n.type === InboxPanel).props;
    inbox = inboxHooks.run(() => InboxPanel(props), flush).props.model;
    resources = libraryHooks.run(
      () => useResourceLibrary({ active: active === "resources" }),
      flush,
    );
    return { page, inbox, resources, active };
  };
  return {
    shared,
    calls,
    opens,
    store,
    location,
    links,
    render,
    async ready() {
      render();
      await settle();
      return render();
    },
    async settle() {
      render();
      await settle();
      render();
      await settle();
      return render();
    },
    navigate(view) {
      find(page, (n) => n.type === Sidebar).props.onNavigate(view);
      return render();
    },
    panel(type) {
      return find(
        page,
        (n) =>
          n.type ===
          {
            resources: ResourcePanel,
            tasks: TasksPanel,
            agents: AgentsPanel,
            watchlist: WatchlistAction,
          }[type],
      ).props;
    },
    link(value, event = "hashchange") {
      location.hash = value;
      windows.emit(event);
      return render();
    },
    visible(next) {
      visible = next;
      documents.emit("visibilitychange");
      return render();
    },
    owner(next, unlocked = false) {
      shared.owner = next;
      shared.authenticated = Boolean(next);
      shared.authStatus = next ? "authenticated" : "anonymous";
      shared.phase = unlocked ? "unlocked" : next ? "locked" : "anonymous";
      shared.vaultGeneration++;
      return render();
    },
    unlock() {
      shared.phase = "unlocked";
      shared.vaultGeneration++;
      return render();
    },
    deferOpen(callback) {
      asyncOpen = callback;
    },
    transport(callback) {
      transport = callback;
    },
    poll() {
      for (const fn of [...intervals.values()]) fn();
    },
    close() {
      pageHooks.close();
      inboxHooks.close();
      libraryHooks.close();
      assert.equal(intervals.size, 0);
    },
  };
}

test("public result links are closed canonical fragments and OAuth handoff retains priority", async () => {
  const h = flow({ owner: null });
  assert.deepEqual(clone(h.links.readInboxResultLink("#inbox/result/result_A/revisions/2")), {
    resultId: "result_A",
    revision: 2,
  });
  for (const hash of [
    "#inbox/result/r\n",
    "#inbox/result/r\r\n",
    "#inbox/result/r/revisions/01",
    "#inbox/result/r/revisions/33",
    "#inbox/result/r?owner=A",
    "#inbox/result/%2fsecret",
    "#inbox/result/r/../x",
    "https://example.test/#inbox/result/r",
  ])
    assert.equal(h.links.readInboxResultLink(hash), null, hash);
  assert.equal(h.links.inboxResultHref("r\n", 1), null);
  assert.equal(h.render().active, "markets");
  h.location.search = "?agent_request=request_synthetic&agent_nonce=nonce_synthetic";
  assert.equal(h.link("#inbox/result/result_A1").active, "agents");
  await h.settle();
  assert.equal(h.opens.length, 0);
  h.close();
});

test("Market edits and resource discovery use the same owner source through the task and agent navigation", async () => {
  const h = flow();
  await h.ready();
  const originalWorkspace = h.shared;
  await h.panel("watchlist").watchlist.add("ADDED");
  await h.settle();
  h.navigate("resources");
  let state = await h.settle();
  assert.deepEqual(clone(state.resources.watchlist.data.items.map((row) => row.symbol)), [
    "SYNTH",
    "ADDED",
  ]);
  assert.deepEqual(clone(h.panel("watchlist").watchlist.items.map((row) => row.symbol)), [
    "SYNTH",
    "ADDED",
  ]);
  for (const group of state.resources.catalogue.data.groups) {
    state.resources.useForTask(group.items[0], h.panel("resources").onCreateTask);
    assert.equal(h.render().active, "tasks");
    const request = h.panel("tasks").request;
    assert.equal(request.owner, "A:1");
    assert.equal(request.binding.ref.kind, group.kind);
    assert.equal(h.panel("tasks").workspace, originalWorkspace);
    h.navigate("resources");
    state = await h.settle();
  }
  h.navigate("agents");
  assert.equal(h.panel("agents").workspace, originalWorkspace);
  h.navigate("inbox");
  await h.settle();
  assert.equal(h.shared, originalWorkspace);
  h.navigate("markets");
  assert.equal(h.render().active, "markets");
  h.close();
});

test("a direct locked link waits for unlock, keeps history exact and survives a memory lock", async () => {
  const h = flow({ hash: "#inbox/result/result_A1/revisions/2", locked: true });
  let state = await h.ready();
  assert.equal(state.active, "inbox");
  assert.equal(h.opens.length, 0);
  assert.ok(h.calls.every((call) => !/\/results\/result_/.test(call.route)));
  h.unlock();
  state = await h.settle();
  assert.equal(state.inbox.selected.metadata.revision, 2);
  assert.equal(state.inbox.selected.historical, true);
  assert.equal(state.inbox.selected.content.title, "PRIVATE_result_A1_revision_2");
  assert.ok(h.calls.every((call) => call.options.method !== "PATCH"));
  const unlockedWorkspace = h.shared;
  const direct = new URL("/" + h.links.inboxResultHref("result_A2", 1), h.location.origin);
  h.link(direct.hash);
  state = await h.settle();
  assert.equal(
    h.shared,
    unlockedWorkspace,
    "Same-document report navigation keeps the owner Worker",
  );
  assert.equal(state.inbox.selected.metadata.resultId, "result_A2");
  h.shared.lock();
  state = h.render(false);
  assert.equal(state.inbox.selected, null, "The render observing lock already masks plaintext");
  h.render();
  h.unlock();
  state = await h.settle();
  assert.equal(state.inbox.selected.metadata.revision, 1);
  assert.equal(state.inbox.selected.metadata.resultId, "result_A2");
  h.close();
});

test("hidden and inactive linked lookups resume once, while an explicit refresh retries a failed target", async () => {
  const h = flow({ hash: "#inbox/result/result_A1", hidden: true });
  await h.ready();
  assert.equal(h.opens.length, 0);
  h.visible(true);
  let state = await h.settle();
  assert.equal(state.inbox.selected.metadata.resultId, "result_A1");
  const late = deferred();
  h.deferOpen(() => late.promise);
  h.link("#inbox/result/result_A2");
  await settle();
  h.navigate("markets");
  late.resolve({
    title: "LATE_PRIVATE",
    summary: "",
    sections: [],
    citations: [],
    limitations: [],
  });
  await h.settle();
  assert.equal(h.render().active, "markets");
  h.deferOpen(null);
  h.link("#inbox/result/result_A2", "popstate");
  state = await h.settle();
  assert.equal(state.inbox.selected.metadata.resultId, "result_A2");
  h.link("#inbox/result/result_missing");
  state = await h.settle();
  assert.equal(state.inbox.error, "not_found");
  const count = () =>
    h.calls.filter((call) => call.route === "/api/v2/results/result_missing").length;
  assert.equal(count(), 1);
  for (let i = 0; i < 3; i++) h.render();
  assert.equal(count(), 1, "A missing link cannot become an effect retry loop");
  await state.inbox.reload();
  await h.settle();
  assert.equal(
    count(),
    2,
    "A user refresh can explicitly retry a linked result outside the loaded list",
  );
  h.close();
});

test("established-owner changes clear links and fence delayed content; initial anonymous links remain usable", async () => {
  const h = flow({ hash: "#inbox/result/result_A1", owner: null, locked: true });
  await h.ready();
  assert.equal(h.location.hash, "#inbox/result/result_A1");
  h.owner("A:1", true);
  let state = await h.settle();
  assert.equal(state.inbox.selected.metadata.connectionId, "agent_A1");
  await state.inbox.openResult("result_A2");
  state = await h.settle();
  assert.equal(state.inbox.selected.metadata.connectionId, "agent_A2");
  const late = deferred();
  h.deferOpen(() => late.promise);
  h.link("#inbox/result/result_A1");
  await settle();
  state = h.owner(null);
  assert.equal(state.inbox.selected, null);
  assert.equal(h.location.hash, "");
  h.owner("B:1", true);
  late.resolve({
    title: "PRIVATE_FROM_A",
    summary: "",
    sections: [],
    citations: [],
    limitations: [],
  });
  h.deferOpen(null);
  state = await h.settle();
  assert.equal(state.inbox.selected, null);
  assert.ok(state.inbox.items.every((item) => item.metadata.connectionId === "agent_B1"));
  const previousCalls = h.calls.length;
  h.render();
  await h.settle();
  assert.ok(h.calls.slice(previousCalls).every((call) => !/result_A/.test(call.route)));
  h.link("#inbox/result/result_A1");
  state = await h.settle();
  assert.equal(state.inbox.error, "not_found");
  assert.equal(state.inbox.selected, null);
  h.link("#inbox/result/result_B1");
  state = await h.settle();
  assert.equal(state.inbox.selected.metadata.connectionId, "agent_B1");
  h.close();
});

test("result arrivals preserve the active page and selection without portfolio synchronization", async () => {
  const h = flow();
  await h.ready();
  const count = h.calls.length;
  h.store.A.rows.unshift(metadata("result_A_new", "agent_A2"));
  h.poll();
  await h.settle();
  assert.equal(h.render().active, "markets");
  assert.equal(h.calls.length, count, "Hidden inbox has no polling work");
  h.navigate("inbox");
  let state = await h.settle();
  await state.inbox.openResult("result_A1");
  state = await h.settle();
  const selected = state.inbox.selected.content.title;
  h.store.A.rows.unshift(metadata("result_A_newer", "agent_A1"));
  h.poll();
  state = await h.settle();
  assert.equal(state.active, "inbox");
  assert.equal(state.inbox.selected.content.title, selected);
  assert.equal(state.inbox.notice, "new_results");
  assert.ok(h.calls.every((call) => call.service !== "portfolio"));
  assert.ok(
    h.calls.every((call) => !/sync|broker|wealthsimple|refresh-holdings/i.test(call.route)),
  );
  h.close();
});

test("logout discards the old intent but a new anonymous link can be opened by the next signed-in owner", async () => {
  const h = flow({ hash: "#inbox/result/result_A1" });
  await h.ready();
  await h.settle();
  h.owner(null);
  assert.equal(h.location.hash, "");
  h.link("#inbox/result/result_B1/revisions/2");
  await h.settle();
  assert.equal(h.location.hash, "#inbox/result/result_B1/revisions/2");
  h.owner("B:2", true);
  const state = await h.settle();
  assert.equal(h.location.hash, "#inbox/result/result_B1/revisions/2");
  assert.equal(state.inbox.selected.metadata.resultId, "result_B1");
  assert.equal(state.inbox.selected.metadata.revision, 2);
  assert.equal(state.inbox.selected.metadata.connectionId, "agent_B1");
  h.close();
});
