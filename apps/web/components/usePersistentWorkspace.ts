"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import {
  PersistentExperienceController,
  PersistentExperienceError,
  PERSISTENT_CONTRACT,
  type PersistentConnection,
  type PersistentConnectionView,
  type PersistentTask,
} from "@/lib/persistent-experience-controller";
type State = {
  owner: string | null;
  enabled: boolean;
  executionEnabled: boolean;
  views: PersistentConnectionView[];
  tasks: PersistentTask[];
  busy: boolean;
  error: string;
  scope: string | null;
};
const initial: State = {
  owner: null,
  enabled: false,
  executionEnabled: false,
  views: [],
  tasks: [],
  busy: false,
  error: "",
  scope: null,
};
export function usePersistentWorkspace(workspace: HoldingsWorkspace, hubOrigin: string | null) {
  const auth = useAuth(),
    owner = auth.status === "authenticated" ? auth.sessionKey : null;
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const scope =
    visible && owner && workspace.owner === owner && workspace.phase === "unlocked"
      ? `${owner}:${workspace.vaultGeneration}`
      : null;
  const [state, setState] = useState<State>(initial);
  const live = useRef({ auth, workspace, owner, scope, visible, hubOrigin });
  live.current = { auth, workspace, owner, scope, visible, hubOrigin };
  const job = useRef<AbortController | null>(null);
  const execute = useCallback(
    async <T>(
      action: (
        controller: PersistentExperienceController,
        api: (path: string, options?: any) => Promise<any>,
        assert: () => void,
      ) => Promise<T>,
      privateRead = true,
    ): Promise<T | null> => {
      if (job.current) return null;
      const start = live.current;
      if (
        !start.owner ||
        !start.auth.agentHubConfigured ||
        !start.visible ||
        (privateRead && !start.scope)
      )
        return null;
      const abort = new AbortController();
      job.current = abort;
      const timer = setTimeout(() => abort.abort(), 120000);
      const assert = () => {
        const n = live.current;
        if (
          abort.signal.aborted ||
          job.current !== abort ||
          n.owner !== start.owner ||
          !n.visible ||
          !n.auth.agentHubConfigured ||
          n.scope !== start.scope
        )
          throw new PersistentExperienceError("cancelled");
      };
      const api = async (
        service: "agent-hub" | "portfolio" | "user",
        path: string,
        options: any = {},
      ) => {
        assert();
        const r = await start.auth.requestPrivate(service, path, start.owner!, {
          ...options,
          signal: abort.signal,
          ...(service === "user"
            ? {}
            : { headers: { "X-FolioView-Contract": PERSISTENT_CONTRACT, ...options.headers } }),
        });
        assert();
        if (!r.ok)
          throw new PersistentExperienceError(
            r.status === 404
              ? "not_found"
              : r.status === 409
                ? "version_conflict"
                : "request_failed",
          );
        if (!r.body) throw new PersistentExperienceError("invalid_response");
        const reader = r.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        abort.signal.addEventListener("abort", cancel, { once: true });
        try {
          for (;;) {
            const p = await reader.read();
            assert();
            if (p.done) break;
            size += p.value.length;
            if (size > 4194304) throw new PersistentExperienceError("invalid_response");
            chunks.push(p.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const p of chunks) {
            bytes.set(p, offset);
            offset += p.length;
          }
          const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          assert();
          return value;
        } finally {
          abort.signal.removeEventListener("abort", cancel);
          cancel();
          reader.releaseLock();
        }
      };
      const hub = (path: string, options: any = {}) => api("agent-hub", path, options);
      setState((s) =>
        s.owner === start.owner
          ? { ...s, busy: true, error: "" }
          : { ...initial, owner: start.owner, busy: true },
      );
      try {
        assert();
        if (privateRead) {
          await live.current.workspace.refreshVault(abort.signal, false);
          assert();
        }
        const result = await action(
          new PersistentExperienceController(
            api,
            () => live.current.workspace,
            assert,
            abort.signal,
          ),
          hub,
          assert,
        );
        assert();
        return result;
      } catch (error) {
        if (
          !abort.signal.aborted &&
          live.current.owner === start.owner &&
          (!privateRead || live.current.scope === start.scope)
        ) {
          const code = (error as { code?: string })?.code;
          setState((s) => ({
            ...s,
            error: [
              "review_changed",
              "select_task",
              "select_resource",
              "replacement_review_required",
              "resource_not_approved",
              "persistent_operation_pending",
              "version_conflict",
              "source_unavailable",
            ].includes(code ?? "")
              ? code!
              : "request_failed",
          }));
        }
        return null;
      } finally {
        clearTimeout(timer);
        abort.abort();
        if (job.current === abort) {
          job.current = null;
          setState((s) => (s.owner === live.current.owner ? { ...s, busy: false } : initial));
        }
      }
    },
    [],
  );
  const reload = useCallback(
    () =>
      execute(async (c, api, assert) => {
        const caps = await api("/api/v2/persistent-agents/capabilities"),
          native = await api("/api/v2/persistent-account-authorizations/capabilities"),
          list = await api("/api/v2/persistent-connections");
        const views: PersistentConnectionView[] = [],
          tasks =
            live.current.scope && (native.accountLinkEnabled || list.connections.length)
              ? await c.tasks()
              : [];
        for (const connection of list.connections as PersistentConnection[]) {
          const view: PersistentConnectionView = {
            connection,
            identity: null,
            policy: null,
            tasks: [],
            pending: false,
            error: "",
          };
          if (
            live.current.scope &&
            connection.status === "active" &&
            connection.vaultId === live.current.workspace.vault?.vaultId
          ) {
            try {
              const context = await c.review(connection);
              assert();
              view.identity = context.identity;
              view.policy = context.policy;
              if (caps.executionEnabled && live.current.workspace.canWriteState)
                await c.synchronize(connection);
              for (const task of tasks.filter(
                (t) => t.authority.authority?.context.connectionId === connection.connectionId,
              )) {
                const raw = await c.plan(connection, task.taskId);
                const plan = await live.current.workspace.verifyPersistentPlan({
                  actor: { connectionId: connection.connectionId, clientId: connection.clientId },
                  ...raw,
                  taskId: task.taskId,
                  hubOrigin: live.current.hubOrigin,
                });
                assert();
                view.tasks.push({ ...task, plan });
              }
              view.pending = !!(await live.current.workspace.loadPersistentPending({
                connectionId: connection.connectionId,
                clientId: connection.clientId,
              }));
              assert();
            } catch {
              view.error = "review_required";
            }
            try {
              view.pending = !!(await live.current.workspace.loadPersistentPending({
                connectionId: connection.connectionId,
                clientId: connection.clientId,
              }));
              assert();
            } catch {
              assert();
            }
          }
          views.push(view);
        }
        assert();
        setState({
          owner: live.current.owner,
          enabled:
            !!native.accountLinkEnabled &&
            !!caps.enrollmentEnabled &&
            !!caps.resourceConsentEnabled,
          executionEnabled: !!caps.executionEnabled,
          views,
          tasks,
          busy: true,
          error: "",
          scope: live.current.scope,
        });
      }, false),
    [execute],
  );
  useEffect(() => {
    job.current?.abort();
    job.current = null;
    setState((s) =>
      s.owner === owner
        ? {
            ...s,
            views: s.views.map((v) => ({
              ...v,
              identity: null,
              policy: null,
              tasks: [],
              pending: false,
              error: "",
            })),
            tasks: [],
            scope: null,
            busy: false,
            error: "",
          }
        : initial,
    );
    if (owner && visible) void reload();
    return () => {
      job.current?.abort();
      job.current = null;
    };
  }, [owner, scope, visible, reload]);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    change();
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!owner || !visible || !scope) return;
    const timer = setInterval(() => void reload(), 60000);
    return () => clearInterval(timer);
  }, [owner, visible, scope, reload]);
  const perform = useCallback(
    async (action: (c: PersistentExperienceController) => Promise<unknown>) => {
      const result = await execute((c) => action(c));
      await reload();
      return result !== null;
    },
    [execute, reload],
  );
  const visibleState = state.owner === owner ? state : initial;
  return {
    ...visibleState,
    tasks: scope !== null && visibleState.scope === scope ? visibleState.tasks : [],
    views: visibleState.views.map((v) =>
      scope !== null && visibleState.scope === scope
        ? v
        : { ...v, identity: null, policy: null, tasks: [], pending: false },
    ),
    unlocked: !!scope,
    owner,
    reload,
    execute,
    review: (connection: PersistentConnection) => execute((c) => c.review(connection)),
    approve: (
      connection: PersistentConnection,
      tasks: PersistentTask[],
      review: Record<string, any>,
      allowReassign: boolean,
    ) => perform((c) => c.approve(connection, tasks, review, allowReassign)),
    withdraw: (connection: PersistentConnection, ids: string[]) =>
      perform((c) => c.revoke(connection, ids)),
    resume: (connection: PersistentConnection) => perform((c) => c.resume(connection)),
    disconnect: async (connection: PersistentConnection) => {
      await execute(
        async (_c, api) =>
          api(`/api/v2/persistent-connections/${connection.connectionId}/revocations`, {
            method: "POST",
            json: { contractVersion: PERSISTENT_CONTRACT },
          }),
        false,
      );
      await reload();
    },
  };
}
export type PersistentWorkspaceModel = ReturnType<typeof usePersistentWorkspace>;
