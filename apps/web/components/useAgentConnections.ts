"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { TaskContent, TaskMetadata } from "@/lib/encrypted-types";
import { encryptedTask } from "@/lib/task-types";
import {
  CONNECTION_CONTRACT,
  ConnectionError,
  connectionError,
  readConnectionList,
  readAgentCapabilities,
  readRevocation,
  type AgentConnection,
  type AuthorizationAttempt,
  type RevokeSelection,
} from "@/lib/agent-connections";

type State = {
  owner: string | null;
  loading: boolean;
  busy: boolean;
  error: string;
  connectionsLoaded: boolean;
  capabilitiesLoading: boolean;
  museConnectionEnabled: boolean | null;
  capabilityError: string;
  notice: string;
  items: AgentConnection[];
  attempts: AuthorizationAttempt[];
  selectedId: string | null;
  confirmation: RevokeSelection | null;
  uncertain: boolean;
  privateScope: string | null;
  privateTask: { metadata: TaskMetadata; content: TaskContent } | null;
};
const initial = (owner: string | null = null): State => ({
  owner,
  loading: false,
  busy: false,
  error: "",
  connectionsLoaded: false,
  capabilitiesLoading: false,
  museConnectionEnabled: null,
  capabilityError: "",
  notice: "",
  items: [],
  attempts: [],
  selectedId: null,
  confirmation: null,
  uncertain: false,
  privateScope: null,
  privateTask: null,
});
type Context = { signal: AbortSignal; assert: () => void };

/** Application permission and content-key approval are deliberately separate facts. */
export function useAgentConnections(workspace: HoldingsWorkspace, { active }: { active: boolean }) {
  const auth = useAuth();
  const owner = auth.status === "authenticated" && auth.profile ? auth.sessionKey : null;
  const configured = auth.agentHubConfigured;
  const scope =
    owner && configured && workspace.owner === owner && workspace.phase === "unlocked"
      ? `${owner}:${workspace.vaultGeneration}`
      : null;
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [state, setState] = useState<State>(() => initial(owner));
  const current = useRef(state);
  current.current = state;
  const live = useRef({ owner, configured, active, visible, scope, workspace });
  live.current = { owner, configured, active, visible, scope, workspace };
  const jobs = useRef(new Set<AbortController>()),
    generation = useRef(0),
    serial = useRef(0),
    detailSerial = useRef(0),
    mutation = useRef<object | null>(null);
  const reviewed = useRef<string | null>(null);
  const operation = useCallback(
    async <T>(privateRead: boolean, action: (context: Context) => Promise<T>): Promise<T> => {
      const start = live.current,
        epoch = generation.current,
        controller = new AbortController();
      jobs.current.add(controller);
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 30_000);
      const assert = () => {
        const now = live.current;
        if (
          controller.signal.aborted ||
          !start.owner ||
          now.owner !== start.owner ||
          !now.configured ||
          !now.active ||
          !now.visible ||
          generation.current !== epoch ||
          (privateRead && (!start.scope || now.scope !== start.scope))
        )
          throw new ConnectionError(timedOut ? "request_timeout" : "cancelled");
      };
      let cancel: (() => void) | undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new ConnectionError(timedOut ? "request_timeout" : "cancelled"));
        controller.signal.addEventListener("abort", cancel, { once: true });
      });
      try {
        assert();
        return await Promise.race([action({ signal: controller.signal, assert }), cancelled]);
      } finally {
        if (cancel) controller.signal.removeEventListener("abort", cancel);
        controller.abort();
        window.clearTimeout(timer);
        jobs.current.delete(controller);
      }
    },
    [],
  );
  const update = useCallback(
    (apply: (previous: State) => State) => {
      const now = live.current;
      if (owner && now.owner === owner && now.active && now.visible && now.configured)
        setState((previous) => (previous.owner === owner ? apply(previous) : previous));
    },
    [owner],
  );
  const fail = useCallback(
    (error: unknown) => {
      if (connectionError(error) !== "cancelled")
        update((previous) => ({ ...previous, error: connectionError(error) }));
    },
    [update],
  );
  const api = useCallback(
    async (path: string, context: Context, json?: unknown) => {
      context.assert();
      const response = await auth.requestPrivate("agent-hub", path, owner!, {
        signal: context.signal,
        method: json === undefined ? "GET" : "POST",
        ...(json === undefined ? {} : { json }),
        headers: { "X-FolioView-Contract": CONNECTION_CONTRACT },
      });
      context.assert();
      if (!response.ok)
        throw new ConnectionError(
          response.status === 401
            ? "session_expired"
            : response.status === 403
              ? "insufficient_scope"
              : response.status === 404
                ? "not_found"
                : response.status === 409
                  ? "version_conflict"
                  : "request_failed",
        );
      if (
        !response.body ||
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json"
      )
        throw new ConnectionError("invalid_response");
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      context.signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          const part = await reader.read();
          context.assert();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1048576) throw new ConnectionError("invalid_response");
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        context.assert();
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch (error) {
        if (error instanceof ConnectionError) throw error;
        throw new ConnectionError("invalid_response");
      } finally {
        context.signal.removeEventListener("abort", cancel);
        cancel();
        reader.releaseLock();
      }
    },
    [auth.requestPrivate, owner],
  );
  const readLatest = useCallback(
    async (context: Context) => {
      const list = readConnectionList(await api("/api/v2/agent-connections", context));
      context.assert();
      return list;
    },
    [api],
  );
  const reload = useCallback(async () => {
    if (
      !owner ||
      live.current.owner !== owner ||
      !configured ||
      !active ||
      !visible ||
      mutation.current
    )
      return;
    const request = ++serial.current;
    reviewed.current = null;
    update((previous) => ({
      ...previous,
      loading: true,
      capabilitiesLoading: true,
      error: "",
      confirmation: null,
      capabilityError: "",
      museConnectionEnabled: null,
    }));
    const connections = operation(false, async (context) => {
      const list = await readLatest(context);
      context.assert();
      if (request !== serial.current) return;
      update((previous) => ({
        ...previous,
        items: list.items,
        attempts: list.authorizationAttempts,
        connectionsLoaded: true,
        selectedId: list.items.some((item) => item.connectionId === previous.selectedId)
          ? previous.selectedId
          : null,
        uncertain: false,
      }));
    })
      .catch((error) => {
        if (request === serial.current) fail(error);
      })
      .finally(() => {
        if (request === serial.current) update((previous) => ({ ...previous, loading: false }));
      });
    const capabilities = operation(false, async (context) => {
      const capability = readAgentCapabilities(await api("/api/v2/agent-capabilities", context));
      context.assert();
      if (request !== serial.current) return;
      update((previous) => ({
        ...previous,
        museConnectionEnabled: capability.museConnectionEnabled,
      }));
    })
      .catch((error) => {
        if (request === serial.current && connectionError(error) !== "cancelled")
          update((previous) => ({ ...previous, capabilityError: connectionError(error) }));
      })
      .finally(() => {
        if (request === serial.current)
          update((previous) => ({ ...previous, capabilitiesLoading: false }));
      });
    await Promise.allSettled([connections, capabilities]);
  }, [owner, configured, active, visible, operation, readLatest, api, update, fail]);
  const select = useCallback(
    (connectionId: string) => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !live.current.active ||
        !live.current.visible ||
        !live.current.configured ||
        mutation.current ||
        !current.current.items.some((row) => row.connectionId === connectionId)
      )
        return;
      ++detailSerial.current;
      reviewed.current = null;
      update((previous) => ({
        ...previous,
        selectedId: connectionId,
        confirmation: null,
        privateTask: null,
        privateScope: null,
        error: "",
        notice: "",
      }));
    },
    [owner, update],
  );
  const reviewRevoke = useCallback(
    (selection: RevokeSelection) => {
      const connection = current.current.items.find(
        (row) => row.connectionId === selection.connectionId,
      );
      if (
        !owner ||
        live.current.owner !== owner ||
        !connection ||
        mutation.current ||
        current.current.loading ||
        current.current.uncertain ||
        connection.status === "revoked" ||
        (selection.grantId !== null &&
          !connection.grants.some((g) => g.grantId === selection.grantId && g.status === "active"))
      )
        return;
      reviewed.current = JSON.stringify({ selection, connection });
      update((previous) => ({
        ...previous,
        confirmation: { ...selection },
        error: "",
        notice: "",
      }));
    },
    [owner, update],
  );
  const revoke = useCallback(async () => {
    if (
      !owner ||
      live.current.owner !== owner ||
      mutation.current ||
      !current.current.confirmation ||
      current.current.uncertain
    )
      return;
    const selection = current.current.confirmation,
      expected = reviewed.current,
      job = {};
    mutation.current = job;
    update((previous) => ({ ...previous, busy: true, error: "", notice: "" }));
    let sent = false;
    try {
      await operation(false, async (context) => {
        const latest = await readLatest(context),
          connection = latest.items.find((row) => row.connectionId === selection.connectionId);
        if (!connection || expected !== JSON.stringify({ selection, connection })) {
          reviewed.current = null;
          update((previous) => ({
            ...previous,
            items: latest.items,
            attempts: latest.authorizationAttempts,
            confirmation: null,
          }));
          throw new ConnectionError("review_required");
        }
        context.assert();
        sent = true;
        const path = `/api/v2/agent-connections/${selection.connectionId}${selection.grantId === null ? "" : `/grants/${selection.grantId}`}/revoke`;
        readRevocation(
          await api(path, context, { contractVersion: CONNECTION_CONTRACT }),
          selection,
        );
        context.assert();
        const after = await readLatest(context);
        context.assert();
        const saved = after.items.find((row) => row.connectionId === selection.connectionId);
        if (
          !saved ||
          (selection.grantId === null
            ? saved.status !== "revoked"
            : !saved.grants.some((g) => g.grantId === selection.grantId && g.status === "revoked"))
        )
          throw new ConnectionError("invalid_response");
        reviewed.current = null;
        ++detailSerial.current;
        update((previous) => ({
          ...previous,
          items: after.items,
          attempts: after.authorizationAttempts,
          confirmation: null,
          privateTask: null,
          privateScope: null,
          uncertain: false,
          notice: "revoked",
        }));
      });
    } catch (error) {
      if (connectionError(error) !== "cancelled" && sent)
        update((previous) => ({
          ...previous,
          uncertain: true,
          confirmation: null,
          error: "outcome_unknown",
        }));
      else fail(error);
    } finally {
      if (mutation.current === job) {
        mutation.current = null;
        update((previous) => ({ ...previous, busy: false }));
      }
    }
  }, [owner, operation, readLatest, api, update, fail]);
  const inspectGrant = useCallback(
    async (connectionId: string, grantId: string) => {
      const start = live.current,
        connection = current.current.items.find((row) => row.connectionId === connectionId),
        grant = connection?.grants.find((row) => row.grantId === grantId);
      if (
        !owner ||
        start.owner !== owner ||
        !start.scope ||
        !grant ||
        current.current.selectedId !== connectionId ||
        mutation.current
      )
        return;
      const request = ++detailSerial.current;
      update((previous) => ({
        ...previous,
        busy: true,
        privateTask: null,
        privateScope: null,
        error: "",
      }));
      try {
        await operation(true, async (context) => {
          await live.current.workspace.refreshVault(context.signal);
          context.assert();
          const packet = encryptedTask(
            await api(`/api/v2/tasks/${grant.taskId}/versions/${grant.taskVersion}`, context),
          );
          context.assert();
          if (
            packet.metadata.taskId !== grant.taskId ||
            packet.metadata.taskVersion !== grant.taskVersion
          )
            throw new ConnectionError("invalid_response");
          const content = await live.current.workspace.openTask(packet);
          context.assert();
          if (request !== detailSerial.current || current.current.selectedId !== connectionId)
            return;
          update((previous) => ({
            ...previous,
            privateTask: { metadata: packet.metadata, content },
            privateScope: start.scope,
          }));
        });
      } catch (error) {
        if (request === detailSerial.current) fail(error);
      } finally {
        if (request === detailSerial.current) update((previous) => ({ ...previous, busy: false }));
      }
    },
    [owner, operation, api, update, fail],
  );
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    ++generation.current;
    ++serial.current;
    ++detailSerial.current;
    for (const job of jobs.current) job.abort();
    jobs.current.clear();
    mutation.current = null;
    reviewed.current = null;
    setState((previous) => ({
      ...(previous.owner === owner ? previous : initial(owner)),
      owner,
      loading: false,
      capabilitiesLoading: false,
      busy: false,
      confirmation: null,
      privateTask: null,
      privateScope: null,
    }));
    return () => {
      ++generation.current;
      for (const job of jobs.current) job.abort();
      jobs.current.clear();
    };
  }, [owner, configured, active, visible]);
  useEffect(() => {
    ++detailSerial.current;
    update((previous) => ({
      ...previous,
      privateTask: null,
      privateScope: null,
      busy: mutation.current !== null,
    }));
  }, [scope, update]);
  useEffect(() => {
    if (owner && configured && active && visible) void reload();
  }, [owner, configured, active, visible, reload]);
  const display =
    owner && state.owner === owner && configured && active && visible ? state : initial(owner);
  const privateVisible = Boolean(scope && display.privateScope === scope);
  return {
    ...display,
    owner,
    configured,
    authenticated: Boolean(owner),
    // Availability is public configuration, not private view content. Preserve the
    // same-owner operation gate while display data is hidden for helper focus.
    museConnectionOperationsEnabled: Boolean(
      owner &&
      state.owner === owner &&
      configured &&
      !state.capabilitiesLoading &&
      !state.capabilityError &&
      state.museConnectionEnabled === true,
    ),
    unlocked: Boolean(scope),
    selected: display.items.find((row) => row.connectionId === display.selectedId) ?? null,
    privateTask: privateVisible ? display.privateTask : null,
    reload,
    select,
    reviewRevoke,
    revoke,
    inspectGrant,
    cancelRevoke: () => {
      reviewed.current = null;
      update((previous) => ({ ...previous, confirmation: null }));
    },
  };
}
export type AgentConnectionsModel = ReturnType<typeof useAgentConnections>;
