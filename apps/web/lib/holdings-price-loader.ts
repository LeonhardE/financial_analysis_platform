import {
  chunks,
  fxBatch,
  fxLegs,
  instruments,
  instrumentKey,
  missingFx,
  missingQuotes,
  quoteBatch,
  readPublicValuation,
  type Batch,
  type Currency,
  type FxItem,
  type HoldingsFacts,
  type Instrument,
  type PriceSet,
  type QuoteItem,
} from "./holdings-valuation";

export type PriceProgress = { phase: "cache" | "refresh"; done: number; total: number };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;
const timestamp = (value: string | null) => (value ? Date.parse(value) : 0);
function retainQuote(before: QuoteItem | undefined, next: QuoteItem): QuoteItem {
  if (!before?.price) return next;
  if (
    !next.price ||
    timestamp(next.sourceAsOf) < timestamp(before.sourceAsOf) ||
    (next.sourceAsOf === before.sourceAsOf &&
      timestamp(next.fetchedAt) < timestamp(before.fetchedAt))
  )
    return { ...before, status: "stale" };
  return next;
}
function replaceQuotes(prices: PriceSet, next: Batch<QuoteItem>) {
  const entries = new Map(next.items.map((i) => [instrumentKey(i.instrument), i]));
  prices.quotes = prices.quotes.map((batch) => {
    if (!batch.items.some((i) => entries.has(instrumentKey(i.instrument)))) return batch;
    const items = batch.items.map((old) =>
        entries.has(instrumentKey(old.instrument))
          ? retainQuote(old, entries.get(instrumentKey(old.instrument))!)
          : old,
      ),
      fetchedAt = [next.fetchedAt, batch.fetchedAt, ...items.map((i) => i.fetchedAt)]
        .sort()
        .at(-1)!;
    return quoteBatch({
      ...batch,
      snapshotId: `view_${next.snapshotId}`.slice(0, 128),
      fetchedAt,
      items,
    });
  });
}
async function pool<T>(values: T[], run: (value: T) => Promise<void>, signal: AbortSignal) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, values.length) }, async () => {
      while (next < values.length && !signal.aborted) await run(values[next++]);
    }),
  );
}

/** One bounded pass, no polling. Producer budget/refresh limits are unchanged. */
export async function loadHoldingsPrices(args: {
  facts: HoldingsFacts;
  currency: Currency;
  previous?: PriceSet;
  refresh: boolean;
  origin: string;
  signal: AbortSignal;
  fetch: Fetch;
  publish: (prices: PriceSet, progress: PriceProgress) => void;
  now?: () => number;
}): Promise<{ prices: PriceSet; error: boolean }> {
  const now = args.now ?? Date.now,
    at = new Date(now()).toISOString(),
    all = instruments(args.facts),
    wantedFx = fxLegs(args.facts, args.currency),
    groups = chunks(all, 50),
    prices: PriceSet = args.previous
      ? structuredClone(args.previous)
      : { quotes: groups.map((g) => missingQuotes(g, at)), fx: missingFx(at), readAt: 0 };
  const priorKeys = new Set(
    prices.quotes.flatMap((b) => b.items.map((i) => instrumentKey(i.instrument))),
  );
  if (priorKeys.size !== all.length || all.some((i) => !priorKeys.has(instrumentKey(i))))
    prices.quotes = groups.map((g) => missingQuotes(g, at));
  let error = Boolean(prices.error);
  const call = async <T>(
    path: string,
    json: unknown,
    validator: (value: unknown) => T,
  ): Promise<T> => {
    const controller = new AbortController(),
      abort = () => controller.abort();
    args.signal.addEventListener("abort", abort, { once: true });
    if (args.signal.aborted) controller.abort();
    let rejectAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(Error("cancelled"));
    });
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
    const timer = setTimeout(abort, 20_000);
    try {
      return await Promise.race([
        cancelled,
        (async () =>
          readPublicValuation(
            await args.fetch(args.origin + path, {
              method: "POST",
              credentials: "omit",
              cache: "no-store",
              signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(json),
            }),
            validator,
            controller.signal,
          ))(),
      ]);
    } finally {
      clearTimeout(timer);
      args.signal.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectAbort);
      controller.abort();
    }
  };
  const emit = (progress: PriceProgress) => {
    if (!args.signal.aborted) args.publish({ ...prices, quotes: [...prices.quotes] }, progress);
  };
  const fresh = prices.readAt > 0 && now() - prices.readAt < 60_000;
  const fxReady = wantedFx.every((p) =>
    prices.fx.items.some((i) => i.base === p.base && i.quote === p.quote),
  );
  const cachedJobs: Array<() => Promise<void>> = [];
  if (!fresh || args.refresh)
    for (const group of groups)
      cachedJobs.push(async () => {
        replaceQuotes(
          prices,
          await call("/api/valuation/quotes?cached=true", { instruments: group }, (v) =>
            quoteBatch(v, group),
          ),
        );
      });
  if (wantedFx.length && (!fresh || args.refresh || !fxReady))
    cachedJobs.push(async () => {
      prices.fx = await call("/api/valuation/fx?cached=true", { pairs: wantedFx }, (v) =>
        fxBatch(v, wantedFx),
      );
    });
  let done = 0;
  if (cachedJobs.length || args.refresh) error = false;
  emit({ phase: "cache", done, total: cachedJobs.length });
  await pool(
    cachedJobs,
    async (run) => {
      try {
        await run();
      } catch {
        if (!args.signal.aborted) error = true;
      }
      emit({ phase: "cache", done: ++done, total: cachedJobs.length });
    },
    args.signal,
  );
  if (args.signal.aborted) throw Error("cancelled");
  if (!fresh || args.refresh || !fxReady) {
    // At most four producer batches of four instruments per visit/explicit refresh.
    // Large sources still get all cache reads; missing rows retain honest partial coverage.
    const pending = (fresh && !args.refresh ? [] : prices.quotes.flatMap((b) => b.items))
      .filter((i) => i.status !== "available")
      .sort((a, b) => Number(Boolean(a.price)) - Number(Boolean(b.price)))
      .slice(0, 16);
    const jobs: Array<() => Promise<void>> = chunks(
      pending.map((i) => i.instrument),
      4,
    ).map((group) => async () => {
      replaceQuotes(
        prices,
        await call("/api/valuation/quotes", { instruments: group }, (v) => quoteBatch(v, group)),
      );
    });
    if (
      wantedFx.length &&
      wantedFx.some(
        (p) =>
          !prices.fx.items.some(
            (i) => i.base === p.base && i.quote === p.quote && i.status === "available",
          ),
      )
    )
      jobs.push(async () => {
        prices.fx = await call("/api/valuation/fx", { pairs: wantedFx }, (v) =>
          fxBatch(v, wantedFx),
        );
      });
    done = 0;
    emit({ phase: "refresh", done, total: jobs.length });
    await pool(
      jobs,
      async (run) => {
        try {
          await run();
        } catch {
          if (!args.signal.aborted) error = true;
        }
        emit({ phase: "refresh", done: ++done, total: jobs.length });
      },
      args.signal,
    );
  }
  if (args.signal.aborted) throw Error("cancelled");
  if (error) {
    prices.quotes = prices.quotes.map((b) => ({
      ...b,
      items: b.items.map((i) => (i.price ? { ...i, status: "stale" as const } : i)),
    }));
    prices.fx = {
      ...prices.fx,
      items: prices.fx.items.map((i) =>
        i.rate && i.source !== "identity" ? { ...i, status: "stale" as const } : i,
      ),
    };
  }
  prices.error = error;
  prices.readAt = now();
  return { prices, error };
}
