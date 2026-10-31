const assert = require("node:assert/strict");
const test = require("node:test");
const {
  harness,
  list,
  connection,
  grant,
  response,
  deferred,
  settle,
  CONTRACT,
} = require("./agent-connections-helpers.cjs");

test("connections load without unlocking and independent task/connection revocation requires explicit confirmation", async () => {
  const h = harness();
  let model = await h.ready();
  h.lock();
  model = h.render();
  assert.equal(model.items.length, 2);
  assert.equal(model.unlocked, false);
  model.select("connection_A");
  model = h.render();
  model.reviewRevoke({ connectionId: "connection_A", grantId: "grant_A" });
  model = h.render();
  assert.equal(h.calls.filter((call) => call.route.endsWith("/revoke")).length, 0);
  await model.revoke();
  model = await h.drain();
  assert.equal(model.items[0].grants[0].status, "revoked");
  assert.equal(model.items[1].status, "active");
  assert.equal(model.items[1].grants[0].status, "active");
  assert.equal(model.notice, "revoked");
  assert.deepEqual(
    JSON.parse(JSON.stringify(h.calls.find((call) => call.route.endsWith("/revoke")).options.json)),
    { contractVersion: CONTRACT },
  );
  h.unmount();
});
test("account switches hide prior connection metadata before effects and discard delayed bodies", async () => {
  const body = deferred();
  let first = true;
  const h = harness({
    transport: ({ route }) => {
      if (route === "/api/v2/agent-connections" && first) {
        first = false;
        return new Response(
          new ReadableStream({
            start(controller) {
              body.promise.then(() => {
                try {
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify(list([connection({ connectionId: "private_A_connection" })])),
                    ),
                  );
                  controller.close();
                } catch {
                  /* Cancellation has already closed the real response stream. */
                }
              });
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
    },
  });
  h.render();
  await settle();
  h.owner("owner_B:2");
  let model = h.render({ flush: false });
  assert.equal(model.items.length, 0);
  h.render();
  body.resolve();
  model = await h.drain();
  assert.ok(model.items.every((item) => item.connectionId !== "private_A_connection"));
  h.unmount();
});
test("authorization changes invalidate a pending revocation review before any write", async () => {
  const h = harness();
  let model = await h.ready();
  model.reviewRevoke({ connectionId: "connection_A", grantId: null });
  h.render();
  h.items[0].authorizationId = "authorization_new";
  await h.render().revoke();
  model = await h.drain();
  assert.equal(model.error, "review_required");
  assert.equal(h.calls.filter((call) => call.route.endsWith("/revoke")).length, 0);
  assert.equal(model.confirmation, null);
  h.unmount();
});
test("unknown revoke outcome never auto-retries and explicit reload recovers authoritative state", async () => {
  let lost = true;
  const h = harness({
    transport: ({ route }) => {
      if (route.endsWith("/revoke") && lost) {
        lost = false;
        h.items[0].status = "revoked";
        h.items[0].grants[0].status = "revoked";
        throw new Error("lost reply");
      }
    },
  });
  let model = await h.ready();
  model.reviewRevoke({ connectionId: "connection_A", grantId: null });
  await h.render().revoke();
  model = await h.drain();
  assert.equal(model.uncertain, true);
  assert.equal(model.error, "outcome_unknown");
  assert.equal(model.notice, "");
  await model.revoke();
  assert.equal(h.calls.filter((call) => call.route.endsWith("/revoke")).length, 1);
  await model.reload();
  model = await h.drain();
  assert.equal(model.items[0].status, "revoked");
  assert.equal(model.uncertain, false);
  h.unmount();
});
test("late task decryption after lock and another selection never restores private rules", async () => {
  const clear = deferred(),
    h = harness({ openTask: () => clear.promise });
  let model = await h.ready();
  model.select("connection_A");
  model = h.render();
  const opening = model.inspectGrant("connection_A", "grant_A");
  await settle();
  h.lock();
  model = h.render({ flush: false });
  assert.equal(model.privateTask, null);
  h.render();
  clear.resolve({ name: "PRIVATE_CANARY", goal: "PRIVATE_GOAL" });
  await opening;
  model = await h.drain();
  assert.equal(model.privateTask, null);
  h.unmount();
});
test("hidden views and unavailable capabilities cannot mutate or publish stale reads", async () => {
  const h = harness();
  let model = await h.ready();
  model.reviewRevoke({ connectionId: "connection_A", grantId: null });
  model = h.render();
  h.visibility(false);
  const hidden = h.render();
  assert.equal(hidden.items.length, 0);
  await model.revoke();
  assert.equal(h.calls.filter((call) => call.route.endsWith("/revoke")).length, 0);
  h.visibility(true);
  h.capability(false);
  const disabled = h.render();
  assert.equal(disabled.items.length, 0);
  assert.equal(disabled.confirmation, null);
  h.unmount();
});
test("a stalled revocation clears busy at deadline and leaves outcome uncertain without a second POST", async () => {
  const stalled = deferred();
  const h = harness({
    transport: ({ route }) => (route.endsWith("/revoke") ? stalled.promise : undefined),
  });
  let model = await h.ready();
  model.reviewRevoke({ connectionId: "connection_A", grantId: null });
  const sending = h.render().revoke();
  await settle();
  h.render();
  for (const callback of [...h.timers.values()]) callback();
  await sending;
  model = await h.drain();
  assert.equal(model.busy, false);
  assert.equal(model.uncertain, true);
  assert.equal(h.calls.filter((call) => call.route.endsWith("/revoke")).length, 1);
  stalled.resolve(
    response({
      contractVersion: CONTRACT,
      connection: connection({ status: "revoked", grants: [grant({ status: "revoked" })] }),
    }),
  );
  await h.drain();
  h.unmount();
});

test("disabled Muse issuance keeps owner history and revocation independently usable", async () => {
  const h = harness({
    transport: ({ route }) =>
      route === "/api/v2/agent-capabilities"
        ? response({
            contractVersion: CONTRACT,
            profile: "folioview.owner-agent-capabilities.v1",
            ownerConnections: true,
            museConnectionEnabled: false,
          })
        : undefined,
  });
  let model = await h.ready();
  assert.equal(model.connectionsLoaded, true);
  assert.equal(model.museConnectionEnabled, false);
  assert.equal(model.error, "");
  model.reviewRevoke({ connectionId: "connection_A", grantId: null });
  await h.render().revoke();
  model = await h.drain();
  assert.equal(model.items[0].status, "revoked");
  assert.equal(model.museConnectionEnabled, false);
  h.unmount();
});

test("capability timeout never delays an independently successful owner list or revocation", async () => {
  const stalled = deferred();
  const h = harness({
    transport: ({ route }) =>
      route === "/api/v2/agent-capabilities" ? stalled.promise : undefined,
  });
  let model = await h.ready();
  assert.equal(model.connectionsLoaded, true);
  assert.equal(model.loading, false);
  assert.equal(model.capabilitiesLoading, true);
  assert.equal(model.items.length, 2);
  model.reviewRevoke({ connectionId: "connection_A", grantId: null });
  await h.render().revoke();
  model = await h.drain();
  assert.equal(model.items[0].status, "revoked");
  for (const callback of [...h.timers.values()]) callback();
  model = await h.drain();
  assert.equal(model.capabilitiesLoading, false);
  assert.equal(model.capabilityError, "request_timeout");
  assert.equal(model.error, "");
  assert.equal(model.items.length, 2);
  stalled.resolve(
    response({
      contractVersion: CONTRACT,
      profile: "folioview.owner-agent-capabilities.v1",
      ownerConnections: true,
      museConnectionEnabled: true,
    }),
  );
  model = await h.drain();
  assert.equal(model.museConnectionEnabled, null);
  h.unmount();
});

test("real list failures and unavailable or malformed capability signals stay distinct", async () => {
  for (const faulty of ["list", "capability", "malformed"]) {
    const h = harness({
      transport: ({ route }) => {
        if (
          (faulty === "list" && route === "/api/v2/agent-connections") ||
          (faulty === "capability" && route === "/api/v2/agent-capabilities")
        )
          return Response.json({}, { status: 503 });
        if (faulty === "malformed" && route === "/api/v2/agent-capabilities")
          return response({
            contractVersion: CONTRACT,
            profile: "folioview.owner-agent-capabilities.v1",
            ownerConnections: true,
            museConnectionEnabled: "true",
            privateCanary: "PRIVATE_CANARY",
          });
      },
    });
    const model = await h.ready();
    assert.equal(model.error, faulty === "list" ? "request_failed" : "");
    assert.equal(model.connectionsLoaded, faulty !== "list");
    assert.equal(
      model.capabilityError,
      faulty === "list" ? "" : faulty === "malformed" ? "invalid_response" : "request_failed",
    );
    assert.equal(model.museConnectionEnabled, faulty === "list" ? true : null);
    assert.ok(!JSON.stringify(model).includes("PRIVATE_CANARY"));
    h.unmount();
  }
});

test("a late prior-owner capability cannot restore a new-connection entry for the next owner", async () => {
  const stalled = deferred();
  let first = true;
  const h = harness({
    transport: ({ route }) => {
      if (route === "/api/v2/agent-capabilities" && first) {
        first = false;
        return stalled.promise;
      }
    },
  });
  await h.ready();
  h.owner("owner_B:2");
  h.render();
  await h.drain();
  stalled.resolve(
    response({
      contractVersion: CONTRACT,
      profile: "folioview.owner-agent-capabilities.v1",
      ownerConnections: true,
      museConnectionEnabled: false,
    }),
  );
  const model = await h.drain();
  assert.equal(model.owner, "owner_B:2");
  assert.equal(model.museConnectionEnabled, true);
  h.unmount();
});

test("the same-owner operation gate survives hidden display masking but pauses on real reload and owner change", async () => {
  const h = harness();
  let model = await h.ready();
  assert.equal(model.museConnectionOperationsEnabled, true);
  h.visibility(false);
  model = h.render();
  assert.equal(model.items.length, 0);
  assert.equal(model.museConnectionEnabled, null);
  assert.equal(model.museConnectionOperationsEnabled, true);
  h.active(false);
  model = h.render();
  assert.equal(model.museConnectionOperationsEnabled, true);
  h.visibility(true);
  h.active(true);
  model = await h.drain();
  const checking = model.reload();
  model = h.render();
  assert.equal(model.museConnectionOperationsEnabled, false);
  await checking;
  model = await h.drain();
  assert.equal(model.museConnectionOperationsEnabled, true);
  h.owner("owner_B:2");
  model = h.render({ flush: false });
  assert.equal(model.museConnectionOperationsEnabled, false);
  h.render();
  model = await h.drain();
  assert.equal(model.museConnectionOperationsEnabled, true);
  h.capability(false);
  model = h.render({ flush: false });
  assert.equal(model.museConnectionOperationsEnabled, false);
  h.unmount();
});
