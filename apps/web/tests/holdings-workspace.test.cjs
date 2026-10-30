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
      return { needsDeviceRegistration };
    }
    async unlockForResults() {
      readOnlyUnlocks++;
      return { canWriteState: resultCanWrite };
    }
    async acceptResultVault() {
      if (this.locked) throw { code: "locked" };
      return { canWriteState: resultCanWrite };
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
      return { operationId: "device_operation", expectedVersion: 1, registryBundle: {} };
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
      return new Response(
        JSON.stringify({ contractVersion: CONTRACT, vault: remoteVault, sources }),
      );
    }
    if (route === "/api/v2/vaults") {
      remoteVault = vault;
      return new Response(JSON.stringify({ contractVersion: CONTRACT, vault }));
    }
    if (route === "/api/v2/vaults/vault_a/registry")
      return new Response(JSON.stringify({ contractVersion: CONTRACT }));
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
      createVaultPasskey: async () => {
        passkeyCalls++;
        return passkey.promise;
      },
      unlockVaultPasskey: async () => {
        passkeyCalls++;
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

test("explicit Inbox device enablement uses existing strict registration without a Portfolio dependency", async () => {
  const h = harness({ configured: false, needsDeviceRegistration: true });
  let model = await ready(h);
  const unlocking = model.unlock({ forResults: true, enableState: true });
  h.resolvePasskey();
  await unlocking;
  model = h.render();
  assert.equal(model.phase, "unlocked");
  assert.equal(model.canWriteState, true);
  assert.equal(h.counts().strictUnlocks, 1);
  assert.equal(h.counts().readOnlyUnlocks, 0);
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
