const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const CONTRACT = "folioview.agent-workspace.v2.0";
const settle = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise((success) => {
    resolve = success;
  });
  return { promise, resolve };
}

function harness() {
  const calls = [],
    requests = [],
    instances = [],
    cells = [],
    effects = [];
  let index = 0,
    dirty = false;
  let auth = { status: "authenticated", sessionKey: "owner_A:1", profile: { uid: "owner_A" } };
  let vault = {
    vaultId: "vault_A",
    rootKeyId: "root_A",
    version: 1,
    registryHistory: [],
    archive: { credentialId: "same_passkey", prfSalt: "same_salt" },
  };
  let pending = null,
    cancellation = null,
    applied = false,
    cancelled = false,
    receipt = null;
  let postFailure = null,
    cancelFailure = null,
    postHold = null,
    unlockHold = null,
    localPending = false;
  let prepared = 0,
    finished = 0,
    cleared = 0,
    passkeys = 0,
    ordinaryCalls = 0;
  const materials = [];
  const source = {
    resourceRef: {
      kind: "holdings",
      sourceService: "portfolio",
      resourceId: "synthetic_holdings_A",
      incarnation: "synthetic_incarnation_A",
    },
    sourceEpoch: 1,
  };
  const summary = () => ({
    vaultId: vault.vaultId,
    rootKeyId: vault.rootKeyId,
    registrySequence: vault.version,
    checkpointDigest: "checkpoint_" + vault.version,
    keyEpoch: 1,
    canRenew: !pending,
    reason: null,
    device: {
      deviceId: "device_A",
      signingKeyId: "old_sig",
      encryptionKeyId: "old_enc",
      expiresAt: 900,
    },
    recovery: { keyId: "old_rec", expiresAt: 900 },
    pending: pending
      ? {
          operationId: pending.operationId,
          state: applied ? "applied" : cancelled ? "conflict" : "ready",
          expiresAt: 1200,
        }
      : null,
  });
  class Session {
    constructor(uid) {
      this.uid = uid;
      this.locked = false;
      instances.push(this);
    }
    lock() {
      calls.push("lock");
      this.locked = true;
    }
    active() {
      if (this.locked) throw { code: "locked" };
    }
    async unlockForKeyRenewal() {
      calls.push("renewal-unlock");
      if (unlockHold) await unlockHold.promise;
      this.active();
      return { renewalOnly: true };
    }
    async inspectKeyRenewal() {
      this.active();
      return summary();
    }
    async getKeyRenewal() {
      this.active();
      return pending
        ? {
            packet: pending,
            state: summary().pending.state,
            cancellation: cancellation ?? undefined,
          }
        : null;
    }
    async prepareKeyRenewal() {
      this.active();
      calls.push("prepare");
      if (pending) throw { code: "key_renewal_pending" };
      if (localPending) throw { code: "key_renewal_local_pending" };
      prepared++;
      pending = {
        operationId: "synthetic_original_renewal",
        body: {
          contractVersion: CONTRACT,
          registryBundle: { synthetic: true },
          archive: { ciphertext: "SYNTHETIC_ONLY" },
          command: { signature: "root_approval" },
          archiveCommand: { signature: "root_archive_approval" },
        },
      };
      return pending;
    }
    async finishKeyRenewal(_vault, _life, value, operation) {
      this.active();
      calls.push("finish");
      assert.ok(applied);
      assert.equal(operation, pending.operationId);
      assert.equal(JSON.stringify(value), JSON.stringify(receipt));
      pending = null;
      cancellation = null;
      finished++;
    }
    async prepareKeyRenewalCancellation() {
      this.active();
      calls.push("prepare-cancel");
      cancellation ??= {
        operationId: "synthetic_original_cancel",
        body: {
          contractVersion: CONTRACT,
          archive: { ciphertext: "SYNTHETIC_CANCEL_ONLY" },
          command: { signature: "root_cancel_approval" },
        },
      };
      return cancellation;
    }
    async discardKeyRenewal(_vault, _life, operation) {
      this.active();
      calls.push("discard");
      assert.ok(cancelled && !applied);
      assert.equal(operation, pending.operationId);
      pending = null;
      cancellation = null;
      cleared++;
    }
    async openTask() {
      ordinaryCalls++;
      throw Error("Renewal-only Worker must not receive ordinary calls");
    }
    async openResult() {
      return this.openTask();
    }
    async signAgentGrants() {
      return this.openTask();
    }
  }
  const applyRenewal = () => {
    applied = true;
    cancelled = false;
    vault = { ...vault, version: vault.version + 1 };
    receipt = {
      contractVersion: CONTRACT,
      profile: "folioview.vault-key-renewal.v1",
      receipt: { operationId: pending.operationId },
    };
  };
  const requestPrivate = async (service, route, owner, options = {}) => {
    requests.push({ service, route, owner, options });
    if (route === "/api/v2/vaults/current")
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          vault: owner.startsWith("owner_A:") ? vault : null,
          sources: owner.startsWith("owner_A:") ? [source] : [],
        }),
      );
    if (route.endsWith("/archive") && options.method !== "PUT")
      return new Response(JSON.stringify({ contractVersion: CONTRACT, archive: vault.archive }));
    if (route.includes("/key-renewal-operations/"))
      return receipt
        ? new Response(JSON.stringify(receipt))
        : new Response(
            JSON.stringify({ contractVersion: CONTRACT, error: { code: "not_found" } }),
            { status: 404 },
          );
    if (route.endsWith("/key-renewals")) {
      if (postHold) await postHold.promise;
      if (postFailure !== "before") applyRenewal();
      if (postFailure) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify(receipt), { status: 201 });
    }
    if (route.endsWith("/archive") && options.method === "PUT") {
      if (cancelFailure === "renewal-wins") {
        applyRenewal();
        return new Response("{}", { status: 409 });
      }
      if (cancelFailure !== "before") {
        cancelled = true;
        vault = { ...vault, version: vault.version + 1 };
      }
      if (cancelFailure) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ contractVersion: CONTRACT }));
    }
    throw Error("Unexpected renewal request " + route);
  };
  const changed = (before, after) => !before || after.some((value, i) => value !== before[i]);
  const hooks = {
    useState(initial) {
      const slot = index++;
      cells[slot] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        cells[slot].value,
        (next) => {
          const value = typeof next === "function" ? next(cells[slot].value) : next;
          dirty ||= value !== cells[slot].value;
          cells[slot].value = value;
        },
      ];
    },
    useRef(current) {
      const slot = index++;
      cells[slot] ??= { current };
      return cells[slot];
    },
    useCallback(callback, dependencies) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].dependencies, dependencies))
        cells[slot] = { callback, dependencies };
      return cells[slot].callback;
    },
    useEffect(effect, dependencies) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].dependencies, dependencies))
        effects.push({ slot, effect, dependencies });
    },
  };
  const imports = {
    react: hooks,
    "@/components/AuthProvider": {
      useAuth: () => ({
        ...auth,
        portfolioConfigured: true,
        agentHubConfigured: true,
        requestPrivate,
        signIn() {},
      }),
    },
    "@/lib/encrypted-vault": { EncryptedVaultSession: Session },
    "@/lib/encrypted-passkey": {
      async unlockVaultPasskey() {
        passkeys++;
        const material = {
          secret: new ArrayBuffer(32),
          credentialId: "same_passkey",
          prfSalt: "same_salt",
        };
        new Uint8Array(material.secret).fill(9);
        materials.push(material);
        return material;
      },
      createVaultPasskey() {
        throw Error("No new Passkey is created for renewal");
      },
      replaceVaultPasskey() {
        throw Error("No Passkey replacement");
      },
    },
    "@/lib/holdings-csv": {
      HOLDINGS_CSV_MAX_BYTES: 1024,
      HoldingsCsvError: class extends Error {},
      parseHoldingsCsv() {
        throw Error("No CSV parse in renewal-only mode");
      },
      selectHoldingsAccounts() {},
    },
  };
  const module = { exports: {} },
    filename = path.join(__dirname, "../components/useHoldingsWorkspace.ts");
  vm.runInNewContext(
    transformSync(readFileSync(filename, "utf8"), {
      filename,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" },
    }).code,
    {
      module,
      exports: module.exports,
      crypto: webcrypto,
      TextEncoder,
      Uint8Array,
      AbortController,
      window: { setTimeout: () => 1, clearTimeout() {} },
      require(name) {
        assert.ok(Object.hasOwn(imports, name), name);
        return imports[name];
      },
    },
  );
  let model;
  const view = () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      dirty = false;
      index = 0;
      model = module.exports.useHoldingsWorkspace();
      const pendingEffects = effects.splice(0);
      pendingEffects.forEach(({ slot, effect, dependencies }) => {
        cells[slot]?.cleanup?.();
        cells[slot] = { dependencies, cleanup: effect() };
      });
      if (!dirty && effects.length === 0) return model;
    }
    throw Error("Renewal harness did not settle");
  };
  return {
    view,
    requests,
    calls,
    instances,
    materials,
    async ready() {
      view();
      await settle();
      return view();
    },
    async run(name, ...args) {
      const work = view()[name](...args);
      view();
      await work;
      return view();
    },
    auth(value) {
      auth = value;
      return view();
    },
    postFailure(value) {
      postFailure = value;
    },
    cancelFailure(value) {
      cancelFailure = value;
    },
    postHold(value) {
      postHold = value;
    },
    unlockHold(value) {
      unlockHold = value;
    },
    localPending(value) {
      localPending = value;
    },
    otherTabCandidate() {
      pending = { operationId: "synthetic_other_tab", body: { contractVersion: CONTRACT } };
    },
    counts() {
      return { prepared, finished, cleared, passkeys, ordinaryCalls };
    },
    packet() {
      return pending;
    },
    cancellation() {
      return cancellation;
    },
  };
}

test("expired certificates enter a renewal-only review; no generation or POST occurs before confirmation", async () => {
  const f = harness();
  await f.ready();
  assert.equal(f.view().phase, "locked");
  assert.equal(f.counts().passkeys, 0);
  const state = await f.run("reviewKeyRenewal");
  assert.equal(state.phase, "renewal-only");
  assert.equal(state.canWriteState, false);
  assert.equal(state.keyRenewal.device.expiresAt, 900);
  assert.equal(f.counts().prepared, 0);
  for (const operation of [
    () => state.openTask({}),
    () => state.openResult({}),
    () => state.signAgentGrants({}),
  ])
    await assert.rejects(operation, (error) => error.code === "unlock_required");
  await f.run("importFile", { size: 1, text: async () => "PRIVATE" });
  const before = f.requests.length;
  await f.run("readStored");
  assert.equal(f.requests.length, before);
  await f.run("unlock");
  assert.equal(f.requests.length, before);
  assert.equal(f.counts().ordinaryCalls, 0);
  assert.ok(
    f.materials.every((material) => new Uint8Array(material.secret).every((byte) => byte === 0)),
  );
  assert.equal(f.requests.filter((request) => request.options.method === "POST").length, 0);
  await f.run("lock");
  assert.equal(f.view().keyRenewal, null);
});

test("confirmation submits only the encrypted packet, verifies original receipt, promotes once and locks", async () => {
  const f = harness();
  await f.ready();
  await f.run("reviewKeyRenewal");
  const before = f.view().vaultGeneration;
  const state = await f.run("confirmKeyRenewal");
  assert.equal(state.phase, "locked");
  assert.equal(state.keyNotice, "key_renewal_saved");
  assert.ok(state.vaultGeneration > before);
  assert.equal(f.counts().finished, 1);
  assert.equal(f.packet(), null);
  const writes = f.requests.filter((request) => request.options.method === "POST");
  assert.equal(writes.length, 1);
  assert.ok(writes[0].route.endsWith("/key-renewals"));
  assert.equal(writes[0].options.headers["Idempotency-Key"], "synthetic_original_renewal");
  assert.ok(!JSON.stringify(writes).includes("secret"));
  assert.ok(
    f.requests.findIndex((request) => request.route.includes("/key-renewal-operations/")) <
      f.requests.indexOf(writes[0]),
  );
});

test("unknown committed reply recovers the original receipt without generating or submitting another request", async () => {
  const f = harness();
  await f.ready();
  await f.run("reviewKeyRenewal");
  f.postFailure("after");
  await f.run("confirmKeyRenewal");
  assert.equal(f.view().phase, "renewal-only");
  assert.ok(f.packet());
  f.postFailure(null);
  await f.run("refreshKeyRenewal");
  assert.equal(f.view().phase, "locked");
  assert.equal(f.counts().prepared, 1);
  assert.equal(f.counts().finished, 1);
  assert.equal(f.requests.filter((request) => request.options.method === "POST").length, 1);
});

test("unknown uncommitted outcome retries the original ciphertext and operation; lock preserves it", async () => {
  const f = harness();
  await f.ready();
  await f.run("reviewKeyRenewal");
  f.postFailure("before");
  await f.run("confirmKeyRenewal");
  const original = JSON.stringify(f.packet());
  await f.run("lock");
  assert.equal(f.view().keyRenewal, null);
  assert.equal(JSON.stringify(f.packet()), original);
  await f.run("reviewKeyRenewal");
  f.postFailure(null);
  await f.run("confirmKeyRenewal");
  const writes = f.requests.filter((request) => request.options.method === "POST");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].options.json, writes[1].options.json);
  assert.equal(
    writes[0].options.headers["Idempotency-Key"],
    writes[1].options.headers["Idempotency-Key"],
  );
  assert.equal(f.counts().prepared, 1);
  assert.equal(f.counts().finished, 1);
});

test("safe cancellation verifies a competing archive fence and retains unknown cancellation requests", async () => {
  const f = harness();
  await f.ready();
  await f.run("reviewKeyRenewal");
  f.postFailure("before");
  await f.run("confirmKeyRenewal");
  f.cancelFailure("before");
  await f.run("cancelKeyRenewal");
  assert.equal(f.view().keyRenewalCancellation, true);
  assert.ok(f.packet());
  assert.ok(f.cancellation());
  assert.equal(f.counts().cleared, 0);
  const original = JSON.stringify(f.cancellation());
  f.cancelFailure(null);
  await f.run("cancelKeyRenewal");
  assert.equal(f.view().phase, "locked");
  assert.equal(f.view().keyNotice, "key_renewal_cancelled");
  assert.equal(f.counts().cleared, 1);
  const writes = f.requests.filter((request) => request.options.method === "PUT");
  assert.equal(writes.length, 2);
  assert.equal(
    JSON.stringify({
      operationId: writes[1].options.headers["Idempotency-Key"],
      body: writes[1].options.json,
    }),
    original,
  );
});

test("if renewal wins the cancellation race, its active candidate is finished rather than discarded", async () => {
  const f = harness();
  await f.ready();
  await f.run("reviewKeyRenewal");
  f.postFailure("before");
  await f.run("confirmKeyRenewal");
  f.cancelFailure("renewal-wins");
  await f.run("cancelKeyRenewal");
  assert.equal(f.view().keyNotice, "key_renewal_saved");
  assert.equal(f.counts().finished, 1);
  assert.equal(f.counts().cleared, 0);
});

test("another tab’s candidate and local outbox never get overwritten or silently submitted", async () => {
  for (const kind of ["tab", "outbox"]) {
    const f = harness();
    await f.ready();
    await f.run("reviewKeyRenewal");
    if (kind === "tab") f.otherTabCandidate();
    else f.localPending(true);
    await f.run("confirmKeyRenewal");
    assert.equal(
      f.view().error,
      kind === "tab" ? "key_renewal_pending" : "key_renewal_local_pending",
    );
    assert.equal(f.counts().prepared, 0);
    assert.equal(f.requests.filter((request) => request.options.method === "POST").length, 0);
  }
});

test("late Passkey review and network completion cannot resurrect locked, signed-out or switched sessions", async () => {
  for (const stage of ["unlock", "post"])
    for (const change of ["lock", "logout", "account", "session"]) {
      const f = harness();
      await f.ready();
      const hold = deferred();
      let work;
      if (stage === "unlock") {
        f.unlockHold(hold);
        work = f.view().reviewKeyRenewal();
      } else {
        await f.run("reviewKeyRenewal");
        f.postHold(hold);
        work = f.view().confirmKeyRenewal();
      }
      await settle();
      f.view();
      const previous = f.view();
      if (change === "lock") previous.lock();
      else if (change === "logout")
        f.auth({ status: "anonymous", sessionKey: null, profile: null });
      else
        f.auth({
          status: "authenticated",
          sessionKey: change === "session" ? "owner_A:2" : "owner_B:1",
          profile: { uid: change === "session" ? "owner_A" : "owner_B" },
        });
      assert.equal(f.view().keyRenewal, null);
      assert.equal(f.view().content, null);
      hold.resolve();
      await work;
      await settle();
      f.view();
      assert.notEqual(f.view().phase, "renewal-only");
      assert.equal(f.counts().finished, 0);
      assert.ok(f.instances.every((instance) => instance.locked));
      await assert.rejects(
        () => previous.openTask({}),
        (error) => error.code === "unlock_required",
      );
    }
});

test("stale review callbacks cannot submit a candidate from a later unlock generation", async () => {
  const f = harness();
  await f.ready();
  await f.run("reviewKeyRenewal");
  const stale = f.view();
  await f.run("lock");
  await f.run("reviewKeyRenewal");
  await stale.confirmKeyRenewal();
  f.view();
  assert.equal(f.counts().prepared, 0);
  assert.equal(f.requests.filter((request) => request.options.method === "POST").length, 0);
  assert.equal(f.view().phase, "renewal-only");
});
