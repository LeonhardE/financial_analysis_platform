import "server-only";

import {
  hubResponse,
  vaultKeyRenewalRequest,
  vaultLifecycleArchive,
  vaultLifecycleCommand,
} from "./hub-owner-contracts";

import {
  CONTRACT,
  JWT,
  Failure,
  fail,
  fields,
  integer,
  errorResponse,
  until,
  bytes,
  json,
  carrier,
  signedObject,
  record,
  createFirebaseVerifier,
  createAdmission,
  forwardResponse,
  type Options,
} from "./owner-transport";

const PREFIX = "/api/private/agent-hub";
const ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const identifier = (value: unknown) =>
  typeof value === "string" && new RegExp(`^${ID}$`).test(value);
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const BINDING = ["ref", "sourceEpoch"];
type Rule = {
  kind:
    | "read"
    | "bootstrap"
    | "registry"
    | "archive"
    | "key-renewal"
    | "lifecycle-control"
    | "control"
    | "small"
    | "task-create"
    | "task-update"
    | "task-transition"
    | "stage"
    | "commit";
  max: number;
  operation?: boolean;
  author?: boolean;
  vaultId?: string;
  responseStatus?: 200 | 201;
  query?: Record<string, "limit" | "cursor" | "filter" | "id" | "revision" | "delivery">;
};
type Config = { origin: string; project: string };

export function hubConfiguration(env: NodeJS.ProcessEnv): Config | null {
  const origin = env.FOLIOVIEW_HUB_ORIGIN ?? "";
  const project = env.FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID ?? "";
  if (
    env.FOLIOVIEW_HUB_OWNER_ENABLED !== "true" ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
    !/^https:\/\/agent-hub-api-[0-9]{1,20}\.[a-z]+(?:-[a-z0-9]+)+[0-9]\.run\.app$/.test(origin)
  )
    return null;
  return { origin, project };
}

function decimal(value: string, maximum: number) {
  return (
    /^[1-9][0-9]{0,15}$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) <= maximum
  );
}

function route(request: Request): { path: string; rule: Rule } {
  const url = new URL(request.url);
  // Query values can be encoded; encoded PATH separators/segments cannot select a route.
  if (/[\\%#]/.test(request.url.split("?", 1)[0]) || url.hash) fail();
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site")
    fail("insufficient_scope");
  if (!url.pathname.startsWith(PREFIX + "/")) fail();
  const path = url.pathname.slice(PREFIX.length);
  const get = request.method === "GET";
  let rule: Rule | undefined;
  if (
    get &&
    ["/api/v2/vaults/current", "/api/v2/resources/catalogue", "/api/v2/agent-connections"].includes(
      path,
    )
  )
    rule = { kind: "read", max: 0 };
  else if (get && path === "/api/v2/tasks")
    rule = { kind: "read", max: 0, query: { limit: "limit", cursor: "cursor" } };
  else if (
    get &&
    new RegExp(
      `^/api/v2/vaults/${ID}/(?:key-renewal-state|key-renewal-operations/[A-Za-z0-9_-]{22,128})$`,
    ).test(path)
  )
    rule = { kind: "read", max: 0, responseStatus: 200 };
  else if (
    request.method === "POST" &&
    new RegExp(`^/api/v2/vaults/${ID}/key-renewals$`).test(path)
  )
    rule = {
      kind: "key-renewal",
      max: 589824,
      operation: true,
      vaultId: path.split("/")[4],
      responseStatus: 201,
    };
  else if (
    get &&
    new RegExp(`^/api/v2/tasks/${ID}(?:/versions/(?:[1-9]|[1-4][0-9]|50))?$`).test(path)
  )
    rule = { kind: "read", max: 0 };
  else if (get && path === "/api/v2/results")
    rule = {
      kind: "read",
      max: 0,
      query: { limit: "limit", cursor: "cursor", filter: "filter", taskId: "id" },
    };
  else if (get && path === "/api/v2/results/counts")
    rule = { kind: "read", max: 0, query: { taskId: "id" } };
  else if (get && new RegExp(`^/api/v2/results/${ID}$`).test(path))
    rule = { kind: "read", max: 0, query: { revision: "revision", deliveryRevision: "delivery" } };
  else if (get && new RegExp(`^/api/v2/results/${ID}/revisions$`).test(path))
    rule = { kind: "read", max: 0, query: { limit: "limit", cursor: "cursor" } };
  else if (
    get &&
    new RegExp(
      `^/api/v2/results/${ID}/revisions/([1-9]|[12][0-9]|3[0-2])/(?:evidence|registries/([1-9]|[12][0-9]|3[0-2]))$`,
    ).test(path)
  )
    rule = { kind: "read", max: 0 };
  else if (
    get &&
    new RegExp(`^/api/v2/agent-connections/${ID}/tasks/${ID}/preparation-intent$`).test(path)
  )
    rule = { kind: "read", max: 0 };
  else if (
    get &&
    new RegExp(`^/api/v2/vaults/${ID}/(?:archive|archive-operations/[A-Za-z0-9_-]{22,128})$`).test(
      path,
    )
  )
    rule = { kind: "read", max: 0 };
  else if (request.method === "PUT" && new RegExp(`^/api/v2/vaults/${ID}/archive$`).test(path))
    rule = { kind: "archive", max: 65536, operation: true, vaultId: path.split("/")[4] };
  else if (
    request.method === "POST" &&
    new RegExp(`^/api/v2/vaults/${ID}/recovery-authorizations(?:/${ID}/revoke)?$`).test(path)
  )
    rule = { kind: "lifecycle-control", max: 8192, operation: true };
  else if (request.method === "POST" && path === "/api/v2/vaults")
    rule = { kind: "bootstrap", max: 589824, operation: true };
  else if (request.method === "PUT" && new RegExp(`^/api/v2/vaults/${ID}/registry$`).test(path))
    rule = { kind: "registry", max: 589824, operation: true };
  else if (
    request.method === "POST" &&
    new RegExp(`^/api/v2/vaults/${ID}/holdings-sources/${ID}$`).test(path)
  )
    rule = { kind: "control", max: 66560, operation: true, author: true };
  else if (request.method === "POST" && path === "/api/v2/vaults/current/authority-token")
    rule = { kind: "small", max: 1024 };
  else if (request.method === "POST" && path === "/api/v2/tasks")
    rule = { kind: "task-create", max: 589824, operation: true, author: true };
  else if (request.method === "PUT" && new RegExp(`^/api/v2/tasks/${ID}$`).test(path))
    rule = { kind: "task-update", max: 589824, operation: true, author: true };
  else if (request.method === "POST" && new RegExp(`^/api/v2/tasks/${ID}/transitions$`).test(path))
    rule = { kind: "task-transition", max: 589824, operation: true, author: true };
  else if (request.method === "PATCH" && new RegExp(`^/api/v2/results/${ID}/state$`).test(path))
    rule = { kind: "control", max: 65536, operation: true, author: true };
  else if (
    request.method === "POST" &&
    new RegExp(`^/api/v2/agent-connections/${ID}/(?:revoke|grants/${ID}/revoke)$`).test(path)
  )
    rule = { kind: "small", max: 1024 };
  else if (
    request.method === "PUT" &&
    new RegExp(`^/api/v2/agent-connections/${ID}/tasks/${ID}/preparation/objects/${ID}$`).test(path)
  )
    rule = { kind: "stage", max: 589824, operation: true, author: true };
  else if (
    request.method === "POST" &&
    new RegExp(`^/api/v2/agent-connections/${ID}/tasks/${ID}/preparation/commit$`).test(path)
  )
    rule = { kind: "commit", max: 8192, operation: true };
  if (!rule) return fail();
  if (url.searchParams.size === 0 && request.url.includes("?")) fail("unsupported_query");
  for (const [key, value] of url.searchParams) {
    const kind = rule.query && Object.hasOwn(rule.query, key) ? rule.query[key] : undefined;
    if (
      !kind ||
      url.searchParams.getAll(key).length !== 1 ||
      (kind === "limit"
        ? !decimal(value, 50)
        : kind === "revision"
          ? !decimal(value, 32)
          : kind === "delivery"
            ? !decimal(value, Number.MAX_SAFE_INTEGER)
            : kind === "id"
              ? !identifier(value)
              : kind === "cursor"
                ? !/^[A-Za-z0-9_-]{1,2048}$/.test(value)
                : !["all", "unread", "starred", "archived"].includes(value))
    )
      fail("unsupported_query");
  }
  return { path: path + url.search, rule };
}

function binding(value: unknown) {
  return (
    fields(value, BINDING) &&
    integer(value.sourceEpoch, 1) &&
    fields(value.ref, ["kind", "sourceService", "resourceId", "incarnation"]) &&
    ["holdings", "watchlist", "channel_follows"].includes(value.ref.kind as string) &&
    value.ref.sourceService === (value.ref.kind === "holdings" ? "portfolio" : "user") &&
    identifier(value.ref.resourceId) &&
    identifier(value.ref.incarnation)
  );
}

function validBody(body: unknown, kind: Rule["kind"], vaultId?: string) {
  if (!record(body) || body.contractVersion !== CONTRACT) return false;
  switch (kind) {
    case "small":
      return fields(body, ["contractVersion"]);
    case "control":
      return fields(body, ["contractVersion", "command"]) && signedObject(body.command);
    case "lifecycle-control":
      return fields(body, ["contractVersion", "command"]) && vaultLifecycleCommand(body.command);
    case "archive":
      return (
        fields(body, ["contractVersion", "archive", "command"]) &&
        vaultLifecycleArchive(body.archive, vaultId) &&
        vaultLifecycleCommand(body.command)
      );
    case "key-renewal":
      return vaultKeyRenewalRequest(body, vaultId);
    case "stage":
      return fields(body, ["contractVersion", "envelope"]) && carrier(body.envelope);
    case "registry":
      return (
        fields(body, ["contractVersion", "expectedVersion", "registryBundle"]) &&
        integer(body.expectedVersion, 1) &&
        registryBundle(body.registryBundle)
      );
    case "bootstrap":
      return (
        fields(body, [
          "contractVersion",
          "vaultId",
          "rootJwk",
          "rootKeyId",
          "registryBundle",
          "archive",
        ]) &&
        identifier(body.vaultId) &&
        fields(body.rootJwk, ["kty", "crv", "x", "y"]) &&
        body.rootJwk.kty === "EC" &&
        body.rootJwk.crv === "P-256" &&
        /^[A-Za-z0-9_-]{43}$/.test(body.rootKeyId as string) &&
        registryBundle(body.registryBundle) &&
        fields(body.archive, [
          "profile",
          "ownerSubject",
          "vaultId",
          "rootKeyId",
          "credentialId",
          "prfSalt",
          "iv",
          "ciphertext",
        ]) &&
        body.archive.profile === "folioview.passkey-vault.v1" &&
        Object.values(body.archive).every((value) => typeof value === "string")
      );
    case "commit":
      return (
        fields(body, ["contractVersion", "objects"]) &&
        Array.isArray(body.objects) &&
        body.objects.length >= 1 &&
        body.objects.length <= 11 &&
        body.objects.every(
          (item) =>
            fields(item, ["objectId", "envelopeFingerprint"]) &&
            identifier(item.objectId) &&
            digest(item.envelopeFingerprint),
        )
      );
    default: {
      const create = kind === "task-create",
        transition = kind === "task-transition";
      return (
        fields(body, [
          "contractVersion",
          "expectedVersion",
          "resourceBindings",
          "envelope",
          ...(create ? ["taskId"] : []),
          ...(transition ? ["transitionIntent"] : []),
        ]) &&
        integer(body.expectedVersion, create ? 0 : 1) &&
        (!create || identifier(body.taskId)) &&
        Array.isArray(body.resourceBindings) &&
        body.resourceBindings.length <= 10 &&
        body.resourceBindings.every(binding) &&
        carrier(body.envelope) &&
        (!transition || signedObject(body.transitionIntent))
      );
    }
  }
}

function registryBundle(value: unknown) {
  return (
    fields(value, ["contractVersion", "checkpoint", "entries"]) &&
    value.contractVersion === CONTRACT &&
    signedObject(value.checkpoint) &&
    Array.isArray(value.entries) &&
    value.entries.length <= 64 &&
    value.entries.every(
      (entry) =>
        fields(entry, ["certificate", "active"]) &&
        signedObject(entry.certificate) &&
        typeof entry.active === "boolean",
    )
  );
}

async function transport(request: Request, rule: Rule, signal: AbortSignal) {
  if (request.headers.get("x-folioview-contract") !== CONTRACT) fail("unsupported_contract");
  const auth = request.headers.get("authorization") ?? "";
  if (auth.length > 8192 || !auth.startsWith("Bearer ") || !JWT.test(auth.slice(7)))
    fail("invalid_token");
  const headers = new Headers({ Authorization: auth, "X-FolioView-Contract": CONTRACT });
  for (const [name, required, pattern] of [
    ["idempotency-key", rule.operation, /^[A-Za-z0-9_-]{22,128}$/],
    ["x-folioview-author-key", rule.author, /^[A-Za-z0-9_-]{43}$/],
  ] as const) {
    const value = request.headers.get(name);
    if (required) {
      if (!value || !pattern.test(value)) fail();
      headers.set(name, value!);
    } else if (value !== null) fail();
  }
  // Build a fresh allowlist: cookies, caller identity/delegation and Origin are not forwarded.
  if (request.headers.has("x-folioview-authority-delegation")) fail();
  if (request.headers.has("content-encoding")) fail("unsupported_media_type");
  const raw = await bytes(request.body, rule.max, signal);
  if (rule.kind === "read") return { headers, raw: undefined, token: auth.slice(7) };
  if (request.headers.get("content-type")?.split(";", 1)[0].toLowerCase() !== "application/json")
    fail("unsupported_media_type");
  if (!validBody(json(raw), rule.kind, rule.vaultId)) fail();
  headers.set("Content-Type", "application/json");
  return { headers, raw, token: auth.slice(7) };
}

export function createHubProxy(options: Options = {}) {
  const env = options.env ?? process.env,
    send = options.fetch ?? fetch,
    now = options.now ?? Date.now;
  const verifyOwner = createFirebaseVerifier(send, now),
    admission = createAdmission(now);
  return async function hubProxy(request: Request): Promise<Response> {
    let releaseGlobal: (() => void) | undefined, releaseOwner: (() => void) | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.deadlineMs ?? 12000);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    try {
      releaseGlobal = admission.enter();
      const config = hubConfiguration(env);
      if (!config) fail("authorization_unavailable");
      const { path, rule } = route(request);
      const { headers, raw, token } = await transport(request, rule, signal);
      const uid = await verifyOwner(token, config!.project, signal);
      releaseOwner = admission.owner(uid);
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
      if (
        response.status < 400 &&
        rule.responseStatus !== undefined &&
        response.status !== rule.responseStatus
      ) {
        void response.body?.cancel().catch(() => {});
        fail("authorization_unavailable");
      }
      return await forwardResponse(response, signal, (body) =>
        hubResponse(path, request.method, body, headers.get("idempotency-key") ?? undefined),
      );
    } catch (error) {
      return errorResponse(error instanceof Failure ? error.code : "authorization_unavailable");
    } finally {
      releaseOwner?.();
      releaseGlobal?.();
      clearTimeout(timer);
    }
  };
}

export const hubProxy = createHubProxy();
