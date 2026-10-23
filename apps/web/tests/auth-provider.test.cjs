const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

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

function mountProvider({
  logout = async () => {},
  fetchProfile = async () => profileResponse("a"),
} = {}) {
  let state;
  let observer;
  let observerError;
  const effects = [];
  const requests = [];
  const auth = { currentUser: null };
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useState: (initial) => {
      state = initial;
      return [
        state,
        (next) => {
          state = next;
        },
      ];
    },
    useRef: (current) => ({ current }),
    useCallback: (callback) => callback,
    useMemo: (callback) => callback(),
    useEffect: (effect) => effects.push(effect),
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
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected test import ${name}`);
      return imports[name];
    },
    process: { env: {} },
    AbortController,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    fetch: (...args) => {
      requests.push(args);
      return fetchProfile(...args);
    },
  });
  const tree = module.exports.AuthProvider({ children: null });
  effects.forEach((effect) => effect());
  return {
    actions: tree.props.value,
    auth,
    requests,
    state: () => state,
    emitUser: (next) => {
      auth.currentUser = next;
      observer(next);
    },
    emitError: () => observerError(new Error("Observer unavailable")),
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
  await harness.actions.requestPrivate("/api/v1/watchlist/NFLX", "a:1", { method: "PUT" });
  assert.equal(tokens, 2);
  const [url, options] = harness.requests[1];
  assert.match(url, /\/api\/v1\/watchlist\/NFLX$/);
  assert.equal(options.headers.Authorization, "Bearer fresh-token-2");
  assert.equal(options.method, "PUT");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  await assert.rejects(
    harness.actions.requestPrivate("https://example.com/api/v1/watchlist", "a:1"),
    /Invalid private API path/,
  );
  assert.equal(harness.requests.length, 2);
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
  const pending = harness.actions.requestPrivate("/api/v1/watchlist/NFLX", "a:1", {
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
    harness.actions.requestPrivate("/api/v1/watchlist", "a:1"),
    /account session changed/,
  );
  assert.equal(harness.state().status, "error");
  assert.equal(harness.state().profile, null);
  await assert.rejects(harness.actions.requestPrivate("/api/v1/watchlist", "a:1"));
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
  const pending = harness.actions.requestPrivate("/api/v1/watchlist", "a:1");
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
    harness.actions.requestPrivate("/api/v1/watchlist", "a:1"),
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
  const pending = harness.actions.requestPrivate("/api/v1/watchlist/NFLX", "a:1", {
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
  await harness.actions.requestPrivate("/api/v1/preferences", "a:1", {
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
      harness.actions.requestPrivate(path, "a:1", { method: "PUT", json: preferences }),
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
      harness.actions.requestPrivate(path, "a:1", options),
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
  const pending = harness.actions.requestPrivate("/api/v1/preferences", "a:1", {
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
