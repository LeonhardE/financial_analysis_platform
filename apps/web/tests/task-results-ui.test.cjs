const test = require("node:test"),
  assert = require("node:assert/strict"),
  React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"),
  { createTranslator } = require("next-intl"),
  { compile } = require("./resource-library-helpers.cjs");
const jsx = require("react/jsx-runtime"),
  md = compile("../components/SafeReportMarkdown.tsx", { "react/jsx-runtime": jsx }, { URL });
function render({
  ready = true,
  loading = false,
  historical = false,
  detail = false,
  read = false,
} = {}) {
  const t = (ns) =>
    createTranslator({ locale: "en", messages: require("../messages/en.json"), namespace: ns });
  const components = compile(
    "../components/TaskResultsPanel.tsx",
    {
      react: React,
      "react/jsx-runtime": jsx,
      "next-intl": { useLocale: () => "en", useTranslations: t },
      "./ReportDialog": {
        ReportDialog: (p) =>
          p.open ? React.createElement("div", { role: "dialog" }, p.title, p.children) : null,
      },
      "./WorkspaceFeedback": {
        LoadingIndicator: () => null,
        InlineError: (p) => React.createElement("p", null, p.message),
        UnreadDot: () => React.createElement("span", { "data-unread": true }),
      },
      "./SafeReportMarkdown": md,
      "./TaskResultsPanel.module.css": {
        __esModule: true,
        default: new Proxy({}, { get: (_, p) => p }),
      },
    },
    { Intl, Date },
  );
  const row = {
    kind: "persistent",
    metadata: {
      resultId: "presult_PRIVATE_ID",
      taskId: "task_A",
      connectionId: "old_connection_PRIVATE_ID",
      receivedAt: 1000,
      read,
    },
    triggerKind: "legacy_unknown",
  };
  const model = {
    scope: "scope_A",
    canWrite: true,
    rows: ready ? [row] : [],
    ready,
    loading,
    complete: ready,
    error: "",
    filters: { actor: "all", filter: "all", query: "" },
    actors: ["muse"],
    providerFor: () => "muse",
    title: () => "PRIVATE <script> report",
    titleFailed: () => false,
    history: [],
    hasMore: false,
    scroll: { current: new Map() },
    presented() {
      throw Error("SSR cannot mark read");
    },
    detail: detail
      ? {
          row,
          historical,
          content: {
            title: "PRIVATE <script> report",
            summary: "Summary <img src=https://evil.test/secret>",
            sections: [
              {
                sectionId: "opaque_section_id",
                markdown: "![image](https://evil.test/track) <script>alert(1)</script>",
              },
            ],
            limitations: [],
          },
        }
      : null,
  };
  return renderToStaticMarkup(
    React.createElement(components.TaskResultsPanel, { taskId: "task_A", model }),
  );
}
test("task-owned reports display historical Agent and honest unknown provenance, with no technical IDs", () => {
  const html = render();
  assert.match(html, /Muse/);
  assert.match(html, /Source unknown/);
  assert.match(html, /Unread result/);
  assert.doesNotMatch(html, /presult_PRIVATE_ID|old_connection_PRIVATE_ID/);
  assert.match(html, /PRIVATE &lt;script&gt; report/);
  assert.doesNotMatch(render({ read: true }), /Unread result/);
});
test("initial loading is distinct from an empty task and historical modal content never offers current-state mutations", () => {
  assert.doesNotMatch(render({ ready: false, loading: true }), /No matching results/);
  const html = render({ detail: true, historical: true });
  assert.match(html, /Historical revision/);
  assert.doesNotMatch(html, /<img|<script|opaque_section_id|>Archive<|>Star</);
});
