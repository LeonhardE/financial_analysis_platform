"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { TaskCenterModel } from "./useTaskCenter";
import type { TaskModel } from "./useTasks";
import type { PersistentWorkspaceModel } from "./usePersistentWorkspace";
import { DisplayLru, untilSignal } from "@/lib/workspace-cache";
import { readInboxResultLink, clearInboxResultLink } from "@/lib/inbox-link";
import { metadata as foregroundMetadata, metadataPage } from "@/lib/inbox-types";
import {
  RESULT_CONTRACT as C,
  resultPage,
  resultKey,
  persistentResultMetadata,
  readTaskResult,
  resultRecordPath,
  stateReceipt,
  immutableMetadata,
  type ResultRow,
  type ResultDetail,
} from "@/lib/task-result-reader";
type J = Record<string, any>;
type Feed = {
  kind: ResultRow["kind"];
  archived?: boolean;
  cursor: string | null;
  started: boolean;
  done: boolean;
};
const initialFeeds = (): Feed[] => [
  { kind: "persistent", cursor: null, started: false, done: false },
  { kind: "foreground", cursor: null, started: false, done: false },
  { kind: "foreground", archived: true, cursor: null, started: false, done: false },
];
export function useTaskResults(
  workspace: HoldingsWorkspace,
  persistent: PersistentWorkspaceModel | undefined,
  model: TaskModel,
  active: boolean,
  observedResults = "",
  center?: TaskCenterModel,
) {
  const auth = useAuth(),
    [visible, setVisible] = useState(
      () => typeof document === "undefined" || document.visibilityState !== "hidden",
    );
  const scope =
    visible &&
    auth.status === "authenticated" &&
    workspace.owner === auth.sessionKey &&
    workspace.phase === "unlocked" &&
    !workspace.needsDeviceApproval
      ? `${auth.sessionKey}:${workspace.vault?.vaultId}:${workspace.vaultGeneration}`
      : null;
  const [state, setState] = useState<{
    scope: string | null;
    rows: ResultRow[];
    loading: boolean;
    ready: boolean;
    complete: boolean;
    error: string;
    detail: ResultDetail | null;
    busy: boolean;
    pending: boolean;
    revision: number;
    history: J[];
    historyCursor: string | null;
    selection: string | null;
  }>({
    scope: null,
    rows: [],
    loading: false,
    ready: false,
    complete: false,
    error: "",
    detail: null,
    busy: false,
    pending: false,
    revision: 0,
    history: [],
    historyCursor: null,
    selection: null,
  });
  const wanted = useRef(new Map<string, ResultRow>()),
    selections = useRef(new Map<string, string>());
  const [filters, setFilters] = useState<
    Record<string, { actor: string; filter: string; query: string; limit: number }>
  >({});
  const live = useRef({ scope, workspace, auth, model, active, visible, persistent });
  live.current = { scope, workspace, auth, model, active, visible, persistent };
  const uiRevision = useRef(0),
    attributions = useRef(new Map<string, J>());
  const taskPages = useRef(
    new Map<
      string,
      {
        cursor: string | null;
        done: boolean;
        fresh: number;
        busy: boolean;
        observed: string;
        rules: boolean | undefined;
      }
    >(),
  );
  const rows = useRef(new Map<string, ResultRow>()),
    feeds = useRef(initialFeeds()),
    jobs = useRef(new Set<AbortController>()),
    generation = useRef(0),
    loadSerial = useRef(0),
    loading = useRef(false),
    reloadAfter = useRef(false),
    loadAgain = useRef<(force?: boolean) => Promise<void>>(async () => {}),
    fresh = useRef(0),
    evicted = useRef(false);
  const cache = useRef(
      workspace.displayCache?.reports ?? new DisplayLru<unknown>(10, 16 * 1024 * 1024),
    ),
    titles = useRef(new Map<string, { version: string; title: string }>()),
    failures = useRef(new Set<string>()),
    titleQueue = useRef<ResultRow[]>([]),
    titlePending = useRef(new Set<string>()),
    titleActive = useRef(0);
  const selectedSerial = useRef(0),
    pending = useRef<{ scope: string; row: ResultRow; changes: J; packet: J } | null>(null),
    writeBusy = useRef(false),
    attemptedRead = useRef(new Set<string>()),
    scroll = useRef(new Map<string, number>());
  const link = useRef<ReturnType<typeof readInboxResultLink>>(null),
    [linkedRow, setLinkedRow] = useState<ResultRow | null>(null),
    channel = useRef<BroadcastChannel | null>(null);
  const update = useCallback((patch: Partial<typeof state>, expected = live.current.scope) => {
    if (expected && live.current.scope === expected)
      setState((s) => ({ ...s, ...patch, scope: expected }));
  }, []);
  const api = useCallback(
    async (path: string, options: any = {}, expected = live.current.scope): Promise<J> => {
      const start = live.current,
        epoch = generation.current;
      if (!expected || start.scope !== expected) throw Error("cancelled");
      const abort = new AbortController();
      jobs.current.add(abort);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, 14000);
      const check = () => {
        if (
          abort.signal.aborted ||
          live.current.scope !== expected ||
          generation.current !== epoch ||
          !live.current.visible
        )
          throw Error(timedOut ? "request_timeout" : "cancelled");
      };
      try {
        check();
        const method = options.method ?? "GET",
          send = () =>
            start.auth.requestPrivate("agent-hub", path, start.auth.sessionKey!, {
              ...options,
              signal: abort.signal,
              coalesceDisplay: method === "GET" && !options.fresh,
              headers: { "X-FolioView-Contract": C, ...options.headers },
            });
        let response = await untilSignal(send(), abort.signal, () =>
          Error(timedOut ? "request_timeout" : "cancelled"),
        );
        check();
        if (
          method === "GET" &&
          response.status === 503 &&
          response.headers.get("X-FolioView-Admission-Retry") === "safe" &&
          response.headers.get("Retry-After") === "1"
        ) {
          void response.body?.cancel().catch(() => {});
          await new Promise<void>((resolve, reject) => {
            const cancel = () => {
              clearTimeout(t);
              reject(Error("cancelled"));
            };
            const t = setTimeout(() => {
              abort.signal.removeEventListener("abort", cancel);
              resolve();
            }, 1000);
            abort.signal.addEventListener("abort", cancel, { once: true });
          });
          check();
          response = await untilSignal(send(), abort.signal, () =>
            Error(timedOut ? "request_timeout" : "cancelled"),
          );
          check();
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw Error(
            response.headers.get("X-FolioView-Read-Failure") === "deadline"
              ? "request_timeout"
              : response.status === 404
                ? "not_found"
                : response.status === 409
                  ? "version_conflict"
                  : response.status === 401
                    ? "session_expired"
                    : "request_failed",
          );
        }
        if (!response.body) throw Error("invalid_response");
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        const cancel = () => void reader.cancel().catch(() => {});
        abort.signal.addEventListener("abort", cancel, { once: true });
        try {
          for (;;) {
            const part = await untilSignal(reader.read(), abort.signal, () =>
              Error(timedOut ? "request_timeout" : "cancelled"),
            );
            check();
            if (part.done) break;
            size += part.value.length;
            if (size > 4194304) throw Error("invalid_response");
            chunks.push(part.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) {
            bytes.set(part, offset);
            offset += part.length;
          }
          const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          check();
          if (!data || typeof data !== "object" || Array.isArray(data))
            throw Error("invalid_response");
          return data;
        } finally {
          abort.signal.removeEventListener("abort", cancel);
          cancel();
          try {
            reader.releaseLock();
          } catch {
            /* Cancelled reader may still be pending. */
          }
        }
      } finally {
        clearTimeout(timer);
        jobs.current.delete(abort);
      }
    },
    [],
  );
  const merge = useCallback(
    (incoming: ResultRow[], expected: string) => {
      if (live.current.scope !== expected) return;
      for (const row of incoming) {
        const key = resultKey(row),
          old = rows.current.get(key);
        if (
          !old ||
          (row.kind === "foreground" && row.metadata.revision > old.metadata.revision) ||
          (row.metadata.revision === old.metadata.revision &&
            old.metadata.stateVersion <= row.metadata.stateVersion)
        )
          rows.current.set(key, {
            ...row,
            triggerKind:
              attributions.current.get(key)?.triggerKind ?? old?.triggerKind ?? row.triggerKind,
          });
      }
      while (rows.current.size > 2048) {
        const key = rows.current.keys().next().value!;
        rows.current.delete(key);
        titles.current.delete(key);
        failures.current.delete(key);
        wanted.current.delete(key);
        attributions.current.delete(key);
        evicted.current = true;
      }
      update(
        { rows: [...rows.current.values()], ready: true, revision: ++uiRevision.current },
        expected,
      );
    },
    [update],
  );
  const load = useCallback(
    async (force = false, more = false) => {
      const start = live.current;
      if (loading.current) {
        if (force) reloadAfter.current = true;
        return;
      }
      if (!start.scope || !start.active || (!force && !more && Date.now() - fresh.current < 30000))
        return;
      loading.current = true;
      const serial = ++loadSerial.current,
        epoch = generation.current;
      update({ loading: true, error: "" }, start.scope);
      if (force || (!more && fresh.current > 0)) feeds.current = initialFeeds();
      if (force) {
        rows.current.clear();
        evicted.current = false;
      }
      try {
        await Promise.all(
          feeds.current.map(async (feed) => {
            for (let page = 0; !feed.done && page < 1; page++) {
              if (
                live.current.scope !== start.scope ||
                serial !== loadSerial.current ||
                generation.current !== epoch ||
                !live.current.active
              )
                return;
              const path =
                feed.kind === "persistent"
                  ? `/api/v2/persistent-results/${start.workspace.vault!.vaultId}?limit=20`
                  : `/api/v2/results?limit=20&filter=${feed.archived ? "archived" : "all"}`;
              const data = await api(
                  path + (feed.cursor ? "&cursor=" + encodeURIComponent(feed.cursor) : ""),
                  {},
                  start.scope,
                ),
                p = resultPage(feed.kind, data);
              if (live.current.scope !== start.scope || generation.current !== epoch) return;
              feed.started = true;
              feed.cursor = p.nextCursor;
              feed.done = p.nextCursor === null;
              merge(p.items, start.scope!);
            }
          }),
        );
        if (live.current.scope === start.scope && generation.current === epoch) {
          fresh.current = Date.now();
          update(
            {
              complete: feeds.current.every((f) => f.done) && !evicted.current,
              ready: true,
              loading: false,
            },
            start.scope,
          );
        }
      } catch (e) {
        if (live.current.scope === start.scope && generation.current === epoch)
          update(
            { loading: false, error: e instanceof Error ? e.message : "request_failed" },
            start.scope,
          );
      } finally {
        if (serial === loadSerial.current) {
          loading.current = false;
          if (reloadAfter.current && live.current.scope === start.scope && live.current.active) {
            reloadAfter.current = false;
            void loadAgain.current(true);
          }
        }
      }
    },
    [api, merge, update],
  );
  loadAgain.current = load;
  const read = useCallback(
    async (row: ResultRow, freshRead = true, revision?: number) => {
      const start = live.current,
        epoch = generation.current;
      if (!start.scope) throw Error("cancelled");
      const assert = () => {
        if (
          live.current.scope !== start.scope ||
          generation.current !== epoch ||
          !live.current.visible
        )
          throw Error("cancelled");
      };
      const result = await readTaskResult({
        row,
        workspace: start.workspace,
        api: (p, o) => api(p, { ...o, fresh: freshRead }, start.scope),
        cache: cache.current,
        scope: start.scope,
        assert,
        fresh: freshRead,
        revision,
      });
      assert();
      return result;
    },
    [api],
  );
  const pump = useRef<() => void>(() => {});
  pump.current = () => {
    const start = live.current;
    if (!start.scope || !start.active) return;
    while (titleActive.current < 2 && titleQueue.current.length) {
      const row = titleQueue.current.shift()!,
        key = resultKey(row),
        version = JSON.stringify(immutableMetadata(row.metadata));
      if (titlePending.current.has(key)) continue;
      titleActive.current++;
      titlePending.current.add(key);
      void read(row, false)
        .then((detail) => {
          if (
            live.current.scope === start.scope &&
            JSON.stringify(immutableMetadata(rows.current.get(key)?.metadata ?? {})) === version
          )
            titles.current.set(key, { version, title: detail.content.title });
        })
        .catch((error) => {
          if (
            live.current.scope === start.scope &&
            live.current.active &&
            error?.message !== "cancelled"
          )
            failures.current.add(key);
        })
        .finally(() => {
          if (live.current.scope === start.scope) {
            titlePending.current.delete(key);
            titleActive.current--;
            update({ revision: ++uiRevision.current }, start.scope);
            pump.current();
          }
        });
    }
  };
  const open = useCallback(
    async (row: ResultRow, revision?: number) => {
      const start = live.current;
      if (!start.scope || !start.active) return;
      const serial = ++selectedSerial.current;
      attemptedRead.current.delete(`${start.scope}:${resultKey(row)}:${row.metadata.stateVersion}`);
      update({ busy: true, error: "", detail: null }, start.scope);
      try {
        // Ordinary task read applies current deletion visibility before a cached report can be shown.
        await api(`/api/v2/tasks/${row.metadata.taskId}`, { fresh: true }, start.scope);
        const detail = await read(row, true, revision);
        if (serial !== selectedSerial.current || live.current.scope !== start.scope) return;
        if (!detail.historical) {
          merge([detail.row], start.scope);
          titles.current.set(resultKey(row), {
            version: JSON.stringify(immutableMetadata(detail.row.metadata)),
            title: detail.content.title,
          });
        }
        selections.current.set(row.metadata.taskId, resultKey(row));
        update({ detail, busy: false, history: [], selection: resultKey(row) }, start.scope);
        if (row.kind === "foreground") {
          const history = metadataPage(
            await api(
              `/api/v2/results/${row.metadata.resultId}/revisions?limit=20`,
              {},
              start.scope,
            ),
          );
          if (history.items.some((m) => m.resultId !== row.metadata.resultId))
            throw Error("invalid_response");
          if (serial === selectedSerial.current)
            update({ history: history.items, historyCursor: history.nextCursor }, start.scope);
        }
      } catch (e) {
        if (serial === selectedSerial.current)
          update(
            { busy: false, error: e instanceof Error ? e.message : "request_failed" },
            start.scope,
          );
      }
    },
    [api, read, merge, update],
  );
  const publishState = useCallback(
    (row: ResultRow, expected: string) => {
      merge([row], expected);
      if (live.current.scope === expected)
        setState((s) => ({
          ...s,
          detail:
            s.detail &&
            !s.detail.historical &&
            resultKey(s.detail.row) === resultKey(row) &&
            s.detail.row.metadata.stateVersion <= row.metadata.stateVersion &&
            JSON.stringify(immutableMetadata(s.detail.row.metadata)) ===
              JSON.stringify(immutableMetadata(row.metadata))
              ? { ...s.detail, row }
              : s.detail,
        }));
    },
    [merge],
  );
  const change = useCallback(
    async (row: ResultRow, changes: J, retry = false) => {
      const start = live.current;
      if (!start.scope || !start.workspace.canWriteState || writeBusy.current) return;
      writeBusy.current = true;
      update({ busy: true, error: "" }, start.scope);
      try {
        if (pending.current && !retry) throw Error("state_pending");
        if (!retry) {
          const raw = await api(
              resultRecordPath(row.kind, start.workspace.vault!.vaultId, row.metadata.resultId),
              { fresh: true },
              start.scope,
            ),
            meta: J =
              row.kind === "persistent"
                ? persistentResultMetadata(raw.metadata)
                : foregroundMetadata(raw.metadata);
          if (
            JSON.stringify(immutableMetadata(meta)) !==
            JSON.stringify(immutableMetadata(row.metadata))
          )
            throw Error("version_conflict");
          const current = { ...row, metadata: meta };
          publishState(current, start.scope);
          if (Object.keys(changes).every((k) => meta[k] === changes[k])) return;
          const packet =
            row.kind === "persistent"
              ? await start.workspace.signPersistentResultState({ metadata: meta, changes })
              : await start.workspace.signResultState({ metadata: meta as any, changes });
          if (live.current.scope !== start.scope) throw Error("cancelled");
          pending.current = { scope: start.scope, row: current, changes, packet };
          update({ pending: true }, start.scope);
        }
        const p = pending.current;
        if (!p || p.scope !== start.scope) throw Error("cancelled");
        const ack = await api(
          resultRecordPath(p.row.kind, start.workspace.vault!.vaultId, p.row.metadata.resultId) +
            "/state",
          {
            method: "PATCH",
            json: { contractVersion: C, command: p.packet.command },
            headers: {
              "Idempotency-Key": p.packet.operationId,
              "X-FolioView-Author-Key": p.packet.authorKeyId,
            },
          },
          start.scope,
        );
        const saved = stateReceipt(p.row, p.changes, ack);
        pending.current = null;
        publishState(saved, start.scope);
        update({ pending: false }, start.scope);
      } catch (e) {
        update(
          {
            error: pending.current
              ? "state_pending"
              : e instanceof Error
                ? e.message
                : "request_failed",
            pending: Boolean(pending.current),
          },
          start.scope,
        );
      } finally {
        writeBusy.current = false;
        update({ busy: false }, start.scope);
      }
    },
    [api, publishState, update],
  );
  const presented = useCallback(
    (detail: ResultDetail) => {
      const key = `${live.current.scope}:${resultKey(detail.row)}:${detail.row.metadata.stateVersion}`;
      if (
        !live.current.workspace.canWriteState ||
        detail.historical ||
        detail.row.metadata.read ||
        attemptedRead.current.has(key) ||
        pending.current
      )
        return;
      attemptedRead.current.add(key);
      void change(detail.row, { read: true });
    },
    [change],
  );
  const task = model.selected?.taskId ?? "",
    f = (scope && active && state.scope === scope ? filters[task] : null) ?? {
      actor: "all",
      filter: "all",
      query: "",
      limit: 20,
    };
  const current =
    scope && active && state.scope === scope
      ? state
      : {
          ...state,
          rows: [],
          detail: null,
          history: [],
          historyCursor: null,
          selection: null,
          ready: false,
          loading: Boolean(scope),
          error: "",
          pending: false,
          busy: false,
        };
  const providers = new Map(
    (persistent?.views ?? []).map((v) => [v.connection.connectionId, v.connection.provider]),
  );
  const providerFor = (row: ResultRow) =>
    attributions.current.get(resultKey(row))?.provider ??
    providers.get(row.metadata.connectionId) ??
    "agent";
  const taskRows = current.rows
    .filter((r) => r.metadata.taskId === task)
    .sort(
      (a, b) =>
        new Date(
          typeof b.metadata.receivedAt === "number"
            ? b.metadata.receivedAt * 1000
            : b.metadata.receivedAt,
        ).getTime() -
        new Date(
          typeof a.metadata.receivedAt === "number"
            ? a.metadata.receivedAt * 1000
            : a.metadata.receivedAt,
        ).getTime(),
    );
  const filtered = taskRows
    .filter(
      (r) =>
        (f.actor === "all" || providerFor(r) === f.actor) &&
        (f.filter === "archived"
          ? r.metadata.archived
          : !r.metadata.archived &&
            (f.filter === "all" ||
              (f.filter === "unread" && !r.metadata.read) ||
              (f.filter === "starred" && r.metadata.starred))),
    )
    .filter(
      (r) =>
        !f.query ||
        titles.current
          .get(resultKey(r))
          ?.title.toLocaleLowerCase()
          .includes(f.query.toLocaleLowerCase()),
    );
  const visibleRows = filtered.slice(0, f.limit),
    signature = visibleRows
      .map((r) => resultKey(r) + JSON.stringify(immutableMetadata(r.metadata)))
      .join("|");
  useEffect(() => {
    titleQueue.current = [
      ...new Map(
        [...wanted.current.values()]
          .filter((r) => r.metadata.taskId === task)
          .map((r) => [resultKey(r), r]),
      ).values(),
    ].filter(
      (r) =>
        titles.current.get(resultKey(r))?.version !==
          JSON.stringify(immutableMetadata(r.metadata)) &&
        !failures.current.has(resultKey(r)) &&
        !titlePending.current.has(resultKey(r)),
    );
    pump.current();
  }, [scope, active, signature, state.revision]);
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
    generation.current++;
    loadSerial.current++;
    selectedSerial.current++;
    for (const j of jobs.current) j.abort();
    rows.current.clear();
    feeds.current = initialFeeds();
    titles.current.clear();
    wanted.current.clear();
    failures.current.clear();
    titleQueue.current = [];
    titlePending.current.clear();
    titleActive.current = 0;
    cache.current.clear();
    attributions.current.clear();
    taskPages.current.clear();
    reloadAfter.current = false;
    pending.current = null;
    attemptedRead.current.clear();
    fresh.current = 0;
    loading.current = false;
    evicted.current = false;
    scroll.current.clear();
    selections.current.clear();
    setFilters({});
    setState({
      scope,
      rows: [],
      loading: false,
      ready: false,
      complete: false,
      error: "",
      detail: null,
      busy: false,
      pending: false,
      revision: 0,
      history: [],
      historyCursor: null,
      selection: null,
    });
  }, [scope]);
  useEffect(() => {
    if (scope && active) void load();
  }, [scope, active, load]);
  useEffect(() => {
    if (!scope || !active) return;
    return () => {
      generation.current++;
      selectedSerial.current++;
      loadSerial.current++;
      if (loading.current) fresh.current = 0;
      loading.current = false;
      reloadAfter.current = false;
      titleQueue.current = [];
      for (const job of jobs.current) job.abort();
      update({ loading: false, busy: false }, scope);
    };
  }, [scope, active, update]);
  // Read one selected-task page, including sparse history, only on entry or explicit More.
  const loadTaskPage = useCallback(
    async (target: string, rules: boolean | undefined, force = false, more = false) => {
      const start = live.current,
        epoch = generation.current;
      if (!start.scope || !start.active || !target) return;
      const previous = taskPages.current.get(target);
      if (
        (previous?.busy && previous.observed === observedResults && previous.rules === rules) ||
        (!force &&
          !more &&
          previous &&
          Date.now() - previous.fresh < 30000 &&
          previous.observed === observedResults &&
          previous.rules === rules) ||
        (!force && more && previous?.done)
      )
        return;
      const pageState =
        force || !previous || !more
          ? { cursor: null, done: false, fresh: 0, busy: false, observed: observedResults, rules }
          : previous;
      taskPages.current.delete(target);
      taskPages.current.set(target, pageState);
      while (taskPages.current.size > 32)
        taskPages.current.delete(taskPages.current.keys().next().value!);
      pageState.busy = true;
      update({ revision: ++uiRevision.current }, start.scope);
      const current = () =>
        live.current.scope === start.scope &&
        generation.current === epoch &&
        live.current.active &&
        live.current.model.selected?.taskId === target &&
        taskPages.current.get(target) === pageState;
      try {
        const base = `/api/v3/task-center/${start.workspace.vault!.vaultId}/tasks/${target}`;
        // Callers without a shared verified center model retain the legacy read adapter.
        const enrolled = rules ?? Boolean((await api(base, {}, start.scope)).rules);
        if (!current()) return;
        if (!enrolled) {
          pageState.done = true;
          pageState.fresh = Date.now();
          return;
        }
        const page = await api(
          base + "/results/query",
          {
            method: "POST",
            json: { contractVersion: C, request: { limit: 50, cursor: pageState.cursor } },
          },
          start.scope,
        );
        if (!current()) return;
        if (
          page.contractVersion !== C ||
          page.profile !== "folioview.task-center.v1" ||
          !Array.isArray(page.items) ||
          page.items.length > 50 ||
          !(
            page.nextCursor === null ||
            (typeof page.nextCursor === "string" &&
              page.nextCursor.length > 0 &&
              page.nextCursor.length <= 4096 &&
              page.nextCursor !== pageState.cursor)
          )
        )
          throw Error("invalid_response");
        const parsed: ResultRow[] = page.items.map((r: J) => {
          if (
            !["persistent", "foreground"].includes(r.kind) ||
            !["manual", "scheduled", "legacy_unknown"].includes(r.triggerKind)
          )
            throw Error("invalid_response");
          const metadata =
            r.kind === "persistent"
              ? persistentResultMetadata(r.metadata)
              : foregroundMetadata(r.metadata);
          if (metadata.taskId !== target) throw Error("invalid_response");
          return { kind: r.kind, metadata, triggerKind: r.triggerKind };
        });
        if (new Set(parsed.map(resultKey)).size !== parsed.length) throw Error("invalid_response");
        for (let n = 0; n < parsed.length; n++)
          attributions.current.set(resultKey(parsed[n]), {
            triggerKind: parsed[n].triggerKind,
            provider: page.items[n].attribution?.provider,
            taskId: target,
          });
        pageState.cursor = page.nextCursor;
        pageState.done = page.nextCursor === null;
        pageState.fresh = Date.now();
        merge(parsed, start.scope);
      } catch (e) {
        if (current())
          update({ error: e instanceof Error ? e.message : "request_failed" }, start.scope);
      } finally {
        pageState.busy = false;
        if (current()) update({ revision: ++uiRevision.current }, start.scope);
      }
    },
    [api, merge, update, observedResults],
  );
  const selectedRecord = center?.records[task];
  const selectedRules = center ? Boolean(selectedRecord?.rules) : undefined;
  useEffect(() => {
    if (scope && active && task && (!center || selectedRecord))
      void loadTaskPage(task, selectedRules);
  }, [scope, active, task, selectedRecord, selectedRules, loadTaskPage]);
  useEffect(() => {
    if (scope && active && observedResults) void load(true);
  }, [scope, active, observedResults, load]);
  useEffect(() => {
    selectedSerial.current++;
    update({
      detail: null,
      history: [],
      historyCursor: null,
      selection: selections.current.get(task) ?? null,
    });
  }, [task, update]);
  useEffect(() => {
    if (!active || !scope) return;
    let stopped = false;
    const resolve = async () => {
      const value = readInboxResultLink(window.location.hash);
      link.current = value;
      if (!value) return;
      try {
        const kind = value.resultId.startsWith("presult_") ? "persistent" : "foreground",
          raw = await api(
            resultRecordPath(kind, workspace.vault!.vaultId, value.resultId, value.revision),
          ),
          meta =
            kind === "persistent"
              ? persistentResultMetadata(raw.metadata)
              : foregroundMetadata(raw.metadata);
        await api(`/api/v2/tasks/${meta.taskId}`, { fresh: true });
        if (!stopped) setLinkedRow({ kind, metadata: meta, triggerKind: "legacy_unknown" });
      } catch {
        if (!stopped) update({ error: "not_found" });
      }
    };
    void resolve();
    window.addEventListener("hashchange", resolve);
    window.addEventListener("popstate", resolve);
    return () => {
      stopped = true;
      window.removeEventListener("hashchange", resolve);
      window.removeEventListener("popstate", resolve);
    };
  }, [scope, active, api, update, workspace.vault?.vaultId]);
  useEffect(() => {
    if (!scope || !active || !linkedRow || model.busy || model.dirty || model.pending) return;
    if (model.selected?.taskId !== linkedRow.metadata.taskId) {
      void model.openTask(linkedRow.metadata.taskId);
      return;
    }
    const r = linkedRow;
    setLinkedRow(null);
    void open(r, link.current?.revision);
  }, [
    scope,
    active,
    linkedRow,
    model.busy,
    model.dirty,
    model.pending,
    model.selected?.taskId,
    model.openTask,
    open,
  ]);
  useEffect(() => {
    if (!scope) return;
    const invalidate = (detail: J, broadcast: boolean) => {
      const v = live.current.workspace.vault;
      if (!v || detail.vaultId !== v.vaultId || detail.rootKeyId !== v.rootKeyId) return;
      generation.current++;
      selectedSerial.current++;
      loadSerial.current++;
      loading.current = false;
      fresh.current = 0;
      taskPages.current.delete(detail.taskId);
      cache.current.clear();
      titles.current.clear();
      wanted.current.clear();
      titleQueue.current = [];
      failures.current.clear();
      for (const j of jobs.current) j.abort();
      live.current.model.invalidateTask?.(detail.taskId, detail.action === "restore");
      live.current.persistent?.invalidateTask?.(detail.taskId);
      if (detail.action === "trash") {
        selections.current.delete(detail.taskId);
        for (const [key, row] of rows.current)
          if (row.metadata.taskId === detail.taskId) rows.current.delete(key);
        if (pending.current?.row.metadata.taskId === detail.taskId) pending.current = null;
      }
      update({
        rows: [...rows.current.values()],
        detail: null,
        history: [],
        pending: Boolean(pending.current),
        revision: ++uiRevision.current,
      });
      if (broadcast) channel.current?.postMessage(detail);
      void load(true);
      void live.current.model.reloadTasks();
    };
    const event = (e: Event) => invalidate((e as CustomEvent).detail ?? {}, true);
    window.addEventListener("folioview-task-lifecycle", event);
    if (typeof BroadcastChannel !== "undefined") {
      const c = new BroadcastChannel("folioview-task-lifecycle");
      channel.current = c;
      c.onmessage = (e) => invalidate(e.data ?? {}, false);
    }
    return () => {
      window.removeEventListener("folioview-task-lifecycle", event);
      channel.current?.close();
      channel.current = null;
    };
  }, [scope, load, update]);
  const unreadCounts: Record<string, number> = {};
  for (const row of current.rows)
    if (!row.metadata.read && !row.metadata.archived)
      unreadCounts[row.metadata.taskId] = (unreadCounts[row.metadata.taskId] ?? 0) + 1;
  return {
    scope,
    canWrite: Boolean(scope && workspace.canWriteState),
    wantTitle: (row: ResultRow) => {
      if (!scope || !active) return;
      const key = resultKey(row);
      wanted.current.set(key, row);
      if (
        !titlePending.current.has(key) &&
        !failures.current.has(key) &&
        titles.current.get(key)?.version !== JSON.stringify(immutableMetadata(row.metadata))
      ) {
        titleQueue.current.push(row);
        pump.current();
      }
    },
    stopTitle: (row: ResultRow) => wanted.current.delete(resultKey(row)),
    rows: visibleRows,
    allTaskRows: taskRows,
    loading: current.loading || Boolean(taskPages.current.get(task)?.busy),
    ready: current.ready,
    complete: current.complete && (!task || taskPages.current.get(task)?.done === true),
    error: current.error,
    busy: current.busy,
    detail: current.detail
      ? {
          ...current.detail,
          row: {
            ...current.detail.row,
            triggerKind:
              attributions.current.get(resultKey(current.detail.row))?.triggerKind ??
              current.detail.row.triggerKind,
          },
        }
      : null,
    selection: current.selection,
    history: current.history,
    historyHasMore: Boolean(current.historyCursor),
    moreHistory: async () => {
      const d = current.detail,
        cursor = current.historyCursor,
        start = live.current.scope,
        serial = selectedSerial.current;
      if (!d || !cursor || !start) return;
      try {
        const p = metadataPage(
          await api(
            `/api/v2/results/${d.row.metadata.resultId}/revisions?limit=20&cursor=${encodeURIComponent(cursor)}`,
            {},
            start,
          ),
        );
        if (p.items.some((m) => m.resultId !== d.row.metadata.resultId))
          throw Error("invalid_response");
        if (serial === selectedSerial.current)
          update(
            {
              history: [
                ...new Map([...current.history, ...p.items].map((m) => [m.revision, m])).values(),
              ].slice(0, 32),
              historyCursor: p.nextCursor,
            },
            start,
          );
      } catch {
        update({ error: "request_failed" }, start);
      }
    },
    pending: current.pending,
    unreadCounts,
    partial: !current.complete || Boolean(task && taskPages.current.get(task)?.done !== true),
    filters: f,
    actors: [...new Set(taskRows.map(providerFor))],
    providerFor,
    title: (r: ResultRow) =>
      scope && active && state.scope === scope
        ? titles.current.get(resultKey(r))?.version ===
          JSON.stringify(immutableMetadata(r.metadata))
          ? titles.current.get(resultKey(r))!.title
          : null
        : null,
    titleFailed: (r: ResultRow) => failures.current.has(resultKey(r)),
    retryTitle: (r: ResultRow) => {
      failures.current.delete(resultKey(r));
      update({ revision: ++uiRevision.current });
    },
    setFilter: (patch: Partial<typeof f>) =>
      setFilters((s) => ({ ...s, [task]: { ...f, ...patch, limit: 20 } })),
    windowed: evicted.current,
    hasMore:
      filtered.length > f.limit ||
      feeds.current.some((x) => !x.done) ||
      Boolean(task && taskPages.current.get(task)?.done !== true),
    more: async () => {
      setFilters((s) => ({ ...s, [task]: { ...f, limit: f.limit + 20 } }));
      if (filtered.length <= f.limit)
        await Promise.all([load(false, true), loadTaskPage(task, selectedRules, false, true)]);
    },
    reload: () => Promise.all([load(true), loadTaskPage(task, selectedRules, true)]),
    open,
    close: () => {
      selectedSerial.current++;
      update({ detail: null, history: [], historyCursor: null });
      link.current = null;
      setLinkedRow(null);
      clearInboxResultLink();
    },
    presented,
    change,
    retryState: () => {
      const p = pending.current;
      if (p) void change(p.row, p.changes, true);
    },
    discardState: () => {
      if (!writeBusy.current) {
        pending.current = null;
        update({ pending: false, error: "" });
        void load(true);
      }
    },
    linkedBlocked: Boolean(linkedRow && model.dirty),
    scroll,
  };
}
export type TaskResultsModel = ReturnType<typeof useTaskResults>;
