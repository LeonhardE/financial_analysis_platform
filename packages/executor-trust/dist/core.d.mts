export type PublicJson = Record<string, any>;
export type SignedObject = { protected: string; payload: string; signature: string };

/** Opt-in public executor trust. Expectations must be independently selected current state. */
export const EXECUTOR_TRUST_PROFILE: "folioview.executor-trust.v1";
export const MAX_EXECUTOR_CONTROL_BYTES: number;
export const MAX_EXECUTOR_LEASE_SECONDS: number;
export const MAX_EXECUTOR_APPROVAL_SECONDS: number;
export type ExecutorBinding = {
  ownerSubject: string;
  vaultId: string;
  connectionId: string;
  agentId: string;
  clientId: string;
  provider: string;
  providerClientId: string;
  rootKeyId: string;
  agentSigningKeyId: string;
  agentEncryptionKeyId: string;
  tlsKeyId: string;
  policySigningKeyId: string;
  identityEpoch: number;
  bindingFingerprint: string;
  scopeDigest: string;
  workloadDigest: string;
  issuer: string;
  audience: string;
  recipientKeyIds: string[];
};
export type ExecutorApprovalOptions = {
  expectedBinding: ExecutorBinding;
  rootJwk: PublicJson;
  now: number;
};
export type ExecutorLeaseOptions = ExecutorApprovalOptions & {
  policyJwk: PublicJson;
  currentCheckpoint: PublicJson;
  challenge: PublicJson;
  challengeUsed: boolean;
  expectedOperation: PublicJson;
  purpose: "execute" | "write_report" | "recover";
};
export function validateExecutorSchema(name: string, value: unknown): PublicJson;
export function verifyExecutorApproval(
  signed: SignedObject,
  options: ExecutorApprovalOptions,
): Promise<PublicJson>;
export function verifyExecutorLease(
  approval: SignedObject,
  checkpoint: SignedObject,
  lease: SignedObject,
  options: ExecutorLeaseOptions,
): Promise<PublicJson>;
export function verifyExecutorRecovery(
  proof: SignedObject,
  options: ExecutorLeaseOptions & {
    agentJwk: PublicJson;
    expectedReceipts: PublicJson[];
    approvalSigned: SignedObject;
    checkpointSigned: SignedObject;
    leaseSigned: SignedObject;
  },
): Promise<PublicJson>;
export function verifyExecutorTransition(
  transition: SignedObject,
  options: ExecutorApprovalOptions & {
    approvalSigned: SignedObject;
    checkpointSigned: SignedObject;
    expectedNextBinding: ExecutorBinding;
    policyJwk: PublicJson;
    currentCheckpoint: PublicJson;
  },
): Promise<PublicJson>;
export function checkExecutorRetry(
  operation: PublicJson,
  originalReceipt: PublicJson,
  options: { expectedOperation: PublicJson },
): PublicJson;
