const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createHarness,
  createOwner,
  importHoldings,
  createTask,
  enroll,
  prepare,
  install,
  beginRun,
  ownerResult,
  report,
  fullFlow,
  decoded,
  clone,
} = require("./full-flow-crypto-fixture.cjs");

let h;
test.before(async () => {
  h = await createHarness();
});
test.after(async () => {
  if (h) await h.close();
});

const wire = (flow) => ({
  holdings: flow.holdings.pending.carrier,
  task: flow.task.pending.body,
  approval: flow.agent.approval,
  preparation: flow.prepared.sealed,
  begin: flow.frozen.begin,
  result: flow.packet,
});
const privateMarkers = [
  "SYNTH_PRIVATE_ACCOUNT_4821",
  "PRIVATE_SYNTHETIC_TFSA",
  "PRIVATE_GOAL_SYNTHETIC_RISK",
  "PRIVATE_WATCHLIST_ENTRY",
  "PRIVATE_YOUTUBE_FOLLOW",
  "PRIVATE_FOLLOW_NOTE",
  "PRIVATE_REPORT_initial",
  "PRIVATE_SUMMARY_SYNTHETIC",
  "PRIVATE_BODY:",
];

test("CSV → three resources → both task templates → approved helper → encrypted report → owner Inbox uses the actual crypto modules", async () => {
  for (const template of ["brief", "custom"]) {
    const flow = await fullFlow(h, { template, uid: "synthetic_owner_" + template });
    assert.equal(flow.holdings.preview.stats.positions, 1);
    assert.equal(flow.holdings.preview.stats.totals.CAD, "175.25");
    const holdings = await flow.f.session.openSnapshot(
      flow.holdings.response,
      flow.holdings.source,
    );
    assert.equal(holdings.data.accounts[0].positions[0].quantity, "12.5");
    assert.equal(holdings.data.accounts[0].balances[0].cashBalance, "50.25");
    assert.equal(holdings.sourceAsOf, null);
    assert.equal(JSON.stringify(flow.holdings.preview).includes(privateMarkers[0]), false);
    assert.equal((await flow.f.session.openTask(flow.task.task)).template, template);
    assert.deepEqual(
      flow.inputs.slice(1).map((row) => row.payload.data.kind),
      ["holdings", "watchlist", "channel_follows"],
    );
    assert.equal(flow.inputs[0].payload.template, template);
    assert.equal(flow.inputs[1].payload.data.accounts[0].positions[0].marketValue.amount, "125");
    assert.equal(
      flow.inputs[3].payload.data.readableMaterialCount,
      0,
      "a YouTube follow is context metadata, not fetched video content",
    );
    assert.deepEqual(await flow.f.session.openResult(flow.result), flow.content);
    for (const marker of privateMarkers)
      assert.equal(JSON.stringify(wire(flow)).includes(marker), false, marker);
    const command = await flow.f.session.signResultState({
      metadata: flow.result.result.metadata,
      changes: { read: true, starred: true, archived: false },
    });
    assert.deepEqual(decoded(command.command).parameters, {
      read: true,
      starred: true,
      archived: false,
    });
    assert.equal(decoded(command.command).targetId, flow.packet.resultId);
    await h.jose.flattenedVerify(
      command.command,
      await h.jose.importJWK(flow.f.session.device.sigJwk, "ES256"),
      { algorithms: ["ES256"] },
    );
  }
});

test("CSV unknown valuation/account coverage blocks strict task execution until the owner explicitly permits both limitations", async () => {
  for (const [policy, expected] of [
    [
      { allowPartial: false, allowUnknownAsOf: false, maxFetchedAgeSeconds: 86400 },
      "input_policy_partial",
    ],
    [
      { allowPartial: true, allowUnknownAsOf: false, maxFetchedAgeSeconds: 86400 },
      "input_policy_asof",
    ],
  ]) {
    const f = await createOwner(h),
      holdings = await importHoldings(h, f);
    const task = await createTask(h, f, { content: { inputPolicy: policy } });
    const agent = await enroll(h, f, task.task),
      prepared = await prepare(h, f, task.task, agent, holdings);
    const inputs = await install(f, agent, prepared);
    assert.equal(inputs[1].payload.sourceAsOf, null);
    assert.notEqual(inputs[1].payload.coverage.state, "complete");
    assert.deepEqual(inputs[0].payload.inputPolicy, policy);
    await assert.rejects(
      agent.call("beginRun", { stableOperationId: "synthetic_strict_policy_operation" }),
      (error) => error.code === expected,
    );
    await assert.rejects(
      agent.call("resultOutbox", {
        runId: "run_not_created",
        stableOperationId: "synthetic_strict_policy_operation",
      }),
      /result_operation_not_found/,
    );
  }
});

test("later watchlist and task edits cannot replace frozen pages; the actual helper rejects new signed bytes and consumes the original Run", async () => {
  const f = await createOwner(h),
    holdings = await importHoldings(h, f),
    task = await createTask(h, f);
  const agent = await enroll(h, f, task.task),
    prepared = await prepare(h, f, task.task, agent, holdings);
  await install(f, agent, prepared);
  const frozen = await beginRun(h, f, agent, prepared, "synthetic_frozen_before_edits", {
    consume: false,
  });
  const frozenBytes = h.core.canonical(frozen.response.manifest),
    originalSources = clone(prepared.sources);
  const updated = await createTask(h, f, {
    current: task.task,
    content: { ...task.content, goal: "PRIVATE_CHANGED_GOAL_AFTER_RUN" },
  });
  prepared.sources
    .find((s) => s.kind === "watchlist")
    .response.items.push({
      symbol: "AFTER",
      name: "Private later addition",
      instrumentType: "stock",
      currency: "USD",
      addedAt: "1970-01-01T00:16:40.000Z",
    });
  prepared.sources.find((s) => s.kind === "watchlist").revision = 2;
  assert.equal(updated.task.metadata.taskVersion, 2);
  await assert.rejects(
    f.session.sealAgentPreparation({
      intent: prepared.intent,
      task: updated.task,
      signedGrant: agent.approval.signedGrants[0],
      sources: prepared.sources,
    }),
  );
  // A different valid owner-signed encryption of the original selected copy is
  // still not the frozen operation. This candidate is never published by a server.
  const candidate = await f.session.sealAgentPreparation({
    intent: prepared.intent,
    task: task.task,
    signedGrant: agent.approval.signedGrants[0],
    sources: originalSources,
  });
  const runId = frozen.response.run.runId,
    changedTaskPage = clone(frozen.pages[0]);
  changedTaskPage.component.signedObject = updated.task.signedObject;
  await assert.rejects(
    agent.call("decryptRun", { runId, page: changedTaskPage }),
    /component_fingerprint_mismatch/,
  );
  const inputs = [];
  inputs.push(await agent.call("decryptRun", { runId, page: frozen.pages[0] }));
  inputs.push(await agent.call("decryptRun", { runId, page: frozen.pages[1] }));
  const changedWatchlistPage = clone(frozen.pages[2]);
  changedWatchlistPage.component.signedObject = candidate.objects.find(
    (v) => v.objectId === changedWatchlistPage.component.objectId,
  ).envelope.signedObject;
  await assert.rejects(
    agent.call("decryptRun", { runId, page: changedWatchlistPage }),
    /component_fingerprint_mismatch/,
  );
  inputs.push(await agent.call("decryptRun", { runId, page: frozen.pages[2] }));
  inputs.push(await agent.call("decryptRun", { runId, page: frozen.pages[3] }));
  assert.equal(inputs[0].payload.goal, task.content.goal);
  assert.deepEqual(
    inputs[2].payload.data.items.map((v) => v.symbol),
    ["SYNTH"],
  );
  assert.deepEqual(agent.grant.taskVersions, [1]);
  assert.deepEqual(
    agent.grant.resourceBindings.find((b) => b.ref.kind === "watchlist").selectedVersions,
    [1],
  );
  assert.equal(h.core.canonical(frozen.response.manifest), frozenBytes);
  const packet = await agent.call("sealResult", {
    runId,
    stableOperationId: "synthetic_result_after_source_edits",
    content: report("frozen"),
  });
  const result = await ownerResult(h, f, agent, frozen, packet);
  await agent.call(
    "acceptReceipt",
    { runId, stableOperationId: packet.stableOperationId, receipt: result.evidence.receipt },
    true,
  );
  assert.deepEqual(await f.session.openResult(result), report("frozen"));
  assert.equal(result.evidence.manifest.taskVersion, 1);
  assert.equal(JSON.stringify(result).includes("PRIVATE_CHANGED_GOAL_AFTER_RUN"), false);
});

test("A/B vaults and same-owner A1/A2 helpers cannot decrypt one another's approved resources or result ciphertext", async () => {
  const a = await fullFlow(h),
    b = await fullFlow(h, { uid: "synthetic_owner_B", connectionId: "connection_B1" });
  await assert.rejects(b.f.session.openSnapshot(a.holdings.response, a.holdings.source));
  await assert.rejects(b.f.session.openTask(a.task.task));
  await assert.rejects(b.f.session.openResult(a.result));
  await assert.rejects(a.f.session.openResult(b.result));
  await assert.rejects(
    b.f.session.openAgentPending({
      kind: "preparation",
      record: a.prepared.sealed.localPending,
      connectionId: a.agent.grant.connectionId,
      taskId: a.agent.grant.taskId,
    }),
  );
  const a2 = await enroll(h, a.f, a.task.task, "connection_A2"),
    prepared2 = await prepare(h, a.f, a.task.task, a2, a.holdings);
  await install(a.f, a2, prepared2);
  const a1Task = a.prepared.sealed.objects.find((v) => v.objectId === a.task.task.metadata.taskId);
  const a2Task = prepared2.sealed.objects.find((v) => v.objectId === a.task.task.metadata.taskId);
  await assert.rejects(
    a2.call("decrypt", { objectId: a1Task.objectId, envelope: a1Task.envelope }),
    /component_fingerprint_mismatch/,
  );
  await assert.rejects(
    a.agent.call("decrypt", { objectId: a2Task.objectId, envelope: a2Task.envelope }),
    /component_fingerprint_mismatch/,
  );
  await assert.rejects(
    b.agent.call("decrypt", { objectId: a1Task.objectId, envelope: a1Task.envelope }),
    /component_fingerprint_mismatch/,
  );
  const recipients = decoded(a.packet.envelope.signedObject).context.recipients.map(
    (row) => row.keyId,
  );
  assert.equal(recipients.includes(a.agent.offer.agentEncryptionKeyId), false);
  assert.equal(recipients.includes(a2.offer.agentEncryptionKeyId), false);
  await assert.rejects(
    a2.call("decrypt", { objectId: a.packet.resultId, envelope: a.packet.envelope }),
    /object_not_authorized/,
  );
  assert.deepEqual(
    await a.f.session.openResult(a.result),
    a.content,
    "A2 enrollment does not invalidate legitimate A1 historical result evidence",
  );
});

test("revoking A1's current key directory stops its future work while A2 and historical owner reading continue", async () => {
  const a = await fullFlow(h),
    a2 = await enroll(h, a.f, a.task.task, "connection_A2");
  const prepared2 = await prepare(h, a.f, a.task.task, a2, a.holdings);
  await install(a.f, a2, prepared2);
  const frozen2 = await beginRun(h, a.f, a2, prepared2);
  const revoked = [a.agent.offer.agentSigningKeyId, a.agent.offer.agentEncryptionKeyId];
  const entries = a.f.vault.registryHistory.at(-1).entries.map((row) => ({
    ...row,
    active: !revoked.includes(decoded(row.certificate).keyId) && row.active,
  }));
  const bundle = await a.f.session.bundle(entries, a.f.session.registry),
    checkpoint = decoded(bundle.checkpoint);
  checkpoint.revokedKeyIds = [...new Set([...checkpoint.revokedKeyIds, ...revoked])].sort();
  const signed = await new h.jose.FlattenedSign(
    new TextEncoder().encode(h.core.canonical(checkpoint)),
  )
    .setProtectedHeader({
      alg: "ES256",
      kid: a.f.vault.rootKeyId,
      typ: "fv-control+jws",
      cty: "application/json",
    })
    .sign(a.f.session.root);
  bundle.checkpoint = {
    protected: signed.protected,
    payload: signed.payload,
    signature: signed.signature,
  };
  a.f.vault = {
    ...a.f.vault,
    version: a.f.vault.version + 1,
    registryHistory: [...a.f.vault.registryHistory, bundle],
  };
  await a.f.session.acceptResultVault(a.f.vault);
  await assert.rejects(
    a.agent.call("registry", { bundles: a.f.vault.registryHistory }),
    /key_revoked|certificate_revoked|key_unavailable/,
  );
  await assert.rejects(
    a.agent.call("beginRun", { stableOperationId: "synthetic_revoked_future_begin" }),
  );
  await a2.call("registry", { bundles: a.f.vault.registryHistory });
  const packet2 = await a2.call("sealResult", {
    runId: frozen2.response.run.runId,
    stableOperationId: "synthetic_A2_after_A1_revocation",
    content: report("A2"),
  });
  assert.deepEqual(
    await a.f.session.openResult(await ownerResult(h, a.f, a2, frozen2, packet2)),
    report("A2"),
  );
  assert.deepEqual(await a.f.session.openResult(a.result), a.content);
});

test("lost-save recovery reuses original ciphertext and revisions require a trusted matching receipt", async () => {
  const flow = await fullFlow(h),
    runId = flow.packet.runId,
    stableOperationId = flow.packet.stableOperationId;
  const original = JSON.stringify(flow.packet);
  assert.equal(
    JSON.stringify(
      await flow.agent.call("sealResult", { runId, stableOperationId, content: flow.content }),
    ),
    original,
  );
  const outbox = await flow.agent.call("resultOutbox", { runId, stableOperationId });
  assert.equal(outbox.receipt, null);
  const { receipt, ...pending } = outbox;
  assert.equal(JSON.stringify(pending), original);
  await assert.rejects(
    flow.agent.call("sealResult", {
      runId,
      stableOperationId,
      content: report("changed_same_operation"),
    }),
    /idempotency_conflict/,
  );
  await assert.rejects(
    flow.agent.call("reviseResult", {
      runId,
      stableOperationId: "synthetic_revision_before_receipt",
      expectedRevision: 1,
      content: report("revision"),
    }),
    /revision_base_unacknowledged/,
  );
  await assert.rejects(
    flow.agent.call("acceptReceipt", {
      runId,
      stableOperationId,
      receipt: flow.result.evidence.receipt,
    }),
    /unsupported_operation/,
  );
  await assert.rejects(
    flow.agent.call(
      "acceptReceipt",
      {
        runId,
        stableOperationId,
        receipt: { ...flow.result.evidence.receipt, envelopeFingerprint: "0".repeat(64) },
      },
      true,
    ),
    /receipt_binding_mismatch/,
  );
  await flow.agent.call(
    "acceptReceipt",
    { runId, stableOperationId, receipt: flow.result.evidence.receipt },
    true,
  );
  const revised = await flow.agent.call("reviseResult", {
    runId,
    stableOperationId: "synthetic_revision_after_receipt",
    expectedRevision: 1,
    content: report("revision"),
  });
  const version2 = await ownerResult(h, flow.f, flow.agent, flow.frozen, revised);
  assert.equal(version2.result.metadata.revision, 2);
  assert.deepEqual(await flow.f.session.openResult(version2), report("revision"));
  assert.deepEqual(await flow.f.session.openResult(flow.result), flow.content);
  assert.equal(
    JSON.stringify(
      await flow.agent.call("sealResult", { runId, stableOperationId, content: flow.content }),
    ),
    original,
  );
});

test("a fresh locked owner context requires the original PRF material; identity alone or another user's material cannot restore plaintext", async () => {
  const flow = await fullFlow(h),
    other = await createOwner(h, "synthetic_owner_B"),
    bytes = JSON.stringify(flow.result);
  const locked = new h.core.VaultCore(flow.f.uid, flow.f.now);
  await assert.rejects(locked.openResult(flow.result), /locked/);
  await assert.rejects(locked.openSnapshot(flow.holdings.response, flow.holdings.source), /locked/);
  await assert.rejects(locked.unlock(flow.f.vault, other.material(), flow.f.local));
  const wrong = flow.f.material();
  wrong.secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
  await assert.rejects(
    new h.core.VaultCore(flow.f.uid, flow.f.now).unlock(flow.f.vault, wrong, flow.f.local),
  );
  await locked.unlock(flow.f.vault, flow.f.material(), flow.f.local);
  await locked.acceptVault(flow.f.vault);
  assert.deepEqual(await locked.openResult(flow.result), flow.content);
  assert.equal((await locked.openTask(flow.task.task)).name, flow.task.content.name);
  assert.equal(
    (await locked.openSnapshot(flow.holdings.response, flow.holdings.source)).data.accounts[0]
      .positions[0].quantity,
    "12.5",
  );
  assert.equal(
    JSON.stringify(flow.result),
    bytes,
    "relogin reads the original saved bytes without importing or encrypting again",
  );
  const missingArchive = clone(flow.f.vault);
  missingArchive.archive = null;
  await assert.rejects(
    new h.core.VaultCore(flow.f.uid, flow.f.now).unlock(missingArchive, flow.f.material()),
  );
  await flow.agent.call("lock");
  await assert.rejects(
    flow.agent.call("decrypt", {
      objectId: flow.task.task.metadata.taskId,
      envelope: flow.prepared.sealed.objects[0].envelope,
    }),
  );
  assert.deepEqual(
    await locked.openResult(flow.result),
    flow.content,
    "stopping an agent never removes the owner's retained historical report key",
  );
});

test("tampered report bytes, swapped public keys, wrong receipt and mismatched frozen manifests never become Inbox plaintext", async () => {
  const flow = await fullFlow(h),
    original = JSON.stringify(flow.result);
  for (const mutate of [
    (value) => {
      value.result.signedObject.signature = "A".repeat(86);
    },
    (value) => {
      value.evidence.receipt.envelopeFingerprint = "0".repeat(64);
    },
    (value) => {
      value.evidence.manifest.entries[0].revision = 2;
    },
    (value) => {
      value.evidence.provenance.connectionId = "connection_A2";
    },
    (value) => {
      value.result.metadata.resultId = "result_foreign";
    },
    (value) => {
      value.registryBundles[0].entries[0].certificate = value.evidence.agentKeyGrant;
    },
  ]) {
    const changed = clone(flow.result);
    mutate(changed);
    await assert.rejects(flow.f.session.openResult(changed));
  }
  const other = await createOwner(h, "synthetic_foreign_key_owner");
  const replaced = clone(flow.result);
  replaced.result.keyProofs = {
    checkpoint: other.vault.registryHistory[0].checkpoint,
    certificates: other.vault.registryHistory[0].entries.map((e) => e.certificate),
  };
  await assert.rejects(flow.f.session.openResult(replaced));
  assert.equal(JSON.stringify(flow.result), original);
  assert.deepEqual(await flow.f.session.openResult(flow.result), flow.content);
});
