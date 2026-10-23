"use client";

import { useEffect, useRef, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const UNAVAILABLE = "Market data is unavailable. Please try again shortly.";
const TIMED_OUT = "The market data request timed out. Please try again shortly.";

type Snapshot = { refreshRequired?: boolean };
type ResourceState<T> = {
  path: string | null;
  reload: number;
  data: T | null;
  error: string;
  refreshError: string;
  loading: boolean;
  refreshing: boolean;
  hasSettled: boolean;
};

function errorMessage(error: unknown) {
  return error instanceof Error && error.name !== "TypeError" ? error.message : UNAVAILABLE;
}

/** Public snapshots only. Search and all authenticated resources use separate hooks. */
export function useCachedMarketResource<T>(path: string | null, reload = 0, refreshReady = true) {
  const initial: ResourceState<T> = {
    path: null,
    reload: 0,
    data: null,
    error: "",
    refreshError: "",
    loading: false,
    refreshing: false,
    hasSettled: false,
  };
  const [state, setState] = useState(initial);
  const stateRef = useRef(state);
  const identity = `${path ?? ""}\0${reload}`;
  const identityRef = useRef(identity);
  const readyRef = useRef(refreshReady);
  const resumeRef = useRef<(() => void) | null>(null);
  // Protect a new selection even before its previous effect is cleaned up.
  identityRef.current = identity;
  readyRef.current = refreshReady;

  useEffect(() => {
    if (!path) return;
    let alive = true;
    let data = stateRef.current.path === path ? stateRef.current.data : null;
    let activeRequest: {
      controller: AbortController;
      cancel: () => void;
    } | null = null;
    let needsRefresh = false;
    let refreshStarted = false;
    let waitedForOverview = !readyRef.current;
    const owns = () => alive && identityRef.current === identity;
    const cachedPath = `${path}${path.includes("?") ? "&" : "?"}cached=true`;

    function publish(changes: Partial<ResourceState<T>>) {
      if (!owns()) return;
      const next = { ...stateRef.current, path, reload, data, ...changes };
      stateRef.current = next;
      setState(next);
    }

    async function request(requestPath: string): Promise<(T & Snapshot) | null> {
      const controller = new AbortController();
      let timer: number | undefined;
      let cancel = () => {};
      const deadline = new Promise<never>((_, reject) => {
        cancel = () => {
          controller.abort();
          reject(new Error(TIMED_OUT));
        };
        timer = window.setTimeout(cancel, 30_000);
      });
      const current = { controller, cancel };
      activeRequest = current;
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(`${API_BASE_URL}${requestPath}`, {
              signal: controller.signal,
              credentials: "omit",
              cache: "no-store",
            });
            // A cache miss has no body. Do not parse it or render fictional data.
            if (response.status === 204) return null;
            if (!response.ok) {
              let message = UNAVAILABLE;
              if (response.status === 404) message = "No market data is available for this symbol.";
              if (response.status === 429)
                message = "Too many requests. Please wait before retrying.";
              if (response.status === 503) {
                const body: { detail?: unknown } = await response.json().catch(() => ({}));
                if (typeof body.detail === "string") message = body.detail;
              }
              throw new Error(message);
            }
            const result: unknown = await response.json();
            if (!result || typeof result !== "object" || Array.isArray(result)) {
              throw new Error(UNAVAILABLE);
            }
            return result as T & Snapshot;
          })(),
          deadline,
        ]);
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
        if (activeRequest === current) activeRequest = null;
      }
    }

    function accept(snapshot: T & Snapshot) {
      if (!owns()) return;
      data = snapshot;
      // An older API ignores cached=true and returns an ordinary response with
      // no marker. That response already did the work; never fetch it twice.
      needsRefresh = snapshot.refreshRequired === true;
      publish({
        data,
        error: "",
        refreshError: "",
        loading: false,
        refreshing: needsRefresh,
        hasSettled: !needsRefresh,
      });
    }

    async function refresh() {
      if (!owns() || !needsRefresh || refreshStarted) return;
      if (!readyRef.current) {
        waitedForOverview = true;
        publish({
          loading: data === null,
          refreshing: data !== null,
          hasSettled: false,
        });
        return;
      }
      refreshStarted = true;
      publish({
        loading: data === null,
        refreshing: data !== null,
        hasSettled: false,
      });
      try {
        // The overview refresh may have populated the default 1M chart while
        // this request waited. Re-read once before reserving an upstream call.
        if (waitedForOverview) {
          try {
            const snapshot = await request(cachedPath);
            if (!owns()) return;
            if (snapshot) {
              accept(snapshot);
              if (!needsRefresh) return;
            }
          } catch {
            if (!owns()) return;
          }
        }
        const snapshot = await request(path!);
        if (!owns()) return;
        if (!snapshot) throw new Error(UNAVAILABLE);
        data = snapshot;
        needsRefresh = false;
        publish({
          data,
          error: "",
          refreshError: "",
          loading: false,
          refreshing: false,
          hasSettled: true,
        });
      } catch (error) {
        if (!owns()) return;
        const message = errorMessage(error);
        publish({
          error: data === null ? message : "",
          refreshError: data === null ? "" : message,
          loading: false,
          refreshing: false,
          hasSettled: true,
        });
      }
    }

    const resume = () => void refresh();
    resumeRef.current = resume;
    publish({
      error: "",
      refreshError: "",
      loading: data === null,
      refreshing: false,
      hasSettled: false,
    });
    void (async () => {
      try {
        const snapshot = await request(cachedPath);
        if (!owns()) return;
        if (snapshot) {
          accept(snapshot);
          if (!needsRefresh) return;
        }
      } catch {
        if (!owns()) return;
      }
      needsRefresh = true;
      await refresh();
    })();

    return () => {
      alive = false;
      activeRequest?.cancel();
      if (resumeRef.current === resume) resumeRef.current = null;
    };
    // Refresh readiness releases the current cycle; it must not restart probes.
  }, [path, reload, identity]);

  useEffect(() => {
    if (refreshReady) resumeRef.current?.();
  }, [refreshReady, path, reload]);

  if (!path || state.path !== path || state.reload !== reload) {
    return {
      data: state.path === path && path ? state.data : null,
      error: "",
      refreshError: "",
      loading: Boolean(path) && !(state.path === path && state.data),
      refreshing: Boolean(path && state.path === path && state.data),
      hasSettled: false,
    };
  }
  return {
    data: state.data,
    error: state.error,
    refreshError: state.refreshError,
    loading: state.loading,
    refreshing: state.refreshing,
    hasSettled: state.hasSettled,
  };
}
