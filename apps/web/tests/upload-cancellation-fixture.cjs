const { createHash } = require("node:crypto");
module.exports = function cancellationFixture(kind, slot, id = "synthetic_cancel_operation_0001") {
  const contractVersion = "folioview.agent-workspace.v2.0",
    rootKeyId = "A".repeat(43);
  const target =
    kind === "task"
      ? {
          taskId: slot,
          operationId: "synthetic_original_upload_0001",
          mode: "create",
          expectedVersion: 0,
          authorKeyId: rootKeyId,
          envelopeFingerprint: "a".repeat(64),
          requestFingerprint: "b".repeat(64),
          packetDigest: "c".repeat(64),
        }
      : {
          resourceRef: {
            kind: "holdings",
            sourceService: "portfolio",
            resourceId: slot,
            incarnation: "synthetic_incarnation",
          },
          sourceEpoch: 1,
          snapshotId: "snapshot_A",
          operationId: "synthetic_original_upload_0001",
          expectedRevision: 0,
          authorKeyId: rootKeyId,
          envelopeFingerprint: "a".repeat(64),
          packetDigest: "c".repeat(64),
        };
  const payload = {
      artifactType: `${kind}_upload_cancellation_intent`,
      contractVersion,
      profile: `folioview.${kind}-upload-cancellation.v1`,
      ownerSubject: "a".repeat(64),
      vaultId: "vault_A",
      rootKeyId,
      rootEpoch: 1,
      cancellationId: id,
      target,
    },
    b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url"),
    command = {
      protected: b64({
        alg: "ES256",
        kid: rootKeyId,
        typ: "fv-control+jws",
        cty: "application/json",
      }),
      payload: b64(payload),
      signature: "A".repeat(86),
    };
  const response = {
    contractVersion,
    profile: payload.profile,
    command,
    receipt: {
      ...Object.fromEntries(
        ["cancellationId", "ownerSubject", "vaultId", "rootKeyId", "rootEpoch", "target"].map(
          (k) => [k, payload[k]],
        ),
      ),
      commandFingerprint: createHash("sha256")
        .update(command.protected + "." + command.payload)
        .digest("hex"),
      outcome: "cancelled",
      acceptedAt: 1000,
    },
  };
  return { id, body: { contractVersion, command }, response };
};
