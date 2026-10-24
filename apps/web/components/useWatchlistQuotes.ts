"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_INSTRUMENTS,
  type CandleResponse,
  type ChartRange,
  type DailyQuote,
  type Instrument,
  type MarketOverview,
} from "@/lib/market-data";
import { hasQuote, preferQuote, readCandleQuote, readOverviewQuote } from "@/lib/market-quotes";

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
  selectedInstrument?: Instrument | null;
  selectedRange?: ChartRange;
  selectedActive?: boolean;
  selectedChartSettled?: boolean;
  overviewPending?: boolean;
};
type CachedQuote = { quote: DailyQuote; freshUntil: number };
type Job = { controller: AbortController; cancel: () => void };

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
    return (
      (current.active && current.owner !== null) ||
      Boolean(current.selectedActive && current.selectedInstrument)
    );
  }

  instrument(symbol: string) {
    const current = this.options();
    return current.selectedInstrument?.symbol === symbol
      ? current.selectedInstrument
      : current.items.find((item) => item.symbol === symbol);
  }

  canRequest(symbol: string) {
    const current = this.options();
    const selected = current.selectedInstrument?.symbol === symbol;
    // A selected 1M chart already owns this exact cache probe/full request. Wait
    // for other selected ranges too, since their nested quote often suffices.
    if (selected && (current.selectedRange === "1m" || !current.selectedChartSettled)) return false;
    // Default symbols share the overview's upstream lease. Never race its batch.
    const defaultSymbol = DEFAULT_INSTRUMENTS.some((instrument) => instrument.symbol === symbol);
    if (defaultSymbol && current.overviewPending) return false;
    return Boolean(
      (selected && current.selectedActive) ||
      (current.active &&
        current.owner !== null &&
        current.items.some((item) => item.symbol === symbol)),
    );
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
        for (const cached of this.cache.values()) cached.freshUntil = 0;
      }
    }
    if (!this.enabled()) this.cancel();
    this.pending = this.pending.filter((symbol) => {
      if (this.instrument(symbol) && this.canRequest(symbol)) return true;
      this.attempted.delete(symbol);
      return false;
    });
    for (const [symbol, job] of this.jobs) {
      if (this.instrument(symbol) && this.canRequest(symbol)) continue;
      this.jobs.delete(symbol);
      this.attempted.delete(symbol);
      job.cancel();
    }
  }

  remember(candidate: DailyQuote) {
    const previous = this.cache.get(candidate.symbol);
    const quote = preferQuote(previous?.quote, candidate);
    if (!quote || (previous && JSON.stringify(previous.quote) === JSON.stringify(quote))) return;
    this.cache.set(quote.symbol, {
      quote,
      freshUntil: !quote.isStale ? Date.now() + MEMORY_TTL : 0,
    });
    // Public prices stay in page memory only, with bounded retention across account changes.
    while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
    this.notify();
  }

  candidates() {
    const current = this.options();
    const result: DailyQuote[] = [];
    for (const row of current.overview?.stocks ?? []) {
      const instrument = DEFAULT_INSTRUMENTS.find((item) => item.symbol === row.symbol);
      const quote = instrument
        ? readOverviewQuote(row, instrument, current.overview?.isMock)
        : null;
      if (quote) result.push(quote);
    }
    const selected = current.selectedQuote;
    if (selected) {
      const instrument =
        current.selectedInstrument?.symbol === selected.symbol
          ? current.selectedInstrument
          : this.instrument(selected.symbol);
      const quote = instrument ? readCandleQuote(selected, instrument) : null;
      if (quote) result.push(quote);
    }
    return result;
  }

  seed() {
    for (const quote of this.candidates()) this.remember(quote);
  }

  requestSelected() {
    const current = this.options();
    const selected = current.selectedInstrument;
    if (!selected || !current.selectedActive || !this.canRequest(selected.symbol)) return;
    // Fresh canonical data needs no additional download. A stale snapshot or
    // older API may need one bounded 1M recheck for this selected symbol only.
    const candidate = this.candidates()
      .filter((quote) => quote.symbol === selected.symbol)
      .reduce<DailyQuote | undefined>((best, quote) => preferQuote(best, quote), undefined);
    const best = preferQuote(this.cache.get(selected.symbol)?.quote, candidate);
    if (hasQuote(candidate) && hasQuote(best) && !best.isStale) return;
    this.request(selected.symbol);
  }

  snapshot() {
    const current = this.options();
    const instruments = new Map<string, Instrument>(
      DEFAULT_INSTRUMENTS.map((instrument) => [instrument.symbol, instrument]),
    );
    for (const row of current.overview?.stocks ?? []) instruments.set(row.symbol, row);
    if (current.owner) for (const item of current.items) instruments.set(item.symbol, item);
    if (current.selectedInstrument)
      instruments.set(current.selectedInstrument.symbol, current.selectedInstrument);
    const quotes: Record<string, DailyQuote> = {};
    for (const symbol of instruments.keys()) {
      const cached = this.cache.get(symbol);
      if (cached) quotes[symbol] = cached.quote;
    }
    // Merge current responses during render as well as in the effect, so every
    // consumer changes to the same quote in the same paint.
    for (const quote of this.candidates()) {
      if (!instruments.has(quote.symbol)) continue;
      const best = preferQuote(quotes[quote.symbol], quote);
      if (best) quotes[quote.symbol] = best;
    }
    return quotes;
  }

  request(symbol: string) {
    this.sync();
    if (
      !this.enabled() ||
      this.paused ||
      !SYMBOL.test(symbol) ||
      !this.instrument(symbol) ||
      !this.canRequest(symbol)
    )
      return;
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
      if (this.instrument(symbol) && this.canRequest(symbol)) void this.load(symbol);
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
      !controller.signal.aborted &&
      currentScope() &&
      Boolean(this.instrument(symbol)) &&
      this.canRequest(symbol);

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
      if (
        !value ||
        typeof value !== "object" ||
        !("range" in value) ||
        value.range !== "1m" ||
        !("interval" in value) ||
        value.interval !== "1d"
      )
        throw new Error("Invalid quote range");
      const quote = readCandleQuote(value, item);
      // A valid new response may explicitly lack a canonical quote. Keep the
      // previous real price, and honor the server's refresh marker once only.
      if (!quote && !("quote" in value && value.quote === null))
        throw new Error("Invalid quote response");
      if (quote) this.remember(quote);
      const needsRefresh =
        quote?.isStale || ("refreshRequired" in value && value.refreshRequired === true);
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
  }, [queue, options.active, options.owner, options.refreshKey, options.selectedActive]);

  useEffect(() => {
    queue.sync();
    queue.seed();
    queue.requestSelected();
    queue.pump();
  }, [
    queue,
    symbols,
    options.overview,
    options.selectedQuote,
    options.selectedInstrument,
    options.selectedRange,
    options.selectedActive,
    options.selectedChartSettled,
    options.overviewPending,
    options.refreshKey,
    options.owner,
    options.active,
  ]);

  const requestQuote = useCallback(
    (symbol: string) => queue.request(symbol),
    [
      queue,
      options.active,
      options.owner,
      options.refreshKey,
      options.overviewPending,
      options.selectedInstrument?.symbol,
      options.selectedRange,
      options.selectedChartSettled,
    ],
  );
  return {
    quotes: queue.snapshot() as Readonly<Record<string, DailyQuote>>,
    loading: Boolean(queue.enabled() && (queue.jobs.size || queue.pending.length)),
    requestQuote,
  };
}
