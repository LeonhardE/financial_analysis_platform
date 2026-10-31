const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createHarness,
  createOwner,
  fullFlow,
  decoded,
  clone,
  importHoldings,
  createTask,
} = require("./full-flow-crypto-fixture.cjs");
const {
  lifecycleState,
  archiveAccepted,
  renewalAccepted,
} = require("./vault-key-renewal-fixture.cjs");
const { actualHub, action } = require("./vault-renewal-hub-fixture.cjs");
let h;
test.before(async () => {
  h = await createHarness();
});
test.after(async () => {
  await h?.close();
});
const material = () => {
  const raw = crypto.getRandomValues(new Uint8Array(32)),
    credentialId = h.core.b64(crypto.getRandomValues(new Uint8Array(32))),
    prfSalt = h.core.b64(crypto.getRandomValues(new Uint8Array(32)));
  return () => ({ credentialId, prfSalt, secret: raw.slice().buffer });
};
async function prepared(f, state) {
  await f.session.unlockForKeyRenewal(f.vault, f.material(), {
    pin: f.local.pin,
    device: f.local.device,
  });
  return f.session.prepareKeyRenewal(f.vault, state);
}

test("successor keyring preserves old holdings, tasks and reports across two renewals and reload; new writes use new keys", async () => {
  const flow = await fullFlow(h),
    f = flow.f;
  f.time(2000);
  let state = await lifecycleState(h, f);
  const before = {
    holdings: await f.session.openSnapshot(flow.holdings.response, flow.holdings.source),
    task: await f.session.openTask(flow.task.task),
    result: await f.session.openResult(flow.result),
  };
  for (let i = 0; i < 2; i++) {
    const candidate = await prepared(f, state),
      p = decoded(candidate.packet.body.command);
    assert.equal(candidate.packet.body.archive.credentialId, f.vault.archive.credentialId);
    assert.equal(candidate.packet.body.archive.prfSalt, f.vault.archive.prfSalt);
    assert.notEqual(candidate.packet.body.archive.iv, f.vault.archive.iv);
    assert(!JSON.stringify(candidate).includes("PrivateJwk"));
    assert(!JSON.stringify(candidate).includes('"d":'));
    assert.equal(p.renewals.length, 3);
    assert.equal(p.keyEpoch, 1);
    assert.equal((await f.session.getKeyRenewal(f.vault, state, candidate.record)).state, "ready");
    const accepted = await renewalAccepted(h, f.vault, state, candidate.packet, f.now());
    const done = await f.session.finishKeyRenewal(
      accepted.vault,
      accepted.state,
      candidate.record,
      accepted.receipt,
    );
    f.vault = accepted.vault;
    state = accepted.state;
    f.local = done.record;
    f.session = new h.core.VaultCore(f.uid, f.now);
    await f.session.unlock(f.vault, f.material(), { pin: f.local.pin, device: f.local.device });
    await f.session.acceptVault(f.vault);
    assert.deepEqual(
      await f.session.openSnapshot(flow.holdings.response, flow.holdings.source),
      before.holdings,
    );
    assert.deepEqual(await f.session.openTask(flow.task.task), before.task);
    assert.deepEqual(await f.session.openResult(flow.result), before.result);
    const source = await f.session.signSource("new_source_synthetic");
    assert.equal(source.authorKeyId, p.renewals.find((t) => t.role === "device_sig").newKeyId);
    f.time(f.now() + 1);
  }
  const freshHoldings = await importHoldings(h, f),
    freshTask = await createTask(h, f);
  assert.equal(
    (await f.session.openSnapshot(freshHoldings.response, freshHoldings.source)).data.accounts[0]
      .positions[0].quantity,
    "12.5",
  );
  assert.equal((await f.session.openTask(freshTask.task)).name, freshTask.content.name);
});

test("all expired certificates permit only explicit root renewal and never ordinary signing or device grants", async () => {
  const f = await createOwner(h);
  f.time(31537001);
  const state = await lifecycleState(h, f);
  const worker = new h.core.VaultCore(f.uid, f.now);
  assert.deepEqual(
    await worker.unlockForKeyRenewal(f.vault, f.material(), {
      pin: f.local.pin,
      device: f.local.device,
    }),
    {
      renewalOnly: true,
    },
  );
  assert.equal((await worker.inspectKeyRenewal(f.vault, state)).canRenew, true);
  for (const action of [
    () => worker.signSource("source_synthetic"),
    () => worker.prepareDeviceRegistration(f.vault),
    () => worker.prepareArchiveChange(f.vault, state, material()(), "passkey_change"),
  ])
    await assert.rejects(action(), /key_renewal_pending/);
  const c = await worker.prepareKeyRenewal(f.vault, state),
    accepted = await renewalAccepted(h, f.vault, state, c.packet, f.now());
  const done = await worker.finishKeyRenewal(
    accepted.vault,
    accepted.state,
    c.record,
    accepted.receipt,
  );
  assert(done.record.device);
  const ordinary = new h.core.VaultCore(f.uid, f.now);
  await ordinary.unlock(accepted.vault, f.material(), done.record);
  await ordinary.acceptVault(accepted.vault);
  assert(await ordinary.signSource("synthetic_after_expiry_renewal"));
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForKeyRenewal(f.vault, f.material());
  const summary = await fresh.inspectKeyRenewal(f.vault, state);
  assert.equal(summary.canRenew, false);
  assert.equal(summary.reason, "device_required");
});

test("pending renewal is encrypted, authenticated, owner-root bound and survives reload without regenerating keys", async () => {
  const f = await createOwner(h);
  f.time(2000);
  const state = await lifecycleState(h, f),
    c = await prepared(f, state);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForKeyRenewal(f.vault, f.material(), {
    pin: f.local.pin,
    device: f.local.device,
  });
  assert.deepEqual((await fresh.getKeyRenewal(f.vault, state, c.record)).packet, c.packet);
  const changedCiphertext = Buffer.from(c.record.ciphertext, "base64url");
  changedCiphertext[0] ^= 1;
  for (const r of [
    { ...c.record, operationId: "different_operation_0001" },
    { ...c.record, rootKeyId: "x".repeat(43) },
    { ...c.record, ciphertext: changedCiphertext.toString("base64url") },
  ])
    await assert.rejects(fresh.getKeyRenewal(f.vault, state, r));
  const other = await createOwner(h, "other_synthetic_owner");
  await other.session.unlockForKeyRenewal(other.vault, other.material(), {
    pin: other.local.pin,
    device: other.local.device,
  });
  await assert.rejects(
    other.session.getKeyRenewal(other.vault, await lifecycleState(h, other), c.record),
  );
  await assert.rejects(
    fresh.discardKeyRenewal(f.vault, state, c.record, c.packet.operationId),
    /key_renewal_unknown/,
  );
  f.time(3000);
  assert.deepEqual((await fresh.getKeyRenewal(f.vault, state, c.record)).packet, c.packet);
  await assert.rejects(
    fresh.discardKeyRenewal(f.vault, state, c.record, c.packet.operationId),
    /key_renewal_unknown/,
  );
});

test("signed cancellation fence wins atomically; only verified conflict may remove the original candidate", async () => {
  const f = await createOwner(h);
  f.time(2000);
  const state = await lifecycleState(h, f),
    c = await prepared(f, state);
  const cancel = await f.session.prepareKeyRenewalCancellation(f.vault, state, c.record);
  assert.deepEqual(
    await f.session.prepareKeyRenewalCancellation(f.vault, state, cancel.record),
    cancel,
  );
  const now = await archiveAccepted(h, f.vault, state, cancel.packet, f.now());
  assert.equal(
    (await f.session.getKeyRenewal(now.vault, now.state, cancel.record)).state,
    "conflict",
  );
  const done = await f.session.discardKeyRenewal(
    now.vault,
    now.state,
    cancel.record,
    c.packet.operationId,
  );
  assert.equal(done.safe, true);
  assert.equal(done.pin.lifecycleVersion, 1);
  assert.equal(done.record.pin.checkpointDigest, state.checkpointDigest);
  await assert.rejects(
    f.session.finishKeyRenewal(now.vault, now.state, cancel.record, {
      contractVersion: h.core.CONTRACT,
    }),
    /key_renewal_unknown/,
  );
});

test("expired cancellation renews only its own fence while the original successor ciphertext stays byte-identical", async () => {
  const f = await createOwner(h);
  f.time(2000);
  const state = await lifecycleState(h, f),
    c = await prepared(f, state);
  const a = await f.session.prepareKeyRenewalCancellation(f.vault, state, c.record);
  f.time(2400);
  const b = await f.session.prepareKeyRenewalCancellation(f.vault, state, a.record);
  assert.notEqual(a.packet.operationId, b.packet.operationId);
  assert.deepEqual((await f.session.getKeyRenewal(f.vault, state, b.record)).packet, c.packet);
});

test("latest lifecycle and exact immutable receipt are required before adopting successor device keys", async () => {
  const f = await createOwner(h);
  f.time(2000);
  const state = await lifecycleState(h, f),
    c = await prepared(f, state);
  const applied = await renewalAccepted(h, f.vault, state, c.packet, f.now());
  for (const mutate of [
    (v) => v.receipt.vaultVersion++,
    (v) => (v.receipt.acceptedAt = true),
    (v) => (v.receipt.commandFingerprint = "0".repeat(64)),
    (v) => v.receipt.renewals.reverse(),
  ]) {
    const r = clone(applied.receipt);
    mutate(r);
    await assert.rejects(f.session.finishKeyRenewal(applied.vault, applied.state, c.record, r));
  }
  await f.session.finishKeyRenewal(applied.vault, applied.state, c.record, applied.receipt);
  await assert.rejects(f.session.getKeyRenewal(f.vault, state, c.record), /rollback_detected/);
});

test("versioned keyring survives Passkey replacement and an independent recovery kit without losing historical readers", async () => {
  const flow = await fullFlow(h),
    f = flow.f;
  f.time(2000);
  const initial = await lifecycleState(h, f),
    c = await prepared(f, initial);
  const applied = await renewalAccepted(h, f.vault, initial, c.packet, f.now());
  const done = await f.session.finishKeyRenewal(
    applied.vault,
    applied.state,
    c.record,
    applied.receipt,
  );
  f.vault = applied.vault;
  f.local = done.record;
  const kit = await f.session.createRecoveryKit(f.vault, applied.state),
    next = material();
  const change = await f.session.prepareArchiveChange(
    f.vault,
    applied.state,
    next(),
    "passkey_change",
  );
  const changed = await archiveAccepted(h, f.vault, applied.state, change.packet, f.now());
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForResults(changed.vault, next());
  await fresh.getArchiveChange(changed.vault, changed.state, change.record);
  const finalized = await fresh.finishArchiveChange(
    changed.vault,
    changed.state,
    change.packet.operationId,
  );
  const ordinary = new h.core.VaultCore(f.uid, f.now);
  await ordinary.unlock(changed.vault, next(), finalized.record);
  await ordinary.acceptVault(changed.vault);
  assert.deepEqual(await ordinary.openResult(flow.result), flow.content);
  assert.equal((await ordinary.openTask(flow.task.task)).name, flow.task.content.name);
  const recovered = new h.core.VaultCore(f.uid, f.now);
  await recovered.importRecoveryKit(changed.vault, changed.state, kit.file, kit.code);
  await recovered.acceptResultVault(changed.vault);
  assert.deepEqual(await recovered.openResult(flow.result), flow.content);
});

test("root-sealed pending remains recoverable after an independently accepted legitimate Passkey replacement", async () => {
  const f = await createOwner(h);
  f.time(2000);
  const state = await lifecycleState(h, f),
    c = await prepared(f, state);
  const other = new h.core.VaultCore(f.uid, f.now);
  await other.unlock(f.vault, f.material(), { pin: f.local.pin, device: f.local.device });
  await other.acceptVault(f.vault);
  const next = material(),
    change = await other.prepareArchiveChange(f.vault, state, next(), "passkey_change");
  const changed = await archiveAccepted(h, f.vault, state, change.packet, f.now());
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForKeyRenewal(changed.vault, next(), {
    pin: f.local.pin,
    device: f.local.device,
  });
  assert.equal(
    (await fresh.getKeyRenewal(changed.vault, changed.state, c.record)).state,
    "conflict",
  );
  const done = await fresh.discardKeyRenewal(
    changed.vault,
    changed.state,
    c.record,
    c.packet.operationId,
  );
  assert(done.safe);
  assert.equal(done.pin.archiveDigest, changed.state.archiveDigest);
  assert.equal(done.record.device, undefined);
});

test("cancelling an expired-device renewal retains its sealed identity for the next explicit root-only attempt", async () => {
  const f = await createOwner(h);
  f.time(31537001);
  const state = await lifecycleState(h, f),
    candidate = await prepared(f, state);
  const cancel = await f.session.prepareKeyRenewalCancellation(f.vault, state, candidate.record);
  const changed = await archiveAccepted(h, f.vault, state, cancel.packet, f.now());
  const done = await f.session.discardKeyRenewal(
    changed.vault,
    changed.state,
    cancel.record,
    candidate.packet.operationId,
  );
  assert(done.record.device);
  assert.equal(done.record.device.signingKeyId, f.local.device.signingKeyId);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForKeyRenewal(changed.vault, f.material(), {
    pin: done.record.pin,
    device: done.record.device,
  });
  assert.equal((await fresh.inspectKeyRenewal(changed.vault, changed.state)).canRenew, true);
  assert(await fresh.prepareKeyRenewal(changed.vault, changed.state));
  await assert.rejects(fresh.signSource("ordinary_expired_synthetic"), /key_renewal_pending/);
});

test("late acknowledgment preserves expired successor identity without granting ordinary capabilities", async () => {
  const f = await createOwner(h);
  f.time(2000);
  const state = await lifecycleState(h, f),
    candidate = await prepared(f, state);
  const accepted = await renewalAccepted(h, f.vault, state, candidate.packet, f.now());
  f.time(31538001);
  const done = await f.session.finishKeyRenewal(
    accepted.vault,
    accepted.state,
    candidate.record,
    accepted.receipt,
  );
  assert(done.record.device);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForKeyRenewal(accepted.vault, f.material(), {
    pin: done.record.pin,
    device: done.record.device,
  });
  assert.equal((await fresh.inspectKeyRenewal(accepted.vault, accepted.state)).canRenew, true);
  await assert.rejects(fresh.signSource("ordinary_expired_synthetic"), /key_renewal_pending/);
});

test("a pre-renewal recovery kit cannot downgrade the archive after actual Hub renewal and new holdings, task and agent report writes; a refreshed kit restores both generations", async (t) => {
  const old = await fullFlow(h),
    f = old.f;
  const oldState = await lifecycleState(h, f),
    oldKit = await f.session.createRecoveryKit(f.vault, oldState);
  f.time(2000);
  const pending = await prepared(f, oldState);
  const producer = actualHub(
    t,
    h,
    { uid: f.uid, vault: clone(f.vault) },
    [action("renewal", pending.packet, f.now())],
    f.now(),
  );
  if (!producer) return;
  const saved = { ...producer, receipt: producer.replies[0].response };
  const done = await f.session.finishKeyRenewal(
    saved.vault,
    saved.state,
    pending.record,
    saved.receipt,
  );
  f.vault = saved.vault;
  f.local = done.record;
  f.session = new h.core.VaultCore(f.uid, f.now);
  await f.session.unlock(f.vault, f.material(), { pin: f.local.pin, device: f.local.device });
  await f.session.acceptVault(f.vault);
  const latest = await fullFlow(h, {
    owner: f,
    taskId: "task_after_renewal_kit_guard",
    connectionId: "connection_after_renewal_kit_guard",
  });
  const cp = decoded(f.vault.registryHistory.at(-1).checkpoint),
    state = {
      ...saved.state,
      vaultVersion: f.vault.version,
      registrySequence: cp.registrySequence,
      checkpointDigest: await h.core.sha(h.core.canonical(cp)),
      keyEpoch: cp.keyEpoch,
    };
  const freshKit = await f.session.createRecoveryKit(f.vault, state),
    next = material();
  const failed = new h.core.VaultCore(f.uid, f.now);
  await assert.rejects(
    failed.importRecoveryKit(f.vault, state, oldKit.file, oldKit.code),
    /stale_recovery_kit/,
  );
  await assert.rejects(failed.prepareArchiveChange(f.vault, state, next(), "recovery"), /locked/);
  // Failure also cannot install stale private material into an already unlocked Worker.
  await assert.rejects(
    f.session.importRecoveryKit(f.vault, state, oldKit.file, oldKit.code),
    /stale_recovery_kit/,
  );
  assert.deepEqual(await f.session.openResult(latest.result), latest.content);
  const restored = new h.core.VaultCore(f.uid, f.now);
  await restored.importRecoveryKit(f.vault, state, freshKit.file, freshKit.code);
  await restored.acceptResultVault(f.vault);
  for (const flow of [old, latest]) {
    assert.deepEqual(await restored.openResult(flow.result), flow.content);
    assert.equal((await restored.openTask(flow.task.task)).name, flow.task.content.name);
  }
  // The new kit also retains every owner encryption key required by both holdings generations.
  const replacement = await restored.prepareArchiveChange(f.vault, state, next(), "recovery");
  const newArchiveVault = { ...f.vault, archive: replacement.packet.archive };
  const recovered = new h.core.VaultCore(f.uid, f.now);
  await recovered.unlockForResults(newArchiveVault, next());
  const enrollment = await recovered.prepareDeviceRegistration(newArchiveVault);
  const registered = {
    ...newArchiveVault,
    version: newArchiveVault.version + 1,
    registryHistory: [...newArchiveVault.registryHistory, enrollment.registryBundle],
  };
  await recovered.acceptVault(registered);
  for (const flow of [old, latest]) {
    assert.equal(
      (await recovered.openSnapshot(flow.holdings.response, flow.holdings.source)).data.accounts[0]
        .positions[0].quantity,
      "12.5",
    );
    assert.equal((await recovered.openTask(flow.task.task)).name, flow.task.content.name);
    assert.deepEqual(await recovered.openResult(flow.result), flow.content);
  }
});

test("successful older-kit recovery pins a newly observed directory and cannot roll back an ordinary device revocation with the same recovery key", async () => {
  const f = await createOwner(h),
    original = clone(f.vault),
    originalState = await lifecycleState(h, f);
  const kit = await f.session.createRecoveryKit(f.vault, originalState);
  const rotation = await f.session.prepareDeviceChange({
    vault: f.vault,
    action: "rotate",
    deviceId: f.local.device.deviceId,
  });
  const current = {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, rotation.registryBundle],
  };
  const cp = decoded(current.registryHistory.at(-1).checkpoint),
    state = {
      ...originalState,
      vaultVersion: current.version,
      registrySequence: cp.registrySequence,
      checkpointDigest: await h.core.sha(h.core.canonical(cp)),
      keyEpoch: cp.keyEpoch,
    };
  const recovered = new h.core.VaultCore(f.uid, f.now);
  await recovered.importRecoveryKit(current, state, kit.file, kit.code);
  await assert.rejects(recovered.acceptResultVault(original), /rollback_detected/);
  const accepted = await recovered.acceptResultVault(current);
  assert.equal(accepted.pin.registrySequence, 2);
  assert.equal(accepted.pin.checkpointDigest, state.checkpointDigest);
  assert.equal(accepted.canWriteState, false);
  const lifecycle = await recovered.verifyLifecycle(current, state);
  assert.equal(lifecycle.lifecycleVersion, state.lifecycleVersion);
  assert.equal(lifecycle.archiveDigest, state.archiveDigest);
});

test("root-only unlock remembers a newer verified directory even when durable local pin is older and archive lifecycle did not change", async () => {
  const f = await createOwner(h),
    original = clone(f.vault),
    originalState = await lifecycleState(h, f);
  const rotation = await f.session.prepareDeviceChange({
    vault: f.vault,
    action: "rotate",
    deviceId: f.local.device.deviceId,
  });
  const current = {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, rotation.registryBundle],
  };
  const cp = decoded(current.registryHistory.at(-1).checkpoint),
    state = {
      ...originalState,
      vaultVersion: current.version,
      registrySequence: cp.registrySequence,
      checkpointDigest: await h.core.sha(h.core.canonical(cp)),
      keyEpoch: cp.keyEpoch,
    };
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForKeyRenewal(current, f.material(), {
    pin: f.local.pin,
    device: f.local.device,
  });
  await assert.rejects(fresh.inspectKeyRenewal(original, originalState), /rollback_detected/);
  const summary = await fresh.inspectKeyRenewal(current, state);
  assert.equal(summary.registrySequence, 2);
  const publicPin = await fresh.verifiedVaultPin(current);
  assert.equal(publicPin.pin.registrySequence, 2);
  assert.equal(publicPin.history.length, 2);
  assert.deepEqual(Object.keys(publicPin).sort(), ["history", "pin"]);
  assert(!JSON.stringify(publicPin).includes("device"));
  assert(!JSON.stringify(publicPin).includes("PrivateJwk"));
});

test("an ordinary session cannot sign or create a fresh agent anchor from its stale cached directory after observing device revocation", async () => {
  const f = await createOwner(h),
    originalState = await lifecycleState(h, f);
  const other = new h.core.VaultCore(f.uid, f.now);
  await other.unlock(f.vault, f.material(), { pin: f.local.pin, device: f.local.device });
  await other.acceptVault(f.vault);
  const rotation = await other.prepareDeviceChange({
    vault: f.vault,
    action: "rotate",
    deviceId: f.local.device.deviceId,
  });
  const current = {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, rotation.registryBundle],
  };
  const cp = decoded(current.registryHistory.at(-1).checkpoint),
    state = {
      ...originalState,
      vaultVersion: current.version,
      registrySequence: cp.registrySequence,
      checkpointDigest: await h.core.sha(h.core.canonical(cp)),
      keyEpoch: cp.keyEpoch,
    };
  await f.session.verifyLifecycle(current, state);
  await assert.rejects(
    f.session.signSource("must_not_sign_after_observed_revocation"),
    /registry_conflict/,
  );
  await assert.rejects(
    f.session.publicAgentAnchor({
      connectionId: "connection_synthetic",
      agentPrincipalId: "agent_synthetic",
      taskId: "task_synthetic",
    }),
    /registry_conflict/,
  );
  // A newer validated directory with an older durable lower-bound pin is still a valid ordinary unlock.
  const accepted = await other.acceptDeviceChange(current, rotation.localPending);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlock(current, f.material(), { pin: f.local.pin, device: accepted.record.device });
  assert(await fresh.signSource("newer_directory_older_pin_is_valid"));
});
