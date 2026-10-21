import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim(),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim(),
};

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Initialize only in the browser. Missing configuration preserves anonymous browsing.
export function getBrowserAuth(): Auth | null {
  if (typeof window === "undefined" || Object.values(firebaseConfig).some((value) => !value)) {
    return null;
  }

  const emulatorUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL?.trim();
  if (emulatorUrl) {
    const url = new URL(emulatorUrl);
    if (
      process.env.NODE_ENV !== "development" ||
      !loopbackHosts.has(window.location.hostname) ||
      url.protocol !== "http:" ||
      !loopbackHosts.has(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("The authentication emulator is restricted to local development.");
    }
  }

  const app =
    getApps().find((candidate) => candidate.name === "market-web") ??
    initializeApp(firebaseConfig, "market-web");
  const auth = getAuth(app);
  if (emulatorUrl && !auth.emulatorConfig) {
    connectAuthEmulator(auth, emulatorUrl);
  }
  return auth;
}
