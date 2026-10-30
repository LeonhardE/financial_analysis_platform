import type { AgentPreparationPacket, Json, ResourceBindingMetadata } from "./encrypted-types";
import {
  AGENT_SCOPES,
  CONNECTION_CONTRACT,
  ConnectionError,
  exact,
  identifier,
  type AgentScope,
} from "./agent-connections";
import { resourceBinding, taskMetadata } from "./task-types";

export type SelectedResourceVersion = ResourceBindingMetadata & {
  revision: number;
  producerSnapshotId: string | null;
};
export type PreparedTask = {
  taskId: string;
  taskVersion: number;
  executionEpoch: number;
  resourceBindings: ResourceBindingMetadata[];
  grantId: string;
  grantEpoch: number;
  selectedResourceVersions?: SelectedResourceVersion[];
};
export type PreparedAuthorization = {
  taskIds: string[];
  approvedScopes: AgentScope[];
  tasks: PreparedTask[];
  authorizationCount: number;
  keyEpoch: number;
  registrySequence: number;
  checkpointDigest: string;
  authorizationExpiresAt: number;
  historyPolicy: "none" | "selected";
};
export type PendingAuthorization = {
  contractVersion: typeof CONNECTION_CONTRACT;
  provider: "muse";
  status: "pending" | "authorized" | "denied" | "cancelled";
  clientId: string;
  scopes: AgentScope[];
  connectionId: string;
  authorizationId: string;
  expiresAt: number;
  prepared: PreparedAuthorization | null;
};
const integer = (value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
function fail(): never {
  throw new ConnectionError("invalid_response");
}
const scopes = (value: unknown): value is AgentScope[] =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= AGENT_SCOPES.length &&
  new Set(value).size === value.length &&
  value.every((scope) => AGENT_SCOPES.includes(scope));
export function equalJSON(left: unknown, right: unknown): boolean {
  const sorted = (value: any): any =>
    Array.isArray(value)
      ? value.map(sorted)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key])]),
          )
        : value;
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}
export function readPendingAuthorization(value: unknown): PendingAuthorization {
  if (
    !exact(value, [
      "contractVersion",
      "provider",
      "status",
      "clientId",
      "scopes",
      "connectionId",
      "authorizationId",
      "expiresAt",
      "prepared",
    ]) ||
    value.contractVersion !== CONNECTION_CONTRACT ||
    value.provider !== "muse" ||
    !["pending", "authorized", "denied", "cancelled"].includes(value.status) ||
    ![value.clientId, value.connectionId, value.authorizationId].every(identifier) ||
    !scopes(value.scopes) ||
    !integer(value.expiresAt, 0)
  )
    fail();
  if (value.prepared !== null) {
    const p = value.prepared;
    if (
      !exact(p, [
        "taskIds",
        "approvedScopes",
        "tasks",
        "authorizationCount",
        "keyEpoch",
        "registrySequence",
        "checkpointDigest",
        "authorizationExpiresAt",
        "historyPolicy",
      ]) ||
      !Array.isArray(p.taskIds) ||
      p.taskIds.length < 1 ||
      p.taskIds.length > 10 ||
      !p.taskIds.every(identifier) ||
      new Set(p.taskIds).size !== p.taskIds.length ||
      !scopes(p.approvedScopes) ||
      !p.approvedScopes.every((scope) => value.scopes.includes(scope)) ||
      !Array.isArray(p.tasks) ||
      p.tasks.length !== p.taskIds.length ||
      ![p.authorizationCount, p.keyEpoch, p.registrySequence].every((n) => integer(n)) ||
      !integer(p.authorizationExpiresAt, 0) ||
      !/^[a-f0-9]{64}$/.test(p.checkpointDigest) ||
      !["none", "selected"].includes(p.historyPolicy)
    )
      fail();
    for (const [index, task] of p.tasks.entries()) {
      if (
        !exact(task, [
          "taskId",
          "taskVersion",
          "executionEpoch",
          "resourceBindings",
          "grantId",
          "grantEpoch",
          ...(p.historyPolicy === "selected" ? ["selectedResourceVersions"] : []),
        ]) ||
        task.taskId !== p.taskIds[index] ||
        !identifier(task.grantId) ||
        !integer(task.taskVersion, 1, 50) ||
        !integer(task.executionEpoch) ||
        !integer(task.grantEpoch) ||
        !Array.isArray(task.resourceBindings) ||
        task.resourceBindings.length > 10
      )
        fail();
      try {
        task.resourceBindings.forEach(resourceBinding);
      } catch {
        fail();
      }
      if (
        new Set(
          task.resourceBindings.map((binding: ResourceBindingMetadata) =>
            JSON.stringify([
              binding.ref.kind,
              binding.ref.sourceService,
              binding.ref.resourceId,
              binding.ref.incarnation,
            ]),
          ),
        ).size !== task.resourceBindings.length
      )
        fail();
      if (p.historyPolicy === "selected") {
        if (
          !Array.isArray(task.selectedResourceVersions) ||
          task.selectedResourceVersions.length !== task.resourceBindings.length
        )
          fail();
        for (const [position, source] of task.selectedResourceVersions.entries()) {
          if (
            !exact(source, ["ref", "revision", "sourceEpoch", "producerSnapshotId"]) ||
            !integer(source.revision) ||
            !(source.producerSnapshotId === null || identifier(source.producerSnapshotId)) ||
            !equalJSON(
              { ref: source.ref, sourceEpoch: source.sourceEpoch },
              task.resourceBindings[position],
            )
          )
            fail();
        }
      }
    }
  }
  return value as PendingAuthorization;
}
export function readPreparationIntent(value: unknown): Json {
  if (
    !exact(value, [
      "contractVersion",
      "profile",
      "preparationId",
      "objects",
      "taskMetadata",
      "connectionId",
      "taskId",
      "grantId",
      "grantEpoch",
      "registrySequence",
      "checkpointDigest",
      "taskDeliveryBase",
      "status",
    ]) ||
    value.contractVersion !== CONNECTION_CONTRACT ||
    value.profile !== "folioview.agent-preparation.v1" ||
    ![value.preparationId, value.connectionId, value.taskId, value.grantId].every(identifier) ||
    ![value.grantEpoch, value.registrySequence].every((n) => integer(n)) ||
    !/^[a-f0-9]{64}$/.test(value.checkpointDigest) ||
    !["staging", "committed"].includes(value.status) ||
    !exact(value.taskDeliveryBase, ["deliveryRevision", "envelopeFingerprint"]) ||
    !integer(value.taskDeliveryBase.deliveryRevision) ||
    !/^[a-f0-9]{64}$/.test(value.taskDeliveryBase.envelopeFingerprint) ||
    !Array.isArray(value.objects) ||
    value.objects.length < 1 ||
    value.objects.length > 11
  )
    fail();
  taskMetadata(value.taskMetadata);
  for (const row of value.objects) {
    if (
      !exact(row, [
        "objectId",
        "objectType",
        "revision",
        "deliveryRevision",
        "priorEnvelopeFingerprint",
        "resourceRef",
        "sourceRevision",
        "sourceEpoch",
        "producerSnapshotId",
        "provenance",
        ...(value.status === "committed" ? ["envelopeFingerprint", "path"] : []),
      ]) ||
      !identifier(row.objectId) ||
      !integer(row.revision) ||
      !integer(row.deliveryRevision)
    )
      fail();
    if (
      value.status === "committed" &&
      (!/^[a-f0-9]{64}$/.test(row.envelopeFingerprint) ||
        row.path !== `/agent/v2/preparations/${value.preparationId}/objects/${row.objectId}`)
    )
      fail();
  }
  return value;
}
export function readPreparationCommit(value: unknown, preparationId: string): Json {
  if (
    !exact(value, ["contractVersion", "profile", "preparationId", "status", "objects"]) ||
    value.contractVersion !== CONNECTION_CONTRACT ||
    value.profile !== "folioview.agent-preparation.v1" ||
    value.preparationId !== preparationId ||
    value.status !== "committed" ||
    !Array.isArray(value.objects) ||
    value.objects.length < 1 ||
    value.objects.length > 11
  )
    fail();
  return value;
}

/** Compare server metadata with a packet already authenticated by the crypto Worker. */
export function verifyPreparationDescriptor(value: unknown, packet: AgentPreparationPacket): void {
  if (
    !exact(value, [
      "objectId",
      "objectType",
      "revision",
      "deliveryRevision",
      "priorEnvelopeFingerprint",
      "resourceRef",
      "sourceRevision",
      "sourceEpoch",
      "producerSnapshotId",
      "provenance",
      "envelopeFingerprint",
      "path",
    ])
  )
    fail();
  const object = packet.objects.find((item) => item.objectId === value.objectId);
  if (
    !object ||
    value.envelopeFingerprint !== object.envelopeFingerprint ||
    value.path !== `/agent/v2/preparations/${packet.preparationId}/objects/${object.objectId}`
  )
    fail();
  let context: Json;
  try {
    const payload = object.envelope.signedObject.payload as string;
    const bytes = Uint8Array.from(
      atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
      (character) => character.charCodeAt(0),
    );
    context = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).context;
  } catch {
    fail();
  }
  if (
    value.objectType !== context.objectType ||
    value.revision !== context.revision ||
    value.deliveryRevision !== context.deliveryRevision ||
    value.priorEnvelopeFingerprint !== context.priorEnvelopeFingerprint ||
    !equalJSON(value.resourceRef, context.binding.resourceRef) ||
    value.sourceRevision !== context.binding.sourceRevision ||
    value.sourceEpoch !== context.binding.sourceEpoch ||
    value.provenance !== (context.objectType === "task" ? "task_reshare" : "owner_attested_copy") ||
    !(
      value.producerSnapshotId === null ||
      (context.objectType === "holdings_snapshot" && identifier(value.producerSnapshotId))
    )
  )
    fail();
}
export function verifyPreparationObjects(value: unknown, packet: AgentPreparationPacket): void {
  if (!Array.isArray(value) || value.length !== packet.objects.length) fail();
  value.forEach((item) => verifyPreparationDescriptor(item, packet));
  const pins = value
    .map((item) => ({ objectId: item.objectId, envelopeFingerprint: item.envelopeFingerprint }))
    .sort((a, b) => (a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0));
  if (
    new Set(pins.map((item) => item.objectId)).size !== pins.length ||
    !equalJSON(pins, packet.deliveryPin.objects)
  )
    fail();
}
