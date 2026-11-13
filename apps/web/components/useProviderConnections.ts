"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
type J = Record<string, any>;
const C = "folioview.agent-workspace.v2.0";
export function useProviderConnections(workspace: HoldingsWorkspace, active: boolean) {
  const auth = useAuth(),
    scope =
      auth.status === "authenticated" &&
      workspace.owner === auth.sessionKey &&
      workspace.phase === "unlocked"
        ? `${auth.sessionKey}:${workspace.vault?.vaultId}:${workspace.vaultGeneration}`
        : null;
  const [state, setState] = useState<{
    scope: string | null;
    states: Record<string, J>;
    loading: boolean;
    error: boolean;
  }>({ scope: null, states: {}, loading: false, error: false });
  const live = useRef({ scope, workspace, auth, active });
  live.current = { scope, workspace, auth, active };
  const fresh = useRef(0),
    job = useRef<AbortController | null>(null);
  const load = useCallback(async (force = false) => {
    const start = live.current;
    if (
      !start.scope ||
      !start.active ||
      job.current ||
      (!force && Date.now() - fresh.current < 30000)
    )
      return;
    const abort = new AbortController();
    job.current = abort;
    const timer = setTimeout(() => abort.abort(), 14000);
    setState((s) => ({ ...s, scope: start.scope, loading: true, error: false }));
    try {
      const values = await Promise.all(
        ["muse", "chatgpt"].map(async (p) => {
          const r = await start.auth.requestPrivate(
            "agent-hub",
            `/api/v3/provider-connections/${start.workspace.vault!.vaultId}/${p}`,
            start.auth.sessionKey!,
            { signal: abort.signal, headers: { "X-FolioView-Contract": C }, coalesceDisplay: true },
          );
          if (!r.ok) throw Error("read_failed");
          const value = await r.json();
          if (value.profile !== "folioview.provider-connection-slot.v1")
            throw Error("invalid_response");
          return [p, value];
        }),
      );
      if (live.current.scope === start.scope && !abort.signal.aborted) {
        fresh.current = Date.now();
        setState({
          scope: start.scope,
          states: Object.fromEntries(values),
          loading: false,
          error: false,
        });
      }
    } catch {
      if (live.current.scope === start.scope)
        setState((s) => ({ ...s, loading: false, error: true }));
    } finally {
      clearTimeout(timer);
      if (job.current === abort) job.current = null;
    }
  }, []);
  useEffect(() => {
    job.current?.abort();
    job.current = null;
    fresh.current = 0;
    setState({ scope, states: {}, loading: false, error: false });
    return () => job.current?.abort();
  }, [scope]);
  useEffect(() => {
    if (scope && active) void load();
  }, [scope, active, load]);
  return {
    states: scope && state.scope === scope ? state.states : {},
    loading: state.scope === scope && state.loading,
    error: state.scope === scope && state.error,
    reload: () => load(true),
  };
}
