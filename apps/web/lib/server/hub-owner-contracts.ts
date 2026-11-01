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
const LIFECYCLE = "folioview.vault-lifecycle.v1";
const KEY_RENEWAL = "folioview.vault-key-renewal.v1";
const ownerRoles = ["device_sig", "device_enc", "recovery_enc"];
const operation = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{22,128}$/.test(v);
const actions = ["archive_replace", "recovery_authorize", "recovery_revoke"];
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function binary(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const remainder = value.length % 4;
  const last = alphabet.indexOf(value.at(-1)!);
  const size = Math.floor((value.length * 6) / 8);
  return (
    remainder !== 1 &&
    (remainder !== 2 || last % 16 === 0) &&
    (remainder !== 3 || last % 4 === 0) &&
    minimum <= size &&
    size <= maximum
  );
}

// Transport validation stays structural. Only the trusted Worker accepts root
// signatures, history transitions and the archive's encrypted private material.
export function vaultLifecycleCommand(value: unknown) {
  return (
    record(value) &&
    signedObject(value) &&
    JSON.stringify(value).length <= 8192 &&
    binary(value.protected, 1, 8192) &&
    binary(value.payload, 1, 8192) &&
    binary(value.signature, 64, 64)
  );
}

export function vaultLifecycleArchive(value: unknown, vaultId?: string) {
  return (
    fields(value, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "credentialId",
      "prfSalt",
      "iv",
      "ciphertext",
    ]) &&
    value.profile === "folioview.passkey-vault.v1" &&
    digest(value.ownerSubject) &&
    id(value.vaultId) &&
    (vaultId === undefined || value.vaultId === vaultId) &&
    binary(value.rootKeyId, 32, 32) &&
    binary(value.credentialId, 1, 1536) &&
    binary(value.prfSalt, 32, 32) &&
    binary(value.iv, 12, 12) &&
    binary(value.ciphertext, 16, 24576)
  );
}

export function vaultKeyRenewalRequest(value: unknown, vaultId?: string) {
  return (
    fields(value, ["contractVersion", "registryBundle", "archive", "command", "archiveCommand"]) &&
    value.contractVersion === CONTRACT &&
    formal("RegistryBundle", value.registryBundle) &&
    vaultLifecycleArchive(value.archive, vaultId) &&
    formal("SignedObject", value.command) &&
    vaultLifecycleCommand(value.command) &&
    formal("SignedObject", value.archiveCommand) &&
    vaultLifecycleCommand(value.archiveCommand)
  );
}

function keyRenewalState(value: unknown, vaultId: string) {
  if (
    !fields(value, [
      "contractVersion",
      "profile",
      "vaultId",
      "rootKeyId",
      "rootAnchorExpiresAt",
      "vaultVersion",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "lifecycleVersion",
      "archiveRevision",
      "archiveDigest",
      "pendingRecoveryAuthorization",
      "certificates",
    ]) ||
    value.contractVersion !== CONTRACT ||
    value.profile !== KEY_RENEWAL ||
    value.vaultId !== vaultId ||
    !binary(value.rootKeyId, 32, 32) ||
    value.rootAnchorExpiresAt !== null ||
    !integer(value.vaultVersion, 1) ||
    !integer(value.registrySequence, 1) ||
    (value.registrySequence as number) > 32 ||
    !digest(value.checkpointDigest) ||
    !integer(value.keyEpoch, 1) ||
    !integer(value.lifecycleVersion, 0) ||
    (value.lifecycleVersion as number) > 32 ||
    !integer(value.archiveRevision, 0) ||
    (value.archiveRevision as number) > (value.lifecycleVersion as number) ||
    !digest(value.archiveDigest) ||
    typeof value.pendingRecoveryAuthorization !== "boolean" ||
    !Array.isArray(value.certificates) ||
    value.certificates.length > 64
  )
    return false;
  const keys = new Set<unknown>();
  return value.certificates.every((item) => {
    if (
      !fields(item, [
        "keyId",
        "role",
        "principalId",
        "keyEpoch",
        "notBefore",
        "expiresAt",
        "status",
      ]) ||
      !binary(item.keyId, 32, 32) ||
      keys.has(item.keyId) ||
      !ownerRoles.includes(item.role as string) ||
      !id(item.principalId) ||
      !integer(item.keyEpoch, 1) ||
      !integer(item.notBefore, 0) ||
      !integer(item.expiresAt, 1) ||
      (item.expiresAt as number) <= (item.notBefore as number) ||
      !["active", "revoked", "superseded", "not_yet_valid", "expired"].includes(
        item.status as string,
      )
    )
      return false;
    keys.add(item.keyId);
    return true;
  });
}

function keyRenewalTargets(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return false;
  const roles = new Set<unknown>(),
    oldKeys = new Set<unknown>(),
    newKeys = new Set<unknown>(),
    devices = new Set<unknown>();
  let previous = "";
  for (const item of value) {
    if (
      !fields(item, [
        "role",
        "principalId",
        "priorKeyId",
        "newKeyId",
        "priorKeyEpoch",
        "newKeyEpoch",
      ]) ||
      !ownerRoles.includes(item.role as string) ||
      !id(item.principalId) ||
      !binary(item.priorKeyId, 32, 32) ||
      !binary(item.newKeyId, 32, 32) ||
      !integer(item.priorKeyEpoch, 1) ||
      !integer(item.newKeyEpoch, 2) ||
      item.newKeyEpoch !== (item.priorKeyEpoch as number) + 1 ||
      roles.has(item.role) ||
      oldKeys.has(item.priorKeyId) ||
      newKeys.has(item.newKeyId)
    )
      return false;
    const order = `${item.role}\0${item.principalId}\0${item.priorKeyId}`;
    if (order <= previous) return false;
    previous = order;
    roles.add(item.role);
    oldKeys.add(item.priorKeyId);
    newKeys.add(item.newKeyId);
    if (item.role !== "recovery_enc") devices.add(item.principalId);
  }
  return (
    devices.size <= 1 &&
    ![...oldKeys].some((key) => newKeys.has(key)) &&
    ((roles.size === 1 && roles.has("recovery_enc")) ||
      (roles.size === 2 && roles.has("device_sig") && roles.has("device_enc")) ||
      roles.size === 3)
  );
}

function keyRenewalAcknowledgement(value: unknown, vaultId: string, operationId?: string) {
  if (
    !fields(value, ["contractVersion", "profile", "receipt"]) ||
    value.contractVersion !== CONTRACT ||
    value.profile !== KEY_RENEWAL ||
    !fields(value.receipt, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "operationId",
      "vaultVersion",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "lifecycleVersion",
      "archiveRevision",
      "archiveDigest",
      "renewals",
      "commandFingerprint",
      "archiveCommandFingerprint",
      "acceptedAt",
    ])
  )
    return false;
  const receipt = value.receipt;
  return (
    receipt.profile === KEY_RENEWAL &&
    digest(receipt.ownerSubject) &&
    receipt.vaultId === vaultId &&
    binary(receipt.rootKeyId, 32, 32) &&
    operation(receipt.operationId) &&
    (operationId === undefined || receipt.operationId === operationId) &&
    integer(receipt.vaultVersion, 2) &&
    integer(receipt.registrySequence, 2) &&
    (receipt.registrySequence as number) <= 32 &&
    digest(receipt.checkpointDigest) &&
    integer(receipt.keyEpoch, 1) &&
    integer(receipt.lifecycleVersion, 1) &&
    (receipt.lifecycleVersion as number) <= 32 &&
    integer(receipt.archiveRevision, 1) &&
    (receipt.archiveRevision as number) <= (receipt.lifecycleVersion as number) &&
    digest(receipt.archiveDigest) &&
    keyRenewalTargets(receipt.renewals) &&
    digest(receipt.commandFingerprint) &&
    digest(receipt.archiveCommandFingerprint) &&
    integer(receipt.acceptedAt, 0)
  );
}

function lifecycleReceipt(value: unknown, vaultId: string) {
  return (
    fields(value, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "operationId",
      "action",
      "lifecycleVersion",
      "archiveRevision",
      "archiveDigest",
      "commandFingerprint",
      "acceptedAt",
    ]) &&
    value.profile === LIFECYCLE &&
    digest(value.ownerSubject) &&
    value.vaultId === vaultId &&
    binary(value.rootKeyId, 32, 32) &&
    operation(value.operationId) &&
    actions.includes(value.action as string) &&
    integer(value.lifecycleVersion, 1) &&
    (value.lifecycleVersion as number) <= 32 &&
    integer(value.archiveRevision, 0) &&
    (value.archiveRevision as number) <= (value.lifecycleVersion as number) &&
    (value.action !== "archive_replace" || (value.archiveRevision as number) >= 1) &&
    digest(value.archiveDigest) &&
    digest(value.commandFingerprint) &&
    integer(value.acceptedAt, 0)
  );
}

function lifecycleState(value: unknown, vaultId: string) {
  if (
    !fields(value, [
      "contractVersion",
      "profile",
      "vaultId",
      "rootKeyId",
      "vaultVersion",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "lifecycleVersion",
      "archiveRevision",
      "archiveDigest",
      "archive",
      "pendingAuthorization",
      "history",
    ]) ||
    value.contractVersion !== CONTRACT ||
    value.profile !== LIFECYCLE ||
    value.vaultId !== vaultId ||
    !binary(value.rootKeyId, 32, 32) ||
    !integer(value.vaultVersion, 1) ||
    !integer(value.registrySequence, 1) ||
    (value.registrySequence as number) > 32 ||
    !digest(value.checkpointDigest) ||
    !integer(value.keyEpoch, 1) ||
    !integer(value.lifecycleVersion, 0) ||
    (value.lifecycleVersion as number) > 32 ||
    !integer(value.archiveRevision, 0) ||
    (value.archiveRevision as number) > (value.lifecycleVersion as number) ||
    !digest(value.archiveDigest) ||
    !vaultLifecycleArchive(value.archive, vaultId) ||
    !record(value.archive) ||
    value.archive.rootKeyId !== value.rootKeyId ||
    !Array.isArray(value.history) ||
    value.history.length !== value.lifecycleVersion
  )
    return false;
  const rootKeyId = value.rootKeyId,
    ownerSubject = value.archive.ownerSubject;
  if (
    !value.history.every(
      (item, index) =>
        fields(item, ["command", "receipt"]) &&
        vaultLifecycleCommand(item.command) &&
        lifecycleReceipt(item.receipt, vaultId) &&
        record(item.receipt) &&
        item.receipt.ownerSubject === ownerSubject &&
        item.receipt.rootKeyId === rootKeyId &&
        item.receipt.lifecycleVersion === index + 1,
    )
  )
    return false;
  const last = value.history.at(-1)?.receipt;
  if (
    last &&
    (last.archiveRevision !== value.archiveRevision || last.archiveDigest !== value.archiveDigest)
  )
    return false;
  const pending = value.pendingAuthorization;
  return (
    pending === null ||
    (fields(pending, ["authorizationId", "newArchiveDigest", "expiresAt", "status", "command"]) &&
      id(pending.authorizationId) &&
      digest(pending.newArchiveDigest) &&
      integer(pending.expiresAt, 1) &&
      ["active", "expired", "stale"].includes(pending.status as string) &&
      vaultLifecycleCommand(pending.command))
  );
}

function lifecycleAcknowledgement(
  value: unknown,
  vaultId: string,
  operationId?: string,
  action?: string,
) {
  return (
    fields(value, ["contractVersion", "profile", "receipt"]) &&
    value.contractVersion === CONTRACT &&
    value.profile === LIFECYCLE &&
    lifecycleReceipt(value.receipt, vaultId) &&
    record(value.receipt) &&
    (operationId === undefined || value.receipt.operationId === operationId) &&
    (action === undefined || value.receipt.action === action)
  );
}
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

export function hubResponse(
  path: string,
  method: string,
  body: unknown,
  operationId?: string,
): boolean {
  path = path.split("?", 1)[0];
  // This named producer returns a descriptor, not a fabricated contract wrapper.
  if (method === "PUT" && /\/preparation\/objects\//.test(path))
    return descriptor(body, true) && record(body) && body.objectId === path.split("/").at(-1);
  // Formal ResultMetadata is the original state ACK and has no contractVersion field.
  if (method === "PATCH" && /^\/api\/v2\/results\/[^/]+\/state$/.test(path))
    return formal("ResultMetadata", body);
  if (!record(body) || body.contractVersion !== CONTRACT) return false;
  const renewalPath =
    /^\/api\/v2\/vaults\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/(key-renewal-state|key-renewals|key-renewal-operations\/([A-Za-z0-9_-]{22,128}))$/.exec(
      path,
    );
  if (renewalPath) {
    if (method === "GET" && renewalPath[2] === "key-renewal-state")
      return keyRenewalState(body, renewalPath[1]);
    if (
      (method === "GET" && renewalPath[3]) ||
      (method === "POST" && renewalPath[2] === "key-renewals")
    )
      return keyRenewalAcknowledgement(body, renewalPath[1], renewalPath[3] ?? operationId);
    return false;
  }
  const lifecyclePath =
    /^\/api\/v2\/vaults\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/(archive|archive-operations\/([A-Za-z0-9_-]{22,128})|recovery-authorizations(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/revoke)?)$/.exec(
      path,
    );
  if (lifecyclePath) {
    if (method === "GET" && lifecyclePath[2] === "archive")
      return lifecycleState(body, lifecyclePath[1]);
    if (
      (method === "GET" && lifecyclePath[3]) ||
      (method === "PUT" && lifecyclePath[2] === "archive") ||
      (method === "POST" && lifecyclePath[2].startsWith("recovery-authorizations"))
    )
      return lifecycleAcknowledgement(
        body,
        lifecyclePath[1],
        lifecyclePath[3],
        method === "GET"
          ? undefined
          : method === "PUT"
            ? "archive_replace"
            : path.endsWith("/revoke")
              ? "recovery_revoke"
              : "recovery_authorize",
      );
    return false;
  }
  if (path === "/api/v2/tasks" && method === "GET") return formal("TaskMetadataPage", body);
  const taskOperation =
    /^\/api\/v2\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/operations\/([A-Za-z0-9_-]{22,128})$/.exec(
      path,
    );
  if (taskOperation) {
    if (method !== "GET" || !formal("EncryptedTask", body) || !record(body.metadata)) return false;
    try {
      if (!record(body.signedObject) || typeof body.signedObject.payload !== "string") return false;
      const message = JSON.parse(
        Buffer.from(body.signedObject.payload, "base64url").toString("utf8"),
      );
      return (
        record(message) &&
        record(message.context) &&
        body.metadata.taskId === taskOperation[1] &&
        message.context.objectId === taskOperation[1] &&
        message.context.stableOperationId === taskOperation[2]
      );
    } catch {
      return false;
    }
  }
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
  if (path === "/api/v2/agent-capabilities")
    return (
      fields(body, ["contractVersion", "profile", "ownerConnections", "museConnectionEnabled"]) &&
      body.profile === "folioview.owner-agent-capabilities.v1" &&
      body.ownerConnections === true &&
      typeof body.museConnectionEnabled === "boolean"
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
