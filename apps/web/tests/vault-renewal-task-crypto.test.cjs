const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createHarness,
  createOwner,
  createTask,
  clone,
  decoded,
  keyProofs,
  iso,
} = require("./full-flow-crypto-fixture.cjs");
const { lifecycleState, renewalAccepted } = require("./vault-key-renewal-fixture.cjs");
let h;
test.before(async () => {
  h = await createHarness();
});
test.after(async () => {
  await h?.close();
});
async function fixture() {
  const f = await createOwner(h);
  const task = await createTask(h, f, { template: "custom", bindings: [] });
  return { f, ...task };
}
async function restricted(f) {
  const session = new h.core.VaultCore(f.uid, f.now);
  await session.unlockForKeyRenewal(f.vault, f.material(), {
    pin: f.local.pin,
    device: f.local.device,
  });
  return session;
}
function transitionResponse(f, pending, previous) {
  const c = decoded(pending.body.envelope.signedObject).context,
    intent = decoded(pending.body.transitionIntent);
  return {
    contractVersion: h.core.CONTRACT,
    signedObject: clone(pending.body.envelope.signedObject),
    keyProofs: keyProofs(f),
    metadata: {
      ...clone(previous.metadata),
      taskVersion: c.revision,
      objectRevision: c.revision,
      executionEpoch: intent.nextExecutionEpoch,
      status: { pause: "paused", resume: "active", archive: "archived" }[intent.action],
      envelopeFingerprint: pending.envelopeFingerprint,
      keyEpoch: pending.keyEpoch,
      updatedAt: iso(f.now()),
    },
  };
}
async function signed(f, payload, object = false) {
  return new h.jose.FlattenedSign(new TextEncoder().encode(h.core.canonical(payload)))
    .setProtectedHeader({
      alg: "ES256",
      kid: object ? payload.context.authorSigningKeyId : f.vault.rootKeyId,
      typ: object ? "fv-object+jws" : "fv-control+jws",
      cty: "application/json",
    })
    .sign(object ? f.session.device.sig : f.session.root);
}
test("renewal-only task inspection and original-operation proof are read-only after key expiry", async () => {
  const { f, pending, task } = await fixture();
  f.time(31537001);
  const session = await restricted(f);
  // These methods must not accidentally obtain a reader or an ordinary writer.
  session.reader = () => assert.fail("task plaintext reader was used");
  session.ready = () => assert.fail("ordinary writer was used");
  assert.deepEqual(await session.inspectRenewalTaskPending(pending), pending);
  await session.verifyRenewalTaskReceipt(pending, task);
  for (const action of [
    () => session.openTask(task),
    () => session.validateTaskPending(pending),
    () =>
      session.sealTask({ current: null, content: {}, taskId: "task_other", resourceBindings: [] }),
    () => session.transitionTask({ current: task, action: "pause" }),
  ]) {
    // Restore the production guard for methods whose ready() entry point is the guard.
    delete session.ready;
    await assert.rejects(action(), /key_renewal_pending/);
  }
});
test("task reconciliation rejects locked, ordinary and foreign owner/vault sessions", async () => {
  const { f, pending, task } = await fixture();
  await assert.rejects(f.session.inspectRenewalTaskPending(pending), /invalid_operation/);
  await assert.rejects(new h.core.VaultCore(f.uid).inspectRenewalTaskPending(pending), /locked/);
  const other = await createOwner(h, "synthetic_other_owner"),
    session = await restricted(other);
  await assert.rejects(session.verifyRenewalTaskReceipt(pending, task));
  const changed = clone(pending);
  changed.body.extra = undefined;
  await assert.rejects((await restricted(f)).inspectRenewalTaskPending(changed));
});
test("operation proof requires the original full envelope, version, author, operation and proof bundle", async () => {
  const { f, pending, task } = await fixture(),
    session = await restricted(f);
  const mutations = [
    (v) => v.metadata.taskVersion++,
    (v) => v.metadata.objectRevision++,
    (v) => v.metadata.executionEpoch++,
    (v) => v.metadata.keyEpoch++,
    (v) => (v.metadata.taskId = "other_task"),
    (v) => (v.metadata.vaultId = "other_vault"),
    (v) => (v.metadata.status = "paused"),
    (v) => (v.metadata.envelopeFingerprint = "0".repeat(64)),
    (v) => v.metadata.resourceBindings.push({}),
    (v) => v.keyProofs.certificates.reverse(),
    (v) => (v.signedObject.signature = "A".repeat(v.signedObject.signature.length)),
    (v) => (v.metadata.updatedAt = iso(f.now() + 1)),
    (v) => (v.extra = undefined),
  ];
  for (const change of mutations) {
    const v = clone(task);
    change(v);
    await assert.rejects(session.verifyRenewalTaskReceipt(pending, v));
  }
  for (const change of [
    (p) => (p.authorKeyId = f.vault.rootKeyId),
    (p) => (p.operationId = "other_operation_0001"),
    (p) => (p.taskId = "other_task"),
    (p) => p.registrySequence++,
    (p) => p.keyEpoch++,
  ]) {
    const p = clone(pending);
    change(p);
    await assert.rejects(session.verifyRenewalTaskReceipt(p, task));
  }
  for (const value of [null, {}, { metadata: task.metadata }, { ...task, keyProofs: {} }])
    await assert.rejects(session.verifyRenewalTaskReceipt(pending, value));
});
test("updates authenticate only their original version and do not infer state from a later head", async () => {
  const { f, task: first } = await fixture();
  f.time(1001);
  const update = await createTask(h, f, { template: "custom", bindings: [], current: first });
  f.time(1002);
  const later = await createTask(h, f, { template: "custom", bindings: [], current: update.task });
  const session = await restricted(f);
  await session.verifyRenewalTaskReceipt(update.pending, update.task);
  const paused = clone(update.task);
  paused.metadata.status = "paused";
  await session.verifyRenewalTaskReceipt(update.pending, paused);
  const archived = clone(update.task);
  archived.metadata.status = "archived";
  await assert.rejects(session.verifyRenewalTaskReceipt(update.pending, archived));
  await assert.rejects(session.verifyRenewalTaskReceipt(update.pending, later.task));
});
test("all transitions bind original signed action and next execution epoch", async () => {
  const { f, task: first } = await fixture();
  let current = first;
  for (const action of ["pause", "resume", "archive"]) {
    f.time(f.now() + 1);
    const pending = await f.session.transitionTask({ current, action }),
      value = transitionResponse(f, pending, current),
      session = await restricted(f);
    await session.inspectRenewalTaskPending(pending);
    await session.verifyRenewalTaskReceipt(pending, value);
    for (const change of [
      (v) => v.metadata.executionEpoch++,
      (v) => (v.metadata.status = v.metadata.status === "active" ? "paused" : "active"),
    ]) {
      const wrong = clone(value);
      change(wrong);
      await assert.rejects(session.verifyRenewalTaskReceipt(pending, wrong));
    }
    const tampered = clone(pending);
    tampered.body.transitionIntent.signature = "A".repeat(
      tampered.body.transitionIntent.signature.length,
    );
    await assert.rejects(session.verifyRenewalTaskReceipt(tampered, value));
    current = value;
  }
});
test("renewal and later revocation preserve a genuine earlier task commit but reject a later acceptance time", async () => {
  const { f, pending, task } = await fixture();
  f.time(2000);
  const state = await lifecycleState(h, f),
    old = await restricted(f),
    candidate = await old.prepareKeyRenewal(f.vault, state),
    accepted = await renewalAccepted(h, f.vault, state, candidate.packet, f.now()),
    done = await old.finishKeyRenewal(
      accepted.vault,
      accepted.state,
      candidate.record,
      accepted.receipt,
    );
  f.vault = accepted.vault;
  f.local = done.record;
  f.time(31539001);
  const session = await restricted(f);
  await session.inspectRenewalTaskPending(pending);
  await session.verifyRenewalTaskReceipt(pending, task);
  const late = clone(task);
  late.metadata.createdAt = late.metadata.updatedAt = iso(2001);
  await assert.rejects(session.verifyRenewalTaskReceipt(pending, late));
  const expired = clone(task);
  expired.metadata.createdAt = expired.metadata.updatedAt = iso(31538000);
  await assert.rejects(session.verifyRenewalTaskReceipt(pending, expired));
});
test("initial task acceptance cannot claim a trusted earlier directory after a newer checkpoint", async () => {
  const { f, pending, task } = await fixture();
  f.time(1500);
  const successor = await f.session.bundle(
    clone(f.session.registry.bundle.entries),
    f.session.registry,
  );
  f.vault = { ...f.vault, version: 2, registryHistory: [...f.vault.registryHistory, successor] };
  f.local = await f.session.acceptVault(f.vault);
  f.time(1600);
  const session = await restricted(f);
  await session.verifyRenewalTaskReceipt(pending, task);
  const late = clone(task);
  late.metadata.createdAt = late.metadata.updatedAt = iso(1600);
  await assert.rejects(session.verifyRenewalTaskReceipt(pending, late), /registry_conflict/);
});
test("inspection finds the actual authorization intersection when an omitted recipient had already expired", async () => {
  const f = await createOwner(h),
    other = (await f.session.makeDevice()).device,
    extra = decoded(await f.session.certificate("device_enc", other.encJwk, other.deviceId));
  extra.expiresAt = 1010;
  const entries = [
      ...clone(f.session.registry.bundle.entries),
      { certificate: await signed(f, extra), active: true },
    ],
    successor = await f.session.bundle(entries, f.session.registry);
  f.vault = { ...f.vault, version: 2, registryHistory: [...f.vault.registryHistory, successor] };
  f.local = await f.session.acceptVault(f.vault);
  f.time(1020);
  const { pending, task } = await createTask(h, f, { template: "custom", bindings: [] }),
    session = await restricted(f);
  assert.equal(
    decoded(pending.body.envelope.signedObject).context.recipients.some(
      (r) => r.keyId === extra.keyId,
    ),
    false,
  );
  await session.inspectRenewalTaskPending(pending);
  await session.verifyRenewalTaskReceipt(pending, task);
});
test("a root-authenticated directory with no common author and recipient authorization interval cannot inspect an upload", async () => {
  const { f, pending } = await fixture(),
    entries = clone(f.session.registry.bundle.entries);
  for (const e of entries) {
    const c = decoded(e.certificate);
    if (c.role === "device_sig") c.expiresAt = 1005;
    if (c.role === "recovery_enc") c.notBefore = 1005;
    e.certificate = await signed(f, c);
  }
  const first = await f.session.bundle(entries),
    cp = decoded(first.checkpoint),
    changed = clone(pending),
    message = decoded(changed.body.envelope.signedObject);
  changed.checkpointDigest = message.context.checkpointDigest = await h.core.sha(
    h.core.canonical(cp),
  );
  message.jwe.aad = h.core.b64(new TextEncoder().encode(h.core.canonical(message.context)));
  changed.body.envelope.signedObject = await signed(f, message, true);
  changed.envelopeFingerprint = await h.core.signingFingerprint(changed.body.envelope.signedObject);
  f.vault = { ...f.vault, registryHistory: [first] };
  f.time(1010);
  const session = new h.core.VaultCore(f.uid, f.now);
  await session.unlockForKeyRenewal(f.vault, f.material());
  await assert.rejects(session.inspectRenewalTaskPending(changed), /key_revoked/);
});

async function uploadReply(packet, outcome = "cancelled") {
  const p = decoded(packet.body.command);
  return {
    contractVersion: h.core.CONTRACT,
    profile: p.profile,
    command: clone(packet.body.command),
    receipt: {
      ...Object.fromEntries(
        ["cancellationId", "ownerSubject", "vaultId", "rootKeyId", "rootEpoch", "target"].map(
          (k) => [k, clone(p[k])],
        ),
      ),
      commandFingerprint: await h.core.signingFingerprint(packet.body.command),
      outcome,
      acceptedAt: 31537001,
    },
  };
}
for (const kind of ["task", "holdings"]) {
  test(`${kind} cancellation signs only the original encrypted upload under Root after device expiry`, async () => {
    const f = await createOwner(h),
      fixture =
        kind === "task"
          ? await createTask(h, f, { template: "custom", bindings: [] })
          : await require("./full-flow-crypto-fixture.cjs").importHoldings(h, f);
    f.time(31537001);
    const session = await restricted(f);
    session.reader = () => assert.fail("No plaintext reader");
    session.ready = () => assert.fail("No device writer");
    const packet = await session.prepareUploadCancellation(kind, fixture.pending),
      payload = decoded(packet.body.command);
    assert.equal(payload.profile, `folioview.${kind}-upload-cancellation.v1`);
    assert.equal(payload.target.operationId, fixture.pending.operationId);
    assert.equal(Object.hasOwn(payload, "expiresAt"), false);
    assert.equal(Object.hasOwn(payload, "registrySequence"), false);
    const response = await uploadReply(packet);
    assert.deepEqual(
      await session.verifyUploadCancellationReceipt(kind, fixture.pending, packet, response),
      { outcome: "cancelled" },
    );
    response.receipt.outcome = "saved";
    assert.deepEqual(
      await session.verifyUploadCancellationReceipt(kind, fixture.pending, packet, response),
      { outcome: "saved" },
    );
    await assert.rejects(f.session.prepareUploadCancellation(kind, fixture.pending));
    await assert.rejects(
      new h.core.VaultCore(f.uid).prepareUploadCancellation(kind, fixture.pending),
    );
    const other = await createOwner(h, "synthetic_other_cancel_owner");
    await assert.rejects(
      (await restricted(other)).validateUploadCancellation(kind, fixture.pending, packet),
    );
  });
  test(`${kind} cancellation binds every original target and rejects mutated receipts and commands`, async () => {
    const f = await createOwner(h),
      fixture =
        kind === "task"
          ? await createTask(h, f, { template: "custom", bindings: [] })
          : await require("./full-flow-crypto-fixture.cjs").importHoldings(h, f),
      session = await restricted(f),
      packet = await session.prepareUploadCancellation(kind, fixture.pending),
      reply = await uploadReply(packet);
    for (const mutate of [
      (v) => (v.receipt.target.operationId = "synthetic_other_operation_0001"),
      (v) => v.receipt.rootEpoch++,
      (v) => (v.receipt.cancellationId = "synthetic_other_cancellation_1"),
      (v) => (v.receipt.commandFingerprint = "a".repeat(64)),
      (v) => (v.receipt.outcome = "missing"),
      (v) => (v.receipt.acceptedAt = -1),
      (v) => (v.receipt.extra = true),
      (v) => (v.profile = "wrong"),
      (v) => (v.command.signature = "A".repeat(86)),
    ]) {
      const value = clone(reply);
      mutate(value);
      await assert.rejects(
        session.verifyUploadCancellationReceipt(kind, fixture.pending, packet, value),
      );
    }
    const changed = clone(packet),
      p = decoded(packet.body.command);
    p.target.packetDigest = "0".repeat(64);
    changed.body.command = await signed(f, p);
    await assert.rejects(session.validateUploadCancellation(kind, fixture.pending, changed));
    const foreign = clone(fixture.pending);
    foreign.operationId = "synthetic_other_operation_0001";
    await assert.rejects(session.validateUploadCancellation(kind, foreign, packet));
    const variant = clone(reply);
    variant.command = await signed(f, decoded(packet.body.command));
    assert.equal(
      await h.core.signingFingerprint(variant.command),
      reply.receipt.commandFingerprint,
    );
    await session.verifyUploadCancellationReceipt(kind, fixture.pending, packet, variant);
  });
}
test("a later Root-only unlock replays the exact cancellation after key renewal", async () => {
  const { f, pending } = await fixture(),
    old = await restricted(f),
    packet = await old.prepareUploadCancellation("task", pending),
    reply = await uploadReply(packet);
  f.time(2000);
  const state = await lifecycleState(h, f),
    candidate = await old.prepareKeyRenewal(f.vault, state),
    accepted = await renewalAccepted(h, f.vault, state, candidate.packet, f.now()),
    done = await old.finishKeyRenewal(
      accepted.vault,
      accepted.state,
      candidate.record,
      accepted.receipt,
    );
  const later = new h.core.VaultCore(f.uid, f.now);
  await later.unlockForKeyRenewal(accepted.vault, f.material(), {
    pin: done.record.pin,
    device: done.record.device,
  });
  await later.validateUploadCancellation("task", pending, packet);
  await later.verifyUploadCancellationReceipt("task", pending, packet, reply);
});
