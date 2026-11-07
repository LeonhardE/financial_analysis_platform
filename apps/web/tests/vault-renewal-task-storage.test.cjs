const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");
const { compileVaultWorker } = require("./worker-dispatch-helpers.cjs");
const { createHarness, createOwner, createTask, clone } = require("./full-flow-crypto-fixture.cjs");
const { lifecycleState } = require("./vault-key-renewal-fixture.cjs");
const fake = require("fake-indexeddb");
let h,
  bridge,
  storageModule,
  directory,
  workerCode,
  CoreError,
  clock = 1000;
const clients = [];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test.before(async () => {
  h = await createHarness();
  try {
    new h.core.VaultCore("");
  } catch (error) {
    CoreError = error.constructor;
  }
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-renewal-task-storage-"));
  for (const name of ["encrypted-types", "encrypted-storage", "encrypted-vault"]) {
    const filename = path.resolve(__dirname, "../lib/" + name + ".ts");
    let { code } = transformSync(readFileSync(filename, "utf8"), {
      filename,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "es6" },
    });
    code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, n) => `from "./${n}.mjs"`);
    await fs.writeFile(path.join(directory, name + ".mjs"), code);
  }
  bridge = await import(pathToFileURL(path.join(directory, "encrypted-vault.mjs")).href);
  storageModule = await import(pathToFileURL(path.join(directory, "encrypted-storage.mjs")).href);
  workerCode = compileVaultWorker();
});
test.after(async () => {
  clients.forEach((c) => c.lock());
  await h?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
// Actual production dispatch/crypto, with only native Worker scheduling substituted.
class LocalWorker {
  constructor() {
    const owner = this;
    this.methods = new Map();
    class ClockCore extends h.core.VaultCore {
      constructor(uid) {
        super(uid, () => clock);
      }
    }
    this.realm = {
      ArrayBuffer,
      Uint8Array,
      TextEncoder,
      TextDecoder,
      crypto,
      module: { exports: {} },
      exports: {},
      require(name) {
        if (name === "./encrypted-core") return { VaultCore: ClockCore };
        if (name === "./encrypted-types") return { VaultError: CoreError };
        assert.fail(name);
      },
      postMessage(value) {
        const method = owner.methods.get(value.id);
        owner.methods.delete(value.id);
        Promise.resolve(owner.beforeReply?.(method, value)).then(() => {
          if (!owner.stopped) owner.onmessage({ data: structuredClone(value) });
        });
      },
    };
    vm.runInNewContext(workerCode, this.realm);
  }
  postMessage(message, transfer = []) {
    this.methods.set(message.id, message.method);
    const copy = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (!this.stopped) this.realm.onmessage({ data: copy });
    });
  }
  terminate() {
    this.stopped = true;
    this.realm = null;
  }
}
async function withStorage(action) {
  clock = 1000;
  const old = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    range = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: fake.IDBKeyRange });
  try {
    return await action();
  } finally {
    clients.splice(0).forEach((c) => c.lock());
    for (const [key, descriptor] of [
      ["indexedDB", old],
      ["IDBKeyRange", range],
    ])
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  }
}
function context(store, f, archive = f.vault.archive) {
  store.setArchiveContext(f.owner, archive.credentialId, archive.prfSalt, archive.iv);
}
async function seeded(uid = "synthetic_owner_A") {
  const f = await createOwner(h, uid),
    task = await createTask(h, f, { template: "custom", bindings: [] }),
    store = new storageModule.BrowserEncryptedStorage(),
    state = await lifecycleState(h, f);
  context(store, f);
  await store.commitVault(f.owner, f.local);
  await store.commitLifecycle(
    f.owner,
    await f.session.verifyLifecycle(f.vault, state),
    f.vault.archive,
  );
  const key = f.owner + ":task-outbox:" + f.vault.vaultId + ":" + task.pending.taskId,
    row = {
      ownerSubject: f.owner,
      vaultId: f.vault.vaultId,
      slot: task.pending.taskId,
      kind: "outbox",
      revision: 1,
      pending: task.pending,
    };
  await store.put(key, row);
  clock = 31537001;
  f.time(clock);
  return { f, ...task, store, state, key, row };
}
function browser(f, store) {
  const worker = new LocalWorker(),
    client = new bridge.EncryptedVaultSession(f.uid, {
      storage: store,
      workerFactory: () => worker,
    });
  clients.push(client);
  return { client, worker };
}
async function unlocked(f, store) {
  const value = browser(f, store);
  await value.client.unlockForKeyRenewal(f.vault, f.material());
  return value;
}
test("task root-only list discovers the local original, review retains it, confirmation writes a revision tombstone", async () =>
  withStorage(async () => {
    const { f, pending, task, store, key, row } = await seeded(),
      { client } = await unlocked(f, store);
    const draftKey = key.replace(":task-outbox:", ":task-draft:"),
      holdingsKey = f.owner + ":outbox:synthetic_holdings";
    await store.put(draftKey, { retained: "draft" });
    await store.put(holdingsKey, { retained: "holdings" });
    await store.put(f.owner + ":task-outbox:other_vault:task_other", { retained: "other_vault" });
    await store.put("other_owner:task-outbox:" + f.vault.vaultId + ":task_other", {
      retained: "other_owner",
    });
    assert.deepEqual(await client.listRenewalTaskOutbox(), [pending]);
    assert.deepEqual(await client.loadRenewalTaskOutbox(pending.taskId), pending);
    assert.equal(await client.loadRenewalTaskOutbox("task_missing"), null);
    await client.verifyRenewalTaskReceipt(pending, task);
    assert.deepEqual(await store.get(key), row, "review must not clear anything");
    for (const action of [
      () => client.openTask(task),
      () => client.validateTaskPending(pending),
      () => client.loadTaskOutbox(pending.taskId),
      () => client.clearTaskOutbox(pending.taskId, pending.operationId),
      () => client.sealTask({ taskId: "other", content: {}, current: null, resourceBindings: [] }),
    ])
      await assert.rejects(action(), /key_renewal_pending/);
    await client.reconcileRenewalTaskOutbox(pending, task);
    assert.deepEqual(await store.get(key), {
      ownerSubject: f.owner,
      vaultId: f.vault.vaultId,
      slot: pending.taskId,
      kind: "outbox",
      revision: 2,
      deleted: true,
    });
    assert.equal(await client.loadRenewalTaskOutbox(pending.taskId), null);
    assert.deepEqual(await client.listRenewalTaskOutbox(), []);
    assert.deepEqual(await store.get(draftKey), { retained: "draft" });
    assert.deepEqual(await store.get(holdingsKey), { retained: "holdings" });
    await assert.rejects(client.reconcileRenewalTaskOutbox(pending, task), /operation_conflict/);
    assert.equal(
      await store.compareTaskRecord(key, { ...row, revision: 2 }, 1),
      false,
      "a stale writer cannot overwrite the tombstone",
    );
    assert.equal(
      await store.compareTaskRecord(
        key,
        { ...row, revision: 3, pending: { ...pending, operationId: "new_operation_0001" } },
        2,
      ),
      true,
    );
    await assert.rejects(client.reconcileRenewalTaskOutbox(pending, task), /operation_conflict/);
  }));
test("only a proven original task stops blocking renewal; inspection and unknown receipts retain the blocker", async () =>
  withStorage(async () => {
    const { f, pending, task, store, key, row, state } = await seeded();
    let { client } = await unlocked(f, store);
    for (const value of [null, {}, { ...task, metadata: { ...task.metadata, taskVersion: 2 } }]) {
      await assert.rejects(client.reconcileRenewalTaskOutbox(pending, value));
      assert.deepEqual(await store.get(key), row);
    }
    await assert.rejects(client.prepareKeyRenewal(f.vault, state), /key_renewal_local_pending/);
    ({ client } = await unlocked(f, store));
    await client.reconcileRenewalTaskOutbox(pending, task);
    const candidate = await client.prepareKeyRenewal(f.vault, state);
    assert.equal((await store.get(f.owner + ":key-renewal")).operationId, candidate.operationId);
    assert.equal((await store.get(key)).deleted, true);
  }));
test("ordinary sessions, foreign owner/vault/task rows, malformed tombstones and invalid IDs cannot reconcile", async () =>
  withStorage(async () => {
    const { f, pending, task, store, key, row } = await seeded(),
      ordinary = browser(f, store).client;
    for (const action of [
      () => ordinary.listRenewalTaskOutbox(),
      () => ordinary.loadRenewalTaskOutbox(pending.taskId),
      () => ordinary.verifyRenewalTaskReceipt(pending, task),
      () => ordinary.reconcileRenewalTaskOutbox(pending, task),
    ])
      await assert.rejects(action(), /invalid_operation/);
    const { client } = await unlocked(f, store);
    await assert.rejects(client.loadRenewalTaskOutbox("../foreign"), /invalid_data/);
    for (const changed of [
      { ...row, ownerSubject: "other_owner" },
      { ...row, vaultId: "other_vault" },
      { ...row, slot: "other_task" },
      { ...row, kind: "draft" },
      { ...row, deleted: true },
      { ...row, extra: undefined },
      { ...row, pending: { ...pending, taskId: "other_task" } },
    ]) {
      await store.put(key, changed);
      await assert.rejects(client.loadRenewalTaskOutbox(pending.taskId));
      await assert.rejects(client.reconcileRenewalTaskOutbox(pending, task));
      assert.deepEqual(await store.get(key), changed);
    }
  }));
test("a same-operation own undefined change after review is retained by exact bridge comparison", async () =>
  withStorage(async () => {
    const { f, pending, task, store, key, row } = await seeded(),
      { client } = await unlocked(f, store),
      reviewed = await client.loadRenewalTaskOutbox(pending.taskId);
    await client.verifyRenewalTaskReceipt(reviewed, task);
    const replacement = clone(row);
    replacement.pending.changedAfterReview = undefined;
    await store.put(key, replacement);
    assert.equal(JSON.stringify(replacement.pending), JSON.stringify(reviewed));
    await assert.rejects(client.verifyRenewalTaskReceipt(reviewed, task), /operation_conflict/);
    await assert.rejects(client.reconcileRenewalTaskOutbox(reviewed, task), /operation_conflict/);
    assert.deepEqual(await store.get(key), replacement);
  }));
test("same revision and operation changes during crypto verification cannot clear a replacement row", async () =>
  withStorage(async () => {
    let index = 0;
    for (const change of [
      (r) => (r.pending.changedDuringVerify = undefined),
      (r) => r.revision++,
      (r) => (r.pending.envelopeFingerprint = "0".repeat(64)),
    ]) {
      const { f, pending, task, store, key, row } = await seeded("synthetic_CAS_" + index++),
        { client } = await unlocked(f, store),
        original = store.reconcileTaskOutbox.bind(store),
        replacement = clone(row);
      change(replacement);
      store.reconcileTaskOutbox = async (...args) => {
        await store.put(key, replacement);
        return original(...args);
      };
      await assert.rejects(client.reconcileRenewalTaskOutbox(pending, task), /operation_conflict/);
      assert.deepEqual(await store.get(key), replacement);
    }
  }));
test("another tab's tombstone or newly staged operation cannot be cleared by an older verified ACK", async () =>
  withStorage(async () => {
    const { f, pending, task, store, key, row } = await seeded(),
      { client } = await unlocked(f, store),
      original = store.reconcileTaskOutbox.bind(store);
    const tombstone = { ...row, revision: 2, deleted: true };
    delete tombstone.pending;
    for (const replacement of [
      tombstone,
      { ...row, revision: 3, pending: { ...pending, operationId: "new_operation_0001" } },
    ]) {
      await store.put(key, row);
      store.reconcileTaskOutbox = async (...args) => {
        await store.put(key, replacement);
        return original(...args);
      };
      await assert.rejects(client.reconcileRenewalTaskOutbox(pending, task), /operation_conflict/);
      assert.deepEqual(await store.get(key), replacement);
    }
  }));
test("renewal, archive candidate, changed archive binding and session context fence all retain the original row", async () =>
  withStorage(async () => {
    for (const suffix of [":key-renewal", ":archive-change", ":archive-binding", "context"]) {
      const { f, pending, task, store, key, row } = await seeded("synthetic_fence_" + suffix),
        { client } = await unlocked(f, store),
        original = store.reconcileTaskOutbox.bind(store);
      store.reconcileTaskOutbox = async (...args) => {
        if (suffix === "context") {
          const operation = original(...args);
          context(store, f);
          return operation;
        }
        await store.put(
          f.owner + suffix,
          suffix === ":archive-binding"
            ? { credentialId: "changed", prfSalt: "changed" }
            : { pending: true },
        );
        return original(...args);
      };
      await assert.rejects(
        client.reconcileRenewalTaskOutbox(pending, task),
        /key_renewal_pending|archive_change_pending|archive_session_stale/,
      );
      assert.deepEqual(await store.get(key), row);
    }
  }));
test("lock before Worker reply and during IDB tombstone write reject stale completion and roll back uncommitted data", async () =>
  withStorage(async () => {
    const { f, pending, task, store, key, row } = await seeded(),
      first = await unlocked(f, store),
      entered = deferred(),
      release = deferred();
    first.worker.beforeReply = async (method) => {
      if (method === "verifyRenewalTaskReceipt") {
        entered.resolve();
        await release.promise;
      }
    };
    const operation = first.client.reconcileRenewalTaskOutbox(pending, task);
    await entered.promise;
    const rejected = assert.rejects(operation, /locked/);
    first.client.lock();
    release.resolve();
    await rejected;
    assert.deepEqual(await store.get(key), row);
    const second = await unlocked(f, store),
      put = fake.IDBObjectStore.prototype.put;
    fake.IDBObjectStore.prototype.put = function (value, target) {
      const request = put.call(this, value, target);
      if (target === key && value.deleted) second.client.lock();
      return request;
    };
    try {
      await assert.rejects(second.client.reconcileRenewalTaskOutbox(pending, task), /locked/);
    } finally {
      fake.IDBObjectStore.prototype.put = put;
    }
    assert.deepEqual(await store.get(key), row);
  }));
test("storage requires this owner/vault exact outbox shape and preserves a full row CAS", async () =>
  withStorage(async () => {
    const { f, store, key, row } = await seeded(),
      unbound = new storageModule.BrowserEncryptedStorage();
    await assert.rejects(unbound.reconcileTaskOutbox(key, row), /wrong_account/);
    for (const [target, expected] of [
      [key.replace(":task-outbox:", ":task-draft:"), row],
      [key, { ...row, kind: "draft" }],
      [key, { ...row, vaultId: "other_vault" }],
      [key, { ...row, extra: undefined }],
      [key, { ...row, revision: Number.MAX_SAFE_INTEGER }],
    ])
      await assert.rejects(store.reconcileTaskOutbox(target, expected), /wrong_account/);
    const replacement = clone(row);
    replacement.pending.extra = undefined;
    await store.put(key, replacement);
    assert.equal(await store.reconcileTaskOutbox(key, row), false);
    assert.deepEqual(await store.get(key), replacement);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(store.reconcileTaskOutbox(key, replacement, aborted.signal), /locked/);
    assert.deepEqual(await store.get(key), replacement);
  }));
test("lock after a committed tombstone but before completion delivery terminates Worker and rejects the stale return", async () =>
  withStorage(async () => {
    const { f, pending, task, store, key } = await seeded(),
      { client, worker } = await unlocked(f, store),
      put = fake.IDBObjectStore.prototype.put;
    let committed = false;
    fake.IDBObjectStore.prototype.put = function (value, target) {
      const request = put.call(this, value, target);
      if (target === key && value.deleted) {
        const tx = this.transaction,
          dispatch = tx.dispatchEvent;
        tx.dispatchEvent = function (event) {
          if (event.type === "complete") {
            assert.equal(this._state, "finished");
            committed = true;
            client.lock();
            assert.equal(worker.stopped, true);
          }
          return dispatch.call(this, event);
        };
      }
      return request;
    };
    try {
      await assert.rejects(client.reconcileRenewalTaskOutbox(pending, task), /locked/);
    } finally {
      fake.IDBObjectStore.prototype.put = put;
    }
    assert.equal(committed, true);
    assert.equal((await store.get(key)).revision, 2);
    assert.equal(
      (await store.get(key)).deleted,
      true,
      "already committed public cleanup is not claimed rolled back",
    );
  }));
test("archive context replacement while IDB opens cannot bypass the captured session fence", async () =>
  withStorage(async () => {
    const { f, store, key, row } = await seeded(),
      open = store.open.bind(store),
      entered = deferred(),
      release = deferred();
    store.open = async () => {
      entered.resolve();
      await release.promise;
      return open();
    };
    const operation = store.reconcileTaskOutbox(key, row);
    await entered.promise;
    store.setArchiveContext(
      f.owner,
      f.vault.archive.credentialId,
      f.vault.archive.prfSalt,
      "changed_iv",
    );
    release.resolve();
    await assert.rejects(operation, /archive_session_stale/);
    assert.deepEqual(await store.get(key), row);
  }));
test("a review batch authenticates at most 32 original packets and leaves additional rows blocking renewal", async () =>
  withStorage(async () => {
    const { f, store, key, row, state } = await seeded();
    f.time(1000);
    for (let i = 0; i < 33; i++) {
      const taskId = "task_batch_" + String(i).padStart(2, "0"),
        { pending } = await createTask(h, f, { template: "custom", bindings: [], taskId });
      await store.put(key.slice(0, key.lastIndexOf(":") + 1) + taskId, {
        ...row,
        slot: taskId,
        pending,
      });
    }
    f.time(clock);
    const { client } = await unlocked(f, store),
      originalGet = store.get.bind(store);
    store.get = (key) => {
      assert.equal(key.includes(":task-draft:"), false);
      return originalGet(key);
    };
    const pending = await client.listRenewalTaskOutbox();
    assert.equal(pending.length, 32);
    assert.equal(pending[0].taskId, "task_batch_00");
    assert.equal(pending.at(-1).taskId, "task_batch_31");
    assert.deepEqual(await store.get(key), row);
    assert.equal((await store.list(key.slice(0, key.lastIndexOf(":") + 1))).length, 34);
    await assert.rejects(client.prepareKeyRenewal(f.vault, state), /key_renewal_local_pending/);
  }));

async function cancelReply(packet, outcome = "cancelled") {
  const p = require("./full-flow-crypto-fixture.cjs").decoded(packet.body.command);
  return {
    contractVersion: h.core.CONTRACT,
    profile: p.profile,
    command: clone(packet.body.command),
    receipt: {
      ...Object.fromEntries(
        ["cancellationId", "ownerSubject", "vaultId", "rootKeyId", "rootEpoch", "target"].map(
          (k) => [k, clone(p[k])],
        ),
      ),
      commandFingerprint: await h.core.signingFingerprint(packet.body.command),
      outcome,
      acceptedAt: clock,
    },
  };
}
for (const kind of ["task", "holdings"]) {
  async function cancelSeed() {
    const seed = await seeded();
    if (kind === "task") return { ...seed, slot: seed.pending.taskId };
    seed.f.time(1000);
    const fixture = await require("./full-flow-crypto-fixture.cjs").importHoldings(h, seed.f);
    seed.f.time(clock);
    const slot = fixture.source.resourceRef.resourceId,
      key = seed.f.owner + ":outbox:" + slot,
      row = { ownerSubject: seed.f.owner, vaultId: seed.f.vault.vaultId, pending: fixture.pending };
    await seed.store.remove(seed.key);
    await seed.store.put(key, row);
    return { ...seed, ...fixture, key, row, slot };
  }
  test(`${kind} cancellation persists before transport, resumes identical command and clears only after proof`, async () =>
    withStorage(async () => {
      const { f, pending, store, key, row, slot, state } = await cancelSeed(),
        { client } = await unlocked(f, store);
      const record = await client.prepareRenewalUploadCancellation(kind, slot, pending),
        cancelKey = f.owner + ":upload-cancellation:" + f.vault.vaultId + ":" + kind + ":" + slot;
      assert.deepEqual(await store.get(key), row);
      assert.deepEqual((await store.get(cancelKey)).original, row);
      await assert.rejects(client.prepareKeyRenewal(f.vault, state), /key_renewal_local_pending/);
      client.lock();
      const second = await unlocked(f, store);
      assert.deepEqual(await second.client.listRenewalUploadCancellations(kind), [record]);
      assert.deepEqual(
        await second.client.prepareRenewalUploadCancellation(kind, slot, pending),
        record,
      );
      for (const reply of [null, {}, { ...(await cancelReply(record.packet)), receipt: {} }])
        await assert.rejects(second.client.finishRenewalUploadCancellation(record, reply));
      assert.deepEqual(await store.get(key), row);
      assert.ok(await store.get(cancelKey));
      await second.client.finishRenewalUploadCancellation(record, await cancelReply(record.packet));
      assert.equal(await store.get(cancelKey), null);
      if (kind === "task") {
        assert.equal((await store.get(key)).deleted, true);
        assert.equal((await store.get(key)).revision, 2);
      } else assert.equal(await store.get(key), null);
      assert.deepEqual(await second.client.listRenewalUploadCancellations(kind), []);
    }));
  test(`${kind} saved cancellation needs the actual historical original before local cleanup`, async () =>
    withStorage(async () => {
      const { f, pending, store, key, row, slot, task, response } = await cancelSeed(),
        { client } = await unlocked(f, store),
        record = await client.prepareRenewalUploadCancellation(kind, slot, pending),
        reply = await cancelReply(record.packet, "saved");
      await assert.rejects(client.finishRenewalUploadCancellation(record, reply));
      await assert.rejects(
        client.finishRenewalUploadCancellation(record, reply, {
          task: {},
          receipt: {},
          snapshot: {},
        }),
      );
      assert.deepEqual(await store.get(key), row);
      await client.finishRenewalUploadCancellation(
        record,
        reply,
        kind === "task" ? { task } : { receipt: response.receipt, snapshot: response },
      );
      if (kind === "task") assert.equal((await store.get(key)).deleted, true);
      else assert.equal(await store.get(key), null);
    }));
  test(`${kind} a newer tab upload survives finishing an older terminal cancellation`, async () =>
    withStorage(async () => {
      const { f, pending, store, key, row, slot, state } = await cancelSeed(),
        { client } = await unlocked(f, store),
        record = await client.prepareRenewalUploadCancellation(kind, slot, pending),
        replacement = clone(row);
      replacement.pending.operationId = "synthetic_newer_operation_0001";
      if (kind === "task") replacement.revision++;
      await store.put(key, replacement);
      await client.finishRenewalUploadCancellation(record, await cancelReply(record.packet));
      assert.deepEqual(await store.get(key), replacement);
      assert.deepEqual(await client.listRenewalUploadCancellations(kind), []);
      await assert.rejects(client.prepareKeyRenewal(f.vault, state), /key_renewal_local_pending/);
    }));
}
test("cancellation staging rejects full-row races, renewal candidates, stale archive and lock during Worker reply", async () =>
  withStorage(async () => {
    const { f, pending, store, key, row } = await seeded(),
      { client, worker } = await unlocked(f, store),
      entered = deferred(),
      release = deferred();
    worker.beforeReply = async (method) => {
      if (method === "prepareUploadCancellation") {
        entered.resolve();
        await release.promise;
      }
    };
    const operation = client.prepareRenewalUploadCancellation("task", pending.taskId, pending);
    await entered.promise;
    const replacement = { ...row, revision: 2 };
    await store.put(key, replacement);
    release.resolve();
    await assert.rejects(operation, /operation_conflict/);
    assert.deepEqual(await store.get(key), replacement);
    assert.deepEqual(await store.list(f.owner + ":upload-cancellation:"), []);
    await store.put(key, row);
    worker.beforeReply = undefined;
    await store.put(f.owner + ":key-renewal", { ownerSubject: f.owner, vaultId: f.vault.vaultId });
    await assert.rejects(client.prepareRenewalUploadCancellation("task", pending.taskId, pending));
    await store.atomic((s, done) => {
      s.delete(f.owner + ":key-renewal");
      done();
    });
    const record = await client.prepareRenewalUploadCancellation("task", pending.taskId, pending),
      cancelKey = f.owner + ":upload-cancellation:" + f.vault.vaultId + ":task:" + pending.taskId,
      saved = await store.get(cancelKey),
      open = store.open.bind(store),
      e = deferred(),
      r = deferred();
    store.open = async () => {
      e.resolve();
      await r.promise;
      return open();
    };
    const finishing = store.finishUploadCancellation(cancelKey, saved);
    await e.promise;
    store.setArchiveContext(
      f.owner,
      f.vault.archive.credentialId,
      f.vault.archive.prfSalt,
      "changed_iv",
    );
    r.resolve();
    await assert.rejects(finishing, /archive_session_stale/);
    store.open = open;
    context(store, f);
    assert.deepEqual(await store.get(key), row);
    const e2 = deferred(),
      r2 = deferred();
    worker.beforeReply = async (method) => {
      if (method === "verifyUploadCancellationReceipt") {
        e2.resolve();
        await r2.promise;
      }
    };
    const final = client.finishRenewalUploadCancellation(record, await cancelReply(record.packet));
    await e2.promise;
    const rejected = assert.rejects(final, /locked/);
    client.lock();
    r2.resolve();
    await rejected;
    assert.deepEqual(await store.get(key), row);
    assert.deepEqual(await store.get(cancelKey), saved);
  }));

test("pending cancellation remains a renewal blocker even when another tab removed its original outbox", async () =>
  withStorage(async () => {
    const { f, pending, store, key, state } = await seeded(),
      { client } = await unlocked(f, store),
      record = await client.prepareRenewalUploadCancellation("task", pending.taskId, pending);
    await store.atomic((s, done) => {
      s.delete(key);
      done();
    });
    await assert.rejects(client.prepareKeyRenewal(f.vault, state), /key_renewal_local_pending/);
    const resumed = (await unlocked(f, store)).client;
    assert.deepEqual(await resumed.listRenewalUploadCancellations("task"), [record]);
    await resumed.finishRenewalUploadCancellation(record, await cancelReply(record.packet));
    assert.equal(await store.get(key), null);
    assert.deepEqual(await resumed.listRenewalUploadCancellations("task"), []);
  }));
test("locking inside cancellation cleanup aborts the whole IDB transaction, retaining original and cancellation", async () =>
  withStorage(async () => {
    const { f, pending, store, key, row } = await seeded(),
      { client } = await unlocked(f, store),
      record = await client.prepareRenewalUploadCancellation("task", pending.taskId, pending),
      cancelKey = f.owner + ":upload-cancellation:" + f.vault.vaultId + ":task:" + pending.taskId,
      saved = await store.get(cancelKey),
      put = fake.IDBObjectStore.prototype.put;
    fake.IDBObjectStore.prototype.put = function (value, target) {
      const request = put.call(this, value, target);
      if (target === key && value.deleted) client.lock();
      return request;
    };
    try {
      await assert.rejects(
        client.finishRenewalUploadCancellation(record, await cancelReply(record.packet)),
        /locked/,
      );
    } finally {
      fake.IDBObjectStore.prototype.put = put;
    }
    assert.deepEqual(await store.get(key), row);
    assert.deepEqual(await store.get(cancelKey), saved);
  }));
