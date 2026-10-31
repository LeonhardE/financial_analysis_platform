// Synthetic lifecycle transport fixtures around the actual Worker crypto. No service/network side effects.
const { decoded, clone } = require("./full-flow-crypto-fixture.cjs");
async function lifecycleState(h, f) {
  const cp = decoded(f.vault.registryHistory.at(-1).checkpoint);
  return {
    contractVersion: h.core.CONTRACT,
    profile: "folioview.vault-lifecycle.v1",
    vaultId: f.vault.vaultId,
    rootKeyId: f.vault.rootKeyId,
    vaultVersion: f.vault.version,
    registrySequence: cp.registrySequence,
    checkpointDigest: await h.core.sha(h.core.canonical(cp)),
    keyEpoch: cp.keyEpoch,
    lifecycleVersion: 0,
    archiveRevision: 0,
    archiveDigest: await h.core.sha(h.core.canonical(f.vault.archive)),
    archive: f.vault.archive,
    pendingAuthorization: null,
    history: [],
  };
}
async function archiveAccepted(h, vault, state, packet, at = 1000) {
  const body = packet.body ?? packet,
    command = body.command,
    p = decoded(command);
  const nextVault = { ...clone(vault), archive: clone(body.archive) };
  const receipt = {
    profile: state.profile,
    ownerSubject: state.archive.ownerSubject,
    vaultId: vault.vaultId,
    rootKeyId: vault.rootKeyId,
    operationId: p.stableOperationId,
    action: p.action,
    lifecycleVersion: state.lifecycleVersion + 1,
    archiveRevision: state.archiveRevision + 1,
    archiveDigest: p.newArchiveDigest,
    commandFingerprint: await h.core.signingFingerprint(command),
    acceptedAt: at,
  };
  return {
    vault: nextVault,
    state: {
      ...clone(state),
      vaultVersion: nextVault.version,
      lifecycleVersion: receipt.lifecycleVersion,
      archiveRevision: receipt.archiveRevision,
      archiveDigest: receipt.archiveDigest,
      archive: clone(body.archive),
      pendingAuthorization: null,
      history: [...clone(state.history), { command: clone(command), receipt }],
    },
  };
}
async function renewalAccepted(h, vault, state, packet, at = 1000) {
  const p = decoded(packet.body.command);
  const advanced = await archiveAccepted(
    h,
    vault,
    state,
    { body: { ...packet.body, command: packet.body.archiveCommand } },
    at,
  );
  advanced.vault.registryHistory.push(clone(packet.body.registryBundle));
  advanced.vault.version = vault.version + 1;
  Object.assign(advanced.state, {
    vaultVersion: advanced.vault.version,
    registrySequence: p.registrySequence + 1,
    checkpointDigest: p.newCheckpointDigest,
    keyEpoch: p.keyEpoch,
  });
  const receipt = {
    profile: p.profile,
    ownerSubject: p.ownerSubject,
    vaultId: p.vaultId,
    rootKeyId: p.rootKeyId,
    operationId: p.stableOperationId,
    vaultVersion: p.expectedVaultVersion + 1,
    registrySequence: p.registrySequence + 1,
    checkpointDigest: p.newCheckpointDigest,
    keyEpoch: p.keyEpoch,
    lifecycleVersion: p.expectedLifecycleVersion + 1,
    archiveRevision: p.expectedArchiveRevision + 1,
    archiveDigest: p.newArchiveDigest,
    renewals: p.renewals,
    commandFingerprint: await h.core.signingFingerprint(packet.body.command),
    archiveCommandFingerprint: p.archiveCommandFingerprint,
    acceptedAt: at,
  };
  return {
    ...advanced,
    receipt: { contractVersion: h.core.CONTRACT, profile: p.profile, receipt },
  };
}
module.exports = { lifecycleState, archiveAccepted, renewalAccepted };
