const assert = require("node:assert/strict"),
  test = require("node:test"),
  React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"),
  { createTranslator } = require("next-intl");
const { compile } = require("./resource-library-helpers.cjs");
function render({ running = false, name = true, count = 0 } = {}) {
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
    selected: metadata,
    form: { name: "Daily <brief>", goal: "Summarize my watchlist" },
    canWrite: true,
    bindings: [],
    drafts: [],
    pendingOperations: [],
    catalogue: [],
    reload() {},
  };
  const center = {
    scope: "owner:vault:1",
    enabled: true,
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
  };
  return renderToStaticMarkup(
    React.createElement(mod.TaskCenterView, {
      workspace: {},
      model,
      center,
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
