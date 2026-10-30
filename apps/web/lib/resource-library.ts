/** Closed owner discovery and manual-list contracts. No content-key or agent authority. */
import { readWatchlist, type WatchlistResponse } from "./watchlist";

export const RESOURCE_CONTRACT = "folioview.agent-workspace.v2.0";
export type ResourceKind = "holdings" | "watchlist" | "channel_follows";
export type ResourceRef = {
  kind: ResourceKind;
  sourceService: "portfolio" | "user";
  resourceId: string;
  incarnation: string;
};
export type ResourceSelection = { ref: ResourceRef; sourceEpoch: number };
export type ResourceItem = {
  ref: ResourceRef | null;
  revision: number | null;
  sourceEpoch: number | null;
  state:
    | "pending"
    | "active"
    | "revoking"
    | "disconnected"
    | "deleted"
    | "ready"
    | "empty"
    | "uninitialized"
    | "unavailable";
  snapshotId: string | null;
  updatedAt: string | null;
  encryptedEvidence: "not_checked" | "not_prepared";
};
export type ResourceGroup = {
  kind: ResourceKind;
  sourceService: "portfolio" | "user";
  status: "available" | "partial" | "uninitialized" | "unavailable";
  items: ResourceItem[];
};
export type ResourceCatalogue = {
  contractVersion: string;
  profile: "folioview.owner-resource-discovery.v1";
  readAt: string;
  groups: ResourceGroup[];
};
export type ChannelInput = { name: string; handleOrUrl: string; note: string };
export type ChannelFollow = ChannelInput & {
  followId: string;
  verification: "user_provided";
  addedAt: string;
};
export type ChannelFollows = { revision: number; items: ChannelFollow[]; limit: 50 };
export type ResourceLoad<T> = { data: T | null; loading: boolean; error: string; stale: boolean };
export class ResourceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const exact = (value: unknown, names: string[]): value is Record<string, any> =>
  record(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const identifier = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.exec(value)?.[0] === value;
const integer = (value: unknown, min: number) =>
  Number.isSafeInteger(value) && (value as number) >= min;
const date = (value: unknown) =>
  typeof value === "string" &&
  /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19) &&
  value.endsWith("Z");
function fail(): never {
  throw new ResourceError("invalid_response");
}
export function readResourceCatalogue(value: unknown): ResourceCatalogue {
  if (
    !exact(value, ["contractVersion", "profile", "readAt", "groups"]) ||
    value.contractVersion !== RESOURCE_CONTRACT ||
    value.profile !== "folioview.owner-resource-discovery.v1" ||
    !date(value.readAt) ||
    !Array.isArray(value.groups) ||
    value.groups.length !== 3
  )
    fail();
  const kinds = new Set<string>();
  for (const group of value.groups) {
    if (
      !exact(group, ["kind", "sourceService", "status", "items"]) ||
      !["holdings", "watchlist", "channel_follows"].includes(group.kind) ||
      kinds.has(group.kind) ||
      group.sourceService !== (group.kind === "holdings" ? "portfolio" : "user") ||
      !["available", "partial", "uninitialized", "unavailable"].includes(group.status) ||
      !Array.isArray(group.items) ||
      group.items.length > 10 ||
      (group.kind !== "holdings" && group.items.length !== 1)
    )
      fail();
    kinds.add(group.kind);
    const refs = new Set<string>();
    for (const item of group.items) {
      if (
        !exact(item, [
          "ref",
          "revision",
          "sourceEpoch",
          "state",
          "snapshotId",
          "updatedAt",
          "encryptedEvidence",
        ]) ||
        ![
          "pending",
          "active",
          "revoking",
          "disconnected",
          "deleted",
          "ready",
          "empty",
          "uninitialized",
          "unavailable",
        ].includes(item.state) ||
        !["not_checked", "not_prepared"].includes(item.encryptedEvidence) ||
        !(item.revision === null || integer(item.revision, 0)) ||
        !(item.sourceEpoch === null || integer(item.sourceEpoch, 1)) ||
        !(item.snapshotId === null || identifier(item.snapshotId)) ||
        !(item.updatedAt === null || date(item.updatedAt))
      )
        fail();
      if (item.ref !== null) {
        if (
          !exact(item.ref, ["kind", "sourceService", "resourceId", "incarnation"]) ||
          item.ref.kind !== group.kind ||
          item.ref.sourceService !== group.sourceService ||
          !identifier(item.ref.resourceId) ||
          !identifier(item.ref.incarnation)
        )
          fail();
        const key = JSON.stringify([
          item.ref.kind,
          item.ref.sourceService,
          item.ref.resourceId,
          item.ref.incarnation,
        ]);
        if (refs.has(key)) fail();
        refs.add(key);
      }
      if (
        ["ready", "empty", "active", "revoking", "disconnected", "deleted", "pending"].includes(
          item.state,
        ) &&
        (!item.ref || item.sourceEpoch === null)
      )
        fail();
      if (["ready", "empty", "active", "revoking"].includes(item.state) && item.revision === null)
        fail();
      if (item.state === "ready" && (item.revision < 1 || !item.updatedAt)) fail();
      if (item.state === "empty" && !item.updatedAt) fail();
      if (
        item.state === "uninitialized" &&
        [item.ref, item.revision, item.sourceEpoch, item.snapshotId, item.updatedAt].some(
          (v) => v !== null,
        )
      )
        fail();
      if (group.kind === "holdings" && ["ready", "empty", "uninitialized"].includes(item.state))
        fail();
      if (
        item.state === "unavailable" &&
        [item.revision, item.sourceEpoch, item.snapshotId, item.updatedAt].some(
          (value) => value !== null,
        )
      )
        fail();
      if (group.kind !== "holdings" && item.state === "unavailable" && item.ref !== null) fail();
      if (
        group.kind === "holdings" &&
        (item.updatedAt !== null || (item.state !== "active" && item.snapshotId !== null))
      )
        fail();
      if (
        group.kind === "holdings" &&
        item.state === "active" &&
        (item.revision === 0) !== (item.snapshotId === null)
      )
        fail();
      if (
        group.kind !== "holdings" &&
        ["pending", "active", "revoking", "disconnected", "deleted"].includes(item.state)
      )
        fail();
      if (
        group.kind !== "holdings" &&
        (item.snapshotId !== null || item.encryptedEvidence !== "not_prepared")
      )
        fail();
    }
    const unavailable = group.items.filter(
      (item: ResourceItem) => item.state === "unavailable",
    ).length;
    const status =
      group.kind === "holdings"
        ? !group.items.length
          ? "uninitialized"
          : unavailable === group.items.length
            ? "unavailable"
            : unavailable
              ? "partial"
              : "available"
        : unavailable
          ? "unavailable"
          : "available";
    if (group.status !== status) fail();
  }
  return value as ResourceCatalogue;
}
export function resourceSelection(item: ResourceItem): ResourceSelection | null {
  return item.ref &&
    (item.ref.kind !== "holdings" ||
      (item.revision !== null && item.revision > 0 && item.snapshotId !== null)) &&
    item.sourceEpoch !== null &&
    ["ready", "empty", "active"].includes(item.state)
    ? { ref: { ...item.ref }, sourceEpoch: item.sourceEpoch }
    : null;
}
export function normalizeChannel(value: string): string {
  const match = /^(?:@|https:\/\/(?:www\.)?youtube\.com\/@)([A-Za-z0-9_.-]{1,64})$/.exec(value);
  if (!match || match[0] !== value) throw new ResourceError("invalid_locator");
  return `https://www.youtube.com/@${match[1].toLowerCase()}`;
}
export function channelInputs(value: unknown, maxBytes = 131072): ChannelInput[] {
  if (!Array.isArray(value) || value.length > 50) throw new ResourceError("invalid_input");
  const seen = new Set<string>();
  const items = value.map((item) => {
    if (
      !exact(item, ["name", "handleOrUrl", "note"]) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      [...item.name].length > 120 ||
      typeof item.handleOrUrl !== "string" ||
      item.handleOrUrl.length > 256 ||
      typeof item.note !== "string" ||
      [...item.note].length > 1000
    )
      throw new ResourceError("invalid_input");
    for (const field of Object.values(item))
      if (
        typeof field === "string" &&
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(field)
      )
        throw new ResourceError("invalid_input");
    const locator = normalizeChannel(item.handleOrUrl);
    if (seen.has(locator)) throw new ResourceError("duplicate_locator");
    seen.add(locator);
    return { name: item.name, handleOrUrl: locator, note: item.note };
  });
  if (
    new TextEncoder().encode(JSON.stringify({ expectedRevision: Number.MAX_SAFE_INTEGER, items }))
      .length > maxBytes
  )
    throw new ResourceError("too_large");
  return items;
}
export function readChannelFollows(value: unknown): ChannelFollows {
  if (
    !exact(value, ["revision", "items", "limit"]) ||
    !integer(value.revision, 0) ||
    value.limit !== 50 ||
    !Array.isArray(value.items) ||
    value.items.length > 50
  )
    fail();
  const ids = new Set<string>();
  for (const item of value.items) {
    if (
      !exact(item, ["name", "handleOrUrl", "note", "followId", "verification", "addedAt"]) ||
      !identifier(item.followId) ||
      ids.has(item.followId) ||
      item.verification !== "user_provided" ||
      !date(item.addedAt)
    )
      fail();
    ids.add(item.followId);
    try {
      if (normalizeChannel(item.handleOrUrl) !== item.handleOrUrl) fail();
    } catch {
      fail();
    }
  }
  try {
    channelInputs(
      value.items.map((item: ChannelFollow) => ({
        name: item.name,
        handleOrUrl: item.handleOrUrl,
        note: item.note,
      })),
      196608,
    );
  } catch {
    fail();
  }
  return value as ChannelFollows;
}
export function readResourceWatchlist(value: unknown): WatchlistResponse {
  if (!exact(value, ["items", "limit"]) || value.limit !== 50 || !Array.isArray(value.items))
    fail();
  for (const item of value.items)
    if (
      !exact(item, ["symbol", "name", "instrumentType", "currency", "addedAt"]) ||
      !date(item.addedAt)
    )
      fail();
  try {
    return readWatchlist(value);
  } catch {
    return fail();
  }
}
