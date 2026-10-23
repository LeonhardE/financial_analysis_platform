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
    path: string,
    sessionKey: string,
    options?: { method?: "GET" | "PUT" | "DELETE"; signal?: AbortSignal; json?: unknown },
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
      const response = await fetch(`${API_BASE_URL}/api/v1/me`, {
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
      path: string,
      sessionKey: string,
      options: { method?: "GET" | "PUT" | "DELETE"; signal?: AbortSignal; json?: unknown } = {},
    ): Promise<Response> => {
      // Only fixed, same-API private routes may receive a Firebase token.
      const preferencesPath = path === "/api/v1/preferences";
      if (
        !preferencesPath &&
        !/^\/api\/v1\/watchlist(?:\/[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?)?$/.test(path)
      ) {
        throw new Error("Invalid private API path");
      }
      const method = options.method ?? "GET";
      if (
        (options.json !== undefined && (!preferencesPath || method !== "PUT")) ||
        (preferencesPath &&
          (method === "DELETE" || (method === "PUT" && options.json === undefined)))
      ) {
        throw new Error("Invalid private API request");
      }
      const body = options.json === undefined ? undefined : JSON.stringify(options.json);
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
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
        cache: "no-store",
        credentials: "omit",
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
