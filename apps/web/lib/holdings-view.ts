/** Read preconditions and display DTOs only; never an authority-installation interface. */
import { exact, identifier } from "./task-types";
import type { Source, Vault, Json } from "./encrypted-types";
const CONTRACT = "folioview.agent-workspace.v2.0";
const key = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
const positive = (v: unknown, min = 1) => Number.isSafeInteger(v) && Number(v) >= min;
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const ref = (v: unknown) =>
  exact(v, ["kind", "sourceService", "resourceId", "incarnation"]) &&
  v.kind === "holdings" &&
  v.sourceService === "portfolio" &&
  identifier(v.resourceId) &&
  identifier(v.incarnation);
const sameRef = (a: Json, b: Json) =>
  ["kind", "sourceService", "resourceId", "incarnation"].every((k) => a[k] === b[k]);
const signed = (v: unknown) =>
  exact(v, ["protected", "payload", "signature"]) &&
  typeof v.protected === "string" &&
  /^[A-Za-z0-9_-]{1,1024}$/.test(v.protected) &&
  typeof v.payload === "string" &&
  /^[A-Za-z0-9_-]+$/.test(v.payload) &&
  v.payload.length <= 699051 &&
  typeof v.signature === "string" &&
  /^[A-Za-z0-9_-]{86}$/.test(v.signature);
export type HoldingsViewExpected = {
  vaultId: string;
  rootJwk: Json;
  rootKeyId: string;
  registrySequence: number;
  checkpointDigest: string;
  keyEpoch: number;
  resourceRef: Source["resourceRef"];
  sourceEpoch: number;
  recipientKeyIds: string[];
};
export const holdingsViewPath = (source: string) => `/api/v3/holdings/sources/${source}/view/query`;
export function holdingsViewRequest(
  v: unknown,
  source?: string,
): v is { contractVersion: string; expected: HoldingsViewExpected } {
  if (!exact(v, ["contractVersion", "expected"]) || v.contractVersion !== CONTRACT) return false;
  const e = v.expected;
  return (
    exact(e, [
      "vaultId",
      "rootJwk",
      "rootKeyId",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "resourceRef",
      "sourceEpoch",
      "recipientKeyIds",
    ]) &&
    identifier(e.vaultId) &&
    exact(e.rootJwk, ["kty", "crv", "x", "y"]) &&
    e.rootJwk.kty === "EC" &&
    e.rootJwk.crv === "P-256" &&
    key(e.rootJwk.x) &&
    key(e.rootJwk.y) &&
    key(e.rootKeyId) &&
    positive(e.registrySequence) &&
    e.registrySequence <= 32 &&
    digest(e.checkpointDigest) &&
    positive(e.keyEpoch) &&
    ref(e.resourceRef) &&
    (!source || e.resourceRef.resourceId === source) &&
    positive(e.sourceEpoch) &&
    Array.isArray(e.recipientKeyIds) &&
    e.recipientKeyIds.length >= 1 &&
    e.recipientKeyIds.length <= 8 &&
    e.recipientKeyIds.every(key) &&
    JSON.stringify(e.recipientKeyIds) === JSON.stringify([...new Set(e.recipientKeyIds)].sort())
  );
}
export type HoldingsView = {
  contractVersion: string;
  profile: string;
  vaultId: string;
  sourceId: string;
  mode: "complete" | "sync_required" | "separate";
  metadata: Json | null;
  snapshot: Json | null;
};
export function parseHoldingsView(
  v: unknown,
  expected: Pick<HoldingsViewExpected, "vaultId" | "resourceRef" | "sourceEpoch">,
): HoldingsView {
  if (
    !exact(v, [
      "contractVersion",
      "profile",
      "vaultId",
      "sourceId",
      "mode",
      "metadata",
      "snapshot",
    ]) ||
    v.contractVersion !== CONTRACT ||
    v.profile !== "folioview.owner-holdings-view.v1" ||
    v.vaultId !== expected.vaultId ||
    v.sourceId !== expected.resourceRef.resourceId
  )
    throw Error("invalid_response");
  if (v.mode === "sync_required" || v.mode === "separate") {
    if (v.metadata !== null || v.snapshot !== null) throw Error("invalid_response");
    return v as HoldingsView;
  }
  const m = v.metadata;
  if (
    v.mode !== "complete" ||
    !exact(m, [
      "contractVersion",
      "ownerSubject",
      "sourceId",
      "vaultId",
      "resourceRef",
      "sourceEpoch",
      "revision",
      "snapshotId",
      "snapshotSourceEpoch",
      "authorityVersion",
      "state",
      "pendingMutationId",
    ]) ||
    m.contractVersion !== CONTRACT ||
    !digest(m.ownerSubject) ||
    m.sourceId !== v.sourceId ||
    m.vaultId !== v.vaultId ||
    !ref(m.resourceRef) ||
    !sameRef(m.resourceRef, expected.resourceRef) ||
    m.sourceEpoch !== expected.sourceEpoch ||
    !positive(m.sourceEpoch) ||
    !positive(m.revision, 0) ||
    !positive(m.authorityVersion) ||
    m.state !== "active" ||
    m.pendingMutationId !== null ||
    !(
      m.snapshotSourceEpoch === null ||
      (positive(m.snapshotSourceEpoch) && m.snapshotSourceEpoch <= m.sourceEpoch)
    )
  )
    throw Error("invalid_response");
  if (m.snapshotId === null) {
    if (m.revision !== 0 || m.snapshotSourceEpoch !== null || v.snapshot !== null)
      throw Error("invalid_response");
    return v as HoldingsView;
  }
  if (!identifier(m.snapshotId) || !positive(m.revision)) throw Error("invalid_response");
  const s = v.snapshot;
  if (
    !exact(s, ["contractVersion", "carrier", "keyProofs", "receipt"]) ||
    s.contractVersion !== CONTRACT ||
    !exact(s.carrier, ["contractVersion", "signedObject"]) ||
    s.carrier.contractVersion !== CONTRACT ||
    !signed(s.carrier.signedObject) ||
    !exact(s.keyProofs, ["checkpoint", "certificates"]) ||
    !signed(s.keyProofs.checkpoint) ||
    !Array.isArray(s.keyProofs.certificates) ||
    s.keyProofs.certificates.length < 1 ||
    s.keyProofs.certificates.length > 64 ||
    !s.keyProofs.certificates.every(signed)
  )
    throw Error("invalid_response");
  const r = s.receipt;
  if (
    !exact(r, [
      "contractVersion",
      "vaultId",
      "resourceRef",
      "snapshotId",
      "revision",
      "sourceEpoch",
      "stableOperationId",
      "envelopeFingerprint",
      "snapshotPath",
      "storedAt",
    ]) ||
    r.contractVersion !== CONTRACT ||
    r.vaultId !== v.vaultId ||
    !ref(r.resourceRef) ||
    !sameRef(r.resourceRef, expected.resourceRef) ||
    r.snapshotId !== m.snapshotId ||
    r.revision !== m.revision ||
    !positive(r.sourceEpoch) ||
    r.sourceEpoch > m.sourceEpoch ||
    (m.snapshotSourceEpoch !== null && r.sourceEpoch !== m.snapshotSourceEpoch) ||
    typeof r.stableOperationId !== "string" ||
    !/^[A-Za-z0-9_-]{22,128}$/.test(r.stableOperationId) ||
    !digest(r.envelopeFingerprint) ||
    r.snapshotPath !== `/api/v2/holdings/sources/${v.sourceId}/snapshots/${m.snapshotId}` ||
    typeof r.storedAt !== "string"
  )
    throw Error("invalid_response");
  return v as HoldingsView;
}
export function holdingsViewExpectation(
  vault: Vault,
  source: Source,
  authority: {
    registrySequence: number;
    checkpointDigest: string;
    keyEpoch: number;
    recipientKeyIds: string[];
  },
): HoldingsViewExpected {
  return structuredClone({
    vaultId: vault.vaultId,
    rootJwk: vault.rootJwk,
    rootKeyId: vault.rootKeyId,
    registrySequence: authority.registrySequence,
    checkpointDigest: authority.checkpointDigest,
    keyEpoch: authority.keyEpoch,
    resourceRef: source.resourceRef,
    sourceEpoch: source.sourceEpoch,
    recipientKeyIds: [...authority.recipientKeyIds].sort(),
  });
}
