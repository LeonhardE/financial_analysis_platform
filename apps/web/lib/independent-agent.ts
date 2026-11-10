/** Public deployment selection only. Root/Policy authority is checked in the Owner Worker. */
export const INDEPENDENT_CONTRACT = "folioview.agent-workspace.v2.0";
export type IndependentAgentConfiguration = {
  connectionId: string;
  clientId: string;
  issuer: string;
  audience: string;
  policyJwk: Record<string, string>;
  nativeRedirectUris: string[];
};
const exact = (v: any, keys: string[]) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const origin = /^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export function independentConfiguration(v: any): IndependentAgentConfiguration {
  if (
    !exact(v, [
      "connectionId",
      "clientId",
      "issuer",
      "audience",
      "policyJwk",
      "nativeRedirectUris",
    ]) ||
    ![v.connectionId, v.clientId].every(
      (s) => typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(s),
    ) ||
    typeof v.issuer !== "string" ||
    v.issuer.length > 1024 ||
    !origin.test(v.issuer) ||
    typeof v.audience !== "string" ||
    !v.audience.endsWith("/mcp") ||
    !origin.test(v.audience.slice(0, -4)) ||
    v.audience.length > 1028 ||
    v.audience.slice(0, -4) === v.issuer ||
    !exact(v.policyJwk, ["kty", "crv", "x", "y"]) ||
    v.policyJwk.kty !== "EC" ||
    v.policyJwk.crv !== "P-256" ||
    ![v.policyJwk.x, v.policyJwk.y].every(
      (s) => typeof s === "string" && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(s),
    ) ||
    !Array.isArray(v.nativeRedirectUris) ||
    v.nativeRedirectUris.length < 1 ||
    v.nativeRedirectUris.length > 4 ||
    new Set(v.nativeRedirectUris).size !== v.nativeRedirectUris.length ||
    !v.nativeRedirectUris.every(
      (s: unknown) =>
        typeof s === "string" &&
        s.length <= 2048 &&
        /^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\/[A-Za-z0-9._~-]+)+$/.test(s) &&
        !s.includes("/../") &&
        !s.endsWith("/.."),
    )
  )
    throw new Error("invalid_configuration");
  return structuredClone(v);
}
export async function independentJson(
  response: Response,
  signal?: AbortSignal,
  maximum = 262144,
  status = 200,
): Promise<any> {
  if (
    signal?.aborted ||
    response.status !== status ||
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json" ||
    !response.body
  )
    throw new Error("request_failed");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const part = await reader.read();
      if (signal?.aborted) throw new Error("cancelled");
      if (part.done) break;
      size += part.value.length;
      if (size > maximum) throw new Error("invalid_response");
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}
export async function loadIndependentConfiguration(signal?: AbortSignal) {
  const value = await independentJson(
    await fetch("/api/private/independent-agent/config", {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    }),
    signal,
    16384,
  );
  if (
    !exact(value, ["schemaVersion", "enabled", "configuration"]) ||
    value.schemaVersion !== 1 ||
    typeof value.enabled !== "boolean" ||
    (!value.enabled && value.configuration !== null)
  )
    throw new Error("invalid_configuration");
  return value.enabled ? independentConfiguration(value.configuration) : null;
}
export function policyRequest(
  config: IndependentAgentConfiguration,
  path: string,
  method: string,
  json?: any,
  expectedIssuer?: string,
) {
  if (config.issuer !== expectedIssuer) throw new Error("policy_destination_changed");
  const base = `/api/v1/connections/${config.connectionId}`;
  const pending = /^\/api\/v1\/authorizations\/pauth_[A-Za-z0-9_-]{43}(\/approvals)?$/.exec(path);
  const signed = (s: any) =>
    exact(s, ["protected", "payload", "signature"]) &&
    Object.values(s).every((v) => typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v));
  if (method === "GET" && json === undefined && (path === base || (pending && !pending[1]))) return;
  if (
    method === "POST" &&
    path === base + "/checkpoint" &&
    exact(json, ["contractVersion"]) &&
    json.contractVersion === INDEPENDENT_CONTRACT
  )
    return;
  if (
    method === "POST" &&
    pending?.[1] &&
    exact(json, ["contractVersion", "connectionId", "command"]) &&
    json.contractVersion === INDEPENDENT_CONTRACT &&
    json.connectionId === config.connectionId &&
    signed(json.command)
  )
    return;
  if (
    method === "POST" &&
    path === base + "/controls" &&
    exact(json, ["contractVersion", "request"]) &&
    json.contractVersion === INDEPENDENT_CONTRACT &&
    exact(json.request, ["action", "parameters", "approval", "command"]) &&
    json.request.action === "revoke" &&
    exact(json.request.parameters, []) &&
    json.request.approval === null &&
    signed(json.request.command)
  )
    return;
  throw new Error("invalid_policy_request");
}
export function independentHandoff(search: string) {
  const q = new URLSearchParams(search);
  if (!q.has("request")) return null;
  const id = q.get("request");
  if (q.size !== 1 || !id || !/^pauth_[A-Za-z0-9_-]{43}$/.test(id))
    throw new Error("invalid_handoff");
  return id;
}
export function policyRedirect(value: unknown, config: IndependentAgentConfiguration) {
  if (typeof value !== "string" || value.length > 4096) throw new Error("invalid_redirect");
  const url = new URL(value),
    base = url.origin + url.pathname;
  if (
    !config.nativeRedirectUris.includes(base) ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.size !== 3 ||
    [...url.searchParams.keys()].some((k) => !["code", "state", "iss"].includes(k)) ||
    !url.searchParams.get("code") ||
    !url.searchParams.get("state") ||
    url.searchParams.get("iss") !== config.issuer
  )
    throw new Error("invalid_redirect");
  return url.href;
}
