import type { EncryptedTask, ResourceBindingMetadata, TaskMetadata } from "./encrypted-types";

export const TASK_CONTRACT = "folioview.agent-workspace.v2.0";
export class TaskError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export type TaskResourceOption = {
  key: string;
  kind: "holdings" | "watchlist" | "channel_follows";
  groupStatus: string;
  state: string;
  binding: ResourceBindingMetadata | null;
  revision: number | null;
  selectable: boolean;
  encryptedEvidence: "not_prepared" | "not_checked";
};
export const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const exact = (value: unknown, keys: string[]): value is Record<string, any> =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
export const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const integer = (value: unknown, min = 1) =>
  Number.isSafeInteger(value) && (value as number) >= min;
const date = (value: unknown) =>
  typeof value === "string" && /Z$/.test(value) && Number.isFinite(Date.parse(value));
export const bindingKey = (binding: ResourceBindingMetadata) =>
  [
    binding.ref.kind,
    binding.ref.sourceService,
    binding.ref.resourceId,
    binding.ref.incarnation,
  ].join(":");
export const bindingsKey = (bindings: ResourceBindingMetadata[]) =>
  JSON.stringify(
    bindings
      .map((item) => [bindingKey(item), item.sourceEpoch])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
export function resourceBinding(value: unknown): ResourceBindingMetadata {
  if (
    !exact(value, ["ref", "sourceEpoch"]) ||
    !exact(value.ref, ["kind", "sourceService", "resourceId", "incarnation"]) ||
    !["holdings", "watchlist", "channel_follows"].includes(value.ref.kind) ||
    value.ref.sourceService !== (value.ref.kind === "holdings" ? "portfolio" : "user") ||
    !identifier(value.ref.resourceId) ||
    !identifier(value.ref.incarnation) ||
    !integer(value.sourceEpoch)
  )
    throw new TaskError("invalid_response");
  return value as ResourceBindingMetadata;
}
export function taskMetadata(value: unknown): TaskMetadata {
  if (
    !exact(value, [
      "contractVersion",
      "vaultId",
      "taskId",
      "taskVersion",
      "executionEpoch",
      "status",
      "resourceBindings",
      "objectRevision",
      "deliveryRevision",
      "envelopeFingerprint",
      "keyEpoch",
      "createdAt",
      "updatedAt",
    ]) ||
    value.contractVersion !== TASK_CONTRACT ||
    !identifier(value.vaultId) ||
    !identifier(value.taskId) ||
    !integer(value.taskVersion) ||
    value.taskVersion > 50 ||
    !integer(value.executionEpoch) ||
    !["active", "paused", "archived"].includes(value.status) ||
    !Array.isArray(value.resourceBindings) ||
    value.resourceBindings.length > 10 ||
    value.objectRevision !== value.taskVersion ||
    value.deliveryRevision !== 1 ||
    typeof value.envelopeFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.envelopeFingerprint) ||
    !integer(value.keyEpoch) ||
    !date(value.createdAt) ||
    !date(value.updatedAt)
  )
    throw new TaskError("invalid_response");
  const bindings = value.resourceBindings.map(resourceBinding);
  if (new Set(bindings.map(bindingKey)).size !== bindings.length)
    throw new TaskError("invalid_response");
  return value as TaskMetadata;
}
export function taskPage(value: unknown): TaskMetadata[] {
  if (
    !exact(value, ["contractVersion", "items", "nextCursor"]) ||
    value.contractVersion !== TASK_CONTRACT ||
    !Array.isArray(value.items) ||
    value.items.length > 32 ||
    value.nextCursor !== null
  )
    throw new TaskError("invalid_response");
  const items = value.items.map(taskMetadata);
  if (new Set(items.map((item) => item.taskId)).size !== items.length)
    throw new TaskError("invalid_response");
  return items;
}
export function encryptedTask(value: unknown): EncryptedTask {
  const signed = (part: unknown) =>
    exact(part, ["protected", "payload", "signature"]) &&
    [part.protected, part.payload, part.signature].every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 786432,
    );
  if (
    !exact(value, ["contractVersion", "metadata", "signedObject", "keyProofs"]) ||
    value.contractVersion !== TASK_CONTRACT ||
    !signed(value.signedObject) ||
    !exact(value.keyProofs, ["checkpoint", "certificates"]) ||
    !signed(value.keyProofs.checkpoint) ||
    !Array.isArray(value.keyProofs.certificates) ||
    value.keyProofs.certificates.length > 128 ||
    !value.keyProofs.certificates.every(signed)
  )
    throw new TaskError("invalid_response");
  taskMetadata(value.metadata);
  return value as EncryptedTask;
}
/** Discovery only: selecting a source does not prepare its encrypted evidence or grant an agent. */
export function taskCatalogue(value: unknown): TaskResourceOption[] {
  if (
    !exact(value, ["contractVersion", "profile", "readAt", "groups"]) ||
    value.contractVersion !== TASK_CONTRACT ||
    value.profile !== "folioview.owner-resource-discovery.v1" ||
    !date(value.readAt) ||
    !Array.isArray(value.groups) ||
    value.groups.length !== 3
  )
    throw new TaskError("invalid_response");
  const result: TaskResourceOption[] = [];
  for (const [index, kind] of ["holdings", "watchlist", "channel_follows"].entries()) {
    const group = value.groups[index];
    if (
      !exact(group, ["kind", "sourceService", "status", "items"]) ||
      group.kind !== kind ||
      group.sourceService !== (kind === "holdings" ? "portfolio" : "user") ||
      !["available", "uninitialized", "partial", "unavailable"].includes(group.status) ||
      !Array.isArray(group.items) ||
      group.items.length > (kind === "holdings" ? 10 : 1) ||
      (kind !== "holdings" && group.items.length !== 1)
    )
      throw new TaskError("invalid_response");
    for (const [position, item] of group.items.entries()) {
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
        !["not_prepared", "not_checked"].includes(item.encryptedEvidence) ||
        !(item.revision === null || integer(item.revision, 0)) ||
        !(item.sourceEpoch === null || integer(item.sourceEpoch)) ||
        !(item.updatedAt === null || date(item.updatedAt)) ||
        !(item.snapshotId === null || identifier(item.snapshotId)) ||
        !(
          kind === "holdings"
            ? ["active", "revoking", "disconnected", "deleted", "pending", "unavailable"]
            : ["ready", "empty", "uninitialized", "unavailable"]
        ).includes(item.state)
      )
        throw new TaskError("invalid_response");
      const binding =
        item.ref === null || item.sourceEpoch === null
          ? null
          : resourceBinding({ ref: item.ref, sourceEpoch: item.sourceEpoch });
      if (binding && binding.ref.kind !== kind) throw new TaskError("invalid_response");
      if (
        item.ref !== null &&
        !binding &&
        resourceBinding({ ref: item.ref, sourceEpoch: 1 }).ref.kind !== kind
      )
        throw new TaskError("invalid_response");
      const selectable = Boolean(
        binding &&
        ["available", "partial"].includes(group.status) &&
        item.revision !== null &&
        (kind === "holdings"
          ? item.state === "active" && item.revision > 0 && item.snapshotId
          : ["ready", "empty"].includes(item.state)),
      );
      result.push({
        key: binding ? bindingKey(binding) : `${kind}:unavailable:${position}`,
        kind: kind as TaskResourceOption["kind"],
        groupStatus: group.status,
        state: item.state,
        binding,
        revision: item.revision,
        selectable,
        encryptedEvidence: item.encryptedEvidence,
      });
    }
  }
  const keys = result.filter((row) => row.binding).map((row) => row.key);
  if (new Set(keys).size !== keys.length) throw new TaskError("invalid_response");
  return result;
}
export function taskError(error: unknown): string {
  const code = object(error) && typeof error.code === "string" ? error.code : "";
  return [
    "cancelled",
    "request_timeout",
    "invalid_response",
    "session_expired",
    "insufficient_scope",
    "not_found",
    "version_conflict",
    "unlock_required",
    "pending_task",
    "pending_stale",
    "draft_conflict",
    "source_unavailable",
    "validation_failed",
    "review_required",
    "task_limit",
    "version_limit",
    "historical_read_only",
    "unsaved_draft",
    "nothing_to_save",
    "key_revoked",
    "registry_conflict",
    "stale_key_epoch",
    "stale_epoch",
  ].includes(code)
    ? code
    : "request_failed";
}
