import "server-only";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schemas from "../encrypted-schemas.json";
import { CONTRACT, JWT, fields, integer, record, signedObject } from "./owner-transport";

const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: true });
addFormats(ajv);
ajv.addFormat("iana-timezone", {
  type: "string",
  validate: (value: string) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
});
ajv.addSchema(schemas, "formal");
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function formal(name: string, value: unknown) {
  let validate = validators.get(name);
  if (!validate) {
    validate = ajv.compile({ $ref: `formal#/$defs/${name}` });
    validators.set(name, validate);
  }
  return validate(value) === true;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const id = (v: unknown) => typeof v === "string" && ID.test(v) && !/[\r\n]/.test(v);
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v));
const nullable = (v: unknown, test: (v: unknown) => boolean) => v === null || test(v);
const descriptorFields = [
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
];

function descriptor(value: unknown, committed: boolean) {
  return (
    fields(value, [...descriptorFields, ...(committed ? ["envelopeFingerprint", "path"] : [])]) &&
    id(value.objectId) &&
    ["task", "holdings_snapshot", "watchlist_evidence", "channel_follows_evidence"].includes(
      value.objectType as string,
    ) &&
    integer(value.revision, 1) &&
    integer(value.deliveryRevision, 1) &&
    nullable(value.priorEnvelopeFingerprint, digest) &&
    nullable(value.resourceRef, (v) => formal("ResourceRef", v)) &&
    nullable(value.sourceRevision, (v) => integer(v, 1)) &&
    nullable(value.sourceEpoch, (v) => integer(v, 1)) &&
    nullable(value.producerSnapshotId, id) &&
    ["task_reshare", "owner_attested_copy"].includes(value.provenance as string) &&
    (!committed ||
      (digest(value.envelopeFingerprint) &&
        typeof value.path === "string" &&
        /^\/agent\/v2\/preparations\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/objects\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(
          value.path,
        )))
  );
}

function aggregate(value: unknown) {
  return (
    fields(value, ["contractVersion", "vault", "sources"]) &&
    value.contractVersion === CONTRACT &&
    Array.isArray(value.sources) &&
    value.sources.length <= 10 &&
    (value.vault === null ||
      (fields(value.vault, [
        "vaultId",
        "rootJwk",
        "rootKeyId",
        "registryHistory",
        "archive",
        "version",
      ]) &&
        id(value.vault.vaultId) &&
        fields(value.vault.rootJwk, ["kty", "crv", "x", "y"]) &&
        fields(value.vault.archive, [
          "profile",
          "ownerSubject",
          "vaultId",
          "rootKeyId",
          "credentialId",
          "prfSalt",
          "iv",
          "ciphertext",
        ]) &&
        value.vault.archive.profile === "folioview.passkey-vault.v1" &&
        Object.values(value.vault.archive).every((v) => typeof v === "string") &&
        Array.isArray(value.vault.registryHistory) &&
        value.vault.registryHistory.length <= 32 &&
        value.vault.registryHistory.every((v) => formal("RegistryBundle", v)) &&
        integer(value.vault.version, 1)))
  );
}

export function hubResponse(path: string, method: string, body: unknown): boolean {
  path = path.split("?", 1)[0];
  // This named producer returns a descriptor, not a fabricated contract wrapper.
  if (method === "PUT" && /\/preparation\/objects\//.test(path))
    return descriptor(body, true) && record(body) && body.objectId === path.split("/").at(-1);
  // Formal ResultMetadata is the original state ACK and has no contractVersion field.
  if (method === "PATCH" && /^\/api\/v2\/results\/[^/]+\/state$/.test(path))
    return formal("ResultMetadata", body);
  if (!record(body) || body.contractVersion !== CONTRACT) return false;
  if (path === "/api/v2/tasks" && method === "GET") return formal("TaskMetadataPage", body);
  if (path.startsWith("/api/v2/tasks")) return formal("EncryptedTask", body);
  if (path === "/api/v2/results/counts")
    return (
      fields(body, ["contractVersion", "profile", "asOf", "counts"]) &&
      body.profile === "folioview.owner-result-counts.v1" &&
      date(body.asOf) &&
      fields(body.counts, ["all", "unread", "starred", "archived", "total"]) &&
      Object.values(body.counts).every((v) => integer(v, 0))
    );
  if (path === "/api/v2/results" || /^\/api\/v2\/results\/[^/]+\/revisions$/.test(path))
    return formal("ResultMetadataPage", body);
  if (path.startsWith("/api/v2/results/")) {
    if (path.endsWith("/state")) return formal("ResultMetadata", body);
    if (/\/registries\//.test(path)) return formal("RegistryBundle", body);
    if (path.endsWith("/evidence"))
      return (
        fields(body, [
          "contractVersion",
          "profile",
          "run",
          "manifest",
          "manifestFingerprint",
          "receipt",
          "agentKeyGrant",
          "authorizationExpiresAt",
          "provenance",
          "authorProof",
          "registryProofs",
        ]) &&
        body.profile === "folioview.owner-result-evidence.v1" &&
        formal("RunDescriptor", body.run) &&
        formal("ManifestDescriptor", body.manifest) &&
        formal("ResultReceipt", body.receipt) &&
        signedObject(body.agentKeyGrant) &&
        digest(body.manifestFingerprint) &&
        integer(body.authorizationExpiresAt, 1) &&
        record(body.provenance) &&
        fields(body.authorProof, ["registrySequence", "verifiedAt"]) &&
        integer(body.authorProof.registrySequence, 1) &&
        integer(body.authorProof.verifiedAt, 0) &&
        Array.isArray(body.registryProofs) &&
        body.registryProofs.length <= 32 &&
        body.registryProofs.every(
          (v) =>
            fields(v, ["registrySequence", "checkpointDigest", "path"]) &&
            integer(v.registrySequence, 1) &&
            digest(v.checkpointDigest) &&
            typeof v.path === "string" &&
            /^\/api\/v2\/results\/[A-Za-z0-9_-]+\/revisions\/[1-9][0-9]?\/registries\/[1-9][0-9]?$/.test(
              v.path,
            ),
        )
      );
    return formal("EncryptedResult", body);
  }
  if (path === "/api/v2/vaults/current/authority-token")
    return (
      fields(body, ["contractVersion", "token", "expiresAt"]) &&
      typeof body.token === "string" &&
      body.token.length <= 16384 &&
      JWT.test(body.token) &&
      integer(body.expiresAt, 1)
    );
  if (/^\/api\/v2\/vaults\/[^/]+\/holdings-sources\//.test(path))
    return fields(body, ["contractVersion", "source"]) && record(body.source);
  if (path.startsWith("/api/v2/vaults")) return aggregate(body);
  if (path === "/api/v2/resources/catalogue")
    return (
      fields(body, ["contractVersion", "profile", "readAt", "groups"]) &&
      body.profile === "folioview.owner-resource-discovery.v1" &&
      date(body.readAt) &&
      Array.isArray(body.groups) &&
      body.groups.length === 3 &&
      body.groups.every(
        (group) =>
          fields(group, ["kind", "sourceService", "status", "items"]) &&
          ["holdings", "watchlist", "channel_follows"].includes(group.kind as string) &&
          Array.isArray(group.items) &&
          group.items.length <= 10 &&
          group.items.every((item) =>
            fields(item, [
              "ref",
              "revision",
              "sourceEpoch",
              "state",
              "snapshotId",
              "updatedAt",
              "encryptedEvidence",
            ]),
          ),
      )
    );
  if (path.endsWith("/preparation-intent"))
    return (
      fields(body, [
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
      ]) &&
      body.profile === "folioview.agent-preparation.v1" &&
      ["staging", "committed"].includes(body.status as string) &&
      formal("TaskMetadata", body.taskMetadata) &&
      Array.isArray(body.objects) &&
      body.objects.length <= 11 &&
      body.objects.every((v) => descriptor(v, body.status === "committed"))
    );
  if (path.endsWith("/preparation/commit"))
    return (
      fields(body, ["contractVersion", "profile", "preparationId", "status", "objects"]) &&
      body.profile === "folioview.agent-preparation.v1" &&
      body.status === "committed" &&
      Array.isArray(body.objects) &&
      body.objects.length <= 11 &&
      body.objects.every((v) => descriptor(v, true))
    );
  if (path === "/api/v2/agent-connections")
    return (
      fields(body, ["contractVersion", "items", "authorizationAttempts"]) &&
      Array.isArray(body.items) &&
      body.items.length <= 32 &&
      Array.isArray(body.authorizationAttempts) &&
      body.authorizationAttempts.length <= 64
    );
  return fields(body, ["contractVersion", "connection"]) && record(body.connection);
}
