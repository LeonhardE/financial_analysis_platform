"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
type J = Record<string, any>;
const C = "folioview.agent-workspace.v2.0",
  P = "folioview.private-display-name.v1";
export const displayRefKey = (r: J) =>
  [r.kind, r.sourceService, r.resourceId, r.incarnation].join(":");
const same = (a: J, b: J) => displayRefKey(a) === displayRefKey(b);
const code = (e: unknown) =>
  e instanceof Error &&
  [
    "cancelled",
    "timeout",
    "not_found",
    "conflict",
    "unlock_required",
    "operation_pending",
    "display_name_invalid",
    "invalid_response",
  ].includes(e.message)
    ? e.message
    : "request_failed";
export function useDisplayNames(workspace: HoldingsWorkspace, active: boolean) {
  const auth = useAuth(),
    [visible, setVisible] = useState(
      () => typeof document === "undefined" || document.visibilityState !== "hidden",
    );
  const scope =
    visible &&
    auth.status === "authenticated" &&
    auth.agentHubConfigured &&
    workspace.owner === auth.sessionKey &&
    workspace.phase === "unlocked" &&
    !workspace.needsDeviceApproval &&
    workspace.vault
      ? `${auth.sessionKey}:${workspace.vault.vaultId}:${workspace.vault.rootKeyId}:${workspace.vaultGeneration}`
      : null;
  const [state, setState] = useState<{
    scope: string | null;
    ready: boolean;
    enabled: boolean;
    loading: boolean;
    busy: boolean;
    error: string;
    names: Record<string, { name: string; state: J }>;
    pending: Record<string, J>;
  }>({
    scope: null,
    ready: false,
    enabled: false,
    loading: false,
    busy: false,
    error: "",
    names: {},
    pending: {},
  });
  const live = useRef({ scope, workspace, auth, active, visible });
  live.current = { scope, workspace, auth, active, visible };
  const jobs = useRef(new Set<AbortController>()),
    fresh = useRef(0),
    readSerial = useRef(0),
    readBusy = useRef(false),
    writing = useRef<object | null>(null),
    pending = useRef(new Map<string, J>());
  const update = useCallback((patch: Partial<typeof state>, expected: string | null) => {
    if (expected && live.current.scope === expected)
      setState((s) => (live.current.scope === expected ? { ...s, ...patch, scope: expected } : s));
  }, []);
  const api = useCallback(
    async (path: string, options: any = {}, expected = live.current.scope): Promise<J | null> => {
      const start = live.current;
      if (!expected || start.scope !== expected) throw Error("cancelled");
      const abort = new AbortController();
      jobs.current.add(abort);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, 14000);
      const check = () => {
        if (abort.signal.aborted || live.current.scope !== expected)
          throw Error(timedOut ? "timeout" : "cancelled");
      };
      try {
        check();
        const response = await start.auth.requestPrivate(
          "agent-hub",
          path,
          start.auth.sessionKey!,
          {
            method: options.packet ? "POST" : "GET",
            signal: abort.signal,
            coalesceDisplay: !options.packet && !options.fresh,
            ...(options.packet ? { json: options.packet.body } : {}),
            headers: {
              "X-FolioView-Contract": C,
              ...(options.packet ? { "Idempotency-Key": options.packet.operationId } : {}),
            },
          },
        );
        check();
        if (response.status === 404 && options.missing) {
          void response.body?.cancel().catch(() => {});
          return null;
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw Error(
            response.status === 409
              ? "conflict"
              : response.status === 403
                ? "unlock_required"
                : response.status === 404
                  ? "not_found"
                  : "request_failed",
          );
        }
        if (
          !response.body ||
          response.headers.get("content-type")?.split(";")[0] !== "application/json"
        )
          throw Error("invalid_response");
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        const cancel = () => void reader.cancel().catch(() => {});
        abort.signal.addEventListener("abort", cancel, { once: true });
        try {
          for (;;) {
            const part = await reader.read();
            check();
            if (part.done) break;
            size += part.value.length;
            if (size > 262144) throw Error("invalid_response");
            chunks.push(part.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const c of chunks) {
            bytes.set(c, offset);
            offset += c.length;
          }
          const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          check();
          if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data) ||
            data.contractVersion !== C ||
            data.profile !== P
          )
            throw Error("invalid_response");
          const keys = Object.keys(data).sort().join(",");
          const allowed = path.endsWith("/capabilities")
            ? "contractVersion,enabled,maxNameLength,maxSources,profile"
            : Object.hasOwn(data, "items")
              ? "contractVersion,items,profile"
              : "contractVersion,item,profile";
          if (keys !== allowed) throw Error("invalid_response");
          return data;
        } finally {
          abort.signal.removeEventListener("abort", cancel);
          cancel();
          reader.releaseLock();
        }
      } catch (error) {
        check();
        throw error;
      } finally {
        clearTimeout(timer);
        jobs.current.delete(abort);
      }
    },
    [],
  );
  const base = (vault: string, ref?: J) =>
    `/api/v3/private-display-names/${vault}/holdings${ref ? "/" + ref.resourceId : ""}`;
  const load = useCallback(
    async (force = false, refreshRoot = false) => {
      const start = live.current,
        expected = scope;
      if (
        !expected ||
        start.scope !== expected ||
        !start.active ||
        readBusy.current ||
        Boolean(writing.current) ||
        (!force && fresh.current > 0 && Date.now() - fresh.current < 30000)
      )
        return;
      const serial = ++readSerial.current;
      readBusy.current = true;
      update({ loading: true, error: "" }, expected);
      try {
        if (refreshRoot) {
          const a = new AbortController();
          jobs.current.add(a);
          const timer = setTimeout(() => a.abort(), 14000);
          try {
            await start.workspace.refreshVault(a.signal);
          } finally {
            clearTimeout(timer);
            jobs.current.delete(a);
          }
        }
        const caps = await api(
          "/api/v3/private-display-names/capabilities",
          { missing: true },
          expected,
        );
        if (serial !== readSerial.current || live.current.scope !== expected)
          throw Error("cancelled");
        if (!caps || caps.enabled !== true) {
          update({ enabled: false, ready: true, loading: false }, expected);
          return;
        }
        if (caps.maxNameLength !== 80 || caps.maxSources !== 10) throw Error("invalid_response");
        const data = await api(base(start.workspace.vault!.vaultId), {}, expected);
        if (!data || !Array.isArray(data.items) || data.items.length > 10)
          throw Error("invalid_response");
        const refs = start.workspace.sources.map((s) => s.resourceRef);
        const opened = await start.workspace.openDisplayNames(
          refs,
          data.items.filter((v: J) => refs.some((r) => same(r, v.state?.ref ?? {}))),
        );
        if (live.current.scope !== expected || serial !== readSerial.current)
          throw Error("cancelled");
        const names = Object.fromEntries(
          opened.map((v: J) => [displayRefKey(v.ref), { name: v.name, state: v.state }]),
        );
        fresh.current = Date.now();
        update({ names, enabled: true, ready: true, loading: false, error: "" }, expected);
        // Recover original local packets without submitting any automatic write.
        for (const ref of refs) {
          const packet = await start.workspace.loadDisplayNamePending(ref);
          if (live.current.scope !== expected || serial !== readSerial.current)
            throw Error("cancelled");
          if (packet) pending.current.set(displayRefKey(ref), packet);
          else pending.current.delete(displayRefKey(ref));
          update({ pending: Object.fromEntries(pending.current) }, expected);
        }
      } catch (e) {
        if (serial === readSerial.current) update({ loading: false, error: code(e) }, expected);
      } finally {
        if (serial === readSerial.current) readBusy.current = false;
      }
    },
    [scope, api, update],
  );
  const refreshRoot = useCallback(async (expected: string, write = false) => {
    const a = new AbortController();
    jobs.current.add(a);
    const t = setTimeout(() => a.abort(), 14000);
    try {
      await live.current.workspace.refreshVault(a.signal, write);
      if (live.current.scope !== expected || a.signal.aborted) throw Error("cancelled");
    } finally {
      clearTimeout(t);
      jobs.current.delete(a);
    }
  }, []);
  const readCurrentName = useCallback(
    async (ref: J, expected: string) => {
      const latest = await api(
        base(live.current.workspace.vault!.vaultId, ref),
        { fresh: true, missing: true },
        expected,
      );
      if (latest) {
        const opened = await live.current.workspace.openDisplayName(ref, latest.item);
        if (live.current.scope !== expected) throw Error("cancelled");
        setState((s) =>
          live.current.scope !== expected
            ? s
            : {
                ...s,
                names: {
                  ...s.names,
                  [displayRefKey(ref)]: { name: opened.name, state: opened.state },
                },
              },
        );
      } else
        setState((s) => {
          if (live.current.scope !== expected) return s;
          const names = { ...s.names };
          delete names[displayRefKey(ref)];
          return { ...s, names };
        });
    },
    [api],
  );
  const finish = useCallback(
    async (ref: J, packet: J, value: J, expected: string) => {
      if (live.current.scope !== expected) throw Error("cancelled");
      if (!value.item || value.item.state?.stableOperationId !== packet.operationId)
        throw Error("invalid_response");
      await live.current.workspace.finishDisplayNamePending(ref, value);
      if (live.current.scope !== expected) throw Error("cancelled");
      pending.current.delete(displayRefKey(ref));
      update({ pending: Object.fromEntries(pending.current) }, expected);
      // Never label from an original receipt that may predate another rename.
      await readCurrentName(ref, expected);
    },
    [readCurrentName, update],
  );

  const rename = useCallback(
    async (ref: J, name: string, alreadyFresh = false) => {
      const expected = scope,
        start = live.current;
      if (
        !expected ||
        start.scope !== expected ||
        !start.workspace.canWriteState ||
        writing.current
      )
        return false;
      const token = {};
      writing.current = token;
      ++readSerial.current;
      readBusy.current = false;
      update({ busy: true, loading: false, error: "" }, expected);
      try {
        const existing = await start.workspace.loadDisplayNamePending(ref);
        if (live.current.scope !== expected) throw Error("cancelled");
        if (existing) {
          pending.current.set(displayRefKey(ref), existing);
          update({ pending: Object.fromEntries(pending.current) }, expected);
          throw Error("operation_pending");
        }
        if (!alreadyFresh) await refreshRoot(expected, true);
        const current = await api(
          base(start.workspace.vault!.vaultId, ref),
          { fresh: true },
          expected,
        );
        if (!current || !Object.hasOwn(current, "item")) throw Error("invalid_response");
        const packet = await live.current.workspace.prepareDisplayName({
          ref,
          item: current.item,
          name,
        });
        if (live.current.scope !== expected) throw Error("cancelled");
        pending.current.set(displayRefKey(ref), packet);
        update({ pending: Object.fromEntries(pending.current) }, expected);
        const value = await api(
          base(start.workspace.vault!.vaultId, ref) + "/commands",
          { packet },
          expected,
        );
        if (!value) throw Error("invalid_response");
        await finish(ref, packet, value, expected);
        fresh.current = 0;
        return true;
      } catch (e) {
        update({ error: code(e) }, expected);
        return false;
      } finally {
        if (writing.current === token) {
          writing.current = null;
          update({ busy: false }, expected);
        }
      }
    },
    [scope, api, refreshRoot, finish, update],
  );
  const recover = useCallback(
    async (ref: J, replay = false, discard = false) => {
      const expected = scope,
        start = live.current;
      if (!expected || start.scope !== expected || writing.current) return false;
      const token = {};
      writing.current = token;
      ++readSerial.current;
      readBusy.current = false;
      update({ busy: true, loading: false, error: "" }, expected);
      try {
        const packet = await start.workspace.loadDisplayNamePending(ref);
        if (live.current.scope !== expected) throw Error("cancelled");
        if (!packet) {
          pending.current.delete(displayRefKey(ref));
          update({ pending: Object.fromEntries(pending.current) }, expected);
          await refreshRoot(expected);
          await readCurrentName(ref, expected);
          return true;
        }
        await refreshRoot(expected);
        const path = base(start.workspace.vault!.vaultId, ref);
        let value = await api(
          path + "/operations/" + packet.operationId,
          { fresh: true, missing: true },
          expected,
        );
        if (!value && replay) value = await api(path + "/commands", { packet }, expected);
        if (!value && discard) {
          await live.current.workspace.discardDisplayNamePending(ref, packet.operationId);
          if (live.current.scope !== expected) throw Error("cancelled");
          pending.current.delete(displayRefKey(ref));
          update({ pending: Object.fromEntries(pending.current) }, expected);
          await readCurrentName(ref, expected);
          return true;
        }
        if (!value) {
          update({ error: "operation_pending" }, expected);
          return false;
        }
        await finish(ref, packet, value, expected);
        return true;
      } catch (e) {
        update({ error: code(e) }, expected);
        return false;
      } finally {
        if (writing.current === token) {
          writing.current = null;
          update({ busy: false }, expected);
        }
      }
    },
    [scope, api, refreshRoot, finish, readCurrentName, update],
  );
  useEffect(() => {
    const changed = () => {
      const v = document.visibilityState !== "hidden";
      live.current.visible = v;
      setVisible(v);
      if (!v) for (const j of jobs.current) j.abort();
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    for (const j of jobs.current) j.abort();
    ++readSerial.current;
    readBusy.current = false;
    writing.current = null;
    pending.current.clear();
    fresh.current = 0;
    setState({
      scope,
      ready: false,
      enabled: false,
      loading: false,
      busy: false,
      error: "",
      names: {},
      pending: {},
    });
    return () => {
      for (const j of jobs.current) j.abort();
    };
  }, [scope]);
  const refsVersion = workspace.sources
    .map((s) => displayRefKey(s.resourceRef) + ":" + s.sourceEpoch)
    .sort()
    .join("|");
  useEffect(() => {
    fresh.current = 0;
    if (scope && active) {
      void load(true);
    }
  }, [scope, refsVersion]);
  useEffect(() => {
    if (scope && active) void load();
  }, [scope, active, load]);
  const current =
    scope && state.scope === scope
      ? state
      : {
          ...state,
          names: {},
          pending: {},
          error: "",
          busy: false,
          ready: false,
          enabled: false,
          loading: Boolean(scope),
        };
  return {
    scope,
    enabled: current.enabled,
    ready: current.ready,
    loading: current.loading,
    busy: current.busy,
    error: current.error,
    name: (ref: J) =>
      live.current.scope === scope && scope
        ? (current.names[displayRefKey(ref)]?.name ?? null)
        : null,
    pending: (ref: J) => Boolean(current.pending[displayRefKey(ref)]),
    rename,
    recover,
    discard: (ref: J) => recover(ref, false, true),
    reload: () => load(true, true),
    clearError: () => update({ error: "" }, scope),
  };
}
export type DisplayNamesModel = ReturnType<typeof useDisplayNames>;
