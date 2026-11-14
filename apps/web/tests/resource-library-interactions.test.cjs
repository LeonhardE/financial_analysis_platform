const assert = require("node:assert/strict"),
  test = require("node:test"),
  { readFileSync } = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { transformSync } = require("next/dist/build/swc");
const { hooks, jsx, all } = require("./resource-ui-harness.cjs"),
  { compile, catalogue, channels, stocks, contracts } = require("./resource-library-helpers.cjs");
const css = { __esModule: true, default: new Proxy({}, { get: (_, k) => k }) };
const translations = () => {
  const t = (key) => key;
  t.has = () => true;
  return t;
};
const runtime = { jsx, jsxs: jsx, Fragment: "fragment" };
const button = (tree, key) => all(tree, (n) => n.type === "button" && n.props.children === key)[0];
const loaded = (data) => ({ data, loading: false, error: "", stale: false });
test("real category tabs reveal operative watchlist and follows, with shared-owner list identity", async () => {
  const h = hooks(),
    edits = [],
    shared = {
      sessionKey: "A",
      items: stocks().items,
      loading: false,
      busy: false,
      limit: 50,
      add: (v) => edits.push(["add", v]),
      remove: (v) => edits.push(["remove", v]),
    };
  const { ResourceLibraryView } = compile("../components/ResourceLibrary.tsx", {
    react: h.react,
    "react/jsx-runtime": runtime,
    "next-intl": { useTranslations: translations, useLocale: () => "en" },
    "./useResourceLibrary": {},
    "@/lib/resource-library": contracts,
    "./ResourceLibrary.module.css": css,
  });
  const model = {
    owner: "A",
    authenticated: true,
    configured: true,
    catalogue: loaded(catalogue()),
    watchlist: loaded(stocks("WRONG")),
    follows: loaded(channels()),
    reload() {},
  };
  const render = () =>
    h.render(() => ResourceLibraryView({ model, watchlist: shared, children: "HOLDINGS" }));
  let tree = render();
  assert.ok(
    all(tree, (n) => n.type === "section" && n.props["aria-label"] === "kinds.holdings").length,
  );
  button(tree, "kinds.watchlist").props.onClick();
  tree = render();
  assert.ok(all(tree, (n) => n.type === "strong" && n.props.children === "SYNTH").length);
  assert.equal(all(tree, (n) => n.props?.children === "WRONG").length, 0);
  all(tree, (n) => n.type === "input")[0].props.onChange({ target: { value: "aapl" } });
  tree = render();
  all(tree, (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(edits, [["add", "AAPL"]]);
  button(render(), "remove").props.onClick();
  assert.deepEqual(edits[1], ["remove", "SYNTH"]);
  shared.sessionKey = "B";
  assert.equal(all(render(), (n) => n.props?.children === "SYNTH").length, 0);
  h.close();
});
test("actual holdings chooser and drop zone share the importer; multiple files and blocked states never reach it", async () => {
  const h = hooks(),
    calls = [],
    ref = {
      kind: "holdings",
      sourceService: "portfolio",
      resourceId: "source",
      incarnation: "inc",
    };
  let model = {
    configured: true,
    authenticated: true,
    phase: "unlocked",
    canWriteState: true,
    busy: null,
    sources: [],
    newSource: true,
    importFile: (f) => calls.push(["import", f]),
    save: async (callback) => {
      calls.push(["save"]);
      if (callback) await callback({ resourceRef: ref });
    },
    selectAccounts() {},
  };
  const names = {
    enabled: true,
    rename: async (r, name, fresh) => {
      calls.push(["name", r, name, fresh]);
      return true;
    },
  };
  const source = readFileSync(path.join(__dirname, "../components/ResourcesPanel.tsx"), "utf8"),
    { code } = transformSync(source, {
      filename: "ResourcesPanel.tsx",
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        target: "es2022",
        transform: { react: { runtime: "automatic" } },
      },
      module: { type: "commonjs" },
    });
  const imports = {
    "@/lib/holdings-facts": compile("../lib/holdings-facts.ts"),
    "./HoldingsEditor": { __esModule: true, default: () => null },
    "./HoldingsValuation": { __esModule: true, default: () => null },
    "next/dynamic": { __esModule: true, default: () => () => null },
    react: h.react,
    "react/jsx-runtime": runtime,
    "next-intl": { useTranslations: translations, useLocale: () => "en" },
    "./WorkspaceFeedback": { LoadingIndicator: () => null, InlineError: () => null },
    "@/components/useHoldingsWorkspace": {},
    "./ResourceLibrary": {},
    "./PasskeyHelp": {},
    "./useDisplayNames": {},
    "./HoldingsSourceBar": { HoldingsSourceBar: () => null },
    "./ResourcesPanel.module.css": css,
  };
  const module = { exports: {} };
  vm.runInNewContext(code + "\nmodule.exports.Workspace = Workspace;", {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in imports, name);
      return imports[name];
    },
    requestAnimationFrame: (fn) => fn(),
  });
  const render = () => h.render(() => module.exports.Workspace({ model, names, library: {} }));
  const file = { name: "synthetic.csv" };
  let tree = render();
  const chooser = all(tree, (n) => n.type === "input" && n.props.type === "file")[0];
  chooser.props.onChange({ target: { files: [file], value: "name" } });
  let prevented = 0;
  all(tree, (n) => n.props["aria-label"] === "manage.dropZone")[0].props.onDrop({
    preventDefault() {
      prevented++;
    },
    dataTransfer: { files: [file] },
  });
  assert.equal(prevented, 1);
  assert.deepEqual(calls, [
    ["import", file],
    ["import", file],
  ]);
  all(tree, (n) => n.props["aria-label"] === "manage.dropZone")[0].props.onDrop({
    preventDefault() {},
    dataTransfer: { files: [file, file] },
  });
  assert.equal(calls.length, 2);
  model = { ...model, hasPending: true };
  tree = render();
  assert.equal(
    all(tree, (n) => n.type === "input" && n.props.type === "file")[0].props.disabled,
    true,
  );
  all(tree, (n) => n.props["aria-label"] === "manage.dropZone")[0].props.onDrop({
    preventDefault() {},
    dataTransfer: { files: [file] },
  });
  assert.equal(calls.length, 2);
  model = {
    ...model,
    hasPending: false,
    preview: {
      reportDate: null,
      accounts: [],
      stats: { accounts: 0, positions: 0, totals: {}, excluded: 0, duplicates: 0 },
      warnings: [],
      resourceContent: { data: { accounts: [], excludedAssets: [] } },
    },
  };
  tree = render();
  const input = all(tree, (n) => n.type === "input" && n.props.maxLength === 80)[0];
  input.props.onChange({ target: { value: "Named synthetic" } });
  tree = render();
  await button(tree, "confirmSave").props.onClick();
  assert.equal(calls.at(-2)[0], "save");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), [
    "name",
    ref,
    "Named synthetic",
    true,
  ]);
  h.close();
});

test("data settings open a smooth dialog, preserve original pending-name recovery and fresh scope controls", async () => {
  const h = hooks(),
    calls = [],
    ref = {
      kind: "holdings",
      sourceService: "portfolio",
      resourceId: "holdings",
      incarnation: "incarnation_A",
    };
  const { HoldingsSourceBar } = compile("../components/HoldingsSourceBar.tsx", {
    react: h.react,
    "react/jsx-runtime": runtime,
    "next-intl": { useTranslations: translations, useLocale: () => "en" },
    "./useTasks": {},
    "./ResourcesPanel.module.css": css,
  });
  let pending = false;
  const names = {
    scope: "A:root:1",
    ready: true,
    enabled: true,
    name: () => "PRIVATE NAME",
    pending: () => pending,
    clearError() {},
    rename: async (r, name) => calls.push(["rename", r, name]),
    recover: async (r, replay) => calls.push(["recover", r, replay]),
  };
  const model = {
    sources: [{ resourceRef: ref }],
    selectedSourceId: ref.resourceId,
    canWriteState: true,
    phase: "unlocked",
    sourceMetadata: { state: "active" },
  };
  const render = () =>
    h.render(() =>
      HoldingsSourceBar({
        model,
        names,
        library: { catalogue: loaded(catalogue()) },
        onUpdate() {},
        children: "DANGER_CONFIRMATIONS",
      }),
    );
  let tree = render();
  const dialog = () => all(tree, (n) => n.props.id === "holdings-source-settings")[0];
  assert.equal(dialog().props.open, false);
  button(tree, "lifecycle.settings").props.onClick();
  tree = render();
  assert.equal(dialog().props.open, true);
  const input = all(tree, (n) => n.type === "input")[0];
  assert.equal(input.props.value, "PRIVATE NAME");
  input.props.onChange({ target: { value: "Renamed" } });
  tree = render();
  all(tree, (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(calls[0][0], "rename");
  pending = true;
  tree = render();
  assert.equal(button(tree, "manage.saveName").props.disabled, true);
  button(tree, "manage.checkName").props.onClick();
  button(tree, "manage.retryNameSave").props.onClick();
  assert.equal(calls[1][2], undefined);
  assert.equal(calls[2][2], true);
  assert.ok(
    all(
      tree,
      (n) => n.type === "details" && n.props.children[0].props.children === "manage.advanced",
    ).length,
  );
  model.preview = { selectedAccountIds: [] };
  tree = render();
  assert.equal(
    button(tree, "lifecycle.settings").props.disabled,
    false,
    "account-scope review remains reachable during preview",
  );
  assert.equal(
    button(tree, "manage.add").props.disabled,
    false,
    "preview can be saved as independent data",
  );
  h.close();
});
