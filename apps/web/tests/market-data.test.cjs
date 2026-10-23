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
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Exercise the actual request effect and cleanup with controlled network/timers.
function mountResource() {
  let state;
  let initialized = false;
  let nextEffect;
  let dependencies;
  let cleanup;
  let nextTimer = 1;
  const timers = new Map();
  const requests = [];
  const { useMarketResource } = compile(
    "../components/useMarketResource.ts",
    {
      react: {
        useState: (initial) => {
          if (!initialized) {
            initialized = true;
            state = initial;
          }
          return [state, (next) => (state = typeof next === "function" ? next(state) : next)];
        },
        useEffect: (effect, nextDependencies) => {
          if (
            !dependencies ||
            nextDependencies.some((value, index) => value !== dependencies[index])
          ) {
            nextEffect = { effect, dependencies: nextDependencies };
          }
        },
      },
    },
    {
      process: { env: {} },
      AbortController,
      window: {
        setTimeout: (callback, delay) => {
          const id = nextTimer++;
          timers.set(id, { callback, delay });
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
      },
      fetch: (url, options) => {
        const result = deferred();
        requests.push({ url, options, result });
        return result.promise;
      },
    },
  );
  return {
    requests,
    render: (resourcePath, reload = 0, delay = 0, flush = true) => {
      const result = useMarketResource(resourcePath, reload, delay);
      if (flush && nextEffect) {
        cleanup?.();
        const pending = nextEffect;
        nextEffect = null;
        dependencies = pending.dependencies;
        cleanup = pending.effect();
      }
      return result;
    },
    runTimer: (delay) => {
      const pending = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(pending, `Expected a ${delay} ms timer`);
      timers.delete(pending[0]);
      return pending[1].callback();
    },
    pendingTimers: () => [...timers.values()].map((timer) => timer.delay),
  };
}

test("a late candle response cannot display the previous symbol's price", async () => {
  const resource = mountResource();
  const aapl = "/api/stocks/AAPL/candles";
  const msft = "/api/stocks/MSFT/candles";
  resource.render(aapl);
  resource.runTimer(0);
  resource.render(msft);
  resource.runTimer(0);
  assert.equal(resource.requests[0].options.signal.aborted, true);
  resource.requests[1].result.resolve(response({ symbol: "MSFT", close: 500 }));
  await settle();
  assert.equal(resource.render(msft).data.symbol, "MSFT");

  // Simulate a response/body parse that completes despite AbortController cancellation.
  resource.requests[0].result.resolve(response({ symbol: "AAPL", close: 200 }));
  await settle();
  assert.equal(resource.render(msft).data.symbol, "MSFT");
  assert.equal(resource.requests[1].options.credentials, "omit");
  assert.equal(resource.requests[1].options.headers, undefined);
});

test("selection hides the previous price before the next effect executes", async () => {
  const resource = mountResource();
  resource.render("/api/stocks/AAPL/candles");
  resource.runTimer(0);
  resource.requests[0].result.resolve(response({ symbol: "AAPL", close: 200 }));
  await settle();
  assert.equal(resource.render("/api/stocks/AAPL/candles").data.close, 200);
  const switched = resource.render("/api/stocks/SPX/candles", 0, 0, false);
  assert.equal(switched.data, null);
  assert.equal(switched.loading, true);
});

test("search typing is debounced and clearing search removes pending results", async () => {
  const resource = mountResource();
  resource.render("/api/stocks/search?q=NE", 0, 400);
  resource.render("/api/stocks/search?q=NET", 0, 400);
  assert.deepEqual(resource.pendingTimers(), [400]);
  resource.runTimer(400);
  assert.equal(resource.requests.length, 1);
  assert.match(resource.requests[0].url, /q=NET$/);
  const cleared = resource.render(null, 0, 400);
  assert.equal(cleared.data, null);
  assert.equal(cleared.loading, false);
  assert.equal(resource.requests[0].options.signal.aborted, true);
  resource.requests[0].result.resolve(response({ stocks: [{ symbol: "NET" }] }));
  await settle();
  assert.equal(resource.render(null, 0, 400).data, null);
  assert.deepEqual(resource.pendingTimers(), []);
});

test("a previous search response cannot replace results for the new query", async () => {
  const resource = mountResource();
  resource.render("/api/stocks/search?q=AP", 0, 400);
  resource.runTimer(400);
  resource.render("/api/stocks/search?q=MS", 0, 400);
  resource.runTimer(400);
  resource.requests[1].result.resolve(response({ stocks: [{ symbol: "MSFT" }] }));
  await settle();
  resource.requests[0].result.resolve(response({ stocks: [{ symbol: "AAPL" }] }));
  await settle();
  assert.equal(resource.render("/api/stocks/search?q=MS", 0, 400).data.stocks[0].symbol, "MSFT");
});

test("market-data failures remain unavailable and explicit retry recovers", async () => {
  const resource = mountResource();
  resource.render("/api/stocks/AAPL/candles");
  resource.runTimer(0);
  resource.requests[0].result.resolve(
    response({ detail: "Daily data is temporarily unavailable." }, 503),
  );
  await settle();
  const failed = resource.render("/api/stocks/AAPL/candles");
  assert.equal(failed.data, null);
  assert.equal(failed.error, "Daily data is temporarily unavailable.");
  resource.render("/api/stocks/AAPL/candles", 1);
  resource.runTimer(0);
  resource.requests[1].result.resolve(response({ symbol: "AAPL", close: 200 }));
  await settle();
  assert.equal(resource.render("/api/stocks/AAPL/candles", 1).data.close, 200);
});

test("a stalled request is aborted after the browser deadline", async () => {
  const resource = mountResource();
  resource.render("/api/stocks/AAPL/candles");
  resource.runTimer(0);
  resource.runTimer(30_000);
  assert.equal(resource.requests[0].options.signal.aborted, true);
});

test("index points and missing prices never appear as dollars, zero, or NaN", () => {
  const { DEFAULT_INSTRUMENTS, formatPrice, formatChange, formatFetchedAt } = compile(
    "../lib/market-data.ts",
    {},
  );
  const spx = DEFAULT_INSTRUMENTS.find((instrument) => instrument.symbol === "SPX");
  const aapl = DEFAULT_INSTRUMENTS.find((instrument) => instrument.symbol === "AAPL");
  assert.equal(formatPrice(6789.12, spx), "6,789.12");
  assert.equal(formatPrice(200, aapl), "$200.00");
  for (const missing of [null, undefined, NaN, Infinity]) {
    assert.equal(formatPrice(missing, aapl), "—");
    assert.equal(formatChange(missing), "—");
  }
  assert.equal(formatChange(-1.234), "-1.23%");
  assert.equal(formatFetchedAt("invalid"), "—");
  assert.match(formatFetchedAt("2026-10-20T20:10:00Z"), /20:10 UTC$/);
});

function renderDashboard({
  overview,
  chart,
  selectedSymbol = "AAPL",
  range = "1m",
  requests = [],
}) {
  const market = compile("../lib/market-data.ts", {});
  const selected = market.DEFAULT_INSTRUMENTS.find((item) => item.symbol === selectedSymbol) ?? {
    symbol: selectedSymbol,
    name: "Netflix",
    instrumentType: "stock",
    currency: "USD",
  };
  let stateIndex = 0;
  const { default: Dashboard } = compile("../app/page.tsx", {
    react: {
      useEffect: () => {},
      useState: (initial) => [
        stateIndex++ === 0 ? selected : stateIndex === 2 ? range : initial,
        () => {},
      ],
      useRef: (current) => ({ current }),
    },
    "react/jsx-runtime": jsxRuntime,
    "@/lib/market-data": market,
    "next-intl": intl,
    "@/lib/ui-messages": compile("../lib/ui-messages.ts", {}),
    "@/components/PreferencesProvider": {
      usePreferences: () => ({
        preferences: { theme: "dark", language: "en", defaultChartRange: "1m" },
        resolvedTheme: "dark",
      }),
    },
    "@/components/SettingsPanel": { default: () => null },
    "@/components/useMarketResource": {
      useMarketResource: (resourcePath) => {
        requests.push(resourcePath);
        if (resourcePath === "/api/stocks") return { hasSettled: !overview.loading, ...overview };
        if (resourcePath?.includes("/candles?range=")) return chart;
        return { data: null, error: "", loading: false };
      },
    },
    "@/components/AccountControls": {
      AccountControls: () => jsxRuntime.jsx("button", { children: "Sign in with Google" }),
    },
    "@/components/useWatchlist": {
      useWatchlist: () => ({ authenticated: false, items: [] }),
    },
    "@/components/PersonalWatchlist": {
      PersonalWatchlist: () => jsxRuntime.jsx("aside", { children: "My watchlist" }),
      WatchlistAction: () => jsxRuntime.jsx("button", { children: "Sign in to save" }),
    },
    "@/components/CandlestickChart": {
      CandlestickChart: () => jsxRuntime.jsx("div", { "data-chart": "rendered" }),
    },
  });
  return renderToStaticMarkup(Dashboard());
}

test("an overview outage retains all ten public instruments without inventing mock prices", () => {
  const html = renderDashboard({
    overview: { data: null, error: "Overview unavailable", loading: false },
    chart: { data: null, error: "Daily data unavailable", loading: false },
  });
  for (const symbol of [
    "SPX",
    "IXIC",
    "DJI",
    "AAPL",
    "MSFT",
    "GOOGL",
    "AMZN",
    "NVDA",
    "META",
    "TSLA",
  ]) {
    assert.match(html, new RegExp(`<strong>${symbol}</strong>`));
  }
  assert.match(html, /Overview unavailable/);
  assert.match(html, /Daily data unavailable/);
  assert.match(html, /No sign-in needed/);
  assert.doesNotMatch(html, /Mock data|Simulated prices|\$0\.00|NaN/);
});

test("the first overview settles before chart loading, including overview failures", () => {
  const pendingRequests = [];
  const html = renderDashboard({
    overview: { data: null, error: "", loading: true, hasSettled: false },
    chart: { data: null, error: "Unexpected chart request", loading: false },
    requests: pendingRequests,
  });
  assert.deepEqual(pendingRequests, ["/api/stocks", null, null]);
  assert.match(html, /Loading market data/);
  assert.doesNotMatch(html, /Unexpected chart request/);

  const failedRequests = [];
  renderDashboard({
    overview: { data: null, error: "Overview unavailable", loading: false, hasSettled: true },
    chart: { data: null, error: "Daily data unavailable", loading: false },
    requests: failedRequests,
  });
  assert.deepEqual(failedRequests, ["/api/stocks", "/api/stocks/AAPL/candles?range=1m", null]);
});

test("settled overview readiness survives its retry but belongs to its original path", async () => {
  const resource = mountResource();
  const overviewPath = "/api/stocks";
  assert.equal(resource.render(overviewPath).hasSettled, false);
  resource.runTimer(0);
  resource.requests[0].result.resolve(response({ detail: "Overview unavailable" }, 503));
  await settle();
  assert.equal(resource.render(overviewPath).hasSettled, true);
  resource.render(overviewPath, 1);
  const retrying = resource.render(overviewPath, 1);
  assert.equal(retrying.loading, true);
  assert.equal(retrying.hasSettled, true);
  assert.equal(resource.render("/api/stocks/search?q=AP").hasSettled, false);
});

test("refreshing the overview leaves an already loaded chart visible", () => {
  const requests = [];
  const html = renderDashboard({
    overview: { data: null, error: "", loading: true, hasSettled: true },
    chart: {
      data: {
        symbol: "AAPL",
        range: "1m",
        interval: "1d",
        changePercent: 5,
        name: "Apple",
        source: "yfinance",
        isMock: false,
        candles: [{ time: "2026-10-20", open: 100, high: 106, low: 100, close: 105 }],
      },
      error: "",
      loading: false,
    },
    requests,
  });
  assert.deepEqual(requests, ["/api/stocks", "/api/stocks/AAPL/candles?range=1m", null]);
  assert.match(html, /\$105\.00/);
  assert.match(html, /data-chart="rendered"/);
  assert.doesNotMatch(html, /Loading market data/);
});

test("a searched stock remains readable when the separate overview has failed", () => {
  const html = renderDashboard({
    selectedSymbol: "NFLX",
    overview: { data: null, error: "Overview unavailable", loading: false },
    chart: {
      loading: false,
      error: "",
      data: {
        symbol: "NFLX",
        range: "1m",
        interval: "1d",
        changePercent: 5,
        name: "Netflix",
        instrumentType: "stock",
        currency: "USD",
        source: "yfinance",
        isMock: false,
        isStale: true,
        isPartial: true,
        adjustment: "split_and_dividend_adjusted",
        warning: null,
        dataDate: "2026-10-20",
        fetchedAt: "2026-10-20T20:10:00Z",
        candles: [
          { time: "2026-10-19", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
          { time: "2026-10-20", open: 100, high: 106, low: 100, close: 105, volume: 1000 },
        ],
      },
    },
  });
  assert.match(html, /NFLX stock details/);
  assert.match(html, /Netflix/);
  assert.match(html, /\$105\.00/);
  assert.match(html, /\+5\.00%/);
  assert.match(html, /data-chart="rendered"/);
  assert.match(html, /Yahoo Finance · Delayed snapshot/);
  assert.match(html, /Latest candle was incomplete when fetched/);
  assert.match(html, /Cached data · Update unavailable/);
  assert.match(html, /Adjusted for splits and dividends/);
  assert.match(html, /2026-10-20/);
  assert.doesNotMatch(html, /Mock data|Simulated prices|NaN/);
});

test("all five time ranges request their own candles and retain an accurate interval label", () => {
  for (const range of ["1d", "1w", "1m", "3m", "1y"]) {
    const requests = [];
    const html = renderDashboard({
      range,
      requests,
      overview: { data: null, loading: false, error: "" },
      chart: {
        data: {
          symbol: "AAPL",
          range,
          interval: range === "1d" ? "5m" : range === "1w" ? "30m" : "1d",
          candles: [{ time: "2026-10-20", open: 100, high: 106, low: 99, close: 105 }],
          changePercent: -1.23,
        },
        loading: false,
        error: "",
      },
    });
    assert.equal(requests[1], `/api/stocks/AAPL/candles?range=${range}`);
    assert.match(html, /data-chart="rendered"/);
    assert.match(html, /-1\.23%/);
    assert.match(
      html,
      new RegExp(
        range === "1d"
          ? "5-minute candles"
          : range === "1w"
            ? "30-minute candles"
            : "Daily candles",
      ),
    );
  }
});

test("an old API response cannot masquerade as a different time range", () => {
  const html = renderDashboard({
    range: "1y",
    overview: { data: null, loading: false, error: "" },
    chart: {
      data: { symbol: "AAPL", range: "1m", candles: [{ time: "2026-10-20", close: 999 }] },
      loading: false,
      error: "",
    },
  });
  assert.doesNotMatch(html, /data-chart="rendered"|999/);
  assert.match(html, /This time range is not available yet/);
});

test("a late time-range response cannot replace a newly selected range", async () => {
  const resource = mountResource();
  const month = "/api/stocks/AAPL/candles?range=1m";
  const year = "/api/stocks/AAPL/candles?range=1y";
  resource.render(month);
  resource.runTimer(0);
  resource.render(year);
  resource.runTimer(0);
  resource.requests[1].result.resolve(response({ symbol: "AAPL", range: "1y" }));
  await settle();
  resource.requests[0].result.resolve(response({ symbol: "AAPL", range: "1m" }));
  await settle();
  assert.equal(resource.render(year).data.range, "1y");
});
