const assert = require("node:assert/strict"),
  test = require("node:test");
const { compile } = require("./resource-library-helpers.cjs");
const t = compile("../lib/server/owner-transport.ts", {
  "server-only": {},
  "node:crypto": require("node:crypto"),
  jose: {},
});
const dto = compile("../lib/server/task-center-owner.ts", {
  "server-only": {},
  "./owner-transport": t,
});
const base = "/api/v3/task-center/vault_A/tasks/task_A",
  op = "center_01234567890123456789012345678901";
test("Owner task center routes stay closed; cancellation is narrow, fingerprint-bound and bounded", () => {
  const p = base + "/operations/" + op + "/cancel",
    body = { contractVersion: t.CONTRACT, fingerprint: "a".repeat(64) };
  assert.equal(dto.taskCenterRoute(p, "POST").responseStatus, 200);
  assert.equal(dto.taskCenterRequest(p, body), true);
  assert.equal(dto.taskCenterRequest(p, { ...body, command: {} }), false);
  assert.equal(dto.taskCenterRequest(p, { ...body, fingerprint: "bad" }), false);
  assert.equal(dto.taskCenterRoute(base + "/agent/runs/begin", "POST"), null);
  assert.equal(dto.taskCenterRoute(base + "/commands", "PATCH"), null);
  const outcome = {
    contractVersion: t.CONTRACT,
    taskId: "task_A",
    operationId: op,
    fingerprint: "a".repeat(64),
    state: "cancelled",
    receipt: null,
  };
  assert.equal(dto.taskCenterResponse(p, outcome), true);
  assert.equal(dto.taskCenterResponse(p, { ...outcome, state: "automatic_run_started" }), false);
  assert.equal(dto.taskCenterResponse(p, { ...outcome, extraSecret: "bad" }), false);
});
test("provider slot Owner state uses the published profile and cannot claim native dispatch", () => {
  const path = "/api/v3/provider-connections/vault_A/muse",
    state = {
      contractVersion: t.CONTRACT,
      profile: "folioview.provider-connection-slot.v1",
      slot: null,
      retainedSelections: [],
      retirementCandidates: [],
      legacyBlockers: [],
      requiresFreshGrants: true,
    };
  assert.equal(dto.taskCenterResponse(path, state), true);
  assert.equal(dto.taskCenterResponse(path, { ...state, profile: "invented" }), false);
});
