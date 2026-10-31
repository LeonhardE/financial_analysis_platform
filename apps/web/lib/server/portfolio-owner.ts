import "server-only";

import { decodeJwt } from "jose";
import {
  CONTRACT,
  JWT,
  Failure,
  fail,
  requireSameOrigin,
  record,
  fields,
  integer,
  errorResponse,
  until,
  bytes,
  json,
  carrier,
  signedObject,
  createFirebaseVerifier,
  createAdmission,
  forwardResponse,
  type Options,
} from "./owner-transport";

const PREFIX = "/api/private/portfolio";
const METADATA =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const SOURCE = `/api/v2/holdings/sources/${ID}`;
type Config = { project: string; origin: string; audience: string };
type Rule = { kind: "read" | "snapshot" | "mutation" | "authority"; max: number };
export function portfolioConfiguration(env: NodeJS.ProcessEnv): Config | null {
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

function ruleFor(request: Request): { path: string; rule: Rule } {
  // Inspect the original string too: URL parsers normalize literal and escaped dot segments.
  const url = new URL(request.url);
  if (url.search || request.url.includes("?")) fail("unsupported_query");
  if (/[\\%#]/.test(request.url)) fail();
  requireSameOrigin(request, url);
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
  const verifyOwner = createFirebaseVerifier(send, now);
  const admission = createAdmission(now);
  let serviceToken: { audience: string; token: string; until: number } | undefined;
  let tokenFlight: { audience: string; promise: Promise<string> } | undefined;

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
    let releaseGlobal: (() => void) | undefined;
    let releaseOwner: (() => void) | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.deadlineMs ?? 12000);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    try {
      releaseGlobal = admission.enter();
      const config = portfolioConfiguration(env);
      if (!config) fail("authorization_unavailable");
      const { path, rule } = ruleFor(request);
      const { headers, raw, token } = await transport(request, rule, signal);
      const uid = await verifyOwner(token, config!.project, signal);
      releaseOwner = admission.owner(uid);
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
      return await forwardResponse(response, signal);
    } catch (error) {
      return errorResponse(error instanceof Failure ? error.code : "authorization_unavailable");
    } finally {
      releaseOwner?.();
      releaseGlobal?.();
      clearTimeout(timer);
    }
  };
}

export const portfolioProxy = createPortfolioProxy();
