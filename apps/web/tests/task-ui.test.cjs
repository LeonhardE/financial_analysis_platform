const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createTranslator } = require("next-intl");
const { transformSync } = require("next/dist/build/swc");
const runtime = require("react/jsx-runtime");
const catalogs = { en: require("../messages/en.json"), zh: require("../messages/zh.json") };
const code = transformSync(
  readFileSync(path.join(__dirname, "../components/TasksPanel.tsx"), "utf8"),
  {
    filename: "TasksPanel.tsx",
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  },
).code;
const noop = () => {};
const form = () => ({
  name: "Synthetic private task <script>",
  template: "brief",
  goal: "Synthetic private goal <img src=https://example.test/secret>",
  inputPolicy: { allowPartial: false, allowUnknownAsOf: false, maxFetchedAgeSeconds: 86400 },
  outputSpec: {
    label: "Synthetic report",
    sections: [
      { sectionId: "overview", title: "Overview", instructions: "Synthetic instructions" },
    ],
    language: "en",
    verbosity: "standard",
  },
  deliveryExpectation: {
    cadence: "daily",
    localTime: "09:00",
    timeZone: "America/Toronto",
    graceMinutes: 60,
  },
});
function fixture(changes = {}, ws = {}) {
  const metadata = {
    taskId: "task_synthetic_A",
    taskVersion: 2,
    status: "active",
    updatedAt: "2026-10-30T13:00:00Z",
    resourceBindings: [],
  };
  return {
    workspace: {
      authenticated: true,
      authStatus: "authenticated",
      owner: "session_A",
      phase: "unlocked",
      busy: null,
      error: "",
      lock: noop,
      unlock: noop,
      create: noop,
      signIn: noop,
      ...ws,
    },
    model: {
      owner: "session_A",
      configured: true,
      unlocked: true,
      canWrite: true,
      busy: false,
      loading: false,
      error: "",
      notice: "",
      items: [metadata],
      catalogue: [],
      selected: metadata,
      form: form(),
      bindings: [],
      dirty: true,
      history: [metadata],
      historical: false,
      confirmation: null,
      confirmationReasons: [],
      pending: null,
      pendingOperations: [],
      drafts: [],
      conflictCurrent: null,
      nextExpectedAt: "2026-10-31T13:00:00Z",
      preview: null,
      reload: noop,
      startNew: noop,
      openTask: noop,
      setForm: noop,
      setBindings: noop,
      review: noop,
      save: noop,
      transition: noop,
      recoverPending: noop,
      resendPending: noop,
      discardPending: noop,
      restoreDraft: noop,
      discardDraft: noop,
      rebaseDraft: noop,
      cancelConfirmation: noop,
      loadVersion: noop,
      copyHandoff: noop,
      ...changes,
    },
  };
}
function render(f = fixture(), locale = "en", capture = []) {
  const module = { exports: {} };
  const jsx =
    (kind) =>
    (type, props, ...rest) => {
      if (type === "button") capture.push(props);
      return runtime[kind](type, props, ...rest);
    };
  const imports = {
    react: React,
    "react/jsx-runtime": { ...runtime, jsx: jsx("jsx"), jsxs: jsx("jsxs") },
    "./PasskeyHelp": { PasskeyHelp: () => null },
    "next-intl": {
      useLocale: () => locale,
      useTranslations: (namespace) =>
        createTranslator({ locale, messages: catalogs[locale], namespace }),
    },
    "./useTasks": { useTasks: () => f.model },
    "@/lib/task-forms": { defaultTask: () => form() },
    "@/lib/task-types": { bindingKey: JSON.stringify },
    "./TasksPanel.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_, key) => key }),
    },
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in imports, name);
      return imports[name];
    },
    Intl,
    crypto: require("node:crypto").webcrypto,
  });
  return renderToStaticMarkup(React.createElement(module.exports.TasksView, f));
}
test("task editor renders both catalogs, escapes decrypted text and does not load embedded content", () => {
  for (const locale of ["en", "zh"]) {
    const html = render(fixture(), locale);
    assert.match(html, /Synthetic private task &lt;script&gt;/);
    assert.match(html, /&lt;img src=https:\/\/example.test\/secret&gt;/);
    assert.doesNotMatch(html, /<script|<img|<iframe/);
    assert.ok(
      html.includes(
        locale === "en" ? "saving here does not create a schedule" : "保存不会创建排程",
      ),
    );
  }
});
test("lock, logout and switched owner mask all private form and selection in same render", () => {
  for (const ws of [
    { phase: "locked" },
    { authenticated: false, authStatus: "anonymous" },
    { owner: "session_B" },
  ]) {
    const html = render(fixture({}, ws));
    assert.doesNotMatch(html, /Synthetic private|Synthetic instructions|Synthetic report/);
  }
});
test("historical/read-only and dirty transitions do not offer writable fields", () => {
  const html = render(fixture({ historical: true, dirty: false }));
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /Historical version/);
  const withUnreviewedDraft = render(
    fixture({
      dirty: false,
      drafts: [
        { slot: "task_synthetic_A", taskId: "task_synthetic_A", revision: 7, baseVersion: 1 },
      ],
    }),
  );
  assert.match(withUnreviewedDraft, /<fieldset disabled=""/);

  const buttons = [];
  render(fixture(), "en", buttons);
  assert.equal(buttons.find((b) => b.children === "Pause").disabled, true);
  assert.equal(buttons.find((b) => b.children === "Archive").disabled, true);
});
test("confirmation passes only its explicit reviewed save and does not hide scope explanations", () => {
  const calls = [],
    buttons = [];
  render(
    fixture({
      confirmation: "resource_scope",
      confirmationReasons: ["resource_scope", "key_epoch"],
      save: (value) => calls.push(value),
    }),
    "en",
    buttons,
  );
  assert.ok(buttons.some((b) => b.children === "Confirm change"));
  buttons.find((b) => b.children === "Confirm change").onClick();
  assert.deepEqual(calls, [true]);
});
test("draft and pending recovery stays explicit; handoff contains only saved task ID", () => {
  const calls = [],
    buttons = [];
  const html = render(
    fixture({
      dirty: false,
      drafts: [{ slot: "new", baseVersion: 0, taskId: "new_task", revision: 1 }],
      pendingOperations: [{ taskId: "task_synthetic_A", operationId: "operation_synthetic_A" }],
      recoverPending: (id) => calls.push(id),
    }),
    "en",
    buttons,
  );
  assert.match(html, /Incomplete edits are sealed locally/);
  assert.match(html, /Discarding does not undo a server save/);
  assert.match(html, /Copy the task ID/);
  assert.doesNotMatch(html, /href="https:\/\/muse|bearer|access_token|privateKey/);
  buttons.find((b) => b.children === "Recover original operation").onClick();
  assert.deepEqual(calls, ["task_synthetic_A"]);
});

test("resource handoff only seeds an explicitly started task for the current owner and epoch", () => {
  const binding = {
    ref: {
      kind: "watchlist",
      sourceService: "user",
      resourceId: "watchlist_synthetic",
      incarnation: "incarnation_A",
    },
    sourceEpoch: 2,
  };
  const calls = [],
    buttons = [];
  const state = fixture({
    form: null,
    selected: null,
    dirty: false,
    catalogue: [{ kind: "watchlist", binding, selectable: true }],
    startNew: (...args) => calls.push(args),
  });
  state.request = { owner: "session_A", binding, nonce: 1 };
  state.onRequestConsumed = () => calls.push("consumed");
  const html = render(state, "en", buttons);
  assert.match(html, /Start a brief using Watchlist/);
  assert.equal(calls.length, 0);
  const start = buttons.find((button) => button.children === "Start with this resource");
  assert.equal(start.disabled, false);
  start.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][0])), binding);
  assert.equal(calls[0][1].template, "brief");
  assert.equal(calls[1], "consumed");
  for (const change of [
    { request: { owner: "session_B", binding, nonce: 2 } },
    {
      model: {
        ...state.model,
        catalogue: [
          { kind: "watchlist", selectable: true, binding: { ...binding, sourceEpoch: 3 } },
        ],
      },
    },
  ]) {
    const captured = [];
    render({ ...state, ...change }, "en", captured);
    const button = captured.find((item) => item.children === "Start with this resource");
    assert.ok(!button || button.disabled);
  }
});
