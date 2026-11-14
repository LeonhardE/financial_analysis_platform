/** Display composition only. Original credential signatures still require the owner Worker. */
import type { PersistentConnection } from "./persistent-experience-controller";
type Json = Record<string, any>;
const CONTRACT = "folioview.agent-workspace.v2.0";
const record = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const fields = (v: unknown, names: string[]): v is Json =>
  record(v) && Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const integer = (v: unknown, min = 0) => Number.isSafeInteger(v) && Number(v) >= min;
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const signed = (v: unknown) =>
  fields(v, ["protected", "payload", "signature"]) &&
  Object.values(v).every((s) => typeof s === "string" && /^[A-Za-z0-9_-]+$/.test(s));
const ref = (v: unknown) =>
  fields(v, ["connectionId", "clientId", "credentialGeneration", "credentialFingerprint"]) &&
  id(v.connectionId) &&
  id(v.clientId) &&
  integer(v.credentialGeneration, 1) &&
  hash(v.credentialFingerprint);
const equalRef = (a: Json, b: Json) =>
  ["connectionId", "clientId", "credentialGeneration", "credentialFingerprint"].every(
    (k) => a[k] === b[k],
  );
function providerState(v: unknown, vault: string, provider: string) {
  if (
    !fields(v, [
      "contractVersion",
      "profile",
      "slot",
      "retainedSelections",
      "retirementCandidates",
      "legacyBlockers",
      "requiresFreshGrants",
    ]) ||
    v.contractVersion !== CONTRACT ||
    v.profile !== "folioview.provider-connection-slot.v1" ||
    v.requiresFreshGrants !== true ||
    !Array.isArray(v.retainedSelections) ||
    v.retainedSelections.length > 100 ||
    !Array.isArray(v.retirementCandidates) ||
    v.retirementCandidates.length > 32 ||
    !v.retirementCandidates.every(ref) ||
    new Set(v.retirementCandidates.map((r: Json) => r.connectionId)).size !==
      v.retirementCandidates.length ||
    !Array.isArray(v.legacyBlockers) ||
    v.legacyBlockers.length > 32 ||
    !v.legacyBlockers.every(id) ||
    new Set(v.legacyBlockers).size !== v.legacyBlockers.length
  )
    return false;
  if (
    !v.retainedSelections.every(
      (s: unknown) =>
        fields(s, ["taskId", "taskVersion", "executionEpoch", "grantFingerprint", "resourceIds"]) &&
        id(s.taskId) &&
        integer(s.taskVersion, 1) &&
        integer(s.executionEpoch, 1) &&
        hash(s.grantFingerprint) &&
        Array.isArray(s.resourceIds) &&
        s.resourceIds.length <= 10 &&
        s.resourceIds.every(id) &&
        new Set(s.resourceIds).size === s.resourceIds.length,
    )
  )
    return false;
  if (v.slot === null) return true;
  const s = v.slot;
  return (
    fields(s, [
      "contractVersion",
      "profile",
      "ownerSubject",
      "vaultId",
      "provider",
      "slotId",
      "slotVersion",
      "slotGeneration",
      "currentCredential",
      "lastCredential",
    ]) &&
    s.contractVersion === CONTRACT &&
    s.profile === v.profile &&
    id(s.ownerSubject) &&
    id(s.slotId) &&
    s.vaultId === vault &&
    s.provider === provider &&
    integer(s.slotVersion, 1) &&
    integer(s.slotGeneration, 1) &&
    s.slotGeneration <= s.slotVersion &&
    ref(s.lastCredential) &&
    (s.currentCredential === null ||
      (ref(s.currentCredential) && equalRef(s.currentCredential, s.lastCredential)))
  );
}
function connection(v: unknown) {
  return (
    fields(v, [
      "connectionId",
      "clientId",
      "vaultId",
      "provider",
      "status",
      "accountState",
      "linkedAt",
    ]) &&
    [v.connectionId, v.clientId, v.vaultId].every(id) &&
    ["muse", "chatgpt"].includes(v.provider) &&
    ["active", "revoked"].includes(v.status) &&
    ["connected", "revoked", "relogin_required", "connecting"].includes(v.accountState) &&
    integer(v.linkedAt)
  );
}
function credential(v: unknown, c: Json, slot: Json | null) {
  if (
    !fields(v, [
      "contractVersion",
      "profile",
      "identity",
      "binding",
      "lease",
      "approval",
      "status",
      "defaultValiditySeconds",
      "noticeSeconds",
    ]) ||
    v.contractVersion !== CONTRACT ||
    v.profile !== "folioview.agent-credential.v1" ||
    !["active", "expiring", "expired", "revoked", "reauthorization_required"].includes(v.status) ||
    v.defaultValiditySeconds !== 7776000 ||
    v.noticeSeconds !== 604800 ||
    (v.identity === null ? v.binding !== null : !record(v.identity) || !signed(v.binding)) ||
    (v.lease === null ? v.approval !== null : !record(v.lease) || !signed(v.approval)) ||
    (v.lease === null) !== (v.status === "reauthorization_required") ||
    (v.identity === null && v.lease !== null)
  )
    return false;
  for (const actor of [v.identity, v.lease]) {
    if (actor === null) continue;
    if (
      actor.vaultId !== c.vaultId ||
      actor.connectionId !== c.connectionId ||
      actor.clientId !== c.clientId ||
      (slot && actor.ownerSubject !== slot.ownerSubject)
    )
      return false;
  }
  if (v.lease !== null && v.identity.ownerSubject !== v.lease.ownerSubject) return false;
  return (
    !slot ||
    (v.lease !== null &&
      slot.currentCredential.credentialGeneration === v.lease.generation &&
      slot.currentCredential.credentialFingerprint === v.lease.credentialFingerprint)
  );
}
export type ConnectionSummary = {
  contractVersion: string;
  profile: string;
  vaultId: string;
  connections: PersistentConnection[];
  providers: Record<"muse" | "chatgpt", Json>;
  credentials: { connectionId: string; state: Json }[];
};
/** Reject partial/duplicate compositions and mismatched actors before publishing verified views. */
export function connectionSummary(v: unknown, vault: string): v is ConnectionSummary {
  if (
    !fields(v, [
      "contractVersion",
      "profile",
      "vaultId",
      "connections",
      "providers",
      "credentials",
    ]) ||
    v.contractVersion !== CONTRACT ||
    v.profile !== "folioview.provider-connection-summary.v1" ||
    v.vaultId !== vault ||
    !id(vault) ||
    !Array.isArray(v.connections) ||
    v.connections.length > 32 ||
    !v.connections.every(connection) ||
    new Set(v.connections.map((c: Json) => c.connectionId)).size !== v.connections.length ||
    !fields(v.providers, ["muse", "chatgpt"]) ||
    !providerState(v.providers.muse, vault, "muse") ||
    !providerState(v.providers.chatgpt, vault, "chatgpt") ||
    !Array.isArray(v.credentials) ||
    v.credentials.length > 32
  )
    return false;
  const slots = [v.providers.muse.slot, v.providers.chatgpt.slot].filter((s) => s !== null);
  if (slots.length === 2 && slots[0].ownerSubject !== slots[1].ownerSubject) return false;
  const expected = new Map<string, Json>();
  for (const c of v.connections) {
    if (c.status !== "active" || c.vaultId !== vault) continue;
    const slot = v.providers[c.provider].slot,
      current = slot?.currentCredential;
    if (!slot || (current?.connectionId === c.connectionId && current.clientId === c.clientId))
      expected.set(c.connectionId, c);
  }
  for (const item of v.credentials) {
    if (!fields(item, ["connectionId", "state"]) || !id(item.connectionId)) return false;
    const c = expected.get(item.connectionId);
    if (!c || !credential(item.state, c, v.providers[c.provider].slot)) return false;
    expected.delete(item.connectionId);
  }
  return expected.size === 0;
}

type DisplayCapabilities = Record<"agents" | "account" | "credentials", Json>;
type DisplayBase = {
  contractVersion: string;
  profile: string;
  vaultId: string;
  capabilities: DisplayCapabilities;
};
export type ConnectionDisplay = DisplayBase &
  (
    | { mode: "complete"; vaultResponse: Json; summary: ConnectionSummary }
    | { mode: "separate"; vaultResponse: null; summary: null }
  );
function capabilities(v: unknown): v is DisplayCapabilities {
  if (!fields(v, ["agents", "account", "credentials"])) return false;
  const a = v.agents,
    b = v.account,
    c = v.credentials;
  return (
    fields(a, [
      "contractVersion",
      "profile",
      "enrollmentEnabled",
      "resourceConsentEnabled",
      "executionEnabled",
    ]) &&
    a.contractVersion === CONTRACT &&
    a.profile === "folioview.persistent-agent-capabilities.v1" &&
    [a.enrollmentEnabled, a.resourceConsentEnabled, a.executionEnabled].every(
      (v) => typeof v === "boolean",
    ) &&
    fields(b, ["contractVersion", "profile", "accountLinkEnabled", "scope", "runtimeReady"]) &&
    b.contractVersion === CONTRACT &&
    b.profile === "folioview.persistent-account.v1" &&
    typeof b.accountLinkEnabled === "boolean" &&
    b.scope === "runtime:connect" &&
    b.runtimeReady === false &&
    fields(c, [
      "contractVersion",
      "profile",
      "enabled",
      "defaultValiditySeconds",
      "noticeSeconds",
    ]) &&
    c.contractVersion === CONTRACT &&
    c.profile === "folioview.agent-credential.v1" &&
    typeof c.enabled === "boolean" &&
    c.defaultValiditySeconds === 7776000 &&
    c.noticeSeconds === 604800
  );
}
function currentVaultResponse(v: unknown, vault: string) {
  // This closes the composition. The proxy's original DTO, the original bounded
  // vault parser and the owner Worker still validate the complete vault/proofs.
  return (
    fields(v, ["contractVersion", "vault", "sources"]) &&
    v.contractVersion === CONTRACT &&
    fields(v.vault, ["vaultId", "rootJwk", "rootKeyId", "registryHistory", "archive", "version"]) &&
    v.vault.vaultId === vault &&
    record(v.vault.rootJwk) &&
    typeof v.vault.rootKeyId === "string" &&
    integer(v.vault.version, 1) &&
    Array.isArray(v.vault.registryHistory) &&
    v.vault.registryHistory.length >= 1 &&
    v.vault.registryHistory.length <= 32 &&
    Array.isArray(v.sources) &&
    v.sources.length <= 10 &&
    v.sources.every(
      (s: unknown) =>
        fields(s, ["resourceRef", "sourceEpoch"]) &&
        integer(s.sourceEpoch, 1) &&
        fields(s.resourceRef, ["kind", "sourceService", "resourceId", "incarnation"]) &&
        s.resourceRef.kind === "holdings" &&
        s.resourceRef.sourceService === "portfolio" &&
        id(s.resourceRef.resourceId) &&
        id(s.resourceRef.incarnation),
    )
  );
}
export function connectionDisplay(v: unknown, vault: string): v is ConnectionDisplay {
  if (
    !fields(v, [
      "contractVersion",
      "profile",
      "vaultId",
      "mode",
      "vaultResponse",
      "summary",
      "capabilities",
    ]) ||
    v.contractVersion !== CONTRACT ||
    v.profile !== "folioview.provider-connection-display.v1" ||
    v.vaultId !== vault ||
    !id(vault) ||
    !capabilities(v.capabilities)
  )
    return false;
  if (v.mode === "separate") return v.vaultResponse === null && v.summary === null;
  return (
    v.mode === "complete" &&
    currentVaultResponse(v.vaultResponse, vault) &&
    connectionSummary(v.summary, vault)
  );
}
