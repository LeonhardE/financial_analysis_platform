/** Shared closed owner route table; no Agent bearer or native OAuth approval proxy. */
const ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const OP = "[A-Za-z0-9_-]{22,128}";
export type PersistentOwnerRoute = {
  kind: "read" | "control" | "small" | "persistent-publication";
  max: number;
  operation?: boolean;
  author?: boolean;
  responseStatus: 200 | 201;
  query?: Record<string, "limit" | "persistent-cursor">;
};
export function persistentOwnerRoute(path: string, method: string): PersistentOwnerRoute | null {
  const match = (pattern: string) => new RegExp(`^${pattern}$`).test(path);
  if (
    method === "GET" &&
    (path === "/api/v2/persistent-agents/capabilities" ||
      path === "/api/v2/persistent-connections" ||
      path === "/api/v2/persistent-account-authorizations/capabilities" ||
      match(
        `/api/v2/persistent-agents/${ID}/${ID}(?:/(?:resource-consent|(?:operations|resource-operations)/${OP}))?`,
      ) ||
      match(`/api/v2/persistent-content/${ID}/tasks/${ID}/authority`) ||
      match(`/api/v2/persistent-content/${ID}/connections/${ID}/operations/${OP}`) ||
      match(`/api/v2/runtime-setups/${ID}`) ||
      match(`/api/v2/persistent-plans/${ID}/${ID}/${ID}`) ||
      match(`/api/v2/persistent-results/${ID}/${ID}`))
  )
    return { kind: "read", max: 0, responseStatus: 200 };
  if (method === "GET" && match(`/api/v2/persistent-results/${ID}`))
    return {
      kind: "read",
      max: 0,
      responseStatus: 200,
      query: { limit: "limit", cursor: "persistent-cursor" },
    };
  if (method === "POST" && match(`/api/v2/persistent-connections/${ID}/revocations`))
    return { kind: "small", max: 4096, responseStatus: 200 };
  if (
    method === "POST" &&
    match(
      `/api/v2/persistent-agents/${ID}/${ID}/(?:bindings|revocations|resource-approvals|resource-revocations)`,
    )
  )
    return {
      kind: "control",
      max: path.includes("/resource-") ? 98304 : 24576,
      operation: true,
      responseStatus: 201,
    };
  if (method === "POST" && match(`/api/v2/persistent-content/${ID}/connections/${ID}/publications`))
    return { kind: "persistent-publication", max: 540672, operation: true, responseStatus: 201 };
  if (method === "POST" && match(`/api/v2/runtime-setups/${ID}/completion`))
    return { kind: "small", max: 4096, responseStatus: 200 };
  if (method === "PATCH" && match(`/api/v2/persistent-results/${ID}/${ID}/state`))
    return { kind: "control", max: 24576, operation: true, author: true, responseStatus: 200 };
  return null;
}
