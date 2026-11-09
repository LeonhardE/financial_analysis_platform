import validators from "./validators.cjs";
/** Opt-in, public-only trust verification. Current expectations come from a trusted transaction. */
import {
  canonical,
  bytes,
  same,
  digest,
  keyId,
  verify,
  fingerprint,
  deny,
  integer,
} from "../../encrypted-workspace/dist/core.mjs";

export const EXECUTOR_TRUST_PROFILE = "folioview.executor-trust.v1";
export const MAX_EXECUTOR_CONTROL_BYTES = 32768;
export const MAX_EXECUTOR_LEASE_SECONDS = 120;
export const MAX_EXECUTOR_APPROVAL_SECONDS = 30 * 86400;
const NAMES = new Set([
  "ExecutorBinding",
  "ExecutorApprovalPayload",
  "ExecutorCheckpointPayload",
  "ExecutorChallenge",
  "ExecutorOperation",
  "ExecutorReceipt",
  "ExecutorLeasePayload",
  "ExecutorRecoveryPayload",
  "ExecutorTransitionPayload",
]);
const reject = () => deny("key_authorization_required");
export function validateExecutorSchema(name, value) {
  if (!NAMES.has(name)) reject();
  if (canonical(value).length > MAX_EXECUTOR_CONTROL_BYTES) deny("payload_too_large");
  if (!validators[name](value)) deny("invalid_schema");
  return structuredClone(value);
}
function binding(value) {
  const b = validateExecutorSchema("ExecutorBinding", value);
  const origin = "https://[a-z0-9]+(?:[.-][a-z0-9]+)*";
  if (
    b.issuer.match(new RegExp("^" + origin + "$"))?.[0] !== b.issuer ||
    b.audience.match(new RegExp("^" + origin + "(?:/[A-Za-z0-9_-]+)*/?$"))?.[0] !== b.audience
  )
    reject();
  const keys = [
    "rootKeyId",
    "policySigningKeyId",
    "agentSigningKeyId",
    "agentEncryptionKeyId",
    "tlsKeyId",
  ].map((k) => b[k]);
  for (const key of [...keys, ...b.recipientKeyIds]) if (bytes(key).length !== 32) reject();
  if (
    new Set(keys).size !== keys.length ||
    !same(b.recipientKeyIds, [...new Set(b.recipientKeyIds)].sort()) ||
    keys.some((k) => b.recipientKeyIds.includes(k))
  )
    reject();
  return b;
}
function window(p, now, maximum) {
  integer(now, 1);
  if (!(p.issuedAt <= now && now < p.expiresAt && p.expiresAt <= p.issuedAt + maximum)) reject();
}
async function signed(value, key, name) {
  if (canonical(value).length > MAX_EXECUTOR_CONTROL_BYTES) deny("payload_too_large");
  let payload;
  try {
    payload = await verify(value, key, "fv-control+jws");
  } catch {
    reject();
  }
  return validateExecutorSchema(name, payload);
}
export async function verifyExecutorApproval(value, { expectedBinding, rootJwk, now }) {
  const b = binding(expectedBinding);
  if ((await keyId(rootJwk)) !== b.rootKeyId) reject();
  const p = await signed(value, rootJwk, "ExecutorApprovalPayload");
  if (!same(p.binding, b)) reject();
  window(p, now, MAX_EXECUTOR_APPROVAL_SECONDS);
  return p;
}
async function checkpoint(approval, approvalSigned, value, current, policyJwk, now) {
  if ((await keyId(policyJwk)) !== approval.binding.policySigningKeyId) reject();
  const cp = await signed(value, policyJwk, "ExecutorCheckpointPayload");
  validateExecutorSchema("ExecutorCheckpointPayload", current);
  if (
    !same(cp, current) ||
    cp.revoked ||
    cp.bindingDigest !== (await digest(approval.binding)) ||
    cp.approvalFingerprint !== (await fingerprint(approvalSigned)) ||
    cp.issuedAt < approval.issuedAt ||
    cp.expiresAt > approval.expiresAt
  )
    reject();
  window(cp, now, MAX_EXECUTOR_LEASE_SECONDS);
  return cp;
}
export async function verifyExecutorLease(approvalSigned, checkpointSigned, leaseSigned, options) {
  const {
    expectedBinding,
    rootJwk,
    policyJwk,
    currentCheckpoint,
    challenge,
    challengeUsed,
    expectedOperation,
    purpose,
    now,
  } = options;
  const approval = await verifyExecutorApproval(approvalSigned, { expectedBinding, rootJwk, now });
  const cp = await checkpoint(
    approval,
    approvalSigned,
    checkpointSigned,
    currentCheckpoint,
    policyJwk,
    now,
  );
  const ch = validateExecutorSchema("ExecutorChallenge", challenge),
    operation = validateExecutorSchema("ExecutorOperation", expectedOperation);
  window(ch, now, MAX_EXECUTOR_LEASE_SECONDS);
  if (bytes(ch.nonce).length !== 32) reject();
  const bd = await digest(approval.binding);
  if (
    challengeUsed !== false ||
    ch.bindingDigest !== bd ||
    operation.bindingDigest !== bd ||
    !["execute", "write_report", "recover"].includes(purpose) ||
    ch.purpose !== purpose ||
    ch.issuedAt < approval.issuedAt
  )
    reject();
  const p = await signed(leaseSigned, policyJwk, "ExecutorLeasePayload");
  window(p, now, MAX_EXECUTOR_LEASE_SECONDS);
  if (
    p.bindingDigest !== bd ||
    p.checkpointDigest !== (await digest(cp)) ||
    !same(p.challenge, ch) ||
    !same(p.operation, operation) ||
    p.issuedAt < Math.max(cp.issuedAt, ch.issuedAt) ||
    p.expiresAt > Math.min(cp.expiresAt, ch.expiresAt, approval.expiresAt)
  )
    reject();
  return p;
}
export async function verifyExecutorRecovery(proofSigned, options) {
  const {
    agentJwk,
    expectedReceipts,
    approvalSigned,
    checkpointSigned,
    leaseSigned,
    ...expectations
  } = options;
  if (expectations.purpose !== "recover") reject();
  await verifyExecutorLease(approvalSigned, checkpointSigned, leaseSigned, expectations);
  const b = binding(expectations.expectedBinding),
    cp = expectations.currentCheckpoint;
  if ((await keyId(agentJwk)) !== b.agentSigningKeyId) reject();
  const p = await signed(proofSigned, agentJwk, "ExecutorRecoveryPayload");
  if (
    !same(p.recoveredBinding, b) ||
    p.leaseFingerprint !== (await fingerprint(leaseSigned)) ||
    p.checkpointDigest !== (await digest(cp)) ||
    p.stateHead !== cp.stateHead ||
    !same(p.receipts, expectedReceipts)
  )
    reject();
  const operations = new Set(),
    receipts = new Set();
  for (const r of p.receipts) {
    if (operations.has(r.operation.operationId) || receipts.has(r.receiptId)) reject();
    operations.add(r.operation.operationId);
    receipts.add(r.receiptId);
  }
  return p;
}
export async function verifyExecutorTransition(transitionSigned, options) {
  const {
    approvalSigned,
    checkpointSigned,
    expectedBinding,
    expectedNextBinding,
    rootJwk,
    policyJwk,
    currentCheckpoint,
    now,
  } = options;
  const approval = await verifyExecutorApproval(approvalSigned, { expectedBinding, rootJwk, now });
  const cp = await checkpoint(
    approval,
    approvalSigned,
    checkpointSigned,
    currentCheckpoint,
    policyJwk,
    now,
  );
  const next = binding(expectedNextBinding),
    p = await signed(transitionSigned, rootJwk, "ExecutorTransitionPayload");
  window(p, now, 300);
  if (
    p.previousApprovalFingerprint !== (await fingerprint(approvalSigned)) ||
    p.previousCheckpointDigest !== (await digest(cp)) ||
    !same(p.nextBinding, next) ||
    p.issuedAt < cp.issuedAt ||
    p.expiresAt > approval.expiresAt
  )
    reject();
  const old = approval.binding;
  if (p.transitionType === "code_upgrade") {
    if (same(old, next) || !same({ ...old, workloadDigest: next.workloadDigest }, next)) reject();
  } else {
    const changed = new Set([
      "identityEpoch",
      "agentSigningKeyId",
      "agentEncryptionKeyId",
      "tlsKeyId",
      "workloadDigest",
      "bindingFingerprint",
    ]);
    if (
      Object.keys(old).some((k) => !changed.has(k) && !same(old[k], next[k])) ||
      next.identityEpoch !== old.identityEpoch + 1 ||
      ["agentSigningKeyId", "agentEncryptionKeyId"].some((k) => old[k] === next[k])
    )
      reject();
  }
  return p;
}
export function checkExecutorRetry(operation, originalReceipt, { expectedOperation }) {
  const op = validateExecutorSchema("ExecutorOperation", operation),
    expected = validateExecutorSchema("ExecutorOperation", expectedOperation),
    receipt = validateExecutorSchema("ExecutorReceipt", originalReceipt);
  if (!same(op, expected) || !same(receipt.operation, expected)) reject();
  return receipt;
}
