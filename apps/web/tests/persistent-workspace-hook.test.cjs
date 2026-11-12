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
function harness(authOverride, ownerRequest) {
  let owner = authOverride?.sessionKey ?? "owner_A:login1",
    visible = true,
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
      if (!cells[n] || changed(cells[n].deps, deps)) effects.push({ n, f, deps });
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
    if (
      ownerRequest &&
      (path.includes("/operations/") ||
        path === "/api/v2/vaults/current" ||
        path.endsWith("/registry") ||
        path.endsWith("/approvals"))
    )
      return ownerRequest(path, options);
    return Response.json(
      path.endsWith("/persistent-connections")
        ? { connections: [] }
        : path.includes("persistent-agents")
          ? { enrollmentEnabled: false, resourceConsentEnabled: false, executionEnabled: false }
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
      scope: "owner_A:login1:1",
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
    if (path.endsWith("/approvals")) {
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
