import {
  CONNECTION_CONTRACT,
  ConnectionError,
  exact,
  identifier,
  AGENT_SCOPES,
} from "./agent-connections";

export const OWNER_BRIDGE_PROFILE = "folioview.owner-consent-bridge.v1";
export type ConsentOperation = "claim" | "prepare_encrypted" | "decision";
export type ConsentHandoff = { requestId: string; nonce: string };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const brands = new WeakSet<object>();
const routed = new WeakSet<object>();
const destinations = new WeakMap<object, { peer: Window; origin: string }>();
const HUB_ORIGIN = /^https:\/\/agent-hub-api-[0-9]{1,20}\.[a-z]+(?:-[a-z0-9]+)+[0-9]\.run\.app$/;
const utf8 = new TextEncoder();
const byteSize = (value: unknown) => {
  try {
    return utf8.encode(JSON.stringify(value)).byteLength;
  } catch {
    return Infinity;
  }
};
export function consentHandoff(search: string): ConsentHandoff | null {
  const query = new URLSearchParams(search);
  if (!query.has("agent_request") && !query.has("agent_nonce")) return null;
  if (
    query.size !== 2 ||
    query.getAll("agent_request").length !== 1 ||
    query.getAll("agent_nonce").length !== 1 ||
    !identifier(query.get("agent_request")) ||
    !TOKEN.test(query.get("agent_nonce") ?? "")
  )
    throw new ConnectionError("invalid_handoff");
  return { requestId: query.get("agent_request")!, nonce: query.get("agent_nonce")! };
}

/** Public request locator only: never accept an authorization/callback URL or credentials. */
export function ownerReconnectUrl(value: string, hubOrigin: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectionError("invalid_handoff");
  }
  if (
    !HUB_ORIGIN.test(hubOrigin) ||
    value.length > 2048 ||
    url.origin !== hubOrigin ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== "/agent/v2/helper/consent.html" ||
    url.searchParams.size !== 1 ||
    !identifier(url.searchParams.get("request"))
  )
    throw new ConnectionError("invalid_handoff");
  url.searchParams.set("owner_reuse", "1");
  return url;
}

export function releaseConsentHandoff(handoff: ConsentHandoff | null) {
  if (handoff) destinations.delete(handoff);
}

/** Open a fresh public Hub request from the unlocked page, without replacing its Worker. */
export function openOwnerReconnect(
  value: string,
  hubOrigin: string,
  signal?: AbortSignal,
): Promise<ConsentHandoff> {
  const url = ownerReconnectUrl(value, hubOrigin);
  if (signal?.aborted) return Promise.reject(new ConnectionError("cancelled"));
  return new Promise((resolve, reject) => {
    let peer: Window | null = null;
    const finish = () => {
      window.removeEventListener("message", message);
      signal?.removeEventListener("abort", cancel);
      clearTimeout(timer);
    };
    const cancel = () => {
      finish();
      peer?.close();
      reject(new ConnectionError(signal?.aborted ? "cancelled" : "request_timeout"));
    };
    const message = (event: MessageEvent) => {
      if (
        !event.isTrusted ||
        !peer ||
        event.source !== peer ||
        event.origin !== hubOrigin ||
        event.ports.length !== 0 ||
        !exact(event.data, ["type", "profile", "requestId", "nonce"]) ||
        event.data.type !== "fv-owner-consent-offer" ||
        event.data.profile !== OWNER_BRIDGE_PROFILE ||
        event.data.requestId !== url.searchParams.get("request") ||
        typeof event.data.nonce !== "string" ||
        !TOKEN.test(event.data.nonce)
      )
        return;
      const handoff = Object.freeze({ requestId: event.data.requestId, nonce: event.data.nonce });
      routed.add(handoff);
      destinations.set(handoff, { peer, origin: hubOrigin });
      finish();
      resolve(handoff);
    };
    const timer = setTimeout(cancel, 30_000);
    window.addEventListener("message", message);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      peer = window.open(url.href, "_blank");
      if (!peer) throw new ConnectionError("popup_blocked");
    } catch {
      finish();
      reject(new ConnectionError("invalid_handoff"));
    }
  });
}
export function validateConsentCommand(op: ConsentOperation, json: unknown) {
  if (
    !json ||
    typeof json !== "object" ||
    (json as Record<string, unknown>).contractVersion !== CONNECTION_CONTRACT ||
    byteSize(json) > 114688
  )
    throw new ConnectionError("invalid_request");
  if (op === "claim") {
    if (!exact(json, ["contractVersion"])) throw new ConnectionError("invalid_request");
  } else if (op === "prepare_encrypted") {
    if (
      !exact(json, [
        "contractVersion",
        "taskIds",
        "connectionId",
        "approvedScopes",
        "historyPolicy",
      ]) ||
      !Array.isArray(json.taskIds) ||
      json.taskIds.length !== 1 ||
      !json.taskIds.every(identifier) ||
      !(json.connectionId === null || identifier(json.connectionId)) ||
      !Array.isArray(json.approvedScopes) ||
      json.approvedScopes.length < 1 ||
      json.approvedScopes.length > AGENT_SCOPES.length ||
      new Set(json.approvedScopes).size !== json.approvedScopes.length ||
      !json.approvedScopes.every((scope) => AGENT_SCOPES.includes(scope)) ||
      json.historyPolicy !== "selected"
    )
      throw new ConnectionError("invalid_request");
  } else if (op === "decision") {
    if (
      !exact(json, ["contractVersion", "decision", "signedGrants"]) ||
      !["approve", "deny", "cancel"].includes(json.decision) ||
      !Array.isArray(json.signedGrants) ||
      (json.decision === "approve"
        ? json.signedGrants.length !== 1
        : json.signedGrants.length !== 0) ||
      !json.signedGrants.every(
        (jws) =>
          exact(jws, ["protected", "payload", "signature"]) &&
          [jws.protected, jws.payload, jws.signature].every(
            (field) => typeof field === "string" && /^[A-Za-z0-9_-]+$/.test(field),
          ),
      )
    )
      throw new ConnectionError("invalid_request");
  } else throw new ConnectionError("invalid_request");
}
type Waiter = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  cancel?: () => void;
};
export class OwnerConsentBridge {
  private closed = false;
  private serial = 0;
  private pending = new Map<string, Waiter>();
  constructor(
    private readonly port: MessagePort,
    readonly requestId: string,
    readonly hubOrigin: string,
  ) {
    port.onmessage = ({ data }: MessageEvent) => {
      if (this.closed) return;
      if (
        !exact(data, ["id", "ok", "data"]) ||
        typeof data.id !== "string" ||
        typeof data.ok !== "boolean" ||
        byteSize(data) > 131072
      ) {
        this.close();
        return;
      }
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      clearTimeout(entry.timer);
      if (entry.cancel) entry.signal?.removeEventListener("abort", entry.cancel);
      if (data.ok) entry.resolve(data.data);
      else
        entry.reject(
          new ConnectionError(
            exact(data.data, ["code"]) &&
              [
                "session_expired",
                "insufficient_scope",
                "not_found",
                "version_conflict",
                "source_unavailable",
                "authorization_unavailable",
                "stale_key_epoch",
              ].includes(data.data.code)
              ? data.data.code
              : "request_failed",
          ),
        );
    };
    port.onmessageerror = () => this.close();
    port.start();
  }
  isLive() {
    return !this.closed;
  }
  async request(
    op: ConsentOperation,
    json: unknown,
    authorization: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    validateConsentCommand(op, json);
    if (
      !brands.has(this) ||
      this.closed ||
      signal?.aborted ||
      typeof authorization !== "string" ||
      authorization.length > 16384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)
    )
      throw new ConnectionError("cancelled");
    if (this.pending.size >= 1) throw new ConnectionError("request_busy");
    const id = `owner_${++this.serial}`,
      packet = {
        id,
        profile: OWNER_BRIDGE_PROFILE,
        requestId: this.requestId,
        op,
        authorization,
        json,
      };
    if (byteSize(packet) > 131072) throw new ConnectionError("invalid_request");
    return await new Promise((resolve, reject) => {
      const cancel = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        signal?.removeEventListener("abort", cancel);
        reject(new ConnectionError(signal?.aborted ? "cancelled" : "request_timeout"));
      };
      const entry = { resolve, reject, timer: setTimeout(cancel, 30_000), signal, cancel };
      this.pending.set(id, entry);
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        this.port.postMessage(packet);
      } catch {
        cancel();
      }
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      if (entry.cancel) entry.signal?.removeEventListener("abort", entry.cancel);
      entry.reject(new ConnectionError("cancelled"));
    }
    this.pending.clear();
    this.port.close();
  }
}
export const verifiedOwnerBridge = (value: unknown): value is OwnerConsentBridge =>
  Boolean(
    value &&
    typeof value === "object" &&
    brands.has(value) &&
    (value as OwnerConsentBridge).isLive(),
  );

/** Only the actual opener or the explicitly opened Hub request can transfer the owner port. */
export function connectOwnerConsentBridge(
  handoff: ConsentHandoff,
  hubOrigin: string,
  signal?: AbortSignal,
): Promise<OwnerConsentBridge> {
  const destination = destinations.get(handoff);
  const opener = routed.has(handoff) ? destination?.peer : window.opener;
  if (
    !identifier(handoff.requestId) ||
    !TOKEN.test(handoff.nonce) ||
    !HUB_ORIGIN.test(hubOrigin) ||
    (routed.has(handoff) && destination?.origin !== hubOrigin) ||
    !opener ||
    opener.closed ||
    signal?.aborted
  )
    return Promise.reject(new ConnectionError("invalid_handoff"));
  return new Promise((resolve, reject) => {
    const finish = () => {
      window.removeEventListener("message", message);
      signal?.removeEventListener("abort", cancel);
      clearTimeout(timer);
    };
    const cancel = () => {
      finish();
      reject(new ConnectionError(signal?.aborted ? "cancelled" : "request_timeout"));
    };
    const message = (event: MessageEvent) => {
      if (
        !event.isTrusted ||
        event.origin !== hubOrigin ||
        event.source !== opener ||
        !exact(event.data, ["type", "profile", "requestId", "nonce"]) ||
        event.data.type !== "fv-owner-consent-attached" ||
        event.data.profile !== OWNER_BRIDGE_PROFILE ||
        event.data.requestId !== handoff.requestId ||
        event.data.nonce !== handoff.nonce ||
        event.ports.length !== 1 ||
        !(event.ports[0] instanceof MessagePort)
      )
        return;
      finish();
      // The helper popup must not be able to traverse Web.opener back into the
      // transient Hub consent window where owner-only requests are processed.
      try {
        window.opener = null;
      } catch {
        event.ports[0].close();
        reject(new ConnectionError("invalid_handoff"));
        return;
      }
      if (window.opener !== null) {
        event.ports[0].close();
        reject(new ConnectionError("invalid_handoff"));
        return;
      }
      const bridge = new OwnerConsentBridge(event.ports[0], handoff.requestId, hubOrigin);
      brands.add(bridge);
      resolve(bridge);
    };
    const timer = setTimeout(cancel, 30_000);
    window.addEventListener("message", message);
    signal?.addEventListener("abort", cancel, { once: true });
    opener.postMessage(
      { type: "fv-owner-consent-ready", requestId: handoff.requestId, nonce: handoff.nonce },
      hubOrigin,
    );
  });
}
