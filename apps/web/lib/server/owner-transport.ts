import "server-only";

import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export const CONTRACT = "folioview.agent-workspace.v2.0";
export const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const JWKS =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
export type Json = Record<string, unknown>;
export type Options = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  deadlineMs?: number;
};

export const ERROR_STATUS: Record<string, number> = {
  malformed_request: 400,
  unsupported_contract: 400,
  unsupported_query: 400,
  invalid_token: 401,
  insufficient_scope: 403,
  key_authorization_required: 403,
  not_found: 404,
  version_conflict: 409,
  idempotency_conflict: 409,
  initial_result_exists: 409,
  registry_conflict: 409,
  stale_key_epoch: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  invalid_envelope: 422,
  invalid_signature: 422,
  recipient_binding_mismatch: 422,
  unsupported_profile: 422,
  authorization_unavailable: 503,
  source_unavailable: 503,
};

export class Failure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const fail = (code = "malformed_request"): never => {
  throw new Failure(code);
};

export function requireSameOrigin(request: Request, url: URL) {
  if (request.headers.get("sec-fetch-site") === "cross-site") fail("insufficient_scope");
  const origin = request.headers.get("origin");
  if (origin === null) return;
  // Next standalone builds request.url from the container's listening address.
  // Host retains the browser's destination behind Cloud Run. Forwarded host
  // headers are caller-controlled and must not select the accepted origin.
  const host = request.headers.get("host") ?? url.host;
  if (!host || /[\s,\\/@?#%]/.test(host) || !["https:", "http:"].includes(url.protocol))
    fail("insufficient_scope");
  let expected: string;
  try {
    expected = new URL(`${url.protocol}//${host}`).origin;
  } catch {
    return fail("insufficient_scope");
  }
  if (origin !== expected) fail("insufficient_scope");
}

export const record = (v: unknown): v is Json =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const fields = (v: unknown, names: string[]): v is Json =>
  record(v) &&
  Object.keys(v).length === names.length &&
  names.every((name) => Object.hasOwn(v, name));
export const integer = (v: unknown, min: number) => Number.isSafeInteger(v) && (v as number) >= min;

export function errorResponse(code: string) {
  const status = ERROR_STATUS[code] ?? 503;
  return Response.json(
    {
      contractVersion: CONTRACT,
      error: { code, retryable: status === 503, requestId: randomUUID().replaceAll("-", "") },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 503 ? { "Retry-After": "1" } : {}),
        ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
      },
    },
  );
}

// The deadline also bounds body reads and non-cooperative downstream promises.
export async function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Failure("authorization_unavailable"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function bytes(
  body: ReadableStream<Uint8Array> | null,
  max: number,
  signal: AbortSignal,
) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await until(reader.read(), signal);
      if (done) break;
      size += value.length;
      if (size > max) fail("payload_too_large");
      parts.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  } finally {
    // Do not wait for an uncooperative stream's cancellation handshake.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function json(raw: Uint8Array): unknown {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    value = JSON.parse(text);
  } catch {
    return fail();
  }
  // JSON.parse alone silently accepts duplicate keys. Bound nesting and reject them
  // at every level before a service identity can be used.
  let i = 0;
  const space = () => {
    while (/[ \t\r\n]/.test(text[i] ?? "") && i < text.length) i++;
  };
  const string = (): string => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i++] === '"') {
        const v = JSON.parse(text.slice(start, i));
        if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))
          fail();
        return v;
      }
    }
    return fail();
  };
  const scan = (depth = 0): void => {
    if (depth > 20) fail();
    space();
    if (text[i] === "{" || text[i] === "[") {
      const object = text[i++] === "{";
      const end = object ? "}" : "]";
      const names = new Set<string>();
      space();
      if (text[i] === end) {
        i++;
        return;
      }
      for (;;) {
        if (object) {
          space();
          if (text[i] !== '"') fail();
          const name = string();
          if (names.has(name)) fail();
          names.add(name);
          space();
          if (text[i++] !== ":") fail();
        }
        scan(depth + 1);
        space();
        if (text[i] === end) {
          i++;
          return;
        }
        if (text[i++] !== ",") fail();
      }
    }
    if (text[i] === '"') {
      string();
      return;
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      text.slice(i),
    );
    if (!token) fail();
    if (/^-?\d/.test(token![0]) && !Number.isSafeInteger(Number(token![0]))) fail();
    i += token![0].length;
  };
  scan();
  space();
  if (i !== text.length) fail();
  return value;
}

export function carrier(value: unknown) {
  return (
    fields(value, ["contractVersion", "signedObject"]) &&
    value.contractVersion === CONTRACT &&
    signedObject(value.signedObject)
  );
}

export function signedObject(value: unknown) {
  return (
    fields(value, ["protected", "payload", "signature"]) &&
    Object.values(value).every((v) => typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v))
  );
}

export function createFirebaseVerifier(send: typeof fetch, now: () => number) {
  const remoteKeys = createRemoteJWKSet(new URL(JWKS), {
    cacheMaxAge: 600000,
    cooldownDuration: 30000,
    timeoutDuration: 4000,
    [customFetch]: async (input, init) => {
      if (String(input) !== JWKS) fail("authorization_unavailable");
      const signal = AbortSignal.timeout(4000);
      const response = await until(
        send(JWKS, { ...init, signal, redirect: "manual", cache: "no-store", credentials: "omit" }),
        signal,
      );
      if (response.status !== 200) fail("authorization_unavailable");
      const raw = await bytes(response.body, 131072, signal);
      // The JOSE parser receives only a bounded, duplicate-free JSON document.
      json(raw);
      return new Response(raw, { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  return async (token: string, project: string, signal: AbortSignal): Promise<string> => {
    let uid: string;
    try {
      const { payload } = await until(
        jwtVerify(token, remoteKeys, {
          issuer: `https://securetoken.google.com/${project}`,
          audience: project,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "iat", "auth_time", "sub"],
          currentDate: new Date(now()),
        }),
        signal,
      );
      if (
        payload.aud !== project ||
        typeof payload.sub !== "string" ||
        !payload.sub ||
        payload.sub.length > 128 ||
        !integer(payload.exp, 0) ||
        !integer(payload.iat, 0) ||
        payload.iat! > now() / 1000 ||
        !integer(payload.auth_time, 0) ||
        (payload.auth_time as number) > now() / 1000 ||
        !record(payload.firebase) ||
        payload.firebase.sign_in_provider !== "google.com"
      )
        fail("invalid_token");
      uid = payload.sub!;
    } catch (error) {
      // Unknown kid can be a legitimate rotation during the resolver cooldown.
      // Key infrastructure errors must never log the user out.
      const code = (error as { code?: string }).code;
      if (error instanceof Failure && error.code === "invalid_token") throw error;
      if (
        [
          "ERR_JWT_EXPIRED",
          "ERR_JWT_CLAIM_VALIDATION_FAILED",
          "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
          "ERR_JWS_INVALID",
          "ERR_JWT_INVALID",
          "ERR_JOSE_ALG_NOT_ALLOWED",
        ].includes(code ?? "")
      )
        fail("invalid_token");
      fail("authorization_unavailable");
    }
    return uid!;
  };
}

export function createAdmission(now: () => number) {
  let active = 0;
  const owners = new Map<string, { since: number; count: number; active: number }>();
  return {
    enter() {
      if (active >= 16) fail("authorization_unavailable");
      active++;
      return () => {
        active--;
      };
    },
    owner(uid: string) {
      for (const [key, value] of owners)
        if (value.active === 0 && now() - value.since >= 60000) owners.delete(key);
      let owner = owners.get(uid);
      if (!owner) {
        if (owners.size >= 1024) fail("authorization_unavailable");
        owner = { since: now(), count: 0, active: 0 };
        owners.set(uid, owner);
      }
      if (owner.active >= 4 || owner.count >= 30) fail("authorization_unavailable");
      owner.active++;
      owner.count++;
      return () => {
        owner.active--;
      };
    },
  };
}

export async function forwardResponse(
  response: Response,
  signal: AbortSignal,
  accept?: (body: unknown) => boolean,
) {
  const responseRaw = await bytes(response.body, 1048576, signal).catch(() => {
    throw new Failure("authorization_unavailable");
  });
  if (response.headers.get("content-type")?.split(";", 1)[0].toLowerCase() !== "application/json")
    fail("authorization_unavailable");
  let body: unknown;
  try {
    body = json(responseRaw);
  } catch {
    fail("authorization_unavailable");
  }
  if (response.status >= 400) {
    if (
      !fields(body, ["contractVersion", "error"]) ||
      body.contractVersion !== CONTRACT ||
      !fields(body.error, ["code", "retryable", "requestId"]) ||
      typeof body.error.code !== "string" ||
      ERROR_STATUS[body.error.code] !== response.status ||
      body.error.retryable !== (response.status === 503) ||
      typeof body.error.requestId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.error.requestId)
    )
      fail("authorization_unavailable");
  } else if (
    ![200, 201, 202].includes(response.status) ||
    (accept ? !accept(body) : !record(body) || body.contractVersion !== CONTRACT)
  )
    fail("authorization_unavailable");
  return new Response(responseRaw, {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(response.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
    },
  });
}
