/** A fresh Google credential goes only to the original cookie-bound first-party Hub window. */
import { exact, identifier, ConnectionError } from "./agent-connections";
const PROFILE = "folioview.native-account-bridge.v1",
  CONTRACT = "folioview.agent-workspace.v2.0";
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const brands = new WeakSet<object>();
export type NativeOperation = "pending" | "approve";
export type NativeHandoff = { requestId: string; nonce: string };
export function nativeHandoff(search: string): NativeHandoff | null {
  const q = new URLSearchParams(search);
  if (!q.has("native_request") && !q.has("native_nonce")) return null;
  if (
    q.size !== 2 ||
    q.getAll("native_request").length !== 1 ||
    q.getAll("native_nonce").length !== 1 ||
    !identifier(q.get("native_request")) ||
    !NONCE.test(q.get("native_nonce") ?? "")
  )
    throw new ConnectionError("invalid_handoff");
  return { requestId: q.get("native_request")!, nonce: q.get("native_nonce")! };
}
export function validateNativeCommand(op: NativeOperation, v: unknown) {
  if (
    !exact(
      v,
      op === "pending"
        ? ["contractVersion"]
        : op === "approve"
          ? ["contractVersion", "vaultId"]
          : [],
    ) ||
    v.contractVersion !== CONTRACT ||
    (op === "approve" && !identifier(v.vaultId))
  )
    throw new ConnectionError("invalid_request");
}
export class NativeOwnerBridge {
  private closed = false;
  private serial = 0;
  private pending: {
    id: string;
    op: NativeOperation;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
    cancel: () => void;
    cleanup: () => void;
  } | null = null;
  constructor(
    private readonly port: MessagePort,
    readonly requestId: string,
    readonly hubOrigin: string,
  ) {
    port.onmessage = ({ data }: MessageEvent) => {
      if (this.closed) return;
      if (
        !data ||
        typeof data !== "object" ||
        typeof data.id !== "string" ||
        typeof data.ok !== "boolean" ||
        !exact(data, data.ok ? ["id", "ok", "value"] : ["id", "ok", "error"]) ||
        new TextEncoder().encode(JSON.stringify(data)).byteLength > 32768
      ) {
        this.close();
        return;
      }
      const p = this.pending;
      if (!p || p.id !== data.id) return;
      p.cleanup();
      this.pending = null;
      const v = data.value;
      const valid =
        p.op === "approve"
          ? exact(v, ["state", "authority"]) &&
            v.state === "connected" &&
            v.authority === "account_link_only"
          : exact(v, [
              "contractVersion",
              "profile",
              "requestId",
              "clientId",
              ...(Object.hasOwn(v, "provider") ? ["provider"] : []),
              "scope",
              "status",
              "expiresAt",
              "vaultId",
              "authority",
            ]) &&
            v.contractVersion === CONTRACT &&
            v.profile === "folioview.persistent-account.v1" &&
            v.requestId === this.requestId &&
            identifier(v.clientId) &&
            (!Object.hasOwn(v, "provider") || ["muse", "chatgpt"].includes(String(v.provider))) &&
            v.scope === "runtime:connect" &&
            ["pending", "authorized"].includes(v.status) &&
            Number.isSafeInteger(v.expiresAt) &&
            v.expiresAt > 0 &&
            (v.vaultId === null || identifier(v.vaultId)) &&
            v.authority === "account_link_only";
      if (data.ok && valid) p.resolve(v);
      else p.reject(new ConnectionError("request_failed"));
    };
    port.onmessageerror = () => this.close();
    port.start();
  }
  isLive() {
    return !this.closed;
  }
  request(
    op: NativeOperation,
    json: unknown,
    authorization: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    validateNativeCommand(op, json);
    if (
      !verifiedNativeBridge(this) ||
      signal?.aborted ||
      typeof authorization !== "string" ||
      authorization.length > 16384 ||
      !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(authorization)
    )
      return Promise.reject(new ConnectionError("cancelled"));
    if (this.pending) return Promise.reject(new ConnectionError("request_busy"));
    const id = `native_${++this.serial}`;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        if (this.pending?.id !== id) return;
        cleanup();
        this.pending = null;
        reject(new ConnectionError("cancelled"));
      };
      const timer = setTimeout(cancel, 30000);
      this.pending = { id, op, resolve, reject, cancel, cleanup };
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        this.port.postMessage({
          id,
          profile: PROFILE,
          requestId: this.requestId,
          op,
          authorization,
          json,
        });
      } catch {
        cancel();
      }
    });
  }
  close() {
    if (this.closed) return;
    this.pending?.cancel();
    this.closed = true;
    this.port.close();
  }
}
export function verifiedNativeBridge(v: unknown): v is NativeOwnerBridge {
  return !!v && typeof v === "object" && brands.has(v) && (v as NativeOwnerBridge).isLive();
}
export function connectNativeOwnerBridge(
  handoff: NativeHandoff,
  hubOrigin: string,
  signal?: AbortSignal,
): Promise<NativeOwnerBridge> {
  const peer = window.opener;
  if (
    !identifier(handoff.requestId) ||
    !NONCE.test(handoff.nonce) ||
    !/^https:\/\/agent-hub-api-[0-9]{1,20}\.[a-z]+(?:-[a-z0-9]+)+[0-9]\.run\.app$/.test(
      hubOrigin,
    ) ||
    !peer ||
    peer.closed ||
    signal?.aborted
  )
    return Promise.reject(new ConnectionError("invalid_handoff"));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", message);
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      cleanup();
      reject(new ConnectionError("cancelled"));
    };
    const message = (event: MessageEvent) => {
      if (
        !event.isTrusted ||
        event.source !== peer ||
        event.origin !== hubOrigin ||
        !exact(event.data, ["type", "profile", "requestId", "nonce"]) ||
        event.data.type !== "fv-native-owner-attached" ||
        event.data.profile !== PROFILE ||
        event.data.requestId !== handoff.requestId ||
        event.data.nonce !== handoff.nonce ||
        event.ports.length !== 1 ||
        !(event.ports[0] instanceof MessagePort)
      )
        return;
      cleanup();
      try {
        window.opener = null;
        if (window.opener !== null) throw new Error();
      } catch {
        event.ports[0].close();
        reject(new ConnectionError("invalid_handoff"));
        return;
      }
      const bridge = new NativeOwnerBridge(event.ports[0], handoff.requestId, hubOrigin);
      brands.add(bridge);
      resolve(bridge);
    };
    const timer = setTimeout(cancel, 30000);
    window.addEventListener("message", message);
    signal?.addEventListener("abort", cancel, { once: true });
    peer.postMessage(
      { type: "fv-native-owner-ready", requestId: handoff.requestId, nonce: handoff.nonce },
      hubOrigin,
    );
  });
}
