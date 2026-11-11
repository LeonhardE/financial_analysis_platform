/** Temporary pairing link only; private Agent keys never enter the browser. */
import { ConnectionError, exact, identifier } from "./agent-connections";
export type AgentAuthorizationHandoff = {
  version: 1;
  issuer: string;
  vaultId: string;
  connectionId: string;
  setupIntentId: string;
  secret: string;
};
export function agentAuthorizationHandoff(
  hash: string,
  expectedOrigin: string,
): AgentAuthorizationHandoff | null {
  if (!hash.startsWith("#agent_authorization=")) return null;
  const q = new URLSearchParams(hash.slice(1));
  if (q.size !== 1 || q.getAll("agent_authorization").length !== 1)
    throw new ConnectionError("invalid_handoff");
  const encoded = q.get("agent_authorization") ?? "";
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(encoded)) throw new ConnectionError("invalid_handoff");
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const raw = Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (c) =>
      c.charCodeAt(0),
    );
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (
      !exact(v, ["version", "issuer", "vaultId", "connectionId", "setupIntentId", "secret"]) ||
      v.version !== 1 ||
      v.issuer !== expectedOrigin ||
      !identifier(v.vaultId) ||
      !identifier(v.connectionId) ||
      typeof v.setupIntentId !== "string" ||
      !/^[A-Za-z0-9_-]{22,128}$/.test(v.setupIntentId) ||
      typeof v.secret !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(v.secret)
    )
      throw Error();
    return {
      version: 1,
      issuer: v.issuer,
      vaultId: v.vaultId,
      connectionId: v.connectionId,
      setupIntentId: v.setupIntentId,
      secret: v.secret,
    };
  } catch {
    throw new ConnectionError("invalid_handoff");
  }
}
