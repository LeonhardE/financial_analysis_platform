/** Shared closed owner route table; no Agent bearer or native OAuth approval proxy. */
const ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const OP = "[A-Za-z0-9_-]{22,128}";
export type PersistentOwnerRoute = {
  kind:
    | "read"
    | "control"
    | "small"
    | "persistent-publication"
    | "executor-binding"
    | "credential-approval";
  max: number;
  operation?: boolean;
  author?: boolean;
  responseStatus: 200 | 201;
  query?: Record<string, "limit" | "persistent-cursor">;
};
/** Same ciphertext grammar, separate independently Root-approved parent. */
export function executorLegacyPath(path: string): string | null {
  const m = new RegExp(`^/api/v2/executor-connections/(${ID})/(${ID})(?:/(.*))?$`).exec(path);
  if (!m) return null;
  const [, v, c, tail] = m;
  if (tail === "publications")
    return `/api/v2/persistent-content/${v}/connections/${c}/publications`;
  if (tail?.startsWith("publication-operations/"))
    return `/api/v2/persistent-content/${v}/connections/${c}/operations/${tail.slice(23)}`;
  if (tail?.startsWith("identity-operations/"))
    return `/api/v2/persistent-agents/${v}/${c}/operations/${tail.slice(20)}`;
  if (
    !tail ||
    /^(resource-consent|resource-approvals|resource-revocations|revocations)$/.test(tail) ||
    new RegExp(`^resource-operations/${OP}$`).test(tail)
  )
    return `/api/v2/persistent-agents/${v}/${c}` + (tail ? "/" + tail : "");
  return null;
}
export function persistentOwnerRoute(path: string, method: string): PersistentOwnerRoute | null {
  if (
    method === "POST" &&
    new RegExp(`^/api/v2/executor-connections/${ID}/${ID}/bindings$`).test(path)
  )
    return { kind: "executor-binding", max: 69632, operation: true, responseStatus: 201 };
  if (path.startsWith("/api/v2/executor-connections/")) {
    const mapped = executorLegacyPath(path);
    return mapped ? persistentOwnerRoute(mapped, method) : null;
  }
  const match = (pattern: string) => new RegExp(`^${pattern}$`).test(path);
  if (
    method === "GET" &&
    (path === "/api/v3/agent-credentials/capabilities" ||
      match(`/api/v3/agent-credentials/${ID}/${ID}(?:/(?:setups|operations)/${OP})?`))
  )
    return { kind: "read", max: 0, responseStatus: 200 };
  if (method === "POST" && match(`/api/v3/agent-credentials/${ID}/${ID}/approvals`))
    return { kind: "credential-approval", max: 33000, operation: true, responseStatus: 201 };

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
