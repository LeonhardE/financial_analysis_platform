import type { ResultContent, ResultEvidence, ResultMetadata } from "./encrypted-types";

export const INBOX_CONTRACT = "folioview.agent-workspace.v2.0";
export type InboxFilter = "all" | "unread" | "starred" | "archived";
export type InboxCounts = {
  all: number;
  unread: number;
  starred: number;
  archived: number;
  total: number;
};
export type InboxItem = { metadata: ResultMetadata; content: ResultContent | null };
export type InboxSelection = {
  metadata: ResultMetadata;
  content: ResultContent;
  evidence: ResultEvidence;
  historical: boolean;
};
export class InboxError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const exact = (value: unknown, names: string[]): value is Record<string, any> =>
  object(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
export const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const integer = (value: unknown, minimum: number) =>
  Number.isSafeInteger(value) && (value as number) >= minimum;
const META = [
  "resultId",
  "taskId",
  "runId",
  "revision",
  "deliveryRevision",
  "envelopeFingerprint",
  "connectionId",
  "receivedAt",
  "taskVersion",
  "stateVersion",
  "read",
  "starred",
  "archived",
  "manifestId",
  "keyEpoch",
];
export function metadata(value: unknown): ResultMetadata {
  if (
    !exact(value, META) ||
    ![value.resultId, value.taskId, value.runId, value.connectionId, value.manifestId].every(
      identifier,
    ) ||
    ![value.revision, value.taskVersion, value.keyEpoch].every((v) => integer(v, 1)) ||
    value.revision > 32 ||
    value.deliveryRevision !== 1 ||
    !integer(value.stateVersion, 0) ||
    typeof value.envelopeFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.envelopeFingerprint) ||
    typeof value.receivedAt !== "string" ||
    !/Z$/.test(value.receivedAt) ||
    !Number.isFinite(Date.parse(value.receivedAt)) ||
    ![value.read, value.starred, value.archived].every((v) => typeof v === "boolean")
  )
    throw new InboxError("invalid_response");
  return value as ResultMetadata;
}
export function metadataPage(value: unknown): {
  items: ResultMetadata[];
  nextCursor: string | null;
} {
  if (
    !exact(value, ["contractVersion", "items", "nextCursor"]) ||
    value.contractVersion !== INBOX_CONTRACT ||
    !Array.isArray(value.items) ||
    value.items.length > 20 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" && /^[A-Za-z0-9_-]{1,2048}$/.test(value.nextCursor))
    )
  )
    throw new InboxError("invalid_response");
  const items = value.items.map(metadata);
  if (new Set(items.map((item) => item.resultId + ":" + item.revision)).size !== items.length)
    throw new InboxError("invalid_response");
  return { items, nextCursor: value.nextCursor };
}
export function inboxCounts(value: unknown): InboxCounts {
  if (
    !exact(value, ["contractVersion", "profile", "asOf", "counts"]) ||
    value.contractVersion !== INBOX_CONTRACT ||
    value.profile !== "folioview.owner-result-counts.v1" ||
    typeof value.asOf !== "string" ||
    !Number.isFinite(Date.parse(value.asOf)) ||
    !exact(value.counts, ["all", "unread", "starred", "archived", "total"]) ||
    !Object.values(value.counts).every((v) => integer(v, 0) && (v as number) <= 1024) ||
    value.counts.all + value.counts.archived !== value.counts.total ||
    value.counts.unread > value.counts.all ||
    value.counts.starred > value.counts.all
  )
    throw new InboxError("invalid_response");
  return value.counts as InboxCounts;
}
export const cacheKey = (meta: ResultMetadata) =>
  `${meta.resultId}:${meta.revision}:${meta.deliveryRevision}:${meta.envelopeFingerprint}`;
export const sameBody = (a: ResultMetadata, b: ResultMetadata) =>
  cacheKey(a) === cacheKey(b) &&
  a.taskId === b.taskId &&
  a.runId === b.runId &&
  a.manifestId === b.manifestId &&
  a.keyEpoch === b.keyEpoch &&
  a.connectionId === b.connectionId &&
  a.taskVersion === b.taskVersion;
export function logicalState(historical: ResultMetadata, current: ResultMetadata): ResultMetadata {
  return {
    ...historical,
    stateVersion: current.stateVersion,
    read: current.read,
    starred: current.starred,
    archived: current.archived,
  };
}
export function matchesFilter(meta: ResultMetadata, filter: InboxFilter) {
  return filter === "archived"
    ? meta.archived
    : !meta.archived &&
        (filter === "all" ||
          (filter === "unread" && !meta.read) ||
          (filter === "starred" && meta.starred));
}
export function fixedError(error: unknown, crypto = false): string {
  const code = object(error) && typeof error.code === "string" ? error.code : "";
  if (
    [
      "cancelled",
      "invalid_response",
      "service_unavailable",
      "session_expired",
      "insufficient_scope",
      "version_conflict",
      "request_timeout",
      "unlock_required",
      "not_found",
      "pending_state",
      "state_outcome_unknown",
    ].includes(code)
  )
    return code;
  if (code === "render_rejected") return code;
  if (
    ["key_revoked", "device_required", "key_authorization_required", "insufficient_scope"].includes(
      code,
    )
  )
    return "insufficient_scope";
  return crypto ? "verification_failed" : "service_unavailable";
}
