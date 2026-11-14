const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const jsxRuntime = require("react/jsx-runtime");
const { createTranslator } = require("next-intl");
const currencyContracts = require("./resource-library-helpers.cjs").compile(
  "../lib/currency-preferences.ts",
);

function mountPanel(overrides = {}, locale = "en") {
  const changes = [];
  let retries = 0;
  const cells = [];
  const effects = [];
  const timers = new Map();
  let index = 0;
  let nextTimer = 0;
  const state = {
    preferences: { theme: "system", language: "en", defaultChartRange: "1m" },
    authenticated: false,
    loading: false,
    saving: false,
    status: "guest",
    error: null,
    updatePreferences: (change) => changes.push(change),
    retry: () => retries++,
    ...overrides,
  };
  const currencyChanges = [];
  const currencyState = {
    authenticated: state.authenticated,
    loaded: true,
    loading: false,
    saving: false,
    error: null,
    snapshot: null,
    selected: "USD",
    select: (value) => currencyChanges.push(value),
    retry: () => retries++,
    ...(overrides.currency ?? {}),
  };
  const { code } = transformSync(
    readFileSync(path.join(__dirname, "../components/SettingsPanel.tsx"), "utf8"),
    {
      filename: "SettingsPanel.tsx",
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        target: "es2022",
        transform: { react: { runtime: "automatic" } },
      },
      module: { type: "commonjs" },
    },
  );
  const imports = {
    react: {
      useState: (initial) => {
        const slot = index++;
        cells[slot] ??= { value: initial };
        return [cells[slot].value, (value) => (cells[slot].value = value)];
      },
      useRef: (current) => {
        const slot = index++;
        cells[slot] ??= { current };
        return cells[slot];
      },
      useEffect: (effect, dependencies) => {
        const slot = index++;
        if (
          !cells[slot] ||
          dependencies.some((value, position) => value !== cells[slot].dependencies[position])
        ) {
          effects.push({ slot, effect, dependencies });
        }
      },
    },
    "react/jsx-runtime": jsxRuntime,
    "@/components/PreferencesProvider": { usePreferences: () => state },
    "./SettingsPanel.module.css": { default: {} },
    "./IndependentSetupPanel": { __esModule: true, default: () => null },
    "./SettingsSecurityPanel": { __esModule: true, default: () => null },
    "./CurrencyPreferencesProvider": { useCurrencyPreferences: () => currencyState },
    "@/lib/currency-preferences": currencyContracts,
    "next-intl": {
      useTranslations: (namespace) =>
        createTranslator({
          locale,
          namespace,
          messages: require(`../messages/${locale}.json`),
        }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
    window: {
      setTimeout: (callback, milliseconds) => {
        const id = ++nextTimer;
        timers.set(id, { callback, milliseconds });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  function render() {
    index = 0;
    const root = module.exports.default();
    const nodes = [];
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      nodes.push(node);
      visit(node.props?.children);
    }
    visit(root);
    return { root, nodes, changes, currencyChanges, retries: () => retries };
  }
  return {
    render: (next = {}) => {
      Object.assign(state, next);
      currencyState.authenticated = state.authenticated;
      if (next.currency) Object.assign(currencyState, next.currency);
      render();
      for (const { slot, effect, dependencies } of effects.splice(0)) {
        cells[slot]?.cleanup?.();
        cells[slot] = { dependencies, cleanup: effect() };
      }
      return render();
    },
    expire: () => {
      for (const [id, { callback, milliseconds }] of [...timers]) {
        assert.equal(milliseconds, 3_000);
        timers.delete(id);
        callback();
      }
    },
    pendingTimers: () => timers.size,
    unmount: () => cells.forEach((cell) => cell.cleanup?.()),
  };
}

function panel(overrides = {}, locale = "en") {
  return mountPanel(overrides, locale).render();
}

test("settings retain named preference groups and native labeled controls in both languages", () => {
  for (const locale of ["en", "zh"]) {
    const view = panel({}, locale);
    const groups = view.nodes.filter((node) => node.type === "fieldset");
    assert.equal(groups.length, 4);
    for (const group of groups) {
      assert.ok(view.nodes.some((node) => node.props?.id === group.props["aria-labelledby"]));
      if (group.props["aria-describedby"])
        assert.ok(view.nodes.some((node) => node.props?.id === group.props["aria-describedby"]));
    }
    const selects = view.nodes.filter((node) => node.type === "select");
    assert.equal(selects.length, 3);
    for (const select of selects) {
      assert.ok(view.nodes.some((node) => node.props?.htmlFor === select.props.id));
    }
    assert.equal(view.nodes.filter((node) => node.type === "input").length, 3);
  }
});

test("guest controls remain usable while account restoration failures disable saved settings", () => {
  for (const overrides of [
    { authenticated: true, loading: true },
    { authenticated: true, error: "load" },
    { authenticated: true, error: "loadTimeout" },
  ]) {
    assert.ok(
      panel(overrides)
        .nodes.filter(
          (node) => node.type === "fieldset" && node.props["aria-labelledby"] !== "currency-title",
        )
        .every((node) => node.props.disabled),
    );
  }
  for (const overrides of [
    {},
    { authenticated: true, saving: true },
    { authenticated: true, error: "save" },
  ]) {
    assert.ok(
      panel(overrides)
        .nodes.filter(
          (node) => node.type === "fieldset" && node.props["aria-labelledby"] !== "currency-title",
        )
        .every((node) => !node.props.disabled),
    );
  }
});

test("preference controls dispatch only their field and preserve retry for save errors", () => {
  const view = panel({ authenticated: true, error: "save" });
  view.nodes.find((node) => node.type === "input" && node.props.value === "dark").props.onChange();
  view.nodes
    .find((node) => node.props?.id === "preference-language")
    .props.onChange({ target: { value: "zh" } });
  view.nodes
    .find((node) => node.props?.id === "preference-range")
    .props.onChange({ target: { value: "1y" } });
  assert.deepEqual(JSON.parse(JSON.stringify(view.changes)), [
    { theme: "dark" },
    { language: "zh" },
    { defaultChartRange: "1y" },
  ]);
  assert.ok(view.nodes.some((node) => node.props?.role === "alert"));
  assert.ok(view.nodes.some((node) => node.props?.["aria-live"] === "polite"));
  view.nodes.find((node) => node.type === "button").props.onClick();
  assert.equal(view.retries(), 1);
});

test("currency stays an independent control with an unknown-state placeholder and usable retry", () => {
  const view = panel({
    authenticated: true,
    currency: { authenticated: true, loaded: true, selected: "CNY" },
  });
  view.nodes
    .find((node) => node.props?.id === "preference-currency")
    .props.onChange({ target: { value: "CAD" } });
  assert.deepEqual(view.currencyChanges, ["CAD"]);
  assert.deepEqual(view.changes, []);
  const pending = panel({
    authenticated: true,
    currency: { authenticated: true, loaded: false, loading: true },
  });
  assert.equal(
    pending.nodes.find((node) => node.props?.["aria-labelledby"] === "currency-title").props
      .disabled,
    true,
  );
  assert.ok(
    pending.nodes.some((node) => node.props?.["data-loading"] && node.props?.["aria-hidden"]),
  );
  const failed = panel({
    authenticated: true,
    currency: { authenticated: true, loaded: false, error: "load" },
  });
  const retry = failed.nodes.find((node) => node.type === "button");
  assert.equal(retry.props.disabled, undefined);
  retry.props.onClick();
  assert.equal(failed.retries(), 1);
});

const toast = (view) => view.nodes.find((node) => node.props?.role === "status");

test("only a completed save shows a brief accessible confirmation, without replay on return", () => {
  for (const locale of ["en", "zh"]) {
    const app = mountPanel({ authenticated: true, status: "saved" }, locale);
    assert.equal(toast(app.render()), undefined);
    assert.equal(toast(app.render({ loading: true, status: "loading" })), undefined);
    assert.equal(toast(app.render({ loading: false, status: "saved" })), undefined);
    app.render({ saving: true, status: "saving" });
    const confirmation = toast(app.render({ saving: false, status: "saved" }));
    assert.equal(confirmation.props["aria-live"], "polite");
    assert.equal(confirmation.props["aria-atomic"], "true");
    assert.equal(
      confirmation.props.children[1].props.children,
      locale === "en" ? "Saved" : "已保存",
    );
    assert.equal(app.pendingTimers(), 1);
    app.expire();
    assert.equal(toast(app.render()), undefined);
    assert.equal(toast(panel({ authenticated: true, status: "saved" }, locale)), undefined);
  }
});

test("new edits, failures, logout and navigation clear confirmation and its timer", () => {
  for (const next of [
    { saving: true, status: "saving" },
    { status: "error", error: "save" },
    { authenticated: false, status: "guest" },
  ]) {
    const app = mountPanel({ authenticated: true, saving: true, status: "saving" });
    app.render();
    assert.ok(toast(app.render({ saving: false, status: "saved" })));
    assert.equal(toast(app.render(next)), undefined);
    assert.equal(app.pendingTimers(), 0);
  }
  const app = mountPanel({ authenticated: true, saving: true, status: "saving" });
  app.render();
  app.render({ saving: false, status: "saved" });
  app.unmount();
  assert.equal(app.pendingTimers(), 0);
  assert.equal(toast(panel({ authenticated: false, status: "saved" })), undefined);
});
