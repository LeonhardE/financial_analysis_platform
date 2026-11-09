import { validate, parsed, bytes } from "../dist/core.mjs";
/** Shared executor safety, recovery and cross-language compatibility tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, copyFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  verifyExecutorApproval,
  verifyExecutorLease,
  verifyExecutorRecovery,
  verifyExecutorTransition,
  checkExecutorRetry,
  validateExecutorSchema,
} from "../../executor-trust/dist/core.mjs";
import {
  nodeSign,
  signingFingerprint,
  hash,
  testKeyId,
  publicPart,
  publicTestKey,
} from "../../executor-trust/tests/executor-trust-fixture.mjs";
const vector = JSON.parse(
  await readFile(
    new URL("../../../services/common/tests/fixtures/executor_trust_node.json", import.meta.url),
    "utf8",
  ),
);
const fresh = () => structuredClone(vector);
function options(v) {
  return {
    expectedBinding: v.binding,
    rootJwk: v.rootPublicJwk,
    policyJwk: v.policyPublicJwk,
    currentCheckpoint: v.checkpoint,
    challenge: v.challenge,
    challengeUsed: false,
    expectedOperation: v.operation,
    purpose: "recover",
    now: 1001,
  };
}
const lease = (v, changes = {}) =>
  verifyExecutorLease(v.approvalSigned, v.checkpointSigned, v.leaseSigned, {
    ...options(v),
    ...changes,
  });
const recovery = (v, changes = {}) =>
  verifyExecutorRecovery(v.recoverySigned, {
    ...options(v),
    agentJwk: v.agentPublicJwk,
    expectedReceipts: [v.receipt],
    approvalSigned: v.approvalSigned,
    checkpointSigned: v.checkpointSigned,
    leaseSigned: v.leaseSigned,
    ...changes,
  });
const transition = (v, type, changes = {}) =>
  verifyExecutorTransition(v[type + "Signed"], {
    ...options(v),
    approvalSigned: v.approvalSigned,
    checkpointSigned: v.checkpointSigned,
    expectedNextBinding: v[type].nextBinding,
    ...changes,
  });

test("independent public Node vector verifies exact Root, Policy, Agent and original receipt bindings", async () => {
  const v = fresh();
  assert.deepEqual(await verifyExecutorApproval(v.approvalSigned, options(v)), v.approval);
  assert.deepEqual(await lease(v), v.lease);
  assert.deepEqual(await recovery(v), v.recovery);
  assert.deepEqual(await transition(v, "upgrade"), v.upgrade);
  assert.deepEqual(await transition(v, "migration"), v.migration);
  assert.deepEqual(
    checkExecutorRetry(v.operation, v.receipt, { expectedOperation: v.operation }),
    v.receipt,
  );
});
test("all trusted binding fields are selected independently; request claims cannot select their own trust", async () => {
  const v = fresh();
  for (const field of Object.keys(v.binding)) {
    const b = structuredClone(v.binding);
    b[field] =
      field === "identityEpoch"
        ? 2
        : field === "recipientKeyIds"
          ? [await testKeyId(18)]
          : field.endsWith("KeyId")
            ? await testKeyId(18)
            : ["bindingFingerprint", "scopeDigest", "workloadDigest"].includes(field)
              ? "0".repeat(64)
              : ["issuer", "audience"].includes(field)
                ? "https://other.example.invalid"
                : "substitution";
    await assert.rejects(() => lease(v, { expectedBinding: b }), field);
  }
  await assert.rejects(() => lease(v, { rootJwk: v.policyPublicJwk }));
  await assert.rejects(() => lease(v, { policyJwk: v.rootPublicJwk }));
  v.approvalSigned = await nodeSign(v.approval, 12);
  await assert.rejects(() => lease(v));
});
test("lease rejects wrong purpose, request, nonce, used challenge, stale checkpoint and revoked authority", async () => {
  const v = fresh();
  for (const change of [
    { purpose: "execute" },
    { purpose: "write_report" },
    { purpose: "unsupported" },
    { challengeUsed: true },
    { challengeUsed: undefined },
    { now: 1080 },
    { now: 999 },
    { challenge: { ...v.challenge, nonce: Buffer.alloc(32, 8).toString("base64url") } },
    { expectedOperation: { ...v.operation, requestDigest: "0".repeat(64) } },
    { currentCheckpoint: { ...v.checkpoint, stateVersion: 4 } },
    { currentCheckpoint: { ...v.checkpoint, authorizationEpoch: 3 } },
    { currentCheckpoint: { ...v.checkpoint, stateHead: "0".repeat(64) } },
  ])
    await assert.rejects(() => lease(v, change));
  for (const field of [
    "revoked",
    "stateVersion",
    "authorizationEpoch",
    "stateHead",
    "bindingDigest",
    "approvalFingerprint",
  ]) {
    const x = fresh();
    x.checkpoint[field] =
      field === "revoked"
        ? true
        : ["stateVersion", "authorizationEpoch"].includes(field)
          ? 4
          : "0".repeat(64);
    x.checkpointSigned = await nodeSign(x.checkpoint, 12);
    await assert.rejects(() => lease(x));
  }
});
test("signed expiry extensions, cross-profile messages, oversized and noncanonical controls fail closed", async () => {
  for (const [target, scalar, change] of [
    ["approval", 11, { expiresAt: 900 + 30 * 86400 + 1 }],
    ["checkpoint", 12, { expiresAt: 1111 }],
    ["lease", 12, { expiresAt: 1081 }],
    ["lease", 12, { issuedAt: 994 }],
    ["lease", 12, { profile: "folioview.persistent-content.v1" }],
    ["lease", 12, { extra: "field" }],
  ]) {
    const v = fresh();
    Object.assign(v[target], change);
    v[target + "Signed"] = await nodeSign(v[target], scalar);
    await assert.rejects(() => lease(v));
  }
  const v = fresh();
  v.leaseSigned.extra = "x".repeat(32768);
  await assert.rejects(() => lease(v));
  assert.throws(() => parsed(new TextEncoder().encode('{"profile":1,"profile":2}')));
  assert.throws(() => validateExecutorSchema("UnknownExecutor", {}));
  assert.throws(() =>
    validateExecutorSchema("ExecutorBinding", { ...v.binding, privateKey: "forbidden" }),
  );
  assert.throws(() => validate("PersistentAgentBindingPayload", v.approval));
});
test("same-key recovery requires an Agent proof over latest state, original recipients and complete receipts", async () => {
  for (const field of [
    "recoveredBinding",
    "leaseFingerprint",
    "checkpointDigest",
    "stateHead",
    "receipts",
  ]) {
    const v = fresh();
    v.recovery[field] =
      field === "recoveredBinding"
        ? { ...v.binding, agentEncryptionKeyId: await testKeyId(19) }
        : field === "receipts"
          ? []
          : "0".repeat(64);
    v.recoverySigned = await nodeSign(v.recovery, 13);
    await assert.rejects(() => recovery(v));
  }
  const v = fresh();
  v.recoverySigned = await nodeSign(v.recovery, 11);
  await assert.rejects(() => recovery(v));
  await assert.rejects(() => recovery(fresh(), { agentJwk: publicPart(publicTestKey(18)) }));
  await assert.rejects(() => recovery(fresh(), { purpose: "execute" }));
});
test("code upgrades retain all keys/epoch/scope; migration requires explicit Root approval of the next epoch", async () => {
  for (const [kind, field, value] of [
    ["upgrade", "identityEpoch", 2],
    ["upgrade", "agentSigningKeyId", await testKeyId(18)],
    ["upgrade", "scopeDigest", "0".repeat(64)],
    ["upgrade", "workloadDigest", "a".repeat(64)],
    ["migration", "identityEpoch", 1],
    ["migration", "identityEpoch", 3],
    ["migration", "scopeDigest", "0".repeat(64)],
    ["migration", "agentSigningKeyId", vector.binding.agentSigningKeyId],
    ["migration", "agentEncryptionKeyId", vector.binding.agentEncryptionKeyId],
  ]) {
    const v = fresh();
    v[kind].nextBinding[field] = value;
    v[kind + "Signed"] = await nodeSign(v[kind], 11);
    await assert.rejects(() => transition(v, kind));
  }
  const v = fresh();
  v.migrationSigned = await nodeSign(v.migration, 12);
  await assert.rejects(() => transition(v, "migration"));
  await assert.rejects(() =>
    transition(fresh(), "migration", {
      currentCheckpoint: { ...vector.checkpoint, stateVersion: 4 },
    }),
  );
});
test("post-migration authoritative state fences an old lease and original retries cannot change bytes", async () => {
  const v = fresh(),
    cp = {
      ...v.checkpoint,
      bindingDigest: hash(v.migration.nextBinding),
      stateVersion: 4,
      authorizationEpoch: 3,
    };
  await assert.rejects(() => lease(v, { currentCheckpoint: cp }));
  for (const field of ["bindingDigest", "runId", "operationId", "requestDigest"]) {
    assert.throws(() =>
      checkExecutorRetry({ ...v.operation, [field]: "substitution" }, v.receipt, {
        expectedOperation: v.operation,
      }),
    );
  }
  const receipt = checkExecutorRetry(v.operation, v.receipt, { expectedOperation: v.operation });
  receipt.receiptId = "mutated";
  assert.equal(v.receipt.receiptId, "receipt-original");
  const checked = await recovery(v);
  checked.receipts.length = 0;
  assert.equal(v.recovery.receipts.length, 1);
});
test("executor browser schema is byte-equivalent to the packaged Python contract", async () => {
  const python = JSON.parse(
    await readFile(
      new URL(
        "../../../services/common/folioview_shared/encrypted/executor_trust.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const browser = JSON.parse(
    await readFile(new URL("../../executor-trust/schemas.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(browser, python);
  assert.equal(vector.generatedBy.privateKeysStored, false);
  function checkPublic(value) {
    if (value && typeof value === "object") {
      assert.equal(Object.hasOwn(value, "d"), false);
      for (const item of Object.values(value)) checkPublic(item);
    }
  }
  checkPublic(vector);
  assert.equal(bytes(vector.challenge.nonce).length, 32);
});

test("even Root-signed malformed trust configuration, key-role aliasing and invalid nonce encodings are rejected", async () => {
  for (const [field, value] of [
    ["issuer", "https://policy.example.invalid/"],
    ["issuer", "https://policy.example.invalid?x=1"],
    ["issuer", "https://policy.example.invalid\n"],
    ["issuer", "https://user@policy.example.invalid"],
    ["audience", "https://executor.example.invalid:443/mcp"],
    ["audience", "https://executor.example.invalid/a/../mcp"],
    ["audience", "https://executor.example.invalid/%6dcp"],
    ["audience", "http://executor.example.invalid/mcp"],
    ["recipientKeyIds", [vector.binding.rootKeyId]],
    ["tlsKeyId", vector.binding.agentEncryptionKeyId],
  ]) {
    const v = fresh();
    v.binding[field] = value;
    v.approval.binding = v.binding;
    v.approvalSigned = await nodeSign(v.approval, 11);
    await assert.rejects(() => verifyExecutorApproval(v.approvalSigned, options(v)));
  }
  const v = fresh();
  v.challenge.nonce = v.challenge.nonce.slice(0, -1) + "B";
  await assert.rejects(() => lease(v));
  const x = fresh(),
    raw = Buffer.from(x.leaseSigned.signature, "base64url");
  raw[0] ^= 1;
  x.leaseSigned.signature = raw.toString("base64url");
  await assert.rejects(() => lease(x));
});

test("approved upgrades and migrations recover original historical receipts without rebinding or new execution", async () => {
  for (const kind of ["upgrade", "migration"]) {
    const v = fresh();
    await transition(v, kind);
    const original = structuredClone(v.receipt);
    v.binding = structuredClone(v[kind].nextBinding);
    v.approval.binding = v.binding;
    v.approvalSigned = await nodeSign(v.approval, 11);
    const bd = hash(v.binding);
    v.checkpoint.bindingDigest = bd;
    v.checkpoint.approvalFingerprint = signingFingerprint(v.approvalSigned);
    v.checkpoint.stateVersion++;
    v.checkpoint.authorizationEpoch++;
    v.checkpointSigned = await nodeSign(v.checkpoint, 12);
    v.challenge.bindingDigest = bd;
    v.operation.bindingDigest = bd;
    v.lease.bindingDigest = bd;
    v.lease.challenge = v.challenge;
    v.lease.operation = v.operation;
    v.lease.checkpointDigest = hash(v.checkpoint);
    v.leaseSigned = await nodeSign(v.lease, 12);
    v.recovery.recoveredBinding = v.binding;
    v.recovery.checkpointDigest = hash(v.checkpoint);
    v.recovery.leaseFingerprint = signingFingerprint(v.leaseSigned);
    const scalar = kind === "migration" ? 18 : 13;
    v.agentPublicJwk = publicPart(publicTestKey(scalar));
    v.recoverySigned = await nodeSign(v.recovery, scalar);
    assert.deepEqual((await recovery(v)).receipts, [original]);
    assert.notEqual(original.operation.bindingDigest, bd);
    assert.deepEqual(
      checkExecutorRetry(original.operation, original, { expectedOperation: original.operation }),
      original,
    );
    assert.throws(() =>
      checkExecutorRetry(v.operation, original, { expectedOperation: v.operation }),
    );
  }
});

test("execute and write_report use distinct signed challenges and cannot borrow a recovery lease", async () => {
  for (const purpose of ["execute", "write_report"]) {
    const v = fresh();
    v.challenge.purpose = purpose;
    v.lease.challenge = v.challenge;
    v.leaseSigned = await nodeSign(v.lease, 12);
    assert.deepEqual(await lease(v, { purpose }), v.lease);
    await assert.rejects(() => lease(v, { purpose: "recover" }));
  }
});

test("separate executor distribution pins its complete source and original base, and imports in isolation", async () => {
  const root = new URL("../../executor-trust/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("integrity.json", root), "utf8"));
  const sha = (data) => createHash("sha256").update(data).digest("hex");
  for (const [file, expected] of Object.entries(manifest.files))
    assert.equal(sha(await readFile(new URL(file, root))), expected, file);
  assert.equal(
    manifest.baseContract.bundleSha256,
    sha(await readFile(new URL("../dist/core.mjs", import.meta.url))),
  );
  assert.equal(
    manifest.baseContract.integritySha256,
    sha(await readFile(new URL("../integrity.json", import.meta.url))),
  );
  const temporary = await mkdtemp(join(tmpdir(), "executor-trust-isolated-"));
  try {
    const target = join(temporary, "core.mjs");
    await copyFile(new URL("dist/core.mjs", root), target);
    const isolated = await import(pathToFileURL(target).href);
    assert.equal(isolated.EXECUTOR_TRUST_PROFILE, "folioview.executor-trust.v1");
    assert.deepEqual(
      await isolated.verifyExecutorApproval(vector.approvalSigned, options(vector)),
      vector.approval,
    );
    assert.equal("sign" in isolated, false);
    assert.equal("open" in isolated, false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
