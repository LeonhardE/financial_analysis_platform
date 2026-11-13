const test = require("node:test"),
  assert = require("node:assert/strict"),
  { compile } = require("./resource-library-helpers.cjs");
const t = compile("../lib/server/owner-transport.ts", {
    "server-only": {},
    "node:crypto": require("node:crypto"),
    jose: {},
  }),
  dto = compile("../lib/server/task-center-owner.ts", {
    "../persistent-owner-routes": compile("../lib/persistent-owner-routes.ts"),
    "server-only": {},
    "./owner-transport": t,
  });
const root = "/api/v3/provider-connections/vault_A/muse",
  C = t.CONTRACT,
  sig = { protected: "p", payload: "q", signature: "s" };
test("provider activation is a closed Owner command with no transferred task scope or arbitrary paths", () => {
  const b = {
    contractVersion: C,
    command: {
      approval: sig,
      review: {
        contractVersion: C,
        profile: "folioview.provider-connection-slot.v1",
        ownerSubject: "owner_A",
        vaultId: "vault_A",
        provider: "muse",
        slotId: "provider_A",
        retiredCredentials: [],
        tasks: [],
      },
      credential: {
        binding: sig,
        approval: sig,
        activation: { version: 1, iv: "a".repeat(16), ciphertext: "b".repeat(30) },
      },
    },
  };
  assert.equal(dto.taskCenterRoute(root + "/commands", "POST").max, 140000);
  assert.equal(dto.taskCenterRequest(root + "/commands", b), true);
  assert.equal(dto.taskCenterRequest(root + "/commands", { ...b, privateKey: "no" }), false);
  assert.equal(
    dto.taskCenterRequest(root + "/commands", {
      ...b,
      command: { ...b.command, review: { ...b.command.review, tasks: [{ taskId: "task_A" }] } },
    }),
    false,
  );
  assert.equal(
    dto.taskCenterRoute("/api/v3/provider-connections/vault_A/claude/commands", "POST"),
    null,
  );
  assert.equal(dto.taskCenterRoute(root + "/agent/run", "POST"), null);
});
test("capabilities cannot promise automatic migration and slot history rejects unknown nested fields", () => {
  const caps = {
    contractVersion: C,
    profile: "folioview.provider-connection-slot.v1",
    enabled: false,
    providers: ["muse", "chatgpt"],
    automaticMigration: false,
  };
  assert.equal(dto.taskCenterResponse("/api/v3/provider-connections/capabilities", caps), true);
  assert.equal(
    dto.taskCenterResponse("/api/v3/provider-connections/capabilities", {
      ...caps,
      automaticMigration: true,
    }),
    false,
  );
  const state = {
    contractVersion: C,
    profile: caps.profile,
    slot: null,
    retainedSelections: [],
    retirementCandidates: [
      {
        connectionId: "connection_A",
        clientId: "muse_A",
        credentialGeneration: 1,
        credentialFingerprint: "a".repeat(64),
        privateKey: "no",
      },
    ],
    legacyBlockers: [],
    requiresFreshGrants: true,
  };
  assert.equal(dto.taskCenterResponse(root, state), false);
});
