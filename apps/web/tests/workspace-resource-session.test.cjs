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

test("Market and Resources navigation preserves the same mounted resource owner session", () => {
  const cells = [];
  let index = 0;
  const ResourcePanel = () => null;
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
  assert.equal(first.parent.props.hidden, true);
  sidebar.props.onNavigate("resources");
  tree = render();
  const active = find(tree, (node) => node.type === ResourcePanel);
  assert.equal(active.parent.props.hidden, false);
  assert.deepEqual(active.trail, first.trail);
  assert.equal(active.tree.type, first.tree.type);
  assert.equal(active.tree.key, first.tree.key);
  sidebar = find(tree, (node) => node.type === Sidebar).tree;
  sidebar.props.onNavigate("markets");
  tree = render();
  const returned = find(tree, (node) => node.type === ResourcePanel);
  assert.equal(returned.parent.props.hidden, true);
  assert.deepEqual(returned.trail, first.trail);
  assert.equal(returned.tree.type, first.tree.type);
  // Stable component type/key/position keeps its private Worker alive within the app session.
  // Lock/logout isolation is exercised against the hook in holdings-workspace.test.cjs.
});
