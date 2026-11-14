// Closed synthetic transport only; real Root/receipt/Worker behavior has a separate integration test.
const C = "folioview.agent-workspace.v2.0",
  source = "source_A",
  ref = {
    kind: "holdings",
    sourceService: "portfolio",
    resourceId: source,
    incarnation: "incarnation_A",
  };
const request = () => ({
  contractVersion: C,
  expected: {
    vaultId: "vault_A",
    rootJwk: { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43) },
    rootKeyId: "A".repeat(43),
    registrySequence: 1,
    checkpointDigest: "a".repeat(64),
    keyEpoch: 1,
    resourceRef: { ...ref },
    sourceEpoch: 2,
    recipientKeyIds: ["B".repeat(43), "C".repeat(43)],
  },
});
function view(mode = "complete", empty = false, legacy = false) {
  const signed = { protected: "YQ", payload: "Yg", signature: "A".repeat(86) };
  return {
    contractVersion: C,
    profile: "folioview.owner-holdings-view.v1",
    vaultId: "vault_A",
    sourceId: source,
    mode,
    metadata:
      mode !== "complete"
        ? null
        : {
            contractVersion: C,
            ownerSubject: "a".repeat(64),
            sourceId: source,
            vaultId: "vault_A",
            resourceRef: { ...ref },
            sourceEpoch: 2,
            revision: empty ? 0 : 1,
            snapshotId: empty ? null : "snapshot_A",
            snapshotSourceEpoch: empty || legacy ? null : 1,
            authorityVersion: 2,
            state: "active",
            pendingMutationId: null,
          },
    snapshot:
      mode !== "complete" || empty
        ? null
        : {
            contractVersion: C,
            carrier: { contractVersion: C, signedObject: signed },
            keyProofs: { checkpoint: signed, certificates: [signed] },
            receipt: {
              contractVersion: C,
              vaultId: "vault_A",
              resourceRef: { ...ref },
              snapshotId: "snapshot_A",
              revision: 1,
              sourceEpoch: 1,
              stableOperationId: "original_snapshot_operation_0001",
              envelopeFingerprint: "a".repeat(64),
              snapshotPath: `/api/v2/holdings/sources/${source}/snapshots/snapshot_A`,
              storedAt: "2026-10-30T12:00:00Z",
            },
          },
  };
}
module.exports = { C, source, ref, request, view };
