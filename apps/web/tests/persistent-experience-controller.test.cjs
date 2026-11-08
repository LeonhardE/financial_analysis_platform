const assert = require("node:assert/strict");
const test = require("node:test");
const { compile, contracts: resources } = require("./resource-library-helpers.cjs");
const tasks = compile("../lib/task-types.ts");
const { PersistentExperienceController: Controller, PersistentExperienceError: ErrorType } =
  compile(
    "../lib/persistent-experience-controller.ts",
    { "./resource-library": resources, "./task-types": tasks },
    { Map, Set, Date },
  );
const connection = {
  connectionId: "connection_A",
  clientId: "muse_A",
  vaultId: "vault_A",
  provider: "muse",
  status: "active",
  accountState: "connected",
  linkedAt: 1000,
};
const packet = {
  kind: "publication",
  connectionId: "connection_A",
  operationId: "synthetic_original_operation_0001",
  body: {
    contractVersion: "folioview.agent-workspace.v2.0",
    envelope: { ciphertext: "ORIGINAL_CIPHERTEXT" },
  },
  fingerprint: "a".repeat(64),
};
const missing = () => {
  throw new ErrorType("not_found");
};
function harness(api) {
  let live = true;
  const w = {
    phase: "unlocked",
    vault: { vaultId: "vault_A", version: 1, registryHistory: [] },
    async refreshVault() {},
    async finishPersistentPending(actor, receipt) {
      assert.equal(actor.connectionId, connection.connectionId);
      assert.equal(receipt.fingerprint, packet.fingerprint);
      w.pending = null;
      w.finishes++;
    },
    pending: packet,
    finishes: 0,
    async loadPersistentPending() {
      return w.pending;
    },
  };
  const c = new Controller(
    api,
    () => w,
    () => {
      if (!live) throw Error("cancelled");
    },
    new AbortController().signal,
  );
  return {
    c,
    w,
    lock: () => {
      live = false;
    },
  };
}
test("a committed publication with a lost acknowledgement resumes by exact receipt without another POST or encryption", async () => {
  const calls = [];
  let receipt = null;
  const h = harness(async (_service, path, options = {}) => {
    calls.push({ path, options });
    if (options.method === "POST") {
      receipt = { fingerprint: packet.fingerprint };
      throw Error("network");
    }
    if (receipt) return receipt;
    return missing();
  });
  await assert.rejects(h.c.send(connection, packet), /network/);
  assert.equal(h.w.pending, packet);
  assert.equal(h.w.finishes, 0);
  await h.c.resume(connection);
  assert.equal(h.w.pending, null);
  assert.equal(h.w.finishes, 1);
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 1);
  assert.equal(calls.find((c) => c.options.method === "POST").options.json, packet.body);
});
test("a delayed receipt after lock cannot clear the sealed original", async () => {
  let release;
  const waiting = new Promise((r) => (release = r)),
    h = harness(async () => waiting);
  const operation = h.c.send(connection, packet);
  h.lock();
  release({ fingerprint: packet.fingerprint });
  await assert.rejects(operation, /cancelled/);
  assert.equal(h.w.finishes, 0);
  assert.equal(h.w.pending, packet);
});
test("registry registration recovers an already applied directory without repeating or replacing it", async () => {
  const identity = {
    ...packet,
    kind: "identity",
    setupIntentId: "setup_synthetic_A",
    registryUpdate: { expectedVersion: 1, registryBundle: { checkpoint: "ORIGINAL_DIRECTORY" } },
    body: {
      contractVersion: "folioview.agent-workspace.v2.0",
      command: { payload: "ORIGINAL_BINDING" },
    },
  };
  const calls = [];
  const h = harness(async (_service, path, options = {}) => {
    calls.push({ path, options });
    if (path.includes("/operations/")) return missing();
    if (path === "/api/v2/vaults/current")
      return { vault: { version: 2, registryHistory: [identity.registryUpdate.registryBundle] } };
    if (path.endsWith("/bindings")) return { fingerprint: packet.fingerprint };
    if (path.endsWith("/completion")) return {};
    throw Error(path);
  });
  await h.c.send(connection, identity);
  assert.equal(calls.filter((c) => c.options.method === "PUT").length, 0);
  assert.equal(calls.filter((c) => c.path.endsWith("/bindings")).length, 1);
  assert.equal(h.w.finishes, 1);
});
test("automatic synchronization uses only active continuing permissions; OAuth connection alone grants none", async () => {
  const h = harness(async () => ({}));
  h.w.pending = null;
  const ref = (id) => ({
      kind: "watchlist",
      sourceService: "user",
      resourceId: id,
      incarnation: "incarnation_A",
    }),
    seen = [];
  const permissions = [
    {
      ref: ref("approved"),
      sourceEpoch: 1,
      status: "active",
      versionPolicy: "current_and_future",
      fromRevision: 1,
    },
    {
      ref: ref("revoked"),
      sourceEpoch: 1,
      status: "revoked",
      versionPolicy: "current_and_future",
      fromRevision: 1,
    },
    {
      ref: ref("history_only"),
      sourceEpoch: 1,
      status: "active",
      versionPolicy: "selected",
      fromRevision: 1,
    },
  ];
  h.c.context = async () => ({ policy: { permissions } });
  h.c.catalogue = async () => ({
    groups: [
      {
        items: permissions.map((p) => ({
          ref: p.ref,
          sourceEpoch: 1,
          revision: 4,
          state: "ready",
        })),
      },
    ],
  });
  h.c.publishResource = async (_connection, _context, item) => seen.push(item.ref.resourceId);
  h.c.tasks = async () => [];
  await h.c.synchronize(connection);
  assert.deepEqual(seen, ["approved"]);
  seen.length = 0;
  permissions.length = 0;
  await h.c.synchronize(connection);
  assert.deepEqual(seen, []);
});
test("source revision changing during owner retrieval prevents any new encryption or publication", async () => {
  const item = {
    ref: {
      kind: "watchlist",
      sourceService: "user",
      resourceId: "approved",
      incarnation: "incarnation_A",
    },
    sourceEpoch: 1,
    revision: 1,
    state: "ready",
  };
  const h = harness(async () => ({ items: [], limit: 50 }));
  let reads = 0,
    seals = 0;
  h.c.catalogue = async () => ({
    groups: [{ items: [{ ...item, revision: ++reads === 1 ? 1 : 2 }] }],
  });
  h.w.preparePersistentResource = async () => {
    seals++;
    return packet;
  };
  await assert.rejects(
    h.c.publishResource(connection, {}, item),
    (e) => e.code === "source_unavailable",
  );
  assert.equal(seals, 0);
  assert.equal(h.w.finishes, 0);
});
