"use client";

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
  catalogue: ResourceLoad<ResourceCatalogue>;
  watchlist: ResourceLoad<WatchlistResponse>;
  follows: ResourceLoad<ChannelFollows>;
  busy: boolean;
  writeError: string;
};
const empty = <T>(): ResourceLoad<T> => ({ data: null, loading: false, error: "", stale: false });
const initial = (owner: string | null): State => ({
  owner,
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
export function useResourceLibrary({ active = true }: { active?: boolean } = {}) {
  const auth = useAuth();
  const owner = auth.status === "authenticated" && auth.profile ? auth.sessionKey : null;
  const configured = auth.agentHubConfigured;
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [state, setState] = useState<State>(() => initial(owner));
  const stateRef = useRef(state);
  stateRef.current = state;
  const live = useRef({ owner, configured, active, visible });
  live.current = { owner, configured, active, visible };
  const jobs = useRef(new Map<string, AbortController>());
  const serials = useRef({ catalogue: 0, watchlist: 0, follows: 0 });
  const writing = useRef<object | null>(null);

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
          !now.active ||
          !now.visible ||
          (hub && !now.configured)
        )
          throw new ResourceError("cancelled");
      };
      try {
        assert();
        const result = await action(controller.signal, assert);
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
    [owner],
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
          const part = await reader.read();
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
        reader.releaseLock();
      }
    },
    [auth.requestPrivate, owner],
  );

  const reload = useCallback(
    async (source: Source) => {
      if (
        !owner ||
        (source === "follows" && writing.current) ||
        (source === "catalogue" && !configured)
      )
        return;
      const serial = ++serials.current[source];
      const current = () =>
        live.current.owner === owner &&
        serials.current[source] === serial &&
        (source !== "catalogue" || live.current.configured);
      setState((previous) => ({
        ...(previous.owner === owner ? previous : initial(owner)),
        [source]: { ...empty(), loading: true },
      }));
      try {
        const data = await operation(source, source === "catalogue", (signal, assert) =>
          api(source, signal, assert),
        );
        if (current())
          setState((previous) => ({
            ...previous,
            [source]: { data, loading: false, error: "", stale: false },
            ...(source === "follows" ? { writeError: "" } : {}),
          }));
      } catch (error) {
        if (current() && errorCode(error) !== "cancelled")
          setState((previous) => ({
            ...previous,
            [source]: { ...empty(), error: errorCode(error) },
          }));
      }
    },
    [owner, configured, operation, api],
  );

  const saveFollows = useCallback(
    async (inputs: ChannelInput[]): Promise<boolean> => {
      const before = stateRef.current;
      if (
        !owner ||
        live.current.owner !== owner ||
        before.owner !== owner ||
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
      jobs.current.get("follows")?.abort();
      setState((previous) => ({ ...previous, busy: true, writeError: "" }));
      try {
        const data = (await operation("write", false, (signal, assert) =>
          api("follows", signal, assert, {
            expectedRevision: before.follows.data!.revision,
            items,
          }),
        )) as ChannelFollows;
        if (live.current.owner !== owner || writing.current !== token) return false;
        setState((previous) => ({
          ...previous,
          follows: { data, loading: false, error: "", stale: false },
          busy: false,
          writeError: "",
        }));
        void reload("catalogue");
        return true;
      } catch (error) {
        if (live.current.owner === owner && writing.current === token)
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
    [owner, api, operation, reload],
  );

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    for (const controller of jobs.current.values()) controller.abort();
    jobs.current.clear();
    writing.current = null;
    for (const source of ["catalogue", "watchlist", "follows"] as Source[])
      ++serials.current[source];
    setState(initial(owner));
    if (owner && active && visible) {
      void reload("watchlist");
      void reload("follows");
      if (configured) void reload("catalogue");
    }
    return () => {
      for (const controller of jobs.current.values()) controller.abort();
    };
  }, [owner, active, visible, configured, reload]);

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
    [owner],
  );
  const masked = state.owner === owner && owner ? state : initial(owner);
  return {
    ...masked,
    owner,
    authenticated: Boolean(owner),
    configured,
    catalogue: configured ? masked.catalogue : empty<ResourceCatalogue>(),
    reload,
    saveFollows,
    useForTask,
  };
}
export type ResourceLibraryModel = ReturnType<typeof useResourceLibrary>;
