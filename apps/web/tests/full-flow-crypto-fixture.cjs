// Synthetic producer fixtures around the actual Web crypto and released agent helper.
// Metadata is not an HTTP authorization implementation or proof of a live Muse host.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { transformSync } = require("next/dist/build/swc");
const clone = (value) => structuredClone(value);
const decoded = (value) => JSON.parse(Buffer.from(value.payload, "base64url"));
const iso = (seconds) => new Date(seconds * 1000).toISOString();

async function createHarness() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-full-flow-crypto-"));
  const helpers = [];
  try {
    await fs.symlink(
      path.resolve(__dirname, "../../../node_modules"),
      path.join(directory, "node_modules"),
      "dir",
    );
    for (const name of [
      "encrypted-types",
      "encrypted-core",
      "holdings-csv",
      "task-types",
      "task-forms",
    ]) {
      const file = path.resolve(__dirname, "../lib/" + name + ".ts");
      let { code } = transformSync(readFileSync(file, "utf8"), {
        filename: file,
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "es6" },
      });
      code = code.replace(/from "\.\/([^"]+)"/g, (_, name) =>
        name.endsWith(".json") ? `from "./${name}" with { type: "json" }` : `from "./${name}.mjs"`,
      );
      code = code.replace('"ajv/dist/2020"', '"ajv/dist/2020.js"');
      await fs.writeFile(path.join(directory, name + ".mjs"), code);
    }
    await fs.copyFile(
      path.resolve(__dirname, "../lib/encrypted-schemas.json"),
      path.join(directory, "encrypted-schemas.json"),
    );
    const load = (name) => import(pathToFileURL(path.join(directory, name + ".mjs")).href);
    const core = await load("encrypted-core"),
      csv = await load("holdings-csv"),
      forms = await load("task-forms");
    const { ForegroundSession } = await import(
      pathToFileURL(
        path.resolve(__dirname, "../../../services/agent-hub-service/helper/dist/worker.mjs"),
      ).href
    );
    const jose = await import("jose");
    return {
      core,
      csv,
      forms,
      jose,
      helpers,
      ForegroundSession,
      async close() {
        for (const row of helpers.splice(0)) {
          try {
            await row.call("lock", {}, true);
          } catch {}
        }
        await fs.rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function createOwner(h, uid = "synthetic_owner_A") {
  let now = 1000;
  const secret = crypto.getRandomValues(new Uint8Array(32)),
    salt = h.core.b64(crypto.getRandomValues(new Uint8Array(32)));
  const material = () => ({
    credentialId: h.core.b64(new TextEncoder().encode("synthetic-full-flow-credential")),
    prfSalt: salt,
    secret: secret.slice().buffer,
  });
  const session = new h.core.VaultCore(uid, () => now),
    created = await session.beginCreate(material());
  const vault = {
    vaultId: created.vaultId,
    rootJwk: created.rootJwk,
    rootKeyId: created.rootKeyId,
    registryHistory: [created.registryBundle],
    archive: created.archive,
    version: 1,
  };
  const local = await session.acceptVault(vault);
  return {
    uid,
    session,
    vault,
    local,
    material,
    deliveryTails: new Map(),
    owner: await session.owner,
    now: () => now,
    time: (value) => {
      now = value;
    },
  };
}
function bindings() {
  return ["holdings", "watchlist", "channel_follows"].map((kind) => ({
    ref: {
      kind,
      sourceService: kind === "holdings" ? "portfolio" : "user",
      resourceId: "source_" + kind,
      incarnation: "incarnation_synthetic",
    },
    sourceEpoch: 1,
  }));
}
function keyProofs(f) {
  const bundle = f.vault.registryHistory.at(-1);
  return { checkpoint: bundle.checkpoint, certificates: bundle.entries.map((e) => e.certificate) };
}
async function importHoldings(h, f) {
  const columns = h.csv.WEALTHSIMPLE_HOLDINGS_HEADERS;
  const row = {
    "Account Name": "PRIVATE_SYNTHETIC_TFSA",
    "Account Type": "TFSA",
    "Account Classification": "individual",
    "Account Number": "SYNTH_PRIVATE_ACCOUNT_4821",
    Symbol: "SYNTH",
    Exchange: "Synthetic Exchange",
    MIC: "XSYN",
    Name: "Synthetic holding",
    "Security Type": "EQUITY",
    Quantity: "12.5",
    "Position Direction": "LONG",
    "Market Price": "10",
    "Market Price Currency": "CAD",
    "Book Value (CAD)": "100",
    "Book Value Currency (CAD)": "CAD",
    "Book Value (Market)": "100",
    "Book Value Currency (Market)": "CAD",
    "Market Value": "125",
    "Market Value Currency": "CAD",
    "Market Unrealized Returns": "25",
    "Market Unrealized Returns Currency": "CAD",
  };
  const cash = {
    ...row,
    Symbol: "CAD",
    Name: "Canadian dollars",
    "Security Type": "CURRENCY",
    Quantity: "50.25",
    "Market Price": "1",
    "Market Value": "50.25",
  };
  const text = [
    columns.join(","),
    ...[row, cash].map((value) => columns.map((key) => value[key]).join(",")),
  ].join("\r\n");
  const preview = await h.csv.parseHoldingsCsv({
    text,
    brokerId: "wealthsimple",
    ownerUid: f.uid,
    snapshotId: "snapshot_synthetic",
    importedAt: iso(f.now()),
  });
  const source = { resourceRef: bindings()[0].ref, sourceEpoch: 1 };
  const pending = await f.session.sealSnapshot({
    content: preview.resourceContent,
    source,
    expectedRevision: 0,
    snapshotId: "snapshot_synthetic",
  });
  const response = {
    contractVersion: h.core.CONTRACT,
    carrier: pending.carrier,
    keyProofs: keyProofs(f),
    receipt: {
      contractVersion: h.core.CONTRACT,
      vaultId: f.vault.vaultId,
      resourceRef: source.resourceRef,
      snapshotId: pending.snapshotId,
      revision: 1,
      sourceEpoch: 1,
      stableOperationId: pending.operationId,
      envelopeFingerprint: await h.core.signingFingerprint(pending.carrier.signedObject),
      snapshotPath: `/api/v2/holdings/sources/${source.resourceRef.resourceId}/snapshots/${pending.snapshotId}`,
      storedAt: iso(f.now()),
    },
  };
  await f.session.verifyReceipt(pending, response.receipt);
  return { preview, pending, response, source };
}
function taskResponse(h, f, pending, previous = null) {
  const context = decoded(pending.body.envelope.signedObject).context;
  return {
    contractVersion: h.core.CONTRACT,
    metadata: {
      contractVersion: h.core.CONTRACT,
      vaultId: f.vault.vaultId,
      taskId: pending.taskId,
      taskVersion: context.revision,
      executionEpoch: previous?.metadata.executionEpoch ?? 1,
      status: "active",
      resourceBindings: context.resourceBindings,
      objectRevision: context.revision,
      deliveryRevision: 1,
      envelopeFingerprint: pending.envelopeFingerprint,
      keyEpoch: context.keyEpoch,
      createdAt: previous?.metadata.createdAt ?? iso(f.now()),
      updatedAt: iso(f.now()),
    },
    signedObject: pending.body.envelope.signedObject,
    keyProofs: keyProofs(f),
  };
}
async function createTask(h, f, options = {}) {
  const template = options.template ?? "brief",
    taskId = options.taskId ?? "task_synthetic";
  const content = {
    ...h.forms.defaultTask(template),
    name: "PRIVATE_" + template + "_TASK",
    goal: "PRIVATE_GOAL_SYNTHETIC_RISK",
    // CSV has deliberately unknown valuation time and partial account coverage.
    // This exception is an explicit owner policy, never inferred from a date/footer.
    inputPolicy: { allowPartial: true, allowUnknownAsOf: true, maxFetchedAgeSeconds: 86400 },
    outputSpec: {
      label: "Private report",
      language: template === "brief" ? "zh" : "en",
      verbosity: "concise",
      sections: [
        {
          sectionId: "overview",
          title: "Private overview",
          instructions: "Assess synthetic input concentration",
        },
      ],
    },
    ...options.content,
  };
  const selected = options.bindings ?? bindings();
  assert.equal(h.forms.reviewTask(content, selected, new Date(f.now() * 1000)).valid, true);
  const pending = await f.session.sealTask({
    current: options.current ?? null,
    content,
    resourceBindings: selected,
    taskId,
  });
  return { content, pending, task: taskResponse(h, f, pending, options.current) };
}
const scopes = [
  "tasks:read",
  "runs:create",
  "runs:read",
  "results:create",
  "results:revise",
  "receipts:read",
  "portfolio:read",
  "watchlist:read",
  "channel_follows:read",
].sort();
async function enroll(h, f, task, connectionId = "connection_A1") {
  const anchor = await f.session.publicAgentAnchor({
    connectionId,
    agentPrincipalId: "agent_" + connectionId,
    taskId: task.metadata.taskId,
  });
  const helper = new h.ForegroundSession(),
    sessionId = "session_" + connectionId;
  const call = (op, args = {}, trusted = false) =>
    helper.dispatch({ id: "request_" + op, sessionId, generation: 1, op, args }, trusted);
  const keys = await call("initialize", { anchor, now: f.now(), ttlSeconds: 3600 }, true);
  const row = { helper, call };
  h.helpers.push(row);
  const offer = {
    helperVersion: "1.2.0",
    sessionId,
    generation: 1,
    anchor,
    ...Object.fromEntries(
      [
        "agentSigningPublicJwk",
        "agentEncryptionPublicJwk",
        "agentSigningKeyId",
        "agentEncryptionKeyId",
        "keyExportRejected",
      ].map((key) => [key, keys[key]]),
    ),
  };
  const registration = await f.session.prepareAgentRegistration({ offer, ttlSeconds: 3600 });
  f.vault = {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, registration.registryBundle],
  };
  f.local = await f.session.acceptVault(f.vault);
  const authorization = {
    contractVersion: h.core.CONTRACT,
    provider: "muse",
    status: "pending",
    clientId: "muse_synthetic",
    scopes,
    connectionId,
    authorizationId: "authorization_" + connectionId,
    expiresAt: f.now() + 600,
    prepared: {
      taskIds: [task.metadata.taskId],
      approvedScopes: scopes,
      tasks: [
        {
          taskId: task.metadata.taskId,
          taskVersion: task.metadata.taskVersion,
          executionEpoch: task.metadata.executionEpoch,
          resourceBindings: task.metadata.resourceBindings,
          grantId: "grant_" + connectionId,
          grantEpoch: 1,
          selectedResourceVersions: task.metadata.resourceBindings.map((b) => ({
            ...b,
            revision: 1,
            producerSnapshotId: b.ref.kind === "holdings" ? "snapshot_synthetic" : null,
          })),
        },
      ],
      authorizationCount: 1,
      keyEpoch: 1,
      registrySequence: f.local.pin.registrySequence,
      checkpointDigest: f.local.pin.checkpointDigest,
      authorizationExpiresAt: f.now() + 3600,
      historyPolicy: "selected",
    },
  };
  const approval = await f.session.signAgentGrants({ authorization, tasks: [task], offer });
  Object.assign(row, {
    offer,
    registration,
    authorization,
    approval,
    grant: decoded(approval.signedGrants[0]),
  });
  return row;
}
async function prepare(h, f, task, agent, holdings) {
  const grant = agent.grant;
  const preparationId =
    "preparation_" +
    (
      await h.core.sha(
        h.core.canonical([
          grant.ownerSubject,
          grant.connectionId,
          grant.authorizationId,
          grant.grantId,
          grant.grantEpoch,
          grant.taskId,
          grant.taskVersions,
        ]),
      )
    ).slice(0, 43);
  const deliveryKey = task.metadata.taskId + "/" + task.metadata.taskVersion;
  const tail = f.deliveryTails.get(deliveryKey) ?? {
    deliveryRevision: 1,
    envelopeFingerprint: task.metadata.envelopeFingerprint,
  };
  const objects = [
    {
      objectId: task.metadata.taskId,
      objectType: "task",
      revision: task.metadata.taskVersion,
      deliveryRevision: tail.deliveryRevision + 1,
      priorEnvelopeFingerprint: tail.envelopeFingerprint,
      resourceRef: null,
      sourceRevision: null,
      sourceEpoch: null,
      producerSnapshotId: null,
      provenance: "task_reshare",
    },
  ];
  for (const binding of task.metadata.resourceBindings)
    objects.push({
      objectId:
        "copy_" + (await h.core.sha(h.core.canonical([preparationId, binding.ref]))).slice(0, 43),
      objectType: {
        holdings: "holdings_snapshot",
        watchlist: "watchlist_evidence",
        channel_follows: "channel_follows_evidence",
      }[binding.ref.kind],
      revision: 1,
      deliveryRevision: 1,
      priorEnvelopeFingerprint: null,
      resourceRef: binding.ref,
      sourceRevision: 1,
      sourceEpoch: binding.sourceEpoch,
      producerSnapshotId: null,
      provenance: "owner_attested_copy",
    });
  const intent = {
    contractVersion: h.core.CONTRACT,
    profile: "folioview.agent-preparation.v1",
    preparationId,
    objects,
    taskMetadata: task.metadata,
    connectionId: grant.connectionId,
    taskId: grant.taskId,
    grantId: grant.grantId,
    grantEpoch: grant.grantEpoch,
    registrySequence: f.local.pin.registrySequence,
    checkpointDigest: f.local.pin.checkpointDigest,
    taskDeliveryBase: clone(tail),
    status: "staging",
  };
  const sources = task.metadata.resourceBindings.map((binding) => {
    const base = {
      ref: binding.ref,
      revision: 1,
      sourceEpoch: 1,
      fetchedAt: iso(f.now()),
      sourceAsOf: null,
    };
    if (binding.ref.kind === "holdings")
      return {
        kind: "holdings",
        ref: binding.ref,
        revision: 1,
        sourceEpoch: 1,
        snapshot: holdings.response,
      };
    if (binding.ref.kind === "watchlist")
      return {
        ...base,
        kind: "watchlist",
        response: {
          items: [
            {
              symbol: "SYNTH",
              name: "PRIVATE_WATCHLIST_ENTRY",
              instrumentType: "stock",
              currency: "USD",
              addedAt: iso(f.now()),
            },
          ],
          limit: 50,
        },
      };
    return {
      ...base,
      kind: "channel_follows",
      response: {
        revision: 1,
        items: [
          {
            followId: "follow_synthetic",
            name: "PRIVATE_YOUTUBE_FOLLOW",
            handleOrUrl: "https://www.youtube.com/@synthetic",
            note: "PRIVATE_FOLLOW_NOTE",
            verification: "user_provided",
            addedAt: iso(f.now()),
          },
        ],
        limit: 50,
      },
    };
  });
  const sealed = await f.session.sealAgentPreparation({
    intent,
    task,
    signedGrant: agent.approval.signedGrants[0],
    sources,
  });
  // Synthetic publication advances the same task delivery tail across A1/A2.
  // Actual atomicity/idempotency remain exercised by the production Hub suite.
  f.deliveryTails.set(deliveryKey, {
    deliveryRevision: objects[0].deliveryRevision,
    envelopeFingerprint: sealed.objects[0].envelopeFingerprint,
  });
  const metadata = {
    contractVersion: h.core.CONTRACT,
    profile: "folioview.agent-preparation.v1",
    preparationId,
    connectionId: grant.connectionId,
    authorizationId: grant.authorizationId,
    clientId: agent.authorization.clientId,
    taskId: grant.taskId,
    taskVersion: task.metadata.taskVersion,
    grantId: grant.grantId,
    grantEpoch: grant.grantEpoch,
    executionEpoch: grant.executionEpoch,
    keyEpoch: 1,
    ownerSubject: f.owner,
    vaultId: f.vault.vaultId,
    rootJwk: f.vault.rootJwk,
    rootKeyId: f.vault.rootKeyId,
    rootEpoch: 1,
    agentKeyGrant: agent.approval.signedGrants[0],
    authorizationExpiresAt: agent.authorization.prepared.authorizationExpiresAt,
    registryProofs: await registryProofs(h, f, `/agent/v2/preparations/${preparationId}`),
    taskMetadata: task.metadata,
    taskDeliveryBase: intent.taskDeliveryBase,
    objects: intent.objects.map((d, i) => ({
      ...d,
      envelopeFingerprint: sealed.objects[i].envelopeFingerprint,
      producerSnapshotId: d.objectType === "holdings_snapshot" ? holdings.pending.snapshotId : null,
      path: `/agent/v2/preparations/${preparationId}/objects/${d.objectId}`,
    })),
  };
  return { intent, sources, sealed, metadata };
}
async function registryProofs(h, f, prefix) {
  return Promise.all(
    f.vault.registryHistory.map(async (bundle, i) => ({
      registrySequence: i + 1,
      checkpointDigest: await h.core.sha(h.core.canonical(decoded(bundle.checkpoint))),
      path: `${prefix}/registries/${i + 1}`,
    })),
  );
}
async function install(f, agent, prepared) {
  await agent.call("registry", { bundles: f.vault.registryHistory });
  await agent.call("confirmDelivery", { pin: prepared.sealed.deliveryPin }, true);
  await agent.call("install", { metadata: prepared.metadata });
  const inputs = [];
  for (const object of prepared.sealed.objects)
    inputs.push(
      await agent.call("decrypt", { objectId: object.objectId, envelope: object.envelope }),
    );
  return inputs;
}
async function beginRun(
  h,
  f,
  agent,
  prepared,
  operation = "synthetic_begin_operation_0001",
  { consume = true } = {},
) {
  const begin = await agent.call("beginRun", { stableOperationId: operation }),
    intent = decoded(begin.signedBeginIntent);
  const run = {
    contractVersion: h.core.CONTRACT,
    vaultId: f.vault.vaultId,
    runId: begin.runId,
    manifestId: begin.manifestId,
    initialResultId: begin.initialResultId,
    taskId: intent.taskId,
    taskVersion: intent.expectedTaskVersion,
    executionEpoch: intent.executionEpoch,
    connectionId: intent.connectionId,
    grantId: intent.grantId,
    grantEpoch: intent.grantEpoch,
    authorizationId: intent.authorizationId,
    keyEpoch: intent.keyEpoch,
    state: "ready",
    beginIntentFingerprint: begin.beginIntentFingerprint,
    createdAt: iso(f.now()),
    expiresAt: iso(Math.min(f.now() + 600, agent.grant.expiresAt)),
  };
  const reference = (d) => ({
    objectId: d.objectId,
    objectType: d.objectType,
    revision: d.revision,
    deliveryRevision: d.deliveryRevision,
    envelopeFingerprint: d.envelopeFingerprint,
    keyEpoch: 1,
  });
  const task = prepared.metadata.objects.find((d) => d.objectType === "task");
  const manifest = {
    contractVersion: h.core.CONTRACT,
    vaultId: f.vault.vaultId,
    manifestId: run.manifestId,
    runId: run.runId,
    taskId: run.taskId,
    taskVersion: run.taskVersion,
    connectionId: run.connectionId,
    grantId: run.grantId,
    grantEpoch: run.grantEpoch,
    executionEpoch: run.executionEpoch,
    keyEpoch: 1,
    beginIntentFingerprint: begin.beginIntentFingerprint,
    signedBeginIntent: begin.signedBeginIntent,
    taskEnvelope: reference(task),
    entries: intent.resourceVersions.map((v) => ({
      ...reference(
        prepared.metadata.objects.find(
          (d) => h.core.canonical(d.resourceRef) === h.core.canonical(v.ref),
        ),
      ),
      ref: v.ref,
      sourceEpoch: v.sourceEpoch,
    })),
    createdAt: run.createdAt,
    expiresAt: run.expiresAt,
  };
  const response = {
    contractVersion: h.core.CONTRACT,
    profile: "folioview.agent-run.v1",
    run,
    manifest,
    manifestFingerprint: await h.core.sha(h.core.canonical(manifest)),
    componentPath: `/agent/v2/runs/${run.runId}/inputs`,
    registryProofs: await registryProofs(h, f, `/agent/v2/runs/${run.runId}`),
    authorProofs: [manifest.taskEnvelope, ...manifest.entries].map((d) => ({
      objectId: d.objectId,
      registrySequence: intent.registrySequence,
      verifiedAt: f.now(),
    })),
  };
  await agent.call("installRun", { response });
  const inputs = [],
    pages = [];
  for (const [i, d] of [manifest.taskEnvelope, ...manifest.entries].entries()) {
    const object = prepared.sealed.objects.find((v) => v.objectId === d.objectId);
    const page = {
      contractVersion: h.core.CONTRACT,
      manifest,
      manifestFingerprint: response.manifestFingerprint,
      componentIndex: i,
      component: {
        kind: i === 0 ? "task" : "resource",
        objectId: d.objectId,
        revision: d.revision,
        deliveryRevision: d.deliveryRevision,
        signedObject: object.envelope.signedObject,
      },
      nextCursor: i === manifest.entries.length ? null : "synthetic_cursor_" + i,
    };
    pages.push(page);
    if (consume) inputs.push(await agent.call("decryptRun", { runId: run.runId, page }));
  }
  return { begin, response, inputs, pages };
}
function report(suffix = "initial") {
  return {
    title: "PRIVATE_REPORT_" + suffix,
    summary: "PRIVATE_SUMMARY_SYNTHETIC",
    sections: [
      {
        sectionId: "overview",
        markdown: "PRIVATE_BODY: SYNTH 12.5; CAD 125; cash CAD 50.25. " + suffix,
      },
    ],
    citations: [],
    limitations: ["Synthetic validation; CSV valuation and account coverage remain unknown."],
  };
}
async function ownerResult(h, f, agent, frozen, packet) {
  const { run, manifest, manifestFingerprint } = frozen.response;
  const receipt = {
    contractVersion: h.core.CONTRACT,
    vaultId: f.vault.vaultId,
    runId: run.runId,
    taskId: run.taskId,
    resultId: packet.resultId,
    revision: packet.revision,
    deliveryRevision: 1,
    stableOperationId: packet.stableOperationId,
    envelopeFingerprint: packet.envelopeFingerprint,
    receivedAt: iso(f.now()),
    resultPath: `/results/${packet.resultId}?revision=${packet.revision}`,
  };
  const row = {
    contractVersion: h.core.CONTRACT,
    metadata: {
      resultId: packet.resultId,
      taskId: run.taskId,
      runId: run.runId,
      revision: packet.revision,
      deliveryRevision: 1,
      envelopeFingerprint: packet.envelopeFingerprint,
      connectionId: run.connectionId,
      receivedAt: receipt.receivedAt,
      taskVersion: run.taskVersion,
      stateVersion: packet.revision,
      read: false,
      starred: false,
      archived: false,
      manifestId: run.manifestId,
      keyEpoch: 1,
    },
    signedObject: packet.envelope.signedObject,
    keyProofs: keyProofs(f),
  };
  const evidence = {
    contractVersion: h.core.CONTRACT,
    profile: "folioview.owner-result-evidence.v1",
    run: { ...run, state: "submitted" },
    manifest,
    manifestFingerprint,
    receipt,
    agentKeyGrant: agent.approval.signedGrants[0],
    authorizationExpiresAt: agent.authorization.prepared.authorizationExpiresAt,
    provenance: {
      kind: "authorized_connection_submission",
      provider: "muse",
      clientId: agent.authorization.clientId,
      connectionId: run.connectionId,
      authorizationId: run.authorizationId,
      agentPrincipalId: agent.offer.anchor.agentPrincipalId,
    },
    authorProof: { registrySequence: f.vault.registryHistory.length, verifiedAt: f.now() },
    registryProofs: await registryProofs(
      h,
      f,
      `/api/v2/results/${packet.resultId}/revisions/${packet.revision}`,
    ),
  };
  return { result: row, evidence, registryBundles: clone(f.vault.registryHistory) };
}
async function fullFlow(h, options = {}) {
  const f = options.owner ?? (await createOwner(h, options.uid));
  const holdings = await importHoldings(h, f),
    task = await createTask(h, f, options);
  const agent = await enroll(h, f, task.task, options.connectionId);
  const prepared = await prepare(h, f, task.task, agent, holdings),
    inputs = await install(f, agent, prepared);
  const frozen = await beginRun(h, f, agent, prepared);
  const content = report(),
    packet = await agent.call("sealResult", {
      runId: frozen.response.run.runId,
      stableOperationId: "synthetic_result_operation_01",
      content,
    });
  const result = await ownerResult(h, f, agent, frozen, packet);
  return { f, holdings, task, agent, prepared, inputs, frozen, content, packet, result };
}
module.exports = {
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
  bindings,
  keyProofs,
  decoded,
  clone,
  iso,
};
