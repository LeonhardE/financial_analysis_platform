const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");
let core, bridge, passkey, directory, nativeStorage;
test.before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-browser-crypto-"));
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
    "encrypted-passkey",
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
  nativeStorage = await import(pathToFileURL(path.join(directory, "encrypted-storage.mjs")).href);
  passkey = await import(pathToFileURL(path.join(directory, "encrypted-passkey.mjs")).href);
});
test.after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
const source = {
  resourceRef: {
    kind: "holdings",
    sourceService: "portfolio",
    resourceId: "holdings_synthetic",
    incarnation: "synthetic_incarnation",
  },
  sourceEpoch: 1,
};
const content = () => ({
  state: "empty",
  coverage: { state: "unknown", issues: ["Synthetic CSV input"] },
  sourceAsOf: null,
  fetchedAt: "2026-10-28T00:00:00Z",
  freshness: "unknown",
  data: { kind: "holdings", snapshotId: "placeholder", accounts: [], excludedAssets: [] },
});
async function fixture(uid = "synthetic_A") {
  const secret = crypto.getRandomValues(new Uint8Array(32)),
    salt = crypto.getRandomValues(new Uint8Array(32));
  const material = () => ({
    credentialId: core.b64(new TextEncoder().encode("synthetic-credential")),
    prfSalt: core.b64(salt),
    secret: secret.slice().buffer,
  });
  const session = new core.VaultCore(uid, () => 1000);
  const created = await session.beginCreate(material());
  const vault = {
    vaultId: created.vaultId,
    rootJwk: created.rootJwk,
    rootKeyId: created.rootKeyId,
    registryHistory: [created.registryBundle],
    archive: created.archive,
    version: 1,
  };
  const local = await session.acceptVault(vault);
  return { session, created, vault, material, local, uid };
}
async function stored(f, pending) {
  const c = JSON.parse(
    Buffer.from(pending.carrier.signedObject.payload, "base64url").toString(),
  ).context;
  return {
    contractVersion: core.CONTRACT,
    carrier: pending.carrier,
    keyProofs: {
      checkpoint: f.vault.registryHistory.at(-1).checkpoint,
      certificates: f.vault.registryHistory.at(-1).entries.map((x) => x.certificate),
    },
    receipt: {
      contractVersion: core.CONTRACT,
      vaultId: f.vault.vaultId,
      resourceRef: source.resourceRef,
      snapshotId: pending.snapshotId,
      revision: pending.expectedRevision + 1,
      sourceEpoch: source.sourceEpoch,
      stableOperationId: pending.operationId,
      envelopeFingerprint: await core.signingFingerprint(pending.carrier.signedObject),
      snapshotPath: `/api/v2/holdings/sources/${source.resourceRef.resourceId}/snapshots/${pending.snapshotId}`,
      storedAt: "2026-10-28T00:00:00Z",
    },
  };
}
test("copied formal schemas are byte-identical to the versioned shared producer", () => {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(path.resolve(__dirname, "../lib/encrypted-schemas.json")))
      .digest("hex"),
    createHash("sha256")
      .update(
        readFileSync(
          path.resolve(
            __dirname,
            "../../../services/common/folioview_shared/encrypted/schemas.json",
          ),
        ),
      )
      .digest("hex"),
  );
});
test("Passkey archive/device keystore contain ciphertext only and restore with fresh nonextractable handles", async () => {
  const f = await fixture();
  for (const value of [f.created, f.local]) {
    const text = JSON.stringify(value);
    assert.ok(!text.includes("PrivateJwk"));
    assert.ok(!text.includes('"d":'));
  }
  const restored = new core.VaultCore(f.uid, () => 1000);
  assert.deepEqual(await restored.unlock(f.vault, f.material(), f.local), {
    needsDeviceRegistration: false,
  });
  await restored.acceptVault(f.vault);
  const pending = await restored.sealSnapshot({ content: content(), source, expectedRevision: 0 });
  const value = await stored(f, pending);
  assert.deepEqual(await restored.openSnapshot(value, source), {
    ...content(),
    data: { ...content().data, snapshotId: pending.snapshotId },
  });
  await restored.verifyReceipt(pending, value.receipt);
  assert.equal(restored.device.sig.extractable, false);
  assert.equal(restored.device.enc.extractable, false);
  assert.equal(restored.root.extractable, false);
  assert.equal(restored.recovery.extractable, false);
});
test("wrong account/PRF output/ciphertext/AAD substitutions cannot unlock", async () => {
  const f = await fixture();
  await assert.rejects(
    new core.VaultCore("synthetic_B", () => 1000).unlock(f.vault, f.material()),
    /wrong_account/,
  );
  const wrong = f.material();
  new Uint8Array(wrong.secret).fill(0);
  await assert.rejects(
    new core.VaultCore(f.uid, () => 1000).unlock(f.vault, wrong),
    /unlock_failed/,
  );
  const changed = structuredClone(f.vault);
  changed.archive.ciphertext = changed.archive.ciphertext.slice(0, -2) + "AA";
  await assert.rejects(
    new core.VaultCore(f.uid, () => 1000).unlock(changed, f.material()),
    /unlock_failed|invalid_data/,
  );
  const moved = structuredClone(f.vault);
  moved.archive.vaultId = "different_vault";
  await assert.rejects(
    new core.VaultCore(f.uid, () => 1000).unlock(moved, f.material()),
    /unlock_failed/,
  );
});
test("fresh browser enrolls new device, retains root, and decrypts history through independent recovery recipient", async () => {
  const f = await fixture();
  const pending = await f.session.sealSnapshot({ content: content(), source, expectedRevision: 0 });
  const value = await stored(f, pending);
  const fresh = new core.VaultCore(f.uid, () => 1000);
  assert.deepEqual(await fresh.unlock(f.vault, f.material()), { needsDeviceRegistration: true });
  const update = await fresh.prepareDeviceRegistration(f.vault);
  assert.equal(update.expectedVersion, 1);
  const next = {
    ...f.vault,
    version: 2,
    registryHistory: [...f.vault.registryHistory, update.registryBundle],
  };
  const nextLocal = await fresh.acceptVault(next);
  assert.notEqual(nextLocal.device.deviceId, f.local.device.deviceId);
  assert.equal(nextLocal.pin.rootKeyId, f.local.pin.rootKeyId);
  assert.deepEqual(await fresh.openSnapshot(value, source), {
    ...content(),
    data: { ...content().data, snapshotId: pending.snapshotId },
  });
  await assert.rejects(fresh.acceptVault(f.vault), /rollback_detected|key_revoked/);
  const conflicting = structuredClone(next);
  conflicting.registryHistory[1].checkpoint.payload =
    conflicting.registryHistory[0].checkpoint.payload;
  await assert.rejects(fresh.acceptVault(conflicting), /invalid_signature|registry_conflict/);
});
test("snapshot identity/source/receipt/signature and AEAD tampering all fail closed", async () => {
  const f = await fixture();
  const pending = await f.session.sealSnapshot({ content: content(), source, expectedRevision: 0 });
  const value = await stored(f, pending);
  for (const field of ["snapshotId", "stableOperationId", "envelopeFingerprint"]) {
    const changed = structuredClone(value);
    changed.receipt[field] = "synthetic_wrong";
    await assert.rejects(f.session.openSnapshot(changed, source), /binding_mismatch/);
    await assert.rejects(f.session.verifyReceipt(pending, changed.receipt), /binding_mismatch/);
  }
  await assert.rejects(
    f.session.openSnapshot(value, {
      ...source,
      resourceRef: { ...source.resourceRef, incarnation: "other" },
    }),
    /binding_mismatch/,
  );
  const changed = structuredClone(value);
  changed.carrier.signedObject.signature = "A".repeat(86);
  await assert.rejects(f.session.openSnapshot(changed, source), /invalid_signature/);
  const afterFence = { ...source, sourceEpoch: 2 };
  assert.deepEqual(await f.session.openSnapshot(value, afterFence), {
    ...content(),
    data: { ...content().data, snapshotId: pending.snapshotId },
  });
});
test(
  "formal Node-produced registry/control/carrier accepted and decrypted by Python current validators",
  {
    skip: !existsSync(
      path.resolve(__dirname, "../../../services/market-data-service/.venv/bin/python"),
    )
      ? "Additional local cross-runtime test requires the existing backend development environment"
      : false,
  },
  async () => {
    const f = await fixture();
    const pending = await f.session.sealSnapshot({
      content: content(),
      source,
      expectedRevision: 0,
    });
    const control = await f.session.signSource(source.resourceRef.resourceId);
    const archive = f.vault.archive;
    const { iv, ciphertext, ...aad } = archive;
    const wrapKey = await crypto.subtle.importKey(
      "raw",
      f.material().secret,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const master = JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: core.unb64(iv),
            additionalData: new TextEncoder().encode(core.canonical(aad)),
          },
          wrapKey,
          core.unb64(ciphertext),
        ),
      ),
    );
    const { iv: di, ciphertext: dc, ...da } = f.local.device;
    const device = JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: core.unb64(di),
            additionalData: new TextEncoder().encode(core.canonical(da)),
          },
          wrapKey,
          core.unb64(dc),
        ),
      ),
    );
    const python = path.resolve(
      __dirname,
      "../../../services/market-data-service/.venv/bin/python",
    );
    const script = `import json,sys\nsys.path.insert(0,'services/common')\nfrom folioview_shared.encrypted.authority import verify_registry,verify_control_command\nfrom folioview_shared.encrypted.envelope import verify_carrier,EnvelopeExpectation\nfrom folioview_shared.encrypted.jsonutil import b64url_decode\nfrom folioview_shared.encrypted.crypto import decrypt_jwe,encrypt_jwe,sign_jws\nv=json.load(sys.stdin); owner=v['owner'];vault=v['vault'];r=verify_registry(vault['registryHistory'][0],root_jwk=vault['rootJwk'],pinned_root_key_id=vault['rootKeyId'],owner_subject=owner,vault_id=vault['vaultId'],now=1000)\nc=json.loads(b64url_decode(v['pending']['carrier']['signedObject']['payload']))['context']\ne=EnvelopeExpectation(owner,vault['vaultId'],c['objectId'],c['objectType'],c['revision'],c['expectedRevision'],c['operationType'],c['authorSigningKeyId'],c['binding'],tuple(c['resourceBindings']),tuple(x['keyId'] for x in c['recipients']))\nverify_carrier(v['pending']['carrier'],registry=r,expectation=e,now=1000,contract_header='folioview.agent-workspace.v2.0')\nverify_control_command(v['control']['command'],registry=r,expected_action='manual_source_create',expected_target_id='holdings_synthetic',expected_version=0,expected_source_epoch=None,expected_parameters={},now=1000)\nmessage=json.loads(b64url_decode(v['pending']['carrier']['signedObject']['payload']))\nopened=decrypt_jwe(message['jwe'],v['recoveryPrivateJwk'],context=c)\nassert opened['payload']['data']['snapshotId']==v['pending']['snapshotId']\nassert opened['payload']['data']['accounts']==[]\njwe=encrypt_jwe(opened,{x['keyId']:r.cert(x['keyId'],now=1000)['publicJwk'] for x in c['recipients']},context=c)\ncarrier={'contractVersion':'folioview.agent-workspace.v2.0','signedObject':sign_jws({'context':c,'jwe':jwe},v['deviceSigningPrivateJwk'],typ='fv-object+jws')}\nprint(json.dumps({'verified':True,'carrier':carrier}))`;
    const result = spawnSync(python, ["-c", script], {
      cwd: path.resolve(__dirname, "../../.."),
      input: JSON.stringify({
        owner: await f.session.owner,
        vault: f.vault,
        pending,
        control,
        recoveryPrivateJwk: master.recoveryPrivateJwk,
        deviceSigningPrivateJwk: device.signingPrivateJwk,
      }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const reverse = JSON.parse(result.stdout);
    assert.equal(reverse.verified, true);
    const value = await stored(f, { ...pending, carrier: reverse.carrier });
    assert.deepEqual(await f.session.openSnapshot(value, source), {
      ...content(),
      data: { ...content().data, snapshotId: pending.snapshotId },
    });
  },
);

class MemoryStorage {
  constructor() {
    this.records = new Map();
  }
  async get(k) {
    return structuredClone(this.records.get(k) ?? null);
  }
  async put(k, v) {
    this.records.set(k, structuredClone(v));
  }
  async remove(k) {
    this.records.delete(k);
  }
  async insert(k, v) {
    if (this.records.has(k)) return false;
    this.records.set(k, structuredClone(v));
    return true;
  }
  async removeOperation(k, id) {
    const value = this.records.get(k);
    if (value && value.pending?.operationId !== id) return false;
    this.records.delete(k);
    return true;
  }
  async stageDevice(k, v, expected) {
    const current = this.records.get(k)?.pending ?? null;
    if (
      JSON.stringify(current) !== JSON.stringify(expected ?? null) &&
      JSON.stringify(current) !== JSON.stringify(v.pending)
    )
      return false;
    this.records.set(k, structuredClone(v));
    return true;
  }
  async commitVault(owner, record) {
    nativeStorage.assertPinAdvance(this.records.get(owner + ":pin"), record);
    this.records.set(owner + ":pin", structuredClone(record.pin));
    this.records.set(owner + ":device:" + record.pin.vaultId, {
      ownerSubject: owner,
      device: structuredClone(record.device),
    });
    const k = owner + ":pending-device:" + record.pin.vaultId;
    if (
      record.pending &&
      JSON.stringify(this.records.get(k)?.pending) === JSON.stringify(record.pending)
    )
      this.records.delete(k);
  }
}
class LocalWorker {
  constructor() {
    this.core = null;
    this.stopped = false;
    this.queue = Promise.resolve();
    this.pause = null;
  }
  postMessage(message, transfer = []) {
    const copied = structuredClone(message, { transfer });
    this.queue = this.queue.then(async () => {
      if (this.stopped) return;
      try {
        let result;
        const { method, args } = copied;
        if (method === "init") {
          this.core = new core.VaultCore(args.uid, () => 1000);
          result = { ownerSubject: await this.core.owner };
        } else {
          if (this.pause) await this.pause;
          if (method === "unlock")
            result = await this.core.unlock(args.vault, args.material, args.local);
          else if (method === "beginCreate") result = await this.core.beginCreate(args.material);
          else if (method === "sealSnapshot") result = await this.core.sealSnapshot(args);
          else if (method === "openSnapshot")
            result = await this.core.openSnapshot(args.value, args.source);
          else if (method === "verifyReceipt")
            result = await this.core.verifyReceipt(args.pending, args.receipt);
          else if (method === "validatePending")
            result = await this.core.validatePending(args.pending);
          else if (method === "signSource") result = await this.core.signSource(args.sourceId);
          else result = await this.core[method](args.vault);
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
test("worker bridge persists pins only after accepted enrollment, transfers PRF, retries exact ciphertext and isolates owners", async () => {
  const storage = new MemoryStorage(),
    worker = new LocalWorker();
  const session = new bridge.EncryptedVaultSession("synthetic_A", {
    storage,
    workerFactory: () => worker,
  });
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const salt = core.b64(crypto.getRandomValues(new Uint8Array(32)));
  const material = () => ({
    credentialId: core.b64(new TextEncoder().encode("synthetic-client-credential")),
    prfSalt: salt,
    secret: secret.slice().buffer,
  });
  await session.prepareCreate();
  const first = material();
  const created = await session.beginCreate(first);
  assert.equal(first.secret.byteLength, 0);
  assert.ok(![...storage.records.keys()].some((key) => key.endsWith(":pin")));
  assert.equal(storage.records.size, 1);
  const vault = {
    vaultId: created.vaultId,
    rootJwk: created.rootJwk,
    rootKeyId: created.rootKeyId,
    registryHistory: [created.registryBundle],
    archive: created.archive,
    version: 1,
  };
  await session.acceptVault(vault);
  await assert.rejects(session.prepareCreate(), /untrusted_vault/);
  const pending = await session.sealSnapshot({ content: content(), source, expectedRevision: 0 });
  await assert.rejects(
    session.sealSnapshot({ content: content(), source, expectedRevision: 0 }),
    /pending_upload/,
  );
  const encoded = JSON.stringify(pending.carrier);
  assert.equal(
    JSON.stringify((await session.loadOutbox(source.resourceRef.resourceId)).carrier),
    encoded,
  );
  const text = JSON.stringify([...storage.records.values()]);
  for (const secret of ["PrivateJwk", '"d":', "Synthetic CSV input"])
    assert.ok(!text.includes(secret));
  session.lock();
  assert.equal(worker.stopped, true);
  await assert.rejects(session.loadOutbox(source.resourceRef.resourceId), /locked/);
  const restarted = new bridge.EncryptedVaultSession("synthetic_A", {
    storage,
    workerFactory: () => new LocalWorker(),
  });
  await restarted.unlock(vault, material());
  await restarted.acceptVault(vault);
  assert.equal(
    JSON.stringify((await restarted.loadOutbox(source.resourceRef.resourceId)).carrier),
    encoded,
  );
  await restarted.verifyReceipt(pending, (await stored({ vault }, pending)).receipt);
  await restarted.clearOutbox(source.resourceRef.resourceId, pending.operationId);
  assert.equal(await restarted.loadOutbox(source.resourceRef.resourceId), null);
  restarted.lock();
  const other = new bridge.EncryptedVaultSession("synthetic_B", {
    storage,
    workerFactory: () => new LocalWorker(),
  });
  await assert.rejects(other.unlock(vault, material()), /wrong_account/);
  other.lock();
});
test("lock rejects late crypto results before UI exposure and malformed outbox is never resent", async () => {
  const f = await fixture();
  const storage = new MemoryStorage();
  await storage.put((await f.session.owner) + ":pin", f.local.pin);
  await storage.put((await f.session.owner) + ":device:" + f.vault.vaultId, {
    ownerSubject: await f.session.owner,
    device: f.local.device,
  });
  const worker = new LocalWorker();
  const session = new bridge.EncryptedVaultSession(f.uid, { storage, workerFactory: () => worker });
  await session.unlock(f.vault, f.material());
  await session.acceptVault(f.vault);
  await storage.put((await f.session.owner) + ":outbox:" + source.resourceRef.resourceId, {
    ownerSubject: await f.session.owner,
    vaultId: f.vault.vaultId,
    pending: { plaintext: "must never be sent" },
  });
  await assert.rejects(
    session.loadOutbox(source.resourceRef.resourceId),
    /wrong_account|invalid_data/,
  );
  let resume;
  worker.pause = new Promise((resolve) => {
    resume = resolve;
  });
  const pending = session.signSource(source.resourceRef.resourceId);
  await new Promise((r) => setImmediate(r));
  session.lock();
  await assert.rejects(pending, /locked/);
  resume();
});
test("Passkey helpers require UV and supported PRF without serializing credential or PRF outputs", async () => {
  const keys = ["window", "navigator", "PublicKeyCredential"];
  const previous = Object.fromEntries(
    keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  let createOptions, getOptions;
  let supported = true,
    uv = true;
  const auth = () => {
    const a = new Uint8Array(37);
    a[32] = uv ? 4 : 0;
    return a.buffer;
  };
  const raw = crypto.getRandomValues(new Uint8Array(32)).buffer;
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const credential = () => ({
    rawId: raw,
    response: { authenticatorData: auth(), getAuthenticatorData: auth },
    getClientExtensionResults: () => ({
      prf: {
        enabled: supported,
        results: supported ? { first: secret.slice().buffer } : undefined,
      },
    }),
    toJSON() {
      throw new Error("credential serialization forbidden");
    },
  });
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { isSecureContext: true },
    });
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: class {},
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        credentials: {
          create: async (options) => {
            createOptions = options;
            return credential();
          },
          get: async (options) => {
            getOptions = options;
            return credential();
          },
        },
      },
    });
    const made = await passkey.createVaultPasskey("synthetic_A");
    assert.equal(made.secret.byteLength, 32);
    assert.equal(createOptions.publicKey.authenticatorSelection.userVerification, "required");
    const first = new Uint8Array(createOptions.publicKey.extensions.prf.eval.first);
    const prefix = new TextEncoder().encode("FolioView/device-keystore/v1");
    assert.deepEqual(first.slice(0, prefix.length), prefix);
    assert.equal(first[prefix.length], 0);
    assert.equal(first.length, prefix.length + 33);
    const opened = await passkey.unlockVaultPasskey({
      ...made,
      profile: "folioview.passkey-vault.v1",
    });
    assert.equal(opened.secret.byteLength, 32);
    assert.equal(getOptions.publicKey.userVerification, "required");
    assert.deepEqual(
      new Uint8Array(getOptions.publicKey.allowCredentials[0].id),
      new Uint8Array(raw),
    );
    supported = false;
    await assert.rejects(passkey.createVaultPasskey("synthetic_A"), /passkey_unsupported/);
    supported = true;
    uv = false;
    await assert.rejects(passkey.unlockVaultPasskey(made), /unlock_failed/);
  } finally {
    for (const k of keys) {
      if (previous[k]) Object.defineProperty(globalThis, k, previous[k]);
      else delete globalThis[k];
    }
  }
});

test("revoked authors and global key epochs deny new retries while owner history remains readable", async () => {
  const f = await fixture();
  const pending = await f.session.sealSnapshot({ content: content(), source, expectedRevision: 0 });
  const old = await stored(f, pending);
  const fresh = new core.VaultCore(f.uid, () => 1000);
  await fresh.unlock(f.vault, f.material());
  const registration = await fresh.prepareDeviceRegistration(f.vault);
  const second = {
    ...f.vault,
    version: 2,
    registryHistory: [...f.vault.registryHistory, registration.registryBundle],
  };
  await fresh.acceptVault(second);
  const entries = structuredClone(registration.registryBundle.entries);
  const revoked = [f.local.device.signingKeyId, f.local.device.encryptionKeyId].sort();
  const descriptions = [];
  for (const e of entries) {
    const c = JSON.parse(Buffer.from(e.certificate.payload, "base64url").toString());
    if (revoked.includes(c.keyId)) e.active = false;
    descriptions.push({
      certificateId: c.certificateId,
      payloadDigest: await core.sha(core.canonical(c)),
      active: e.active,
    });
  }
  const cp = JSON.parse(
    Buffer.from(registration.registryBundle.checkpoint.payload, "base64url").toString(),
  );
  const next = {
    ...cp,
    registrySequence: 3,
    previousDigest: await core.sha(core.canonical(cp)),
    entriesDigest: await core.sha(
      core.canonical(descriptions.sort((a, b) => (a.certificateId < b.certificateId ? -1 : 1))),
    ),
    revokedKeyIds: revoked,
    keyEpoch: 2,
  };
  const { FlattenedSign } = await import("jose");
  const checkpoint = await new FlattenedSign(new TextEncoder().encode(core.canonical(next)))
    .setProtectedHeader({
      alg: "ES256",
      kid: f.vault.rootKeyId,
      typ: "fv-control+jws",
      cty: "application/json",
    })
    .sign(f.session.root);
  const third = {
    ...second,
    version: 3,
    registryHistory: [
      ...second.registryHistory,
      { contractVersion: core.CONTRACT, checkpoint, entries },
    ],
  };
  await fresh.acceptVault(third);
  await assert.rejects(fresh.validatePending(pending), /key_revoked|binding_mismatch/);
  assert.deepEqual(await fresh.openSnapshot(old, source), {
    ...content(),
    data: { ...content().data, snapshotId: pending.snapshotId },
  });
  await assert.rejects(f.session.acceptVault(third), /key_revoked/);
});

test("committed bootstrap or device registration with lost response reuses sealed keys without consuming another slot", async () => {
  const storage = new MemoryStorage();
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const salt = core.b64(crypto.getRandomValues(new Uint8Array(32)));
  const material = () => ({
    credentialId: core.b64(new TextEncoder().encode("synthetic-durable-credential")),
    prfSalt: salt,
    secret: secret.slice().buffer,
  });
  const firstWorker = new LocalWorker();
  const first = new bridge.EncryptedVaultSession("synthetic_durable_A", {
    storage,
    workerFactory: () => firstWorker,
  });
  const created = await first.beginCreate(material());
  const deviceId = firstWorker.core.device.deviceId;
  assert.ok(!("localPending" in created));
  assert.ok(![...storage.records.keys()].some((k) => k.endsWith(":pin")));
  const vault = {
    vaultId: created.vaultId,
    rootJwk: created.rootJwk,
    rootKeyId: created.rootKeyId,
    registryHistory: [created.registryBundle],
    archive: created.archive,
    version: 1,
  };
  first.lock();
  const recovered = new bridge.EncryptedVaultSession("synthetic_durable_A", {
    storage,
    workerFactory: () => new LocalWorker(),
  });
  assert.deepEqual(await recovered.unlock(vault, material()), { needsDeviceRegistration: false });
  await recovered.acceptVault(vault);
  const owner = await core.sha("synthetic_durable_A");
  assert.equal((await storage.get(owner + ":device:" + vault.vaultId)).device.deviceId, deviceId);
  assert.equal(await storage.get(owner + ":pending-device:" + vault.vaultId), null);
  recovered.lock();
  const newBrowserStorage = new MemoryStorage();
  const newWorker = new LocalWorker();
  const newBrowser = new bridge.EncryptedVaultSession("synthetic_durable_A", {
    storage: newBrowserStorage,
    workerFactory: () => newWorker,
  });
  assert.deepEqual(await newBrowser.unlock(vault, material()), { needsDeviceRegistration: true });
  const update = await newBrowser.prepareDeviceRegistration(vault);
  const newDeviceId = newWorker.core.device.deviceId;
  assert.ok(!("localPending" in update));
  const next = {
    ...vault,
    version: 2,
    registryHistory: [...vault.registryHistory, update.registryBundle],
  };
  newBrowser.lock();
  const restart = new bridge.EncryptedVaultSession("synthetic_durable_A", {
    storage: newBrowserStorage,
    workerFactory: () => new LocalWorker(),
  });
  assert.deepEqual(await restart.unlock(next, material()), { needsDeviceRegistration: false });
  await restart.acceptVault(next);
  assert.equal(
    (await newBrowserStorage.get(owner + ":device:" + vault.vaultId)).device.deviceId,
    newDeviceId,
  );
  assert.equal(next.registryHistory.at(-1).entries.length, 5);
  assert.equal(await newBrowserStorage.get(owner + ":pending-device:" + vault.vaultId), null);
  restart.lock();
  for (const record of [...storage.records.values(), ...newBrowserStorage.records.values()]) {
    const s = JSON.stringify(record);
    assert.ok(!s.includes("PrivateJwk"));
    assert.ok(!s.includes('"d":'));
  }
});

test("uncommitted registration retries preserve exact operation, and conflict rebases reuse the same key pair", async () => {
  const f = await fixture();
  const storage = new MemoryStorage();
  const w = new LocalWorker();
  const first = new bridge.EncryptedVaultSession(f.uid, { storage, workerFactory: () => w });
  await first.unlock(f.vault, f.material());
  const update = await first.prepareDeviceRegistration(f.vault);
  const ids = [w.core.device.sigId, w.core.device.encId];
  first.lock();
  const restartedWorker = new LocalWorker();
  const restarted = new bridge.EncryptedVaultSession(f.uid, {
    storage,
    workerFactory: () => restartedWorker,
  });
  assert.deepEqual(await restarted.unlock(f.vault, f.material()), {
    needsDeviceRegistration: true,
  });
  assert.deepEqual(await restarted.prepareDeviceRegistration(f.vault), update);
  assert.deepEqual([restartedWorker.core.device.sigId, restartedWorker.core.device.encId], ids);
  const advanced = { ...f.vault, version: 2 };
  const rebased = await restarted.prepareDeviceRegistration(advanced);
  assert.equal(rebased.expectedVersion, 2);
  assert.notEqual(rebased.operationId, update.operationId);
  assert.deepEqual(
    rebased.registryBundle.entries.slice(-2),
    update.registryBundle.entries.slice(-2),
  );
  assert.deepEqual([restartedWorker.core.device.sigId, restartedWorker.core.device.encId], ids);
  restarted.lock();
  const owner = await core.sha(f.uid);
  const pending = await storage.get(owner + ":pending-device:" + f.vault.vaultId);
  pending.pending.rootKeyId = "A".repeat(43);
  await storage.put(owner + ":pending-device:" + f.vault.vaultId, pending);
  const bad = new bridge.EncryptedVaultSession(f.uid, {
    storage,
    workerFactory: () => new LocalWorker(),
  });
  await assert.rejects(bad.unlock(f.vault, f.material()), /wrong_account|unlock_failed/);
  assert.equal(await storage.get(owner + ":pin"), null);
  bad.lock();
});

test("readonly historical pin commits preserve another tab's sealed device and pending enrollment", async () => {
  const fake = require("fake-indexeddb");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  const writer = new nativeStorage.BrowserEncryptedStorage(),
    reader = new nativeStorage.BrowserEncryptedStorage();
  const owner = "synthetic_readonly_owner",
    vaultId = "synthetic_readonly_vault";
  const pin = {
    ownerSubject: owner,
    vaultId,
    rootKeyId: "synthetic_root",
    registrySequence: 1,
    checkpointDigest: "a".repeat(64),
    keyEpoch: 1,
  };
  const nextPin = { ...pin, registrySequence: 2, checkpointDigest: "b".repeat(64) };
  const history = [pin, nextPin];
  const sealed = { ciphertext: "synthetic_sealed_device_from_another_tab", iv: "synthetic_iv" };
  try {
    // The reader's Worker was unlocked before the other tab registered its device.
    const readonly = { pin: nextPin, history, device: undefined, pending: null };
    await writer.commitVault(owner, {
      pin,
      history: [pin],
      device: { ciphertext: "old_sealed_device" },
    });
    await writer.commitVault(owner, { pin: nextPin, history, device: sealed });
    await writer.stageDevice(
      owner + ":pending-device:" + vaultId,
      { ownerSubject: owner, pending: { operationId: "synthetic_pending_next" } },
      null,
    );
    await reader.commitVault(owner, readonly);
    assert.equal(
      JSON.stringify(await reader.get(owner + ":device:" + vaultId)),
      JSON.stringify({ ownerSubject: owner, device: sealed }),
    );
    assert.equal(JSON.stringify(await reader.get(owner + ":pin")), JSON.stringify(nextPin));
    assert.equal(
      (await reader.get(owner + ":pending-device:" + vaultId)).pending.operationId,
      "synthetic_pending_next",
    );
    await assert.rejects(reader.commitVault(owner, { pin, history: [pin] }), /rollback_detected/);
    assert.equal(
      (await reader.get(owner + ":device:" + vaultId)).device.ciphertext,
      sealed.ciphertext,
    );
    await reader.commitVault("synthetic_other_owner", {
      pin: { ...pin, ownerSubject: "synthetic_other_owner" },
      history: [{ ...pin, ownerSubject: "synthetic_other_owner" }],
    });
    assert.equal(await reader.get("synthetic_other_owner:device:" + vaultId), null);
  } finally {
    for (const storage of [writer, reader]) if (storage.database) (await storage.database).close();
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else delete globalThis.indexedDB;
  }
});

test("native IndexedDB transactions keep one outbox winner, compare-delete exact operations and reject stale/forked pin commits", async () => {
  const fake = require("fake-indexeddb");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  const storage1 = new nativeStorage.BrowserEncryptedStorage(),
    storage2 = new nativeStorage.BrowserEncryptedStorage();
  const w1 = new LocalWorker(),
    w2 = new LocalWorker();
  let a, b;
  try {
    const secret = crypto.getRandomValues(new Uint8Array(32)),
      salt = core.b64(crypto.getRandomValues(new Uint8Array(32)));
    const material = () => ({
      credentialId: core.b64(new TextEncoder().encode("synthetic-idb-credential")),
      prfSalt: salt,
      secret: secret.slice().buffer,
    });
    const uid = "synthetic_idb_A";
    const owner = await core.sha(uid);
    a = new bridge.EncryptedVaultSession(uid, { storage: storage1, workerFactory: () => w1 });
    const created = await a.beginCreate(material());
    const vault = {
      vaultId: created.vaultId,
      rootJwk: created.rootJwk,
      rootKeyId: created.rootKeyId,
      registryHistory: [created.registryBundle],
      archive: created.archive,
      version: 1,
    };
    await a.acceptVault(vault);
    b = new bridge.EncryptedVaultSession(uid, { storage: storage2, workerFactory: () => w2 });
    await b.unlock(vault, material());
    await b.acceptVault(vault);
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    w1.pause = w2.pause = gate;
    let seen = 0;
    for (const worker of [w1, w2]) {
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (m, t) => {
        if (m.method === "sealSnapshot") seen++;
        post(m, t);
      };
    }
    const one = a.sealSnapshot({ content: content(), source, expectedRevision: 0 }),
      two = b.sealSnapshot({ content: content(), source, expectedRevision: 0 });
    for (let n = 0; seen < 2 && n < 100; n++) await new Promise((r) => setTimeout(r, 1));
    assert.equal(seen, 2);
    release();
    const results = await Promise.allSettled([one, two]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected")[0].reason.code, "pending_upload");
    const winner = results.find((r) => r.status === "fulfilled").value;
    const key = owner + ":outbox:" + source.resourceRef.resourceId;
    assert.equal(
      JSON.stringify((await storage1.get(key)).pending.carrier),
      JSON.stringify(winner.carrier),
    );
    w1.pause = w2.pause = null;
    const newer = await w2.core.sealSnapshot({ content: content(), source, expectedRevision: 0 });
    const remove = storage1.removeOperation.bind(storage1);
    storage1.removeOperation = async (k, id) => {
      await storage2.removeOperation(k, id);
      assert.equal(
        await storage2.insert(k, { ownerSubject: owner, vaultId: vault.vaultId, pending: newer }),
        true,
      );
      return remove(k, id);
    };
    await assert.rejects(
      a.clearOutbox(source.resourceRef.resourceId, winner.operationId),
      /operation_conflict/,
    );
    assert.equal((await storage2.get(key)).pending.operationId, newer.operationId);
    const fresh = new core.VaultCore(uid, () => 1000);
    await fresh.unlock(vault, material());
    const update = await fresh.prepareDeviceRegistration(vault);
    const next = {
      ...vault,
      version: 2,
      registryHistory: [...vault.registryHistory, update.registryBundle],
    };
    await a.acceptVault(next);
    const pin = await storage1.get(owner + ":pin");
    assert.equal(pin.registrySequence, 2);
    await assert.rejects(b.acceptVault(vault), /rollback_detected/);
    assert.equal(w2.stopped, true);
    assert.deepEqual(await storage1.get(owner + ":pin"), pin);
    const local = await w1.core.acceptVault(next);
    const fork = {
      ...local,
      pin: { ...local.pin, checkpointDigest: "f".repeat(64) },
      history: local.history.map((p) =>
        p.registrySequence === 2 ? { ...p, checkpointDigest: "f".repeat(64) } : p,
      ),
    };
    await assert.rejects(storage2.commitVault(owner, fork), /registry_conflict/);
    assert.deepEqual(await storage1.get(owner + ":pin"), pin);
  } finally {
    a?.lock();
    b?.lock();
    for (const storage of [storage1, storage2])
      if (storage.database) (await storage.database).close();
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else delete globalThis.indexedDB;
  }
});
