const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

const source = path.join(__dirname, "../components/useWatchlistQuotes.ts");
const settle = () => new Promise((resolve) => setImmediate(resolve));
const instrument = (symbol) => ({
  symbol,
  name: `${symbol} company`,
  instrumentType: "stock",
  currency: "USD",
});
const snapshot = (symbol, changes = {}) => ({
  ...instrument(symbol),
  range: "1m",
  interval: "1d",
  latestClose: 123.45,
  changePercent: -1.23,
  dataDate: "2026-10-23",
  fetchedAt: "2026-10-23T18:00:00Z",
  isStale: false,
  ...changes,
});
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function loadLibrary(file) {
  const filename = path.join(__dirname, file);
  const { code } = transformSync(readFileSync(filename, "utf8"), {
    filename,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports });
  return module.exports;
}
const quoteLibrary = loadLibrary("../lib/market-quotes.ts");
const marketLibrary = loadLibrary("../lib/market-data.ts");

function mount(initial = {}) {
  const cells = [];
  const pending = [];
  const requests = [];
  const timers = new Map();
  let index = 0;
  let timerId = 0;
  let options = {
    items: [instrument("NFLX")],
    overview: null,
    selectedQuote: null,
    active: true,
    owner: "a:1",
    refreshKey: 0,
    ...initial,
  };
  const changed = (before, after) => !before || after.some((item, i) => item !== before[i]);
  const react = {
    useState(initialValue) {
      const slot = index++;
      cells[slot] ??= { value: initialValue };
      return [
        cells[slot].value,
        (next) => {
          cells[slot].value = typeof next === "function" ? next(cells[slot].value) : next;
        },
      ];
    },
    useRef(current) {
      const slot = index++;
      cells[slot] ??= { current };
      return cells[slot];
    },
    useCallback(callback, dependencies) {
      const slot = index++;
      if (changed(cells[slot]?.dependencies, dependencies))
        cells[slot] = { callback, dependencies };
      return cells[slot].callback;
    },
    useEffect(effect, dependencies) {
      const slot = index++;
      if (changed(cells[slot]?.dependencies, dependencies))
        pending.push({ slot, effect, dependencies });
    },
  };
  const module = { exports: {} };
  const { code } = transformSync(readFileSync(source, "utf8"), {
    filename: source,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name === "react") return react;
      if (name === "@/lib/market-quotes") return quoteLibrary;
      if (name === "@/lib/market-data") return marketLibrary;
      throw new Error(`Unexpected import: ${name}`);
    },
    process: { env: {} },
    AbortController,
    window: {
      setTimeout(callback, delay) {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    fetch(url, requestOptions) {
      const result = deferred();
      requests.push({ url, options: requestOptions, result });
      return result.promise;
    },
  });
  return {
    requests,
    render(changes = {}, flush = true) {
      options = { ...options, ...changes };
      index = 0;
      const result = module.exports.useWatchlistQuotes(options);
      if (flush) {
        for (const { slot, effect, dependencies } of pending.splice(0)) {
          cells[slot]?.cleanup?.();
          cells[slot] = { dependencies, cleanup: effect() };
        }
      } else pending.length = 0;
      return result;
    },
    timeout() {
      const [id, entry] = timers.entries().next().value;
      assert.equal(entry.delay, 15_000);
      timers.delete(id);
      entry.callback();
    },
  };
}

test("opening a 50-item watchlist never fans out before rows become visible", () => {
  const app = mount({
    items: Array.from({ length: 50 }, (_, number) => instrument(`SYM${number}`)),
  });
  app.render();
  app.render();
  assert.equal(app.requests.length, 0);
  assert.equal(app.render().loading, false);
});

test("overview and selected chart seed matching public summaries without another request", () => {
  const app = mount({
    items: [instrument("AAPL"), instrument("NFLX")],
    overview: { stocks: [snapshot("AAPL")] },
    selectedQuote: snapshot("NFLX", {
      range: "1d",
      interval: "5m",
      latestClose: 999,
      quote: {
        ...snapshot("NFLX", { latestClose: 140 }),
        basis: "daily_snapshot",
        interval: "1d",
        adjustment: "split_and_dividend_adjusted",
        previousClose: 141,
      },
    }),
  });
  let view = app.render();
  view.requestQuote("AAPL");
  view.requestQuote("NFLX");
  view = app.render();
  assert.equal(view.quotes.AAPL.latestClose, 123.45);
  assert.equal(view.quotes.NFLX.latestClose, 140);
  assert.equal(app.requests.length, 0);
  assert.equal(view.quotes.NFLX.candles, undefined);
});

test("visible rows share a two-request queue and duplicate pickers cannot duplicate work", async () => {
  const app = mount({ items: ["NFLX", "AMD", "PDD"].map(instrument) });
  const view = app.render();
  for (const symbol of ["NFLX", "NFLX", "AMD", "PDD", "PDD"]) view.requestQuote(symbol);
  assert.equal(app.requests.length, 2);
  assert.equal(app.render().loading, true);
  for (const request of app.requests) {
    assert.match(request.url, /candles\?range=1m&cached=true$/);
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.cache, "no-store");
    assert.equal(request.options.headers, undefined);
  }
  app.requests[0].result.resolve(response(snapshot("NFLX")));
  await settle();
  assert.equal(app.requests.length, 3);
  assert.match(app.requests[2].url, /PDD\/candles/);
  app.requests[1].result.resolve(response(snapshot("AMD")));
  app.requests[2].result.resolve(response(snapshot("PDD")));
  await settle();
  assert.equal(app.render().loading, false);
});

test("a cache miss refreshes exactly once and reopening reuses the successful quote", async () => {
  const app = mount();
  app.render().requestQuote("NFLX");
  app.requests[0].result.resolve(response(null, 204));
  await settle();
  assert.equal(app.requests.length, 2);
  assert.match(app.requests[1].url, /range=1m$/);
  app.requests[1].result.resolve(response(snapshot("NFLX")));
  await settle();
  const before = app.render().requestQuote;
  app.render({ active: false });
  const reopened = app.render({ active: true });
  assert.notEqual(reopened.requestQuote, before);
  reopened.requestQuote("NFLX");
  assert.equal(app.requests.length, 2);
  assert.equal(app.render().quotes.NFLX.changePercent, -1.23);
});

test("explicit refresh rechecks a fresh page-memory quote through the server cache once", async () => {
  const app = mount();
  app.render().requestQuote("NFLX");
  app.requests[0].result.resolve(response(snapshot("NFLX")));
  await settle();
  assert.equal(app.render().quotes.NFLX.latestClose, 123.45);
  app.render({ active: false });
  app.render({ active: true }).requestQuote("NFLX");
  assert.equal(app.requests.length, 1);

  const refreshed = app.render({ refreshKey: 1 });
  assert.equal(refreshed.quotes.NFLX.latestClose, 123.45);
  refreshed.requestQuote("NFLX");
  refreshed.requestQuote("NFLX");
  assert.equal(app.requests.length, 2);
  assert.match(app.requests[1].url, /NFLX\/candles\?range=1m&cached=true$/);
  app.requests[1].result.resolve(
    response(snapshot("NFLX", { latestClose: 140, fetchedAt: "2026-10-23T18:05:00Z" })),
  );
  await settle();
  assert.equal(app.render().quotes.NFLX.latestClose, 140);
  assert.equal(app.requests.length, 2);
  app.render({ active: false });
  app.render({ active: true }).requestQuote("NFLX");
  assert.equal(app.requests.length, 2);
});

test("stale cached prices remain visible after refresh failure and are never replaced with zeros", async () => {
  const app = mount();
  app.render().requestQuote("NFLX");
  app.requests[0].result.resolve(
    response(snapshot("NFLX", { isStale: true, refreshRequired: true })),
  );
  await settle();
  assert.equal(app.render().quotes.NFLX.latestClose, 123.45);
  assert.equal(app.requests.length, 2);
  app.requests[1].result.resolve(response({}, 503));
  await settle();
  const view = app.render();
  assert.equal(view.loading, false);
  assert.equal(view.quotes.NFLX.latestClose, 123.45);
  assert.equal(view.quotes.NFLX.isStale, true);
  view.requestQuote("NFLX");
  app.render({ active: false });
  app.render({ active: true }).requestQuote("NFLX");
  assert.equal(app.requests.length, 2);
});

test("a shared rate limit stops queued work; only an explicit refresh permits a retry", async () => {
  const app = mount({ items: ["NFLX", "AMD", "PDD", "ABNB"].map(instrument) });
  const view = app.render();
  for (const symbol of ["NFLX", "AMD", "PDD", "ABNB"]) view.requestQuote(symbol);
  app.requests[0].result.resolve(response({}, 429));
  await settle();
  app.requests[1].result.resolve(response(snapshot("AMD")));
  await settle();
  assert.equal(app.requests.length, 2);
  app.render().requestQuote("PDD");
  assert.equal(app.requests.length, 2);
  const refreshed = app.render({ refreshKey: 1 });
  assert.notEqual(refreshed.requestQuote, view.requestQuote);
  refreshed.requestQuote("PDD");
  assert.equal(app.requests.length, 3);
});

test("mismatched, missing, malformed, and wrong-range payloads never create a quote", async () => {
  for (const invalid of [
    snapshot("AMD"),
    snapshot("NFLX", { latestClose: Number.NaN }),
    snapshot("NFLX", { changePercent: Number.POSITIVE_INFINITY }),
    snapshot("NFLX", { currency: "CAD" }),
    snapshot("NFLX", { isStale: "false" }),
    snapshot("NFLX", { dataDate: "invalid" }),
    snapshot("NFLX", { range: "1d", interval: "5m" }),
    { symbol: "NFLX", latestClose: 300 },
  ]) {
    const app = mount();
    app.render().requestQuote("NFLX");
    app.requests[0].result.resolve(response(invalid));
    await settle();
    assert.equal(app.render().quotes.NFLX, undefined);
    assert.equal(app.requests.length, 1);
  }
});

test("account changes cancel old symbols and ignore delayed bodies even before effects", async () => {
  const app = mount({ items: ["NFLX", "AMD", "PDD"].map(instrument) });
  const view = app.render();
  for (const symbol of ["NFLX", "AMD", "PDD"]) view.requestQuote(symbol);
  const body = deferred();
  app.requests[0].result.resolve({ ok: true, status: 200, json: () => body.promise });
  await settle();
  const immediate = app.render({ owner: "b:2", items: [instrument("ABNB")] }, false);
  assert.deepEqual(Object.keys(immediate.quotes), []);
  body.resolve(snapshot("NFLX"));
  await settle();
  assert.equal(app.requests.length, 2);
  app.render();
  assert.equal(app.requests[1].options.signal.aborted, true);
  view.requestQuote("PDD");
  assert.equal(app.requests.length, 2);
  app.render().requestQuote("ABNB");
  assert.equal(app.requests.length, 3);
  app.requests[2].result.resolve(response(snapshot("ABNB")));
  await settle();
  assert.equal(app.render().quotes.ABNB.latestClose, 123.45);
  assert.equal(app.render().quotes.NFLX, undefined);
});

test("hiding the watchlist cancels downloads and queued symbols until visible again", async () => {
  const app = mount({ items: ["NFLX", "AMD", "PDD"].map(instrument) });
  const view = app.render();
  for (const symbol of ["NFLX", "AMD", "PDD"]) view.requestQuote(symbol);
  app.render({ active: false });
  assert.equal(
    app.requests.every((request) => request.options.signal.aborted),
    true,
  );
  app.requests[0].result.resolve(response(null, 204));
  app.requests[1].result.resolve(response(snapshot("AMD")));
  await settle();
  view.requestQuote("PDD");
  assert.equal(app.requests.length, 2);
  app.render({ active: true }).requestQuote("NFLX");
  assert.equal(app.requests.length, 3);
  app.requests[2].result.resolve(response(snapshot("NFLX")));
  await settle();
  assert.equal(app.render().quotes.AMD, undefined);
  assert.equal(app.render().quotes.NFLX.latestClose, 123.45);
});

test("removing rows cancels active work, skips queued work, and masks retained public prices", async () => {
  const app = mount({ items: ["NFLX", "AMD", "PDD"].map(instrument) });
  const view = app.render();
  for (const symbol of ["NFLX", "AMD", "PDD"]) view.requestQuote(symbol);
  app.render({ items: [instrument("AMD")] });
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.requests[1].result.resolve(response(snapshot("AMD")));
  app.requests[0].result.resolve(response(snapshot("NFLX")));
  await settle();
  const current = app.render();
  assert.equal(app.requests.length, 2);
  assert.equal(current.quotes.NFLX, undefined);
  assert.equal(current.quotes.AMD.latestClose, 123.45);
  assert.equal(current.loading, false);
});

test("the total deadline includes body parsing and releases capacity without automatic retries", async () => {
  const app = mount({ items: ["NFLX", "AMD", "PDD"].map(instrument) });
  const view = app.render();
  for (const symbol of ["NFLX", "AMD", "PDD"]) view.requestQuote(symbol);
  const body = deferred();
  app.requests[0].result.resolve({ ok: true, status: 200, json: () => body.promise });
  await settle();
  app.timeout();
  await settle();
  assert.equal(app.requests[0].options.signal.aborted, true);
  assert.equal(app.requests.length, 3);
  assert.match(app.requests[2].url, /PDD\/candles/);
  body.resolve(snapshot("NFLX"));
  app.requests[1].result.resolve(response(snapshot("AMD")));
  app.requests[2].result.resolve(response(snapshot("PDD")));
  await settle();
  const current = app.render();
  assert.equal(current.quotes.NFLX, undefined);
  assert.equal(current.loading, false);
  current.requestQuote("NFLX");
  assert.equal(app.requests.length, 3);
});

test("an older response cannot overwrite a newer chart seed or a manual refresh", async () => {
  const app = mount();
  app.render().requestQuote("NFLX");
  const oldBody = deferred();
  app.requests[0].result.resolve({ ok: true, status: 200, json: () => oldBody.promise });
  await settle();
  const fresh = snapshot("NFLX", { latestClose: 160, fetchedAt: "2026-10-23T18:05:00Z" });
  app.render({ selectedQuote: fresh, refreshKey: 1 });
  oldBody.resolve(snapshot("NFLX"));
  await settle();
  const current = app.render();
  assert.equal(current.quotes.NFLX.latestClose, 160);
  current.requestQuote("NFLX");
  assert.equal(app.requests.length, 1);
});

test("anonymous and invalid-symbol callbacks cannot request prices", () => {
  const app = mount({ items: [instrument("NFLX"), instrument("../secrets")], owner: null });
  app.render().requestQuote("NFLX");
  assert.equal(app.requests.length, 0);
  const signedIn = app.render({ owner: "a:1" });
  signedIn.requestQuote("../secrets");
  signedIn.requestQuote("NOTSAVED");
  assert.equal(app.requests.length, 0);
});

test("anonymous selection reuses a nested daily quote and never downloads hidden watchlist rows", () => {
  const selected = instrument("NFLX");
  const canonical = {
    ...snapshot("NFLX", { latestClose: 524.51, changePercent: 0.66 }),
    basis: "daily_snapshot",
    interval: "1d",
    adjustment: "split_and_dividend_adjusted",
    previousClose: 521.07,
  };
  const app = mount({
    owner: null,
    active: false,
    items: Array.from({ length: 50 }, (_, index) => instrument(`SYM${index}`)),
    selectedInstrument: selected,
    selectedRange: "1d",
    selectedActive: true,
    selectedChartSettled: true,
    selectedQuote: snapshot("NFLX", {
      range: "1d",
      interval: "5m",
      latestClose: 524.53,
      changePercent: 0.56,
      quote: canonical,
    }),
  });
  const view = app.render();
  assert.equal(view.quotes.NFLX.latestClose, 524.51);
  assert.equal(view.quotes.NFLX.changePercent, 0.66);
  view.requestQuote("SYM1");
  assert.equal(app.requests.length, 0);
  assert.deepEqual(Object.keys(view.quotes), ["NFLX"]);
});

test("a missing anonymous selected quote gets one cache-first 1M fallback after chart settlement", async () => {
  const selected = instrument("NFLX");
  const app = mount({
    owner: null,
    active: false,
    items: [],
    selectedInstrument: selected,
    selectedRange: "1d",
    selectedActive: true,
    selectedChartSettled: false,
    selectedQuote: snapshot("NFLX", { range: "1d", interval: "5m", quote: null }),
  });
  app.render();
  assert.equal(app.requests.length, 0);
  app.render({ selectedChartSettled: true });
  assert.equal(app.requests.length, 1);
  assert.match(app.requests[0].url, /NFLX\/candles\?range=1m&cached=true$/);
  app.requests[0].result.resolve(response(null, 204));
  await settle();
  assert.equal(app.requests.length, 2);
  app.requests[1].result.resolve(response(snapshot("NFLX", { latestClose: 140 })));
  await settle();
  assert.equal(app.render().quotes.NFLX.latestClose, 140);
  app.render({ selectedRange: "1w" });
  assert.equal(app.requests.length, 2);
  app.render({ refreshKey: 1 });
  assert.equal(app.requests.length, 3);
  assert.match(app.requests[2].url, /cached=true$/);
  assert.equal(app.render().quotes.NFLX.latestClose, 140);
  app.requests[2].result.resolve(response({ ...snapshot("NFLX"), quote: null }));
  await settle();
  assert.equal(app.render().quotes.NFLX.latestClose, 140);
  assert.equal(app.requests.length, 3);
});

test("selected 1M charts and pending default overview batches never get duplicate quote requests", async () => {
  const selected = instrument("AAPL");
  for (const settled of [false, true]) {
    const app = mount({
      items: [selected],
      selectedInstrument: selected,
      selectedRange: "1m",
      selectedActive: true,
      selectedChartSettled: settled,
    });
    app.render().requestQuote("AAPL");
    assert.equal(app.requests.length, 0);
  }
  const app = mount({
    owner: null,
    active: false,
    items: [],
    selectedInstrument: selected,
    selectedRange: "1d",
    selectedActive: true,
    selectedChartSettled: true,
    overviewPending: true,
  });
  app.render();
  assert.equal(app.requests.length, 0);
  app.render({ overviewPending: false, overview: { stocks: [snapshot("AAPL")] } });
  assert.equal(app.requests.length, 0);
  assert.equal(app.render().quotes.AAPL.latestClose, 123.45);
});

test("older market sessions and null quotes cannot erase a newer canonical price anywhere", () => {
  const selected = instrument("AAPL");
  const app = mount({
    items: [selected],
    selectedInstrument: selected,
    overview: { stocks: [snapshot("AAPL", { latestClose: 140 })] },
  });
  app.render();
  app.render({
    selectedQuote: snapshot("AAPL", {
      dataDate: "2026-10-22",
      fetchedAt: "2026-10-24T20:00:00Z",
      latestClose: 120,
    }),
  });
  assert.equal(app.render().quotes.AAPL.latestClose, 140);
  app.render({ overview: null, selectedQuote: { ...snapshot("AAPL"), quote: null } });
  assert.equal(app.render().quotes.AAPL.latestClose, 140);
  app.render({
    overview: { stocks: [snapshot("AAPL", { latestClose: null, changePercent: null })] },
    selectedQuote: null,
  });
  assert.equal(app.render().quotes.AAPL.latestClose, 140);
});

test("visible default rows can resume after a shared overview batch finishes without a quote", async () => {
  const app = mount({ items: [instrument("AAPL")], overviewPending: true });
  const before = app.render().requestQuote;
  before("AAPL");
  assert.equal(app.requests.length, 0);
  const after = app.render({ overviewPending: false }).requestQuote;
  assert.notEqual(after, before); // Visible-row observers register again when the lease is free.
  after("AAPL");
  after("AAPL");
  assert.equal(app.requests.length, 1);
  app.requests[0].result.resolve(response(snapshot("AAPL")));
  await settle();
  assert.equal(app.render().quotes.AAPL.latestClose, 123.45);
});

test("an expired observation propagates to every consumer despite an unchanged old fresh chart seed", () => {
  const selected = instrument("AAPL");
  const fresh = snapshot("AAPL");
  const app = mount({
    items: [selected],
    selectedInstrument: selected,
    overview: { stocks: [fresh] },
    selectedQuote: fresh,
  });
  app.render();
  assert.equal(app.render().quotes.AAPL.isStale, false);
  app.render({ overview: { stocks: [snapshot("AAPL", { isStale: true })] } });
  assert.equal(app.render().quotes.AAPL.isStale, true);
  app.render({ refreshKey: 1 });
  assert.equal(app.render().quotes.AAPL.isStale, true);
  app.render({ overview: { stocks: [snapshot("AAPL", { fetchedAt: "2026-10-23T18:10:00Z" })] } });
  assert.equal(app.render().quotes.AAPL.isStale, false);
});

test("a stale nested quote gets one daily refresh for the selected anonymous symbol", async () => {
  const selected = instrument("NFLX");
  const canonical = {
    ...snapshot("NFLX", { isStale: true }),
    basis: "daily_snapshot",
    interval: "1d",
    adjustment: "split_and_dividend_adjusted",
    previousClose: 125,
  };
  const app = mount({
    owner: null,
    active: false,
    items: [],
    selectedInstrument: selected,
    selectedRange: "1d",
    selectedActive: true,
    selectedChartSettled: true,
    selectedQuote: { ...snapshot("NFLX", { range: "1d", interval: "5m" }), quote: canonical },
  });
  app.render();
  assert.equal(app.requests.length, 1);
  app.requests[0].result.resolve(response({ ...snapshot("NFLX"), quote: canonical }));
  await settle();
  assert.equal(app.requests.length, 2);
  const updated = {
    ...canonical,
    isStale: false,
    latestClose: 140,
    fetchedAt: "2026-10-23T18:10:00Z",
  };
  app.requests[1].result.resolve(response({ ...snapshot("NFLX"), quote: updated }));
  await settle();
  assert.equal(app.render().quotes.NFLX.latestClose, 140);
  assert.equal(app.render().quotes.NFLX.isStale, false);
  app.render({ selectedRange: "1w" });
  assert.equal(app.requests.length, 2);
  app.render({ refreshKey: 1 });
  assert.equal(app.requests.length, 2); // The retained newer real snapshot beats the old stale seed.
});

test("scope changes resume an anonymous selected fallback even when no watchlist items change", async () => {
  for (const scope of [{ owner: "a:1" }, { active: true }]) {
    const app = mount({
      owner: null,
      active: false,
      items: [],
      selectedInstrument: instrument("NFLX"),
      selectedRange: "1d",
      selectedActive: true,
      selectedChartSettled: true,
    });
    app.render();
    assert.equal(app.requests.length, 1);
    app.render(scope);
    assert.equal(app.requests[0].options.signal.aborted, true);
    assert.equal(app.requests.length, 2);
    app.requests[0].result.resolve(response(snapshot("NFLX", { latestClose: 100 })));
    app.requests[1].result.resolve(response(snapshot("NFLX", { latestClose: 140 })));
    await settle();
    assert.equal(app.render().quotes.NFLX.latestClose, 140);
  }
});
