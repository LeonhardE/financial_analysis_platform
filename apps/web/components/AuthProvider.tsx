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
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import { getBrowserAuth } from "@/lib/firebase-client";
import { channelInputs, exact } from "@/lib/resource-library";
import { loadAgentLinkConfiguration } from "@/lib/agent-link";
import {
  verifiedOwnerBridge,
  validateConsentCommand,
  type OwnerConsentBridge,
  type ConsentOperation,
} from "@/lib/owner-consent-bridge";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
// An unset service origin keeps the current deployment usable during migration.
const USER_API_BASE_URL = process.env.NEXT_PUBLIC_USER_API_BASE_URL || API_BASE_URL;
const CONFIG_API_BASE_URL = process.env.NEXT_PUBLIC_CONFIG_API_BASE_URL || API_BASE_URL;

export type PrivateService = "user" | "config" | "portfolio" | "agent-hub";
type PrivateMethod = "GET" | "PUT" | "DELETE" | "POST" | "PATCH";
type PrivateRequestOptions = {
  method?: PrivateMethod;
  signal?: AbortSignal;
  json?: unknown;
  headers?: Record<string, string>;
};
const CONTRACT = "folioview.agent-workspace.v2.0";
const PORTFOLIO_API_BASE_URL = process.env.NEXT_PUBLIC_PORTFOLIO_API_BASE_URL ?? "";
const AGENT_HUB_API_BASE_URL = process.env.NEXT_PUBLIC_AGENT_HUB_API_BASE_URL ?? "";

function encryptedOrigin(service: "portfolio" | "agent-hub"): string | null {
  const value = service === "portfolio" ? PORTFOLIO_API_BASE_URL : AGENT_HUB_API_BASE_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== value ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

function developmentEncryptedOrigin(service: "portfolio" | "agent-hub"): string | null {
  if (
    process.env.NODE_ENV !== "development" ||
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1"].includes(window.location.hostname)
  )
    return null;
  const origin = encryptedOrigin(service);
  return origin && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname) ? origin : null;
}

export type OwnerCapabilities = Readonly<{ portfolio: boolean; agentHub: boolean }>;
export type OwnerConfigStatus = "loading" | "ready" | "unavailable";
type OwnerConfig = { status: OwnerConfigStatus; flags: OwnerCapabilities };
const disabledCapabilities: OwnerCapabilities = { portfolio: false, agentHub: false };

async function readOwnerCapabilities(
  response: Response,
  signal: AbortSignal,
): Promise<OwnerCapabilities> {
  if (
    response.status !== 200 ||
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json" ||
    !response.body
  )
    throw new Error("Invalid owner configuration");
  const reader = response.body.getReader();
  const cancelRead = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancelRead, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      if (signal.aborted) throw new Error("Owner configuration cancelled");
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error("Owner configuration cancelled");
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("Invalid owner configuration");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    // Cancellation does not wait for a stalled or malicious response stream.
    signal.removeEventListener("abort", cancelRead);
    cancelRead();
    reader.releaseLock();
  }
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== "flags|schemaVersion"
  )
    throw new Error("Invalid owner configuration");
  const config = value as Record<string, unknown>;
  const flags = config.flags;
  if (
    config.schemaVersion !== 1 ||
    !flags ||
    typeof flags !== "object" ||
    Array.isArray(flags) ||
    Object.keys(flags).sort().join("|") !== "agentHub|portfolio" ||
    typeof (flags as Record<string, unknown>).portfolio !== "boolean" ||
    typeof (flags as Record<string, unknown>).agentHub !== "boolean"
  )
    throw new Error("Invalid owner configuration");
  return {
    portfolio: (flags as Record<string, unknown>).portfolio as boolean,
    agentHub: (flags as Record<string, unknown>).agentHub as boolean,
  };
}

type EncryptedRule = {
  method: "GET" | "POST" | "PUT" | "PATCH";
  keys?: string[];
  idempotent?: boolean;
  author?: boolean;
  authority?: boolean;
  maxBytes?: number;
};
function hubOwnerRule(path: string, method: PrivateMethod): EncryptedRule | null {
  if (path.length > 8192 || /[\\#]/.test(path)) return null;
  const parts = path.split("?");
  if (parts.length > 2 || /%/.test(parts[0])) return null;
  const pathname = parts[0];
  const id = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
  const matches = (pattern: string) => new RegExp(`^${pattern}$`).test(pathname);
  let queryKeys: string[] = [];
  let rule: EncryptedRule | null = null;
  if (method === "GET") {
    if (
      [
        "/api/v2/vaults/current",
        "/api/v2/resources/catalogue",
        "/api/v2/agent-connections",
      ].includes(pathname) ||
      matches(`/api/v2/agent-connections/${id}/tasks/${id}/preparation-intent`)
    )
      rule = { method };
    else if (pathname === "/api/v2/tasks") {
      queryKeys = ["limit", "cursor"];
      rule = { method };
    } else if (matches(`/api/v2/tasks/${id}`)) rule = { method };
    else if (matches(`/api/v2/tasks/${id}/versions/(?:[1-9]|[1-4][0-9]|50)`)) rule = { method };
    else if (pathname === "/api/v2/results") {
      queryKeys = ["limit", "cursor", "filter", "taskId"];
      rule = { method };
    } else if (pathname === "/api/v2/results/counts") {
      queryKeys = ["taskId"];
      rule = { method };
    } else if (matches(`/api/v2/results/${id}`)) {
      queryKeys = ["revision", "deliveryRevision"];
      rule = { method };
    } else if (matches(`/api/v2/results/${id}/revisions`)) {
      queryKeys = ["limit", "cursor"];
      rule = { method };
    } else if (
      matches(
        `/api/v2/results/${id}/revisions/(?:[1-9]|[12][0-9]|3[0-2])/(?:evidence|registries/(?:[1-9]|[12][0-9]|3[0-2]))`,
      )
    )
      rule = { method };
  } else if (method === "POST" && pathname === "/api/v2/vaults") {
    rule = {
      method,
      keys: ["contractVersion", "vaultId", "rootJwk", "rootKeyId", "registryBundle", "archive"],
      idempotent: true,
    };
  } else if (method === "PUT" && matches(`/api/v2/vaults/${id}/registry`)) {
    rule = {
      method,
      keys: ["contractVersion", "expectedVersion", "registryBundle"],
      idempotent: true,
    };
  } else if (method === "POST" && matches(`/api/v2/vaults/${id}/holdings-sources/${id}`)) {
    rule = {
      method,
      keys: ["contractVersion", "command"],
      idempotent: true,
      author: true,
      maxBytes: 66560,
    };
  } else if (
    method === "POST" &&
    (pathname === "/api/v2/vaults/current/authority-token" ||
      matches(`/api/v2/agent-connections/${id}/(?:revoke|grants/${id}/revoke)`))
  ) {
    rule = { method, keys: ["contractVersion"], maxBytes: 1024 };
  } else if (method === "POST" && pathname === "/api/v2/tasks") {
    rule = {
      method,
      keys: ["contractVersion", "taskId", "expectedVersion", "resourceBindings", "envelope"],
      idempotent: true,
      author: true,
    };
  } else if (method === "PUT" && matches(`/api/v2/tasks/${id}`)) {
    rule = {
      method,
      keys: ["contractVersion", "expectedVersion", "resourceBindings", "envelope"],
      idempotent: true,
      author: true,
    };
  } else if (method === "POST" && matches(`/api/v2/tasks/${id}/transitions`)) {
    rule = {
      method,
      keys: [
        "contractVersion",
        "expectedVersion",
        "resourceBindings",
        "envelope",
        "transitionIntent",
      ],
      idempotent: true,
      author: true,
    };
  } else if (method === "PATCH" && matches(`/api/v2/results/${id}/state`)) {
    rule = {
      method,
      keys: ["contractVersion", "command"],
      idempotent: true,
      author: true,
      maxBytes: 65536,
    };
  } else if (
    method === "PUT" &&
    matches(`/api/v2/agent-connections/${id}/tasks/${id}/preparation/objects/${id}`)
  ) {
    rule = { method, keys: ["contractVersion", "envelope"], idempotent: true, author: true };
  } else if (
    method === "POST" &&
    matches(`/api/v2/agent-connections/${id}/tasks/${id}/preparation/commit`)
  ) {
    rule = { method, keys: ["contractVersion", "objects"], idempotent: true, maxBytes: 8192 };
  }
  if (!rule) return null;
  if (parts.length === 2) {
    const raw = parts[1];
    if (
      !raw ||
      /%(?![0-9A-Fa-f]{2})/.test(raw) ||
      raw.split("&").some((pair) => !pair || !pair.includes("="))
    )
      return null;
    const seen = new Set<string>();
    for (const [name, value] of new URLSearchParams(raw)) {
      if (!queryKeys.includes(name) || seen.has(name)) return null;
      seen.add(name);
      if (name === "cursor") {
        if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) return null;
      } else if (name === "filter") {
        if (!["all", "unread", "starred", "archived"].includes(value)) return null;
      } else if (name === "taskId") {
        if (!new RegExp(`^${id}$`).test(value)) return null;
      } else {
        const max =
          name === "deliveryRevision" ? Number.MAX_SAFE_INTEGER : name === "revision" ? 32 : 50;
        const number = Number(value);
        if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(number) || number > max)
          return null;
      }
    }
  }
  return rule;
}

function encryptedRule(
  service: "portfolio" | "agent-hub",
  path: string,
  method: PrivateMethod,
): EncryptedRule | null {
  if (service === "agent-hub") return hubOwnerRule(path, method);
  const id = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
  if (
    new RegExp(
      `^/api/v2/holdings/sources/${id}(?:/latest|/snapshots/${id}|/operations/${id}|/mutations/${id})?$`,
    ).test(path)
  )
    return { method: "GET" };
  if (new RegExp(`^/api/v2/holdings/sources/${id}/authority-sync$`).test(path))
    return { method: "POST", keys: ["contractVersion"], authority: true };
  return null;
}

function encryptedRequestHeaders(
  rule: EncryptedRule,
  options: PrivateRequestOptions,
): Record<string, string> {
  const method = options.method ?? "GET";
  // Snapshot reads and writes share a path, but have independently closed bodies.
  if (method !== rule.method) throw new Error("Invalid private API request");
  if (rule.keys) {
    const value = options.json;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join("|") !== [...rule.keys].sort().join("|") ||
      (value as Record<string, unknown>).contractVersion !== CONTRACT
    )
      throw new Error("Invalid private API request");
  } else if (options.json !== undefined) throw new Error("Invalid private API request");
  const headers: Record<string, string> = { "X-FolioView-Contract": CONTRACT };
  const allowed: Record<string, string> = { "x-folioview-contract": "X-FolioView-Contract" };
  if (rule.idempotent) allowed["idempotency-key"] = "Idempotency-Key";
  if (rule.author) allowed["x-folioview-author-key"] = "X-FolioView-Author-Key";
  if (rule.authority)
    allowed["x-folioview-authority-delegation"] = "X-FolioView-Authority-Delegation";
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    const lower = name.toLowerCase();
    if (
      !Object.hasOwn(allowed, lower) ||
      seen.has(lower) ||
      typeof value !== "string" ||
      /[\r\n]/.test(value)
    )
      throw new Error("Invalid private API request");
    seen.add(lower);
    headers[allowed[lower]] = value;
  }
  if (
    headers["X-FolioView-Contract"] !== CONTRACT ||
    (rule.idempotent && !/^[A-Za-z0-9_-]{22,128}$/.test(headers["Idempotency-Key"] ?? "")) ||
    (rule.author && !/^[A-Za-z0-9_-]{43}$/.test(headers["X-FolioView-Author-Key"] ?? "")) ||
    (rule.authority &&
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        headers["X-FolioView-Authority-Delegation"] ?? "",
      )) ||
    (headers["X-FolioView-Authority-Delegation"]?.length ?? 0) > 16384
  )
    throw new Error("Invalid private API request");
  return headers;
}

export type AccountProfile = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
};

export type AuthStatus =
  | "loading"
  | "unavailable"
  | "anonymous"
  | "signing-in"
  | "verifying"
  | "authenticated"
  | "signing-out"
  | "error";

type AuthState = {
  status: AuthStatus;
  profile: AccountProfile | null;
  error: string | null;
  hasFirebaseUser: boolean;
};

type AuthContextValue = AuthState & {
  ownerConfigStatus: OwnerConfigStatus;
  ownerCapabilities: OwnerCapabilities;
  portfolioConfigured: boolean;
  agentHubConfigured: boolean;
  sessionKey: string | null;
  requestPrivate: (
    service: PrivateService,
    path: string,
    sessionKey: string,
    options?: PrivateRequestOptions,
  ) => Promise<Response>;
  requestAgentConsent: (
    bridge: OwnerConsentBridge,
    op: ConsentOperation,
    json: unknown,
    sessionKey: string,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const anonymousState: AuthState = {
  status: "anonymous",
  profile: null,
  error: null,
  hasFirebaseUser: false,
};

function readProfile(value: unknown, expectedUid: string): AccountProfile {
  if (!value || typeof value !== "object") throw new Error("Invalid account response");
  const profile = value as Record<string, unknown>;
  if (
    profile.uid !== expectedUid ||
    ![profile.email, profile.displayName, profile.photoURL].every(
      (field) => field === null || typeof field === "string",
    )
  ) {
    throw new Error("Invalid account response");
  }
  return profile as AccountProfile;
}

function popupErrorMessage(error: unknown): string | null {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
  if (code === "auth/popup-blocked") {
    return "Allow pop-ups for this site, then try signing in again.";
  }
  if (code === "auth/network-request-failed") {
    return "Could not connect to Google. Check your connection and try again.";
  }
  return "Google sign-in is temporarily unavailable. You can continue browsing.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...anonymousState, status: "loading" });
  const [ownerConfig, setOwnerConfig] = useState<OwnerConfig>({
    status: "loading",
    flags: disabledCapabilities,
  });
  const ownerConfigRef = useRef(ownerConfig);
  ownerConfigRef.current = ownerConfig;
  const authRef = useRef<Auth | null>(null);
  const firebaseUserRef = useRef<User | null>(null);
  const signingOutRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const verifiedSessionRef = useRef<{ key: string; user: User } | null>(null);

  const verifyUser = useCallback(async (user: User | null, forceRefresh = false) => {
    // A refresh notification for the old user can arrive while sign-out is pending.
    if (user && signingOutRef.current) return;
    const generation = ++generationRef.current;
    verifiedSessionRef.current = null;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    firebaseUserRef.current = user;

    if (!user) {
      setState(anonymousState);
      return;
    }

    setState({ status: "verifying", profile: null, error: null, hasFirebaseUser: true });
    let message = "Could not verify your account. Please try again.";
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
      if (generation === generationRef.current) {
        setState({
          status: "error",
          profile: null,
          error: "Account verification took too long. Please try again.",
          hasFirebaseUser: true,
        });
      }
    }, 15_000);
    try {
      const token = await user.getIdToken(forceRefresh);
      if (generation !== generationRef.current || controller.signal.aborted) return;
      const response = await fetch(`${USER_API_BASE_URL}/api/v1/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.status === 401) {
        message = "Your session could not be verified. Sign out and sign in again.";
      } else if (response.status === 503) {
        message = "Sign-in is temporarily unavailable. Please try again.";
      }
      if (!response.ok) throw new Error("Account verification failed");
      const profile = readProfile(await response.json(), user.uid);
      if (generation !== generationRef.current || controller.signal.aborted) return;
      verifiedSessionRef.current = { key: `${user.uid}:${generation}`, user };
      setState({ status: "authenticated", profile, error: null, hasFirebaseUser: true });
    } catch {
      if (generation !== generationRef.current || (controller.signal.aborted && !timedOut)) return;
      setState({ status: "error", profile: null, error: message, hasFirebaseUser: true });
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const publish = (config: OwnerConfig) => {
      if (!active) return;
      ownerConfigRef.current = config;
      setOwnerConfig(config);
    };
    const timeout = window.setTimeout(() => {
      controller.abort();
      publish({ status: "unavailable", flags: disabledCapabilities });
    }, 5_000);
    void (async () => {
      try {
        const response = await fetch("/api/private/owner-config", {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        const flags = await readOwnerCapabilities(response, controller.signal);
        if (!controller.signal.aborted) publish({ status: "ready", flags });
      } catch {
        if (!controller.signal.aborted)
          publish({ status: "unavailable", flags: disabledCapabilities });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const auth = getBrowserAuth();
      authRef.current = auth;
      if (!auth) {
        setState({ ...anonymousState, status: "unavailable" });
      } else {
        unsubscribe = onIdTokenChanged(
          auth,
          (user) => void verifyUser(user),
          () => {
            if (signingOutRef.current) return;
            ++generationRef.current;
            verifiedSessionRef.current = null;
            requestRef.current?.abort();
            firebaseUserRef.current = auth.currentUser;
            setState({
              status: "error",
              profile: null,
              error: "Could not restore your session. Please try again.",
              hasFirebaseUser: Boolean(auth.currentUser),
            });
          },
        );
      }
    } catch {
      setState({ ...anonymousState, status: "unavailable" });
    }
    return () => {
      ++generationRef.current;
      verifiedSessionRef.current = null;
      requestRef.current?.abort();
      unsubscribe?.();
      authRef.current = null;
    };
  }, [verifyUser]);

  const signIn = useCallback(async () => {
    const auth = authRef.current;
    if (!auth || signingOutRef.current) return;
    const generation = ++generationRef.current;
    verifiedSessionRef.current = null;
    requestRef.current?.abort();
    setState({ ...anonymousState, status: "signing-in" });
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      // The token observer performs verification, including after token refreshes.
      await signInWithPopup(auth, provider);
    } catch (error) {
      if (generation !== generationRef.current) return;
      const message = popupErrorMessage(error);
      setState({
        ...anonymousState,
        status: message ? "error" : "anonymous",
        error: message,
      });
    }
  }, []);

  const signOut = useCallback(async () => {
    const auth = authRef.current;
    if (!auth || signingOutRef.current) return;
    signingOutRef.current = true;
    const generation = ++generationRef.current;
    verifiedSessionRef.current = null;
    requestRef.current?.abort();
    // Clear verified identity immediately, before the asynchronous SDK operation.
    setState({ status: "signing-out", profile: null, error: null, hasFirebaseUser: true });
    try {
      await firebaseSignOut(auth);
      if (generation === generationRef.current) {
        firebaseUserRef.current = null;
        setState(anonymousState);
      }
    } catch {
      if (generation !== generationRef.current) return;
      firebaseUserRef.current = auth.currentUser;
      setState({
        status: "error",
        profile: null,
        error: "Could not finish signing out. Please try again.",
        hasFirebaseUser: Boolean(auth.currentUser),
      });
    } finally {
      signingOutRef.current = false;
    }
  }, []);

  const retry = useCallback(async () => {
    if (firebaseUserRef.current) await verifyUser(firebaseUserRef.current, true);
    else await signIn();
  }, [signIn, verifyUser]);

  const requestPrivate = useCallback(
    async (
      service: PrivateService,
      path: string,
      sessionKey: string,
      options: PrivateRequestOptions = {},
    ): Promise<Response> => {
      // Only a fixed route on its owning service may receive a Firebase token.
      const method = options.method ?? "GET";
      let origin: string;
      let contractHeaders: Record<string, string> = {};
      let maxBodyBytes = 589824;
      let validatedJson = options.json;
      if (service === "portfolio" || service === "agent-hub") {
        let rule = encryptedRule(service, path, method);
        if (
          service === "portfolio" &&
          method === "POST" &&
          /^\/api\/v2\/holdings\/sources\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/mutations\/(fence|disconnect|delete)$/.test(
            path,
          )
        )
          rule = {
            method: "POST",
            keys: ["contractVersion", "expectedVersion", "expectedSourceEpoch", "command"],
            idempotent: true,
            author: true,
          };
        if (
          service === "portfolio" &&
          method === "PUT" &&
          /^\/api\/v2\/holdings\/sources\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/snapshots\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(
            path,
          )
        ) {
          rule = {
            method: "PUT",
            keys: ["contractVersion", "expectedRevision", "carrier"],
            idempotent: true,
            author: true,
          };
        }
        if (!rule) throw new Error("Invalid private API path");
        const capability = service === "portfolio" ? "portfolio" : "agentHub";
        const configured =
          ownerConfigRef.current.status === "ready" && ownerConfigRef.current.flags[capability]
            ? service === "portfolio"
              ? "/api/private/portfolio"
              : "/api/private/agent-hub"
            : developmentEncryptedOrigin(service);
        if (!configured) throw new Error("Encrypted workspace is not configured.");
        origin = configured;
        contractHeaders = encryptedRequestHeaders(rule, options);
        maxBodyBytes = rule.maxBytes ?? 589824;
      } else {
        const preferencesPath = path === "/api/v1/preferences";
        const followsPath = service === "user" && path === "/api/v1/channel-follows";
        const watchlistPath =
          /^\/api\/v1\/watchlist(?:\/[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?)?$/.test(path);
        if (
          (service !== "user" && service !== "config") ||
          (service === "user" && !watchlistPath && !followsPath) ||
          (service === "config" && !preferencesPath)
        )
          throw new Error("Invalid private API path");
        if (
          !["GET", "PUT", "DELETE"].includes(method) ||
          Object.keys(options.headers ?? {}).length ||
          (options.json !== undefined &&
            ((!preferencesPath && !followsPath) || method !== "PUT")) ||
          ((preferencesPath || followsPath) &&
            (method === "DELETE" || (method === "PUT" && options.json === undefined)))
        )
          throw new Error("Invalid private API request");
        if (followsPath && method === "PUT") {
          if (
            !exact(options.json, ["expectedRevision", "items"]) ||
            !Number.isSafeInteger(options.json.expectedRevision) ||
            options.json.expectedRevision < 0
          )
            throw new Error("Invalid private API request");
          validatedJson = {
            expectedRevision: options.json.expectedRevision,
            items: channelInputs(options.json.items),
          };
          maxBodyBytes = 131072;
        }
        origin = service === "user" ? USER_API_BASE_URL : CONFIG_API_BASE_URL;
      }
      const body = validatedJson === undefined ? undefined : JSON.stringify(validatedJson);
      if (body !== undefined && new TextEncoder().encode(body).byteLength > maxBodyBytes)
        throw new Error("Invalid private API request");
      const session = verifiedSessionRef.current;
      const ownsSession = () =>
        session !== null &&
        session.key === sessionKey &&
        verifiedSessionRef.current === session &&
        firebaseUserRef.current === session.user &&
        authRef.current?.currentUser?.uid === session.user.uid &&
        !signingOutRef.current &&
        !options.signal?.aborted;
      const sessionChanged = () => {
        const error = new Error("Your account session changed. Please try again.");
        error.name = "SessionChangedError";
        return error;
      };
      if (!ownsSession() || !session) throw sessionChanged();
      const invalidateSession = () => {
        ++generationRef.current;
        verifiedSessionRef.current = null;
        requestRef.current?.abort();
        setState({
          status: "error",
          profile: null,
          error: "Your session could not be verified. Sign out and sign in again.",
          hasFirebaseUser: true,
        });
      };
      // Ask the SDK for a current token for each request; never persist a second copy.
      let token: string;
      try {
        token = await session.user.getIdToken();
      } catch {
        if (ownsSession()) invalidateSession();
        throw sessionChanged();
      }
      if (!ownsSession()) throw sessionChanged();
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          ...contractHeaders,
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: options.signal,
      });
      if (!ownsSession()) throw sessionChanged();
      if (response.status === 401) {
        invalidateSession();
        throw sessionChanged();
      }
      return response;
    },
    [],
  );

  const requestAgentConsent = useCallback(
    async (
      bridge: OwnerConsentBridge,
      op: ConsentOperation,
      json: unknown,
      sessionKey: string,
      signal?: AbortSignal,
    ) => {
      // A fresh credential can reach only the source/origin/nonce-bound Hub owner port.
      // Agent/helper ports and arbitrary callback functions are never accepted here.
      validateConsentCommand(op, json);
      if (
        !verifiedOwnerBridge(bridge) ||
        ownerConfigRef.current.status !== "ready" ||
        !ownerConfigRef.current.flags.agentHub
      )
        throw new Error("Agent consent is not configured.");
      const session = verifiedSessionRef.current;
      const ownsSession = () =>
        session !== null &&
        session.key === sessionKey &&
        verifiedSessionRef.current === session &&
        firebaseUserRef.current === session.user &&
        authRef.current?.currentUser?.uid === session.user.uid &&
        !signingOutRef.current &&
        !signal?.aborted &&
        verifiedOwnerBridge(bridge) &&
        ownerConfigRef.current.status === "ready" &&
        ownerConfigRef.current.flags.agentHub;
      const changed = () => {
        const error = new Error("Your account session changed. Please try again.");
        error.name = "SessionChangedError";
        return error;
      };
      if (!session || !ownsSession()) throw changed();
      const configuration = await loadAgentLinkConfiguration(signal);
      if (!ownsSession()) throw changed();
      if (!configuration.enabled || configuration.hubOrigin !== bridge.hubOrigin)
        throw new Error("Agent consent is not configured.");
      let token: string;
      try {
        token = await session.user.getIdToken();
      } catch {
        if (ownsSession()) {
          ++generationRef.current;
          verifiedSessionRef.current = null;
          requestRef.current?.abort();
          setState({
            status: "error",
            profile: null,
            error: "Your session could not be verified. Sign out and sign in again.",
            hasFirebaseUser: true,
          });
        }
        throw changed();
      }
      if (!ownsSession()) throw changed();
      const value = await bridge.request(op, json, token, signal);
      if (!ownsSession()) throw changed();
      return value;
    },
    [],
  );

  const value = useMemo(
    () => ({
      ...state,
      ownerConfigStatus: ownerConfig.status,
      ownerCapabilities: ownerConfig.flags,
      portfolioConfigured:
        (ownerConfig.status === "ready" && ownerConfig.flags.portfolio) ||
        developmentEncryptedOrigin("portfolio") !== null,
      agentHubConfigured:
        (ownerConfig.status === "ready" && ownerConfig.flags.agentHub) ||
        developmentEncryptedOrigin("agent-hub") !== null,
      sessionKey:
        state.status === "authenticated" ? (verifiedSessionRef.current?.key ?? null) : null,
      requestPrivate,
      requestAgentConsent,
      signIn,
      signOut,
      retry,
    }),
    [state, ownerConfig, requestPrivate, requestAgentConsent, signIn, signOut, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
