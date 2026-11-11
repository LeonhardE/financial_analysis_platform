const { compile, response, settle, deferred } = require("./resource-library-helpers.cjs");
const tasks = compile("../lib/task-types.ts");
const contracts = compile("../lib/agent-connections.ts", { "./task-types": tasks });
const CONTRACT = contracts.CONNECTION_CONTRACT;
const now = 1793368800;
const binding = (kind = "watchlist") => ({
  ref: {
    kind,
    sourceService: kind === "holdings" ? "portfolio" : "user",
    resourceId: `${kind}_A`,
    incarnation: "incarnation_A",
  },
  sourceEpoch: 1,
});
const grant = (patch = {}) => ({
  taskId: "task_A",
  taskVersion: 1,
  executionEpoch: 1,
  resourceBindings: [binding()],
  grantId: "grant_A",
  grantEpoch: 1,
  status: "active",
  authorizedAt: now,
  readObserved: false,
  resultSaved: false,
  signedGrantPresent: true,
  ...patch,
});
const connection = (patch = {}) => ({
  connectionId: "connection_A",
  provider: "muse",
  clientId: "muse_client",
  authorizationId: "authorization_A",
  status: "active",
  authorizedAt: now,
  expiresAt: now + 3600,
  approvedScopes: ["tasks:read", "runs:read", "watchlist:read", "results:create"],
  grants: [grant()],
  ...patch,
});
const attempt = (patch = {}) => ({
  requestId: "request_A",
  clientId: "muse_client",
  connectionId: "connection_A",
  authorizationId: "authorization_A",
  status: "authorized",
  createdAt: now,
  updatedAt: now,
  expiresAt: now + 3600,
  ...patch,
});
const list = (items = [connection()], authorizationAttempts = [attempt()]) => ({
  contractVersion: CONTRACT,
  items,
  authorizationAttempts,
});
function taskPacket(taskId = "task_A", version = 1) {
  return {
    contractVersion: CONTRACT,
    metadata: {
      contractVersion: CONTRACT,
      vaultId: "vault_A",
      taskId,
      taskVersion: version,
      executionEpoch: 1,
      status: "active",
      resourceBindings: [binding()],
      objectRevision: version,
      deliveryRevision: 1,
      envelopeFingerprint: "a".repeat(64),
      keyEpoch: 1,
      createdAt: "2026-10-30T10:00:00Z",
      updatedAt: "2026-10-30T10:00:00Z",
    },
    signedObject: { protected: "header", payload: "payload", signature: "signature" },
    keyProofs: {
      checkpoint: { protected: "header", payload: "payload", signature: "signature" },
      certificates: [],
    },
  };
}
module.exports = {
  compile,
  tasks,
  contracts,
  CONTRACT,
  now,
  binding,
  grant,
  connection,
  attempt,
  list,
  taskPacket,
  response,
  settle,
  deferred,
};
