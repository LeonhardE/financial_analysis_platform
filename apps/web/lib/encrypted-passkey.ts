/** PRF results stay in the browser and are never serialized to a server. */
import type { Archive, PasskeyMaterial } from "./encrypted-types";
import { VaultError } from "./encrypted-types";
export type PasskeyMethod = "local" | "other";
export type PasskeyOptions = { method?: PasskeyMethod; signal?: AbortSignal };
export type PasskeySupport = {
  secureContext: boolean;
  credentialApi: boolean;
  platform: "available" | "unavailable" | "unknown";
  prf: "advertised" | "not_advertised" | "unknown";
};
type PrfOutput = { enabled?: boolean; results?: { first?: ArrayBuffer; second?: ArrayBuffer } };
export class PasskeyUnsupportedError extends VaultError {
  constructor() {
    super("passkey_unsupported");
  }
}
function b64(a: Uint8Array) {
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function bytes(s: string) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]+$/.test(s) || s.length > 2048)
    throw new VaultError("invalid_data");
  const a = Uint8Array.from(
    atob(
      s
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(s.length / 4) * 4, "="),
    ),
    (c) => c.charCodeAt(0),
  );
  if (b64(a) !== s) throw new VaultError("invalid_data");
  return a;
}
function input(salt: Uint8Array) {
  if (salt.length !== 32) throw new VaultError("invalid_data");
  const domain = new TextEncoder().encode("FolioView/device-keystore/v1");
  const first = new Uint8Array(domain.length + 1 + 32);
  first.set(domain);
  first.set(salt, domain.length + 1);
  return first;
}
function verifiedUser(credential: PublicKeyCredential, creation = false) {
  const response = credential.response as AuthenticatorAssertionResponse & {
    getAuthenticatorData?: () => ArrayBuffer;
  };
  const data = creation ? response.getAuthenticatorData?.() : response.authenticatorData;
  if (!data) return false;
  const bytes = new Uint8Array(data);
  return bytes.length >= 37 && (bytes[32] & 4) !== 0;
}
function supported() {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    typeof navigator === "undefined" ||
    !navigator.credentials ||
    typeof navigator.credentials.create !== "function" ||
    typeof navigator.credentials.get !== "function" ||
    typeof PublicKeyCredential === "undefined"
  )
    throw new PasskeyUnsupportedError();
}
function active(signal?: AbortSignal) {
  if (signal?.aborted) throw new VaultError("passkey_cancelled");
}
function method(options: PasskeyOptions) {
  if (options.method !== undefined && options.method !== "local" && options.method !== "other")
    throw new VaultError("invalid_data");
  return options.method ?? "local";
}
function hints(selected: PasskeyMethod) {
  return selected === "local" ? ["client-device"] : ["hybrid", "security-key"];
}
function prfOutput(credential: PublicKeyCredential): PrfOutput | undefined {
  return (
    credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
      prf?: PrfOutput;
    }
  ).prf;
}
function erase(value: unknown) {
  try {
    if (value instanceof ArrayBuffer) new Uint8Array(value).fill(0);
    else if (ArrayBuffer.isView(value))
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0);
  } catch {
    // A previously transferred/detached result has no usable bytes to retain.
  }
}
function erasePrf(prf?: PrfOutput) {
  erase(prf?.results?.first);
  erase(prf?.results?.second);
}
function eraseCredential(credential: Credential | null) {
  try {
    if (credential) erasePrf(prfOutput(credential as PublicKeyCredential));
  } catch {}
}
function credentialId(credential: PublicKeyCredential) {
  if (
    credential.type !== "public-key" ||
    !(credential.rawId instanceof ArrayBuffer) ||
    !credential.rawId.byteLength
  )
    throw new VaultError("unlock_failed");
  const id = b64(new Uint8Array(credential.rawId));
  bytes(id);
  return id;
}
function cancelled(error: unknown): never {
  if (error instanceof VaultError) throw error;
  if (error && typeof error === "object" && "name" in error && error.name === "NotSupportedError")
    throw new PasskeyUnsupportedError();
  throw new VaultError("passkey_cancelled");
}
/** A browser that ignores abort must not publish or retain a late PRF result. */
async function request(
  start: () => Promise<Credential | null>,
  signal?: AbortSignal,
): Promise<PublicKeyCredential | null> {
  active(signal);
  let onAbort: (() => void) | undefined;
  const native = Promise.resolve().then(() => {
    active(signal);
    return start();
  });
  const guarded = native.then((credential) => {
    if (signal?.aborted) {
      eraseCredential(credential);
      throw new VaultError("passkey_cancelled");
    }
    return credential as PublicKeyCredential | null;
  });
  if (!signal) return guarded;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new VaultError("passkey_cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([guarded, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
async function read(
  id: string,
  prfSalt: string,
  options: PasskeyOptions,
): Promise<PasskeyMaterial> {
  active(options.signal);
  supported();
  const selected = method(options);
  let prf: PrfOutput | undefined;
  try {
    const publicKey: PublicKeyCredentialRequestOptions & { hints: string[] } = {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: bytes(id), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
      hints: hints(selected),
      extensions: {
        prf: { eval: { first: input(bytes(prfSalt)) } },
      } as AuthenticationExtensionsClientInputs,
    };
    const credential = await request(
      () => navigator.credentials.get({ publicKey, signal: options.signal }),
      options.signal,
    );
    if (!credential) throw new VaultError("passkey_cancelled");
    prf = prfOutput(credential);
    active(options.signal);
    if (credentialId(credential) !== id || !verifiedUser(credential))
      throw new VaultError("unlock_failed");
    const secret = prf?.results?.first;
    if (prf?.enabled === false || !(secret instanceof ArrayBuffer) || secret.byteLength !== 32)
      throw new PasskeyUnsupportedError();
    return { credentialId: id, prfSalt, secret: new Uint8Array(secret).slice().buffer };
  } catch (e) {
    cancelled(e);
  } finally {
    erasePrf(prf);
  }
}
export async function createVaultPasskey(
  uid: string,
  options: PasskeyOptions = {},
): Promise<PasskeyMaterial> {
  active(options.signal);
  supported();
  const selected = method(options);
  let prf: PrfOutput | undefined;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const userId = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid));
    active(options.signal);
    const publicKey: PublicKeyCredentialCreationOptions & { hints: string[] } = {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "FolioView" },
      user: {
        id: userId,
        name: "FolioView account",
        displayName: "FolioView encrypted resources",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
        authenticatorAttachment: selected === "local" ? "platform" : "cross-platform",
      },
      hints: hints(selected),
      timeout: 60000,
      attestation: "none",
      extensions: {
        prf: { eval: { first: input(salt) } },
      } as AuthenticationExtensionsClientInputs,
    };
    const credential = await request(
      () => navigator.credentials.create({ publicKey, signal: options.signal }),
      options.signal,
    );
    if (!credential) throw new VaultError("passkey_cancelled");
    prf = prfOutput(credential);
    active(options.signal);
    if (prf?.enabled !== true) throw new PasskeyUnsupportedError();
    const id = credentialId(credential),
      prfSalt = b64(salt);
    const secret = prf.results?.first;
    if (secret instanceof ArrayBuffer && secret.byteLength === 32 && verifiedUser(credential, true))
      return { credentialId: id, prfSalt, secret: new Uint8Array(secret).slice().buffer };
    if (secret !== undefined && (!(secret instanceof ArrayBuffer) || secret.byteLength !== 32))
      throw new PasskeyUnsupportedError();
    erasePrf(prf);
    // Some authenticators advertise PRF at creation but require an assertion to
    // evaluate it. This uses the same new credential, never another device/key.
    return await read(id, prfSalt, options);
  } catch (e) {
    cancelled(e);
  } finally {
    erasePrf(prf);
  }
}
export async function unlockVaultPasskey(
  archive: Archive,
  options: PasskeyOptions = {},
): Promise<PasskeyMaterial> {
  return read(archive.credentialId, archive.prfSalt, options);
}

/** Public, bounded hints only. No credential chooser or proof of PRF availability. */
export async function inspectVaultPasskeySupport(
  options: { signal?: AbortSignal } = {},
): Promise<PasskeySupport> {
  active(options.signal);
  const secureContext = typeof window !== "undefined" && window.isSecureContext === true;
  const credentialApi = Boolean(
    typeof navigator !== "undefined" &&
    navigator.credentials &&
    typeof navigator.credentials.create === "function" &&
    typeof navigator.credentials.get === "function" &&
    typeof PublicKeyCredential !== "undefined",
  );
  const result: PasskeySupport = {
    secureContext,
    credentialApi,
    platform: "unknown",
    prf: "unknown",
  };
  if (!secureContext || !credentialApi) return result;
  const constructor = PublicKeyCredential as typeof PublicKeyCredential & {
    getClientCapabilities?: () => Promise<Record<string, boolean>>;
  };
  const probe = (call?: () => Promise<unknown>): Promise<unknown> => {
    if (!call) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value?: unknown, aborted = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (aborted) reject(new VaultError("passkey_cancelled"));
        else resolve(value);
      };
      const abort = () => finish(undefined, true);
      const timer = setTimeout(() => finish(), 1500);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) {
        abort();
        return;
      }
      Promise.resolve()
        .then(() => {
          active(options.signal);
          return call();
        })
        .then(finish, () => finish());
    });
  };
  const [platform, capabilities] = await Promise.all([
    probe(
      typeof constructor.isUserVerifyingPlatformAuthenticatorAvailable === "function"
        ? () => constructor.isUserVerifyingPlatformAuthenticatorAvailable()
        : undefined,
    ),
    probe(
      typeof constructor.getClientCapabilities === "function"
        ? () => constructor.getClientCapabilities!()
        : undefined,
    ),
  ]);
  active(options.signal);
  if (typeof platform === "boolean") result.platform = platform ? "available" : "unavailable";
  if (capabilities && typeof capabilities === "object" && "extension:prf" in capabilities) {
    const advertised = capabilities["extension:prf"];
    if (typeof advertised === "boolean") result.prf = advertised ? "advertised" : "not_advertised";
  }
  return result;
}
export type { PasskeyMaterial };
