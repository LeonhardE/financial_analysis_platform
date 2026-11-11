/** Only exact native account-link operations may use the transient owner credential. */
export const ACCOUNT_BRIDGE = "folioview.native-account-bridge.v1";
const CONTRACT = "folioview.agent-workspace.v2.0";
export class AccountBridgeDenied extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const deny = (code) => {
  throw new AccountBridgeDenied(code);
};
function exact(v, fields) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join("\0") !== [...fields].sort().join("\0")
  )
    deny("invalid_message");
}
function id(v) {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))
    deny("invalid_message");
  return v;
}
export function checkedNativeCallback(value, config, clientId) {
  if (typeof value !== "string" || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value))
    deny("invalid_callback");
  const u = new URL(value),
    client = config.clients.find((c) => c.clientId === clientId);
  if (
    !client ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    !client.redirectUris.includes(u.origin + u.pathname) ||
    [...u.searchParams.keys()].sort().join(",") !== "code,iss,state" ||
    u.searchParams.get("iss") !== config.issuer + "/oauth/persistent" ||
    !u.searchParams.get("code") ||
    !u.searchParams.get("state")
  )
    deny("invalid_callback");
  return u.href;
}
async function json(response, signal) {
  if (!response.headers.get("content-type")?.startsWith("application/json") || !response.body)
    deny("invalid_response");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const p = await reader.read();
      if (signal.aborted) deny("bridge_closed");
      if (p.done) break;
      size += p.value.length;
      if (size > 32768) deny("invalid_response");
      chunks.push(p.value);
    }
    const bytes = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class NativeAccountBridge {
  #host;
  #config;
  #request;
  #nonce;
  #peer;
  #origin;
  #port;
  #attached = false;
  #closed = false;
  #busy = false;
  #seen = new Set();
  #client = null;
  #fetch;
  #navigate;
  #notify;
  #controller;
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
      config?.contractVersion !== CONTRACT ||
      config.accountLinkVersion !== "1.0.0" ||
      config.issuer !== host.location.origin ||
      !Array.isArray(config.ownerOrigins) ||
      config.ownerOrigins.length < 1 ||
      config.ownerOrigins.length > 8 ||
      !Array.isArray(config.clients)
    )
      deny("invalid_configuration");
    for (const origin of config.ownerOrigins) {
      const u = new URL(origin);
      if (
        u.origin !== origin ||
        !["https:", "http:"].includes(u.protocol) ||
        (u.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
      )
        deny("invalid_configuration");
    }
    this.#config = config;
    this.#request = id(requestId);
    this.#host = host;
    this.#fetch = (...args) => fetchImpl(...args);
    this.#navigate = navigate;
    this.#notify = onState;
    this.#nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    host.addEventListener("message", this.#message);
    host.addEventListener("pagehide", this.#hide);
    this.#timer = setTimeout(() => this.close(), 1800000);
  }
  open(ownerOrigin) {
    if (this.#closed || this.#peer || !this.#config.ownerOrigins.includes(ownerOrigin))
      deny("invalid_owner_origin");
    const u = new URL("/agents", ownerOrigin);
    u.searchParams.set("native_request", this.#request);
    u.searchParams.set("native_nonce", this.#nonce);
    this.#origin = ownerOrigin;
    this.#peer = this.#host.open(u.href, "_blank");
    if (!this.#peer) deny("popup_blocked");
    this.#poll = setInterval(() => {
      if (this.#peer.closed) this.close();
    }, 1000);
    this.#notify("owner_opened");
  }
  #hide = () => this.close();
  #message = (event) => {
    if (
      event.isTrusted !== true ||
      this.#closed ||
      this.#attached ||
      event.source !== this.#peer ||
      event.origin !== this.#origin ||
      event.ports?.length
    )
      return;
    try {
      exact(event.data, ["type", "requestId", "nonce"]);
      if (
        event.data.type !== "fv-native-owner-ready" ||
        event.data.requestId !== this.#request ||
        event.data.nonce !== this.#nonce
      )
        return;
    } catch {
      return;
    }
    const channel = new MessageChannel();
    this.#port = channel.port1;
    this.#attached = true;
    this.#port.onmessage = ({ data }) => {
      void this.#handle(data);
    };
    this.#port.start();
    this.#peer.postMessage(
      {
        type: "fv-native-owner-attached",
        profile: ACCOUNT_BRIDGE,
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
      held = false;
    try {
      if (this.#closed || this.#busy) deny("bridge_busy");
      if (new TextEncoder().encode(JSON.stringify(value)).length > 24576) deny("payload_too_large");
      exact(value, ["id", "profile", "requestId", "op", "authorization", "json"]);
      callId = id(value.id);
      if (
        value.profile !== ACCOUNT_BRIDGE ||
        value.requestId !== this.#request ||
        !["pending", "approve"].includes(value.op) ||
        typeof value.authorization !== "string" ||
        value.authorization.length > 16384 ||
        !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(value.authorization) ||
        this.#seen.has(callId) ||
        this.#seen.size >= 32
      )
        deny("invalid_message");
      exact(
        value.json,
        value.op === "pending" ? ["contractVersion"] : ["contractVersion", "vaultId"],
      );
      if (value.json.contractVersion !== CONTRACT) deny("unsupported_contract");
      if (value.op === "approve") {
        id(value.json.vaultId);
        if (!this.#client) deny("pending_required");
      }
      this.#seen.add(callId);
      this.#busy = true;
      held = true;
      this.#controller = new AbortController();
      const timeout = setTimeout(() => this.#controller?.abort(), 20000);
      let result;
      try {
        const path =
          "/api/v2/persistent-account-authorizations/" +
          this.#request +
          (value.op === "approve" ? "/approvals" : "/pending");
        const response = await this.#fetch(path, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: this.#controller.signal,
          headers: {
            Authorization: "Bearer " + value.authorization,
            "Content-Type": "application/json",
            "X-FolioView-Contract": CONTRACT,
          },
          body: JSON.stringify(value.json),
        });
        value.authorization = "";
        if (!response.ok)
          deny(response.status === 401 ? "session_expired" : "account_link_unavailable");
        result = await json(response, this.#controller.signal);
      } finally {
        clearTimeout(timeout);
        value.authorization = "";
      }
      if (this.#closed) deny("bridge_closed");
      if (value.op === "pending") {
        if (
          (Object.hasOwn(result, "provider") && !["muse", "chatgpt"].includes(result.provider)) ||
          result.contractVersion !== CONTRACT ||
          result.profile !== "folioview.persistent-account.v1" ||
          result.requestId !== this.#request ||
          result.scope !== "runtime:connect" ||
          result.authority !== "account_link_only" ||
          !this.#config.clients.some((c) => c.clientId === result.clientId)
        )
          deny("invalid_response");
        this.#client = result.clientId;
        this.#port.postMessage({ id: callId, ok: true, value: result });
      } else {
        const callback = checkedNativeCallback(result.redirectTo, this.#config, this.#client);
        this.#port.postMessage({
          id: callId,
          ok: true,
          value: { state: "connected", authority: "account_link_only" },
        });
        this.#notify("connected");
        this.#navigate(callback);
        this.close();
      }
    } catch (error) {
      if (!this.#closed)
        this.#port?.postMessage({
          id: callId,
          ok: false,
          error: error instanceof AccountBridgeDenied ? error.code : "account_link_unavailable",
        });
    } finally {
      if (held) this.#busy = false;
      this.#controller = null;
      if (value && typeof value === "object" && "authorization" in value) value.authorization = "";
    }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#controller?.abort();
    clearTimeout(this.#timer);
    clearInterval(this.#poll);
    this.#host.removeEventListener("message", this.#message);
    this.#host.removeEventListener("pagehide", this.#hide);
    this.#port?.close();
    this.#notify("closed");
  }
}
