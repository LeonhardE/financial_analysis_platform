/** Same-origin OAuth-cookie bridge. Never a proxy for agent/private-content APIs. */
export const OWNER_BRIDGE_PROFILE = "folioview.owner-consent-bridge.v1";
const CONTRACT = "folioview.agent-workspace.v2.0";
const encoder = new TextEncoder();
export class BridgeDenied extends Error {
  constructor(code = "bridge_rejected") {
    super(code);
    this.code = code;
  }
}
const deny = (code) => {
  throw new BridgeDenied(code);
};
const exact = (value, fields) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")
  )
    deny("invalid_message");
};
const id = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    deny("invalid_message");
  return value;
};
const scopes = new Set([
  "tasks:read",
  "runs:create",
  "runs:read",
  "results:create",
  "results:revise",
  "receipts:read",
  "watchlist:read",
  "channel_follows:read",
  "portfolio:read",
]);
const checkedJson = (op, json) => {
  exact(
    json,
    op === "claim"
      ? ["contractVersion"]
      : op === "prepare_encrypted"
        ? ["contractVersion", "taskIds", "connectionId", "approvedScopes", "historyPolicy"]
        : ["contractVersion", "decision", "signedGrants"],
  );
  if (json.contractVersion !== CONTRACT) deny("unsupported_contract");
  if (op === "prepare_encrypted") {
    if (
      !Array.isArray(json.taskIds) ||
      json.taskIds.length !== 1 ||
      new Set(json.taskIds).size !== json.taskIds.length ||
      (json.connectionId !== null && !id(json.connectionId)) ||
      !Array.isArray(json.approvedScopes) ||
      !json.approvedScopes.length ||
      json.approvedScopes.length > 9 ||
      new Set(json.approvedScopes).size !== json.approvedScopes.length ||
      json.approvedScopes.some((value) => !scopes.has(value)) ||
      json.historyPolicy !== "selected"
    )
      deny("invalid_message");
    json.taskIds.forEach(id);
  } else if (op === "decision") {
    if (
      !["approve", "deny", "cancel"].includes(json.decision) ||
      !Array.isArray(json.signedGrants) ||
      (json.decision === "approve"
        ? json.signedGrants.length !== 1
        : json.signedGrants.length !== 0)
    )
      deny("invalid_message");
    for (const signed of json.signedGrants) {
      exact(signed, ["protected", "payload", "signature"]);
      if (
        Object.values(signed).some(
          (value) => typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value),
        )
      )
        deny("invalid_message");
    }
  }
};
export function checkedCallback(value, config, clientId) {
  if (typeof value !== "string" || value.length > 8192) deny("invalid_redirect");
  let uri;
  try {
    uri = new URL(value);
  } catch {
    deny("invalid_redirect");
  }
  const client = config.clients.find((row) => row.clientId === clientId);
  if (
    !client ||
    uri.protocol !== "https:" ||
    uri.username ||
    uri.password ||
    uri.hash ||
    !client.redirectUris.some((raw) => new URL(raw).href === uri.origin + uri.pathname)
  )
    deny("invalid_redirect");
  const names = [...uri.searchParams.keys()].sort(),
    error = uri.searchParams.has("error");
  if (
    names.join("\0") !==
      (error ? ["error", "iss", "state"] : ["code", "iss", "state"]).join("\0") ||
    uri.searchParams.get("iss") !== config.issuer ||
    !uri.searchParams.get("state") ||
    (error ? uri.searchParams.get("error") !== "access_denied" : !uri.searchParams.get("code"))
  )
    deny("invalid_redirect");
  for (const entry of uri.searchParams.values())
    if (entry.length > 4096 || /[\x00-\x1f\x7f]/.test(entry)) deny("invalid_redirect");
  return uri.href;
}
async function readJson(response, signal, maximum = 1048576) {
  if (
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json" ||
    !response.body
  )
    deny("invalid_response");
  const reader = response.body.getReader(),
    chunks = [];
  let length = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const part = await reader.read();
      if (signal.aborted) deny("bridge_closed");
      if (part.done) break;
      length += part.value.length;
      if (length > maximum) deny("invalid_response");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof BridgeDenied) throw error;
    deny("invalid_response");
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class OwnerConsentBridge {
  #config;
  #window;
  #request;
  #nonce;
  #peer;
  #origin;
  #port;
  #used = false;
  #closed = false;
  #busy = false;
  #requests = new Set();
  #seen = new Set();
  #clientId;
  #fetch;
  #navigate;
  #notify;
  #timer;
  #poll;
  constructor({
    config,
    requestId,
    host = window,
    fetchImpl = fetch,
    navigate = (url) => host.location.assign(url),
    onState = () => {},
  }) {
    if (
      config?.profile !== OWNER_BRIDGE_PROFILE ||
      config.contractVersion !== CONTRACT ||
      config.issuer !== host.location.origin ||
      !Array.isArray(config.ownerOrigins) ||
      !config.ownerOrigins.length ||
      config.ownerOrigins.length > 8 ||
      config.ownerOrigins.some((value) => {
        try {
          const url = new URL(value);
          return url.origin !== value || !["https:", "http:"].includes(url.protocol);
        } catch {
          return true;
        }
      }) ||
      !Array.isArray(config.clients)
    )
      deny("invalid_configuration");
    this.#config = config;
    this.#request = id(requestId);
    this.#window = host;
    this.#fetch = fetchImpl;
    this.#navigate = navigate;
    this.#notify = onState;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    this.#nonce = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    host.addEventListener("message", this.#message);
    host.addEventListener("pagehide", this.#pagehide);
    this.#timer = setTimeout(() => this.close("bridge_expired"), 600000);
  }
  open(ownerOrigin) {
    if (this.#closed || this.#peer || !this.#config.ownerOrigins.includes(ownerOrigin))
      deny("invalid_owner_origin");
    this.#origin = ownerOrigin;
    const url = new URL("/", ownerOrigin);
    url.searchParams.set("agent_request", this.#request);
    url.searchParams.set("agent_nonce", this.#nonce);
    this.#peer = this.#window.open(url.href, "_blank");
    if (!this.#peer) {
      this.#origin = undefined;
      deny("popup_blocked");
    }
    this.#poll = setInterval(() => {
      if (this.#peer?.closed) this.close("owner_closed");
    }, 1000);
    this.#notify("owner_opened");
  }
  #pagehide = () => this.close("bridge_closed");
  #message = (event) => {
    if (event.isTrusted !== true) return;
    if (
      this.#closed ||
      this.#used ||
      !this.#peer ||
      event.source !== this.#peer ||
      event.origin !== this.#origin ||
      event.ports?.length
    )
      return;
    try {
      exact(event.data, ["type", "requestId", "nonce"]);
      if (
        event.data.type !== "fv-owner-consent-ready" ||
        event.data.requestId !== this.#request ||
        event.data.nonce !== this.#nonce
      )
        return;
    } catch {
      return;
    }
    this.#used = true;
    const channel = new MessageChannel();
    this.#port = channel.port1;
    this.#port.onmessage = ({ data }) => {
      void this.#handle(data);
    };
    this.#port.start();
    this.#peer.postMessage(
      {
        type: "fv-owner-consent-attached",
        profile: OWNER_BRIDGE_PROFILE,
        requestId: this.#request,
        nonce: this.#nonce,
      },
      this.#origin,
      [channel.port2],
    );
    this.#notify("owner_attached");
  };
  async #handle(value) {
    let callId = "invalid",
      controller,
      held = false;
    try {
      if (this.#closed || this.#busy) deny("bridge_busy");
      if (encoder.encode(JSON.stringify(value)).length > 131072) deny("payload_too_large");
      exact(value, ["id", "profile", "requestId", "op", "authorization", "json"]);
      callId = id(value.id);
      if (
        value.profile !== OWNER_BRIDGE_PROFILE ||
        value.requestId !== this.#request ||
        !["claim", "prepare_encrypted", "decision"].includes(value.op) ||
        typeof value.authorization !== "string" ||
        value.authorization.length > 16384 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.authorization) ||
        this.#seen.has(callId) ||
        this.#seen.size >= 128
      )
        deny("invalid_message");
      checkedJson(value.op, value.json);
      if (value.op !== "claim" && !this.#clientId) deny("claim_required");
      this.#seen.add(callId);
      this.#busy = true;
      held = true;
      controller = new AbortController();
      this.#requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 20000);
      let result;
      try {
        const path = `/api/v2/agent-authorizations/${this.#request}/${value.op === "prepare_encrypted" ? "prepare-encrypted" : value.op}`;
        const response = await this.#fetch(path, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${value.authorization}`,
            "X-FolioView-Contract": CONTRACT,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(value.json),
        });
        // The credential is used only for this exact first-party request. Never
        // return, persist, log or pass it to the controller's model/agent port.
        value.authorization = "";
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            this.#port.postMessage({
              id: callId,
              ok: false,
              data: { code: response.status === 401 ? "session_expired" : "insufficient_scope" },
            });
            this.close("authorization_denied");
            deny("authorization_denied");
          }
          deny(response.status === 409 ? "version_conflict" : "request_failed");
        }
        result = await readJson(response, controller.signal);
      } finally {
        clearTimeout(timeout);
        value.authorization = "";
      }
      if (this.#closed || controller.signal.aborted || this.#peer?.closed) deny("bridge_closed");
      if (value.op === "decision") {
        exact(result, ["redirectUri"]);
        const destination = checkedCallback(result.redirectUri, this.#config, this.#clientId);
        this.#port.postMessage({ id: callId, ok: true, data: { completed: true } });
        this.#notify("completed");
        this.close("completed");
        this.#navigate(destination);
      } else {
        exact(result, [
          "contractVersion",
          "provider",
          "status",
          "clientId",
          "scopes",
          "connectionId",
          "authorizationId",
          "expiresAt",
          "prepared",
        ]);
        if (
          result.contractVersion !== CONTRACT ||
          result.provider !== "muse" ||
          !this.#config.clients.some((client) => client.clientId === result.clientId) ||
          (this.#clientId && this.#clientId !== result.clientId)
        )
          deny("invalid_response");
        this.#clientId = result.clientId;
        this.#port.postMessage({ id: callId, ok: true, data: result });
      }
    } catch (error) {
      if (value && typeof value === "object") value.authorization = "";
      if (!this.#closed)
        this.#port?.postMessage({
          id: callId,
          ok: false,
          data: { code: error instanceof BridgeDenied ? error.code : "request_failed" },
        });
    } finally {
      if (controller) this.#requests.delete(controller);
      if (held) this.#busy = false;
    }
  }
  close(reason = "bridge_closed") {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    clearInterval(this.#poll);
    for (const request of this.#requests) request.abort();
    this.#requests.clear();
    this.#window.removeEventListener("message", this.#message);
    this.#window.removeEventListener("pagehide", this.#pagehide);
    this.#port?.close();
    this.#port = undefined;
    this.#peer = undefined;
    this.#notify(reason);
  }
}
export async function startConsentPage({
  host = window,
  document: doc = document,
  fetchImpl = fetch,
} = {}) {
  const status = doc.getElementById("status"),
    select = doc.getElementById("owner-origin"),
    button = doc.getElementById("continue");
  const update = (state) => {
    status.textContent =
      {
        owner_opened: "Review the connection in your FolioView window.",
        owner_attached: "Connected to your owner window. Review and approve there.",
        completed: "Decision completed. Returning to Muse…",
        owner_closed: "The owner window closed. Restart the Muse connection to continue.",
        authorization_denied: "Authorization was denied. Restart from Muse and sign in again.",
        bridge_expired: "This request expired. Restart the Muse connection.",
      }[state] ?? "Connection closed. Restart from Muse to continue.";
    if (
      [
        "completed",
        "owner_closed",
        "authorization_denied",
        "bridge_expired",
        "bridge_closed",
      ].includes(state)
    )
      button.disabled = true;
  };
  try {
    if (host.top !== host || host.location.hash) deny("top_level_required");
    const query = new URLSearchParams(host.location.search);
    if ([...query.keys()].join() !== "request") deny("invalid_request");
    const requestId = id(query.get("request"));
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 10000);
    let config;
    try {
      const response = await fetchImpl("/agent/v2/controller/config", {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) deny("configuration_unavailable");
      config = await readJson(response, controller.signal, 32768);
    } finally {
      clearTimeout(timeout);
    }
    const bridge = new OwnerConsentBridge({ config, requestId, host, fetchImpl, onState: update });
    for (const origin of config.ownerOrigins) {
      const option = doc.createElement("option");
      option.value = origin;
      option.textContent = origin;
      select.append(option);
    }
    status.textContent =
      "Continue in your FolioView window to sign in, unlock and review the requested access.";
    button.disabled = false;
    button.addEventListener("click", () => {
      try {
        bridge.open(select.value);
        button.disabled = true;
      } catch {
        status.textContent =
          "Could not open the owner window. Allow this popup and restart the connection.";
      }
    });
    doc.getElementById("cancel").addEventListener("click", () => bridge.close());
  } catch {
    status.textContent =
      "This connection page is unavailable or expired. Return to Muse and restart the connection.";
    button.disabled = true;
  }
}
