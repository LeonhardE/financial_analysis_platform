const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compile,
  contracts,
  connection,
  grant,
  attempt,
  list,
} = require("./agent-connections-helpers.cjs");

test("closed connection profiles accept the actual 64-attempt producer bound and keep evidence separate", () => {
  const data = list(
    [connection()],
    Array.from({ length: 64 }, (_, i) => attempt({ requestId: `request_${i}` })),
  );
  assert.equal(contracts.readConnectionList(data).authorizationAttempts.length, 64);
  assert.equal(data.items[0].grants[0].signedGrantPresent, true);
  assert.equal(data.items[0].grants[0].readObserved, false);
  assert.equal(data.items[0].grants[0].resultSaved, false);
  assert.throws(() =>
    contracts.readConnectionList({
      ...data,
      authorizationAttempts: [...data.authorizationAttempts, attempt()],
    }),
  );
});
test("connection schema rejects alternate providers, unknown/private fields, duplicate grants and malformed source bindings", () => {
  for (const value of [
    list([connection({ provider: "chatgpt" })]),
    list([connection({ privateKey: "CANARY" })]),
    list([connection({ grants: [grant(), grant()] })]),
    list([connection({ approvedScopes: ["admin"] })]),
    list([connection({ approvedScopes: ["tasks:read", "tasks:read"] })]),
    list([
      connection({
        grants: [
          grant({
            resourceBindings: [
              {
                ref: {
                  kind: "holdings",
                  sourceService: "user",
                  resourceId: "source_A",
                  incarnation: "incarnation_A",
                },
                sourceEpoch: 1,
              },
            ],
          }),
        ],
      }),
    ]),
    list([connection({ grants: [grant({ taskVersion: 0 })] })]),
    list([connection({ expiresAt: 0 })]),
    list([connection()], [attempt({ token: "CANARY" })]),
  ])
    assert.throws(
      () => contracts.readConnectionList(value),
      (error) => error.code === "invalid_response",
    );
});
test("revocation ACK must name the exact selected connection and revoked grant", () => {
  const selected = { connectionId: "connection_A", grantId: "grant_A" };
  const ok = {
    contractVersion: contracts.CONNECTION_CONTRACT,
    connection: connection({ grants: [grant({ status: "revoked" })] }),
  };
  assert.equal(contracts.readRevocation(ok, selected).connectionId, "connection_A");
  for (const change of [
    connection({ connectionId: "connection_B", grants: [grant({ status: "revoked" })] }),
    connection(),
    connection({ grants: [] }),
  ])
    assert.throws(() => contracts.readRevocation({ ...ok, connection: change }, selected));
});
test("public agent-link configuration has only a validated fixed Hub origin and no credentials", () => {
  const client = compile("../lib/agent-link.ts", { "./agent-connections": contracts });
  const origin = "https://agent-hub-api-123456789.northamerica-northeast2.run.app";
  assert.equal(
    client.readAgentLinkConfiguration({ schemaVersion: 1, enabled: true, hubOrigin: origin })
      .hubOrigin,
    origin,
  );
  for (const value of [
    { schemaVersion: 1, enabled: true, hubOrigin: "https://attacker.example" },
    { schemaVersion: 1, enabled: false, hubOrigin: origin },
    { schemaVersion: 1, enabled: true, hubOrigin: origin, token: "CANARY" },
  ])
    assert.throws(() => client.readAgentLinkConfiguration(value));
  const server = compile(
    "../lib/server/agent-link.ts",
    {
      "server-only": {},
      "./hub-owner": { hubConfiguration: (env) => (env.valid ? { origin } : null) },
    },
    { process: { env: {} } },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(server.agentLinkConfiguration({ valid: true }))), {
    schemaVersion: 1,
    enabled: true,
    hubOrigin: origin,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(server.agentLinkConfiguration({}))), {
    schemaVersion: 1,
    enabled: false,
    hubOrigin: null,
  });
});
