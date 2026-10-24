export type Instrument = {
  symbol: string;
  name: string;
  instrumentType: "index" | "stock";
  currency: string;
};

export type StockSummary = Instrument & {
  latestClose: number | null;
  changePercent: number | null;
  dataDate: string | null;
  fetchedAt: string | null;
  isStale: boolean;
};

export type DailyQuote = StockSummary & {
  basis: "daily_snapshot";
  interval: "1d";
  adjustment: "split_and_dividend_adjusted" | "mock";
  previousClose: number | null;
};

export type MarketOverview = {
  stocks: StockSummary[];
  source: "yfinance" | "mock";
  isMock: boolean;
  warning: string | null;
};

export type Candle = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const CHART_RANGES = ["1d", "1w", "1m", "3m", "1y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const RANGE_LABELS: Record<ChartRange, string> = {
  "1d": "Latest trading session",
  "1w": "Five trading sessions",
  "1m": "One month",
  "3m": "Three months",
  "1y": "One year",
};

export type CandleResponse = Instrument & {
  range: ChartRange;
  interval: "5m" | "30m" | "1d";
  latestClose: number | null;
  changePercent: number | null;
  // Missing on older APIs; explicit null means no canonical snapshot is available.
  quote?: DailyQuote | null;
  source: "yfinance" | "mock";
  isMock: boolean;
  candles: Candle[];
  dataDate: string | null;
  fetchedAt: string | null;
  isStale: boolean;
  isPartial: boolean;
  adjustment: "split_and_dividend_adjusted" | "mock";
  warning: string | null;
};

export function candleIntervalLabel(interval: CandleResponse["interval"]) {
  return interval === "5m"
    ? "5-minute candles"
    : interval === "30m"
      ? "30-minute candles"
      : "Daily candles";
}

export type SearchResponse = {
  stocks: Instrument[];
  source: "yfinance" | "mock";
  isMock: boolean;
  warning: string | null;
};

// Metadata keeps the public overview usable during an outage; prices always come from the API.
export const DEFAULT_INSTRUMENTS: Instrument[] = [
  { symbol: "SPX", name: "S&P 500", instrumentType: "index", currency: "USD" },
  { symbol: "IXIC", name: "Nasdaq Composite", instrumentType: "index", currency: "USD" },
  { symbol: "DJI", name: "Dow Jones Industrial Average", instrumentType: "index", currency: "USD" },
  { symbol: "AAPL", name: "Apple", instrumentType: "stock", currency: "USD" },
  { symbol: "MSFT", name: "Microsoft", instrumentType: "stock", currency: "USD" },
  { symbol: "GOOGL", name: "Alphabet", instrumentType: "stock", currency: "USD" },
  { symbol: "AMZN", name: "Amazon", instrumentType: "stock", currency: "USD" },
  { symbol: "NVDA", name: "NVIDIA", instrumentType: "stock", currency: "USD" },
  { symbol: "META", name: "Meta Platforms", instrumentType: "stock", currency: "USD" },
  { symbol: "TSLA", name: "Tesla", instrumentType: "stock", currency: "USD" },
];

export function formatPrice(
  value: number | null | undefined,
  instrument: Instrument,
  locale = "en",
) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (instrument.instrumentType === "index")
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: instrument.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatChange(value: number | null | undefined, locale = "en") {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "always",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatFetchedAt(value: string | null | undefined, locale = "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return `${new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date)} UTC`;
}
