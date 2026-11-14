const { displayBody } = require("./connection-display-fixtures.cjs");
const assert = require("node:assert/strict"),
  test = require("node:test");
const { compile, contracts: resources } = require("./resource-library-helpers.cjs");
const types = compile("../lib/task-types.ts"),
  controller = compile(
    "../lib/persistent-experience-controller.ts",
    { "./resource-library": resources, "./task-types": types },
    { Map, Set, Date },
  );
const tick = () => new Promise((r) => setImmediate(r));
async function waitUntil(check, label) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function harness(authOverride, ownerRequest, readRequest, otherRequest) {
  let owner = authOverride?.sessionKey ?? "owner_A:login1",
    visible = true,
    active = true,
    index = 0,
    dirty = false;
  const cells = [],
    effects = [],
    events = new Map(),
    timers = new Map(),
    timerDelays = new Map();
  let nextTimer = 0;
  const changed = (a, b) => !a || b.some((v, i) => v !== a[i]);
  const react = {
    useState(initial) {
      const n = index++;
      cells[n] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        cells[n].value,
        (v) => {
          const next = typeof v === "function" ? v(cells[n].value) : v;
          dirty ||= !Object.is(next, cells[n].value);
          cells[n].value = next;
        },
      ];
    },
    useRef(value) {
      const n = index++;
      cells[n] ??= { current: value };
      return cells[n];
    },
    useCallback(f, deps) {
      const n = index++;
      if (!cells[n] || changed(cells[n].deps, deps)) cells[n] = { deps, value: f };
      return cells[n].value;
    },
    useEffect(f, deps) {
      const n = index++;
      if (!cells[n] || changed(cells[n].deps, deps)) {
        const queued = effects.findIndex((e) => e.n === n);
        if (queued >= 0) effects[queued] = { n, f, deps };
        else effects.push({ n, f, deps });
      }
    },
  };
  const calls = [];
  let unlocks = 0;
  const workspace = {
    owner,
    phase: "unlocked",
    vaultGeneration: 1,
    vault: { vaultId: "vault_A" },
    canWriteState: true,
    refreshVault: async () => workspace.vault,
    unlock: async () => {
      unlocks++;
    },
  };
  const requestPrivate = async (_service, path, _key, options) => {
    calls.push({ path, options });
    const other = otherRequest?.(path, options);
    if (other !== undefined) return other;
    if (
      readRequest &&
      (path.endsWith("/capabilities") ||
        path.endsWith("/persistent-connections") ||
        path.startsWith("/api/v3/provider-connections/"))
    )
      return readRequest(path, options);
    if (
      ownerRequest &&
      (path.includes("/operations/") ||
        path === "/api/v2/vaults/current" ||
        path.endsWith("/registry") ||
        path.endsWith("/approvals") ||
        (path.includes("/agent-credentials/") && !path.endsWith("/capabilities")))
    )
      return ownerRequest(path, options);
    return Response.json(
      path.endsWith("/display")
        ? displayBody(summaryBody([]))
        : path.endsWith("/summary")
          ? summaryBody([])
          : path.startsWith("/api/v3/provider-connections/")
            ? { profile: "folioview.provider-connection-slot.v1", slot: null }
            : path.endsWith("/persistent-connections")
              ? { connections: [] }
              : path.includes("persistent-agents")
                ? {
                    enrollmentEnabled: false,
                    resourceConsentEnabled: false,
                    executionEnabled: false,
                  }
                : { accountLinkEnabled: false },
    );
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: (e, f) => events.set(e, f),
    removeEventListener: (e) => events.delete(e),
  };
  const timer = (f, delay) => {
    const n = ++nextTimer;
    timers.set(n, f);
    timerDelays.set(n, delay);
    return n;
  };
  const hook = compile(
    "../components/usePersistentWorkspace.ts",
    {
      react,
      "./AuthProvider": {
        useAuth: () =>
          authOverride
            ? {
                ...authOverride,
                // Only User transport crosses the actual provider in this harness.
                requestPrivate: (service, ...args) =>
                  service === "user"
                    ? authOverride.requestPrivate(service, ...args)
                    : requestPrivate(service, ...args),
              }
            : {
                status: owner ? "authenticated" : "anonymous",
                sessionKey: owner,
                agentHubConfigured: true,
                requestPrivate,
              },
      },
      "@/lib/persistent-experience-controller": controller,
      "@/lib/connection-summary": compile("../lib/connection-summary.ts"),
    },
    {
      document,
      Headers,
      setTimeout: timer,
      clearTimeout: (n) => timers.delete(n),
      setInterval: timer,
      clearInterval: (n) => timers.delete(n),
      Map,
      Set,
      Date,
    },
  );
  let model;
  function render(flush = true) {
    do {
      dirty = false;
      index = 0;
      model = hook.usePersistentWorkspace(
        workspace,
        "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
        active,
      );
      if (flush)
        for (const e of effects.splice(0)) {
          cells[e.n]?.cleanup?.();
          cells[e.n] = { deps: e.deps, cleanup: e.f() };
        }
    } while (flush && dirty);
    return model;
  }
  return {
    workspace,
    calls,
    cells,
    releaseTimer(delay) {
      const pending = [...timers].find(([id]) => timerDelays.get(id) === delay);
      assert.ok(pending, "expected pending timer " + delay);
      pending[1]();
    },
    get unlocks() {
      return unlocks;
    },
    render,
    async settle() {
      for (let i = 0; i < 6; i++) {
        await tick();
        render();
      }
      return model;
    },
    setActive(value) {
      active = value;
      return render();
    },
    setOwner(v, flush = false) {
      owner = v;
      workspace.owner = v;
      workspace.vaultGeneration++;
      return render(flush);
    },
    hide(flush = false) {
      visible = false;
      events.get("visibilitychange")?.();
      return render(flush);
    },
    close() {
      for (const c of cells) c?.cleanup?.();
      timers.clear();
    },
  };
}
test("late private work is rejected on logout/login generation change before effects run, without another unlock", async () => {
  const h = harness();
  try {
    h.render();
    await h.settle();
    let release;
    const waiting = new Promise((r) => (release = r));
    const original = h.render();
    let finished = false;
    const operation = original.execute(async (_controller, _api, assertCurrent) => {
      await waiting;
      assertCurrent();
      finished = true;
      return "PRIVATE_CANARY";
    });
    h.setOwner("owner_A:login2", false);
    release();
    assert.equal(await operation, null);
    assert.equal(finished, false);
    assert.equal(h.unlocks, 0);
    await h.settle();
    assert.equal(h.render().error, "");
  } finally {
    h.close();
  }
});
test("hidden pages mask private connection and task state immediately, abort work, and never prompt Passkey", async () => {
  const h = harness();
  try {
    h.render();
    await h.settle();
    const state = h.cells.find((c) => c?.value && Array.isArray(c.value.views));
    state.value = {
      ...state.value,
      scope: "owner_A:login1:vault_A:1",
      tasks: [{ title: "PRIVATE_CANARY" }],
      views: [
        {
          connection: { connectionId: "connection_A" },
          identity: { private: "PRIVATE_CANARY" },
          policy: { permissions: [] },
          tasks: [{ title: "PRIVATE_CANARY" }],
          pending: true,
        },
      ],
    };
    assert.match(JSON.stringify(h.render(false).tasks), /PRIVATE_CANARY/);
    const hidden = h.hide(false);
    assert.equal(hidden.unlocked, false);
    assert.deepEqual(Array.from(hidden.tasks), []);
    assert.doesNotMatch(JSON.stringify(hidden.views), /PRIVATE_CANARY/);
    assert.equal(await hidden.execute(async () => assert.fail("hidden work")), null);
    assert.equal(h.unlocks, 0);
  } finally {
    h.close();
  }
});

test("persistent user-resource synchronization crosses the actual AuthProvider admission without encrypted-service headers", async () => {
  const { stack } = require("./full-flow-boundaries-helpers.cjs");
  const boundary = await stack();
  const account = boundary.mount();
  await account.login("synthetic_persistent_source_owner");
  await waitUntil(
    () => account.value.status === "authenticated" && account.value.agentHubConfigured,
    "actual owner identity and private-service configuration ready",
  );
  const auth = account.value;
  const h = harness(auth);
  try {
    h.render();
    await waitUntil(() => !h.render().busy, "initial workspace discovery settled");
    await assert.rejects(
      auth.requestPrivate("user", "/api/v1/watchlist", auth.sessionKey, {
        headers: { "X-FolioView-Contract": "folioview.agent-workspace.v2.0" },
      }),
      /Invalid private API request/,
    );
    for (const kind of ["watchlist", "channel_follows"]) {
      const item = {
        ref: {
          kind,
          sourceService: "user",
          resourceId: "resource_" + kind,
          incarnation: "incarnation_A",
        },
        sourceEpoch: 1,
        revision: 1,
        state: "ready",
      };
      let prepared = null;
      h.workspace.preparePersistentResource = async (args) => {
        prepared = args;
        return { kind: "no_change" };
      };
      const result = await h.render().execute(async (c) => {
        c.catalogue = async () => ({ groups: [{ items: [item] }] });
        await c.publishResource(
          {
            connectionId: "connection_A",
            clientId: "muse_A",
            vaultId: "vault_A",
            provider: "muse",
            status: "active",
          },
          {},
          item,
        );
        return true;
      });
      assert.equal(result, true, `${kind}: ${h.render().error}`);
      assert.equal(prepared.source.kind, kind);
      assert.equal(
        boundary.browser.filter((x) =>
          x.url.endsWith(kind === "watchlist" ? "/api/v1/watchlist" : "/api/v1/channel-follows"),
        ).length,
        1,
      );
    }
  } finally {
    h.close();
    boundary.close();
  }
});

const retryProbe =
  "/api/v3/agent-credentials/vault_A/connection_A/operations/synthetic_probe_operation_0001";
const admissionDenied = (delay = "60", safe = true) =>
  Response.json(
    { error: { code: "authorization_unavailable" } },
    {
      status: 503,
      headers: {
        "Retry-After": delay,
        ...(safe ? { "X-FolioView-Admission-Retry": "safe" } : {}),
      },
    },
  );

test("vault refreshes before and after a registry append use bounded admission recovery", async () => {
  let attempts = 0,
    appended = false,
    deniedAfterAppend = false,
    approvals = 0;
  const h = harness(undefined, async (path) => {
    if (path.includes("/operations/")) return Response.json({}, { status: 404 });
    if (path.endsWith("/registry")) {
      assert.equal(appended, false);
      appended = true;
      return Response.json({});
    }
    if (
      path.endsWith("/approvals") ||
      (path.includes("/agent-credentials/") && !path.endsWith("/capabilities"))
    ) {
      assert.equal(deniedAfterAppend, true);
      approvals++;
      return Response.json({ acknowledged: true });
    }
    attempts++;
    if (attempts === 1 || (appended && !deniedAfterAppend)) {
      if (appended) deniedAfterAppend = true;
      return admissionDenied("1");
    }
    return Response.json({ vault: { version: appended ? 2 : 1, registryHistory: [] } });
  });
  try {
    h.render();
    await h.settle();
    const refreshes = [];
    h.workspace.refreshVault = async (signal, forState, readCurrent) => {
      assert.equal(typeof readCurrent, "function", "refresh must use action-bound transport");
      const response = await readCurrent();
      assert.equal(signal.aborted, false);
      assert.equal(response.ok, true);
      refreshes.push(forState);
      return (await response.json()).vault;
    };
    h.workspace.finishPersistentPending = async (_actor, receipt) => {
      assert.equal(receipt.acknowledged, true);
    };
    const pending = h.render().execute((c) =>
      c.send(
        {
          connectionId: "connection_A",
          clientId: "client_A",
          vaultId: "vault_A",
          status: "active",
        },
        {
          kind: "credential",
          connectionId: "connection_A",
          operationId: "synthetic_original_operation_0001",
          registryUpdate: { expectedVersion: 1, registryBundle: {} },
          body: { original: "SEALED_APPROVAL" },
        },
      ),
    );
    await waitUntil(() => attempts === 1, "initial refresh admission denial");
    await h.settle();
    assert.equal(h.render().waitingForService, true);
    h.releaseTimer(1000);
    await waitUntil(() => deniedAfterAppend, "post-append refresh admission denial");
    await h.settle();
    assert.equal(h.render().waitingForService, true);
    assert.equal(approvals, 0, "do not submit before the refreshed registry is verified");
    h.releaseTimer(1000);
    assert.equal(await pending, undefined);
    assert.deepEqual(refreshes, [false, true, true]);
    assert.equal(attempts, 6);
    assert.equal(approvals, 1);
    assert.equal(h.unlocks, 0);
  } finally {
    h.close();
  }
});

test("safe admission waits once and retries the exact sealed original within the existing action", async () => {
  let attempts = 0;
  const h = harness(undefined, async () =>
    ++attempts === 1 ? admissionDenied() : Response.json({ accepted: true }),
  );
  try {
    h.render();
    await h.settle();
    const original = { envelope: { ciphertext: "ORIGINAL_SEALED_CANDIDATE" } };
    const result = h.render().execute((_c, api) =>
      api(retryProbe, {
        method: "POST",
        json: original,
        headers: {
          "Idempotency-Key": "synthetic_original_operation_0001",
          "X-FolioView-Contract": "folioview.agent-workspace.v2.0",
        },
      }),
    );
    await waitUntil(() => attempts === 1, "first admission denial");
    await h.settle();
    assert.equal(h.render().waitingForService, true);
    original.envelope.ciphertext = "UNREVIEWED_EDIT";
    h.releaseTimer(60000);
    assert.equal((await result).accepted, true);
    const sent = h.calls.filter((c) => c.path === retryProbe);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].options.json.envelope.ciphertext, "ORIGINAL_SEALED_CANDIDATE");
    assert.deepEqual(sent[1].options.json, sent[0].options.json);
    assert.deepEqual(sent[1].options.headers, sent[0].options.headers);
    assert.equal(
      new Headers(sent[0].options.headers).get("x-folioview-contract"),
      "folioview.agent-workspace.v2.0",
    );
    await h.settle();
    assert.equal(h.render().waitingForService, false);
    assert.equal(h.unlocks, 0);
  } finally {
    h.close();
  }
});

test("hiding during admission cooldown cancels the wait without another request or unlock", async () => {
  let attempts = 0;
  const h = harness(undefined, async () => {
    attempts++;
    return admissionDenied();
  });
  try {
    h.render();
    await h.settle();
    const pending = h.render().execute((_c, api) => api(retryProbe));
    await waitUntil(() => attempts === 1, "first admission denial");
    await h.settle();
    h.hide(true);
    assert.equal(await pending, null);
    assert.equal(attempts, 1);
    assert.equal(h.render().waitingForService, false);
    assert.equal(h.unlocks, 0);
  } finally {
    h.close();
  }
});

test("generic failures, malformed cooldowns and writes without an operation ID never retry", async () => {
  for (const [delay, safe, options] of [
    ["1", false, {}],
    ["0", true, {}],
    ["61", true, {}],
    ["1.5", true, {}],
    ["60", true, { method: "POST", json: { ciphertext: "SEALED" } }],
  ]) {
    let attempts = 0;
    const h = harness(undefined, async () => {
      attempts++;
      return admissionDenied(delay, safe);
    });
    try {
      h.render();
      await h.settle();
      assert.equal(await h.render().execute((_c, api) => api(retryProbe, options)), null);
      assert.equal(attempts, 1);
      await h.settle();
      assert.equal(h.render().waitingForService, false);
    } finally {
      h.close();
    }
  }
});

test("a second admission denial ends the action instead of looping", async () => {
  let attempts = 0;
  const h = harness(undefined, async () => {
    attempts++;
    return admissionDenied();
  });
  try {
    h.render();
    await h.settle();
    const pending = h.render().execute((_c, api) => api(retryProbe));
    await waitUntil(() => attempts === 1, "first admission denial");
    await h.settle();
    h.releaseTimer(60000);
    assert.equal(await pending, null);
    assert.equal(attempts, 2);
    await h.settle();
    assert.equal(h.render().waitingForService, false);
  } finally {
    h.close();
  }
});

test("changing the vault without an owner change masks retained private tasks before effects", async () => {
  const h = harness();
  try {
    h.render();
    await h.settle();
    const state = h.cells.find((c) => c?.value && Array.isArray(c.value.views));
    state.value = {
      ...state.value,
      scope: "owner_A:login1:vault_A:1",
      tasks: [{ title: "PRIVATE_CANARY" }],
    };
    assert.match(JSON.stringify(h.render(false).tasks), /PRIVATE_CANARY/);
    h.workspace.vault = { vaultId: "vault_B" };
    assert.doesNotMatch(JSON.stringify(h.render(false).tasks), /PRIVATE_CANARY/);
  } finally {
    h.close();
  }
});

test("initial display remains pending until the single complete snapshot is verified", async () => {
  const pending = [];
  const h = harness(
    null,
    null,
    (path, options) => new Promise((resolve) => pending.push({ path, options, resolve })),
  );
  try {
    assert.equal(h.render(false).loaded, false);
    assert.equal(h.render(false).displayState, "loading");
    const model = h.render();
    assert.equal(model.loading, true);
    assert.equal(model.loaded, false);
    await tick();
    assert.equal(pending.length, 1);
    assert.ok(pending[0].path.endsWith("/display"));
    assert.equal(pending[0].options.coalesceDisplay, true);
    pending[0].resolve(Response.json(displayBody(summaryBody([]))));
    const complete = await h.settle();
    assert.equal(complete.loaded, true);
    assert.equal(complete.loading, false);
    assert.equal(complete.loadError, false);
    assert.equal(complete.displayState, "ready");
    assert.equal(h.calls.length, 1);
  } finally {
    h.close();
  }
});
test("failed discovery stays unknown and failed refresh retains the prior snapshot", async () => {
  let failed = true;
  const h = harness(null, null, () =>
    Promise.resolve(
      failed ? Response.json({}, { status: 503 }) : Response.json(displayBody(summaryBody([]))),
    ),
  );
  try {
    h.render();
    let model = await h.settle();
    assert.equal(model.loadError, true);
    assert.equal(model.loaded, false);
    failed = false;
    await model.reload();
    model = h.render();
    assert.equal(model.loaded, true);
    assert.equal(model.loadError, false);
    const state = h.cells.find((c) => c?.value && Array.isArray(c.value.views));
    const previous = { connection: { connectionId: "previous" }, tasks: [] };
    state.value = { ...state.value, views: [previous] };
    failed = true;
    await h.render().reload();
    model = h.render();
    assert.equal(model.loadError, true);
    assert.equal(model.loaded, true);
    assert.equal(model.views[0], previous);
    assert.equal(model.displayState, "error");
  } finally {
    h.close();
  }
});
test("old display discovery cannot publish into a new Owner generation", async () => {
  const pending = [];
  const h = harness(null, null, () => new Promise((resolve) => pending.push(resolve)));
  try {
    h.render();
    await tick();
    h.setOwner("owner_A:login2", false);
    assert.notEqual(h.render(false).displayState, "ready");
    pending[0](Response.json(displayBody(summaryBody([]))));
    await tick();
    let model = h.render(false);
    assert.equal(model.loaded, false);
    assert.equal(model.loadError, false);
    h.render();
    await tick();
    assert.equal(pending.length, 2);
    pending[1](Response.json(displayBody(summaryBody([]))));
    model = await h.settle();
    assert.equal(model.loaded, true);
    assert.equal(model.loadError, false);
  } finally {
    h.close();
  }
});

const connection = (n) => ({
  connectionId: `connection_${n}`,
  clientId: `client_${n}`,
  vaultId: "vault_A",
  provider: n % 2 ? "muse" : "chatgpt",
  status: "active",
  accountState: "connected",
  linkedAt: 1000,
});
const C = "folioview.agent-workspace.v2.0";
const fingerprint = (n) => n.toString(16).padStart(64, "0");
const signed = { protected: "YQ", payload: "Yg", signature: "Yw" };
function summaryBody(connections, generation = 1, slotted = true) {
  const providers = Object.fromEntries(
    ["muse", "chatgpt"].map((provider) => {
      const current = connections.find((c) => c.provider === provider);
      const ref = current
        ? {
            connectionId: current.connectionId,
            clientId: current.clientId,
            credentialGeneration: generation,
            credentialFingerprint: fingerprint(generation),
          }
        : null;
      return [
        provider,
        {
          contractVersion: C,
          profile: "folioview.provider-connection-slot.v1",
          slot:
            slotted && current
              ? {
                  contractVersion: C,
                  profile: "folioview.provider-connection-slot.v1",
                  ownerSubject: "owner_A",
                  vaultId: "vault_A",
                  provider,
                  slotId: "slot_" + provider,
                  slotVersion: generation,
                  slotGeneration: generation,
                  currentCredential: ref,
                  lastCredential: ref,
                }
              : null,
          retainedSelections: [],
          retirementCandidates: [],
          legacyBlockers: [],
          requiresFreshGrants: true,
        },
      ];
    }),
  );
  const credentials = connections
    .filter(
      (c) =>
        c.status === "active" &&
        c.vaultId === "vault_A" &&
        (!providers[c.provider].slot ||
          providers[c.provider].slot.currentCredential.connectionId === c.connectionId),
    )
    .map((c) => ({
      connectionId: c.connectionId,
      state: {
        contractVersion: C,
        profile: "folioview.agent-credential.v1",
        identity: {
          ownerSubject: "owner_A",
          vaultId: c.vaultId,
          connectionId: c.connectionId,
          clientId: c.clientId,
        },
        binding: signed,
        lease: {
          ownerSubject: "owner_A",
          vaultId: c.vaultId,
          connectionId: c.connectionId,
          clientId: c.clientId,
          generation,
          credentialFingerprint: fingerprint(generation),
        },
        approval: signed,
        status: "active",
        defaultValiditySeconds: 7776000,
        noticeSeconds: 604800,
      },
    }));
  return {
    contractVersion: C,
    profile: "folioview.provider-connection-summary.v1",
    vaultId: "vault_A",
    connections,
    providers,
    credentials,
  };
}
const discovery =
  (connections, generation = 1, slotted = true) =>
  (path) =>
    Promise.resolve(
      Response.json(
        path.endsWith("/display")
          ? displayBody(summaryBody(connections, generation, slotted))
          : path.endsWith("/summary")
            ? summaryBody(connections, generation, slotted)
            : {
                accountLinkEnabled: true,
                enabled: true,
                resourceConsentEnabled: true,
                executionEnabled: true,
              },
      ),
    );
const credentialResponse = (generation = 1) =>
  Response.json({
    lease: { generation, credentialFingerprint: `fingerprint_${generation}` },
    identity: { binding: "synthetic" },
  });
function installVerifier(h) {
  h.workspace.inspectAgentCredential = async () => ({ status: "active", expiresAt: 2000000000 });
  h.workspace.loadPersistentPending = async () => null;
}

test("summary verification is bounded to two and never opens task content, policies or plans", async () => {
  const pending = [],
    journals = [];
  const h = harness(
    null,
    null,
    discovery(
      Array.from({ length: 6 }, (_, n) => connection(n + 1)),
      1,
      false,
    ),
    (path) => {
      assert.doesNotMatch(path, /\/tasks|resource-consent|persistent-plans|resource-operations/);
    },
  );
  installVerifier(h);
  h.workspace.inspectAgentCredential = (options) =>
    new Promise((resolve) => pending.push({ resolve, options }));
  h.workspace.loadPersistentPending = async (actor) => {
    journals.push(actor.connectionId);
    return null;
  };
  try {
    h.render();
    await h.settle();
    assert.equal(pending.length, 2);
    assert.equal(h.render().busy, false, "display reads do not occupy the mutation lane");
    for (let offset = 0; offset < 6; offset += 2) {
      assert.equal(h.render().loaded, false);
      pending
        .slice(offset, offset + 2)
        .forEach((p) => p.resolve({ status: "active", expiresAt: 2000000000 }));
      await h.settle();
      assert.equal(pending.length, Math.min(offset + 4, 6));
    }
    const m = h.render();
    assert.equal(m.loaded, true);
    assert.equal(m.views.length, 6);
    assert.equal(journals.length, 6);
    assert.equal(new Set(journals).size, 6, "one pending-journal read per connection");
    assert.equal(m.tasks.length, 0);
    assert.equal(m.providerStates.muse.slot, null);
    assert.equal(h.calls.filter((c) => c.path.endsWith("/display")).length, 1);
    assert.ok(
      !h.calls.some((c) => /persistent-connections|agent-credentials\/vault_A/.test(c.path)),
    );
  } finally {
    h.close();
  }
});

test("credential and provider slot refresh publish atomically and transport failure retains their pair", async () => {
  let generation = 1,
    fail = false;
  const h = harness(null, null, (path) =>
    fail && path.endsWith("/display")
      ? Promise.resolve(Response.json({}, { status: 503 }))
      : discovery([connection(1)], generation)(path),
  );
  installVerifier(h);
  try {
    h.render();
    await h.settle();
    const previous = h.render();
    assert.equal(previous.loaded, true);
    generation = 2;
    fail = true;
    assert.equal(await previous.reload(), null);
    let m = h.render();
    assert.equal(m.loadError, true);
    assert.equal(m.loaded, true);
    assert.equal(m.views, previous.views);
    assert.equal(m.providerStates, previous.providerStates);
    assert.equal(m.views[0].credential.reference.credentialGeneration, 1);
    fail = false;
    assert.equal(await m.reload(), true);
    m = h.render();
    assert.equal(m.loadError, false);
    assert.equal(m.views[0].credential.reference.credentialGeneration, 2);
    assert.equal(m.providerStates.muse.slot.currentCredential.credentialGeneration, 2);
  } finally {
    h.close();
  }
});

test("unrelated routes start no Agent reads and revisiting retains a fresh verified snapshot", async () => {
  const h = harness(null, null, discovery([]));
  try {
    h.setActive(false);
    await h.settle();
    assert.equal(h.calls.length, 0);
    h.setActive(true);
    await h.settle();
    const m = h.render(),
      count = h.calls.length;
    assert.equal(m.loaded, true);
    h.setActive(false);
    h.setActive(true);
    await h.settle();
    assert.equal(h.render().loaded, true);
    assert.equal(h.calls.length, count);
    assert.equal(h.render().providerStates, m.providerStates);
  } finally {
    h.close();
  }
});

test("leaving a pending display read cancels it without a failure or late publication", async () => {
  const pending = [];
  const h = harness(
    null,
    null,
    (_p, options) => new Promise((resolve) => pending.push({ resolve, options })),
  );
  try {
    h.render();
    await tick();
    h.setActive(false);
    await h.settle();
    assert.ok(pending.every((p) => p.options.signal.aborted));
    assert.equal(h.render().loading, false);
    assert.equal(h.render().loadError, false);
    pending.forEach((p) => p.resolve(Response.json({ connections: [] })));
    await h.settle();
    assert.equal(h.render().loaded, false);
  } finally {
    h.close();
  }
});

test("a write preempts display reads and late display responses cannot overwrite its state", async () => {
  const pending = [];
  const h = harness(
    null,
    async () => Response.json({ accepted: true }),
    (_p, options) => new Promise((resolve) => pending.push({ resolve, options })),
  );
  try {
    h.render();
    await tick();
    const result = await h
      .render()
      .execute((_c, api) => api(retryProbe, { method: "POST", json: { sealed: "original" } }));
    assert.equal(result.accepted, true);
    assert.ok(pending.every((p) => p.options.signal.aborted));
    pending.forEach((p) => p.resolve(Response.json({ connections: [] })));
    await h.settle();
    assert.equal(h.render().loaded, false);
    assert.equal(h.render().loadError, false);
    assert.equal(h.calls.filter((c) => c.path === retryProbe).length, 1);
  } finally {
    h.close();
  }
});

test("display deadlines settle ignored cancellation instead of leaving the UI pending forever", async () => {
  const pending = [];
  const h = harness(
    null,
    null,
    (_p, options) => new Promise((resolve) => pending.push({ resolve, options })),
  );
  try {
    h.render();
    await tick();
    h.releaseTimer(14000);
    await h.settle();
    assert.equal(h.render().loading, false);
    assert.equal(h.render().loadError, true);
    assert.equal(h.render().busy, false);
    pending.forEach((p) => p.resolve(Response.json({ connections: [] })));
    await h.settle();
    assert.equal(h.render().loaded, false);
    assert.equal(h.render().loadError, true);
  } finally {
    h.close();
  }
});

test("an unknown write deadline releases its UI lane without retrying or clearing the sealed original", async () => {
  let release,
    calls = 0;
  const h = harness(
    null,
    () => {
      calls++;
      return new Promise((r) => {
        release = r;
      });
    },
    discovery([]),
  );
  const sealed = {
    operationId: "synthetic_original_operation_0001",
    ciphertext: "SEALED_ORIGINAL",
  };
  h.workspace.pending = sealed;
  try {
    h.render();
    await h.settle();
    let committed = false;
    const pending = h.render().execute(async (_c, api) => {
      await api(retryProbe, {
        method: "POST",
        json: sealed,
        headers: { "Idempotency-Key": sealed.operationId },
      });
      committed = true;
      return true;
    });
    await tick();
    h.releaseTimer(120000);
    assert.equal(await pending, null);
    await h.settle();
    assert.equal(h.render().busy, false);
    assert.equal(h.render().error, "request_failed");
    assert.equal(h.workspace.pending, sealed);
    release(Response.json({ accepted: true }));
    await h.settle();
    assert.equal(committed, false);
    assert.equal(calls, 1);
    assert.equal(h.workspace.pending, sealed);
  } finally {
    h.close();
  }
});

const selectedMetadata = {
  contractVersion: "folioview.agent-workspace.v2.0",
  vaultId: "vault_A",
  taskId: "task_selected",
  taskVersion: 1,
  executionEpoch: 1,
  status: "active",
  resourceBindings: [],
  objectRevision: 1,
  deliveryRevision: 1,
  envelopeFingerprint: "a".repeat(64),
  keyEpoch: 1,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};
test("legacy details read only the selected exact task and never scan other tasks or plans", async () => {
  const h = harness(
    null,
    () => Promise.resolve(credentialResponse()),
    discovery([connection(1)]),
    (path) =>
      path === "/api/v2/tasks/task_selected"
        ? Promise.resolve(Response.json({ metadata: selectedMetadata }))
        : path.endsWith("/tasks/task_selected/authority")
          ? Promise.resolve(
              Response.json({ authority: { context: { connectionId: "connection_1" } } }),
            )
          : undefined,
  );
  installVerifier(h);
  let opened = 0;
  h.workspace.openTask = async () => {
    opened++;
    return { name: "Selected private task" };
  };
  try {
    h.render();
    await h.settle();
    assert.equal(opened, 0);
    assert.equal(await h.render().loadTask(selectedMetadata), true);
    const m = h.render();
    assert.equal(opened, 1);
    assert.equal(m.tasks[0].title, "Selected private task");
    assert.equal(m.views[0].tasks[0].taskId, "task_selected");
    assert.equal(m.loaded, true);
    assert.ok(!h.calls.some((c) => /\/tasks\?|persistent-plans|resource-consent/.test(c.path)));
    assert.equal(await m.loadTask({ ...selectedMetadata, vaultId: "foreign_vault" }), false);
    assert.equal(opened, 1);
  } finally {
    h.close();
  }
});
test("deleting a task fences a non-cooperative selected-task read against resurrection", async () => {
  let release;
  const h = harness(null, null, discovery([]), (path) =>
    path === "/api/v2/tasks/task_selected"
      ? new Promise((r) => {
          release = r;
        })
      : undefined,
  );
  h.workspace.openTask = async () => assert.fail("deleted task must not be decrypted");
  try {
    h.render();
    await h.settle();
    const pending = h.render().loadTask(selectedMetadata);
    await tick();
    h.render().invalidateTask("task_selected");
    assert.equal(await pending, false);
    release(Response.json({ metadata: selectedMetadata }));
    await h.settle();
    assert.equal(h.render().tasks.length, 0);
  } finally {
    h.close();
  }
});

test("a current provider slot verifies only its two exact connections despite thirty historical rows", async () => {
  const credentialReads = [];
  const h = harness(null, null, discovery(Array.from({ length: 32 }, (_, n) => connection(n + 1))));
  installVerifier(h);
  h.workspace.inspectAgentCredential = async ({ actor }) => {
    credentialReads.push(actor.connectionId);
    return { status: "active", expiresAt: 2000000000 };
  };
  try {
    h.render();
    await h.settle();
    assert.equal(h.render().loaded, true);
    assert.equal(credentialReads.length, 2);
    assert.equal(h.render().views.filter((v) => v.credential).length, 2);
    assert.equal(h.render().views.filter((v) => !v.credential).length, 30);
    assert.ok(credentialReads.includes("connection_1"));
    assert.ok(credentialReads.includes("connection_2"));
  } finally {
    h.close();
  }
});

test("the display lane cannot forward a write", async () => {
  const h = harness(null, null, discovery([]));
  try {
    h.render();
    await h.settle();
    assert.equal(
      await h
        .render()
        .execute((_c, api) => api(retryProbe, { method: "POST", json: {} }), true, true),
      null,
    );
    assert.equal(h.calls.filter((c) => c.path === retryProbe).length, 0);
  } finally {
    h.close();
  }
});

test("a malformed composition never starts crypto or replaces the prior verified pair", async () => {
  let mutate = () => {},
    checks = 0;
  const h = harness(null, null, (path) => {
    if (!path.endsWith("/display")) return discovery([])(path);
    const body = summaryBody([connection(1)]);
    mutate(body);
    return Promise.resolve(Response.json(displayBody(body)));
  });
  installVerifier(h);
  h.workspace.inspectAgentCredential = async () => {
    checks++;
    return { status: "active", expiresAt: 2000000000 };
  };
  try {
    h.render();
    await h.settle();
    const previous = h.render();
    assert.equal(previous.loaded, true);
    assert.equal(checks, 1);
    for (const change of [
      (v) => v.credentials.pop(),
      (v) => v.credentials.push(structuredClone(v.credentials[0])),
      (v) => (v.credentials[0].connectionId = "foreign_connection"),
      (v) => (v.credentials[0].state.identity.vaultId = "foreign_vault"),
      (v) => (v.providers.muse.slot.currentCredential.credentialGeneration = 2),
      (v) => (v.providers.muse.slot.currentCredential.credentialFingerprint = fingerprint(2)),
      (v) =>
        v.providers.muse.retainedSelections.push({ taskId: "task_A", privateKey: "FORBIDDEN" }),
      (v) => v.connections.push(connection(1)),
      (v) => v.connections.push(...Array.from({ length: 32 }, (_, i) => connection(i + 2))),
    ]) {
      mutate = change;
      assert.equal(await h.render().reload(), null);
      const current = h.render();
      assert.equal(current.loadError, true);
      assert.equal(current.views, previous.views);
      assert.equal(current.providerStates, previous.providerStates);
      assert.equal(checks, 1);
    }
  } finally {
    h.close();
  }
});

test("a failed original credential signature keeps all prior views and slots together", async () => {
  let failed = false,
    generation = 1;
  const h = harness(null, null, (path) =>
    discovery([connection(1), connection(2)], generation, false)(path),
  );
  installVerifier(h);
  h.workspace.inspectAgentCredential = async ({ actor }) => {
    if (failed && actor.connectionId === "connection_2") throw new Error("invalid_signature");
    return { status: "active", expiresAt: 2000000000 };
  };
  try {
    h.render();
    await h.settle();
    const previous = h.render();
    assert.equal(previous.loaded, true);
    failed = true;
    generation = 2;
    assert.equal(await previous.reload(), null);
    const current = h.render();
    assert.equal(current.loadError, true);
    assert.equal(current.views, previous.views);
    assert.equal(current.providerStates, previous.providerStates);
    assert.equal(current.views[0].credential.reference.credentialGeneration, 1);
  } finally {
    h.close();
  }
});

test("slow crypto still obeys the original display deadline and cannot publish late", async () => {
  const pending = [];
  const h = harness(null, null, discovery([connection(1), connection(2), connection(3)], 1, false));
  installVerifier(h);
  h.workspace.inspectAgentCredential = () => new Promise((resolve) => pending.push(resolve));
  try {
    h.render();
    await h.settle();
    assert.equal(pending.length, 2);
    assert.equal(h.render().displayState, "loading");
    h.releaseTimer(14000);
    await h.settle();
    assert.equal(h.render().loadError, true);
    assert.equal(h.render().displayState, "error");
    pending.forEach((resolve) => resolve({ status: "active", expiresAt: 2000000000 }));
    await h.settle();
    assert.equal(h.render().loaded, false);
    assert.equal(pending.length, 2);
  } finally {
    h.close();
  }
});

test("foreign-vault blockers and revoked native history remain visible without credential authority", async () => {
  const current = connection(1),
    foreign = { ...connection(2), vaultId: "foreign_vault" },
    revoked = { ...connection(3), status: "revoked", accountState: "revoked" };
  const h = harness(null, null, (path) => {
    if (!path.endsWith("/display")) return discovery([])(path);
    const body = summaryBody([current, foreign, revoked], 1, false);
    body.providers.chatgpt.legacyBlockers = [foreign.connectionId];
    return Promise.resolve(Response.json(displayBody(body)));
  });
  installVerifier(h);
  const checked = [];
  h.workspace.inspectAgentCredential = async ({ actor }) => {
    checked.push(actor.connectionId);
    return { status: "active", expiresAt: 2000000000 };
  };
  try {
    h.render();
    await h.settle();
    const model = h.render();
    assert.equal(model.loaded, true);
    assert.equal(model.views.length, 3);
    assert.deepEqual(checked, [current.connectionId]);
    assert.equal(model.views[1].credential, null);
    assert.equal(model.views[2].credential, null);
    assert.equal(model.providerStates.chatgpt.legacyBlockers[0], foreign.connectionId);
    assert.equal(h.calls.filter((c) => c.path.endsWith("/display")).length, 1);
  } finally {
    h.close();
  }
});

test("complete display forwards its unchanged vault to the existing refresher before credential verification", async () => {
  const events = [],
    h = harness(null, null, discovery([connection(1)]));
  installVerifier(h);
  h.workspace.refreshVault = async (signal, forState, read) => {
    assert.equal(forState, false);
    assert.equal(signal.aborted, false);
    assert.equal(typeof read, "function");
    const r = await read();
    const body = await r.json();
    assert.equal(body.vault.vaultId, "vault_A");
    assert.equal(body.vault.registryHistory.length, 1);
    events.push("vault-refresher");
    return h.workspace.vault;
  };
  h.workspace.inspectAgentCredential = async () => {
    assert.equal(events[0], "vault-refresher");
    events.push("credential-worker");
    return { status: "active", expiresAt: 2000000000 };
  };
  try {
    h.render();
    await h.settle();
    assert.equal(h.render().loaded, true);
    assert.deepEqual(events, ["vault-refresher", "credential-worker"]);
    assert.equal(h.calls.length, 1);
    assert.ok(h.calls[0].path.endsWith("/display"));
  } finally {
    h.close();
  }
});

test("separate is only a hint and performs the original fresh vault capabilities and summary reads", async () => {
  const h = harness(
    null,
    () => Promise.resolve(Response.json({ vault: { vaultId: "vault_A" } })),
    (path) =>
      path.endsWith("/display")
        ? Promise.resolve(Response.json(displayBody(summaryBody([connection(1)]), "separate")))
        : discovery([connection(1)])(path),
  );
  installVerifier(h);
  let refreshed = false;
  h.workspace.refreshVault = async (_signal, _forState, read) => {
    const r = await read();
    assert.ok((await r.json()).vault);
    refreshed = true;
    return h.workspace.vault;
  };
  h.workspace.inspectAgentCredential = async () => {
    assert.equal(refreshed, true);
    return { status: "active", expiresAt: 2000000000 };
  };
  try {
    h.render();
    await h.settle();
    assert.equal(h.render().loaded, true);
    assert.equal(h.calls.length, 6);
    assert.equal(h.calls.filter((c) => c.path.endsWith("/display")).length, 1);
    assert.equal(h.calls.filter((c) => c.path === "/api/v2/vaults/current").length, 1);
    assert.equal(h.calls.filter((c) => c.path.endsWith("/capabilities")).length, 3);
    assert.equal(h.calls.filter((c) => c.path.endsWith("/summary")).length, 1);
  } finally {
    h.close();
  }
});

test("vault rejection or partial display never verifies credentials or replaces the prior pair", async () => {
  let fail = false,
    partial = false;
  const h = harness(null, null, (path) => {
    if (!path.endsWith("/display")) return discovery([])(path);
    const value = displayBody(summaryBody([connection(1)]));
    if (partial) value.summary = null;
    return Promise.resolve(Response.json(value));
  });
  installVerifier(h);
  let checks = 0;
  h.workspace.inspectAgentCredential = async () => {
    checks++;
    return { status: "active", expiresAt: 2000000000 };
  };
  h.workspace.refreshVault = async () => {
    if (fail) throw Error("rollback_detected");
    return h.workspace.vault;
  };
  try {
    h.render();
    await h.settle();
    const old = h.render();
    assert.equal(old.loaded, true);
    assert.equal(checks, 1);
    fail = true;
    assert.equal(await old.reload(), null);
    assert.equal(h.render().views, old.views);
    assert.equal(checks, 1);
    fail = false;
    partial = true;
    assert.equal(await h.render().reload(), null);
    assert.equal(h.render().providerStates, old.providerStates);
    assert.equal(checks, 1);
  } finally {
    h.close();
  }
});

test("display streams keep the original one MiB ceiling and cancel before parsing or Worker work", async () => {
  let cancelled = false,
    refreshes = 0;
  const h = harness(null, null, () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(1048577));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  h.workspace.refreshVault = async () => {
    refreshes++;
    return h.workspace.vault;
  };
  try {
    h.render();
    await h.settle();
    assert.equal(h.render().loaded, false);
    assert.equal(h.render().loadError, true);
    assert.equal(cancelled, true);
    assert.equal(refreshes, 0);
  } finally {
    h.close();
  }
});
