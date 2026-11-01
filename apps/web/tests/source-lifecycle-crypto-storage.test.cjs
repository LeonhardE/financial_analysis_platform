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
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-source-lifecycle-"));
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

const source = () => ({
  resourceRef: {
    kind: "holdings",
    sourceService: "portfolio",
    resourceId: "source_synthetic_A",
    incarnation: "inc_synthetic_A",
  },
  sourceEpoch: 1,
});
const decoded = (signed) => JSON.parse(Buffer.from(signed.payload, "base64url"));
const iso = (n) => new Date(n * 1000).toISOString();
const ack = (packet, patch = {}) => ({
  contractVersion: h.core.CONTRACT,
  operationId: packet.operationId,
  action: packet.action,
  resourceRef: clone(packet.source.resourceRef),
  sourceEpoch: packet.source.sourceEpoch + 1,
  state: "acknowledged",
  requestedAt: iso(1000),
  completedAt: iso(1001),
  ...patch,
});
async function seed() {
  clock = 1000;
  const f = await createOwner(h),
    store = new storageModule.BrowserEncryptedStorage();
  context(store, f);
  await store.commitVault(f.owner, f.local);
  const { client, worker } = browser(f, store);
  await client.unlock(f.vault, f.material());
  await client.acceptVault(f.vault);
  return { f, store, client, worker };
}
async function restored(f, store, renewal = false) {
  const { client, worker } = browser(f, store);
  if (renewal) await client.unlockForKeyRenewal(f.vault, f.material());
  else {
    await client.unlock(f.vault, f.material());
    await client.acceptVault(f.vault);
  }
  return { client, worker };
}

test("fixed source control signatures bind owner/ref/epoch/action/CAS and cannot become arbitrary signing", async () => {
  const f = await createOwner(h);
  for (const [action, wire] of [
    ["fence", "resource_fence_request"],
    ["disconnect", "source_disconnect"],
    ["delete", "source_delete"],
  ]) {
    const packet = await f.session.signSourceMutation({
      source: source(),
      expectedVersion: 3,
      action,
    });
    const command = decoded(packet.body.command);
    assert.equal(command.action, wire);
    assert.equal(command.ownerSubject, f.owner);
    assert.equal(command.vaultId, f.vault.vaultId);
    assert.equal(command.targetId, source().resourceRef.resourceId);
    assert.equal(command.expectedVersion, 3);
    assert.equal(command.expectedSourceEpoch, 1);
    assert.deepEqual(
      command.parameters,
      action === "fence" ? { resourceRef: source().resourceRef } : {},
    );
    assert.equal(packet.operationId.length, 86);
    assert.equal(packet.operationId.slice(22), await h.core.sha(h.core.canonical(source())));
    assert.deepEqual(await f.session.validateSourceMutation(packet), packet);
    assert.deepEqual(await f.session.verifySourceMutationReceipt(packet, ack(packet)), ack(packet));
    for (const changed of [
      { ...clone(packet), operationId: "A".repeat(86) },
      { ...clone(packet), source: { ...source(), sourceEpoch: 2 } },
      {
        ...clone(packet),
        source: {
          ...source(),
          resourceRef: { ...source().resourceRef, incarnation: "different_incarnation" },
        },
      },
      { ...clone(packet), action: "delete" === action ? "disconnect" : "delete" },
      { ...clone(packet), body: { ...packet.body, expectedVersion: 4 } },
      { ...clone(packet), extra: "not accepted" },
      {
        ...clone(packet),
        body: { ...packet.body, command: { ...packet.body.command, signature: "A".repeat(86) } },
      },
    ])
      await assert.rejects(f.session.validateSourceMutation(changed));
    const other = await createOwner(h, "synthetic_owner_B");
    await assert.rejects(other.session.validateSourceMutation(packet));
  }
  for (const args of [
    { source: source(), expectedVersion: 0, action: "fence" },
    { source: source(), expectedVersion: 1, action: "reset" },
    {
      source: { ...source(), sourceEpoch: Number.MAX_SAFE_INTEGER },
      expectedVersion: 1,
      action: "delete",
    },
    { source: source(), expectedVersion: 1, action: "fence", parameters: { anything: true } },
  ])
    await assert.rejects(f.session.signSourceMutation(args));
});

test("pending and ACK receipts are closed and bound; timestamps and wrong operation/ref/epoch fail", async () => {
  const f = await createOwner(h),
    packet = await f.session.signSourceMutation({
      source: source(),
      expectedVersion: 1,
      action: "fence",
    });
  const pending = ack(packet, { state: "pending", completedAt: null });
  assert.deepEqual(await f.session.verifySourceMutationReceipt(packet, pending), pending);
  for (const patch of [
    { operationId: "another_operation_000001" },
    { action: "delete" },
    { sourceEpoch: 1 },
    { resourceRef: { ...source().resourceRef, incarnation: "other" } },
    { state: "done" },
    { requestedAt: "2026-02-31T00:00:00Z" },
    { completedAt: iso(999) },
    { state: "pending" },
    { completedAt: null },
    { extra: true },
  ])
    await assert.rejects(f.session.verifySourceMutationReceipt(packet, ack(packet, patch)));
});

test("original public controls remain verifiable after expiry without enabling new source signatures", async () => {
  const f = await createOwner(h),
    packet = await f.session.signSourceMutation({
      source: source(),
      expectedVersion: 1,
      action: "disconnect",
    }),
    created = await f.session.prepareSourceCreation("source_new");
  f.time(31537001);
  await assert.rejects(
    f.session.signSourceMutation({ source: source(), expectedVersion: 1, action: "delete" }),
  );
  assert.deepEqual(await f.session.validateSourceMutation(packet), packet);
  assert.deepEqual(await f.session.verifySourceMutationReceipt(packet, ack(packet)), ack(packet));
  assert.deepEqual(await f.session.validateSourceCreation(created), created);
  await assert.rejects(f.session.prepareSourceCreation("source_more"));
  const rootOnly = new h.core.VaultCore(f.uid, f.now);
  await rootOnly.unlockForKeyRenewal(f.vault, f.material(), {
    pin: f.local.pin,
    device: f.local.device,
  });
  assert.deepEqual(await rootOnly.validateSourceMutation(packet), packet);
  await rootOnly.verifySourceMutationReceipt(packet, ack(packet));
  await rootOnly.validateSourceCreation(created);
});

test("public creation binds source ID and signature-derived incarnation, permitting only the exact original packet", async () => {
  const f = await createOwner(h),
    packet = await f.session.prepareSourceCreation("source_new");
  const selected = {
    resourceRef: {
      ...source().resourceRef,
      resourceId: packet.sourceId,
      incarnation: "inc_" + (await h.core.signingFingerprint(packet.command)).slice(0, 32),
    },
    sourceEpoch: 3,
  };
  await f.session.verifySourceCreation(packet, selected);
  for (const changed of [
    { ...selected, resourceRef: { ...selected.resourceRef, resourceId: "source_other" } },
    { ...selected, resourceRef: { ...selected.resourceRef, incarnation: "inc_different" } },
    { ...selected, sourceEpoch: 0 },
  ])
    await assert.rejects(f.session.verifySourceCreation(packet, changed));
  await assert.rejects(f.session.validateSourceCreation({ ...packet, sourceId: "source_other" }));
  await assert.rejects(
    f.session.validateSourceCreation({
      ...packet,
      command: { ...packet.command, signature: "A".repeat(86) },
    }),
  );
});

test("mutation outbox survives restart byte-for-byte, finishes only ACK and never removes a competing newer packet", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed();
    const packet = await client.prepareSourceMutation({
      source: source(),
      expectedVersion: 1,
      action: "delete",
    });
    const key = f.owner + ":source-mutation:" + source().resourceRef.resourceId;
    assert.deepEqual((await store.get(key)).pending, packet);
    client.lock();
    const restarted = (await restored(f, store)).client;
    assert.deepEqual(await restarted.loadSourceMutation(source().resourceRef.resourceId), packet);
    await assert.rejects(
      restarted.finishSourceMutation(packet, ack(packet, { state: "pending", completedAt: null })),
    );
    assert.ok(await store.get(key));
    const newer = await f.session.signSourceMutation({
      source: source(),
      expectedVersion: 1,
      action: "fence",
    });
    await store.put(key, { ownerSubject: f.owner, vaultId: f.vault.vaultId, pending: newer });
    await assert.rejects(restarted.finishSourceMutation(packet, ack(packet)), /operation_conflict/);
    assert.deepEqual((await store.get(key)).pending, newer);
    await restarted.finishSourceMutation(newer, ack(newer));
    assert.equal(await store.get(key), null);
  }));

test("cross-tab source mutation races preserve one packet and both directions exclude snapshot upload atomically", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed(),
      other = (await restored(f, new storageModule.BrowserEncryptedStorage())).client;
    const results = await Promise.allSettled([
      client.prepareSourceMutation({ source: source(), expectedVersion: 1, action: "disconnect" }),
      other.prepareSourceMutation({ source: source(), expectedVersion: 1, action: "delete" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const packet = await client.loadSourceMutation(source().resourceRef.resourceId);
    assert.ok(packet);
    const holdings = await importHoldings(h, f);
    const uploadArgs = {
      source: source(),
      expectedRevision: 0,
      content: holdings.preview.resourceContent,
      snapshotId: "snapshot_synthetic",
    };
    await assert.rejects(client.sealSnapshot(uploadArgs), /pending_upload/);
    await client.finishSourceMutation(packet, ack(packet));
    const uploadKey = f.owner + ":outbox:" + source().resourceRef.resourceId;
    const upload = await client.sealSnapshot(uploadArgs);
    assert.deepEqual(await client.loadOutbox(source().resourceRef.resourceId), upload);
    await assert.rejects(
      client.prepareSourceMutation({ source: source(), expectedVersion: 1, action: "fence" }),
      /source_mutation_pending/,
    );
    assert.ok(await store.get(uploadKey));
  }));

test("creation is one-per-vault durable and exact-CAS; wrong incarnation cannot clear it", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed(),
      packet = await client.prepareSourceCreation("source_new");
    await assert.rejects(client.prepareSourceCreation("source_another"), /source_creation_pending/);
    client.lock();
    const resumed = (await restored(f, store)).client;
    assert.deepEqual(await resumed.loadSourceCreation(), packet);
    const selected = {
      resourceRef: {
        ...source().resourceRef,
        resourceId: packet.sourceId,
        incarnation: "inc_" + (await h.core.signingFingerprint(packet.command)).slice(0, 32),
      },
      sourceEpoch: 1,
    };
    await assert.rejects(
      resumed.finishSourceCreation(packet, {
        ...selected,
        resourceRef: { ...selected.resourceRef, incarnation: "inc_wrong" },
      }),
    );
    const key = f.owner + ":source-create:" + f.vault.vaultId,
      newer = await f.session.prepareSourceCreation("source_different");
    await store.put(key, { ownerSubject: f.owner, vaultId: f.vault.vaultId, pending: newer });
    await assert.rejects(resumed.finishSourceCreation(packet, selected), /operation_conflict/);
    assert.deepEqual((await store.get(key)).pending, newer);
  }));

test("stale mutation cleanup requires same ref and strictly newer epoch and never deletes a newer operation", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed(),
      packet = await client.prepareSourceMutation({
        source: source(),
        expectedVersion: 1,
        action: "fence",
      });
    await assert.rejects(client.discardSourceMutation(packet, source()));
    await assert.rejects(
      client.discardSourceMutation(packet, {
        ...source(),
        resourceRef: { ...source().resourceRef, incarnation: "other" },
        sourceEpoch: 2,
      }),
    );
    const key = f.owner + ":source-mutation:" + source().resourceRef.resourceId,
      newer = await f.session.signSourceMutation({
        source: source(),
        expectedVersion: 1,
        action: "delete",
      });
    await store.put(key, { ownerSubject: f.owner, vaultId: f.vault.vaultId, pending: newer });
    await assert.rejects(
      client.discardSourceMutation(packet, { ...source(), sourceEpoch: 2 }),
      /operation_conflict/,
    );
    assert.deepEqual((await store.get(key)).pending, newer);
    await client.discardSourceMutation(newer, { ...source(), sourceEpoch: 2 });
    assert.equal(await store.get(key), null);
  }));

test("authority advance can retire an unaccepted mutation at the same epoch, without accepting rollback or deleting a replacement", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed(),
      selected = { ...source(), sourceEpoch: 3 },
      packet = await client.prepareSourceMutation({
        source: selected,
        expectedVersion: 5,
        action: "disconnect",
      }),
      key = f.owner + ":source-mutation:" + selected.resourceRef.resourceId;
    for (const version of [undefined, 5, 4, 0, -1, 5.5, NaN, Infinity, "6", null]) {
      await assert.rejects(client.discardSourceMutation(packet, selected, undefined, version));
      assert.deepEqual((await store.get(key)).pending, packet);
    }
    await assert.rejects(
      client.discardSourceMutation(packet, { ...selected, sourceEpoch: 2 }, undefined, 6),
      /binding_mismatch/,
    );
    await assert.rejects(
      client.discardSourceMutation(
        packet,
        { ...selected, resourceRef: { ...selected.resourceRef, incarnation: "other" } },
        undefined,
        6,
      ),
      /binding_mismatch/,
    );
    const newer = await f.session.signSourceMutation({
      source: selected,
      expectedVersion: 5,
      action: "delete",
    });
    await store.put(key, { ownerSubject: f.owner, vaultId: f.vault.vaultId, pending: newer });
    await assert.rejects(
      client.discardSourceMutation(packet, selected, undefined, 6),
      /operation_conflict/,
    );
    assert.deepEqual((await store.get(key)).pending, newer);
    await client.discardSourceMutation(newer, selected, undefined, 6);
    assert.equal(await store.get(key), null);
  }));

test("public candidate rows do not block the only key renewal path and ACK cleanup works in renewal-only mode", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed(),
      packet = await client.prepareSourceMutation({
        source: source(),
        expectedVersion: 1,
        action: "fence",
      }),
      created = await client.prepareSourceCreation("source_new");
    clock = 31537001;
    f.time(clock);
    const { client: renew } = await restored(f, store, true),
      state = await lifecycleState(h, f);
    const proposed = await renew.prepareKeyRenewal(f.vault, state);
    assert.ok(proposed.operationId);
    assert.deepEqual(await renew.loadSourceMutation(source().resourceRef.resourceId), packet);
    assert.deepEqual(await renew.loadSourceCreation(), created);
    await renew.finishSourceMutation(packet, ack(packet));
    assert.equal(
      await store.get(f.owner + ":source-mutation:" + source().resourceRef.resourceId),
      null,
    );
    const selected = {
      resourceRef: {
        ...source().resourceRef,
        resourceId: created.sourceId,
        incarnation: "inc_" + (await h.core.signingFingerprint(created.command)).slice(0, 32),
      },
      sourceEpoch: 1,
    };
    await renew.finishSourceCreation(created, selected);
    assert.equal(await store.get(f.owner + ":source-create:" + f.vault.vaultId), null);
    await assert.rejects(
      renew.prepareSourceMutation({ source: source(), expectedVersion: 1, action: "fence" }),
      /key_renewal_pending/,
    );
  }));

test("lock fences late Worker replies and late public cleanup transactions cannot delete the pending row", async () =>
  withStorage(async () => {
    const { f, store, client, worker } = await seed(),
      packet = await client.prepareSourceMutation({
        source: source(),
        expectedVersion: 1,
        action: "disconnect",
      });
    const wait = deferred();
    let reached;
    const ready = new Promise((r) => (reached = r));
    worker.beforeReply = async (method) => {
      if (method === "verifySourceMutationReceipt") {
        reached();
        await wait.promise;
      }
    };
    const finishing = client.finishSourceMutation(packet, ack(packet));
    await ready;
    client.lock();
    wait.resolve();
    await assert.rejects(finishing, /locked/);
    assert.ok(await store.get(f.owner + ":source-mutation:" + source().resourceRef.resourceId));
  }));

test("simultaneous valid snapshot and source control from different tabs cannot both enter durable outboxes", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed(),
      holdings = await importHoldings(h, f),
      other = (await restored(f, new storageModule.BrowserEncryptedStorage())).client;
    const results = await Promise.allSettled([
      client.sealSnapshot({
        source: source(),
        expectedRevision: 0,
        content: holdings.preview.resourceContent,
        snapshotId: "snapshot_synthetic",
      }),
      other.prepareSourceMutation({ source: source(), expectedVersion: 1, action: "fence" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const upload = await store.get(f.owner + ":outbox:" + source().resourceRef.resourceId),
      mutation = await store.get(f.owner + ":source-mutation:" + source().resourceRef.resourceId);
    assert.equal(Boolean(upload) + Boolean(mutation), 1);
  }));

test("revoked signing keys authenticate only original public controls and cannot sign a new mutation", async () => {
  const f = await createOwner(h),
    old = await f.session.signSourceMutation({
      source: source(),
      expectedVersion: 1,
      action: "delete",
    });
  const other = new h.core.VaultCore(f.uid, f.now);
  await other.unlock(f.vault, f.material());
  const registration = await other.prepareDeviceRegistration(f.vault);
  f.vault = {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, registration.registryBundle],
  };
  const otherLocal = await other.acceptVault(f.vault);
  await f.session.acceptVault(f.vault);
  const current = (await f.session.deviceManagement(f.vault)).summary.currentDeviceId;
  f.time(1002);
  const revocation = await other.prepareDeviceChange({
    vault: f.vault,
    action: "revoke",
    deviceId: current,
  });
  f.vault = {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, revocation.registryBundle],
  };
  await other.acceptDeviceChange(f.vault, revocation.localPending);
  await f.session.acceptResultVault(f.vault);
  await assert.rejects(
    f.session.signSourceMutation({ source: source(), expectedVersion: 1, action: "fence" }),
  );
  assert.deepEqual(await f.session.validateSourceMutation(old), old);
  await f.session.verifySourceMutationReceipt(old, ack(old));
  await assert.rejects(
    f.session.verifySourceMutationReceipt(
      old,
      ack(old, { requestedAt: iso(1003), completedAt: iso(1004) }),
    ),
  );
  void otherLocal;
});

test("aborted exact public-row cleanup preserves mutation and creation records", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed(),
      packet = await client.prepareSourceMutation({
        source: source(),
        expectedVersion: 1,
        action: "fence",
      }),
      creation = await client.prepareSourceCreation("source_new");
    const aborted = new AbortController();
    aborted.abort();
    const mutationKey = f.owner + ":source-mutation:" + source().resourceRef.resourceId,
      creationKey = f.owner + ":source-create:" + f.vault.vaultId;
    await assert.rejects(
      store.finishSourceMutation(
        mutationKey,
        { ownerSubject: f.owner, vaultId: f.vault.vaultId, pending: packet },
        aborted.signal,
      ),
      /locked/,
    );
    await assert.rejects(
      store.finishSourceCreation(
        creationKey,
        { ownerSubject: f.owner, vaultId: f.vault.vaultId, pending: creation },
        aborted.signal,
      ),
      /locked/,
    );
    assert.ok(await store.get(mutationKey));
    assert.ok(await store.get(creationKey));
  }));

test("caller cancellation fences a delayed ACK before any durable public-row deletion", async () =>
  withStorage(async () => {
    const { f, store, client, worker } = await seed(),
      packet = await client.prepareSourceMutation({
        source: source(),
        expectedVersion: 1,
        action: "fence",
      }),
      cancel = new AbortController();
    const hold = deferred();
    let reached;
    const ready = new Promise((r) => (reached = r));
    worker.beforeReply = async (method) => {
      if (method === "verifySourceMutationReceipt") {
        reached();
        await hold.promise;
      }
    };
    const finish = client.finishSourceMutation(packet, ack(packet), cancel.signal);
    await ready;
    cancel.abort();
    hold.resolve();
    await assert.rejects(finish, (error) => error.name === "AbortError");
    assert.ok(await store.get(f.owner + ":source-mutation:" + source().resourceRef.resourceId));
  }));

test("stale creation cleanup requires cryptographic checkpoint advance, bounded absent source and exact saved packet", async () =>
  withStorage(async () => {
    const { f, store, client } = await seed(),
      packet = await client.prepareSourceCreation("source_new");
    await assert.rejects(client.discardSourceCreation(packet, f.vault, []), /binding_mismatch/);
    const other = new h.core.VaultCore(f.uid, f.now);
    await other.unlock(f.vault, f.material());
    const registered = await other.prepareDeviceRegistration(f.vault);
    const current = {
      ...f.vault,
      version: f.vault.version + 1,
      registryHistory: [...f.vault.registryHistory, registered.registryBundle],
    };
    const wrong = await createOwner(h, "other_synthetic_owner");
    await assert.rejects(client.discardSourceCreation(packet, wrong.vault, []));
    const alreadyCreated = {
      resourceRef: {
        ...source().resourceRef,
        resourceId: packet.sourceId,
        incarnation: "inc_" + (await h.core.signingFingerprint(packet.command)).slice(0, 32),
      },
      sourceEpoch: 1,
    };
    await assert.rejects(
      client.discardSourceCreation(packet, current, [alreadyCreated]),
      /binding_mismatch/,
    );
    await assert.rejects(
      client.discardSourceCreation(
        packet,
        current,
        Array.from({ length: 11 }, (_, i) => ({
          resourceRef: { ...source().resourceRef, resourceId: "source_" + i },
          sourceEpoch: 1,
        })),
      ),
    );
    const key = f.owner + ":source-create:" + f.vault.vaultId,
      newer = await f.session.prepareSourceCreation("source_next");
    await store.put(key, { ownerSubject: f.owner, vaultId: f.vault.vaultId, pending: newer });
    await assert.rejects(client.discardSourceCreation(packet, current, []), /operation_conflict/);
    assert.deepEqual((await store.get(key)).pending, newer);
    await client.discardSourceCreation(newer, current, []);
    assert.equal(await store.get(key), null);
  }));
