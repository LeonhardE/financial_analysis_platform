"use client";
import { untilSignal } from "@/lib/workspace-cache";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  channelInputs,
  readChannelFollows,
  readResourceCatalogue,
  readResourceWatchlist,
  ResourceError,
  resourceSelection,
  RESOURCE_CONTRACT,
  type ChannelInput,
  type ChannelFollows,
  type ResourceCatalogue,
  type ResourceItem,
  type ResourceLoad,
  type ResourceSelection,
} from "@/lib/resource-library";
import type { WatchlistResponse } from "@/lib/watchlist";

type Source = "catalogue" | "watchlist" | "follows";
type State = {
  owner: string | null;
  scope: string | null;
  catalogue: ResourceLoad<ResourceCatalogue>;
  watchlist: ResourceLoad<WatchlistResponse>;
  follows: ResourceLoad<ChannelFollows>;
  busy: boolean;
  writeError: string;
};
const empty = <T>(): ResourceLoad<T> => ({ data: null, loading: false, error: "", stale: false });
const initial = (owner: string | null, scope: string | null): State => ({
  owner,
  scope,
  catalogue: empty(),
  watchlist: empty(),
  follows: empty(),
  busy: false,
  writeError: "",
});
const errorCode = (error: unknown) => (error instanceof ResourceError ? error.code : "unavailable");
const selectionKey = (item: ResourceItem) => {
  const selection = resourceSelection(item);
  return selection
    ? JSON.stringify([
        selection.ref.kind,
        selection.ref.sourceService,
        selection.ref.resourceId,
        selection.ref.incarnation,
        selection.sourceEpoch,
      ])
    : null;
};

/** Source lists use their existing User owner API; discovery never grants agent access. */
export function useResourceLibrary({
  active = true,
  externalWatchlist = false,
  workspaceScope = null,
}: { active?: boolean; externalWatchlist?: boolean; workspaceScope?: string | null } = {}) {
  const auth = useAuth();
  const owner = auth.status === "authenticated" && auth.profile ? auth.sessionKey : null;
  const configured = auth.agentHubConfigured;
  const scope = owner ? JSON.stringify([owner, workspaceScope]) : null;
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [state, setState] = useState<State>(() => initial(owner, scope));
  const stateRef = useRef(state);
  stateRef.current = state;
  const live = useRef({ owner, scope, configured, active, visible });
  live.current = { owner, scope, configured, active, visible };
  const jobs = useRef(new Map<string, AbortController>());
  const serials = useRef({ catalogue: 0, watchlist: 0, follows: 0 });
  const writing = useRef<object | null>(null);
  const freshness = useRef<{ scope: string | null; at: Partial<Record<Source, number>> }>({
    scope,
    at: {},
  });
  const isFresh = (source: Source) => {
    const at = freshness.current.scope === scope ? freshness.current.at[source] : undefined;
    const age = at === undefined ? Infinity : Date.now() - at;
    return age >= 0 && age < 30_000;
  };

  const operation = useCallback(
    async <T>(
      key: string,
      hub: boolean,
      action: (signal: AbortSignal, assert: () => void) => Promise<T>,
    ): Promise<T> => {
      const start = live.current;
      if (
        !owner ||
        start.owner !== owner ||
        start.scope !== scope ||
        !start.active ||
        !start.visible ||
        (hub && !start.configured)
      )
        throw new ResourceError("cancelled");
      jobs.current.get(key)?.abort();
      const controller = new AbortController();
      jobs.current.set(key, controller);
      let timeout = false;
      const timer = window.setTimeout(() => {
        timeout = true;
        controller.abort();
      }, 20_000);
      const assert = () => {
        const now = live.current;
        if (timeout) throw new ResourceError("timeout");
        if (
          controller.signal.aborted ||
          now.owner !== owner ||
          now.scope !== scope ||
          !now.active ||
          !now.visible ||
          (hub && !now.configured)
        )
          throw new ResourceError("cancelled");
      };
      try {
        assert();
        const result = await untilSignal(
          action(controller.signal, assert),
          controller.signal,
          () => new ResourceError(timeout ? "timeout" : "cancelled"),
        );
        assert();
        return result;
      } catch (error) {
        assert();
        throw error;
      } finally {
        window.clearTimeout(timer);
        if (jobs.current.get(key) === controller) jobs.current.delete(key);
      }
    },
    [owner, scope],
  );

  const api = useCallback(
    async (source: Source, signal: AbortSignal, assert: () => void, json?: unknown) => {
      assert();
      const response = await auth.requestPrivate(
        source === "catalogue" ? "agent-hub" : "user",
        source === "catalogue"
          ? "/api/v2/resources/catalogue"
          : source === "watchlist"
            ? "/api/v1/watchlist"
            : "/api/v1/channel-follows",
        owner!,
        {
          method: json === undefined ? "GET" : "PUT",
          signal,
          coalesceDisplay: json === undefined,
          ...(json === undefined ? {} : { json }),
          ...(source === "catalogue"
            ? { headers: { "X-FolioView-Contract": RESOURCE_CONTRACT } }
            : {}),
        },
      );
      assert();
      if (!response.ok)
        throw new ResourceError(
          response.status === 409
            ? "conflict"
            : response.status === 403
              ? "forbidden"
              : response.status === 429
                ? "rate_limited"
                : "unavailable",
        );
      if (
        !response.body ||
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json"
      )
        throw new ResourceError("invalid_response");
      const reader = response.body.getReader(),
        decoder = new TextDecoder("utf-8", { fatal: true });
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      signal.addEventListener("abort", cancel, { once: true });
      let size = 0,
        text = "";
      try {
        for (;;) {
          const part = await untilSignal(
            reader.read(),
            signal,
            () => new ResourceError("cancelled"),
          );
          assert();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > (source === "catalogue" ? 1048576 : source === "follows" ? 196608 : 131072))
            throw new ResourceError("invalid_response");
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
        assert();
        const value: unknown = JSON.parse(text);
        return source === "catalogue"
          ? readResourceCatalogue(value)
          : source === "watchlist"
            ? readResourceWatchlist(value)
            : readChannelFollows(value);
      } catch (error) {
        if (error instanceof ResourceError) throw error;
        throw new ResourceError("invalid_response");
      } finally {
        signal.removeEventListener("abort", cancel);
        cancel();
        try {
          reader.releaseLock();
        } catch {
          /* Cancelled reader may still be pending. */
        }
      }
    },
    [auth.requestPrivate, owner],
  );

  const reload = useCallback(
    async (source: Source, force = true) => {
      if (
        !owner ||
        live.current.scope !== scope ||
        !live.current.active ||
        !live.current.visible ||
        (!force && isFresh(source) && !stateRef.current[source].stale) ||
        (source === "follows" && writing.current) ||
        (source === "catalogue" && !configured)
      )
        return;
      const serial = ++serials.current[source];
      const current = () =>
        live.current.owner === owner &&
        live.current.scope === scope &&
        serials.current[source] === serial &&
        (source !== "catalogue" || live.current.configured);
      setState((previous) => ({
        ...(previous.scope === scope ? previous : initial(owner, scope)),
        [source]: {
          ...(previous.scope === scope ? previous[source] : empty()),
          loading: true,
          error: "",
          stale: Boolean(previous.scope === scope && previous[source].data),
        },
      }));
      try {
        const data = await operation(source, source === "catalogue", (signal, assert) =>
          api(source, signal, assert),
        );
        if (current()) {
          freshness.current.at[source] = Date.now();
          setState((previous) => ({
            ...previous,
            [source]: { data, loading: false, error: "", stale: false },
            ...(source === "follows" ? { writeError: "" } : {}),
          }));
        }
      } catch (error) {
        if (current() && errorCode(error) !== "cancelled") {
          delete freshness.current.at[source];
          setState((previous) => ({
            ...previous,
            [source]: {
              ...previous[source],
              loading: false,
              stale: Boolean(previous[source].data),
              error: errorCode(error),
            },
          }));
        }
      }
    },
    [owner, scope, configured, operation, api],
  );

  const saveFollows = useCallback(
    async (inputs: ChannelInput[]): Promise<boolean> => {
      const before = stateRef.current;
      if (
        !owner ||
        live.current.owner !== owner ||
        before.owner !== owner ||
        before.scope !== scope ||
        live.current.scope !== scope ||
        !isFresh("follows") ||
        !before.follows.data ||
        before.follows.stale ||
        before.follows.loading ||
        writing.current
      )
        return false;
      let items: ChannelInput[];
      try {
        items = channelInputs(inputs);
      } catch (error) {
        setState((previous) => ({ ...previous, writeError: errorCode(error) }));
        return false;
      }
      const token = {};
      writing.current = token;
      ++serials.current.follows;
      ++serials.current.catalogue;
      delete freshness.current.at.catalogue;
      jobs.current.get("follows")?.abort();
      jobs.current.get("catalogue")?.abort();
      setState((previous) => ({
        ...previous,
        busy: true,
        writeError: "",
        catalogue: {
          ...previous.catalogue,
          loading: false,
          stale: Boolean(previous.catalogue.data),
        },
      }));
      try {
        const data = (await operation("write", false, (signal, assert) =>
          api("follows", signal, assert, {
            expectedRevision: before.follows.data!.revision,
            items,
          }),
        )) as ChannelFollows;
        if (
          live.current.owner !== owner ||
          live.current.scope !== scope ||
          writing.current !== token
        )
          return false;
        freshness.current.at.follows = Date.now();
        setState((previous) => ({
          ...previous,
          follows: { data, loading: false, error: "", stale: false },
          busy: false,
          writeError: "",
        }));
        void reload("catalogue");
        return true;
      } catch (error) {
        if (freshness.current.scope === scope) delete freshness.current.at.follows;
        if (
          live.current.owner === owner &&
          live.current.scope === scope &&
          writing.current === token
        )
          setState((previous) => ({
            ...previous,
            follows: { ...previous.follows, stale: true },
            busy: false,
            writeError: errorCode(error) === "cancelled" ? "reload_required" : errorCode(error),
          }));
        return false;
      } finally {
        if (writing.current === token) writing.current = null;
      }
    },
    [owner, scope, api, operation, reload],
  );

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    for (const controller of jobs.current.values()) controller.abort();
    jobs.current.clear();
    const uncertainWrite = Boolean(writing.current);
    writing.current = null;
    if (freshness.current.scope !== scope) freshness.current = { scope, at: {} };
    if (!configured) delete freshness.current.at.catalogue;
    if (uncertainWrite) {
      delete freshness.current.at.follows;
      delete freshness.current.at.catalogue;
    }
    for (const source of ["catalogue", "watchlist", "follows"] as Source[])
      ++serials.current[source];
    setState((previous) =>
      previous.scope === scope
        ? {
            ...previous,
            busy: false,
            catalogue: {
              ...previous.catalogue,
              loading: false,
              stale: Boolean(previous.catalogue.data && (previous.catalogue.stale || !configured)),
            },
            watchlist: { ...previous.watchlist, loading: false },
            follows: {
              ...previous.follows,
              loading: false,
              ...(uncertainWrite ? { stale: true } : {}),
            },
            ...(uncertainWrite
              ? {
                  writeError: "reload_required",
                  catalogue: {
                    ...previous.catalogue,
                    loading: false,
                    stale: Boolean(previous.catalogue.data),
                  },
                }
              : {}),
          }
        : initial(owner, scope),
    );
    if (owner && active && visible) {
      if (!externalWatchlist) void reload("watchlist", false);
      void reload("follows", false);
      if (configured) void reload("catalogue", false);
    }
    return () => {
      for (const controller of jobs.current.values()) controller.abort();
    };
  }, [owner, scope, active, visible, configured, reload, externalWatchlist]);

  const useForTask = useCallback(
    (item: ResourceItem, callback?: (selection: ResourceSelection) => void) => {
      const current = stateRef.current;
      if (
        !callback ||
        !owner ||
        live.current.owner !== owner ||
        !live.current.active ||
        !live.current.visible ||
        !live.current.configured ||
        current.owner !== owner ||
        current.scope !== scope ||
        live.current.scope !== scope ||
        !isFresh("catalogue") ||
        current.catalogue.stale ||
        current.catalogue.loading ||
        current.catalogue.error ||
        !["ready", "active"].includes(item.state)
      )
        return;
      const fresh = current.catalogue.data?.groups
        .flatMap((group) => group.items)
        .find(
          (candidate) =>
            selectionKey(candidate) === selectionKey(item) && candidate.state === item.state,
        );
      const selection = fresh && resourceSelection(fresh);
      if (selection) callback(selection);
    },
    [owner, scope],
  );
  const masked = state.scope === scope && owner ? state : initial(owner, scope);
  const display = <T>(source: Source, value: ResourceLoad<T>): ResourceLoad<T> => ({
    ...value,
    stale: Boolean(value.data && (value.stale || !isFresh(source))),
  });
  return {
    ...masked,
    watchlist: display("watchlist", masked.watchlist),
    follows: display("follows", masked.follows),
    owner,
    authenticated: Boolean(owner),
    configured,
    catalogue: configured ? display("catalogue", masked.catalogue) : empty<ResourceCatalogue>(),
    reload,
    saveFollows,
    useForTask,
  };
}
export type ResourceLibraryModel = ReturnType<typeof useResourceLibrary>;
