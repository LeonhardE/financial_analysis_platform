/** Public synthetic scalars, never production keys. Private JWKs stay in this test helper. */
import { createECDH, createHash } from "node:crypto";
import * as jose from "jose";
import canonicalize from "canonicalize";
export const hash = (value) => createHash("sha256").update(canonicalize(value)).digest("hex");
export const signingFingerprint = (s) =>
  createHash("sha256")
    .update(s.protected + "." + s.payload)
    .digest("hex");
export function publicTestKey(scalar) {
  const d = Buffer.alloc(32);
  d.writeUInt32BE(scalar, 28);
  const curve = createECDH("prime256v1");
  curve.setPrivateKey(d);
  const p = curve.getPublicKey(null, "uncompressed");
  return {
    kty: "EC",
    crv: "P-256",
    x: p.subarray(1, 33).toString("base64url"),
    y: p.subarray(33).toString("base64url"),
    d: d.toString("base64url"),
  };
}
export function publicPart(value) {
  const { d, ...p } = value;
  return p;
}
export const testKeyId = async (scalar) =>
  jose.calculateJwkThumbprint(publicPart(publicTestKey(scalar)));
export async function nodeSign(payload, scalar) {
  const key = publicTestKey(scalar);
  return new jose.FlattenedSign(new TextEncoder().encode(canonicalize(payload)))
    .setProtectedHeader({
      alg: "ES256",
      kid: await testKeyId(scalar),
      typ: "fv-control+jws",
      cty: "application/json",
    })
    .sign(await jose.importJWK(key, "ES256"));
}
export const control = (type, fields) => ({
  contractVersion: "folioview.agent-workspace.v2.0",
  profile: "folioview.executor-trust.v1",
  artifactType: type,
  ...fields,
});
export async function makeExecutorFixture() {
  const binding = {
    ownerSubject: "owner-test",
    vaultId: "vault-test",
    connectionId: "connection-test",
    agentId: "agent-test",
    clientId: "client-test",
    provider: "chatgpt",
    providerClientId: "native-client-test",
    rootKeyId: await testKeyId(11),
    policySigningKeyId: await testKeyId(12),
    agentSigningKeyId: await testKeyId(13),
    agentEncryptionKeyId: await testKeyId(14),
    tlsKeyId: await testKeyId(15),
    identityEpoch: 1,
    bindingFingerprint: hash({ originalBinding: "test" }),
    scopeDigest: hash({ approvedScope: "synthetic-only" }),
    workloadDigest: "a".repeat(64),
    issuer: "https://policy.example.invalid",
    audience: "https://executor.example.invalid/mcp",
    recipientKeyIds: [await testKeyId(16), await testKeyId(17)].sort(),
  };
  const approval = control("executor_approval", {
    binding,
    operationId: "approval_test_operation_001",
    issuedAt: 900,
    expiresAt: 1900,
  });
  const approvalSigned = await nodeSign(approval, 11),
    bd = hash(binding);
  const checkpoint = control("executor_checkpoint", {
    bindingDigest: bd,
    approvalFingerprint: signingFingerprint(approvalSigned),
    stateVersion: 3,
    stateHead: "b".repeat(64),
    authorizationEpoch: 2,
    revoked: false,
    issuedAt: 990,
    expiresAt: 1100,
  });
  const checkpointSigned = await nodeSign(checkpoint, 12);
  const challenge = {
    bindingDigest: bd,
    challengeId: "challenge_test_operation_001",
    nonce: Buffer.alloc(32, 7).toString("base64url"),
    purpose: "recover",
    issuedAt: 995,
    expiresAt: 1080,
  };
  const operation = {
    bindingDigest: bd,
    runId: "run-test",
    operationId: "report_test_operation_001",
    requestDigest: "c".repeat(64),
  };
  const receipt = { operation, receiptId: "receipt-original", resultDigest: "d".repeat(64) };
  const lease = control("executor_lease", {
    bindingDigest: bd,
    checkpointDigest: hash(checkpoint),
    challenge,
    operation,
    issuedAt: 1000,
    expiresAt: 1060,
  });
  const leaseSigned = await nodeSign(lease, 12);
  const recovery = control("executor_recovery", {
    recoveredBinding: binding,
    leaseFingerprint: signingFingerprint(leaseSigned),
    checkpointDigest: hash(checkpoint),
    stateHead: checkpoint.stateHead,
    receipts: [receipt],
  });
  const upgradeBinding = { ...binding, workloadDigest: "e".repeat(64) };
  const migrationBinding = {
    ...binding,
    identityEpoch: 2,
    agentSigningKeyId: await testKeyId(18),
    agentEncryptionKeyId: await testKeyId(19),
    bindingFingerprint: "f".repeat(64),
  };
  const transition = (type, nextBinding) =>
    control("executor_transition", {
      transitionType: type,
      previousApprovalFingerprint: signingFingerprint(approvalSigned),
      previousCheckpointDigest: hash(checkpoint),
      nextBinding,
      operationId: "transition_test_operation_001",
      issuedAt: 1000,
      expiresAt: 1060,
    });
  const upgrade = transition("code_upgrade", upgradeBinding),
    migration = transition("epoch_migration", migrationBinding);
  return {
    generatedBy: {
      jose: "6.2.13",
      canonicalize: "5.1.0",
      privateKeysStored: false,
      testScalars: "Public synthetic integers 11 through 19",
    },
    binding,
    approval,
    approvalSigned,
    checkpoint,
    checkpointSigned,
    challenge,
    operation,
    receipt,
    lease,
    leaseSigned,
    recovery,
    recoverySigned: await nodeSign(recovery, 13),
    upgrade,
    upgradeSigned: await nodeSign(upgrade, 11),
    migration,
    migrationSigned: await nodeSign(migration, 11),
    rootPublicJwk: publicPart(publicTestKey(11)),
    policyPublicJwk: publicPart(publicTestKey(12)),
    agentPublicJwk: publicPart(publicTestKey(13)),
  };
}

// Regenerate the public vector after installing this package's locked dev dependencies.
process.stdout.write(JSON.stringify(await makeExecutorFixture(), null, 2) + "\n");
