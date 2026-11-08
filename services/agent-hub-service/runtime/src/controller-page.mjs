import { connect } from "./controller.mjs";
import { recoveryDiagnostic } from "./recovery.mjs";

// This page is the protected browser's visible adapter to the existing closed API.
// It has no credential input, arbitrary operation, URL, crypto or storage interface.
const $ = (id) => document.querySelector("#" + id),
  text = (id, value) =>
    ($(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2));
let api,
  pairing = false,
  connected = false,
  busy = false,
  epoch = 0,
  ended = false,
  reloadRequested = false,
  tasks = [],
  run = null,
  report = null,
  saved = false;
const sections = [],
  citations = [];
function node(tag, value = "") {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}
function controlState() {
  $("refresh-connection").disabled = !api || busy || ended;
  $("workspace").disabled = !connected || busy || ended;
  $("clear-plaintext").disabled = !api || ended;
  for (const id of ["begin-run", "check-plan", "record-plan", "retry-plan"])
    $(id).disabled = !selected();
  for (const id of ["task", "load-tasks", "check-due"]) $(id).disabled = report !== null && !saved;
  $("begin-run").disabled ||= report !== null && !saved;
  $("save-report").disabled = !run || saved;
  $("check-receipt").disabled = !run;
  for (const field of [
    $("report-title"),
    $("report-summary"),
    $("limitations"),
    ...sections.map((s) => s.field),
    ...citations.flatMap((c) => c.fields),
  ])
    field.readOnly = report !== null;
  $("add-citation").disabled = report !== null || citations.length >= 20;
}
function state(value) {
  connected = value.state === "connected";
  text("status", connected ? "已连接，可以使用获准任务。" : "连接已准备，请在 FolioView 中确认。");
  text("connection-result", value);
  controlState();
}
async function action(operation, apply = () => {}) {
  if (busy || ended || !api) return;
  busy = true;
  const original = epoch;
  controlState();
  text("operation-status", "正在处理…");
  try {
    const value = await operation();
    if (original !== epoch || ended) return;
    apply(value);
    text("operation-status", "已完成。");
  } catch (error) {
    if (original !== epoch || ended) return;
    const code = /^[a-z_]{1,80}$/.test(error.message ?? "")
      ? error.message
      : "runtime_operation_failed";
    text("operation-status", "操作未完成：" + code + "。请核对状态后重试原操作。");
    if (["private_schema_invalid", "private_output_mismatch"].includes(code)) report = null;
    if (code === "lost_private_keys") {
      clearView();
      connected = false;
      text("status", "此运行环境的原密钥不可用，请在 FolioView 修复连接。");
    }
  } finally {
    busy = false;
    controlState();
  }
}
function selected() {
  return tasks.find((t) => t.taskId === $("task").value) ?? null;
}
function clearRun() {
  run = null;
  report = null;
  saved = false;
  for (const s of sections) s.field.value = "";
  for (const c of citations) for (const field of c.fields) field.value = "";
  sections.length = 0;
  citations.length = 0;
  $("run").hidden = true;
  for (const id of ["inputs", "report-sections", "citations"]) $(id).replaceChildren();
  for (const id of ["run-result", "input-content", "receipt", "report-status"]) text(id, "");
  for (const id of ["report-title", "report-summary", "limitations"]) $(id).value = "";
}
function clearView() {
  epoch++;
  tasks = [];
  clearRun();
  $("task").replaceChildren(node("option", "请先读取获准任务"));
  $("task").value = "";
  $("due-tasks").replaceChildren();
  for (const id of ["task-content", "task-status", "plan-result"]) text(id, "");
  for (const id of ["trigger", "plan-reference"]) $(id).value = "";
  $("plan-state").value = "unconfirmed";
}
function chooseTask() {
  epoch++;
  clearRun();
  $("trigger").value = "";
  $("plan-reference").value = "";
  $("plan-state").value = "unconfirmed";
  text("plan-result", "");
  text("task-content", selected()?.task ?? "");
  controlState();
}
function showTasks(value) {
  clearView();
  tasks = value;
  const placeholder = node("option", "选择获准任务");
  placeholder.value = "";
  $("task").replaceChildren(placeholder);
  for (const task of tasks) {
    const option = node("option", task.task.name + " · v" + task.taskVersion);
    option.value = task.taskId;
    $("task").append(option);
  }
  text(
    "task-status",
    tasks.length
      ? "已读取 " + tasks.length + " 项获准任务。"
      : "尚无获准任务，请在 FolioView 审阅任务与资源。",
  );
}
function sectionField(section) {
  const label = node("label", section.title),
    field = document.createElement("textarea");
  field.id = "report-section-" + sections.length;
  field.maxLength = 16384;
  label.htmlFor = field.id;
  $("report-sections").append(label, field);
  sections.push({ id: section.sectionId, field });
}
function showRun(value) {
  clearRun();
  run = value;
  $("run").hidden = false;
  text("run-result", {
    runId: value.runId,
    state: value.state,
    resultId: value.resultId,
    inputs: value.inputs,
  });
  for (const input of value.inputs) {
    const button = node("button", "读取获准输入 · " + input.publicationId);
    button.type = "button";
    const runId = value.runId,
      publicationId = input.publicationId;
    button.addEventListener("click", () =>
      action(
        () => api.readInput(runId, publicationId),
        (result) => text("input-content", result),
      ),
    );
    $("inputs").append(button);
  }
  for (const section of value.task.outputSpec.sections) sectionField(section);
  text(
    "report-status",
    value.resultId
      ? "已有报告。请先核对原报告回执，避免重复生成。"
      : "报告将在本运行端加密后保存；重试沿用本次执行的原始加密报告。",
  );
  saved = Boolean(value.resultId);
}
function addCitation() {
  if (report || citations.length >= 20) return;
  const group = node("fieldset"),
    fields = [];
  group.append(node("legend", "引用 " + (citations.length + 1)));
  for (const [name, max] of [
    ["标题", 180],
    ["HTTPS 地址", 2048],
    ["发布时间（UTC，可留空）", 30],
  ]) {
    const field = document.createElement("input"),
      label = node("label", name);
    field.id = "citation-" + citations.length + "-" + fields.length;
    field.maxLength = max;
    field.required = fields.length < 2;
    field.autocomplete = "off";
    label.htmlFor = field.id;
    group.append(label, field);
    fields.push(field);
  }
  citations.push({ id: "citation_" + (citations.length + 1), fields });
  $("citations").append(group);
  controlState();
}
function reportContent() {
  const value = {
    title: $("report-title").value,
    summary: $("report-summary").value,
    sections: sections.map((s) => ({ sectionId: s.id, markdown: s.field.value })),
    citations: citations.map((c) => ({
      citationId: c.id,
      title: c.fields[0].value,
      url: c.fields[1].value,
      publishedAt: c.fields[2].value || null,
      provenance: "agent_provided",
    })),
    limitations: $("limitations")
      .value.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
  if (
    !value.title ||
    !value.summary ||
    value.limitations.length > 20 ||
    value.limitations.some((s) => s.length > 500)
  )
    throw Error("invalid_report");
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
    throw Error("report_too_large");
  return value;
}
function begin(taskId, triggerId) {
  if (report !== null && !saved) throw Error("pending_report");
  return api.beginRun(taskId, triggerId);
}
function taskId() {
  if (!selected()) throw Error("select_approved_task");
  return selected().taskId;
}
function submit(id, listener) {
  $(id).addEventListener("submit", (event) => {
    event.preventDefault();
    void listener();
  });
}
$("refresh-connection").addEventListener("click", () =>
  action(() => (pairing ? api.pairingStatus() : api.refreshConnection()), state),
);
$("load-tasks").addEventListener("click", () => action(() => api.listTasks(), showTasks));
$("task").addEventListener("change", () => {
  if (!busy) chooseTask();
});
$("check-due").addEventListener("click", () =>
  action(
    async () => ({ tasks: await api.listTasks(), due: await api.dueTasks() }),
    (value) => {
      showTasks(value.tasks);
      text(
        "task-status",
        value.due.length ? "有 " + value.due.length + " 项到期任务。" : "当前没有到期任务。",
      );
      for (const due of value.due) {
        const task = tasks.find(
          (t) => t.taskId === due.taskId && t.taskVersion === due.taskVersion,
        );
        if (!task) continue;
        const button = node("button", "执行本次到期任务 · " + task.task.name);
        button.type = "button";
        button.addEventListener("click", () => {
          if (busy || (report !== null && !saved)) return;
          $("task").value = task.taskId;
          chooseTask();
          $("trigger").value = due.triggerId;
          void action(() => begin(task.taskId, due.triggerId), showRun);
        });
        $("due-tasks").append(button);
      }
    },
  ),
);
submit("begin-form", () => action(() => begin(taskId(), $("trigger").value), showRun));
$("add-citation").addEventListener("click", addCitation);
submit("report-form", () =>
  action(
    async () => {
      if (!run || saved) throw Error("no_pending_report");
      report ??= reportContent();
      controlState();
      return api.saveReport(run.runId, report);
    },
    (value) => {
      saved = true;
      text("receipt", value);
      text("report-status", "报告已加密保存，回执已核对。");
    },
  ),
);
$("check-receipt").addEventListener("click", () =>
  action(
    () => {
      if (!run) throw Error("select_run");
      return api.resultReceipt(run.runId);
    },
    (value) => {
      saved = true;
      text("receipt", value);
      text("report-status", "已核对原报告回执。");
    },
  ),
);
$("check-plan").addEventListener("click", () =>
  action(
    () => api.planStatus(taskId()),
    (value) =>
      text("plan-result", {
        desired: value.desired,
        reported: value.reported,
        observed: value.observed,
        nativeScheduleAttested: value.nativeScheduleAttested,
      }),
  ),
);
submit("plan-form", () =>
  action(
    () => api.reportPlan(taskId(), $("plan-state").value, $("plan-reference").value || null),
    (value) => text("plan-result", value),
  ),
);
$("retry-plan").addEventListener("click", () =>
  action(
    () => api.retryPlanReport(taskId()),
    (value) => text("plan-result", value),
  ),
);
$("clear-plaintext").addEventListener("click", () => {
  if (!api || ended) return;
  // Clear synchronously even while a request is in flight or the Worker has failed.
  // epoch prevents that request from rendering plaintext after this point.
  clearView();
  controlState();
  text("operation-status", "本页明文已清除。连接身份和原加密重试记录保留。");
  void api.clearPlaintext().catch(() => {});
});
function leavePage() {
  if (ended) return;
  ended = true;
  clearView();
  controlState();
  void api?.clearPlaintext().catch(() => {});
}
function reloadRuntime() {
  if (reloadRequested) return;
  reloadRequested = true;
  leavePage();
  // setup and resume descriptors live in the fragment. Same-document navigation
  // must not leave the previous immutable API/Worker bound to the old descriptor.
  window.location.reload();
}
window.addEventListener("pagehide", leavePage);
window.addEventListener("hashchange", reloadRuntime);
window.addEventListener("pageshow", (event) => {
  // pagehide deliberately cleared the view. A BFCache restore needs a fresh
  // document/Worker, using the existing nonextractable profile and current URL.
  if (event.persisted) reloadRuntime();
});
try {
  const result = await connect();
  if (!ended) {
    api = window.folioview;
    pairing = result.state.state === "awaiting_owner_approval";
    $("owner").href = result.approvalUrl;
    $("owner").hidden = false;
    state(result.state);
  }
} catch (error) {
  const diagnostic = recoveryDiagnostic(error.diagnostic);
  if (diagnostic) text("connection-result", diagnostic);
  text(
    "status",
    error.message === "lost_private_keys"
      ? "此运行环境的连接密钥不可用。请在 FolioView 修复连接；现有资源和报告会保留。"
      : "连接暂时不可用，请稍后重试或在 FolioView 查看连接状态。",
  );
}
