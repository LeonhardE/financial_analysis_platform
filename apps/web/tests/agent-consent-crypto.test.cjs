const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync, existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");
let core, bridge, storageModule, jose, directory;
const copy = (v) => structuredClone(v);
const decoded = (v) => JSON.parse(Buffer.from(v.payload, "base64url"));
test.before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-agent-consent-crypto-"));
  await fs.symlink(
    path.resolve(__dirname, "../../../node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );
  for (const name of [
    "encrypted-types",
    "encrypted-core",
    "encrypted-storage",
    "encrypted-vault",
  ]) {
    const file = path.resolve(__dirname, "../lib/" + name + ".ts");
    let { code } = transformSync(readFileSync(file, "utf8"), {
      filename: file,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "es6" },
    });
    code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, n) =>
      n.endsWith(".json") ? `from "./${n}" with { type: "json" }` : `from "./${n}.mjs"`,
    );
    code = code.replace('"ajv/dist/2020"', '"ajv/dist/2020.js"');
    await fs.writeFile(path.join(directory, name + ".mjs"), code);
  }
  await fs.copyFile(
    path.resolve(__dirname, "../lib/encrypted-schemas.json"),
    path.join(directory, "encrypted-schemas.json"),
  );
  core = await import(pathToFileURL(path.join(directory, "encrypted-core.mjs")).href);
  bridge = await import(pathToFileURL(path.join(directory, "encrypted-vault.mjs")).href);
  storageModule = await import(pathToFileURL(path.join(directory, "encrypted-storage.mjs")).href);
  jose = await import("jose");
});
test.after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
const resources = () => [
  {
    ref: {
      kind: "holdings",
      sourceService: "portfolio",
      resourceId: "synthetic_source",
      incarnation: "synthetic_incarnation",
    },
    sourceEpoch: 1,
  },
];
const content = () => ({
  name: "Private daily brief",
  template: "brief",
  goal: "Review synthetic concentration",
  inputPolicy: { allowPartial: false, allowUnknownAsOf: false, maxFetchedAgeSeconds: 86400 },
  outputSpec: {
    label: "Private risk report",
    sections: [
      { sectionId: "risk", title: "Synthetic risk", instructions: "Explain concentration" },
    ],
    language: "en",
    verbosity: "concise",
  },
  deliveryExpectation: {
    cadence: "daily",
    localTime: "08:30",
    timeZone: "America/Toronto",
    graceMinutes: 60,
  },
});
async function fixture(uid = "synthetic_task_owner_A") {
  let now = 1000;
  const secret = crypto.getRandomValues(new Uint8Array(32)),
    salt = core.b64(crypto.getRandomValues(new Uint8Array(32)));
  const material = () => ({
    credentialId: core.b64(new TextEncoder().encode("synthetic-task-passkey")),
    prfSalt: salt,
    secret: secret.slice().buffer,
  });
  const session = new core.VaultCore(uid, () => now),
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
    created,
    vault,
    local,
    material,
    setNow: (n) => {
      now = n;
    },
  };
}
async function saved(f, pending, previous = null) {
  const message = decoded(pending.body.envelope.signedObject),
    c = message.context;
  const action = pending.body.transitionIntent && decoded(pending.body.transitionIntent).action;
  const previousMeta = previous?.metadata;
  return {
    contractVersion: core.CONTRACT,
    metadata: {
      contractVersion: core.CONTRACT,
      vaultId: f.vault.vaultId,
      taskId: pending.taskId,
      taskVersion: c.revision,
      executionEpoch: previousMeta
        ? previousMeta.executionEpoch +
          Number(
            action === "pause" ||
              action === "archive" ||
              previousMeta.keyEpoch !== c.keyEpoch ||
              core.canonical(previousMeta.resourceBindings) !== core.canonical(c.resourceBindings),
          )
        : 1,
      status: action
        ? { pause: "paused", resume: "active", archive: "archived" }[action]
        : (previousMeta?.status ?? "active"),
      resourceBindings: c.resourceBindings,
      objectRevision: c.revision,
      deliveryRevision: 1,
      envelopeFingerprint: pending.envelopeFingerprint,
      keyEpoch: c.keyEpoch,
      createdAt: previousMeta?.createdAt ?? new Date(1000000).toISOString(),
      updatedAt: new Date(1000000).toISOString(),
    },
    signedObject: pending.body.envelope.signedObject,
    keyProofs: {
      checkpoint: f.vault.registryHistory.at(-1).checkpoint,
      certificates: f.vault.registryHistory.at(-1).entries.map((e) => e.certificate),
    },
  };
}
async function create(f) {
  const pending = await f.session.sealTask({
    current: null,
    content: content(),
    resourceBindings: resources(),
    taskId: "synthetic_task",
  });
  return { pending, task: await saved(f, pending) };
}
async function signed(
  f,
  payload,
  typ = "fv-control+jws",
  key = f.session.root,
  kid = f.vault.rootKeyId,
) {
  const v = await new jose.FlattenedSign(new TextEncoder().encode(core.canonical(payload)))
    .setProtectedHeader({ alg: "ES256", kid, typ, cty: "application/json" })
    .sign(key);
  return { protected: v.protected, payload: v.payload, signature: v.signature };
}
async function advance(f, { revoke = [], keyEpoch = 1, entries } = {}) {
  const bundle = await f.session.bundle(
    entries ??
      f.vault.registryHistory.at(-1).entries.map((e) => ({
        ...e,
        active: !revoke.includes(decoded(e.certificate).keyId) && e.active,
      })),
    f.session.registry,
  );
  const cp = decoded(bundle.checkpoint);
  cp.revokedKeyIds = [...new Set([...cp.revokedKeyIds, ...revoke])].sort();
  cp.keyEpoch = keyEpoch;
  bundle.checkpoint = await signed(f, cp);
  f.vault = {
    ...f.vault,
    registryHistory: [...f.vault.registryHistory, bundle],
    version: f.vault.version + 1,
  };
  await f.session.acceptResultVault(f.vault);
}

let helperClass;
const helpers = [];
test.before(async () => {
  helperClass = (
    await import(
      pathToFileURL(
        path.resolve(__dirname, "../../../services/agent-hub-service/helper/dist/worker.mjs"),
      ).href
    )
  ).ForegroundSession;
});
test.afterEach(async () => {
  for (const row of helpers.splice(0)) {
    try {
      await row.helper.dispatch(
        {
          id: "end",
          sessionId: row.offer.sessionId,
          generation: row.offer.generation,
          op: "lock",
          args: {},
        },
        true,
      );
    } catch {}
  }
});
const userRef = (kind) => ({
  kind,
  sourceService: "user",
  resourceId: "source_" + kind,
  incarnation: "incarnation_user",
});
const selectedResources = () => [
  ...resources(),
  { ref: userRef("watchlist"), sourceEpoch: 1 },
  { ref: userRef("channel_follows"), sourceEpoch: 1 },
];
const date = () => new Date(1000000).toISOString();
async function taskWith(f, refs = selectedResources()) {
  const pending = await f.session.sealTask({
    current: null,
    content: content(),
    resourceBindings: refs,
    taskId: "synthetic_task",
  });
  return { pending, task: await saved(f, pending) };
}
async function helperOffer(f, connectionId = "connection_synthetic", taskId = "synthetic_task") {
  const anchor = await f.session.publicAgentAnchor({
    connectionId,
    agentPrincipalId: "agent_synthetic_" + connectionId,
    taskId,
  });
  const helper = new helperClass(),
    sessionId = "session_synthetic_" + helpers.length,
    generation = 1;
  const result = await helper.dispatch(
    {
      id: "init",
      sessionId,
      generation,
      op: "initialize",
      args: { anchor, now: 1000, ttlSeconds: 3600 },
    },
    true,
  );
  const offer = {
    helperVersion: "1.2.0",
    sessionId,
    generation,
    anchor,
    ...Object.fromEntries(
      [
        "agentSigningPublicJwk",
        "agentEncryptionPublicJwk",
        "agentSigningKeyId",
        "agentEncryptionKeyId",
        "keyExportRejected",
      ].map((k) => [k, result[k]]),
    ),
  };
  helpers.push({ helper, offer });
  return { helper, offer };
}
async function register(f, offer, replaceKeyIds) {
  const packet = await f.session.prepareAgentRegistration({
    offer,
    ttlSeconds: 3600,
    ...(replaceKeyIds ? { replaceKeyIds } : {}),
  });
  f.vault = {
    ...f.vault,
    version: f.vault.version + 1,
    registryHistory: [...f.vault.registryHistory, packet.registryBundle],
  };
  f.local = await f.session.acceptVault(f.vault);
  return packet;
}
function authorization(f, task, offer) {
  return {
    contractVersion: core.CONTRACT,
    provider: "muse",
    status: "pending",
    clientId: "muse_synthetic",
    scopes: [
      "tasks:read",
      "runs:create",
      "runs:read",
      "results:create",
      "results:revise",
      "receipts:read",
      "portfolio:read",
      "watchlist:read",
      "channel_follows:read",
    ],
    connectionId: offer.anchor.connectionId,
    authorizationId: "authorization_synthetic",
    expiresAt: 1600,
    prepared: {
      taskIds: [task.metadata.taskId],
      approvedScopes: [
        "tasks:read",
        "runs:create",
        "runs:read",
        "results:create",
        "results:revise",
        "receipts:read",
        "portfolio:read",
        "watchlist:read",
        "channel_follows:read",
      ].sort(),
      tasks: [
        {
          taskId: task.metadata.taskId,
          taskVersion: task.metadata.taskVersion,
          executionEpoch: task.metadata.executionEpoch,
          resourceBindings: task.metadata.resourceBindings,
          grantId: "grant_synthetic",
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
      authorizationExpiresAt: 5000,
      historyPolicy: "selected",
    },
  };
}
async function prepareFixture(uid) {
  const f = await fixture(uid),
    { pending, task } = await taskWith(f),
    { offer, helper } = await helperOffer(f),
    registration = await register(f, offer),
    auth = authorization(f, task, offer),
    grants = await f.session.signAgentGrants({ authorization: auth, tasks: [task], offer }),
    grant = decoded(grants.signedGrants[0]);
  const preparationId =
    "preparation_" +
    (
      await core.sha(
        core.canonical([
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
  const descriptors = [
    {
      objectId: task.metadata.taskId,
      objectType: "task",
      revision: 1,
      deliveryRevision: 2,
      priorEnvelopeFingerprint: task.metadata.envelopeFingerprint,
      resourceRef: null,
      sourceRevision: null,
      sourceEpoch: null,
      producerSnapshotId: null,
      provenance: "task_reshare",
    },
  ];
  for (const b of task.metadata.resourceBindings)
    descriptors.push({
      objectId: "copy_" + (await core.sha(core.canonical([preparationId, b.ref]))).slice(0, 43),
      objectType: {
        holdings: "holdings_snapshot",
        watchlist: "watchlist_evidence",
        channel_follows: "channel_follows_evidence",
      }[b.ref.kind],
      revision: 1,
      deliveryRevision: 1,
      priorEnvelopeFingerprint: null,
      resourceRef: b.ref,
      sourceRevision: 1,
      sourceEpoch: 1,
      producerSnapshotId: null,
      provenance: "owner_attested_copy",
    });
  const intent = {
    contractVersion: core.CONTRACT,
    profile: "folioview.agent-preparation.v1",
    preparationId,
    objects: descriptors,
    taskMetadata: task.metadata,
    connectionId: grant.connectionId,
    taskId: grant.taskId,
    grantId: grant.grantId,
    grantEpoch: grant.grantEpoch,
    registrySequence: f.local.pin.registrySequence,
    checkpointDigest: f.local.pin.checkpointDigest,
    taskDeliveryBase: {
      deliveryRevision: 1,
      envelopeFingerprint: task.metadata.envelopeFingerprint,
    },
    status: "staging",
  };
  const holdings = {
    state: "ready",
    coverage: { state: "complete", issues: [] },
    sourceAsOf: date(),
    fetchedAt: date(),
    freshness: "fresh",
    data: {
      kind: "holdings",
      snapshotId: "snapshot_synthetic",
      accounts: [
        {
          accountId: "account_synthetic",
          displayName: "PRIVATE_HOLDING_ACCOUNT",
          balances: [{ currency: "CAD", cashBalance: "50.25", buyingPower: null }],
          positions: [
            {
              assetId: "asset_synthetic",
              brokerAssetId: "broker_synthetic",
              symbol: "SYNTH",
              exchange: "SYNTHETIC",
              name: "Private synthetic asset",
              assetType: "stock",
              quantity: "12.5",
              currency: "CAD",
              marketValue: { currency: "CAD", amount: "125" },
            },
          ],
        },
      ],
      excludedAssets: [],
    },
  };
  const snapshot = await f.session.sealSnapshot({
    content: holdings,
    source: { resourceRef: resources()[0].ref, sourceEpoch: 1 },
    expectedRevision: 0,
    snapshotId: "snapshot_synthetic",
  });
  const response = {
    contractVersion: core.CONTRACT,
    carrier: snapshot.carrier,
    keyProofs: {
      checkpoint: f.vault.registryHistory.at(-1).checkpoint,
      certificates: f.vault.registryHistory.at(-1).entries.map((e) => e.certificate),
    },
    receipt: {
      contractVersion: core.CONTRACT,
      vaultId: f.vault.vaultId,
      resourceRef: resources()[0].ref,
      snapshotId: snapshot.snapshotId,
      revision: 1,
      sourceEpoch: 1,
      stableOperationId: snapshot.operationId,
      envelopeFingerprint: await core.signingFingerprint(snapshot.carrier.signedObject),
      snapshotPath: `/api/v2/holdings/sources/${resources()[0].ref.resourceId}/snapshots/${snapshot.snapshotId}`,
      storedAt: date(),
    },
  };
  const sources = [
    { kind: "holdings", ref: resources()[0].ref, revision: 1, sourceEpoch: 1, snapshot: response },
    {
      kind: "watchlist",
      ref: userRef("watchlist"),
      revision: 1,
      sourceEpoch: 1,
      fetchedAt: date(),
      sourceAsOf: date(),
      response: {
        items: [
          {
            symbol: "SYNTH",
            name: "PRIVATE_WATCHLIST_NAME",
            instrumentType: "stock",
            currency: "USD",
            addedAt: date(),
          },
        ],
        limit: 50,
      },
    },
    {
      kind: "channel_follows",
      ref: userRef("channel_follows"),
      revision: 1,
      sourceEpoch: 1,
      fetchedAt: date(),
      sourceAsOf: date(),
      response: {
        revision: 1,
        items: [
          {
            followId: "follow_synthetic",
            name: "PRIVATE_FOLLOW_NAME",
            handleOrUrl: "https://www.youtube.com/@synthetic",
            note: "PRIVATE_FOLLOW_NOTE",
            verification: "user_provided",
            addedAt: date(),
          },
        ],
        limit: 50,
      },
    },
  ];
  return { f, pending, task, offer, helper, registration, auth, grants, grant, intent, sources };
}
test("independent owner anchor and helper public fingerprints reject substituted identities and private key fields", async () => {
  const f = await fixture(),
    { offer } = await helperOffer(f);
  assert.equal(offer.anchor.rootKeyId, f.vault.rootKeyId);
  for (const mutate of [
    (v) => (v.anchor.ownerSubject = "foreign_owner"),
    (v) => (v.anchor.rootJwk = offer.agentSigningPublicJwk),
    (v) => (v.anchor.checkpointDigest = "0".repeat(64)),
    (v) => (v.agentEncryptionKeyId = v.agentSigningKeyId),
    (v) => (v.agentSigningPublicJwk.d = "private_material"),
    (v) => (v.keyExportRejected = false),
    (v) => (v.helperVersion = "unknown"),
  ]) {
    const bad = copy(offer);
    mutate(bad);
    await assert.rejects(f.session.inspectAgentOffer({ offer: bad }));
  }
  const inspected = await f.session.inspectAgentOffer({ offer });
  assert.deepEqual(inspected.existingConnectionKeyIds, []);
  assert.equal(inspected.offerFingerprint, await core.sha(core.canonical(offer)));
});
test("registry enrollment retries exact signed bytes and explicit replacement revokes only its own connection", async () => {
  const f = await fixture(),
    { offer } = await helperOffer(f);
  const first = await f.session.prepareAgentRegistration({ offer, ttlSeconds: 3600 }),
    retry = await f.session.prepareAgentRegistration({ offer, ttlSeconds: 3600 });
  assert.deepEqual({ ...first, localPending: null }, { ...retry, localPending: null });
  assert.equal(JSON.stringify(first).includes('"d"'), false);
  await register(f, offer);
  const other = await helperOffer(f, "connection_other");
  await register(f, other.offer);
  const replacement = await helperOffer(f);
  const inspect = await f.session.inspectAgentOffer({ offer: replacement.offer });
  await assert.rejects(
    f.session.prepareAgentRegistration({ offer: replacement.offer, ttlSeconds: 3600 }),
    /replacement_review_required/,
  );
  const renewed = await register(f, replacement.offer, inspect.existingConnectionKeyIds),
    cp = decoded(renewed.registryBundle.checkpoint);
  assert.equal(cp.keyEpoch, 1);
  assert.deepEqual(
    renewed.replacedKeyIds,
    [offer.agentEncryptionKeyId, offer.agentSigningKeyId].sort(),
  );
  const certs = renewed.registryBundle.entries.map((e) => ({
    ...decoded(e.certificate),
    active: e.active,
  }));
  assert.equal(certs.find((c) => c.keyId === other.offer.agentEncryptionKeyId).active, true);
  assert.equal(certs.find((c) => c.keyId === offer.agentEncryptionKeyId).active, false);
  assert.equal(certs.find((c) => c.keyId === replacement.offer.agentEncryptionKeyId).keyEpoch, 2);
});
test("signed grants bind current checkpoint, exact selected task/source versions, capabilities and owner recipients", async () => {
  const p = await prepareFixture(),
    g = p.grant;
  assert.deepEqual(g.taskVersions, [1]);
  assert.equal(g.historyPolicy, "selected");
  assert.equal(g.resourceBindings.length, 3);
  assert.ok(
    g.resourceBindings.every((b) => b.versionAccess === "selected" && b.selectedVersions[0] === 1),
  );
  assert.equal(g.writebackRecipientKeyIds.includes(g.agentEncryptionKeyId), false);
  assert.ok(g.expiresAt <= 4600);
  for (const mutate of [
    (a) => (a.prepared.keyEpoch = 2),
    (a) => (a.prepared.tasks[0].taskVersion = 2),
    (a) => (a.prepared.tasks[0].selectedResourceVersions[0].revision = 0),
    (a) =>
      (a.prepared.approvedScopes = a.prepared.approvedScopes.filter((s) => s !== "portfolio:read")),
    (a) => (a.connectionId = "other_connection"),
  ]) {
    const bad = copy(p.auth);
    mutate(bad);
    await assert.rejects(
      p.f.session.signAgentGrants({ authorization: bad, tasks: [p.task], offer: p.offer }),
    );
  }
});
test("D2 task plus three resource copies contain only ciphertext, independent pins, and decrypt with the actual helper", async () => {
  const p = await prepareFixture(),
    sealed = await p.f.session.sealAgentPreparation({
      intent: p.intent,
      task: p.task,
      signedGrant: p.grants.signedGrants[0],
      sources: p.sources,
    }),
    { localPending, ...packet } = sealed;
  assert.equal(packet.objects.length, 4);
  for (const marker of [
    content().goal,
    "PRIVATE_HOLDING_ACCOUNT",
    "PRIVATE_WATCHLIST_NAME",
    "PRIVATE_FOLLOW_NAME",
    "PRIVATE_FOLLOW_NOTE",
  ]) {
    assert.equal(JSON.stringify(packet).includes(marker), false);
    assert.equal(JSON.stringify(localPending).includes(marker), false);
  }
  assert.deepEqual(
    await p.f.session.openAgentPending({
      kind: "preparation",
      record: localPending,
      connectionId: p.grant.connectionId,
      taskId: p.grant.taskId,
    }),
    packet,
  );
  await p.helper.dispatch(
    {
      id: "registry",
      sessionId: p.offer.sessionId,
      generation: 1,
      op: "registry",
      args: { bundles: p.f.vault.registryHistory },
    },
    false,
  );
  await p.helper.dispatch(
    {
      id: "pin",
      sessionId: p.offer.sessionId,
      generation: 1,
      op: "confirmDelivery",
      args: { pin: packet.deliveryPin },
    },
    true,
  );
  const metadata = {
    contractVersion: core.CONTRACT,
    profile: "folioview.agent-preparation.v1",
    preparationId: packet.preparationId,
    connectionId: p.grant.connectionId,
    authorizationId: p.grant.authorizationId,
    clientId: p.auth.clientId,
    taskId: p.grant.taskId,
    taskVersion: 1,
    grantId: p.grant.grantId,
    grantEpoch: 1,
    executionEpoch: 1,
    keyEpoch: 1,
    ownerSubject: await p.f.session.owner,
    vaultId: p.f.vault.vaultId,
    rootJwk: p.f.vault.rootJwk,
    rootKeyId: p.f.vault.rootKeyId,
    rootEpoch: 1,
    agentKeyGrant: p.grants.signedGrants[0],
    authorizationExpiresAt: 5000,
    registryProofs: await Promise.all(
      p.f.vault.registryHistory.map(async (b, i) => ({
        registrySequence: i + 1,
        checkpointDigest: await core.sha(core.canonical(decoded(b.checkpoint))),
        path: `/agent/v2/preparations/${packet.preparationId}/registries/${i + 1}`,
      })),
    ),
    taskMetadata: p.task.metadata,
    taskDeliveryBase: p.intent.taskDeliveryBase,
    objects: p.intent.objects.map((d, i) => ({
      ...d,
      envelopeFingerprint: packet.objects[i].envelopeFingerprint,
      path: `/agent/v2/preparations/${packet.preparationId}/objects/${d.objectId}`,
      producerSnapshotId: d.objectType === "holdings_snapshot" ? "snapshot_synthetic" : null,
    })),
  };
  await p.helper.dispatch(
    {
      id: "install",
      sessionId: p.offer.sessionId,
      generation: 1,
      op: "install",
      args: { metadata },
    },
    false,
  );
  const opened = [];
  for (const object of packet.objects)
    opened.push(
      await p.helper.dispatch(
        {
          id: object.objectId,
          sessionId: p.offer.sessionId,
          generation: 1,
          op: "decrypt",
          args: { objectId: object.objectId, envelope: object.envelope },
        },
        false,
      ),
    );
  assert.equal(opened[0].payload.goal, content().goal);
  assert.deepEqual(
    opened.slice(1).map((v) => v.payload.data.kind),
    ["holdings", "watchlist", "channel_follows"],
  );
  assert.equal(opened[1].payload.data.accounts[0].displayName, "PRIVATE_HOLDING_ACCOUNT");
});
test("unapproved source revisions, mismatched preparation descriptors and wrong-account retry archives fail closed", async () => {
  const p = await prepareFixture(),
    args = {
      intent: p.intent,
      task: p.task,
      signedGrant: p.grants.signedGrants[0],
      sources: p.sources,
    };
  for (const mutate of [
    (v) => (v.intent.preparationId = "preparation_wrong"),
    (v) => (v.intent.objects[0].priorEnvelopeFingerprint = "0".repeat(64)),
    (v) => (v.sources[1].revision = 2),
    (v) => (v.sources[2].response.revision = 2),
    (v) => (v.sources[0].snapshot.receipt.revision = 2),
    (v) => (v.intent.objects[1].objectId = "copy_untrusted"),
  ]) {
    const bad = copy(args);
    mutate(bad);
    await assert.rejects(p.f.session.sealAgentPreparation(bad));
  }
  const sealed = await p.f.session.sealAgentPreparation(args),
    foreign = await fixture("synthetic_owner_B");
  await assert.rejects(
    foreign.session.openAgentPending({
      kind: "preparation",
      record: sealed.localPending,
      connectionId: p.grant.connectionId,
      taskId: p.grant.taskId,
    }),
  );
});
test("browser owner registry, grant and D2 packets match the independent Python grant and preparation producer validators", async (t) => {
  const root = path.resolve(__dirname, "../../.."),
    python = path.join(root, "services/market-data-service/.venv/bin/python");
  if (!existsSync(python)) {
    t.skip("Declared shared Python environment unavailable");
    return;
  }
  const probe = spawnSync(python, ["-c", "import jwcrypto"], { encoding: "utf8" });
  if (probe.status !== 0) {
    t.skip("Declared shared Python dependencies unavailable");
    return;
  }
  const p = await prepareFixture(),
    { localPending, ...packet } = await p.f.session.sealAgentPreparation({
      intent: p.intent,
      task: p.task,
      signedGrant: p.grants.signedGrants[0],
      sources: p.sources,
    });
  const result = spawnSync(
    python,
    [
      "-c",
      `import json,sys
from types import SimpleNamespace
from folioview_shared.encrypted.authority import verify_registry,verify_agent_grant
from app.preparations import PreparationService
x=json.load(sys.stdin);r=None
for b in x['vault']['registryHistory']:r=verify_registry(b,root_jwk=x['vault']['rootJwk'],pinned_root_key_id=x['vault']['rootKeyId'],owner_subject=x['owner'],vault_id=x['vault']['vaultId'],now=1000,previous=r)
g=verify_agent_grant(x['signed'],registry=r,owner_subject=x['owner'],vault_id=x['vault']['vaultId'],connection_id=x['grant']['connectionId'],authorization_id=x['grant']['authorizationId'],task_id=x['grant']['taskId'],task_version=1,execution_epoch=1,grant_id=x['grant']['grantId'],grant_epoch=1,now=1000,authorization_expires_at=5000)
s=object.__new__(PreparationService);s.oauth=SimpleNamespace(now=lambda:1000)
state=({'ownerSubject':x['owner']},g,x['vault'],r,x['task']['metadata'])
for d,p in zip(x['intent']['objects'],x['packet']['objects']):
 v=s._verify(p['envelope'],d,state,p['authorKeyId'],p['operationId']);assert v.fingerprint==p['envelopeFingerprint']
print('verified')`,
    ],
    {
      input: JSON.stringify({
        vault: p.f.vault,
        owner: await p.f.session.owner,
        signed: p.grants.signedGrants[0],
        grant: p.grant,
        task: p.task,
        intent: p.intent,
        packet,
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONPATH:
          path.join(root, "services/agent-hub-service") +
          path.delimiter +
          path.join(root, "services/common"),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified/);
});

class LocalWorker {
  postMessage(message, transfer = []) {
    const m = structuredClone(message, { transfer });
    this.queue = (this.queue ?? Promise.resolve()).then(async () => {
      if (this.stopped) return;
      try {
        const { method, args } = m;
        let result;
        if (method === "init") {
          this.core = new core.VaultCore(args.uid, () => 1000);
          result = { ownerSubject: await this.core.owner };
        } else if (method === "unlock" || method === "unlockForResults")
          result = await this.core[method](args.vault, args.material, args.local);
        else if (method === "acceptVault" || method === "acceptResultVault")
          result = await this.core[method](args.vault);
        else if (method === "openTask") result = await this.core.openTask(args.task);
        else if (method === "taskAuthority") result = await this.core.taskAuthority(args.current);
        else if (method === "openDraft") result = await this.core.openDraft(args.record);
        else if (method === "validateTaskPending")
          result = await this.core.validateTaskPending(args.pending);
        else result = await this.core[method](args);
        if (!this.stopped) this.onmessage({ data: { id: m.id, ok: true, result } });
      } catch (e) {
        if (!this.stopped)
          this.onmessage({ data: { id: m.id, ok: false, error: e.code ?? "crypto_failed" } });
      }
    });
  }
  terminate() {
    this.stopped = true;
    this.core = null;
  }
}

test("production storage transaction model retains only sealed exact registration/preparation retries across lock and CAS races", async () => {
  const fake = require("fake-indexeddb"),
    previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    range = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: fake.IDBKeyRange });
  const sessions = [];
  try {
    const f = await fixture(),
      { offer } = await helperOffer(f),
      storage = new storageModule.BrowserEncryptedStorage();
    await storage.commitVault(await f.session.owner, f.local);
    async function client(vault = f.vault, owner = f.uid) {
      const c = new bridge.EncryptedVaultSession(owner, {
        storage,
        workerFactory: () => new LocalWorker(),
      });
      sessions.push(c);
      await c.unlock(vault, f.material());
      await c.acceptVault(vault);
      return c;
    }
    const a = await client(),
      b = await client();
    const race = await Promise.allSettled([
      a.prepareAgentRegistration({ offer, ttlSeconds: 3600 }),
      b.prepareAgentRegistration({ offer, ttlSeconds: 3600 }),
    ]);
    assert.equal(race.filter((v) => v.status === "fulfilled").length, 1);
    const packet = await a.loadAgentRegistration(offer.anchor.connectionId, offer.anchor.taskId);
    assert.equal(packet.offerFingerprint, await core.sha(core.canonical(offer)));
    assert.equal((await a.listAgentOutbox()).length, 1);
    a.lock();
    b.lock();
    await assert.rejects(
      a.clearAgentRegistration(offer.anchor.connectionId, offer.anchor.taskId, packet.operationId),
      /locked/,
    );
    assert.equal(
      (await storage.list((await f.session.owner) + ":agent-registration:")).length,
      1,
      "a locked captured clear must preserve the durable retry",
    );
    f.vault = {
      ...f.vault,
      version: 2,
      registryHistory: [...f.vault.registryHistory, packet.registryBundle],
    };
    const relogin = await client();
    assert.deepEqual(
      await relogin.loadAgentRegistration(offer.anchor.connectionId, offer.anchor.taskId),
      packet,
    );
    await assert.rejects(
      relogin.clearAgentRegistration(
        offer.anchor.connectionId,
        offer.anchor.taskId,
        "wrong_operation_0000000000",
      ),
      /operation_conflict/,
    );
    await relogin.clearAgentRegistration(
      offer.anchor.connectionId,
      offer.anchor.taskId,
      packet.operationId,
    );
    assert.equal((await relogin.listAgentOutbox()).length, 0);
    relogin.lock();
    const p = await prepareFixture("synthetic_storage_owner_B");
    await storage.commitVault(await p.f.session.owner, p.f.local);
    const c = new bridge.EncryptedVaultSession(p.f.uid, {
      storage,
      workerFactory: () => new LocalWorker(),
    });
    sessions.push(c);
    await c.unlock(p.f.vault, p.f.material());
    await c.acceptVault(p.f.vault);
    const approval = await c.signAgentGrants({
      authorization: p.auth,
      tasks: [p.task],
      offer: p.offer,
    });
    assert.deepEqual(
      await c.signAgentGrants({ authorization: p.auth, tasks: [p.task], offer: p.offer }),
      approval,
    );
    const prepared = await c.sealAgentPreparation({
      intent: p.intent,
      task: p.task,
      signedGrant: p.grants.signedGrants[0],
      sources: p.sources,
    });
    await assert.rejects(
      c.sealAgentPreparation({
        intent: p.intent,
        task: p.task,
        signedGrant: p.grants.signedGrants[0],
        sources: p.sources,
      }),
      /pending_preparation/,
    );
    c.lock();
    const d = new bridge.EncryptedVaultSession(p.f.uid, {
      storage,
      workerFactory: () => new LocalWorker(),
    });
    sessions.push(d);
    await d.unlock(p.f.vault, p.f.material());
    await d.acceptVault(p.f.vault);
    assert.deepEqual(await d.loadAgentApproval(p.grant.connectionId, p.grant.taskId), approval);
    assert.equal(
      JSON.stringify(await d.loadAgentApproval(p.grant.connectionId, p.grant.taskId)),
      JSON.stringify(approval),
    );
    assert.deepEqual(await d.loadAgentPreparation(p.grant.connectionId, p.grant.taskId), prepared);
    assert.equal(
      JSON.stringify(await d.loadAgentPreparation(p.grant.connectionId, p.grant.taskId)),
      JSON.stringify(prepared),
    );
    const rows = await storage.list((await p.f.session.owner) + ":agent-preparation:");
    assert.equal(rows.length, 1);
    for (const marker of [content().goal, "PRIVATE_FOLLOW_NOTE", "PRIVATE_HOLDING_ACCOUNT"]) {
      assert.equal(JSON.stringify(rows).includes(marker), false);
    }
    const corrupted = copy(rows[0].value);
    corrupted.pending.record.ciphertext =
      (corrupted.pending.record.ciphertext[0] === "A" ? "B" : "A") +
      corrupted.pending.record.ciphertext.slice(1);
    await storage.put(rows[0].key, corrupted);
    await assert.rejects(d.loadAgentPreparation(p.grant.connectionId, p.grant.taskId));
    await storage.put(rows[0].key, rows[0].value);
    await advance(p.f, { revoke: [p.offer.agentEncryptionKeyId] });
    await d.acceptVault(p.f.vault);
    await assert.rejects(
      d.loadAgentPreparation(p.grant.connectionId, p.grant.taskId),
      /key_revoked/,
    );
    await assert.rejects(d.loadAgentApproval(p.grant.connectionId, p.grant.taskId), /key_revoked/);
    await d.clearAgentApproval(p.grant.connectionId, p.grant.taskId, approval.operationId);
    await d.clearAgentPreparation(
      p.grant.connectionId,
      p.grant.taskId,
      prepared.commit.operationId,
    );
    assert.equal((await d.listAgentOutbox()).length, 0);
  } finally {
    for (const s of sessions) s.lock();
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else delete globalThis.indexedDB;
    if (range) Object.defineProperty(globalThis, "IDBKeyRange", range);
    else delete globalThis.IDBKeyRange;
  }
});

test("A1 approved grants and sealed retries survive A2 enrollment, another owner device and independent A2 revocation", async () => {
  const p = await prepareFixture(),
    approval = await p.f.session.signAgentGrants({
      authorization: p.auth,
      tasks: [p.task],
      offer: p.offer,
    }),
    a2 = await helperOffer(p.f, "connection_second");
  await register(p.f, a2.offer);
  const newDevice = new core.VaultCore(p.f.uid, () => 1000);
  await newDevice.unlock(p.f.vault, p.f.material());
  const registration = await newDevice.prepareDeviceRegistration(p.f.vault);
  p.f.vault = {
    ...p.f.vault,
    version: p.f.vault.version + 1,
    registryHistory: [...p.f.vault.registryHistory, registration.registryBundle],
  };
  await p.f.session.acceptVault(p.f.vault);
  const extraOwnerKey = registration.registryBundle.entries
    .map((e) => decoded(e.certificate))
    .filter(
      (c) => c.role === "device_enc" && !p.grant.writebackRecipientKeyIds.includes(c.keyId),
    )[0].keyId;
  const opened = await p.f.session.openAgentPending({
    kind: "approval",
    record: approval.localPending,
    connectionId: p.grant.connectionId,
    taskId: p.grant.taskId,
  });
  assert.deepEqual(opened.signedGrants, approval.signedGrants);
  const intent = {
    ...p.intent,
    registrySequence: p.f.session.registry.checkpoint.registrySequence,
    checkpointDigest: p.f.session.registry.digest,
  };
  const prepared = await p.f.session.sealAgentPreparation({
    intent,
    task: p.task,
    signedGrant: approval.signedGrants[0],
    sources: p.sources,
  });
  const ids = decoded(prepared.objects[0].envelope.signedObject).context.recipients.map(
    (r) => r.keyId,
  );
  assert.equal(ids.includes(extraOwnerKey), false);
  assert.equal(ids.includes(a2.offer.agentEncryptionKeyId), false);
  assert.equal(ids.includes(p.offer.agentEncryptionKeyId), true);
  await advance(p.f, { revoke: [a2.offer.agentSigningKeyId, a2.offer.agentEncryptionKeyId] });
  const replay = await p.f.session.openAgentPending({
    kind: "preparation",
    record: prepared.localPending,
    connectionId: p.grant.connectionId,
    taskId: p.grant.taskId,
  });
  assert.deepEqual(replay.objects, prepared.objects);
  assert.deepEqual(
    (
      await p.f.session.openAgentPending({
        kind: "approval",
        record: approval.localPending,
        connectionId: p.grant.connectionId,
        taskId: p.grant.taskId,
      })
    ).signedGrants,
    approval.signedGrants,
  );
  const root = path.resolve(__dirname, "../../.."),
    python = path.join(root, "services/market-data-service/.venv/bin/python");
  if (existsSync(python)) {
    const result = spawnSync(
      python,
      [
        "-c",
        `import json,sys
from folioview_shared.encrypted.authority import verify_registry,verify_agent_grant
x=json.load(sys.stdin);r=None
for b in x['vault']['registryHistory']:r=verify_registry(b,root_jwk=x['vault']['rootJwk'],pinned_root_key_id=x['vault']['rootKeyId'],owner_subject=x['owner'],vault_id=x['vault']['vaultId'],now=1000,previous=r)
g=x['grant'];verify_agent_grant(x['signed'],registry=r,owner_subject=x['owner'],vault_id=x['vault']['vaultId'],connection_id=g['connectionId'],authorization_id=g['authorizationId'],task_id=g['taskId'],task_version=1,execution_epoch=1,grant_id=g['grantId'],grant_epoch=1,now=1000,authorization_expires_at=5000)
print('verified')`,
      ],
      {
        input: JSON.stringify({
          vault: p.f.vault,
          owner: await p.f.session.owner,
          grant: p.grant,
          signed: approval.signedGrants[0],
        }),
        encoding: "utf8",
        env: { ...process.env, PYTHONPATH: path.join(root, "services/common") },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  await advance(p.f, { keyEpoch: 2 });
  await assert.rejects(
    p.f.session.openAgentPending({
      kind: "preparation",
      record: prepared.localPending,
      connectionId: p.grant.connectionId,
      taskId: p.grant.taskId,
    }),
    /stale_epoch/,
  );
  await assert.rejects(
    p.f.session.openAgentPending({
      kind: "approval",
      record: approval.localPending,
      connectionId: p.grant.connectionId,
      taskId: p.grant.taskId,
    }),
    /binding_mismatch/,
  );
});
