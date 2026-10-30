const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { transformSync } = require("next/dist/build/swc");
let core, bridge, jose, directory, storageModule;
const clone = (v) => structuredClone(v);
const value = (signed) => JSON.parse(Buffer.from(signed.payload, "base64url"));
const iso = (n) => new Date(n * 1000).toISOString();
test.before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-result-crypto-"));
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
    code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, name) =>
      name.endsWith(".json") ? `from "./${name}" with { type: "json" }` : `from "./${name}.mjs"`,
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

async function sign(content, key, kid, typ = "fv-control+jws") {
  const out = await new jose.FlattenedSign(new TextEncoder().encode(core.canonical(content)))
    .setProtectedHeader({ alg: "ES256", kid, typ, cty: "application/json" })
    .sign(key);
  return { protected: out.protected, payload: out.payload, signature: out.signature };
}
async function pair(signing) {
  const keys = await jose.generateKeyPair(signing ? "ES256" : "ECDH-ES", {
    crv: "P-256",
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(keys.publicKey);
  return { ...keys, publicJwk, keyId: await jose.calculateJwkThumbprint(publicJwk) };
}
async function fixture(uid = "synthetic_owner_A") {
  const secret = crypto.getRandomValues(new Uint8Array(32)),
    salt = crypto.getRandomValues(new Uint8Array(32));
  const material = () => ({
    credentialId: core.b64(new TextEncoder().encode("synthetic-credential")),
    prfSalt: core.b64(salt),
    secret: secret.slice().buffer,
  });
  let clock = 1000;
  const session = new core.VaultCore(uid, () => clock);
  const created = await session.beginCreate(material());
  let vault = {
    vaultId: created.vaultId,
    rootJwk: created.rootJwk,
    rootKeyId: created.rootKeyId,
    registryHistory: [created.registryBundle],
    archive: created.archive,
    version: 1,
  };
  const local = await session.acceptVault(vault);
  const owner = await session.owner,
    sig = await pair(true),
    enc = await pair(false);
  const entries = [...created.registryBundle.entries];
  for (const [key, role, capabilities] of [
    [sig, "agent_sig", ["run_request", "result_write"]],
    [enc, "agent_enc", []],
  ]) {
    const cert = {
      artifactType: "key_certificate",
      contractVersion: core.CONTRACT,
      vaultId: vault.vaultId,
      ownerSubject: owner,
      certificateId: core.randomId("cert_"),
      keyId: key.keyId,
      role,
      publicJwk: key.publicJwk,
      principalId: "agent_A",
      connectionId: "connection_A",
      keyEpoch: 1,
      issuerKeyId: vault.rootKeyId,
      notBefore: 1090,
      expiresAt: 3000,
      capabilities,
    };
    entries.push({ certificate: await sign(cert, session.root, vault.rootKeyId), active: true });
  }
  clock = 1090;
  const bundle = await session.bundle(entries, session.registry);
  vault = { ...vault, registryHistory: [...vault.registryHistory, bundle], version: 2 };
  await session.acceptVault(vault);
  clock = 1200;
  return {
    uid,
    owner,
    session,
    material,
    local,
    sig,
    enc,
    get vault() {
      return vault;
    },
    set vault(v) {
      vault = v;
    },
    time(n) {
      clock = n;
    },
  };
}
function content() {
  return {
    title: "Synthetic report",
    summary: "Only synthetic positions.",
    sections: [
      {
        sectionId: "summary",
        markdown: "## Summary\nA **synthetic** result. [Source](https://example.test/research)",
      },
    ],
    citations: [
      {
        citationId: "citation_A",
        title: "Synthetic source",
        url: "https://example.test/research",
        provenance: "agent_provided",
        publishedAt: null,
      },
    ],
    limitations: ["Synthetic validation only."],
  };
}
async function result(f, options = {}) {
  const accepted = options.accepted ?? 1100,
    revision = options.revision ?? 1;
  const registry = f.session.registry,
    vault = f.vault,
    device = f.session.device;
  const recipientIds = [...registry.certificates.values()]
    .filter((c) => ["device_enc", "recovery_enc"].includes(c.role))
    .map((c) => c.keyId)
    .sort();
  const grantPayload = {
    artifactType: "agent_key_grant",
    contractVersion: core.CONTRACT,
    vaultId: vault.vaultId,
    ownerSubject: f.owner,
    authorizationId: "authorization_A",
    deviceSigningKeyId: device.sigId,
    connectionId: "connection_A",
    taskId: "task_A",
    taskVersions: [1],
    executionEpoch: 1,
    grantId: "grant_A",
    grantEpoch: 1,
    agentSigningKeyId: f.sig.keyId,
    agentSigningKeyEpoch: 1,
    agentEncryptionKeyId: f.enc.keyId,
    agentEncryptionKeyEpoch: 1,
    keyEpoch: 1,
    resourceBindings: [],
    capabilities: ["decrypt_task", "encrypt_result"],
    writebackRecipientKeyIds: recipientIds,
    historyPolicy: "selected",
    notBefore: 1090,
    expiresAt: 2000,
    registrySequence: registry.checkpoint.registrySequence,
    checkpointDigest: registry.digest,
  };
  const agentKeyGrant = await sign(grantPayload, device.sig, device.sigId);
  const intent = {
    artifactType: "begin_run_intent",
    contractVersion: core.CONTRACT,
    ownerSubject: f.owner,
    vaultId: vault.vaultId,
    stableOperationId: core.randomId(),
    taskId: "task_A",
    expectedTaskVersion: 1,
    taskEnvelopeFingerprint: "a".repeat(64),
    resourceVersions: [],
    connectionId: "connection_A",
    authorizationId: "authorization_A",
    grantId: "grant_A",
    grantEpoch: 1,
    executionEpoch: 1,
    keyEpoch: 1,
    registrySequence: registry.checkpoint.registrySequence,
    checkpointDigest: registry.digest,
  };
  const signedBeginIntent = await sign(intent, f.sig.privateKey, f.sig.keyId),
    beginIntentFingerprint = await core.signingFingerprint(signedBeginIntent);
  const namespace = [
    f.owner,
    vault.vaultId,
    intent.connectionId,
    intent.authorizationId,
    intent.grantId,
    intent.grantEpoch,
    intent.taskId,
    intent.stableOperationId,
    beginIntentFingerprint,
  ];
  const allocation = {};
  for (const [field, prefix] of [
    ["runId", "run"],
    ["manifestId", "manifest"],
    ["initialResultId", "result"],
  ])
    allocation[field] =
      prefix +
      "_" +
      (await core.sha(core.canonical([`folioview.${prefix}-allocation.v1`, ...namespace])));
  const run = {
    contractVersion: core.CONTRACT,
    vaultId: vault.vaultId,
    ...allocation,
    taskId: "task_A",
    taskVersion: 1,
    executionEpoch: 1,
    connectionId: "connection_A",
    grantId: "grant_A",
    grantEpoch: 1,
    authorizationId: "authorization_A",
    keyEpoch: 1,
    state: "submitted",
    beginIntentFingerprint,
    createdAt: iso(1095),
    expiresAt: iso(1900),
  };
  const manifest = {
    contractVersion: core.CONTRACT,
    vaultId: vault.vaultId,
    manifestId: run.manifestId,
    runId: run.runId,
    taskId: run.taskId,
    taskVersion: run.taskVersion,
    connectionId: run.connectionId,
    grantId: run.grantId,
    grantEpoch: run.grantEpoch,
    executionEpoch: run.executionEpoch,
    keyEpoch: run.keyEpoch,
    beginIntentFingerprint,
    signedBeginIntent,
    taskEnvelope: {
      objectId: run.taskId,
      objectType: "task",
      revision: 1,
      deliveryRevision: 2,
      envelopeFingerprint: intent.taskEnvelopeFingerprint,
      keyEpoch: 1,
    },
    entries: [],
    createdAt: run.createdAt,
    expiresAt: run.expiresAt,
  };
  const manifestFingerprint = await core.sha(core.canonical(manifest));
  const binding = {
    taskId: run.taskId,
    taskVersion: run.taskVersion,
    runId: run.runId,
    manifestId: run.manifestId,
    taskEnvelopeFingerprint: intent.taskEnvelopeFingerprint,
    manifestFingerprint,
    connectionId: run.connectionId,
    grantId: run.grantId,
    grantEpoch: run.grantEpoch,
    executionEpoch: run.executionEpoch,
    resourceRef: null,
    sourceRevision: null,
    sourceEpoch: null,
  };
  const recipients = recipientIds.map((kid) => {
    const c = registry.certificates.get(kid);
    return {
      keyId: c.keyId,
      role: c.role,
      principalId: c.principalId,
      connectionId: c.connectionId,
      keyEpoch: c.keyEpoch,
    };
  });
  const context = {
    contractVersion: core.CONTRACT,
    profileId: "P1",
    ownerSubject: f.owner,
    vaultId: vault.vaultId,
    rootKeyId: vault.rootKeyId,
    rootEpoch: 1,
    registrySequence: registry.checkpoint.registrySequence,
    checkpointDigest: registry.digest,
    keyEpoch: 1,
    objectId: run.initialResultId,
    objectType: "result_revision",
    revision,
    deliveryRevision: 1,
    priorEnvelopeFingerprint: null,
    expectedRevision: revision - 1,
    stableOperationId: core.randomId(),
    operationType: revision === 1 ? "submit_result" : "revise_result",
    authorSigningKeyId: f.sig.keyId,
    binding,
    resourceBindings: [],
    recipients,
  };
  const payload = {
    privateSchemaVersion: 2,
    objectId: context.objectId,
    objectType: context.objectType,
    revision,
    binding,
    payload: options.content ?? content(),
  };
  const encrypt = new jose.GeneralEncrypt(new TextEncoder().encode(core.canonical(payload)))
    .setProtectedHeader({
      alg: "ECDH-ES+A256KW",
      enc: "A256GCM",
      typ: "fv-private+jwe",
      cty: "application/json",
    })
    .setAdditionalAuthenticatedData(new TextEncoder().encode(core.canonical(context)));
  for (const kid of recipientIds)
    encrypt
      .addRecipient(
        await jose.importJWK(registry.certificates.get(kid).publicJwk, "ECDH-ES+A256KW"),
      )
      .setUnprotectedHeader({ kid });
  const jwe = await encrypt.encrypt(),
    signedObject = await sign({ context, jwe }, f.sig.privateKey, f.sig.keyId, "fv-object+jws"),
    fingerprint = await core.signingFingerprint(signedObject);
  const metadata = {
    resultId: context.objectId,
    taskId: run.taskId,
    runId: run.runId,
    revision,
    deliveryRevision: 1,
    envelopeFingerprint: fingerprint,
    connectionId: run.connectionId,
    receivedAt: iso(1005),
    taskVersion: run.taskVersion,
    stateVersion: revision + 2,
    read: false,
    starred: false,
    archived: false,
    manifestId: run.manifestId,
    keyEpoch: run.keyEpoch,
  };
  const receipt = {
    contractVersion: core.CONTRACT,
    vaultId: vault.vaultId,
    runId: run.runId,
    taskId: run.taskId,
    resultId: context.objectId,
    revision,
    deliveryRevision: 1,
    stableOperationId: context.stableOperationId,
    envelopeFingerprint: fingerprint,
    receivedAt: iso(accepted),
    resultPath: `/results/${context.objectId}?revision=${revision}`,
  };
  const evidence = {
    contractVersion: core.CONTRACT,
    profile: "folioview.owner-result-evidence.v1",
    run,
    manifest,
    manifestFingerprint,
    receipt,
    agentKeyGrant,
    authorizationExpiresAt: 2500,
    provenance: {
      kind: "authorized_connection_submission",
      provider: "muse",
      clientId: "synthetic_client",
      connectionId: run.connectionId,
      authorizationId: run.authorizationId,
      agentPrincipalId: "agent_A",
    },
    authorProof: { registrySequence: vault.registryHistory.length, verifiedAt: accepted },
    registryProofs: [],
  };
  for (let i = 0; i < vault.registryHistory.length; i++)
    evidence.registryProofs.push({
      registrySequence: i + 1,
      checkpointDigest: await core.sha(core.canonical(value(vault.registryHistory[i].checkpoint))),
      path: `/api/v2/results/${context.objectId}/revisions/${revision}/registries/${i + 1}`,
    });
  return {
    result: {
      contractVersion: core.CONTRACT,
      metadata,
      signedObject,
      keyProofs: {
        checkpoint: registry.bundle.checkpoint,
        certificates: registry.bundle.entries.map((e) => e.certificate),
      },
    },
    evidence,
    registryBundles: clone(vault.registryHistory),
  };
}
async function resign(f, args, mutate) {
  const changed = clone(args),
    message = value(changed.result.signedObject);
  mutate(message);
  changed.result.signedObject = await sign(message, f.sig.privateKey, f.sig.keyId, "fv-object+jws");
  const fingerprint = await core.signingFingerprint(changed.result.signedObject);
  changed.result.metadata.envelopeFingerprint = fingerprint;
  changed.evidence.receipt.envelopeFingerprint = fingerprint;
  return changed;
}

test("real agent result opens only after root chain, grant, deterministic Run, frozen manifest, receipt and AEAD verification", async () => {
  const f = await fixture(),
    args = await result(f);
  assert.deepEqual(await f.session.openResult(args), content());
  assert.equal(
    args.result.metadata.receivedAt,
    iso(1005),
    "arrival sorting time deliberately predates the accepted author certificate",
  );
  const packet = await f.session.signResultState({
    metadata: args.result.metadata,
    changes: { read: true, starred: true, archived: false },
  });
  const command = value(packet.command);
  assert.equal(command.expectedVersion, args.result.metadata.stateVersion);
  assert.equal(command.targetId, args.result.metadata.resultId);
  assert.equal(command.expectedSourceEpoch, null);
  assert.equal(command.action, "result_state_update");
  assert.equal(packet.operationId, command.stableOperationId);
  assert.deepEqual(command.parameters, { read: true, starred: true, archived: false });
  await jose.flattenedVerify(
    packet.command,
    await jose.importJWK(f.session.device.sigJwk, "ES256"),
    { algorithms: ["ES256"] },
  );
});

test("owner historical recovery survives later revocation and expiry without reopening current state-write authority", async () => {
  const f = await fixture(),
    args = await result(f, { revision: 2, accepted: 1120 });
  const previous = f.session.registry,
    revoked = [...previous.certificates.keys()].sort();
  f.time(1250);
  const descriptions = previous.bundle.entries.map((entry) => ({
    certificateId: value(entry.certificate).certificateId,
    payloadDigest: null,
    active: false,
  }));
  for (let i = 0; i < descriptions.length; i++)
    descriptions[i].payloadDigest = await core.sha(
      core.canonical(value(previous.bundle.entries[i].certificate)),
    );
  descriptions.sort((a, b) => (a.certificateId < b.certificateId ? -1 : 1));
  const checkpoint = {
    ...previous.checkpoint,
    registrySequence: 3,
    previousDigest: previous.digest,
    entriesDigest: await core.sha(core.canonical(descriptions)),
    revokedKeyIds: revoked,
    issuedAt: 1250,
  };
  const revocation = {
    contractVersion: core.CONTRACT,
    checkpoint: await sign(checkpoint, f.session.root, f.vault.rootKeyId),
    entries: previous.bundle.entries.map((entry) => ({ ...entry, active: false })),
  };
  f.vault = { ...f.vault, version: 3, registryHistory: [...f.vault.registryHistory, revocation] };
  await assert.rejects(f.session.acceptVault(f.vault), /key_revoked/);
  assert.equal((await f.session.acceptResultVault(f.vault)).canWriteState, false);
  f.time(4000);
  assert.deepEqual(await f.session.openResult(args), content());
  await assert.rejects(
    f.session.signResultState({ metadata: args.result.metadata, changes: { read: true } }),
    /key_revoked/,
  );
  const fresh = new core.VaultCore(f.uid, () => 4000);
  assert.deepEqual(await fresh.unlockForResults(f.vault, f.material()), { canWriteState: false });
  await fresh.acceptResultVault(f.vault);
  assert.deepEqual(
    await fresh.openResult(args),
    content(),
    "fresh device uses retained recovery key without device registration",
  );
  await assert.rejects(
    fresh.signResultState({ metadata: args.result.metadata, changes: { starred: true } }),
    /locked|device_required/,
  );
});

test("cross-user roots and modified evidence, metadata, proofs or receipt fail before plaintext is returned", async () => {
  const f = await fixture(),
    other = await fixture("synthetic_owner_B"),
    args = await result(f);
  await assert.rejects(other.session.openResult(args));
  for (const mutate of [
    (a) => {
      a.result.metadata.resultId = "foreign_result";
    },
    (a) => {
      a.result.metadata.revision = 2;
    },
    (a) => {
      a.result.metadata.keyEpoch = 2;
    },
    (a) => {
      a.result.signedObject.signature = "A".repeat(86);
    },
    (a) => {
      a.evidence.receipt.runId = "foreign_run";
    },
    (a) => {
      a.evidence.receipt.envelopeFingerprint = "b".repeat(64);
    },
    (a) => {
      a.evidence.authorProof.verifiedAt++;
    },
    (a) => {
      a.evidence.manifest.entries.push({});
    },
    (a) => {
      a.evidence.provenance.connectionId = "connection_B";
    },
    (a) => {
      a.evidence.registryProofs[1].path += "?owner=other";
    },
    (a) => {
      a.registryBundles.shift();
    },
    (a) => {
      a.result.keyProofs.certificates.pop();
    },
  ]) {
    const changed = clone(args);
    mutate(changed);
    await assert.rejects(f.session.openResult(changed));
  }
});

test("validly signed but wrong context, key epoch, deterministic allocation or tampered AEAD is rejected", async () => {
  const f = await fixture(),
    args = await result(f);
  for (const mutate of [
    (m) => {
      m.context.binding.manifestFingerprint = "b".repeat(64);
    },
    (m) => {
      m.context.binding.connectionId = "connection_B";
    },
    (m) => {
      m.context.keyEpoch = 2;
    },
    (m) => {
      m.context.expectedRevision = 9;
    },
    (m) => {
      m.context.recipients.reverse();
    },
    (m) => {
      m.context.priorEnvelopeFingerprint = "b".repeat(64);
    },
    (m) => {
      m.jwe.ciphertext = (m.jwe.ciphertext[0] === "A" ? "B" : "A") + m.jwe.ciphertext.slice(1);
    },
  ])
    await assert.rejects(f.session.openResult(await resign(f, args, mutate)));
  const changed = clone(args);
  changed.evidence.run.runId = "run_wrong";
  await assert.rejects(f.session.openResult(changed));
});

test("encrypted reports retain ordinary HTTPS query ampersands and harmless named text entities", async () => {
  const f = await fixture(),
    c = content();
  c.sections[0].markdown =
    "A &amp; B &copy; 2026. [Source](https://example.test/path?one=1&two=2&list=all&tab=report).";
  c.citations[0].url = "https://example.test/path?one=1&two=2&list=all&tab=report";
  assert.deepEqual(await f.session.openResult(await result(f, { content: c })), c);
});

test("private schema, HTML, images, entity-hidden protocols and unsafe citation URLs never escape the Worker", async () => {
  const f = await fixture();
  for (const markdown of [
    "<script>alert(1)</script>",
    "&lt;img src=x onerror=alert(1)&gt;",
    "&LT;script&GT;alert(1)&LT;/script&GT;",
    "&AMP;lt;img src=x onerror=alert(1)&AMP;gt;",
    "![tracking](https://example.test/pixel)",
    "[bad](javascript:alert(1))",
    "[bad](java&#x73;cript:alert(1))",
    "[bad](javascript&colon;alert(1))",
    "[bad](java&Tab;script:alert(1))",
    "[bad](java&NewLine;script:alert(1))",
    "[bad](https://u:p@example.test/)",
    "[bad](https://example.test:8443/path)",
  ]) {
    const c = content();
    c.sections[0].markdown = markdown;
    await assert.rejects(
      f.session.openResult(await result(f, { content: c })),
      /unsafe_content|invalid_data/,
    );
  }
  const duplicate = content();
  duplicate.sections.push(clone(duplicate.sections[0]));
  await assert.rejects(
    f.session.openResult(await result(f, { content: duplicate })),
    /invalid_data/,
  );
  const privateFields = content();
  privateFields.privateHtml = "<iframe>";
  await assert.rejects(
    f.session.openResult(await result(f, { content: privateFields })),
    /invalid_data/,
  );
  const citation = content();
  citation.citations[0].url = "https://user:password@example.test/";
  await assert.rejects(
    f.session.openResult(await result(f, { content: citation })),
    /unsafe_content/,
  );
});

test("state commands reject empty/unknown/nonboolean changes and use new stable operations at the current checkpoint", async () => {
  const f = await fixture(),
    args = await result(f);
  for (const changes of [
    {},
    { read: "yes" },
    { owner: "other" },
    { read: true, resultId: "other" },
  ])
    await assert.rejects(
      f.session.signResultState({ metadata: args.result.metadata, changes }),
      /invalid_data/,
    );
  const a = await f.session.signResultState({
    metadata: args.result.metadata,
    changes: { archived: true },
  });
  const b = await f.session.signResultState({
    metadata: args.result.metadata,
    changes: { archived: true },
  });
  assert.notEqual(a.operationId, b.operationId);
  assert.equal(value(a.command).registrySequence, f.session.registry.checkpoint.registrySequence);
  assert.equal(value(a.command).checkpointDigest, f.session.registry.digest);
});

class MemoryStorage {
  records = new Map();
  async get(key) {
    return clone(this.records.get(key));
  }
  async commitVault(owner, record) {
    storageModule.assertPinAdvance(this.records.get(owner + ":pin"), record);
    this.records.set(owner + ":pin", clone(record.pin));
    this.records.set(owner + ":device:" + record.pin.vaultId, {
      ownerSubject: owner,
      device: clone(record.device),
    });
  }
}
class LocalWorker {
  stopped = false;
  queue = Promise.resolve();
  postMessage(message, transfer = []) {
    const copied = structuredClone(message, { transfer });
    this.queue = this.queue.then(async () => {
      if (this.stopped) return;
      try {
        const { method, args } = copied;
        let result;
        if (method === "init") {
          this.core = new core.VaultCore(args.uid, () => 1200);
          result = { ownerSubject: await this.core.owner };
        } else {
          if (this.pause) await this.pause;
          if (this.stopped) return;
          if (method === "unlockForResults")
            result = await this.core.unlockForResults(args.vault, args.material, args.local);
          else if (method === "acceptResultVault")
            result = await this.core.acceptResultVault(args.vault);
          else result = await this.core[method](args);
        }
        if (!this.stopped) this.onmessage({ data: { id: copied.id, ok: true, result } });
      } catch (e) {
        if (!this.stopped)
          this.onmessage({ data: { id: copied.id, ok: false, error: e.code ?? "crypto_failed" } });
      }
    });
  }
  terminate() {
    this.stopped = true;
    this.core = null;
  }
}
test("Worker bridge transfers PRF, persists only public pins and sealed material, and closes delayed result/state responses on lock", async () => {
  const f = await fixture(),
    args = await result(f),
    storage = new MemoryStorage(),
    worker = new LocalWorker();
  storage.records.set(f.owner + ":pin", clone(f.local.pin));
  storage.records.set(f.owner + ":device:" + f.vault.vaultId, {
    ownerSubject: f.owner,
    device: clone(f.local.device),
  });
  const session = new bridge.EncryptedVaultSession(f.uid, { storage, workerFactory: () => worker });
  const material = f.material();
  assert.deepEqual(await session.unlockForResults(f.vault, material), { canWriteState: true });
  assert.equal(material.secret.byteLength, 0);
  assert.deepEqual(await session.acceptResultVault(f.vault), { canWriteState: true });
  assert.deepEqual(await session.openResult(args), content());
  const packet = await session.signResultState({
    metadata: args.result.metadata,
    changes: { starred: true },
  });
  assert.equal(value(packet.command).targetId, args.result.metadata.resultId);
  assert.ok(!JSON.stringify([...storage.records]).includes(content().title));
  let resume;
  worker.pause = new Promise((resolve) => {
    resume = resolve;
  });
  const opening = session.openResult(args),
    signing = session.signResultState({
      metadata: args.result.metadata,
      changes: { archived: true },
    });
  await new Promise((resolve) => setImmediate(resolve));
  session.lock();
  await assert.rejects(opening, /locked/);
  await assert.rejects(signing, /locked/);
  resume();
  await worker.queue;
  assert.equal(worker.stopped, true);
  await assert.rejects(session.openResult(args), /locked/);
  assert.ok(!JSON.stringify([...storage.records]).includes(content().summary));
});

test("readonly recovery enrollment persists an anti-rollback pin without manufacturing a device key", async () => {
  const f = await fixture(),
    args = await result(f),
    storage = new MemoryStorage(),
    worker = new LocalWorker();
  const session = new bridge.EncryptedVaultSession(f.uid, { storage, workerFactory: () => worker });
  assert.deepEqual(await session.unlockForResults(f.vault, f.material()), { canWriteState: false });
  await session.acceptResultVault(f.vault);
  assert.deepEqual(await session.openResult(args), content());
  assert.equal((await storage.get(f.owner + ":device:" + f.vault.vaultId)).device, undefined);
  assert.equal((await storage.get(f.owner + ":pin")).registrySequence, 2);
  await assert.rejects(
    session.signResultState({ metadata: args.result.metadata, changes: { read: true } }),
    /locked|device_required/,
  );
  session.lock();
});

test("browser-generated result and state command verify with the independent Python shared contract", async (t) => {
  const root = path.resolve(__dirname, "../../.."),
    python = path.join(root, "services/market-data-service/.venv/bin/python");
  if (!existsSync(python)) {
    t.skip("Python shared-contract environment is not installed in this Web-only runner");
    return;
  }
  const f = await fixture(),
    args = await result(f),
    packet = await f.session.signResultState({
      metadata: args.result.metadata,
      changes: { read: true },
    });
  const script = `import json,sys\nsys.path.insert(0,'services/common')\nfrom folioview_shared.encrypted.authority import verify_registry,verify_agent_grant,verify_control_command\nfrom folioview_shared.encrypted.manifests import verify_manifest,ManifestExpectation\nfrom folioview_shared.encrypted.envelope import verify_carrier,EnvelopeExpectation,validate_result_receipt\nfrom folioview_shared.encrypted.jsonutil import b64url_decode\nv=json.load(sys.stdin);a=v['args'];e=a['evidence'];r=None\nfor b in a['registryBundles']:\n r=verify_registry(b,root_jwk=v['root'],pinned_root_key_id=v['rootId'],owner_subject=v['owner'],vault_id=v['vault'],now=1100,previous=r)\nrun=e['run'];g=verify_agent_grant(e['agentKeyGrant'],registry=r,owner_subject=v['owner'],vault_id=v['vault'],connection_id=run['connectionId'],authorization_id=run['authorizationId'],task_id=run['taskId'],task_version=run['taskVersion'],execution_epoch=run['executionEpoch'],grant_id=run['grantId'],grant_epoch=run['grantEpoch'],now=1100,authorization_expires_at=e['authorizationExpiresAt'])\nm=verify_manifest(e['manifest'],run,registry=r,grant=g,expectation=ManifestExpectation(v['owner'],v['vault'],run['runId'],run['manifestId'],run['initialResultId'],run['beginIntentFingerprint']),now=1100)\ns=a['result']['signedObject'];c=json.loads(b64url_decode(s['payload']))['context'];ex=EnvelopeExpectation(v['owner'],v['vault'],c['objectId'],'result_revision',1,0,'submit_result',g['agentSigningKeyId'],c['binding'],[],tuple(g['writebackRecipientKeyIds']))\nverified=verify_carrier({'contractVersion':'folioview.agent-workspace.v2.0','signedObject':s},registry=r,expectation=ex,now=1100,contract_header='folioview.agent-workspace.v2.0',grant=g)\nvalidate_result_receipt(e['receipt'],context=verified.context,fingerprint=verified.fingerprint)\nverify_control_command(v['packet']['command'],registry=r,expected_action='result_state_update',expected_target_id=c['objectId'],expected_version=a['result']['metadata']['stateVersion'],expected_source_epoch=None,expected_parameters={'read':True},now=1200)\nprint('verified')`;
  const checked = spawnSync(python, ["-c", script], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      args,
      packet,
      root: f.vault.rootJwk,
      rootId: f.vault.rootKeyId,
      owner: f.owner,
      vault: f.vault.vaultId,
    }),
    timeout: 15000,
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stdout.trim(), "verified");
});
