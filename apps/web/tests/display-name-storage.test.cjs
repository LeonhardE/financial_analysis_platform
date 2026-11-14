const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  os = require("node:os"),
  vm = require("node:vm"),
  fs = require("node:fs/promises"),
  { readFileSync } = require("node:fs"),
  { pathToFileURL } = require("node:url"),
  { transformSync } = require("next/dist/build/swc"),
  { createHash } = require("node:crypto");
const { createHarness, bindings, decoded } = require("./full-flow-crypto-fixture.cjs"),
  { compileVaultWorker } = require("./worker-dispatch-helpers.cjs");
test("actual Worker and IndexedDB keep exactly one sealed original name operation across tabs/lock, before any transport", async () => {
  const h = await createHarness(),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "fv-name-storage-"));
  const beforeIDB = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    beforeRange = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange"),
    fake = require("fake-indexeddb"),
    sessions = [];
  let storage;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: fake.IDBKeyRange });
  try {
    for (const name of ["encrypted-types", "encrypted-storage", "encrypted-vault"]) {
      const filename = path.resolve(__dirname, "../lib/" + name + ".ts");
      let { code } = transformSync(readFileSync(filename, "utf8"), {
        filename,
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "es6" },
      });
      code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, n) => `from "./${n}.mjs"`);
      await fs.writeFile(path.join(dir, name + ".mjs"), code);
    }
    const { EncryptedVaultSession } = await import(
        pathToFileURL(path.join(dir, "encrypted-vault.mjs")).href
      ),
      { BrowserEncryptedStorage } = await import(
        pathToFileURL(path.join(dir, "encrypted-storage.mjs")).href
      ),
      code = compileVaultWorker();
    let CoreError;
    try {
      new h.core.VaultCore("");
    } catch (e) {
      CoreError = e.constructor;
    }
    class LocalWorker {
      constructor() {
        const worker = this;
        class ClockCore extends h.core.VaultCore {
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
            if (name === "./encrypted-core") return { VaultCore: ClockCore };
            if (name === "./encrypted-types") return { VaultError: CoreError };
            assert.fail(name);
          },
          postMessage(value) {
            if (!worker.stopped) worker.onmessage({ data: structuredClone(value) });
          },
        };
        vm.runInNewContext(code, this.realm);
      }
      postMessage(value, transfer = []) {
        const copied = structuredClone(value, { transfer });
        queueMicrotask(() => {
          if (!this.stopped) this.realm.onmessage({ data: copied });
        });
      }
      terminate() {
        this.stopped = true;
        this.realm = null;
      }
    }
    storage = new BrowserEncryptedStorage();
    const make = () => {
      const s = new EncryptedVaultSession("synthetic_name_owner", {
        storage,
        workerFactory: () => new LocalWorker(),
      });
      sessions.push(s);
      return s;
    };
    const a = make(),
      secret = crypto.getRandomValues(new Uint8Array(32)),
      salt = h.core.b64(crypto.getRandomValues(new Uint8Array(32))),
      material = () => ({
        credentialId: h.core.b64(new TextEncoder().encode("synthetic-name-credential")),
        prfSalt: salt,
        secret: secret.slice().buffer,
      });
    await a.prepareCreate();
    const created = await a.beginCreate(material());
    const vault = {
      vaultId: created.vaultId,
      rootJwk: created.rootJwk,
      rootKeyId: created.rootKeyId,
      registryHistory: [created.registryBundle],
      archive: created.archive,
      version: 1,
    };
    await a.acceptVault(vault);
    const ref = bindings()[0].ref,
      name = "PRIVATE_NAME_CANARY",
      packet = await a.prepareDisplayName({ ref, item: null, name });
    const rows = await storage.list(a.owner + ":display-name:");
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes(name));
    assert.ok(!JSON.stringify(rows).includes('"d":'));
    await assert.rejects(a.prepareDisplayName({ ref, item: null, name: "Replacement" }));
    a.lock();
    const b = make();
    await b.unlockForResults(vault, material());
    assert.deepEqual(await b.loadDisplayNamePending({ ...ref }), packet);
    const p = decoded(packet.body.command),
      state = Object.fromEntries(
        [
          "contractVersion",
          "profile",
          "ownerSubject",
          "vaultId",
          "rootKeyId",
          "ref",
          "revision",
          "stableOperationId",
          "recipientKeyId",
        ].map((k) => [k, p[k]]),
      );
    state.operationFingerprint = createHash("sha256")
      .update(packet.body.command.protected + "." + packet.body.command.payload)
      .digest("hex");
    state.acceptedAt = 1000;
    const receipt = {
        contractVersion: p.contractVersion,
        profile: p.profile,
        item: { state, command: packet.body.command },
      },
      bad = structuredClone(receipt);
    bad.item.state.stableOperationId = "other_operation_00000000000";
    await assert.rejects(b.finishDisplayNamePending(ref, bad));
    assert.ok(await b.loadDisplayNamePending(ref));
    assert.equal((await b.finishDisplayNamePending(ref, receipt)).name, name);
    assert.equal(await b.loadDisplayNamePending(ref), null);
    await b.unlock(vault, material());
    const next = await b.prepareDisplayName({ ref, item: receipt.item, name: "Unsaved synthetic" });
    await assert.rejects(b.discardDisplayNamePending(ref, "foreign_operation_000000000"));
    assert.ok(await b.loadDisplayNamePending(ref));
    await b.discardDisplayNamePending(ref, next.operationId);
    assert.equal(await b.loadDisplayNamePending(ref), null);
    await assert.rejects(b.finishDisplayNamePending(ref, receipt));
  } finally {
    for (const s of sessions) s.lock();
    if (storage) await storage.close();
    if (beforeIDB) Object.defineProperty(globalThis, "indexedDB", beforeIDB);
    else delete globalThis.indexedDB;
    if (beforeRange) Object.defineProperty(globalThis, "IDBKeyRange", beforeRange);
    else delete globalThis.IDBKeyRange;
    await fs.rm(dir, { recursive: true, force: true });
    await h.close();
  }
});
