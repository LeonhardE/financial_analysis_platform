/** Closed Owner transport for the already released, optional Hub task center. */
import "server-only";
import { CONTRACT, fields, record, integer, signedObject } from "./owner-transport";
const ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
  OP = "[A-Za-z0-9_-]{22,128}";
const id = (v: unknown) => typeof v === "string" && new RegExp(`^${ID}$`).test(v);
export function taskCenterRoute(path: string, method: string) {
  if (
    method === "GET" &&
    new RegExp(`^/api/v3/provider-connections/${ID}/(?:muse|chatgpt)$`).test(path)
  )
    return { kind: "read" as const, max: 0, responseStatus: 200 as const };
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
  if (path.startsWith("/api/v3/provider-connections/"))
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
      value.contractVersion === CONTRACT &&
      value.profile === "folioview.provider-connection-slot.v1" &&
      Array.isArray(value.retirementCandidates) &&
      value.retirementCandidates.length <= 32 &&
      value.requiresFreshGrants === true
    );
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
