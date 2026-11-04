// Production Worker dispatch and IndexedDB with synthetic clocks/keys, no native credentials or network.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { transformSync } = require("next/dist/build/swc");
const { createHarness } = require("./full-flow-crypto-fixture.cjs");

async function createBrowserFixture() {
  const h = await createHarness(),
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-deletion-browser-"));
  let clock = 1000,
    CoreError;
  try {
    new h.core.VaultCore("");
  } catch (e) {
    CoreError = e.constructor;
  }
  for (const name of ["encrypted-types", "encrypted-storage", "encrypted-vault"]) {
    const filename = path.resolve(__dirname, "../lib/" + name + ".ts");
    let { code } = transformSync(readFileSync(filename, "utf8"), {
      filename,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "es6" },
    });
    code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, value) => `from "./${value}.mjs"`);
    await fs.writeFile(path.join(directory, name + ".mjs"), code);
  }
  const bridge = await import(pathToFileURL(path.join(directory, "encrypted-vault.mjs")).href);
  const storage = await import(pathToFileURL(path.join(directory, "encrypted-storage.mjs")).href);
  const filename = path.resolve(__dirname, "../lib/encrypted-vault.worker.ts");
  const workerCode = transformSync(readFileSync(filename, "utf8"), {
    filename,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  }).code;
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
        require(name) {
          if (name === "./encrypted-core") return { VaultCore: ClockCore };
          if (name === "./encrypted-types") return { VaultError: CoreError };
          assert.fail(name);
        },
        postMessage(value) {
          if (!owner.stopped) owner.onmessage({ data: structuredClone(value) });
        },
      };
      vm.runInNewContext(workerCode, this.realm);
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
  return {
    h,
    bridge,
    storage,
    time(value) {
      clock = value;
    },
    async withDatabase(action) {
      const fake = require("fake-indexeddb"),
        previous = new Map();
      const clients = [],
        stores = [];
      for (const [key, value] of [
        ["indexedDB", new fake.IDBFactory()],
        ["IDBKeyRange", fake.IDBKeyRange],
      ]) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, value });
      }
      clock = 1000;
      try {
        return await action({
          store() {
            const value = new storage.BrowserEncryptedStorage();
            stores.push(value);
            return value;
          },
          client(uid, store) {
            const value = new bridge.EncryptedVaultSession(uid, {
              storage: store,
              workerFactory: () => new LocalWorker(),
            });
            clients.push(value);
            return value;
          },
        });
      } finally {
        clients.forEach((value) => value.lock());
        await Promise.all(stores.map((value) => value.close()));
        for (const [key, descriptor] of previous) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else delete globalThis[key];
        }
      }
    },
    async close() {
      await h.close();
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}
module.exports = { createBrowserFixture };
