"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import { asFacts } from "@/lib/holdings-facts";
import {
  displayCurrencies,
  valuePortfolio,
  type Currency,
  type PriceSet,
} from "@/lib/holdings-valuation";
import { loadHoldingsPrices, type PriceProgress } from "@/lib/holdings-price-loader";
const ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
type State = {
  key: string;
  prices: PriceSet | null;
  busy: boolean;
  error: boolean;
  progress: PriceProgress | null;
};

export function useHoldingsValuation(
  model: HoldingsWorkspace,
  defaultCurrency: Currency | null,
  active = true,
) {
  const facts = useMemo(() => (model.content ? asFacts(model.content) : null), [model.content]);
  const scope = model.displayCache.scope;
  const cacheRevision = model.displayCache.revision;
  const metadata = model.sourceMetadata;
  const key =
    scope &&
    model.authenticated &&
    model.phase === "unlocked" &&
    facts &&
    metadata &&
    ["active", "disconnected"].includes(metadata.state)
      ? JSON.stringify([
          scope,
          cacheRevision,
          model.owner,
          model.selectedSourceId,
          metadata.source.resourceRef.incarnation,
          metadata.source.sourceEpoch,
          metadata.authorityVersion,
          facts.data.snapshotId,
        ])
      : "";
  const live = useRef(key);
  live.current = key;
  const [state, setState] = useState<State>({
    key: "",
    prices: null,
    busy: false,
    error: false,
    progress: null,
  });
  const [refresh, setRefresh] = useState(0);
  const force = useRef<string | null>(null);
  const [selection, setSelection] = useState<{
    key: string;
    currency: Currency;
    defaultCurrency: Currency;
  } | null>(null);
  const options = useMemo(
    () => (facts && defaultCurrency ? displayCurrencies(facts, defaultCurrency) : []),
    [facts, defaultCurrency],
  );
  const cached = key ? (model.displayCache.valuations.get(key) as PriceSet | undefined) : undefined;
  const picked =
    selection?.key === key && selection.defaultCurrency === defaultCurrency
      ? selection
      : cached?.displaySelection;
  const currency =
    key && picked?.defaultCurrency === defaultCurrency && options.includes(picked.currency)
      ? picked.currency
      : defaultCurrency;
  const current = state.key === key ? state : null;
  const prices = current?.prices ?? cached ?? null;
  useEffect(() => {
    if (!key || !defaultCurrency || !picked || picked.defaultCurrency === defaultCurrency) return;
    setSelection(null);
    const previous = model.displayCache.valuations.get(key) as PriceSet | undefined;
    if (previous)
      model.displayCache.valuations.set(key, {
        ...previous,
        displaySelection: { currency: defaultCurrency, defaultCurrency },
      });
  }, [key, defaultCurrency, model.displayCache]);
  useEffect(() => {
    if (!active || !key || !facts || !defaultCurrency) return;
    const controller = new AbortController(),
      cache = model.displayCache;
    const previous = cache.valuations.get(key) as PriceSet | undefined;
    const owns = () =>
      !controller.signal.aborted &&
      live.current === key &&
      cache.scope === scope &&
      cache.revision === cacheRevision;
    setState({ key, prices: previous ?? null, busy: true, error: false, progress: null });
    const forced = force.current === key;
    force.current = null;
    const keepSelection = (next: PriceSet) => {
      const selection = (cache.valuations.get(key) as PriceSet | undefined)?.displaySelection;
      return selection ? { ...next, displaySelection: selection } : next;
    };
    void loadHoldingsPrices({
      facts,
      currency: defaultCurrency,
      previous,
      refresh: forced,
      origin: ORIGIN,
      signal: controller.signal,
      fetch,
      publish: (next, progress) => {
        if (!owns()) return;
        next = keepSelection(next);
        cache.valuations.set(key, next);
        setState({ key, prices: next, busy: true, error: false, progress });
      },
    })
      .then(({ prices: next, error }) => {
        if (!owns()) return;
        next = keepSelection(next);
        cache.valuations.set(key, next);
        setState({ key, prices: next, busy: false, error, progress: null });
      })
      .catch(() => {
        if (owns()) setState((s) => ({ ...s, key, busy: false, error: true, progress: null }));
      });
    return () => controller.abort();
  }, [active, key, defaultCurrency, refresh, model.displayCache]);
  const valuation = useMemo(
    () => (key && facts && prices && currency ? valuePortfolio(facts, prices, currency) : null),
    [key, facts, prices, currency],
  );
  return {
    facts: key ? facts : null,
    prices: key ? prices : null,
    valuation,
    options,
    currency,
    busy: Boolean(active && key && defaultCurrency && (current?.busy ?? !prices)),
    error: current?.error ?? false,
    progress: current?.progress ?? null,
    select: (next: Currency) => {
      if (key && defaultCurrency && options.includes(next)) {
        const previous = model.displayCache.valuations.get(key) as PriceSet | undefined;
        if (previous)
          model.displayCache.valuations.set(key, {
            ...previous,
            displaySelection: { currency: next, defaultCurrency },
          });
        setSelection({ key, currency: next, defaultCurrency });
      }
    },
    reset: () => {
      setSelection(null);
      const previous = model.displayCache.valuations.get(key) as PriceSet | undefined;
      if (previous && defaultCurrency)
        model.displayCache.valuations.set(key, {
          ...previous,
          displaySelection: { currency: defaultCurrency, defaultCurrency },
        });
    },
    isDefault: currency === defaultCurrency,
    refresh: () => {
      if (active && key && !current?.busy) {
        force.current = key;
        setRefresh((n) => n + 1);
      }
    },
  };
}
