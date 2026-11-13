const test = require("node:test"),
  assert = require("node:assert/strict");
const { compile } = require("./resource-library-helpers.cjs");
const inbox = compile("../lib/inbox-types.ts"),
  reader = compile("../lib/task-result-reader.ts", { "./inbox-types": inbox }),
  { DisplayLru } = compile("../lib/workspace-cache.ts");
const C = reader.RESULT_CONTRACT,
  content = {
    title: "PRIVATE_REPORT",
    summary: "PRIVATE_SUMMARY",
    sections: [{ sectionId: "summary", markdown: "PRIVATE_BODY" }],
    limitations: [],
  };
const pm = () => ({
  resultId: "presult_A",
  taskId: "task_A",
  runId: "run_A",
  connectionId: "connection_A",
  receivedAt: 1000,
  stateVersion: 0,
  read: false,
  starred: false,
  archived: false,
});
const fm = () => ({
  resultId: "result_A",
  taskId: "task_A",
  runId: "run_A",
  revision: 1,
  deliveryRevision: 1,
  envelopeFingerprint: "a".repeat(64),
  connectionId: "connection_A",
  receivedAt: "2026-11-13T12:00:00Z",
  taskVersion: 1,
  stateVersion: 0,
  read: false,
  starred: false,
  archived: false,
  manifestId: "manifest_A",
  keyEpoch: 1,
});
test("persistent preloading is read-only; opening revalidates visibility and reuses the immutable body after a read flag changes", async () => {
  let calls = 0,
    decrypts = 0,
    read = false;
  const raw = {
    metadata: pm(),
    envelope: { synthetic: "CIPHERTEXT" },
    manifest: { runId: "run_A" },
    identity: {},
    binding: {},
    receipt: {},
  };
  const w = {
    vault: { vaultId: "vault_A" },
    openPersistentResult: async (args) => {
      decrypts++;
      assert.equal(args.resultId, "presult_A");
      return content;
    },
  };
  const cache = new DisplayLru(10, 16000000),
    row = { kind: "persistent", metadata: pm(), triggerKind: "legacy_unknown" },
    api = async (path) => {
      calls++;
      assert.equal(path, "/api/v2/persistent-results/vault_A/presult_A");
      return { ...raw, metadata: { ...raw.metadata, read, stateVersion: read ? 1 : 0 } };
    };
  const args = { row, workspace: w, api, cache, scope: "owner:vault:1", assert() {} };
  assert.equal(
    (await reader.readTaskResult({ ...args, fresh: false })).content.title,
    "PRIVATE_REPORT",
  );
  assert.equal(calls, 1);
  assert.equal(decrypts, 1);
  await reader.readTaskResult({ ...args, fresh: false });
  assert.equal(calls, 1);
  read = true;
  const opened = await reader.readTaskResult(args);
  assert.equal(calls, 2);
  assert.equal(decrypts, 1);
  assert.equal(opened.row.metadata.read, true);
});
test("foreground evidence remains on its fixed owner path and a failed decryption neither caches a title nor mutates read state", async () => {
  const meta = fm(),
    calls = [],
    cache = new DisplayLru(10, 16000000),
    row = { kind: "foreground", metadata: meta, triggerKind: "legacy_unknown" };
  const raw = {
    contractVersion: C,
    metadata: meta,
    signedObject: { synthetic: "CIPHERTEXT" },
    keyProofs: {},
  };
  let forged = true,
    decrypts = 0;
  const api = async (path) => {
    calls.push(path);
    if (path.endsWith("/evidence"))
      return {
        contractVersion: C,
        profile: "folioview.owner-result-evidence.v1",
        authorProof: { registrySequence: 1 },
        registryProofs: [
          {
            registrySequence: 1,
            checkpointDigest: "a".repeat(64),
            path: forged
              ? "https://evil.example/keys"
              : "/api/v2/results/result_A/revisions/1/registries/1",
          },
        ],
      };
    return raw;
  };
  const args = {
    row,
    workspace: {
      vault: { vaultId: "vault_A", registryHistory: [{ checkpoint: "TRUSTED" }] },
      openResult: async () => {
        decrypts++;
        throw Error("verification_failed");
      },
    },
    api,
    cache,
    scope: "owner:vault:1",
    assert() {},
  };
  await assert.rejects(reader.readTaskResult(args), /invalid_response/);
  assert.equal(decrypts, 0);
  forged = false;
  await assert.rejects(reader.readTaskResult(args), /verification_failed/);
  assert.equal(decrypts, 1);
  assert.equal(cache.size, 0);
  assert.ok(calls.every((p) => p.startsWith("/api/v2/results/result_A")));
});
test("scope changes and foreign task/result metadata are rejected before any plaintext is returned", async () => {
  const row = { kind: "persistent", metadata: pm(), triggerKind: "legacy_unknown" },
    cache = new DisplayLru(10, 16000000);
  let decrypts = 0;
  const args = {
    row,
    workspace: {
      vault: { vaultId: "vault_A" },
      openPersistentResult: async () => {
        decrypts++;
        return content;
      },
    },
    api: async () => ({ metadata: { ...pm(), taskId: "task_B" } }),
    cache,
    scope: "owner_A",
    assert() {},
  };
  await assert.rejects(reader.readTaskResult(args), /invalid_response/);
  assert.equal(decrypts, 0);
  await assert.rejects(
    reader.readTaskResult({
      ...args,
      assert() {
        throw Error("cancelled");
      },
      api: async () => ({ metadata: pm() }),
    }),
    /cancelled/,
  );
  assert.equal(cache.size, 0);
});
test("result-state acknowledgements must match the immutable report, exact CAS increment and requested flags", () => {
  const row = { kind: "persistent", metadata: pm(), triggerKind: "manual" },
    ack = { ...pm(), stateVersion: 1, read: true };
  assert.equal(reader.stateReceipt(row, { read: true }, ack).metadata.read, true);
  for (const patch of [
    { taskId: "other" },
    { stateVersion: 2 },
    { starred: true },
    { read: false },
  ])
    assert.throws(() => reader.stateReceipt(row, { read: true }, { ...ack, ...patch }));
  assert.throws(() =>
    reader.resultPage("persistent", {
      contractVersion: C,
      profile: "invented",
      items: [],
      nextCursor: null,
    }),
  );
});
module.exports = { reader, pm, fm, content, C };

test("a valid historical foreground revision uses the original evidence chain and remains read-only", async () => {
  const meta = fm(),
    row = { kind: "foreground", metadata: meta, triggerKind: "legacy_unknown" },
    bundle = { checkpoint: "original" };
  let received;
  const result = await reader.readTaskResult({
    row,
    workspace: {
      vault: { vaultId: "vault_A", registryHistory: [bundle] },
      openResult: async (args) => {
        received = args;
        return content;
      },
    },
    api: async (path) =>
      path.endsWith("/evidence")
        ? {
            contractVersion: C,
            profile: "folioview.owner-result-evidence.v1",
            authorProof: { registrySequence: 1 },
            registryProofs: [
              {
                registrySequence: 1,
                checkpointDigest: "a".repeat(64),
                path: "/api/v2/results/result_A/revisions/1/registries/1",
              },
            ],
          }
        : {
            contractVersion: C,
            metadata: meta,
            signedObject: { opaque: "original" },
            keyProofs: {},
          },
    cache: new DisplayLru(10, 16000000),
    scope: "owner_A",
    assert() {},
    revision: 1,
  });
  assert.equal(result.historical, true);
  assert.equal(received.result.metadata.revision, 1);
  assert.equal(received.registryBundles[0], bundle);
  assert.equal(result.content.title, "PRIVATE_REPORT");
});
