"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useCurrencyPreferences } from "./CurrencyPreferencesProvider";
import { FxFollowStore, type FxFollowState } from "@/lib/fx-follows-store";
import { defaultContext, effectivePairs, type Pair } from "@/lib/fx-follows";
export function useFxFollows(active: boolean) {
  const auth = useAuth(),
    currency = useCurrencyPreferences(),
    owner = auth.status === "authenticated" ? auth.sessionKey : null;
  const live = useRef(owner);
  live.current = owner;
  const store = useRef<FxFollowStore | null>(null),
    [state, setState] = useState<FxFollowState | null>(null);
  useEffect(() => {
    if (!owner) {
      setState(null);
      return;
    }
    const next = new FxFollowStore(
      owner,
      (path, options) => auth.requestPrivate("user", path, owner, options),
      (value) => {
        if (live.current === owner && store.current === next) setState(value);
      },
    );
    store.current = next;
    setState(next.state);
    return () => {
      next.dispose();
      if (store.current === next) store.current = null;
    };
  }, [owner, auth.requestPrivate]);
  const current = owner && state?.owner === owner ? state : null;
  useEffect(() => {
    const refresh = () => {
      if (!active || !owner || live.current !== owner || store.current?.owner !== owner) return;
      const state = store.current.state,
        age = Date.now() - state.readAt;
      if ((!state.snapshot || age < 0 || age >= 60_000) && !state.error) store.current.load();
      currency.refresh?.(false);
    };
    refresh();
    if (typeof document === "undefined") return;
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [active, owner, auth.requestPrivate, currency.refresh]);
  const context = defaultContext(currency.snapshot);
  const pairs = current?.snapshot ? effectivePairs(current.snapshot, context) : [];
  const busy = Boolean(current?.loading || current?.saving);
  const canChange = Boolean(
    active &&
    owner &&
    current?.snapshot &&
    !busy &&
    !current.error &&
    !current.uncertain &&
    currency.loaded &&
    !currency.loading &&
    !currency.error,
  );
  const change = (kind: "add" | "remove", pair: Pair) => {
    if (canChange && live.current === owner && store.current?.owner === owner)
      store.current.change({ kind, pair, context });
  };
  return {
    owner,
    authenticated: Boolean(owner),
    checking: ["loading", "signing-in", "verifying", "signing-out"].includes(auth.status),
    canSignIn: ["anonymous", "error"].includes(auth.status),
    pairs,
    snapshot: current?.snapshot ?? null,
    loading: Boolean(
      owner && (!current || current.loading || (!current.snapshot && !current.error)),
    ),
    saving: current?.saving ?? false,
    error: current?.error ?? false,
    uncertain: current?.uncertain ?? false,
    canChange,
    currencyLoading: currency.loading,
    currencyError: Boolean(currency.error),
    currencyRetry: currency.retry,
    retry: () => {
      if (active && owner && live.current === owner && store.current?.owner === owner) {
        store.current.load();
        currency.refresh?.();
      }
    },
    add: (pair: Pair) => change("add", pair),
    remove: (pair: Pair) => change("remove", pair),
    signIn: auth.hasFirebaseUser ? auth.retry : auth.signIn,
  };
}
export type FxFollowsModel = ReturnType<typeof useFxFollows>;
