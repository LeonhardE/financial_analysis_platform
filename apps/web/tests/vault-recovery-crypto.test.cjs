const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { transformSync } = require("next/dist/build/swc");
const {
  createHarness,
  createOwner,
  decoded,
  clone,
  fullFlow,
} = require("./full-flow-crypto-fixture.cjs");
let h, storageModule, bridge, workerCode, directory;
test.before(async () => {
  h = await createHarness();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-vault-recovery-"));
  for (const name of ["encrypted-types", "encrypted-storage", "encrypted-vault"]) {
    const file = path.resolve(__dirname, "../lib/" + name + ".ts");
    let { code } = transformSync(readFileSync(file, "utf8"), {
      filename: file,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "es6" },
    });
    code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, v) => `from "./${v}.mjs"`);
    await fs.writeFile(path.join(directory, name + ".mjs"), code);
  }
  bridge = await import(pathToFileURL(path.join(directory, "encrypted-vault.mjs")).href);
  const workerFile = path.resolve(__dirname, "../lib/encrypted-vault.worker.ts");
  workerCode = transformSync(readFileSync(workerFile, "utf8"), {
    filename: workerFile,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  }).code;
  storageModule = await import(pathToFileURL(path.join(directory, "encrypted-storage.mjs")).href);
});
test.after(async () => {
  await h?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
function replacement() {
  const raw = crypto.getRandomValues(new Uint8Array(32)),
    salt = crypto.getRandomValues(new Uint8Array(32)),
    id = crypto.getRandomValues(new Uint8Array(32));
  return () => ({
    credentialId: h.core.b64(id),
    prfSalt: h.core.b64(salt),
    secret: raw.slice().buffer,
  });
}
async function state(f) {
  const cp = decoded(f.vault.registryHistory.at(-1).checkpoint);
  return {
    contractVersion: h.core.CONTRACT,
    profile: "folioview.vault-lifecycle.v1",
    vaultId: f.vault.vaultId,
    rootKeyId: f.vault.rootKeyId,
    vaultVersion: f.vault.version,
    registrySequence: cp.registrySequence,
    checkpointDigest: await h.core.sha(h.core.canonical(cp)),
    keyEpoch: cp.keyEpoch,
    lifecycleVersion: 0,
    archiveRevision: 0,
    archiveDigest: await h.core.sha(h.core.canonical(f.vault.archive)),
    archive: f.vault.archive,
    pendingAuthorization: null,
    history: [],
  };
}
async function accepted(s, command, archive) {
  const p = decoded(command),
    r = {
      profile: s.profile,
      ownerSubject: s.archive.ownerSubject,
      vaultId: s.vaultId,
      rootKeyId: s.rootKeyId,
      operationId: p.stableOperationId,
      action: p.action,
      lifecycleVersion: s.lifecycleVersion + 1,
      archiveRevision: s.archiveRevision + Number(p.action === "archive_replace"),
      archiveDigest: p.action === "archive_replace" ? p.newArchiveDigest : s.archiveDigest,
      commandFingerprint: await h.core.signingFingerprint(command),
      acceptedAt: 1000,
    };
  let pending = s.pendingAuthorization;
  if (p.action === "recovery_authorize")
    pending = {
      authorizationId: p.authorizationId,
      newArchiveDigest: p.newArchiveDigest,
      expiresAt: p.expiresAt,
      status: "active",
      command,
    };
  else pending = null;
  return {
    ...s,
    lifecycleVersion: r.lifecycleVersion,
    archiveRevision: r.archiveRevision,
    archiveDigest: r.archiveDigest,
    archive: archive ?? s.archive,
    pendingAuthorization: pending,
    history: [...s.history, { command, receipt: r }],
  };
}

test("independent kit restores original root and decrypts retained result without original PRF or a device permission", async () => {
  const flow = await fullFlow(h),
    f = flow.f,
    s = await state(f);
  const kit = await f.session.createRecoveryKit(f.vault, s);
  assert.equal(kit.code.length, 43);
  assert(!kit.file.includes(kit.code));
  assert(!kit.file.includes("rootPrivateJwk"));
  assert(!kit.file.includes("recoveryPrivateJwk"));
  const restored = new h.core.VaultCore(f.uid, f.now);
  await restored.importRecoveryKit(f.vault, s, kit.file, kit.code);
  assert.deepEqual(await restored.openResult(flow.result), flow.content);
  await assert.rejects(restored.deviceManagement(f.vault), /locked/);
  await assert.rejects(
    restored.signResultState({ metadata: flow.result.metadata, changes: { read: true } }),
  );
});

test("recovery kit refuses wrong code, owner, root and altered authenticated public metadata", async () => {
  const f = await createOwner(h),
    s = await state(f),
    kit = await f.session.createRecoveryKit(f.vault, s);
  for (const [uid, file, code] of [
    [f.uid, kit.file, h.core.b64(crypto.getRandomValues(new Uint8Array(32)))],
    ["another-owner", kit.file, kit.code],
    [f.uid, JSON.stringify({ ...JSON.parse(kit.file), createdAt: 1001 }), kit.code],
  ])
    await assert.rejects(
      new h.core.VaultCore(uid, f.now).importRecoveryKit(f.vault, s, file, code),
    );
  const other = await createOwner(h, f.uid);
  await assert.rejects(
    new h.core.VaultCore(f.uid, f.now).importRecoveryKit(
      other.vault,
      await state(other),
      kit.file,
      kit.code,
    ),
  );
});

test("Passkey replacement preserves root/recovery/device keys; original and replacement PRF both recover the exact pending operation", async () => {
  const f = await createOwner(h),
    s = await state(f),
    next = replacement();
  const candidate = await f.session.prepareArchiveChange(f.vault, s, next(), "passkey_change");
  assert.equal(candidate.packet.archive.rootKeyId, f.vault.rootKeyId);
  assert(!JSON.stringify(candidate.record).includes("PrivateJwk"));
  const old = new h.core.VaultCore(f.uid, f.now);
  await old.unlock(f.vault, f.material(), f.local);
  assert.deepEqual(await old.getArchiveChange(f.vault, s, candidate.record), candidate.packet);
  const updated = { ...f.vault, archive: candidate.packet.archive },
    ss = await accepted(s, candidate.packet.command, candidate.packet.archive);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.unlockForResults(updated, next());
  assert.deepEqual(await fresh.getArchiveChange(updated, ss, candidate.record), candidate.packet);
  const done = await fresh.finishArchiveChange(updated, ss, candidate.packet.operationId);
  assert.equal(done.applied, true);
  assert.equal(done.record.device.deviceId, f.local.device.deviceId);
  assert.equal(done.record.device.signingKeyId, f.local.device.signingKeyId);
  assert.equal(done.record.device.encryptionKeyId, f.local.device.encryptionKeyId);
  const again = new h.core.VaultCore(f.uid, f.now);
  await again.unlock(updated, next(), { ...done.record, device: done.record.device });
  assert.equal(
    (await again.deviceManagement(updated)).summary.currentDeviceId,
    f.local.device.deviceId,
  );
  await assert.rejects(new h.core.VaultCore(f.uid, f.now).unlock(updated, f.material()));
});

test("lost-Passkey recovery signs exact digest authorization, consumes it, and never silently registers a device", async () => {
  const f = await createOwner(h),
    s = await state(f),
    kit = await f.session.createRecoveryKit(f.vault, s),
    next = replacement();
  const restored = new h.core.VaultCore(f.uid, f.now);
  await restored.importRecoveryKit(f.vault, s, kit.file, kit.code);
  const c = await restored.prepareArchiveChange(f.vault, s, next(), "recovery");
  assert(c.packet.authorization);
  assert.equal(c.record.old, null);
  const auth = await accepted(s, c.packet.authorization.command),
    updated = { ...f.vault, archive: c.packet.archive },
    ss = await accepted(auth, c.packet.command, c.packet.archive);
  const done = await restored.finishArchiveChange(updated, ss, c.packet.operationId);
  assert.equal(done.applied, true);
  assert.equal(done.needsDeviceRegistration, true);
  assert.equal(done.record.device, undefined);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  assert.equal((await fresh.unlock(updated, next())).needsDeviceRegistration, true);
});

test("lifecycle pin rejects deletion, prior archive, prefix forks and tampered receipts including authorization-only forks", async () => {
  const f = await createOwner(h),
    s = await state(f),
    kit = await f.session.createRecoveryKit(f.vault, s),
    recovered = new h.core.VaultCore(f.uid, f.now);
  await recovered.importRecoveryKit(f.vault, s, kit.file, kit.code);
  const c = await recovered.prepareArchiveChange(f.vault, s, replacement()(), "recovery"),
    auth = await accepted(s, c.packet.authorization.command),
    pin = await recovered.verifyLifecycle(f.vault, auth);
  await assert.rejects(
    new h.core.VaultCore(f.uid, f.now).verifyLifecycle(f.vault, s, pin),
    /rollback_detected/,
  );
  const changed = clone(auth);
  changed.history[0].receipt.acceptedAt = 1300;
  await assert.rejects(new h.core.VaultCore(f.uid, f.now).verifyLifecycle(f.vault, changed));
  const another = new h.core.VaultCore(f.uid, f.now);
  await another.importRecoveryKit(f.vault, s, kit.file, kit.code);
  const c2 = await another.prepareArchiveChange(f.vault, s, replacement()(), "recovery"),
    fork = await accepted(s, c2.packet.authorization.command);
  await assert.rejects(
    new h.core.VaultCore(f.uid, f.now).verifyLifecycle(f.vault, fork, pin),
    /rollback_detected/,
  );
  const bad = clone(auth);
  bad.pendingAuthorization.status = "expired";
  await assert.rejects(
    new h.core.VaultCore(f.uid, f.now).verifyLifecycle(f.vault, bad),
    /untrusted_lifecycle/,
  );
});

test("ordinary vault checks stay strict when another tab changes an archive", async () => {
  const f = await createOwner(h),
    s = await state(f),
    c = await f.session.prepareArchiveChange(f.vault, s, replacement()(), "passkey_change"),
    updated = { ...f.vault, archive: c.packet.archive };
  await assert.rejects(f.session.acceptResultVault(updated), /untrusted_vault/);
});

async function withStorage(action) {
  const fake = require("fake-indexeddb"),
    a = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    b = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: fake.IDBKeyRange });
  try {
    return await action();
  } finally {
    for (const [key, desc] of [
      ["indexedDB", a],
      ["IDBKeyRange", b],
    ])
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
  }
}

test("cross-tab archive fence blocks pending private writes and after promotion rejects the old PRF session", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      s = await state(f),
      pin = await f.session.verifyLifecycle(f.vault, s),
      a = new storageModule.BrowserEncryptedStorage(),
      b = new storageModule.BrowserEncryptedStorage();
    for (const store of [a, b])
      store.setArchiveContext(
        f.owner,
        f.vault.archive.credentialId,
        f.vault.archive.prfSalt,
        f.vault.archive.iv,
      );
    await a.commitVault(f.owner, f.local);
    await a.commitLifecycle(f.owner, pin, f.vault.archive);
    const c = await f.session.prepareArchiveChange(f.vault, s, replacement()(), "passkey_change");
    assert(await a.stageArchiveChange(f.owner, c.record));
    await assert.rejects(
      b.insert(f.owner + ":agent-registration:" + f.vault.vaultId, { pending: {} }),
      /archive_change_pending/,
    );
    await assert.rejects(
      b.compareTaskRecord(f.owner + ":task-draft:" + f.vault.vaultId + ":main", { revision: 1 }, 0),
      /archive_change_pending/,
    );
    const ss = await accepted(s, c.packet.command, c.packet.archive),
      v = { ...f.vault, archive: c.packet.archive },
      done = await f.session.finishArchiveChange(v, ss, c.packet.operationId);
    await a.finishArchiveChange(f.owner, done.pin, v.archive, done.record, c.packet.operationId);
    await assert.rejects(
      b.put(f.owner + ":task-draft:" + f.vault.vaultId + ":main", { revision: 1 }),
      /archive_session_stale/,
    );
    assert.equal(
      (await a.get(f.owner + ":device:" + f.vault.vaultId)).device.signingKeyId,
      f.local.device.signingKeyId,
    );
  }));

test("archive change refuses unresolved draft/device/agent records and keeps every record intact", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      s = await state(f),
      a = new storageModule.BrowserEncryptedStorage();
    a.setArchiveContext(
      f.owner,
      f.vault.archive.credentialId,
      f.vault.archive.prfSalt,
      f.vault.archive.iv,
    );
    const c = await f.session.prepareArchiveChange(f.vault, s, replacement()(), "passkey_change");
    for (const key of [
      f.owner + ":task-draft:" + f.vault.vaultId + ":main",
      f.owner + ":pending-device:" + f.vault.vaultId,
      f.owner + ":device-change:" + f.vault.vaultId,
      f.owner + ":agent-preparation:" + f.vault.vaultId + ":agent:task",
    ]) {
      await a.put(key, { encrypted: "preserve" });
      await assert.rejects(a.stageArchiveChange(f.owner, c.record), /archive_local_pending/);
      assert.deepEqual(await a.get(key), { encrypted: "preserve" });
      await a.remove(key);
    }
  }));

test("root lifecycle packets and independent recovery interoperate with actual Hub SQLite service, replay and original receipt", async (t) => {
  const root = path.resolve(__dirname, "../../.."),
    python = path.join(root, "services/market-data-service/.venv/bin/python");
  if (!existsSync(python)) {
    t.skip("Declared shared Python environment unavailable");
    return;
  }
  const f = await createOwner(h),
    s = await state(f),
    kit = await f.session.createRecoveryKit(f.vault, s),
    recovered = new h.core.VaultCore(f.uid, f.now);
  await recovered.importRecoveryKit(f.vault, s, kit.file, kit.code);
  const c = await recovered.prepareArchiveChange(f.vault, s, replacement()(), "recovery");
  const script = `import json,sys,tempfile\nfrom pathlib import Path\nfrom app.store import SQLiteHubStore\nfrom app.vaults import VaultService\nfrom app.vault_lifecycle import VaultLifecycleService\nx=json.load(sys.stdin)\nwith tempfile.TemporaryDirectory(prefix='folioview-web-recovery-') as d:\n st=SQLiteHubStore(Path(d)/'synthetic.sqlite3');v=VaultService(st,clock=lambda:1000);s=VaultLifecycleService(st,clock=lambda:1000)\n b=x['vault'];v.bootstrap(x['uid'],dict(contractVersion=x['contract'],vaultId=b['vaultId'],rootJwk=b['rootJwk'],rootKeyId=b['rootKeyId'],registryBundle=b['registryHistory'][0],archive=b['archive']),'synthetic_recovery_bootstrap_001')\n p=x['packet'];a=p['authorization'];body=dict(contractVersion=x['contract'],command=a['command']);s.authorize_recovery(x['uid'],b['vaultId'],body,a['operationId'])\n body=dict(contractVersion=x['contract'],archive=p['archive'],command=p['command']);r=s.replace_archive(x['uid'],b['vaultId'],body,p['operationId']);assert s.replace_archive(x['uid'],b['vaultId'],body,p['operationId'])==r;assert s.receipt(x['uid'],b['vaultId'],p['operationId'])==r\n print(json.dumps(dict(vault=v.current(x['uid'])['vault'],state=s.state(x['uid'],b['vaultId']),receipt=r)))`;
  const result = spawnSync(python, ["-c", script], {
    cwd: path.join(root, "services/agent-hub-service"),
    env: { ...process.env, PYTHONPATH: path.join(root, "services/common") },
    input: JSON.stringify({
      uid: f.uid,
      vault: f.vault,
      packet: c.packet,
      contract: h.core.CONTRACT,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  await recovered.verifyLifecycle(actual.vault, actual.state);
  const done = await recovered.finishArchiveChange(
    actual.vault,
    actual.state,
    c.packet.operationId,
  );
  assert.equal(done.applied, true);
  assert.equal(actual.receipt.receipt.operationId, c.packet.operationId);
});

test("a fresh Worker discovers signed recovery candidate and resumes after authorization without the lost original Passkey", async () => {
  const f = await createOwner(h),
    s = await state(f),
    kit = await f.session.createRecoveryKit(f.vault, s),
    next = replacement(),
    r = new h.core.VaultCore(f.uid, f.now);
  await r.importRecoveryKit(f.vault, s, kit.file, kit.code);
  const c = await r.prepareArchiveChange(f.vault, s, next(), "recovery"),
    auth = await accepted(s, c.packet.authorization.command);
  const afterReload = new h.core.VaultCore(f.uid, f.now),
    offer = await afterReload.inspectArchiveChange(f.vault, auth, c.record);
  assert.deepEqual(offer.archive, c.packet.archive);
  assert.deepEqual(await afterReload.getArchiveChange(f.vault, auth, c.record, next()), c.packet);
  const cancellation = await afterReload.prepareArchiveCancellation(f.vault, auth, c.record);
  assert.equal(cancellation.packet.commands.length, 1);
  assert.equal(cancellation.packet.commands[0].action, "recovery_revoke");
  const revoked = await accepted(auth, cancellation.packet.commands[0].command);
  assert.equal(revoked.pendingAuthorization, null);
  await afterReload.discardArchiveChange(
    f.vault,
    revoked,
    cancellation.record,
    c.packet.operationId,
  );
  assert.equal(f.vault.archive, s.archive);
});

test("routine cancellation durably authorizes then revokes a harmless digest witness before clearing an unknown write", async () => {
  const f = await createOwner(h),
    s = await state(f),
    c = await f.session.prepareArchiveChange(f.vault, s, replacement()(), "passkey_change");
  await assert.rejects(
    f.session.discardArchiveChange(f.vault, s, c.record, c.packet.operationId),
    /archive_change_unknown/,
  );
  const cancel = await f.session.prepareArchiveCancellation(f.vault, s, c.record);
  assert.equal(cancel.packet.commands.length, 2);
  assert.deepEqual(
    (await f.session.prepareArchiveCancellation(f.vault, s, cancel.record)).packet,
    cancel.packet,
  );
  let ss = s;
  for (const command of cancel.packet.commands) ss = await accepted(ss, command.command);
  await f.session.discardArchiveChange(f.vault, ss, cancel.record, c.packet.operationId);
  assert.equal(ss.archiveDigest, s.archiveDigest);
  assert.equal(ss.archiveRevision, 0);
});

test("expired recovery can be revoked; cancellation plans can renew without erasing earlier signed attempts", async () => {
  const f = await createOwner(h),
    s = await state(f),
    c = await f.session.prepareArchiveChange(f.vault, s, replacement()(), "passkey_change"),
    a = await f.session.prepareArchiveCancellation(f.vault, s, c.record);
  f.time(1400);
  const b = await f.session.prepareArchiveCancellation(f.vault, s, a.record);
  assert.equal(b.record.cancellation.retained.length, 4);
  assert.notEqual(a.packet.commands[0].operationId, b.packet.commands[0].operationId);
  const auth = await accepted(s, a.packet.commands[0].command);
  auth.pendingAuthorization.status = "expired";
  const revoke = await f.session.prepareArchiveCancellation(f.vault, auth, b.record);
  assert.equal(revoke.packet.commands.length, 1);
  assert.equal(revoke.packet.commands[0].authorizationId, a.packet.commands[0].authorizationId);
});

test("zero-history archive pin binds the first signed digest and rejects a valid-root alternate initial archive", async () => {
  const f = await createOwner(h),
    s = await state(f),
    pin = await f.session.verifyLifecycle(f.vault, s),
    c = await f.session.prepareArchiveChange(f.vault, s, replacement()(), "passkey_change"),
    p = decoded(c.packet.command);
  p.expectedArchiveDigest = "f".repeat(64);
  const altered = await new h.jose.FlattenedSign(Buffer.from(h.core.canonical(p)))
    .setProtectedHeader(JSON.parse(Buffer.from(c.packet.command.protected, "base64url")))
    .sign(f.session.root);
  const fork = await accepted(
      { ...s, archiveDigest: p.expectedArchiveDigest },
      altered,
      c.packet.archive,
    ),
    vault = { ...f.vault, archive: c.packet.archive };
  await assert.rejects(
    new h.core.VaultCore(f.uid, f.now).verifyLifecycle(vault, fork, pin),
    /rollback_detected/,
  );
});

test("signature-byte variants share a signed-input lifecycle pin", async () => {
  const f = await createOwner(h),
    s = await state(f),
    c = await f.session.prepareArchiveChange(f.vault, s, replacement()(), "passkey_change"),
    ss = await accepted(s, c.packet.command, c.packet.archive),
    v = { ...f.vault, archive: c.packet.archive },
    pin = await new h.core.VaultCore(f.uid, f.now).verifyLifecycle(v, ss),
    variant = clone(ss);
  const bytes = Buffer.from(variant.history[0].command.signature, "base64url"),
    n = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
    part = BigInt("0x" + bytes.subarray(32).toString("hex")),
    other = Buffer.from((n - part).toString(16).padStart(64, "0"), "hex");
  other.copy(bytes, 32);
  variant.history[0].command.signature = bytes.toString("base64url");
  assert.deepEqual(await new h.core.VaultCore(f.uid, f.now).verifyLifecycle(v, variant, pin), pin);
});

// The facade executes the actual serialized Worker dispatcher; native authenticator
// UI and a production Google login remain separate from this synthetic verification.
class RecoveryWorker {
  constructor() {
    const owner = this;
    let CoreError;
    try {
      new h.core.VaultCore("");
    } catch (e) {
      CoreError = e.constructor;
    }
    class ClockCore extends h.core.VaultCore {
      constructor(uid) {
        super(uid, () => 1000);
      }
    }
    this.messages = [];
    this.realm = {
      ArrayBuffer,
      Uint8Array,
      TextEncoder,
      TextDecoder,
      crypto,
      module: { exports: {} },
      exports: {},
      require(name) {
        if (name === "./encrypted-core") return { VaultCore: ClockCore };
        if (name === "./encrypted-types") return { VaultError: CoreError };
        assert.fail(name);
      },
      postMessage(value) {
        assert(!JSON.stringify(value).includes("PrivateJwk"), "private master must stay in Worker");
        if (!owner.stopped) owner.onmessage({ data: structuredClone(value) });
      },
    };
    require("node:vm").runInNewContext(workerCode, this.realm);
  }
  postMessage(message, transfer = []) {
    const value = structuredClone(message, { transfer });
    this.messages.push(value.method);
    queueMicrotask(() => {
      if (!this.stopped) this.realm.onmessage({ data: value });
    });
  }
  terminate() {
    this.stopped = true;
    this.realm = null;
  }
}
function browserClient(f, storage) {
  return new bridge.EncryptedVaultSession(f.uid, {
    storage,
    workerFactory: () => new RecoveryWorker(),
  });
}

test("actual Worker bridge and IndexedDB resume lost old Passkey before PUT, durably cancel, and keep recovery code off disk", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      s = await state(f),
      storage = new storageModule.BrowserEncryptedStorage();
    await storage.commitVault(f.owner, f.local);
    const initial = browserClient(f, storage);
    await initial.unlock(f.vault, f.material());
    await initial.verifyLifecycle(f.vault, s);
    await initial.acceptVault(f.vault);
    const kit = await initial.createRecoveryKit(f.vault, s);
    initial.lock();
    const importer = browserClient(f, new storageModule.BrowserEncryptedStorage());
    await importer.importRecoveryKit(f.vault, s, kit.file, kit.code);
    const next = replacement(),
      packet = await importer.prepareArchiveChange(f.vault, s, next(), "recovery");
    importer.lock();
    const auth = await accepted(s, packet.authorization.command),
      resumed = browserClient(f, new storageModule.BrowserEncryptedStorage());
    assert.deepEqual((await resumed.inspectArchiveChange(f.vault, auth)).archive, packet.archive);
    assert.deepEqual((await resumed.getArchiveChange(f.vault, auth, next())).packet, packet);
    const cancel = await resumed.prepareArchiveCancellation(f.vault, auth);
    assert.equal(cancel.commands.length, 1);
    const durable = await storage.get(f.owner + ":archive-change");
    assert(durable.cancellation);
    assert(!JSON.stringify(await storage.list(f.owner + ":")).includes(kit.code));
    const revoked = await accepted(auth, cancel.commands[0].command);
    await resumed.discardArchiveChange(f.vault, revoked, packet.operationId);
    assert.equal(await storage.get(f.owner + ":archive-change"), null);
    resumed.lock();
    const unlocked = browserClient(f, new storageModule.BrowserEncryptedStorage());
    await unlocked.unlock(f.vault, f.material());
    await unlocked.verifyLifecycle(f.vault, revoked);
    await unlocked.acceptVault(f.vault);
    unlocked.lock();
  }));

test("actual bridge promotes migrated device only after new-archive proof and ignores stale seal on another browser", async () =>
  withStorage(async () => {
    const f = await createOwner(h),
      s = await state(f),
      store = new storageModule.BrowserEncryptedStorage();
    await store.commitVault(f.owner, f.local);
    const first = browserClient(f, store);
    await first.unlock(f.vault, f.material());
    await first.verifyLifecycle(f.vault, s);
    await first.acceptVault(f.vault);
    const next = replacement(),
      packet = await first.prepareArchiveChange(f.vault, s, next(), "passkey_change");
    first.lock();
    const v = { ...f.vault, archive: packet.archive },
      ss = await accepted(s, packet.command, packet.archive),
      resumed = browserClient(f, new storageModule.BrowserEncryptedStorage());
    assert.equal((await resumed.unlock(v, next())).needsDeviceRegistration, true);
    await resumed.verifyLifecycle(v, ss);
    await resumed.getArchiveChange(v, ss);
    await resumed.finishArchiveChange(v, ss, packet.operationId);
    resumed.lock();
    const final = browserClient(f, new storageModule.BrowserEncryptedStorage());
    assert.equal((await final.unlock(v, next())).needsDeviceRegistration, false);
    await final.verifyLifecycle(v, ss);
    await final.acceptVault(v);
    final.lock();
    // Another browser with no local outbox retains its old seal but restores read-only,
    // then requires explicit registration instead of reviving that old device identity.
    await assert.rejects(
      store.put(f.owner + ":device:" + v.vaultId, {
        ownerSubject: f.owner,
        device: f.local.device,
      }),
      /archive_session_stale/,
    );
    await new storageModule.BrowserEncryptedStorage().put(f.owner + ":device:" + v.vaultId, {
      ownerSubject: f.owner,
      device: f.local.device,
    });
    const other = browserClient(f, new storageModule.BrowserEncryptedStorage());
    assert.equal((await other.unlock(v, next())).needsDeviceRegistration, true);
    await other.verifyLifecycle(v, ss);
    assert(
      (await store.get(f.owner + ":device:" + v.vaultId)).device.credentialId ===
        f.vault.archive.credentialId,
    );
    other.lock();
  }));

test("an independent recovered browser can supersede an expired old recovery approval without that browser outbox", async () => {
  const f = await createOwner(h),
    s = await state(f),
    kit = await f.session.createRecoveryKit(f.vault, s),
    r = new h.core.VaultCore(f.uid, f.now);
  await r.importRecoveryKit(f.vault, s, kit.file, kit.code);
  const old = await r.prepareArchiveChange(f.vault, s, replacement()(), "recovery"),
    ss = await accepted(s, old.packet.authorization.command);
  f.time(1400);
  ss.pendingAuthorization.status = "expired";
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await fresh.importRecoveryKit(f.vault, ss, kit.file, kit.code);
  const next = await fresh.prepareArchiveChange(f.vault, ss, replacement()(), "recovery");
  assert.notEqual(
    next.packet.authorization.authorizationId,
    old.packet.authorization.authorizationId,
  );
  assert.equal(decoded(next.packet.authorization.command).expectedLifecycleVersion, 1);
});
