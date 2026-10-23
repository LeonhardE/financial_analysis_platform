const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

function compile(file, imports, globals = {}) {
  const { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
    filename: file,
    jsc: {
      parser: { syntax: "typescript", tsx: file.endsWith(".tsx") },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const prefs = (changes = {}) => ({
  theme: "system",
  language: "en",
  defaultChartRange: "1m",
  ...changes,
});
const response = (preferences, status = 200, version = preferences === null ? 0 : 1) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ preferences, version }),
});
const lib = compile("../lib/preferences.ts", {});

function mountPreferences(initialOwner = null) {
  let auth = { status: initialOwner ? "authenticated" : "anonymous", sessionKey: initialOwner };
  const cells = [];
  const pendingEffects = [];
  const requests = [];
  const timers = new Map();
  const mediaListeners = new Set();
  const mediaQuery = {
    matches: false,
    addEventListener: (_type, listener) => mediaListeners.add(listener),
    removeEventListener: (_type, listener) => mediaListeners.delete(listener),
  };
  const document = { title: "", documentElement: { dataset: {}, style: {}, lang: "en" } };
  let index = 0;
  let nextTimer = 0;
  const changed = (before, after) =>
    !before || after.some((value, position) => value !== before[position]);
  const requestPrivate = (service, url, sessionKey, options) => {
    const result = deferred();
    requests.push({ service, url, sessionKey, options, result });
    return result.promise;
  };
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useState: (initial) => {
      const slot = index++;
      cells[slot] ??= { state: initial };
      return [
        cells[slot].state,
        (next) => {
          cells[slot].state = typeof next === "function" ? next(cells[slot].state) : next;
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
      if (!cells[slot] || changed(cells[slot].dependencies, dependencies)) {
        cells[slot] = { callback, dependencies };
      }
      return cells[slot].callback;
    },
    useMemo: (callback, dependencies) => {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].dependencies, dependencies)) {
        cells[slot] = { value: callback(), dependencies };
      }
      return cells[slot].value;
    },
    useEffect: (effect, dependencies) => {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].dependencies, dependencies)) {
        pendingEffects.push({ slot, effect, dependencies });
      }
    },
  };
  const { PreferencesProvider } = compile(
    "../components/PreferencesProvider.tsx",
    {
      react,
      "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
      "next-intl": { NextIntlClientProvider: "intl-provider" },
      "@/components/AuthProvider": { useAuth: () => ({ ...auth, requestPrivate }) },
      "@/lib/preferences": lib,
      "@/messages/en.json": { settings: { title: "Settings" } },
      "@/messages/zh.json": { settings: { title: "设置" } },
    },
    {
      AbortController,
      document,
      window: {
        matchMedia: () => mediaQuery,
        get localStorage() {
          throw new Error("Preferences must not use browser storage");
        },
        get sessionStorage() {
          throw new Error("Preferences must not use browser storage");
        },
        setTimeout: (callback, milliseconds) => {
          const id = ++nextTimer;
          timers.set(id, { callback, milliseconds });
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
      },
    },
  );
  Object.defineProperty(document, "cookie", {
    get() {
      throw new Error("Preferences must not use cookies");
    },
    set() {
      throw new Error("Preferences must not use cookies");
    },
  });
  return {
    requests,
    document,
    render: (flush = true) => {
      index = 0;
      const tree = PreferencesProvider({ children: "page" });
      if (flush) {
        for (const { slot, effect, dependencies } of pendingEffects.splice(0)) {
          cells[slot]?.cleanup?.();
          cells[slot] = { dependencies, cleanup: effect() };
        }
      } else pendingEffects.length = 0;
      return { ...tree.props.value, intl: tree.props.children.props };
    },
    account: (sessionKey, status = sessionKey ? "authenticated" : "anonymous") => {
      auth = { sessionKey, status };
    },
    systemTheme: (dark) => {
      mediaQuery.matches = dark;
      for (const listener of mediaListeners) listener();
    },
    timers: (milliseconds) => {
      for (const [id, timer] of [...timers]) {
        if (timer.milliseconds !== milliseconds) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

test("guest theme and language update in memory, follow the OS, and reset on a fresh visit", () => {
  const app = mountPreferences();
  app.render();
  let view = app.render();
  assert.equal(view.resolvedTheme, "light");
  view.updatePreferences({ language: "zh", defaultChartRange: "1y" });
  view = app.render();
  assert.equal(view.intl.locale, "zh");
  assert.equal(view.intl.timeZone, "America/New_York");
  assert.equal(app.document.documentElement.lang, "zh-CN");
  assert.match(app.document.title, /你的投资工作台/);
  app.systemTheme(true);
  view = app.render();
  assert.equal(view.resolvedTheme, "dark");
  view.updatePreferences({ theme: "light" });
  app.render();
  app.systemTheme(false);
  app.systemTheme(true);
  assert.equal(app.render().resolvedTheme, "light");
  app.timers(400);
  assert.equal(app.requests.length, 0);
  const fresh = mountPreferences();
  assert.equal(fresh.render().preferences.language, "en");
  assert.equal(fresh.render().preferences.defaultChartRange, "1m");
});

test("saved preferences restore before editing, then rapid edits produce one confirmed JSON save", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.render().updatePreferences({ language: "zh" });
  assert.equal(app.render().preferences.language, "en");
  assert.equal(app.requests[0].service, "config");
  assert.equal(app.requests[0].options.method, "GET");
  app.requests[0].result.resolve(response(prefs({ theme: "light", language: "zh" })));
  await settle();
  let view = app.render();
  assert.equal(view.status, "saved");
  assert.equal(view.preferences.language, "zh");
  view.updatePreferences({ theme: "dark" });
  app.render();
  app.render().updatePreferences({ defaultChartRange: "3m" });
  view = app.render();
  assert.notEqual(view.status, "saved");
  app.timers(400);
  assert.equal(app.requests.length, 2);
  const save = app.requests[1];
  assert.equal(save.service, "config");
  assert.equal(save.url, "/api/v1/preferences");
  assert.equal(save.sessionKey, "a:1");
  assert.equal(save.options.method, "PUT");
  assert.deepEqual(JSON.parse(JSON.stringify(save.options.json)), {
    ...prefs({ theme: "dark", language: "zh", defaultChartRange: "3m" }),
    expectedVersion: 1,
  });
  assert.equal(app.render().status, "saving");
  save.result.resolve(
    response(prefs({ theme: "dark", language: "zh", defaultChartRange: "3m" }), 200, 2),
  );
  await settle();
  assert.equal(app.render().status, "saved");
  app.timers(400);
  assert.equal(app.requests.length, 2);
});

test("only an explicitly missing account record adopts guest choices; failed loads never write", async () => {
  const app = mountPreferences();
  app.render().updatePreferences({ language: "zh" });
  app.render();
  app.account("a:1");
  app.render();
  app.requests[0].result.resolve(response(null, 503));
  await settle();
  assert.equal(app.render().error, "load");
  app.timers(400);
  assert.equal(app.requests.length, 1);
  app.render().updatePreferences({ theme: "dark" });
  assert.equal(app.render().preferences.theme, "system");
  app.render().retry();
  app.requests[1].result.resolve(response(null));
  await settle();
  app.render();
  app.timers(400);
  assert.equal(app.requests[2].options.method, "PUT");
  assert.equal(app.requests[2].options.json.language, "zh");

  const pristine = mountPreferences("b:2");
  pristine.render();
  pristine.requests[0].result.resolve(response(null));
  await settle();
  pristine.render();
  pristine.timers(400);
  assert.equal(pristine.requests.length, 1);
});

test("existing account preferences take precedence over temporary guest experiments", async () => {
  const app = mountPreferences();
  app.render().updatePreferences({ language: "zh", defaultChartRange: "1y" });
  app.render();
  app.account("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs({ theme: "dark" })));
  await settle();
  const view = app.render();
  assert.equal(view.preferences.language, "en");
  assert.equal(view.preferences.defaultChartRange, "1m");
  app.timers(400);
  assert.equal(app.requests.length, 1);
});

test("serial saves preserve edits made during a pending save and report failures for retry", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs()));
  await settle();
  app.render().updatePreferences({ language: "zh" });
  app.render();
  app.timers(400);
  app.render().updatePreferences({ theme: "light" });
  app.render();
  app.timers(400);
  assert.equal(app.requests.length, 2);
  app.requests[1].result.resolve(response(prefs({ language: "zh" }), 200, 2));
  await settle();
  let view = app.render();
  assert.equal(view.preferences.theme, "light");
  assert.notEqual(view.status, "saved");
  app.timers(400);
  assert.equal(app.requests.length, 3);
  app.requests[2].result.resolve(response(null, 503));
  await settle();
  view = app.render();
  assert.equal(view.error, "save");
  assert.equal(view.preferences.theme, "light");
  app.timers(400);
  assert.equal(app.requests.length, 3);
  view.retry();
  assert.equal(app.requests.length, 4);
  app.requests[3].result.resolve(response(prefs({ language: "zh", theme: "light" }), 200, 3));
  await settle();
  assert.equal(app.render().status, "saved");
});

test("account switch masks preferences before effects and rejects a late response body or old callback", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs({ language: "zh", defaultChartRange: "1y" })));
  await settle();
  const old = app.render();
  old.updatePreferences({ theme: "light" });
  app.render();
  app.timers(400);
  const delayedBody = deferred();
  app.requests[1].result.resolve({ ok: true, json: () => delayedBody.promise });
  await settle();
  app.account("b:2");
  const immediate = app.render(false);
  assert.equal(immediate.preferences.language, "en");
  assert.equal(immediate.preferences.defaultChartRange, "1m");
  old.updatePreferences({ language: "zh", theme: "dark" });
  old.retry();
  assert.equal(app.requests.length, 2);
  app.render();
  assert.equal(app.requests[1].options.signal.aborted, true);
  app.requests[2].result.resolve(response(prefs({ theme: "dark", defaultChartRange: "3m" })));
  await settle();
  delayedBody.resolve({
    preferences: prefs({ language: "zh", theme: "light", defaultChartRange: "1y" }),
    version: 2,
  });
  await settle();
  const current = app.render();
  assert.equal(current.preferences.language, "en");
  assert.equal(current.preferences.theme, "dark");
  assert.equal(current.preferences.defaultChartRange, "3m");
  assert.equal(current.error, null);
});

test("logout cancels scheduled and pending settings writes and clears account preferences", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs({ language: "zh", theme: "light" })));
  await settle();
  app.render().updatePreferences({ defaultChartRange: "1y" });
  app.render();
  app.account(null, "signing-out");
  assert.equal(app.render().preferences.language, "en");
  app.timers(400);
  assert.equal(app.requests.length, 1);
  assert.equal(app.render().authenticated, false);

  app.account("b:2");
  app.render();
  app.requests[1].result.resolve(response(prefs()));
  await settle();
  app.render().updatePreferences({ language: "zh" });
  app.render();
  app.timers(400);
  app.account(null);
  app.render();
  assert.equal(app.requests[2].options.signal.aborted, true);
  app.requests[2].result.resolve(response(prefs({ language: "zh" })));
  await settle();
  assert.equal(app.render().preferences.language, "en");
});

test("a timed-out request or token cannot leave settings stuck or apply after a retry", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.timers(20_000);
  let view = app.render();
  assert.equal(view.error, "loadTimeout");
  assert.equal(view.loading, false);
  assert.equal(app.requests[0].options.signal.aborted, true);
  view.retry();
  app.requests[1].result.resolve(response(prefs({ theme: "light" })));
  await settle();
  app.requests[0].result.resolve(response(prefs({ language: "zh" })));
  await settle();
  view = app.render();
  assert.equal(view.preferences.language, "en");
  assert.equal(view.preferences.theme, "light");
  view.updatePreferences({ defaultChartRange: "1y" });
  app.render();
  app.timers(400);
  app.timers(20_000);
  view = app.render();
  assert.equal(view.error, "saveTimeout");
  assert.equal(view.saving, false);
  assert.equal(view.preferences.defaultChartRange, "1y");
});

test("preferences reject unsupported enums, owner injection and malformed save responses", () => {
  assert.equal(lib.readPreferences({ preferences: null, version: 0 }).preferences, null);
  assert.equal(
    lib.readPreferences({ preferences: prefs(), version: 1 }).preferences.theme,
    "system",
  );
  for (const value of [
    null,
    {},
    { preferences: [], version: 1 },
    { preferences: prefs({ theme: "pink" }), version: 1 },
    { preferences: prefs({ language: "fr" }), version: 1 },
    { preferences: prefs({ defaultChartRange: "5y" }), version: 1 },
    { preferences: { ...prefs(), owner: "other-user" }, version: 1 },
  ]) {
    assert.throws(() => lib.readPreferences(value), /Invalid preferences response/);
  }
});

test("a conflict reloads the server version and retries the latest active draft, including edits during reload", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs(), 200, 4));
  await settle();
  app.render().updatePreferences({ language: "zh" });
  app.render();
  app.timers(400);
  assert.equal(app.requests[1].options.json.expectedVersion, 4);
  app.requests[1].result.resolve(response(null, 409));
  await settle();
  assert.equal(app.requests[2].options.method, "GET");
  app.render().updatePreferences({ theme: "light" });
  app.render();
  app.requests[2].result.resolve(response(prefs({ defaultChartRange: "1y" }), 200, 5));
  await settle();
  assert.equal(app.requests[3].options.method, "PUT");
  assert.equal(app.requests[3].options.json.expectedVersion, 5);
  assert.equal(app.requests[3].options.json.language, "zh");
  assert.equal(app.requests[3].options.json.theme, "light");
  app.requests[3].result.resolve(response(prefs({ language: "zh", theme: "light" }), 200, 6));
  await settle();
  assert.equal(app.render().status, "saved");
  assert.equal(app.render().preferences.theme, "light");
  app.timers(400);
  assert.equal(app.requests.length, 4);
});

test("repeated conflicts stop after two reloads instead of creating an automatic retry loop", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs(), 200, 1));
  await settle();
  app.render().updatePreferences({ language: "zh" });
  app.render();
  app.timers(400);
  for (let attempt = 0; attempt < 3; attempt++) {
    const put = app.requests.at(-1);
    assert.equal(put.options.method, "PUT");
    assert.equal(put.options.json.expectedVersion, attempt + 1);
    put.result.resolve(response(null, 409));
    await settle();
    if (attempt < 2) {
      assert.equal(app.requests.at(-1).options.method, "GET");
      app.requests.at(-1).result.resolve(response(prefs(), 200, attempt + 2));
      await settle();
    }
  }
  const view = app.render();
  assert.equal(view.error, "save");
  assert.equal(view.preferences.language, "zh");
  app.timers(400);
  assert.equal(app.requests.length, 6);
});

test("a timed-out old PUT cannot roll back a newer explicit save, including restoring the server's original value", async () => {
  for (const oldCommitsFirst of [false, true]) {
    const app = mountPreferences("a:1");
    let stored = { preferences: prefs(), version: 1 };
    // Model the backend CAS boundary rather than assuming abort cancels server work.
    const commit = (request) => {
      const { expectedVersion, ...preferences } = request.options.json;
      if (expectedVersion !== stored.version) return response(null, 409);
      stored = { preferences, version: stored.version + 1 };
      return response(preferences, 200, stored.version);
    };
    app.render();
    app.requests[0].result.resolve(response(stored.preferences, 200, stored.version));
    await settle();
    app.render().updatePreferences({ language: "zh" });
    app.render();
    app.timers(400);
    const old = app.requests[1];
    app.timers(20_000);
    assert.equal(app.render().error, "saveTimeout");
    app.render().updatePreferences({ language: "en" });
    app.render();
    app.timers(400);
    let oldResponse;
    if (oldCommitsFirst) oldResponse = commit(old);
    const recent = app.requests[2];
    recent.result.resolve(commit(recent));
    await settle();
    if (oldCommitsFirst) {
      assert.equal(app.requests[3].options.method, "GET");
      app.requests[3].result.resolve(response(stored.preferences, 200, stored.version));
      await settle();
      const rebased = app.requests[4];
      assert.equal(rebased.options.json.expectedVersion, 2);
      rebased.result.resolve(commit(rebased));
      await settle();
    } else oldResponse = commit(old);
    old.result.resolve(oldResponse);
    await settle();
    assert.equal(stored.preferences.language, "en");
    assert.equal(stored.version, oldCommitsFirst ? 3 : 2);
    assert.equal(app.render().preferences.language, "en");
    assert.equal(app.render().status, "saved");
  }
});

test("a conflict reload cannot apply or resend an old account's draft after switching accounts", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs()));
  await settle();
  app.render().updatePreferences({ language: "zh" });
  app.render();
  app.timers(400);
  app.requests[1].result.resolve(response(null, 409));
  await settle();
  const body = deferred();
  app.requests[2].result.resolve({ ok: true, json: () => body.promise });
  await settle();
  app.account("b:2");
  assert.equal(app.render().preferences.language, "en");
  app.requests[3].result.resolve(response(prefs({ theme: "light" }), 200, 8));
  await settle();
  body.resolve({ preferences: prefs({ language: "zh" }), version: 2 });
  await settle();
  assert.equal(app.requests.length, 4);
  assert.equal(app.render().preferences.language, "en");
  assert.equal(app.render().preferences.theme, "light");
  assert.equal(app.render().status, "saved");
});

test("a failed conflict reload leaves a retryable draft without a blind write", async () => {
  const app = mountPreferences("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs()));
  await settle();
  app.render().updatePreferences({ language: "zh" });
  app.render();
  app.timers(400);
  app.requests[1].result.resolve(response(null, 409));
  await settle();
  app.requests[2].result.resolve(response(null, 503));
  await settle();
  assert.equal(app.render().error, "save");
  assert.equal(app.render().preferences.language, "zh");
  app.timers(400);
  assert.equal(app.requests.length, 3);
});

test("versioned preferences reject unknown or unsafe versions and saves that fail to advance", async () => {
  for (const invalid of [
    { preferences: prefs() },
    { preferences: prefs(), version: -1 },
    { preferences: prefs(), version: 1.5 },
    { preferences: prefs(), version: "1" },
    { preferences: prefs(), version: Number.MAX_SAFE_INTEGER + 1 },
    { preferences: prefs(), version: 0 },
    { preferences: null, version: 1 },
  ])
    assert.throws(() => lib.readPreferences(invalid), /Invalid preferences response/);
  const app = mountPreferences("a:1");
  app.render();
  app.requests[0].result.resolve(response(prefs(), 200, 2));
  await settle();
  app.render().updatePreferences({ language: "zh" });
  app.render();
  app.timers(400);
  app.requests[1].result.resolve(response(prefs({ language: "zh" }), 200, 2));
  await settle();
  assert.equal(app.render().error, "save");
  assert.notEqual(app.render().status, "saved");
});
