"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { TaskMetadata } from "@/lib/encrypted-types";
const CONTRACT = "folioview.agent-workspace.v2.0";
type J = Record<string, any>;
export function useTaskCenter(
  workspace: HoldingsWorkspace,
  active: boolean,
  selected: TaskMetadata | null,
) {
  const auth = useAuth(),
    owner = auth.status === "authenticated" ? auth.sessionKey : null;
  const scope =
    owner &&
    workspace.owner === owner &&
    workspace.phase === "unlocked" &&
    !workspace.needsDeviceApproval
      ? `${owner}:${workspace.vault?.vaultId}:${workspace.vaultGeneration}`
      : null;
  const [state, setState] = useState<{
    scope: string | null;
    enabled: boolean;
    loading: boolean;
    busy: boolean;
    error: string;
    records: Record<string, J>;
    manual: Record<string, J[]>;
    pending: J | null;
    trash: J[];
    trashCursor: string | null;
  }>({
    scope: null,
    enabled: false,
    loading: false,
    busy: false,
    error: "",
    records: {},
    manual: {},
    pending: null,
    trash: [],
    trashCursor: null,
  });
  const live = useRef({ scope, workspace, owner, active });
  live.current = { scope, workspace, owner, active };
  const reads = useRef(new Map<string, Promise<J>>()),
    lastRead = useRef(new Map<string, number>()),
    writes = useRef(false),
    controllers = useRef(new Set<AbortController>());
  const api = useCallback(
    async (
      path: string,
      options: { method?: "POST"; json?: unknown; operation?: string } = {},
    ): Promise<J> => {
      const start = live.current;
      if (!start.owner) throw Error("session_expired");
      const control = new AbortController();
      controllers.current.add(control);
      const timer = setTimeout(() => control.abort(), 14000);
      try {
        const response = await auth.requestPrivate("agent-hub", path, start.owner, {
          method: options.method ?? "GET",
          json: options.json,
          signal: control.signal,
          headers: {
            "X-FolioView-Contract": CONTRACT,
            ...(options.operation ? { "Idempotency-Key": options.operation } : {}),
          },
        });
        if (live.current.owner !== start.owner || live.current.scope !== start.scope)
          throw Error("cancelled");
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw Error(
            response.status === 404
              ? "not_found"
              : response.status === 409
                ? "version_conflict"
                : response.status === 403
                  ? "authorization_changed"
                  : response.status >= 500
                    ? "service_unavailable"
                    : "request_failed",
          );
        }
        const text = await response.text();
        if (text.length > 1048576) throw Error("invalid_response");
        const data = JSON.parse(text);
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw Error("invalid_response");
        if (live.current.scope !== start.scope || live.current.owner !== start.owner)
          throw Error("cancelled");
        return data;
      } finally {
        clearTimeout(timer);
        controllers.current.delete(control);
      }
    },
    [auth.requestPrivate],
  );
  const error = (e: unknown) => (e instanceof Error ? e.message : "request_failed");
  const update = useCallback((value: Partial<typeof state>, expected = live.current.scope) => {
    if (expected && live.current.scope === expected)
      setState((s) => ({ ...s, ...value, scope: expected }));
  }, []);
  const base = useCallback(
    (task: string) => `/api/v3/task-center/${live.current.workspace.vault!.vaultId}/tasks/${task}`,
    [],
  );
  const load = useCallback(
    async (task: string, force = false) => {
      const start = live.current;
      if (!start.scope || !start.active) return null;
      const key = `${start.scope}:${task}`;
      if (!force && Date.now() - (lastRead.current.get(key) ?? 0) < 15000) return null;
      const inFlight = reads.current.get(key);
      if (inFlight) return inFlight;
      const promise = (async () => {
        update({ loading: true, error: "" }, start.scope);
        try {
          const data = await api(base(task)),
            checked = await start.workspace.verifyTaskCenterState(data);
          const manual = await api(base(task) + "/manual");
          const pending = await start.workspace.loadTaskCenterPending(task);
          if (live.current.scope !== start.scope) return {};
          lastRead.current.set(key, Date.now());
          setState((s) => ({
            ...s,
            scope: start.scope,
            records: { ...s.records, [task]: checked },
            manual: { ...s.manual, [task]: manual.items },
            pending,
            loading: false,
            error: "",
          }));
          return data;
        } catch (e) {
          if (error(e) !== "cancelled") update({ error: error(e), loading: false }, start.scope);
          return {};
        } finally {
          reads.current.delete(key);
        }
      })();
      reads.current.set(key, promise);
      return promise;
    },
    [api, base, update],
  );
  const send = useCallback(
    async (packet: J) => {
      const start = live.current;
      const path =
        base(packet.taskId) + (packet.action === "manual_intent" ? "/manual" : "/commands");
      const receipt = await api(path, {
        method: "POST",
        json: packet.body,
        operation: packet.operationId,
      });
      await start.workspace.finishTaskCenterPending(packet.taskId, receipt);
      lastRead.current.delete(`${start.scope}:${packet.taskId}`);
      if (packet.action === "manual_intent" && live.current.scope === start.scope) {
        const encoded = packet.body.command.payload.replaceAll("-", "+").replaceAll("_", "/");
        const p = JSON.parse(
          new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))),
        );
        const pending = {
          receipt,
          snapshot: {
            requestId: packet.operationId,
            taskId: packet.taskId,
            requestedAt: receipt.acceptedAt,
            executors: p.intent.assignments.map((a: J) => ({
              ...a,
              runId: null,
              resultId: null,
              stage: "waiting",
            })),
          },
          aggregate: {
            state: "waiting",
            hasActiveExecutors: true,
            counts: { waiting: p.intent.assignments.length },
          },
          canCancel: true,
          expiresAt: receipt.expiresAt,
        };
        setState((s) => ({
          ...s,
          pending: null,
          manual: {
            ...s.manual,
            [packet.taskId]: [
              pending,
              ...(s.manual[packet.taskId] ?? []).filter(
                (v) => v.snapshot.requestId !== packet.operationId,
              ),
            ],
          },
        }));
      } else update({ pending: null }, start.scope);
      await load(packet.taskId, true);
      return receipt;
    },
    [api, base, load, update],
  );
  const command = useCallback(
    async (task: string, action: string, value: unknown = null, provided?: J) => {
      const start = live.current;
      if (!start.scope || writes.current || !start.workspace.canWriteState)
        throw Error("unlock_required");
      writes.current = true;
      update({ busy: true, error: "" }, start.scope);
      try {
        const existing = await start.workspace.loadTaskCenterPending(task);
        if (existing) {
          update({ pending: existing }, start.scope);
          throw Error("operation_pending");
        }
        const current = provided ?? (await api(base(task)));
        const packet = await start.workspace.prepareTaskCenterControl({
          state: current,
          action,
          value,
        });
        update({ pending: packet }, start.scope);
        return await send(packet);
      } catch (e) {
        update({ error: error(e) }, start.scope);
        throw e;
      } finally {
        writes.current = false;
        update({ busy: false }, start.scope);
      }
    },
    [api, base, send, update],
  );
  const recover = useCallback(
    async (task: string, replay = false, abandon = false) => {
      const start = live.current;
      if (!start.scope || writes.current) return;
      writes.current = true;
      update({ busy: true, error: "" }, start.scope);
      try {
        const packet = await start.workspace.loadTaskCenterPending(task);
        if (!packet) return;
        update({ pending: packet }, start.scope);
        if (abandon) {
          const bytes = new TextEncoder().encode(
            packet.body.command.protected + "." + packet.body.command.payload,
          );
          const fp = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          const outcome = await api(base(task) + `/operations/${packet.operationId}/cancel`, {
            method: "POST",
            json: { contractVersion: CONTRACT, fingerprint: fp },
          });
          await start.workspace.finishTaskCenterPending(task, outcome);
          update({ pending: null }, start.scope);
          await load(task, true);
          return;
        }
        if (replay) {
          await send(packet);
          return;
        }
        const data = await api(
          base(task) +
            (packet.action === "manual_intent"
              ? `/manual/${packet.operationId}`
              : `/operations/${packet.operationId}`),
        );
        await start.workspace.finishTaskCenterPending(
          task,
          packet.action === "manual_intent" ? data.receipt : data,
        );
        update({ pending: null }, start.scope);
        await load(task, true);
      } catch (e) {
        update({ error: error(e) }, start.scope);
      } finally {
        writes.current = false;
        update({ busy: false }, start.scope);
      }
    },
    [api, base, load, send, update],
  );
  const cancel = useCallback(
    async (task: string, intent: string) => {
      try {
        await api(base(task) + `/manual/${intent}/cancel`, {
          method: "POST",
          json: { contractVersion: CONTRACT },
        });
        await load(task, true);
      } catch (e) {
        update({ error: error(e) });
      }
    },
    [api, base, load, update],
  );
  const trashList = useCallback(
    async (more = false) => {
      const start = live.current;
      if (!start.scope) return;
      update({ loading: true, error: "" });
      try {
        const root = `/api/v3/task-center/${start.workspace.vault!.vaultId}/trash`;
        const page = await api(root + "/query", {
          method: "POST",
          json: {
            contractVersion: CONTRACT,
            cursor: more && state.scope === start.scope ? state.trashCursor : null,
          },
        });
        // Opportunistic bounded retirement, only after the service reports expiry.
        // Never schedule work, retire a recoverable row, or loop past review-required data.
        for (const row of page.items) {
          if (
            !row.canRestore &&
            row.cleanupState === "pending" &&
            row.definition?.purgeAfter * 1000 <= Date.now()
          ) {
            await api(base(row.taskId) + "/maintenance", {
              method: "POST",
              json: { contractVersion: CONTRACT },
            });
          }
        }
        const rows = await Promise.all(
          page.items.map(async (row: J) => ({
            ...row,
            title: row.envelope ? (await start.workspace.openTask(row.envelope)).name : null,
          })),
        );
        update(
          {
            trash: more ? [...state.trash, ...rows] : rows,
            trashCursor: page.nextCursor,
            loading: false,
          },
          start.scope,
        );
      } catch (e) {
        update({ loading: false, error: error(e) }, start.scope);
      }
    },
    [api, base, update, state.scope, state.trash, state.trashCursor],
  );
  useEffect(() => {
    for (const c of controllers.current) c.abort();
    reads.current.clear();
    lastRead.current.clear();
    setState({
      scope,
      enabled: false,
      loading: false,
      busy: false,
      error: "",
      records: {},
      manual: {},
      pending: null,
      trash: [],
      trashCursor: null,
    });
    if (!scope) return;
    let stopped = false;
    void api("/api/v3/task-center/capabilities")
      .then((v) => {
        if (!stopped) update({ enabled: v.enabled === true }, scope);
      })
      .catch(() => {});
    return () => {
      stopped = true;
      for (const c of controllers.current) c.abort();
    };
  }, [scope, api, update]);
  useEffect(() => {
    if (scope && active && selected) void load(selected.taskId);
  }, [scope, active, selected?.taskId, selected?.taskVersion, load]);
  useEffect(() => {
    if (!scope || !active) return;
    const tasks = Object.entries(state.manual)
      .filter(([, rows]) => rows.some((v) => v.aggregate?.hasActiveExecutors))
      .map(([task]) => task);
    if (!tasks.length) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      for (const task of tasks) {
        if (stopped || live.current.scope !== scope) break;
        try {
          const data = await api(base(task) + "/manual");
          if (!stopped && live.current.scope === scope)
            setState((s) => ({ ...s, manual: { ...s.manual, [task]: data.items } }));
        } catch (e) {
          if (error(e) !== "cancelled") update({ error: error(e) }, scope);
        }
      }
    };
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [scope, active, state.manual, api, base, update]);
  const current = scope && state.scope === scope ? state : null;
  return {
    scope,
    enabled: current?.enabled ?? false,
    loading: current?.loading ?? false,
    busy: current?.busy ?? false,
    error: current?.error ?? "",
    records: current?.records ?? {},
    manual: current?.manual ?? {},
    pending: current?.pending ?? null,
    trash: current?.trash ?? [],
    trashCursor: current?.trashCursor ?? null,
    load,
    command,
    recover,
    cancel,
    trashList,
    api,
    base,
  };
}
export type TaskCenterModel = ReturnType<typeof useTaskCenter>;
