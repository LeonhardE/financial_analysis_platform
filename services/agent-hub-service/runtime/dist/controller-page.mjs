import { connect as P } from "./controller.mjs";
var e = (t) => document.querySelector("#" + t),
  i = (t, n) => (e(t).textContent = typeof n == "string" ? n : JSON.stringify(n, null, 2)),
  o,
  C = !1,
  I = !1,
  g = !1,
  b = 0,
  f = !1,
  m = [],
  h = null,
  l = null,
  u = !1,
  v = [],
  c = [];
function p(t, n = "") {
  let r = document.createElement(t);
  return ((r.textContent = n), r);
}
function k() {
  ((e("refresh-connection").disabled = !o || g || f),
    (e("workspace").disabled = !I || g || f),
    (e("clear-plaintext").disabled = !o || f));
  for (let t of ["begin-run", "check-plan", "record-plan", "retry-plan"]) e(t).disabled = !y();
  for (let t of ["task", "load-tasks", "check-due"]) e(t).disabled = l !== null && !u;
  ((e("begin-run").disabled ||= l !== null && !u),
    (e("save-report").disabled = !h || u),
    (e("check-receipt").disabled = !h));
  for (let t of [
    e("report-title"),
    e("report-summary"),
    e("limitations"),
    ...v.map((n) => n.field),
    ...c.flatMap((n) => n.fields),
  ])
    t.readOnly = l !== null;
  e("add-citation").disabled = l !== null || c.length >= 20;
}
function S(t) {
  ((I = t.state === "connected"),
    i(
      "status",
      I
        ? "\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u4F7F\u7528\u83B7\u51C6\u4EFB\u52A1\u3002"
        : "\u8FDE\u63A5\u5DF2\u51C6\u5907\uFF0C\u8BF7\u5728 FolioView \u4E2D\u786E\u8BA4\u3002",
    ),
    i("connection-result", t),
    k());
}
async function d(t, n = () => {}) {
  if (g || f || !o) return;
  g = !0;
  let r = b;
  (k(), i("operation-status", "\u6B63\u5728\u5904\u7406\u2026"));
  try {
    let a = await t();
    if (r !== b || f) return;
    (n(a), i("operation-status", "\u5DF2\u5B8C\u6210\u3002"));
  } catch (a) {
    if (r !== b || f) return;
    let s = /^[a-z_]{1,80}$/.test(a.message ?? "") ? a.message : "runtime_operation_failed";
    (i(
      "operation-status",
      "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF1A" +
        s +
        "\u3002\u8BF7\u6838\u5BF9\u72B6\u6001\u540E\u91CD\u8BD5\u539F\u64CD\u4F5C\u3002",
    ),
      ["private_schema_invalid", "private_output_mismatch"].includes(s) && (l = null),
      s === "lost_private_keys" &&
        (_(),
        (I = !1),
        i(
          "status",
          "\u6B64\u8FD0\u884C\u73AF\u5883\u7684\u539F\u5BC6\u94A5\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5728 FolioView \u4FEE\u590D\u8FDE\u63A5\u3002",
        )));
  } finally {
    ((g = !1), k());
  }
}
function y() {
  return m.find((t) => t.taskId === e("task").value) ?? null;
}
function L() {
  ((h = null), (l = null), (u = !1));
  for (let t of v) t.field.value = "";
  for (let t of c) for (let n of t.fields) n.value = "";
  ((v.length = 0), (c.length = 0), (e("run").hidden = !0));
  for (let t of ["inputs", "report-sections", "citations"]) e(t).replaceChildren();
  for (let t of ["run-result", "input-content", "receipt", "report-status"]) i(t, "");
  for (let t of ["report-title", "report-summary", "limitations"]) e(t).value = "";
}
function _() {
  (b++,
    (m = []),
    L(),
    e("task").replaceChildren(p("option", "\u8BF7\u5148\u8BFB\u53D6\u83B7\u51C6\u4EFB\u52A1")),
    (e("task").value = ""),
    e("due-tasks").replaceChildren());
  for (let t of ["task-content", "task-status", "plan-result"]) i(t, "");
  for (let t of ["trigger", "plan-reference"]) e(t).value = "";
  e("plan-state").value = "unconfirmed";
}
function T() {
  (b++,
    L(),
    (e("trigger").value = ""),
    (e("plan-reference").value = ""),
    (e("plan-state").value = "unconfirmed"),
    i("plan-result", ""),
    i("task-content", y()?.task ?? ""),
    k());
}
function V(t) {
  (_(), (m = t));
  let n = p("option", "\u9009\u62E9\u83B7\u51C6\u4EFB\u52A1");
  ((n.value = ""), e("task").replaceChildren(n));
  for (let r of m) {
    let a = p("option", r.task.name + " \xB7 v" + r.taskVersion);
    ((a.value = r.taskId), e("task").append(a));
  }
  i(
    "task-status",
    m.length
      ? "\u5DF2\u8BFB\u53D6 " + m.length + " \u9879\u83B7\u51C6\u4EFB\u52A1\u3002"
      : "\u5C1A\u65E0\u83B7\u51C6\u4EFB\u52A1\uFF0C\u8BF7\u5728 FolioView \u5BA1\u9605\u4EFB\u52A1\u4E0E\u8D44\u6E90\u3002",
  );
}
function A(t) {
  let n = p("label", t.title),
    r = document.createElement("textarea");
  ((r.id = "report-section-" + v.length),
    (r.maxLength = 16384),
    (n.htmlFor = r.id),
    e("report-sections").append(n, r),
    v.push({ id: t.sectionId, field: r }));
}
function F(t) {
  (L(),
    (h = t),
    (e("run").hidden = !1),
    i("run-result", { runId: t.runId, state: t.state, resultId: t.resultId, inputs: t.inputs }));
  for (let n of t.inputs) {
    let r = p("button", "\u8BFB\u53D6\u83B7\u51C6\u8F93\u5165 \xB7 " + n.publicationId);
    r.type = "button";
    let a = t.runId,
      s = n.publicationId;
    (r.addEventListener("click", () =>
      d(
        () => o.readInput(a, s),
        (w) => i("input-content", w),
      ),
    ),
      e("inputs").append(r));
  }
  for (let n of t.task.outputSpec.sections) A(n);
  (i(
    "report-status",
    t.resultId
      ? "\u5DF2\u6709\u62A5\u544A\u3002\u8BF7\u5148\u6838\u5BF9\u539F\u62A5\u544A\u56DE\u6267\uFF0C\u907F\u514D\u91CD\u590D\u751F\u6210\u3002"
      : "\u62A5\u544A\u5C06\u5728\u672C\u8FD0\u884C\u7AEF\u52A0\u5BC6\u540E\u4FDD\u5B58\uFF1B\u91CD\u8BD5\u6CBF\u7528\u672C\u6B21\u6267\u884C\u7684\u539F\u59CB\u52A0\u5BC6\u62A5\u544A\u3002",
  ),
    (u = !!t.resultId));
}
function O() {
  if (l || c.length >= 20) return;
  let t = p("fieldset"),
    n = [];
  t.append(p("legend", "\u5F15\u7528 " + (c.length + 1)));
  for (let [r, a] of [
    ["\u6807\u9898", 180],
    ["HTTPS \u5730\u5740", 2048],
    ["\u53D1\u5E03\u65F6\u95F4\uFF08UTC\uFF0C\u53EF\u7559\u7A7A\uFF09", 30],
  ]) {
    let s = document.createElement("input"),
      w = p("label", r);
    ((s.id = "citation-" + c.length + "-" + n.length),
      (s.maxLength = a),
      (s.required = n.length < 2),
      (s.autocomplete = "off"),
      (w.htmlFor = s.id),
      t.append(w, s),
      n.push(s));
  }
  (c.push({ id: "citation_" + (c.length + 1), fields: n }), e("citations").append(t), k());
}
function q() {
  let t = {
    title: e("report-title").value,
    summary: e("report-summary").value,
    sections: v.map((n) => ({ sectionId: n.id, markdown: n.field.value })),
    citations: c.map((n) => ({
      citationId: n.id,
      title: n.fields[0].value,
      url: n.fields[1].value,
      publishedAt: n.fields[2].value || null,
      provenance: "agent_provided",
    })),
    limitations: e("limitations")
      .value.split(/\r?\n/)
      .map((n) => n.trim())
      .filter(Boolean),
  };
  if (
    !t.title ||
    !t.summary ||
    t.limitations.length > 20 ||
    t.limitations.some((n) => n.length > 500)
  )
    throw Error("invalid_report");
  if (new TextEncoder().encode(JSON.stringify(t)).length > 65536) throw Error("report_too_large");
  return t;
}
function R(t, n) {
  if (l !== null && !u) throw Error("pending_report");
  return o.beginRun(t, n);
}
function E() {
  if (!y()) throw Error("select_approved_task");
  return y().taskId;
}
function x(t, n) {
  e(t).addEventListener("submit", (r) => {
    (r.preventDefault(), n());
  });
}
e("refresh-connection").addEventListener("click", () =>
  d(() => (C ? o.pairingStatus() : o.refreshConnection()), S),
);
e("load-tasks").addEventListener("click", () => d(() => o.listTasks(), V));
e("task").addEventListener("change", () => {
  g || T();
});
e("check-due").addEventListener("click", () =>
  d(
    async () => ({ tasks: await o.listTasks(), due: await o.dueTasks() }),
    (t) => {
      (V(t.tasks),
        i(
          "task-status",
          t.due.length
            ? "\u6709 " + t.due.length + " \u9879\u5230\u671F\u4EFB\u52A1\u3002"
            : "\u5F53\u524D\u6CA1\u6709\u5230\u671F\u4EFB\u52A1\u3002",
        ));
      for (let n of t.due) {
        let r = m.find((s) => s.taskId === n.taskId && s.taskVersion === n.taskVersion);
        if (!r) continue;
        let a = p("button", "\u6267\u884C\u672C\u6B21\u5230\u671F\u4EFB\u52A1 \xB7 " + r.task.name);
        ((a.type = "button"),
          a.addEventListener("click", () => {
            g ||
              (l !== null && !u) ||
              ((e("task").value = r.taskId),
              T(),
              (e("trigger").value = n.triggerId),
              d(() => R(r.taskId, n.triggerId), F));
          }),
          e("due-tasks").append(a));
      }
    },
  ),
);
x("begin-form", () => d(() => R(E(), e("trigger").value), F));
e("add-citation").addEventListener("click", O);
x("report-form", () =>
  d(
    async () => {
      if (!h || u) throw Error("no_pending_report");
      return ((l ??= q()), k(), o.saveReport(h.runId, l));
    },
    (t) => {
      ((u = !0),
        i("receipt", t),
        i(
          "report-status",
          "\u62A5\u544A\u5DF2\u52A0\u5BC6\u4FDD\u5B58\uFF0C\u56DE\u6267\u5DF2\u6838\u5BF9\u3002",
        ));
    },
  ),
);
e("check-receipt").addEventListener("click", () =>
  d(
    () => {
      if (!h) throw Error("select_run");
      return o.resultReceipt(h.runId);
    },
    (t) => {
      ((u = !0),
        i("receipt", t),
        i("report-status", "\u5DF2\u6838\u5BF9\u539F\u62A5\u544A\u56DE\u6267\u3002"));
    },
  ),
);
e("check-plan").addEventListener("click", () =>
  d(
    () => o.planStatus(E()),
    (t) =>
      i("plan-result", {
        desired: t.desired,
        reported: t.reported,
        observed: t.observed,
        nativeScheduleAttested: t.nativeScheduleAttested,
      }),
  ),
);
x("plan-form", () =>
  d(
    () => o.reportPlan(E(), e("plan-state").value, e("plan-reference").value || null),
    (t) => i("plan-result", t),
  ),
);
e("retry-plan").addEventListener("click", () =>
  d(
    () => o.retryPlanReport(E()),
    (t) => i("plan-result", t),
  ),
);
e("clear-plaintext").addEventListener("click", () => {
  !o ||
    f ||
    (_(),
    k(),
    i(
      "operation-status",
      "\u672C\u9875\u660E\u6587\u5DF2\u6E05\u9664\u3002\u8FDE\u63A5\u8EAB\u4EFD\u548C\u539F\u52A0\u5BC6\u91CD\u8BD5\u8BB0\u5F55\u4FDD\u7559\u3002",
    ),
    o.clearPlaintext().catch(() => {}));
});
window.addEventListener("pagehide", () => {
  ((f = !0), _(), k(), o?.clearPlaintext().catch(() => {}));
});
try {
  let t = await P();
  ((o = window.folioview),
    (C = t.state.state === "awaiting_owner_approval"),
    (e("owner").href = t.approvalUrl),
    (e("owner").hidden = !1),
    S(t.state));
} catch (t) {
  i(
    "status",
    t.message === "lost_private_keys"
      ? "\u6B64\u8FD0\u884C\u73AF\u5883\u7684\u8FDE\u63A5\u5BC6\u94A5\u4E0D\u53EF\u7528\u3002\u8BF7\u5728 FolioView \u4FEE\u590D\u8FDE\u63A5\uFF1B\u73B0\u6709\u8D44\u6E90\u548C\u62A5\u544A\u4F1A\u4FDD\u7559\u3002"
      : "\u8FDE\u63A5\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u5728 FolioView \u67E5\u770B\u8FDE\u63A5\u72B6\u6001\u3002",
  );
}
