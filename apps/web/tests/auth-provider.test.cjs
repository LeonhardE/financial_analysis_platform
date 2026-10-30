const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const { contracts: resourceContracts } = require("./resource-library-helpers.cjs");
const {
  contracts: connectionContracts,
  compile: compileAgent,
} = require("./agent-connections-helpers.cjs");
const ownerBridgeCommands = compileAgent("../lib/owner-consent-bridge.ts", {
  "./agent-connections": connectionContracts,
});

// Exercise the actual provider's asynchronous SDK/API boundary without a browser or
// an extra test framework. React rendering and Firebase are isolated at imports.
const source = readFileSync(path.join(__dirname, "../components/AuthProvider.tsx"), "utf8");
const { code } = transformSync(source, {
  filename: "AuthProvider.tsx",
  jsc: {
    parser: { syntax: "typescript", tsx: true },
    target: "es2022",
    transform: { react: { runtime: "automatic" } },
  },
  module: { type: "commonjs" },
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function user(uid) {
  return { uid, getIdToken: async () => `test-token-${uid}` };
}

function profileResponse(uid) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ uid, email: `${uid}@example.com`, displayName: uid, photoURL: null }),
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function configResponse(portfolio = true, agentHub = false) {
  return new Response(JSON.stringify({ schemaVersion: 1, flags: { portfolio, agentHub } }), {
    headers: { "Content-Type": "application/json" },
  });
}

function mountProvider({
  logout = async () => {},
  fetchProfile = async () => profileResponse("a"),
  fetchOwnerConfig = async () => configResponse(),
  env = {},
  hostname = "folioview.example.test",
  fetchLinkConfig = async () => ({
    schemaVersion: 1,
    enabled: true,
    hubOrigin: "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
  }),
} = {}) {
  let observer;
  let observerError;
  let index = 0;
  let dirty = false;
  let mounted = true;
  const effects = [];
  const cells = [];
  const requests = [];
  const configRequests = [];
  const timers = new Map();
  let timerId = 0;
  const auth = { currentUser: null };
  const changed = (before, after) =>
    !before || after.some((value, position) => value !== before[position]);
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useState: (initial) => {
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
    useRef: (current) => {
      const slot = index++;
      cells[slot] ??= { current };
      return cells[slot];
    },
    useCallback: (callback, dependencies) => {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].dependencies, dependencies))
        cells[slot] = { value: callback, dependencies };
      return cells[slot].value;
    },
    useMemo: (callback, dependencies) => {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].dependencies, dependencies))
        cells[slot] = { value: callback(), dependencies };
      return cells[slot].value;
    },
    useEffect: (effect, dependencies) => {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].dependencies, dependencies))
        effects.push({ slot, effect, dependencies });
    },
  };
  const firebase = {
    onIdTokenChanged: (_auth, next, error) => {
      observer = next;
      observerError = error;
      return () => {};
    },
    signOut: logout,
    signInWithPopup: async () => {},
    GoogleAuthProvider: class {
      setCustomParameters() {}
    },
  };
  const module = { exports: {} };
  const imports = {
    react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "firebase/auth": firebase,
    "@/lib/firebase-client": { getBrowserAuth: () => auth },
    "@/lib/resource-library": resourceContracts,
    "@/lib/agent-link": { loadAgentLinkConfiguration: fetchLinkConfig },
    "@/lib/owner-consent-bridge": {
      validateConsentCommand: ownerBridgeCommands.validateConsentCommand,
      verifiedOwnerBridge: (bridge) => bridge?.testVerifiedOwnerBridge === true && bridge.isLive(),
    },
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected test import ${name}`);
      return imports[name];
    },
    process: { env },
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    window: {
      location: { hostname },
      setTimeout: (callback, milliseconds) => {
        timers.set(++timerId, { callback, milliseconds });
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    fetch: (...args) => {
      if (args[0] === "/api/private/owner-config") {
        configRequests.push(args);
        return fetchOwnerConfig(...args);
      }
      requests.push(args);
      return fetchProfile(...args);
    },
  });
  function render() {
    assert.equal(mounted, true);
    let tree;
    do {
      dirty = false;
      index = 0;
      tree = module.exports.AuthProvider({ children: null });
      for (const { slot, effect, dependencies } of effects.splice(0)) {
        cells[slot]?.cleanup?.();
        cells[slot] = { dependencies, cleanup: effect() };
      }
    } while (dirty);
    return tree.props.value;
  }
  render();
  return {
    get actions() {
      return render();
    },
    auth,
    requests,
    configRequests,
    state: render,
    emitUser: (next) => {
      auth.currentUser = next;
      observer(next);
    },
    emitError: () => observerError(new Error("Observer unavailable")),
    expireConfig: () => {
      const timer = [...timers.values()].find((item) => item.milliseconds === 5_000);
      assert.ok(timer, "owner config timeout exists");
      timer.callback();
    },
    unmount: () => {
      mounted = false;
      cells.forEach((cell) => cell.cleanup?.());
    },
  };
}

test("a token refresh cannot restore an identity while sign-out is pending", async () => {
  const logout = deferred();
  const harness = mountProvider({ logout: () => logout.promise });
  const account = user("a");
  harness.emitUser(account);
  await settle();
  assert.equal(harness.state().profile.uid, "a");

  const signingOut = harness.actions.signOut();
  assert.equal(harness.state().profile, null);
  harness.emitUser(account);
  harness.emitError();
  await settle();
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.state().status, "signing-out");
  assert.equal(harness.state().profile, null);

  harness.emitUser(null);
  assert.equal(harness.state().status, "anonymous");
  logout.resolve();
  await signingOut;
  assert.equal(harness.state().profile, null);

  harness.emitUser(account);
  await settle();
  assert.equal(harness.state().profile.uid, "a");
  assert.equal(harness.requests.length, 2);
});

test("a delayed response from a previous account cannot replace the current account", async () => {
  const first = deferred();
  const second = deferred();
  const responses = [first, second];
  const harness = mountProvider({ fetchProfile: () => responses.shift().promise });
  harness.emitUser(user("a"));
  await settle();
  assert.equal(harness.state().profile, null);
  harness.emitUser(user("b"));
  await settle();
  second.resolve(profileResponse("b"));
  await settle();
  assert.equal(harness.state().profile.uid, "b");

  // Deliberately allow a response despite abort, as can happen during body parsing.
  first.resolve(profileResponse("a"));
  await settle();
  assert.equal(harness.state().profile.uid, "b");
  assert.equal(harness.requests[0][1].signal.aborted, true);
});

test("failed sign-out keeps identity hidden and retries the SDK's current account", async () => {
  const harness = mountProvider({
    logout: async () => {
      throw new Error("Sign-out failed");
    },
    fetchProfile: async (_url, options) =>
      profileResponse(options.headers.Authorization.endsWith("-b") ? "b" : "a"),
  });
  harness.emitUser(user("a"));
  await settle();
  let refreshed = false;
  harness.auth.currentUser = {
    uid: "b",
    getIdToken: async (forceRefresh) => {
      refreshed = forceRefresh;
      return "test-token-b";
    },
  };
  await harness.actions.signOut();
  assert.equal(harness.state().status, "error");
  assert.equal(harness.state().profile, null);

  await harness.actions.retry();
  assert.equal(refreshed, true);
  assert.equal(harness.state().profile.uid, "b");
});

test("private requests use a fresh SDK token, fixed API route, and no credential storage", async () => {
  let tokens = 0;
  const account = { uid: "a", getIdToken: async () => `fresh-token-${++tokens}` };
  const harness = mountProvider();
  harness.emitUser(account);
  await settle();
  await harness.actions.requestPrivate("user", "/api/v1/watchlist/NFLX", "a:1", { method: "PUT" });
  assert.equal(tokens, 2);
  const [url, options] = harness.requests[1];
  assert.match(url, /\/api\/v1\/watchlist\/NFLX$/);
  assert.equal(options.headers.Authorization, "Bearer fresh-token-2");
  assert.equal(options.method, "PUT");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  await assert.rejects(
    harness.actions.requestPrivate("user", "https://example.com/api/v1/watchlist", "a:1"),
    /Invalid private API path/,
  );
  assert.equal(harness.requests.length, 2);
});

test("profile, watchlist and preferences use only their configured service origins", async () => {
  const harness = mountProvider({
    env: {
      NEXT_PUBLIC_API_BASE_URL: "https://market.example.com",
      NEXT_PUBLIC_USER_API_BASE_URL: "https://user.example.com",
      NEXT_PUBLIC_CONFIG_API_BASE_URL: "https://config.example.com",
    },
  });
  harness.emitUser(user("a"));
  await settle();
  await harness.actions.requestPrivate("user", "/api/v1/watchlist", "a:1");
  await harness.actions.requestPrivate("config", "/api/v1/preferences", "a:1");
  assert.deepEqual(
    harness.requests.map(([url]) => url),
    [
      "https://user.example.com/api/v1/me",
      "https://user.example.com/api/v1/watchlist",
      "https://config.example.com/api/v1/preferences",
    ],
  );
  assert.ok(
    harness.requests.every(
      ([, options]) =>
        options.cache === "no-store" &&
        options.credentials === "omit" &&
        options.headers.Authorization === "Bearer test-token-a",
    ),
  );
});

test("each omitted service origin independently retains the legacy API during migration", async () => {
  for (const [env, userOrigin, configOrigin] of [
    [{}, "http://localhost:8000", "http://localhost:8000"],
    [
      {
        NEXT_PUBLIC_API_BASE_URL: "https://legacy.example.com",
        NEXT_PUBLIC_USER_API_BASE_URL: "",
        NEXT_PUBLIC_CONFIG_API_BASE_URL: "",
      },
      "https://legacy.example.com",
      "https://legacy.example.com",
    ],
    [
      {
        NEXT_PUBLIC_API_BASE_URL: "https://legacy.example.com",
        NEXT_PUBLIC_USER_API_BASE_URL: "https://user.example.com",
      },
      "https://user.example.com",
      "https://legacy.example.com",
    ],
    [
      {
        NEXT_PUBLIC_API_BASE_URL: "https://legacy.example.com",
        NEXT_PUBLIC_CONFIG_API_BASE_URL: "https://config.example.com",
      },
      "https://legacy.example.com",
      "https://config.example.com",
    ],
  ]) {
    const harness = mountProvider({ env });
    harness.emitUser(user("a"));
    await settle();
    await harness.actions.requestPrivate("user", "/api/v1/watchlist", "a:1");
    await harness.actions.requestPrivate("config", "/api/v1/preferences", "a:1");
    assert.deepEqual(
      harness.requests.map(([url]) => url),
      [
        `${userOrigin}/api/v1/me`,
        `${userOrigin}/api/v1/watchlist`,
        `${configOrigin}/api/v1/preferences`,
      ],
    );
  }
});

test("a private route cannot send a token to another domain's service", async () => {
  let tokens = 0;
  const harness = mountProvider();
  harness.emitUser({ uid: "a", getIdToken: async () => `token-${++tokens}` });
  await settle();
  for (const [service, path] of [
    ["user", "/api/v1/preferences"],
    ["config", "/api/v1/watchlist"],
    ["config", "/api/v1/watchlist/AAPL"],
    ["market", "/api/v1/watchlist"],
    ["config", "/api/v1/me"],
    ["user", "//other.example.com/api/v1/watchlist"],
  ]) {
    await assert.rejects(
      harness.actions.requestPrivate(service, path, "a:1"),
      /Invalid private API path/,
    );
  }
  assert.equal(tokens, 1);
  assert.equal(harness.requests.length, 1);
});

test("service failures never retry a token or write against the legacy API", async () => {
  for (const failWith of [
    () => ({ ok: false, status: 503 }),
    () => {
      throw new TypeError("Network unavailable");
    },
  ]) {
    const harness = mountProvider({
      env: {
        NEXT_PUBLIC_API_BASE_URL: "https://legacy.example.com",
        NEXT_PUBLIC_USER_API_BASE_URL: "https://user.example.com",
        NEXT_PUBLIC_CONFIG_API_BASE_URL: "https://config.example.com",
      },
      fetchProfile: async (url) => (url.endsWith("/api/v1/me") ? profileResponse("a") : failWith()),
    });
    harness.emitUser(user("a"));
    await settle();
    const requests = [
      harness.actions.requestPrivate("user", "/api/v1/watchlist/AAPL", "a:1", {
        method: "PUT",
      }),
      harness.actions.requestPrivate("config", "/api/v1/preferences", "a:1", {
        method: "PUT",
        json: { theme: "light", language: "en", defaultChartRange: "1m", expectedVersion: 0 },
      }),
    ];
    const results = await Promise.allSettled(requests);
    assert.ok(
      results.every((result) => result.status === "rejected" || result.value.status === 503),
    );
    assert.equal(harness.requests.length, 3);
    assert.ok(harness.requests.every(([url]) => !url.startsWith("https://legacy.example.com")));
    assert.equal(harness.state().profile.uid, "a");
  }
});

test("switching account while a private token is pending cannot send the previous token", async () => {
  const token = deferred();
  let attempts = 0;
  const harness = mountProvider({
    fetchProfile: async (_url, options) =>
      profileResponse(options.headers.Authorization.endsWith("-b") ? "b" : "a"),
  });
  harness.emitUser({
    uid: "a",
    getIdToken: () => (++attempts === 1 ? Promise.resolve("test-token-a") : token.promise),
  });
  await settle();
  const pending = harness.actions.requestPrivate("user", "/api/v1/watchlist/NFLX", "a:1", {
    method: "PUT",
  });
  const rejected = assert.rejects(pending, /account session changed/);
  harness.emitUser(user("b"));
  await settle();
  token.resolve("late-test-token-a");
  await rejected;
  assert.equal(harness.state().profile.uid, "b");
  assert.equal(harness.requests.length, 2);
  assert.ok(harness.requests.every(([url]) => url.endsWith("/api/v1/me")));
});

test("a private 401 hides verified identity without repeated token refreshes", async () => {
  let attempts = 0;
  const harness = mountProvider({
    fetchProfile: async (url) =>
      url.endsWith("/api/v1/me") ? profileResponse("a") : { ok: false, status: 401 },
  });
  harness.emitUser({ uid: "a", getIdToken: async () => `test-token-${++attempts}` });
  await settle();
  await assert.rejects(
    harness.actions.requestPrivate("user", "/api/v1/watchlist", "a:1"),
    /account session changed/,
  );
  assert.equal(harness.state().status, "error");
  assert.equal(harness.state().profile, null);
  await assert.rejects(harness.actions.requestPrivate("user", "/api/v1/watchlist", "a:1"));
  assert.equal(attempts, 2);
  assert.equal(harness.requests.length, 2);
});

test("a late rejected private response from A cannot invalidate verified account B", async () => {
  const privateResponse = deferred();
  const harness = mountProvider({
    fetchProfile: async (url, options) =>
      url.endsWith("/api/v1/me")
        ? profileResponse(options.headers.Authorization.endsWith("-b") ? "b" : "a")
        : privateResponse.promise,
  });
  harness.emitUser(user("a"));
  await settle();
  const pending = harness.actions.requestPrivate("user", "/api/v1/watchlist", "a:1");
  const rejected = assert.rejects(pending, /account session changed/);
  await settle();
  harness.emitUser(user("b"));
  await settle();
  privateResponse.resolve({ status: 401, ok: false });
  await rejected;
  assert.equal(harness.state().profile.uid, "b");
  assert.equal(harness.state().status, "authenticated");
});

test("failed private token acquisition hides identity and never transmits an invalid token", async () => {
  let attempts = 0;
  const harness = mountProvider();
  harness.emitUser({
    uid: "a",
    getIdToken: async () => {
      if (++attempts > 1) throw new Error("Expired SDK credential");
      return "test-token-a";
    },
  });
  await settle();
  await assert.rejects(
    harness.actions.requestPrivate("user", "/api/v1/watchlist", "a:1"),
    /account session changed/,
  );
  assert.equal(harness.state().profile, null);
  assert.equal(harness.state().status, "error");
  assert.equal(harness.requests.length, 1);
});

test("logging out while a private token is pending prevents the private fetch", async () => {
  const token = deferred();
  let attempts = 0;
  const harness = mountProvider();
  harness.emitUser({
    uid: "a",
    getIdToken: () => (++attempts === 1 ? Promise.resolve("test-token-a") : token.promise),
  });
  await settle();
  const pending = harness.actions.requestPrivate("user", "/api/v1/watchlist/NFLX", "a:1", {
    method: "PUT",
  });
  const rejected = assert.rejects(pending, /account session changed/);
  await harness.actions.signOut();
  token.resolve("late-test-token-a");
  await rejected;
  assert.equal(harness.state().profile, null);
  assert.equal(harness.requests.length, 1);
});

test("preferences JSON stays on its exact private endpoint with authenticated no-store requests", async () => {
  const harness = mountProvider();
  harness.emitUser(user("a"));
  await settle();
  const preferences = {
    theme: "system",
    language: "zh",
    defaultChartRange: "1y",
    expectedVersion: 2,
  };
  await harness.actions.requestPrivate("config", "/api/v1/preferences", "a:1", {
    method: "PUT",
    json: preferences,
  });
  const [url, options] = harness.requests[1];
  assert.match(url, /\/api\/v1\/preferences$/);
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.equal(options.headers.Authorization, "Bearer test-token-a");
  assert.deepEqual(JSON.parse(options.body), preferences);
  assert.equal(options.cache, "no-store");
  assert.equal(options.credentials, "omit");
  for (const path of [
    "/api/v1/preferences/other",
    "/api/v1/preferences?uid=b",
    "https://example.com/api/v1/preferences",
  ]) {
    await assert.rejects(
      harness.actions.requestPrivate("config", path, "a:1", { method: "PUT", json: preferences }),
      /Invalid private API path/,
    );
  }
  for (const [path, options] of [
    ["/api/v1/watchlist/AAPL", { method: "PUT", json: preferences }],
    ["/api/v1/preferences", { method: "GET", json: preferences }],
    ["/api/v1/preferences", { method: "DELETE" }],
    ["/api/v1/preferences", { method: "PUT" }],
  ]) {
    await assert.rejects(
      harness.actions.requestPrivate(
        path.startsWith("/api/v1/preferences") ? "config" : "user",
        path,
        "a:1",
        options,
      ),
      /Invalid private API request/,
    );
  }
  assert.equal(harness.requests.length, 2);
});

test("aborting a pending settings token prevents its JSON write after the deadline", async () => {
  const token = deferred();
  let attempts = 0;
  const harness = mountProvider();
  harness.emitUser({
    uid: "a",
    getIdToken: () => (++attempts === 1 ? Promise.resolve("test-token-a") : token.promise),
  });
  await settle();
  const controller = new AbortController();
  const pending = harness.actions.requestPrivate("config", "/api/v1/preferences", "a:1", {
    method: "PUT",
    signal: controller.signal,
    json: { theme: "light", language: "en", defaultChartRange: "1m", expectedVersion: 0 },
  });
  const rejected = assert.rejects(pending, /account session changed/);
  controller.abort();
  token.resolve("late-test-token-a");
  await rejected;
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.state().profile.uid, "a");
});

const encryptedEnv = {
  NEXT_PUBLIC_PORTFOLIO_API_BASE_URL: "https://portfolio.example.test",
  NEXT_PUBLIC_AGENT_HUB_API_BASE_URL: "https://hub.example.test",
};
const version = "folioview.agent-workspace.v2.0";
const operation = "synthetic_operation_000001";
const author = "A".repeat(43);
function operationHeaders(extra = {}) {
  return { "Idempotency-Key": operation, ...extra };
}

test("encrypted requests use only explicit services, fixed version, closed methods and no redirects", async () => {
  const harness = mountProvider({
    env: encryptedEnv,
    fetchOwnerConfig: async () => configResponse(true, true),
  });
  harness.emitUser(user("a"));
  await settle();
  const entries = [
    ["agent-hub", "/api/v2/vaults/current", {}],
    [
      "agent-hub",
      "/api/v2/vaults",
      {
        method: "POST",
        headers: operationHeaders(),
        json: {
          contractVersion: version,
          vaultId: "vault_A",
          rootJwk: {},
          rootKeyId: author,
          registryBundle: {},
          archive: {},
        },
      },
    ],
    [
      "agent-hub",
      "/api/v2/vaults/vault_A/registry",
      {
        method: "PUT",
        headers: operationHeaders(),
        json: { contractVersion: version, expectedVersion: 1, registryBundle: {} },
      },
    ],
    [
      "agent-hub",
      "/api/v2/vaults/vault_A/holdings-sources/source_A",
      {
        method: "POST",
        headers: operationHeaders({ "X-FolioView-Author-Key": author }),
        json: { contractVersion: version, command: {} },
      },
    ],
    [
      "agent-hub",
      "/api/v2/vaults/current/authority-token",
      { method: "POST", json: { contractVersion: version } },
    ],
    [
      "portfolio",
      "/api/v2/holdings/sources/source_A/authority-sync",
      {
        method: "POST",
        headers: { "X-FolioView-Authority-Delegation": ["a", "b", "c"].join(".") },
        json: { contractVersion: version },
      },
    ],
    ["portfolio", "/api/v2/holdings/sources/source_A", {}],
    ["portfolio", "/api/v2/holdings/sources/source_A/latest", {}],
    [
      "portfolio",
      "/api/v2/holdings/sources/source_A/snapshots/snapshot_A",
      {
        method: "PUT",
        headers: operationHeaders({ "X-FolioView-Author-Key": author }),
        json: { contractVersion: version, expectedRevision: 0, carrier: {} },
      },
    ],
    ["portfolio", "/api/v2/holdings/sources/source_A/operations/synthetic_operation_000001", {}],
    ["portfolio", "/api/v2/holdings/sources/source_A/snapshots/snapshot_A", {}],
    ["portfolio", "/api/v2/holdings/sources/source_A/mutations/synthetic_operation_000001", {}],
    ...["fence", "disconnect", "delete"].map((action) => [
      "portfolio",
      `/api/v2/holdings/sources/source_A/mutations/${action}`,
      {
        method: "POST",
        headers: operationHeaders({ "X-FolioView-Author-Key": author }),
        json: { contractVersion: version, expectedVersion: 1, expectedSourceEpoch: 1, command: {} },
      },
    ]),
  ];
  for (const [service, path, options] of entries) {
    await harness.actions.requestPrivate(service, path, "a:1", options);
    const [url, request] = harness.requests.at(-1);
    assert.equal(
      url,
      (service === "portfolio" ? "/api/private/portfolio" : "/api/private/agent-hub") + path,
    );
    assert.equal(request.headers["X-FolioView-Contract"], version);
    assert.equal(request.headers.Authorization, "Bearer test-token-a");
    assert.equal(request.credentials, "omit");
    assert.equal(request.cache, "no-store");
    assert.equal(request.redirect, "error");
    assert.equal(request.referrerPolicy, "no-referrer");
  }
});

test("disabled proxy never falls back to direct Portfolio, Market or forwards a bearer", async () => {
  for (const origin of [
    undefined,
    "http://example.test",
    "https://user:pass@example.test",
    "https://example.test/",
    "https://example.test/path",
    "https://example.test?x=1",
  ]) {
    let tokens = 0;
    const harness = mountProvider({
      fetchOwnerConfig: async () => configResponse(false),
      env: {
        NEXT_PUBLIC_API_BASE_URL: "https://market.example.test",
        NEXT_PUBLIC_PORTFOLIO_API_BASE_URL: origin,
      },
    });
    harness.emitUser({
      uid: "a",
      getIdToken: async () => {
        tokens++;
        return "test-token-a";
      },
    });
    await settle();
    await assert.rejects(
      harness.actions.requestPrivate("portfolio", "/api/v2/holdings/sources/source_A", "a:1"),
      /not configured/,
    );
    assert.equal(tokens, 1);
    assert.equal(harness.requests.length, 1);
  }
});

test("encrypted routes reject header overrides, duplicates, wrong methods, unknown bodies and URLs before token retrieval", async () => {
  let tokens = 0;
  const harness = mountProvider({
    env: encryptedEnv,
    fetchOwnerConfig: async () => configResponse(true, true),
  });
  harness.emitUser({
    uid: "a",
    getIdToken: async () => {
      tokens++;
      return "test-token-a";
    },
  });
  await settle();
  const source = "/api/v2/holdings/sources/source_A";
  const failures = [
    ["portfolio", source, { method: "POST" }],
    ["portfolio", source, { json: { holdings: "private" } }],
    ["portfolio", source, { headers: { Authorization: "Bearer stolen" } }],
    ["portfolio", source, { headers: { "X-FolioView-Contract": "old-version" } }],
    [
      "portfolio",
      source,
      { headers: { "X-FolioView-Contract": version, "x-folioview-contract": version } },
    ],
    ["portfolio", source, { headers: JSON.parse('{"__proto__":"unexpected"}') }],
    ["portfolio", "https://other.example.test" + source, {}],
    ["portfolio", source + "?owner=other", {}],
    ["portfolio", source.replace("source_A", "%2fother"), {}],
    [
      "agent-hub",
      "/internal/v2/portfolio-authorities/read",
      { method: "POST", json: { contractVersion: version } },
    ],
    [
      "agent-hub",
      "/api/v2/vaults/current/authority-token",
      { method: "POST", json: { contractVersion: version, ownerUid: "other" } },
    ],
    [
      "agent-hub",
      "/api/v2/vaults/current/authority-token",
      {
        method: "POST",
        json: { contractVersion: version },
        headers: { "X-FolioView-Author-Key": author },
      },
    ],
    [
      "portfolio",
      source + "/authority-sync",
      { method: "POST", json: { contractVersion: version } },
    ],
    [
      "portfolio",
      source + "/snapshots/snapshot_A",
      {
        method: "PUT",
        headers: operationHeaders(),
        json: { contractVersion: version, expectedRevision: 0, carrier: {} },
      },
    ],
  ];
  for (const args of failures)
    await assert.rejects(
      harness.actions.requestPrivate(args[0], args[1], "a:1", args[2]),
      /Invalid private API/,
    );
  assert.equal(tokens, 1);
  assert.equal(harness.requests.length, 1);
});

test("owner capabilities load anonymously and Portfolio waits without delaying account verification", async () => {
  const config = deferred();
  let tokens = 0;
  const h = mountProvider({ fetchOwnerConfig: () => config.promise, env: encryptedEnv });
  h.emitUser({ uid: "a", getIdToken: async () => `test-token-${++tokens}` });
  await settle();
  assert.equal(h.state().status, "authenticated");
  assert.equal(h.actions.ownerConfigStatus, "loading");
  assert.equal(h.actions.portfolioConfigured, false);
  await assert.rejects(
    h.actions.requestPrivate("portfolio", "/api/v2/holdings/sources/source_A", "a:1"),
    /not configured/,
  );
  assert.equal(tokens, 1, "only User profile token is requested before configuration");
  assert.equal(h.requests.length, 1);
  const [url, options] = h.configRequests[0];
  assert.equal(url, "/api/private/owner-config");
  assert.equal(options.method, "GET");
  assert.equal(options.headers, undefined);
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.equal(options.referrerPolicy, "no-referrer");
  config.resolve(configResponse());
  await settle();
  assert.equal(h.actions.ownerConfigStatus, "ready");
  assert.equal(h.actions.ownerCapabilities.portfolio, true);
  assert.equal(h.actions.ownerCapabilities.agentHub, false);
  assert.equal(h.actions.portfolioConfigured, true);
  await h.actions.requestPrivate("portfolio", "/api/v2/holdings/sources/source_A", "a:1");
  assert.equal(h.requests.at(-1)[0], "/api/private/portfolio/api/v2/holdings/sources/source_A");
  assert.equal(tokens, 2);
});

test("missing, invalid, oversized and future owner configuration disables Portfolio without direct fallback", async () => {
  const json = (value) =>
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  for (const reply of [
    () => new Response("missing", { status: 404 }),
    () => {
      throw new Error("unavailable");
    },
    () => configResponse(false),
    () => json({ schemaVersion: 2, flags: { portfolio: true, agentHub: false } }),
    () => json({ schemaVersion: 1, flags: { portfolio: "true", agentHub: false } }),
    () => json({ schemaVersion: 1, flags: { portfolio: true, agentHub: "true" } }),
    () =>
      json({ schemaVersion: 1, flags: { portfolio: true, agentHub: false, upstream: "private" } }),
    () =>
      json({ schemaVersion: 1, flags: { portfolio: true, agentHub: false }, upstream: "private" }),
    () => new Response("x".repeat(4097), { headers: { "Content-Type": "application/json" } }),
    () => new Response("{invalid", { headers: { "Content-Type": "application/json" } }),
    () =>
      new Response(
        JSON.stringify({ schemaVersion: 1, flags: { portfolio: true, agentHub: false } }),
      ),
  ]) {
    let tokens = 0;
    const h = mountProvider({ fetchOwnerConfig: reply, env: encryptedEnv });
    h.emitUser({ uid: "a", getIdToken: async () => `test-token-${++tokens}` });
    await settle();
    assert.equal(h.actions.portfolioConfigured, false);
    assert.equal(h.actions.ownerCapabilities.portfolio, false);
    await assert.rejects(
      h.actions.requestPrivate("portfolio", "/api/v2/holdings/sources/source_A", "a:1"),
      /not configured/,
    );
    assert.equal(tokens, 1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.state().status, "authenticated");
    h.unmount();
  }
});

test("capability deadline aborts a stalled body and late bytes cannot enable Portfolio", async () => {
  let stream;
  let cancelled = false;
  const h = mountProvider({
    fetchOwnerConfig: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  });
  await settle();
  assert.equal(h.actions.ownerConfigStatus, "loading");
  h.expireConfig();
  await settle();
  assert.equal(h.actions.ownerConfigStatus, "unavailable");
  assert.equal(h.actions.portfolioConfigured, false);
  assert.equal(h.configRequests[0][1].signal.aborted, true);
  assert.equal(cancelled, true);
  assert.throws(() =>
    stream.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          flags: { portfolio: true, agentHub: false },
        }),
      ),
    ),
  );
  h.unmount();
});

test("unmount aborts capability body reads and late config fetches cannot publish", async () => {
  const config = deferred();
  const h = mountProvider({ fetchOwnerConfig: () => config.promise });
  h.unmount();
  assert.equal(h.configRequests[0][1].signal.aborted, true);
  config.resolve(configResponse());
  await settle();
  assert.equal(h.configRequests.length, 1);
  assert.equal(h.requests.length, 0);
});

test("only an explicit development loopback page and loopback API permit legacy direct Portfolio", async () => {
  for (const [nodeEnv, hostname, origin, direct] of [
    ["development", "localhost", "http://127.0.0.1:8788", true],
    ["development", "127.0.0.1", "http://localhost:8788", true],
    ["production", "localhost", "http://127.0.0.1:8788", false],
    ["development", "folioview.example.test", "http://127.0.0.1:8788", false],
    ["development", "localhost", "https://portfolio.example.test", false],
    ["development", "localhost", "http://127.0.0.1.evil.test:8788", false],
    ["development", "localhost", "http://localhost:8788/path", false],
  ]) {
    const h = mountProvider({
      fetchOwnerConfig: async () => configResponse(false),
      env: { NODE_ENV: nodeEnv, NEXT_PUBLIC_PORTFOLIO_API_BASE_URL: origin },
      hostname,
    });
    h.emitUser(user("a"));
    await settle();
    assert.equal(h.actions.portfolioConfigured, direct);
    if (direct) {
      await h.actions.requestPrivate("portfolio", "/api/v2/holdings/sources/source_A", "a:1");
      assert.equal(h.requests.at(-1)[0], origin + "/api/v2/holdings/sources/source_A");
    } else {
      await assert.rejects(
        h.actions.requestPrivate("portfolio", "/api/v2/holdings/sources/source_A", "a:1"),
        /not configured/,
      );
      assert.equal(h.requests.length, 1);
    }
    h.unmount();
  }
});

test("Portfolio proxy preserves account switch, logout, abort and late 401 session fences", async () => {
  for (const transition of ["switch", "logout", "abort"]) {
    const token = deferred();
    let attempts = 0;
    const h = mountProvider({
      fetchProfile: async (_url, options) =>
        profileResponse(options.headers.Authorization.endsWith("-b") ? "b" : "a"),
    });
    h.emitUser({
      uid: "a",
      getIdToken: () => (++attempts === 1 ? Promise.resolve("test-token-a") : token.promise),
    });
    await settle();
    const controller = new AbortController();
    const pending = h.actions.requestPrivate(
      "portfolio",
      "/api/v2/holdings/sources/source_A",
      "a:1",
      { signal: controller.signal },
    );
    const rejected = assert.rejects(pending, /account session changed/);
    if (transition === "switch") h.emitUser(user("b"));
    if (transition === "logout") await h.actions.signOut();
    if (transition === "abort") controller.abort();
    await settle();
    token.resolve("late-test-token-a");
    await rejected;
    assert.ok(h.requests.every(([url]) => url.endsWith("/api/v1/me")));
    h.unmount();
  }
  const response = deferred();
  const h = mountProvider({
    fetchProfile: async (url, options) =>
      url.endsWith("/api/v1/me")
        ? profileResponse(options.headers.Authorization.endsWith("-b") ? "b" : "a")
        : response.promise,
  });
  h.emitUser(user("a"));
  await settle();
  const pending = h.actions.requestPrivate("portfolio", "/api/v2/holdings/sources/source_A", "a:1");
  const rejected = assert.rejects(pending, /account session changed/);
  await settle();
  h.emitUser(user("b"));
  await settle();
  response.resolve({ status: 401, ok: false });
  await rejected;
  assert.equal(h.state().profile.uid, "b");
  h.unmount();
});

test("Portfolio 401 invalidates the active session and invalid mutation shapes never request a token", async () => {
  let tokens = 0;
  const h = mountProvider({
    fetchProfile: async (url) =>
      url.endsWith("/api/v1/me") ? profileResponse("a") : { status: 401, ok: false },
  });
  h.emitUser({ uid: "a", getIdToken: async () => `test-token-${++tokens}` });
  await settle();
  for (const [path, options] of [
    [
      "/api/v2/holdings/sources/source_A/mutations/unknown",
      {
        method: "POST",
        json: { contractVersion: version, expectedVersion: 1, expectedSourceEpoch: 1, command: {} },
        headers: operationHeaders({ "X-FolioView-Author-Key": author }),
      },
    ],
    [
      "/api/v2/holdings/sources/source_A/mutations/fence",
      {
        method: "POST",
        json: {
          contractVersion: version,
          expectedVersion: 1,
          expectedSourceEpoch: 1,
          command: {},
          ownerUid: "b",
        },
        headers: operationHeaders({ "X-FolioView-Author-Key": author }),
      },
    ],
    [
      "/api/v2/holdings/sources/source_A/mutations/delete",
      {
        method: "POST",
        json: { contractVersion: version, expectedVersion: 1, expectedSourceEpoch: 1, command: {} },
        headers: operationHeaders(),
      },
    ],
    [
      "/api/v2/holdings/sources/source_A/mutations/disconnect",
      {
        method: "POST",
        json: { contractVersion: version, expectedVersion: 1, expectedSourceEpoch: 1, command: {} },
        headers: { "X-FolioView-Author-Key": author },
      },
    ],
    ["/api/v2/holdings/sources/source_A/mutations/operation_A/ack", {}],
  ])
    await assert.rejects(
      h.actions.requestPrivate("portfolio", path, "a:1", options),
      /Invalid private API/,
    );
  assert.equal(tokens, 1);
  await assert.rejects(
    h.actions.requestPrivate("portfolio", "/api/v2/holdings/sources/source_A", "a:1"),
    /account session changed/,
  );
  assert.equal(h.state().status, "error");
  assert.equal(h.state().profile, null);
  assert.equal(tokens, 2);
});

test("Hub capability is independent and production never falls back to its legacy remote origin", async () => {
  for (const [portfolio, agentHub] of [
    [true, false],
    [false, true],
    [false, false],
  ]) {
    let tokens = 0;
    const h = mountProvider({
      env: encryptedEnv,
      fetchOwnerConfig: async () => configResponse(portfolio, agentHub),
    });
    h.emitUser({ uid: "a", getIdToken: async () => `test-token-${++tokens}` });
    await settle();
    assert.equal(h.actions.portfolioConfigured, portfolio);
    assert.equal(h.actions.agentHubConfigured, agentHub);
    assert.equal(h.actions.ownerCapabilities.agentHub, agentHub);
    for (const [service, path, enabled] of [
      ["portfolio", "/api/v2/holdings/sources/source_A", portfolio],
      ["agent-hub", "/api/v2/vaults/current", agentHub],
    ]) {
      const before = tokens;
      if (enabled) {
        await h.actions.requestPrivate(service, path, "a:1");
        assert.equal(h.requests.at(-1)[0], `/api/private/${service}${path}`);
        assert.equal(tokens, before + 1);
      } else {
        await assert.rejects(h.actions.requestPrivate(service, path, "a:1"), /not configured/);
        assert.equal(tokens, before);
      }
    }
    assert.ok(h.requests.every(([url]) => !url.startsWith("https://hub.example.test")));
    h.unmount();
  }
  const pending = deferred();
  const h = mountProvider({ fetchOwnerConfig: () => pending.promise, env: encryptedEnv });
  h.emitUser(user("a"));
  await settle();
  assert.equal(h.state().status, "authenticated");
  await assert.rejects(
    h.actions.requestPrivate("agent-hub", "/api/v2/vaults/current", "a:1"),
    /not configured/,
  );
  assert.equal(h.requests.length, 1);
  pending.resolve(configResponse(false, true));
  await settle();
  assert.equal(h.actions.agentHubConfigured, true);
  h.unmount();
});

test("Hub owner catalogue, tasks, Inbox, connections and preparation use only closed same-origin routes", async () => {
  const h = mountProvider({
    fetchOwnerConfig: async () => configResponse(true, true),
    env: encryptedEnv,
  });
  h.emitUser(user("a"));
  await settle();
  const cursor = "A".repeat(32);
  const signedHeaders = operationHeaders({ "X-FolioView-Author-Key": author });
  const versioned = {
    contractVersion: version,
    expectedVersion: 1,
    resourceBindings: [],
    envelope: {},
  };
  const entries = [
    ["/api/v2/resources/catalogue", {}],
    ["/api/v2/tasks?" + new URLSearchParams({ limit: "50", cursor }), {}],
    ["/api/v2/tasks/task_A", {}],
    ["/api/v2/tasks/task_A/versions/50", {}],
    ["/api/v2/results?limit=50&cursor=" + cursor + "&filter=unread&taskId=task_A", {}],
    ["/api/v2/results/counts?taskId=task_A", {}],
    ["/api/v2/results/result_A?revision=32&deliveryRevision=1", {}],
    ["/api/v2/results/result_A?deliveryRevision=9007199254740991", {}],
    ["/api/v2/results/result_A/revisions?limit=1&cursor=" + cursor, {}],
    ["/api/v2/results/result_A/revisions/32/evidence", {}],
    ["/api/v2/results/result_A/revisions/32/registries/32", {}],
    ["/api/v2/agent-connections", {}],
    ["/api/v2/agent-connections/connection_A/tasks/task_A/preparation-intent", {}],
    [
      "/api/v2/tasks",
      { method: "POST", json: { ...versioned, taskId: "task_A" }, headers: signedHeaders },
    ],
    ["/api/v2/tasks/task_A", { method: "PUT", json: versioned, headers: signedHeaders }],
    [
      "/api/v2/tasks/task_A/transitions",
      { method: "POST", json: { ...versioned, transitionIntent: {} }, headers: signedHeaders },
    ],
    [
      "/api/v2/results/result_A/state",
      { method: "PATCH", json: { contractVersion: version, command: {} }, headers: signedHeaders },
    ],
    [
      "/api/v2/agent-connections/connection_A/revoke",
      { method: "POST", json: { contractVersion: version } },
    ],
    [
      "/api/v2/agent-connections/connection_A/grants/grant_A/revoke",
      { method: "POST", json: { contractVersion: version } },
    ],
    [
      "/api/v2/agent-connections/connection_A/tasks/task_A/preparation/objects/object_A",
      { method: "PUT", json: { contractVersion: version, envelope: {} }, headers: signedHeaders },
    ],
    [
      "/api/v2/agent-connections/connection_A/tasks/task_A/preparation/commit",
      {
        method: "POST",
        json: {
          contractVersion: version,
          objects: [{ objectId: "object_A", envelopeFingerprint: author }],
        },
        headers: operationHeaders(),
      },
    ],
  ];
  for (const [path, options] of entries) {
    await h.actions.requestPrivate("agent-hub", path, "a:1", options);
    const [url, sent] = h.requests.at(-1);
    assert.equal(url, "/api/private/agent-hub" + path);
    assert.equal(sent.method, options.method ?? "GET");
    assert.equal(sent.headers.Authorization, "Bearer test-token-a");
    assert.equal(sent.headers["X-FolioView-Contract"], version);
    assert.equal(sent.headers["X-Serverless-Authorization"], undefined);
    assert.equal(sent.credentials, "omit");
    assert.equal(sent.cache, "no-store");
    assert.equal(sent.redirect, "error");
    if (options.json) assert.equal(sent.body, JSON.stringify(options.json));
  }
  h.unmount();
});

test("Hub owner queries reject duplicate, unknown, malformed and out-of-range values before retrieving a token", async () => {
  let tokens = 0;
  const h = mountProvider({ fetchOwnerConfig: async () => configResponse(false, true) });
  h.emitUser({ uid: "a", getIdToken: async () => `test-token-${++tokens}` });
  await settle();
  for (const path of [
    "/api/v2/tasks?ownerUid=b",
    "/api/v2/tasks?limit=1&limit=2",
    "/api/v2/tasks?limit=0",
    "/api/v2/tasks?limit=51",
    "/api/v2/tasks?limit=01",
    "/api/v2/tasks?cursor=",
    "/api/v2/tasks?cursor=" + "A".repeat(2049),
    "/api/v2/tasks?cursor=%",
    "/api/v2/tasks?cursor=%2F",
    "/api/v2/tasks?",
    "/api/v2/tasks?&",
    "/api/v2/tasks?limit=1&",
    "/api/v2/tasks/task_A?limit=1",
    "/api/v2/results?filter=everything",
    "/api/v2/results?taskId=owner%2Ftask",
    "/api/v2/results?cursor=a&cursor=b",
    "/api/v2/results/counts?limit=1",
    "/api/v2/results/counts?taskId=a&taskId=b",
    "/api/v2/results/result_A?revision=33",
    "/api/v2/results/result_A?revision=01",
    "/api/v2/results/result_A?deliveryRevision=0",
    "/api/v2/results/result_A?deliveryRevision=9007199254740992",
    "/api/v2/results/result_A/revisions/33/evidence",
    "/api/v2/results/result_A/revisions/1/registries/33",
    "/api/v2/tasks/task_A/versions/51",
    "/api/v2/tasks/task_A/versions/01",
    "/api/v2/vaults/current?owner=a",
    "/api/v2/resources/catalogue?kind=holdings",
    "/api/v2/tasks/%41",
    "/api/v2/tasks/task_A#fragment",
  ])
    await assert.rejects(h.actions.requestPrivate("agent-hub", path, "a:1"), /Invalid private API/);
  assert.equal(tokens, 1);
  assert.equal(h.requests.length, 1);
  h.unmount();
});

test("Hub owner rejects authorization flow, agent protocols, internal/helper paths and header/body bypasses", async () => {
  let tokens = 0;
  const h = mountProvider({ fetchOwnerConfig: async () => configResponse(false, true) });
  h.emitUser({ uid: "a", getIdToken: async () => `test-token-${++tokens}` });
  await settle();
  const state = "/api/v2/results/result_A/state";
  const good = {
    method: "PATCH",
    json: { contractVersion: version, command: {} },
    headers: operationHeaders({ "X-FolioView-Author-Key": author }),
  };
  const attempts = [
    ["/api/v2/agent-authorizations/request_A", {}],
    ...["claim", "prepare", "prepare-encrypted", "decision"].map((action) => [
      "/api/v2/agent-authorizations/request_A/" + action,
      { method: "POST", json: { contractVersion: version } },
    ]),
    ["/oauth/token", { method: "POST" }],
    ["/mcp/v2", { method: "POST" }],
    ["/.well-known/jwks.json", {}],
    ["/internal/v2/source-fences", { method: "POST" }],
    ["/agent/v2/helper/worker.js", {}],
    ["/agent/v2/tasks/task_A", {}],
    ["https://evil.test/api/v2/tasks", {}],
    ["//evil.test/api/v2/tasks", {}],
    [state, { ...good, method: "PUT" }],
    [state, { ...good, json: { ...good.json, ownerUid: "b" } }],
    [state, { ...good, headers: operationHeaders() }],
    [
      state,
      { ...good, headers: { ...good.headers, "X-Serverless-Authorization": "Bearer forged" } },
    ],
    [state, { ...good, headers: { ...good.headers, "X-FolioView-Delegation": "forged" } }],
    [state, { ...good, headers: { ...good.headers, Origin: "https://evil.test" } }],
    [state, { ...good, headers: { ...good.headers, Cookie: "fv_oauth_flow=forged" } }],
    ["/api/v2/resources/catalogue", { json: { contractVersion: version } }],
    [
      "/api/v2/tasks",
      {
        method: "POST",
        json: { contractVersion: version, expectedVersion: 0, resourceBindings: [], envelope: {} },
        headers: good.headers,
      },
    ],
    [
      "/api/v2/agent-connections/connection_A/revoke",
      { method: "POST", json: { contractVersion: version }, headers: good.headers },
    ],
    [
      "/api/v2/agent-connections/connection_A/tasks/task_A/preparation/commit",
      { method: "POST", json: { contractVersion: version, objects: [] }, headers: good.headers },
    ],
  ];
  for (const [path, options] of attempts)
    await assert.rejects(
      h.actions.requestPrivate("agent-hub", path, "a:1", options),
      /Invalid private API/,
    );
  assert.equal(tokens, 1);
  assert.equal(h.requests.length, 1);
  h.unmount();
});

test("Hub owner write budgets reject oversized state, source control, commit and task bodies before token access", async () => {
  let tokens = 0;
  const h = mountProvider({ fetchOwnerConfig: async () => configResponse(false, true) });
  h.emitUser({ uid: "a", getIdToken: async () => `test-token-${++tokens}` });
  await settle();
  const headers = operationHeaders({ "X-FolioView-Author-Key": author });
  for (const [path, method, json, selectedHeaders] of [
    [
      "/api/v2/results/result_A/state",
      "PATCH",
      { contractVersion: version, command: "A".repeat(65536) },
      headers,
    ],
    [
      "/api/v2/vaults/vault_A/holdings-sources/source_A",
      "POST",
      { contractVersion: version, command: "A".repeat(66560) },
      headers,
    ],
    [
      "/api/v2/agent-connections/connection_A/tasks/task_A/preparation/commit",
      "POST",
      { contractVersion: version, objects: ["A".repeat(8192)] },
      operationHeaders(),
    ],
    [
      "/api/v2/tasks",
      "POST",
      {
        contractVersion: version,
        taskId: "task_A",
        expectedVersion: 0,
        resourceBindings: [],
        envelope: "A".repeat(589824),
      },
      headers,
    ],
  ])
    await assert.rejects(
      h.actions.requestPrivate("agent-hub", path, "a:1", {
        method,
        json,
        headers: selectedHeaders,
      }),
      /Invalid private API/,
    );
  assert.equal(tokens, 1);
  assert.equal(h.requests.length, 1);
  h.unmount();
});

test("Hub proxy preserves pending-token account switch, logout, cancellation and late401 fences", async () => {
  for (const transition of ["switch", "logout", "abort"]) {
    const token = deferred();
    let attempts = 0;
    const h = mountProvider({
      fetchOwnerConfig: async () => configResponse(false, true),
      fetchProfile: async (_url, options) =>
        profileResponse(options.headers.Authorization.endsWith("-b") ? "b" : "a"),
    });
    h.emitUser({
      uid: "a",
      getIdToken: () => (++attempts === 1 ? Promise.resolve("test-token-a") : token.promise),
    });
    await settle();
    const controller = new AbortController();
    const pending = h.actions.requestPrivate("agent-hub", "/api/v2/results/result_A", "a:1", {
      signal: controller.signal,
    });
    const rejected = assert.rejects(pending, /account session changed/);
    if (transition === "switch") h.emitUser(user("b"));
    if (transition === "logout") await h.actions.signOut();
    if (transition === "abort") controller.abort();
    await settle();
    token.resolve("late-test-token-a");
    await rejected;
    assert.ok(h.requests.every(([url]) => url.endsWith("/api/v1/me")));
    h.unmount();
  }
  const reply = deferred();
  const h = mountProvider({
    fetchOwnerConfig: async () => configResponse(false, true),
    fetchProfile: async (url, options) =>
      url.endsWith("/api/v1/me")
        ? profileResponse(options.headers.Authorization.endsWith("-b") ? "b" : "a")
        : reply.promise,
  });
  h.emitUser(user("a"));
  await settle();
  const pending = h.actions.requestPrivate("agent-hub", "/api/v2/results/result_A", "a:1");
  const rejected = assert.rejects(pending, /account session changed/);
  await settle();
  h.emitUser(user("b"));
  await settle();
  reply.resolve({ ok: false, status: 401 });
  await rejected;
  assert.equal(h.state().profile.uid, "b");
  h.unmount();
});

test("Hub active401 invalidates identity while infrastructure503 preserves the owner", async () => {
  for (const status of [503, 401]) {
    const h = mountProvider({
      fetchOwnerConfig: async () => configResponse(false, true),
      fetchProfile: async (url) =>
        url.endsWith("/api/v1/me") ? profileResponse("a") : { ok: false, status },
    });
    h.emitUser(user("a"));
    await settle();
    const pending = h.actions.requestPrivate("agent-hub", "/api/v2/resources/catalogue", "a:1");
    if (status === 401) {
      await assert.rejects(pending, /account session changed/);
      assert.equal(h.state().profile, null);
    } else {
      assert.equal((await pending).status, 503);
      assert.equal(h.state().profile.uid, "a");
    }
    h.unmount();
  }
});

test("Hub legacy direct transport exists only for explicit development loopback testing", async () => {
  for (const [mode, hostname, origin, enabled] of [
    ["development", "localhost", "http://127.0.0.1:8788", true],
    ["development", "127.0.0.1", "https://localhost:8788", true],
    ["production", "localhost", "http://localhost:8788", false],
    ["development", "folioview.example.test", "http://localhost:8788", false],
    ["development", "localhost", "https://hub.example.test", false],
    ["development", "localhost", "http://localhost.evil.test:8788", false],
  ]) {
    const h = mountProvider({
      fetchOwnerConfig: async () => configResponse(false, false),
      hostname,
      env: { NODE_ENV: mode, NEXT_PUBLIC_AGENT_HUB_API_BASE_URL: origin },
    });
    h.emitUser(user("a"));
    await settle();
    assert.equal(h.actions.agentHubConfigured, enabled);
    if (enabled) {
      await h.actions.requestPrivate("agent-hub", "/api/v2/vaults/current", "a:1");
      assert.equal(h.requests.at(-1)[0], origin + "/api/v2/vaults/current");
    } else
      await assert.rejects(
        h.actions.requestPrivate("agent-hub", "/api/v2/vaults/current", "a:1"),
        /not configured/,
      );
    h.unmount();
  }
});

test("manual follows permits only fixed User GET and bounded CAS PUT before obtaining a token", async () => {
  const h = mountProvider();
  const account = user("a");
  h.emitUser(account);
  await settle();
  let tokens = 0;
  account.getIdToken = async () => {
    tokens++;
    return "synthetic-token";
  };
  const valid = {
    expectedRevision: 0,
    items: [{ name: "Synthetic", handleOrUrl: "@synthetic", note: "" }],
  };
  await h.actions.requestPrivate("user", "/api/v1/channel-follows", "a:1");
  await h.actions.requestPrivate("user", "/api/v1/channel-follows", "a:1", {
    method: "PUT",
    json: valid,
  });
  assert.equal(tokens, 2);
  const last = h.requests.at(-1);
  assert.equal(last[0], "http://localhost:8000/api/v1/channel-follows");
  assert.equal(last[1].credentials, "omit");
  assert.equal(last[1].redirect, "error");
  assert.equal(
    last[1].body,
    JSON.stringify({
      ...valid,
      items: [{ ...valid.items[0], handleOrUrl: "https://www.youtube.com/@synthetic" }],
    }),
  );
  const cases = [
    ["user", "/api/v1/channel-follows?owner=b", {}],
    ["user", "/api/v1/channel-follows/item", {}],
    ["config", "/api/v1/channel-follows", {}],
    ["user", "/api/v1/channel-follows", { method: "DELETE" }],
    ["user", "/api/v1/channel-follows", { method: "POST", json: valid }],
    ["user", "/api/v1/channel-follows", { json: valid }],
    ["user", "/api/v1/channel-follows", { method: "PUT" }],
    ["user", "/api/v1/channel-follows", { headers: { Authorization: "Bearer arbitrary" } }],
    ["user", "/api/v1/channel-follows", { method: "PUT", json: { ...valid, owner: "b" } }],
    [
      "user",
      "/api/v1/channel-follows",
      { method: "PUT", json: { ...valid, expectedRevision: -1 } },
    ],
    [
      "user",
      "/api/v1/channel-follows",
      {
        method: "PUT",
        json: { ...valid, items: [{ ...valid.items[0], handleOrUrl: "https://evil.test/@a" }] },
      },
    ],
    [
      "user",
      "/api/v1/channel-follows",
      {
        method: "PUT",
        json: {
          ...valid,
          items: Array.from({ length: 50 }, (_, i) => ({
            name: "A",
            handleOrUrl: `@a${i}`,
            note: "字".repeat(1000),
          })),
        },
      },
    ],
  ];
  for (const [service, route, options] of cases)
    await assert.rejects(h.actions.requestPrivate(service, route, "a:1", options));
  assert.equal(tokens, 2, "invalid route/body never requests an SDK token");
  h.unmount();
});

test("owner consent uses only a verified fixed Hub bridge and a fresh raw credential after body checks", async () => {
  const h = mountProvider({ fetchOwnerConfig: async () => configResponse(true, true) });
  let tokens = 0;
  h.emitUser({
    uid: "a",
    getIdToken: async () => {
      tokens++;
      return "RAW.JWT.fixture";
    },
  });
  await settle();
  const calls = [],
    bridge = {
      testVerifiedOwnerBridge: true,
      hubOrigin: "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
      isLive: () => true,
      async request(...args) {
        calls.push(args);
        return { recorded: true };
      },
    };
  const key = h.actions.sessionKey,
    before = tokens;
  await h.actions.requestAgentConsent(
    bridge,
    "claim",
    { contractVersion: "folioview.agent-workspace.v2.0" },
    key,
  );
  assert.equal(tokens, before + 1);
  assert.equal(calls[0][2], "RAW.JWT.fixture");
  assert.equal(calls[0][0], "claim");
  await assert.rejects(
    h.actions.requestAgentConsent(
      { ...bridge, testVerifiedOwnerBridge: false },
      "claim",
      { contractVersion: "folioview.agent-workspace.v2.0" },
      key,
    ),
  );
  await assert.rejects(
    h.actions.requestAgentConsent(
      bridge,
      "decision",
      { contractVersion: "folioview.agent-workspace.v2.0", decision: "approve", signedGrants: [] },
      key,
    ),
  );
  await assert.rejects(
    h.actions.requestAgentConsent(
      bridge,
      "claim",
      { contractVersion: "folioview.agent-workspace.v2.0", privateKey: "CANARY" },
      key,
    ),
  );
  assert.equal(tokens, before + 1);
  assert.equal(calls.length, 1);
  h.unmount();
});
test("owner consent never retrieves or sends a credential to a different configured Hub origin", async () => {
  const h = mountProvider({
    fetchOwnerConfig: async () => configResponse(true, true),
    fetchLinkConfig: async () => ({
      schemaVersion: 1,
      enabled: true,
      hubOrigin: "https://agent-hub-api-987654321.northamerica-northeast2.run.app",
    }),
  });
  let tokens = 0,
    calls = 0;
  h.emitUser({
    uid: "a",
    getIdToken: async () => {
      tokens++;
      return "RAW.JWT.fixture";
    },
  });
  await settle();
  const before = tokens,
    bridge = {
      testVerifiedOwnerBridge: true,
      hubOrigin: "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
      isLive: () => true,
      request: async () => calls++,
    };
  await assert.rejects(
    h.actions.requestAgentConsent(
      bridge,
      "claim",
      { contractVersion: "folioview.agent-workspace.v2.0" },
      h.actions.sessionKey,
    ),
  );
  assert.equal(tokens, before);
  assert.equal(calls, 0);
  h.unmount();
});
test("a delayed owner-consent token cannot cross account changes or a closed browser port", async () => {
  const h = mountProvider({
    fetchOwnerConfig: async () => configResponse(true, true),
    fetchProfile: async (_url, init) =>
      profileResponse(init.headers.Authorization.includes("b") ? "b" : "a"),
  });
  const token = deferred();
  let wait = false,
    live = true,
    sends = 0;
  const a = { uid: "a", getIdToken: async () => (wait ? token.promise : "RAW.a.fixture") };
  h.emitUser(a);
  await settle();
  wait = true;
  const bridge = {
    testVerifiedOwnerBridge: true,
    hubOrigin: "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
    isLive: () => live,
    request: async () => sends++,
  };
  const pending = h.actions.requestAgentConsent(
    bridge,
    "claim",
    { contractVersion: "folioview.agent-workspace.v2.0" },
    h.actions.sessionKey,
  );
  await settle();
  h.emitUser({ uid: "b", getIdToken: async () => "RAW.b.fixture" });
  await settle();
  live = false;
  token.resolve("RAW.old.fixture");
  await assert.rejects(pending, { name: "SessionChangedError" });
  assert.equal(sends, 0);
  h.unmount();
});
