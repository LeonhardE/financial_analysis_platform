/** Same-browser owner convenience channel. Not a remote Muse transport. */
import { ControllerDenied, reject, exact, identifier, bounded } from "./controller.mjs";
export const OWNER_HELPER_PROFILE = "folioview.foreground-owner.v1";
export class OwnerHelperBridge {
  #host;
  #ownerWindow;
  #origin;
  #nonce;
  #port;
  #controller;
  #used = false;
  #closed = false;
  #busy = false;
  #seen = new Set();
  #lease;
  #poll;
  #notify;
  constructor({ host = window, config, controller, ownerOrigin, nonce, onState = () => {} }) {
    if (
      host.top !== host ||
      !host.opener ||
      !config.ownerOrigins.includes(ownerOrigin) ||
      typeof nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
      config.issuer !== host.location.origin
    )
      reject("invalid_owner_pairing");
    this.#host = host;
    this.#ownerWindow = host.opener;
    this.#origin = ownerOrigin;
    this.#nonce = nonce;
    this.#controller = controller;
    this.#notify = onState;
    host.addEventListener("message", this.#message);
    host.addEventListener("pagehide", this.#pagehide);
    this.#poll = setInterval(() => {
      if (this.#ownerWindow?.closed) this.close("owner_closed");
    }, 1000);
    this.#touch();
    this.#ownerWindow.postMessage(
      { type: "fv-helper-owner-ready", profile: OWNER_HELPER_PROFILE, nonce },
      ownerOrigin,
    );
  }
  #touch() {
    clearTimeout(this.#lease);
    this.#lease = setTimeout(() => this.close("owner_heartbeat_expired"), 90000);
  }
  #pagehide = () => this.close("page_closed");
  #message = (event) => {
    if (event.isTrusted !== true) return;
    if (
      this.#closed ||
      this.#used ||
      event.source !== this.#ownerWindow ||
      event.origin !== this.#origin
    )
      return;
    try {
      exact(event.data, ["type", "profile", "nonce"]);
      if (
        event.data.type !== "fv-helper-owner-attached" ||
        event.data.profile !== OWNER_HELPER_PROFILE ||
        event.data.nonce !== this.#nonce ||
        event.ports?.length !== 1
      )
        return;
    } catch {
      return;
    }
    this.#used = true;
    // Keep the trusted peer only in this private closure; the model page must
    // not retain an opener chain to the owner or transient OAuth-cookie shell.
    try {
      this.#host.opener = null;
    } catch {}
    this.#port = event.ports[0];
    this.#port.onmessage = ({ data }) => {
      void this.#handle(data);
    };
    this.#port.onmessageerror = () => this.close("owner_disconnected");
    this.#port.start();
    this.#notify("owner_attached");
  };
  async #handle(message) {
    let id = "invalid",
      held = false;
    try {
      if (this.#closed || this.#busy) reject("owner_channel_busy");
      bounded(message, 131072);
      exact(message, ["id", "profile", "op", "args"]);
      id = identifier(message.id);
      if (
        message.profile !== OWNER_HELPER_PROFILE ||
        !["initialize", "confirm_delivery", "status", "lock"].includes(message.op) ||
        this.#seen.has(id) ||
        this.#seen.size >= 256
      )
        reject("unsupported_operation");
      if (message.op === "initialize")
        exact(message.args, ["helperVersion", "workerSha256", "anchor", "ttlSeconds"]);
      else exact(message.args, message.op === "confirm_delivery" ? ["pin"] : []);
      this.#seen.add(id);
      this.#busy = true;
      held = true;
      this.#touch();
      let data;
      if (message.op === "initialize") data = await this.#controller.initialize(message.args);
      else if (message.op === "confirm_delivery")
        data = await this.#controller.confirmDelivery(message.args);
      else if (message.op === "status") data = this.#controller.status();
      else {
        this.#controller.lock();
        data = this.#controller.status();
      }
      if (this.#closed) return;
      this.#port.postMessage({ id, ok: true, data });
      if (message.op === "lock") this.close("owner_locked");
    } catch (error) {
      if (!this.#closed)
        this.#port?.postMessage({
          id,
          ok: false,
          data: { code: error instanceof ControllerDenied ? error.code : "owner_operation_failed" },
        });
    } finally {
      if (held) this.#busy = false;
    }
  }
  close(reason = "owner_disconnected") {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#lease);
    clearInterval(this.#poll);
    this.#host.removeEventListener("message", this.#message);
    this.#host.removeEventListener("pagehide", this.#pagehide);
    this.#port?.close();
    this.#port = undefined;
    this.#ownerWindow = undefined;
    this.#controller.lock(reason);
    this.#notify(reason);
  }
}
