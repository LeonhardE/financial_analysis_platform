import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const root = new URL("../helper/releases/1.3.0/", import.meta.url);
const html = await readFile(new URL("static/controller.html", root), "utf8");
const script = (await readFile(new URL("src/controller-page.mjs", root), "utf8"))
  .replace(/^import .* from "\.\/controller.mjs";$/m, "")
  .replace(/^import .* from "\.\/owner-helper.mjs";$/m, "");
function fixture() {
  const fields = new Map(
    [...html.matchAll(/id="([^"]+)"/g)].map((m) => [
      m[1],
      {
        value: "",
        textContent: "",
        listeners: new Map(),
        remove() {},
        addEventListener(name, fn) {
          this.listeners.set(name, fn);
        },
      },
    ]),
  );
  for (const node of fields.values()) {
    node.replaceChildren = () => {};
    node.append = () => {};
  }
  const events = new Map(),
    calls = [],
    pending = [];
  let state = "ABSENT",
    notify = () => {},
    readHold,
    beginFailures = 0,
    loseSave = false;
  class Denied extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  class Controller {
    constructor(options) {
      notify = options.onState;
    }
    status() {
      return { state };
    }
    initialize() {
      calls.push(["initialize"]);
      state = "READY";
      notify({ state });
      return {};
    }
    publicOffer() {
      return {};
    }
    confirmDelivery() {
      calls.push(["confirmDelivery"]);
      return {};
    }
    connectTransport(packet) {
      calls.push(["connectTransport", packet]);
      return {};
    }
    loadPreparation() {
      calls.push(["loadPreparation"]);
      return { objects: [{ objectId: "task" }, { objectId: "holdings" }] };
    }
    readPreparedObject(id) {
      calls.push(["readPreparedObject", id]);
      return {};
    }
    beginRun(id) {
      calls.push(["beginRun", id]);
      if (beginFailures > 0) {
        beginFailures--;
        throw new Denied("run_expired_or_untrusted");
      }
      return { run: { runId: "run_synthetic" } };
    }
    async readRunPage() {
      if (readHold) await readHold;
      return {
        nextCursor: null,
        privateContent: "SYNTHETIC_PRIVATE_INPUT",
        componentIndex: 0,
        payload: { outputSpec: { sections: [{ sectionId: "overview" }, { sectionId: "risks" }] } },
      };
    }
    submitResult(run, id, content) {
      calls.push(["submitResult", run, id, structuredClone(content)]);
      pending.push({ stableOperationId: id });
      if (loseSave) throw new Denied("request_failed");
      return { receipt: { resultId: "result_synthetic", revision: 1 } };
    }
    listOutbox() {
      return pending;
    }
    recoverReceipt(id) {
      calls.push(["recoverReceipt", id]);
      return { receipt: { resultId: "result_synthetic", revision: 1 } };
    }
    replay(id) {
      calls.push(["replay", id]);
      return { receipt: { resultId: "result_synthetic", revision: 1 } };
    }
    setVisible() {}
    lock() {
      state = "LOCKED";
      notify({ state });
    }
  }
  const doc = {
    visibilityState: "visible",
    getElementById: (id) => fields.get(id),
    createElement() {
      const node = { value: "", textContent: "" };
      let id;
      Object.defineProperty(node, "id", {
        get: () => id,
        set: (value) => {
          id = value;
          fields.set(value, node);
        },
      });
      return node;
    },
    addEventListener: (n, fn) => events.set(n, fn),
  };
  const host = {
    location: { origin: "https://hub.example", hostname: "hub.example", hash: "", search: "" },
    addEventListener: (n, fn) => events.set(n, fn),
  };
  host.top = host;
  vm.runInNewContext(script, {
    document: doc,
    window: host,
    ForegroundController: Controller,
    ControllerDenied: Denied,
    OwnerHelperBridge: class {},
    URLSearchParams,
    AbortController,
    crypto,
    JSON,
    TextEncoder,
    structuredClone,
    setTimeout,
    clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
  });
  const click = async (id) => {
    const fn = fields.get(id)?.listeners.get("click");
    assert(fn, "Missing action " + id);
    await fn();
  };
  return {
    fields,
    calls,
    doc,
    click,
    pending,
    async setup() {
      fields.get("owner-card").value = "{}";
      await click("initialize");
      fields.get("transport-packet").value = JSON.stringify({ credential: "synthetic_ciphertext" });
      await click("connect-transport");
    },
    lose() {
      loseSave = true;
    },
    refuseBegin() {
      beginFailures++;
    },
    hold(value) {
      readHold = value;
    },
    hide() {
      doc.visibilityState = "hidden";
      events.get("visibilitychange")();
    },
    fill() {
      for (const [id, value] of [
        ["report-title", "Synthetic title"],
        ["report-summary", "Synthetic summary"],
        ["report-section-0", "Synthetic report"],
        ["report-section-1", "Synthetic risks"],
        ["report-limits", "Synthetic limitation"],
      ])
        if (fields.has(id)) fields.get(id).value = value;
    },
  };
}
test("rendering never authenticates or performs an agent/network operation", () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert(html.includes("Never paste a token"));
});
test("explicit basic flow reads frozen approved inputs and only reports saved after a real receipt", async () => {
  const f = fixture();
  await f.setup();
  assert.equal(f.fields.get("transport-packet").value, "");
  await f.click("read-analysis");
  assert(f.fields.get("analysis-inputs").textContent.includes("SYNTHETIC_PRIVATE_INPUT"));
  f.fill();
  await f.click("save-analysis");
  const save = f.calls.find((c) => c[0] === "submitResult");
  assert.deepEqual(
    save[3].sections.map((row) => row.sectionId),
    ["overview", "risks"],
  );
  assert.equal(save[3].title, "Synthetic title");
  assert(f.fields.get("save-state").textContent.includes("Saved to Inbox"));
  assert.equal(f.fields.get("report-section-0")?.value ?? "", "");
  assert.equal(f.fields.get("analysis-inputs").textContent, "");
});
test("lost save response retains one original operation; explicit receipt/retry never seals another report", async () => {
  const f = fixture();
  await f.setup();
  await f.click("read-analysis");
  f.fill();
  f.lose();
  await f.click("save-analysis");
  assert(f.fields.get("save-state").textContent.includes("unknown"));
  const id = f.pending[0].stableOperationId;
  await f.click("check-analysis");
  await f.click("retry-analysis");
  await f.click("save-analysis");
  assert.equal(f.calls.filter((c) => c[0] === "submitResult").length, 1);
  assert.deepEqual(
    f.calls.filter((c) => ["recoverReceipt", "replay"].includes(c[0])).map((c) => c[1]),
    [id, id],
  );
});
test("a refused Run continuation keeps the original operation and still completes the report", async () => {
  const f = fixture();
  await f.setup();
  f.refuseBegin();
  await f.click("read-analysis");
  assert(f.fields.get("status").textContent.includes("run_expired_or_untrusted"));
  assert.equal(f.fields.get("read-analysis").textContent, "Continue the original analysis");
  const first = f.calls.find((c) => c[0] === "beginRun")[1];
  await f.click("read-analysis");
  assert.deepEqual(
    f.calls.filter((c) => c[0] === "beginRun").map((c) => c[1]),
    [first, first],
  );
  f.fill();
  await f.click("save-analysis");
  assert.equal(f.calls.filter((c) => c[0] === "submitResult").length, 1);
  assert(f.fields.get("save-state").textContent.includes("Saved to Inbox"));
});
test("ending a session clears its original analysis operation", async () => {
  const f = fixture();
  await f.setup();
  f.refuseBegin();
  await f.click("read-analysis");
  const first = f.calls.find((c) => c[0] === "beginRun")[1];
  await f.click("lock");
  await f.setup();
  await f.click("read-analysis");
  const last = f.calls.filter((c) => c[0] === "beginRun").at(-1)[1];
  assert.notEqual(last, first);
});
test("hidden or locked sessions clear private fields and reject a late input result", async () => {
  const f = fixture();
  await f.setup();
  let resolve;
  f.hold(new Promise((r) => (resolve = r)));
  const reading = f.click("read-analysis");
  await new Promise((r) => setImmediate(r));
  f.fill();
  f.hide();
  await f.click("lock");
  resolve();
  await reading;
  assert.equal(f.fields.get("analysis-inputs").textContent, "");
  assert.equal(f.fields.get("report-section-0")?.value ?? "", "");
  assert.equal(f.fields.get("report-title").value, "");
  assert.equal(f.calls.filter((c) => c[0] === "submitResult").length, 0);
});
