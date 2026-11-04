const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, createOwner, fullFlow, clone } = require("./full-flow-crypto-fixture.cjs");
const { actualHub, action } = require("./vault-renewal-hub-fixture.cjs");
let h;
test.before(async () => {
  h = await createHarness();
});
test.after(async () => {
  await h?.close();
});
const material = () => {
  const secret = crypto.getRandomValues(new Uint8Array(32)),
    credentialId = h.core.b64(crypto.getRandomValues(new Uint8Array(32))),
    prfSalt = h.core.b64(crypto.getRandomValues(new Uint8Array(32)));
  return () => ({ credentialId, prfSalt, secret: secret.slice().buffer });
};

test("real Hub deletion removes only the cloud archive; independent kit restores old holdings, task and result without old PRF", async (t) => {
  const flow = await fullFlow(h),
    f = flow.f,
    seed = clone(f.vault);
  const initial = actualHub(t, h, f);
  if (!initial) return;
  const contents = {
    holdings: await f.session.openSnapshot(flow.holdings.response, flow.holdings.source),
    task: await f.session.openTask(flow.task.task),
    result: await f.session.openResult(flow.result),
  };
  const kit = await f.session.createRecoveryKit(f.vault, initial.state);
  const deletion = await f.session.prepareArchiveDeletion(f.vault, initial.state);
  const bytes = JSON.stringify(deletion.record);
  for (const value of [
    seed.archive.ciphertext,
    seed.archive.credentialId,
    seed.archive.prfSalt,
    '"d":',
    "PrivateJwk",
  ])
    assert(!bytes.includes(value));
  await assert.rejects(
    f.session.openResult(flow.result),
    (e) => e.code === "archive_deletion_pending",
  );
  const remove = action("archive_delete", deletion.packet, 1000);
  const deleted = actualHub(t, h, f, [remove]);
  assert.equal(deleted.vault.archive, null);
  assert.equal(deleted.vault.rootKeyId, seed.rootKeyId);
  const observer = new h.core.VaultCore(f.uid, f.now);
  const status = await observer.inspectArchiveDeletion(
    deleted.vault,
    deleted.state,
    deletion.record,
  );
  assert.equal(status.outcome, "deleted");
  assert.equal(
    (await observer.finishArchiveDeletion(deleted.vault, deleted.state, deletion.record)).outcome,
    "deleted",
  );
  await assert.rejects(
    observer.unlock(deleted.vault, f.material(), { pin: f.local.pin }),
    (e) => e.code === "archive_deleted",
  );
  const restored = new h.core.VaultCore(f.uid, f.now);
  await restored.importRecoveryKit(deleted.vault, deleted.state, kit.file, kit.code);
  const next = material();
  const candidate = await restored.prepareArchiveChange(
    deleted.vault,
    deleted.state,
    next(),
    "recovery",
  );
  const mutations = [
    remove,
    action("recovery_authorize", candidate.packet.authorization, 1000),
    action("archive_replace", candidate.packet, 1000),
  ];
  const saved = actualHub(t, h, f, mutations);
  assert.equal(saved.vault.rootKeyId, seed.rootKeyId);
  assert.equal(saved.state.archiveRevision, 2);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  assert.equal(
    (await fresh.unlock(saved.vault, next(), { pin: f.local.pin })).needsDeviceRegistration,
    true,
  );
  await fresh.verifyLifecycle(saved.vault, saved.state);
  await assert.rejects(fresh.openSnapshot(flow.holdings.response, flow.holdings.source));
  const registration = await fresh.prepareDeviceRegistration(saved.vault);
  mutations.push(
    action(
      "registry",
      {
        operationId: registration.operationId,
        body: {
          contractVersion: h.core.CONTRACT,
          expectedVersion: registration.expectedVersion,
          registryBundle: registration.registryBundle,
        },
      },
      1000,
    ),
  );
  const approved = actualHub(t, h, f, mutations);
  await fresh.acceptVault(approved.vault);
  assert.deepEqual(
    await fresh.openSnapshot(flow.holdings.response, flow.holdings.source),
    contents.holdings,
  );
  assert.deepEqual(await fresh.openTask(flow.task.task), contents.task);
  assert.deepEqual(await fresh.openResult(flow.result), contents.result);
  const replayed = actualHub(t, h, f, [
    ...mutations,
    action("archive_delete", deletion.packet, 2000),
  ]);
  assert.deepEqual(replayed.vault.archive, saved.vault.archive);
  assert.equal(
    (await fresh.inspectArchiveDeletion(replayed.vault, replayed.state, deletion.record)).outcome,
    "deleted",
  );
});

test("expiry stays unresolved; original Passkey authorizes exact withdrawal after restart and a late deletion cannot win", async (t) => {
  const f = await createOwner(h),
    initial = actualHub(t, h, f);
  if (!initial) return;
  const deletion = await f.session.prepareArchiveDeletion(f.vault, initial.state);
  f.time(9000);
  const restarted = new h.core.VaultCore(f.uid, f.now);
  assert.equal(
    (await restarted.inspectArchiveDeletion(f.vault, initial.state, deletion.record)).outcome,
    "unresolved",
  );
  await assert.rejects(
    restarted.finishArchiveDeletion(f.vault, initial.state, deletion.record),
    (e) => e.code === "archive_deletion_unknown",
  );
  await restarted.unlockForArchiveDeletion(f.vault, f.material(), f.local.pin);
  const withdrawal = await restarted.prepareArchiveWithdrawal(
    f.vault,
    initial.state,
    deletion.record,
  );
  assert.deepEqual(withdrawal.packet.body.deletionCommand, deletion.packet.body.command);
  const actions = [
    action("archive_delete_withdraw", withdrawal.packet, 9000),
    action("archive_delete", deletion.packet, 1000, { expectError: true }),
    action("archive_delete_check", deletion.packet, 9000),
  ];
  const result = actualHub(t, h, f, actions, 9000);
  assert.deepEqual(result.vault.archive, f.vault.archive);
  assert.equal(result.state.archiveRevision, 0);
  assert.equal(result.state.lifecycleVersion, 1);
  assert.equal(result.replies.at(-1).response.outcome, "withdrawn");
  const observer = new h.core.VaultCore(f.uid, f.now);
  assert.equal(
    (await observer.inspectArchiveDeletion(result.vault, result.state, withdrawal.record)).outcome,
    "withdrawn",
  );
  assert.equal(
    (await observer.finishArchiveDeletion(result.vault, result.state, withdrawal.record)).outcome,
    "withdrawn",
  );
  const again = actualHub(
    t,
    h,
    f,
    [...actions, action("archive_delete_withdraw", withdrawal.packet, 9500)],
    9500,
  );
  assert.equal(again.state.lifecycleVersion, 1);
});

test("a committed delete wins over withdrawal, and valid-root later changes are independently recognized as superseding", async (t) => {
  const f = await createOwner(h),
    initial = actualHub(t, h, f);
  if (!initial) return;
  const separate = new h.core.VaultCore(f.uid, f.now);
  await separate.unlock(f.vault, f.material(), { pin: f.local.pin, device: f.local.device });
  const replacement = await separate.prepareArchiveChange(
    f.vault,
    initial.state,
    material()(),
    "passkey_change",
  );
  const deletion = await f.session.prepareArchiveDeletion(f.vault, initial.state);
  const other = new h.core.VaultCore(f.uid, f.now);
  await other.unlockForArchiveDeletion(f.vault, f.material(), f.local.pin);
  const withdrawal = await other.prepareArchiveWithdrawal(f.vault, initial.state, deletion.record);
  const deleted = actualHub(t, h, f, [
    action("archive_delete", deletion.packet, 1000),
    action("archive_delete_withdraw", withdrawal.packet, 1000, { expectError: true }),
  ]);
  assert.equal(
    (await other.inspectArchiveDeletion(deleted.vault, deleted.state, withdrawal.record)).outcome,
    "deleted",
  );
  const superseded = actualHub(t, h, f, [action("archive_replace", replacement.packet, 1000)]);
  const observer = new h.core.VaultCore(f.uid, f.now);
  assert.equal(
    (await observer.inspectArchiveDeletion(superseded.vault, superseded.state, deletion.record))
      .outcome,
    "superseded",
  );
});

test("forged null archives, deleted history, tampered targets, cross-owner records and old rollback fail closed", async (t) => {
  const f = await createOwner(h),
    initial = actualHub(t, h, f);
  if (!initial) return;
  const candidate = await f.session.prepareArchiveDeletion(f.vault, initial.state);
  const deleted = actualHub(t, h, f, [action("archive_delete", candidate.packet, 1000)]);
  for (const change of [
    (result) => {
      result.state.history = [];
      result.state.lifecycleVersion = 0;
    },
    (result) => {
      result.state.history[0].receipt.commandFingerprint = "0".repeat(64);
    },
    (result) => {
      result.state.archiveRevision += 1;
    },
  ]) {
    const bad = clone(deleted);
    change(bad);
    const c = new h.core.VaultCore(f.uid, f.now);
    await assert.rejects(c.inspectArchiveDeletion(bad.vault, bad.state, candidate.record));
  }
  const observer = new h.core.VaultCore(f.uid, f.now);
  await observer.inspectArchiveDeletion(deleted.vault, deleted.state, candidate.record);
  await assert.rejects(
    observer.inspectArchiveDeletion(f.vault, initial.state, candidate.record),
    (e) => e.code === "rollback_detected",
  );
  const foreign = new h.core.VaultCore("synthetic_owner_B", f.now);
  await assert.rejects(
    foreign.inspectArchiveDeletion(deleted.vault, deleted.state, candidate.record),
  );
  const changed = clone(candidate.record);
  changed.packet.body.command.payload += "A";
  await assert.rejects(
    new h.core.VaultCore(f.uid, f.now).inspectArchiveDeletion(
      deleted.vault,
      deleted.state,
      changed,
    ),
  );
  const noProof = { ...initial.state, archive: null, archiveDigest: await h.core.sha("null") };
  await assert.rejects(
    new h.core.VaultCore(f.uid, f.now).verifyLifecycle({ ...f.vault, archive: null }, noProof),
  );
});
