const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const { renderToStaticMarkup } = require("react-dom/server");
const jsxRuntime = require("react/jsx-runtime");
const { createTranslator } = require("next-intl");
const catalogs = { en: require("../messages/en.json"), zh: require("../messages/zh.json") };

function compile(file, imports = {}) {
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
  });
  return module.exports;
}
const lib = compile("../lib/instrument-metrics.ts");
const instrument = { symbol: "AAPL", name: "Apple", instrumentType: "stock", currency: "USD" };
const candle = (time, volume) => ({ time, volume, open: 1, high: 2, low: 1, close: 2 });
const candles = (entries, overrides = {}) => ({
  ...instrument,
  interval: "1d",
  range: "1m",
  dataDate: "2026-10-22",
  fetchedAt: "2026-10-22T19:00:00Z",
  isPartial: false,
  candles: entries,
  ...overrides,
});
const fundamentals = (overrides = {}) => ({
  symbol: "AAPL",
  trailingPE: 29.87,
  marketCap: 1_230_000_000,
  currency: "CAD",
  fetchedAt: "2026-10-22T10:00:00Z",
  source: "yfinance",
  isMock: false,
  isStale: false,
  warning: null,
  ...overrides,
});

test("daily volume uses the latest session rather than summing the selected chart range", () => {
  const result = lib.latestSessionVolume(
    instrument,
    candles([candle("2026-10-21", 500), candle("2026-10-22", 100)]),
  );
  assert.equal(result.value, 100);
  assert.equal(result.date, "2026-10-22");
});

test("intraday volume sums only the latest New York session, including UTC midnight correctly", () => {
  const epoch = (value) => Date.parse(value) / 1000;
  const result = lib.latestSessionVolume(
    instrument,
    candles(
      [
        candle(epoch("2026-10-21T18:00:00Z"), 1000),
        candle(epoch("2026-10-22T18:00:00Z"), 10),
        candle(epoch("2026-10-22T19:00:00Z"), 20),
        candle(epoch("2026-10-23T00:00:00Z"), 30),
      ],
      { interval: "30m", range: "1w", isPartial: true },
    ),
  );
  assert.equal(result.value, 60);
  assert.equal(result.date, "2026-10-22");
  assert.equal(result.isPartial, true);
});

test("missing, invalid, or overflowing volume stays unavailable while an explicit zero is valid", () => {
  for (const value of [undefined, null, -1, NaN, Infinity]) {
    assert.equal(
      lib.latestSessionVolume(instrument, candles([candle("2026-10-22", value)])).value,
      null,
    );
  }
  assert.equal(lib.latestSessionVolume(instrument, candles([candle("2026-10-22", 0)])).value, 0);
  const epoch = Date.parse("2026-10-22T18:00:00Z") / 1000;
  const incomplete = candles([candle(epoch, 20), candle(epoch + 300, undefined)], {
    interval: "5m",
  });
  assert.equal(lib.latestSessionVolume(instrument, incomplete).value, null);
  assert.equal(
    lib.latestSessionVolume(
      instrument,
      candles([candle(epoch, Number.MAX_VALUE), candle(epoch + 300, Number.MAX_VALUE)], {
        interval: "5m",
      }),
    ).value,
    null,
  );
});

test("index, wrong-symbol, and unknown-date candles cannot produce a share volume", () => {
  assert.equal(
    lib.latestSessionVolume(
      { ...instrument, instrumentType: "index" },
      candles([candle("2026-10-22", 100)]),
    ).value,
    null,
  );
  assert.equal(
    lib.latestSessionVolume(instrument, candles([candle("2026-10-22", 100)], { symbol: "MSFT" }))
      .value,
    null,
  );
  for (const date of ["2026-02-30", "2026-10-22T00:00:00Z", "invalid"]) {
    assert.equal(lib.latestSessionVolume(instrument, candles([candle(date, 100)])).value, null);
  }
});

test("fundamentals preserve their own currency and reject misleading PE, cap, or symbol values", () => {
  const valid = lib.readInstrumentMetrics(fundamentals(), "AAPL");
  assert.equal(valid.trailingPE, 29.87);
  assert.equal(valid.currency, "CAD");
  assert.match(lib.formatMarketCap(valid.marketCap, valid.currency, "en"), /CA\$/);
  assert.match(lib.formatMarketCap(valid.marketCap, valid.currency, "zh"), /CA\$/);
  for (const value of [0, -2, NaN, Infinity, "30"]) {
    assert.equal(
      lib.readInstrumentMetrics(fundamentals({ trailingPE: value }), "AAPL").trailingPE,
      null,
    );
    assert.equal(
      lib.readInstrumentMetrics(fundamentals({ marketCap: value }), "AAPL").marketCap,
      null,
    );
  }
  assert.equal(lib.readInstrumentMetrics(fundamentals({ symbol: "MSFT" }), "AAPL"), null);
  assert.equal(lib.readInstrumentMetrics(fundamentals({ currency: null }), "AAPL").marketCap, null);
  const simulated = lib.readInstrumentMetrics(fundamentals({ isMock: true }), "AAPL");
  assert.equal(simulated.trailingPE, null);
  assert.equal(simulated.marketCap, null);
});

function renderMetrics({
  candleData = null,
  selected = instrument,
  resource = {},
  locale = "en",
} = {}) {
  const requests = [];
  const refs = [];
  let refIndex = 0;
  const { InstrumentMetrics } = compile("../components/InstrumentMetrics.tsx", {
    react: {
      useState: (initial) => [initial, () => {}],
      useRef: (current) => {
        const slot = refIndex++;
        refs[slot] ??= { current };
        return refs[slot];
      },
    },
    "react/jsx-runtime": jsxRuntime,
    "next-intl": {
      useLocale: () => locale,
      useTranslations: () => createTranslator({ locale, messages: catalogs[locale] }),
    },
    "@/components/useCachedMarketResource": {
      useCachedMarketResource: (resourcePath) => {
        requests.push(resourcePath);
        return {
          data: null,
          error: "",
          refreshError: "",
          loading: false,
          refreshing: false,
          ...resource,
        };
      },
    },
    "@/lib/market-data": compile("../lib/market-data.ts"),
    "@/lib/instrument-metrics": lib,
    "@/lib/ui-messages": compile("../lib/ui-messages.ts"),
    "./InstrumentMetrics.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_target, name) => name }),
    },
  });
  function render(next = {}) {
    if ("selected" in next) selected = next.selected;
    if ("candleData" in next) candleData = next.candleData;
    refIndex = 0;
    return renderToStaticMarkup(InstrumentMetrics({ instrument: selected, candleData }));
  }
  return { html: render(), requests, render };
}

test("the unified statistics group preserves the latest chart prices and independent fundamentals", () => {
  const latest = {
    time: "2026-10-22",
    open: 1234.5,
    high: 1345.67,
    low: 1200.01,
    close: 1300.9,
    volume: 125000,
  };
  const { html, requests } = renderMetrics({
    candleData: candles([candle("2026-10-21", 500), latest]),
    resource: { data: fundamentals() },
  });
  const entries = [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((match) => [
    match[1],
    match[2],
  ]);
  assert.equal((html.match(/<dl\b/g) ?? []).length, 1);
  assert.deepEqual(entries, [
    ["OPEN", "1,234.50"],
    ["HIGH", "1,345.67"],
    ["LOW", "1,200.01"],
    ["CLOSE", "1,300.90"],
    ["P/E (TTM)", "29.87"],
    ["Trading-session volume", "125K"],
    ["Market cap", "CA$1.23B"],
  ]);
  assert.deepEqual(requests, ["/api/stocks/AAPL/metrics"]);
});

test("the unified group never shows another instrument's candle prices", () => {
  const { html } = renderMetrics({
    candleData: candles([candle("2026-10-22", 125000)], { symbol: "MSFT" }),
    resource: { data: fundamentals({ symbol: "MSFT" }) },
  });
  const values = [...html.matchAll(/<dd>(.*?)<\/dd>/g)].map((match) => match[1]);
  assert.deepEqual(values, Array(7).fill("—"));
});

test("fundamentals wait for the selected chart and never start an index request", () => {
  const chart = candles([candle("2026-10-22", 100)]);
  for (const options of [
    {},
    { candleData: { ...chart, symbol: "MSFT" } },
    { candleData: { ...chart, candles: [] } },
    { candleData: chart, selected: { ...instrument, instrumentType: "index" } },
  ]) {
    const rendered = renderMetrics(options);
    assert.deepEqual(rendered.requests, [null]);
    assert.doesNotMatch(rendered.html, /Loading fundamentals/);
  }
  assert.deepEqual(renderMetrics({ candleData: chart }).requests, ["/api/stocks/AAPL/metrics"]);
});

test("chart range changes retain the same fundamentals path but a new unloaded symbol waits", () => {
  const chart = candles([candle("2026-10-22", 100)]);
  const view = renderMetrics({ candleData: chart, resource: { data: fundamentals() } });
  const loadingRange = view.render({ candleData: null });
  assert.match(loadingRange, /29\.87/);
  view.render({ candleData: { ...chart, range: "1y" } });
  assert.deepEqual(view.requests, Array(3).fill("/api/stocks/AAPL/metrics"));
  const microsoft = { ...instrument, symbol: "MSFT", name: "Microsoft" };
  view.render({ selected: microsoft, candleData: null });
  assert.equal(view.requests.at(-1), null);
  view.render({ candleData: { ...chart, ...microsoft } });
  assert.equal(view.requests.at(-1), "/api/stocks/MSFT/metrics");
  view.render({ candleData: null });
  assert.equal(view.requests.at(-1), "/api/stocks/MSFT/metrics");
  view.render({ selected: instrument, candleData: null });
  assert.equal(view.requests.at(-1), null);
});

test("an unavailable fundamentals request keeps existing volume visible and offers a discreet retry", () => {
  const { html } = renderMetrics({
    candleData: candles([candle("2026-10-22", 125000)]),
    resource: { error: "Market data is temporarily unavailable. Please try again later." },
  });
  assert.match(html, /125K/);
  assert.match(html, /Fundamentals unavailable/);
  assert.match(html, />Retry<\/button>/);
  assert.doesNotMatch(html, /temporarily unavailable\. Please try again later/);
});

test("cached fundamentals retain their own timestamp and currency while Chinese labels translate", () => {
  const { html } = renderMetrics({
    locale: "zh",
    candleData: candles([candle("2026-10-22", 125000)], { isPartial: true }),
    resource: { data: fundamentals({ isStale: true }), refreshing: true },
  });
  assert.match(html, /<dt>开盘<\/dt><dd>1\.00<\/dd>/);
  assert.match(html, /<dt>最高<\/dt><dd>2\.00<\/dd>/);
  assert.match(html, /<dt>最低<\/dt><dd>1\.00<\/dd>/);
  assert.match(html, /<dt>收盘<\/dt><dd>2\.00<\/dd>/);
  assert.match(html, /市盈率（TTM）/);
  assert.match(html, /29\.87/);
  assert.match(html, /CAD/);
  assert.match(html, /10:00 UTC/);
  assert.match(html, /19:00 UTC/);
  assert.match(html, /正在更新基本面/);
  assert.match(html, /成交量为不完整快照/);
  assert.match(html, /基本面使用缓存数据/);
});
