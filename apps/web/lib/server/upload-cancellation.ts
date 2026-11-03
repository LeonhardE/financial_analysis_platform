import "server-only";
import { createHash } from "node:crypto";
import { CONTRACT, fields, integer, record, signedObject } from "./owner-transport";

type Kind = "task" | "holdings";
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const op = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{22,128}$/.test(v);
const key = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const stable = (v: any): string =>
  v && typeof v === "object"
    ? JSON.stringify(
        Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, JSON.parse(stable(v[k]))]),
        ),
      )
    : JSON.stringify(v);

function intent(kind: Kind, command: unknown, slot: string, cancellationId?: string) {
  if (
    !signedObject(command) ||
    !record(command) ||
    typeof command.payload !== "string" ||
    typeof command.protected !== "string"
  )
    return null;
  try {
    const p = JSON.parse(Buffer.from(command.payload, "base64url").toString("utf8"));
    const h = JSON.parse(Buffer.from(command.protected, "base64url").toString("utf8"));
    if (
      !fields(p, [
        "artifactType",
        "contractVersion",
        "profile",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "rootEpoch",
        "cancellationId",
        "target",
      ]) ||
      !fields(h, ["alg", "kid", "typ", "cty"]) ||
      h.alg !== "ES256" ||
      h.typ !== "fv-control+jws" ||
      h.cty !== "application/json" ||
      h.kid !== p.rootKeyId ||
      p.artifactType !== `${kind}_upload_cancellation_intent` ||
      p.contractVersion !== CONTRACT ||
      p.profile !== `folioview.${kind}-upload-cancellation.v1` ||
      !digest(p.ownerSubject) ||
      !id(p.vaultId) ||
      !key(p.rootKeyId) ||
      p.rootEpoch !== 1 ||
      !op(p.cancellationId) ||
      (cancellationId !== undefined && p.cancellationId !== cancellationId)
    )
      return null;
    const t = p.target;
    if (kind === "task") {
      if (
        !fields(t, [
          "taskId",
          "operationId",
          "mode",
          "expectedVersion",
          "authorKeyId",
          "envelopeFingerprint",
          "requestFingerprint",
          "packetDigest",
        ]) ||
        t.taskId !== slot ||
        !id(t.taskId) ||
        !op(t.operationId) ||
        !["create", "update", "transition"].includes(t.mode as string) ||
        !integer(t.expectedVersion, 0) ||
        (t.mode === "create") !== (t.expectedVersion === 0) ||
        !key(t.authorKeyId) ||
        !digest(t.envelopeFingerprint) ||
        !digest(t.requestFingerprint) ||
        !digest(t.packetDigest)
      )
        return null;
    } else {
      if (
        !fields(t, [
          "resourceRef",
          "sourceEpoch",
          "snapshotId",
          "operationId",
          "expectedRevision",
          "authorKeyId",
          "envelopeFingerprint",
          "packetDigest",
        ]) ||
        !fields(t.resourceRef, ["kind", "sourceService", "resourceId", "incarnation"]) ||
        t.resourceRef.kind !== "holdings" ||
        t.resourceRef.sourceService !== "portfolio" ||
        t.resourceRef.resourceId !== slot ||
        !id(t.resourceRef.resourceId) ||
        !id(t.resourceRef.incarnation) ||
        !integer(t.sourceEpoch, 1) ||
        !id(t.snapshotId) ||
        !op(t.operationId) ||
        !integer(t.expectedRevision, 0) ||
        !key(t.authorKeyId) ||
        !digest(t.envelopeFingerprint) ||
        !digest(t.packetDigest)
      )
        return null;
    }
    return p;
  } catch {
    return null;
  }
}
export function cancellationRequest(
  kind: Kind,
  value: unknown,
  slot: string,
  cancellationId: string,
) {
  return (
    fields(value, ["contractVersion", "command"]) &&
    value.contractVersion === CONTRACT &&
    Boolean(intent(kind, value.command, slot, cancellationId))
  );
}
export function cancellationResponse(
  kind: Kind,
  value: unknown,
  slot: string,
  cancellationId?: string,
) {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 16384) return false;
  if (
    !fields(value, ["contractVersion", "profile", "command", "receipt"]) ||
    value.contractVersion !== CONTRACT
  )
    return false;
  const p = intent(kind, value.command, slot, cancellationId);
  if (!p || value.profile !== p.profile) return false;
  const r = value.receipt;
  if (
    !fields(r, [
      "cancellationId",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "rootEpoch",
      "target",
      "commandFingerprint",
      "outcome",
      "acceptedAt",
    ]) ||
    !["saved", "cancelled"].includes(r.outcome as string) ||
    !integer(r.acceptedAt, 0)
  )
    return false;
  for (const f of ["cancellationId", "ownerSubject", "vaultId", "rootKeyId", "rootEpoch", "target"])
    if (stable(r[f]) !== stable(p[f])) return false;
  const command = value.command as { protected: string; payload: string };
  return (
    r.commandFingerprint ===
    createHash("sha256")
      .update(command.protected + "." + command.payload)
      .digest("hex")
  );
}
