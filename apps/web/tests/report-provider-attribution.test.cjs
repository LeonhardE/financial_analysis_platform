const assert = require("node:assert/strict"),
  test = require("node:test");
const { compile } = require("./resource-library-helpers.cjs");
const { readReportProviders } = compile("../lib/report-provider-attribution.ts");
const row = (patch = {}) => ({
  connectionId: "connection_A",
  clientId: "client_A",
  vaultId: "vault_A",
  provider: "muse",
  status: "revoked",
  accountState: "revoked",
  linkedAt: 1,
  ...patch,
});
const page = (connections) => ({
  contractVersion: "folioview.agent-workspace.v2.0",
  profile: "folioview.persistent-account.v1",
  connections,
});
test("provider labels retain historical revocations, filter vaults and never derive a provider from clientId", () => {
  const providers = readReportProviders(
    page([row(), row({ connectionId: "foreign", vaultId: "vault_B", provider: "chatgpt" })]),
    "vault_A",
  );
  assert.equal(providers.connection_A, "muse");
  assert.equal(providers.foreign, undefined);
  assert.equal(providers.chatgpt_client, undefined);
  assert.equal(Object.keys(providers).length, 1);
});
test("the existing Owner connection display DTO is closed, bounded and rejects duplicate/ambiguous attribution", () => {
  for (const value of [
    page([row(), row()]),
    page(Array.from({ length: 33 }, (_, n) => row({ connectionId: `c_${n}` }))),
    { ...page([]), permission: true },
    page([row({ provider: "guessed" })]),
    page([row({ vaultId: null })]),
    page([row({ status: "authorized" })]),
    page([row({ linkedAt: -1 })]),
    page([row({ extra: true })]),
  ])
    assert.throws(() => readReportProviders(value, "vault_A"), /invalid_response/);
});
