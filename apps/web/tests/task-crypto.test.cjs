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
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-task-crypto-"));
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
test("task content is encrypted before transport and exact owner recipients decrypt across relogin", async () => {
  const f = await fixture(),
    { task, pending } = await create(f);
  const c = decoded(task.signedObject).context;
  assert.deepEqual(await f.session.openTask(task), content());
  assert.equal(pending.body.taskId, "synthetic_task");
  assert.equal(pending.body.expectedVersion, 0);
  assert.deepEqual(c.recipients.map((r) => r.role).sort(), ["device_enc", "recovery_enc"]);
  for (const privateValue of [
    content().name,
    content().goal,
    content().outputSpec.label,
    "America/Toronto",
  ])
    assert.ok(!JSON.stringify(pending).includes(privateValue));
  const restored = new core.VaultCore(f.uid, () => 1000);
  await restored.unlockForResults(f.vault, f.material(), f.local);
  await restored.acceptResultVault(f.vault);
  assert.deepEqual(await restored.openTask(task), content());
  assert.deepEqual(await f.session.validateTaskPending(pending), pending);
  assert.deepEqual(await f.session.validateTaskPending(copy(pending)), pending);
});
test("private semantic validation rejects incomplete final forms, duplicate sections, unsupported schedule and duplicate refs", async () => {
  const f = await fixture();
  for (const mutate of [
    (v) => {
      v.name = "";
    },
    (v) => {
      v.outputSpec.sections.push(copy(v.outputSpec.sections[0]));
    },
    (v) => {
      v.deliveryExpectation.timeZone = "Invalid/Unknown";
    },
    (v) => {
      v.deliveryExpectation.weekday = 1;
    },
    (v) => {
      v.deliveryExpectation.localTime = "25:00";
    },
  ]) {
    const v = content();
    mutate(v);
    await assert.rejects(
      f.session.sealTask({ current: null, content: v, resourceBindings: resources() }),
      /invalid_data/,
    );
  }
  await assert.rejects(
    f.session.sealTask({ current: null, content: content(), resourceBindings: [] }),
    /invalid_data/,
  );
  await assert.rejects(
    f.session.sealTask({
      current: null,
      content: content(),
      resourceBindings: [...resources(), ...resources()],
    }),
    /invalid_data/,
  );
  const oversized = content();
  oversized.name = "\0".repeat(80);
  oversized.goal = "\0".repeat(2000);
  oversized.outputSpec.sections = Array.from({ length: 8 }, (_, i) => ({
    sectionId: "part" + i,
    title: "\0".repeat(120),
    instructions: "\0".repeat(1000),
  }));
  await assert.rejects(
    f.session.sealTask({ current: null, content: oversized, resourceBindings: resources() }),
    /too_large/,
  );
});
test("historical task validation rejects owner, metadata, fingerprint, registry, context and ciphertext tampering", async () => {
  const f = await fixture(),
    { task } = await create(f),
    other = await fixture("synthetic_B");
  await assert.rejects(other.session.openTask(task));
  for (const mutate of [
    (t) => {
      t.metadata.taskId = "another";
    },
    (t) => {
      t.metadata.keyEpoch++;
    },
    (t) => {
      t.metadata.envelopeFingerprint = "0".repeat(64);
    },
    (t) => {
      t.metadata.updatedAt = "1970-01-01T00:00:00Z";
    },
    (t) => {
      t.keyProofs.certificates.pop();
    },
    (t) => {
      t.signedObject.signature = t.signedObject.signature.slice(0, -2) + "AA";
    },
  ]) {
    const changed = copy(task);
    mutate(changed);
    await assert.rejects(f.session.openTask(changed));
  }
  const changed = copy(task),
    message = decoded(changed.signedObject);
  message.jwe.ciphertext = "AA" + message.jwe.ciphertext.slice(2);
  changed.signedObject = await signed(
    f,
    message,
    "fv-object+jws",
    f.session.device.sig,
    f.session.device.sigId,
  );
  changed.metadata.envelopeFingerprint = await core.signingFingerprint(changed.signedObject);
  await assert.rejects(f.session.openTask(changed), /decryption_failed/);
});
test("history remains readable after current writer revocation; new writes and replay do not", async () => {
  const f = await fixture(),
    { task, pending } = await create(f),
    oldWriter = f.session.device.sigId;
  // A second authorized writer keeps the registry structurally usable.
  const keys = await jose.generateKeyPair("ES256", { crv: "P-256", extractable: true }),
    jwk = await jose.exportJWK(keys.publicKey);
  const certificate = await f.session.certificate("device_sig", jwk, "synthetic_second_device");
  await advance(f, {
    revoke: [oldWriter],
    entries: [
      ...f.vault.registryHistory
        .at(-1)
        .entries.map((e) => ({ ...e, active: decoded(e.certificate).keyId !== oldWriter })),
      { certificate, active: true },
    ],
  });
  assert.deepEqual(await f.session.openTask(task), content());
  await assert.rejects(
    f.session.sealTask({ current: task, content: content(), resourceBindings: resources() }),
    /key_revoked/,
  );
  await assert.rejects(f.session.validateTaskPending(pending), /key_revoked/);
  const restored = new core.VaultCore(f.uid, () => 1000);
  await restored.unlockForResults(f.vault, f.material(), f.local);
  await restored.acceptResultVault(f.vault);
  assert.deepEqual(await restored.openTask(task), content());
});
test("history verifies author certificate at saved time and independently pinned complete registry history", async () => {
  const f = await fixture(),
    { task } = await create(f);
  f.setNow(40000000);
  assert.deepEqual(await f.session.openTask(task), content());
  await assert.rejects(f.session.taskAuthority(), /key_revoked/);
  f.setNow(1000);
  await advance(f);
  const updated = await f.session.sealTask({
    current: task,
    content: { ...content(), goal: "Private updated goal" },
    resourceBindings: resources(),
  });
  const t2 = await saved(f, updated, task);
  assert.deepEqual(await f.session.openTask(t2), { ...content(), goal: "Private updated goal" });
  const full = f.session.vault.registryHistory;
  f.session.vault = { ...f.session.vault, registryHistory: full.slice(1) };
  await assert.rejects(f.session.openTask(t2), /registry_conflict|binding_mismatch/);
});
test("pause/resume/archive preserve encrypted private rules and carry exact control intent", async () => {
  const f = await fixture(),
    { task } = await create(f);
  let current = task;
  for (const [action, status, epoch] of [
    ["pause", "paused", 2],
    ["resume", "active", 2],
    ["archive", "archived", 3],
  ]) {
    const p = await f.session.transitionTask({ current, action }),
      intent = decoded(p.body.transitionIntent);
    assert.equal(intent.action, action);
    assert.equal(intent.nextExecutionEpoch, epoch);
    assert.equal(intent.nextEnvelopeFingerprint, p.envelopeFingerprint);
    assert.equal(intent.expectedVersion, current.metadata.taskVersion);
    assert.deepEqual(p.body.resourceBindings, current.metadata.resourceBindings);
    await f.session.validateTaskPending(p);
    current = await saved(f, p, current);
    assert.equal(current.metadata.status, status);
    assert.deepEqual(await f.session.openTask(current), content());
  }
  await assert.rejects(f.session.transitionTask({ current, action: "resume" }), /version_conflict/);
  await assert.rejects(
    f.session.sealTask({ current, content: content(), resourceBindings: resources() }),
    /version_conflict/,
  );
});
test("new task ciphertext is tied to current directory, replay keeps original body and rejects changed packet or epoch", async () => {
  const f = await fixture(),
    { pending, task } = await create(f),
    original = JSON.stringify(pending);
  for (const mutate of [
    (p) => {
      p.operationId = "different_operation";
    },
    (p) => {
      p.body.expectedVersion++;
    },
    (p) => {
      p.body.resourceBindings[0].sourceEpoch++;
    },
    (p) => {
      p.envelopeFingerprint = "0".repeat(64);
    },
  ]) {
    const p = copy(pending);
    mutate(p);
    await assert.rejects(f.session.validateTaskPending(p));
  }
  await f.session.validateTaskPending(pending);
  assert.equal(JSON.stringify(pending), original);
  await advance(f, { keyEpoch: 2 });
  await assert.rejects(f.session.validateTaskPending(pending), /stale_epoch/);
  const next = await f.session.sealTask({
    current: task,
    content: content(),
    resourceBindings: resources(),
  });
  assert.equal(next.keyEpoch, 2);
  assert.notEqual(next.operationId, pending.operationId);
  assert.notEqual(next.envelopeFingerprint, pending.envelopeFingerprint);
});
test("incomplete local drafts are sealed, owner/task/baseVersion authenticated and restore from the same Passkey", async () => {
  const f = await fixture(),
    draft = { content: content(), resourceBindings: [] };
  draft.content.name = "";
  draft.content.goal = "";
  draft.content.inputPolicy.maxFetchedAgeSeconds = -1;
  const sealed = await f.session.sealDraft({
    slot: "new",
    revision: 1,
    baseVersion: 0,
    taskId: "synthetic_draft",
    draft,
  });
  assert.ok(!JSON.stringify(sealed).includes("Synthetic risk"));
  const fresh = new core.VaultCore(f.uid, () => 1000);
  await fresh.unlockForResults(f.vault, f.material(), f.local);
  await fresh.acceptResultVault(f.vault);
  assert.deepEqual((await fresh.openDraft(sealed)).draft, draft);
  for (const mutate of [
    (r) => {
      r.baseVersion++;
    },
    (r) => {
      r.taskId = "other_task";
    },
    (r) => {
      r.ownerSubject = "other_owner";
    },
    (r) => {
      r.revision++;
    },
    (r) => {
      r.slot = "other_task";
    },
  ]) {
    const r = copy(sealed);
    mutate(r);
    await assert.rejects(fresh.openDraft(r));
  }
  const bad = copy(draft);
  bad.content.unrecognized = "private";
  await assert.rejects(
    f.session.sealDraft({
      slot: "new",
      revision: 1,
      baseVersion: 0,
      taskId: "synthetic_draft",
      draft: bad,
    }),
    /invalid_data/,
  );
});
test("agent keys never become task recipients automatically and signed recipient/control mismatches fail closed", async () => {
  const f = await fixture(),
    { task } = await create(f);
  const keys = await jose.generateKeyPair("ECDH-ES", { crv: "P-256", extractable: true }),
    jwk = await jose.exportJWK(keys.publicKey);
  const agent = {
    ...decoded(
      f.created.registryBundle.entries.find((e) => decoded(e.certificate).role === "device_enc")
        .certificate,
    ),
    certificateId: core.randomId("cert_"),
    keyId: await jose.calculateJwkThumbprint(jwk),
    publicJwk: jwk,
    role: "agent_enc",
    principalId: "synthetic_agent",
    connectionId: "synthetic_connection",
    capabilities: [],
  };
  await advance(f, {
    entries: [
      ...f.vault.registryHistory.at(-1).entries,
      { certificate: await signed(f, agent), active: true },
    ],
  });
  const p = await f.session.sealTask({
    current: task,
    content: content(),
    resourceBindings: resources(),
  });
  assert.ok(
    !decoded(p.body.envelope.signedObject).context.recipients.some((r) => r.keyId === agent.keyId),
  );
  const changed = copy(p),
    message = decoded(changed.body.envelope.signedObject);
  message.context.recipients.push({
    keyId: agent.keyId,
    role: agent.role,
    principalId: agent.principalId,
    connectionId: agent.connectionId,
    keyEpoch: agent.keyEpoch,
  });
  message.context.recipients.sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
  changed.body.envelope.signedObject = await signed(
    f,
    message,
    "fv-object+jws",
    f.session.device.sig,
    f.session.device.sigId,
  );
  changed.envelopeFingerprint = await core.signingFingerprint(changed.body.envelope.signedObject);
  await assert.rejects(f.session.validateTaskPending(changed), /binding_mismatch/);
  const transition = await f.session.transitionTask({ current: task, action: "pause" }),
    intent = decoded(transition.body.transitionIntent);
  intent.nextEnvelopeFingerprint = "0".repeat(64);
  transition.body.transitionIntent = await signed(
    f,
    intent,
    "fv-control+jws",
    f.session.device.sig,
    f.session.device.sigId,
  );
  await assert.rejects(f.session.validateTaskPending(transition), /binding_mismatch/);
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
test("real IndexedDB preserves sealed drafts/outbox across lock, owner changes and cross-tab CAS conflicts", async () => {
  const fake = require("fake-indexeddb"),
    previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    previousRange = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: fake.IDBKeyRange });
  const sessions = [];
  try {
    const f = await fixture(),
      storage = new storageModule.BrowserEncryptedStorage();
    await storage.commitVault(await f.session.owner, f.local);
    async function session(uid = f.uid) {
      const s = new bridge.EncryptedVaultSession(uid, {
        storage: new storageModule.BrowserEncryptedStorage(),
        workerFactory: () => new LocalWorker(),
      });
      sessions.push(s);
      if (uid === f.uid) {
        await s.unlock(f.vault, f.material());
        await s.acceptVault(f.vault);
      }
      return s;
    }
    const a = await session(),
      b = await session(),
      d = {
        slot: "new",
        expectedRevision: 0,
        taskId: "synthetic_draft",
        baseVersion: 0,
        draft: { content: content(), resourceBindings: resources() },
      };
    const attempts = await Promise.allSettled([a.saveTaskDraft(d), b.saveTaskDraft(d)]);
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((r) => r.status === "rejected")[0].reason.code, "draft_conflict");
    const loaded = await a.loadTaskDraft("new");
    assert.deepEqual(loaded.draft, d.draft);
    const rows = await storage.list((await f.session.owner) + ":task-");
    assert.ok(rows.length);
    assert.ok(!JSON.stringify(rows).includes(content().goal));
    await assert.rejects(a.saveTaskDraft({ ...d, expectedRevision: 0 }), /draft_conflict/);
    await a.clearTaskDraft("new", loaded.revision);
    await assert.rejects(
      b.saveTaskDraft({ ...d, expectedRevision: loaded.revision }),
      /draft_conflict/,
    );
    const fresh = await b.saveTaskDraft(d);
    assert.ok(fresh.revision > loaded.revision);
    const p = await a.sealTask({
      current: null,
      content: content(),
      resourceBindings: resources(),
      taskId: "synthetic_task",
    });
    await assert.rejects(
      b.sealTask({
        current: null,
        content: content(),
        resourceBindings: resources(),
        taskId: "synthetic_task",
      }),
      /pending_upload/,
    );
    a.lock();
    await assert.rejects(a.openTask(await saved(f, p)), /locked/);
    const restored = await session();
    assert.deepEqual((await restored.loadTaskDraft("new")).draft, d.draft);
    assert.deepEqual(await restored.loadTaskOutbox(p.taskId), p);
    assert.equal((await restored.listTaskOutbox())[0].operationId, p.operationId);
    await assert.rejects(
      restored.clearTaskOutbox(p.taskId, "wrong_operation"),
      /operation_conflict/,
    );
    await restored.clearTaskOutbox(p.taskId, p.operationId);
    assert.equal(await restored.loadTaskOutbox(p.taskId), null);
    const delayed = await session(),
      originalHandler = delayed.worker.onmessage;
    let delayedEvent, release;
    const responseReady = new Promise((resolve) => {
      release = resolve;
    });
    delayed.worker.onmessage = (event) => {
      if (event.data.ok && event.data.result?.name === content().name) {
        delayedEvent = event;
        release();
      } else originalHandler(event);
    };
    const latePlaintext = delayed.openTask(await saved(f, p));
    await responseReady;
    delayed.lock();
    await assert.rejects(latePlaintext, /locked/);
    originalHandler(delayedEvent);
    const other = await session("synthetic_other_owner");
    await assert.rejects(other.loadTaskDraft("new"), /invalid_data/);
    const otherF = await fixture("synthetic_other_owner");
    await other.unlockForResults(otherF.vault, otherF.material());
    await other.acceptResultVault(otherF.vault);
    assert.deepEqual(await other.listTaskDrafts(), []);
    assert.deepEqual(await other.listTaskOutbox(), []);
  } finally {
    for (const s of sessions) s.lock();
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else delete globalThis.indexedDB;
    if (previousRange) Object.defineProperty(globalThis, "IDBKeyRange", previousRange);
    else delete globalThis.IDBKeyRange;
  }
});
test("browser task create/update/transition packets interoperate with the existing Python verifier", async (t) => {
  const root = path.resolve(__dirname, "../../.."),
    python = path.join(root, "services/market-data-service/.venv/bin/python");
  if (!existsSync(python)) return t.skip("Declared shared Python environment is unavailable");
  const f = await fixture(),
    { task, pending } = await create(f);
  const update = await f.session.sealTask({
    current: task,
    content: content(),
    resourceBindings: resources(),
  });
  const updated = await saved(f, update, task),
    pause = await f.session.transitionTask({ current: updated, action: "pause" });
  const result = spawnSync(
    python,
    [
      "-c",
      `import json,sys
from folioview_shared.encrypted.authority import verify_registry,verify_task_transition
from folioview_shared.encrypted.envelope import verify_carrier,EnvelopeExpectation
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.encrypted.constants import CONTRACT_VERSION
import base64
d=json.load(sys.stdin); r=None
for b in d['vault']['registryHistory']:
 r=verify_registry(b,root_jwk=d['vault']['rootJwk'],pinned_root_key_id=d['vault']['rootKeyId'],owner_subject=d['owner'],vault_id=d['vault']['vaultId'],now=1000,previous=r)
for p in d['packets']:
 c=json.loads(base64.urlsafe_b64decode(p['body']['envelope']['signedObject']['payload']+'=='))['context']
 e=EnvelopeExpectation(d['owner'],d['vault']['vaultId'],p['taskId'],'task',p['body']['expectedVersion']+1,p['body']['expectedVersion'],c['operationType'],p['authorKeyId'],c['binding'],p['body']['resourceBindings'],tuple(x['keyId'] for x in c['recipients']))
 v=verify_carrier(p['body']['envelope'],registry=r,expectation=e,now=1000,contract_header=CONTRACT_VERSION)
 assert v.fingerprint==p['envelopeFingerprint']
 if p['mode']=='transition':
  verify_task_transition(p['body']['transitionIntent'],registry=r,task_id=p['taskId'],action='pause',expected_version=2,next_task_version=3,next_execution_epoch=2,next_envelope_fingerprint=v.fingerprint,now=1000)
print('verified')`,
    ],
    {
      input: JSON.stringify({
        vault: f.vault,
        owner: await f.session.owner,
        packets: [pending, update, pause],
      }),
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: path.join(root, "services/common") },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified/);
});
