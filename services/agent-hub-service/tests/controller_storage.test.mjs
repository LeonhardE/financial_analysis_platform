import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { CiphertextOutbox } from "../helper/dist/controller.mjs";
import { IDBFactory } from "./fixtures/idb-runtime.mjs";
const original = JSON.parse(await readFile(process.env.FV_CONTROLLER_CIPHER_RECORD, "utf8"));
const copy = (value) => structuredClone(value),
  scope = original.scope,
  pending = { ...copy(original), receipt: null };
function pair(t) {
  const indexedDB = new IDBFactory(),
    one = new CiphertextOutbox({ indexedDB }),
    two = new CiphertextOutbox({ indexedDB });
  t.after(async () => {
    await one.close();
    await two.close();
  });
  return { indexedDB, one, two };
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function changedPacket(operation, mutate = () => {}) {
  const packet = copy(original.packet),
    message = JSON.parse(Buffer.from(packet.envelope.signedObject.payload, "base64url"));
  if (operation) {
    packet.stableOperationId = operation;
    message.context.stableOperationId = operation;
  }
  mutate(message);
  message.jwe.aad = Buffer.from(canonical(message.context)).toString("base64url");
  packet.envelope.signedObject.payload = Buffer.from(canonical(message)).toString("base64url");
  packet.envelopeFingerprint = createHash("sha256")
    .update(packet.envelope.signedObject.protected + "." + packet.envelope.signedObject.payload)
    .digest("hex");
  return packet;
}
test("production outbox transactions keep exact concurrent packets and idempotent receipts across two tabs", async (t) => {
  const { one, two } = pair(t);
  const staged = await Promise.all([one.stage(scope, pending), two.stage(scope, pending)]);
  assert.deepEqual(staged[0], staged[1]);
  const accepted = await Promise.all([
    one.accept(
      scope,
      pending.packet.stableOperationId,
      pending.packet.envelopeFingerprint,
      original.receipt,
    ),
    two.accept(
      scope,
      pending.packet.stableOperationId,
      pending.packet.envelopeFingerprint,
      original.receipt,
    ),
  ]);
  assert.deepEqual(accepted[0], accepted[1]);
  assert.deepEqual((await one.list(scope))[0].receipt, original.receipt);
});
test("a competing changed original operation cannot overwrite its first ciphertext winner", async (t) => {
  const { one, two } = pair(t);
  await one.stage(scope, pending);
  const packet = changedPacket(null, (message) => {
    message.jwe.ciphertext =
      (message.jwe.ciphertext[0] === "A" ? "B" : "A") + message.jwe.ciphertext.slice(1);
  });
  await assert.rejects(() => two.stage(scope, { ...pending, packet }), /outbox_conflict/);
  assert.deepEqual((await one.list(scope))[0].packet, pending.packet);
});
test("different owners and different agents cannot list, acknowledge or import another scope's packets", async (t) => {
  const { one } = pair(t);
  await one.stage(scope, pending);
  for (const other of [
    { ...scope, ownerSubject: "owner_synthetic_B" },
    { ...scope, connectionId: "connection_synthetic_A2", agentPrincipalId: "agent_synthetic_A2" },
  ]) {
    assert.deepEqual(await one.list(other), []);
    await assert.rejects(() => one.stage(other, pending), /record_binding_mismatch/);
    await assert.rejects(
      () =>
        one.accept(
          other,
          pending.packet.stableOperationId,
          pending.packet.envelopeFingerprint,
          original.receipt,
        ),
      /outbox_conflict/,
    );
  }
});
test("credentials, plaintext properties, malformed carriers and replacement receipts fail before persistence", async (t) => {
  const { one } = pair(t);
  for (const bad of [
    { ...pending, accessToken: "A".repeat(43) },
    { ...pending, report: "SYNTHETIC_PRIVATE_REPORT" },
    {
      ...pending,
      packet: { ...pending.packet, envelope: { ...pending.packet.envelope, privateKey: {} } },
    },
  ])
    await assert.rejects(() => one.stage(scope, bad));
  assert.deepEqual(await one.list(scope), []);
  await one.stage(scope, pending);
  await assert.rejects(() =>
    one.accept(scope, pending.packet.stableOperationId, pending.packet.envelopeFingerprint, {
      ...original.receipt,
      envelopeFingerprint: "0".repeat(64),
    }),
  );
  assert.equal((await one.list(scope))[0].receipt, null);
});
test("outbox capacity is bounded and explicit discard compares the original fingerprint", async (t) => {
  const { one } = pair(t);
  for (let index = 0; index < 32; index++)
    await one.stage(scope, {
      ...pending,
      packet: changedPacket(`synthetic_store_operation_${index}`),
    });
  await assert.rejects(
    () => one.stage(scope, { ...pending, packet: changedPacket("synthetic_store_operation_33") }),
    /outbox_capacity/,
  );
  const rows = await one.list(scope);
  assert.equal(rows.length, 32);
  await assert.rejects(
    () => one.discard(scope, rows[0].packet.stableOperationId, "0".repeat(64)),
    /outbox_conflict/,
  );
  assert.equal((await one.list(scope)).length, 32);
  await one.discard(scope, rows[0].packet.stableOperationId, rows[0].packet.envelopeFingerprint);
  assert.equal((await one.list(scope)).length, 31);
});
