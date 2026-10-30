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
    setTimeout(callback) {
      const id = ++timer;
      timers.set(id, callback);
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
    deadline() {
      for (const callback of [...timers.values()]) callback();
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
