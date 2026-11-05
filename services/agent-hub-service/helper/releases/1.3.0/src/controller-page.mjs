/** Fixed foreground helper page. No authentication-token or private-key input. */
import { ForegroundController, ControllerDenied } from "./controller.mjs";
import { OwnerHelperBridge } from "./owner-helper.mjs";
const doc = document,
  host = window,
  status = doc.getElementById("status"),
  output = doc.getElementById("output"),
  offer = doc.getElementById("public-offer");
let controller, ownerBridge, currentRun, reportOperation;
let pageGeneration = 0,
  busy = false;
const reportFields = ["report-title", "report-summary", "report-limits"];
let sectionFields = [];
const clearPrivate = () => {
  doc.getElementById("analysis-inputs").textContent = "";
  for (const id of reportFields) doc.getElementById(id).value = "";
  for (const section of sectionFields) section.input.value = "";
};
const showState = (state) => {
  if (state.state === "LOCKED") {
    pageGeneration++;
    currentRun = reportOperation = null;
    clearPrivate();
    sectionFields = [];
    doc.getElementById("report-sections").replaceChildren();
    doc.getElementById("transport-packet").value = "";
    doc.getElementById("analysis-state").textContent =
      "Session ended. Start a new approved session before reading.";
    doc.getElementById("save-state").textContent =
      "Session ended. Original encrypted retry records remain on this device.";
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
const permittedAction = async (action) => {
  if (busy || !controller || doc.visibilityState === "hidden") return;
  busy = true;
  const active = controller,
    generation = pageGeneration;
  const check = () => {
    if (
      active !== controller ||
      generation !== pageGeneration ||
      active.status().state === "LOCKED" ||
      doc.visibilityState === "hidden"
    )
      throw new ControllerDenied("foreground_required");
  };
  try {
    await action(active, check);
  } catch (error) {
    if (generation === pageGeneration) failure(error);
  } finally {
    busy = false;
  }
};
const operation = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
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
        const response = await fetch("/agent/v2/controller/config/1.3.0", {
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
    doc.getElementById("connect-transport").addEventListener("click", () =>
      permittedAction(async (active, check) => {
        const text = doc.getElementById("transport-packet").value;
        doc.getElementById("transport-packet").value = "";
        if (text.length > 12288) throw new ControllerDenied("invalid_transport");
        await active.connectTransport(JSON.parse(text));
        check();
        doc.getElementById("analysis-state").textContent =
          "Approved session connected. Read the selected task to begin.";
      }),
    );
    doc.getElementById("read-analysis").addEventListener("click", () =>
      permittedAction(async (active, check) => {
        if (currentRun || reportOperation) throw new ControllerDenied("analysis_already_started");
        clearPrivate();
        const prepared = await active.loadPreparation();
        check();
        for (const descriptor of prepared.objects) {
          await active.readPreparedObject(descriptor.objectId);
          check();
        }
        const result = await active.beginRun(operation("analysis"));
        check();
        currentRun = result.run.runId;
        const pages = [],
          seen = new Set();
        let cursor = null;
        do {
          if (pages.length >= 16 || (cursor !== null && seen.has(cursor)))
            throw new ControllerDenied("invalid_response");
          seen.add(cursor);
          const page = await active.readRunPage(currentRun, cursor);
          check();
          pages.push(page);
          cursor = page.nextCursor;
        } while (cursor !== null);
        const sections = pages.find((page) => page.componentIndex === 0)?.payload?.outputSpec
          ?.sections;
        if (!Array.isArray(sections) || !sections.length || sections.length > 8)
          throw new ControllerDenied("invalid_response");
        doc.getElementById("report-sections").replaceChildren();
        sectionFields = sections.map((section, index) => {
          const label = doc.createElement("label"),
            input = doc.createElement("textarea");
          input.id = `report-section-${index}`;
          input.maxLength = 16384;
          input.autocomplete = "off";
          label.htmlFor = input.id;
          label.textContent = `Section ${index + 1}`;
          doc.getElementById("report-sections").append(label, input);
          return { sectionId: section.sectionId, input };
        });
        doc.getElementById("analysis-inputs").textContent = JSON.stringify(pages, null, 2);
        doc.getElementById("analysis-state").textContent =
          "Approved frozen task and resources are ready. Read them and write the report below.";
      }),
    );
    doc.getElementById("save-analysis").addEventListener("click", () =>
      permittedAction(async (active, check) => {
        if (!currentRun || reportOperation) throw new ControllerDenied("run_required");
        const content = {
          title: doc.getElementById("report-title").value,
          summary: doc.getElementById("report-summary").value,
          sections: sectionFields.map((section) => ({
            sectionId: section.sectionId,
            markdown: section.input.value,
          })),
          citations: [],
          limitations: doc
            .getElementById("report-limits")
            .value.split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        };
        if (
          !content.title.trim() ||
          !content.summary.trim() ||
          !content.sections.length ||
          content.sections.some((section) => !section.markdown.trim())
        )
          throw new ControllerDenied("report_required");
        const id = operation("report");
        clearPrivate();
        try {
          const saved = await active.submitResult(currentRun, id, content);
          check();
          reportOperation = id;
          doc.getElementById("save-state").textContent =
            `Saved to Inbox. Result ${saved.receipt.resultId}, revision ${saved.receipt.revision}.`;
        } catch (error) {
          check();
          const retained = (await active.listOutbox()).some((row) => row.stableOperationId === id);
          check();
          if (retained) {
            reportOperation = id;
            doc.getElementById("save-state").textContent =
              "Save outcome is unknown. Check or retry this original encrypted report; do not create another report.";
          }
          throw error;
        }
      }),
    );
    for (const [id, method] of [
      ["check-analysis", "recoverReceipt"],
      ["retry-analysis", "replay"],
    ])
      doc.getElementById(id).addEventListener("click", () =>
        permittedAction(async (active, check) => {
          if (!reportOperation) throw new ControllerDenied("run_required");
          const saved = await active[method](reportOperation);
          check();
          doc.getElementById("save-state").textContent = saved.receipt
            ? `Saved to Inbox. Result ${saved.receipt.resultId}, revision ${saved.receipt.revision}.`
            : "The original report is still unconfirmed. Keep its encrypted retry record.";
        }),
      );
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
        clearPrivate();
        output.textContent = "";
        doc.getElementById("agent-args").value = "";
      }
    });
    host.addEventListener("pagehide", () => {
      ownerBridge?.close("page_closed");
      controller?.lock();
      clearPrivate();
      output.textContent = "";
      offer.textContent = "";
    });
  } catch (error) {
    failure(error);
    doc.getElementById("agent-run").disabled = true;
  }
}
void start();
