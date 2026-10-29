/** PRF results stay in the browser and are never serialized to a server. */
import type { Archive, PasskeyMaterial } from "./encrypted-types";
import { VaultError } from "./encrypted-types";
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
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length > 2048) throw new VaultError("invalid_data");
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
    !navigator.credentials ||
    typeof PublicKeyCredential === "undefined"
  )
    throw new PasskeyUnsupportedError();
}
async function read(credentialId: string, prfSalt: string): Promise<PasskeyMaterial> {
  supported();
  try {
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: bytes(credentialId), type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
        extensions: {
          prf: { eval: { first: input(bytes(prfSalt)) } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (
      !credential ||
      b64(new Uint8Array(credential.rawId)) !== credentialId ||
      !verifiedUser(credential)
    )
      throw new VaultError("unlock_failed");
    const extension =
      credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
        prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
      };
    const secret = extension.prf?.results?.first;
    if (!(secret instanceof ArrayBuffer) || secret.byteLength !== 32)
      throw new PasskeyUnsupportedError();
    return { credentialId, prfSalt, secret };
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError("passkey_cancelled");
  }
}
export async function createVaultPasskey(uid: string): Promise<PasskeyMaterial> {
  supported();
  try {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const userId = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid));
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "FolioView" },
        user: {
          id: userId,
          name: "FolioView account",
          displayName: "FolioView encrypted resources",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        timeout: 60000,
        attestation: "none",
        extensions: {
          prf: { eval: { first: input(salt) } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new VaultError("passkey_cancelled");
    const extension =
      credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
        prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
      };
    if (extension.prf?.enabled !== true) throw new PasskeyUnsupportedError();
    const credentialId = b64(new Uint8Array(credential.rawId)),
      prfSalt = b64(salt);
    const secret = extension.prf.results?.first;
    if (secret instanceof ArrayBuffer && secret.byteLength === 32 && verifiedUser(credential, true))
      return { credentialId, prfSalt, secret };
    if (secret instanceof ArrayBuffer) new Uint8Array(secret).fill(0);
    return await read(credentialId, prfSalt);
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError("passkey_cancelled");
  }
}
export async function unlockVaultPasskey(archive: Archive): Promise<PasskeyMaterial> {
  return read(archive.credentialId, archive.prfSalt);
}
export type { PasskeyMaterial };
