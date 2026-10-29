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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
// An unset service origin keeps the current deployment usable during migration.
const USER_API_BASE_URL = process.env.NEXT_PUBLIC_USER_API_BASE_URL || API_BASE_URL;
const CONFIG_API_BASE_URL = process.env.NEXT_PUBLIC_CONFIG_API_BASE_URL || API_BASE_URL;

export type PrivateService = "user" | "config" | "portfolio" | "agent-hub";
type PrivateMethod = "GET" | "PUT" | "DELETE" | "POST";
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

export function isPrivateServiceConfigured(service: "portfolio" | "agent-hub"): boolean {
  return encryptedOrigin(service) !== null;
}

type EncryptedRule = {
  method: "GET" | "POST" | "PUT";
  keys?: string[];
  idempotent?: boolean;
  author?: boolean;
  authority?: boolean;
};
function encryptedRule(service: "portfolio" | "agent-hub", path: string): EncryptedRule | null {
  const id = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
  if (service === "agent-hub") {
    if (path === "/api/v2/vaults/current") return { method: "GET" };
    if (path === "/api/v2/vaults")
      return {
        method: "POST",
        keys: ["contractVersion", "vaultId", "rootJwk", "rootKeyId", "registryBundle", "archive"],
        idempotent: true,
      };
    if (path === "/api/v2/vaults/current/authority-token")
      return { method: "POST", keys: ["contractVersion"] };
    if (new RegExp(`^/api/v2/vaults/${id}/registry$`).test(path))
      return {
        method: "PUT",
        keys: ["contractVersion", "expectedVersion", "registryBundle"],
        idempotent: true,
      };
    if (new RegExp(`^/api/v2/vaults/${id}/holdings-sources/${id}$`).test(path))
      return {
        method: "POST",
        keys: ["contractVersion", "command"],
        idempotent: true,
        author: true,
      };
  } else {
    if (
      new RegExp(
        `^/api/v2/holdings/sources/${id}(?:/latest|/snapshots/${id}|/operations/${id})?$`,
      ).test(path)
    )
      return { method: "GET" };
    if (new RegExp(`^/api/v2/holdings/sources/${id}/authority-sync$`).test(path))
      return { method: "POST", keys: ["contractVersion"], authority: true };
  }
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
  sessionKey: string | null;
  requestPrivate: (
    service: PrivateService,
    path: string,
    sessionKey: string,
    options?: PrivateRequestOptions,
  ) => Promise<Response>;
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
      if (service === "portfolio" || service === "agent-hub") {
        let rule = encryptedRule(service, path);
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
        const configured = encryptedOrigin(service);
        if (!configured) throw new Error("Encrypted workspace is not configured.");
        origin = configured;
        contractHeaders = encryptedRequestHeaders(rule, options);
      } else {
        const preferencesPath = path === "/api/v1/preferences";
        const watchlistPath =
          /^\/api\/v1\/watchlist(?:\/[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?)?$/.test(path);
        if (
          (service !== "user" && service !== "config") ||
          (service === "user" && !watchlistPath) ||
          (service === "config" && !preferencesPath)
        )
          throw new Error("Invalid private API path");
        if (
          !["GET", "PUT", "DELETE"].includes(method) ||
          Object.keys(options.headers ?? {}).length ||
          (options.json !== undefined && (!preferencesPath || method !== "PUT")) ||
          (preferencesPath &&
            (method === "DELETE" || (method === "PUT" && options.json === undefined)))
        )
          throw new Error("Invalid private API request");
        origin = service === "user" ? USER_API_BASE_URL : CONFIG_API_BASE_URL;
      }
      const body = options.json === undefined ? undefined : JSON.stringify(options.json);
      if (
        (service === "portfolio" || service === "agent-hub") &&
        body !== undefined &&
        new TextEncoder().encode(body).byteLength > 589824
      )
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

  const value = useMemo(
    () => ({
      ...state,
      sessionKey:
        state.status === "authenticated" ? (verifiedSessionRef.current?.key ?? null) : null,
      requestPrivate,
      signIn,
      signOut,
      retry,
    }),
    [state, requestPrivate, signIn, signOut, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
