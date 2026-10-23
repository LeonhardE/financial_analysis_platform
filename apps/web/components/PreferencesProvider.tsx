"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NextIntlClientProvider } from "next-intl";
import { useAuth } from "@/components/AuthProvider";
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  samePreferences,
  validatePreferences,
  type Preferences,
} from "@/lib/preferences";
import englishMessages from "@/messages/en.json";
import chineseMessages from "@/messages/zh.json";

type PreferenceStatus = "guest" | "loading" | "ready" | "saving" | "saved" | "error";
type PreferenceError = "load" | "save" | "loadTimeout" | "saveTimeout" | null;
type PreferenceState = {
  owner: string | null;
  preferences: Preferences;
  loaded: boolean;
  dirty: boolean;
  revision: number;
  serverVersion: number | null;
  status: PreferenceStatus;
  error: PreferenceError;
};
type PreferencesContextValue = {
  preferences: Preferences;
  resolvedTheme: "light" | "dark";
  authenticated: boolean;
  loading: boolean;
  saving: boolean;
  status: PreferenceStatus;
  error: PreferenceError;
  updatePreferences: (changes: Partial<Preferences>) => void;
  retry: () => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);
const initialState: PreferenceState = {
  owner: null,
  preferences: DEFAULT_PREFERENCES,
  loaded: false,
  dirty: false,
  revision: 0,
  serverVersion: null,
  status: "guest",
  error: null,
};

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, sessionKey, requestPrivate } = useAuth();
  const owner = authStatus === "authenticated" ? sessionKey : null;
  const ownerRef = useRef(owner);
  // Render-time ownership masks a previous account even before effect cleanup.
  ownerRef.current = owner;
  const [guest, setGuest] = useState({ preferences: DEFAULT_PREFERENCES, changed: false });
  const guestRef = useRef(guest);
  const [state, setState] = useState<PreferenceState>(initialState);
  const stateRef = useRef(state);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("dark");
  const generationRef = useRef(0);
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null);

  const publish = useCallback((next: PreferenceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const requestPreferences = useCallback(
    async (method: "GET" | "PUT") => {
      if (!owner || ownerRef.current !== owner || requestRef.current) return;
      const current = stateRef.current;
      if (
        method === "PUT" &&
        (current.owner !== owner ||
          !current.loaded ||
          !current.dirty ||
          current.serverVersion === null)
      ) {
        return;
      }
      const id = ++generationRef.current;
      const controller = new AbortController();
      requestRef.current = { id, controller };
      const ownsRequest = () =>
        ownerRef.current === owner && generationRef.current === id && !controller.signal.aborted;
      publish({ ...current, owner, status: method === "GET" ? "loading" : "saving", error: null });
      const timeout = window.setTimeout(() => {
        if (!ownsRequest()) return;
        controller.abort();
        ++generationRef.current;
        requestRef.current = null;
        publish({
          ...stateRef.current,
          status: "error",
          error: method === "GET" ? "loadTimeout" : "saveTimeout",
        });
      }, 20_000);
      try {
        const readCurrent = async () => {
          const response = await requestPrivate("/api/v1/preferences", owner, {
            method: "GET",
            signal: controller.signal,
          });
          if (!ownsRequest()) return null;
          if (!response.ok) throw new Error("Preferences request failed");
          const snapshot = readPreferences(await response.json());
          return ownsRequest() ? snapshot : null;
        };
        if (method === "GET") {
          const snapshot = await readCurrent();
          if (!snapshot) return;
          const { preferences, version } = snapshot;
          // Only a successful, explicitly missing record may adopt guest choices.
          const dirty = preferences === null && guestRef.current.changed;
          publish({
            owner,
            preferences: preferences ?? guestRef.current.preferences,
            serverVersion: version,
            loaded: true,
            dirty,
            revision: dirty ? 1 : 0,
            status: preferences === null ? "ready" : "saved",
            error: null,
          });
          return;
        }

        // Compare-and-set prevents an already dispatched, timed-out PUT from
        // overwriting a later save. Rebase only this active draft, at most twice.
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!ownsRequest()) return;
          const beforeSave = stateRef.current;
          const draft = beforeSave.preferences;
          const revision = beforeSave.revision;
          const expectedVersion = beforeSave.serverVersion;
          if (expectedVersion === null) throw new Error("Preferences version is unavailable");
          const response = await requestPrivate("/api/v1/preferences", owner, {
            method: "PUT",
            signal: controller.signal,
            json: { ...draft, expectedVersion },
          });
          if (!ownsRequest()) return;
          if (response.status === 409) {
            if (attempt === 2) throw new Error("Preferences kept changing");
            const snapshot = await readCurrent();
            if (!snapshot) return;
            const latest = stateRef.current;
            publish({
              ...latest,
              serverVersion: snapshot.version,
              dirty: true,
              status: "saving",
              error: null,
            });
            continue;
          }
          if (!response.ok) throw new Error("Preferences request failed");
          const snapshot = readPreferences(await response.json());
          if (!ownsRequest()) return;
          if (!snapshot.preferences || snapshot.version <= expectedVersion) {
            throw new Error("Invalid saved preferences");
          }
          const latest = stateRef.current;
          const dirty = latest.revision !== revision;
          // A response for an earlier edit cannot replace a newer local choice.
          publish({
            ...latest,
            preferences: dirty ? latest.preferences : snapshot.preferences,
            serverVersion: snapshot.version,
            dirty,
            status: dirty ? "ready" : "saved",
            error: null,
          });
          return;
        }
      } catch {
        if (!ownsRequest()) return;
        publish({
          ...stateRef.current,
          status: "error",
          error: method === "GET" ? "load" : "save",
        });
      } finally {
        window.clearTimeout(timeout);
        if (requestRef.current?.id === id) requestRef.current = null;
      }
    },
    [owner, publish, requestPrivate],
  );

  useEffect(() => {
    ++generationRef.current;
    requestRef.current?.controller.abort();
    requestRef.current = null;
    publish({
      ...initialState,
      owner,
      preferences: guestRef.current.preferences,
      status: owner ? "loading" : "guest",
    });
    if (owner) void requestPreferences("GET");
    return () => {
      ++generationRef.current;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    };
  }, [owner, publish, requestPreferences]);

  useEffect(() => {
    if (
      !owner ||
      state.owner !== owner ||
      !state.loaded ||
      !state.dirty ||
      state.error ||
      state.status === "saving"
    ) {
      return;
    }
    const timer = window.setTimeout(() => void requestPreferences("PUT"), 400);
    return () => window.clearTimeout(timer);
  }, [owner, state, requestPreferences]);

  const updatePreferences = useCallback(
    (changes: Partial<Preferences>) => {
      if (ownerRef.current !== owner) return;
      if (!owner) {
        const preferences = validatePreferences({ ...guestRef.current.preferences, ...changes });
        if (samePreferences(preferences, guestRef.current.preferences)) return;
        const next = { preferences, changed: true };
        guestRef.current = next;
        setGuest(next);
        return;
      }
      const current = stateRef.current;
      // Wait for saved preferences instead of overwriting an unknown account state.
      if (current.owner !== owner || !current.loaded) return;
      const preferences = validatePreferences({ ...current.preferences, ...changes });
      if (samePreferences(preferences, current.preferences)) return;
      publish({
        ...current,
        preferences,
        dirty: true,
        revision: current.revision + 1,
        status: requestRef.current ? "saving" : "ready",
        error: null,
      });
    },
    [owner, publish],
  );

  const retry = useCallback(() => {
    if (!owner || ownerRef.current !== owner || requestRef.current) return;
    const current = stateRef.current;
    if (current.owner !== owner || !current.error) return;
    void requestPreferences(current.loaded ? "PUT" : "GET");
  }, [owner, requestPreferences]);

  const visible = owner && state.owner === owner ? state : null;
  const preferences = visible?.preferences ?? guest.preferences;
  const preferenceStatus = visible?.status ?? (owner ? "loading" : "guest");
  const resolvedTheme = preferences.theme === "system" ? systemTheme : preferences.theme;

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.documentElement.lang = preferences.language === "zh" ? "zh-CN" : "en";
    document.title =
      preferences.language === "zh"
        ? "FolioView — 你的投资工作台"
        : "FolioView — Your investing workspace";
  }, [resolvedTheme, preferences.language]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      resolvedTheme,
      authenticated: Boolean(owner),
      loading: Boolean(owner) && preferenceStatus === "loading",
      saving: preferenceStatus === "saving" || Boolean(visible?.dirty && !visible.error),
      status: preferenceStatus,
      error: visible?.error ?? null,
      updatePreferences,
      retry,
    }),
    [preferences, resolvedTheme, owner, preferenceStatus, visible, updatePreferences, retry],
  );

  return (
    <PreferencesContext.Provider value={value}>
      <NextIntlClientProvider
        locale={preferences.language}
        messages={preferences.language === "zh" ? chineseMessages : englishMessages}
        timeZone="America/New_York"
      >
        {children}
      </NextIntlClientProvider>
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences must be used within PreferencesProvider");
  return context;
}
