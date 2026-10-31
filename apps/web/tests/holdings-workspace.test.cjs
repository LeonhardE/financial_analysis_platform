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
  let snapshotOpenHold = null;
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
  let archivePacket = null;
  let archiveApplied = false;
  let archiveFailure = null;
  let archivePrepares = 0;
  let archiveFinishes = 0;
  let recoveryImports = 0;
  let recoveryExports = 0;
  let replacementCalls = 0;
  let recoveryImportHold = null;
  let recoveryExportHold = null;
  let replacementHold = null;
  let archiveLifecycle = 0;
  let archiveOriginalFence = 0;
  let archiveAuthorized = false;
  let cancellationCommands = null;
  let cancellationFailure = null;
  let archiveDiscards = 0;
  const passkeyOptions = [];
  const passkeyArchives = [];
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
    async verifyLifecycle() {
      if (this.locked) throw { code: "locked" };
    }
    async createRecoveryKit() {
      if (this.locked) throw { code: "locked" };
      recoveryExports++;
      if (recoveryExportHold) await recoveryExportHold.promise;
      return {
        file: '{"ciphertext":"SYNTHETIC_ENCRYPTED_KIT"}',
        code: "R".repeat(43),
        createdAt: 1793386800,
      };
    }
    async importRecoveryKit(_vault, _lifecycle, file, code) {
      recoveryImports++;
      if (recoveryImportHold) await recoveryImportHold.promise;
      if (this.locked) throw { code: "locked" };
      if (file !== '{"ciphertext":"SYNTHETIC_ENCRYPTED_KIT"}' || code !== "R".repeat(43))
        throw { code: "unlock_failed" };
    }
    async prepareArchiveChange(_vault, _lifecycle, material, mode) {
      if (this.locked) throw { code: "locked" };
      archivePrepares++;
      archiveOriginalFence = mode === "recovery" ? archiveLifecycle + 1 : archiveLifecycle;
      archivePacket ??= {
        operationId: "archive_original_operation",
        mode,
        archive: {
          ...remoteVault.archive,
          credentialId: material.credentialId,
          prfSalt: material.prfSalt,
          ciphertext: "SYNTHETIC_NEW_CIPHER",
        },
        command: {
          protected: "public_signed_root",
          payload: "opaque_bound_digest",
          signature: "public_signature",
        },
        ...(mode === "recovery"
          ? {
              authorization: {
                operationId: "authorization_original_operation",
                command: {
                  protected: "public_root",
                  payload: "opaque_bound_approval",
                  signature: "public_signature",
                },
              },
            }
          : {}),
      };
      return archivePacket;
    }
    async getArchiveChange() {
      if (this.locked) throw { code: "locked" };
      return archivePacket
        ? {
            packet: archivePacket,
            state: archiveApplied
              ? "applied"
              : archiveLifecycle > archiveOriginalFence
                ? "conflict"
                : "ready",
          }
        : null;
    }
    async inspectArchiveChange() {
      return archivePacket
        ? {
            operationId: archivePacket.operationId,
            mode: archivePacket.mode,
            archive: archivePacket.archive,
          }
        : null;
    }
    async finishArchiveChange(_vault, _lifecycle, operationId) {
      if (this.locked || !archiveApplied || operationId !== archivePacket?.operationId)
        throw { code: "archive_change_pending" };
      archiveFinishes++;
      if (archivePacket.mode === "recovery") deviceRegistered = false;
      archivePacket = null;
    }
    async prepareArchiveCancellation() {
      if (this.locked || !archivePacket) throw { code: "locked" };
      if (archiveApplied) throw { code: "archive_change_unknown" };
      if (archiveLifecycle > archiveOriginalFence && !archiveAuthorized) return { commands: [] };
      cancellationCommands ??= [
        {
          operationId: "cancel_authorize_original",
          action: "recovery_authorize",
          authorizationId: "cancel_authorization_original",
          command: {
            protected: "public_root",
            payload: "bound_cancel_approval",
            signature: "signature",
          },
        },
        {
          operationId: "cancel_revoke_original",
          action: "recovery_revoke",
          authorizationId: "cancel_authorization_original",
          command: {
            protected: "public_root",
            payload: "bound_cancel_revoke",
            signature: "signature",
          },
        },
      ];
      return { commands: archiveAuthorized ? cancellationCommands.slice(1) : cancellationCommands };
    }
    async discardArchiveChange(_vault, _lifecycle, operationId) {
      if (
        this.locked ||
        archiveApplied ||
        archiveLifecycle <= archiveOriginalFence ||
        archiveAuthorized ||
        operationId !== archivePacket?.operationId
      )
        throw { code: "archive_change_unknown" };
      archiveDiscards++;
      archivePacket = null;
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
      if (snapshotOpenHold) await snapshotOpenHold.promise;
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
    if (route === "/api/v2/vaults/vault_a/archive") {
      if (options.method === "PUT") {
        if (archiveFailure !== "before") {
          archiveApplied = true;
          archiveLifecycle++;
          remoteVault = { ...remoteVault, archive: options.json.archive };
        }
        if (archiveFailure) throw { code: "service_unavailable" };
        return new Response(
          JSON.stringify({
            contractVersion: CONTRACT,
            profile: "folioview.vault-lifecycle.v1",
            receipt: { operationId: options.headers["Idempotency-Key"] },
          }),
        );
      }
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          profile: "folioview.vault-lifecycle.v1",
          vaultId: remoteVault.vaultId,
          rootKeyId: remoteVault.rootKeyId,
          archive: remoteVault.archive,
          lifecycleVersion: archiveLifecycle,
        }),
      );
    }
    if (route === "/api/v2/vaults/vault_a/recovery-authorizations") {
      if (!archiveAuthorized) archiveLifecycle++;
      archiveAuthorized = true;
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          profile: "folioview.vault-lifecycle.v1",
          receipt: { operationId: options.headers["Idempotency-Key"] },
        }),
      );
    }
    if (route.includes("/recovery-authorizations/") && route.endsWith("/revoke")) {
      if (cancellationFailure === "before") throw { code: "service_unavailable" };
      if (archiveAuthorized) archiveLifecycle++;
      archiveAuthorized = false;
      if (cancellationFailure === "after") throw { code: "service_unavailable" };
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          profile: "folioview.vault-lifecycle.v1",
          receipt: { operationId: options.headers["Idempotency-Key"] },
        }),
      );
    }
    if (route.startsWith("/api/v2/vaults/vault_a/archive-operations/")) {
      if (archiveApplied)
        return new Response(
          JSON.stringify({
            contractVersion: CONTRACT,
            profile: "folioview.vault-lifecycle.v1",
            receipt: { operationId: route.split("/").at(-1) },
          }),
        );
      return new Response(
        JSON.stringify({
          contractVersion: CONTRACT,
          error: { code: "not_found", retryable: false, requestId: "synthetic_request" },
        }),
        { status: 404 },
      );
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
      unlockVaultPasskey: async (archive, options) => {
        passkeyCalls++;
        passkeyOptions.push(options);
        passkeyArchives.push(archive);
        return passkey.promise;
      },
      replaceVaultPasskey: async (_uid, _archive, options) => {
        replacementCalls++;
        passkeyOptions.push(options);
        if (replacementHold) return replacementHold.promise;
        return { credentialId: "new_credential", prfSalt: "new_salt", secret: new ArrayBuffer(32) };
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
    holdSnapshotOpen(next) {
      snapshotOpenHold = next;
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
      archivePrepares,
      archiveFinishes,
      recoveryImports,
      recoveryExports,
      replacementCalls,
      archiveDiscards,
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
    passkeyArchives,
    managementFault(value) {
      managementFault = value;
    },
    loseRegistrationRead() {
      loseRegistrationRead = true;
    },
    registryFailure(value) {
      registryFailure = value;
    },
    archiveFailure(value) {
      archiveFailure = value;
    },
    cancellationFailure(value) {
      cancellationFailure = value;
    },
    holdRecoveryImport(value) {
      recoveryImportHold = value;
    },
    holdRecoveryExport(value) {
      recoveryExportHold = value;
    },
    holdReplacement(value) {
      replacementHold = value;
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

test("Passkey replacement saves only a root-signed encrypted archive and recovers a lost committed reply without recreating credentials", async () => {
  const h = harness();
  const original = await unlocked(h),
    generation = original.vaultGeneration;
  h.archiveFailure("after");
  await original.changePasskey();
  let model = h.render();
  assert.equal(model.phase, "locked");
  assert.equal(model.content, null);
  assert.equal(model.archiveChange.operationId, "archive_original_operation");
  assert.ok(model.vaultGeneration > generation);
  assert.equal(h.counts().replacementCalls, 1);
  assert.equal(h.counts().archivePrepares, 1);
  const writes = () =>
    h.requests.filter((row) => row.route.endsWith("/archive") && row.options.method === "PUT");
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].options.headers["Idempotency-Key"], "archive_original_operation");
  assert.equal(writes()[0].options.headers["X-FolioView-Author-Key"], undefined);
  assert.ok(!JSON.stringify(writes()[0]).includes("PRIVATE_SENTINEL"));
  h.archiveFailure(null);
  await model.refreshArchiveChange();
  model = h.render();
  assert.equal(model.archiveChange, null);
  assert.equal(model.keyNotice, "archive_change_saved");
  assert.equal(model.phase, "locked");
  assert.equal(h.counts().archiveFinishes, 1);
  assert.equal(
    writes().length,
    1,
    "A confirmed original operation only recovers its receipt/state",
  );
  assert.equal(h.counts().replacementCalls, 1);
  assert.equal(h.counts().archivePrepares, 1);
  assert.ok(h.instances.every((instance) => instance.locked));
  h.unmount();
});

test("an archive update with an unknown uncommitted outcome replays identical ciphertext, command and operation", async () => {
  const h = harness();
  await unlocked(h);
  h.archiveFailure("before");
  await h.render().changePasskey("other");
  assert.equal(h.render().archiveChange.state, "ready");
  h.archiveFailure(null);
  await h.render().confirmArchiveChange();
  const writes = h.requests.filter(
    (row) => row.route.endsWith("/archive") && row.options.method === "PUT",
  );
  assert.equal(writes.length, 2);
  assert.equal(JSON.stringify(writes[0].options.json), JSON.stringify(writes[1].options.json));
  assert.equal(
    writes[0].options.headers["Idempotency-Key"],
    writes[1].options.headers["Idempotency-Key"],
  );
  assert.equal(h.counts().replacementCalls, 1);
  assert.equal(h.counts().archivePrepares, 1);
  assert.equal(h.render().archiveChange, null);
  assert.equal(h.passkeyOptions.at(-1).method, "other");
  h.unmount();
});

test("independent kit recovery works while locked without the old Passkey and requires separate browser registration afterward", async () => {
  const h = harness();
  await ready(h);
  await h.render().recoverWithKit('{"ciphertext":"SYNTHETIC_ENCRYPTED_KIT"}', "R".repeat(43));
  let model = h.render();
  assert.equal(h.counts().recoveryImports, 1);
  assert.equal(h.counts().passkeyCalls, 0, "Recovery must not request the missing old credential");
  assert.equal(h.counts().replacementCalls, 1);
  assert.equal(model.phase, "locked");
  assert.equal(model.keyNotice, "archive_change_saved");
  const writes = h.requests.filter((row) => ["PUT", "POST"].includes(row.options.method));
  assert.deepEqual(
    writes.map((row) => row.route),
    ["/api/v2/vaults/vault_a/recovery-authorizations", "/api/v2/vaults/vault_a/archive"],
  );
  for (const row of writes) {
    assert.ok(row.options.headers["Idempotency-Key"]);
    assert.equal(row.options.headers["X-FolioView-Author-Key"], undefined);
    assert.ok(!JSON.stringify(row.options.json).includes("R".repeat(43)));
    assert.ok(!JSON.stringify(row.options.json).includes("SYNTHETIC_ENCRYPTED_KIT"));
  }
  const job = model.unlock({ forResults: true, enableState: true });
  h.resolvePasskey();
  await job;
  model = h.render();
  assert.equal(model.phase, "needs-device");
  assert.equal(model.needsDeviceApproval, true);
  assert.equal(h.counts().registrationPrepares, 0);
  assert.ok(!h.requests.some((row) => row.route.endsWith("/registry")));
  h.unmount();
});

test("a wrong independent recovery code never creates a Passkey or submits recovery authority", async () => {
  const h = harness();
  await ready(h);
  await h.render().recoverWithKit('{"ciphertext":"SYNTHETIC_ENCRYPTED_KIT"}', "wrong-code");
  assert.equal(h.render().error, "unlock_failed");
  assert.equal(h.counts().replacementCalls, 0);
  assert.ok(!h.requests.some((row) => ["PUT", "POST"].includes(row.options.method)));
  assert.ok(h.instances.every((instance) => instance.locked));
  h.unmount();
});

test("a recovered browser reads its saved holdings immediately after explicit device approval", async () => {
  const h = harness();
  await ready(h);
  h.forceHead(1);
  await h.render().recoverWithKit('{"ciphertext":"SYNTHETIC_ENCRYPTED_KIT"}', "R".repeat(43));
  const unlocking = h.render().unlock();
  h.resolvePasskey();
  await unlocking;
  assert.equal(h.render().phase, "needs-device");
  assert.equal(h.render().content, null);
  assert.equal(h.counts().opens, 0);
  assert.ok(!h.requests.some((row) => row.service === "portfolio"));
  await h.render().confirmDeviceRegistration();
  const model = h.render();
  assert.equal(model.phase, "unlocked");
  assert.equal(model.keyNotice, "device_registered");
  assert.equal(model.content.data.accounts[0].positions[0].symbol, "PRIVATE_SENTINEL");
  assert.equal(h.counts().opens, 1);
  assert.equal(h.counts().registrationPrepares, 1);
  assert.equal(h.commits.length, 0, "Recovery reads the original snapshot without reimporting it");
  h.unmount();
});

test("device approval auto-read cannot reveal a late snapshot body or decryption after lock, logout or account switch", async () => {
  for (const stage of ["body", "decryption"])
    for (const transition of ["lock", "logout", "switch"]) {
      const h = harness({ needsDeviceRegistration: true });
      await ready(h);
      h.forceHead(1);
      const unlocking = h.render().unlock();
      h.resolvePasskey();
      await unlocking;
      h.render();
      const gate = deferred();
      if (stage === "body") h.holdBody(gate);
      else h.holdSnapshotOpen(gate);
      const approving = h.render().confirmDeviceRegistration();
      await settle();
      assert.equal(stage === "body" ? h.bodyReads() : h.counts().opens, 1);
      assert.equal(h.render().content, null);
      if (transition === "lock") h.render().lock();
      else
        h.auth(
          transition === "switch"
            ? { status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } }
            : { status: "anonymous", sessionKey: null, profile: null },
        );
      assert.equal(h.render({ flush: false }).content, null);
      h.render();
      gate.resolve();
      await approving;
      const model = h.render();
      assert.equal(model.content, null);
      assert.equal(model.preview, null);
      assert.equal(h.counts().opens, stage === "body" ? 0 : 1);
      assert.ok(h.instances.every((instance) => instance.locked));
      h.unmount();
    }
});

test("Inbox-only device approval never prefetches holdings even when Portfolio is available", async () => {
  const h = harness({ needsDeviceRegistration: true });
  await ready(h);
  h.forceHead(1);
  const unlocking = h.render().unlock({ forResults: true, enableState: true });
  h.resolvePasskey();
  await unlocking;
  h.render();
  await h.render().confirmDeviceRegistration();
  assert.equal(h.render().phase, "unlocked");
  assert.equal(h.counts().opens, 0);
  assert.equal(h.render().content, null);
  assert.ok(h.requests.every((row) => row.service === "agent-hub"));
  h.unmount();
});

test("a locked fresh Worker resumes a staged recovery with the new Passkey even while the server archive is still old", async () => {
  const h = harness();
  await ready(h);
  h.archiveFailure("before");
  await h.render().recoverWithKit('{"ciphertext":"SYNTHETIC_ENCRYPTED_KIT"}', "R".repeat(43));
  assert.equal(h.render().archiveChange.mode, "recovery");
  const originalWorker = h.instances.at(-1);
  h.render().lock();
  assert.equal(originalWorker.locked, true);
  assert.equal(
    h.render().archiveChange.operationId,
    "archive_original_operation",
    "A public pending-operation summary may survive locking",
  );
  h.archiveFailure(null);
  const job = h.render().resumeArchiveWithNewPasskey();
  await settle();
  assert.equal(h.passkeyArchives.at(-1).credentialId, "new_credential");
  assert.equal(h.passkeyArchives.at(-1).prfSalt, "new_salt");
  h.resolvePasskey();
  await job;
  assert.equal(h.render().keyNotice, "archive_change_saved");
  assert.equal(h.render().archiveChange, null);
  assert.equal(h.counts().recoveryImports, 1);
  assert.equal(h.counts().replacementCalls, 1);
  assert.equal(h.counts().archivePrepares, 1);
  assert.equal(h.counts().archiveFinishes, 1);
  const writes = h.requests.filter(
    (row) => row.route.endsWith("/archive") && row.options.method === "PUT",
  );
  assert.equal(writes.length, 2);
  assert.equal(JSON.stringify(writes[0].options.json), JSON.stringify(writes[1].options.json));
  assert.ok(h.instances.every((instance) => instance.locked));
  h.unmount();
});

test("safe cancellation establishes an authorization/revocation fence before discarding an unknown archive candidate", async () => {
  const h = harness();
  const original = await unlocked(h),
    originalArchive = JSON.stringify(original.vault.archive);
  h.archiveFailure("before");
  await original.changePasskey();
  assert.equal(h.counts().archiveDiscards, 0);
  await h.render().cancelArchiveChange();
  const model = h.render(),
    controls = h.requests.filter(
      (row) => row.options.method === "POST" && row.route.includes("recovery-authorizations"),
    );
  assert.deepEqual(
    controls.map((row) => row.route),
    [
      "/api/v2/vaults/vault_a/recovery-authorizations",
      "/api/v2/vaults/vault_a/recovery-authorizations/cancel_authorization_original/revoke",
    ],
  );
  assert.deepEqual(
    controls.map((row) => row.options.headers["Idempotency-Key"]),
    ["cancel_authorize_original", "cancel_revoke_original"],
  );
  assert.equal(h.counts().archiveDiscards, 1);
  assert.equal(h.counts().archiveFinishes, 0);
  assert.equal(h.counts().archivePrepares, 1);
  assert.equal(model.archiveChange, null);
  assert.equal(model.phase, "locked");
  assert.equal(model.keyNotice, "archive_change_cancelled");
  assert.equal(JSON.stringify(model.vault.archive), originalArchive);
  assert.equal(
    h.requests.filter((row) => row.options.method === "PUT" && row.route.endsWith("/archive"))
      .length,
    1,
    "Cancellation never writes another archive",
  );
  assert.ok(h.instances.every((instance) => instance.locked));
  h.unmount();
});

test("lost cancellation replies retain the original archive candidate until fresh state proves a completed fence", async () => {
  for (const failure of ["before", "after"]) {
    const h = harness();
    await unlocked(h);
    h.archiveFailure("before");
    await h.render().changePasskey();
    h.cancellationFailure(failure);
    await h.render().cancelArchiveChange();
    assert.equal(h.counts().archiveDiscards, 0);
    assert.equal(h.render().archiveChange.operationId, "archive_original_operation");
    h.cancellationFailure(null);
    await h.render().cancelArchiveChange();
    assert.equal(h.counts().archiveDiscards, 1);
    assert.equal(h.render().keyNotice, "archive_change_cancelled");
    const revoke = h.requests.filter((row) => row.route.endsWith("/revoke"));
    assert.equal(revoke.length, failure === "before" ? 2 : 1);
    if (revoke.length === 2) {
      assert.equal(JSON.stringify(revoke[0].options.json), JSON.stringify(revoke[1].options.json));
      assert.equal(
        revoke[0].options.headers["Idempotency-Key"],
        revoke[1].options.headers["Idempotency-Key"],
      );
    }
    assert.equal(
      h.requests.filter((row) => row.route.endsWith("/recovery-authorizations")).length,
      1,
    );
    assert.equal(h.counts().replacementCalls, 1);
    h.unmount();
  }
});

test("canceling a candidate already confirmed as applied adopts that update instead of discarding its active keys", async () => {
  const h = harness();
  await unlocked(h);
  h.archiveFailure("after");
  await h.render().changePasskey();
  await h.render().cancelArchiveChange();
  assert.equal(h.counts().archiveDiscards, 0);
  assert.equal(h.counts().archiveFinishes, 1);
  assert.equal(h.render().keyNotice, "archive_change_saved");
  assert.ok(!h.requests.some((row) => row.route.includes("recovery-authorizations")));
  h.unmount();
});

test("exported recovery codes disappear on lock, logout and same-render account change; late exports cannot restore them", async () => {
  for (const transition of ["lock", "logout", "switch", "late-lock"]) {
    const h = harness();
    await unlocked(h);
    let job;
    const gate = deferred();
    if (transition === "late-lock") h.holdRecoveryExport(gate);
    job = h.render().exportRecoveryKit();
    if (transition === "late-lock") await settle();
    else await job;
    if (transition !== "late-lock") assert.equal(h.render().recoveryExport.code, "R".repeat(43));
    if (["lock", "late-lock"].includes(transition)) h.render().lock();
    else
      h.auth(
        transition === "logout"
          ? { status: "anonymous", sessionKey: null, profile: null }
          : { status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } },
      );
    assert.equal(h.render({ flush: false }).recoveryExport, null);
    h.render();
    gate.resolve();
    await job;
    assert.equal(h.render().recoveryExport, null);
    assert.ok(h.instances.every((instance) => instance.locked));
    h.unmount();
  }
});

test("late kit imports and native replacement responses are fenced by lock, logout and owner changes", async () => {
  for (const stage of ["import", "passkey"]) {
    for (const transition of ["lock", "logout", "switch"]) {
      const h = harness(),
        gate = deferred();
      await ready(h);
      if (stage === "import") h.holdRecoveryImport(gate);
      else h.holdReplacement(gate);
      const job = h
        .render()
        .recoverWithKit('{"ciphertext":"SYNTHETIC_ENCRYPTED_KIT"}', "R".repeat(43));
      await settle();
      if (transition === "lock") h.render().lock();
      else
        h.auth(
          transition === "logout"
            ? { status: "anonymous", sessionKey: null, profile: null }
            : { status: "authenticated", sessionKey: "owner_b:1", profile: { uid: "owner_b" } },
        );
      h.render();
      const secret = new Uint8Array(32).fill(19);
      gate.resolve(
        stage === "passkey"
          ? { credentialId: "late_new", prfSalt: "late_salt", secret: secret.buffer }
          : undefined,
      );
      await job;
      assert.equal(h.counts().archivePrepares, 0);
      assert.equal(h.counts().replacementCalls, stage === "passkey" ? 1 : 0);
      assert.ok(!h.requests.some((row) => ["PUT", "POST"].includes(row.options.method)));
      assert.ok(h.instances.every((instance) => instance.locked));
      if (stage === "passkey") assert.ok(secret.every((byte) => byte === 0));
      h.unmount();
    }
  }
});

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
