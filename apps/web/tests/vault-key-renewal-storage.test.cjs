const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");
const { createHarness, createOwner, importHoldings } = require("./full-flow-crypto-fixture.cjs");
const {
  lifecycleState,
  renewalAccepted,
  archiveAccepted,
} = require("./vault-key-renewal-fixture.cjs");
let h,
  bridge,
  storageModule,
  directory,
  workerCode,
  CoreError,
  clock = 1000;
const clients = [];
test.before(async () => {
  h = await createHarness();
  try {
    new h.core.VaultCore("");
  } catch (e) {
    CoreError = e.constructor;
  }
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-renewal-storage-"));
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
    code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, n) => `from "./${n}.mjs"`);
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
  clients.forEach((c) => c.lock());
  await h?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
// Execute production Worker dispatch and cryptography, with a transfer-aware in-process facade.
// Native WebAuthn and OS termination are deliberately outside this synthetic fixture.
class LocalWorker {
  constructor() {
    const owner = this;
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
      require(n) {
        if (n === "./encrypted-core") return { VaultCore: ClockCore };
        if (n === "./encrypted-types") return { VaultError: CoreError };
        assert.fail(n);
      },
      postMessage(value) {
        if (!owner.stopped) owner.onmessage({ data: structuredClone(value) });
      },
    };
    vm.runInNewContext(workerCode, this.realm);
  }
  postMessage(message, transfer = []) {
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
  const fake = require("fake-indexeddb"),
    previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
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
    for (const [key, desc] of [
      ["indexedDB", previous],
      ["IDBKeyRange", range],
    ])
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
  }
}
function context(store, f, vault = f.vault) {
  store.setArchiveContext(
    f.owner,
    vault.archive.credentialId,
    vault.archive.prfSalt,
    vault.archive.iv,
  );
}
async function seeded(f) {
  f.time(2000);
  clock = 2000;
  const store = new storageModule.BrowserEncryptedStorage(),
    state = await lifecycleState(h, f);
  context(store, f);
  await store.commitVault(f.owner, f.local);
  await store.commitLifecycle(
    f.owner,
    await f.session.verifyLifecycle(f.vault, state),
    f.vault.archive,
  );
  return { store, state };
}
function browser(f, store) {
  const c = new bridge.EncryptedVaultSession(f.uid, {
    storage: store,
    workerFactory: () => new LocalWorker(),
  });
  clients.push(c);
  return c;
}
async function renewal(f, store, state) {
  const c = browser(f, store);
  await c.unlockForKeyRenewal(f.vault, f.material());
  assert.equal((await c.inspectKeyRenewal(f.vault, state)).canRenew, true);
  return { client: c, packet: await c.prepareKeyRenewal(f.vault, state) };
}
function ciphertextOnly(row) {
  const text = JSON.stringify(row);
  for (const secret of ["PrivateJwk", '"d":', "SYNTH_PRIVATE_ACCOUNT", "PRIVATE_SYNTHETIC_TFSA"])
    assert(!text.includes(secret), secret);
}

test("actual Worker bridge persists only sealed candidate, resumes exact operation after lock and promotes atomically before relogin", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      holdings = await importHoldings(h, f),
      { store, state } = await seeded(f);
    const { client, packet } = await renewal(f, store, state);
    const row = await store.get(f.owner + ":key-renewal");
    ciphertextOnly(row);
    assert.equal(row.operationId, packet.operationId);
    await assert.rejects(
      client.openSnapshot(holdings.response, holdings.source),
      /key_renewal_pending/,
    );
    client.lock();
    const resumed = browser(f, store);
    await assert.rejects(resumed.unlock(f.vault, f.material()), /key_renewal_pending/);
    await resumed.unlockForKeyRenewal(f.vault, f.material());
    assert.deepEqual((await resumed.getKeyRenewal(f.vault, state)).packet, packet);
    const saved = await renewalAccepted(h, f.vault, state, packet, clock);
    await resumed.finishKeyRenewal(saved.vault, saved.state, saved.receipt, packet.operationId);
    assert.equal(await store.get(f.owner + ":key-renewal"), null);
    assert.equal((await store.get(f.owner + ":pin")).registrySequence, 2);
    assert.equal((await store.get(f.owner + ":lifecycle")).archiveRevision, 1);
    await assert.rejects(resumed.inspectKeyRenewal(saved.vault, saved.state), /locked/);
    const reopened = browser(f, store);
    await reopened.unlock(saved.vault, f.material());
    await reopened.acceptVault(saved.vault);
    assert.equal(
      (await reopened.openSnapshot(holdings.response, holdings.source)).data.accounts[0]
        .positions[0].quantity,
      "12.5",
    );
    ciphertextOnly(await store.list(f.owner + ":"));
  }));

test("two tabs race candidate staging with one winner and cannot replace each other's sealed operation", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      { store, state } = await seeded(f),
      other = new storageModule.BrowserEncryptedStorage();
    context(other, f);
    const a = browser(f, store),
      b = browser(f, other);
    await a.unlockForKeyRenewal(f.vault, f.material());
    await b.unlockForKeyRenewal(f.vault, f.material());
    const answers = await Promise.allSettled([
      a.prepareKeyRenewal(f.vault, state),
      b.prepareKeyRenewal(f.vault, state),
    ]);
    assert.equal(answers.filter((x) => x.status === "fulfilled").length, 1);
    assert.match(answers.find((x) => x.status === "rejected").reason.code, /key_renewal_pending/);
    const winner = answers.find((x) => x.status === "fulfilled").value;
    assert.equal((await store.get(f.owner + ":key-renewal")).operationId, winner.operationId);
    await assert.rejects(
      other.put(f.owner + ":task-draft:vault:new", { revision: 1 }),
      /key_renewal_pending/,
    );
    await assert.rejects(
      other.stageArchiveChange(f.owner, { ownerSubject: f.owner }),
      /key_renewal_pending/,
    );
  }));

test("cancel uses a competing signed archive fence; ready candidate cannot be deleted and retries reuse the cancellation", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      { store, state } = await seeded(f),
      { client, packet } = await renewal(f, store, state);
    await assert.rejects(
      client.discardKeyRenewal(f.vault, state, packet.operationId),
      /key_renewal_unknown/,
    );
    const resumed = browser(f, store);
    await resumed.unlockForKeyRenewal(f.vault, f.material());
    const cancel = await resumed.prepareKeyRenewalCancellation(f.vault, state);
    assert.deepEqual(await resumed.prepareKeyRenewalCancellation(f.vault, state), cancel);
    assert.deepEqual((await resumed.getKeyRenewal(f.vault, state)).cancellation, cancel);
    const saved = await archiveAccepted(h, f.vault, state, cancel, clock);
    await resumed.discardKeyRenewal(saved.vault, saved.state, packet.operationId);
    assert.equal(await store.get(f.owner + ":key-renewal"), null);
    assert.equal((await store.get(f.owner + ":lifecycle")).archiveRevision, 1);
    const reopened = browser(f, store);
    await reopened.unlock(saved.vault, f.material());
    await reopened.acceptVault(saved.vault);
  }));

test("same credential and PRF salt still fence an older tab after archive IV advances", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      { store, state } = await seeded(f),
      old = new storageModule.BrowserEncryptedStorage();
    context(old, f);
    const { client, packet } = await renewal(f, store, state),
      saved = await renewalAccepted(h, f.vault, state, packet, clock);
    await client.finishKeyRenewal(saved.vault, saved.state, saved.receipt, packet.operationId);
    await assert.rejects(
      old.put(f.owner + ":task-draft:vault:new", { revision: 1 }),
      /archive_session_stale/,
    );
    await assert.rejects(
      old.stageKeyRenewal(f.owner, { ownerSubject: f.owner, operationId: "other", pending: {} }),
      /archive_session_stale/,
    );
    context(old, f, saved.vault);
    await old.put(f.owner + ":task-draft:vault:new", { revision: 1 });
  }));

test("renewal blocks unresolved uploads and authority candidates, retains draft and other users' records", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      { store, state } = await seeded(f);
    const worker = new h.core.VaultCore(f.uid, f.now);
    await worker.unlockForKeyRenewal(f.vault, f.material(), {
      pin: f.local.pin,
      device: f.local.device,
    });
    const candidate = await worker.prepareKeyRenewal(f.vault, state),
      row = {
        ownerSubject: f.owner,
        vaultId: f.vault.vaultId,
        operationId: candidate.packet.operationId,
        pending: candidate.record,
      };
    for (const suffix of [
      ":outbox:holdings",
      ":task-outbox:vault:task",
      ":pending-device:vault",
      ":device-change:vault",
      ":agent-registration:vault:agent",
    ]) {
      const key = f.owner + suffix;
      await store.put(key, { ownerSubject: f.owner, encrypted: "retained" });
      await assert.rejects(store.stageKeyRenewal(f.owner, row), /key_renewal_local_pending/);
      assert.equal((await store.get(key)).encrypted, "retained");
      await store.remove(key);
    }
    await store.put(f.owner + ":task-draft:vault:new", { encrypted: "draft" });
    await store.put("other-owner:outbox:holdings", { encrypted: "other" });
    assert(await store.stageKeyRenewal(f.owner, row));
    assert.equal((await store.get(f.owner + ":task-draft:vault:new")).encrypted, "draft");
    assert.equal((await store.get("other-owner:outbox:holdings")).encrypted, "other");
    const other = await createOwner(h, "another-archive-owner"),
      seed = await seeded(other);
    await seed.store.put(other.owner + ":archive-change", {
      ownerSubject: other.owner,
      encrypted: "preserve",
    });
    await assert.rejects(
      seed.store.stageKeyRenewal(other.owner, {
        ...row,
        ownerSubject: other.owner,
        vaultId: other.vault.vaultId,
      }),
      /key_renewal_local_pending/,
    );
  }));

test("pending compare-and-swap and wrong-owner finish failures leave all pins, ciphertext and device unchanged", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      { store, state } = await seeded(f),
      { packet } = await renewal(f, store, state);
    const row = await store.get(f.owner + ":key-renewal"),
      before = await store.list(f.owner + ":");
    await assert.rejects(
      store.updateKeyRenewal(
        f.owner,
        { ...row, pending: { changed: true } },
        { ...row, operationId: "stale" },
      ),
      /operation_conflict/,
    );
    const pin = await store.get(f.owner + ":lifecycle");
    await assert.rejects(
      store.finishKeyRenewal("other-owner", pin, f.vault.archive, f.local, row),
      /operation_conflict/,
    );
    assert.deepEqual(await store.list(f.owner + ":"), before);
    assert.equal((await store.get(f.owner + ":key-renewal")).operationId, packet.operationId);
  }));

test(
  "lock during pending persistence rejects late return but retains only encrypted original operation for later recovery",
  { timeout: 10000 },
  async () =>
    withStorage(async () => {
      const f = await createOwner(h),
        { store, state } = await seeded(f),
        original = store.stageKeyRenewal.bind(store);
      let entered, release;
      const ready = new Promise((r) => (entered = r)),
        gate = new Promise((r) => (release = r));
      store.stageKeyRenewal = async (owner, row) => {
        entered();
        await gate;
        return original(owner, row);
      };
      const client = browser(f, store);
      await client.unlockForKeyRenewal(f.vault, f.material());
      const pending = client.prepareKeyRenewal(f.vault, state);
      await ready;
      client.lock();
      release();
      await assert.rejects(pending, /locked/);
      const row = await store.get(f.owner + ":key-renewal");
      ciphertextOnly(row);
      const resumed = browser(f, store);
      await resumed.unlockForKeyRenewal(f.vault, f.material());
      assert.equal(
        (await resumed.getKeyRenewal(f.vault, state)).packet.operationId,
        row.operationId,
      );
    }),
);

test("expired registered device can enter bridge renewal-only mode and cannot restore ordinary API until committed and unlocked", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      { store, state } = await seeded(f);
    clock = 31537001;
    f.time(clock);
    const { client, packet } = await renewal(f, store, state);
    await assert.rejects(client.signSource("source_synthetic"), /key_renewal_pending/);
    const saved = await renewalAccepted(h, f.vault, state, packet, clock);
    await client.finishKeyRenewal(saved.vault, saved.state, saved.receipt, packet.operationId);
    const fresh = browser(f, store);
    await fresh.unlock(saved.vault, f.material());
    await fresh.acceptVault(saved.vault);
    assert.equal(
      (await fresh.signSource("source_synthetic")).authorKeyId,
      JSON.parse(Buffer.from(packet.body.command.payload, "base64url")).renewals.find(
        (t) => t.role === "device_sig",
      ).newKeyId,
    );
  }));

test("renewal-only verified reads durably advance registry and lifecycle pins together without promoting a device", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      { store } = await seeded(f),
      oldVault = f.vault;
    const second = new h.core.VaultCore(f.uid, f.now);
    await second.unlock(f.vault, f.material());
    const registration = await second.prepareDeviceRegistration(f.vault);
    const current = {
      ...f.vault,
      registryHistory: [...f.vault.registryHistory, registration.registryBundle],
      version: f.vault.version + 1,
    };
    const state = await lifecycleState(h, { ...f, vault: current });
    const client = browser(f, store);
    await client.unlockForKeyRenewal(current, f.material());
    await client.inspectKeyRenewal(current, state);
    assert.equal((await store.get(f.owner + ":pin")).registrySequence, 2);
    assert.equal(
      (await store.get(f.owner + ":device:" + current.vaultId)).device.signingKeyId,
      f.local.device.signingKeyId,
    );
    const before = await store.list(f.owner + ":");
    const life = await store.get(f.owner + ":lifecycle");
    await assert.rejects(
      store.commitLifecycle(
        f.owner,
        { ...life, lifecycleVersion: 1, archiveRevision: 1, fingerprints: ["concurrent"] },
        current.archive,
        { pin: f.local.pin, history: f.local.history },
      ),
      /rollback_detected/,
    );
    assert.deepEqual(await store.list(f.owner + ":"), before);
    await assert.rejects(
      client.inspectKeyRenewal(oldVault, await lifecycleState(h, f)),
      /rollback_detected/,
    );
    client.lock();
    const again = browser(f, store);
    await assert.rejects(again.unlockForKeyRenewal(oldVault, f.material()), /rollback_detected/);
    assert.deepEqual(await store.list(f.owner + ":"), before);
  }));
