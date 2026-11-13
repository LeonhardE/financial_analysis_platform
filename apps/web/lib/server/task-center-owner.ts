/** Closed Owner transport for the already released, optional Hub task center. */
import "server-only";
import { CONTRACT, fields, record, integer, signedObject } from "./owner-transport";
const ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
  OP = "[A-Za-z0-9_-]{22,128}";
const id = (v: unknown) => typeof v === "string" && new RegExp(`^${ID}$`).test(v);
const credentialRef = (v: unknown) =>
  record(v) &&
  fields(v, ["connectionId", "clientId", "credentialGeneration", "credentialFingerprint"]) &&
  id(v.connectionId) &&
  id(v.clientId) &&
  integer(v.credentialGeneration, 1) &&
  typeof v.credentialFingerprint === "string" &&
  /^[a-f0-9]{64}$/.test(v.credentialFingerprint);
const slotResponse = (v: unknown) =>
  record(v) &&
  fields(v, [
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
  v.contractVersion === CONTRACT &&
  v.profile === "folioview.provider-connection-slot.v1" &&
  [v.ownerSubject, v.vaultId, v.slotId].every(id) &&
  ["muse", "chatgpt"].includes(v.provider as string) &&
  integer(v.slotVersion, 1) &&
  integer(v.slotGeneration, 1) &&
  (v.currentCredential === null || credentialRef(v.currentCredential)) &&
  credentialRef(v.lastCredential);
export function taskCenterRoute(path: string, method: string) {
  const providerPath = new RegExp(
    `^/api/v3/provider-connections/${ID}/(?:muse|chatgpt)(?:/operations/${OP})?$`,
  );
  if (
    method === "GET" &&
    (path === "/api/v3/provider-connections/capabilities" || providerPath.test(path))
  )
    return { kind: "read" as const, max: 0, responseStatus: 200 as const };
  if (
    method === "POST" &&
    new RegExp(`^/api/v3/provider-connections/${ID}/(?:muse|chatgpt)/commands$`).test(path)
  )
    return { kind: "center" as const, max: 140000, operation: true, responseStatus: 201 as const };
  if (
    method === "GET" &&
    (path === "/api/v3/task-center/capabilities" ||
      new RegExp(
        `^/api/v3/task-center/${ID}/(?:trash|tasks/${ID}(?:/operations/${OP}|/manual(?:/${OP})?)?)$`,
      ).test(path))
  )
    return { kind: "read" as const, max: 0, responseStatus: 200 as const };
  if (method !== "POST") return null;
  if (new RegExp(`^/api/v3/task-center/${ID}/tasks/${ID}/(?:commands|manual)$`).test(path))
    return { kind: "center" as const, max: 24576, operation: true, responseStatus: 201 as const };
  if (
    new RegExp(
      `^/api/v3/task-center/${ID}/(?:trash/query|tasks/${ID}/(?:results/query|progress/query|maintenance|manual/${OP}/cancel|operations/${OP}/cancel))$`,
    ).test(path)
  )
    return { kind: "center" as const, max: 8192, responseStatus: 200 as const };
  return null;
}
export function taskCenterRequest(path: string, body: unknown) {
  if (!record(body) || body.contractVersion !== CONTRACT) return false;
  if (path.startsWith("/api/v3/provider-connections/")) {
    if (!fields(body, ["contractVersion", "command"]) || !record(body.command)) return false;
    const c = body.command;
    if (Boolean(fields(c, ["approval"]))) return signedObject(c.approval);
    if (
      !fields(c, ["approval", "review", "credential"]) ||
      !signedObject(c.approval) ||
      !record(c.review) ||
      !record(c.credential)
    )
      return false;
    const r = c.review,
      k = c.credential;
    return (
      fields(r, [
        "contractVersion",
        "profile",
        "ownerSubject",
        "vaultId",
        "provider",
        "slotId",
        "retiredCredentials",
        "tasks",
      ]) &&
      r.contractVersion === CONTRACT &&
      r.profile === "folioview.provider-connection-slot.v1" &&
      [r.ownerSubject, r.vaultId, r.slotId].every(id) &&
      ["muse", "chatgpt"].includes(r.provider as string) &&
      Array.isArray(r.retiredCredentials) &&
      r.retiredCredentials.length <= 32 &&
      r.retiredCredentials.every(
        (x: unknown) =>
          record(x) &&
          fields(x, [
            "connectionId",
            "clientId",
            "credentialGeneration",
            "credentialFingerprint",
          ]) &&
          id(x.connectionId) &&
          id(x.clientId) &&
          integer(x.credentialGeneration, 1) &&
          typeof x.credentialFingerprint === "string" &&
          /^[a-f0-9]{64}$/.test(x.credentialFingerprint),
      ) &&
      Array.isArray(r.tasks) &&
      r.tasks.length === 0 &&
      fields(k, ["binding", "approval", "activation"]) &&
      signedObject(k.binding) &&
      signedObject(k.approval) &&
      record(k.activation) &&
      fields(k.activation, ["version", "iv", "ciphertext"]) &&
      k.activation.version === 1 &&
      typeof k.activation.iv === "string" &&
      /^[A-Za-z0-9_-]{16}$/.test(k.activation.iv) &&
      typeof k.activation.ciphertext === "string" &&
      /^[A-Za-z0-9_-]{22,10923}$/.test(k.activation.ciphertext)
    );
  }
  if (/\/(commands|manual)$/.test(path))
    return fields(body, ["contractVersion", "command"]) && signedObject(body.command);
  if (path.endsWith("/trash/query"))
    return fields(body, ["contractVersion", "cursor"]) && (body.cursor === null || id(body.cursor));
  if (/\/operations\/[^/]+\/cancel$/.test(path))
    return (
      fields(body, ["contractVersion", "fingerprint"]) &&
      typeof body.fingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(body.fingerprint)
    );
  if (/\/(maintenance|cancel)$/.test(path)) return fields(body, ["contractVersion"]);
  if (!fields(body, ["contractVersion", "request"]) || !record(body.request)) return false;
  const r = body.request;
  if (path.endsWith("/results/query"))
    return (
      fields(r, ["limit", "cursor"]) &&
      integer(r.limit, 1) &&
      Number(r.limit) <= 50 &&
      (r.cursor === null || (typeof r.cursor === "string" && r.cursor.length <= 4096))
    );
  return (
    path.endsWith("/progress/query") &&
    fields(r, ["requestId", "assignmentIds"]) &&
    typeof r.requestId === "string" &&
    new RegExp(`^${OP}$`).test(r.requestId) &&
    Array.isArray(r.assignmentIds) &&
    r.assignmentIds.length >= 1 &&
    r.assignmentIds.length <= 32 &&
    r.assignmentIds.every(id) &&
    new Set(r.assignmentIds).size === r.assignmentIds.length
  );
}
export function taskCenterResponse(path: string, value: unknown) {
  if (!record(value)) return false;
  if (path.startsWith("/api/v3/provider-connections/")) {
    if (
      value.contractVersion !== CONTRACT ||
      value.profile !== "folioview.provider-connection-slot.v1"
    )
      return false;
    if (path.endsWith("/capabilities"))
      return (
        fields(value, [
          "contractVersion",
          "profile",
          "enabled",
          "providers",
          "automaticMigration",
        ]) &&
        typeof value.enabled === "boolean" &&
        JSON.stringify(value.providers) === JSON.stringify(["muse", "chatgpt"]) &&
        value.automaticMigration === false
      );
    const parts = path.split("/");
    if (
      value.slot !== null &&
      (!record(value.slot) || value.slot.vaultId !== parts[4] || value.slot.provider !== parts[5])
    )
      return false;
    if (
      /\/operations\//.test(path) &&
      (!record(value.operation) || value.operation.stableOperationId !== parts[7])
    )
      return false;
    if (path.endsWith("/commands") || /\/operations\//.test(path))
      return (
        fields(value, [
          "contractVersion",
          "profile",
          "slot",
          "operation",
          "credentialReceipt",
          "retainedSelections",
          "requiresFreshGrants",
        ]) &&
        slotResponse(value.slot) &&
        record(value.operation) &&
        fields(value.operation, [
          "contractVersion",
          "profile",
          "ownerSubject",
          "vaultId",
          "provider",
          "slotId",
          "stableOperationId",
          "operationFingerprint",
          "slotVersion",
          "slotGeneration",
          "currentCredentialFingerprint",
          "acceptedAt",
        ]) &&
        value.operation.contractVersion === CONTRACT &&
        value.operation.profile === value.profile &&
        [value.operation.ownerSubject, value.operation.vaultId, value.operation.slotId].every(id) &&
        ["muse", "chatgpt"].includes(value.operation.provider as string) &&
        typeof value.operation.stableOperationId === "string" &&
        new RegExp(`^${OP}$`).test(value.operation.stableOperationId) &&
        typeof value.operation.operationFingerprint === "string" &&
        /^[a-f0-9]{64}$/.test(value.operation.operationFingerprint) &&
        integer(value.operation.slotVersion, 1) &&
        integer(value.operation.slotGeneration, 1) &&
        integer(value.operation.acceptedAt, 0) &&
        (value.operation.currentCredentialFingerprint === null ||
          (typeof value.operation.currentCredentialFingerprint === "string" &&
            /^[a-f0-9]{64}$/.test(value.operation.currentCredentialFingerprint))) &&
        Array.isArray(value.retainedSelections) &&
        value.retainedSelections.length === 0 &&
        value.requiresFreshGrants === true
      );
    return (
      fields(value, [
        "contractVersion",
        "profile",
        "slot",
        "retainedSelections",
        "retirementCandidates",
        "legacyBlockers",
        "requiresFreshGrants",
      ]) &&
      (value.slot === null || slotResponse(value.slot)) &&
      Array.isArray(value.retirementCandidates) &&
      value.retirementCandidates.length <= 32 &&
      value.retirementCandidates.every(credentialRef) &&
      Array.isArray(value.legacyBlockers) &&
      value.legacyBlockers.length <= 32 &&
      Array.isArray(value.retainedSelections) &&
      value.retainedSelections.length <= 100 &&
      value.requiresFreshGrants === true
    );
  }
  // Ciphertext stays opaque here; trusted Worker verifies original controls.
  // No caller-supplied identity, code URL, dispatch claim or extra top-level data.
  const fieldsFor = path.endsWith("/capabilities")
    ? [
        "contractVersion",
        "profile",
        "enabled",
        "actions",
        "dispatchSupported",
        "nativeScheduleAttested",
      ]
    : /\/operations\/[^/]+\/cancel$/.test(path)
      ? ["contractVersion", "taskId", "operationId", "fingerprint", "state", "receipt"]
      : /\/manual\/[^/]+\/cancel$/.test(path)
        ? ["requestId", "cancelled"]
        : path.endsWith("/maintenance")
          ? ["contractVersion", "complete", "reviewRequired", "phase"]
          : /\/trash(?:\/query)?$/.test(path)
            ? ["contractVersion", "items", "nextCursor"]
            : path.endsWith("/manual") && "items" in value
              ? ["contractVersion", "items"]
              : /\/manual(?:\/[^/]+)?$/.test(path) && "snapshot" in value
                ? [
                    "receipt",
                    "snapshot",
                    "aggregate",
                    "reasons",
                    "expiresAt",
                    "canCancel",
                    "dispatchSupported",
                    "continuation",
                    "nativeScheduleAttested",
                  ]
                : path.endsWith("/manual")
                  ? [
                      "contractVersion",
                      "requestId",
                      "taskId",
                      "fingerprint",
                      "acceptedAt",
                      "expiresAt",
                      "dispatchSupported",
                      "continuation",
                      "nativeScheduleAttested",
                    ]
                  : path.endsWith("/results/query")
                    ? [
                        "contractVersion",
                        "profile",
                        "items",
                        "nextCursor",
                        "total",
                        "historyScanPending",
                        "ordering",
                        "nativeScheduleAttested",
                      ]
                    : path.endsWith("/progress/query")
                      ? ["snapshot", "aggregate", "nativeScheduleAttested"]
                      : /\/(commands|operations\/[^/]+)$/.test(path)
                        ? [
                            "contractVersion",
                            "profile",
                            "taskId",
                            "operationId",
                            "fingerprint",
                            "definition",
                            "assignment",
                            "requiresFreshDelivery",
                            "nativeScheduleAttested",
                          ]
                        : [
                            "contractVersion",
                            "profile",
                            "taskId",
                            "taskVersion",
                            "executionEpoch",
                            "rules",
                            "assignments",
                            "dispatchSupported",
                            "nativeScheduleAttested",
                          ];
  if (
    !fields(value, fieldsFor) ||
    ("contractVersion" in value && value.contractVersion !== CONTRACT) ||
    ("profile" in value && value.profile !== "folioview.task-center.v1") ||
    ("dispatchSupported" in value && value.dispatchSupported !== false) ||
    ("nativeScheduleAttested" in value && value.nativeScheduleAttested !== false)
  )
    return false;
  if (
    /\/operations\/[^/]+\/cancel$/.test(path) &&
    (!["cancelled", "committed"].includes(value.state as string) ||
      (value.state === "cancelled" ? value.receipt !== null : !record(value.receipt)))
  )
    return false;
  if ("items" in value && (!Array.isArray(value.items) || value.items.length > 50)) return false;
  if (
    "assignments" in value &&
    (!Array.isArray(value.assignments) || value.assignments.length > 32)
  )
    return false;
  return true;
}
