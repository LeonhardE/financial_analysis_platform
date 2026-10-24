import type { DailyQuote, Instrument, StockSummary } from "./market-data";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown) => finite(value) && (value as number) > 0;

function readSummary(value: unknown, instrument: Instrument): StockSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.symbol !== "string" ||
    !/^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?$/.test(row.symbol) ||
    !["stock", "index"].includes(String(row.instrumentType)) ||
    typeof row.currency !== "string" ||
    !/^[A-Z]{3}$/.test(row.currency) ||
    row.symbol !== instrument.symbol ||
    row.instrumentType !== instrument.instrumentType ||
    row.currency !== instrument.currency ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    row.name.length > 200 ||
    !(row.latestClose === null || positive(row.latestClose)) ||
    !(row.changePercent === null || finite(row.changePercent)) ||
    !(
      row.dataDate === null ||
      (typeof row.dataDate === "string" &&
        DATE.test(row.dataDate) &&
        Number.isFinite(Date.parse(row.dataDate)) &&
        new Date(row.dataDate).toISOString().slice(0, 10) === row.dataDate)
    ) ||
    !(
      row.fetchedAt === null ||
      (typeof row.fetchedAt === "string" &&
        row.fetchedAt.length <= 40 &&
        Number.isFinite(Date.parse(row.fetchedAt)))
    ) ||
    typeof row.isStale !== "boolean"
  )
    return null;
  return {
    ...instrument,
    name: row.name,
    latestClose: row.latestClose as number | null,
    changePercent: row.changePercent as number | null,
    dataDate: row.dataDate as string | null,
    fetchedAt: row.fetchedAt as string | null,
    isStale: row.isStale,
  };
}

/** The overview has always used the canonical 1M daily snapshot. */
export function readOverviewQuote(
  value: unknown,
  instrument: Instrument,
  mock = false,
): DailyQuote | null {
  const summary = readSummary(value, instrument);
  return summary
    ? {
        ...summary,
        basis: "daily_snapshot",
        interval: "1d",
        adjustment: mock ? "mock" : "split_and_dividend_adjusted",
        previousClose: null,
      }
    : null;
}

/** Candle ranges describe history, not competing current quotes. */
export function readCandleQuote(value: unknown, instrument: Instrument): DailyQuote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.symbol !== instrument.symbol) return null;
  if (Object.hasOwn(row, "quote")) {
    if (!row.quote || typeof row.quote !== "object" || Array.isArray(row.quote)) return null;
    const quote = row.quote as Record<string, unknown>;
    if (
      quote.basis !== "daily_snapshot" ||
      quote.interval !== "1d" ||
      !["split_and_dividend_adjusted", "mock"].includes(String(quote.adjustment)) ||
      !(quote.previousClose === null || positive(quote.previousClose))
    )
      return null;
    const summary = readSummary(quote, instrument);
    return summary
      ? {
          ...summary,
          basis: "daily_snapshot",
          interval: "1d",
          adjustment: quote.adjustment as DailyQuote["adjustment"],
          previousClose: quote.previousClose as number | null,
        }
      : null;
  }
  // Backward compatibility is intentionally limited to the canonical daily
  // range. Intraday and other historical caches must never seed current prices.
  if (row.range !== "1m" || row.interval !== "1d") return null;
  return readOverviewQuote(row, instrument, row.isMock === true);
}

export function hasQuote(quote: DailyQuote | null | undefined): quote is DailyQuote {
  return Boolean(quote && positive(quote.latestClose));
}

/** Compare market date before fetch time: a newly fetched older session loses. */
export function preferQuote(
  previous: DailyQuote | null | undefined,
  candidate: DailyQuote | null | undefined,
): DailyQuote | undefined {
  if (!hasQuote(candidate)) return previous ?? undefined;
  if (!hasQuote(previous)) return candidate;
  if (previous.symbol !== candidate.symbol) return previous;
  const dateOrder = (candidate.dataDate ?? "").localeCompare(previous.dataDate ?? "");
  if (dateOrder < 0) return previous;
  if (dateOrder > 0) return candidate;
  const timestamp = (quote: DailyQuote) => (quote.fetchedAt ? Date.parse(quote.fetchedAt) : 0);
  if (timestamp(candidate) < timestamp(previous)) return previous;
  if (timestamp(candidate) > timestamp(previous)) return candidate;
  // Staleness is an observation of this same snapshot, not a competing price.
  // Once the server observes expiry, an older fresh seed must not clear it.
  // A genuinely newer market date/fetch above can establish freshness again.
  const winner =
    previous.previousClose !== null && candidate.previousClose === null ? previous : candidate;
  return previous.isStale || candidate.isStale
    ? winner.isStale
      ? winner
      : { ...winner, isStale: true }
    : winner;
}
