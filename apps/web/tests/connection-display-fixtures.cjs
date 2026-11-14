// Closed synthetic transport only; signature/authority behavior is tested in the real Worker suite.
const C = "folioview.agent-workspace.v2.0";
function displayBody(summary, mode = "complete", enabled = true) {
  const signed = { protected: "YQ", payload: "Yg", signature: "A".repeat(86) };
  return {
    contractVersion: C,
    profile: "folioview.provider-connection-display.v1",
    vaultId: summary.vaultId,
    mode,
    vaultResponse:
      mode === "separate"
        ? null
        : {
            contractVersion: C,
            vault: {
              vaultId: summary.vaultId,
              rootJwk: { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43) },
              rootKeyId: "A".repeat(43),
              version: 1,
              registryHistory: [
                {
                  contractVersion: C,
                  checkpoint: signed,
                  entries: [{ certificate: signed, active: true }],
                },
              ],
              archive: {
                profile: "folioview.passkey-vault.v1",
                ownerSubject: "a".repeat(64),
                vaultId: summary.vaultId,
                rootKeyId: "A".repeat(43),
                credentialId: "YQ",
                prfSalt: "A".repeat(43),
                iv: "A".repeat(16),
                ciphertext: "A".repeat(22),
              },
            },
            sources: [],
          },
    summary: mode === "separate" ? null : summary,
    capabilities: {
      agents: {
        contractVersion: C,
        profile: "folioview.persistent-agent-capabilities.v1",
        enrollmentEnabled: enabled,
        resourceConsentEnabled: enabled,
        executionEnabled: enabled,
      },
      account: {
        contractVersion: C,
        profile: "folioview.persistent-account.v1",
        accountLinkEnabled: enabled,
        scope: "runtime:connect",
        runtimeReady: false,
      },
      credentials: {
        contractVersion: C,
        profile: "folioview.agent-credential.v1",
        enabled,
        defaultValiditySeconds: 7776000,
        noticeSeconds: 604800,
      },
    },
  };
}
module.exports = { displayBody };
