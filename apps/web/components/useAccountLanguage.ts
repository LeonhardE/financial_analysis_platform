"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  LanguagePreferenceStore,
  type LanguagePreferenceState,
} from "@/lib/language-preferences-store";
import type { UiLanguage } from "@/lib/language-preferences";

type RequestPrivate = (
  service: "config",
  path: string,
  owner: string,
  options: { method: "GET" | "PUT"; signal: AbortSignal; json?: unknown },
) => Promise<Response>;

/** The optional v2 choice never changes or rewrites legacy preference snapshots. */
export function useAccountLanguage(
  owner: string | null,
  requestPrivate: RequestPrivate,
  fallback: UiLanguage,
  adoptTraditionalGuest = false,
) {
  const live = useRef(owner);
  live.current = owner;
  const store = useRef<LanguagePreferenceStore | null>(null);
  const [state, setState] = useState<LanguagePreferenceState | null>(null);
  useEffect(() => {
    if (!owner) {
      setState(null);
      return;
    }
    const next = new LanguagePreferenceStore(
      owner,
      (path, options) => requestPrivate("config", path, owner, options),
      (value) => {
        if (live.current === owner && store.current === next) setState(value);
      },
    );
    store.current = next;
    next.fallback(fallback);
    setState(next.state);
    next.start();
    return () => {
      next.dispose();
      if (store.current === next) store.current = null;
    };
  }, [owner, requestPrivate]);
  useLayoutEffect(() => {
    if (owner && live.current === owner && store.current?.owner === owner)
      store.current.fallback(fallback);
  }, [owner, fallback]);
  const current = owner && state?.owner === owner ? state : null;
  useEffect(() => {
    if (
      adoptTraditionalGuest &&
      owner &&
      live.current === owner &&
      current?.snapshot?.version === 0 &&
      current.status === "saved" &&
      !current.error &&
      store.current?.owner === owner
    )
      store.current.select("zh-Hant");
  }, [owner, adoptTraditionalGuest, current]);
  const select = useCallback(
    (language: UiLanguage) => {
      if (owner && live.current === owner && store.current?.owner === owner)
        store.current.select(language);
    },
    [owner],
  );
  const retry = useCallback(() => {
    if (owner && live.current === owner && store.current?.owner === owner) store.current.retry();
  }, [owner]);
  const usesOverride = Boolean(current?.snapshot?.preferences || current?.hasIntent);
  return {
    language: usesOverride ? (current?.selected ?? null) : null,
    usesOverride,
    loading: Boolean(owner && (!current || current.status === "loading")),
    saving: current?.status === "saving",
    loaded: !owner || Boolean(current?.snapshot),
    error: current?.error ?? null,
    select,
    retry,
  };
}
