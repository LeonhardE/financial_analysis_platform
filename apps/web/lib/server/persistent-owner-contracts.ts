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
    ["muse", "chatgpt"].includes(String(v.provider)) &&
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
function pairingPacket(v: unknown) {
  return (
    fields(v, ["version", "iv", "ciphertext"]) &&
    v.version === 1 &&
    typeof v.iv === "string" &&
    /^[A-Za-z0-9_-]{16}$/.test(v.iv) &&
    typeof v.ciphertext === "string" &&
    /^[A-Za-z0-9_-]{22,10923}$/.test(v.ciphertext)
  );
}
export function credentialApprovalRequest(v: unknown) {
  return (
    fields(v, ["contractVersion", "command"]) &&
    v.contractVersion === CONTRACT &&
    fields(v.command, ["binding", "approval", "activation"]) &&
    signedObject(v.command.binding) &&
    signedObject(v.command.approval) &&
    pairingPacket(v.command.activation)
  );
}
function credentialReceipt(v: unknown, operationId?: string) {
  return (
    fields(v, [
      "contractVersion",
      "profile",
      "operationId",
      "fingerprint",
      "identity",
      "binding",
      "lease",
      "approval",
    ]) &&
    v.contractVersion === CONTRACT &&
    v.profile === "folioview.agent-credential.v1" &&
    op(v.operationId) &&
    (operationId === undefined || v.operationId === operationId) &&
    hash(v.fingerprint) &&
    formal("PersistentAgentIdentity", v.identity) &&
    formal("AgentCredentialLease", v.lease) &&
    signedObject(v.binding) &&
    signedObject(v.approval)
  );
}
function restorationDescriptor(v: unknown) {
  return (
    fields(v, ["connectionId", "bindingFingerprint", "credentialFingerprint", "generation"]) &&
    id(v.connectionId) &&
    hash(v.bindingFingerprint) &&
    integer(v.generation, 0) &&
    nullable(v.credentialFingerprint, hash) &&
    (v.generation === 0) === (v.credentialFingerprint === null)
  );
}
function restorationResponse(p: string[], v: Record<string, unknown>) {
  if (v.profile !== "folioview.agent-restoration.v1") return false;
  if (p.length === 7)
    return (
      fields(v, ["contractVersion", "profile", "source"]) &&
      nullable(v.source, restorationDescriptor)
    );
  return (
    fields(v, [
      "contractVersion",
      "profile",
      "source",
      "historical",
      "identityState",
      "credential",
      "resourceState",
      "predecessor",
    ]) &&
    restorationDescriptor(v.source) &&
    record(v.source) &&
    v.source.connectionId === p[7] &&
    v.source.bindingFingerprint === p[8] &&
    typeof v.historical === "boolean" &&
    fields(v.identityState, [
      "contractVersion",
      "profile",
      "identity",
      "binding",
      "revocation",
      "connectionRevoked",
    ]) &&
    v.identityState.contractVersion === CONTRACT &&
    v.identityState.profile === AGENT &&
    formal("PersistentAgentIdentity", v.identityState.identity) &&
    record(v.identityState.identity) &&
    v.identityState.identity.connectionId === p[7] &&
    v.identityState.identity.bindingFingerprint === p[8] &&
    signedObject(v.identityState.binding) &&
    nullable(v.identityState.revocation, signedObject) &&
    typeof v.identityState.connectionRevoked === "boolean" &&
    nullable(
      v.credential,
      (c) =>
        fields(c, ["lease", "approval"]) &&
        formal("AgentCredentialLease", c.lease) &&
        signedObject(c.approval),
    ) &&
    fields(v.resourceState, [
      "contractVersion",
      "profile",
      "consent",
      "operations",
      "parentRevoked",
    ]) &&
    v.resourceState.contractVersion === CONTRACT &&
    v.resourceState.profile === CONSENT &&
    nullable(v.resourceState.consent, (c) => formal("PersistentResourceConsent", c)) &&
    Array.isArray(v.resourceState.operations) &&
    v.resourceState.operations.length <= 96 &&
    v.resourceState.operations.every(op) &&
    typeof v.resourceState.parentRevoked === "boolean" &&
    nullable(v.predecessor, restorationDescriptor)
  );
}
function credentialResponse(
  p: string[],
  method: string,
  v: Record<string, unknown>,
  operationId?: string,
) {
  if (p[6] === "restoration") return restorationResponse(p, v);
  if (p[4] === "capabilities")
    return (
      fields(v, [
        "contractVersion",
        "profile",
        "enabled",
        "defaultValiditySeconds",
        "noticeSeconds",
      ]) &&
      v.profile === "folioview.agent-credential.v1" &&
      typeof v.enabled === "boolean" &&
      v.defaultValiditySeconds === 7776000 &&
      v.noticeSeconds === 604800
    );
  if (p.length === 6)
    return (
      fields(v, [
        "contractVersion",
        "profile",
        "identity",
        "binding",
        "lease",
        "approval",
        "status",
        "defaultValiditySeconds",
        "noticeSeconds",
      ]) &&
      v.profile === "folioview.agent-credential.v1" &&
      nullable(v.identity, (x) => formal("PersistentAgentIdentity", x)) &&
      nullable(v.binding, signedObject) &&
      nullable(v.lease, (x) => formal("AgentCredentialLease", x)) &&
      nullable(v.approval, signedObject) &&
      ["active", "expiring", "expired", "revoked", "reauthorization_required"].includes(
        String(v.status),
      ) &&
      v.defaultValiditySeconds === 7776000 &&
      v.noticeSeconds === 604800
    );
  if (p[6] === "setups")
    return (
      fields(v, [
        "setupIntentId",
        "ownerSubject",
        "vaultId",
        "connectionId",
        "clientId",
        "authorizationId",
        "issuedAt",
        "expiresAt",
        "expectedGeneration",
        "expectedCredentialFingerprint",
        "offer",
        "consumedBy",
        "issuer",
        "provider",
        "predecessorConnectionId",
      ]) &&
      v.setupIntentId === p[7] &&
      hash(v.ownerSubject) &&
      v.vaultId === p[4] &&
      v.connectionId === p[5] &&
      id(v.clientId) &&
      id(v.authorizationId) &&
      integer(v.issuedAt, 0) &&
      integer(v.expiresAt, 1) &&
      v.expiresAt === Number(v.issuedAt) + 600 &&
      integer(v.expectedGeneration, 0) &&
      nullable(v.expectedCredentialFingerprint, hash) &&
      nullable(v.offer, pairingPacket) &&
      nullable(v.consumedBy, op) &&
      typeof v.issuer === "string" &&
      /^https:\/\/[^/]+$/.test(v.issuer) &&
      ["muse", "chatgpt"].includes(String(v.provider)) &&
      nullable(v.predecessorConnectionId, id)
    );
  return credentialReceipt(v, method === "GET" ? p[7] : operationId);
}
/** DTO validation only. Root/Agent signatures are independently verified inside the owner Worker. */
export function persistentResponse(
  path: string,
  method: string,
  v: unknown,
  operationId?: string,
): boolean {
  const p = path.split("?", 1)[0].split("/");
  if (p[3] === "agent-credentials") {
    if (!record(v)) return false;
    // Owner setup metadata is a closed object without a contractVersion wrapper.
    return (
      (p[6] === "setups" || v.contractVersion === CONTRACT) &&
      credentialResponse(p, method, v, operationId)
    );
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
      ["muse", "chatgpt"].includes(String(x.provider)) &&
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
