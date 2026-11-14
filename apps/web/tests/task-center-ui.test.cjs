const assert = require("node:assert/strict"),
  test = require("node:test"),
  React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"),
  { createTranslator } = require("next-intl");
const { compile } = require("./resource-library-helpers.cjs");
function render({
  running = false,
  name = true,
  count = 0,
  home = false,
  modelPatch = {},
  resultPatch = {},
  workspacePatch = {},
  navigating = false,
  centerPatch = {},
} = {}) {
  const messages = require("../messages/en.json"),
    metadata = { taskId: "task_PRIVATE_ID", status: "active", taskVersion: 1 };
  const mod = compile(
    "../components/TaskCenterPanel.tsx",
    {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      "next-intl": {
        useLocale: () => "en",
        useTranslations: (ns) => createTranslator({ locale: "en", messages, namespace: ns }),
      },
      "@/lib/task-forms": { defaultTask: () => ({}) },
      "@/lib/task-center-schedule": { nextCenterOccurrence: () => null },
      "@/lib/task-types": { bindingKey: JSON.stringify },
      "./ReportDialog": { ReportDialog: () => null },
      "./WorkspaceFeedback": { InlineError: () => null, LoadingIndicator: () => null },
      "./TaskCenterPanel.module.css": {
        __esModule: true,
        default: new Proxy({}, { get: (_, p) => p }),
      },
    },
    { Intl, Date },
  );
  const model = {
    items: [metadata],
    taskNames: name ? { task_PRIVATE_ID: "Daily <brief>" } : {},
    nameErrors: {},
    selected: home ? null : metadata,
    form: home ? null : { name: "Daily <brief>", goal: "Summarize my watchlist" },
    owner: "owner_A",
    privateScope: "owner_A:vault_A:1",
    unlocked: true,
    listReady: true,
    loading: false,
    listError: "",
    error: "",
    canWrite: true,
    bindings: [],
    drafts: [],
    pendingOperations: [],
    catalogue: [],
    reload() {},
    ...modelPatch,
  };
  const center = {
    scope: "owner:vault:1",
    enabled: true,
    capabilityState: "ready",
    records: {},
    manual: running
      ? {
          task_PRIVATE_ID: [
            {
              aggregate: { hasActiveExecutors: true },
              snapshot: { requestId: "request_PRIVATE_ID", executors: [] },
            },
          ],
        }
      : {},
    pending: null,
    ...centerPatch,
  };
  return renderToStaticMarkup(
    React.createElement(mod.TaskCenterView, {
      workspace: {
        authenticated: true,
        owner: "owner_A",
        phase: "unlocked",
        vault: { vaultId: "vault_A" },
        vaultGeneration: 1,
        ...workspacePatch,
      },
      model,
      center,
      navigating,
      resultState: {
        scope: "owner_A:vault_A:1",
        ready: true,
        complete: true,
        loading: false,
        error: "",
        partial: false,
        busy: false,
        ...resultPatch,
      },
      unreadCounts: { task_PRIVATE_ID: count },
    }),
  );
}
test("task actions live inside the task and technical IDs never replace verified names", () => {
  const html = render();
  assert.match(html, /Daily &lt;brief&gt;/);
  assert.doesNotMatch(html, /task_PRIVATE_ID|request_PRIVATE_ID|Manage executors|View results/);
  assert.doesNotMatch(html.slice(0, html.indexOf("</header>")), /Run now/);
  assert.match(html, /Run now/);
});
test("known running requests show a returnable progress action and list/title indicators", () => {
  const html = render({ running: true, count: 2 });
  assert.match(html, /View progress/);
  assert.equal((html.match(/aria-label="In progress"/g) || []).length, 2);
  assert.match(html, /2 unread results/);
  assert.doesNotMatch(render({ count: 0 }), /class="badge"/);
});
test("an unresolved task name has a skeleton rather than an opaque ID", () => {
  const html = render({ name: false });
  assert.match(html, /Loading task name/);
  assert.doesNotMatch(html, /task_PRIVATE_ID/);
});

test("legacy task settings wait for the selected assignment and retain it when details arrive", async () => {
  const { hooks, jsx, all } = require("./resource-ui-harness.cjs"),
    h = hooks();
  const messages = require("../messages/en.json");
  const mod = compile(
    "../components/TaskCenterPanel.tsx",
    {
      react: h.react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next-intl": {
        useLocale: () => "en",
        useTranslations: (ns) => createTranslator({ locale: "en", messages, namespace: ns }),
      },
      "@/lib/task-forms": { defaultTask: () => ({}) },
      "@/lib/task-center-schedule": { nextCenterOccurrence: () => null },
      "@/lib/task-types": { bindingKey: JSON.stringify },
      "./ReportDialog": { ReportDialog: () => null },
      "./WorkspaceFeedback": { InlineError: () => null, LoadingIndicator: () => null },
      "./TaskCenterPanel.module.css": {
        __esModule: true,
        default: new Proxy({}, { get: (_, p) => p }),
      },
    },
    { Intl, Date },
  );
  const meta = {
    taskId: "selected_legacy",
    status: "active",
    taskVersion: 1,
    envelopeFingerprint: "exact_version",
  };
  const model = {
    selected: meta,
    form: { name: "Legacy brief", goal: "Read selected resource" },
    items: [meta],
    taskNames: { selected_legacy: "Legacy brief" },
    nameErrors: {},
    canWrite: true,
    bindings: [],
    drafts: [],
    pendingOperations: [],
    catalogue: [],
  };
  const center = {
    scope: "owner:vault:1",
    enabled: true,
    records: { selected_legacy: { rules: null, assignments: [] } },
    manual: {},
    pending: null,
  };
  let release,
    reads = 0;
  const view = {
    connection: { provider: "muse", status: "active" },
    credential: { status: "active" },
    tasks: [],
  };
  const persistent = {
    loaded: true,
    loading: false,
    tasks: [],
    views: [view],
    revision: 1,
    loadTask: (selected) => {
      assert.equal(selected, meta);
      reads++;
      return new Promise((r) => {
        release = r;
      });
    },
  };
  const draw = (active = true) =>
    h.render(() => mod.TaskCenterView({ workspace: {}, model, center, persistent, active }));
  const settings = (tree) =>
    all(tree, (n) => n.type === "button" && n.props.children === "Settings")[0];
  try {
    draw(false);
    assert.equal(reads, 0, "a retained hidden Task Center must not start legacy detail reads");
    let tree = draw();
    assert.equal(reads, 1);
    assert.equal(settings(tree).props.disabled, true);
    const task = { taskId: meta.taskId, packet: { metadata: meta } };
    persistent.tasks = [task];
    persistent.views = [{ ...view, tasks: [task] }];
    release(true);
    await new Promise(setImmediate);
    tree = draw();
    assert.equal(settings(tree).props.disabled, false);
    const executors = all(tree, (n) => n.type === "dd" && n.props.children === "Muse");
    assert.equal(executors.length, 1);
    assert.equal(reads, 1, "verified details do not trigger another scan on render");
  } finally {
    h.close();
  }
});

test("resource handoffs wait for a confirmed catalogue and keep read failure retry visible before starting the task", () => {
  const { hooks, jsx, all } = require("./resource-ui-harness.cjs"),
    h = hooks();
  let started = 0,
    consumed = 0;
  const model = {
    items: [],
    taskNames: {},
    nameErrors: {},
    selected: null,
    form: null,
    canWrite: true,
    bindings: [],
    drafts: [],
    pendingOperations: [],
    catalogue: [],
    catalogueReady: false,
    catalogueLoading: true,
    startNew(seed, form) {
      assert.equal(seed, request.binding);
      started++;
      model.form = form;
    },
    reloadCatalogue() {},
  };
  const request = { owner: "owner_A", nonce: 1, binding: { ref: { kind: "watchlist" } } };
  const center = {
    scope: "owner_A:vault_A:1",
    enabled: true,
    records: {},
    manual: {},
    pending: null,
  };
  const LoadingIndicator = () => null,
    InlineError = () => null;
  const mod = compile(
    "../components/TaskCenterPanel.tsx",
    {
      react: h.react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next-intl": { useLocale: () => "en", useTranslations: () => (v) => v },
      "@/lib/task-forms": { defaultTask: () => ({ outputSpec: {} }) },
      "@/lib/task-center-schedule": { nextCenterOccurrence: () => null },
      "@/lib/task-types": { bindingKey: JSON.stringify },
      "./ReportDialog": { ReportDialog: () => null },
      "./WorkspaceFeedback": { LoadingIndicator, InlineError },
      "./TaskCenterPanel.module.css": { __esModule: true, default: {} },
    },
    { Intl, Date },
  );
  const draw = () =>
    h.render(() =>
      mod.TaskCenterView({
        workspace: { owner: "owner_A" },
        model,
        center,
        request,
        onRequestConsumed: () => consumed++,
      }),
    );
  let tree = draw();
  assert.equal(started, 0);
  assert.ok(all(tree, (n) => n.type?.name === "LoadingIndicator" && n.props.busy).length);
  model.catalogueLoading = false;
  model.catalogueError = "source_unavailable";
  tree = draw();
  assert.equal(started, 0);
  assert.ok(all(tree, (n) => n.type?.name === "InlineError" && n.props.onRetry).length);
  model.catalogueError = "";
  model.catalogueReady = true;
  draw();
  assert.equal(started, 1);
  assert.equal(consumed, 1);
  h.close();
});

test("only the task-list homepage reports ready after current lists names capabilities and complete report feeds", () => {
  const state = (options = {}) => {
    const html = render({ home: true, ...options });
    return html.slice(0, html.indexOf(">") + 1);
  };
  assert.match(state({ count: 2 }), /data-load-scope="task-list" data-load-state="ready"/);
  for (const options of [
    { modelPatch: { items: [], listReady: false } },
    { name: false },
    { modelPatch: { loading: true } },
    { resultPatch: { loading: true, complete: false } },
    { resultPatch: { ready: false, complete: false } },
    { centerPatch: { capabilityState: "loading", enabled: false } },
  ]) {
    assert.match(state(options), /data-load-state="loading"/);
    assert.doesNotMatch(state(options), /data-load-state="ready"/);
  }
  for (const options of [
    { modelPatch: { listError: "service_unavailable" } },
    { modelPatch: { nameErrors: { task_PRIVATE_ID: "verification_failed" } } },
    { resultPatch: { error: "service_unavailable" } },
    { resultPatch: { partial: true } },
    { centerPatch: { capabilityState: "error" } },
  ])
    assert.match(state(options), /data-load-state="error"/);
  assert.match(
    state({ centerPatch: { capabilityState: "ready", enabled: false } }),
    /data-load-state="ready"/,
  );
  assert.match(state({ modelPatch: { items: [], taskNames: {} } }), /data-load-state="ready"/);
  for (const options of [
    { workspacePatch: { owner: "owner_B" } },
    { workspacePatch: { vaultGeneration: 2 } },
    { workspacePatch: { needsDeviceApproval: true } },
    { resultPatch: { scope: "owner_B:vault_A:1" } },
  ])
    assert.match(state(options), /data-load-state="locked"/);
  assert.doesNotMatch(render(), /data-load-scope|data-load-state/);
  assert.doesNotMatch(state({ navigating: true }), /data-load-scope|data-load-state/);
  assert.doesNotMatch(state(), /PRIVATE|owner_A|vault_A/);
});
