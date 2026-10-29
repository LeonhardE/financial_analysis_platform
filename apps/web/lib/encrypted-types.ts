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
export class VaultError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "VaultError";
  }
}
