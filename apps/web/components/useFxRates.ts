"use client";
import { useEffect, useRef, useState } from "react";
import { fetchFxRates, type FxRates } from "@/lib/fx-market";
import { pairKey, type Pair } from "@/lib/fx-follows";
type State = {
  key: string;
  owner: string | null;
  data: FxRates | null;
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  readAt: number;
};
function keepKnown(previous: FxRates | null, next: FxRates): FxRates {
  const old = new Map(previous?.items.map((i) => [pairKey(i), i]) ?? []);
  return {
    ...next,
    items: next.items.map((i) => {
      const before = old.get(pairKey(i));
      return before?.rate &&
        (!i.rate || (i.sourceDate && before.sourceDate && i.sourceDate < before.sourceDate))
        ? { ...before, status: "stale" as const }
        : i;
    }),
  };
}
export function useFxRates(pairs: readonly Pair[], owner: string | null, active: boolean) {
  const key = owner && pairs.length ? JSON.stringify([owner, pairs.map(pairKey)]) : "",
    live = useRef(key);
  live.current = key;
  const [state, setState] = useState<State>({
    key: "",
    owner: null,
    data: null,
    loading: false,
    refreshing: false,
    error: false,
    readAt: 0,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [reload, setReload] = useState(0),
    forced = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !key) return;
    let alive = true;
    const controller = new AbortController();
    const owns = () => alive && live.current === key && !controller.signal.aborted;
    const previous = stateRef.current.key === key ? stateRef.current : null;
    if (
      forced.current !== key &&
      (previous?.data || previous?.error) &&
      Date.now() - previous.readAt < 60_000
    )
      return;
    forced.current = null;
    let data =
      previous?.data ??
      (stateRef.current.owner === owner && stateRef.current.data
        ? {
            ...stateRef.current.data,
            items: stateRef.current.data.items.filter((i) =>
              pairs.some((p) => pairKey(p) === pairKey(i)),
            ),
          }
        : null);
    const publish = (busy: boolean, error = false) => {
      if (owns())
        setState({
          key,
          owner,
          data,
          loading: busy && !data,
          refreshing: busy && Boolean(data),
          error,
          readAt: busy ? 0 : Date.now(),
        });
    };
    publish(true);
    let rejectTimeout: () => void = () => {};
    const deadline = new Promise<never>((_, reject) => {
      rejectTimeout = () => reject(Error("rates_timeout"));
    });
    const timer = setTimeout(() => {
      controller.abort();
      rejectTimeout();
    }, 20_000);
    const request = (cached: boolean) =>
      Promise.race([fetchFxRates(pairs, cached, controller.signal), deadline]);
    void (async () => {
      try {
        const cached = await request(true);
        if (!owns()) return;
        data = keepKnown(data, cached);
        publish(true);
        if (cached.items.some((i) => i.status !== "available")) {
          const refreshed = await request(false);
          if (!owns()) return;
          data = keepKnown(data, refreshed);
        }
        publish(false);
      } catch {
        if (alive && live.current === key) {
          if (data)
            data = {
              ...data,
              items: data.items.map((i) => (i.rate ? { ...i, status: "stale" as const } : i)),
            };
          setState({
            key,
            owner,
            data,
            loading: false,
            refreshing: false,
            error: true,
            readAt: Date.now(),
          });
        }
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, key, reload]);
  const current = key && state.key === key ? state : null;
  const data =
    current?.data ??
    (key && state.owner === owner && state.data
      ? {
          ...state.data,
          items: state.data.items.filter((i) => pairs.some((p) => pairKey(p) === pairKey(i))),
        }
      : null);
  return {
    data,
    loading: Boolean(active && key && (current?.loading ?? !data)),
    refreshing: Boolean(active && current?.refreshing),
    error: current?.error ?? false,
    refresh: () => {
      if (active && key && !current?.loading && !current?.refreshing) {
        forced.current = key;
        setReload((n) => n + 1);
      }
    },
  };
}
