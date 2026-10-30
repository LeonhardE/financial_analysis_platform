"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { HoldingsWorkspace } from "@/components/useHoldingsWorkspace";
import type {
  EncryptedResult,
  RegistryBundle,
  ResultContent,
  ResultEvidence,
  ResultMetadata,
  ResultStateChanges,
  ResultStatePacket,
} from "@/lib/encrypted-types";
import {
  cacheKey,
  exact,
  fixedError,
  identifier,
  inboxCounts,
  InboxError,
  INBOX_CONTRACT,
  logicalState,
  matchesFilter,
  metadata,
  metadataPage,
  object,
  sameBody,
  type InboxCounts,
  type InboxFilter,
  type InboxItem,
  type InboxSelection,
} from "@/lib/inbox-types";

const PAGE = 20,
  MAX_ITEMS = 100,
  MAX_DECRYPTED = 20,
  OPERATION_MS = 60_000;
type State = {
  owner: string | null;
  filter: InboxFilter;
  items: ResultMetadata[];
  counts: InboxCounts | null;
  cursor: string | null;
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  selected: InboxSelection | null;
  history: ResultMetadata[];
  historyCursor: string | null;
  query: string;
  cacheVersion: number;
  pendingState: boolean;
  privateScope: string | null;
  queryScope: string | null;
};
const initial: State = {
  owner: null,
  filter: "all",
  items: [],
  counts: null,
  cursor: null,
  loading: false,
  busy: false,
  error: "",
  notice: "",
  selected: null,
  history: [],
  historyCursor: null,
  query: "",
  cacheVersion: 0,
  pendingState: false,
  privateScope: null,
  queryScope: null,
};
type Pending = {
  packet: ResultStatePacket;
  metadata: ResultMetadata;
  changes: ResultStateChanges;
  scope: string;
};
type Context = { signal: AbortSignal; assert: () => void };

export function useInbox(workspace: HoldingsWorkspace, { active }: { active: boolean }) {
  const auth = useAuth();
  const owner = auth.status === "authenticated" && auth.profile ? auth.sessionKey : null;
  const configured = auth.agentHubConfigured && workspace.vaultConfigured;
  const unlocked = Boolean(
    owner && configured && workspace.owner === owner && workspace.phase === "unlocked",
  );
  const scope = unlocked ? `${owner}:${workspace.vaultGeneration}` : null;
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [state, setState] = useState<State>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const live = useRef({ owner, configured, scope, active, visible, workspace });
  live.current = { owner, configured, scope, active, visible, workspace };
  const cache = useRef(
    new Map<
      string,
      { content: ResultContent; evidence: ResultEvidence; metadata: ResultMetadata; scope: string }
    >(),
  );
  const heads = useRef(new Map<string, ResultMetadata>());
  const pending = useRef<Pending | null>(null);
  const jobs = useRef(new Set<AbortController>());
  const selectionSerial = useRef(0),
    listSerial = useRef(0);
  const privateGeneration = useRef(0);
  const stateJob = useRef<object | null>(null);

  const api = useCallback(
    async (
      path: string,
      context: Context,
      options: { method?: "GET" | "PATCH"; json?: unknown; headers?: Record<string, string> } = {},
    ) => {
      context.assert();
      const response = await auth.requestPrivate("agent-hub", path, owner!, {
        ...options,
        signal: context.signal,
        headers: { "X-FolioView-Contract": INBOX_CONTRACT, ...options.headers },
      });
      context.assert();
      if (!response.ok)
        throw new InboxError(
          response.status === 409
            ? "version_conflict"
            : response.status === 401
              ? "session_expired"
              : response.status === 403
                ? "insufficient_scope"
                : response.status === 404
                  ? "not_found"
                  : "service_unavailable",
        );
      if (
        !response.body ||
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json"
      )
        throw new InboxError("invalid_response");
      const reader = response.body.getReader(),
        parts: Uint8Array[] = [];
      let length = 0;
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      context.signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          const chunk = await reader.read();
          context.assert();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > 1048576) throw new InboxError("invalid_response");
          parts.push(chunk.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        context.assert();
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch (error) {
        if (error instanceof InboxError) throw error;
        throw new InboxError("invalid_response");
      } finally {
        context.signal.removeEventListener("abort", cancel);
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
    [auth.requestPrivate, owner],
  );

  const operation = useCallback(
    async <T>(privateRead: boolean, action: (context: Context) => Promise<T>): Promise<T> => {
      const start = live.current,
        generation = privateGeneration.current;
      const controller = new AbortController();
      jobs.current.add(controller);
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, OPERATION_MS);
      const assert = () => {
        const now = live.current;
        if (controller.signal.aborted) throw new InboxError("cancelled");
        if (
          !start.owner ||
          now.owner !== start.owner ||
          !now.configured ||
          !now.active ||
          !now.visible ||
          (privateRead &&
            (!start.scope || now.scope !== start.scope || generation !== privateGeneration.current))
        )
          throw new InboxError("cancelled");
      };
      let abort: (() => void) | undefined;
      const cancellation = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new InboxError(timedOut ? "request_timeout" : "cancelled"));
        controller.signal.addEventListener("abort", abort, { once: true });
      });
      try {
        assert();
        return await Promise.race([action({ signal: controller.signal, assert }), cancellation]);
      } finally {
        if (abort) controller.signal.removeEventListener("abort", abort);
        controller.abort();
        window.clearTimeout(timer);
        jobs.current.delete(controller);
      }
    },
    [],
  );

  const publishMetadata = useCallback((fresh: ResultMetadata) => {
    const current = heads.current.get(fresh.resultId);
    if (current && current.stateVersion > fresh.stateVersion) return;
    heads.current.set(fresh.resultId, fresh);
    setState((previous) => {
      if (previous.owner !== live.current.owner) return previous;
      const known = previous.items.find((item) => item.resultId === fresh.resultId);
      if (known && known.stateVersion > fresh.stateVersion) return previous;
      const selected =
        previous.selected?.metadata.resultId === fresh.resultId
          ? {
              ...previous.selected,
              metadata: logicalState(previous.selected.metadata, fresh),
              historical: !sameBody(previous.selected.metadata, fresh),
            }
          : previous.selected;
      return {
        ...previous,
        items: previous.items.map((item) => (item.resultId === fresh.resultId ? fresh : item)),
        selected,
      };
    });
  }, []);

  const clearPrivate = useCallback(() => {
    ++privateGeneration.current;
    ++selectionSerial.current;
    cache.current.clear();
    pending.current = null;
    stateJob.current = null;
    setState((previous) => ({
      ...previous,
      selected: null,
      history: [],
      historyCursor: null,
      query: "",
      pendingState: false,
      busy: false,
      privateScope: null,
      queryScope: null,
      cacheVersion: previous.cacheVersion + 1,
    }));
  }, []);

  const reload = useCallback(
    async (options?: { preserve?: boolean }) => {
      const start = live.current;
      if (!owner || start.owner !== owner || !start.configured || !start.active || !start.visible)
        return;
      const serial = ++listSerial.current,
        filter = stateRef.current.owner === start.owner ? stateRef.current.filter : "all";
      const preserve = Boolean(
        options?.preserve &&
        stateRef.current.owner === start.owner &&
        stateRef.current.items.length,
      );
      setState((previous) => ({
        ...previous,
        owner: start.owner,
        loading: !preserve,
        error: preserve ? previous.error : "",
      }));
      try {
        await operation(false, async (context) => {
          const [rawPage, rawCounts] = await Promise.all([
            api(`/api/v2/results?limit=${PAGE}&filter=${filter}`, context),
            api("/api/v2/results/counts", context),
          ]);
          const page = metadataPage(rawPage),
            counts = inboxCounts(rawCounts);
          context.assert();
          if (serial !== listSerial.current) return;
          const fresh = page.items.map((item) => {
            const known = heads.current.get(item.resultId);
            if (known && known.stateVersion > item.stateVersion) return known;
            heads.current.set(item.resultId, item);
            return item;
          });
          setState((previous) => {
            const latest = previous.selected
              ? heads.current.get(previous.selected.metadata.resultId)
              : null;
            const changed =
              preserve &&
              (fresh.some(
                (item, index) =>
                  !previous.items[index] ||
                  !sameBody(item, previous.items[index]) ||
                  item.stateVersion !== previous.items[index].stateVersion,
              ) ||
                previous.counts?.total !== counts.total);
            return {
              ...previous,
              owner: start.owner,
              items: preserve
                ? previous.items.map((item) => heads.current.get(item.resultId) ?? item)
                : fresh,
              counts,
              cursor: preserve ? (changed ? null : previous.cursor) : page.nextCursor,
              notice: changed && !previous.pendingState ? "new_results" : previous.notice,
              loading: false,
              selected:
                previous.selected && latest
                  ? {
                      ...previous.selected,
                      metadata: logicalState(previous.selected.metadata, latest),
                      historical: !sameBody(previous.selected.metadata, latest),
                    }
                  : previous.selected,
            };
          });
        });
      } catch (error) {
        if (
          live.current.owner === start.owner &&
          serial === listSerial.current &&
          fixedError(error) !== "cancelled"
        )
          setState((previous) => ({ ...previous, loading: false, error: fixedError(error) }));
      } finally {
        if (live.current.owner === start.owner && serial === listSerial.current)
          setState((previous) => ({ ...previous, loading: false }));
      }
    },
    [api, operation, owner],
  );

  useEffect(() => {
    const changed = () => {
      const next = document.visibilityState !== "hidden";
      live.current.visible = next;
      setVisible(next);
      if (!next) for (const job of jobs.current) job.abort();
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    for (const job of jobs.current) job.abort();
    ++listSerial.current;
    clearPrivate();
    heads.current.clear();
    setState({ ...initial, owner });
  }, [owner, configured, clearPrivate]);
  useEffect(() => {
    clearPrivate();
  }, [scope, clearPrivate]);
  useEffect(() => {
    if (!active || !visible || !owner || !configured) {
      for (const job of jobs.current) job.abort();
      return;
    }
    void reload({ preserve: true });
    const timer = window.setInterval(() => void reload({ preserve: true }), 60_000);
    return () => {
      window.clearInterval(timer);
      for (const job of jobs.current) job.abort();
      ++listSerial.current;
    };
  }, [active, visible, owner, configured, reload]);
  useEffect(
    () => () => {
      for (const job of jobs.current) job.abort();
      cache.current.clear();
      pending.current = null;
      ++privateGeneration.current;
    },
    [],
  );

  const setFilter = useCallback(
    (filter: InboxFilter) => {
      if (
        !["all", "unread", "starred", "archived"].includes(filter) ||
        !owner ||
        live.current.owner !== owner
      )
        return;
      ++listSerial.current;
      setState((previous) => ({ ...previous, filter, items: [], cursor: null, error: "" }));
    },
    [owner],
  );
  useEffect(() => {
    if (state.owner === owner) void reload();
  }, [state.filter]); // filter is the only selection dependency

  const loadMore = useCallback(async () => {
    const current = stateRef.current,
      start = live.current;
    if (
      !owner ||
      start.owner !== owner ||
      !current.cursor ||
      current.items.length >= MAX_ITEMS ||
      current.loading
    )
      return;
    const serial = listSerial.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      await operation(false, async (context) => {
        const page = metadataPage(
          await api(
            `/api/v2/results?limit=${PAGE}&filter=${current.filter}&cursor=${encodeURIComponent(current.cursor!)}`,
            context,
          ),
        );
        context.assert();
        if (serial !== listSerial.current) return;
        if (page.items.some((item) => current.items.some((old) => old.resultId === item.resultId)))
          throw new InboxError("invalid_response");
        const fresh = page.items.map((item) => {
          const known = heads.current.get(item.resultId);
          if (known && known.stateVersion > item.stateVersion) return known;
          heads.current.set(item.resultId, item);
          return item;
        });
        setState((previous) => ({
          ...previous,
          items: [...current.items, ...fresh].slice(0, MAX_ITEMS),
          cursor: page.nextCursor,
          loading: false,
        }));
      });
    } catch (error) {
      if (live.current.owner === start.owner && fixedError(error) !== "cancelled")
        setState((previous) => ({
          ...previous,
          loading: false,
          error: fixedError(error),
          ...(fixedError(error) === "version_conflict" ? { cursor: null } : {}),
        }));
    } finally {
      if (live.current.owner === start.owner)
        setState((previous) => ({ ...previous, loading: false }));
    }
  }, [api, operation, owner]);

  const stateWrite = useCallback(
    async (
      changes: ResultStateChanges,
      context: Context,
      retry = false,
      selection?: InboxSelection,
    ) => {
      if (stateJob.current) throw new InboxError("pending_state");
      const job = {};
      stateJob.current = job;
      try {
        let saved = pending.current;
        if (!retry) {
          if (saved) throw new InboxError("pending_state");
          const selected = selection ?? stateRef.current.selected;
          if (!selected) throw new InboxError("unlock_required");
          let fresh = selected.metadata;
          if (!selection) {
            await live.current.workspace.refreshVault(context.signal, true);
            context.assert();
            const latest = await api(`/api/v2/results/${selected.metadata.resultId}`, context);
            if (!object(latest) || latest.contractVersion !== INBOX_CONTRACT)
              throw new InboxError("invalid_response");
            fresh = metadata(latest.metadata);
          } else {
            // Automatic mark-read uses the exact body just authenticated by this
            // operation. A concurrent update is refused by the signed CAS, not retried.
            const known = heads.current.get(fresh.resultId);
            if (known && known.stateVersion > fresh.stateVersion)
              throw new InboxError("version_conflict");
          }
          if (fresh.resultId !== selected.metadata.resultId)
            throw new InboxError("invalid_response");
          publishMetadata(fresh);
          if (changes.read === true && !sameBody(fresh, selected.metadata))
            throw new InboxError("version_conflict");
          const packet = await live.current.workspace.signResultState({ metadata: fresh, changes });
          context.assert();
          saved = { packet, metadata: fresh, changes, scope: live.current.scope! };
          pending.current = saved;
          setState((previous) => ({ ...previous, pendingState: true }));
        }
        if (!saved || saved.scope !== live.current.scope) throw new InboxError("unlock_required");
        const ack = metadata(
          await api(`/api/v2/results/${saved.metadata.resultId}/state`, context, {
            method: "PATCH",
            json: { contractVersion: INBOX_CONTRACT, command: saved.packet.command },
            headers: {
              "Idempotency-Key": saved.packet.operationId,
              "X-FolioView-Author-Key": saved.packet.authorKeyId,
            },
          }),
        );
        context.assert();
        if (
          ack.resultId !== saved.metadata.resultId ||
          ack.stateVersion !== saved.metadata.stateVersion + 1 ||
          !sameBody(ack, saved.metadata) ||
          Object.entries(saved.changes).some(
            ([key, value]) => ack[key as keyof ResultStateChanges] !== value,
          )
        )
          throw new InboxError("invalid_response");
        pending.current = null;
        setState((previous) => ({
          ...previous,
          pendingState: false,
          notice: retry ? "state_recovered" : "state_saved",
          error: "",
        }));
        if (retry) {
          // A replay acknowledgement describes the original operation, not the
          // current head. Refresh only metadata after confirming that receipt.
          const latest = await api(`/api/v2/results/${ack.resultId}`, context);
          if (!object(latest) || latest.contractVersion !== INBOX_CONTRACT)
            throw new InboxError("invalid_response");
          const current = metadata(latest.metadata);
          if (current.resultId !== ack.resultId || current.stateVersion < ack.stateVersion)
            throw new InboxError("invalid_response");
          publishMetadata(current);
        } else publishMetadata(ack);
      } catch (error) {
        context.assert();
        const code = fixedError(error);
        if (
          code === "version_conflict" ||
          code === "insufficient_scope" ||
          code === "session_expired"
        ) {
          pending.current = null;
          setState((previous) => ({
            ...previous,
            pendingState: false,
            notice: code === "version_conflict" ? "state_conflict" : "",
          }));
        }
        throw error;
      } finally {
        if (stateJob.current === job) stateJob.current = null;
      }
    },
    [api, publishMetadata],
  );

  const openResult = useCallback(
    async (resultId: string, revision?: number) => {
      if (
        !identifier(resultId) ||
        (revision !== undefined &&
          (!Number.isSafeInteger(revision) || revision < 1 || revision > 32))
      )
        return;
      const start = live.current;
      if (!scope || start.scope !== scope || start.owner !== owner) return;
      const serial = ++selectionSerial.current;
      const previousHistory =
        stateRef.current.selected?.metadata.resultId === resultId ? stateRef.current.history : [];
      const previousHistoryCursor = previousHistory.length ? stateRef.current.historyCursor : null;
      setState((previous) => ({
        ...previous,
        busy: true,
        error: "",
        notice: "",
        selected: null,
        history: previousHistory,
        historyCursor: previousHistoryCursor,
      }));
      try {
        await operation(true, async (context) => {
          const vault = await start.workspace.refreshVault(context.signal);
          context.assert();
          const raw = await api(
            `/api/v2/results/${resultId}${revision ? `?revision=${revision}` : ""}`,
            context,
          );
          if (!object(raw) || raw.contractVersion !== INBOX_CONTRACT)
            throw new InboxError("invalid_response");
          const meta = metadata(raw.metadata);
          if (meta.resultId !== resultId || (revision !== undefined && meta.revision !== revision))
            throw new InboxError("invalid_response");
          const evidence = await api(
            `/api/v2/results/${resultId}/revisions/${meta.revision}/evidence`,
            context,
          );
          if (
            !object(evidence) ||
            evidence.contractVersion !== INBOX_CONTRACT ||
            evidence.profile !== "folioview.owner-result-evidence.v1" ||
            !object(evidence.authorProof) ||
            !Number.isSafeInteger(evidence.authorProof.registrySequence) ||
            evidence.authorProof.registrySequence < 1 ||
            evidence.authorProof.registrySequence > 32 ||
            !Array.isArray(evidence.registryProofs) ||
            evidence.registryProofs.length !== evidence.authorProof.registrySequence
          )
            throw new InboxError("invalid_response");
          const bundles: RegistryBundle[] = [];
          for (let n = 0; n < evidence.registryProofs.length; n++) {
            const proof = evidence.registryProofs[n],
              sequence = n + 1;
            const path = `/api/v2/results/${resultId}/revisions/${meta.revision}/registries/${sequence}`;
            if (
              !exact(proof, ["registrySequence", "checkpointDigest", "path"]) ||
              proof.registrySequence !== sequence ||
              proof.path !== path ||
              !/^[a-f0-9]{64}$/.test(proof.checkpointDigest)
            )
              throw new InboxError("invalid_response");
            // Current vault history contains the same full root-signed chain. The Worker
            // authenticates every sequence/digest against the selected result evidence.
            let bundle = vault.registryHistory[n];
            if (!bundle) bundle = (await api(path, context)) as RegistryBundle;
            bundles.push(bundle);
            context.assert();
          }
          const content = await start.workspace.openResult({
            result: raw as EncryptedResult,
            evidence: evidence as ResultEvidence,
            registryBundles: bundles,
          });
          context.assert();
          if (serial !== selectionSerial.current) return;
          const historical = revision !== undefined;
          const entry = { content, evidence: evidence as ResultEvidence };
          cache.current.delete(cacheKey(meta));
          cache.current.set(cacheKey(meta), { ...entry, metadata: meta, scope: scope! });
          if (revision === undefined) {
            const known = heads.current.get(meta.resultId);
            if (!known || known.stateVersion <= meta.stateVersion)
              heads.current.set(meta.resultId, meta);
          }
          while (cache.current.size > MAX_DECRYPTED)
            cache.current.delete(cache.current.keys().next().value!);
          setState((previous) => ({
            ...previous,
            selected: { metadata: meta, ...entry, historical },
            privateScope: scope,
            cacheVersion: previous.cacheVersion + 1,
          }));
          const history = previousHistory.length
            ? { items: previousHistory, nextCursor: previousHistoryCursor }
            : metadataPage(
                await api(`/api/v2/results/${resultId}/revisions?limit=${PAGE}`, context),
              );
          context.assert();
          if (serial !== selectionSerial.current) return;
          if (history.items.some((item) => item.resultId !== resultId))
            throw new InboxError("invalid_response");
          setState((previous) => ({
            ...previous,
            history: history.items,
            historyCursor: history.nextCursor,
          }));
          if (
            !historical &&
            !meta.read &&
            live.current.workspace.canWriteState &&
            !pending.current
          ) {
            try {
              await stateWrite({ read: true }, context, false, {
                metadata: meta,
                ...entry,
                historical,
              });
            } catch (error) {
              context.assert();
              if (serial === selectionSerial.current)
                setState((previous) => ({
                  ...previous,
                  error: pending.current ? "state_outcome_unknown" : fixedError(error),
                  notice: fixedError(error) === "version_conflict" ? "state_conflict" : "",
                }));
            }
          }
        });
      } catch (error) {
        if (
          live.current.scope === start.scope &&
          serial === selectionSerial.current &&
          fixedError(error) !== "cancelled"
        )
          setState((previous) => ({ ...previous, error: fixedError(error, true) }));
      } finally {
        if (live.current.scope === start.scope && serial === selectionSerial.current)
          setState((previous) => ({ ...previous, busy: false }));
      }
    },
    [api, operation, stateWrite, owner, scope],
  );

  const loadMoreHistory = useCallback(async () => {
    const current = stateRef.current,
      start = live.current,
      serial = selectionSerial.current;
    if (
      !scope ||
      start.scope !== scope ||
      start.owner !== owner ||
      !current.selected ||
      !current.historyCursor ||
      current.history.length >= 32 ||
      current.busy
    )
      return;
    setState((previous) => ({ ...previous, busy: true, error: "" }));
    try {
      await operation(true, async (context) => {
        const page = metadataPage(
          await api(
            `/api/v2/results/${current.selected!.metadata.resultId}/revisions?limit=${PAGE}&cursor=${encodeURIComponent(current.historyCursor!)}`,
            context,
          ),
        );
        context.assert();
        if (serial !== selectionSerial.current) return;
        if (
          page.items.some(
            (item) =>
              item.resultId !== current.selected!.metadata.resultId ||
              current.history.some((old) => old.revision === item.revision),
          )
        )
          throw new InboxError("invalid_response");
        setState((previous) => ({
          ...previous,
          history: [...current.history, ...page.items].slice(0, 32),
          historyCursor: page.nextCursor,
        }));
      });
    } catch (error) {
      if (live.current.scope === start.scope && fixedError(error) !== "cancelled")
        setState((previous) => ({ ...previous, error: fixedError(error) }));
    } finally {
      if (live.current.scope === start.scope)
        setState((previous) => ({ ...previous, busy: false }));
    }
  }, [api, operation, owner, scope]);

  const updateState = useCallback(
    async (changes: ResultStateChanges) => {
      if (stateRef.current.busy || stateJob.current) return;
      const start = live.current;
      if (
        !scope ||
        start.scope !== scope ||
        start.owner !== owner ||
        !start.workspace.canWriteState
      )
        return;
      setState((previous) => ({ ...previous, busy: true, error: "", notice: "" }));
      try {
        await operation(true, (context) => stateWrite(changes, context));
      } catch (error) {
        if (live.current.scope === start.scope && fixedError(error) !== "cancelled")
          setState((previous) => ({
            ...previous,
            error: pending.current ? "state_outcome_unknown" : fixedError(error),
            notice: fixedError(error) === "version_conflict" ? "state_conflict" : "",
          }));
      } finally {
        if (live.current.scope === start.scope)
          setState((previous) => ({ ...previous, busy: false }));
      }
    },
    [operation, stateWrite, owner, scope],
  );
  const retryPendingState = useCallback(async () => {
    const start = live.current;
    if (
      !scope ||
      start.scope !== scope ||
      start.owner !== owner ||
      !pending.current ||
      stateRef.current.busy ||
      stateJob.current
    )
      return;
    setState((previous) => ({ ...previous, busy: true, error: "" }));
    try {
      await operation(true, (context) => stateWrite({}, context, true));
    } catch (error) {
      if (live.current.scope === start.scope && fixedError(error) !== "cancelled")
        setState((previous) => ({
          ...previous,
          error: pending.current ? "state_outcome_unknown" : fixedError(error),
        }));
    } finally {
      if (live.current.scope === start.scope)
        setState((previous) => ({ ...previous, busy: false }));
    }
  }, [operation, stateWrite, owner, scope]);
  const discardPendingState = useCallback(() => {
    if (
      !scope ||
      live.current.scope !== scope ||
      live.current.owner !== owner ||
      stateRef.current.busy
    )
      return;
    pending.current = null;
    setState((previous) => ({ ...previous, pendingState: false, error: "", notice: "" }));
  }, [owner, scope]);
  const closeDetail = useCallback(() => {
    if (live.current.owner !== owner || live.current.scope !== scope) return;
    ++selectionSerial.current;
    setState((previous) => ({
      ...previous,
      selected: null,
      history: [],
      historyCursor: null,
      error: "",
    }));
  }, [owner, scope]);
  const setQuery = useCallback(
    (query: string) => {
      if (scope && live.current.scope === scope && live.current.owner === owner)
        setState((previous) => ({ ...previous, query: query.slice(0, 200), queryScope: scope }));
    },
    [owner, scope],
  );
  const copyText = useCallback(() => {
    const now = live.current,
      selected = stateRef.current.selected;
    if (
      !scope ||
      now.scope !== scope ||
      now.owner !== owner ||
      !now.active ||
      !now.visible ||
      stateRef.current.owner !== now.owner ||
      stateRef.current.privateScope !== scope ||
      !selected
    )
      return null;
    return [
      selected.content.title,
      selected.content.summary,
      ...selected.content.sections.map((section) => section.markdown),
      ...selected.content.limitations,
    ].join("\n\n");
  }, [owner, scope]);

  const current = owner && configured && state.owner === owner ? state : { ...initial, owner };
  const canExpose = Boolean(scope && active && visible);
  const items: InboxItem[] = current.items
    .filter((item) => matchesFilter(item, current.filter))
    .map((meta) => {
      const entry = cache.current.get(cacheKey(meta));
      return {
        metadata: meta,
        content:
          canExpose && entry?.scope === scope && sameBody(meta, entry.metadata)
            ? entry.content
            : null,
      };
    });
  const privateState = canExpose && current.privateScope === scope;
  const privateQuery = canExpose && current.queryScope === scope;
  const normalized = privateQuery ? current.query.trim().toLocaleLowerCase() : "";
  const searched = normalized
    ? items.filter(
        (item) =>
          item.content &&
          [
            item.content.title,
            item.content.summary,
            ...item.content.sections.map((section) => section.markdown),
          ].some((text) => text.toLocaleLowerCase().includes(normalized)),
      )
    : items;
  return {
    configured,
    authenticated: Boolean(owner),
    unlocked,
    canWriteState: unlocked && workspace.canWriteState,
    filter: current.filter,
    setFilter,
    query: privateQuery ? current.query : "",
    setQuery,
    items: searched,
    counts: current.counts,
    loading: current.loading,
    busy: current.busy,
    error: current.error,
    notice: current.notice,
    nextCursor: current.cursor,
    hasMore: Boolean(current.cursor && current.items.length < MAX_ITEMS),
    loadMore,
    reload,
    selected: privateState ? current.selected : null,
    history: privateState ? current.history : [],
    historyHasMore: Boolean(privateState && current.historyCursor && current.history.length < 32),
    loadMoreHistory,
    openResult,
    closeDetail,
    updateState,
    retryPendingState,
    discardPendingState,
    pendingState: Boolean(scope && current.pendingState),
    copyText,
    loadedCount: current.items.length,
    decryptedCount: canExpose ? items.filter((item) => item.content).length : 0,
  };
}
export type InboxModel = ReturnType<typeof useInbox>;
