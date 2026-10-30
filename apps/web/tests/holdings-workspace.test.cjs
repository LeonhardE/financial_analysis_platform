const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const compile = (file, imports) => {
  const { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
    filename: file,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    AbortController,
    require: (name) => {
      assert.ok(name in imports, `Unexpected import ${name}`);
      return imports[name];
    },
    window: { setTimeout: () => 1, clearTimeout: () => {} },
  });
  return module.exports;
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const CONTRACT = "folioview.agent-workspace.v2.0";
const source = {
  resourceRef: {
    kind: "holdings",
    sourceService: "portfolio",
    resourceId: "holdings_a",
    incarnation: "inc_a",
  },
  sourceEpoch: 1,
};
const content = {
  state: "ready",
  coverage: { state: "unknown", issues: [] },
  sourceAsOf: null,
  fetchedAt: "2026-10-28T19:00:00Z",
  freshness: "unknown",
  data: {
    kind: "holdings",
    snapshotId: "snapshot_preview",
    accounts: [
      {
        accountId: "masked_a",
        displayName: "Synthetic · ••••4821",
        balances: [],
        positions: [
          {
            symbol: "PRIVATE_SENTINEL",
            name: "Synthetic",
            assetId: "asset_a",
            brokerAssetId: "broker_a",
            assetType: "stock",
            quantity: "2",
            currency: "CAD",
            marketValue: { currency: "CAD", amount: "20" },
            exchange: "XSYN",
          },
        ],
      },
    ],
    excludedAssets: [],
  },
};
const preview = {
  resourceContent: content,
  selectedAccountIds: ["masked_a"],
  accounts: [
    {
      accountId: "masked_a",
      displayName: "Synthetic",
      positionCount: 1,
      excludedCount: 0,
      totals: { CAD: "20" },
    },
  ],
  warnings: [],
  stats: {
    positions: 1,
    excluded: 0,
    duplicates: 0,
    accounts: 1,
    inputRows: 1,
    totals: { CAD: "20" },
  },
  reportDate: "2026-10-22",
};
const vault = {
  vaultId: "vault_a",
  version: 1,
  rootJwk: {},
  rootKeyId: "synthetic",
  registryHistory: [],
  archive: { profile: "folioview.passkey-vault.v1" },
};

function harness({
  configured = true,
  hubConfigured = true,
  hasVault = true,
  hasSource = true,
  resultCanWrite = true,
  needsDeviceRegistration = false,
} = {}) {
  const requests = [];
  const instances = [];
  const commits = [];
  const outboxes = new Map();
  const passkey = deferred();
  let auth = { status: "authenticated", sessionKey: "owner_a:1", profile: { uid: "owner_a" } };
  let portfolioConfigured = configured;
  let agentHubConfigured = hubConfigured;
  let bodyHold = null;
  let bodyReads = 0;
  let remoteVault = hasVault ? vault : null;
  let sources = hasSource ? [source] : [];
  let readFailure = null;
  let failCommit = false;
  let getCurrentHold = null;
  let outboxHold = null;
  let seals = 0;
  let passkeyCalls = 0;
  let creates = 0;
  let receiptFailure = false;
  let prepareFailure = false;
  let snapshotSwap = null;
  let receiptFound = false;
  let successfulHead = 0;
  let latestSnapshot = null;
  let forcedHead = null;
  let opens = 0;
  let resultOpens = 0;
  let resultHold = null;
  let readOnlyUnlocks = 0;
  let strictUnlocks = 0;
  let deviceRegistered = !needsDeviceRegistration;
  let devicePacket = null;
  let deviceApplied = false;
  let deviceConflict = false;
  let registryFailure = null;
  let devicePrepares = 0;
  let deviceAccepts = 0;
  let deviceDiscards = 0;
  let recoveryVerifications = 0;
  let registrationPrepares = 0;
  let loseRegistrationRead = false;
  let loseNextCurrent = false;
  const passkeyOptions = [];
  let managementFault = null;
  const management = () => ({
    vaultId: "vault_a",
    rootKeyId: "synthetic",
    registrySequence: remoteVault?.version ?? 1,
    checkpointDigest: `checkpoint_${remoteVault?.version ?? 1}`,
    keyEpoch: 1,
    currentDeviceId: deviceRegistered
      ? deviceApplied && devicePacket?.action === "rotate"
        ? "device_new"
        : "device_a"
      : null,
    canManage: deviceRegistered && resultCanWrite,
    devices: [
      {
        deviceId: "device_a",
        signingKeyId: "signing_a",
        encryptionKeyId: "encryption_a",
        current: true,
        active: true,
        notBefore: 1000,
        expiresAt: 9999999999,
      },
      {
        deviceId: "device_b",
        signingKeyId: "signing_b",
        encryptionKeyId: "encryption_b",
        current: false,
        active: true,
        notBefore: 1000,
        expiresAt: 9999999999,
      },
    ],
    pendingChange: devicePacket
      ? {
          operationId: devicePacket.operationId,
          action: devicePacket.action,
          deviceId: devicePacket.deviceId,
          newDeviceId: devicePacket.newDeviceId,
          state: deviceConflict ? "conflict" : deviceApplied ? "applied" : "ready",
        }
      : null,
  });
  let index = 0;
  let dirty = false;
  const cells = [];
  const effects = [];
  const changed = (before, after) =>
    !before || after.some((value, position) => value !== before[position]);
  class Session {
    constructor(uid) {
      this.uid = uid;
      this.locked = false;
      instances.push(this);
    }
    lock() {
      this.locked = true;
    }
    async prepareCreate() {
      if (prepareFailure) throw { code: "untrusted_vault" };
    }
    async beginCreate() {
      return {
        operationId: "create_operation",
        vaultId: "vault_a",
        rootJwk: {},
        rootKeyId: "synthetic",
        registryBundle: {},
        archive: {},
      };
    }
    async unlock() {
      strictUnlocks++;
      return { needsDeviceRegistration: !deviceRegistered };
    }
    async unlockForResults() {
      readOnlyUnlocks++;
      return { canWriteState: resultCanWrite && deviceRegistered };
    }
    async acceptResultVault() {
      if (this.locked) throw { code: "locked" };
      return { canWriteState: resultCanWrite && deviceRegistered };
    }
    async openResult() {
      resultOpens++;
      if (resultHold) await resultHold.promise;
      return {
        title: "PRIVATE_RESULT",
        summary: "Private",
        sections: [],
        citations: [],
        limitations: [],
      };
    }
    async openTask() {
      resultOpens++;
      if (resultHold) await resultHold.promise;
      return { name: "PRIVATE_TASK" };
    }
    async ownerAgentCall() {
      resultOpens++;
      if (resultHold) await resultHold.promise;
      return { publicPacket: true };
    }
    async publicAgentAnchor() {
      return this.ownerAgentCall();
    }
    async prepareAgentRegistration() {
      return this.ownerAgentCall();
    }
    async signAgentGrants() {
      return this.ownerAgentCall();
    }
    async sealAgentPreparation() {
      return this.ownerAgentCall();
    }
    async signResultState() {
      if (!resultCanWrite) throw { code: "key_revoked" };
      return {
        operationId: "state_operation",
        authorKeyId: "author",
        command: { protected: "opaque", payload: "opaque", signature: "opaque" },
      };
    }
    async acceptVault() {
      if (this.locked) throw { code: "locked" };
    }
    async prepareDeviceRegistration() {
      registrationPrepares++;
      return { operationId: "device_operation", expectedVersion: 1, registryBundle: {} };
    }
    async deviceManagement() {
      if (this.locked) throw { code: "locked" };
      if (managementFault) throw { code: managementFault };
      return management();
    }
    async loadDeviceChange() {
      if (this.locked) throw { code: "locked" };
      return devicePacket;
    }
    async prepareDeviceChange({ action, deviceId }) {
      if (this.locked) throw { code: "locked" };
      devicePrepares++;
      devicePacket ??= {
        operationId: `device_change_operation_${devicePrepares}`,
        expectedVersion: remoteVault.version,
        registryBundle: { synthetic: true },
        action,
        deviceId,
        replacedKeyIds: ["signing_a", "encryption_a"],
        newDeviceId: action === "rotate" ? "device_new" : null,
        newKeyIds: action === "rotate" ? ["new_signing", "new_encryption"] : [],
      };
      return devicePacket;
    }
    async acceptDeviceChange() {
      if (this.locked || !deviceApplied) throw { code: "device_change_pending" };
      deviceAccepts++;
      devicePacket = null;
      return management();
    }
    async discardDeviceChange(_vault, operationId) {
      if (this.locked || !deviceConflict || operationId !== devicePacket?.operationId)
        throw { code: "device_change_pending" };
      deviceDiscards++;
      devicePacket = null;
    }
    async verifyRecovery() {
      if (this.locked) throw { code: "locked" };
      if (resultHold) await resultHold.promise;
      recoveryVerifications++;
      return {
        vaultId: "vault_a",
        rootKeyId: "synthetic",
        registrySequence: remoteVault.version,
        recoveryKeyId: "recovery_synthetic",
        checkpointDigest: `checkpoint_${remoteVault.version}`,
        verifiedAt: 1000,
      };
    }
    async signSource(sourceId) {
      creates++;
      return {
        operationId: "source_operation",
        command: { opaque: true },
        authorKeyId: "author_a",
        sourceId,
      };
    }
    async sealSnapshot({ source: selected, expectedRevision }) {
      seals++;
      const pending = {
        snapshotId: seals === 1 ? "snapshot_encrypted" : `snapshot_encrypted_${seals}`,
        operationId: seals === 1 ? "snapshot_operation" : `snapshot_operation_${seals}`,
        authorKeyId: "author_a",
        expectedRevision,
        source: selected,
        carrier: {
          signedObject: {
            protected: "public",
            payload: "opaque_ciphertext",
            signature: "signature",
          },
        },
      };
      outboxes.set(this.uid, pending);
      return pending;
    }
    async loadOutbox() {
      if (outboxHold) return outboxHold.promise;
      return outboxes.get(this.uid) ?? null;
    }
    async clearOutbox() {
      outboxes.delete(this.uid);
    }
    async verifyReceipt(pending, receipt) {
      if (receiptFailure || receipt.stableOperationId !== pending.operationId)
        throw { code: "invalid_data" };
    }
    async openSnapshot() {
      opens++;
      return content;
    }
  }
  const requestPrivate = async (service, route, owner, options = {}) => {
    requests.push({ service, route, owner, options });
    if (route === "/api/v2/vaults/current") {
      if (getCurrentHold) return getCurrentHold.promise;
      if (loseNextCurrent) {
        loseNextCurrent = false;
        return new Response("{}", { status: 503 });
      }
      return new Response(
        JSON.stringify({ contractVersion: CONTRACT, vault: remoteVault, sources }),
      );
    }
    if (route === "/api/v2/vaults") {
      remoteVault = vault;
      return new Response(JSON.stringify({ contractVersion: CONTRACT, vault }));
    }
    if (route === "/api/v2/vaults/vault_a/registry") {
      if (devicePacket) {
        if (registryFailure !== "before") {
          deviceApplied = true;
          remoteVault = { ...remoteVault, version: remoteVault.version + 1 };
        }
        if (registryFailure) throw { code: "service_unavailable" };
      } else {
        deviceRegistered = true;
        remoteVault = { ...remoteVault, version: remoteVault.version + 1 };
        if (loseRegistrationRead) loseNextCurrent = true;
      }
      return new Response(JSON.stringify({ contractVersion: CONTRACT }));
    }
    if (route.endsWith("/authority-token"))
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          token: "synthetic_delegation",
          expiresAt: "2026-10-28T19:01:00Z",
        }),
      );
    if (route.endsWith("/authority-sync"))
      return new Response(JSON.stringify({ contractVersion: CONTRACT }));
    if (route.includes("/holdings-sources/")) {
      const resourceId = route.split("/").at(-1);
      sources = [{ ...source, resourceRef: { ...source.resourceRef, resourceId } }];
      return new Response(JSON.stringify({ contractVersion: CONTRACT, source: sources[0] }));
    }
    if (route.includes("/snapshots/") && options.method === "PUT") {
      commits.push({
        owner,
        body: JSON.stringify(options.json),
        key: options.headers["Idempotency-Key"],
      });
      if (failCommit)
        return new Response("{}", { status: typeof failCommit === "number" ? failCommit : 503 });
      successfulHead++;
      latestSnapshot = route.split("/").at(-1);
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          stableOperationId: options.headers["Idempotency-Key"],
        }),
      );
    }
    if (route.includes("/snapshots/")) {
      const selected = sources[0] ?? source;
      const receipt = {
        snapshotId: route.split("/").at(-1),
        revision: forcedHead ?? successfulHead,
        sourceEpoch: 1,
        resourceRef: selected.resourceRef,
        snapshotPath: route,
      };
      if (snapshotSwap === "older") {
        receipt.snapshotId = "older_signed_snapshot";
        receipt.revision = 0;
        receipt.snapshotPath = route.replace("snapshot_encrypted", "older_signed_snapshot");
      }
      if (snapshotSwap === "revision") receipt.revision = 2;
      if (snapshotSwap === "epoch") receipt.sourceEpoch = 2;
      const text = JSON.stringify({
        contractVersion: CONTRACT,
        carrier: { opaque: true },
        receipt,
      });
      if (bodyHold)
        return {
          ok: true,
          status: 200,
          text: async () => {
            bodyReads++;
            await bodyHold.promise;
            return text;
          },
        };
      return new Response(text);
    }
    if (route.includes("/operations/")) {
      if (receiptFound)
        return new Response(
          JSON.stringify({ contractVersion: CONTRACT, stableOperationId: route.split("/").at(-1) }),
        );
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          error: { code: "not_found", retryable: false, requestId: "synthetic_request" },
        }),
        { status: 404 },
      );
    }
    if (route.startsWith("/api/v2/holdings/sources/")) {
      if (readFailure) return new Response("{}", { status: readFailure });
      const selected = sources[0] ?? source;
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          resourceRef: selected.resourceRef,
          sourceEpoch: 1,
          snapshotSourceEpoch: 1,
          revision: forcedHead ?? successfulHead,
          snapshotId: forcedHead ? "snapshot_remote_newer" : latestSnapshot,
        }),
      );
    }
    throw new Error(`Unexpected path ${route}`);
  };
  const React = {
    useState(initial) {
      const slot = index++;
      cells[slot] ??= { state: typeof initial === "function" ? initial() : initial };
      return [
        cells[slot].state,
        (next) => {
          const value = typeof next === "function" ? next(cells[slot].state) : next;
          dirty ||= !Object.is(cells[slot].state, value);
          cells[slot].state = value;
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
  const { useHoldingsWorkspace } = compile("../components/useHoldingsWorkspace.ts", {
    react: React,
    "@/components/AuthProvider": {
      useAuth: () => ({
        ...auth,
        portfolioConfigured,
        agentHubConfigured,
        requestPrivate,
        signIn: async () => {},
      }),
    },
    "@/lib/holdings-csv": {
      HOLDINGS_CSV_MAX_BYTES: 4194304,
      HoldingsCsvError: class HoldingsCsvError extends Error {},
      parseHoldingsCsv: async () => preview,
      selectHoldingsAccounts: (input) => input,
    },
    "@/lib/encrypted-vault": { EncryptedVaultSession: Session },
    "@/lib/encrypted-passkey": {
      createVaultPasskey: async (_uid, options) => {
        passkeyCalls++;
        passkeyOptions.push(options);
        return passkey.promise;
      },
      unlockVaultPasskey: async (_archive, options) => {
        passkeyCalls++;
        passkeyOptions.push(options);
        return passkey.promise;
      },
    },
  });
  function render({ flush = true } = {}) {
    let model;
    do {
      dirty = false;
      index = 0;
      model = useHoldingsWorkspace();
      if (flush)
        for (const { slot, effect, dependencies } of effects.splice(0)) {
          cells[slot]?.cleanup?.();
          cells[slot] = { dependencies, cleanup: effect() };
        }
    } while (flush && dirty);
    return model;
  }
  return {
    render,
    requests,
    instances,
    commits,
    outboxes,
    auth(next) {
      auth = next;
    },
    configured(next) {
      portfolioConfigured = next;
    },
    hubConfigured(next) {
      agentHubConfigured = next;
    },
    holdBody(next) {
      bodyHold = next;
    },
    bodyReads: () => bodyReads,
    holdCurrent(value) {
      getCurrentHold = value;
    },
    holdOutbox(value) {
      outboxHold = value;
    },
    failCommit(value) {
      failCommit = value;
    },
    failReceipt(value) {
      receiptFailure = value;
    },
    failPrepare(value) {
      prepareFailure = value;
    },
    failRead(status) {
      readFailure = status;
    },
    resolvePasskey() {
      passkey.resolve({ credentialId: "credential", prfSalt: "salt", secret: new ArrayBuffer(32) });
    },
    rejectPasskey(code) {
      passkey.reject({ code });
    },
    counts: () => ({
      seals,
      passkeyCalls,
      creates,
      opens,
      resultOpens,
      readOnlyUnlocks,
      strictUnlocks,
      devicePrepares,
      deviceAccepts,
      deviceDiscards,
      recoveryVerifications,
      registrationPrepares,
    }),
    holdResult(next) {
      resultHold = next;
    },
    swapSnapshot(value) {
      snapshotSwap = value;
    },
    receiptFound(value) {
      receiptFound = value;
    },
    forceHead(value) {
      forcedHead = value;
    },
    passkeyOptions,
    managementFault(value) {
      managementFault = value;
    },
    loseRegistrationRead() {
      loseRegistrationRead = true;
    },
    registryFailure(value) {
      registryFailure = value;
    },
    deviceConflict() {
      deviceConflict = true;
      remoteVault = { ...remoteVault, version: remoteVault.version + 1 };
    },
    unmount: () => cells.forEach((cell) => cell.cleanup?.()),
  };
}
async function ready(h) {
  h.render();
  await settle();
  return h.render();
}
async function unlocked(h) {
  await ready(h);
  const action = h.render().unlock();
  h.resolvePasskey();
  await action;
  return h.render();
}
const file = { size: 10, text: async () => "private CSV that must never reach HTTP" };

test("new-device cancellation never uploads public keys or authorizes the browser implicitly", async () => {
  const h = harness({ needsDeviceRegistration: true });
  await ready(h);
  const job = h.render().unlock();
  h.resolvePasskey();
  await job;
  let model = h.render();
  assert.equal(model.phase, "needs-device");
  assert.equal(model.needsDeviceApproval, true);
  const staleConfirm = model.confirmDeviceRegistration;
  model.cancelOperation();
  await staleConfirm();
  model = h.render();
  assert.equal(model.phase, "locked");
  assert.equal(model.keyManagement, null);
  assert.equal(model.needsDeviceApproval, false);
  assert.ok(h.instances.every((instance) => instance.locked));
  assert.equal(h.requests.filter((row) => row.options.method === "PUT").length, 0);
  h.unmount();
});

test("explicit alternate Passkey choices pass the same cancellable operation signal without fallback", async () => {
  for (const create of [true, false]) {
    const h = harness({ hasVault: !create, hasSource: false });
    await ready(h);
    const model = h.render();
    const job = create ? model.create({ method: "other" }) : model.unlock({ method: "other" });
    await settle();
    assert.equal(h.passkeyOptions.length, 1);
    assert.equal(h.passkeyOptions[0].method, "other");
    assert.equal(h.passkeyOptions[0].signal.aborted, false);
    h.render().cancelOperation();
    assert.equal(h.passkeyOptions[0].signal.aborted, true);
    h.resolvePasskey();
    await job;
    assert.equal(h.counts().passkeyCalls, 1);
    assert.ok(
      !h.requests.some((row) => row.options.method === "PUT" || row.options.method === "POST"),
    );
    assert.ok(h.instances.every((instance) => instance.locked));
    h.unmount();
  }
});

test("device review generates no candidate until confirmation and confirmed changes invalidate consumer generations", async () => {
  const h = harness();
  let model = await unlocked(h);
  const generation = model.vaultGeneration;
  await model.reviewDeviceChange("rotate", "device_a");
  model = h.render();
  assert.equal(model.deviceReview.deviceId, "device_a");
  assert.equal(h.counts().devicePrepares, 0);
  assert.ok(!h.requests.some((row) => row.options.method === "PUT"));
  await model.discardDeviceChange();
  assert.equal(h.render().deviceReview, null);
  assert.equal(h.counts().devicePrepares, 0);
  await h.render().reviewDeviceChange("rotate", "device_a");
  await h.render().confirmDeviceChange();
  model = h.render();
  assert.equal(h.counts().devicePrepares, 1);
  assert.equal(h.counts().deviceAccepts, 1);
  assert.equal(model.deviceChange, null);
  assert.ok(model.vaultGeneration > generation);
  assert.equal(model.keyNotice, "device_change_saved");
  assert.equal(model.notice, "", "A key change must not masquerade as holdings saved");
  assert.equal(model.content, null);
  const [write] = h.requests.filter((row) => row.options.method === "PUT");
  assert.deepEqual(Object.keys(write.options.json).sort(), [
    "contractVersion",
    "expectedVersion",
    "registryBundle",
  ]);
  assert.equal(write.options.headers["Idempotency-Key"], "device_change_operation_1");
  h.unmount();
});

test("a changed directory or a captured confirmation cannot authorize a different device review", async () => {
  for (const transition of ["directory", "selection"]) {
    const h = harness();
    let model = await unlocked(h);
    await model.reviewDeviceChange("rotate", "device_a");
    model = h.render();
    const stale = model.confirmDeviceChange;
    if (transition === "directory") h.deviceConflict();
    else {
      await model.reviewDeviceChange("revoke", "device_b");
      h.render();
    }
    await stale();
    model = h.render();
    assert.equal(model.error, "version_conflict");
    assert.equal(h.counts().devicePrepares, 0);
    assert.ok(!h.requests.some((row) => row.options.method === "PUT"));
    h.unmount();
  }
});

test("a lost registry acknowledgement recovers the applied candidate without a second PUT or new signature", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.reviewDeviceChange("rotate", "device_a");
  h.registryFailure("lost-after-apply");
  await h.render().confirmDeviceChange();
  model = h.render();
  assert.equal(model.error, "service_unavailable");
  const original = JSON.stringify(model.deviceChange);
  assert.equal(h.counts().deviceAccepts, 0);
  await model.refreshKeyManagement();
  model = h.render();
  assert.equal(model.keyManagement.pendingChange.state, "applied");
  assert.equal(JSON.stringify(model.deviceChange), original);
  await model.confirmDeviceChange();
  model = h.render();
  assert.equal(model.deviceChange, null);
  assert.equal(h.counts().devicePrepares, 1);
  assert.equal(h.counts().deviceAccepts, 1);
  assert.equal(h.requests.filter((row) => row.options.method === "PUT").length, 1);
  h.unmount();
});

test("ready registry operations retain candidate keys and explicitly replay the exact original bytes", async () => {
  const h = harness();
  await unlocked(h);
  await h.render().reviewDeviceChange("rotate", "device_a");
  h.registryFailure("before");
  await h.render().confirmDeviceChange();
  let model = h.render();
  const original = JSON.stringify(model.deviceChange);
  await model.discardDeviceChange();
  model = h.render();
  assert.equal(model.error, "device_change_pending");
  assert.equal(JSON.stringify(model.deviceChange), original);
  assert.equal(h.counts().deviceDiscards, 0);
  h.registryFailure(null);
  await model.confirmDeviceChange();
  model = h.render();
  assert.equal(model.deviceChange, null);
  const writes = h.requests.filter((row) => row.options.method === "PUT");
  assert.equal(writes.length, 2);
  assert.equal(JSON.stringify(writes[0].options.json), JSON.stringify(writes[1].options.json));
  assert.equal(
    writes[0].options.headers["Idempotency-Key"],
    writes[1].options.headers["Idempotency-Key"],
  );
  assert.equal(h.counts().devicePrepares, 1);
  h.unmount();
});

test("discard is allowed only after a higher authoritative version fences an unapplied old operation", async () => {
  const h = harness();
  await unlocked(h);
  await h.render().reviewDeviceChange("revoke", "device_b");
  h.registryFailure("before");
  await h.render().confirmDeviceChange();
  h.render();
  h.deviceConflict();
  await h.render().refreshKeyManagement();
  let model = h.render();
  assert.equal(model.keyManagement.pendingChange.state, "conflict");
  await model.discardDeviceChange();
  model = h.render();
  assert.equal(model.deviceChange, null);
  assert.equal(h.counts().deviceDiscards, 1);
  assert.equal(h.requests.filter((row) => row.options.method === "PUT").length, 1);
  h.unmount();
});

test("recovery checks use a separate short-lived read-only Worker and never register or mutate a directory", async () => {
  const h = harness();
  let model = await unlocked(h);
  const original = h.instances[0];
  const before = h.requests.length;
  await model.verifyRecovery("other");
  model = h.render();
  assert.equal(model.recoveryCheck.rootKeyId, "synthetic");
  assert.equal(model.keyNotice, "recovery_verified");
  assert.equal(h.counts().recoveryVerifications, 1);
  assert.equal(h.instances.length, 2);
  assert.equal(original.locked, false);
  assert.equal(h.instances[1].locked, true);
  assert.equal(h.passkeyOptions.at(-1).method, "other");
  assert.ok(h.requests.slice(before).every((row) => !row.options.method));
  h.unmount();
});

test("late recovery proofs and captured management callbacks cannot survive lock or account changes", async () => {
  for (const transition of ["lock", "switch"]) {
    const h = harness();
    let model = await unlocked(h);
    const held = deferred();
    h.holdResult(held);
    const checking = model.verifyRecovery();
    await settle();
    const staleReview = model.reviewDeviceChange;
    if (transition === "lock") h.render().lock();
    else h.auth({ status: "authenticated", sessionKey: "owner_b:2", profile: { uid: "owner_b" } });
    model = h.render();
    held.resolve();
    await checking;
    await staleReview("rotate", "device_a");
    model = h.render();
    assert.equal(model.recoveryCheck, null);
    assert.equal(model.keyManagement, null);
    assert.equal(model.deviceChange, null);
    assert.equal(h.counts().devicePrepares, 0);
    assert.ok(h.instances.every((instance) => instance.locked));
    h.unmount();
  }
});

test("a current Passkey recovery proof advances displayed directory facts without implicitly enabling state changes", async () => {
  const h = harness({ resultCanWrite: false });
  await ready(h);
  const unlock = h.render().unlock({ forResults: true });
  h.resolvePasskey();
  await unlock;
  h.render();
  h.deviceConflict();
  await h.render().verifyRecovery();
  const model = h.render();
  assert.equal(model.keyManagement.registrySequence, 2);
  assert.equal(model.recoveryCheck.registrySequence, 2);
  assert.equal(model.canWriteState, false);
  assert.equal(h.requests.filter((row) => row.options.method === "PUT").length, 0);
  h.unmount();
});

test("a management trust or high-water failure locks all private consumers instead of leaving an unlocked badge", async () => {
  for (const error of ["rollback_detected", "registry_conflict", "key_revoked"]) {
    const h = harness();
    let model = await unlocked(h);
    const generation = model.vaultGeneration;
    h.managementFault(error);
    await model.refreshKeyManagement();
    model = h.render();
    assert.equal(model.phase, "locked");
    assert.equal(model.keyManagement, null);
    assert.equal(model.recoveryCheck, null);
    assert.equal(model.canWriteState, false);
    assert.ok(model.vaultGeneration > generation);
    assert.ok(h.instances.every((instance) => instance.locked));
    h.unmount();
  }
});

test("same-session device enrollment recovers a committed registration after the follow-up read is lost", async () => {
  const h = harness({ configured: false, needsDeviceRegistration: true });
  await ready(h);
  const unlock = h.render().unlock({ forResults: true, enableState: true });
  h.resolvePasskey();
  await unlock;
  h.render();
  h.loseRegistrationRead();
  await h.render().confirmDeviceRegistration();
  let model = h.render();
  assert.equal(model.phase, "needs-device");
  assert.equal(model.error, "service_unavailable");
  assert.equal(h.counts().registrationPrepares, 1);
  await model.confirmDeviceRegistration();
  model = h.render();
  assert.equal(model.phase, "unlocked");
  assert.equal(model.needsDeviceApproval, false);
  assert.equal(model.canWriteState, true);
  assert.equal(h.counts().registrationPrepares, 1, "Never mint or re-sign a second registration");
  assert.equal(h.requests.filter((row) => row.options.method === "PUT").length, 1);
  h.unmount();
});

test("configured owner unlocks, previews locally, saves only ciphertext and verifies receipt", async () => {
  const h = harness();
  let model = await unlocked(h);
  assert.equal(model.phase, "unlocked");
  await model.importFile(file);
  model = h.render();
  assert.equal(
    model.preview.resourceContent.data.accounts[0].positions[0].symbol,
    "PRIVATE_SENTINEL",
  );
  await model.save();
  model = h.render();
  assert.equal(model.notice, "saved");
  assert.equal(model.hasPending, false);
  assert.equal(h.counts().seals, 1);
  assert.equal(h.commits.length, 1);
  assert.ok(h.commits[0].body.includes("opaque_ciphertext"));
  assert.ok(
    !h.requests.some((request) =>
      JSON.stringify(request.options.json ?? {}).includes("PRIVATE_SENTINEL"),
    ),
  );
  assert.equal(model.content.data.accounts[0].positions[0].symbol, "PRIVATE_SENTINEL");
  h.unmount();
});

test("failed save retry reuses the exact carrier and operation instead of encrypting again", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  h.failCommit(true);
  await model.save();
  model = h.render();
  assert.equal(model.hasPending, true);
  assert.equal(model.error, "service_unavailable");
  h.failCommit(false);
  await model.save();
  model = h.render();
  assert.equal(h.counts().seals, 1);
  assert.equal(h.commits.length, 2);
  assert.equal(h.commits[0].body, h.commits[1].body);
  assert.equal(h.commits[0].key, h.commits[1].key);
  assert.equal(model.hasPending, false);
  h.unmount();
});

test("unverified receipt leaves encrypted outbox pending and never reports saved", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  h.failReceipt(true);
  await model.save();
  model = h.render();
  assert.equal(model.hasPending, true);
  assert.equal(model.notice, "");
  assert.equal(model.error, "invalid_data");
  assert.ok(h.outboxes.has("owner_a"));
  h.unmount();
});

test("account switch masks private state in the same render before cleanup effects", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  assert.ok(model.preview);
  h.auth({ status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } });
  model = h.render({ flush: false });
  assert.equal(model.preview, null);
  assert.equal(model.content, null);
  h.render();
  await settle();
  h.render();
  assert.ok(h.instances[0].locked);
  h.unmount();
});

test("late native passkey response after logout cannot create a vault or keep a worker", async () => {
  const h = harness({ hasVault: false, hasSource: false });
  await ready(h);
  const action = h.render().create();
  await settle();
  assert.equal(h.counts().passkeyCalls, 1);
  h.auth({ status: "anonymous", sessionKey: null, profile: null });
  h.render();
  h.resolvePasskey();
  await action;
  const model = h.render();
  assert.equal(model.authenticated, false);
  assert.equal(model.preview, null);
  assert.ok(h.instances[0].locked);
  assert.equal(h.requests.filter((request) => request.route === "/api/v2/vaults").length, 0);
  h.unmount();
});

test("late outbox restore after an account transition cannot seed another owner's save", async () => {
  const h = harness();
  await ready(h);
  const held = deferred();
  h.holdOutbox(held);
  const action = h.render().unlock();
  h.resolvePasskey();
  await settle();
  h.auth({ status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } });
  h.render();
  await settle();
  h.render();
  held.resolve({ operationId: "owner_a_private_operation", carrier: { opaque: true } });
  await action;
  h.holdOutbox(null);
  let model = h.render();
  await model.unlock();
  model = h.render();
  await model.importFile(file);
  model = h.render();
  await model.save();
  assert.equal(h.counts().seals, 1);
  assert.equal(h.commits[0].key, "snapshot_operation");
  assert.ok(!h.commits[0].body.includes("owner_a_private_operation"));
  h.unmount();
});

test("lock drops plaintext, cancels work, terminates the worker and requires unlocking", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  model.lock();
  model = h.render();
  assert.equal(model.phase, "locked");
  assert.equal(model.preview, null);
  assert.equal(model.content, null);
  assert.ok(h.instances[0].locked);
  await model.save();
  assert.equal(h.render().error, "unlock_required");
  h.unmount();
});

test("missing origins and unsupported passkeys never fall back to plaintext uploads", async () => {
  const closed = harness({ configured: false, hubConfigured: false });
  const model = await ready(closed);
  await model.create();
  await model.unlock();
  assert.equal(closed.requests.length, 0);
  assert.equal(closed.counts().passkeyCalls, 0);
  closed.unmount();
  const unsupported = harness();
  await ready(unsupported);
  const action = unsupported.render().unlock();
  unsupported.rejectPasskey("passkey_unsupported");
  await action;
  assert.equal(unsupported.render().error, "passkey_unsupported");
  assert.ok(unsupported.instances[0].locked);
  assert.equal(unsupported.commits.length, 0);
  unsupported.unmount();
});

test("source creation is server backed and existing first source is reused on subsequent saves", async () => {
  const h = harness({ hasSource: false });
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  await model.save();
  model = h.render();
  assert.equal(h.counts().creates, 1);
  assert.equal(model.sources.length, 1);
  await model.importFile(file);
  model = h.render();
  await model.save();
  assert.equal(h.counts().creates, 1);
  h.unmount();
});

test("known local vault pin prevents a replacement passkey prompt when the server claims no vault", async () => {
  const h = harness({ hasVault: false, hasSource: false });
  await ready(h);
  h.failPrepare(true);
  await h.render().create();
  assert.equal(h.render().error, "untrusted_vault");
  assert.equal(h.counts().passkeyCalls, 0);
  assert.ok(h.instances[0].locked);
  h.unmount();
});

test("a self-consistent older snapshot reply cannot satisfy a different requested latest identity", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  h.swapSnapshot("older");
  await model.save();
  model = h.render();
  assert.equal(model.error, "invalid_response");
  assert.equal(model.content, null);
  assert.equal(h.counts().opens, 0);
  h.unmount();
});

test("requested latest revision and known snapshot epoch are checked before local decryption", async () => {
  for (const mismatch of ["revision", "epoch"]) {
    const h = harness();
    let model = await unlocked(h);
    await model.importFile(file);
    model = h.render();
    h.swapSnapshot(mismatch);
    await model.save();
    model = h.render();
    assert.equal(model.error, "invalid_response", mismatch);
    assert.equal(model.content, null);
    assert.equal(h.counts().opens, 0);
    h.unmount();
  }
});

test("stale cross-device CAS can discard only a confirmed local retry then import with a fresh operation", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  h.failCommit(409);
  await model.save();
  model = h.render();
  assert.equal(model.error, "version_conflict");
  assert.equal(model.hasPending, true);
  h.forceHead(1);
  await model.recoverPending();
  model = h.render();
  assert.equal(model.discardOperationId, "snapshot_operation");
  assert.ok(h.outboxes.has("owner_a"));
  await model.discardPending();
  model = h.render();
  assert.equal(model.hasPending, false);
  assert.equal(model.preview, null);
  assert.equal(model.notice, "retry_discarded");
  assert.equal(h.outboxes.has("owner_a"), false);
  h.failCommit(false);
  await model.importFile(file);
  model = h.render();
  await model.save();
  assert.equal(h.counts().seals, 2);
  assert.notEqual(h.commits[0].key, h.commits[1].key);
  assert.ok(h.requests.every((request) => request.options.method !== "DELETE"));
  h.unmount();
});

test("a found valid receipt recovers the commit instead of offering a discard of server history", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  h.failCommit(true);
  await model.save();
  model = h.render();
  h.receiptFound(true);
  await model.recoverPending();
  model = h.render();
  assert.equal(model.hasPending, false);
  assert.equal(model.discardOperationId, null);
  assert.equal(model.notice, "receipt_recovered");
  assert.equal(h.counts().seals, 1);
  assert.equal(h.outboxes.has("owner_a"), false);
  assert.ok(h.requests.every((request) => request.options.method !== "DELETE"));
  h.unmount();
});

test("unverified recovery receipts never clear the exact encrypted retry packet", async () => {
  const h = harness();
  let model = await unlocked(h);
  await model.importFile(file);
  model = h.render();
  h.failCommit(true);
  await model.save();
  model = h.render();
  h.receiptFound(true);
  h.failReceipt(true);
  await model.recoverPending();
  model = h.render();
  assert.equal(model.error, "invalid_data");
  assert.equal(model.hasPending, true);
  assert.ok(h.outboxes.has("owner_a"));
  h.unmount();
});

test("Portfolio availability gates holdings while the shared Hub vault remains available", async () => {
  const h = harness({ configured: false });
  let model = await ready(h);
  assert.equal(model.configured, false);
  assert.ok(h.requests.every((request) => request.service === "agent-hub"));
  h.configured(true);
  model = await unlocked(h);
  await model.importFile(file);
  await h.render().save();
  model = h.render();
  assert.equal(model.content.data.accounts[0].positions[0].symbol, "PRIVATE_SENTINEL");
  h.configured(false);
  model = h.render({ flush: false });
  assert.equal(model.configured, false);
  assert.equal(model.content, null);
  assert.equal(model.preview, null);
  h.render();
  assert.ok(h.instances.every((instance) => instance.locked));
  const count = h.requests.length;
  await h.render().save();
  assert.equal(h.requests.length, count);
  h.unmount();
});

test("late encrypted response body after account switch or logout cannot decrypt or restore holdings", async () => {
  for (const transition of ["switch", "logout"]) {
    const h = harness();
    let model = await unlocked(h);
    await model.importFile(file);
    await h.render().save();
    const opened = h.counts().opens;
    const body = deferred();
    h.holdBody(body);
    const reading = h.render().readStored();
    await settle();
    assert.equal(h.bodyReads(), 1);
    h.auth(
      transition === "switch"
        ? { status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } }
        : { status: "anonymous", sessionKey: null, profile: null },
    );
    model = h.render({ flush: false });
    assert.equal(model.content, null);
    h.render();
    body.resolve();
    await reading;
    model = h.render();
    assert.equal(model.content, null);
    assert.equal(model.preview, null);
    assert.equal(h.counts().opens, opened);
    assert.ok(h.instances.every((instance) => instance.locked));
    h.unmount();
  }
});

test("Hub availability independently blocks loading and locks an already open holdings workspace", async () => {
  const h = harness({ hubConfigured: false });
  let model = await ready(h);
  assert.equal(model.configured, false);
  assert.equal(h.requests.length, 0);
  h.hubConfigured(true);
  model = await unlocked(h);
  await model.importFile(file);
  assert.ok(h.render().preview);
  h.hubConfigured(false);
  model = h.render({ flush: false });
  assert.equal(model.configured, false);
  assert.equal(model.preview, null);
  assert.equal(model.content, null);
  h.render();
  assert.ok(h.instances.every((instance) => instance.locked));
  const calls = h.requests.length;
  await h.render().reload();
  assert.equal(h.requests.length, calls);
  h.unmount();
});

test("late Hub vault response body cannot restore a switched or logged-out owner's workspace", async () => {
  for (const transition of ["switch", "logout"]) {
    const h = harness();
    let model = await unlocked(h);
    await model.importFile(file);
    const body = deferred();
    let reads = 0;
    h.holdCurrent({
      promise: Promise.resolve({
        ok: true,
        status: 200,
        text: async () => {
          reads++;
          await body.promise;
          return JSON.stringify({ contractVersion: CONTRACT, vault, sources: [source] });
        },
      }),
    });
    const loading = h.render().reload();
    await settle();
    assert.equal(reads, 1);
    h.auth(
      transition === "switch"
        ? { status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } }
        : { status: "anonymous", sessionKey: null, profile: null },
    );
    model = h.render({ flush: false });
    assert.equal(model.preview, null);
    assert.equal(model.content, null);
    assert.equal(model.vault, null);
    body.resolve();
    await loading;
    model = h.render();
    assert.equal(model.preview, null);
    assert.equal(model.content, null);
    assert.ok(h.instances.every((instance) => instance.locked));
    h.unmount();
  }
});

test("Hub-only Inbox unlock reuses one Passkey worker without Portfolio or implicit device registration", async () => {
  const h = harness({ configured: false, resultCanWrite: false });
  let model = await ready(h);
  assert.equal(model.configured, false);
  assert.equal(model.vaultConfigured, true);
  const unlocking = model.unlock({ forResults: true });
  h.resolvePasskey();
  await unlocking;
  model = h.render();
  assert.equal(model.phase, "unlocked");
  assert.equal(model.canWriteState, false);
  assert.equal(h.instances.length, 1);
  assert.equal(h.counts().readOnlyUnlocks, 1);
  assert.equal(h.counts().strictUnlocks, 0);
  assert.ok(h.requests.every((request) => request.service === "agent-hub"));
  assert.ok(!h.requests.some((request) => request.route.endsWith("/registry")));
  const value = await model.openResult({});
  assert.equal(value.title, "PRIVATE_RESULT");
  assert.equal(h.counts().resultOpens, 1);
  await model.refreshVault(new AbortController().signal);
  assert.equal(h.instances.length, 1);
  h.unmount();
});

test("new Inbox device enablement pauses for explicit review before strict registration without Portfolio", async () => {
  const h = harness({ configured: false, needsDeviceRegistration: true });
  let model = await ready(h);
  const unlocking = model.unlock({ forResults: true, enableState: true });
  h.resolvePasskey();
  await unlocking;
  model = h.render();
  assert.equal(model.phase, "needs-device");
  assert.equal(model.needsDeviceApproval, true);
  assert.equal(model.canWriteState, false);
  assert.equal(h.requests.filter((request) => request.route.endsWith("/registry")).length, 0);
  await model.confirmDeviceRegistration();
  model = h.render();
  assert.equal(model.phase, "unlocked");
  assert.equal(model.needsDeviceApproval, false);
  assert.equal(model.canWriteState, true);
  assert.equal(h.counts().strictUnlocks, 0);
  assert.equal(h.counts().readOnlyUnlocks, 1);
  assert.equal(h.requests.filter((request) => request.route.endsWith("/registry")).length, 1);
  assert.ok(h.requests.every((request) => request.service === "agent-hub"));
  h.unmount();
});

test("late shared result decryption and captured private methods cannot cross lock or owner changes", async () => {
  for (const transition of ["lock", "switch"]) {
    const h = harness();
    let model = await ready(h);
    const unlocking = model.unlock({ forResults: true });
    h.resolvePasskey();
    await unlocking;
    model = h.render();
    const old = model,
      gate = deferred();
    h.holdResult(gate);
    const opening = model.openResult({});
    await settle();
    if (transition === "lock") model.lock();
    else h.auth({ status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } });
    model = h.render();
    gate.resolve();
    await assert.rejects(opening);
    const opens = h.counts().resultOpens;
    await assert.rejects(old.openResult({}));
    assert.equal(h.counts().resultOpens, opens);
    assert.equal(model.content, null);
    h.unmount();
  }
});

test("task Worker wrappers fence late replies and reject captured prior unlock generations", async () => {
  const h = harness({ configured: false });
  let model = await ready(h);
  const unlocking = model.unlock({ forResults: true, enableState: true });
  h.resolvePasskey();
  await unlocking;
  model = h.render();
  const old = model,
    gate = deferred();
  h.holdResult(gate);
  const opening = model.openTask({});
  await settle();
  model.lock();
  h.render();
  gate.resolve();
  await assert.rejects(opening);
  const again = h.render().unlock({ forResults: true, enableState: true });
  await again;
  model = h.render();
  assert.equal(model.phase, "unlocked");
  const count = h.counts().resultOpens;
  await assert.rejects(old.openTask({}));
  assert.equal(h.counts().resultOpens, count);
  assert.equal(Object.hasOwn(model, "worker"), false);
  assert.ok(h.requests.every((request) => request.service === "agent-hub"));
  h.unmount();
});

test("owner agent crypto wrappers reject late replies and captured methods across lock and account switches", async () => {
  for (const method of [
    "publicAgentAnchor",
    "prepareAgentRegistration",
    "signAgentGrants",
    "sealAgentPreparation",
  ]) {
    for (const change of ["lock", "owner"]) {
      const h = harness({ configured: false });
      let model = await ready(h);
      const unlocking = model.unlock({ forResults: true, enableState: true });
      h.resolvePasskey();
      await unlocking;
      model = h.render();
      const old = model,
        gate = deferred();
      h.holdResult(gate);
      const pending = model[method]({});
      await settle();
      if (change === "lock") model.lock();
      else
        h.auth({ status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } });
      h.render();
      gate.resolve();
      await assert.rejects(pending);
      const count = h.counts().resultOpens;
      await assert.rejects(old[method]({}));
      assert.equal(h.counts().resultOpens, count);
      assert.ok(h.requests.every((request) => request.service === "agent-hub"));
      h.unmount();
    }
  }
});
