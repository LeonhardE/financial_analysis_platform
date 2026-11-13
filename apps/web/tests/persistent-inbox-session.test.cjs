const assert = require("node:assert/strict");
const test = require("node:test");
const { compile } = require("./resource-library-helpers.cjs");
const { WorkspaceDisplayCache } = compile("../lib/workspace-cache.ts");
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness({ canWrite = false, dropAck = false, listFailure = false } = {}) {
  const cells = [],
    effects = [];
  let index = 0,
    dirty = false,
    active = true,
    opens = 0;
  let meta = {
    resultId: "result_A",
    taskId: "task_A",
    runId: "run_A",
    connectionId: "agent_A",
    receivedAt: 1805100000,
    stateVersion: 0,
    read: false,
    starred: false,
    archived: false,
  };
  let record = { metadata: meta, ciphertext: "SYNTHETIC_A" };
  let signs = 0;
  const patches = [],
    receipts = new Map();
  const react = {
    useState(initial) {
      const slot = index++;
      cells[slot] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        cells[slot].value,
        (value) => {
          const next = typeof value === "function" ? value(cells[slot].value) : value;
          dirty ||= next !== cells[slot].value;
          cells[slot].value = next;
        },
      ];
    },
    useRef(value) {
      const slot = index++;
      cells[slot] ??= { current: value };
      return cells[slot];
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!cells[slot] || deps.some((d, n) => d !== cells[slot].deps[n]))
        effects.push({ slot, effect, deps });
    },
  };
  const workspace = {
    vaultGeneration: 1,
    vault: { vaultId: "vault_A" },
    canWriteState: canWrite,
    signPersistentResultState: async () => {
      signs++;
      return {
        command: { payload: "SYNTHETIC_SIGNED_STATE" },
        operationId: `operation_${signs}`,
        authorKeyId: "owner_key",
      };
    },
    displayCache: new WorkspaceDisplayCache(),
    openPersistentResult: async () => {
      opens++;
      return { title: "PRIVATE_REPORT", summary: "PRIVATE_SUMMARY", sections: [], citations: [] };
    },
  };
  const model = {
    owner: "owner_A",
    unlocked: true,
    busy: false,
    execute: async (action) => {
      try {
        return await action(
          {},
          async (path, options = {}) => {
            if (path.includes("?limit=")) {
              if (listFailure) throw Error("unavailable");
              return { items: [meta], nextCursor: null };
            }
            if (path.endsWith("/state")) {
              patches.push(JSON.stringify(options));
              const id = options.headers["Idempotency-Key"];
              if (!receipts.has(id)) {
                meta = { ...meta, read: true, stateVersion: meta.stateVersion + 1 };
                record = { ...record, metadata: meta };
                receipts.set(id, meta);
              }
              if (dropAck) {
                dropAck = false;
                throw Error("ack_lost");
              }
              return receipts.get(id);
            }
            return record;
          },
          () => {},
        );
      } catch {
        return null;
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const { PersistentInboxPanel } = compile("../components/PersistentInboxPanel.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next-intl": {
      useLocale: () => "en",
      useTranslations: () => (key, data) => (data ? `${key}:${data.count}` : key),
    },
    "./SafeReportMarkdown": { SafeReportMarkdown: () => null, reportLink: () => null },
    "./InboxPanel.module.css": { __esModule: true, default: {} },
  });
  function render() {
    let tree;
    do {
      dirty = false;
      index = 0;
      tree = PersistentInboxPanel({ workspace, model, active });
      for (const entry of effects.splice(0)) {
        cells[entry.slot]?.cleanup?.();
        cells[entry.slot] = { deps: entry.deps, cleanup: entry.effect() };
      }
    } while (dirty);
    return tree;
  }
  function find(tree, predicate) {
    if (Array.isArray(tree)) return tree.map((x) => find(x, predicate)).find(Boolean);
    if (!tree || typeof tree !== "object") return null;
    return predicate(tree) ? tree : find(tree.props?.children, predicate);
  }
  return {
    render,
    find,
    model,
    workspace,
    opens: () => opens,
    signs: () => signs,
    patches,
    metadata: () => meta,
    failList(value) {
      listFailure = value;
    },
    async drain() {
      for (let n = 0; n < 3; n++) {
        render();
        await settle();
      }
      return render();
    },
    active(value) {
      active = value;
    },
    record(value) {
      record = { ...record, ...value, metadata: { ...record.metadata, ...value.metadata } };
    },
    async ready() {
      render();
      await settle();
      return render();
    },
    async open() {
      const tree = render();
      const button = find(tree, (x) => x.key === "result_A");
      assert.ok(button);
      button.props.onClick();
      await settle();
      return render();
    },
  };
}

test("persistent Inbox retains exact selected report and filter across internal navigation without decrypting again", async () => {
  const h = harness();
  await h.ready();
  let tree = await h.open();
  assert.match(JSON.stringify(tree), /PRIVATE_REPORT/);
  assert.equal(h.opens(), 1);
  h.find(tree, (x) => [].concat(x.props?.children).includes("filter_unread")).props.onClick();
  tree = h.render();
  h.active(false);
  h.render();
  h.active(true);
  tree = h.render();
  assert.match(JSON.stringify(tree), /PRIVATE_REPORT/);
  assert.equal(
    h.find(tree, (x) => [].concat(x.props?.children).includes("filter_unread")).props[
      "aria-pressed"
    ],
    true,
  );
  await settle();
  await h.open();
  assert.equal(h.opens(), 1);
});

test("changed report bytes, lock and generation changes invalidate persistent plaintext reuse", async () => {
  const h = harness();
  await h.ready();
  await h.open();
  h.record({ metadata: { resultId: "result_A", taskId: "task_A" }, ciphertext: "CHANGED" });
  await h.open();
  assert.equal(h.opens(), 2);
  h.model.unlocked = false;
  let tree = h.render();
  assert.doesNotMatch(JSON.stringify(tree), /PRIVATE_REPORT/);
  assert.equal(h.workspace.displayCache.reports.size, 0);
  h.model.unlocked = true;
  h.workspace.vaultGeneration++;
  await h.ready();
  await h.open();
  assert.equal(h.opens(), 3);
});

test("opening an authenticated report marks it read once and removes unread feedback only after acknowledgement", async () => {
  const h = harness({ canWrite: true });
  await h.ready();
  await h.open();
  let tree = await h.drain();
  assert.equal(h.signs(), 1);
  assert.equal(h.patches.length, 1);
  assert.equal(h.metadata().read, true);
  assert.equal(h.find(tree, (x) => x.props?.label === "loadedUnreadCount:0").props.count, 0);
  h.render();
  await h.drain();
  assert.equal(h.patches.length, 1);
});

test("closing after a lost read ACK retains an explicit original retry outside the modal", async () => {
  const h = harness({ canWrite: true, dropAck: true });
  await h.ready();
  await h.open();
  let tree = await h.drain();
  assert.equal(h.signs(), 1);
  assert.equal(h.patches.length, 1);
  const modal = h.find(tree, (x) => x.props?.id === "persistent-report");
  modal.props.onClose();
  tree = h.render();
  const resume = h.find(tree, (x) => x.type === "button" && x.props.children === "resume");
  assert.ok(resume);
  resume.props.onClick();
  tree = await h.drain();
  assert.equal(h.patches.length, 2);
  assert.equal(h.patches[0], h.patches[1]);
  assert.equal(h.signs(), 1);
  assert.equal(h.find(tree, (x) => x.props?.label === "loadedUnreadCount:0").props.count, 0);
});

test("failed first report load shows retry without false empty or an endless spinner", async () => {
  const h = harness({ listFailure: true });
  let tree = await h.ready();
  assert.ok(h.find(tree, (x) => x.props?.message === "requestFailed"));
  assert.doesNotMatch(JSON.stringify(tree), /noReports/);
  assert.equal(h.find(tree, (x) => x.props?.label === "loadingReports").props.busy, false);
  h.failList(false);
  h.find(tree, (x) => x.props?.message === "requestFailed").props.onRetry();
  tree = await h.drain();
  assert.ok(h.find(tree, (x) => x.key === "result_A"));
});
