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
for (const outcome of ["committed", "missing", "unknown", "not_superseded"]) {
  test(`directory-advanced publication recovery preserves the original on ${outcome}`, async () => {
    const calls = [],
      current = { identity: "CURRENT_AUTHORITY" },
      h = harness(async (_service, path, options = {}) => {
        calls.push({ path, options });
        if (path.includes("/operations/")) {
          if (outcome === "committed") return { fingerprint: packet.fingerprint };
          if (outcome === "unknown") throw new ErrorType("service_unavailable");
          return missing();
        }
        if (path.startsWith("/api/v3/agent-credentials/")) return current;
        if (options.method === "POST") return { fingerprint: packet.fingerprint };
        throw Error(path);
      });
    h.w.pending = { ...packet, context: { registrySequence: 1 } };
    h.w.vault.registryHistory = [{}, {}];
    let archives = 0;
    h.w.archiveSupersededPersistentPublication = async (args) => {
      archives++;
      assert.equal(args.current, current);
      assert.equal(args.actor.connectionId, connection.connectionId);
      assert.equal(args.expectedOperationId, packet.operationId);
      assert.equal(args.expectedFingerprint, packet.fingerprint);
      assert.equal(Object.hasOwn(args, "packet"), false, "Worker reloads the actual sealed row");
      if (outcome === "not_superseded") return false;
      h.w.pending = null;
      return true;
    };
    if (outcome === "unknown") {
      await assert.rejects(h.c.resume(connection), /service_unavailable/);
      assert.equal(h.w.pending.operationId, packet.operationId);
      assert.equal(h.w.finishes, 0);
    } else await h.c.resume(connection);
    assert.equal(archives, ["missing", "not_superseded"].includes(outcome) ? 1 : 0);
    const posts = calls.filter((c) => c.options.method === "POST");
    assert.equal(posts.length, outcome === "not_superseded" ? 1 : 0);
    if (posts.length) assert.equal(posts[0].options.json, packet.body);
    assert.equal(h.w.finishes, ["committed", "not_superseded"].includes(outcome) ? 1 : 0);
  });
}
test("registry registration recovers an already applied directory without repeating or replacing it", async () => {
  const identity = {
    ...packet,
    kind: "credential",
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
    if (path.endsWith("/approvals")) return { fingerprint: packet.fingerprint };
    if (path.endsWith("/completion")) return {};
    throw Error(path);
  });
  await h.c.send(connection, identity);
  assert.equal(calls.filter((c) => c.options.method === "PUT").length, 0);
  assert.equal(calls.filter((c) => c.path.endsWith("/approvals")).length, 1);
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
test("a repeated confirmation sends the sealed original credential and never generates another key approval", async () => {
  const h = harness(async () => ({
    lease: { credentialFingerprint: "credential_A" },
    identity: { bindingFingerprint: "binding_A" },
  }));
  const original = {
    kind: "credential",
    connectionId: connection.connectionId,
    setupIntentId: "setup_synthetic_A",
    operationId: "original_credential_operation_0001",
    expectedLease: { credentialFingerprint: "credential_A" },
    identity: { bindingFingerprint: "binding_A" },
  };
  const review = {
    connection,
    setup: { setupIntentId: original.setupIntentId },
    current: {},
    scope: { reviewDigest: "scope_A" },
    tasks: [],
    renewing: false,
  };
  h.w.pending = original;
  h.c.inspectAuthorization = async () => review;
  h.w.prepareAgentCredential = async () => assert.fail("must use the sealed original");
  let sent;
  h.c.send = async (_c, p) => {
    sent = p;
  };
  assert.equal((await h.c.authorize({}, review, [])).connected, true);
  assert.equal(sent, original);
});
test("a changed offer checks the original receipt before archiving an expired journal", async () => {
  const calls = [],
    h = harness(async (_s, path) => {
      calls.push(path);
      if (path.includes("/operations/")) return missing();
      if (path.includes("/setups/")) return { setupIntentId: "old_setup" };
      return {
        lease: { credentialFingerprint: "new_credential" },
        identity: { bindingFingerprint: "new_binding" },
      };
    });
  const original = {
      kind: "credential",
      setupIntentId: "old_setup",
      operationId: "original_credential_operation_0001",
    },
    packet = {
      kind: "credential",
      expectedLease: { credentialFingerprint: "new_credential" },
      identity: { bindingFingerprint: "new_binding" },
    },
    review = {
      connection,
      setup: { setupIntentId: "new_setup" },
      current: {},
      scope: { reviewDigest: "scope_A" },
      tasks: [],
      renewing: false,
    };
  h.w.pending = original;
  h.c.inspectAuthorization = async () => review;
  h.w.archiveExpiredCredentialPending = async (a) => {
    assert.ok(calls.at(-2).includes("/operations/"));
    assert.equal(a.previousSetup.setupIntentId, "old_setup");
    calls.push("archive");
  };
  h.w.prepareAgentCredential = async () => {
    assert.equal(calls.at(-1), "archive");
    return packet;
  };
  h.c.send = async (_c, p) => assert.equal(p, packet);
  assert.equal((await h.c.authorize({}, review, [])).connected, true);
});

test("temporary authorization sends the Owner-selected lifetime to the Worker", async () => {
  const h = harness(async () => ({
    lease: { credentialFingerprint: "temporary_credential" },
    identity: { bindingFingerprint: "temporary_binding" },
  }));
  const review = {
    connection,
    setup: { setupIntentId: "setup_temporary" },
    current: {},
    scope: { reviewDigest: "scope_A" },
    tasks: [],
    renewing: false,
  };
  h.w.pending = null;
  h.c.inspectAuthorization = async () => review;
  let prepares = 0;
  h.w.prepareAgentCredential = async (args) => {
    prepares++;
    assert.equal(args.lifetimeSeconds, 900);
    return {
      kind: "credential",
      credentialLifetimeSeconds: 900,
      expectedLease: { credentialFingerprint: "temporary_credential" },
      identity: { bindingFingerprint: "temporary_binding" },
    };
  };
  h.c.send = async () => {};
  assert.equal((await h.c.authorize({}, review, [], 900)).connected, true);
  assert.equal(prepares, 1);
});

test("a pending temporary approval is immutable and cannot become ninety days during retry", async () => {
  const h = harness(async () => ({
    lease: { credentialFingerprint: "temporary_credential" },
    identity: { bindingFingerprint: "temporary_binding" },
  }));
  const original = {
    kind: "credential",
    setupIntentId: "setup_temporary",
    credentialLifetimeSeconds: 900,
    expectedLease: { credentialFingerprint: "temporary_credential" },
    identity: { bindingFingerprint: "temporary_binding" },
  };
  const review = {
    connection,
    setup: { setupIntentId: original.setupIntentId },
    current: {},
    scope: { reviewDigest: "scope_A" },
    tasks: [],
    renewing: false,
  };
  h.w.pending = original;
  h.c.inspectAuthorization = async () => review;
  h.w.prepareAgentCredential = async () => assert.fail("must retain the sealed original");
  let sends = 0;
  h.c.send = async (_connection, packet) => {
    sends++;
    assert.equal(packet, original);
  };
  await assert.rejects(
    h.c.authorize({}, review, [], 7776000),
    (e) => e.code === "persistent_operation_pending",
  );
  assert.equal(sends, 0);
  assert.equal(h.w.pending, original);
  assert.equal((await h.c.authorize({}, review, [], 900)).connected, true);
  assert.equal(sends, 1);
});

test("unsupported connection lifetime is refused before reads or Worker preparation", async () => {
  const h = harness(async () => assert.fail("must not request unsupported duration"));
  h.c.inspectAuthorization = async () => assert.fail("must not inspect unsupported duration");
  for (const seconds of [0, 899, 901, 7776001, "900", null])
    await assert.rejects(h.c.authorize({}, {}, [], seconds), (e) => e.code === "review_changed");
});

test("authorization review exposes only the immutable pending connection duration", async () => {
  const setup = {
    setupIntentId: "setup_temporary",
    clientId: connection.clientId,
    provider: "muse",
    predecessorConnectionId: null,
  };
  const h = harness(async (_service, path) => {
    if (path.includes("/setups/")) return setup;
    if (path === "/api/v2/persistent-connections") return { connections: [connection] };
    if (path.endsWith("/restoration")) return { source: null };
    if (path.startsWith("/api/v2/tasks?"))
      return { contractVersion: "folioview.agent-workspace.v2.0", items: [], nextCursor: null };
    return { identity: null, lease: null };
  });
  h.w.inspectAgentCredentialSetup = async () => ({ provider: "muse", reviewDigest: "review_A" });
  h.w.verifyAgentRestoration = async () => ({
    identities: [],
    permissions: [],
    reviewDigest: "scope_A",
  });
  const handoff = {
    issuer: h.c.hubOrigin,
    vaultId: connection.vaultId,
    connectionId: connection.connectionId,
    setupIntentId: setup.setupIntentId,
  };
  h.w.pending = {
    kind: "credential",
    setupIntentId: setup.setupIntentId,
    credentialLifetimeSeconds: 900,
  };
  assert.equal((await h.c.inspectAuthorization(handoff)).pendingLifetimeSeconds, 900);
  delete h.w.pending.credentialLifetimeSeconds;
  assert.equal((await h.c.inspectAuthorization(handoff)).pendingLifetimeSeconds, 7776000);
  h.w.pending.credentialLifetimeSeconds = null;
  await assert.rejects(h.c.inspectAuthorization(handoff), (e) => e.code === "verification_failed");
});

test("restoration follows equivalent descriptors across server JSON property order", async () => {
  // The Hub head builds this descriptor directly, while source() snapshots its
  // response through canonical JSON (recursively sorted object properties).
  const ref = {
    connectionId: connection.connectionId,
    bindingFingerprint: "a".repeat(64),
    credentialFingerprint: "b".repeat(64),
    generation: 1,
  };
  const reordered = Object.fromEntries(Object.entries(ref).sort(([a], [b]) => a.localeCompare(b)));
  const source = {
    source: reordered,
    resourceState: { operations: ["consent_operation_original"] },
    predecessor: null,
  };
  const receipt = { operationId: "consent_operation_original" };
  const calls = [];
  const h = harness(async (_service, path) => {
    calls.push(path);
    if (path.endsWith("/restoration")) return { source: ref };
    if (path.includes("/restoration/")) return source;
    if (path.endsWith("/resource-operations/consent_operation_original")) return receipt;
    assert.fail("unexpected request: " + path);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await h.c.restorationSources(connection))), [
    { state: source, receipts: [receipt] },
  ]);
  assert.equal(calls.length, 3);

  for (const changed of [
    { ...reordered, generation: 2 },
    { ...reordered, bindingFingerprint: "c".repeat(64) },
    { ...reordered, credentialFingerprint: null },
    { ...reordered, connectionId: "another_connection" },
    { ...reordered, extra: true },
    Object.fromEntries(Object.entries(reordered).filter(([k]) => k !== "generation")),
  ]) {
    source.source = changed;
    calls.length = 0;
    await assert.rejects(h.c.restorationSources(connection), (e) => e.code === "invalid_response");
    assert.equal(calls.length, 2, "changed binding must stop before reading consent receipts");
  }
});

test("authorization accepts reordered JSON fields but rejects changed nested values and array order", async () => {
  const h = harness(async () => assert.fail("must stop before a write"));
  const expected = {
    connection,
    setup: { setupIntentId: "setup_original", binding: { generation: 1, clientId: "muse_A" } },
    current: { lease: { generation: 1, status: "active" } },
    scope: { reviewDigest: "scope_original" },
    tasks: [
      { taskId: "task_A", packet: { metadata: { version: 2, sections: ["overview", "risks"] } } },
    ],
  };
  const reverseObjects = (v) =>
    Array.isArray(v)
      ? v.map(reverseObjects)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, x]) => [k, reverseObjects(x)]),
          )
        : v;
  let actual = reverseObjects(expected);
  h.c.inspectAuthorization = async () => actual;
  let pendingReads = 0;
  h.w.loadPersistentPending = async () => {
    pendingReads++;
    throw new ErrorType("original_pending_read");
  };
  await assert.rejects(h.c.authorize({}, expected, []), (e) => e.code === "original_pending_read");
  assert.equal(pendingReads, 1, "equivalent review reached the existing sealed-pending boundary");
  for (const change of [
    (v) => {
      v.setup.binding.generation = 2;
    },
    (v) => {
      v.current.lease.status = "revoked";
    },
    (v) => {
      v.tasks[0].packet.metadata.sections.reverse();
    },
    (v) => {
      v.setup.binding.extra = null;
    },
  ]) {
    actual = reverseObjects(expected);
    change(actual);
    await assert.rejects(h.c.authorize({}, expected, []), (e) => e.code === "review_changed");
    assert.equal(pendingReads, 1, "changed review stops before opening or sending a pending write");
  }
});
