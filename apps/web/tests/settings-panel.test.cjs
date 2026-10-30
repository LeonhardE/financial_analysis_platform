const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const jsxRuntime = require("react/jsx-runtime");
const { createTranslator } = require("next-intl");

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
    "./VaultManagementPanel": { __esModule: true, default: () => null },
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
    return { root, nodes, changes, retries: () => retries };
  }
  return {
    render: (next = {}) => {
      Object.assign(state, next);
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
    assert.equal(groups.length, 3);
    for (const group of groups) {
      assert.ok(view.nodes.some((node) => node.props?.id === group.props["aria-labelledby"]));
      assert.ok(view.nodes.some((node) => node.props?.id === group.props["aria-describedby"]));
    }
    const selects = view.nodes.filter((node) => node.type === "select");
    assert.equal(selects.length, 2);
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
        .nodes.filter((node) => node.type === "fieldset")
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
        .nodes.filter((node) => node.type === "fieldset")
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
      locale === "en" ? "Preferences saved to your account." : "偏好已保存到账户。",
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
