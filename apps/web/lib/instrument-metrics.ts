import type { CandleResponse, Instrument } from "@/lib/market-data";

export type InstrumentMetrics = {
  symbol: string;
  trailingPE: number | null;
  marketCap: number | null;
  currency: string | null;
  fetchedAt: string | null;
  source: "yfinance" | "mock";
  isMock: boolean;
  isStale: boolean;
  warning: string | null;
};

const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const newYorkSession = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function readInstrumentMetrics(value: unknown, symbol: string): InstrumentMetrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.symbol !== symbol ||
    !["yfinance", "mock"].includes(String(data.source)) ||
    typeof data.isMock !== "boolean" ||
    typeof data.isStale !== "boolean"
  ) {
    return null;
  }
  const currency =
    typeof data.currency === "string" && /^[A-Z]{3}$/.test(data.currency) ? data.currency : null;
  const fetchedAt =
    typeof data.fetchedAt === "string" && Number.isFinite(new Date(data.fetchedAt).getTime())
      ? data.fetchedAt
      : null;
  const isMock = data.source === "mock" || data.isMock;
  return {
    symbol,
    trailingPE: isMock ? null : positive(data.trailingPE),
    marketCap: isMock || !currency ? null : positive(data.marketCap),
    currency,
    fetchedAt,
    source: data.source as InstrumentMetrics["source"],
    isMock,
    isStale: data.isStale,
    warning: typeof data.warning === "string" ? data.warning : null,
  };
}

function sessionDate(time: string | number, intraday: boolean) {
  if (!intraday) {
    if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(time)) return null;
    const date = new Date(`${time}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === time
      ? time
      : null;
  }
  if (typeof time !== "number" || !Number.isFinite(time)) return null;
  const date = new Date(time * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = newYorkSession.formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
}

/** Daily bars use one session; intraday bars sum only the latest New York session. */
export function latestSessionVolume(instrument: Instrument, data: CandleResponse | null) {
  const unavailable = { value: null, date: null, isPartial: false };
  if (instrument.instrumentType !== "stock" || data?.symbol !== instrument.symbol) {
    return unavailable;
  }
  const intraday = data.interval !== "1d";
  const dated = data.candles.map((candle) => ({
    candle,
    date: sessionDate(candle.time, intraday),
  }));
  // Unknown timestamps prevent identifying the latest session reliably.
  if (!dated.length || dated.some((item) => !item.date)) return unavailable;
  const date = dated.reduce((latest, item) => (item.date! > latest ? item.date! : latest), "");
  const latest = dated.filter((item) => item.date === date);
  const volumes = (intraday ? latest : latest.slice(-1)).map((item) => item.candle.volume);
  const valid = volumes.every(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  const total = valid ? volumes.reduce((sum, value) => sum + value, 0) : null;
  return {
    value: total !== null && Number.isFinite(total) ? total : null,
    date,
    isPartial: data.isPartial,
  };
}

export function formatMetricNumber(value: number | null, locale: string, compact = false) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    ...(compact ? { notation: "compact" } : {}),
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatMarketCap(value: number | null, currency: string | null, locale: string) {
  if (value === null || !currency || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return "—";
  }
}
