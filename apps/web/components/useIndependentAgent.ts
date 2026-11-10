"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { PersistentWorkspaceModel } from "./usePersistentWorkspace";
import {
  loadIndependentConfiguration,
  independentJson,
  type IndependentAgentConfiguration,
} from "@/lib/independent-agent";
import { IndependentExperienceController } from "@/lib/independent-experience-controller";
export function useIndependentAgent(workspace: HoldingsWorkspace, model: PersistentWorkspaceModel) {
  const auth = useAuth();
  const [configuration, setConfiguration] = useState<IndependentAgentConfiguration | null>(null);
  const [view, setView] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const scope = model.unlocked ? `${model.owner}:${workspace.vaultGeneration}` : null;
  const live = useRef({ configuration, scope, auth, workspace, model });
  live.current = { configuration, scope, auth, workspace, model };
  const job = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 15000);
    void loadIndependentConfiguration(abort.signal)
      .then((cfg) => {
        if (!abort.signal.aborted) setConfiguration(cfg);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  const run = useCallback(
    async <T>(action: (c: IndependentExperienceController) => Promise<T>): Promise<T | null> => {
      const start = live.current;
      if (!start.scope || !start.configuration || !start.model.owner || job.current) return null;
      const abort = new AbortController(),
        timer = setTimeout(() => abort.abort(), 110000);
      job.current = abort;
      setBusy(true);
      setError("");
      try {
        return await start.model.execute(async (_legacy, hub, assert) => {
          const current = () => {
            assert();
            if (
              abort.signal.aborted ||
              start.scope !== live.current.scope ||
              start.configuration !== live.current.configuration
            )
              throw new Error("cancelled");
          };
          const controller = new IndependentExperienceController(
            start.configuration!,
            async (service, path, options = {}) => {
              current();
              let value;
              if (service === "agent-hub") value = await hub(path, options);
              else {
                const response = await start.auth.requestPrivate(
                  service,
                  path,
                  start.model.owner!,
                  {
                    ...options,
                    signal: abort.signal,
                    ...(service === "agent-policy"
                      ? { expectedPolicyIssuer: start.configuration!.issuer }
                      : {}),
                    ...(service === "portfolio"
                      ? {
                          headers: {
                            "X-FolioView-Contract": "folioview.agent-workspace.v2.0",
                            ...options.headers,
                          },
                        }
                      : {}),
                  },
                );
                value = await independentJson(
                  response,
                  abort.signal,
                  262144,
                  service === "agent-policy" && path.endsWith("/controls") ? 201 : 200,
                );
              }
              current();
              return value;
            },
            () => live.current.workspace,
            current,
            abort.signal,
          );
          let cancelWait: (() => void) | undefined;
          try {
            const cancelled = new Promise<never>((_resolve, reject) => {
              cancelWait = () => reject(new Error("cancelled"));
              abort.signal.addEventListener("abort", cancelWait, { once: true });
              if (abort.signal.aborted) cancelWait();
            });
            return await Promise.race([action(controller), cancelled]);
          } catch (e) {
            if (start.scope === live.current.scope && !abort.signal.aborted)
              setError((e as any)?.code ?? "request_failed");
            throw e;
          } finally {
            if (cancelWait) abort.signal.removeEventListener("abort", cancelWait);
          }
        });
      } finally {
        clearTimeout(timer);
        abort.abort();
        if (job.current === abort) {
          job.current = null;
          setBusy(false);
        }
      }
    },
    [],
  );
  const reload = useCallback(async () => {
    const original = live.current.scope;
    const value = await run(async (c) => {
      await c.content.synchronize(c.connection());
      return c.load();
    });
    if (original === live.current.scope) setView(value ? { scope: original, value } : null);
  }, [run]);
  useEffect(() => {
    job.current?.abort();
    job.current = null;
    setBusy(false);
    setView(null);
    setError("");
    if (scope && configuration) void reload();
    const change = () => {
      if (document.visibilityState === "hidden") {
        job.current?.abort();
        setView(null);
      } else if (live.current.scope) void reload();
    };
    document.addEventListener("visibilitychange", change);
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void reload();
    }, 60000);
    return () => {
      job.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", change);
    };
  }, [scope, configuration, reload]);
  return {
    configuration,
    scope,
    view: view?.scope === scope ? view.value : null,
    error,
    busy,
    run,
    reload,
  };
}
export type IndependentAgentModel = ReturnType<typeof useIndependentAgent>;
