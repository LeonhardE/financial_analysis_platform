const cacheContracts = require("./resource-library-helpers.cjs").compile(
  "../lib/workspace-cache.ts",
);
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");
const { transformSync } = require("next/dist/build/swc");
const CONTRACT = "folioview.agent-workspace.v2.0";
const settle = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function compile(file, imports = {}, globals = {}) {
  const module = { exports: {} },
    { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
      filename: file,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" },
    });
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      if (name === "@/lib/workspace-cache") return cacheContracts;
      assert.ok(Object.hasOwn(imports, name), name);
      return imports[name];
    },
    Response,
    AbortController,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Date,
    Intl,
    crypto: webcrypto,
    ...globals,
  });
  return module.exports;
}
const types = compile("../lib/task-types.ts"),
  forms = compile("../lib/task-forms.ts", { "./task-types": types });
const binding = (id = "portfolio_A", epoch = 1) => ({
  ref: {
    kind: "holdings",
    sourceService: "portfolio",
    resourceId: id,
    incarnation: "incarnation_A",
  },
  sourceEpoch: epoch,
});
const content = (patch = {}) => ({
  ...forms.defaultTask("custom"),
  name: "PRIVATE_TASK",
  goal: "PRIVATE_GOAL",
  ...patch,
});
const meta = (version = 1, patch = {}) => ({
  contractVersion: CONTRACT,
  vaultId: "vault_A",
  taskId: "task_A",
  taskVersion: version,
  executionEpoch: 1,
  status: "active",
  resourceBindings: [],
  objectRevision: version,
  deliveryRevision: 1,
  envelopeFingerprint: String(version % 10).repeat(64),
  keyEpoch: 1,
  createdAt: "2026-10-30T10:00:00Z",
  updatedAt: "2026-10-30T10:00:00Z",
  ...patch,
});
const signed = { protected: "opaque", payload: "opaque", signature: "opaque" };
const task = (metadata = meta()) => ({
  contractVersion: CONTRACT,
  metadata,
  signedObject: signed,
  keyProofs: { checkpoint: signed, certificates: [] },
});
const catalogue = (rows = [binding()]) => ({
  contractVersion: CONTRACT,
  profile: "folioview.owner-resource-discovery.v1",
  readAt: "2026-10-30T10:00:00Z",
  groups: [
    {
      kind: "holdings",
      sourceService: "portfolio",
      status: "available",
      items: rows.map((row) => ({
        ref: row.ref,
        sourceEpoch: row.sourceEpoch,
        revision: 1,
        state: "active",
        snapshotId: "snapshot_A",
        updatedAt: "2026-10-30T10:00:00Z",
        encryptedEvidence: "not_prepared",
      })),
    },
    ...["watchlist", "channel_follows"].map((kind) => ({
      kind,
      sourceService: "user",
      status: "available",
      items: [
        {
          ref: null,
          sourceEpoch: null,
          revision: null,
          state: "uninitialized",
          snapshotId: null,
          updatedAt: null,
          encryptedEvidence: "not_checked",
        },
      ],
    })),
  ],
});

function harness({
  locked = false,
  transport,
  packetBatch,
  open,
  saveDraft,
  seal,
  rows = [meta()],
  initialDrafts = [],
  initialOutbox = [],
} = {}) {
  let owner = "owner_A:1",
    configured = true,
    active = true,
    visible = true,
    dirty = false,
    index = 0,
    mounted = true,
    timer = 0;
  let currentRows = clone(rows),
    currentTask = task(currentRows[0] ?? meta()),
    currentCatalogue = catalogue();
  let authority = {
    keyEpoch: 1,
    registrySequence: 1,
    checkpointDigest: "a".repeat(64),
    recipientKeyIds: ["owner_key"],
    previousRecipientKeyIds: ["owner_key"],
  };
  const effects = [],
    cells = [],
    events = new Map(),
    timers = new Map(),
    calls = [],
    opens = [],
    seals = [],
    transitions = [],
    savedDrafts = [],
    copies = [];
  const drafts = new Map(initialDrafts.map((draft) => [draft.slot, clone(draft)])),
    outbox = new Map(initialOutbox.map((packet) => [packet.taskId, clone(packet)]));
  const changed = (before, after) =>
    !before || after.some((value, place) => value !== before[place]);
  const react = {
    useState(initial) {
      const slot = index++;
      cells[slot] ??= { state: typeof initial === "function" ? initial() : initial };
      return [
        cells[slot].state,
        (next) => {
          if (!mounted) return;
          const value = typeof next === "function" ? next(cells[slot].state) : next;
          dirty ||= !Object.is(value, cells[slot].state);
          cells[slot].state = value;
        },
      ];
    },
    useRef(initial) {
      const slot = index++;
      cells[slot] ??= { current: initial };
      return cells[slot];
    },
    useCallback(callback, deps) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].deps, deps)) cells[slot] = { value: callback, deps };
      return cells[slot].value;
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].deps, deps)) effects.push({ slot, effect, deps });
    },
  };
  const summary = ({ slot, revision, baseVersion, taskId }) => ({
    slot,
    revision,
    baseVersion,
    taskId,
  });
  const pendingSummary = (packet) => ({
    taskId: packet.taskId,
    operationId: packet.operationId,
    keyEpoch: packet.keyEpoch,
    mode: packet.mode,
    expectedVersion: packet.body.expectedVersion,
  });
  const packetFor = (args, mode = "update") => ({
    taskId: args.taskId ?? args.current?.metadata.taskId,
    mode,
    operationId: "operation_AAAAAAAAAAAAAA",
    authorKeyId: "a".repeat(43),
    keyEpoch: authority.keyEpoch,
    registrySequence: authority.registrySequence,
    checkpointDigest: authority.checkpointDigest,
    envelopeFingerprint: String(((args.current?.metadata.taskVersion ?? 0) + 1) % 10).repeat(64),
    body: {
      contractVersion: CONTRACT,
      expectedVersion: args.current?.metadata.taskVersion ?? 0,
      resourceBindings: args.resourceBindings ?? args.current?.metadata.resourceBindings ?? [],
      envelope: { signedObject: signed, syntheticCiphertext: "CIPHERTEXT" },
      ...(mode === "create" ? { taskId: args.taskId } : {}),
      ...(mode === "transition" ? { transitionIntent: signed } : {}),
    },
  });
  const workspace = {
    owner,
    phase: locked ? "locked" : "unlocked",
    vaultGeneration: 1,
    vaultConfigured: true,
    canWriteState: !locked,
    async refreshVault(signal, forState) {
      assert.equal(signal.aborted, false);
      if (forState && !workspace.canWriteState) throw { code: "key_revoked" };
      return {};
    },
    async taskAuthority() {
      return clone(authority);
    },
    async openTask(packet) {
      opens.push(packet);
      return open ? open(packet) : content();
    },
    async sealTask(args) {
      seals.push(clone(args));
      const packet = seal ? await seal(args) : packetFor(args, args.current ? "update" : "create");
      outbox.set(packet.taskId, clone(packet));
      return packet;
    },
    async transitionTask(args) {
      transitions.push(clone(args));
      const packet = packetFor(args, "transition");
      outbox.set(packet.taskId, clone(packet));
      return packet;
    },
    async saveTaskDraft(args) {
      savedDrafts.push(clone(args));
      if (saveDraft) await saveDraft(args);
      const prior = drafts.get(args.slot);
      if ((prior?.revision ?? 0) !== args.expectedRevision) throw { code: "draft_conflict" };
      const value = {
        slot: args.slot,
        revision: args.expectedRevision + 1,
        baseVersion: args.baseVersion,
        taskId: args.taskId,
        draft: clone(args.draft),
      };
      drafts.set(args.slot, value);
      return summary(value);
    },
    async listTaskDrafts() {
      return [...drafts.values()].map(summary);
    },
    async loadTaskDraft(slot) {
      return clone(drafts.get(slot) ?? null);
    },
    async clearTaskDraft(slot, revision) {
      if (drafts.get(slot)?.revision !== revision) throw { code: "draft_conflict" };
      drafts.delete(slot);
    },
    async listTaskOutbox() {
      return [...outbox.values()].map(pendingSummary);
    },
    async loadTaskOutbox(id) {
      const packet = outbox.get(id);
      if (packet && packet.keyEpoch !== authority.keyEpoch) throw { code: "stale_key_epoch" };
      return clone(packet ?? null);
    },
    async validateTaskPending(packet) {
      if (packet.keyEpoch !== authority.keyEpoch) throw { code: "stale_key_epoch" };
    },
    async clearTaskOutbox(id, operation) {
      if (outbox.get(id)?.operationId !== operation) throw { code: "version_conflict" };
      outbox.delete(id);
    },
  };
  const requestPrivate = async (service, route, key, options) => {
    calls.push({ service, route, key, options });
    if (route === types.TASK_PACKET_QUERY) {
      if (packetBatch) return packetBatch({ taskIds: options.json.taskIds, options });
      const items = [];
      for (const taskId of options.json.taskIds) {
        const { method: _method, json: _json, ...readOptions } = options;
        const selected = currentRows.find((row) => row.taskId === taskId);
        const reply = transport
          ? await transport({
              service,
              route: "/api/v2/tasks/" + taskId,
              key,
              options: readOptions,
              head: currentTask,
              setHead(value) {
                currentTask = value;
                currentRows = [value.metadata];
              },
            })
          : undefined;
        if (reply && !reply.ok) return reply;
        const packet = reply
          ? await reply.json()
          : taskId === currentTask.metadata.taskId
            ? currentTask
            : selected
              ? task(selected)
              : null;
        items.push(packet ? { taskId, status: "ready", packet } : { taskId, status: "not_found" });
      }
      return response({
        contractVersion: CONTRACT,
        profile: "folioview.owner-task-packets.v1",
        items,
        remainingTaskIds: [],
      });
    }
    if (transport) {
      const result = await transport({
        service,
        route,
        key,
        options,
        head: currentTask,
        setHead(value) {
          currentTask = value;
          currentRows = [value.metadata];
        },
      });
      if (result !== undefined) return result;
    }
    if (route === "/api/v2/resources/catalogue") return response(currentCatalogue);
    if (route === "/api/v2/tasks?limit=32")
      return response({ contractVersion: CONTRACT, items: currentRows, nextCursor: null });
    if (options.method === "POST" || options.method === "PUT") {
      const packet = [...outbox.values()].find(
        (item) => item.operationId === options.headers["Idempotency-Key"],
      );
      currentTask = task(
        meta(packet.body.expectedVersion + 1, {
          taskId: packet.taskId,
          resourceBindings: packet.body.resourceBindings,
          envelopeFingerprint: packet.envelopeFingerprint,
          status:
            transitions.at(-1)?.action === "pause"
              ? "paused"
              : transitions.at(-1)?.action === "archive"
                ? "archived"
                : "active",
        }),
      );
      currentRows = [currentTask.metadata];
      return response(currentTask);
    }
    const version = /\/versions\/(\d+)$/.exec(route);
    if (version) return response(task(meta(Number(version[1]))));
    if (/^\/api\/v2\/tasks\/[A-Za-z0-9_-]+$/.test(route)) return response(currentTask);
    throw new Error("unexpected route");
  };
  const window = {
    setTimeout(callback, delay) {
      const id = ++timer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener(event, callback) {
      events.set(event, callback);
    },
    removeEventListener(event) {
      events.delete(event);
    },
  };
  const { useTasks } = compile(
    "../components/useTasks.ts",
    {
      react,
      "@/components/AuthProvider": {
        useAuth: () => ({
          status: owner ? "authenticated" : "anonymous",
          profile: owner ? { uid: owner.split(":")[0] } : null,
          sessionKey: owner,
          agentHubConfigured: configured,
          requestPrivate,
        }),
      },
      "@/lib/task-types": types,
      "@/lib/task-forms": forms,
    },
    {
      window,
      document,
      navigator: {
        clipboard: {
          async writeText(text) {
            copies.push(text);
          },
        },
      },
    },
  );
  function render({ flush = true } = {}) {
    let result,
      cycles = 0;
    do {
      assert.ok(cycles++ < 50, "render loop");
      dirty = false;
      index = 0;
      result = useTasks(workspace, { active });
      if (flush)
        for (const entry of effects.splice(0)) {
          cells[entry.slot]?.cleanup?.();
          cells[entry.slot] = { deps: entry.deps, cleanup: entry.effect() };
        }
    } while (flush && dirty);
    return result;
  }
  return {
    render,
    workspace,
    calls,
    opens,
    seals,
    transitions,
    savedDrafts,
    drafts,
    outbox,
    copies,
    async ready() {
      render();
      await settle();
      return render();
    },
    async drain() {
      for (let n = 0; n < 3; n++) {
        render();
        await settle();
      }
      return render();
    },
    owner(next) {
      owner = next;
      workspace.owner = next;
      workspace.vaultGeneration++;
    },
    lock() {
      workspace.phase = "locked";
      workspace.canWriteState = false;
      workspace.vaultGeneration++;
    },
    unlock() {
      workspace.phase = "unlocked";
      workspace.canWriteState = true;
      workspace.vaultGeneration++;
    },
    active(next) {
      active = next;
    },
    visibility(next) {
      visible = next;
      events.get("visibilitychange")?.();
    },
    capability(next) {
      configured = next;
      workspace.vaultConfigured = next;
    },
    setRows(rows) {
      currentRows = clone(rows);
    },
    setHead(packet) {
      currentTask = clone(packet);
      currentRows = [packet.metadata];
    },
    catalogue(next) {
      currentCatalogue = next;
    },
    authority(next) {
      authority = { ...authority, ...next };
    },
    deadline(delay) {
      for (const [id, entry] of [...timers]) {
        if (delay === undefined || entry.delay === delay) {
          timers.delete(id);
          entry.callback();
        }
      }
    },
    timerDelays() {
      return [...timers.values()].map((entry) => entry.delay);
    },
    unmount() {
      for (const cell of cells) cell?.cleanup?.();
      mounted = false;
    },
  };
}

test("task semantics: brief requires resources; custom supports zero; sections and policies are bounded", () => {
  assert.equal(forms.reviewTask(content(), []).valid, true);
  assert.equal(forms.reviewTask(content({ template: "brief" }), []).valid, false);
  assert.equal(forms.reviewTask(content({ template: "brief" }), [binding()]).valid, true);
  assert.ok(
    forms
      .reviewTask(
        content({
          inputPolicy: { allowPartial: true, allowUnknownAsOf: false, maxFetchedAgeSeconds: -1 },
        }),
        [],
      )
      .errors.includes("inputPolicy"),
  );
  const invalid = content();
  invalid.outputSpec.sections.push(clone(invalid.outputSpec.sections[0]));
  assert.ok(forms.reviewTask(invalid, []).errors.includes("sections"));
  assert.ok(forms.reviewTask(content(), [binding(), binding()]).errors.includes("resources"));
});
test("private expectation uses saved IANA zone, weekly weekday and DST, without any server schedule", () => {
  const input = content({
    deliveryExpectation: {
      cadence: "weekdays",
      localTime: "09:00",
      timeZone: "America/Toronto",
      graceMinutes: 30,
    },
  });
  assert.equal(
    forms.reviewTask(input, [], new Date("2026-10-30T14:00:00Z")).nextExpectedAt,
    "2026-11-02T14:00:00.000Z",
  );
  input.deliveryExpectation.timeZone = "Invalid/Zone";
  assert.ok(forms.reviewTask(input, []).errors.includes("expectation"));
  input.deliveryExpectation = {
    cadence: "weekly",
    localTime: "09:00",
    timeZone: "UTC",
    graceMinutes: 0,
    weekday: 1,
  };
  assert.equal(
    forms.reviewTask(input, [], new Date("2026-10-30T14:00:00Z")).nextExpectedAt,
    "2026-11-02T09:00:00.000Z",
  );
  input.deliveryExpectation = {
    cadence: "daily",
    localTime: "02:30",
    timeZone: "America/Toronto",
    graceMinutes: 0,
  };
  assert.equal(
    forms.reviewTask(input, [], new Date("2027-03-14T05:00:00Z")).nextExpectedAt,
    "2027-03-15T06:30:00.000Z",
  );
});
test("metadata is closed and bounded, catalogue never labels discovery as prepared", () => {
  assert.throws(() =>
    types.taskPage({
      contractVersion: CONTRACT,
      items: Array.from({ length: 33 }, (_, i) => meta(1, { taskId: `task_${i}` })),
      nextCursor: null,
    }),
  );
  assert.throws(() => types.taskMetadata({ ...meta(), name: "PRIVATE" }));
  const options = types.taskCatalogue(catalogue());
  assert.equal(options[0].selectable, true);
  assert.equal(options[0].encryptedEvidence, "not_prepared");
  assert.throws(() => types.taskCatalogue({ ...catalogue(), groups: [] }));
});
test("metadata list does not decrypt task names; opening is explicit; saved handoff copies only opaque ID", async () => {
  const h = harness();
  let model = await h.ready();
  assert.equal(h.opens.length, 0);
  assert.equal(model.form, null);
  await model.openTask("task_A");
  model = h.render();
  assert.equal(model.form.name, "PRIVATE_TASK");
  await model.copyHandoff();
  assert.deepEqual(h.copies, ["task_A"]);
  assert.ok(
    h.calls.every(
      (call) => call.service === "agent-hub" && !JSON.stringify(call).includes("PRIVATE_"),
    ),
  );
  h.unmount();
});
test("incomplete drafts autosave sealed and restore only after re-unlock; hidden page clears plaintext immediately", async () => {
  const h = harness({ rows: [] });
  let model = await h.ready();
  model.startNew();
  model = await h.drain();
  assert.equal(h.savedDrafts.at(-1).draft.content.name, "");
  assert.ok(h.drafts.has("new"));
  model.setForm(content());
  model = await h.drain();
  const stored = clone(h.drafts.get("new"));
  h.visibility(false);
  assert.equal(h.render({ flush: false }).form, null);
  h.render();
  h.visibility(true);
  model = await h.ready();
  assert.equal(model.form, null);
  assert.equal(model.drafts.length, 1);
  await model.restoreDraft("new");
  model = await h.drain();
  assert.equal(model.form.name, "PRIVATE_TASK");
  assert.equal(model.drafts[0].taskId, stored.taskId);
  h.lock();
  assert.equal(h.render({ flush: false }).form, null);
  h.render();
  h.unlock();
  model = await h.ready();
  assert.equal(model.form, null);
  await model.restoreDraft("new");
  model = h.render();
  assert.equal(model.form.goal, "PRIVATE_GOAL");
  h.unmount();
});
test("explicit preview+review required; save transports only original ciphertext packet and CAS", async () => {
  const h = harness({ rows: [] });
  let model = await h.ready();
  model.startNew(undefined, content());
  model = await h.drain();
  await model.save(true);
  model = h.render();
  assert.equal(model.confirmation, "rules");
  assert.equal(h.seals.length, 0);
  await model.save(true);
  model = await h.drain();
  assert.equal(model.notice, "saved");
  assert.equal(model.dirty, false);
  assert.equal(h.outbox.size, 0);
  const write = h.calls.find((call) => call.options.method === "POST");
  assert.equal(write.options.json.expectedVersion, 0);
  assert.equal(write.route, "/api/v2/tasks");
  assert.ok(!JSON.stringify(write).includes("PRIVATE_"));
  assert.equal(h.seals.length, 1);
  h.unmount();
});
test("editing invalidates confirmed review; resource/epoch/recipient changes have distinct explicit reasons", async () => {
  const h = harness();
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  model.setBindings([binding()]);
  model = await h.drain();
  await model.save();
  model = h.render();
  assert.equal(model.confirmation, "resource_scope");
  model.setForm(content({ name: "CHANGED_PRIVATE" }));
  model = await h.drain();
  await model.save(true);
  model = h.render();
  assert.equal(h.seals.length, 0);
  assert.equal(model.confirmation, "resource_scope");
  h.authority({ keyEpoch: 2, recipientKeyIds: ["new_owner_key"] });
  await model.save(true);
  model = h.render();
  assert.equal(h.seals.length, 0);
  assert.equal(model.confirmation, "key_epoch");
  assert.ok(model.confirmationReasons.includes("recipients"));
  assert.ok(model.confirmationReasons.includes("resource_scope"));
  h.unmount();
});
test("concurrent version conflict preserves sealed draft; rebase is explicit and retains private rule edits", async () => {
  const h = harness();
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  model.setForm(content({ goal: "MY_NEW_PRIVATE_GOAL" }));
  model = await h.drain();
  h.setHead(task(meta(2)));
  await model.save();
  model = h.render();
  assert.equal(model.error, "version_conflict");
  assert.equal(h.seals.length, 0);
  assert.equal(h.drafts.get("task_A").baseVersion, 1);
  await model.rebaseDraft();
  model = await h.drain();
  assert.equal(model.form.goal, "MY_NEW_PRIVATE_GOAL");
  assert.equal(model.selected.taskVersion, 2);
  assert.equal(h.drafts.get("task_A").baseVersion, 2);
  await model.save(true);
  model = h.render();
  assert.equal(h.seals.length, 0);
  assert.equal(model.confirmation, "rules");
  h.unmount();
});
test("lost response retains exact ciphertext+operation through lock; explicit resend signs nothing", async () => {
  let lose = true;
  const h = harness({
    transport({ options }) {
      if (options.method && lose) {
        lose = false;
        throw new Error("offline");
      }
    },
  });
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  model.setForm(content({ goal: "EDIT" }));
  model = await h.drain();
  await model.save();
  model = h.render();
  await model.save(true);
  model = h.render();
  assert.equal(model.pending.taskId, "task_A");
  assert.equal(h.outbox.size, 1);
  const first = h.calls.find((call) => call.options.method === "PUT");
  h.lock();
  h.render();
  h.unlock();
  model = await h.ready();
  assert.equal(model.pending, null);
  assert.equal(model.pendingOperations.length, 1);
  await model.recoverPending("task_A");
  model = h.render();
  await model.resendPending();
  model = await h.drain();
  const writes = h.calls.filter((call) => call.options.method === "PUT");
  assert.equal(h.seals.length, 1);
  assert.equal(writes.length, 2);
  assert.equal(JSON.stringify(writes[1].options.json), JSON.stringify(first.options.json));
  assert.equal(
    writes[1].options.headers["Idempotency-Key"],
    first.options.headers["Idempotency-Key"],
  );
  assert.equal(model.pending, null);
  h.unmount();
});
test("recovering an outbox after opening saved content preserves an unrelated unreviewed draft", async () => {
  const draft = {
    slot: "task_A",
    revision: 7,
    baseVersion: 1,
    taskId: "task_A",
    draft: { content: content({ goal: "UNREVIEWED_PRIVATE_DRAFT" }), resourceBindings: [] },
  };
  const pending = {
    taskId: "task_A",
    operationId: "operation_AAAAAAAAAAAAAA",
    authorKeyId: "a".repeat(43),
    mode: "update",
    keyEpoch: 1,
    registrySequence: 1,
    checkpointDigest: "a".repeat(64),
    envelopeFingerprint: "2".repeat(64),
    body: {
      contractVersion: CONTRACT,
      expectedVersion: 1,
      resourceBindings: [],
      envelope: { signedObject: signed, syntheticCiphertext: "OLD_CIPHERTEXT" },
    },
  };
  const h = harness({ initialDrafts: [draft], initialOutbox: [pending] });
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  assert.equal(model.dirty, false);
  assert.equal(model.form.goal, "PRIVATE_GOAL");
  await model.recoverPending("task_A");
  model = h.render();
  await model.resendPending();
  model = await h.drain();
  assert.equal(model.pending, null);
  assert.equal(h.outbox.size, 0);
  assert.equal(h.seals.length, 0);
  assert.equal(h.drafts.get("task_A").draft.content.goal, "UNREVIEWED_PRIVATE_DRAFT");
  assert.equal(h.drafts.get("task_A").revision, 7);
  assert.equal(model.notice, "saved_draft_retained");
  const request = h.calls.find((call) => call.options.method === "PUT");
  assert.equal(JSON.stringify(request.options.json), JSON.stringify(pending.body));
  model.setForm(content({ goal: "ATTEMPTED_REPLACEMENT" }));
  model = h.render();
  assert.equal(model.error, "unsaved_draft");
  assert.equal(model.form.goal, "PRIVATE_GOAL");
  model.setBindings([binding()]);
  model = h.render();
  assert.equal(model.bindings.length, 0);
  assert.equal(h.drafts.get("task_A").revision, 7);
  await model.discardDraft();
  model = h.render();
  assert.equal(h.drafts.has("task_A"), false);
  assert.equal(model.form, null);
  assert.equal(model.notice, "draft_discarded");
  h.unmount();
});
test("stale epoch outbox can be listed and explicitly discarded, never silently re-signed", async () => {
  const packet = {
    taskId: "task_A",
    operationId: "operation_AAAAAAAAAAAAAA",
    mode: "update",
    keyEpoch: 1,
    body: { expectedVersion: 1 },
  };
  const h = harness({ initialOutbox: [packet] });
  h.authority({ keyEpoch: 2 });
  let model = await h.ready();
  await model.recoverPending("task_A");
  model = h.render();
  assert.equal(model.error, "stale_key_epoch");
  assert.equal(model.pendingOperations.length, 1);
  await model.discardPending("task_A", packet.operationId);
  model = h.render();
  assert.equal(h.outbox.size, 0);
  assert.equal(h.seals.length, 0);
  h.unmount();
});
test("late decrypt and captured callbacks cannot cross lock/relogin/account boundaries", async () => {
  const gate = deferred(),
    h = harness({ open: () => gate.promise });
  let model = await h.ready();
  const old = model;
  const opening = model.openTask("task_A");
  await settle();
  h.owner("owner_B:1");
  model = h.render({ flush: false });
  assert.equal(model.form, null);
  h.render();
  gate.resolve(content());
  await opening;
  model = await h.ready();
  assert.equal(model.form, null);
  const callCount = h.calls.length;
  await old.openTask("task_A");
  old.startNew();
  await old.recoverPending();
  assert.equal(h.calls.length, callCount);
  assert.equal(h.render().form, null);
  h.unmount();
});
test("deferred HTTP body is fenced before private open after lock; deadlines release busy", async () => {
  const gate = deferred();
  const h = harness({
    transport({ route }) {
      if (route === "/api/v2/tasks/task_A")
        return new Response(
          new ReadableStream({
            async start(controller) {
              await gate.promise;
              try {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(task())));
                controller.close();
              } catch {}
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
    },
  });
  let model = await h.ready();
  const opening = model.openTask("task_A");
  await settle();
  h.lock();
  h.render();
  gate.resolve();
  await opening;
  assert.equal(h.opens.length, 0);
  assert.equal(h.render().form, null);
  h.unmount();
  const slow = deferred(),
    h2 = harness({ open: () => slow.promise });
  model = await h2.ready();
  const pending = model.openTask("task_A");
  await settle();
  h2.deadline();
  await pending;
  assert.equal(h2.render().busy, false);
  slow.resolve(content());
  h2.unmount();
});
test("late selected-task draft listing cannot overwrite the more recent selected task", async () => {
  const h = harness({
    transport({ route }) {
      if (route === "/api/v2/tasks/task_B") return response(task(meta(1, { taskId: "task_B" })));
    },
  });
  let model = await h.ready();
  const listing = deferred();
  let blocked = false;
  const original = h.workspace.listTaskDrafts;
  h.workspace.listTaskDrafts = async () => {
    if (!blocked) {
      blocked = true;
      await listing.promise;
    }
    return original();
  };
  const first = model.openTask("task_A");
  await settle();
  model = h.render();
  await model.openTask("task_B");
  model = h.render();
  assert.equal(model.selected.taskId, "task_B");
  listing.resolve();
  await first;
  model = h.render();
  assert.equal(model.selected.taskId, "task_B");
  h.unmount();
});
test("a new unlock generation autosaves independently of a cancelled prior draft queue", async () => {
  const gate = deferred();
  let first = true;
  const h = harness({
    rows: [],
    saveDraft: async () => {
      if (first) {
        first = false;
        await gate.promise;
      }
    },
  });
  let model = await h.ready();
  model.startNew(undefined, content());
  h.render();
  await settle();
  h.lock();
  h.render();
  h.unlock();
  model = await h.ready();
  model.startNew(undefined, content({ name: "NEW_UNLOCK_PRIVATE" }));
  model = await h.drain();
  assert.equal(h.drafts.get("new").draft.content.name, "NEW_UNLOCK_PRIVATE");
  gate.resolve();
  await settle();
  model = h.render();
  assert.equal(model.form.name, "NEW_UNLOCK_PRIVATE");
  h.unmount();
});
test("outbox remains recoverable if authenticated latest refresh fails after write acknowledgement", async () => {
  let writes = 0;
  const h = harness({
    transport({ route, options }) {
      if (options.method === "PUT") writes++;
      if (writes && route === "/api/v2/tasks/task_A" && !options.method) return response({}, 503);
    },
  });
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  model.setForm(content({ goal: "MY_EDIT" }));
  model = await h.drain();
  await model.save();
  model = h.render();
  await model.save(true);
  model = h.render();
  assert.ok(model.pending);
  assert.equal(h.outbox.size, 1);
  assert.equal(h.drafts.size, 1);
  assert.equal(model.dirty, true);
  h.unmount();
});
test("pause/resume/archive use a freshly encrypted version plus signed transition, not plaintext status patch", async () => {
  const h = harness();
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  await model.transition("pause");
  model = h.render();
  assert.equal(h.transitions.length, 0);
  await model.transition("pause", true);
  model = await h.drain();
  assert.equal(h.transitions.length, 1);
  const call = h.calls.find((entry) => entry.route.endsWith("/transitions"));
  assert.equal(call.options.method, "POST");
  assert.ok(call.options.json.transitionIntent);
  assert.equal(Object.hasOwn(call.options.json, "status"), false);
  assert.equal(model.selected.status, "paused");
  h.unmount();
});
test("transitioning a saved task never consumes an existing unreviewed local draft", async () => {
  for (const action of ["pause", "archive"]) {
    const draft = {
      slot: "task_A",
      revision: 7,
      baseVersion: 1,
      taskId: "task_A",
      draft: { content: content({ goal: "UNREVIEWED_PRIVATE_DRAFT" }), resourceBindings: [] },
    };
    const h = harness({ initialDrafts: [draft] });
    let model = await h.ready();
    await model.openTask("task_A");
    model = h.render();
    assert.equal(model.dirty, false);
    assert.equal(model.form.goal, "PRIVATE_GOAL");
    await model.transition(action);
    model = h.render();
    await model.transition(action, true);
    model = await h.drain();
    assert.equal(model.error, "unsaved_draft");
    assert.equal(h.transitions.length, 0);
    assert.equal(h.drafts.get("task_A").draft.content.goal, "UNREVIEWED_PRIVATE_DRAFT");
    assert.equal(h.drafts.get("task_A").revision, 7);
    h.unmount();
  }
});
test("unavailable resource blocks fresh save while existing version remains readable; historical version is read only", async () => {
  const h = harness({ rows: [meta(2)] });
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  model.setBindings([binding()]);
  model = await h.drain();
  h.catalogue(catalogue([]));
  await model.save();
  model = h.render();
  assert.equal(model.error, "source_unavailable");
  assert.equal(h.seals.length, 0);
  await model.discardDraft();
  model = h.render();
  await model.openTask("task_A", 1);
  model = h.render();
  assert.equal(model.historical, true);
  const before = h.seals.length;
  model.setForm(content({ goal: "forbidden" }));
  await model.save(true);
  assert.equal(h.seals.length, before);
  h.unmount();
});

test("slow catalogue never holds the task list; its failure and retry stay local", async () => {
  const gate = deferred();
  let slow = true;
  const h = harness({
    transport: ({ route }) => (route.endsWith("/catalogue") && slow ? gate.promise : undefined),
  });
  let model = await h.ready();
  assert.equal(model.items.length, 1);
  assert.equal(model.loading, false);
  assert.equal(model.catalogueLoading, true);
  assert.equal(model.error, "");
  gate.resolve(response({}, 503));
  model = await h.drain();
  assert.equal(model.catalogueError, "source_unavailable");
  assert.equal(model.listError, "");
  assert.equal(model.items[0].taskId, "task_A");
  slow = false;
  await model.reloadCatalogue();
  model = h.render();
  assert.equal(model.catalogueError, "");
  assert.ok(model.catalogue.some((row) => row.selectable));
  assert.equal(h.calls.filter((call) => call.route.includes("tasks?limit")).length, 1);
  h.unmount();
});

test("task-list failure preserves independently loaded resources and retries only the list", async () => {
  let failed = true;
  const h = harness({
    transport: ({ route }) =>
      route.includes("tasks?limit") && failed ? response({}, 403) : undefined,
  });
  let model = await h.ready();
  assert.equal(model.listError, "insufficient_scope");
  assert.ok(model.catalogue.some((row) => row.selectable));
  assert.equal(model.catalogueError, "");
  assert.equal(model.error, "");
  failed = false;
  await model.reloadTasks();
  model = h.render();
  assert.equal(model.listError, "");
  assert.equal(model.items.length, 1);
  assert.equal(h.calls.filter((call) => call.route.endsWith("/catalogue")).length, 1);
  h.unmount();
});

test("read budget is below the proxy; timeout retains rows and a late success cannot overwrite recovery", async () => {
  const late = deferred();
  let slow = false;
  const h = harness({
    transport: ({ route }) => (slow && route.includes("tasks?limit") ? late.promise : undefined),
  });
  let model = await h.ready();
  slow = true;
  const waiting = model.reloadTasks();
  await settle();
  assert.ok(h.timerDelays().includes(11500));
  h.deadline(11500);
  await waiting;
  model = h.render();
  assert.equal(model.listError, "request_timeout");
  assert.equal(model.items[0].taskId, "task_A");
  assert.equal(model.loading, false);
  assert.equal(model.error, "");
  slow = false;
  await model.reloadTasks();
  late.resolve(
    response({
      contractVersion: CONTRACT,
      items: [meta(1, { taskId: "task_LATE" })],
      nextCursor: null,
    }),
  );
  model = await h.drain();
  assert.equal(model.items[0].taskId, "task_A");
  assert.equal(model.listError, "");
  h.unmount();
});

test("a superseding list refresh cancels the previous read without a false error", async () => {
  const late = deferred();
  let attempt = 0;
  const h = harness({
    transport: ({ route }) =>
      route.includes("tasks?limit") && ++attempt === 1 ? late.promise : undefined,
  });
  let model = await h.ready();
  await model.reloadTasks();
  late.resolve(response({ contractVersion: CONTRACT, items: [], nextCursor: null }));
  model = await h.drain();
  assert.equal(model.items.length, 1);
  assert.equal(model.listError, "");
  assert.equal(model.error, "");
  h.unmount();
});

test("timeout also cancels a streamed list body while preserving successful resources", async () => {
  let cancelled = false;
  const h = harness({
    transport: ({ route }) =>
      route.includes("tasks?limit")
        ? new Response(
            new ReadableStream({
              start() {},
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "content-type": "application/json" } },
          )
        : undefined,
  });
  await h.ready();
  h.deadline(11500);
  const model = await h.drain();
  assert.equal(model.listError, "request_timeout");
  assert.equal(model.loading, false);
  assert.equal(cancelled, true);
  assert.ok(model.catalogue.some((row) => row.selectable));
  h.unmount();
});

const busyResponse = (seconds = "1") =>
  new Response("{}", {
    status: 503,
    headers: {
      "content-type": "application/json",
      "X-FolioView-Admission-Retry": "safe",
      "Retry-After": seconds,
    },
  });
test("only pre-forward safe GET admission retries once, with bounded backoff", async () => {
  const h = harness({
    transport: ({ route }) => (route.includes("tasks?limit") ? busyResponse() : undefined),
  });
  await h.ready();
  assert.equal(h.calls.filter((c) => c.route.includes("tasks?limit")).length, 1);
  assert.ok(h.timerDelays().includes(1000));
  h.deadline(1000);
  const model = await h.drain();
  assert.equal(h.calls.filter((c) => c.route.includes("tasks?limit")).length, 2);
  assert.equal(model.listError, "service_busy");
  assert.equal(model.loading, false);
  assert.ok(!h.timerDelays().includes(1000));
  h.unmount();
});

test("read retry can recover; long admission waits and downstream errors never auto-retry", async () => {
  let attempts = 0;
  const recovered = harness({
    transport: ({ route }) =>
      route.includes("tasks?limit") && ++attempts === 1 ? busyResponse() : undefined,
  });
  await recovered.ready();
  recovered.deadline(1000);
  let model = await recovered.drain();
  assert.equal(model.items.length, 1);
  assert.equal(model.listError, "");
  assert.equal(attempts, 2);
  recovered.unmount();
  for (const [reply, code] of [
    [() => busyResponse("60"), "service_busy"],
    [() => response({}, 503), "source_unavailable"],
    [
      () =>
        new Response("{}", { status: 503, headers: { "X-FolioView-Read-Failure": "deadline" } }),
      "request_timeout",
    ],
  ]) {
    const h = harness({
      transport: ({ route }) => (route.includes("tasks?limit") ? reply() : undefined),
    });
    model = await h.ready();
    assert.equal(model.listError, code);
    assert.equal(h.calls.filter((c) => c.route.includes("tasks?limit")).length, 1);
    assert.ok(!h.timerDelays().includes(1000));
    h.unmount();
  }
});

test("leaving during retry backoff cancels silently and cannot send another request", async () => {
  const h = harness({
    transport: ({ route }) => (route.includes("tasks?limit") ? busyResponse() : undefined),
  });
  await h.ready();
  h.active(false);
  h.render();
  h.deadline(1000);
  const model = await h.drain();
  assert.equal(h.calls.filter((c) => c.route.includes("tasks?limit")).length, 1);
  assert.equal(model.listError, "");
  assert.equal(model.error, "");
  assert.ok(!h.timerDelays().includes(1000));
  h.unmount();
});

test("read transport and session failures have distinct closed errors without exposing exception text", async () => {
  for (const [name, expected] of [
    ["TypeError", "network_unavailable"],
    ["SessionChangedError", "session_expired"],
  ]) {
    const h = harness({
      transport({ route }) {
        if (route.includes("tasks?limit")) {
          const error = new Error("PRIVATE_EXCEPTION");
          error.name = name;
          throw error;
        }
      },
    });
    const model = await h.ready();
    assert.equal(model.listError, expected);
    assert.equal(model.error, "");
    assert.ok(!JSON.stringify(model).includes("PRIVATE_EXCEPTION"));
    h.unmount();
  }
});

test("write admission never retries or replaces the exact recoverable packet", async () => {
  const h = harness({
    rows: [],
    transport: ({ options }) => (options.method === "POST" ? busyResponse() : undefined),
  });
  let model = await h.ready();
  model.startNew(undefined, content());
  model = await h.drain();
  await model.save(true);
  model = h.render();
  await model.save(true);
  model = await h.drain();
  assert.equal(model.error, "service_busy");
  assert.equal(h.calls.filter((c) => c.options.method === "POST").length, 1);
  assert.equal(h.seals.length, 1);
  assert.equal(h.outbox.size, 1);
  assert.ok(!h.timerDelays().includes(1000));
  h.unmount();
});

test("read refresh clears old draft notices and account changes discard old rows and late replies", async () => {
  const late = deferred();
  let slow = false;
  const h = harness({
    transport: ({ route, key }) =>
      route.includes("tasks?limit") && slow && key === "owner_A:1" ? late.promise : undefined,
  });
  let model = await h.ready();
  model.startNew(undefined, content());
  model = await h.drain();
  await model.discardDraft();
  model = h.render();
  assert.equal(model.notice, "draft_discarded");
  await model.reloadTasks();
  model = h.render();
  assert.equal(model.notice, "");
  slow = true;
  const pending = model.reloadTasks();
  h.owner("owner_B:2");
  h.render();
  late.resolve(
    response({
      contractVersion: CONTRACT,
      items: [meta(1, { taskId: "task_OLD_OWNER" })],
      nextCursor: null,
    }),
  );
  await pending;
  model = await h.drain();
  assert.equal(model.owner, "owner_B:2");
  assert.ok(model.items.every((row) => row.taskId !== "task_OLD_OWNER"));
  assert.equal(model.listError, "");
  h.unmount();
});

test("captured resource actions cannot select preserved stale catalogue entries", async () => {
  let failed = false;
  const h = harness({
    transport: ({ route }) =>
      failed && route.endsWith("/catalogue") ? response({}, 503) : undefined,
  });
  const original = await h.ready();
  failed = true;
  await original.reloadCatalogue();
  assert.ok(h.render().catalogue.some((row) => row.selectable));
  original.startNew(binding(), content());
  assert.equal(h.render().form, null);
  assert.equal(h.render().error, "source_unavailable");
  original.startNew(undefined, content());
  const model = await h.drain();
  model.setBindings([binding()]);
  assert.equal(h.render().bindings.length, 0);
  assert.equal(h.render().error, "source_unavailable");
  h.unmount();
});

test("non-actionable draft feedback expires without another network read", async () => {
  const h = harness();
  let model = await h.ready();
  model.startNew(undefined, content());
  model = await h.drain();
  await model.discardDraft();
  model = h.render();
  assert.equal(model.notice, "draft_discarded");
  const requests = h.calls.length;
  h.deadline(4500);
  model = h.render();
  assert.equal(model.notice, "");
  assert.equal(h.calls.length, requests);
  h.unmount();
});

test("internal navigation preserves the editor, sealed draft, selection and verified task name", async () => {
  const h = harness();
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  assert.equal(model.taskNames.task_A, "PRIVATE_TASK");
  model.setForm({ ...model.form, goal: "PRIVATE_UNSAVED_GOAL" });
  model = await h.drain();
  const opens = h.opens.length;
  h.active(false);
  model = h.render();
  assert.equal(model.form, null);
  h.active(true);
  model = h.render();
  assert.equal(model.form.goal, "PRIVATE_UNSAVED_GOAL");
  assert.equal(model.selected.taskId, "task_A");
  assert.equal(model.dirty, true);
  assert.equal(h.opens.length, opens);
  h.visibility(false);
  model = h.render();
  assert.equal(model.form, null);
  assert.equal(Object.keys(model.taskNames).length, 0);
  h.visibility(true);
  model = await h.drain();
  assert.equal(model.form, null);
  h.unmount();
});

test("navigation during sealed draft save keeps its original CAS revision recoverable", async () => {
  const g = deferred();
  let held = true;
  const h = harness({
    saveDraft: async () => {
      if (held) await g.promise;
    },
  });
  let model = await h.ready();
  model.startNew(undefined, content());
  h.render();
  await settle();
  h.active(false);
  h.render();
  held = false;
  g.resolve();
  await settle();
  h.render();
  h.active(true);
  model = await h.drain();
  assert.equal(model.form.name, "PRIVATE_TASK");
  assert.equal(model.error, "");
  assert.ok(h.savedDrafts.length >= 1);
  h.unmount();
});

test("new task metadata cannot relabel a cached old name or keep its editor writable", async () => {
  let newer = false;
  const h = harness({
    transport: ({ route }) =>
      newer && route.includes("tasks?limit")
        ? response({ contractVersion: CONTRACT, items: [meta(2)], nextCursor: null })
        : undefined,
  });
  let model = await h.ready();
  await model.openTask("task_A");
  model = h.render();
  assert.equal(model.taskNames.task_A, "PRIVATE_TASK");
  newer = true;
  await model.reloadTasks();
  model = h.render();
  assert.equal(model.taskNames.task_A, undefined);
  assert.equal(model.historical, true);
  assert.equal(model.conflictCurrent.taskVersion, 2);
  h.unmount();
});

test("background name verification never selects an editor or creates a draft; revisit reuses version cache", async () => {
  const h = harness();
  let m = await h.drain();
  assert.equal(m.taskNames.task_A, "PRIVATE_TASK");
  assert.equal(m.form, null);
  assert.equal(m.selected, null);
  assert.equal(h.savedDrafts.length, 0);
  const reads = h.calls.length,
    opens = h.opens.length;
  h.active(false);
  await h.drain();
  h.active(true);
  m = await h.drain();
  assert.equal(m.taskNames.task_A, "PRIVATE_TASK");
  assert.equal(h.opens.length, opens);
  assert.equal(h.calls.length, reads);
  h.lock();
  m = await h.drain();
  assert.deepEqual(Object.keys(m.taskNames), []);
  h.unmount();
});
test("a failed name is isolated and can be retried without entering edit mode", async () => {
  let failed = true;
  const h = harness({
    open: async () => {
      if (failed) throw { code: "verification_failed" };
      return content();
    },
  });
  let m = await h.drain();
  assert.ok(m.nameErrors.task_A);
  assert.equal(m.form, null);
  failed = false;
  m.retryTaskName("task_A");
  m = await h.drain();
  assert.equal(m.taskNames.task_A, "PRIVATE_TASK");
  assert.equal(m.nameErrors.task_A, undefined);
  assert.equal(h.savedDrafts.length, 0);
  h.unmount();
});
test("background name verification limits concurrent decryption to two across batches", async () => {
  const waiting = deferred();
  let inflight = 0,
    peak = 0;
  const rows = Array.from({ length: 8 }, (_, i) => meta(1, { taskId: "task_" + i }));
  const h = harness({
    rows,
    transport: async ({ route }) => {
      const row = rows.find((m) => route === "/api/v2/tasks/" + m.taskId);
      if (row) return response(task(row));
    },
    open: async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await waiting.promise;
      inflight--;
      return content();
    },
  });
  await h.drain();
  assert.equal(peak, 2);
  waiting.resolve();
  const m = await h.drain();
  assert.equal(m.form, null);
  assert.equal(h.savedDrafts.length, 0);
  assert.ok(peak <= 2);
  h.unmount();
});

test("task deletion immediately masks its editor and names while preserving sealed local recovery records", async () => {
  const h = harness();
  let m = await h.ready();
  await m.openTask("task_A");
  m = h.render();
  m.setForm(content({ name: "DELETED_TASK_DRAFT" }));
  m = await h.drain();
  assert.ok(h.drafts.has("task_A"));
  m.invalidateTask("task_A");
  m = h.render();
  assert.equal(m.selected, null);
  assert.equal(m.form, null);
  assert.equal(m.taskNames.task_A, undefined);
  assert.ok(h.drafts.has("task_A"));
  assert.equal(
    m.drafts.some((d) => d.taskId === "task_A"),
    false,
  );
  h.unmount();
});

const batchPage = (
  ids,
  packets = ids.map((id) => task(meta(1, { taskId: id }))),
  remaining = [],
) => ({
  contractVersion: CONTRACT,
  profile: "folioview.owner-task-packets.v1",
  items: packets.map((packet, n) =>
    packet ? { taskId: ids[n], status: "ready", packet } : { taskId: ids[n], status: "not_found" },
  ),
  remainingTaskIds: remaining,
});
test("task packet DTO binds the exact requested prefix and suffix before any decryption", () => {
  const ids = ["task_A", "task_B", "task_C"],
    valid = batchPage(ids.slice(0, 2), [task(), null], ["task_C"]);
  const parsed = types.taskPacketPage(valid, ids);
  assert.equal(parsed.items[0].packet.metadata.taskId, "task_A");
  assert.equal(parsed.items[1].status, "not_found");
  assert.deepEqual(Array.from(parsed.remainingTaskIds), ["task_C"]);
  for (const value of [
    { ...valid, privateTitle: "PRIVATE" },
    { ...valid, profile: "other" },
    { ...valid, items: [] },
    { ...valid, remainingTaskIds: ids },
    { ...valid, remainingTaskIds: ["foreign_task"] },
    { ...valid, items: [...valid.items].reverse() },
    {
      ...valid,
      items: [
        { ...valid.items[0], packet: task(meta(1, { taskId: "foreign_task" })) },
        valid.items[1],
      ],
    },
    { ...valid, items: [valid.items[0], { ...valid.items[1], packet: null }] },
  ])
    assert.throws(() => types.taskPacketPage(value, ids), /invalid_response/);
  assert.throws(() => types.taskPacketPage(valid, ["task_A", "task_A"]), /invalid_response/);
});
test("name metadata comparison covers the complete version even across JSON property ordering", () => {
  const original = meta(1, { resourceBindings: [binding()] });
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  reordered.resourceBindings = [
    { sourceEpoch: 1, ref: Object.fromEntries(Object.entries(binding().ref).reverse()) },
  ];
  assert.equal(types.sameTaskMetadata(original, reordered), true);
  for (const patch of [
    { executionEpoch: 2 },
    { createdAt: "2026-10-31T10:00:00Z" },
    { resourceBindings: [binding("other")] },
  ])
    assert.equal(types.sameTaskMetadata(original, { ...original, ...patch }), false);
});
test("thirty-two task names use eight four-packet reads with unchanged per-task Worker verification", async () => {
  const rows = Array.from({ length: 32 }, (_, n) => meta(1, { taskId: `task_batch_${n}` }));
  const h = harness({ rows });
  try {
    const m = await h.drain(),
      batches = h.calls.filter((c) => c.route === types.TASK_PACKET_QUERY);
    assert.equal(batches.length, 8);
    assert.ok(
      batches.every((c) => c.options.method === "POST" && c.options.json.taskIds.length === 4),
    );
    assert.equal(h.opens.length, 32);
    assert.equal(Object.keys(m.taskNames).length, 32);
    assert.equal(h.calls.filter((c) => /^\/api\/v2\/tasks\/task_batch_/.test(c.route)).length, 0);
    assert.equal(h.seals.length + h.savedDrafts.length, 0);
  } finally {
    h.unmount();
  }
});
test("large-packet suffixes strictly shrink and finish without duplicates", async () => {
  const rows = Array.from({ length: 4 }, (_, n) => meta(1, { taskId: `task_split_${n}` }));
  const h = harness({
    rows,
    packetBatch: ({ taskIds }) =>
      response(
        batchPage(
          taskIds.slice(0, 1),
          [task(rows.find((r) => r.taskId === taskIds[0]))],
          taskIds.slice(1),
        ),
      ),
  });
  try {
    const m = await h.drain();
    assert.deepEqual(
      h.calls
        .filter((c) => c.route === types.TASK_PACKET_QUERY)
        .map((c) => c.options.json.taskIds.length),
      [4, 3, 2, 1],
    );
    assert.equal(Object.keys(m.taskNames).length, 4);
    assert.equal(new Set(h.opens.map((p) => p.metadata.taskId)).size, 4);
  } finally {
    h.unmount();
  }
});
test("a malformed batch cannot open even its first packet or loop its remaining IDs", async () => {
  const rows = Array.from({ length: 4 }, (_, n) => meta(1, { taskId: `task_bad_${n}` }));
  const h = harness({
    rows,
    packetBatch: ({ taskIds }) =>
      response(batchPage(taskIds.slice(0, 1), [task(rows[0])], taskIds)),
  });
  try {
    const m = await h.drain();
    assert.equal(h.opens.length, 0);
    assert.equal(Object.keys(m.taskNames).length, 0);
    assert.equal(Object.keys(m.nameErrors).length, 4);
    assert.equal(h.calls.filter((c) => c.route === types.TASK_PACKET_QUERY).length, 1);
  } finally {
    h.unmount();
  }
});
test("a missing or stale packet stays unavailable while other batch members verify normally", async () => {
  const rows = Array.from({ length: 4 }, (_, n) => meta(1, { taskId: `task_partial_${n}` }));
  const h = harness({
    rows,
    packetBatch: ({ taskIds }) =>
      response(
        batchPage(taskIds, [
          null,
          task({ ...rows[1], executionEpoch: 2 }),
          task(rows[2]),
          task(rows[3]),
        ]),
      ),
  });
  try {
    const m = await h.drain();
    assert.equal(Object.keys(m.taskNames).length, 2);
    assert.equal(m.nameErrors.task_partial_0, "not_found");
    assert.equal(m.nameErrors.task_partial_1, "version_conflict");
    assert.equal(h.opens.length, 2);
    assert.equal(m.selected, null);
  } finally {
    h.unmount();
  }
});
test("verified names publish before a stalled sibling and can retry an earlier failure without losing pending ownership", async () => {
  const gate = deferred(),
    rows = Array.from({ length: 4 }, (_, n) => meta(1, { taskId: `task_progress_${n}` }));
  let first = true;
  const h = harness({
    rows,
    open: async (packet) => {
      if (packet.metadata.taskId === rows[0].taskId && first) {
        first = false;
        throw { code: "verification_failed" };
      }
      if (packet.metadata.taskId === rows[1].taskId) await gate.promise;
      return content({ name: "Verified name" });
    },
  });
  try {
    let m = await h.drain();
    assert.ok(m.nameErrors.task_progress_0);
    m.retryTaskName(rows[0].taskId);
    m = await h.drain();
    assert.equal(m.taskNames.task_progress_0, "Verified name");
    assert.equal(m.nameErrors.task_progress_0, undefined);
    assert.equal(m.taskNames.task_progress_1, undefined);
    gate.resolve();
    m = await h.drain();
    assert.equal(Object.keys(m.taskNames).length, 4);
    assert.equal(h.calls.filter((c) => c.route === types.TASK_PACKET_QUERY).length, 2);
  } finally {
    gate.resolve();
    h.unmount();
  }
});

test("metadata refresh cannot spawn extra name workers while two earlier batches are decrypting", async () => {
  const gate = deferred(),
    rows = Array.from({ length: 8 }, (_, n) => meta(1, { taskId: `task_refresh_${n}` }));
  let active = 0,
    peak = 0;
  const h = harness({
    rows,
    open: async () => {
      active++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
      return content();
    },
  });
  try {
    let m = await h.drain();
    assert.equal(peak, 2);
    h.setRows([
      ...rows,
      ...Array.from({ length: 4 }, (_, n) => meta(1, { taskId: `task_new_${n}` })),
    ]);
    await m.reloadTasks();
    await h.drain();
    assert.equal(peak, 2);
    gate.resolve();
    m = await h.drain();
    assert.equal(Object.keys(m.taskNames).length, 12);
    assert.equal(peak, 2);
    assert.equal(h.calls.filter((c) => c.route === types.TASK_PACKET_QUERY).length, 3);
  } finally {
    gate.resolve();
    h.unmount();
  }
});
test("a late batch cannot open private packets across an Owner change before effects run", async () => {
  const gate = deferred(),
    rows = [meta()];
  const h = harness({
    rows,
    packetBatch: () => gate.promise,
    open: async () => assert.fail("old Owner packet must not open"),
  });
  try {
    await h.drain();
    h.owner("owner_B:2");
    assert.equal(Object.keys(h.render(false).taskNames).length, 0);
    gate.resolve(response(batchPage(["task_A"], [task()])));
    await settle();
    assert.equal(h.opens.length, 0);
    assert.equal(Object.keys(h.render(false).taskNames).length, 0);
    h.active(false);
    await h.drain();
  } finally {
    gate.resolve(response(batchPage(["task_A"], [task()])));
    h.unmount();
  }
});

test("cancelling a deleted task batch resumes only remaining visible names, without stale resurrection", async () => {
  const gate = deferred(),
    rows = Array.from({ length: 3 }, (_, n) => meta(1, { taskId: `task_delete_${n}` }));
  let requests = 0;
  const h = harness({
    rows,
    packetBatch: ({ taskIds }) =>
      ++requests === 1
        ? gate.promise
        : response(
            batchPage(
              taskIds,
              taskIds.map((id) => task(rows.find((r) => r.taskId === id))),
            ),
          ),
  });
  try {
    let m = await h.drain();
    m.invalidateTask(rows[0].taskId);
    h.setRows(rows.slice(1));
    m = await h.drain();
    assert.equal(m.taskNames.task_delete_0, undefined);
    assert.equal(m.taskNames.task_delete_1, "PRIVATE_TASK");
    assert.equal(m.taskNames.task_delete_2, "PRIVATE_TASK");
    gate.resolve(
      response(
        batchPage(
          rows.map((r) => r.taskId),
          rows.map((r) => task(r)),
        ),
      ),
    );
    m = await h.drain();
    assert.equal(m.taskNames.task_delete_0, undefined);
    assert.equal(
      h.opens.some((p) => p.metadata.taskId === rows[0].taskId),
      false,
    );
    assert.equal(requests, 2);
  } finally {
    gate.resolve(response(batchPage([], [])));
    h.unmount();
  }
});
test("unmounting a pending name batch cannot refill its display queue", async () => {
  const gate = deferred();
  let requests = 0;
  const h = harness({
    rows: [meta(), meta(1, { taskId: "task_B" })],
    packetBatch: () => {
      requests++;
      return gate.promise;
    },
  });
  await h.drain();
  h.unmount();
  gate.resolve(response(batchPage(["task_A", "task_B"])));
  await settle();
  await settle();
  assert.equal(requests, 1);
  assert.equal(h.opens.length, 0);
});
