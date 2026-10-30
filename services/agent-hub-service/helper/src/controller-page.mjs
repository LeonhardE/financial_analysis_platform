/** Fixed foreground helper page. No authentication-token or private-key input. */
import { ForegroundController, ControllerDenied } from "./controller.mjs";
import { OwnerHelperBridge } from "./owner-helper.mjs";
const doc = document,
  host = window,
  status = doc.getElementById("status"),
  output = doc.getElementById("output"),
  offer = doc.getElementById("public-offer");
let controller, ownerBridge;
const showState = (state) => {
  if (state.state === "LOCKED") {
    output.textContent = "";
    offer.textContent = "";
    doc.getElementById("agent-args").value = "";
  }
  status.textContent =
    state.state === "LOCKED"
      ? "Locked. Private key handles were discarded. Pending encrypted operations stay on this device."
      : state.state === "READY"
        ? "Foreground session active. Agent access still requires your FolioView approval and exact encrypted delivery."
        : "Waiting for independent owner setup.";
};
const failure = (error) => {
  status.textContent = `Operation refused: ${error instanceof ControllerDenied ? error.code : "controller_rejected"}.`;
};
const freshController = () =>
  new ForegroundController({
    issuer: host.location.origin,
    developmentLoopback: ["localhost", "127.0.0.1", "[::1]"].includes(host.location.hostname),
    onState: showState,
  });
async function start() {
  try {
    if (host.top !== host || host.location.hash) throw new ControllerDenied("top_level_required");
    const query = new URLSearchParams(host.location.search),
      paired = query.has("owner_nonce") || query.has("owner_origin");
    if (paired) {
      if ([...query.keys()].sort().join() !== "owner_nonce,owner_origin")
        throw new ControllerDenied("invalid_owner_pairing");
      doc.getElementById("manual-owner").remove();
      const abort = new AbortController(),
        timeout = setTimeout(() => abort.abort(), 10000);
      let config;
      try {
        const response = await fetch("/agent/v2/controller/config", {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: abort.signal,
        });
        if (!response.ok) throw new ControllerDenied("configuration_unavailable");
        const text = await response.text();
        if (new TextEncoder().encode(text).length > 32768)
          throw new ControllerDenied("invalid_configuration");
        config = JSON.parse(text);
      } finally {
        clearTimeout(timeout);
      }
      controller = freshController();
      ownerBridge = new OwnerHelperBridge({
        config,
        controller,
        ownerOrigin: query.get("owner_origin"),
        nonce: query.get("owner_nonce"),
        onState: (state) => {
          if (state !== "owner_attached") {
            output.textContent = "";
            offer.textContent = "";
            status.textContent = "The owner connection closed. Start a new foreground session.";
          }
        },
      });
      status.textContent =
        "Waiting for your paired FolioView window. Keep both windows open; private views are hidden when this helper is in the background.";
    } else {
      if ([...query.keys()].length) throw new ControllerDenied("invalid_owner_pairing");
      doc.getElementById("initialize").addEventListener("click", async () => {
        try {
          if (controller && controller.status().state !== "LOCKED")
            throw new ControllerDenied("session_already_initialized");
          controller = freshController();
          const value = await controller.initialize(
            JSON.parse(doc.getElementById("owner-card").value),
          );
          offer.textContent = JSON.stringify(value, null, 2);
        } catch (error) {
          failure(error);
        }
      });
      doc.getElementById("confirm-delivery").addEventListener("click", async () => {
        try {
          if (!controller) throw new ControllerDenied("owner_setup_required");
          await controller.confirmDelivery({
            pin: JSON.parse(doc.getElementById("delivery-pin").value),
          });
        } catch (error) {
          failure(error);
        }
      });
    }
    doc.getElementById("copy-offer").addEventListener("click", async () => {
      try {
        if (!controller) throw new ControllerDenied("owner_setup_required");
        await navigator.clipboard.writeText(JSON.stringify(controller.publicOffer()));
        status.textContent =
          "Public key offer copied. Review it in your signed-in FolioView window.";
      } catch (error) {
        failure(error);
      }
    });
    doc.getElementById("show-offer").addEventListener("click", () => {
      try {
        offer.textContent = JSON.stringify(controller.publicOffer(), null, 2);
      } catch (error) {
        failure(error);
      }
    });
    doc.getElementById("agent-run").addEventListener("click", async () => {
      try {
        if (!controller) throw new ControllerDenied("owner_setup_required");
        const op = doc.getElementById("agent-operation").value,
          args = JSON.parse(doc.getElementById("agent-args").value || "{}");
        const value = await controller.dispatchAgent({ op, args });
        if (doc.visibilityState === "hidden") return;
        output.textContent = JSON.stringify(value, null, 2);
        if (["sealResult", "reviseResult"].includes(op)) {
          doc.getElementById("agent-args").value = "";
          status.textContent =
            "Original encrypted result saved to this device's outbox. This page has NOT verified a server save. Use the authenticated agent API; receipt/revision confirmation needs a trusted authenticated host.";
        }
      } catch (error) {
        failure(error);
      }
    });
    doc.getElementById("lock").addEventListener("click", () => {
      ownerBridge?.close("user_locked");
      controller?.lock();
      output.textContent = "";
      offer.textContent = "";
    });
    doc.addEventListener("visibilitychange", () => {
      controller?.setVisible(doc.visibilityState !== "hidden");
      if (doc.visibilityState === "hidden") {
        output.textContent = "";
        doc.getElementById("agent-args").value = "";
      }
    });
    host.addEventListener("pagehide", () => {
      ownerBridge?.close("page_closed");
      controller?.lock();
      output.textContent = "";
      offer.textContent = "";
    });
  } catch (error) {
    failure(error);
    doc.getElementById("agent-run").disabled = true;
  }
}
void start();
