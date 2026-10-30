const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");

const CONTRACT = "folioview.agent-workspace.v2.0";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const meta = (resultId = "result_A", revision = 1, patch = {}) => ({
  resultId,
  taskId: "task_A",
  runId: "run_A",
  revision,
  deliveryRevision: 1,
  envelopeFingerprint: String(revision % 10).repeat(64),
  connectionId: "agent_A",
  receivedAt: "2026-10-30T10:00:00Z",
  taskVersion: 1,
  stateVersion: 0,
  read: false,
  starred: false,
  archived: false,
  manifestId: "manifest_A",
  keyEpoch: 1,
  ...patch,
});
const content = (title = "PRIVATE_TITLE_A") => ({
  title,
  summary: "PRIVATE_SUMMARY_A",
  sections: [{ sectionId: "overview", markdown: "PRIVATE_BODY_A" }],
  citations: [],
  limitations: [],
});
const result = (metadata) => ({
  contractVersion: CONTRACT,
  metadata,
  signedObject: { protected: "public", payload: "ciphertext", signature: "sig" },
  keyProofs: { checkpoint: {}, certificates: [] },
});
const evidence = (id = "result_A", revision = 1) => ({
  contractVersion: CONTRACT,
  profile: "folioview.owner-result-evidence.v1",
  run: {},
  manifest: { entries: [] },
  manifestFingerprint: "a".repeat(64),
  receipt: { receivedAt: "2026-10-30T10:01:00Z" },
  agentKeyGrant: {},
  authorizationExpiresAt: 1,
  provenance: { provider: "muse" },
  authorProof: { registrySequence: 1, verifiedAt: "2026-10-30T10:01:00Z" },
  registryProofs: [
    {
      registrySequence: 1,
      checkpointDigest: "a".repeat(64),
      path: `/api/v2/results/${id}/revisions/${revision}/registries/1`,
    },
  ],
});
const vault = {
  registryHistory: [{ checkpoint: { payload: "opaque" }, entries: [], contractVersion: CONTRACT }],
};

function compile(file, imports, globals = {}) {
  const { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
    filename: file,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
      return imports[name];
    },
    Response,
    AbortController,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URLSearchParams,
    Date,
    ...globals,
  });
  return module.exports;
}
function harness({
  locked = false,
  active = true,
  canWrite = true,
  rows = [meta()],
  transport,
  open,
  sign,
} = {}) {
  let owner = "owner_A:1",
    configured = true,
    visible = true;
  let currentRows = rows,
    latest = rows[0] ?? meta(),
    asyncOpen = open;
  const calls = [],
    opens = [],
    signs = [],
    intervals = new Map(),
    timeouts = new Map(),
    events = new Map(),
    effects = [],
    cells = [];
  let timer = 0,
    index = 0,
    dirty = false,
    mounted = true,
    bodyOverride = null;
  const changed = (before, after) =>
    !before || after.some((value, place) => value !== before[place]);
  const react = {
    useState(initial) {
      const slot = index++;
      cells[slot] ??= { state: typeof initial === "function" ? initial() : initial };
      return [
        cells[slot].state,
        (next) => {
          if (!mounted) return;
          const value = typeof next === "function" ? next(cells[slot].state) : next;
          dirty ||= !Object.is(value, cells[slot].state);
          cells[slot].state = value;
        },
      ];
    },
    useRef(value) {
      const slot = index++;
      cells[slot] ??= { current: value };
      return cells[slot];
    },
    useCallback(callback, deps) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].deps, deps)) cells[slot] = { value: callback, deps };
      return cells[slot].value;
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].deps, deps)) effects.push({ slot, effect, deps });
    },
  };
  const workspace = {
    owner,
    phase: locked ? "locked" : "unlocked",
    vaultGeneration: 1,
    vaultConfigured: true,
    canWriteState: canWrite,
    async refreshVault(signal, forState) {
      assert.equal(signal.aborted, false);
      if (forState && !workspace.canWriteState) throw { code: "key_revoked" };
      return vault;
    },
    async openResult(input) {
      opens.push(input);
      return asyncOpen
        ? asyncOpen(input)
        : content(
            input.result.metadata.resultId === "result_B" ? "PRIVATE_TITLE_B" : "PRIVATE_TITLE_A",
          );
    },
    async signResultState(input) {
      signs.push(input);
      if (sign) return sign(input);
      return {
        operationId: "synthetic_operation_AAAAA",
        authorKeyId: "a".repeat(43),
        command: { protected: "signed", payload: JSON.stringify(input), signature: "opaque" },
      };
    },
  };
  const requestPrivate = async (service, route, key, options) => {
    calls.push({ service, route, key, options });
    if (transport) {
      const value = await transport({
        service,
        route,
        key,
        options,
        latest,
        setLatest: (value) => (latest = value),
      });
      if (value !== undefined) return value;
    }
    if (bodyOverride && route === `/api/v2/results/${latest.resultId}`) {
      const body = bodyOverride;
      bodyOverride = null;
      return body;
    }
    if (route.startsWith("/api/v2/results/counts"))
      return response({
        contractVersion: CONTRACT,
        profile: "folioview.owner-result-counts.v1",
        asOf: "2026-10-30T10:00:00Z",
        counts: {
          all: currentRows.filter((row) => !row.archived).length,
          unread: currentRows.filter((row) => !row.archived && !row.read).length,
          starred: currentRows.filter((row) => !row.archived && row.starred).length,
          archived: currentRows.filter((row) => row.archived).length,
          total: currentRows.length,
        },
      });
    if (route.startsWith("/api/v2/results?"))
      return response({ contractVersion: CONTRACT, items: currentRows, nextCursor: null });
    if (route.includes("/revisions/") && route.endsWith("/evidence")) {
      const pieces = route.split("/");
      return response(evidence(pieces[4], Number(pieces[6])));
    }
    if (route.includes("/revisions?"))
      return response({ contractVersion: CONTRACT, items: [latest], nextCursor: null });
    if (route.endsWith("/state")) {
      const signed = JSON.parse(options.json.command.payload);
      latest = { ...latest, ...signed.changes, stateVersion: latest.stateVersion + 1 };
      currentRows = currentRows.map((row) => (row.resultId === latest.resultId ? latest : row));
      return response(latest);
    }
    if (route.startsWith("/api/v2/results/")) {
      const parsed = new URL(route, "https://test.invalid"),
        id = parsed.pathname.split("/").at(-1);
      const revision = Number(parsed.searchParams.get("revision") || latest.revision);
      return response(
        result({
          ...latest,
          resultId: id,
          revision,
          envelopeFingerprint: String(revision % 10).repeat(64),
        }),
      );
    }
    throw new Error("Unexpected synthetic route");
  };
  const window = {
    setTimeout(callback) {
      const id = ++timer;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval(callback) {
      const id = ++timer;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: (event, callback) => events.set(event, callback),
    removeEventListener: (event) => events.delete(event),
  };
  const helpers = compile("../lib/inbox-types.ts", {});
  const { useInbox } = compile(
    "../components/useInbox.ts",
    {
      react,
      "@/components/AuthProvider": {
        useAuth: () => ({
          status: owner ? "authenticated" : "anonymous",
          profile: owner ? { uid: owner.split(":")[0] } : null,
          sessionKey: owner,
          agentHubConfigured: configured,
          requestPrivate,
        }),
      },
      "@/lib/inbox-types": helpers,
    },
    { window, document },
  );
  function render({ flush = true } = {}) {
    let value;
    do {
      dirty = false;
      index = 0;
      value = useInbox(workspace, { active });
      if (flush)
        for (const entry of effects.splice(0)) {
          cells[entry.slot]?.cleanup?.();
          cells[entry.slot] = { deps: entry.deps, cleanup: entry.effect() };
        }
    } while (flush && dirty);
    return value;
  }
  return {
    render,
    calls,
    opens,
    signs,
    workspace,
    async ready() {
      render();
      await settle();
      return render();
    },
    owner(next) {
      owner = next;
      workspace.owner = next;
      workspace.vaultGeneration++;
    },
    lock() {
      workspace.phase = "locked";
      workspace.canWriteState = false;
      workspace.vaultGeneration++;
    },
    unlock() {
      workspace.phase = "unlocked";
      workspace.canWriteState = canWrite;
      workspace.vaultGeneration++;
    },
    capability(next) {
      configured = next;
      workspace.vaultConfigured = next;
    },
    active(next) {
      active = next;
    },
    visibility(next) {
      visible = next;
      events.get("visibilitychange")?.();
    },
    poll() {
      for (const callback of [...intervals.values()]) callback();
    },
    deadline() {
      for (const callback of [...timeouts.values()]) callback();
    },
    intervalCount: () => intervals.size,
    replace(next) {
      currentRows = next;
      latest = next[0] ?? latest;
    },
    setLatest(next) {
      latest = next;
      currentRows = currentRows.map((row) => (row.resultId === next.resultId ? next : row));
    },
    deferBody(body) {
      bodyOverride = body;
    },
    deferOpen(callback) {
      asyncOpen = callback;
    },
    unmount() {
      for (const cell of cells) cell?.cleanup?.();
      mounted = false;
    },
    helpers,
  };
}

test("locked discovery loads only bounded metadata and local search never reaches a server", async () => {
  const h = harness({ locked: true });
  let model = await h.ready();
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].content, null);
  assert.equal(model.unlocked, false);
  assert.equal(h.opens.length, 0);
  assert.equal(h.calls.length, 2);
  await model.openResult("result_A");
  assert.equal(h.calls.length, 2);
  model.setQuery("PRIVATE_SENTINEL");
  model = h.render();
  assert.equal(model.query, "");
  assert.ok(h.calls.every((call) => !JSON.stringify(call).includes("PRIVATE_SENTINEL")));
  assert.equal(h.intervalCount(), 1);
  h.unmount();
});

test("latest authenticated opening reuses pinned public history and only then marks its exact body read", async () => {
  const h = harness();
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  assert.equal(model.selected.content.title, "PRIVATE_TITLE_A");
  assert.equal(model.selected.metadata.read, true);
  assert.equal(model.selected.metadata.stateVersion, 1);
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].registryBundles[0], vault.registryHistory[0]);
  assert.equal(h.calls.filter((call) => call.options.method === "PATCH").length, 1);
  assert.ok(
    h.calls.findIndex((call) => call.route.includes("/evidence")) <
      h.calls.findIndex((call) => call.options.method === "PATCH"),
  );
  assert.ok(!h.calls.some((call) => call.route.includes("/registries/")));
  model.setQuery("PRIVATE_BODY_A");
  model = h.render();
  assert.equal(model.items.length, 1);
  assert.equal(model.decryptedCount, 1);
  const count = h.calls.length;
  model.setQuery("unloaded words");
  model = h.render();
  assert.equal(model.items.length, 0);
  assert.equal(h.calls.length, count);
  h.unmount();
});

test("history opens remain historical and never mark the latest unseen body read", async () => {
  const h = harness({ rows: [meta("result_A", 2, { stateVersion: 2 })] });
  let model = await h.ready();
  await model.openResult("result_A", 1);
  model = h.render();
  assert.equal(model.selected.historical, true);
  assert.equal(model.selected.metadata.revision, 1);
  assert.equal(h.calls.filter((call) => call.options.method === "PATCH").length, 0);
  assert.equal(h.signs.length, 0);
  assert.equal(model.selected.evidence.receipt.receivedAt, "2026-10-30T10:01:00Z");
  h.unmount();
});

test("a failed authentication or unsafe render result is never cached, searched or marked read", async () => {
  for (const code of ["invalid_signature", "render_rejected"]) {
    const h = harness({
      open: async () => {
        throw { code };
      },
    });
    let model = await h.ready();
    await model.openResult("result_A");
    model = h.render();
    assert.equal(model.selected, null);
    assert.equal(model.items[0].content, null);
    assert.equal(model.decryptedCount, 0);
    assert.equal(model.copyText(), null);
    assert.equal(model.error, code === "render_rejected" ? code : "verification_failed");
    assert.equal(h.signs.length, 0);
    h.unmount();
  }
});

test("proof selectors are reconstructed and mismatched or arbitrary paths stop before decrypt", async () => {
  const h = harness({
    transport: async ({ route }) =>
      route.endsWith("/evidence")
        ? response({
            ...evidence(),
            registryProofs: [
              {
                registrySequence: 1,
                checkpointDigest: "a".repeat(64),
                path: "https://evil.invalid/steal",
              },
            ],
          })
        : undefined,
  });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  assert.equal(model.error, "invalid_response");
  assert.equal(h.opens.length, 0);
  assert.ok(!h.calls.some((call) => call.route.startsWith("https:")));
  h.unmount();
});

test("lock and account transitions mask plaintext in the same render and invalidate captured actions", async () => {
  for (const transition of ["lock", "switch", "logout", "capability"]) {
    const h = harness();
    let model = await h.ready();
    await model.openResult("result_A");
    model = h.render();
    model.setQuery("PRIVATE");
    model = h.render();
    const captured = model;
    const count = h.calls.length;
    if (transition === "lock") h.lock();
    if (transition === "switch") h.owner("owner_B:1");
    if (transition === "logout") h.owner(null);
    if (transition === "capability") h.capability(false);
    model = h.render({ flush: false });
    assert.equal(model.selected, null);
    assert.equal(model.query, "");
    assert.ok(model.items.every((item) => item.content === null));
    assert.equal(captured.copyText(), null);
    await captured.openResult("result_A");
    await captured.updateState({ starred: true });
    captured.setQuery("OLD_PRIVATE");
    captured.discardPendingState();
    assert.equal(h.calls.length, count);
    model = h.render();
    assert.equal(model.selected, null);
    h.unmount();
  }
});

test("late decrypted content after lock, switched account or inactive view cannot revive a report", async () => {
  for (const transition of ["lock", "switch", "inactive", "hidden"]) {
    const gate = deferred(),
      h = harness({ open: () => gate.promise });
    let model = await h.ready();
    const opening = model.openResult("result_A");
    await settle();
    assert.equal(h.opens.length, 1);
    if (transition === "lock") h.lock();
    if (transition === "switch") h.owner("owner_B:1");
    if (transition === "inactive") h.active(false);
    if (transition === "hidden") h.visibility(false);
    model = h.render();
    gate.resolve(content());
    await opening;
    model = h.render();
    assert.equal(model.selected, null);
    assert.equal(model.decryptedCount, 0);
    assert.equal(h.signs.length, 0);
    h.unmount();
  }
});

test("polling pauses while hidden or away, preserves loaded reports and restarts on visibility", async () => {
  const h = harness();
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  const calls = h.calls.length;
  h.visibility(false);
  model = h.render();
  assert.equal(h.intervalCount(), 0);
  h.poll();
  await settle();
  assert.equal(h.calls.length, calls);
  assert.equal(model.selected, null);
  h.visibility(true);
  await h.ready();
  assert.equal(h.intervalCount(), 1);
  h.active(false);
  h.render();
  assert.equal(h.intervalCount(), 0);
  h.unmount();
  assert.equal(h.intervalCount(), 0);
});

test("network body timeout is bounded and late body data cannot become decrypted content", async () => {
  const h = harness();
  let model = await h.ready();
  let closed = false;
  const stream = new ReadableStream({
    cancel() {
      closed = true;
    },
  });
  h.deferBody(new Response(stream, { headers: { "Content-Type": "application/json" } }));
  const opening = model.openResult("result_A");
  await settle();
  h.deadline();
  await opening;
  model = h.render();
  assert.equal(model.error, "request_timeout");
  assert.equal(model.busy, false);
  assert.equal(h.opens.length, 0);
  assert.equal(closed, true);
  h.unmount();
});

test("uncertain state writes retain exact packet for explicit replay without new signing", async () => {
  let fail = true,
    packet = null;
  const h = harness({
    rows: [meta("result_A", 1, { read: true })],
    transport: async ({ route, options, latest, setLatest }) => {
      if (!route.endsWith("/state")) return;
      if (fail) {
        packet = options.json;
        fail = false;
        throw new Error("lost response");
      }
      assert.deepEqual(options.json, packet);
      const value = { ...latest, starred: true, stateVersion: latest.stateVersion + 1 };
      setLatest(value);
      return response(value);
    },
  });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  await model.updateState({ starred: true });
  model = h.render();
  assert.equal(model.pendingState, true);
  assert.equal(model.error, "state_outcome_unknown");
  assert.equal(h.signs.length, 1);
  await model.retryPendingState();
  model = h.render();
  assert.equal(h.signs.length, 1);
  assert.equal(model.pendingState, false);
  assert.equal(model.selected.metadata.starred, true);
  assert.equal(model.notice, "state_recovered");
  h.unmount();
});

test("a competing new body cannot be marked read by an older decrypted report", async () => {
  const h = harness({ rows: [meta("result_A", 1, { read: true })] });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  h.setLatest(meta("result_A", 2, { stateVersion: 2 }));
  await model.updateState({ read: true });
  model = h.render();
  assert.equal(model.notice, "state_conflict");
  assert.equal(model.selected.metadata.revision, 1);
  assert.equal(model.selected.historical, true);
  assert.equal(h.calls.filter((call) => call.options.method === "PATCH").length, 0);
  assert.equal(h.signs.length, 0);
  h.unmount();
});

test("old replay acknowledgement cannot overwrite newer logical state", async () => {
  let hold = false;
  const gate = deferred();
  const h = harness({
    rows: [meta("result_A", 1, { read: true })],
    transport: async ({ route, options, latest }) => {
      if (route.endsWith("/state") && !hold) {
        hold = true;
        return gate.promise;
      }
    },
  });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  const write = model.updateState({ starred: true });
  await settle();
  h.setLatest(meta("result_A", 1, { stateVersion: 3, read: true, starred: false, archived: true }));
  await h.render().reload();
  model = h.render();
  gate.resolve(response(meta("result_A", 1, { stateVersion: 1, read: true, starred: true })));
  await write;
  model = h.render();
  assert.equal(model.selected.metadata.stateVersion, 3);
  assert.equal(model.selected.metadata.archived, true);
  assert.equal(model.selected.metadata.starred, false);
  h.unmount();
});

test("explicit replay treats original ACK as a receipt and refreshes an uncached newer head", async () => {
  let first = true;
  const h = harness({
    rows: [meta("result_A", 1, { read: true })],
    transport: async ({ route, setLatest }) => {
      if (!route.endsWith("/state")) return;
      if (first) {
        first = false;
        setLatest(
          meta("result_A", 1, { stateVersion: 3, read: true, starred: false, archived: true }),
        );
        throw new Error("lost ACK");
      }
      return response(meta("result_A", 1, { stateVersion: 1, read: true, starred: true }));
    },
  });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  await model.updateState({ starred: true });
  model = h.render();
  assert.equal(model.pendingState, true);
  await model.retryPendingState();
  model = h.render();
  assert.equal(model.pendingState, false);
  assert.equal(model.notice, "state_recovered");
  assert.equal(model.selected.metadata.stateVersion, 3);
  assert.equal(model.selected.metadata.archived, true);
  assert.equal(model.selected.metadata.starred, false);
  assert.equal(h.signs.length, 1);
  h.unmount();
});

test("readonly historical unlock keeps reading available but never signs owner state", async () => {
  const h = harness({ canWrite: false });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  assert.ok(model.selected);
  assert.equal(model.canWriteState, false);
  assert.equal(h.signs.length, 0);
  await model.updateState({ archived: true });
  assert.equal(h.signs.length, 0);
  assert.equal(model.copyText().includes("PRIVATE_BODY_A"), true);
  h.unmount();
});

test("fresh metadata cannot relabel cached plaintext for another authenticated fingerprint", async () => {
  const h = harness({ rows: [meta("result_A", 1, { read: true })] });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  assert.ok(model.items[0].content);
  h.setLatest(
    meta("result_A", 1, { stateVersion: 2, read: true, envelopeFingerprint: "b".repeat(64) }),
  );
  await model.reload();
  model = h.render();
  assert.equal(model.items[0].content, null);
  assert.equal(model.selected.historical, true);
  model.setQuery("PRIVATE_TITLE_A");
  model = h.render();
  assert.equal(model.items.length, 0);
  h.unmount();
});

test("metadata fingerprints must be strings rather than coercible arrays", async () => {
  const h = harness({ rows: [meta("result_A", 1, { envelopeFingerprint: ["a".repeat(64)] })] });
  const model = await h.ready();
  assert.equal(model.error, "invalid_response");
  assert.equal(model.items.length, 0);
  assert.equal(h.opens.length, 0);
  h.unmount();
});

test("metadata pages cap loaded rows at100 without decrypting or silently restarting expired cursors", async () => {
  let page = 0,
    conflict = false;
  const h = harness({
    locked: true,
    transport: async ({ route }) => {
      if (!route.startsWith("/api/v2/results?")) return;
      if (conflict)
        return response({ contractVersion: CONTRACT, error: { code: "version_conflict" } }, 409);
      const current = page++;
      return response({
        contractVersion: CONTRACT,
        items: Array.from({ length: 20 }, (_, i) => meta(`result_${current * 20 + i}`)),
        nextCursor: `cursor_${current + 1}`,
      });
    },
  });
  let model = await h.ready();
  for (let n = 0; n < 4; n++) {
    await model.loadMore();
    model = h.render();
  }
  assert.equal(model.loadedCount, 100);
  assert.equal(model.hasMore, false);
  const count = h.calls.length;
  await model.loadMore();
  assert.equal(h.calls.length, count);
  assert.equal(h.opens.length, 0);
  h.unmount();
  const bad = harness({
    transport: async ({ route }) =>
      route.startsWith("/api/v2/results?")
        ? route.includes("cursor=")
          ? response({}, 409)
          : response({ contractVersion: CONTRACT, items: [meta()], nextCursor: "cursor_expired" })
        : undefined,
  });
  model = await bad.ready();
  await model.loadMore();
  model = bad.render();
  assert.equal(model.error, "version_conflict");
  assert.equal(model.nextCursor, null);
  assert.equal(bad.calls.filter((call) => call.route.includes("cursor=")).length, 1);
  bad.unmount();
});

test("history pagination preserves32 revisions and opening history never consumes current read state", async () => {
  const history = Array.from({ length: 32 }, (_, i) =>
    meta("result_A", 32 - i, { stateVersion: 40 }),
  );
  const h = harness({
    canWrite: false,
    rows: [history[0]],
    transport: async ({ route }) =>
      route.includes("/revisions?")
        ? response({
            contractVersion: CONTRACT,
            items: route.includes("cursor=") ? history.slice(20) : history.slice(0, 20),
            nextCursor: route.includes("cursor=") ? null : "history_more",
          })
        : undefined,
  });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  assert.equal(model.history.length, 20);
  await model.loadMoreHistory();
  model = h.render();
  assert.equal(model.history.length, 32);
  assert.equal(model.historyHasMore, false);
  const historyCalls = h.calls.filter((call) => call.route.includes("/revisions?")).length;
  await model.openResult("result_A", 1);
  model = h.render();
  assert.equal(model.history.length, 32);
  assert.equal(model.selected.metadata.revision, 1);
  assert.equal(model.selected.historical, true);
  assert.equal(h.calls.filter((call) => call.route.includes("/revisions?")).length, historyCalls);
  assert.equal(h.signs.length, 0);
  h.unmount();
});

test("decrypted search cache is bounded to20 exact authenticated deliveries", async () => {
  const rows = Array.from({ length: 21 }, (_, i) => meta(`result_${i}`, 1, { read: true }));
  const h = harness({
    rows,
    canWrite: false,
    open: async (input) => content(`Private ${input.result.metadata.resultId}`),
    transport: async ({ route }) =>
      route.startsWith("/api/v2/results?")
        ? response({
            contractVersion: CONTRACT,
            items: route.includes("cursor=") ? rows.slice(20) : rows.slice(0, 20),
            nextCursor: route.includes("cursor=") ? null : "page_two",
          })
        : undefined,
  });
  let model = await h.ready();
  await model.loadMore();
  model = h.render();
  for (const row of rows) {
    await model.openResult(row.resultId);
    model = h.render();
  }
  assert.equal(model.loadedCount, 21);
  assert.equal(model.decryptedCount, 20);
  assert.equal(model.items[0].content, null);
  model.setQuery("Private result_0");
  model = h.render();
  assert.equal(model.items.length, 0);
  assert.ok(!h.calls.some((call) => call.route.includes("Private")));
  h.unmount();
});

test("late HTTP body after account transition cannot reach the Worker", async () => {
  let release;
  const stream = new ReadableStream({
    start(controller) {
      release = () => {
        try {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(result(meta()))));
          controller.close();
        } catch {}
      };
    },
  });
  const h = harness();
  let model = await h.ready();
  h.deferBody(new Response(stream, { headers: { "Content-Type": "application/json" } }));
  const opening = model.openResult("result_A");
  await settle();
  h.owner("owner_B:1");
  h.render();
  release();
  await opening;
  model = h.render();
  assert.equal(h.opens.length, 0);
  assert.equal(model.selected, null);
  h.unmount();
});

test("state CAS conflict does not auto-resign or retry, and local pending recovery does not leak after lock", async () => {
  const h = harness({
    rows: [meta("result_A", 1, { read: true })],
    transport: async ({ route }) => (route.endsWith("/state") ? response({}, 409) : undefined),
  });
  let model = await h.ready();
  await model.openResult("result_A");
  model = h.render();
  await model.updateState({ archived: true });
  model = h.render();
  assert.equal(model.error, "version_conflict");
  assert.equal(model.notice, "state_conflict");
  assert.equal(model.pendingState, false);
  assert.equal(h.signs.length, 1);
  assert.equal(h.calls.filter((call) => call.route.endsWith("/state")).length, 1);
  h.unmount();
  const pending = harness({
    rows: [meta("result_A", 1, { read: true })],
    transport: async ({ route }) => {
      if (route.endsWith("/state")) throw new Error("lost");
    },
  });
  model = await pending.ready();
  await model.openResult("result_A");
  model = pending.render();
  await model.updateState({ starred: true });
  model = pending.render();
  assert.equal(model.pendingState, true);
  const old = model;
  pending.lock();
  model = pending.render({ flush: false });
  assert.equal(model.pendingState, false);
  await old.retryPendingState();
  assert.equal(pending.calls.filter((call) => call.route.endsWith("/state")).length, 1);
  pending.render();
  pending.unmount();
});
