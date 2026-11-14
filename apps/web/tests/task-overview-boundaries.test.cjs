const test = require("node:test"),
  assert = require("node:assert/strict");
const { stack, response, HUB, CONTRACT } = require("./full-flow-boundaries-helpers.cjs"),
  fixtures = require("./task-overview-fixtures.cjs");
const path = "/api/v3/tasks/vault_A/overview/query",
  body = { contractVersion: CONTRACT, knownPacketVersions: [], packetLimit: 4 };
const options = () => ({
  method: "POST",
  json: structuredClone(body),
  headers: { "X-FolioView-Contract": CONTRACT },
});
test("actual AuthProvider and Next proxy admit only the closed readonly overview POST and reuse all original nested DTO validators", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_overview_owner");
  const expected = fixtures.body(body);
  b.setUpstream((url, init) => {
    assert.equal(url, HUB + path);
    assert.equal(init.method, "POST");
    assert.equal(b.subject(init), "synthetic_overview_owner");
    assert.deepEqual(
      JSON.parse(typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body)),
      body,
    );
    return response(expected);
  });
  const r = await owner.value.requestPrivate("agent-hub", path, owner.value.sessionKey, options());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), expected);
  assert.equal(b.producerCalls().length, 1);
  for (const [route, patch] of [
    [path + "?owner=foreign", {}],
    [path, { method: "GET" }],
    [path, { method: "PUT" }],
    [path, { json: { ...body, packetLimit: 5 } }],
    [path, { json: { ...body, extra: true } }],
    [
      path,
      {
        json: {
          ...body,
          knownPacketVersions: [
            { taskId: "task_1", taskVersion: 1, envelopeFingerprint: "a".repeat(64), keyEpoch: 1 },
          ],
        },
      },
    ],
    [path, { headers: { "X-FolioView-Delegation": "foreign" } }],
    [path, { headers: { "Idempotency-Key": "invented_operation" } }],
  ])
    await assert.rejects(
      owner.value.requestPrivate("agent-hub", route, owner.value.sessionKey, {
        ...options(),
        ...patch,
      }),
    );
  assert.equal(b.producerCalls().length, 1);
  assert.equal(b.logs.length, 0);
});
test("actual proxy fails the whole overview on nested foreign or malformed DTOs without replacing bad packets by null", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_overview_owner");
  for (const mutate of [
    (v) => (v.vaultId = "foreign"),
    (v) => (v.tasks.items[0].vaultId = "foreign"),
    (v) => (v.tasks.nextCursor = "new_cursor"),
    (v) => (v.capabilities.extra = "FORBIDDEN"),
    (v) => (v.feeds.persistent.items[0].extra = "FORBIDDEN"),
    (v) => (v.feeds.archived.nextCursor = 7),
    (v) => (v.connections.connections[0].extra = "FORBIDDEN"),
    (v) => (v.packets.items[0].packet.metadata.taskId = "foreign"),
    (v) => v.packets.items.push(v.packets.items[0]),
    (v) => v.packets.remainingTaskIds.push("invented_suffix"),
    (v) => (v.packets.items[0].packet.keyProofs.extra = "FORBIDDEN"),
  ]) {
    const value = fixtures.body(body);
    mutate(value);
    b.setUpstream(() => response(value));
    const r = await owner.value.requestPrivate(
      "agent-hub",
      path,
      owner.value.sessionKey,
      options(),
    );
    assert.equal(r.status, 503);
    assert.ok(!JSON.stringify(await r.json()).includes("FORBIDDEN"));
  }
});
test("budget null and all-known null retain original task and feed pages at the actual boundary", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_overview_owner");
  for (const known of [
    [],
    fixtures.body().tasks.items.map(({ taskId, taskVersion, envelopeFingerprint }) => ({
      taskId,
      taskVersion,
      envelopeFingerprint,
    })),
  ]) {
    const req = { ...body, knownPacketVersions: known };
    const value = fixtures.body(req);
    value.packets = null;
    b.setUpstream(() => response(value));
    const r = await owner.value.requestPrivate("agent-hub", path, owner.value.sessionKey, {
      ...options(),
      json: req,
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), value);
  }
});
