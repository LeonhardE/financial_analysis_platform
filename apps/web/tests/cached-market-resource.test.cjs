const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const source = path.join(__dirname, "../components/useCachedMarketResource.ts");
const settle = () => new Promise((resolve) => setImmediate(resolve));
const candlePath = (symbol, range = "1m") => `/api/stocks/${symbol}/candles?range=${range}`;
const snapshot = (symbol = "AAPL", refreshRequired = false) => ({
  symbol,
  close: 102,
  isStale: refreshRequired,
  refreshRequired,
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

function mount() {
  const cells = [];
  const pending = [];
  const requests = [];
  const timers = new Map();
  let index = 0;
  let timerId = 0;
  const changed = (before, after) => !before || after.some((item, i) => item !== before[i]);
  const react = {
    useState(initial) {
      const slot = index++;
      cells[slot] ??= { value: initial };
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
      assert.equal(name, "react");
      return react;
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
    fetch(url, options) {
      const result = deferred();
      requests.push({ url, options, result });
      return result.promise;
    },
  });
  return {
    requests,
    render(resourcePath, reload = 0, ready = true, flush = true) {
      index = 0;
      const result = module.exports.useCachedMarketResource(resourcePath, reload, ready);
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
      timers.delete(id);
      entry.callback();
    },
  };
}

test("fresh cached snapshot is the only request and carries no credentials", async () => {
  const app = mount();
  app.render(candlePath("AAPL"));
  assert.match(app.requests[0].url, /range=1m&cached=true$/);
  app.requests[0].result.resolve(response(snapshot()));
  await settle();
  const state = app.render(candlePath("AAPL"));
  assert.equal(state.data.symbol, "AAPL");
  assert.equal(state.hasSettled, true);
  assert.equal(state.loading, false);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].options.credentials, "omit");
  assert.equal(app.requests[0].options.headers, undefined);
});

test("overview and selected chart probes can start together; chart paint does not wait", async () => {
  const overview = mount();
  const chart = mount();
  overview.render("/api/stocks");
  chart.render(candlePath("AAPL"), 0, false);
  assert.equal(overview.requests.length, 1);
  assert.equal(chart.requests.length, 1);
  chart.requests[0].result.resolve(response(snapshot("AAPL", true)));
  await settle();
  const state = chart.render(candlePath("AAPL"), 0, false);
  assert.equal(state.data.symbol, "AAPL");
  assert.equal(state.loading, false);
  assert.equal(state.hasSettled, false);
  assert.equal(chart.requests.length, 1);
});

test("default chart miss waits for overview then re-probes shared cache exactly once", async () => {
  const app = mount();
  app.render(candlePath("AAPL"), 0, false);
  app.requests[0].result.resolve({
    ok: true,
    status: 204,
    json: () => {
      throw new Error("204 must not parse");
    },
  });
  await settle();
  assert.equal(app.requests.length, 1);
  app.render(candlePath("AAPL"), 0, true);
  assert.equal(app.requests.length, 2);
  assert.match(app.requests[1].url, /cached=true$/);
  app.requests[1].result.resolve(response(snapshot()));
  await settle();
  assert.equal(app.render(candlePath("AAPL")).hasSettled, true);
  assert.equal(app.requests.length, 2);
});

test("after missing re-probe the chart performs one ordinary refresh without looping", async () => {
  const app = mount();
  app.render(candlePath("AAPL"), 0, false);
  app.requests[0].result.resolve(response(null, 204));
  await settle();
  app.render(candlePath("AAPL"), 0, true);
  app.requests[1].result.resolve(response(null, 204));
  await settle();
  assert.equal(app.requests.length, 3);
  assert.doesNotMatch(app.requests[2].url, /cached=true/);
  app.requests[2].result.resolve(response({ symbol: "AAPL", close: 103 }));
  await settle();
  assert.equal(app.render(candlePath("AAPL")).data.close, 103);
  assert.equal(app.requests.length, 3);
});

test("stale prices stay visible through refresh failure and distinguish nonfatal error", async () => {
  const app = mount();
  app.render(candlePath("AAPL"));
  app.requests[0].result.resolve(response(snapshot("AAPL", true)));
  await settle();
  let state = app.render(candlePath("AAPL"));
  assert.equal(state.loading, false);
  assert.equal(state.refreshing, true);
  assert.equal(state.data.close, 102);
  app.requests[1].result.resolve(response({ detail: "Upstream offline" }, 503));
  await settle();
  state = app.render(candlePath("AAPL"));
  assert.equal(state.data.close, 102);
  assert.equal(state.error, "");
  assert.equal(state.refreshError, "Upstream offline");
  assert.equal(state.hasSettled, true);
  assert.equal(state.refreshing, false);
});

test("old API ignoring cached flag is not called twice", async () => {
  const app = mount();
  app.render("/api/stocks");
  app.requests[0].result.resolve(response({ stocks: [], warning: "Existing API warning" }));
  await settle();
  assert.equal(app.render("/api/stocks").hasSettled, true);
  assert.equal(app.requests.length, 1);
});

test("a cached error falls through once and a full refresh error settles waiting peers", async () => {
  const app = mount();
  app.render("/api/stocks");
  app.requests[0].result.resolve(response({ detail: "Cache failed" }, 503));
  await settle();
  app.requests[1].result.resolve(response({ detail: "Still unavailable" }, 503));
  await settle();
  const state = app.render("/api/stocks");
  assert.equal(state.data, null);
  assert.equal(state.error, "Still unavailable");
  assert.equal(state.hasSettled, true);
  assert.equal(app.requests.length, 2);
});

test("switching symbols masks old data before effects and ignores delayed body parsing", async () => {
  const app = mount();
  app.render(candlePath("AAPL"));
  const body = deferred();
  app.requests[0].result.resolve({
    ok: true,
    status: 200,
    json: () => body.promise,
  });
  await settle();
  const immediate = app.render(candlePath("MSFT"), 0, true, false);
  assert.equal(immediate.data, null);
  app.render(candlePath("MSFT"));
  assert.equal(app.requests[0].options.signal.aborted, true);
  body.resolve(snapshot());
  await settle();
  app.requests[1].result.resolve(response(snapshot("MSFT")));
  await settle();
  assert.equal(app.render(candlePath("MSFT")).data.symbol, "MSFT");
});

test("deadline includes a stalled JSON body and falls back once; full timeout settles", async () => {
  const app = mount();
  app.render("/api/stocks");
  app.requests[0].result.resolve({
    ok: true,
    status: 200,
    json: () => new Promise(() => {}),
  });
  await settle();
  app.timeout();
  await settle();
  assert.equal(app.requests[0].options.signal.aborted, true);
  assert.equal(app.requests.length, 2);
  app.timeout();
  await settle();
  const state = app.render("/api/stocks");
  assert.equal(state.hasSettled, true);
  assert.match(state.error, /timed out/);
});

test("explicit reload keeps same-symbol data, then replaces it with the new snapshot", async () => {
  const app = mount();
  app.render(candlePath("AAPL"));
  app.requests[0].result.resolve(response(snapshot()));
  await settle();
  assert.equal(app.render(candlePath("AAPL"), 1).data.close, 102);
  app.requests[1].result.resolve(response({ ...snapshot(), close: 110 }));
  await settle();
  assert.equal(app.render(candlePath("AAPL"), 1).data.close, 110);
});

test("a delayed ordinary-refresh body cannot replace a newly selected range", async () => {
  const app = mount();
  app.render(candlePath("AAPL"));
  app.requests[0].result.resolve(response(snapshot("AAPL", true)));
  await settle();
  const oldBody = deferred();
  app.requests[1].result.resolve({
    ok: true,
    status: 200,
    json: () => oldBody.promise,
  });
  await settle();

  const nextPath = candlePath("AAPL", "1d");
  assert.equal(app.render(nextPath, 0, true, false).data, null);
  app.render(nextPath);
  assert.equal(app.requests[1].options.signal.aborted, true);
  app.requests[2].result.resolve(response({ ...snapshot(), range: "1d", close: 120 }));
  await settle();
  oldBody.resolve({ ...snapshot(), range: "1m", close: 90 });
  await settle();

  const state = app.render(nextPath);
  assert.equal(state.data.range, "1d");
  assert.equal(state.data.close, 120);
  assert.equal(state.refreshError, "");
  assert.equal(state.hasSettled, true);
  assert.equal(app.requests.length, 3);
});

test("retry during a refresh preserves its snapshot and ignores the prior generation", async () => {
  const app = mount();
  const resourcePath = candlePath("AAPL");
  app.render(resourcePath);
  app.requests[0].result.resolve(response(snapshot("AAPL", true)));
  await settle();
  const oldBody = deferred();
  app.requests[1].result.resolve({
    ok: true,
    status: 200,
    json: () => oldBody.promise,
  });
  await settle();

  assert.equal(app.render(resourcePath, 1).data.close, 102);
  assert.equal(app.requests[1].options.signal.aborted, true);
  app.requests[2].result.resolve(response(snapshot("AAPL", true)));
  await settle();
  // Readiness changes must not start another ordinary request in this cycle.
  app.render(resourcePath, 1, false);
  app.render(resourcePath, 1, true);
  assert.equal(app.requests.length, 4);
  app.requests[3].result.resolve(response({ ...snapshot(), close: 110 }));
  await settle();
  oldBody.resolve({ ...snapshot(), close: 90 });
  await settle();

  const state = app.render(resourcePath, 1);
  assert.equal(state.data.close, 110);
  assert.equal(state.refreshing, false);
  assert.equal(state.hasSettled, true);
  assert.equal(state.error, "");
  assert.equal(state.refreshError, "");
  assert.equal(app.requests.length, 4);
});
