// Independent Python-produced signatures are verified in the dependency-free browser bundle.
import {
  verifyExecutorApproval,
  verifyExecutorLease,
  verifyExecutorRecovery,
  verifyExecutorTransition,
  checkExecutorRetry,
} from "../../../../packages/executor-trust/dist/core.mjs";
let raw = "";
for await (const chunk of process.stdin) {
  raw += chunk.toString("utf8");
  if (Buffer.byteLength(raw) > 131072) throw new Error("fixture_limit");
}
const v = JSON.parse(raw),
  options = {
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
const result = {};
result.approval = !!(await verifyExecutorApproval(v.approvalSigned, options));
result.lease = !!(await verifyExecutorLease(
  v.approvalSigned,
  v.checkpointSigned,
  v.leaseSigned,
  options,
));
result.recovery = !!(await verifyExecutorRecovery(v.recoverySigned, {
  ...options,
  agentJwk: v.agentPublicJwk,
  expectedReceipts: [v.receipt],
  approvalSigned: v.approvalSigned,
  checkpointSigned: v.checkpointSigned,
  leaseSigned: v.leaseSigned,
}));
for (const type of ["upgrade", "migration"])
  result[type] = !!(await verifyExecutorTransition(v[type + "Signed"], {
    ...options,
    approvalSigned: v.approvalSigned,
    checkpointSigned: v.checkpointSigned,
    expectedNextBinding: v[type].nextBinding,
  }));
result.retry = !!checkExecutorRetry(v.operation, v.receipt, { expectedOperation: v.operation });
process.stdout.write(JSON.stringify(result));
