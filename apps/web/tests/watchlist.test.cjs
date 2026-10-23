const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const { renderToStaticMarkup } = require("react-dom/server");
const jsxRuntime = require("react/jsx-runtime");
const { createTranslator } = require("next-intl");
const english = require("../messages/en.json");
const intl = {
  useLocale: () => "en",
  useTranslations: (namespace) => createTranslator({ locale: "en", messages: english, namespace }),
};

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

const instrument = (symbol) => ({
  symbol,
  name: symbol === "NFLX" ? "Netflix" : "Apple",
  instrumentType: "stock",
  currency: "USD",
  addedAt: "2026-10-21T16:00:00Z",
});
const body = (...symbols) => ({ items: symbols.map(instrument), limit: 50 });
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

function mountWatchlist() {
  let auth = { status: "authenticated", sessionKey: "a:1" };
  const cells = [];
  const pendingEffects = [];
  const requests = [];
  const timers = new Map();
  let nextTimer = 0;
  let index = 0;
  const changed = (before, after) =>
    !before || after.some((value, position) => value !== before[position]);
  const requestPrivate = (service, url, sessionKey, options) => {
    const result = deferred();
    requests.push({ service, url, sessionKey, options, result });
    return result.promise;
  };
  const { useWatchlist } = compile(
    "../components/useWatchlist.ts",
    {
      react: {
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
        useEffect: (effect, dependencies) => {
          const slot = index++;
          if (!cells[slot] || changed(cells[slot].dependencies, dependencies)) {
            pendingEffects.push({ slot, effect, dependencies });
          }
        },
      },
      "@/components/AuthProvider": { useAuth: () => ({ ...auth, requestPrivate }) },
      "@/lib/watchlist": compile("../lib/watchlist.ts", {}),
    },
    {
      AbortController,
      window: {
        setTimeout: (callback) => {
          const id = ++nextTimer;
          timers.set(id, callback);
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
      },
    },
  );
  return {
    requests,
    render: (flush = true) => {
      index = 0;
      const result = useWatchlist();
      if (flush) {
        for (const { slot, effect, dependencies } of pendingEffects.splice(0)) {
          cells[slot]?.cleanup?.();
          cells[slot] = { dependencies, cleanup: effect() };
        }
      } else {
        pendingEffects.length = 0;
      }
      return result;
    },
    account: (sessionKey, status = sessionKey ? "authenticated" : "anonymous") => {
      auth = { sessionKey, status };
    },
    timeout: () => {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
    },
  };
}

test("watchlist CRUD uses one private request at a time and retains server results", async () => {
  const hook = mountWatchlist();
  hook.render();
  assert.equal(hook.requests.length, 1);
  assert.equal(hook.requests[0].service, "user");
  assert.equal(hook.requests[0].options.method, "GET");
  hook.requests[0].result.resolve(response(body()));
  await settle();
  let view = hook.render();
  assert.equal(view.loaded, true);
  const adding = view.add("NFLX");
  void view.add("NFLX");
  assert.equal(hook.requests.length, 2);
  assert.equal(hook.requests[1].url, "/api/v1/watchlist/NFLX");
  assert.equal(hook.requests[1].service, "user");
  assert.equal(hook.requests[1].sessionKey, "a:1");
  assert.equal(hook.requests[1].options.method, "PUT");
  assert.equal(hook.render().pendingSymbol, "NFLX");
  hook.requests[1].result.resolve(response(body("NFLX")));
  await adding;
  view = hook.render();
  assert.equal(view.items[0].symbol, "NFLX");
  assert.match(view.message, /NFLX added/);
  const removing = view.remove("NFLX");
  assert.equal(hook.requests[2].options.method, "DELETE");
  hook.requests[2].result.resolve(response(body()));
  await removing;
  view = hook.render();
  assert.equal(view.items.length, 0);
  assert.match(view.message, /NFLX removed/);
  const reload = view.reload();
  hook.requests[3].result.resolve(response(body("AAPL")));
  await reload;
  assert.equal(hook.render().items[0].symbol, "AAPL");
});

test("account switch masks private items before effects and ignores a late mutation", async () => {
  const hook = mountWatchlist();
  hook.render();
  hook.requests[0].result.resolve(response(body("AAPL")));
  await settle();
  const oldView = hook.render();
  const adding = oldView.add("NFLX");
  hook.account("b:2");
  const firstBRender = hook.render(false);
  assert.equal(firstBRender.items.length, 0);
  assert.equal(firstBRender.message, "");
  // A click callback retained by an old render must not send as the new account.
  void oldView.remove("AAPL");
  assert.equal(hook.requests.length, 2);
  hook.render();
  assert.equal(hook.requests[1].options.signal.aborted, true);
  assert.equal(hook.requests[2].sessionKey, "b:2");
  hook.requests[2].result.resolve(response(body("NFLX")));
  await settle();
  hook.requests[1].result.resolve(response(body("AAPL", "NFLX")));
  await adding;
  const current = hook.render();
  assert.equal(current.items.length, 1);
  assert.equal(current.items[0].symbol, "NFLX");
  assert.equal(current.message, "");
});

test("logout and verification hide all saved symbols even when a read completes late", async () => {
  const hook = mountWatchlist();
  hook.render();
  hook.account(null, "verifying");
  assert.equal(hook.render().authenticated, false);
  hook.requests[0].result.resolve(response(body("AAPL")));
  await settle();
  assert.equal(hook.render().items.length, 0);
  hook.account("b:3");
  hook.render();
  hook.requests[1].result.resolve(response(body("NFLX")));
  await settle();
  assert.equal(hook.render().items[0].symbol, "NFLX");
  hook.account(null);
  const loggedOut = hook.render(false);
  assert.equal(loggedOut.items.length, 0);
  assert.equal(loggedOut.loaded, false);
  assert.equal(loggedOut.error, "");
});

test("a delayed private response body cannot restore A's symbols after B loads", async () => {
  const hook = mountWatchlist();
  hook.render();
  const pendingBody = deferred();
  hook.requests[0].result.resolve({ ok: true, status: 200, json: () => pendingBody.promise });
  await settle();
  hook.account("b:2");
  hook.render();
  hook.requests[1].result.resolve(response(body("NFLX")));
  await settle();
  pendingBody.resolve(body("AAPL"));
  await settle();
  assert.equal(hook.render().items[0].symbol, "NFLX");
  assert.equal(hook.render().items.length, 1);
});

test("a failed mutation preserves known items and requires a reload before another UI edit", async () => {
  const hook = mountWatchlist();
  hook.render();
  hook.requests[0].result.resolve(response(body("AAPL")));
  await settle();
  const adding = hook.render().add("NFLX");
  hook.requests[1].result.resolve(response({ detail: "Full" }, 409));
  await adding;
  let view = hook.render();
  assert.match(view.error, /watchlist is full/);
  assert.equal(view.items[0].symbol, "AAPL");
  assert.equal(view.loaded, false);
  const reload = view.reload();
  hook.requests[2].result.resolve(response(body("AAPL")));
  await reload;
  view = hook.render();
  assert.equal(view.error, "");
  assert.equal(view.loaded, true);
});

test("a stalled token or request clears pending UI and cannot restore its late result", async () => {
  const hook = mountWatchlist();
  hook.render();
  hook.timeout();
  const failed = hook.render();
  assert.equal(failed.loading, false);
  assert.equal(failed.busy, false);
  assert.match(failed.error, /took too long/);
  assert.equal(hook.requests[0].options.signal.aborted, true);
  const reload = failed.reload();
  hook.requests[1].result.resolve(response(body("NFLX")));
  await reload;
  hook.requests[0].result.resolve(response(body("AAPL")));
  await settle();
  assert.equal(hook.render().items[0].symbol, "NFLX");
});

test("ordinary rerenders and chart selections do not reload a private watchlist", async () => {
  const hook = mountWatchlist();
  hook.render();
  hook.requests[0].result.resolve(response(body()));
  await settle();
  for (let index = 0; index < 10; index++) hook.render();
  assert.equal(hook.requests.length, 1);
});

test("malformed private responses cannot add duplicate, invalid, or excessive saved symbols", () => {
  const { readWatchlist } = compile("../lib/watchlist.ts", {});
  assert.equal(readWatchlist(body("NFLX")).items[0].symbol, "NFLX");
  for (const invalid of [
    null,
    { items: [], limit: 100 },
    body("NFLX", "NFLX"),
    body("https://example.com"),
    body(".."),
    { items: [{ ...instrument("NFLX"), currency: "EUR" }], limit: 50 },
    { items: [{ ...instrument("NFLX"), addedAt: "invalid" }], limit: 50 },
  ]) {
    assert.throws(() => readWatchlist(invalid), /Invalid watchlist response/);
  }
});

function renderWatchlist(authenticated, items = []) {
  const { PersonalWatchlist, WatchlistAction } = compile("../components/PersonalWatchlist.tsx", {
    "next-intl": intl,
    "@/lib/ui-messages": compile("../lib/ui-messages.ts", {}),
    "react/jsx-runtime": jsxRuntime,
    "@/components/AuthProvider": {
      useAuth: () => ({ status: authenticated ? "authenticated" : "anonymous" }),
    },
  });
  const watchlist = {
    authenticated,
    items,
    limit: 50,
    loaded: true,
    loading: false,
    busy: false,
    error: "",
    message: "",
  };
  return renderToStaticMarkup(
    jsxRuntime.jsxs("div", {
      children: [
        jsxRuntime.jsx(PersonalWatchlist, { watchlist, selectedSymbol: "NFLX" }),
        jsxRuntime.jsx(WatchlistAction, { watchlist, instrument: instrument("NFLX") }),
      ],
    }),
  );
}

test("guest save CTA and private saved instruments remain separate from public quotes", () => {
  const guest = renderWatchlist(false);
  assert.match(guest, /My watchlist/);
  assert.match(guest, /Sign in to save/);
  assert.doesNotMatch(guest, /Your saved instruments|NFLX|AAPL/);
  const signedIn = renderWatchlist(true, [instrument("NFLX")]);
  assert.match(signedIn, /Netflix/);
  assert.match(signedIn, /Remove NFLX from watchlist/);
  assert.match(signedIn, /Remove from watchlist/);
  assert.match(signedIn, /aria-pressed="true"/);
  assert.doesNotMatch(signedIn, /\$|Daily prices|Only visible to your signed-in account/);
});
