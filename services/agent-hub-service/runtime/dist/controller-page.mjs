import { connect as O } from "./controller.mjs";
var M = ["profile_record_missing", "profile_validation_failed", "identity_key_mismatch"];
function C(t) {
  if (!t || !M.includes(t.stage) || !/^profile:[a-f0-9]{64}$/.test(t.namespace)) return null;
  let e = { stage: t.stage, namespace: t.namespace };
  if (t.stage === "identity_key_mismatch")
    for (let i of ["signingKeyMatches", "encryptionKeyMatches", "identityActive"]) {
      if (typeof t[i] != "boolean") return null;
      e[i] = t[i];
    }
  return e;
}
var n = (t) => document.querySelector("#" + t),
  r = (t, e) => (n(t).textContent = typeof e == "string" ? e : JSON.stringify(e, null, 2)),
  o,
  F = !1,
  b = !1,
  k = !1,
  w = 0,
  u = !1,
  S = !1,
  m = [],
  h = null,
  l = null,
  p = !1,
  v = [],
  d = [];
function f(t, e = "") {
  let i = document.createElement(t);
  return ((i.textContent = e), i);
}
function g() {
  ((n("refresh-connection").disabled = !o || k || u),
    (n("workspace").disabled = !b || k || u),
    (n("clear-plaintext").disabled = !o || u));
  for (let t of ["begin-run", "check-plan", "record-plan", "retry-plan"]) n(t).disabled = !_();
  for (let t of ["task", "load-tasks", "check-due"]) n(t).disabled = l !== null && !p;
  ((n("begin-run").disabled ||= l !== null && !p),
    (n("save-report").disabled = !h || p),
    (n("check-receipt").disabled = !h));
  for (let t of [
    n("report-title"),
    n("report-summary"),
    n("limitations"),
    ...v.map((e) => e.field),
    ...d.flatMap((e) => e.fields),
  ])
    t.readOnly = l !== null;
  n("add-citation").disabled = l !== null || d.length >= 20;
}
function T(t) {
  ((b = t.state === "connected"),
    r(
      "status",
      b
        ? "\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u4F7F\u7528\u83B7\u51C6\u4EFB\u52A1\u3002"
        : "\u8FDE\u63A5\u5DF2\u51C6\u5907\uFF0C\u8BF7\u5728 FolioView \u4E2D\u786E\u8BA4\u3002",
    ),
    r("connection-result", t),
    g());
}
async function c(t, e = () => {}) {
  if (k || u || !o) return;
  k = !0;
  let i = w;
  (g(), r("operation-status", "\u6B63\u5728\u5904\u7406\u2026"));
  try {
    let a = await t();
    if (i !== w || u) return;
    (e(a), r("operation-status", "\u5DF2\u5B8C\u6210\u3002"));
  } catch (a) {
    if (i !== w || u) return;
    let s = /^[a-z_]{1,80}$/.test(a.message ?? "") ? a.message : "runtime_operation_failed";
    (r(
      "operation-status",
      "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF1A" +
        s +
        "\u3002\u8BF7\u6838\u5BF9\u72B6\u6001\u540E\u91CD\u8BD5\u539F\u64CD\u4F5C\u3002",
    ),
      ["private_schema_invalid", "private_output_mismatch"].includes(s) && (l = null),
      s === "lost_private_keys" &&
        (I(),
        (b = !1),
        r(
          "status",
          "\u6B64\u8FD0\u884C\u73AF\u5883\u7684\u539F\u5BC6\u94A5\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5728 FolioView \u4FEE\u590D\u8FDE\u63A5\u3002",
        )));
  } finally {
    ((k = !1), g());
  }
}
function _() {
  return m.find((t) => t.taskId === n("task").value) ?? null;
}
function L() {
  ((h = null), (l = null), (p = !1));
  for (let t of v) t.field.value = "";
  for (let t of d) for (let e of t.fields) e.value = "";
  ((v.length = 0), (d.length = 0), (n("run").hidden = !0));
  for (let t of ["inputs", "report-sections", "citations"]) n(t).replaceChildren();
  for (let t of ["run-result", "input-content", "receipt", "report-status"]) r(t, "");
  for (let t of ["report-title", "report-summary", "limitations"]) n(t).value = "";
}
function I() {
  (w++,
    (m = []),
    L(),
    n("task").replaceChildren(f("option", "\u8BF7\u5148\u8BFB\u53D6\u83B7\u51C6\u4EFB\u52A1")),
    (n("task").value = ""),
    n("due-tasks").replaceChildren());
  for (let t of ["task-content", "task-status", "plan-result"]) r(t, "");
  for (let t of ["trigger", "plan-reference"]) n(t).value = "";
  n("plan-state").value = "unconfirmed";
}
function V() {
  (w++,
    L(),
    (n("trigger").value = ""),
    (n("plan-reference").value = ""),
    (n("plan-state").value = "unconfirmed"),
    r("plan-result", ""),
    r("task-content", _()?.task ?? ""),
    g());
}
function R(t) {
  (I(), (m = t));
  let e = f("option", "\u9009\u62E9\u83B7\u51C6\u4EFB\u52A1");
  ((e.value = ""), n("task").replaceChildren(e));
  for (let i of m) {
    let a = f("option", i.task.name + " \xB7 v" + i.taskVersion);
    ((a.value = i.taskId), n("task").append(a));
  }
  r(
    "task-status",
    m.length
      ? "\u5DF2\u8BFB\u53D6 " + m.length + " \u9879\u83B7\u51C6\u4EFB\u52A1\u3002"
      : "\u5C1A\u65E0\u83B7\u51C6\u4EFB\u52A1\uFF0C\u8BF7\u5728 FolioView \u5BA1\u9605\u4EFB\u52A1\u4E0E\u8D44\u6E90\u3002",
  );
}
function $(t) {
  let e = f("label", t.title),
    i = document.createElement("textarea");
  ((i.id = "report-section-" + v.length),
    (i.maxLength = 16384),
    (e.htmlFor = i.id),
    n("report-sections").append(e, i),
    v.push({ id: t.sectionId, field: i }));
}
function P(t) {
  (L(),
    (h = t),
    (n("run").hidden = !1),
    r("run-result", { runId: t.runId, state: t.state, resultId: t.resultId, inputs: t.inputs }));
  for (let e of t.inputs) {
    let i = f("button", "\u8BFB\u53D6\u83B7\u51C6\u8F93\u5165 \xB7 " + e.publicationId);
    i.type = "button";
    let a = t.runId,
      s = e.publicationId;
    (i.addEventListener("click", () =>
      c(
        () => o.readInput(a, s),
        (y) => r("input-content", y),
      ),
    ),
      n("inputs").append(i));
  }
  for (let e of t.task.outputSpec.sections) $(e);
  (r(
    "report-status",
    t.resultId
      ? "\u5DF2\u6709\u62A5\u544A\u3002\u8BF7\u5148\u6838\u5BF9\u539F\u62A5\u544A\u56DE\u6267\uFF0C\u907F\u514D\u91CD\u590D\u751F\u6210\u3002"
      : "\u62A5\u544A\u5C06\u5728\u672C\u8FD0\u884C\u7AEF\u52A0\u5BC6\u540E\u4FDD\u5B58\uFF1B\u91CD\u8BD5\u6CBF\u7528\u672C\u6B21\u6267\u884C\u7684\u539F\u59CB\u52A0\u5BC6\u62A5\u544A\u3002",
  ),
    (p = !!t.resultId));
}
function B() {
  if (l || d.length >= 20) return;
  let t = f("fieldset"),
    e = [];
  t.append(f("legend", "\u5F15\u7528 " + (d.length + 1)));
  for (let [i, a] of [
    ["\u6807\u9898", 180],
    ["HTTPS \u5730\u5740", 2048],
    ["\u53D1\u5E03\u65F6\u95F4\uFF08UTC\uFF0C\u53EF\u7559\u7A7A\uFF09", 30],
  ]) {
    let s = document.createElement("input"),
      y = f("label", i);
    ((s.id = "citation-" + d.length + "-" + e.length),
      (s.maxLength = a),
      (s.required = e.length < 2),
      (s.autocomplete = "off"),
      (y.htmlFor = s.id),
      t.append(y, s),
      e.push(s));
  }
  (d.push({ id: "citation_" + (d.length + 1), fields: e }), n("citations").append(t), g());
}
function J() {
  let t = {
    title: n("report-title").value,
    summary: n("report-summary").value,
    sections: v.map((e) => ({ sectionId: e.id, markdown: e.field.value })),
    citations: d.map((e) => ({
      citationId: e.id,
      title: e.fields[0].value,
      url: e.fields[1].value,
      publishedAt: e.fields[2].value || null,
      provenance: "agent_provided",
    })),
    limitations: n("limitations")
      .value.split(/\r?\n/)
      .map((e) => e.trim())
      .filter(Boolean),
  };
  if (
    !t.title ||
    !t.summary ||
    t.limitations.length > 20 ||
    t.limitations.some((e) => e.length > 500)
  )
    throw Error("invalid_report");
  if (new TextEncoder().encode(JSON.stringify(t)).length > 65536) throw Error("report_too_large");
  return t;
}
function A(t, e) {
  if (l !== null && !p) throw Error("pending_report");
  return o.beginRun(t, e);
}
function E() {
  if (!_()) throw Error("select_approved_task");
  return _().taskId;
}
function x(t, e) {
  n(t).addEventListener("submit", (i) => {
    (i.preventDefault(), e());
  });
}
n("refresh-connection").addEventListener("click", () =>
  c(() => (F ? o.pairingStatus() : o.refreshConnection()), T),
);
n("load-tasks").addEventListener("click", () => c(() => o.listTasks(), R));
n("task").addEventListener("change", () => {
  k || V();
});
n("check-due").addEventListener("click", () =>
  c(
    async () => ({ tasks: await o.listTasks(), due: await o.dueTasks() }),
    (t) => {
      (R(t.tasks),
        r(
          "task-status",
          t.due.length
            ? "\u6709 " + t.due.length + " \u9879\u5230\u671F\u4EFB\u52A1\u3002"
            : "\u5F53\u524D\u6CA1\u6709\u5230\u671F\u4EFB\u52A1\u3002",
        ));
      for (let e of t.due) {
        let i = m.find((s) => s.taskId === e.taskId && s.taskVersion === e.taskVersion);
        if (!i) continue;
        let a = f("button", "\u6267\u884C\u672C\u6B21\u5230\u671F\u4EFB\u52A1 \xB7 " + i.task.name);
        ((a.type = "button"),
          a.addEventListener("click", () => {
            k ||
              (l !== null && !p) ||
              ((n("task").value = i.taskId),
              V(),
              (n("trigger").value = e.triggerId),
              c(() => A(i.taskId, e.triggerId), P));
          }),
          n("due-tasks").append(a));
      }
    },
  ),
);
x("begin-form", () => c(() => A(E(), n("trigger").value), P));
n("add-citation").addEventListener("click", B);
x("report-form", () =>
  c(
    async () => {
      if (!h || p) throw Error("no_pending_report");
      return ((l ??= J()), g(), o.saveReport(h.runId, l));
    },
    (t) => {
      ((p = !0),
        r("receipt", t),
        r(
          "report-status",
          "\u62A5\u544A\u5DF2\u52A0\u5BC6\u4FDD\u5B58\uFF0C\u56DE\u6267\u5DF2\u6838\u5BF9\u3002",
        ));
    },
  ),
);
n("check-receipt").addEventListener("click", () =>
  c(
    () => {
      if (!h) throw Error("select_run");
      return o.resultReceipt(h.runId);
    },
    (t) => {
      ((p = !0),
        r("receipt", t),
        r("report-status", "\u5DF2\u6838\u5BF9\u539F\u62A5\u544A\u56DE\u6267\u3002"));
    },
  ),
);
n("check-plan").addEventListener("click", () =>
  c(
    () => o.planStatus(E()),
    (t) =>
      r("plan-result", {
        desired: t.desired,
        reported: t.reported,
        observed: t.observed,
        nativeScheduleAttested: t.nativeScheduleAttested,
      }),
  ),
);
x("plan-form", () =>
  c(
    () => o.reportPlan(E(), n("plan-state").value, n("plan-reference").value || null),
    (t) => r("plan-result", t),
  ),
);
n("retry-plan").addEventListener("click", () =>
  c(
    () => o.retryPlanReport(E()),
    (t) => r("plan-result", t),
  ),
);
n("clear-plaintext").addEventListener("click", () => {
  !o ||
    u ||
    (I(),
    g(),
    r(
      "operation-status",
      "\u672C\u9875\u660E\u6587\u5DF2\u6E05\u9664\u3002\u8FDE\u63A5\u8EAB\u4EFD\u548C\u539F\u52A0\u5BC6\u91CD\u8BD5\u8BB0\u5F55\u4FDD\u7559\u3002",
    ),
    o.clearPlaintext().catch(() => {}));
});
function q() {
  u || ((u = !0), I(), g(), o?.clearPlaintext().catch(() => {}));
}
function D() {
  S || ((S = !0), q(), window.location.reload());
}
window.addEventListener("pagehide", q);
window.addEventListener("hashchange", D);
window.addEventListener("pageshow", (t) => {
  t.persisted && D();
});
try {
  let t = await O();
  u ||
    ((o = window.folioview),
    (F = t.state.state === "awaiting_owner_approval"),
    (n("owner").href = t.approvalUrl),
    (n("owner").hidden = !1),
    T(t.state));
} catch (t) {
  let e = C(t.diagnostic);
  (e && r("connection-result", e),
    r(
      "status",
      t.message === "lost_private_keys"
        ? "\u6B64\u8FD0\u884C\u73AF\u5883\u7684\u8FDE\u63A5\u5BC6\u94A5\u4E0D\u53EF\u7528\u3002\u8BF7\u5728 FolioView \u4FEE\u590D\u8FDE\u63A5\uFF1B\u73B0\u6709\u8D44\u6E90\u548C\u62A5\u544A\u4F1A\u4FDD\u7559\u3002"
        : "\u8FDE\u63A5\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u5728 FolioView \u67E5\u770B\u8FDE\u63A5\u72B6\u6001\u3002",
    ));
}
