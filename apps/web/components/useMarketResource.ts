"use client";

import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type ResourceState<T> = {
  path: string | null;
  data: T | null;
  error: string;
  loading: boolean;
  hasSettled: boolean;
};

/** Each selection owns its response, even if an old request completes after cancellation. */
export function useMarketResource<T>(path: string | null, reload = 0, delay = 0) {
  const [state, setState] = useState<ResourceState<T>>({
    path: null,
    data: null,
    error: "",
    loading: false,
    hasSettled: false,
  });

  useEffect(() => {
    if (!path) return;
    let active = true;
    let requestTimeout: number | undefined;
    const controller = new AbortController();
    setState((previous) => ({
      path,
      data: null,
      error: "",
      loading: true,
      hasSettled: previous.path === path && previous.hasSettled,
    }));

    const timeout = window.setTimeout(async () => {
      requestTimeout = window.setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          signal: controller.signal,
          credentials: "omit",
          cache: "no-store",
        });
        if (!response.ok) {
          let message = "Market data is unavailable. Please try again shortly.";
          if (response.status === 404) message = "No market data is available for this symbol.";
          if (response.status === 429) message = "Too many requests. Please wait before retrying.";
          if (response.status === 503) {
            const body: { detail?: unknown } = await response.json().catch(() => ({}));
            if (typeof body.detail === "string") message = body.detail;
          }
          throw new Error(message);
        }
        const data = (await response.json()) as T;
        if (active) setState({ path, data, error: "", loading: false, hasSettled: true });
      } catch (error) {
        if (active) {
          setState({
            path,
            data: null,
            error: controller.signal.aborted
              ? "The market data request timed out. Please try again shortly."
              : error instanceof Error && error.name !== "TypeError"
                ? error.message
                : "Market data is unavailable. Please try again shortly.",
            loading: false,
            hasSettled: true,
          });
        }
      } finally {
        if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
      }
    }, delay);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [path, reload, delay]);

  // Effects run after rendering: never expose the previous symbol's price for one frame.
  if (!path || state.path !== path) {
    return { data: null, error: "", loading: Boolean(path), hasSettled: false };
  }
  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    hasSettled: state.hasSettled,
  };
}
