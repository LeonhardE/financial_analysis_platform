/** Owner display metadata only. These labels never establish an active connection or permission. */
type Provider = "muse" | "chatgpt";
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).sort().join("|") === fields.sort().join("|");
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function readReportProviders(value: unknown, vaultId: string): Record<string, Provider> {
  if (
    !object(value) ||
    !exact(value, ["contractVersion", "profile", "connections"]) ||
    value.contractVersion !== "folioview.agent-workspace.v2.0" ||
    value.profile !== "folioview.persistent-account.v1" ||
    !Array.isArray(value.connections) ||
    value.connections.length > 32
  )
    throw Error("invalid_response");
  const providers: Record<string, Provider> = Object.create(null);
  const seen = new Set<string>();
  for (const row of value.connections) {
    if (
      !object(row) ||
      !exact(row, [
        "connectionId",
        "clientId",
        "vaultId",
        "provider",
        "status",
        "accountState",
        "linkedAt",
      ]) ||
      !identifier(row.connectionId) ||
      !identifier(row.clientId) ||
      !identifier(row.vaultId) ||
      !["muse", "chatgpt"].includes(String(row.provider)) ||
      !["active", "revoked"].includes(String(row.status)) ||
      !["connected", "revoked", "relogin_required", "connecting"].includes(
        String(row.accountState),
      ) ||
      !Number.isSafeInteger(row.linkedAt) ||
      Number(row.linkedAt) < 0 ||
      seen.has(row.connectionId)
    )
      throw Error("invalid_response");
    seen.add(row.connectionId);
    // A revoked/historical actor retains its original provider; other vaults cannot label this one.
    if (row.vaultId === vaultId) providers[row.connectionId] = row.provider as Provider;
  }
  return providers;
}
