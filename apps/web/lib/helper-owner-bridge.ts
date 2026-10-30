import { ConnectionError, exact, identifier } from "./agent-connections";

export const HELPER_OWNER_PROFILE = "folioview.foreground-owner.v1";
// Pinned to the reviewed 1.2.0 release in the repository, not to a Hub HTTP response.
export const HELPER_WORKER_SHA256 =
  "930519d391fb3aafc489ab449c50da18991d32a64ff3039a99fa0edf84cd513c";
export const HELPER_VERSION = "1.2.0";
export type HelperOwnerOperation = "initialize" | "confirm_delivery" | "status" | "lock";
const size = (value: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Infinity;
  }
};
const noncePattern = /^[A-Za-z0-9_-]{43}$/;
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 1;
export function validateHelperOwnerCommand(op: HelperOwnerOperation, args: unknown) {
  if (size(args) > 131072) throw new ConnectionError("invalid_request");
  if (op === "status" || op === "lock") {
    if (!exact(args, [])) throw new ConnectionError("invalid_request");
    return;
  }
  if (op === "initialize") {
    if (
      !exact(args, ["helperVersion", "workerSha256", "anchor", "ttlSeconds"]) ||
      args.helperVersion !== HELPER_VERSION ||
      args.workerSha256 !== HELPER_WORKER_SHA256 ||
      !Number.isSafeInteger(args.ttlSeconds) ||
      args.ttlSeconds < 60 ||
      args.ttlSeconds > 3600 ||
      !exact(args.anchor, [
        "ownerSubject",
        "vaultId",
        "rootJwk",
        "rootKeyId",
        "rootEpoch",
        "registrySequence",
        "checkpointDigest",
        "connectionId",
        "agentPrincipalId",
        "taskId",
      ]) ||
      ![
        args.anchor.vaultId,
        args.anchor.connectionId,
        args.anchor.agentPrincipalId,
        args.anchor.taskId,
      ].every(identifier) ||
      !noncePattern.test(args.anchor.ownerSubject) ||
      !noncePattern.test(args.anchor.rootKeyId) ||
      !positive(args.anchor.rootEpoch) ||
      !positive(args.anchor.registrySequence) ||
      !/^[a-f0-9]{64}$/.test(args.anchor.checkpointDigest) ||
      !exact(args.anchor.rootJwk, ["kty", "crv", "x", "y"]) ||
      args.anchor.rootJwk.kty !== "EC" ||
      args.anchor.rootJwk.crv !== "P-256" ||
      ![args.anchor.rootJwk.x, args.anchor.rootJwk.y].every(
        (value) => typeof value === "string" && noncePattern.test(value),
      )
    )
      throw new ConnectionError("invalid_request");
    return;
  }
  if (op === "confirm_delivery") {
    if (
      !exact(args, ["pin"]) ||
      !exact(args.pin, [
        "preparationId",
        "taskVersion",
        "taskEnvelopeFingerprint",
        "taskDeliveryFingerprint",
        "objects",
        "deliveryRevision",
        "priorEnvelopeFingerprint",
        "authorizationId",
        "grantId",
        "grantEpoch",
        "executionEpoch",
      ]) ||
      ![args.pin.preparationId, args.pin.authorizationId, args.pin.grantId].every(identifier) ||
      ![
        args.pin.taskVersion,
        args.pin.deliveryRevision,
        args.pin.grantEpoch,
        args.pin.executionEpoch,
      ].every(positive) ||
      ![args.pin.taskEnvelopeFingerprint, args.pin.taskDeliveryFingerprint].every(
        (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
      ) ||
      !(
        args.pin.priorEnvelopeFingerprint === null ||
        (typeof args.pin.priorEnvelopeFingerprint === "string" &&
          /^[a-f0-9]{64}$/.test(args.pin.priorEnvelopeFingerprint))
      ) ||
      !Array.isArray(args.pin.objects) ||
      args.pin.objects.length < 1 ||
      args.pin.objects.length > 11
    )
      throw new ConnectionError("invalid_request");
    const ids: string[] = [];
    for (const object of args.pin.objects) {
      if (
        !exact(object, ["objectId", "envelopeFingerprint"]) ||
        !identifier(object.objectId) ||
        !/^[a-f0-9]{64}$/.test(object.envelopeFingerprint)
      )
        throw new ConnectionError("invalid_request");
      ids.push(object.objectId);
    }
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id, index) => index > 0 && ids[index - 1] >= id)
    )
      throw new ConnectionError("invalid_request");
    return;
  }
  throw new ConnectionError("invalid_request");
}
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  cancel: () => void;
  signal?: AbortSignal;
};
export class HelperOwnerBridge {
  private closed = false;
  private serial = 0;
  private pending = new Map<string, Pending>();
  private monitor: ReturnType<typeof setInterval>;
  constructor(
    private readonly port: MessagePort,
    private readonly popup: Window,
  ) {
    port.onmessage = ({ data }: MessageEvent) => {
      if (this.closed) return;
      if (
        !exact(data, ["id", "ok", "data"]) ||
        typeof data.id !== "string" ||
        typeof data.ok !== "boolean" ||
        size(data) > 131072
      ) {
        this.close();
        return;
      }
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener("abort", entry.cancel);
      if (data.ok) entry.resolve(data.data);
      else entry.reject(new ConnectionError("helper_rejected"));
    };
    port.onmessageerror = () => this.close();
    port.start();
    this.monitor = setInterval(() => {
      if (popup.closed) this.close();
    }, 1000);
  }
  isLive() {
    return !this.closed && !this.popup.closed;
  }
  async request(op: HelperOwnerOperation, args: unknown, signal?: AbortSignal): Promise<unknown> {
    validateHelperOwnerCommand(op, args);
    if (!this.isLive() || signal?.aborted) throw new ConnectionError("cancelled");
    if (this.pending.size >= 1) throw new ConnectionError("request_busy");
    const id = `helper_${++this.serial}`;
    return await new Promise((resolve, reject) => {
      const cancel = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        signal?.removeEventListener("abort", cancel);
        reject(new ConnectionError(signal?.aborted ? "cancelled" : "request_timeout"));
      };
      this.pending.set(id, { resolve, reject, cancel, signal, timer: setTimeout(cancel, 30_000) });
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        this.port.postMessage({ id, profile: HELPER_OWNER_PROFILE, op, args });
      } catch {
        cancel();
      }
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.monitor);
    try {
      this.port.postMessage({
        id: `helper_${++this.serial}`,
        profile: HELPER_OWNER_PROFILE,
        op: "lock",
        args: {},
      });
    } catch {}
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener("abort", entry.cancel);
      entry.reject(new ConnectionError("cancelled"));
    }
    this.pending.clear();
    this.port.close();
    if (!this.popup.closed) this.popup.close();
  }
}
/** Must be invoked from an explicit user click so the browser can open its own helper window. */
export function openHelperOwnerBridge(
  hubOrigin: string,
  signal?: AbortSignal,
): Promise<HelperOwnerBridge> {
  if (
    !/^https:\/\/agent-hub-api-[0-9]{1,20}\.[a-z]+(?:-[a-z0-9]+)+[0-9]\.run\.app$/.test(
      hubOrigin,
    ) ||
    signal?.aborted
  )
    return Promise.reject(new ConnectionError("invalid_handoff"));
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const url = new URL("/agent/v2/helper/controller.html", hubOrigin);
  url.searchParams.set("owner_nonce", nonce);
  url.searchParams.set("owner_origin", window.location.origin);
  const popup = window.open(url.toString(), "_blank", "popup,width=780,height=850");
  if (!popup) return Promise.reject(new ConnectionError("popup_blocked"));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", message);
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      cleanup();
      if (!popup.closed) popup.close();
      reject(new ConnectionError(signal?.aborted ? "cancelled" : "request_timeout"));
    };
    const message = (event: MessageEvent) => {
      if (
        !event.isTrusted ||
        event.source !== popup ||
        event.origin !== hubOrigin ||
        !exact(event.data, ["type", "profile", "nonce"]) ||
        event.data.type !== "fv-helper-owner-ready" ||
        event.data.profile !== HELPER_OWNER_PROFILE ||
        event.data.nonce !== nonce ||
        event.ports.length
      )
        return;
      cleanup();
      const channel = new MessageChannel();
      popup.postMessage(
        { type: "fv-helper-owner-attached", profile: HELPER_OWNER_PROFILE, nonce },
        hubOrigin,
        [channel.port2],
      );
      resolve(new HelperOwnerBridge(channel.port1, popup));
    };
    const timer = setTimeout(cancel, 30_000);
    window.addEventListener("message", message);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
