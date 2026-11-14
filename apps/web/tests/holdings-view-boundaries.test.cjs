const test = require("node:test"),
  assert = require("node:assert/strict"),
  { stack, response, PORTFOLIO, CONTRACT } = require("./full-flow-boundaries-helpers.cjs"),
  f = require("./holdings-view-fixtures.cjs");
const path = `/api/v3/holdings/sources/${f.source}/view/query`;
const options = () => ({
  method: "POST",
  json: f.request(),
  headers: { "X-FolioView-Contract": CONTRACT },
});
test("actual browser and Next view preserve Firebase Owner plus the original service IAM header and exact DTO", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_view_owner");
  b.setUpstream((url, init) => {
    assert.equal(url, PORTFOLIO + path);
    assert.equal(init.method, "POST");
    assert.equal(b.subject(init), "synthetic_view_owner");
    assert.equal(
      new Headers(init.headers).get("x-serverless-authorization"),
      "Bearer " + b.serviceToken,
    );
    assert.equal(new Headers(init.headers).get("x-folioview-authority-delegation"), null);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), f.request());
    return response(f.view());
  });
  const r = await owner.value.requestPrivate("portfolio", path, owner.value.sessionKey, options());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), f.view());
  assert.equal(b.producerCalls().length, 1);
  for (const [route, patch] of [
    [path + "?owner=foreign", {}],
    [path, { method: "GET" }],
    [path, { json: { ...f.request(), extra: true } }],
    [path, { headers: { "X-Serverless-Authorization": "Bearer attacker" } }],
    [path, { headers: { "X-FolioView-Authority-Delegation": "attacker" } }],
    [path, { headers: { "Idempotency-Key": "original_operation_0001" } }],
  ])
    await assert.rejects(
      owner.value.requestPrivate("portfolio", route, owner.value.sessionKey, {
        ...options(),
        ...patch,
      }),
    );
  assert.equal(b.producerCalls().length, 1);
});
test("actual view boundary accepts only legal two-null hints empty sources and retained historical receipt epochs", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_view_owner");
  for (const value of [
    f.view("sync_required"),
    f.view("separate"),
    f.view("complete", true),
    f.view("complete", false, true),
  ]) {
    b.setUpstream(() => response(value));
    const r = await owner.value.requestPrivate(
      "portfolio",
      path,
      owner.value.sessionKey,
      options(),
    );
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), value);
  }
});
test("bad view metadata receipt cross-associations and nested fields fail the entire response rather than becoming hints", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_view_owner");
  for (const mutate of [
    (v) => (v.metadata.extra = "FORBIDDEN"),
    (v) => (v.metadata.sourceId = "foreign"),
    (v) => (v.metadata.sourceEpoch = 3),
    (v) => (v.metadata.revision = 2),
    (v) => (v.snapshot.receipt.vaultId = "foreign"),
    (v) => (v.snapshot.receipt.sourceEpoch = 3),
    (v) => (v.snapshot.receipt.sourceEpoch = 2),
    (v) => (v.snapshot.keyProofs.extra = "FORBIDDEN"),
    (v) => (v.snapshot.carrier.extra = "FORBIDDEN"),
    (v) => (v.snapshot.receipt.extra = "FORBIDDEN"),
    (v) => (v.snapshot = null),
    (v) => {
      v.mode = "separate";
      v.snapshot = null;
    },
    (v) => {
      v.snapshot = null;
      v.metadata.snapshotId = null;
    },
  ]) {
    const value = f.view();
    mutate(value);
    b.setUpstream(() => response(value));
    const r = await owner.value.requestPrivate(
      "portfolio",
      path,
      owner.value.sessionKey,
      options(),
    );
    assert.equal(r.status, 503);
    assert.ok(!JSON.stringify(await r.json()).includes("FORBIDDEN"));
  }
});
test("view request Root recipient key fields are closed before a browser credential or backend request is sent", async (t) => {
  const b = await stack();
  t.after(() => b.close());
  const owner = b.mount();
  await owner.login("synthetic_view_owner");
  for (const mutate of [
    (v) => (v.expected.rootJwk.d = "FORBIDDEN"),
    (v) => (v.expected.resourceRef.resourceId = "other_source"),
    (v) => v.expected.recipientKeyIds.reverse(),
    (v) => v.expected.recipientKeyIds.push(v.expected.recipientKeyIds[0]),
    (v) => (v.expected.checkpointDigest = "bad"),
    (v) => (v.expected.registrySequence = 0),
  ]) {
    const value = f.request();
    mutate(value);
    await assert.rejects(
      owner.value.requestPrivate("portfolio", path, owner.value.sessionKey, {
        ...options(),
        json: value,
      }),
    );
  }
  assert.equal(b.producerCalls().length, 0);
});
