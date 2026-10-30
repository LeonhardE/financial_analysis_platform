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
export type ResourceBindingMetadata = {
  ref: {
    kind: "holdings" | "watchlist" | "channel_follows";
    sourceService: "portfolio" | "user";
    resourceId: string;
    incarnation: string;
  };
  sourceEpoch: number;
};
export type TaskContent = {
  name: string;
  template: "brief" | "custom";
  goal: string;
  inputPolicy: { allowPartial: boolean; allowUnknownAsOf: boolean; maxFetchedAgeSeconds: number };
  outputSpec: {
    label: string;
    sections: { sectionId: string; title: string; instructions: string }[];
    language: "zh" | "en";
    verbosity: "concise" | "standard";
  };
  deliveryExpectation: null | {
    cadence: "daily" | "weekdays" | "weekly";
    localTime: string;
    timeZone: string;
    graceMinutes: number;
    weekday?: number;
  };
};
export type TaskMetadata = {
  contractVersion: string;
  vaultId: string;
  taskId: string;
  taskVersion: number;
  executionEpoch: number;
  status: "active" | "paused" | "archived";
  resourceBindings: ResourceBindingMetadata[];
  objectRevision: number;
  deliveryRevision: number;
  envelopeFingerprint: string;
  keyEpoch: number;
  createdAt: string;
  updatedAt: string;
};
export type EncryptedTask = {
  contractVersion: string;
  metadata: TaskMetadata;
  signedObject: Signed;
  keyProofs: { checkpoint: Signed; certificates: Signed[] };
};
export type TaskAction = "pause" | "resume" | "archive";
export type PendingTask = {
  taskId: string;
  operationId: string;
  authorKeyId: string;
  mode: "create" | "update" | "transition";
  body: {
    contractVersion: string;
    expectedVersion: number;
    resourceBindings: ResourceBindingMetadata[];
    envelope: { contractVersion: string; signedObject: Signed };
    taskId?: string;
    transitionIntent?: Signed;
  };
  envelopeFingerprint: string;
  keyEpoch: number;
  registrySequence: number;
  checkpointDigest: string;
};
/** Incomplete forms use the same closed fields; blank strings and -1 integers are permitted locally. */
export type TaskDraft = { content: TaskContent; resourceBindings: ResourceBindingMetadata[] };
export type TaskDraftSummary = {
  slot: string;
  revision: number;
  baseVersion: number;
  taskId: string;
};
export type TaskDraftRecord = TaskDraftSummary & { draft: TaskDraft };
export type TaskOutboxSummary = Pick<
  PendingTask,
  "taskId" | "operationId" | "mode" | "keyEpoch"
> & { expectedVersion: number };
export type SealTaskArgs = {
  content: TaskContent;
  resourceBindings: ResourceBindingMetadata[];
  current: EncryptedTask | null;
  taskId?: string;
};
export class VaultError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "VaultError";
  }
}
