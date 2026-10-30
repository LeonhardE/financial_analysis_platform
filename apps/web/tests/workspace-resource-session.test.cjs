const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

function compile(file, imports) {
  const { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
    filename: file,
    jsc: {
      parser: { syntax: "typescript", tsx: file.endsWith(".tsx") },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in imports, name);
      return imports[name];
    },
  });
  return module.exports;
}
function find(tree, predicate, trail = [], parent = null) {
  if (!tree || typeof tree !== "object") return null;
  if (Array.isArray(tree)) {
    for (let index = 0; index < tree.length; index++) {
      const result = find(tree[index], predicate, [...trail, index], parent);
      if (result) return result;
    }
    return null;
  }
  if (predicate(tree)) return { tree, parent, trail };
  return find(tree.props?.children, predicate, [...trail, "children"], tree);
}

test("Market, Resources, Tasks and Inbox reuse one mounted encrypted owner workspace", () => {
  const cells = [];
  let index = 0;
  const ResourcePanel = () => null;
  const InboxPanel = () => null;
  const TasksPanel = () => null;
  const sharedWorkspace = { lock() {}, owner: "session_A", authenticated: true };
  let workspaceCalls = 0;
  const Sidebar = () => null;
  const noData = () => ({ data: null, loading: false, hasSettled: true, error: "" });
  const jsx = (type, props, key) => ({ type, props, key });
  const module = compile("../app/page.tsx", {
    react: {
      useState(initial) {
        const slot = index++;
        if (!(slot in cells)) cells[slot] = { value: initial };
        return [
          cells[slot].value,
          (next) => {
            cells[slot].value = typeof next === "function" ? next(cells[slot].value) : next;
          },
        ];
      },
      useRef(value) {
        const slot = index++;
        cells[slot] ??= { current: value };
        return cells[slot];
      },
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next-intl": { useLocale: () => "en", useTranslations: () => (key) => key },
    "@/components/PreferencesProvider": {
      usePreferences: () => ({ preferences: { defaultChartRange: "1m" }, resolvedTheme: "dark" }),
    },
    "@/components/SettingsPanel": { __esModule: true, default: () => null },
    "@/components/ResourcesPanel": { __esModule: true, default: ResourcePanel },
    "@/components/TasksPanel": { __esModule: true, default: TasksPanel },
    "@/components/InboxPanel": { __esModule: true, default: InboxPanel },
    "@/components/useHoldingsWorkspace": {
      useHoldingsWorkspace: () => {
        workspaceCalls++;
        return sharedWorkspace;
      },
    },
    "@/lib/ui-messages": { localizeMessage: (message) => message ?? "" },
    "@/components/CandlestickChart": { CandlestickChart: () => null },
    "@/components/InstrumentMetrics": { InstrumentMetrics: () => null },
    "@/components/WorkspaceSidebar": { WorkspaceSidebar: Sidebar },
    "@/components/useCachedMarketResource": { useCachedMarketResource: noData },
    "@/components/useMarketResource": { useMarketResource: noData },
    "@/components/PersonalWatchlist": {
      PersonalWatchlist: () => null,
      WatchlistAction: () => null,
    },
    "@/components/useWatchlist": { useWatchlist: () => ({ items: [], authenticated: false }) },
    "@/components/useWatchlistQuotes": { useWatchlistQuotes: () => ({ quotes: {} }) },
    "@/components/WatchlistNotification": { WatchlistNotification: () => null },
    "@/lib/market-data": compile("../lib/market-data.ts", {}),
  });
  const render = () => {
    index = 0;
    return module.default();
  };
  let tree = render();
  let sidebar = find(tree, (node) => node.type === Sidebar).tree;
  assert.equal(sidebar.props.activeView, "markets");
  const first = find(tree, (node) => node.type === ResourcePanel);
  assert.ok(first);
  assert.equal(workspaceCalls, 1);
  assert.equal(first.tree.props.workspace, sharedWorkspace);
  assert.equal(first.parent.props.hidden, true);
  sidebar.props.onNavigate("resources");
  tree = render();
  const active = find(tree, (node) => node.type === ResourcePanel);
  assert.equal(active.parent.props.hidden, false);
  assert.deepEqual(active.trail, first.trail);
  assert.equal(active.tree.type, first.tree.type);
  assert.equal(active.tree.key, first.tree.key);
  sidebar = find(tree, (node) => node.type === Sidebar).tree;
  sidebar.props.onNavigate("inbox");
  tree = render();
  const inbox = find(tree, (node) => node.type === InboxPanel);
  assert.equal(inbox.tree.props.workspace, sharedWorkspace);
  assert.equal(inbox.tree.props.active, true);
  assert.equal(inbox.parent.props.hidden, false);
  assert.deepEqual(find(tree, (node) => node.type === ResourcePanel).trail, first.trail);
  sidebar = find(tree, (node) => node.type === Sidebar).tree;
  sidebar.props.onNavigate("tasks");
  tree = render();
  const tasks = find(tree, (node) => node.type === TasksPanel);
  assert.equal(tasks.tree.props.workspace, sharedWorkspace);
  assert.equal(tasks.tree.props.active, true);
  assert.equal(tasks.parent.props.hidden, false);
  sidebar = find(tree, (node) => node.type === Sidebar).tree;
  sidebar.props.onNavigate("markets");
  tree = render();
  const returned = find(tree, (node) => node.type === ResourcePanel);
  assert.equal(returned.parent.props.hidden, true);
  assert.deepEqual(returned.trail, first.trail);
  assert.equal(returned.tree.type, first.tree.type);
  const selection = {
    ref: {
      kind: "watchlist",
      sourceService: "user",
      resourceId: "watchlist_A",
      incarnation: "incarnation_A",
    },
    sourceEpoch: 2,
  };
  returned.tree.props.onCreateTask(selection);
  tree = render();
  const seeded = find(tree, (node) => node.type === TasksPanel).tree;
  assert.equal(seeded.props.active, true);
  assert.equal(seeded.props.request.owner, "session_A");
  assert.deepEqual(seeded.props.request.binding, selection);
  sharedWorkspace.owner = "session_B";
  tree = render();
  assert.equal(find(tree, (node) => node.type === TasksPanel).tree.props.request, null);
  // Stable component type/key/position keeps its private Worker alive within the app session.
  // Lock/logout isolation is exercised against the hook in holdings-workspace.test.cjs.
});
