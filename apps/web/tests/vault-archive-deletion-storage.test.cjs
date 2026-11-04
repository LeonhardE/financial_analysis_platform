const assert = require("node:assert/strict");
const test = require("node:test");
const { createBrowserFixture } = require("./vault-browser-fixture.cjs");
const { createOwner, clone } = require("./full-flow-crypto-fixture.cjs");
const { actualHub, action } = require("./vault-renewal-hub-fixture.cjs");
let b;
test.before(async () => {
  b = await createBrowserFixture();
});
test.after(async () => {
  await b?.close();
});
async function seed(t, database) {
  const f = await createOwner(b.h),
    initial = actualHub(t, b.h, f);
  if (!initial) return null;
  const store = database.store();
  await store.commitVault(f.owner, f.local);
  await store.commitLifecycle(
    f.owner,
    await f.session.verifyLifecycle(f.vault, initial.state),
    f.vault.archive,
  );
  const client = database.client(f.uid, store);
  await client.unlock(f.vault, f.material());
  await client.verifyLifecycle(f.vault, initial.state);
  return { f, store, client, state: initial.state };
}

test("real Worker/IndexedDB retain unknown deletion across reload and only clear it after signed accepted proof", async (t) => {
  await b.withDatabase(async (db) => {
    const setup = await seed(t, db);
    if (!setup) return;
    const { f, store, client, state } = setup;
    const device = await store.get(f.owner + ":device:" + f.vault.vaultId);
    const packet = await client.prepareArchiveDeletion(f.vault, state);
    const record = await store.get(f.owner + ":archive-change");
    assert.deepEqual(record.packet, packet);
    assert.equal(await b.bridge.EncryptedVaultSession.hasArchiveDeletion(f.uid), true);
    assert.equal(await b.bridge.EncryptedVaultSession.hasArchiveDeletion("another_owner"), false);
    assert(!JSON.stringify(record).includes(f.vault.archive.ciphertext));
    client.lock();
    const resumed = db.client(f.uid, store);
    assert.equal((await resumed.inspectArchiveDeletion(f.vault, state)).outcome, "unresolved");
    await assert.rejects(
      resumed.finishArchiveDeletion(f.vault, state),
      (e) => e.code === "archive_deletion_unknown",
    );
    assert.deepEqual(await store.get(f.owner + ":archive-change"), record);
    const accepted = actualHub(t, b.h, f, [action("archive_delete", packet, 1000)]);
    assert.equal(
      (await resumed.inspectArchiveDeletion(accepted.vault, accepted.state)).outcome,
      "deleted",
    );
    assert.equal(await resumed.finishArchiveDeletion(accepted.vault, accepted.state), "deleted");
    assert.equal(await b.bridge.EncryptedVaultSession.hasArchiveDeletion(f.uid), false);
    assert.equal(await store.get(f.owner + ":archive-change"), null);
    assert.deepEqual(await store.get(f.owner + ":device:" + f.vault.vaultId), device);
    await assert.rejects(
      store.insert(f.owner + ":task-outbox:late", { synthetic: true }),
      (e) => e.code === "archive_session_stale",
    );
  });
});

test("withdrawal command is durable before HTTP; loss and restart recover one original withdrawal and keep old device keys", async (t) => {
  await b.withDatabase(async (db) => {
    const setup = await seed(t, db);
    if (!setup) return;
    const { f, store, client, state } = setup;
    const deletion = await client.prepareArchiveDeletion(f.vault, state);
    client.lock();
    const resumed = db.client(f.uid, store);
    await resumed.unlockForArchiveDeletion(f.vault, f.material());
    const withdrawal = await resumed.prepareArchiveWithdrawal(f.vault, state);
    const retained = await store.get(f.owner + ":archive-change");
    assert.deepEqual(retained.withdrawal, withdrawal);
    assert.deepEqual(withdrawal.body.deletionCommand, deletion.body.command);
    assert.deepEqual(await resumed.prepareArchiveWithdrawal(f.vault, state), withdrawal);
    resumed.lock();
    const accepted = actualHub(t, b.h, f, [action("archive_delete_withdraw", withdrawal, 1000)]);
    const reader = db.client(f.uid, store);
    assert.equal(
      (await reader.inspectArchiveDeletion(accepted.vault, accepted.state)).outcome,
      "withdrawn",
    );
    assert.equal(await reader.finishArchiveDeletion(accepted.vault, accepted.state), "withdrawn");
    reader.lock();
    const normal = db.client(f.uid, store);
    assert.equal(
      (await normal.unlock(accepted.vault, f.material())).needsDeviceRegistration,
      false,
    );
  });
});

test("atomic staging refuses unresolved uploads/drafts and preserves unrelated other-vault bootstrap", async (t) => {
  await b.withDatabase(async (db) => {
    const setup = await seed(t, db);
    if (!setup) return;
    const { f, store, client, state } = setup;
    client.lock();
    for (const suffix of [
      ":task-outbox:one",
      ":outbox:one",
      ":task-draft:one",
      ":upload-cancellation:one",
      ":source-create:one",
      ":source-mutation:one",
    ]) {
      const key = f.owner + suffix,
        pending = { ownerSubject: f.owner, synthetic: true };
      await store.put(key, pending);
      const actor = db.client(f.uid, store);
      await actor.unlock(f.vault, f.material());
      await assert.rejects(
        actor.prepareArchiveDeletion(f.vault, state),
        (e) => e.code === "archive_local_pending",
      );
      assert.deepEqual(await store.get(key), pending);
      assert.equal(await store.get(f.owner + ":archive-change"), null);
      await store.remove(key);
    }
    const key = f.owner + ":pending-device:other",
      pending = {
        ownerSubject: f.owner,
        pending: {
          ownerSubject: f.owner,
          profile: "folioview.pending-device.v1",
          kind: "bootstrap",
          vaultId: "other_vault",
        },
      };
    await store.put(key, pending);
    const actor = db.client(f.uid, store);
    await actor.unlock(f.vault, f.material());
    await actor.prepareArchiveDeletion(f.vault, state);
    assert.deepEqual(await store.get(key), pending);
  });
});

test("two tabs cannot stage different deletions; a pending deletion blocks ordinary Worker methods and late writes", async (t) => {
  await b.withDatabase(async (db) => {
    const setup = await seed(t, db);
    if (!setup) return;
    const { f, store, client, state } = setup;
    const other = db.client(f.uid, store);
    await other.unlock(f.vault, f.material());
    const results = await Promise.allSettled([
      client.prepareArchiveDeletion(f.vault, state),
      other.prepareArchiveDeletion(f.vault, state),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const winner = results.find((r) => r.status === "fulfilled").value;
    assert.deepEqual((await store.get(f.owner + ":archive-change")).packet, winner);
    await assert.rejects(
      store.put(f.owner + ":task-draft:late", { synthetic: true }),
      (e) => e.code === "archive_change_pending",
    );
    const alive = results[0].status === "fulfilled" ? client : other;
    await assert.rejects(
      alive.deviceManagement(f.vault),
      (e) => e.code === "archive_deletion_pending",
    );
  });
});

test("cleanup uses exact record CAS and cannot erase another tab's newly retained withdrawal", async (t) => {
  await b.withDatabase(async (db) => {
    const setup = await seed(t, db);
    if (!setup) return;
    const { f, store, client, state } = setup;
    const packet = await client.prepareArchiveDeletion(f.vault, state);
    const old = await store.get(f.owner + ":archive-change");
    const core = new b.h.core.VaultCore(f.uid, f.now);
    await core.unlockForArchiveDeletion(f.vault, f.material(), f.local.pin);
    const changed = await core.prepareArchiveWithdrawal(f.vault, state, old);
    const accepted = actualHub(t, b.h, f, [action("archive_delete", packet, 1000)]);
    const originalFinish = store.finishArchiveDeletion.bind(store);
    store.finishArchiveDeletion = async (...args) => {
      await store.updateArchiveChange(f.owner, clone(changed.record), old);
      return originalFinish(...args);
    };
    await assert.rejects(
      client.finishArchiveDeletion(accepted.vault, accepted.state),
      (e) => e.code === "operation_conflict",
    );
    assert.deepEqual(await store.get(f.owner + ":archive-change"), changed.record);
    store.finishArchiveDeletion = originalFinish;
    const resumed = db.client(f.uid, store);
    await resumed.finishArchiveDeletion(accepted.vault, accepted.state);
    assert.equal(await store.get(f.owner + ":archive-change"), null);
  });
});

test("deleted-archive recovery survives browser restart with the new Passkey and supports verified completion or cancellation", async (t) => {
  for (const cancel of [false, true]) {
    await b.withDatabase(async (db) => {
      const setup = await seed(t, db);
      if (!setup) return;
      const { f, store, client, state } = setup;
      const kit = await f.session.createRecoveryKit(f.vault, state);
      const deletion = await client.prepareArchiveDeletion(f.vault, state);
      const mutations = [action("archive_delete", deletion, 1000)];
      const deleted = actualHub(t, b.h, f, mutations);
      await client.finishArchiveDeletion(deleted.vault, deleted.state);
      client.lock();
      const recovery = db.client(f.uid, db.store());
      await recovery.importRecoveryKit(deleted.vault, deleted.state, kit.file, kit.code);
      const secret = crypto.getRandomValues(new Uint8Array(32)),
        credentialId = b.h.core.b64(crypto.getRandomValues(new Uint8Array(32))),
        prfSalt = b.h.core.b64(crypto.getRandomValues(new Uint8Array(32))),
        material = () => ({ credentialId, prfSalt, secret: secret.slice().buffer });
      const packet = await recovery.prepareArchiveChange(
        deleted.vault,
        deleted.state,
        material(),
        "recovery",
      );
      recovery.lock();
      const resumed = db.client(f.uid, db.store());
      const offer = await resumed.inspectArchiveChange(deleted.vault, deleted.state);
      assert.equal(offer.operationId, packet.operationId);
      assert.deepEqual(offer.archive, packet.archive);
      const pending = await resumed.getArchiveChange(deleted.vault, deleted.state, material());
      assert.deepEqual(pending.packet, packet);
      if (cancel) {
        const cancellation = await resumed.prepareArchiveCancellation(deleted.vault, deleted.state);
        assert.equal(cancellation.commands.length, 2);
        mutations.push(
          ...cancellation.commands.map((command) => action(command.action, command, 1000)),
        );
        const saved = actualHub(t, b.h, f, mutations);
        await resumed.discardArchiveChange(saved.vault, saved.state, packet.operationId);
        assert.equal(saved.vault.archive, null);
        assert.equal(saved.state.pendingAuthorization, null);
        assert.equal(await store.get(f.owner + ":archive-change"), null);
      } else {
        mutations.push(
          action("recovery_authorize", packet.authorization, 1000),
          action("archive_replace", packet, 1000),
        );
        const saved = actualHub(t, b.h, f, mutations);
        assert.equal(
          (await resumed.finishArchiveChange(saved.vault, saved.state, packet.operationId)).applied,
          true,
        );
        assert.equal(await store.get(f.owner + ":archive-change"), null);
        const normal = db.client(f.uid, store);
        assert.equal((await normal.unlock(saved.vault, material())).needsDeviceRegistration, true);
      }
    });
  }
});
