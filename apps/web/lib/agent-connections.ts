import type { ResourceBindingMetadata } from "./encrypted-types";
import { resourceBinding } from "./task-types";

export const CONNECTION_CONTRACT = "folioview.agent-workspace.v2.0";
export const AGENT_SCOPES = [
  "tasks:read",
  "runs:create",
  "runs:read",
  "results:create",
  "results:revise",
  "receipts:read",
  "watchlist:read",
  "channel_follows:read",
  "portfolio:read",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];
export type AgentGrant = {
  taskId: string;
  taskVersion: number;
  executionEpoch: number;
  resourceBindings: ResourceBindingMetadata[];
  grantId: string;
  grantEpoch: number;
  status: "active" | "revoked";
  authorizedAt: number;
  readObserved: boolean;
  resultSaved: boolean;
  signedGrantPresent: boolean;
};
export type AgentConnection = {
  connectionId: string;
  provider: "muse";
  clientId: string;
  authorizationId: string;
  status: "active" | "revoked" | "expired";
  authorizedAt: number;
  expiresAt: number;
  approvedScopes: AgentScope[];
  grants: AgentGrant[];
};
export type AuthorizationAttempt = {
  requestId: string;
  clientId: string;
  connectionId: string;
  authorizationId: string;
  status: "pending" | "authorized" | "denied" | "cancelled" | "expired" | "superseded" | "revoked";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};
export type ConnectionList = {
  contractVersion: typeof CONNECTION_CONTRACT;
  items: AgentConnection[];
  authorizationAttempts: AuthorizationAttempt[];
};
export type RevokeSelection = { connectionId: string; grantId: string | null };
export class ConnectionError extends Error {
  constructor(readonly code: string) {
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
const integer = (value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
function fail(): never {
  throw new ConnectionError("invalid_response");
}
const unique = <T>(rows: T[], key: (row: T) => string) =>
  new Set(rows.map(key)).size === rows.length;
function scopes(value: unknown): value is AgentScope[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= AGENT_SCOPES.length &&
    value.every((v) => AGENT_SCOPES.includes(v)) &&
    new Set(value).size === value.length
  );
}

export function readConnection(value: unknown): AgentConnection {
  if (
    !exact(value, [
      "connectionId",
      "provider",
      "clientId",
      "authorizationId",
      "status",
      "authorizedAt",
      "expiresAt",
      "approvedScopes",
      "grants",
    ]) ||
    !identifier(value.connectionId) ||
    value.provider !== "muse" ||
    !identifier(value.clientId) ||
    !identifier(value.authorizationId) ||
    !["active", "revoked", "expired"].includes(value.status) ||
    !integer(value.authorizedAt, 0) ||
    !integer(value.expiresAt, value.authorizedAt) ||
    !scopes(value.approvedScopes) ||
    !Array.isArray(value.grants) ||
    value.grants.length > 10
  )
    fail();
  const grants: AgentGrant[] = value.grants.map((grant: unknown) => {
    if (
      !exact(grant, [
        "taskId",
        "taskVersion",
        "executionEpoch",
        "resourceBindings",
        "grantId",
        "grantEpoch",
        "status",
        "authorizedAt",
        "readObserved",
        "resultSaved",
        "signedGrantPresent",
      ]) ||
      !identifier(grant.taskId) ||
      !integer(grant.taskVersion, 1, 50) ||
      !integer(grant.executionEpoch) ||
      !identifier(grant.grantId) ||
      !integer(grant.grantEpoch) ||
      !["active", "revoked"].includes(grant.status) ||
      !integer(grant.authorizedAt, 0) ||
      !Array.isArray(grant.resourceBindings) ||
      grant.resourceBindings.length > 10 ||
      ![grant.readObserved, grant.resultSaved, grant.signedGrantPresent].every(
        (v) => typeof v === "boolean",
      )
    )
      fail();
    try {
      const refs = grant.resourceBindings.map(resourceBinding);
      if (
        !unique(refs, (r: ResourceBindingMetadata) =>
          JSON.stringify([r.ref.kind, r.ref.sourceService, r.ref.resourceId, r.ref.incarnation]),
        )
      )
        fail();
    } catch {
      fail();
    }
    return grant as AgentGrant;
  });
  if (!unique(grants, (g) => g.grantId) || !unique(grants, (g) => g.taskId)) fail();
  return value as AgentConnection;
}
export function readConnectionList(value: unknown): ConnectionList {
  if (
    !exact(value, ["contractVersion", "items", "authorizationAttempts"]) ||
    value.contractVersion !== CONNECTION_CONTRACT ||
    !Array.isArray(value.items) ||
    value.items.length > 32 ||
    !Array.isArray(value.authorizationAttempts) ||
    value.authorizationAttempts.length > 64
  )
    fail();
  const items = value.items.map(readConnection);
  if (!unique(items, (item: AgentConnection) => item.connectionId)) fail();
  for (const row of value.authorizationAttempts) {
    if (
      !exact(row, [
        "requestId",
        "clientId",
        "connectionId",
        "authorizationId",
        "status",
        "createdAt",
        "updatedAt",
        "expiresAt",
      ]) ||
      ![row.requestId, row.clientId, row.connectionId, row.authorizationId].every(identifier) ||
      ![
        "pending",
        "authorized",
        "denied",
        "cancelled",
        "expired",
        "superseded",
        "revoked",
      ].includes(row.status) ||
      !integer(row.createdAt, 0) ||
      !integer(row.updatedAt, row.createdAt) ||
      !integer(row.expiresAt, row.createdAt)
    )
      fail();
  }
  if (!unique(value.authorizationAttempts, (row: AuthorizationAttempt) => row.requestId)) fail();
  return value as ConnectionList;
}
export function readRevocation(value: unknown, selection: RevokeSelection): AgentConnection {
  if (
    !exact(value, ["contractVersion", "connection"]) ||
    value.contractVersion !== CONNECTION_CONTRACT
  )
    fail();
  const connection = readConnection(value.connection);
  if (
    connection.connectionId !== selection.connectionId ||
    (selection.grantId === null
      ? connection.status !== "revoked"
      : !connection.grants.some((g) => g.grantId === selection.grantId && g.status === "revoked"))
  )
    fail();
  return connection;
}
export const connectionError = (error: unknown) =>
  object(error) &&
  [
    "invalid_response",
    "session_expired",
    "insufficient_scope",
    "request_timeout",
    "cancelled",
    "request_failed",
    "outcome_unknown",
    "not_found",
    "version_conflict",
    "review_required",
  ].includes(error.code)
    ? String(error.code)
    : "request_failed";
