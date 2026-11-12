const assert = require("node:assert/strict");
const test = require("node:test");
const fake = require("fake-indexeddb");
const { compile } = require("./resource-library-helpers.cjs");
const types = compile("../lib/encrypted-types.ts");
function fixture(t) {
  const { BrowserEncryptedStorage } = compile(
    "../lib/encrypted-storage.ts",
    { "./encrypted-types": types },
    { indexedDB: new fake.IDBFactory(), IDBKeyRange: fake.IDBKeyRange },
  );
  const storage = new BrowserEncryptedStorage();
  storage.setArchiveContext("owner_A", "credential_A", "salt_A", "iv_A");
  t.after(() => storage.close());
  const row = {
    ownerSubject: "owner_A",
    vaultId: "vault_A",
    connectionId: "connection_A",
    clientId: "client_A",
    kind: "publication",
    pending: {
      operationId: "synthetic_original_operation_0001",
      record: { iv: "SEALED_IV", ciphertext: "SEALED_ORIGINAL" },
    },
  };
  return {
    storage,
    row,
    key: "owner_A:persistent-owner:vault_A:connection_A",
    fingerprint: "a".repeat(64),
  };
}
test("superseded archive preserves encrypted bytes and atomically clears only the original", async (t) => {
  const { storage, row, key, fingerprint } = fixture(t);
  await storage.put(key, row);
  assert.equal(await storage.archivePersistentPublication(key, row, fingerprint), true);
  assert.equal(await storage.get(key), null);
  const archives = await storage.list("owner_A:persistent-superseded:");
  assert.equal(archives.length, 1);
  assert.deepEqual(archives[0].value, row);
  assert.ok(archives[0].key.endsWith(":" + fingerprint));
});
test("same operation ID with replacement ciphertext cannot be cleared or archived", async (t) => {
  const { storage, row, key, fingerprint } = fixture(t);
  const replacement = structuredClone(row);
  replacement.pending.record.ciphertext = "OTHER_TAB_CIPHERTEXT";
  await storage.put(key, replacement);
  assert.equal(await storage.archivePersistentPublication(key, row, fingerprint), false);
  assert.deepEqual(await storage.get(key), replacement);
  assert.equal((await storage.list("owner_A:persistent-superseded:")).length, 0);
});
test("archive conflicts and foreign bindings retain the sealed pending original", async (t) => {
  const { storage, row, key, fingerprint } = fixture(t);
  await storage.put(key, row);
  const archiveKey = `owner_A:persistent-superseded:vault_A:${row.pending.operationId}:${fingerprint}`;
  await storage.put(archiveKey, { ciphertext: "OTHER_ORIGINAL" });
  await assert.rejects(
    storage.archivePersistentPublication(key, row, fingerprint),
    /operation_conflict/,
  );
  for (const field of ["ownerSubject", "vaultId", "connectionId", "kind"])
    await assert.rejects(
      storage.archivePersistentPublication(key, { ...row, [field]: "foreign" }, fingerprint),
      /wrong_account/,
    );
  assert.deepEqual(await storage.get(key), row);
  assert.deepEqual(await storage.get(archiveKey), { ciphertext: "OTHER_ORIGINAL" });
});
test("lock while archiving aborts both archive insertion and pending removal", async (t) => {
  const { storage, row, key, fingerprint } = fixture(t);
  await storage.put(key, row);
  const controller = new AbortController(),
    put = fake.IDBObjectStore.prototype.put;
  fake.IDBObjectStore.prototype.put = function (value, target) {
    const request = put.call(this, value, target);
    if (target.includes(":persistent-superseded:")) controller.abort();
    return request;
  };
  try {
    await assert.rejects(
      storage.archivePersistentPublication(key, row, fingerprint, controller.signal),
      /locked/,
    );
  } finally {
    fake.IDBObjectStore.prototype.put = put;
  }
  assert.deepEqual(await storage.get(key), row);
  assert.equal((await storage.list("owner_A:persistent-superseded:")).length, 0);
});
