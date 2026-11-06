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
  const fileInput = fields.get("transport-packet-file");
  fileInput.files = [];
  Object.defineProperty(fileInput, "value", {
    get: () => (fileInput.files.length ? "synthetic-packet.json" : ""),
    set: (value) => {
      assert.equal(value, "");
      fileInput.files = [];
    },
  });
  const events = new Map(),
    calls = [],
    pending = [];
  let state = "ABSENT",
    notify = () => {},
    readHold,
    beginFailures = 0,
    pageFailures = 0,
    expiredAccess = false,
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
      calls.push(["readRunPage"]);
      if (pageFailures > 0) {
        pageFailures--;
        throw new Denied("access_token_refresh_required");
      }
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
      if (expiredAccess) {
        expiredAccess = false;
        throw new Denied("access_token_refresh_required");
      }
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
    expireAccess() {
      expiredAccess = true;
    },
    expirePageRead() {
      pageFailures++;
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
    show() {
      doc.visibilityState = "visible";
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
test("an original packet file is read only on connect and reaches the existing controller unchanged", async () => {
  const f = fixture();
  f.fields.get("owner-card").value = "{}";
  await f.click("initialize");
  const packet = {
    contractVersion: "folioview.agent-workspace.v2.0",
    profile: "folioview.foreground-transport.v1",
    taskId: "task_synthetic",
    connectionId: "connection_synthetic",
    preparationId: "preparation_synthetic",
    credential: [
      "SYNTHETIC_HEADER",
      "SYNTHETIC_KEY",
      "SYNTHETIC_IV",
      "a".repeat(2000),
      "SYNTHETIC_TAG",
    ].join("."),
  };
  let reads = 0;
  const file = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
  f.fields.get("transport-packet-file").files = [
    {
      size: file.size,
      async text() {
        reads++;
        assert.equal(f.fields.get("transport-packet-file").value, "");
        return await file.text();
      },
    },
  ];
  assert.equal(reads, 0);
  assert.equal(f.calls.filter((c) => c[0] === "connectTransport").length, 0);
  await f.click("connect-transport");
  assert.equal(reads, 1);
  const connected = f.calls.filter((c) => c[0] === "connectTransport");
  assert.equal(connected.length, 1);
  assert.deepEqual(connected[0][1], packet);
  assert.equal(f.fields.get("transport-packet-file").files.length, 0);
  assert.equal(f.fields.get("transport-packet").value, "");
  await f.click("read-analysis");
  f.fill();
  await f.click("save-analysis");
  assert(f.fields.get("save-state").textContent.includes("Saved to Inbox"));
});
test("empty, oversized, ambiguous or multiple packet files are rejected before reading", async () => {
  for (const scenario of ["empty", "oversized", "ambiguous", "multiple"]) {
    const f = fixture();
    await f.setup();
    f.calls.length = 0;
    let reads = 0;
    const file = {
      size: scenario === "empty" ? 0 : scenario === "oversized" ? 12289 : 2,
      text: async () => {
        reads++;
        return "{}";
      },
    };
    f.fields.get("transport-packet-file").files = scenario === "multiple" ? [file, file] : [file];
    if (scenario === "ambiguous") f.fields.get("transport-packet").value = "{}";
    await f.click("connect-transport");
    assert.equal(reads, 0, scenario);
    assert.equal(f.calls.length, 0, scenario);
    assert(f.fields.get("status").textContent.includes("invalid_transport"), scenario);
    assert.equal(f.fields.get("transport-packet-file").files.length, 0, scenario);
    assert.equal(f.fields.get("transport-packet").value, "", scenario);
  }
});
test("invalid or unreadable packet files clear inputs and never connect", async () => {
  for (const contents of ["not JSON", "x".repeat(12289), null]) {
    const f = fixture();
    await f.setup();
    f.calls.length = 0;
    f.fields.get("transport-packet-file").files = [
      {
        size: 20,
        async text() {
          if (contents === null) throw new Error("SYNTHETIC_FILE_FAILURE");
          return contents;
        },
      },
    ];
    await f.click("connect-transport");
    assert.equal(f.calls.length, 0);
    assert.equal(f.fields.get("transport-packet-file").files.length, 0);
    assert.equal(f.fields.get("transport-packet").value, "");
    assert(!f.fields.get("status").textContent.includes("SYNTHETIC_FILE_FAILURE"));
  }
});
test("lock or a hide/show cycle cancels a late file read without connecting", async () => {
  for (const action of ["lock", "hide/show"]) {
    const f = fixture();
    await f.setup();
    f.calls.length = 0;
    let resolve;
    f.fields.get("transport-packet-file").files = [
      {
        size: 2,
        text: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
    ];
    const connecting = f.click("connect-transport");
    assert(resolve);
    if (action === "lock") await f.click("lock");
    else {
      f.hide();
      f.show();
    }
    resolve("{}");
    await connecting;
    assert.equal(f.calls.filter((c) => c[0] === "connectTransport").length, 0, action);
    assert.equal(f.fields.get("transport-packet-file").files.length, 0, action);
  }
});
test("hiding the page clears an unsubmitted file and pasted packet", async () => {
  const f = fixture();
  await f.setup();
  f.fields.get("transport-packet-file").files = [new Blob(["{}"], { type: "application/json" })];
  f.fields.get("transport-packet").value = "{}";
  const before = f.calls.length;
  f.hide();
  assert.equal(f.fields.get("transport-packet-file").files.length, 0);
  assert.equal(f.fields.get("transport-packet").value, "");
  assert.equal(f.calls.length, before);
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
test("access expiry prompts a same-session reconnect and preserves the original report operation", async () => {
  const f = fixture();
  await f.setup();
  await f.click("read-analysis");
  f.fill();
  f.expireAccess();
  await f.click("save-analysis");
  assert(f.fields.get("status").textContent.includes("fresh encrypted connection packet"));
  assert(!f.fields.get("save-state").textContent.includes("Saved to Inbox"));
  const id = f.pending[0].stableOperationId;
  f.fields.get("transport-packet").value = JSON.stringify({
    credential: "synthetic_refreshed_ciphertext",
  });
  await f.click("connect-transport");
  assert(f.fields.get("analysis-state").textContent.includes("Continue the original"));
  await f.click("retry-analysis");
  assert.equal(f.calls.filter((c) => c[0] === "beginRun").length, 1);
  assert.equal(f.calls.filter((c) => c[0] === "submitResult").length, 1);
  assert.deepEqual(
    f.calls.filter((c) => c[0] === "replay").map((c) => c[1]),
    [id],
  );
  assert(f.fields.get("save-state").textContent.includes("Saved to Inbox"));
});
test("renewal during frozen input reading resumes the existing Run without replacing a ready draft", async () => {
  const f = fixture();
  await f.setup();
  f.expirePageRead();
  await f.click("read-analysis");
  assert(f.fields.get("status").textContent.includes("fresh encrypted connection packet"));
  f.fields.get("transport-packet").value = JSON.stringify({
    credential: "synthetic_refreshed_ciphertext",
  });
  await f.click("connect-transport");
  await f.click("read-analysis");
  assert.equal(f.calls.filter((c) => c[0] === "beginRun").length, 1);
  assert.equal(f.calls.filter((c) => c[0] === "loadPreparation").length, 1);
  assert.equal(f.calls.filter((c) => c[0] === "readRunPage").length, 2);
  f.fill();
  await f.click("read-analysis");
  assert.equal(f.fields.get("report-title").value, "Synthetic title");
  await f.click("save-analysis");
  assert.equal(f.calls.filter((c) => c[0] === "submitResult").length, 1);
  assert(f.fields.get("save-state").textContent.includes("Saved to Inbox"));
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
