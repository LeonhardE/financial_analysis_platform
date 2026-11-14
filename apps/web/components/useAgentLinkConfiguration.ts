"use client";

import { useEffect, useRef, useState } from "react";
import { untilSignal } from "@/lib/workspace-cache";
import { readAgentLinkConfiguration, type AgentLinkConfiguration } from "@/lib/agent-link";

/** This public metadata response contains a configured destination, never a user or credential. */
export function useAgentLinkConfiguration(active: boolean) {
  const [state, setState] = useState<{
    data: AgentLinkConfiguration | null;
    loading: boolean;
    error: boolean;
  }>({ data: null, loading: false, error: false });
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const fresh = useRef(0);
  const live = useRef({ active, visible });
  live.current = { active, visible };
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (
      !active ||
      !visible ||
      (fresh.current > 0 && Date.now() - fresh.current >= 0 && Date.now() - fresh.current < 60000)
    )
      return;
    const controller = new AbortController();
    let disposed = false;
    const timer = window.setTimeout(() => {
      controller.abort();
      if (!disposed && live.current.active && live.current.visible)
        setState((previous) => ({ ...previous, loading: false, error: true }));
    }, 15_000);
    const current = () =>
      !disposed && !controller.signal.aborted && live.current.active && live.current.visible;
    setState((previous) => ({ ...previous, loading: true, error: false }));
    void (async () => {
      try {
        const response = await untilSignal(
          fetch("/api/private/agent-link/config", {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
          controller.signal,
        );
        if (!current()) return;
        if (
          response.status !== 200 ||
          response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
            "application/json" ||
          !response.body
        )
          throw new Error("invalid_response");
        const reader = response.body.getReader(),
          decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "",
          size = 0;
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        controller.signal.addEventListener("abort", cancel, { once: true });
        try {
          for (;;) {
            const part = await untilSignal(reader.read(), controller.signal);
            if (!current()) return;
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 4096) throw new Error("invalid_response");
            text += decoder.decode(part.value, { stream: true });
          }
          text += decoder.decode();
          const data = readAgentLinkConfiguration(JSON.parse(text));
          if (current()) {
            fresh.current = Date.now();
            setState({ data, loading: false, error: false });
          }
        } finally {
          controller.signal.removeEventListener("abort", cancel);
          cancel();
          try {
            reader.releaseLock();
          } catch {
            /* Cancelled reader can still be pending. */
          }
        }
      } catch {
        if (!disposed && live.current.active && live.current.visible)
          setState((previous) => ({ ...previous, loading: false, error: true }));
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, visible]);
  // Public destination metadata may keep an existing helper heartbeat alive while hidden.
  return state;
}
