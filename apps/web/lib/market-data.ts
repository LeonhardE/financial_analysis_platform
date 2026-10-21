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

export type MarketOverview = {
  stocks: StockSummary[];
  source: "yfinance" | "mock";
  isMock: boolean;
  warning: string | null;
};

export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandleResponse = Instrument & {
  range: "1m";
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

const decimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPrice(value: number | null | undefined, instrument: Instrument) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (instrument.instrumentType === "index") return decimal.format(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: instrument.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatChange(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatFetchedAt(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return `${new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date)} UTC`;
}
