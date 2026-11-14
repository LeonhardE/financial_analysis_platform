"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import {
  connectionSummary,
  connectionDisplay,
  type ConnectionDisplay,
} from "@/lib/connection-summary";
import {
  PersistentExperienceController,
  PersistentExperienceError,
  PERSISTENT_CONTRACT,
  type PersistentConnection,
  type PersistentConnectionView,
  type PersistentTask,
} from "@/lib/persistent-experience-controller";
// Only the first-party proxy can mark rejection before forwarding. Upstream
// headers are stripped; generic failures and unknown commits never get retried.
function admissionWait(response: Response) {
  const delay = response.headers.get("retry-after");
  return response.status === 503 &&
    response.headers.get("x-folioview-admission-retry") === "safe" &&
    delay !== null &&
    /^(?:[1-9]|[1-5][0-9]|60)$/.test(delay)
    ? Number(delay)
    : null;
}
function waitForAdmission(seconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new PersistentExperienceError("cancelled"));
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      finish();
      reject(new PersistentExperienceError("cancelled"));
    };
    const timer = setTimeout(() => {
      finish();
      resolve();
    }, seconds * 1000);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
type State = {
  owner: string | null;
  enabled: boolean;
  executionEnabled: boolean;
  views: PersistentConnectionView[];
  tasks: PersistentTask[];
  providerStates: Record<string, Record<string, any>>;
  revision: number;
  busy: boolean;
  loading: boolean;
  loaded: boolean;
  loadError: boolean;
  loadScope: string | null;
  waitingForService: boolean;
  error: string;
  scope: string | null;
  hubOrigin: string | null;
};
const initial: State = {
  owner: null,
  enabled: false,
  executionEnabled: false,
  views: [],
  tasks: [],
  providerStates: {},
  revision: 0,
  busy: false,
  loading: false,
  loaded: false,
  loadError: false,
  loadScope: null,
  waitingForService: false,
  error: "",
  scope: null,
  hubOrigin: null,
};
export function usePersistentWorkspace(
  workspace: HoldingsWorkspace,
  hubOrigin: string | null,
  active = true,
) {
  const auth = useAuth(),
    owner = auth.status === "authenticated" ? auth.sessionKey : null;
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const scope =
    visible && owner && workspace.owner === owner && workspace.phase === "unlocked"
      ? `${owner}:${workspace.vault?.vaultId ?? "unavailable"}:${workspace.vaultGeneration}`
      : null;
  const [state, setState] = useState<State>(initial);
  const live = useRef({ auth, workspace, owner, scope, visible, hubOrigin, active });
  live.current = { auth, workspace, owner, scope, visible, hubOrigin, active };
  const job = useRef<AbortController | null>(null);
  const displayJob = useRef<AbortController | null>(null);
  const fresh = useRef(0);
  const read = useRef<symbol | null>(null);
  const execute = useCallback(
    async <T>(
      action: (
        controller: PersistentExperienceController,
        api: (path: string, options?: any) => Promise<any>,
        assert: () => void,
      ) => Promise<T>,
      privateRead = true,
      display = false,
      prepareDisplay?: (
        api: (path: string, options?: any) => Promise<any>,
        assert: () => void,
      ) => Promise<(() => Promise<Response>) | undefined>,
    ): Promise<T | null> => {
      if (job.current) return null;
      if (display && (!live.current.active || displayJob.current)) return null;
      const start = live.current;
      if (
        !start.owner ||
        !start.auth.agentHubConfigured ||
        !start.visible ||
        (privateRead && !start.scope)
      )
        return null;
      if (!display) {
        displayJob.current?.abort();
        displayJob.current = null;
        read.current = null;
      }
      const abort = new AbortController();
      const lane = display ? displayJob : job;
      lane.current = abort;
      let timedOut = false;
      const timer = setTimeout(
        () => {
          timedOut = true;
          abort.abort();
        },
        display ? 14000 : 120000,
      );
      let cancel = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => reject(new PersistentExperienceError(timedOut ? "timeout" : "cancelled"));
        abort.signal.addEventListener("abort", cancel, { once: true });
      });
      const assert = () => {
        const n = live.current;
        if (
          abort.signal.aborted ||
          lane.current !== abort ||
          (display && !n.active) ||
          n.owner !== start.owner ||
          !n.visible ||
          !n.auth.agentHubConfigured ||
          n.scope !== start.scope ||
          n.hubOrigin !== start.hubOrigin
        )
          throw new PersistentExperienceError("cancelled");
      };
      const request = async (
        service: "agent-hub" | "portfolio" | "user",
        path: string,
        options: any = {},
      ) => {
        assert();
        const suppliedHeaders = new Headers(options.headers),
          operation = suppliedHeaders.get("idempotency-key"),
          method = options.method ?? "GET",
          safeRetry =
            method === "GET" ||
            (["POST", "PUT", "PATCH"].includes(method) &&
              operation !== null &&
              /^[A-Za-z0-9_-]{22,128}$/.test(operation));
        if (display && method !== "GET")
          throw new PersistentExperienceError("invalid_display_request");
        const requestHeaders = new Headers(
          service === "user" ? undefined : { "X-FolioView-Contract": PERSISTENT_CONTRACT },
        );
        suppliedHeaders.forEach((value, key) => requestHeaders.set(key, value));
        // Snapshot the sealed original once so a delayed retry cannot adopt edits.
        const requestOptions = {
          ...options,
          ...(options.json === undefined ? {} : { json: JSON.parse(JSON.stringify(options.json)) }),
          signal: abort.signal,
          headers: Object.fromEntries(requestHeaders),
        };
        let r: Response;
        for (let attempt = 0; ; attempt++) {
          r = await start.auth.requestPrivate(service, path, start.owner!, requestOptions);
          assert();
          const delay = admissionWait(r);
          if (attempt !== 0 || !safeRetry || delay === null) break;
          void r.body?.cancel().catch(() => {});
          setState((s) => ({ ...s, waitingForService: true }));
          try {
            await waitForAdmission(delay, abort.signal);
            assert();
          } finally {
            setState((s) => (s.owner === start.owner ? { ...s, waitingForService: false } : s));
          }
        }
        return r;
      };
      const api = async (
        service: "agent-hub" | "portfolio" | "user",
        path: string,
        options: any = {},
      ) => {
        const r = await request(service, path, options);
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
            const maximum = /^\/api\/v3\/provider-connections\/[^/]+\/display$/.test(path)
              ? 1048576
              : 4194304;
            if (size > maximum) throw new PersistentExperienceError("invalid_response");
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
      const refreshVault = (
        signal: AbortSignal,
        forState = false,
        readCurrent?: () => Promise<Response>,
      ) =>
        live.current.workspace.refreshVault(
          signal,
          forState,
          readCurrent ?? (() => request("agent-hub", "/api/v2/vaults/current")),
        );
      const hub = (path: string, options: any = {}) => api("agent-hub", path, options);
      if (!display)
        setState((s) =>
          s.owner === start.owner && s.hubOrigin === start.hubOrigin
            ? { ...s, busy: true, loading: false, waitingForService: false, error: "", tasks: [] }
            : { ...initial, owner: start.owner, hubOrigin: start.hubOrigin, busy: true },
        );
      try {
        assert();
        const result = await Promise.race([
          (async () => {
            if (privateRead) {
              const readCurrent =
                display && prepareDisplay ? await prepareDisplay(hub, assert) : undefined;
              assert();
              await refreshVault(abort.signal, false, readCurrent);
              assert();
            }
            return action(
              new PersistentExperienceController(
                api,
                () => ({ ...live.current.workspace, refreshVault }),
                assert,
                abort.signal,
                live.current.hubOrigin ?? "",
              ),
              hub,
              assert,
            );
          })(),
          cancelled,
        ]);
        assert();
        return result;
      } catch (error) {
        if (
          (!abort.signal.aborted || timedOut) &&
          lane.current === abort &&
          live.current.owner === start.owner &&
          live.current.scope === start.scope
        ) {
          const code = (error as { code?: string })?.code;
          if (!display)
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
        abort.signal.removeEventListener("abort", cancel);
        if (lane.current === abort) {
          lane.current = null;
          if (!display)
            setState((s) =>
              s.owner === live.current.owner
                ? { ...s, busy: false, waitingForService: false }
                : initial,
            );
        }
      }
    },
    [],
  );
  const reload = useCallback(
    async (force = true) => {
      const start = live.current;
      if (
        job.current ||
        displayJob.current ||
        !start.scope ||
        !start.hubOrigin ||
        !start.active ||
        !start.auth.agentHubConfigured ||
        (!force && fresh.current !== 0 && Date.now() - fresh.current < 30000)
      )
        return null;
      const token = Symbol();
      read.current = token;
      setState((s) => ({
        ...(s.owner === start.owner ? s : { ...initial, owner: start.owner }),
        loading: true,
        loadError: false,
        loadScope: start.scope,
        hubOrigin: start.hubOrigin,
      }));
      let prepared: ConnectionDisplay | null = null;
      const result = await execute(
        async (c, api, assert) => {
          // One snapshot pairs verified credentials and provider slots. No task,
          // resource policy or native-plan scan is needed to show a connection.
          const vaultId = start.workspace.vault!.vaultId;
          const [caps, native, credentials, summary] =
            prepared?.mode === "complete"
              ? [
                  prepared.capabilities.agents,
                  prepared.capabilities.account,
                  prepared.capabilities.credentials,
                  prepared.summary,
                ]
              : await Promise.all(
                  [
                    "/api/v2/persistent-agents/capabilities",
                    "/api/v2/persistent-account-authorizations/capabilities",
                    "/api/v3/agent-credentials/capabilities",
                    `/api/v3/provider-connections/${vaultId}/summary`,
                  ].map((path) => api(path, { coalesceDisplay: true })),
                );
          if (!connectionSummary(summary, vaultId))
            throw new PersistentExperienceError("invalid_response");
          const { muse, chatgpt } = summary.providers;
          const states = new Map(
            summary.credentials.map((item) => [item.connectionId, item.state]),
          );
          const views: PersistentConnectionView[] = summary.connections.map(
            (connection: PersistentConnection) => ({
              connection,
              identity: null,
              credential: null,
              policy: null,
              tasks: [],
              pending: false,
              error: "",
            }),
          );
          let cursor = 0;
          const work = async () => {
            while (cursor < views.length) {
              const view = views[cursor++],
                connection = view.connection;
              assert();
              if (
                connection.status !== "active" ||
                connection.vaultId !== start.workspace.vault!.vaultId
              )
                continue;
              // Transport or verification failure makes the snapshot unavailable.
              // Never turn an unread credential into reauthorization/disconnection.
              const slot = (connection.provider === "muse" ? muse : chatgpt).slot,
                ref = slot?.currentCredential;
              // With a provider slot, only its exact current connection needs
              // credential verification. Legacy ambiguous inventories
              // still verify all candidates instead of inventing a current one.
              if (
                !slot ||
                (ref?.connectionId === connection.connectionId &&
                  ref.clientId === connection.clientId)
              ) {
                const credential = await c.inspectCredential(
                  connection,
                  states.get(connection.connectionId)!,
                );
                assert();
                view.credential = {
                  ...credential.verified,
                  reference: credential.state.lease
                    ? {
                        connectionId: connection.connectionId,
                        clientId: connection.clientId,
                        credentialGeneration: credential.state.lease.generation,
                        credentialFingerprint: credential.state.lease.credentialFingerprint,
                      }
                    : null,
                };
                view.identity = credential.state.identity;
              }
              view.pending = !!(await live.current.workspace.loadPersistentPending({
                connectionId: connection.connectionId,
                clientId: connection.clientId,
              }));
              assert();
            }
          };
          await Promise.all(Array.from({ length: Math.min(2, views.length) }, work));
          assert();
          fresh.current = Date.now();
          setState((s) => ({
            ...s,
            owner: start.owner,
            enabled:
              !!native.accountLinkEnabled && !!credentials.enabled && !!caps.resourceConsentEnabled,
            executionEnabled: !!caps.executionEnabled,
            views,
            providerStates: { muse, chatgpt },
            tasks: [],
            busy: false,
            loaded: true,
            loadError: false,
            loadScope: start.scope,
            scope: start.scope,
            hubOrigin: start.hubOrigin,
            revision: s.revision + 1,
          }));
          return true;
        },
        true,
        true,
        async (api, assert) => {
          const vaultId = start.workspace.vault!.vaultId;
          const value = await api(`/api/v3/provider-connections/${vaultId}/display`, {
            coalesceDisplay: true,
          });
          assert();
          if (!connectionDisplay(value, vaultId))
            throw new PersistentExperienceError("invalid_response");
          prepared = value;
          return value.mode === "complete"
            ? async () =>
                Response.json(value.vaultResponse, { headers: { "Cache-Control": "no-store" } })
            : undefined;
        },
      );
      if (read.current === token && live.current.scope === start.scope && live.current.active) {
        setState((s) => ({ ...s, loading: false, loadError: result !== true }));
        read.current = null;
      }
      return result;
    },
    [execute],
  );
  // Only an explicitly viewed legacy task needs its content/authority. Current
  // task-center records already own their assignments and execution history.
  const loadTask = useCallback(
    async (metadata: Record<string, any>) => {
      if (job.current || !live.current.scope || !live.current.active) return false;
      displayJob.current?.abort();
      displayJob.current = null;
      read.current = null;
      const result = await execute(
        async (c, _api, assert) => {
          const task = await c.task(metadata);
          assert();
          setState((s) => ({
            ...s,
            loading: false,
            tasks: [task],
            views: s.views.map((v) => ({
              ...v,
              tasks:
                task.authority.authority?.context.connectionId === v.connection.connectionId ||
                task.authority.taskCenter?.assignments?.some(
                  (r: Record<string, any>) =>
                    r.assignment.credential.connectionId === v.connection.connectionId &&
                    r.plan?.currentAssignment,
                )
                  ? [task]
                  : [],
            })),
          }));
          return true;
        },
        true,
        true,
      );
      return result === true;
    },
    [execute],
  );
  useEffect(() => {
    job.current?.abort();
    job.current = null;
    displayJob.current?.abort();
    displayJob.current = null;
    read.current = null;
    fresh.current = 0;
    setState({ ...initial, owner, hubOrigin });
    return () => {
      job.current?.abort();
      job.current = null;
      displayJob.current?.abort();
      displayJob.current = null;
      read.current = null;
    };
  }, [owner, scope, hubOrigin]);
  useEffect(() => {
    if (active && scope) void reload(false);
    else {
      displayJob.current?.abort();
      displayJob.current = null;
      read.current = null;
      setState((s) => ({ ...s, loading: false }));
    }
  }, [active, scope, hubOrigin, reload]);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    change();
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  const perform = useCallback(
    async (action: (c: PersistentExperienceController) => Promise<unknown>) => {
      const result = await execute((c) => action(c));
      await reload();
      return result !== null;
    },
    [execute, reload],
  );
  const visibleState = state.owner === owner && state.hubOrigin === hubOrigin ? state : initial;
  const displayState: "locked" | "loading" | "error" | "ready" =
    !scope || !active
      ? "locked"
      : visibleState.loadError || visibleState.error
        ? "error"
        : visibleState.loading ||
            visibleState.busy ||
            visibleState.scope !== scope ||
            !visibleState.loaded ||
            !fresh.current ||
            Date.now() - fresh.current >= 30000
          ? "loading"
          : "ready";
  return {
    isBusy: () => job.current !== null,
    ...visibleState,
    displayState,
    loaded: Boolean(scope && visibleState.scope === scope && visibleState.loaded),
    loading: Boolean(owner && visibleState.loadScope === scope && visibleState.loading),
    loadError: Boolean(owner && visibleState.loadScope === scope && visibleState.loadError),
    tasks: scope !== null && visibleState.scope === scope ? visibleState.tasks : [],
    views: scope !== null && visibleState.scope === scope ? visibleState.views : [],
    providerStates:
      scope !== null && visibleState.scope === scope ? visibleState.providerStates : {},
    unlocked: !!scope,
    owner,
    reload,
    loadTask,
    invalidateTask: (taskId: string) => {
      displayJob.current?.abort();
      displayJob.current = null;
      read.current = null;
      setState((s) => ({
        ...s,
        loading: false,
        tasks: s.tasks.filter((t) => t.taskId !== taskId),
        views: s.views.map((v) => ({ ...v, tasks: v.tasks.filter((t) => t.taskId !== taskId) })),
      }));
    },
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
    continueOperation: (connection: PersistentConnection) => perform((c) => c.resume(connection)),
    resume: (connection: PersistentConnection) => perform((c) => c.restore(connection)),
    synchronize: (connection: PersistentConnection) => perform((c) => c.synchronize(connection)),
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
