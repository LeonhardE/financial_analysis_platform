const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { transformSync } = require("next/dist/build/swc");
const {
  createHarness,
  createOwner,
  importHoldings,
  clone,
  decoded,
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
  await f.session.unlock(f.vault, f.material(), { pin: f.local.pin, device: f.local.device });
  const holdings = await importHoldings(h, f);
  return { f, ...holdings };
}
async function restricted(f) {
  const session = new h.core.VaultCore(f.uid, f.now);
  await session.unlockForKeyRenewal(f.vault, f.material(), {
    pin: f.local.pin,
    device: f.local.device,
  });
  return session;
}
async function signedPacket(f, pending, modify) {
  const value = clone(pending),
    message = decoded(value.carrier.signedObject);
  modify(message, value);
  const signed = await new h.jose.FlattenedSign(new TextEncoder().encode(h.core.canonical(message)))
    .setProtectedHeader({
      alg: "ES256",
      kid: pending.authorKeyId,
      typ: "fv-object+jws",
      cty: "application/json",
    })
    .sign(f.session.device.sig);
  value.carrier.signedObject = signed;
  return value;
}

test("root-only reconciliation authenticates expired original ciphertext and both GETs without permitting ordinary operations", async () => {
  const { f, pending, response, source } = await fixture();
  f.time(31537001);
  const session = await restricted(f);
  assert.deepEqual(await session.inspectRenewalHoldingsPending(pending), pending);
  assert.equal(
    await session.verifyRenewalHoldingsReceipt(pending, response.receipt, response),
    undefined,
  );
  for (const action of [
    () => session.validatePending(pending),
    () => session.verifyReceipt(pending, response.receipt),
    () => session.openSnapshot(response, source),
    () => session.signSource(source.resourceRef.resourceId),
    () => session.sealSnapshot({ content: {}, source, expectedRevision: 1 }),
    () => session.validateTaskPending({}),
  ])
    await assert.rejects(action(), /key_renewal_pending/);
});

test("the same reconciliation authenticates an ordinary unlocked root session and rejects a locked or foreign vault", async () => {
  const { f, pending, response } = await fixture();
  await f.session.verifyRenewalHoldingsReceipt(pending, response.receipt, response);
  await assert.rejects(
    new h.core.VaultCore(f.uid).inspectRenewalHoldingsPending(pending),
    /locked/,
  );
  const other = await createOwner(h, "synthetic_owner_B");
  await other.session.unlock(other.vault, other.material(), {
    pin: other.local.pin,
    device: other.local.device,
  });
  await assert.rejects(other.session.inspectRenewalHoldingsPending(pending), /binding_mismatch/);
});

test("inspection authenticates a packet only; absent or incomplete storage evidence never confirms a save", async () => {
  const { f, pending, response } = await fixture(),
    session = await restricted(f);
  assert.deepEqual(await session.inspectRenewalHoldingsPending(pending), pending);
  for (const value of [null, {}, { receipt: response.receipt }, { ...response, keyProofs: {} }])
    await assert.rejects(session.verifyRenewalHoldingsReceipt(pending, response.receipt, value));
  await assert.rejects(session.verifyRenewalHoldingsReceipt(pending, null, response));
});

test("a later renewal and revoked historical keys do not erase a valid pre-renewal storage proof", async () => {
  const { f, pending, response } = await fixture();
  f.time(2000);
  const state = await lifecycleState(h, f),
    original = await restricted(f),
    candidate = await original.prepareKeyRenewal(f.vault, state),
    accepted = await renewalAccepted(h, f.vault, state, candidate.packet, f.now()),
    done = await original.finishKeyRenewal(
      accepted.vault,
      accepted.state,
      candidate.record,
      accepted.receipt,
    );
  f.vault = accepted.vault;
  f.local = done.record;
  f.time(31539001);
  const session = await restricted(f);
  await session.verifyRenewalHoldingsReceipt(pending, response.receipt, response);
  const sameSecond = clone(response);
  sameSecond.receipt.storedAt = new Date(2000999).toISOString();
  await session.verifyRenewalHoldingsReceipt(pending, sameSecond.receipt, sameSecond);
  const late = clone(response);
  late.receipt.storedAt = new Date(2001 * 1000).toISOString();
  await assert.rejects(session.verifyRenewalHoldingsReceipt(pending, late.receipt, late));
});

test("an authenticated older global epoch remains inspectable under a newer pinned directory", async () => {
  const { f, pending, response } = await fixture();
  f.time(2000);
  const successor = await f.session.bundle(
    clone(f.vault.registryHistory[0].entries),
    f.session.registry,
  );
  const checkpoint = { ...decoded(successor.checkpoint), keyEpoch: 2 };
  successor.checkpoint = await new h.jose.FlattenedSign(
    new TextEncoder().encode(h.core.canonical(checkpoint)),
  )
    .setProtectedHeader({
      alg: "ES256",
      kid: f.vault.rootKeyId,
      typ: "fv-control+jws",
      cty: "application/json",
    })
    .sign(f.session.root);
  f.vault = {
    ...f.vault,
    version: 2,
    registryHistory: [...f.vault.registryHistory, successor],
  };
  f.local = await f.session.acceptVault(f.vault);
  const session = await restricted(f);
  assert.equal(decoded(pending.carrier.signedObject).context.keyEpoch, 1);
  assert.equal(f.local.pin.keyEpoch, 2);
  await session.verifyRenewalHoldingsReceipt(pending, response.receipt, response);
  f.time(2001);
  const late = clone(response);
  late.receipt.storedAt = new Date(2001000).toISOString();
  await assert.rejects(session.verifyRenewalHoldingsReceipt(pending, late.receipt, late));
});

test("unchanged and unrelated device checkpoints permit a replica's older upload; subsequent key replacement does not", async () => {
  const { f, pending, response } = await fixture();
  const advance = async (registryBundle) => {
    f.vault = {
      ...f.vault,
      version: f.vault.version + 1,
      registryHistory: [...f.vault.registryHistory, registryBundle],
    };
    f.local = await f.session.acceptVault(f.vault);
  };
  const savedAt = (seconds) => {
    const value = clone(response);
    value.receipt.storedAt = new Date(seconds * 1000).toISOString();
    return value;
  };
  f.time(1500);
  await advance(
    await f.session.bundle(clone(f.session.registry.bundle.entries), f.session.registry),
  );
  f.time(1600);
  let session = await restricted(f),
    value = savedAt(1600);
  await session.verifyRenewalHoldingsReceipt(pending, value.receipt, value);
  f.time(2000);
  const other = (await f.session.makeDevice()).device;
  const entries = clone(f.session.registry.bundle.entries);
  for (const [role, jwk] of [
    ["device_sig", other.sigJwk],
    ["device_enc", other.encJwk],
  ])
    entries.push({
      certificate: await f.session.certificate(role, jwk, other.deviceId),
      active: true,
    });
  await advance(await f.session.bundle(entries, f.session.registry));
  f.time(2100);
  session = await restricted(f);
  value = savedAt(2100);
  await session.verifyRenewalHoldingsReceipt(pending, value.receipt, value);
  f.time(3000);
  const change = await f.session.prepareDeviceChange({
    vault: f.vault,
    action: "rotate",
    deviceId: f.session.device.deviceId,
  });
  f.vault = {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, change.registryBundle],
  };
  f.time(3100);
  session = await restricted(f);
  await session.verifyRenewalHoldingsReceipt(pending, value.receipt, value);
  value = savedAt(3100);
  await assert.rejects(
    session.verifyRenewalHoldingsReceipt(pending, value.receipt, value),
    /key_revoked/,
  );
});

test("both GETs must identify the exact owner, source, incarnation, object, operation and ciphertext fingerprint", async () => {
  const { f, pending, response } = await fixture(),
    session = await restricted(f);
  const mutations = [
    (r) => (r.contractVersion = "other"),
    (r) => (r.vaultId = "different_vault"),
    (r) => (r.resourceRef.resourceId = "different_source"),
    (r) => (r.resourceRef.incarnation = "different_incarnation"),
    (r) => (r.snapshotId = "different_snapshot"),
    (r) => r.revision++,
    (r) => r.sourceEpoch++,
    (r) => (r.stableOperationId = "different_operation_0001"),
    (r) => (r.envelopeFingerprint = "0".repeat(64)),
    (r) => (r.snapshotPath = "/api/v2/holdings/sources/different/snapshots/object"),
    (r) => (r.extra = true),
  ];
  for (const mutate of mutations) {
    const value = clone(response);
    mutate(value.receipt);
    await assert.rejects(session.verifyRenewalHoldingsReceipt(pending, value.receipt, value));
  }
  const independent = clone(response.receipt);
  independent.storedAt = new Date(1001 * 1000).toISOString();
  await assert.rejects(session.verifyRenewalHoldingsReceipt(pending, independent, response));
});

test("matching signing-input fingerprint cannot substitute different signature bytes or unauthenticated key proofs", async () => {
  const { f, pending, response } = await fixture(),
    session = await restricted(f),
    alternate = await signedPacket(f, pending, () => {});
  assert.equal(
    await h.core.signingFingerprint(alternate.carrier.signedObject),
    response.receipt.envelopeFingerprint,
  );
  assert.notDeepEqual(alternate.carrier.signedObject, pending.carrier.signedObject);
  await assert.rejects(
    session.verifyRenewalHoldingsReceipt(pending, response.receipt, {
      ...response,
      carrier: alternate.carrier,
    }),
  );
  for (const mutate of [
    (v) => v.keyProofs.certificates.pop(),
    (v) => v.keyProofs.certificates.push(v.keyProofs.certificates[0]),
    (v) => (v.keyProofs.checkpoint.signature = "A".repeat(86)),
  ]) {
    const value = clone(response);
    mutate(value);
    await assert.rejects(session.verifyRenewalHoldingsReceipt(pending, value.receipt, value));
  }
});

test("malformed, future and certificate-expired saved times cannot clear an upload", async () => {
  const { f, pending, response } = await fixture(),
    author = decoded(
      f.vault.registryHistory[0].entries.find(
        (e) => decoded(e.certificate).keyId === pending.authorKeyId,
      ).certificate,
    ),
    session = await restricted(f);
  const fractional = clone(response);
  fractional.receipt.storedAt = new Date(1000001).toISOString();
  await assert.rejects(
    session.verifyRenewalHoldingsReceipt(pending, fractional.receipt, fractional),
  );
  f.time(author.expiresAt + 100);
  for (const storedAt of [
    "not-a-date",
    "1970-02-31T00:00:00.000Z",
    "1970-01-01T00:16:40+00:00",
    new Date(999000).toISOString(),
    new Date((f.now() + 1) * 1000).toISOString(),
    new Date(author.expiresAt * 1000).toISOString(),
  ]) {
    const value = clone(response);
    value.receipt.storedAt = storedAt;
    await assert.rejects(session.verifyRenewalHoldingsReceipt(pending, value.receipt, value));
  }
});

test("a recipient's shorter validity bounds storage even when the author remains valid", async () => {
  const f = await createOwner(h),
    entries = clone(f.vault.registryHistory[0].entries),
    recovery = entries.find((entry) => decoded(entry.certificate).role === "recovery_enc"),
    certificate = { ...decoded(recovery.certificate), expiresAt: 1001 };
  recovery.certificate = await new h.jose.FlattenedSign(
    new TextEncoder().encode(h.core.canonical(certificate)),
  )
    .setProtectedHeader({
      alg: "ES256",
      kid: f.vault.rootKeyId,
      typ: "fv-control+jws",
      cty: "application/json",
    })
    .sign(f.session.root);
  f.vault.registryHistory = [await f.session.bundle(entries)];
  const device = f.local.device;
  f.session = new h.core.VaultCore(f.uid, f.now);
  await f.session.unlock(f.vault, f.material(), { device });
  f.local = await f.session.acceptVault(f.vault);
  const { pending, response } = await importHoldings(h, f);
  f.time(2000);
  const session = await restricted(f);
  await session.verifyRenewalHoldingsReceipt(pending, response.receipt, response);
  const late = clone(response);
  late.receipt.storedAt = new Date(1001 * 1000).toISOString();
  await assert.rejects(
    session.verifyRenewalHoldingsReceipt(pending, late.receipt, late),
    /key_revoked/,
  );
});

test("signed packets with altered binding, history, recipient or JWE framing are refused during inspection", async () => {
  const { f, pending } = await fixture(),
    session = await restricted(f);
  for (const modify of [
    (m) => (m.context.checkpointDigest = "0".repeat(64)),
    (m) => m.context.registrySequence++,
    (m) => m.context.keyEpoch++,
    (m) => m.context.expectedRevision++,
    (m) => (m.context.deliveryRevision = 2),
    (m) => (m.context.stableOperationId = "different_operation_0001"),
    (m) => (m.context.binding.sourceEpoch = 2),
    (m) => m.context.recipients.pop(),
    (m) => m.context.recipients.reverse(),
    (m) => (m.jwe.aad = "e30"),
    (m) => (m.jwe.recipients[0].header.kid = "A".repeat(43)),
    (m) => (m.jwe.recipients[0].header.epk.x = "A".repeat(43)),
    (m) => (m.jwe.iv = "A".repeat(15)),
    (m) => (m.jwe.ciphertext = "A"),
    (m) => (m.jwe.protected = h.core.b64(new TextEncoder().encode('{"alg":"dir"}'))),
  ])
    await assert.rejects(
      session.inspectRenewalHoldingsPending(await signedPacket(f, pending, modify)),
    );
  const badSignature = clone(pending);
  badSignature.carrier.signedObject.signature = "A".repeat(86);
  await assert.rejects(session.inspectRenewalHoldingsPending(badSignature));
});

test("the actual serialized Worker dispatcher exposes only the two read-only reconciliation RPCs", async () => {
  const { f, pending, response, source } = await fixture(),
    file = path.resolve(__dirname, "../lib/encrypted-vault.worker.ts");
  let { code } = transformSync(fs.readFileSync(file, "utf8"), {
    filename: file,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  let VaultError;
  try {
    new h.core.VaultCore("");
  } catch (error) {
    VaultError = error.constructor;
  }
  const replies = new Map(),
    realm = {
      require: (name) => {
        if (name === "./encrypted-core") return h.core;
        if (name === "./encrypted-types") return { VaultError };
        throw new Error("unexpected import");
      },
      exports: {},
      ArrayBuffer,
      Uint8Array,
      postMessage: ({ id, ...reply }) => replies.get(id)(reply),
    };
  vm.runInNewContext(code, realm);
  let next = 0;
  const call = (method, args) =>
    new Promise((resolve) => {
      const id = ++next;
      replies.set(id, resolve);
      realm.onmessage({ data: { id, method, args } });
    });
  assert.equal((await call("init", { uid: f.uid })).ok, true);
  assert.equal(
    (
      await call("unlockForKeyRenewal", {
        vault: f.vault,
        material: f.material(),
        local: { pin: f.local.pin, device: f.local.device },
      })
    ).ok,
    true,
  );
  assert.deepEqual((await call("inspectRenewalHoldingsPending", { pending })).result, pending);
  assert.equal(
    (
      await call("verifyRenewalHoldingsReceipt", {
        pending,
        receipt: response.receipt,
        value: response,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await call("openSnapshot", { value: response, source })).error,
    "key_renewal_pending",
  );
  assert.equal(
    (await call("signSource", { sourceId: source.resourceRef.resourceId })).error,
    "key_renewal_pending",
  );
});
