/** Client-only public valuation arithmetic and opt-in holdings reader. */
import { same } from "../../dist/core.mjs";
import validators from "./validators.cjs";
import { need, unique, time, date, validateShape } from "./validation.mjs";
import { holdingsFacts } from "./holdings.mjs";
import { decimal, add, multiply, plain, divide, crossRate } from "./decimal.mjs";
export { crossRate } from "./decimal.mjs";
export {
  HOLDINGS_FACTS_PROFILE,
  holdingsFacts,
  holdingsPrivate,
  openHoldings,
  sealHoldingsFacts,
} from "./holdings.mjs";
export const VALUATION_CONTRACT = "folioview.valuation.v1";
export const DEFAULT_PREFERENCES = Object.freeze({
  defaultPortfolioCurrency: "USD",
  language: "en",
  theme: "light",
  defaultChartRange: "1m",
});
const instrumentKey = (i) => JSON.stringify([i.symbol, i.market, i.currency]);
const pairKey = (i) => JSON.stringify([i.base, i.quote]);
const positive = (value) => {
  const result = decimal(value);
  need(result.n > 0n);
  return result;
};
export function validateValuation(name, value) {
  if (name === "HoldingsFactsContent") return holdingsFacts(value);
  need(Object.hasOwn(validators, name));
  const result = validateShape(validators[name], value);
  if (name === "Timestamp") time(result);
  if (name === "Date") date(result);
  return result;
}
export function quoteRequest(value) {
  const result = validateValuation("QuoteRequest", value);
  result.instruments = [...new Map(result.instruments.map((i) => [instrumentKey(i), i])).values()];
  return result;
}
export function fxRequest(value) {
  const result = validateValuation("FxRequest", value);
  result.pairs = [...new Map(result.pairs.map((i) => [pairKey(i), i])).values()];
  return result;
}
function itemTime(item, batch) {
  need(time(item.fetchedAt) <= time(batch.fetchedAt));
  need(item.sourceAsOf === null || time(item.sourceAsOf) <= time(item.fetchedAt));
  need(item.sourceDate === null || item.sourceDate <= item.fetchedAt.slice(0, 10));
}
export function quoteBatch(value, requested = null) {
  const result = validateValuation("QuoteBatch", value);
  const keys = result.items.map((i) => instrumentKey(i.instrument));
  unique(keys);
  if (requested !== null)
    need(
      same(
        [...keys].sort(),
        quoteRequest({ instruments: requested }).instruments.map(instrumentKey).sort(),
      ),
    );
  for (const item of result.items) {
    itemTime(item, result);
    if (["available", "stale"].includes(item.status)) {
      positive(item.price);
      need(
        item.source === "yahoo_finance" &&
          item.sourceAsOf !== null &&
          item.reason === null &&
          item.instrument.market !== "UNKNOWN",
      );
    } else need(item.price === null && item.reason !== null);
  }
  return result;
}
export function fxBatch(value, requested = null) {
  const result = validateValuation("FxBatch", value),
    dates = new Set();
  const keys = result.items.map(pairKey);
  unique(keys);
  if (requested !== null)
    need(same([...keys].sort(), fxRequest({ pairs: requested }).pairs.map(pairKey).sort()));
  for (const item of result.items) {
    itemTime(item, result);
    if (!["available", "stale"].includes(item.status)) {
      need(item.rate === null && item.route === null && item.reason !== null);
      continue;
    }
    const rate = positive(item.rate),
      { base, quote, route } = item;
    need(route !== null && item.reason === null);
    if (base === quote) {
      need(
        plain(rate) === "1" &&
          item.source === "identity" &&
          item.status === "available" &&
          same(route, { kind: "identity", via: null, legs: [] }) &&
          item.sourceDate === null &&
          item.sourceAsOf === null,
      );
      continue;
    }
    need(item.source === "bank_of_canada" && item.sourceDate !== null);
    dates.add(item.sourceDate);
    for (const leg of route.legs) {
      positive(leg.rate);
      need(leg.sourceDate === item.sourceDate && leg.quote === "CAD" && leg.base !== "CAD");
    }
    let expected;
    if (quote === "CAD") {
      need(
        route.kind === "direct" &&
          route.via === null &&
          route.legs.length === 1 &&
          route.legs[0].base === base,
      );
      expected = crossRate(route.legs[0].rate, "1");
    } else if (base === "CAD") {
      need(
        route.kind === "inverse" &&
          route.via === null &&
          route.legs.length === 1 &&
          route.legs[0].base === quote,
      );
      expected = crossRate("1", route.legs[0].rate);
    } else {
      need(
        route.kind === "cross" &&
          route.via === "CAD" &&
          route.legs.length === 2 &&
          same(
            route.legs.map((l) => l.base),
            [base, quote],
          ),
      );
      expected = crossRate(route.legs[0].rate, route.legs[1].rate);
    }
    need(plain(rate) === expected);
  }
  need(dates.size <= 1);
  return result;
}
function snapshot(value, schema) {
  const result = validateValuation(schema, value);
  need((result.version === 0) === (result.preferences === null));
  return result;
}
export function currencySnapshot(value) {
  const result = snapshot(value, "CurrencyPreferencesSnapshot");
  need(
    (result.currencyGeneration === 0) === (result.preferences === null) &&
      result.currencyGeneration <= result.version,
  );
  return result;
}
export function resolvePreferences(ui, currency) {
  return {
    ...DEFAULT_PREFERENCES,
    ...(snapshot(ui, "UiPreferencesSnapshotV1").preferences ?? {}),
    ...(currencySnapshot(currency).preferences ?? {}),
  };
}
export function fxPreferences(value) {
  const result = validateValuation("FxPreferences", value);
  unique(result.pairs.map(pairKey));
  need(result.pairs.every((p) => p.base !== p.quote));
  need(result.suppressedDefault === null || result.suppressedDefault.currency !== "USD");
  return result;
}
export function fxPreferencesSnapshot(value) {
  const result = snapshot(value, "FxPreferencesSnapshot");
  if (result.preferences !== null) fxPreferences(result.preferences);
  return result;
}
export function effectiveFxPairs(preferences, currency) {
  const current = fxPreferencesSnapshot(preferences).preferences ?? {
    pairs: [],
    suppressedDefault: null,
  };
  const manual = current.pairs.map((p) => ({ ...p, origin: "manual" }));
  if (currency === null) return manual;
  const selection = currencySnapshot(currency),
    code = (selection.preferences ?? DEFAULT_PREFERENCES).defaultPortfolioCurrency;
  if (
    code === "USD" ||
    same(current.suppressedDefault, {
      currency: code,
      currencyGeneration: selection.currencyGeneration,
    }) ||
    manual.some((p) => p.base === "USD" && p.quote === code)
  )
    return manual;
  return [{ base: "USD", quote: code, origin: "default" }, ...manual];
}
export function displayCurrencies(holdings, defaultCurrency) {
  const result = [validateValuation("Currency", defaultCurrency)];
  for (const a of holdingsFacts(holdings).data.accounts)
    for (const p of a.positions)
      if (!result.includes(p.instrument.currency)) result.push(p.instrument.currency);
  return result;
}
export function valueHoldings(holdings, quotes, fx, displayCurrency) {
  holdings = holdingsFacts(holdings);
  quotes = quoteBatch(quotes);
  fx = fxBatch(fx);
  validateValuation("Currency", displayCurrency);
  const prices = new Map(quotes.items.map((i) => [instrumentKey(i.instrument), i])),
    rates = new Map(fx.items.map((i) => [pairKey(i), i]));
  const rows = [];
  let subtotal = { n: 0n, s: 0 };
  for (const a of holdings.data.accounts)
    for (const p of a.positions) {
      const instrument = p.instrument,
        quote = prices.get(instrumentKey(instrument)),
        rate = rates.get(pairKey({ base: instrument.currency, quote: displayCurrency })),
        sameCurrency = instrument.currency === displayCurrency;
      let status =
        instrument.market === "UNKNOWN" ||
        instrument.symbol === null ||
        p.assetType === "unsupported"
          ? "unresolved"
          : !quote || !["available", "stale"].includes(quote.status)
            ? "missing_quote"
            : !sameCurrency && (!rate || !["available", "stale"].includes(rate.status))
              ? "missing_fx"
              : "valued";
      let value = null,
        stale = false;
      if (decimal(p.quantity).n === 0n) {
        status = "valued";
        value = "0";
      } else if (status === "valued") {
        const amount = multiply(
          multiply(decimal(p.quantity), positive(quote.price)),
          sameCurrency ? decimal("1") : positive(rate.rate),
        );
        subtotal = add(subtotal, amount);
        value = plain(amount);
        stale = quote.status === "stale" || (!sameCurrency && rate.status === "stale");
      }
      rows.push({
        accountId: a.accountId,
        assetId: p.assetId,
        status,
        value,
        weightPercent: null,
        stale,
      });
    }
  for (const row of rows)
    if (row.value !== null && subtotal.n !== 0n)
      row.weightPercent = plain(
        divide(multiply(decimal(row.value, true), decimal("100")), subtotal, 6),
      );
  const valuedCount = rows.filter((r) => r.value !== null).length;
  return {
    currency: displayCurrency,
    subtotal: valuedCount || !rows.length ? plain(subtotal) : null,
    complete: valuedCount === rows.length,
    valuedCount,
    positionCount: rows.length,
    stale: rows.some((r) => r.stale),
    quoteSnapshotId: quotes.snapshotId,
    fxSnapshotId: fx.snapshotId,
    rows,
  };
}
export function roundDisplayAmount(value, currency) {
  validateValuation("Currency", currency);
  return plain(divide(decimal(value, true), decimal("1"), currency === "JPY" ? 0 : 2), true);
}
