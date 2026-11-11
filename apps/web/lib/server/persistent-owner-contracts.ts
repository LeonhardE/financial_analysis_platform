import "server-only";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schemas from "../../../../packages/encrypted-workspace/schemas.json";
import { CONTRACT, fields, record, integer, signedObject } from "./owner-transport";
const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: true });
addFormats(ajv);
ajv.addFormat("iana-timezone", {
  type: "string",
  validate: (v: string) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  },
});
ajv.addSchema(schemas, "persistent");
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function formal(name: string, v: unknown) {
  let f = validators.get(name);
  if (!f) {
    f = ajv.compile({ $ref: `persistent#/$defs/${name}` });
    validators.set(name, f);
  }
  return f(v) === true;
}
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const op = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{22,128}$/.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const AGENT = "folioview.persistent-agent-identity.v1",
  CONTENT = "folioview.persistent-content.v1",
  CONSENT = "folioview.persistent-resource-consent.v1",
  PAIRING = "folioview.runtime-pairing.v1",
  PLAN = "folioview.persistent-native-plan.v1";
const nullable = (v: unknown, fn: (v: unknown) => boolean) => v === null || fn(v);
function metadata(v: unknown, result?: string) {
  return (
    fields(v, [
      "resultId",
      "taskId",
      "runId",
      "connectionId",
      "receivedAt",
      "stateVersion",
      "read",
      "starred",
      "archived",
    ]) &&
    ["resultId", "taskId", "runId", "connectionId"].every((k) => id(v[k])) &&
    (result === undefined || v.resultId === result) &&
    integer(v.receivedAt, 0) &&
    integer(v.stateVersion, 0) &&
    ["read", "starred", "archived"].every((k) => typeof v[k] === "boolean")
  );
}
function receipt(v: unknown, operationId?: string) {
  return (
    fields(v, [
      "contractVersion",
      "profile",
      "publicationId",
      "fingerprint",
      "context",
      ...(record(v) && "envelope" in v ? ["envelope"] : []),
    ]) &&
    v.contractVersion === CONTRACT &&
    v.profile === CONTENT &&
    op(v.publicationId) &&
    (operationId === undefined || v.publicationId === operationId) &&
    hash(v.fingerprint) &&
    formal("PersistentContentContext", v.context) &&
    (!("envelope" in v) || formal("PersistentContentCarrier", v.envelope))
  );
}
function planReceipt(v: unknown) {
  return (
    fields(v, [
      "contractVersion",
      "profile",
      "connectionId",
      "taskId",
      "operationId",
      "version",
      "requestDigest",
      "taskPublicationFingerprint",
      "provider",
      "planReferenceHash",
      "reportedStatus",
      "reportedAt",
      "receivedAt",
      "authority",
      "nativeScheduleAttested",
    ]) &&
    v.contractVersion === CONTRACT &&
    v.profile === PLAN &&
    id(v.connectionId) &&
    id(v.taskId) &&
    op(v.operationId) &&
    integer(v.version, 1) &&
    hash(v.requestDigest) &&
    hash(v.taskPublicationFingerprint) &&
    v.provider === "muse" &&
    nullable(v.planReferenceHash, hash) &&
    ["enabled", "paused", "removed", "unconfirmed"].includes(String(v.reportedStatus)) &&
    integer(v.reportedAt, 0) &&
    integer(v.receivedAt, 0) &&
    v.authority === "agent_statement" &&
    v.nativeScheduleAttested === false
  );
}
function observed(v: unknown) {
  return (
    fields(v, [
      "source",
      "runId",
      "triggerId",
      "taskPublicationFingerprint",
      "runCreatedAt",
      "resultId",
      "receivedAt",
      "nativeScheduleAttested",
    ]) &&
    id(v.runId) &&
    op(v.triggerId) &&
    hash(v.taskPublicationFingerprint) &&
    integer(v.runCreatedAt, 0) &&
    v.nativeScheduleAttested === false &&
    (v.resultId === null
      ? v.source === "hub_run_receipt" && v.receivedAt === null
      : v.source === "hub_result_receipt" && id(v.resultId) && integer(v.receivedAt, 0))
  );
}
export function persistentRequest(v: unknown) {
  return (
    fields(v, ["contractVersion", "envelope"]) &&
    v.contractVersion === CONTRACT &&
    formal("PersistentContentCarrier", v.envelope)
  );
}
/** DTO validation only. Root/Agent signatures are independently verified inside the owner Worker. */
export function persistentResponse(
  path: string,
  method: string,
  v: unknown,
  operationId?: string,
): boolean {
  const p = path.split("?", 1)[0].split("/");
  if (p[3] === "executor-connections") {
    if (p[6] === "bindings" && method === "POST")
      return (
        fields(v, [
          "contractVersion",
          "profile",
          "operationId",
          "registrationDigest",
          "identity",
        ]) &&
        v.contractVersion === CONTRACT &&
        v.profile === "folioview.hub-executor-ciphertext.v1" &&
        v.operationId === operationId &&
        op(v.operationId) &&
        hash(v.registrationDigest) &&
        formal("PersistentAgentIdentity", v.identity)
      );

    if (p.length === 6 && method === "GET")
      return (
        fields(v, [
          "contractVersion",
          "profile",
          "identity",
          "command",
          "revocation",
          "binding",
          "scope",
          "approval",
          "receipt",
        ]) &&
        v.contractVersion === CONTRACT &&
        v.profile === "folioview.hub-executor-ciphertext.v1" &&
        formal("PersistentAgentIdentity", v.identity) &&
        signedObject(v.command) &&
        nullable(v.revocation, signedObject) &&
        record(v.binding) &&
        record(v.scope) &&
        signedObject(v.approval) &&
        record(v.receipt)
      );
    let mapped = `/api/v2/persistent-agents/${p[4]}/${p[5]}/${p.slice(6).join("/")}`;
    if (p[6] === "identity-operations")
      mapped = `/api/v2/persistent-agents/${p[4]}/${p[5]}/operations/${p[7]}`;
    if (p[6] === "publications" || p[6] === "publication-operations")
      mapped =
        `/api/v2/persistent-content/${p[4]}/connections/${p[5]}/` +
        (p[6] === "publications" ? "publications" : "operations/" + p[7]);
    return persistentResponse(mapped, method, v, operationId);
  }
  if (method === "PATCH") return metadata(v, p[5]);
  if (!record(v) || v.contractVersion !== CONTRACT) return false;
  if (p[3] === "persistent-account-authorizations")
    return (
      fields(v, ["contractVersion", "profile", "accountLinkEnabled", "scope", "runtimeReady"]) &&
      v.profile === "folioview.persistent-account.v1" &&
      typeof v.accountLinkEnabled === "boolean" &&
      v.scope === "runtime:connect" &&
      v.runtimeReady === false
    );
  if (p[3] === "persistent-connections") {
    const connection = (x: unknown) =>
      fields(x, [
        "connectionId",
        "clientId",
        "vaultId",
        "provider",
        "status",
        "accountState",
        "linkedAt",
      ]) &&
      id(x.connectionId) &&
      id(x.clientId) &&
      id(x.vaultId) &&
      x.provider === "muse" &&
      ["active", "revoked"].includes(String(x.status)) &&
      ["connected", "revoked", "relogin_required", "connecting"].includes(String(x.accountState)) &&
      integer(x.linkedAt, 0);
    return (
      v.profile === "folioview.persistent-account.v1" &&
      (method === "GET"
        ? fields(v, ["contractVersion", "profile", "connections"]) &&
          Array.isArray(v.connections) &&
          v.connections.length <= 64 &&
          v.connections.every(connection)
        : fields(v, ["contractVersion", "profile", "connection"]) &&
          connection(v.connection) &&
          record(v.connection) &&
          v.connection.connectionId === p[4])
    );
  }
  if (p[3] === "persistent-agents") {
    if (p[4] === "capabilities")
      return (
        fields(v, [
          "contractVersion",
          "profile",
          "enrollmentEnabled",
          "resourceConsentEnabled",
          "executionEnabled",
        ]) &&
        v.profile === "folioview.persistent-agent-capabilities.v1" &&
        ["enrollmentEnabled", "resourceConsentEnabled", "executionEnabled"].every(
          (k) => typeof v[k] === "boolean",
        )
      );
    if (p[6]?.startsWith("resource-")) {
      if (p[6] === "resource-consent")
        return (
          fields(v, ["contractVersion", "profile", "consent", "operations", "parentRevoked"]) &&
          v.profile === CONSENT &&
          nullable(v.consent, (x) => formal("PersistentResourceConsent", x)) &&
          Array.isArray(v.operations) &&
          v.operations.length <= 96 &&
          v.operations.every(op) &&
          typeof v.parentRevoked === "boolean"
        );
      return (
        fields(v, [
          "contractVersion",
          "profile",
          "operationId",
          "fingerprint",
          "priorDigest",
          "consent",
          ...(method === "GET" ? ["command", "sourceStates"] : []),
        ]) &&
        v.profile === CONSENT &&
        v.operationId === (method === "GET" ? p[7] : operationId) &&
        op(v.operationId) &&
        hash(v.fingerprint) &&
        nullable(v.priorDigest, hash) &&
        formal("PersistentResourceConsent", v.consent) &&
        (method !== "GET" ||
          (signedObject(v.command) &&
            Array.isArray(v.sourceStates) &&
            v.sourceStates.length <= 10 &&
            v.sourceStates.every((x) => formal("ConsentSourceState", x))))
      );
    }
    if (p.length === 6)
      return (
        fields(v, [
          "contractVersion",
          "profile",
          "identity",
          "binding",
          "revocation",
          "connectionRevoked",
        ]) &&
        v.profile === AGENT &&
        nullable(v.identity, (x) => formal("PersistentAgentIdentity", x)) &&
        nullable(v.binding, signedObject) &&
        nullable(v.revocation, signedObject) &&
        typeof v.connectionRevoked === "boolean"
      );
    return (
      fields(v, ["contractVersion", "profile", "operationId", "fingerprint", "identity"]) &&
      v.profile === AGENT &&
      v.operationId === (method === "GET" ? p[7] : operationId) &&
      op(v.operationId) &&
      hash(v.fingerprint) &&
      formal("PersistentAgentIdentity", v.identity)
    );
  }
  if (p[3] === "persistent-content") {
    if (p[5] === "tasks")
      return (
        fields(v, ["contractVersion", "profile", "authority", "envelope"]) &&
        v.profile === CONTENT &&
        nullable(
          v.authority,
          (x) =>
            fields(x, ["publicationId", "fingerprint", "context"]) &&
            op(x.publicationId) &&
            hash(x.fingerprint) &&
            formal("PersistentTaskContext", x.context),
        ) &&
        nullable(v.envelope, (x) => formal("PersistentContentCarrier", x))
      );
    return receipt(v, method === "GET" ? p[8] : operationId);
  }
  if (p[3] === "runtime-setups") {
    if (method === "POST")
      return (
        fields(v, ["contractVersion", "profile", "paired"]) &&
        v.profile === PAIRING &&
        fields(v.paired, ["identity", "rootJwk", "acceptedAt", "authority"]) &&
        formal("PersistentAgentIdentity", v.paired.identity) &&
        formal("PublicJWK", v.paired.rootJwk) &&
        integer(v.paired.acceptedAt, 0) &&
        v.paired.authority === "pairing_observation_only"
      );
    return (
      fields(v, [
        "contractVersion",
        "profile",
        "setup",
        "offer",
        "protectedHostAttested",
        "authority",
      ]) &&
      v.profile === PAIRING &&
      fields(v.setup, [
        "intentId",
        "ownerSubject",
        "vaultId",
        "connectionId",
        "clientId",
        "authorizationId",
        "nonce",
        "issuedAt",
        "expiresAt",
        "confirmed",
      ]) &&
      v.setup.intentId === p[4] &&
      hash(v.setup.ownerSubject) &&
      ["vaultId", "connectionId", "clientId", "authorizationId"].every((k) =>
        id((v.setup as Record<string, unknown>)[k]),
      ) &&
      typeof v.setup.nonce === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(v.setup.nonce) &&
      integer(v.setup.issuedAt, 0) &&
      integer(v.setup.expiresAt, 1) &&
      typeof v.setup.confirmed === "boolean" &&
      nullable(
        v.offer,
        (x) =>
          fields(x, ["command", "fingerprint", "agentId", "signingKeyId", "encryptionKeyId"]) &&
          signedObject(x.command) &&
          hash(x.fingerprint) &&
          id(x.agentId) &&
          formal("KeyId", x.signingKeyId) &&
          formal("KeyId", x.encryptionKeyId),
      ) &&
      v.protectedHostAttested === false &&
      v.authority === "pairing_observation_only"
    );
  }
  if (p[3] === "persistent-results") {
    if (p.length === 5)
      return (
        fields(v, ["contractVersion", "profile", "items", "nextCursor"]) &&
        v.profile === CONTENT &&
        Array.isArray(v.items) &&
        v.items.length <= 50 &&
        v.items.every((x) => metadata(x)) &&
        nullable(
          v.nextCursor,
          (x) => typeof x === "string" && /^[A-Za-z0-9_-]{22,128}:[1-9][0-9]{0,2}$/.test(x),
        )
      );
    return (
      fields(v, [
        "contractVersion",
        "profile",
        "metadata",
        "receipt",
        "envelope",
        "manifest",
        "manifestFingerprint",
        "identity",
        "binding",
        "rootJwk",
        "registryHistory",
      ]) &&
      v.profile === CONTENT &&
      metadata(v.metadata, p[5]) &&
      fields(v.receipt, [
        "contractVersion",
        "profile",
        "resultId",
        "runId",
        "taskId",
        "connectionId",
        "revision",
        "publicationId",
        "fingerprint",
        "manifestFingerprint",
        "receivedAt",
      ]) &&
      v.receipt.contractVersion === CONTRACT &&
      v.receipt.profile === CONTENT &&
      v.receipt.resultId === p[5] &&
      id(v.receipt.runId) &&
      op(v.receipt.publicationId) &&
      id(v.receipt.taskId) &&
      id(v.receipt.connectionId) &&
      v.receipt.revision === 1 &&
      hash(v.receipt.fingerprint) &&
      hash(v.receipt.manifestFingerprint) &&
      integer(v.receipt.receivedAt, 0) &&
      formal("PersistentContentCarrier", v.envelope) &&
      formal("PersistentRunManifest", v.manifest) &&
      hash(v.manifestFingerprint) &&
      formal("PersistentAgentIdentity", v.identity) &&
      signedObject(v.binding) &&
      formal("PublicJWK", v.rootJwk) &&
      Array.isArray(v.registryHistory) &&
      v.registryHistory.length >= 1 &&
      v.registryHistory.length <= 32 &&
      v.registryHistory.every((x) => formal("RegistryBundle", x))
    );
  }
  if (p[3] === "persistent-plans")
    return (
      fields(v, [
        "contractVersion",
        "profile",
        "taskId",
        "connectionId",
        "version",
        "desired",
        "reported",
        "reportedEvidence",
        "observed",
        "nativeScheduleAttested",
        "parentRevoked",
      ]) &&
      v.profile === PLAN &&
      v.taskId === p[6] &&
      v.connectionId === p[5] &&
      integer(v.version, 0) &&
      nullable(
        v.desired,
        (x) =>
          fields(x, ["taskPublicationFingerprint", "taskVersion", "executionEpoch"]) &&
          hash(x.taskPublicationFingerprint) &&
          integer(x.taskVersion, 1) &&
          integer(x.executionEpoch, 1),
      ) &&
      nullable(v.reported, planReceipt) &&
      nullable(
        v.reportedEvidence,
        (x) =>
          fields(x, ["request", "proof", "identity", "registrySequence", "checkpointDigest"]) &&
          fields(x.request, [
            "taskId",
            "taskPublicationFingerprint",
            "operationId",
            "expectedVersion",
            "provider",
            "planReferenceHash",
            "reportedStatus",
            "reportedAt",
          ]) &&
          signedObject(x.proof) &&
          formal("PersistentAgentIdentity", x.identity) &&
          integer(x.registrySequence, 1) &&
          hash(x.checkpointDigest),
      ) &&
      nullable(v.observed, observed) &&
      v.nativeScheduleAttested === false &&
      typeof v.parentRevoked === "boolean"
    );
  return false;
}
