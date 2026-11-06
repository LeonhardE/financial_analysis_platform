import { ForegroundController as A, ControllerDenied as s } from "./controller.mjs";
import { OwnerHelperBridge as N } from "./owner-helper.mjs";
var e = document,
  u = window,
  f = e.getElementById("status"),
  w = e.getElementById("output"),
  m = e.getElementById("public-offer"),
  o,
  k,
  h,
  p,
  O,
  x = 0,
  S = !1,
  J = ["report-title", "report-summary", "report-limits"],
  b = [],
  v = () => {
    e.getElementById("analysis-inputs").textContent = "";
    for (let n of J) e.getElementById(n).value = "";
    for (let n of b) n.input.value = "";
  },
  P = (n) => {
    (n.state === "LOCKED" &&
      (x++,
      (h = p = O = null),
      (e.getElementById("read-analysis").textContent = "Read approved task and start analysis"),
      v(),
      (b = []),
      e.getElementById("report-sections").replaceChildren(),
      (e.getElementById("transport-packet").value = ""),
      (e.getElementById("analysis-state").textContent =
        "Session ended. Start a new approved session before reading."),
      (e.getElementById("save-state").textContent =
        "Session ended. Original encrypted retry records remain on this device."),
      (w.textContent = ""),
      (m.textContent = ""),
      (e.getElementById("agent-args").value = "")),
      (f.textContent =
        n.state === "LOCKED"
          ? "Locked. Private key handles were discarded. Pending encrypted operations stay on this device."
          : n.state === "READY"
            ? "Foreground session active. Agent access still requires your FolioView approval and exact encrypted delivery."
            : "Waiting for independent owner setup."));
  },
  y = (n) => {
    f.textContent = `Operation refused: ${n instanceof s ? n.code : "controller_rejected"}.`;
  },
  R = () =>
    new A({
      issuer: u.location.origin,
      developmentLoopback: ["localhost", "127.0.0.1", "[::1]"].includes(u.location.hostname),
      onState: P,
    }),
  C = async (n) => {
    if (S || !o || e.visibilityState === "hidden") return;
    S = !0;
    let E = o,
      t = x,
      a = () => {
        if (E !== o || t !== x || E.status().state === "LOCKED" || e.visibilityState === "hidden")
          throw new s("foreground_required");
      };
    try {
      await n(E, a);
    } catch (i) {
      t === x && y(i);
    } finally {
      S = !1;
    }
  },
  q = (n) => `${n}_${crypto.randomUUID().replaceAll("-", "")}`;
async function T() {
  try {
    if (u.top !== u || u.location.hash) throw new s("top_level_required");
    let n = new URLSearchParams(u.location.search);
    if (n.has("owner_nonce") || n.has("owner_origin")) {
      if ([...n.keys()].sort().join() !== "owner_nonce,owner_origin")
        throw new s("invalid_owner_pairing");
      e.getElementById("manual-owner").remove();
      let t = new AbortController(),
        a = setTimeout(() => t.abort(), 1e4),
        i;
      try {
        let l = await fetch("/agent/v2/controller/config/1.3.0", {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: t.signal,
        });
        if (!l.ok) throw new s("configuration_unavailable");
        let r = await l.text();
        if (new TextEncoder().encode(r).length > 32768) throw new s("invalid_configuration");
        i = JSON.parse(r);
      } finally {
        clearTimeout(a);
      }
      ((o = R()),
        (k = new N({
          config: i,
          controller: o,
          ownerOrigin: n.get("owner_origin"),
          nonce: n.get("owner_nonce"),
          onState: (l) => {
            l !== "owner_attached" &&
              ((w.textContent = ""),
              (m.textContent = ""),
              (f.textContent = "The owner connection closed. Start a new foreground session."));
          },
        })),
        (f.textContent =
          "Waiting for your paired FolioView window. Keep both windows open; private views are hidden when this helper is in the background."));
    } else {
      if ([...n.keys()].length) throw new s("invalid_owner_pairing");
      (e.getElementById("initialize").addEventListener("click", async () => {
        try {
          if (o && o.status().state !== "LOCKED") throw new s("session_already_initialized");
          o = R();
          let t = await o.initialize(JSON.parse(e.getElementById("owner-card").value));
          m.textContent = JSON.stringify(t, null, 2);
        } catch (t) {
          y(t);
        }
      }),
        e.getElementById("confirm-delivery").addEventListener("click", async () => {
          try {
            if (!o) throw new s("owner_setup_required");
            await o.confirmDelivery({ pin: JSON.parse(e.getElementById("delivery-pin").value) });
          } catch (t) {
            y(t);
          }
        }));
    }
    (e.getElementById("copy-offer").addEventListener("click", async () => {
      try {
        if (!o) throw new s("owner_setup_required");
        (await navigator.clipboard.writeText(JSON.stringify(o.publicOffer())),
          (f.textContent =
            "Public key offer copied. Review it in your signed-in FolioView window."));
      } catch (t) {
        y(t);
      }
    }),
      e.getElementById("connect-transport").addEventListener("click", () =>
        C(async (t, a) => {
          let i = e.getElementById("transport-packet").value;
          if (((e.getElementById("transport-packet").value = ""), i.length > 12288))
            throw new s("invalid_transport");
          (await t.connectTransport(JSON.parse(i)),
            a(),
            (e.getElementById("analysis-state").textContent =
              "Approved session connected. Read the selected task to begin."));
        }),
      ),
      e.getElementById("read-analysis").addEventListener("click", () =>
        C(async (t, a) => {
          if (h || p) throw new s("analysis_already_started");
          v();
          let i = await t.loadPreparation();
          a();
          for (let c of i.objects) (await t.readPreparedObject(c.objectId), a());
          ((O ??= q("analysis")),
            (e.getElementById("read-analysis").textContent = "Continue the original analysis"),
            (e.getElementById("analysis-state").textContent =
              "Checking this analysis. If it is interrupted, continue the original analysis to check the same request."));
          let l = await t.beginRun(O);
          (a(), (h = l.run.runId));
          let r = [],
            I = new Set(),
            d = null;
          do {
            if (r.length >= 16 || (d !== null && I.has(d))) throw new s("invalid_response");
            I.add(d);
            let c = await t.readRunPage(h, d);
            (a(), r.push(c), (d = c.nextCursor));
          } while (d !== null);
          let B = r.find((c) => c.componentIndex === 0)?.payload?.outputSpec?.sections;
          if (!Array.isArray(B) || !B.length || B.length > 8) throw new s("invalid_response");
          (e.getElementById("report-sections").replaceChildren(),
            (b = B.map((c, L) => {
              let _ = e.createElement("label"),
                g = e.createElement("textarea");
              return (
                (g.id = `report-section-${L}`),
                (g.maxLength = 16384),
                (g.autocomplete = "off"),
                (_.htmlFor = g.id),
                (_.textContent = `Section ${L + 1}`),
                e.getElementById("report-sections").append(_, g),
                { sectionId: c.sectionId, input: g }
              );
            })),
            (e.getElementById("analysis-inputs").textContent = JSON.stringify(r, null, 2)),
            (e.getElementById("analysis-state").textContent =
              "Approved frozen task and resources are ready. Read them and write the report below."));
        }),
      ),
      e.getElementById("save-analysis").addEventListener("click", () =>
        C(async (t, a) => {
          if (!h || p) throw new s("run_required");
          let i = {
            title: e.getElementById("report-title").value,
            summary: e.getElementById("report-summary").value,
            sections: b.map((r) => ({ sectionId: r.sectionId, markdown: r.input.value })),
            citations: [],
            limitations: e
              .getElementById("report-limits")
              .value.split(
                `
`,
              )
              .map((r) => r.trim())
              .filter(Boolean),
          };
          if (
            !i.title.trim() ||
            !i.summary.trim() ||
            !i.sections.length ||
            i.sections.some((r) => !r.markdown.trim())
          )
            throw new s("report_required");
          let l = q("report");
          v();
          try {
            let r = await t.submitResult(h, l, i);
            (a(),
              (p = l),
              (e.getElementById("save-state").textContent =
                `Saved to Inbox. Result ${r.receipt.resultId}, revision ${r.receipt.revision}.`));
          } catch (r) {
            a();
            let I = (await t.listOutbox()).some((d) => d.stableOperationId === l);
            throw (
              a(),
              I &&
                ((p = l),
                (e.getElementById("save-state").textContent =
                  "Save outcome is unknown. Check or retry this original encrypted report; do not create another report.")),
              r
            );
          }
        }),
      ));
    for (let [t, a] of [
      ["check-analysis", "recoverReceipt"],
      ["retry-analysis", "replay"],
    ])
      e.getElementById(t).addEventListener("click", () =>
        C(async (i, l) => {
          if (!p) throw new s("run_required");
          let r = await i[a](p);
          (l(),
            (e.getElementById("save-state").textContent = r.receipt
              ? `Saved to Inbox. Result ${r.receipt.resultId}, revision ${r.receipt.revision}.`
              : "The original report is still unconfirmed. Keep its encrypted retry record."));
        }),
      );
    (e.getElementById("show-offer").addEventListener("click", () => {
      try {
        m.textContent = JSON.stringify(o.publicOffer(), null, 2);
      } catch (t) {
        y(t);
      }
    }),
      e.getElementById("agent-run").addEventListener("click", async () => {
        try {
          if (!o) throw new s("owner_setup_required");
          let t = e.getElementById("agent-operation").value,
            a = JSON.parse(e.getElementById("agent-args").value || "{}"),
            i = await o.dispatchAgent({ op: t, args: a });
          if (e.visibilityState === "hidden") return;
          ((w.textContent = JSON.stringify(i, null, 2)),
            ["sealResult", "reviseResult"].includes(t) &&
              ((e.getElementById("agent-args").value = ""),
              (f.textContent =
                "Original encrypted result saved to this device's outbox. This page has NOT verified a server save. Use the authenticated agent API; receipt/revision confirmation needs a trusted authenticated host.")));
        } catch (t) {
          y(t);
        }
      }),
      e.getElementById("lock").addEventListener("click", () => {
        (k?.close("user_locked"), o?.lock(), (w.textContent = ""), (m.textContent = ""));
      }),
      e.addEventListener("visibilitychange", () => {
        (o?.setVisible(e.visibilityState !== "hidden"),
          e.visibilityState === "hidden" &&
            (v(), (w.textContent = ""), (e.getElementById("agent-args").value = "")));
      }),
      u.addEventListener("pagehide", () => {
        (k?.close("page_closed"), o?.lock(), v(), (w.textContent = ""), (m.textContent = ""));
      }));
  } catch (n) {
    (y(n), (e.getElementById("agent-run").disabled = !0));
  }
}
T();
