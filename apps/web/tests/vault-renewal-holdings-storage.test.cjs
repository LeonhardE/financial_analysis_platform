const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");
const {
  createHarness,
  createOwner,
  importHoldings,
  clone,
} = require("./full-flow-crypto-fixture.cjs");
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
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-renewal-holdings-storage-"));
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
  const filename = path.resolve(__dirname, "../lib/encrypted-vault.worker.ts");
  workerCode = transformSync(readFileSync(filename, "utf8"), {
    filename,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  }).code;
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
    holdings = await importHoldings(h, f),
    store = new storageModule.BrowserEncryptedStorage(),
    state = await lifecycleState(h, f);
  context(store, f);
  await store.commitVault(f.owner, f.local);
  await store.commitLifecycle(
    f.owner,
    await f.session.verifyLifecycle(f.vault, state),
    f.vault.archive,
  );
  const key = f.owner + ":outbox:" + holdings.source.resourceRef.resourceId,
    row = { ownerSubject: f.owner, vaultId: f.vault.vaultId, pending: holdings.pending };
  await store.put(key, row);
  clock = 31537001;
  f.time(clock);
  return { f, holdings, store, state, key, row };
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
  const result = browser(f, store);
  await result.client.unlockForKeyRenewal(f.vault, f.material());
  return result;
}

test("expired renewal-only bridge verifies exact saved holdings without deleting until reconciliation and never opens ordinary APIs", async () =>
  withStorage(async () => {
    const { f, holdings, store, key, row, state } = await seeded(),
      { client } = await unlocked(f, store),
      taskKey = f.owner + ":task-outbox:" + f.vault.vaultId + ":task_synthetic";
    await store.put(taskKey, { ownerSubject: f.owner, pending: { operationId: "task_retained" } });
    await store.put("other-owner:outbox:holdings", { encrypted: "other_retained" });
    const original = await client.loadRenewalHoldingsOutbox(holdings.source.resourceRef.resourceId);
    assert.deepEqual(original, holdings.pending);
    await client.verifyRenewalHoldingsReceipt(
      original,
      holdings.response.receipt,
      holdings.response,
    );
    assert.deepEqual(await store.get(key), row, "inspection is read-only");
    for (const run of [
      () => client.verifyReceipt(original, holdings.response.receipt),
      () => client.loadOutbox(holdings.source.resourceRef.resourceId),
      () => client.clearOutbox(holdings.source.resourceRef.resourceId, original.operationId),
      () => client.signSource(holdings.source.resourceRef.resourceId),
      () => client.openSnapshot(holdings.response, holdings.source),
    ])
      await assert.rejects(run, /key_renewal_pending/);
    await client.reconcileRenewalHoldingsOutbox(
      original,
      holdings.response.receipt,
      holdings.response,
    );
    assert.equal(await store.get(key), null);
    assert.equal((await store.get(taskKey)).pending.operationId, "task_retained");
    assert.equal((await store.get("other-owner:outbox:holdings")).encrypted, "other_retained");
    await assert.rejects(client.prepareKeyRenewal(f.vault, state), /key_renewal_local_pending/);
    assert.equal(
      (await store.get(taskKey)).pending.operationId,
      "task_retained",
      "task still blocks renewal",
    );
  }));

test("renewal bridge rejects ordinary sessions, invalid source keys and foreign owner/vault/source rows without deleting", async () =>
  withStorage(async () => {
    const { f, holdings, store, key, row } = await seeded(),
      ordinary = browser(f, store).client;
    await assert.rejects(
      ordinary.loadRenewalHoldingsOutbox(holdings.source.resourceRef.resourceId),
      /invalid_operation/,
    );
    await assert.rejects(
      ordinary.verifyRenewalHoldingsReceipt(
        holdings.pending,
        holdings.response.receipt,
        holdings.response,
      ),
      /invalid_operation/,
    );
    await assert.rejects(
      ordinary.reconcileRenewalHoldingsOutbox(
        holdings.pending,
        holdings.response.receipt,
        holdings.response,
      ),
      /invalid_operation/,
    );
    const { client } = await unlocked(f, store);
    await assert.rejects(client.loadRenewalHoldingsOutbox("task-outbox:foreign"), /invalid_data/);
    assert.equal(await client.loadRenewalHoldingsOutbox("missing_source"), null);
    for (const changed of [
      { ...row, ownerSubject: "foreign-owner" },
      { ...row, vaultId: "foreign-vault" },
      {
        ...row,
        pending: {
          ...holdings.pending,
          source: {
            ...holdings.source,
            resourceRef: { ...holdings.source.resourceRef, resourceId: "foreign-source" },
          },
        },
      },
    ]) {
      await store.put(key, changed);
      await assert.rejects(
        client.loadRenewalHoldingsOutbox(holdings.source.resourceRef.resourceId),
        /wrong_account/,
      );
      assert.deepEqual(await store.get(key), changed);
    }
  }));

test("unresolved holdings still block renewal; only exact saved reconciliation removes that blocker", async () =>
  withStorage(async () => {
    const { f, holdings, store, key, row, state } = await seeded(),
      first = await unlocked(f, store);
    await assert.rejects(
      first.client.prepareKeyRenewal(f.vault, state),
      /key_renewal_local_pending/,
    );
    assert.deepEqual(await store.get(key), row);
    assert.equal(await store.get(f.owner + ":key-renewal"), null);
    const { client } = await unlocked(f, store);
    await client.reconcileRenewalHoldingsOutbox(
      holdings.pending,
      holdings.response.receipt,
      holdings.response,
    );
    assert.equal(await store.get(key), null);
    const packet = await client.prepareKeyRenewal(f.vault, state);
    assert.equal((await store.get(f.owner + ":key-renewal")).operationId, packet.operationId);
  }));

test("receipt mismatch or full historical carrier mismatch retains the original encrypted package", async () =>
  withStorage(async () => {
    const { f, holdings, store, key, row } = await seeded(),
      { client } = await unlocked(f, store);
    const badReceipt = { ...holdings.response.receipt, stableOperationId: "wrong-operation" },
      badSnapshot = clone(holdings.response);
    badSnapshot.carrier.signedObject.signature = "A".repeat(
      badSnapshot.carrier.signedObject.signature.length,
    );
    for (const [receipt, snapshot] of [
      [badReceipt, holdings.response],
      [holdings.response.receipt, badSnapshot],
    ]) {
      await assert.rejects(
        client.verifyRenewalHoldingsReceipt(holdings.pending, receipt, snapshot),
      );
      await assert.rejects(
        client.reconcileRenewalHoldingsOutbox(holdings.pending, receipt, snapshot),
      );
      assert.deepEqual(await store.get(key), row);
    }
  }));

test("same operation ID cannot clear a package replaced between crypto verification and full-row CAS", async () =>
  withStorage(async () => {
    const { f, holdings, store, key, row } = await seeded(),
      { client } = await unlocked(f, store),
      other = new storageModule.BrowserEncryptedStorage(),
      original = store.reconcileHoldingsOutbox.bind(store),
      replacement = { ...row, pending: { ...holdings.pending, snapshotId: "different_snapshot" } };
    context(other, f);
    store.reconcileHoldingsOutbox = async (...args) => {
      await other.put(key, replacement);
      return original(...args);
    };
    await assert.rejects(
      client.reconcileRenewalHoldingsOutbox(
        holdings.pending,
        holdings.response.receipt,
        holdings.response,
      ),
      /operation_conflict/,
    );
    assert.equal(replacement.pending.operationId, holdings.pending.operationId);
    assert.deepEqual(await store.get(key), replacement);
  }));

test("bridge rejects an own undefined field added to the stored pending package after read-only review", async () =>
  withStorage(async () => {
    const { f, holdings, store, key, row } = await seeded(),
      { client } = await unlocked(f, store),
      reviewed = await client.loadRenewalHoldingsOutbox(holdings.source.resourceRef.resourceId);
    await client.verifyRenewalHoldingsReceipt(
      reviewed,
      holdings.response.receipt,
      holdings.response,
    );
    const replacement = clone(row);
    replacement.pending.changedAfterReview = undefined;
    await store.put(key, replacement);
    assert.equal(JSON.stringify(replacement.pending), JSON.stringify(reviewed));
    for (const method of ["verifyRenewalHoldingsReceipt", "reconcileRenewalHoldingsOutbox"])
      await assert.rejects(
        client[method](reviewed, holdings.response.receipt, holdings.response),
        /operation_conflict/,
      );
    assert.deepEqual(await store.get(key), replacement);
    assert.equal(Object.hasOwn((await store.get(key)).pending, "changedAfterReview"), true);
  }));

test("another tab's renewal or archive fence after verified read preserves the encrypted outbox", async () =>
  withStorage(async () => {
    for (const suffix of [":key-renewal", ":archive-change", ":archive-binding"]) {
      const { f, holdings, store, key, row } = await seeded("synthetic_fence_" + suffix),
        { client } = await unlocked(f, store),
        other = new storageModule.BrowserEncryptedStorage(),
        original = store.reconcileHoldingsOutbox.bind(store);
      context(other, f);
      store.reconcileHoldingsOutbox = async (...args) => {
        await other.put(
          f.owner + suffix,
          suffix === ":archive-binding"
            ? {
                credentialId: f.vault.archive.credentialId,
                prfSalt: f.vault.archive.prfSalt,
                archiveIv: "different_iv",
              }
            : { ownerSubject: f.owner, pending: "retained_fence" },
        );
        return original(...args);
      };
      await assert.rejects(
        client.reconcileRenewalHoldingsOutbox(
          holdings.pending,
          holdings.response.receipt,
          holdings.response,
        ),
        /key_renewal_pending|archive_change_pending|archive_session_stale/,
      );
      assert.deepEqual(await store.get(key), row);
    }
  }));

test("locking during a verified Worker reply or during the IDB delete aborts cleanup and retains the original row", async () =>
  withStorage(async () => {
    const { f, holdings, store, key, row } = await seeded(),
      first = await unlocked(f, store),
      entered = deferred(),
      release = deferred();
    first.worker.beforeReply = async (method) => {
      if (method === "verifyRenewalHoldingsReceipt") {
        entered.resolve();
        await release.promise;
      }
    };
    const pending = first.client.reconcileRenewalHoldingsOutbox(
      holdings.pending,
      holdings.response.receipt,
      holdings.response,
    );
    await entered.promise;
    const rejected = assert.rejects(pending, /locked/);
    first.client.lock();
    release.resolve();
    await rejected;
    assert.deepEqual(await store.get(key), row);
    const second = await unlocked(f, store),
      originalDelete = fake.IDBObjectStore.prototype.delete;
    fake.IDBObjectStore.prototype.delete = function (target) {
      const request = originalDelete.call(this, target);
      if (target === key) second.client.lock();
      return request;
    };
    try {
      await assert.rejects(
        second.client.reconcileRenewalHoldingsOutbox(
          holdings.pending,
          holdings.response.receipt,
          holdings.response,
        ),
        /locked/,
      );
    } finally {
      fake.IDBObjectStore.prototype.delete = originalDelete;
    }
    assert.deepEqual(await store.get(key), row, "the transaction rolls back its queued delete");
  }));

test("storage reconciliation requires exact holdings key/context/full row, including newly added undefined fields", async () =>
  withStorage(async () => {
    const { f, store, key, row } = await seeded(),
      noContext = new storageModule.BrowserEncryptedStorage();
    await assert.rejects(noContext.reconcileHoldingsOutbox(key, row), /wrong_account/);
    await assert.rejects(
      store.reconcileHoldingsOutbox(f.owner + ":task-outbox:" + f.vault.vaultId + ":task", row),
      /wrong_account/,
    );
    const replacement = clone(row);
    replacement.pending.changedDuringVerification = undefined;
    await store.put(key, replacement);
    assert.equal(await store.reconcileHoldingsOutbox(key, row), false);
    assert.deepEqual(await store.get(key), replacement);
  }));

test("lock after committed deletion but before completion delivery still terminates Worker and rejects the stale session return", async () =>
  withStorage(async () => {
    const { f, holdings, store, key } = await seeded(),
      { client, worker } = await unlocked(f, store),
      originalDelete = fake.IDBObjectStore.prototype.delete;
    let committedBeforeLock = false;
    fake.IDBObjectStore.prototype.delete = function (target) {
      const request = originalDelete.call(this, target);
      if (target === key) {
        const tx = this.transaction,
          dispatch = tx.dispatchEvent;
        tx.dispatchEvent = function (event) {
          if (event.type === "complete") {
            assert.equal(this._state, "finished");
            committedBeforeLock = true;
            client.lock();
            assert.equal(worker.stopped, true);
          }
          return dispatch.call(this, event);
        };
      }
      return request;
    };
    try {
      await assert.rejects(
        client.reconcileRenewalHoldingsOutbox(
          holdings.pending,
          holdings.response.receipt,
          holdings.response,
        ),
        /locked/,
      );
    } finally {
      fake.IDBObjectStore.prototype.delete = originalDelete;
    }
    assert.equal(committedBeforeLock, true);
    assert.equal(await store.get(key), null, "already committed deletion cannot be rolled back");
  }));

test("archive context changed while storage opens cannot bypass the captured session binding", async () =>
  withStorage(async () => {
    const { f, store, key, row } = await seeded(),
      oldOpen = store.open.bind(store),
      entered = deferred(),
      release = deferred();
    store.open = async () => {
      entered.resolve();
      await release.promise;
      return oldOpen();
    };
    const pending = store.reconcileHoldingsOutbox(key, row);
    await entered.promise;
    store.setArchiveContext(
      f.owner,
      f.vault.archive.credentialId,
      f.vault.archive.prfSalt,
      "different_iv",
    );
    release.resolve();
    await assert.rejects(pending, /archive_session_stale/);
    assert.deepEqual(await store.get(key), row);
  }));
