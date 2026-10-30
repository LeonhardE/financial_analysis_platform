const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync, existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");
const {
  createHarness,
  createOwner,
  importHoldings,
  createTask,
  fullFlow,
  decoded,
  clone,
} = require("./full-flow-crypto-fixture.cjs");
let h, bridge, storageModule, directory, workerCode, CoreError;
const clients = [];
test.before(async () => {
  h = await createHarness();
  try {
    new h.core.VaultCore("");
  } catch (error) {
    CoreError = error.constructor;
  }
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-device-management-"));
  await fs.symlink(
    path.resolve(__dirname, "../../../node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );
  for (const name of ["encrypted-types", "encrypted-storage", "encrypted-vault"]) {
    const file = path.resolve(__dirname, "../lib/" + name + ".ts");
    let { code } = transformSync(readFileSync(file, "utf8"), {
      filename: file,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "es6" },
    });
    code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, value) => `from "./${value}.mjs"`);
    await fs.writeFile(path.join(directory, name + ".mjs"), code);
  }
  bridge = await import(pathToFileURL(path.join(directory, "encrypted-vault.mjs")).href);
  storageModule = await import(pathToFileURL(path.join(directory, "encrypted-storage.mjs")).href);
  const file = path.resolve(__dirname, "../lib/encrypted-vault.worker.ts");
  workerCode = transformSync(readFileSync(file, "utf8"), {
    filename: file,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  }).code;
});
test.after(async () => {
  clients.forEach((client) => client.lock());
  if (h) await h.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

// Execute the actual serialized Worker dispatch with an explicit in-process Worker
// facade. This tests bridge/dispatch/crypto/storage, not native termination or WebAuthn.
class LocalWorker {
  constructor() {
    const owner = this;
    class TestClockCore extends h.core.VaultCore {
      constructor(uid) {
        super(uid, () => 1000);
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
        if (name === "./encrypted-core") return { VaultCore: TestClockCore };
        if (name === "./encrypted-types") return { VaultError: CoreError };
        assert.fail(name);
      },
      postMessage(value) {
        if (!owner.stopped) owner.onmessage({ data: structuredClone(value) });
      },
    };
    vm.runInNewContext(workerCode, this.realm);
  }
  postMessage(message, transfer = []) {
    const value = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (!this.stopped) this.realm.onmessage({ data: value });
    });
  }
  terminate() {
    this.stopped = true;
    this.realm = null;
  }
}
function published(f, packet) {
  return {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, packet.registryBundle],
  };
}
async function secondDevice(f) {
  const session = new h.core.VaultCore(f.uid, f.now);
  assert.equal((await session.unlock(f.vault, f.material())).needsDeviceRegistration, true);
  const registration = await session.prepareDeviceRegistration(f.vault);
  f.vault = published(f, registration);
  const local = await session.acceptVault(f.vault);
  f.local = await f.session.acceptVault(f.vault);
  return {
    session,
    local,
    deviceId: (await session.deviceManagement(f.vault)).summary.currentDeviceId,
  };
}
async function browser(f, storage, vault = f.vault, uid = f.uid) {
  const client = new bridge.EncryptedVaultSession(uid, {
    storage,
    workerFactory: () => new LocalWorker(),
  });
  clients.push(client);
  await client.unlock(vault, f.material());
  await client.acceptVault(vault);
  return client;
}
async function withStorage(action) {
  const fake = require("fake-indexeddb"),
    before = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    range = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: fake.IDBKeyRange });
  try {
    return await action(new storageModule.BrowserEncryptedStorage());
  } finally {
    if (before) Object.defineProperty(globalThis, "indexedDB", before);
    else delete globalThis.indexedDB;
    if (range) Object.defineProperty(globalThis, "IDBKeyRange", range);
    else delete globalThis.IDBKeyRange;
  }
}

test("verified device summaries and recovery proof expose public facts without exporting archive or device private keys", async () => {
  const f = await createOwner(h),
    other = await secondDevice(f);
  const { summary } = await f.session.deviceManagement(f.vault);
  assert.equal(summary.canManage, true);
  assert.equal(summary.devices.length, 2);
  assert.equal(summary.devices.filter((row) => row.current).length, 1);
  assert.equal(summary.devices.find((row) => row.deviceId === other.deviceId).active, true);
  assert.equal(summary.devices[0].expiresAt, 31537000);
  assert.equal(summary.recovery.active, true);
  assert.equal(summary.recovery.expiresAt, 31537000);
  const readOnly = new h.core.VaultCore(f.uid, f.now);
  assert.deepEqual(await readOnly.unlockForResults(f.vault, f.material()), {
    canWriteState: false,
  });
  const proof = await readOnly.verifyRecovery(f.vault);
  assert.equal(proof.rootKeyId, f.vault.rootKeyId);
  assert.equal(proof.registrySequence, 2);
  assert.equal(proof.recoveryKeyId.length, 43);
  assert.equal((await readOnly.deviceManagement(f.vault)).summary.canManage, false);
  await assert.rejects(
    readOnly.prepareDeviceChange({ vault: f.vault, action: "revoke", deviceId: other.deviceId }),
    /locked/,
  );
  for (const value of [summary, proof]) {
    assert.ok(!JSON.stringify(value).includes('"d":'));
    assert.ok(!JSON.stringify(value).includes("PrivateJwk"));
    assert.ok(!JSON.stringify(value).includes("ciphertext"));
  }
});

test("revoking another device changes only its key pair and requires a current active owner device", async () => {
  const flow = await fullFlow(h),
    f = flow.f,
    other = await secondDevice(f);
  const before = (await f.session.deviceManagement(f.vault)).summary;
  await assert.rejects(
    f.session.prepareDeviceChange({
      vault: f.vault,
      action: "revoke",
      deviceId: before.currentDeviceId,
    }),
    /device_unavailable/,
  );
  const packet = await f.session.prepareDeviceChange({
    vault: f.vault,
    action: "revoke",
    deviceId: other.deviceId,
  });
  assert.equal(packet.newDeviceId, null);
  assert.equal(packet.newKeyIds.length, 0);
  const cp = decoded(packet.registryBundle.checkpoint);
  assert.equal(cp.keyEpoch, decoded(f.vault.registryHistory.at(-1).checkpoint).keyEpoch);
  for (const row of f.vault.registryHistory
    .at(-1)
    .entries.filter((row) => decoded(row.certificate).role.startsWith("agent_")))
    assert.deepEqual(
      packet.registryBundle.entries.find(
        (next) => decoded(next.certificate).keyId === decoded(row.certificate).keyId,
      ),
      row,
    );
  f.vault = published(f, packet);
  const result = await f.session.acceptDeviceChange(f.vault, packet.localPending);
  assert.equal(result.summary.canManage, true);
  assert.equal(result.summary.devices.find((row) => row.deviceId === other.deviceId).active, false);
  await other.session.acceptResultVault(f.vault);
  assert.equal((await other.session.deviceManagement(f.vault)).summary.canManage, false);
  await assert.rejects(
    other.session.prepareDeviceChange({
      vault: f.vault,
      action: "rotate",
      deviceId: other.deviceId,
    }),
    /key_revoked/,
  );
  assert.deepEqual(await f.session.openResult(flow.result), flow.content);
  assert.equal(JSON.stringify(packet).includes("PrivateJwk"), false);
});

test("rotation keeps the original device until an exact accepted registry installs the sealed candidate and historical content remains readable", async () => {
  const flow = await fullFlow(h),
    f = flow.f;
  const before = (await f.session.deviceManagement(f.vault)).summary;
  const packet = await f.session.prepareDeviceChange({
    vault: f.vault,
    action: "rotate",
    deviceId: before.currentDeviceId,
  });
  assert.notEqual(packet.newDeviceId, before.currentDeviceId);
  assert.equal(
    (await f.session.deviceManagement(f.vault, packet.localPending)).summary.currentDeviceId,
    before.currentDeviceId,
  );
  await assert.rejects(
    f.session.acceptDeviceChange(f.vault, packet.localPending),
    /device_change_conflict/,
  );
  await assert.rejects(
    f.session.discardDeviceChange(f.vault, packet.localPending, packet.operationId),
    /device_change_pending/,
  );
  f.vault = published(f, packet);
  const result = await f.session.acceptDeviceChange(f.vault, packet.localPending);
  assert.equal(result.summary.currentDeviceId, packet.newDeviceId);
  assert.equal(
    result.summary.devices.find((row) => row.deviceId === before.currentDeviceId).active,
    false,
  );
  assert.equal(result.summary.canManage, true);
  const task = await createTask(h, f, { taskId: "task_after_rotation" });
  assert.ok(packet.newKeyIds.includes(task.pending.authorKeyId));
  const revisedTask = await createTask(h, f, {
    current: flow.task.task,
    content: { ...flow.task.content, goal: "Explicitly update after device rotation" },
  });
  assert.equal(revisedTask.task.metadata.taskVersion, 2);
  assert.ok(packet.newKeyIds.includes(revisedTask.pending.authorKeyId));
  assert.deepEqual(await f.session.openResult(flow.result), flow.content);
  assert.equal(
    (await f.session.openSnapshot(flow.holdings.response, flow.holdings.source)).data.accounts[0]
      .positions[0].quantity,
    "12.5",
  );
  await assert.rejects(
    flow.agent.call("registry", { bundles: f.vault.registryHistory }),
    /key_revoked|certificate_revoked|key_unavailable/,
  );
  assert.deepEqual(
    flow.agent.grant.writebackRecipientKeyIds,
    decoded(flow.agent.approval.signedGrants[0]).writebackRecipientKeyIds,
    "rotation never rewrites an existing agent grant",
  );
});

test("durable rotation uses exact signed bytes across lock, unknown save and relogin before clearing only the acknowledged candidate", async () =>
  withStorage(async (storage) => {
    const f = await createOwner(h);
    await storage.commitVault(f.owner, f.local);
    const a = await browser(f, storage),
      status = await a.deviceManagement(f.vault);
    const packet = await a.prepareDeviceChange({
      vault: f.vault,
      action: "rotate",
      deviceId: status.currentDeviceId,
    });
    const bytes = JSON.stringify(packet),
      key = f.owner + ":device-change:" + f.vault.vaultId;
    const row = await storage.get(key);
    assert.equal(row.pending.operationId, packet.operationId);
    assert.equal(JSON.stringify(row).includes(packet.newDeviceId), false);
    assert.equal(JSON.stringify(row).includes('"d":'), false);
    a.lock();
    await assert.rejects(a.discardDeviceChange(f.vault, packet.operationId), /locked/);
    assert.ok(await storage.get(key));
    const retry = await browser(f, storage);
    assert.equal(JSON.stringify(await retry.loadDeviceChange(f.vault)), bytes);
    assert.equal((await retry.deviceManagement(f.vault)).pendingChange.state, "ready");
    await assert.rejects(
      retry.discardDeviceChange(f.vault, packet.operationId),
      /device_change_pending/,
    );
    retry.lock();
    f.vault = published(f, packet);
    const relogin = await browser(f, storage);
    assert.equal((await relogin.deviceManagement(f.vault)).currentDeviceId, packet.newDeviceId);
    assert.equal((await relogin.deviceManagement(f.vault)).pendingChange.state, "applied");
    assert.equal(JSON.stringify(await relogin.loadDeviceChange(f.vault)), bytes);
    await relogin.acceptDeviceChange(f.vault);
    assert.equal(await storage.get(key), null);
    relogin.lock();
    const restored = await browser(f, storage);
    assert.equal((await restored.deviceManagement(f.vault)).currentDeviceId, packet.newDeviceId);
    assert.equal(await restored.loadDeviceChange(f.vault), null);
  }));

test("CAS preserves the first candidate across tabs, conflicting controls require a higher-version proof before discard", async () =>
  withStorage(async (storage) => {
    const f = await createOwner(h);
    await storage.commitVault(f.owner, f.local);
    const a = await browser(f, storage),
      b = await browser(f, storage),
      status = await a.deviceManagement(f.vault);
    const outcomes = await Promise.allSettled([
      a.prepareDeviceChange({ vault: f.vault, action: "rotate", deviceId: status.currentDeviceId }),
      b.prepareDeviceChange({ vault: f.vault, action: "rotate", deviceId: status.currentDeviceId }),
    ]);
    assert.equal(outcomes.filter((v) => v.status === "fulfilled").length, 1);
    const packet = await a.loadDeviceChange(f.vault),
      original = JSON.stringify(packet);
    assert.equal(JSON.stringify(await b.loadDeviceChange(f.vault)), original);
    await assert.rejects(
      a.discardDeviceChange(f.vault, packet.operationId),
      /device_change_pending/,
    );
    const newer = { ...f.vault, version: f.vault.version + 1 }; // An actual source-create may advance only the Vault version.
    assert.equal((await a.deviceManagement(newer)).pendingChange.state, "conflict");
    await assert.rejects(
      a.discardDeviceChange(newer, "wrong_operation_000000000"),
      /operation_conflict/,
    );
    await a.discardDeviceChange(newer, packet.operationId);
    assert.equal(await b.loadDeviceChange(newer), null);
    assert.equal((await a.deviceManagement(newer)).currentDeviceId, status.currentDeviceId);
  }));

test("a stale live tab cannot overwrite the accepted candidate during management or historical refresh", async () =>
  withStorage(async (storage) => {
    const f = await createOwner(h);
    await storage.commitVault(f.owner, f.local);
    const a = await browser(f, storage),
      b = await browser(f, storage);
    const original = await a.deviceManagement(f.vault);
    const packet = await a.prepareDeviceChange({
      vault: f.vault,
      action: "rotate",
      deviceId: original.currentDeviceId,
    });
    f.vault = published(f, packet);
    await a.acceptDeviceChange(f.vault);
    const key = f.owner + ":device:" + f.vault.vaultId;
    const promoted = await storage.get(key);
    const stale = await b.deviceManagement(f.vault);
    assert.equal(stale.canManage, false);
    assert.equal(stale.currentDeviceId, original.currentDeviceId);
    await b.acceptResultVault(f.vault);
    assert.deepEqual(await storage.get(key), promoted);
    a.lock();
    b.lock();
    const restarted = await browser(f, storage);
    assert.equal((await restarted.deviceManagement(f.vault)).currentDeviceId, packet.newDeviceId);
  }));

test("explicit candidate promotion rejects an unrelated concurrently stored device without deleting its recovery packet", async () =>
  withStorage(async (storage) => {
    const f = await createOwner(h),
      other = await secondDevice(f);
    await storage.commitVault(f.owner, f.local);
    const a = await browser(f, storage),
      original = await a.deviceManagement(f.vault);
    const packet = await a.prepareDeviceChange({
      vault: f.vault,
      action: "rotate",
      deviceId: original.currentDeviceId,
    });
    // Another acknowledged owner device has become this profile's stored device.
    await storage.commitVault(f.owner, other.local);
    f.vault = published(f, packet);
    await assert.rejects(a.acceptDeviceChange(f.vault), /operation_conflict/);
    const current = await storage.get(f.owner + ":device:" + f.vault.vaultId);
    assert.equal(current.device.deviceId, other.deviceId);
    assert.ok(await storage.get(f.owner + ":device-change:" + f.vault.vaultId));
  }));

test("a subsequently revoked accepted candidate can finish its exact acknowledgement only as a read-only device", async () =>
  withStorage(async (storage) => {
    const f = await createOwner(h),
      other = await secondDevice(f);
    await storage.commitVault(f.owner, f.local);
    const a = await browser(f, storage),
      original = await a.deviceManagement(f.vault);
    const rotation = await a.prepareDeviceChange({
      vault: f.vault,
      action: "rotate",
      deviceId: original.currentDeviceId,
    });
    f.vault = published(f, rotation);
    await other.session.acceptVault(f.vault);
    const revoke = await other.session.prepareDeviceChange({
      vault: f.vault,
      action: "revoke",
      deviceId: rotation.newDeviceId,
    });
    f.vault = published(f, revoke);
    a.lock();
    const reader = new bridge.EncryptedVaultSession(f.uid, {
      storage,
      workerFactory: () => new LocalWorker(),
    });
    clients.push(reader);
    assert.equal((await reader.unlockForResults(f.vault, f.material())).canWriteState, false);
    await reader.acceptResultVault(f.vault);
    assert.equal((await reader.deviceManagement(f.vault)).pendingChange.state, "applied");
    const completed = await reader.acceptDeviceChange(f.vault);
    assert.equal(completed.currentDeviceId, rotation.newDeviceId);
    assert.equal(completed.canManage, false);
    assert.equal(completed.devices.find((d) => d.deviceId === rotation.newDeviceId).active, false);
    assert.equal(await reader.loadDeviceChange(f.vault), null);
    await assert.rejects(
      reader.prepareDeviceChange({
        vault: f.vault,
        action: "rotate",
        deviceId: rotation.newDeviceId,
      }),
      /key_revoked/,
    );
    const device = await storage.get(f.owner + ":device:" + f.vault.vaultId);
    assert.equal(device.device.deviceId, rotation.newDeviceId);
  }));

test("holding the original Passkey permits only an explicit new device identity after revocation, never revival of its old pair", async () => {
  const flow = await fullFlow(h),
    f = flow.f,
    oldId = (await f.session.deviceManagement(f.vault)).summary.currentDeviceId;
  const other = await secondDevice(f);
  const removal = await other.session.prepareDeviceChange({
    vault: f.vault,
    action: "revoke",
    deviceId: oldId,
  });
  f.vault = published(f, removal);
  const recovery = new h.core.VaultCore(f.uid, f.now);
  assert.equal(
    (await recovery.unlockForResults(f.vault, f.material(), f.local)).canWriteState,
    false,
  );
  await recovery.acceptResultVault(f.vault);
  assert.deepEqual(await recovery.openResult(flow.result), flow.content);
  await assert.rejects(recovery.prepareDeviceRegistration(f.vault), /key_revoked/);
  const registration = await recovery.prepareDeviceRegistration(f.vault, { replaceInactive: true });
  const newId = decoded(registration.registryBundle.entries.at(-1).certificate).principalId;
  assert.notEqual(newId, oldId);
  assert.notEqual(newId, other.deviceId);
  for (const id of removal.replacedKeyIds)
    assert.ok(decoded(registration.registryBundle.checkpoint).revokedKeyIds.includes(id));
  f.vault = published(f, registration);
  await recovery.acceptVault(f.vault);
  const summary = (await recovery.deviceManagement(f.vault)).summary;
  assert.equal(summary.currentDeviceId, newId);
  assert.equal(summary.canManage, true);
  assert.equal(summary.devices.find((d) => d.deviceId === oldId).active, false);
  await assert.rejects(
    flow.agent.call("registry", { bundles: f.vault.registryHistory }),
    /key_revoked|certificate_revoked|key_unavailable/,
  );
  assert.deepEqual(await recovery.openResult(flow.result), flow.content);
});

test("read-only enrollment recovery preserves a staged registration's original keys and operation until explicit confirmation", async () =>
  withStorage(async (storage) => {
    const f = await createOwner(h);
    const initial = new bridge.EncryptedVaultSession(f.uid, {
      storage,
      workerFactory: () => new LocalWorker(),
    });
    clients.push(initial);
    assert.equal((await initial.unlockForResults(f.vault, f.material())).canWriteState, false);
    await initial.acceptResultVault(f.vault);
    const registration = await initial.prepareDeviceRegistration(f.vault, {
      replaceInactive: true,
    });
    initial.lock();
    const restored = new bridge.EncryptedVaultSession(f.uid, {
      storage,
      workerFactory: () => new LocalWorker(),
    });
    clients.push(restored);
    assert.equal((await restored.unlockForResults(f.vault, f.material())).canWriteState, false);
    await restored.acceptResultVault(f.vault);
    const retry = await restored.prepareDeviceRegistration(f.vault, { replaceInactive: true });
    assert.deepEqual(retry, registration);
    f.vault = published(f, registration);
    await assert.rejects(
      restored.prepareDeviceRegistration(f.vault, { replaceInactive: true }),
      /device_unavailable/,
    );
    await restored.acceptVault(f.vault);
    const summary = await restored.deviceManagement(f.vault);
    assert.equal(summary.canManage, true);
    await assert.rejects(
      restored.prepareDeviceRegistration(f.vault, { replaceInactive: true }),
      /device_unavailable/,
    );
    assert.equal(await storage.get(f.owner + ":pending-device:" + f.vault.vaultId), null);
  }));

test("new-device registration and device rotation contend for a single atomic enrollment slot across tabs", async () =>
  withStorage(async (storage) => {
    const f = await createOwner(h);
    await storage.commitVault(f.owner, f.local);
    const old = await browser(f, storage),
      original = await old.deviceManagement(f.vault);
    await storage.remove(f.owner + ":device:" + f.vault.vaultId);
    const fresh = new bridge.EncryptedVaultSession(f.uid, {
      storage,
      workerFactory: () => new LocalWorker(),
    });
    clients.push(fresh);
    await fresh.unlockForResults(f.vault, f.material());
    await fresh.acceptResultVault(f.vault);
    const outcomes = await Promise.allSettled([
      fresh.prepareDeviceRegistration(f.vault, { replaceInactive: true }),
      old.prepareDeviceChange({
        vault: f.vault,
        action: "rotate",
        deviceId: original.currentDeviceId,
      }),
    ]);
    assert.equal(outcomes.filter((v) => v.status === "fulfilled").length, 1);
    const registered = await storage.get(f.owner + ":pending-device:" + f.vault.vaultId);
    const changed = await storage.get(f.owner + ":device-change:" + f.vault.vaultId);
    assert.equal(Number(Boolean(registered)) + Number(Boolean(changed)), 1);
    if (changed)
      await assert.rejects(
        fresh.prepareDeviceRegistration(f.vault, { replaceInactive: true }),
        /device_change_pending/,
      );
  }));

test("cross-owner, modified ciphertext/AAD and replayed registry cannot turn a candidate into another user's device", async () => {
  const a = await createOwner(h),
    b = await createOwner(h, "synthetic_other_management_owner");
  const state = (await a.session.deviceManagement(a.vault)).summary;
  const packet = await a.session.prepareDeviceChange({
    vault: a.vault,
    action: "rotate",
    deviceId: state.currentDeviceId,
  });
  await assert.rejects(b.session.loadDeviceChange(b.vault, packet.localPending), /wrong_account/);
  for (const mutate of [
    (r) => {
      r.vaultId = b.vault.vaultId;
    },
    (r) => {
      r.profile = "folioview.passkey-vault.v1";
    },
    (r) => {
      r.ciphertext = "A".repeat(r.ciphertext.length);
    },
  ]) {
    const changed = clone(packet.localPending);
    mutate(changed);
    await assert.rejects(a.session.loadDeviceChange(a.vault, changed));
  }
  a.vault = published(a, packet);
  await a.session.acceptDeviceChange(a.vault, packet.localPending);
  const rollback = { ...a.vault, version: 1, registryHistory: a.vault.registryHistory.slice(0, 1) };
  await assert.rejects(a.session.deviceManagement(rollback), /rollback_detected/);
  await assert.rejects(new h.core.VaultCore(a.uid, a.now).unlock(a.vault, b.material(), a.local));
});

test("the recovery proof requires the original PRF and proves keys without registering a device or widening a grant", async () => {
  const flow = await fullFlow(h),
    original = h.core.canonical(flow.f.vault);
  const probe = new h.core.VaultCore(flow.f.uid, flow.f.now);
  await assert.rejects(probe.verifyRecovery(flow.f.vault), /locked/);
  const wrong = flow.f.material();
  wrong.secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
  await assert.rejects(probe.unlockForResults(flow.f.vault, wrong));
  await probe.unlockForResults(flow.f.vault, flow.f.material());
  const proof = await probe.verifyRecovery(flow.f.vault);
  assert.equal(proof.vaultId, flow.f.vault.vaultId);
  assert.equal((await probe.deviceManagement(flow.f.vault)).summary.currentDeviceId, null);
  assert.deepEqual(await probe.openResult(flow.result), flow.content);
  assert.equal(h.core.canonical(flow.f.vault), original);
  assert.equal(proof.verifiedAt, 1000);
});

test("expired credentials and the producer's finite directory history remain explicit failures rather than new implicit device registrations", async () => {
  const f = await createOwner(h),
    other = await secondDevice(f);
  for (let i = f.vault.registryHistory.length; i < 32; i++) {
    const bundle = await f.session.bundle(f.session.registry.bundle.entries, f.session.registry);
    f.vault = published(f, { registryBundle: bundle });
    f.local = await f.session.acceptVault(f.vault);
  }
  assert.equal((await f.session.deviceManagement(f.vault)).summary.registrySequence, 32);
  await assert.rejects(
    f.session.prepareDeviceChange({ vault: f.vault, action: "revoke", deviceId: other.deviceId }),
    /device_limit/,
  );
  const expired = await createOwner(h, "synthetic_expired_management_owner");
  const current = (await expired.session.deviceManagement(expired.vault)).summary.currentDeviceId;
  expired.time(31537001);
  const summary = (await expired.session.deviceManagement(expired.vault)).summary;
  assert.equal(summary.canManage, false);
  assert.equal(summary.devices[0].active, false);
  assert.equal(summary.recovery.active, false);
  assert.equal(summary.recovery.expiresAt, 31537000);
  await assert.rejects(
    expired.session.prepareDeviceChange({
      vault: expired.vault,
      action: "rotate",
      deviceId: current,
    }),
    /key_revoked/,
  );
  await assert.rejects(expired.session.verifyRecovery(expired.vault), /key_revoked/);
});

test("root-signed device rotation and revocation interoperate with the existing Python VaultService producer", async (t) => {
  const root = path.resolve(__dirname, "../../.."),
    python = path.join(root, "services/market-data-service/.venv/bin/python");
  if (!existsSync(python)) {
    t.skip("Declared shared Python environment unavailable");
    return;
  }
  const f = await createOwner(h),
    initial = clone(f.vault),
    other = await secondDevice(f);
  const registration = f.vault.registryHistory[1],
    status = (await f.session.deviceManagement(f.vault)).summary;
  const revoke = await f.session.prepareDeviceChange({
    vault: f.vault,
    action: "revoke",
    deviceId: other.deviceId,
  });
  f.vault = published(f, revoke);
  await f.session.acceptDeviceChange(f.vault, revoke.localPending);
  const rotate = await f.session.prepareDeviceChange({
    vault: f.vault,
    action: "rotate",
    deviceId: status.currentDeviceId,
  });
  const script = `import json,sys,tempfile\nfrom pathlib import Path\nfrom app.store import SQLiteHubStore\nfrom app.vaults import VaultService\nx=json.load(sys.stdin)\nwith tempfile.TemporaryDirectory(prefix='folioview-device-management-') as directory:\n s=VaultService(SQLiteHubStore(Path(directory)/'synthetic.sqlite3'),clock=lambda:1000)\n v=x['initial'];s.bootstrap(x['uid'],dict(contractVersion='folioview.agent-workspace.v2.0',vaultId=v['vaultId'],rootJwk=v['rootJwk'],rootKeyId=v['rootKeyId'],registryBundle=v['registryHistory'][0],archive=v['archive']),'synthetic_management_bootstrap_001')\n s.update_registry(x['uid'],v['vaultId'],dict(contractVersion='folioview.agent-workspace.v2.0',expectedVersion=1,registryBundle=x['registration']),'synthetic_management_register_002')\n for p in [x['revoke'],x['rotate']]:\n  body=dict(contractVersion='folioview.agent-workspace.v2.0',expectedVersion=p['expectedVersion'],registryBundle=p['registryBundle']);s.update_registry(x['uid'],v['vaultId'],body,p['operationId']);s.update_registry(x['uid'],v['vaultId'],body,p['operationId'])\n print('verified')`;
  const result = spawnSync(python, ["-c", script], {
    input: JSON.stringify({ uid: f.uid, initial, registration, revoke, rotate }),
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH:
        path.join(root, "services/agent-hub-service") +
        path.delimiter +
        path.join(root, "services/common"),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified/);
});
