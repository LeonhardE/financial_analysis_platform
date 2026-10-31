const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createHarness,
  createOwner,
  fullFlow,
  createTask,
  importHoldings,
  clone,
  decoded,
} = require("./full-flow-crypto-fixture.cjs");
const { actualHub, action } = require("./vault-renewal-hub-fixture.cjs");
const { lifecycleState } = require("./vault-key-renewal-fixture.cjs");
let h;
test.before(async () => {
  h = await createHarness();
});
test.after(async () => {
  await h?.close();
});
const seed = (f) => ({ uid: f.uid, vault: clone(f.vault) });
const local = (f) => ({ pin: f.local.pin, device: f.local.device });
const response = (saved, operationId) =>
  saved.replies.findLast((row) => row.operationId === operationId).response;
function replacement() {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = h.core.b64(crypto.getRandomValues(new Uint8Array(32)));
  const prfSalt = h.core.b64(crypto.getRandomValues(new Uint8Array(32)));
  return () => ({ credentialId, prfSalt, secret: secret.slice().buffer });
}
async function candidate(f, state) {
  await f.session.unlockForKeyRenewal(f.vault, f.material(), local(f));
  return f.session.prepareKeyRenewal(f.vault, state);
}
async function adopt(f, saved, pending) {
  const done = await f.session.finishKeyRenewal(
    saved.vault,
    saved.state,
    pending.record,
    response(saved, pending.packet.operationId),
  );
  f.vault = saved.vault;
  f.local = done.record;
  f.session = new h.core.VaultCore(f.uid, f.now);
  await f.session.unlock(f.vault, f.material(), local(f));
  await f.session.acceptVault(f.vault);
  return done;
}

test("root-only renewal cannot decrypt or seal ordinary private task drafts", async () => {
  const f = await createOwner(h);
  const args = {
    slot: "new",
    revision: 1,
    baseVersion: 0,
    taskId: "private_draft_before_renewal",
    draft: { content: h.forms.defaultTask("brief"), resourceBindings: [] },
  };
  const sealed = await f.session.sealDraft(args);
  const current = await lifecycleState(h, f);
  const archiveChange = await f.session.prepareArchiveChange(
    f.vault,
    current,
    replacement()(),
    "passkey_change",
  );
  f.session = new h.core.VaultCore(f.uid, f.now);
  await f.session.unlockForKeyRenewal(f.vault, f.material(), local(f));
  await assert.rejects(f.session.openDraft(sealed), /key_renewal_pending/);
  await assert.rejects(f.session.sealDraft(args), /key_renewal_pending/);
  await assert.rejects(
    f.session.prepareArchiveCancellation(f.vault, current, archiveChange.record),
    /key_renewal_pending/,
  );
});

test("actual Hub accepts two browser double approvals while historical holdings/tasks/results and fresh-key writes survive reload", async (t) => {
  const flow = await fullFlow(h);
  const f = flow.f,
    initial = seed(f),
    actions = [];
  const originalContent = JSON.stringify([flow.holdings.response, flow.task.task, flow.result]);
  let saved = actualHub(t, h, initial);
  if (!saved) return;
  const old = {
    holdings: await f.session.openSnapshot(flow.holdings.response, flow.holdings.source),
    task: await f.session.openTask(flow.task.task),
    result: await f.session.openResult(flow.result),
  };
  let previousKeys, firstTask, firstHoldings;
  for (let round = 0; round < 2; round++) {
    f.time(2000 + round);
    const pending = await candidate(f, saved.state),
      p = decoded(pending.packet.body.command);
    const encoded = JSON.stringify(pending);
    for (const privateField of ["rootPrivateJwk", "recoveryPrivateJwk", "historicalKeys", '"d":'])
      assert.ok(!encoded.includes(privateField));
    actions.push(action("renewal", pending.packet, f.now()));
    saved = actualHub(t, h, initial, actions, f.now());
    assert.equal(saved.errors.length, 0);
    assert.equal(saved.state.archiveRevision, round + 1);
    assert.equal(
      saved.vault.registryHistory.length,
      initial.vault.registryHistory.length + round + 1,
    );
    assert.equal(saved.renewalState.rootAnchorExpiresAt, null);
    await adopt(f, saved, pending);
    assert.deepEqual(
      await f.session.openSnapshot(flow.holdings.response, flow.holdings.source),
      old.holdings,
    );
    assert.deepEqual(await f.session.openTask(flow.task.task), old.task);
    assert.deepEqual(await f.session.openResult(flow.result), old.result);
    const newest = p.renewals.find((item) => item.role === "device_sig").newKeyId;
    assert.equal((await f.session.signSource("fresh_source_" + round)).authorKeyId, newest);
    if (previousKeys) assert.ok(p.renewals.every((item) => previousKeys.has(item.priorKeyId)));
    previousKeys = new Set(p.renewals.map((item) => item.newKeyId));
    if (round === 0) {
      firstHoldings = await importHoldings(h, f);
      firstTask = await createTask(h, f, { taskId: "task_after_first_renewal" });
      assert.equal(
        decoded(firstHoldings.pending.carrier.signedObject).context.authorSigningKeyId,
        newest,
      );
      assert.equal(
        decoded(firstTask.pending.body.envelope.signedObject).context.authorSigningKeyId,
        newest,
      );
    }
  }
  assert.deepEqual(await f.session.openTask(firstTask.task), firstTask.content);
  assert.equal(
    (await f.session.openSnapshot(firstHoldings.response, firstHoldings.source)).data.accounts[0]
      .positions[0].quantity,
    "12.5",
  );
  // A new agent is explicitly approved; the old recipient grant is never silently renewed.
  const freshFlow = await fullFlow(h, {
    owner: f,
    taskId: "task_after_second_renewal",
    connectionId: "connection_after_second_renewal",
  });
  const latestContext = decoded(freshFlow.packet.envelope.signedObject).context;
  assert.ok(
    latestContext.recipients
      .filter((item) => item.role !== "agent_enc")
      .every((item) => previousKeys.has(item.keyId)),
  );
  assert.deepEqual(await f.session.openResult(freshFlow.result), freshFlow.content);
  assert.equal(
    JSON.stringify([flow.holdings.response, flow.task.task, flow.result]),
    originalContent,
  );
});

test("actual Hub can renew fully expired owner certificates without allowing ordinary plaintext or writer capabilities beforehand", async (t) => {
  const flow = await fullFlow(h),
    f = flow.f,
    initial = seed(f);
  f.time(31537001);
  const saved = actualHub(t, h, initial, [], f.now());
  if (!saved) return;
  f.session = new h.core.VaultCore(f.uid, f.now);
  await f.session.unlockForKeyRenewal(f.vault, f.material(), local(f));
  for (const ordinary of [
    () => f.session.openTask(flow.task.task),
    () => f.session.openResult(flow.result),
    () => f.session.openSnapshot(flow.holdings.response, flow.holdings.source),
    () => f.session.signSource("expired_source"),
    () => f.session.prepareDeviceRegistration(f.vault),
    () => f.session.prepareArchiveChange(f.vault, saved.state, replacement()(), "passkey_change"),
  ])
    await assert.rejects(ordinary(), /key_renewal_pending/);
  const pending = await f.session.prepareKeyRenewal(f.vault, saved.state);
  const applied = actualHub(t, h, initial, [action("renewal", pending.packet, f.now())], f.now());
  await adopt(f, applied, pending);
  assert.deepEqual(await f.session.openResult(flow.result), flow.content);
  assert.ok(await f.session.signSource("renewed_source"));
});

test("actual Hub keeps all three documents unchanged for tampered, cross-user or mismatched-operation browser packets", async (t) => {
  const f = await createOwner(h),
    initial = seed(f);
  f.time(2000);
  const saved = actualHub(t, h, initial, [], f.now());
  if (!saved) return;
  const pending = await candidate(f, saved.state);
  const changedArchive = clone(pending.packet);
  changedArchive.body.archive.ciphertext = h.core.b64(crypto.getRandomValues(new Uint8Array(64)));
  const changedSignature = clone(pending.packet);
  changedSignature.body.command.signature = "A".repeat(86);
  const changedBody = clone(pending.packet);
  changedBody.body.privateKey = "PRIVATE_CANARY";
  for (const mutation of [
    action("renewal", changedArchive, f.now(), { expectError: true }),
    action("renewal", changedSignature, f.now(), { expectError: true }),
    action("renewal", changedBody, f.now(), { expectError: true }),
    action("renewal", pending.packet, f.now(), { uid: "other_synthetic_owner", expectError: true }),
    action("renewal", pending.packet, f.now(), {
      operationId: "different_operation_0001",
      expectError: true,
    }),
  ]) {
    const rejected = actualHub(
      t,
      h,
      initial,
      [mutation, action("receipt", pending.packet, f.now(), { expectError: true })],
      f.now(),
    );
    assert.equal(rejected.errors.length, 2);
    assert.equal(rejected.errors[1], "not_found");
    assert.deepEqual(rejected.vault, saved.vault);
    assert.deepEqual(rejected.state, saved.state);
  }
});

test("actual original receipt survives a later renewal and expiry; replay cannot reinstall the old archive", async (t) => {
  const f = await createOwner(h),
    initial = seed(f),
    actions = [];
  f.time(2000);
  let saved = actualHub(t, h, initial, [], f.now());
  if (!saved) return;
  const first = await candidate(f, saved.state);
  actions.push(action("renewal", first.packet, f.now()));
  saved = actualHub(t, h, initial, actions, f.now());
  const originalReceipt = response(saved, first.packet.operationId);
  await adopt(f, saved, first);
  f.time(2001);
  const second = await candidate(f, saved.state);
  actions.push(action("renewal", second.packet, f.now()));
  saved = actualHub(t, h, initial, actions, f.now());
  const replayed = actualHub(
    t,
    h,
    initial,
    [
      ...actions,
      action("renewal", first.packet, 99999999),
      action("receipt", first.packet, 99999999),
      action("receipt", first.packet, 99999999, {
        uid: "other_synthetic_owner",
        expectError: true,
      }),
    ],
    99999999,
  );
  assert.deepEqual(replayed.vault, saved.vault);
  assert.deepEqual(response(replayed, first.packet.operationId), originalReceipt);
  assert.deepEqual(replayed.errors, ["not_found"]);
});

test("browser refuses forged lifecycle evidence, old archive rollback and foreign-root candidate recovery around a real accepted renewal", async (t) => {
  const f = await createOwner(h),
    initial = seed(f);
  f.time(2000);
  const saved = actualHub(t, h, initial, [], f.now());
  if (!saved) return;
  const pending = await candidate(f, saved.state);
  const applied = actualHub(t, h, initial, [action("renewal", pending.packet, f.now())], f.now());
  const forgedState = clone(applied.state);
  forgedState.history[0].receipt.archiveDigest = "0".repeat(64);
  await assert.rejects(
    f.session.finishKeyRenewal(
      applied.vault,
      forgedState,
      pending.record,
      response(applied, pending.packet.operationId),
    ),
  );
  const rollback = { ...applied.vault, archive: initial.vault.archive };
  await assert.rejects(f.session.getKeyRenewal(rollback, applied.state, pending.record));
  const changedRecord = { ...pending.record, operationId: "synthetic_grafted_operation_0001" };
  await assert.rejects(f.session.getKeyRenewal(applied.vault, applied.state, changedRecord));
  const other = await createOwner(h, f.uid);
  await other.session.unlockForKeyRenewal(other.vault, other.material(), local(other));
  await assert.rejects(other.session.getKeyRenewal(other.vault, saved.state, pending.record));
  const done = await adopt(f, applied, pending);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await assert.rejects(
    fresh.unlockForKeyRenewal(initial.vault, f.material(), done.record),
    /rollback_detected/,
  );
});

test("a real accepted Passkey replacement preserves root-sealed pending while permanently fencing its old renewal", async (t) => {
  const f = await createOwner(h),
    initial = seed(f);
  f.time(2000);
  const saved = actualHub(t, h, initial, [], f.now());
  if (!saved) return;
  const pending = await candidate(f, saved.state);
  const other = new h.core.VaultCore(f.uid, f.now);
  await other.unlock(f.vault, f.material(), local(f));
  await other.acceptVault(f.vault);
  const next = replacement();
  const change = await other.prepareArchiveChange(f.vault, saved.state, next(), "passkey_change");
  const actions = [action("archive_replace", change.packet, f.now())];
  const changed = actualHub(t, h, initial, actions, f.now());
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForKeyRenewal(changed.vault, next(), local(f));
  const recovered = await fresh.getKeyRenewal(changed.vault, changed.state, pending.record);
  assert.equal(recovered.state, "conflict");
  assert.deepEqual(recovered.packet, pending.packet);
  const fenced = actualHub(
    t,
    h,
    initial,
    [...actions, action("renewal", pending.packet, 2001, { expectError: true })],
    2001,
  );
  assert.deepEqual(fenced.vault, changed.vault);
  assert.deepEqual(fenced.state, changed.state);
  assert.deepEqual(fenced.errors, ["version_conflict"]);
  const discarded = await fresh.discardKeyRenewal(
    changed.vault,
    changed.state,
    pending.record,
    pending.packet.operationId,
  );
  assert.equal(discarded.safe, true);
  assert.equal(discarded.record.device, undefined);
  assert.equal(discarded.pin.archiveDigest, changed.state.archiveDigest);
});

test("actual expiry-time cancellation preserves the local identity required to reopen and perform a later renewal", async (t) => {
  const f = await createOwner(h),
    initial = seed(f);
  f.time(31537001);
  const before = actualHub(t, h, initial, [], f.now());
  if (!before) return;
  const pending = await candidate(f, before.state);
  const cancellation = await f.session.prepareKeyRenewalCancellation(
    f.vault,
    before.state,
    pending.record,
  );
  const actions = [action("archive_replace", cancellation.packet, f.now())];
  const canceled = actualHub(t, h, initial, actions, f.now());
  const discarded = await f.session.discardKeyRenewal(
    canceled.vault,
    canceled.state,
    cancellation.record,
    pending.packet.operationId,
  );
  assert.equal(discarded.record.device.deviceId, f.local.device.deviceId);
  assert.equal(discarded.record.device.signingKeyId, f.local.device.signingKeyId);
  f.vault = canceled.vault;
  f.local = discarded.record;
  f.session = new h.core.VaultCore(f.uid, f.now);
  await f.session.unlockForKeyRenewal(f.vault, f.material(), local(f));
  assert.equal((await f.session.inspectKeyRenewal(f.vault, canceled.state)).canRenew, true);
  await assert.rejects(f.session.signSource("expired_cancelled_identity"), /key_renewal_pending/);
  f.time(f.now() + 1);
  const next = await f.session.prepareKeyRenewal(f.vault, canceled.state);
  const saved = actualHub(
    t,
    h,
    initial,
    [...actions, action("renewal", next.packet, f.now())],
    f.now(),
  );
  await adopt(f, saved, next);
  assert.ok(await f.session.signSource("after_cancel_and_renewal"));
});
