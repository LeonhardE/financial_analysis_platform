import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { recoveryDiagnostic } from "../runtime/src/recovery.mjs";
const html = await readFile(new URL("../runtime/static/controller.html", import.meta.url), "utf8");
const script = (
  await readFile(new URL("../runtime/src/controller-page.mjs", import.meta.url), "utf8")
)
  .replace('import { connect } from "./controller.mjs";', "const connect = connectFixture;")
  .replace('import { recoveryDiagnostic } from "./recovery.mjs";', "");
const task = {
  taskId: "task_synthetic",
  taskVersion: 2,
  task: {
    name: '<img src=x onerror="secret()">',
    outputSpec: { sections: [{ sectionId: "risks", title: "风险" }] },
  },
};
const trigger = "muse_synthetic_execution_0001";
function fixture(options = {}) {
  const ids = new Map(),
    events = new Map(),
    calls = [],
    overrides = {};
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.listeners = new Map();
      this.value = "";
      this.disabled = false;
      this.readOnly = false;
      this._text = "";
    }
    set id(value) {
      this._id = value;
      ids.set(value, this);
    }
    get id() {
      return this._id;
    }
    set innerHTML(_) {
      throw Error("HTML injection forbidden");
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join("");
    }
    append(...items) {
      for (const item of items) {
        item.parent = this;
        this.children.push(item);
      }
    }
    replaceChildren(...items) {
      this.children = [];
      this._text = "";
      this.append(...items);
    }
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    }
    async fire(type = "click") {
      for (let e = this; e; e = e.parent) if (e.disabled) return;
      await this.listeners.get(type)?.({ preventDefault() {} });
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    }
  }
  for (const m of html.matchAll(/<([a-z-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const field = new Element(m[1]);
    field.id = m[2];
    field.disabled = /\sdisabled(?:\s|>)/.test(m[0]);
  }
  const $ = (id) => ids.get(id);
  // Model the actual disabled workspace, including form-submit controls.
  for (const id of [
    "load-tasks",
    "check-due",
    "task",
    "begin-form",
    "report-form",
    "check-receipt",
    "check-plan",
    "plan-form",
    "retry-plan",
    "add-citation",
  ])
    $(id).parent = $("workspace");
  const run = {
    runId: "run_synthetic",
    task: task.task,
    inputs: [
      {
        publicationId: "publication_synthetic_00001",
        ref: { kind: "holdings" },
        sourceRevision: 1,
      },
    ],
    state: "active",
    resultId: null,
  };
  const methods = {
    status: () => ({ state: "connected" }),
    refreshConnection: () => ({ state: "connected" }),
    pairingStatus: () => ({ state: "connected" }),
    listTasks: () => [task],
    dueTasks: () => [{ taskId: task.taskId, taskVersion: 2, triggerId: trigger }],
    beginRun: () => run,
    readInput: () => ({ resource: { name: "Synthetic holdings" } }),
    saveReport: () => ({ state: "saved", runId: run.runId }),
    resultReceipt: () => ({ state: "saved", runId: run.runId }),
    planStatus: () => ({
      desired: { taskVersion: 2 },
      reported: null,
      observed: null,
      nativeScheduleAttested: false,
      reportedEvidence: "must-not-render",
    }),
    reportPlan: () => ({ state: "reported", nativeScheduleAttested: false }),
    retryPlanReport: () => ({ state: "reported" }),
    clearPlaintext: () => ({ state: "connected" }),
  };
  const api = Object.fromEntries(
    Object.entries(methods).map(([name, fn]) => [
      name,
      async (...args) => {
        calls.push([name, structuredClone(args)]);
        return (overrides[name] ?? fn)(...args);
      },
    ]),
  );
  const window = {
    folioview: api,
    location: { reload: () => calls.push(["reload"]) },
    addEventListener: (name, fn) => events.set(name, fn),
  };
  const ready = vm.runInNewContext("(async()=>{\n" + script + "\n})()", {
    window,
    document: {
      querySelector: (selector) => $(selector.slice(1)),
      createElement: (tag) => new Element(tag),
    },
    TextEncoder,
    recoveryDiagnostic,
    connectFixture: async () => {
      calls.push(["connect"]);
      if (options.lost) {
        const error = Error("lost_private_keys");
        error.diagnostic = options.diagnostic;
        throw error;
      }
      return {
        state: { state: options.pending ? "awaiting_owner_approval" : "connected" },
        approvalUrl: "https://owner.example/agents?runtime_setup=synthetic",
      };
    },
  });
  return {
    $,
    api,
    calls,
    overrides,
    ready,
    events,
    async choose() {
      await ready;
      await $("load-tasks").fire();
      $("task").value = task.taskId;
      await $("task").fire("change");
    },
    async begin() {
      await this.choose();
      $("trigger").value = trigger;
      await $("begin-form").fire("submit");
    },
    fillReport() {
      $("report-title").value = "Synthetic report";
      $("report-summary").value = "Summary";
      $("report-section-0").value = "Synthetic **risk**";
      $("limitations").value = "Synthetic only";
    },
  };
}
test("first pairing and an existing lost profile never reconnect or run financial methods", async () => {
  const f = fixture({ pending: true });
  await f.ready;
  assert.equal(f.$("workspace").disabled, true);
  await f.$("load-tasks").fire();
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["connect"],
  );
  await f.$("refresh-connection").fire();
  assert.equal(f.$("workspace").disabled, false);
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["connect", "pairingStatus"],
  );
  const lost = fixture({ lost: true });
  await lost.ready;
  assert.equal(lost.$("workspace").disabled, true);
  assert.match(lost.$("status").textContent, /连接密钥不可用/);
  assert.deepEqual(
    lost.calls.map((c) => c[0]),
    ["connect"],
  );
});
test("failed restore displays only bounded diagnostic metadata and retains the closed workspace", async () => {
  const diagnostic = {
    stage: "profile_record_missing",
    namespace: "profile:" + "a".repeat(64),
  };
  const f = fixture({ lost: true, diagnostic: { ...diagnostic, token: "never-render-secret" } });
  await f.ready;
  assert.deepEqual(JSON.parse(f.$("connection-result").textContent), diagnostic);
  assert.equal(f.$("workspace").disabled, true);
  assert.deepEqual(f.calls, [["connect"]]);
});
test("DOM-only task, frozen input and encrypted report flow binds original identifiers", async () => {
  const f = fixture();
  await f.begin();
  assert.equal(f.$("task").children[1].textContent, task.task.name + " · v2");
  assert.deepEqual(f.calls.find((c) => c[0] === "beginRun")[1], [task.taskId, trigger]);
  await f.$("inputs").children[0].fire();
  assert.deepEqual(f.calls.find((c) => c[0] === "readInput")[1], [
    "run_synthetic",
    "publication_synthetic_00001",
  ]);
  f.fillReport();
  await f.$("report-form").fire("submit");
  const [runId, report] = f.calls.find((c) => c[0] === "saveReport")[1];
  assert.equal(runId, "run_synthetic");
  assert.deepEqual(report, {
    title: "Synthetic report",
    summary: "Summary",
    sections: [{ sectionId: "risks", markdown: "Synthetic **risk**" }],
    citations: [],
    limitations: ["Synthetic only"],
  });
  assert.equal(f.$("save-report").disabled, true);
  assert.match(f.$("receipt").textContent, /saved/);
  await f.$("check-receipt").fire();
  assert.equal(f.calls.filter((c) => c[0] === "beginRun").length, 1);
});
test("unknown save outcome freezes the original report for exact retry and receipt recovery", async () => {
  const f = fixture();
  await f.begin();
  f.fillReport();
  f.overrides.saveReport = () => {
    throw Error("runtime_network_unavailable");
  };
  await f.$("report-form").fire("submit");
  assert.equal(f.$("report-title").readOnly, true);
  assert.equal(f.$("load-tasks").disabled, true);
  assert.equal(f.$("check-due").disabled, true);
  assert.equal(f.$("report-title").value, "Synthetic report");
  await f.$("begin-form").fire("submit");
  assert.equal(f.calls.filter((c) => c[0] === "beginRun").length, 1);
  f.$("report-title").value = "A changed DOM value must not replace the pending report";
  delete f.overrides.saveReport;
  await f.$("report-form").fire("submit");
  const saves = f.calls.filter((c) => c[0] === "saveReport");
  assert.deepEqual(saves[0][1], saves[1][1]);
  assert.equal(f.calls.filter((c) => c[0] === "connect").length, 1);
});
test("scheduled slots use the verified original trigger and plan reports do not attest native installation", async () => {
  const f = fixture();
  await f.ready;
  await f.$("check-due").fire();
  f.$("trigger").value = "unrelated_trigger_0000000001";
  await f.$("due-tasks").children[0].fire();
  assert.deepEqual(f.calls.find((c) => c[0] === "beginRun")[1], [task.taskId, trigger]);
  await f.$("check-plan").fire();
  assert.doesNotMatch(f.$("plan-result").textContent, /must-not-render/);
  assert.match(f.$("plan-result").textContent, /"nativeScheduleAttested": false/);
  f.$("plan-state").value = "enabled";
  f.$("plan-reference").value = "synthetic_native_plan";
  await f.$("plan-form").fire("submit");
  assert.deepEqual(f.calls.find((c) => c[0] === "reportPlan")[1], [
    task.taskId,
    "enabled",
    "synthetic_native_plan",
  ]);
  await f.$("retry-plan").fire();
  assert.deepEqual(f.calls.find((c) => c[0] === "retryPlanReport")[1], [task.taskId]);
  assert.match(html, /这里不会创建计划/);
});
test("page exit clears private DOM and ignores a late plaintext response without deleting identity", async () => {
  const f = fixture();
  await f.begin();
  f.fillReport();
  let resolve;
  f.overrides.readInput = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = f.$("inputs").children[0].fire();
  await new Promise((r) => setImmediate(r));
  f.events.get("pagehide")();
  resolve({ resource: { name: "late sensitive content" } });
  await pending;
  assert.equal(f.$("input-content").textContent, "");
  assert.equal(f.$("task-content").textContent, "");
  assert.equal(f.$("report-title").value, "");
  assert.equal(f.$("workspace").disabled, true);
  assert.equal(f.calls.filter((c) => c[0] === "clearPlaintext").length, 1);
  assert.equal(f.calls.filter((c) => c[0] === "connect").length, 1);
});
test("manual Run retries retain the caller's execution id and errors never echo arbitrary messages", async () => {
  const f = fixture();
  await f.choose();
  f.$("trigger").value = trigger;
  f.overrides.beginRun = () => {
    throw Error("an arbitrary secret or server response");
  };
  await f.$("begin-form").fire("submit");
  assert.doesNotMatch(f.$("operation-status").textContent, /arbitrary secret/);
  assert.equal(f.$("trigger").value, trigger);
  delete f.overrides.beginRun;
  await f.$("begin-form").fire("submit");
  assert.deepEqual(
    f.calls.filter((c) => c[0] === "beginRun").map((c) => c[1]),
    [
      [task.taskId, trigger],
      [task.taskId, trigger],
    ],
  );
});

test("a rejected report schema stays editable, while valid drafts remain frozen on transport failure", async () => {
  const f = fixture();
  await f.begin();
  f.fillReport();
  f.overrides.saveReport = () => {
    throw Error("private_schema_invalid");
  };
  await f.$("report-form").fire("submit");
  assert.equal(f.$("report-title").readOnly, false);
  f.$("report-title").value = "Corrected report";
  delete f.overrides.saveReport;
  await f.$("report-form").fire("submit");
  assert.equal(f.calls.filter((c) => c[0] === "saveReport")[1][1][1].title, "Corrected report");
});

test("connection refresh checks the certified session without bootstrapping a second identity", async () => {
  const f = fixture();
  await f.ready;
  await f.$("refresh-connection").fire();
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["connect", "refreshConnection"],
  );
});

test("explicit clear remains available during an in-flight read and a failed Worker clear", async () => {
  const f = fixture();
  await f.begin();
  f.fillReport();
  let resolve;
  f.overrides.readInput = () =>
    new Promise((r) => {
      resolve = r;
    });
  f.overrides.clearPlaintext = () => {
    throw Error("runtime_unavailable");
  };
  const pending = f.$("inputs").children[0].fire();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.$("workspace").disabled, true);
  assert.equal(f.$("clear-plaintext").disabled, false);
  await f.$("clear-plaintext").fire();
  assert.equal(f.$("report-title").value, "");
  resolve({ resource: { name: "must not appear after clear" } });
  await pending;
  assert.equal(f.$("input-content").textContent, "");
  assert.equal(f.$("task-content").textContent, "");
  assert.equal(f.calls.filter((c) => c[0] === "clearPlaintext").length, 1);
});

test("setup-to-resume hash navigation reloads once without reusing the old Worker binding", async () => {
  const f = fixture({ pending: true });
  await f.ready;
  f.events.get("hashchange")();
  f.events.get("hashchange")();
  assert.equal(f.calls.filter((c) => c[0] === "reload").length, 1);
  assert.equal(f.calls.filter((c) => c[0] === "clearPlaintext").length, 1);
  assert.equal(f.calls.filter((c) => c[0] === "connect").length, 1);
  assert.equal(f.$("workspace").disabled, true);
});
test("a BFCache return reloads the retained profile after its plaintext view was cleared", async () => {
  const f = fixture();
  await f.begin();
  f.fillReport();
  f.events.get("pageshow")({ persisted: false });
  assert.equal(f.calls.filter((c) => c[0] === "reload").length, 0);
  f.events.get("pagehide")();
  f.events.get("pageshow")({ persisted: true });
  assert.equal(f.$("report-title").value, "");
  assert.equal(f.calls.filter((c) => c[0] === "reload").length, 1);
  assert.equal(f.calls.filter((c) => c[0] === "clearPlaintext").length, 1);
});
test("old in-flight plaintext cannot render after a runtime descriptor change", async () => {
  const f = fixture();
  await f.begin();
  let resolve;
  f.overrides.readInput = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = f.$("inputs").children[0].fire();
  await new Promise((r) => setImmediate(r));
  f.events.get("hashchange")();
  resolve({ resource: { name: "old runtime response" } });
  await pending;
  assert.equal(f.$("input-content").textContent, "");
  assert.equal(f.calls.filter((c) => c[0] === "reload").length, 1);
});
