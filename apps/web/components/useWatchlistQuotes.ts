"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CandleResponse, Instrument, MarketOverview, StockSummary } from "@/lib/market-data";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const MEMORY_TTL = 5 * 60_000;
const REQUEST_TIMEOUT = 15_000;
const SYMBOL = /^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?$/;

type Options = {
  items: Instrument[];
  overview: MarketOverview | null;
  selectedQuote: CandleResponse | null;
  active: boolean;
  owner: string | null;
  refreshKey: number;
};
type CachedQuote = { quote: StockSummary; freshUntil: number };
type Job = { controller: AbortController; cancel: () => void };

function readQuote(value: unknown, instrument: Instrument): StockSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.symbol !== instrument.symbol ||
    row.instrumentType !== instrument.instrumentType ||
    row.currency !== instrument.currency ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    row.name.length > 200 ||
    !(
      row.latestClose === null ||
      (typeof row.latestClose === "number" &&
        Number.isFinite(row.latestClose) &&
        row.latestClose > 0)
    ) ||
    !(
      row.changePercent === null ||
      (typeof row.changePercent === "number" && Number.isFinite(row.changePercent))
    ) ||
    !(
      row.dataDate === null ||
      (typeof row.dataDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.dataDate) &&
        Number.isFinite(Date.parse(row.dataDate)))
    ) ||
    !(
      row.fetchedAt === null ||
      (typeof row.fetchedAt === "string" &&
        row.fetchedAt.length <= 40 &&
        Number.isFinite(Date.parse(row.fetchedAt)))
    ) ||
    typeof row.isStale !== "boolean"
  ) {
    return null;
  }
  return {
    ...instrument,
    latestClose: row.latestClose as number | null,
    changePercent: row.changePercent as number | null,
    dataDate: row.dataDate as string | null,
    fetchedAt: row.fetchedAt as string | null,
    isStale: row.isStale,
  };
}

/** One page-owned queue prevents the desktop and mobile pickers duplicating downloads. */
class QuoteQueue {
  cache = new Map<string, CachedQuote>();
  jobs = new Map<string, Job>();
  pending: string[] = [];
  attempted = new Set<string>();
  owner: string | null = null;
  refreshKey = 0;
  generation = 0;
  paused = false;

  constructor(
    private options: () => Options,
    private notify: () => void,
  ) {}

  enabled() {
    const current = this.options();
    return current.active && current.owner !== null;
  }

  instrument(symbol: string) {
    return this.options().items.find((item) => item.symbol === symbol);
  }

  cancel() {
    ++this.generation;
    for (const symbol of this.pending) this.attempted.delete(symbol);
    this.pending = [];
    for (const [symbol, job] of this.jobs) {
      this.attempted.delete(symbol);
      job.cancel();
    }
    this.jobs.clear();
  }

  sync() {
    const current = this.options();
    const ownerChanged = this.owner !== current.owner;
    const refreshChanged = this.refreshKey !== current.refreshKey;
    if (ownerChanged || refreshChanged) {
      this.cancel();
      this.owner = current.owner;
      this.refreshKey = current.refreshKey;
      this.attempted.clear();
      this.paused = false;
      if (refreshChanged && !ownerChanged) {
        // Explicit refresh rechecks the server cache while retaining every known price.
        for (const item of current.items) {
          const cached = this.cache.get(item.symbol);
          if (cached) cached.freshUntil = 0;
        }
      }
    }
    if (!this.enabled()) this.cancel();
    this.pending = this.pending.filter((symbol) => {
      if (this.instrument(symbol)) return true;
      this.attempted.delete(symbol);
      return false;
    });
    for (const [symbol, job] of this.jobs) {
      if (this.instrument(symbol)) continue;
      this.jobs.delete(symbol);
      this.attempted.delete(symbol);
      job.cancel();
    }
  }

  remember(quote: StockSummary) {
    const previous = this.cache.get(quote.symbol);
    const timestamp = (value: StockSummary) => (value.fetchedAt ? Date.parse(value.fetchedAt) : 0);
    if (previous && timestamp(previous.quote) > timestamp(quote)) return;
    if (previous && JSON.stringify(previous.quote) === JSON.stringify(quote)) return;
    this.cache.set(quote.symbol, {
      quote,
      freshUntil: !quote.isStale && quote.latestClose !== null ? Date.now() + MEMORY_TTL : 0,
    });
    // Public prices stay in page memory only, with bounded retention across account changes.
    while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
    this.notify();
  }

  seed() {
    const current = this.options();
    const candidates: unknown[] = [
      ...(current.overview?.stocks ?? []),
      ...(current.selectedQuote ? [current.selectedQuote] : []),
    ];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || !("symbol" in candidate)) continue;
      const item = this.instrument(String(candidate.symbol));
      if (!item || !SYMBOL.test(item.symbol)) continue;
      const quote = readQuote(candidate, item);
      if (quote) this.remember(quote);
    }
  }

  request(symbol: string) {
    this.sync();
    if (!this.enabled() || this.paused || !SYMBOL.test(symbol) || !this.instrument(symbol)) return;
    this.seed();
    const cached = this.cache.get(symbol);
    if (cached && cached.freshUntil > Date.now()) return;
    if (this.attempted.has(symbol)) return;
    this.attempted.add(symbol);
    this.pending.push(symbol);
    this.pump();
  }

  pump() {
    while (this.enabled() && !this.paused && this.jobs.size < 2 && this.pending.length) {
      const symbol = this.pending.shift()!;
      if (this.instrument(symbol)) void this.load(symbol);
    }
    this.notify();
  }

  async load(symbol: string) {
    const generation = this.generation;
    const owner = this.owner;
    const refreshKey = this.refreshKey;
    const controller = new AbortController();
    let rejectDeadline: (error: Error) => void = () => {};
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const job: Job = {
      controller,
      cancel: () => {
        controller.abort();
        rejectDeadline(new Error("Quote request cancelled"));
      },
    };
    const timer = window.setTimeout(job.cancel, REQUEST_TIMEOUT);
    this.jobs.set(symbol, job);
    const currentScope = () =>
      this.enabled() &&
      this.options().owner === owner &&
      this.options().refreshKey === refreshKey &&
      this.generation === generation;
    const owns = () =>
      !controller.signal.aborted && currentScope() && Boolean(this.instrument(symbol));

    const request = async (cached: boolean) => {
      const path = `/api/stocks/${encodeURIComponent(symbol)}/candles?range=1m${cached ? "&cached=true" : ""}`;
      const response = await fetch(`${API_BASE_URL}${path}`, {
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      });
      if (!owns()) return null;
      if (response.status === 204) return null;
      if (!response.ok) {
        // A shared limit or unavailable cache must not fan out into more Yahoo refreshes.
        if (response.status === 429 || response.status === 503) {
          this.paused = true;
          this.pending = [];
        }
        throw new Error("Quote unavailable");
      }
      const value: unknown = await response.json();
      if (!owns()) return null;
      const item = this.instrument(symbol)!;
      const quote = readQuote(value, item);
      if (!quote) throw new Error("Invalid quote response");
      if (
        !value ||
        typeof value !== "object" ||
        !("range" in value) ||
        value.range !== "1m" ||
        !("interval" in value) ||
        value.interval !== "1d"
      ) {
        throw new Error("Invalid quote range");
      }
      this.remember(quote);
      const needsRefresh =
        quote.isStale || ("refreshRequired" in value && value.refreshRequired === true);
      return { needsRefresh };
    };

    try {
      await Promise.race([
        (async () => {
          const cached = await request(true);
          if (owns() && !this.paused && (!cached || cached.needsRefresh)) await request(false);
        })(),
        deadline,
      ]);
    } catch {
      // Missing quotes remain unavailable; a failed refresh never erases the last real price.
    } finally {
      window.clearTimeout(timer);
      if (this.jobs.get(symbol) === job) this.jobs.delete(symbol);
      if (currentScope()) this.pump();
      else this.notify();
    }
  }
}

export function useWatchlistQuotes(options: Options) {
  const [, setVersion] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const queueRef = useRef<QuoteQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new QuoteQueue(
      () => optionsRef.current,
      () => setVersion((value) => value + 1),
    );
  }
  const queue = queueRef.current;
  const symbols = options.items.map((item) => item.symbol).join(",");

  useEffect(() => {
    queue.sync();
    queue.seed();
    return () => queue.cancel();
  }, [queue, options.active, options.owner, options.refreshKey]);

  useEffect(() => {
    queue.sync();
    queue.seed();
    queue.pump();
  }, [queue, symbols, options.overview, options.selectedQuote]);

  const requestQuote = useCallback(
    (symbol: string) => queue.request(symbol),
    [queue, options.active, options.owner, options.refreshKey],
  );
  const quotes: Record<string, StockSummary> = {};
  if (options.owner) {
    for (const item of options.items) {
      const cached = queue.cache.get(item.symbol);
      if (cached) quotes[item.symbol] = cached.quote;
    }
  }
  return {
    quotes: quotes as Readonly<Record<string, StockSummary>>,
    loading: Boolean(options.active && options.owner && (queue.jobs.size || queue.pending.length)),
    requestQuote,
  };
}
