const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

const filename = path.join(__dirname, "../lib/market-quotes.ts");
const { code } = transformSync(readFileSync(filename, "utf8"), {
  filename,
  jsc: { parser: { syntax: "typescript" }, target: "es2022" },
  module: { type: "commonjs" },
});
const moduleFixture = { exports: {} };
vm.runInNewContext(code, { module: moduleFixture, exports: moduleFixture.exports });
const { readCandleQuote, readOverviewQuote, preferQuote } = moduleFixture.exports;
const instrument = { symbol: "MSFT", name: "Microsoft", instrumentType: "stock", currency: "USD" };
const quote = (changes = {}) => ({
  ...instrument,
  latestClose: 524.51,
  changePercent: 0.66,
  dataDate: "2026-10-23",
  fetchedAt: "2026-10-23T20:10:00Z",
  isStale: false,
  basis: "daily_snapshot",
  interval: "1d",
  adjustment: "split_and_dividend_adjusted",
  previousClose: 521.07,
  ...changes,
});

test("nested daily snapshot overrides every historical range without changing OHLC", () => {
  for (const range of ["1d", "1w", "1m", "3m", "1y"]) {
    const history = {
      ...quote({ latestClose: 524.53, changePercent: 0.56 }),
      range,
      interval: range === "1d" ? "5m" : range === "1w" ? "30m" : "1d",
      candles: [{ time: "2026-10-23", close: 524.53 }],
      quote: quote(),
    };
    const before = JSON.stringify(history);
    const result = readCandleQuote(history, instrument);
    assert.equal(result.latestClose, 524.51);
    assert.equal(result.changePercent, 0.66);
    assert.equal(result.previousClose, 521.07);
    assert.equal(result.candles, undefined);
    assert.equal(JSON.stringify(history), before);
  }
});

test("only a legacy 1M daily response can supply a fallback quote", () => {
  assert.equal(readCandleQuote({ ...quote(), range: "1m" }, instrument).latestClose, 524.51);
  for (const [range, interval] of [
    ["1d", "5m"],
    ["1w", "30m"],
    ["3m", "1d"],
    ["1y", "1d"],
    ["1m", "5m"],
  ]) {
    assert.equal(readCandleQuote({ ...quote(), range, interval }, instrument), null);
  }
  assert.equal(readCandleQuote({ ...quote(), range: "1m", quote: null }, instrument), null);
  assert.equal(
    readCandleQuote(
      { ...quote(), range: "1m", quote: { ...quote(), basis: "intraday" } },
      instrument,
    ),
    null,
  );
});

test("malformed nested identity, basis, dates and nonfinite prices cannot become current quotes", () => {
  for (const changes of [
    { symbol: "AAPL" },
    { currency: "CAD" },
    { interval: "5m" },
    { basis: "other" },
    { latestClose: NaN },
    { latestClose: 0 },
    { changePercent: Infinity },
    { previousClose: -1 },
    { adjustment: "unknown" },
    { dataDate: "2026-02-30" },
    { fetchedAt: "not-a-date" },
    { isStale: "false" },
  ])
    assert.equal(
      readCandleQuote({ symbol: "MSFT", range: "1d", quote: quote(changes) }, instrument),
      null,
    );
  assert.equal(readCandleQuote({ symbol: "AAPL", quote: quote() }, instrument), null);
});

test("market session date wins over a more recent fetch of an older session", () => {
  const latest = quote();
  const olderSession = quote({
    dataDate: "2026-10-22",
    fetchedAt: "2026-10-24T22:00:00Z",
    latestClose: 500,
  });
  assert.equal(preferQuote(latest, olderSession), latest);
  const newerSession = quote({
    dataDate: "2026-10-26",
    fetchedAt: "2026-10-23T18:00:00Z",
    latestClose: 530,
  });
  assert.equal(preferQuote(latest, newerSession), newerSession);
});

test("same-session fetch ordering and missing responses retain the best real snapshot", () => {
  const latest = quote();
  assert.equal(
    preferQuote(latest, quote({ fetchedAt: "2026-10-23T18:00:00Z", latestClose: 510 })),
    latest,
  );
  assert.equal(preferQuote(latest, null), latest);
  assert.equal(preferQuote(latest, quote({ latestClose: null, changePercent: null })), latest);
  assert.equal(preferQuote(undefined, quote({ latestClose: null })), undefined);
  assert.equal(
    preferQuote(latest, quote({ fetchedAt: "2026-10-23T20:15:00Z", latestClose: 525 })).latestClose,
    525,
  );
  const summary = readOverviewQuote(quote(), instrument);
  assert.equal(summary.previousClose, null);
  assert.equal(preferQuote(latest, summary), latest);
});

test("summary metadata is validated even when the caller receives an untyped overview row", () => {
  for (const changes of [
    { instrumentType: undefined },
    { instrumentType: "crypto" },
    { currency: undefined },
    { currency: "not-a-currency" },
    { symbol: undefined },
  ]) {
    const row = quote(changes);
    assert.equal(readOverviewQuote(row, row), null);
  }
});

test("expiry of the same snapshot remains stale until a newer snapshot is fetched", () => {
  const fresh = quote();
  const expired = quote({ isStale: true });
  const observed = preferQuote(fresh, expired);
  assert.equal(observed.isStale, true);
  assert.equal(observed.latestClose, fresh.latestClose);
  assert.equal(preferQuote(observed, fresh).isStale, true);
  assert.equal(preferQuote(observed, readOverviewQuote(fresh, instrument)).isStale, true);
  assert.equal(preferQuote(observed, quote({ fetchedAt: "2026-10-23T20:20:00Z" })).isStale, false);
});
