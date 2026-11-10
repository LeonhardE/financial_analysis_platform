const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");
const { createHarness } = require("./full-flow-crypto-fixture.cjs");
const { compileVaultWorker } = require("./worker-dispatch-helpers.cjs");

test("one unlocked owner prepares persistent registration; sealed original retries survive lock and block key changes until verified", async () => {
  const h = await createHarness(),
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "folioview-persistent-storage-")),
    fake = require("fake-indexeddb"),
    previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    previousRange = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange"),
    clients = [],
    workers = [];
  let storage;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new fake.IDBFactory(),
  });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: fake.IDBKeyRange });
  try {
    for (const name of ["encrypted-types", "encrypted-storage", "encrypted-vault"]) {
      const filename = path.resolve(__dirname, "../lib/" + name + ".ts");
      let { code } = transformSync(readFileSync(filename, "utf8"), {
        filename,
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "es6" },
      });
      code = code.replace(/from "\.\/(encrypted-[^"]+)"/g, (_, n) => `from "./${n}.mjs"`);
      code = code.replaceAll(
        '"../../../packages/executor-trust/dist/core.mjs"',
        JSON.stringify(
          pathToFileURL(path.resolve(__dirname, "../../../packages/executor-trust/dist/core.mjs"))
            .href,
        ),
      );
      await fs.writeFile(path.join(directory, name + ".mjs"), code);
    }
    const load = (name) => import(pathToFileURL(path.join(directory, name + ".mjs")).href),
      { EncryptedVaultSession } = await load("encrypted-vault"),
      { BrowserEncryptedStorage } = await load("encrypted-storage"),
      shared = await import(
        pathToFileURL(
          path.resolve(__dirname, "../../../packages/encrypted-workspace/dist/core.mjs"),
        ).href
      ),
      code = compileVaultWorker();
    let CoreError;
    try {
      new h.core.VaultCore("");
    } catch (error) {
      CoreError = error.constructor;
    }
    class LocalWorker {
      constructor() {
        workers.push(this);
        this.methods = [];
        const worker = this;
        class ClockCore extends h.core.VaultCore {
          constructor(uid) {
            super(uid, () => 1000);
          }
        }
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
            if (!worker.stopped) worker.onmessage({ data: structuredClone(value) });
          },
        };
        vm.runInNewContext(code, this.realm);
      }
      postMessage(value, transfer = []) {
        this.methods.push(value.method);
        const copied = structuredClone(value, { transfer });
        queueMicrotask(() => {
          if (!this.stopped) this.realm.onmessage({ data: copied });
        });
      }
      terminate() {
        this.stopped = true;
        this.realm = null;
      }
    }
    storage = new BrowserEncryptedStorage();
    const makeSession = () => {
      const session = new EncryptedVaultSession("synthetic_persistent_owner", {
        storage,
        workerFactory: () => new LocalWorker(),
      });
      clients.push(session);
      return session;
    };
    const session = makeSession(),
      secret = crypto.getRandomValues(new Uint8Array(32)),
      salt = h.core.b64(crypto.getRandomValues(new Uint8Array(32)));
    const material = () => ({
      credentialId: h.core.b64(new TextEncoder().encode("synthetic-persistent-credential")),
      prfSalt: salt,
      secret: secret.slice().buffer,
    });
    await session.prepareCreate();
    const created = await session.beginCreate(material());
    const vault = {
      vaultId: created.vaultId,
      rootJwk: created.rootJwk,
      rootKeyId: created.rootKeyId,
      registryHistory: [created.registryBundle],
      archive: created.archive,
      version: 1,
    };
    await session.acceptVault(vault);
    const metadata = {
      resultId: "presult_synthetic",
      taskId: "task_synthetic",
      runId: "prun_synthetic",
      connectionId: "connection_synthetic",
      receivedAt: 999,
      stateVersion: 2,
      read: false,
      starred: false,
      archived: false,
    };
    const statePacket = await session.signPersistentResultState({
      metadata,
      changes: { read: true },
    });
    const certificate = vault.registryHistory[0].entries
      .map((e) => JSON.parse(Buffer.from(e.certificate.payload, "base64url").toString()))
      .find((e) => e.keyId === statePacket.authorKeyId);
    const stateCommand = await shared.verify(
      statePacket.command,
      certificate.publicJwk,
      "fv-control+jws",
    );
    assert.equal(stateCommand.action, "result_state_update");
    assert.equal(stateCommand.targetId, metadata.resultId);
    assert.equal(stateCommand.expectedVersion, 2);
    assert.deepEqual(stateCommand.parameters, { read: true });
    await assert.rejects(
      session.signPersistentResultState({
        metadata: { ...metadata, plaintext: "CANARY" },
        changes: { read: true },
      }),
    );
    await assert.rejects(
      session.signPersistentResultState({ metadata, changes: { archive: "not_boolean" } }),
    );
    const actor = { connectionId: "synthetic_persistent_connection", clientId: "synthetic_muse" },
      keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
        "sign",
        "verify",
      ]),
      encryption = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
        "deriveBits",
      ]),
      sig = Object.fromEntries(
        Object.entries(await crypto.subtle.exportKey("jwk", keys.publicKey)).filter(([key]) =>
          ["kty", "crv", "x", "y"].includes(key),
        ),
      ),
      enc = Object.fromEntries(
        Object.entries(await crypto.subtle.exportKey("jwk", encryption.publicKey)).filter(([key]) =>
          ["kty", "crv", "x", "y"].includes(key),
        ),
      ),
      kid = await shared.keyId(sig),
      encId = await shared.keyId(enc),
      owner = await h.core.sha("synthetic_persistent_owner"),
      setup = {
        intentId: "synthetic_persistent_setup_0001",
        ownerSubject: owner,
        vaultId: vault.vaultId,
        ...actor,
        authorizationId: "synthetic_native_authorization",
        nonce: h.core.b64(crypto.getRandomValues(new Uint8Array(32))),
        issuedAt: 1000,
        expiresAt: 1300,
        confirmed: true,
      },
      { confirmed, ...locator } = setup,
      payload = {
        contractVersion: shared.CONTRACT,
        profile: "folioview.runtime-pairing.v1",
        artifactType: "runtime_key_offer",
        ...locator,
        expiresAt: 1200,
        agentId: "agent_" + kid,
        signingPublicJwk: sig,
        encryptionPublicJwk: enc,
      },
      command = await shared.sign(payload, keys.privateKey, kid, "fv-control+jws"),
      state = {
        contractVersion: shared.CONTRACT,
        profile: "folioview.runtime-pairing.v1",
        setup,
        offer: {
          command,
          agentId: payload.agentId,
          signingKeyId: kid,
          encryptionKeyId: encId,
          fingerprint: await shared.fingerprint(command),
        },
        protectedHostAttested: false,
        authority: "pairing_observation_only",
      };
    const packet = await session.preparePersistentEnrollment({
      actor,
      setup: state,
      intentId: setup.intentId,
    });
    assert.equal(packet.kind, "identity");
    assert.equal((await session.listPersistentOutbox()).length, 1);
    assert.deepEqual(await session.loadPersistentPending(actor), packet);
    await assert.rejects(
      session.preparePersistentEnrollment({ actor, setup: state, intentId: setup.intentId }),
      /persistent_operation_pending/,
    );
    const row = (await storage.list(owner + ":persistent-owner:"))[0].value;
    assert.ok(!JSON.stringify(row).includes(packet.body.command.signature));
    assert.ok(!JSON.stringify(row).includes('"d":'));
    await assert.rejects(
      storage.stageKeyRenewal(owner, {
        ownerSubject: owner,
        vaultId: vault.vaultId,
        operationId: "synthetic_renewal_00000001",
        pending: {},
      }),
      /key_renewal_local_pending/,
    );
    await assert.rejects(
      storage.stageArchiveChange(owner, {
        ownerSubject: owner,
        vaultId: vault.vaultId,
        profile: "folioview.archive-deletion-candidate.v1",
      }),
      /archive_local_pending/,
    );
    assert.equal(
      workers[0].methods.filter((method) => ["beginCreate", "unlock"].includes(method)).length,
      1,
    );
    session.lock();
    const restored = makeSession();
    await restored.unlock(vault, material());
    await restored.acceptVault(vault);
    assert.deepEqual(await restored.loadPersistentPending(actor), packet);
    const advanced = {
      ...vault,
      version: 2,
      registryHistory: [...vault.registryHistory, packet.registryUpdate.registryBundle],
    };
    await restored.acceptVault(advanced);
    const receipt = {
      contractVersion: shared.CONTRACT,
      profile: "folioview.persistent-agent-identity.v1",
      operationId: packet.operationId,
      fingerprint: await shared.fingerprint(packet.body.command),
      identity: packet.identity,
    };
    await assert.rejects(
      restored.finishPersistentPending(actor, { ...receipt, fingerprint: "0".repeat(64) }),
      /binding_mismatch/,
    );
    assert.equal((await restored.listPersistentOutbox()).length, 1);
    await restored.finishPersistentPending(actor, receipt);
    assert.equal((await restored.listPersistentOutbox()).length, 0);
    assert.equal(workers[1].methods.filter((method) => method === "unlock").length, 1);
  } finally {
    for (const client of clients) client.lock();
    if (storage) await storage.close();
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else delete globalThis.indexedDB;
    if (previousRange) Object.defineProperty(globalThis, "IDBKeyRange", previousRange);
    else delete globalThis.IDBKeyRange;
    await h.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
