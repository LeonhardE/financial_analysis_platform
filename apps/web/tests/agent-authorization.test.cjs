const assert = require("node:assert/strict"),
  test = require("node:test");
const { compile } = require("./resource-library-helpers.cjs");
const types = compile("../lib/task-types.ts"),
  connections = compile("../lib/agent-connections.ts", { "./task-types": types });
const { agentAuthorizationHandoff: parse } = compile(
  "../lib/agent-authorization.ts",
  { "./agent-connections": connections },
  { URLSearchParams, atob },
);
const origin = "https://synthetic-hub.example",
  value = {
    version: 1,
    issuer: origin,
    vaultId: "vault_A",
    connectionId: "connection_A",
    setupIntentId: "setup_synthetic_owner_00001",
    secret: Buffer.alloc(32, 7).toString("base64url"),
  };
const hash = (v) => "#agent_authorization=" + Buffer.from(JSON.stringify(v)).toString("base64url");
test("temporary authorization fragments are closed and bound to the configured service", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parse(hash(value), origin))), value);
  assert.equal(parse("#inbox/result/result_A", origin), null);
  for (const v of [
    { ...value, issuer: "https://attacker.example" },
    { ...value, owner: "caller_claim" },
    { ...value, secret: "bad" },
    { ...value, connectionId: "../other" },
    { ...value, version: 2 },
  ])
    assert.throws(
      () => parse(hash(v), origin),
      (e) => e.code === "invalid_handoff",
    );
  for (const v of [
    hash(value) + "&agent_authorization=duplicate",
    hash(value) + "&secret=extra",
    "#agent_authorization=%%%",
    "#agent_authorization=" + "a".repeat(4097),
  ])
    assert.throws(
      () => parse(v, origin),
      (e) => e.code === "invalid_handoff",
    );
});
