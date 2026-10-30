/** Exact public transport types. Private keys never cross the worker boundary. */
export const CONTRACT = "folioview.agent-workspace.v2.0";
export type Json = Record<string, any>;
export type Signed = { protected: string; payload: string; signature: string };
export type RegistryBundle = {
  contractVersion: string;
  checkpoint: Signed;
  entries: { certificate: Signed; active: boolean }[];
};
export type Archive = {
  profile: "folioview.passkey-vault.v1";
  ownerSubject: string;
  vaultId: string;
  rootKeyId: string;
  credentialId: string;
  prfSalt: string;
  iv: string;
  ciphertext: string;
};
export type Vault = {
  vaultId: string;
  rootJwk: Json;
  rootKeyId: string;
  registryHistory: RegistryBundle[];
  archive: Archive;
  version: number;
};
export type Source = {
  resourceRef: {
    kind: "holdings";
    sourceService: "portfolio";
    resourceId: string;
    incarnation: string;
  };
  sourceEpoch: number;
};
export type ResourceContent = Json;
export type SnapshotResponse = {
  contractVersion: string;
  carrier: Json;
  keyProofs: Json;
  receipt: Json;
};
export type PendingSnapshot = {
  snapshotId: string;
  operationId: string;
  authorKeyId: string;
  expectedRevision: number;
  carrier: Json;
  source: Source;
};
export type PasskeyMaterial = { credentialId: string; prfSalt: string; secret: ArrayBuffer };
export type ResultMetadata = {
  resultId: string;
  taskId: string;
  runId: string;
  revision: number;
  deliveryRevision: number;
  envelopeFingerprint: string;
  connectionId: string;
  receivedAt: string;
  taskVersion: number;
  stateVersion: number;
  read: boolean;
  starred: boolean;
  archived: boolean;
  manifestId: string;
  keyEpoch: number;
};
export type ResultContent = {
  title: string;
  summary: string;
  sections: { sectionId: string; markdown: string }[];
  citations: {
    citationId: string;
    title: string;
    url: string;
    provenance: "agent_provided";
    publishedAt: string | null;
  }[];
  limitations: string[];
};
export type EncryptedResult = {
  contractVersion: string;
  metadata: ResultMetadata;
  signedObject: Signed;
  keyProofs: { checkpoint: Signed; certificates: Signed[] };
};
export type ResultEvidence = {
  contractVersion: string;
  profile: "folioview.owner-result-evidence.v1";
  run: Json;
  manifest: Json;
  manifestFingerprint: string;
  receipt: Json;
  agentKeyGrant: Signed;
  authorizationExpiresAt: number;
  provenance: Json;
  authorProof: { registrySequence: number; verifiedAt: number };
  registryProofs: { registrySequence: number; checkpointDigest: string; path: string }[];
};
export type OpenResultArgs = {
  result: EncryptedResult;
  evidence: ResultEvidence;
  registryBundles: RegistryBundle[];
};
export type ResultStateChanges = Partial<Pick<ResultMetadata, "read" | "starred" | "archived">>;
export type ResultStatePacket = { operationId: string; authorKeyId: string; command: Signed };
export class VaultError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "VaultError";
  }
}
