const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createHarness,
  createOwner,
  importHoldings,
  createTask,
  fullFlow,
} = require("./full-flow-crypto-fixture.cjs");
const {
  stack,
  response,
  failure,
  settle,
  deferred,
  HUB,
  PORTFOLIO,
  USER,
  CONFIG,
  MARKET,
  CONTRACT,
} = require("./full-flow-boundaries-helpers.cjs");

function request(owner, service, route, options) {
  return owner.value.requestPrivate(service, route, owner.value.sessionKey, options);
}
function write(packet) {
  return { "Idempotency-Key": packet.operationId, "X-FolioView-Author-Key": packet.authorKeyId };
}
function catalogue(flow) {
  return {
    contractVersion: CONTRACT,
    profile: "folioview.owner-resource-discovery.v1",
    readAt: "2026-10-30T12:00:00Z",
    groups: flow.task.task.metadata.resourceBindings.map((binding) => ({
      kind: binding.ref.kind,
      sourceService: binding.ref.sourceService,
      status: "available",
      items: [
        {
          ref: binding.ref,
          revision: 1,
          sourceEpoch: binding.sourceEpoch,
          state: binding.ref.kind === "holdings" ? "active" : "ready",
          snapshotId: binding.ref.kind === "holdings" ? flow.holdings.pending.snapshotId : null,
          updatedAt: null,
          encryptedEvidence: binding.ref.kind === "holdings" ? "not_checked" : "not_prepared",
        },
      ],
    })),
  };
}

test("one signed browser session crosses both actual Next forwarders from CSV ciphertext through prepared resources to decrypted Inbox", async (t) => {
  const crypto = await createHarness();
  t.after(() => crypto.close());
  const flow = await fullFlow(crypto, {
    uid: "synthetic_boundary_owner_A",
    connectionId: "connection_boundary_A1",
  });
  const boundary = await stack();
  t.after(() => boundary.close());
  const owner = boundary.mount();
  await owner.login(flow.f.uid);
  assert.equal(owner.value.status, "authenticated");
  const writes = [];
  const resultId = flow.packet.resultId,
    taskId = flow.task.pending.taskId;
  const snapshotPath = `/api/v2/holdings/sources/${flow.holdings.source.resourceRef.resourceId}/snapshots/${flow.holdings.pending.snapshotId}`;
  const preparationPath = `/api/v2/agent-connections/${flow.agent.grant.connectionId}/tasks/${taskId}/preparation`;
  const committed = {
    contractVersion: CONTRACT,
    profile: "folioview.agent-preparation.v1",
    preparationId: flow.prepared.intent.preparationId,
    status: "committed",
    objects: flow.prepared.metadata.objects,
  };
  const statePacket = await flow.f.session.signResultState({
    metadata: flow.result.result.metadata,
    changes: { read: true, starred: true },
  });
  const updatedState = {
    ...flow.result.result.metadata,
    read: true,
    starred: true,
    stateVersion: flow.result.result.metadata.stateVersion + 1,
  };
  boundary.setUpstream((url, init) => {
    const path = new URL(url).pathname;
    if (init.body)
      writes.push({
        path,
        raw: new TextDecoder().decode(init.body),
        headers: new Headers(init.headers),
      });
    if (path === "/api/v2/vaults/current")
      return response({ contractVersion: CONTRACT, vault: flow.f.vault, sources: [] });
    if (path === "/api/v2/resources/catalogue") return response(catalogue(flow));
    if (url === PORTFOLIO + snapshotPath) return response(flow.holdings.response);
    if (path === "/api/v2/tasks" && init.method === "POST") return response(flow.task.task, 201);
    if (path === preparationPath + "/commit") return response(committed);
    if (path.startsWith(preparationPath + "/objects/"))
      return response(committed.objects.find((row) => row.objectId === path.split("/").at(-1)));
    if (path === "/api/v2/results")
      return response({
        contractVersion: CONTRACT,
        items: [flow.result.result.metadata],
        nextCursor: null,
      });
    if (path === `/api/v2/results/${resultId}/state`) return response(updatedState);
    if (path === `/api/v2/results/${resultId}/revisions/1/evidence`)
      return response(flow.result.evidence);
    if (path === `/api/v2/results/${resultId}`) return response(flow.result.result);
    assert.fail("Unselected synthetic producer route " + path);
  });

  assert.equal((await request(owner, "agent-hub", "/api/v2/vaults/current")).status, 200);
  const resources = await (await request(owner, "agent-hub", "/api/v2/resources/catalogue")).json();
  assert.deepEqual(
    resources.groups.map((row) => row.kind),
    ["holdings", "watchlist", "channel_follows"],
  );
  const snapshotBody = {
    contractVersion: CONTRACT,
    expectedRevision: flow.holdings.pending.expectedRevision,
    carrier: flow.holdings.pending.carrier,
  };
  const saved = await request(owner, "portfolio", snapshotPath, {
    method: "PUT",
    headers: write(flow.holdings.pending),
    json: snapshotBody,
  });
  assert.equal(saved.status, 200);
  const snapshot = await saved.json();
  assert.deepEqual(
    await flow.f.session.openSnapshot(snapshot, flow.holdings.source),
    flow.holdings.preview.resourceContent,
  );
  const task = await request(owner, "agent-hub", "/api/v2/tasks", {
    method: "POST",
    headers: write(flow.task.pending),
    json: flow.task.pending.body,
  });
  assert.equal(task.status, 201);
  assert.deepEqual(await flow.f.session.openTask(await task.json()), flow.task.content);
  for (const packet of flow.prepared.sealed.objects) {
    const staged = await request(
      owner,
      "agent-hub",
      preparationPath + "/objects/" + packet.objectId,
      {
        method: "PUT",
        headers: write(packet),
        json: { contractVersion: CONTRACT, envelope: packet.envelope },
      },
    );
    assert.equal(staged.status, 200);
    assert.equal((await staged.json()).envelopeFingerprint, packet.envelopeFingerprint);
  }
  const commitPacket = flow.prepared.sealed.commit;
  const commit = await request(owner, "agent-hub", preparationPath + "/commit", {
    method: "POST",
    headers: { "Idempotency-Key": commitPacket.operationId },
    json: commitPacket.body,
  });
  assert.deepEqual(await commit.json(), committed);
  const index = await (
    await request(owner, "agent-hub", "/api/v2/results?filter=unread&limit=50")
  ).json();
  assert.equal(index.items[0].resultId, resultId);
  const result = await (
    await request(owner, "agent-hub", `/api/v2/results/${resultId}?revision=1&deliveryRevision=1`)
  ).json();
  const evidence = await (
    await request(owner, "agent-hub", `/api/v2/results/${resultId}/revisions/1/evidence`)
  ).json();
  assert.deepEqual(
    await flow.f.session.openResult({
      result,
      evidence,
      registryBundles: flow.result.registryBundles,
    }),
    flow.content,
  );
  const marked = await request(owner, "agent-hub", `/api/v2/results/${resultId}/state`, {
    method: "PATCH",
    headers: write(statePacket),
    json: { contractVersion: CONTRACT, command: statePacket.command },
  });
  assert.deepEqual(await marked.json(), updatedState);

  const ownerToken = await boundary.token(flow.f.uid);
  for (const call of boundary.producerCalls()) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("authorization"), "Bearer " + ownerToken);
    assert.equal(
      headers.get("x-serverless-authorization"),
      call.url.startsWith(PORTFOLIO) ? "Bearer " + boundary.serviceToken : null,
    );
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("origin"), null);
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.redirect, "manual");
  }
  const expected = [
    snapshotBody,
    flow.task.pending.body,
    ...flow.prepared.sealed.objects.map((row) => ({
      contractVersion: CONTRACT,
      envelope: row.envelope,
    })),
    commitPacket.body,
    { contractVersion: CONTRACT, command: statePacket.command },
  ];
  assert.equal(writes.length, expected.length);
  assert.deepEqual(
    writes.map((row) => row.raw),
    expected.map((row) => JSON.stringify(row)),
    "No server reserialization or cipher regeneration",
  );
  assert.deepEqual(
    writes.map((row) => row.headers.get("idempotency-key")),
    [
      flow.holdings.pending.operationId,
      flow.task.pending.operationId,
      ...flow.prepared.sealed.objects.map((row) => row.operationId),
      commitPacket.operationId,
      statePacket.operationId,
    ],
  );
  const encryptedWire = JSON.stringify(
    boundary.browser
      .filter((row) => row.url.startsWith("/api/private/"))
      .map((row) => ({ url: row.url, body: row.init.body })),
  );
  for (const marker of [
    "PRIVATE_SYNTHETIC_TFSA",
    "SYNTH_PRIVATE_ACCOUNT_4821",
    "PRIVATE_GOAL_SYNTHETIC_RISK",
    "PRIVATE_WATCHLIST_ENTRY",
    "PRIVATE_FOLLOW_NOTE",
    flow.content.title,
    flow.content.summary,
    flow.content.sections[0].markdown,
  ])
    assert.ok(!encryptedWire.includes(marker), marker);
  assert.equal(boundary.logs.length, 0, "Actual auth and forwarders emitted no private logs");
  assert.ok(
    boundary.browser.every((row) => !row.url.startsWith(HUB) && !row.url.startsWith(PORTFOLIO)),
  );
});

test("shared real forwarders keep two owners distinct while a canceled or late request cannot cross an Auth session", async (t) => {
  const crypto = await createHarness();
  t.after(() => crypto.close());
  const fa = await createOwner(crypto, "synthetic_boundary_A"),
    fb = await createOwner(crypto, "synthetic_boundary_B");
  const importedA = await importHoldings(crypto, fa),
    importedB = await importHoldings(crypto, fb);
  const boundary = await stack();
  t.after(() => boundary.close());
  const a = boundary.mount(),
    b = boundary.mount();
  await a.login("synthetic_boundary_A");
  await b.login("synthetic_boundary_B");
  const delayed = deferred();
  let delayA = false;
  boundary.setUpstream((url, init) => {
    const uid = boundary.subject(init);
    if (url.startsWith(PORTFOLIO))
      return response(uid === fa.uid ? importedA.response : importedB.response);
    if (delayA && uid === "synthetic_boundary_A") return delayed.promise;
    return response({
      contractVersion: CONTRACT,
      profile: "folioview.owner-result-counts.v1",
      asOf: "2026-10-30T12:00:00Z",
      counts: {
        all: uid.endsWith("A") ? 1 : 2,
        unread: 0,
        starred: 0,
        archived: 0,
        total: uid.endsWith("A") ? 1 : 2,
      },
    });
  });
  const samePath = `/api/v2/holdings/sources/${importedA.source.resourceRef.resourceId}/snapshots/${importedA.pending.snapshotId}`;
  const [replyA, replyB] = await Promise.all([
    request(a, "portfolio", samePath),
    request(b, "portfolio", samePath),
  ]);
  const [cipherA, cipherB] = await Promise.all([replyA.json(), replyB.json()]);
  assert.deepEqual(
    await fa.session.openSnapshot(cipherA, importedA.source),
    importedA.preview.resourceContent,
  );
  assert.deepEqual(
    await fb.session.openSnapshot(cipherB, importedB.source),
    importedB.preview.resourceContent,
  );
  await assert.rejects(fa.session.openSnapshot(cipherB, importedB.source));
  const portfolioCalls = boundary.producerCalls().filter((row) => row.url.startsWith(PORTFOLIO));
  assert.equal(portfolioCalls.length, 2);
  assert.notEqual(
    new Headers(portfolioCalls[0].init.headers).get("authorization"),
    new Headers(portfolioCalls[1].init.headers).get("authorization"),
  );
  for (const row of portfolioCalls)
    assert.equal(
      new Headers(row.init.headers).get("x-serverless-authorization"),
      "Bearer " + boundary.serviceToken,
    );
  assert.equal(
    boundary.network.filter((row) => row.url.startsWith("http://metadata.google.internal/")).length,
    1,
    "A shared service-token flight does not replace either owner's Firebase identity",
  );
  assert.equal(
    (await (await request(a, "agent-hub", "/api/v2/results/counts")).json()).counts.total,
    1,
  );
  assert.equal(
    (await (await request(b, "agent-hub", "/api/v2/results/counts")).json()).counts.total,
    2,
  );
  delayA = true;
  const oldKey = a.value.sessionKey;
  const pending = request(a, "agent-hub", "/api/v2/results/counts");
  const rejected = assert.rejects(pending, { name: "SessionChangedError" });
  await settle();
  await a.login("synthetic_boundary_B");
  delayed.resolve(failure("invalid_token", 401));
  await rejected;
  assert.equal(a.value.status, "authenticated");
  assert.equal(a.value.profile.uid, "synthetic_boundary_B");
  assert.notEqual(a.value.sessionKey, oldKey);
  assert.equal(
    (await (await request(a, "agent-hub", "/api/v2/results/counts")).json()).counts.total,
    2,
  );
  const pendingToken = deferred();
  a.auth.currentUser.getIdToken = () => pendingToken.promise;
  const before = boundary.producerCalls().length;
  const controller = new AbortController();
  const canceled = request(a, "agent-hub", "/api/v2/results/counts", { signal: controller.signal });
  const canceledAssertion = assert.rejects(canceled, { name: "SessionChangedError" });
  controller.abort();
  pendingToken.resolve(await boundary.token("synthetic_boundary_B"));
  await canceledAssertion;
  assert.equal(boundary.producerCalls().length, before);
  await a.value.signOut();
  await assert.rejects(a.value.requestPrivate("agent-hub", "/api/v2/results/counts", oldKey), {
    name: "SessionChangedError",
  });
  assert.equal(a.value.profile, null);
  assert.equal(b.value.profile.uid, "synthetic_boundary_B");
  assert.equal(boundary.logs.length, 0);
});

test("IAM, malformed upstream and version conflicts stay service failures, preserve exact retry bytes and never sign the owner out", async (t) => {
  const crypto = await createHarness();
  t.after(() => crypto.close());
  const f = await createOwner(crypto, "synthetic_boundary_recovery"),
    imported = await importHoldings(crypto, f),
    task = await createTask(crypto, f);
  const boundary = await stack();
  t.after(() => boundary.close());
  const owner = boundary.mount();
  await owner.login(f.uid);
  const snapshotPath = `/api/v2/holdings/sources/${imported.source.resourceRef.resourceId}/snapshots/${imported.pending.snapshotId}`;
  const body = {
    contractVersion: CONTRACT,
    expectedRevision: 0,
    carrier: imported.pending.carrier,
  };
  boundary.metadataStatus(403);
  assert.equal(
    (
      await request(owner, "portfolio", snapshotPath, {
        method: "PUT",
        headers: write(imported.pending),
        json: body,
      })
    ).status,
    503,
  );
  assert.equal(boundary.producerCalls().length, 0);
  assert.equal(owner.value.profile.uid, f.uid);
  boundary.metadataStatus(200);
  let scenario = "iam";
  boundary.setUpstream((url) => {
    if (scenario === "iam")
      return new Response("PRIVATE_UPSTREAM_TOKEN_AND_ACCOUNT", {
        status: 403,
        headers: { "Content-Type": "text/html", "Set-Cookie": "forbidden=private" },
      });
    if (scenario === "saved") return response(imported.response);
    if (scenario === "conflict") return failure("version_conflict");
    if (scenario === "plainLeak")
      return response({
        contractVersion: CONTRACT,
        items: [],
        nextCursor: null,
        privateSummary: "PRIVATE_UNEXPECTED_REPORT",
      });
    return response({ contractVersion: CONTRACT, items: [], nextCursor: null });
  });
  const failed = await request(owner, "portfolio", snapshotPath, {
    method: "PUT",
    headers: write(imported.pending),
    json: body,
  });
  assert.equal(failed.status, 503);
  const safe = await failed.text();
  assert.ok(!safe.includes("PRIVATE_UPSTREAM"));
  assert.equal(failed.headers.get("set-cookie"), null);
  assert.equal(owner.value.status, "authenticated");
  scenario = "saved";
  assert.deepEqual(
    await (
      await request(owner, "portfolio", snapshotPath, {
        method: "PUT",
        headers: write(imported.pending),
        json: body,
      })
    ).json(),
    imported.response,
  );
  const snapshots = boundary.producerCalls().filter((row) => row.url === PORTFOLIO + snapshotPath);
  assert.equal(snapshots.length, 2, "The failed write was not automatically repeated");
  assert.equal(
    new TextDecoder().decode(snapshots[0].init.body),
    new TextDecoder().decode(snapshots[1].init.body),
  );
  assert.equal(
    new Headers(snapshots[0].init.headers).get("idempotency-key"),
    new Headers(snapshots[1].init.headers).get("idempotency-key"),
  );
  scenario = "conflict";
  const conflicted = await request(owner, "agent-hub", "/api/v2/tasks", {
    method: "POST",
    headers: write(task.pending),
    json: task.pending.body,
  });
  assert.equal(conflicted.status, 409);
  assert.equal((await conflicted.json()).error.code, "version_conflict");
  scenario = "plainLeak";
  const privateReply = await request(owner, "agent-hub", "/api/v2/results");
  assert.equal(privateReply.status, 503);
  assert.ok(!(await privateReply.text()).includes("PRIVATE_UNEXPECTED_REPORT"));
  scenario = "healthy";
  assert.equal((await request(owner, "agent-hub", "/api/v2/results")).status, 200);
  assert.equal(owner.value.profile.uid, f.uid);
  assert.equal(boundary.logs.length, 0);
});

test("disabling private capabilities or attempting an agent/internal escape never obtains a token or redirects User and Config to Market", async (t) => {
  const boundary = await stack({
    env: { FOLIOVIEW_PORTFOLIO_OWNER_ENABLED: "false", FOLIOVIEW_HUB_OWNER_ENABLED: "false" },
  });
  t.after(() => boundary.close());
  const owner = boundary.mount();
  await owner.login("synthetic_boundary_disabled");
  let retrievals = 0;
  const actual = owner.auth.currentUser.getIdToken;
  owner.auth.currentUser.getIdToken = () => {
    retrievals++;
    return actual();
  };
  assert.equal(owner.value.portfolioConfigured, false);
  assert.equal(owner.value.agentHubConfigured, false);
  await assert.rejects(
    request(owner, "portfolio", "/api/v2/holdings/sources/source_synthetic"),
    /not configured/,
  );
  await assert.rejects(
    request(owner, "agent-hub", "/api/v2/resources/catalogue"),
    /not configured/,
  );
  for (const route of [
    "/internal/v2/source-fences",
    "/oauth/token",
    "/agent/v2/results",
    "/api/v2/agent-authorizations/request_synthetic/decision",
    "/api/v2/tasks?owner=other",
    "/api/v2/tasks%2fprivate",
  ])
    await assert.rejects(request(owner, "agent-hub", route), /Invalid private API path/);
  assert.equal(retrievals, 0);
  assert.equal(boundary.network.length, 0);
  assert.equal((await request(owner, "user", "/api/v1/watchlist")).status, 200);
  assert.equal((await request(owner, "config", "/api/v1/preferences")).status, 200);
  assert.equal(retrievals, 2);
  assert.ok(boundary.browser.some((row) => row.url.startsWith(USER)));
  assert.ok(boundary.browser.some((row) => row.url.startsWith(CONFIG)));
  assert.ok(boundary.browser.every((row) => !row.url.startsWith(MARKET)));
  assert.equal(owner.value.status, "authenticated");
});
