import "server-only";

import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, customFetch, decodeJwt, jwtVerify } from "jose";

const CONTRACT = "folioview.agent-workspace.v2.0";
const PREFIX = "/api/private/portfolio";
const JWKS =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const METADATA =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const SOURCE = `/api/v2/holdings/sources/${ID}`;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ERROR_STATUS: Record<string, number> = {
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

type Json = Record<string, unknown>;
type Config = { project: string; origin: string; audience: string };
type Rule = { kind: "read" | "snapshot" | "mutation" | "authority"; max: number };
type Options = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  deadlineMs?: number;
};

class Failure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const fail = (code = "malformed_request"): never => {
  throw new Failure(code);
};
const record = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const fields = (v: unknown, names: string[]): v is Json =>
  record(v) &&
  Object.keys(v).length === names.length &&
  names.every((name) => Object.hasOwn(v, name));
const integer = (v: unknown, min: number) => Number.isSafeInteger(v) && (v as number) >= min;

function configuration(env: NodeJS.ProcessEnv): Config | null {
  const project = env.FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID ?? "";
  const origin = env.FOLIOVIEW_PORTFOLIO_ORIGIN ?? "";
  if (
    env.FOLIOVIEW_PORTFOLIO_OWNER_ENABLED !== "true" ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
    !/^https:\/\/portfolio-api-[0-9]{1,20}\.[a-z]+(?:-[a-z0-9]+)+[0-9]\.run\.app$/.test(origin) ||
    env.FOLIOVIEW_PORTFOLIO_AUDIENCE !== origin
  )
    return null;
  return { project, origin, audience: origin };
}

export function ownerCapabilities(env: NodeJS.ProcessEnv = process.env) {
  return { schemaVersion: 1, flags: { portfolio: configuration(env) !== null, agentHub: false } };
}

function errorResponse(code: string) {
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

function ruleFor(request: Request): { path: string; rule: Rule } {
  // Inspect the original string too: URL parsers normalize literal and escaped dot segments.
  const url = new URL(request.url);
  if (url.search || request.url.includes("?")) fail("unsupported_query");
  if (/[\\%#]/.test(request.url)) fail();
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site")
    fail("insufficient_scope");
  if (!url.pathname.startsWith(PREFIX + "/")) fail();
  const path = url.pathname.slice(PREFIX.length);
  if (
    request.method === "GET" &&
    new RegExp(`^${SOURCE}(?:/latest|/(?:snapshots|operations|mutations)/${ID})?$`).test(path)
  )
    return { path, rule: { kind: "read", max: 0 } };
  if (request.method === "PUT" && new RegExp(`^${SOURCE}/snapshots/${ID}$`).test(path))
    return { path, rule: { kind: "snapshot", max: 589824 } };
  if (
    request.method === "POST" &&
    new RegExp(`^${SOURCE}/mutations/(?:fence|disconnect|delete)$`).test(path)
  )
    return { path, rule: { kind: "mutation", max: 66560 } };
  if (request.method === "POST" && new RegExp(`^${SOURCE}/authority-sync$`).test(path))
    return { path, rule: { kind: "authority", max: 1024 } };
  return fail();
}

// The deadline also bounds body reads and non-cooperative downstream promises.
async function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Failure("authorization_unavailable"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function bytes(body: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal) {
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

function json(raw: Uint8Array): unknown {
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

function carrier(value: unknown) {
  return (
    fields(value, ["contractVersion", "signedObject"]) &&
    value.contractVersion === CONTRACT &&
    signedObject(value.signedObject)
  );
}

function signedObject(value: unknown) {
  return (
    fields(value, ["protected", "payload", "signature"]) &&
    Object.values(value).every((v) => typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v))
  );
}

async function transport(request: Request, rule: Rule, signal: AbortSignal) {
  if (request.headers.get("x-folioview-contract") !== CONTRACT) fail("unsupported_contract");
  const auth = request.headers.get("authorization") ?? "";
  if (auth.length > 8192 || !auth.startsWith("Bearer ") || !JWT.test(auth.slice(7)))
    fail("invalid_token");
  const headers = new Headers({ Authorization: auth, "X-FolioView-Contract": CONTRACT });
  for (const name of [
    "idempotency-key",
    "x-folioview-author-key",
    "x-folioview-authority-delegation",
  ]) {
    const value = request.headers.get(name);
    const allowed =
      rule.kind === "authority"
        ? name === "x-folioview-authority-delegation"
        : rule.kind !== "read" && name !== "x-folioview-authority-delegation";
    if (allowed) {
      if (
        !value ||
        !(name === "idempotency-key"
          ? /^[A-Za-z0-9_-]{22,128}$/.test(value)
          : name === "x-folioview-author-key"
            ? /^[A-Za-z0-9_-]{43}$/.test(value)
            : value.length <= 16384 && JWT.test(value))
      )
        fail();
      headers.set(name, value!);
    } else if (value !== null) fail();
  }
  if (request.headers.has("content-encoding")) fail("unsupported_media_type");
  const raw = await bytes(request.body, rule.max, signal);
  if (rule.kind === "read") return { headers, raw: undefined, token: auth.slice(7) };
  if (request.headers.get("content-type")?.split(";", 1)[0].toLowerCase() !== "application/json")
    fail("unsupported_media_type");
  const body = json(raw);
  if (rule.kind === "authority") {
    if (!fields(body, ["contractVersion"]) || body.contractVersion !== CONTRACT) fail();
  } else if (rule.kind === "snapshot") {
    if (
      !fields(body, ["contractVersion", "expectedRevision", "carrier"]) ||
      body.contractVersion !== CONTRACT ||
      !integer(body.expectedRevision, 0) ||
      !carrier(body.carrier)
    )
      fail();
  } else if (
    !fields(body, ["contractVersion", "expectedVersion", "expectedSourceEpoch", "command"]) ||
    body.contractVersion !== CONTRACT ||
    !integer(body.expectedVersion, 1) ||
    !integer(body.expectedSourceEpoch, 1) ||
    !signedObject(body.command)
  )
    fail();
  headers.set("Content-Type", "application/json");
  return { headers, raw, token: auth.slice(7) };
}

export function createPortfolioProxy(options: Options = {}) {
  const env = options.env ?? process.env;
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
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
  let serviceToken: { audience: string; token: string; until: number } | undefined;
  let tokenFlight: { audience: string; promise: Promise<string> } | undefined;
  let inFlight = 0;
  const owners = new Map<string, { since: number; count: number; active: number }>();

  async function identity(config: Config) {
    if (serviceToken?.audience === config.audience && serviceToken.until > now())
      return serviceToken.token;
    if (tokenFlight?.audience === config.audience) return tokenFlight.promise;
    const promise = (async () => {
      const signal = AbortSignal.timeout(4000);
      const url = `${METADATA}?audience=${encodeURIComponent(config.audience)}&format=full`;
      const response = await until(
        send(url, {
          headers: { "Metadata-Flavor": "Google" },
          redirect: "manual",
          cache: "no-store",
          credentials: "omit",
          signal,
        }),
        signal,
      );
      if (response.status !== 200 || response.headers.get("metadata-flavor") !== "Google")
        fail("authorization_unavailable");
      const token = new TextDecoder("utf-8", { fatal: true }).decode(
        await bytes(response.body, 16384, signal),
      );
      if (!JWT.test(token)) fail("authorization_unavailable");
      const claims = decodeJwt(token);
      if (
        claims.aud !== config.audience ||
        !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss ?? "") ||
        !Number.isSafeInteger(claims.exp) ||
        claims.exp! * 1000 <= now() + 30000
      )
        fail("authorization_unavailable");
      serviceToken = {
        audience: config.audience,
        token,
        until: Math.min(claims.exp! * 1000 - 30000, now() + 300000),
      };
      return token;
    })().catch(() => {
      throw new Failure("authorization_unavailable");
    });
    tokenFlight = { audience: config.audience, promise };
    try {
      return await promise;
    } finally {
      if (tokenFlight?.promise === promise) tokenFlight = undefined;
    }
  }

  return async function portfolioProxy(request: Request): Promise<Response> {
    if (inFlight >= 16) return errorResponse("authorization_unavailable");
    inFlight++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.deadlineMs ?? 12000);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    let owner: { since: number; count: number; active: number } | undefined;
    let ownerAcquired = false;
    try {
      const config = configuration(env);
      if (!config) fail("authorization_unavailable");
      const { path, rule } = ruleFor(request);
      const { headers, raw, token } = await transport(request, rule, signal);
      let uid: string;
      try {
        const { payload } = await until(
          jwtVerify(token, remoteKeys, {
            issuer: `https://securetoken.google.com/${config!.project}`,
            audience: config!.project,
            algorithms: ["RS256"],
            requiredClaims: ["exp", "iat", "auth_time", "sub"],
            currentDate: new Date(now()),
          }),
          signal,
        );
        if (
          payload.aud !== config!.project ||
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
      for (const [key, value] of owners)
        if (value.active === 0 && now() - value.since >= 60000) owners.delete(key);
      owner = owners.get(uid!)!;
      if (!owner) {
        if (owners.size >= 1024) fail("authorization_unavailable");
        owner = { since: now(), count: 0, active: 0 };
        owners.set(uid!, owner);
      }
      if (owner.active >= 4 || owner.count >= 30) fail("authorization_unavailable");
      owner.active++;
      owner.count++;
      ownerAcquired = true;
      headers.set("X-Serverless-Authorization", `Bearer ${await until(identity(config!), signal)}`);
      const response = await until(
        send(config!.origin + path, {
          method: request.method,
          headers,
          body: raw,
          signal,
          redirect: "manual",
          cache: "no-store",
          credentials: "omit",
        }),
        signal,
      );
      const responseRaw = await bytes(response.body, 1048576, signal).catch(() => {
        throw new Failure("authorization_unavailable");
      });
      if (
        response.headers.get("content-type")?.split(";", 1)[0].toLowerCase() !== "application/json"
      )
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
        !record(body) ||
        body.contractVersion !== CONTRACT
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
    } catch (error) {
      return errorResponse(error instanceof Failure ? error.code : "authorization_unavailable");
    } finally {
      if (ownerAcquired && owner) owner.active--;
      inFlight--;
      clearTimeout(timer);
    }
  };
}

export const portfolioProxy = createPortfolioProxy();
