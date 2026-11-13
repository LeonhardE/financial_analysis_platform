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
