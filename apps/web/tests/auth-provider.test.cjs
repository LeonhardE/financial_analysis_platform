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
