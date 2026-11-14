"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthProvider";
import {
  CurrencyPreferenceStore,
  type CurrencyPreferenceState,
} from "@/lib/currency-preferences-store";
import {
  effectivePortfolioCurrency,
  type CurrencyPreferencesSnapshot,
  type PortfolioCurrency,
} from "@/lib/currency-preferences";

type CurrencyContext = {
  authenticated: boolean;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: "load" | "save" | null;
  snapshot: CurrencyPreferencesSnapshot | null;
  defaultPortfolioCurrency: PortfolioCurrency | null;
  selected: PortfolioCurrency;
  select: (currency: PortfolioCurrency) => void;
  retry: () => void;
  refresh: (force?: boolean) => void;
};
const Context = createContext<CurrencyContext | null>(null);
export function CurrencyPreferencesProvider({ children }: { children: ReactNode }) {
  const auth = useAuth(),
    owner = auth.status === "authenticated" ? auth.sessionKey : null;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const storeRef = useRef<CurrencyPreferenceStore | null>(null);
  const [state, setState] = useState<CurrencyPreferenceState | null>(null);
  useEffect(() => {
    if (!owner) {
      setState(null);
      return;
    }
    const store = new CurrencyPreferenceStore(
      owner,
      (path, options) => auth.requestPrivate("config", path, owner, options),
      (next) => {
        if (ownerRef.current === owner && storeRef.current === store) setState(next);
      },
    );
    storeRef.current = store;
    setState(store.state);
    store.start();
    const visible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible")
        store.refresh();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);
    return () => {
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", visible);
      store.dispose();
      if (storeRef.current === store) storeRef.current = null;
    };
  }, [owner, auth.requestPrivate]);
  const select = useCallback(
    (currency: PortfolioCurrency) => {
      if (owner && ownerRef.current === owner && storeRef.current?.owner === owner)
        storeRef.current.select(currency);
    },
    [owner],
  );
  const retry = useCallback(() => {
    if (owner && ownerRef.current === owner && storeRef.current?.owner === owner)
      storeRef.current.retry();
  }, [owner]);
  const refresh = useCallback(
    (force = true) => {
      if (owner && ownerRef.current === owner && storeRef.current?.owner === owner)
        storeRef.current.refresh(force);
    },
    [owner],
  );
  const current = owner && state?.owner === owner ? state : null;
  const value = useMemo<CurrencyContext>(
    () => ({
      authenticated: Boolean(owner),
      loaded: !owner || Boolean(current?.snapshot),
      loading: Boolean(owner && (!current || current.status === "loading")),
      saving: current?.status === "saving",
      error: current?.error ?? null,
      snapshot: current?.snapshot ?? null,
      defaultPortfolioCurrency: !owner
        ? "USD"
        : current?.snapshot
          ? effectivePortfolioCurrency(current.snapshot)
          : null,
      selected: current?.selected ?? "USD",
      select,
      retry,
      refresh,
    }),
    [owner, current, select, retry, refresh],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCurrencyPreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("Currency preferences provider is required");
  return value;
}
