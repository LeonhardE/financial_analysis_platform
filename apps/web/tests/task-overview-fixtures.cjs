const C = "folioview.agent-workspace.v2.0";
const metadata = (n = 1, version = 1) => ({
  contractVersion: C,
  vaultId: "vault_A",
  taskId: `task_${n}`,
  taskVersion: version,
  executionEpoch: 1,
  status: "active",
  resourceBindings: [],
  objectRevision: version,
  deliveryRevision: 1,
  envelopeFingerprint: String(version % 10).repeat(64),
  keyEpoch: 1,
  createdAt: "2026-10-30T10:00:00Z",
  updatedAt: "2026-10-30T10:00:00Z",
});
const signed = { protected: "opaque", payload: "opaque", signature: "A".repeat(86) };
const packet = (m) => ({
  contractVersion: C,
  metadata: m,
  signedObject: signed,
  keyProofs: { checkpoint: signed, certificates: [signed] },
});
const batch = (ids, tasks) => ({
  contractVersion: C,
  profile: "folioview.owner-task-packets.v1",
  items: ids.map((id) => ({
    taskId: id,
    status: "ready",
    packet: packet(tasks.find((t) => t.taskId === id)),
  })),
  remainingTaskIds: [],
});
function body(request = { knownPacketVersions: [], packetLimit: 4 }, count = 2) {
  const tasks = Array.from({ length: count }, (_, i) => metadata(i + 1));
  const ids = tasks
    .filter(
      (t) =>
        !request.knownPacketVersions.some(
          (k) =>
            k.taskId === t.taskId &&
            k.taskVersion === t.taskVersion &&
            k.envelopeFingerprint === t.envelopeFingerprint,
        ),
    )
    .slice(0, 4)
    .map((t) => t.taskId);
  return {
    contractVersion: C,
    profile: "folioview.owner-task-overview.v1",
    vaultId: "vault_A",
    tasks: { contractVersion: C, items: tasks, nextCursor: null },
    capabilities: {
      contractVersion: C,
      profile: "folioview.task-center.v1",
      enabled: true,
      actions: ["set_rules", "set_assignment", "remove_assignment", "trash", "restore", "purge"],
      dispatchSupported: false,
      nativeScheduleAttested: false,
    },
    feeds: {
      persistent: {
        contractVersion: C,
        profile: "folioview.persistent-content.v1",
        items: [
          {
            resultId: "result_A",
            taskId: "task_1",
            runId: "run_A",
            connectionId: "connection_A",
            receivedAt: 1000,
            stateVersion: 0,
            read: false,
            starred: false,
            archived: false,
          },
        ],
        nextCursor: null,
      },
      foreground: { contractVersion: C, items: [], nextCursor: null },
      archived: { contractVersion: C, items: [], nextCursor: null },
    },
    connections: {
      contractVersion: C,
      profile: "folioview.persistent-account.v1",
      connections: [
        {
          connectionId: "connection_A",
          clientId: "client_A",
          vaultId: "vault_A",
          provider: "muse",
          status: "revoked",
          accountState: "revoked",
          linkedAt: 1000,
        },
      ],
    },
    packets: request.packetLimit === 4 && ids.length ? batch(ids, tasks) : null,
  };
}
module.exports = { C, metadata, packet, batch, body };
