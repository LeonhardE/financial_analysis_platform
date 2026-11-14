const test = require("node:test"),
  assert = require("node:assert/strict");
const { compile } = require("./resource-library-helpers.cjs"),
  { hooks, jsx, all } = require("./resource-ui-harness.cjs");
const currencies = compile("../lib/currency-preferences.ts"),
  model = compile("../lib/fx-follows.ts", { "./currency-preferences": currencies }),
  stores = compile(
    "../lib/fx-follows-store.ts",
    { "./fx-follows": model },
    { setTimeout, clearTimeout },
  ),
  market = compile(
    "../lib/fx-market.ts",
    { "./currency-preferences": currencies, "./fx-follows": model },
    { process: { env: {} } },
  );
const copy = (v) => structuredClone(v),
  tick = () => new Promise((r) => setImmediate(r));
const usdCad = { base: "USD", quote: "CAD" },
  usdCny = { base: "USD", quote: "CNY" };
const snapshot = (preferences = null, version = 0) => ({
  contractVersion: "folioview.valuation.v1",
  profile: "folioview.fx-preferences.v1",
  preferences,
  version,
});
const prefs = (pairs = [], suppressedDefault = null) => ({ pairs, suppressedDefault });
const reply = (v, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const context = (currency = "CNY", currencyGeneration = 1) => ({ currency, currencyGeneration });
const deferred = () => {
  let resolve;
  return { promise: new Promise((r) => (resolve = r)), resolve: (v) => resolve(v) };
};
test("defaults are contextual, manual pairs survive USD/default changes and removing an automatic pair stays removed", () => {
  const empty = model.fxSnapshot(snapshot()),
    ctx = context();
  assert.deepEqual(copy(model.effectivePairs(empty, ctx)), [{ ...usdCny, origin: "default" }]);
  assert.equal(model.effectivePairs(empty, context("USD")).length, 0);
  const removed = model.applyFxIntent(empty, { kind: "remove", pair: usdCny, context: ctx });
  assert.equal(model.effectivePairs(model.fxSnapshot(snapshot(removed, 1)), ctx).length, 0);
  assert.equal(
    model.effectivePairs(model.fxSnapshot(snapshot(removed, 1)), context("CNY", 2)).length,
    1,
  );
  const manual = model.fxSnapshot(snapshot(prefs([usdCny, usdCad]), 1));
  assert.deepEqual(copy(model.effectivePairs(manual, ctx).map((p) => p.origin)), [
    "manual",
    "manual",
  ]);
  assert.equal(model.effectivePairs(manual, context("USD", 2)).length, 2);
  const deleted = model.applyFxIntent(manual, { kind: "remove", pair: usdCny, context: ctx });
  assert.deepEqual(copy(model.effectivePairs(model.fxSnapshot(snapshot(deleted, 2)), ctx)), [
    { ...usdCad, origin: "manual" },
  ]);
  const newer = prefs([], context("EUR", 5)),
    old = model.applyFxIntent(model.fxSnapshot(snapshot(newer, 3)), {
      kind: "remove",
      pair: usdCny,
      context: context("CNY", 4),
    });
  assert.equal(
    old.suppressedDefault.currency,
    "EUR",
    "stale default intent cannot erase a newer context's dismissal",
  );
});
test("preference readers reject unknown fields, false absence, duplicates, identity pairs, unsupported currencies and oversize lists", () => {
  for (const v of [
    { ...snapshot(), version: 1 },
    { ...snapshot(), preferences: prefs() },
    snapshot(prefs([usdCad, usdCad]), 1),
    snapshot(prefs([{ base: "USD", quote: "USD" }]), 1),
    snapshot(prefs([{ base: "BTC", quote: "CAD" }]), 1),
    snapshot(prefs([], context("USD")), 1),
    { ...snapshot(), owner: "PRIVATE" },
  ])
    assert.throws(() => model.fxSnapshot(v));
  assert.throws(() => model.fxPreferences(prefs(Array.from({ length: 13 }, () => usdCad))));
});
test("lost PUT acknowledgement is reconciled by GET before another write and cannot create another save", async () => {
  let remote = snapshot(),
    writes = 0;
  const methods = [],
    states = [];
  const store = new stores.FxFollowStore(
    "owner_A",
    async (path, options) => {
      assert.equal(path, "/api/v1/fx-follows");
      methods.push(options.method);
      if (options.method === "GET") return reply(remote);
      writes++;
      remote = snapshot(options.json.preferences, remote.version + 1);
      throw Error("lost acknowledgement");
    },
    (s) => states.push(s),
  );
  store.load();
  await tick();
  store.change({ kind: "add", pair: usdCad, context: context("USD", 0) });
  await tick();
  assert.equal(store.state.error, true);
  assert.equal(store.state.uncertain, true);
  assert.equal(writes, 1);
  store.change({ kind: "add", pair: usdCny, context: context() });
  assert.equal(writes, 1);
  store.load();
  await tick();
  assert.equal(store.state.error, false);
  assert.equal(store.state.uncertain, false);
  assert.equal(store.state.snapshot.version, 1);
  assert.equal(writes, 1);
  assert.deepEqual(methods, ["GET", "PUT", "GET"]);
  store.dispose();
});
test("a409 rebases the user's action on fresh follows without erasing another device's manual pair", async () => {
  let remote = snapshot(),
    puts = 0;
  const store = new stores.FxFollowStore(
    "A",
    async (path, o) => {
      if (o.method === "GET") return reply(remote);
      if (++puts === 1) {
        remote = snapshot(prefs([{ base: "EUR", quote: "CAD" }]), 1);
        return reply({}, 409);
      }
      assert.equal(o.json.expectedVersion, 1);
      assert.deepEqual(copy(o.json.preferences.pairs), [{ base: "EUR", quote: "CAD" }, usdCad]);
      remote = snapshot(o.json.preferences, 2);
      return reply(remote);
    },
    () => {},
  );
  store.load();
  await tick();
  store.change({ kind: "add", pair: usdCad, context: null });
  await tick();
  await tick();
  assert.equal(puts, 2);
  assert.equal(store.state.error, false);
  assert.equal(store.state.snapshot.version, 2);
  store.dispose();
});
test("failed initial read never invents empty follows and disposal prevents a late account publication", async () => {
  const first = new stores.FxFollowStore(
    "A",
    async () => reply({}, 503),
    () => {},
  );
  first.load();
  await tick();
  assert.equal(first.state.snapshot, null);
  assert.equal(first.state.error, true);
  let calls = 0;
  first.change({ kind: "add", pair: usdCad, context: null });
  assert.equal(first.state.snapshot, null);
  first.dispose();
  const pending = deferred(),
    states = [],
    second = new stores.FxFollowStore(
      "A",
      async () => {
        calls++;
        return pending.promise;
      },
      (s) => states.push(s),
    );
  second.load();
  const count = states.length;
  second.dispose();
  pending.resolve(reply(snapshot(prefs([usdCad]), 1)));
  await tick();
  assert.equal(states.length, count);
  assert.equal(calls, 1);
});
const at = "2026-11-14T06:00:00Z",
  day = "2026-11-13";
const rate = (pair = usdCad) => ({
  ...pair,
  rate: "1.36",
  source: "bank_of_canada",
  status: "available",
  sourceAsOf: null,
  sourceDate: day,
  fetchedAt: at,
  reason: null,
  route: {
    kind: "direct",
    via: null,
    legs: [{ base: "USD", quote: "CAD", rate: "1.36", sourceDate: day }],
  },
});
const batch = (items = [rate()]) => ({
  contractVersion: "folioview.valuation.v1",
  profile: "folioview.fx-batch.v1",
  snapshotId: "fx_synthetic",
  fetchedAt: at,
  items,
});
test("the small public rate reader verifies exact CAD routes, source dates and full requested pair identity", () => {
  const good = market.readFxRates(batch(), [usdCad]);
  assert.equal(good.items[0].rate, "1.36");
  assert.equal(market.rateLabel("7.157894736842105263"), "7.157895");
  assert.equal(market.rateLabel("0.0000000001"), "<0.000001");
  for (const mutate of [
    (b) => (b.items[0].rate = "1.35"),
    (b) => (b.items[0].route.legs[0].sourceDate = "2026-11-12"),
    (b) => b.items.push(copy(b.items[0])),
    (b) => (b.items[0].quantity = "SECRET"),
    (b) => (b.items[0].fetchedAt = "2026-02-30T01:00:00Z"),
    (b) => (b.items[0].sourceAsOf = "2026-11-14T06:00:00.000001Z"),
    (b) => (b.items[0].rate = "NaN"),
    (b) => (b.profile = "wrong"),
  ]) {
    const b = batch();
    mutate(b);
    assert.throws(() => market.readFxRates(b, [usdCad]));
  }
  assert.throws(() => market.readFxRates(batch(), [usdCny]));
  const crossRate = {
    ...rate(usdCny),
    rate: "7.157894736842105263",
    route: {
      kind: "cross",
      via: "CAD",
      legs: [
        { base: "USD", quote: "CAD", rate: "1.36", sourceDate: day },
        { base: "CNY", quote: "CAD", rate: "0.19", sourceDate: day },
      ],
    },
  };
  assert.equal(market.readFxRates(batch([crossRate]), [usdCny]).items[0].rate, crossRate.rate);
  const inverse = {
    ...rate({ base: "CAD", quote: "USD" }),
    rate: "0.735294117647058824",
    route: {
      kind: "inverse",
      via: null,
      legs: [{ base: "USD", quote: "CAD", rate: "1.36", sourceDate: day }],
    },
  };
  assert.equal(
    market.readFxRates(batch([inverse]), [{ base: "CAD", quote: "USD" }]).items[0].rate,
    inverse.rate,
  );
});
function mountRates(loader) {
  const h = hooks(),
    calls = [],
    timers = new Map();
  let timer = 0;
  const hook = compile(
    "../components/useFxRates.ts",
    {
      react: h.react,
      "@/lib/fx-follows": model,
      "@/lib/fx-market": {
        fetchFxRates: async (...args) => {
          calls.push(args);
          return loader(...args);
        },
      },
    },
    {
      setTimeout: (fn) => {
        timers.set(++timer, fn);
        return timer;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return {
    calls,
    close: h.close,
    timeout() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((fn) => fn());
    },
    render: (pairs = [usdCad], owner = "A", active = true) =>
      h.render(() => hook.useFxRates(pairs, owner, active)),
  };
}
const rates = () => market.readFxRates(batch(), [usdCad]);
test("fresh public FX cache is one request; chart rerenders/revisits do not trigger another and owner changes mask old rates", async () => {
  const app = mountRates(async () => rates());
  app.render();
  await tick();
  let v = app.render();
  assert.equal(v.data.items[0].rate, "1.36");
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][1], true);
  app.render(copy([usdCad]));
  app.render([usdCad], "A", false);
  app.render([usdCad], "A", true);
  await tick();
  assert.equal(app.calls.length, 1);
  v = app.render([usdCad], "B", false);
  assert.equal(v.data, null);
  app.close();
});
test("missing cached FX refreshes once, failed refresh retains dated stale values and never starts a polling loop", async () => {
  let count = 0;
  const old = rates();
  old.items[0].status = "stale";
  const app = mountRates(async () => {
    if (++count === 1) return old;
    throw Error("private diagnostic");
  });
  app.render();
  await tick();
  await tick();
  let v = app.render();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1][1], false);
  assert.equal(v.error, true);
  assert.equal(v.data.items[0].rate, "1.36");
  assert.equal(v.data.items[0].status, "stale");
  assert.equal(v.loading, false);
  app.render([usdCad], "A", false);
  app.render([usdCad], "A", true);
  await tick();
  assert.equal(app.calls.length, 2);
  app.close();
});
test("FX timeout settles even if a transport ignores abort; navigation cancellation cannot revive obsolete data", async () => {
  const wait = deferred(),
    app = mountRates(() => wait.promise);
  app.render();
  assert.equal(app.calls.length, 1);
  app.timeout();
  await tick();
  let v = app.render();
  assert.equal(v.error, true);
  assert.equal(v.loading, false);
  assert.ok(app.calls[0][2].aborted);
  wait.resolve(rates());
  await tick();
  assert.equal(app.render().data, null);
  app.close();
  const late = deferred(),
    other = mountRates(() => late.promise);
  other.render();
  other.render([usdCad], "A", false);
  assert.ok(other.calls[0][2].aborted);
  late.resolve(rates());
  await tick();
  assert.equal(other.render([usdCad], "A", false).data, null);
  other.close();
});
test("the rates panel keeps checking, empty, stale and mutation states distinct without exposing preference internals", () => {
  const h = hooks(),
    actions = [],
    follows = {
      authenticated: true,
      checking: false,
      owner: "A",
      pairs: [{ ...usdCad, origin: "manual" }],
      snapshot: snapshot(prefs([usdCad]), 1),
      loading: false,
      saving: false,
      error: false,
      currencyLoading: false,
      currencyError: false,
      canChange: true,
      add: (p) => actions.push(["add", p]),
      remove: (p) => actions.push(["remove", p]),
      retry() {},
      currencyRetry() {},
      signIn() {
        actions.push(["signIn"]);
      },
    },
    rateState = { data: rates(), loading: false, refreshing: false, error: false, refresh() {} };
  const t = (key, v = {}) => key + Object.values(v).join(":"),
    panel = compile("../components/FxRatesPanel.tsx", {
      react: h.react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "next-intl": { useTranslations: () => t, useLocale: () => "en" },
      "./useFxFollows": { useFxFollows: () => follows },
      "./useFxRates": { useFxRates: () => rateState },
      "@/lib/currency-preferences": currencies,
      "@/lib/fx-follows": model,
      "@/lib/fx-market": market,
      "./FxRatesPanel.module.css": { default: {} },
    });
  const render = () => h.render(() => panel.default({ active: true }));
  let tree = render();
  assert.ok(JSON.stringify(tree).includes("1.36"));
  assert.ok(!JSON.stringify(tree).includes("expectedVersion"));
  const selects = all(tree, (n) => n.type === "select");
  selects[1].props.onChange({ target: { value: "CNY" } });
  tree = render();
  all(tree, (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(copy(actions[0]), ["add", usdCny]);
  all(
    tree,
    (n) => n.type === "button" && n.props["aria-label"] === "removeUSD/CAD",
  )[0].props.onClick();
  assert.equal(actions[1][0], "remove");
  follows.authenticated = false;
  follows.checking = true;
  tree = render();
  assert.equal(all(tree, (n) => n.type === "button" && n.props.children === "signIn").length, 0);
  follows.authenticated = true;
  follows.checking = false;
  follows.pairs = [];
  follows.snapshot = null;
  follows.loading = true;
  tree = render();
  assert.ok(!JSON.stringify(tree).includes('"children":"empty"'));
  follows.loading = false;
  follows.snapshot = snapshot();
  tree = render();
  assert.ok(JSON.stringify(tree).includes('"children":"empty"'));
  h.close();
});
test("public FX transport sends only pairs with no credentials and rejects unexpected response fields", async () => {
  const calls = [],
    signal = new AbortController().signal;
  const data = await market.fetchFxRates(
    [{ ...usdCad, origin: "default", privateOwner: "SECRET" }],
    true,
    signal,
    async (url, o) => {
      calls.push({ url, o });
      return reply(batch());
    },
  );
  assert.equal(data.items.length, 1);
  assert.match(calls[0].url, /fx\?cached=true$/);
  assert.equal(calls[0].o.credentials, "omit");
  assert.deepEqual(JSON.parse(calls[0].o.body), { pairs: [usdCad] });
  await assert.rejects(
    market.fetchFxRates([usdCad], false, signal, async () =>
      reply({ ...batch(), privateOwner: "SECRET" }),
    ),
  );
});
test("account switch masks follows immediately, inactive routes do not load, and revisits reuse the confirmed preference state", async () => {
  const h = hooks();
  let calls = 0,
    active = false;
  const auth = {
    status: "authenticated",
    sessionKey: "A",
    requestPrivate: async () => {
      calls++;
      return reply(snapshot(prefs([usdCad]), 1));
    },
    signIn() {},
  };
  const currency = {
    snapshot: {
      contractVersion: "folioview.valuation.v1",
      profile: "folioview.currency-preferences.v2",
      preferences: { defaultPortfolioCurrency: "CNY" },
      version: 1,
      currencyGeneration: 1,
    },
    loaded: true,
    error: null,
    retry() {},
  };
  const hook = compile("../components/useFxFollows.ts", {
    react: h.react,
    "./AuthProvider": { useAuth: () => auth },
    "./CurrencyPreferencesProvider": { useCurrencyPreferences: () => currency },
    "@/lib/fx-follows-store": stores,
    "@/lib/fx-follows": model,
  });
  const render = () => h.render(() => hook.useFxFollows(active));
  render();
  await tick();
  assert.equal(calls, 0);
  active = true;
  render();
  await tick();
  let v = render();
  assert.equal(v.pairs.length, 2);
  assert.equal(calls, 1);
  active = false;
  render();
  active = true;
  render();
  await tick();
  assert.equal(calls, 1);
  auth.sessionKey = "B";
  v = render();
  assert.equal(v.pairs.length, 0);
  assert.equal(v.canChange, false);
  await tick();
  v = render();
  assert.equal(v.owner, "B");
  assert.equal(calls, 2);
  h.close();
});
test("expired revisit revalidates peer follows in the background while preserving current rows and does not poll", async () => {
  const h = hooks();
  let now = Date.now(),
    calls = 0,
    active = true;
  const pending = deferred();
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const timed = compile(
    "../lib/fx-follows-store.ts",
    { "./fx-follows": model },
    { setTimeout, clearTimeout, Date: Clock },
  );
  const auth = {
    status: "authenticated",
    sessionKey: "A",
    requestPrivate: async () =>
      ++calls === 1 ? reply(snapshot(prefs([usdCad]), 1)) : pending.promise,
  };
  const currency = {
    snapshot: {
      contractVersion: "folioview.valuation.v1",
      profile: "folioview.currency-preferences.v2",
      preferences: { defaultPortfolioCurrency: "USD" },
      version: 1,
      currencyGeneration: 1,
    },
    loaded: true,
    loading: false,
    error: null,
    refresh() {},
    retry() {},
  };
  const hook = compile(
    "../components/useFxFollows.ts",
    {
      react: h.react,
      "./AuthProvider": { useAuth: () => auth },
      "./CurrencyPreferencesProvider": { useCurrencyPreferences: () => currency },
      "@/lib/fx-follows-store": timed,
      "@/lib/fx-follows": model,
    },
    { Date: Clock },
  );
  const render = () => h.render(() => hook.useFxFollows(active));
  render();
  await tick();
  assert.equal(render().pairs[0].quote, "CAD");
  active = false;
  render();
  now += 60_001;
  active = true;
  let view = render();
  assert.equal(calls, 2);
  assert.equal(view.pairs[0].quote, "CAD");
  assert.equal(view.loading, true);
  pending.resolve(reply(snapshot(prefs([{ base: "USD", quote: "EUR" }]), 2)));
  await tick();
  view = render();
  assert.equal(view.pairs[0].quote, "EUR");
  render();
  await tick();
  assert.equal(calls, 2);
  h.close();
});
