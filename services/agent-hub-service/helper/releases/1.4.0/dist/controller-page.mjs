import { ForegroundController as N, ControllerDenied as o } from "./controller.mjs";
import { OwnerHelperBridge as J } from "./owner-helper.mjs";
var e = document,
  g = window,
  m = e.getElementById("status"),
  h = e.getElementById("output"),
  f = e.getElementById("public-offer"),
  l,
  S,
  p,
  u,
  C,
  _ = 0,
  L = 0,
  R = !1,
  O = !1,
  T = ["report-title", "report-summary", "report-limits"],
  k = [],
  b = () => {
    (L++,
      (e.getElementById("transport-packet").value = ""),
      (e.getElementById("transport-packet-file").value = ""));
  },
  E = () => {
    e.getElementById("analysis-inputs").textContent = "";
    for (let n of T) e.getElementById(n).value = "";
    for (let n of k) n.input.value = "";
  },
  P = (n) => {
    (n.state === "LOCKED" &&
      (_++,
      (p = u = C = null),
      (R = !1),
      (e.getElementById("read-analysis").textContent = "Read approved task and start analysis"),
      E(),
      (k = []),
      e.getElementById("report-sections").replaceChildren(),
      b(),
      (e.getElementById("analysis-state").textContent =
        "Session ended. Start a new approved session before reading."),
      (e.getElementById("save-state").textContent =
        "Session ended. Original encrypted retry records remain on this device."),
      (h.textContent = ""),
      (f.textContent = ""),
      (e.getElementById("agent-args").value = "")),
      (m.textContent =
        n.state === "LOCKED"
          ? "Locked. Private key handles were discarded. Pending encrypted operations stay on this device."
          : n.state === "READY"
            ? "Foreground session active. Agent access still requires your FolioView approval and exact encrypted delivery."
            : "Waiting for independent owner setup."));
  },
  y = (n) => {
    m.textContent =
      n instanceof o && n.code === "access_token_refresh_required"
        ? "Access token needs renewal. Reconnect this session with a fresh encrypted connection packet, then continue the original analysis or report."
        : n instanceof o && n.code === "transport_expired"
          ? "Connection packet expired. Request a fresh get_foreground_transport_v3 packet and reconnect this same session. Existing foreground keys remain available until the session ends."
          : `Operation refused: ${n instanceof o ? n.code : "controller_rejected"}.`;
  },
  q = () =>
    new N({
      issuer: g.location.origin,
      developmentLoopback: ["localhost", "127.0.0.1", "[::1]"].includes(g.location.hostname),
      onState: P,
    }),
  B = async (n) => {
    if (O || !l || e.visibilityState === "hidden") return;
    O = !0;
    let I = l,
      t = _,
      a = () => {
        if (I !== l || t !== _ || I.status().state === "LOCKED" || e.visibilityState === "hidden")
          throw new o("foreground_required");
      };
    try {
      await n(I, a);
    } catch (i) {
      t === _ && y(i);
    } finally {
      O = !1;
    }
  },
  A = (n) => `${n}_${crypto.randomUUID().replaceAll("-", "")}`;
async function $() {
  try {
    if (g.top !== g || g.location.hash) throw new o("top_level_required");
    let n = new URLSearchParams(g.location.search);
    if (n.has("owner_nonce") || n.has("owner_origin")) {
      if ([...n.keys()].sort().join() !== "owner_nonce,owner_origin")
        throw new o("invalid_owner_pairing");
      e.getElementById("manual-owner").remove();
      let t = new AbortController(),
        a = setTimeout(() => t.abort(), 1e4),
        i;
      try {
        let s = await fetch("/agent/v2/controller/config/1.4.0", {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: t.signal,
        });
        if (!s.ok) throw new o("configuration_unavailable");
        let r = await s.text();
        if (new TextEncoder().encode(r).length > 32768) throw new o("invalid_configuration");
        i = JSON.parse(r);
      } finally {
        clearTimeout(a);
      }
      ((l = q()),
        (S = new J({
          config: i,
          controller: l,
          ownerOrigin: n.get("owner_origin"),
          nonce: n.get("owner_nonce"),
          onState: (s) => {
            s !== "owner_attached" &&
              ((h.textContent = ""),
              (f.textContent = ""),
              (m.textContent = "The owner connection closed. Start a new foreground session."));
          },
        })),
        (m.textContent =
          "Waiting for your paired FolioView window. Keep both windows open; private views are hidden when this helper is in the background."));
    } else {
      if ([...n.keys()].length) throw new o("invalid_owner_pairing");
      (e.getElementById("initialize").addEventListener("click", async () => {
        try {
          if (l && l.status().state !== "LOCKED") throw new o("session_already_initialized");
          l = q();
          let t = await l.initialize(JSON.parse(e.getElementById("owner-card").value));
          f.textContent = JSON.stringify(t, null, 2);
        } catch (t) {
          y(t);
        }
      }),
        e.getElementById("confirm-delivery").addEventListener("click", async () => {
          try {
            if (!l) throw new o("owner_setup_required");
            await l.confirmDelivery({ pin: JSON.parse(e.getElementById("delivery-pin").value) });
          } catch (t) {
            y(t);
          }
        }));
    }
    (e.getElementById("copy-offer").addEventListener("click", async () => {
      try {
        if (!l) throw new o("owner_setup_required");
        (await navigator.clipboard.writeText(JSON.stringify(l.publicOffer())),
          (m.textContent =
            "Public key offer copied. Review it in your signed-in FolioView window."));
      } catch (t) {
        y(t);
      }
    }),
      e.getElementById("connect-transport").addEventListener("click", () =>
        B(async (t, a) => {
          let i = e.getElementById("transport-packet").value,
            s = [...(e.getElementById("transport-packet-file").files ?? [])];
          b();
          let r = L;
          if (s.length > 1 || (s.length && i.trim())) throw new o("invalid_transport");
          if (s.length) {
            let d = s[0];
            if (d.size < 1 || d.size > 12288) throw new o("invalid_transport");
            try {
              i = await d.text();
            } catch {
              throw new o("invalid_transport");
            }
            if ((a(), r !== L)) throw new o("foreground_required");
          }
          if (i.length > 12288) throw new o("invalid_transport");
          (await t.connectTransport(JSON.parse(i)),
            a(),
            (e.getElementById("analysis-state").textContent =
              p || C
                ? "Approved session reconnected. Continue the original analysis or report."
                : "Approved session connected. Read the selected task to begin."));
        }),
      ),
      e.getElementById("read-analysis").addEventListener("click", () =>
        B(async (t, a) => {
          if (R || u) throw new o("analysis_already_started");
          if ((E(), !p)) {
            let c = await t.loadPreparation();
            a();
            for (let v of c.objects) (await t.readPreparedObject(v.objectId), a());
            ((C ??= A("analysis")),
              (e.getElementById("read-analysis").textContent = "Continue the original analysis"),
              (e.getElementById("analysis-state").textContent =
                "Checking this analysis. If it is interrupted, continue the original analysis to check the same request."));
            let x = await t.beginRun(C);
            (a(), (p = x.run.runId));
          }
          let i = [],
            s = new Set(),
            r = null;
          do {
            if (i.length >= 16 || (r !== null && s.has(r))) throw new o("invalid_response");
            s.add(r);
            let c = await t.readRunPage(p, r);
            (a(), i.push(c), (r = c.nextCursor));
          } while (r !== null);
          let d = i.find((c) => c.componentIndex === 0)?.payload?.outputSpec?.sections;
          if (!Array.isArray(d) || !d.length || d.length > 8) throw new o("invalid_response");
          (e.getElementById("report-sections").replaceChildren(),
            (k = d.map((c, x) => {
              let v = e.createElement("label"),
                w = e.createElement("textarea");
              return (
                (w.id = `report-section-${x}`),
                (w.maxLength = 16384),
                (w.autocomplete = "off"),
                (v.htmlFor = w.id),
                (v.textContent = `Section ${x + 1}`),
                e.getElementById("report-sections").append(v, w),
                { sectionId: c.sectionId, input: w }
              );
            })),
            (e.getElementById("analysis-inputs").textContent = JSON.stringify(i, null, 2)),
            (R = !0),
            (e.getElementById("analysis-state").textContent =
              "Approved frozen task and resources are ready. Read them and write the report below."));
        }),
      ),
      e.getElementById("save-analysis").addEventListener("click", () =>
        B(async (t, a) => {
          if (!p || u) throw new o("run_required");
          let i = {
            title: e.getElementById("report-title").value,
            summary: e.getElementById("report-summary").value,
            sections: k.map((r) => ({ sectionId: r.sectionId, markdown: r.input.value })),
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
            throw new o("report_required");
          let s = A("report");
          E();
          try {
            let r = await t.submitResult(p, s, i);
            (a(),
              (u = s),
              (e.getElementById("save-state").textContent =
                `Saved to Inbox. Result ${r.receipt.resultId}, revision ${r.receipt.revision}.`));
          } catch (r) {
            a();
            let d = (await t.listOutbox()).some((c) => c.stableOperationId === s);
            throw (
              a(),
              d &&
                ((u = s),
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
        B(async (i, s) => {
          if (!u) throw new o("run_required");
          let r = await i[a](u);
          (s(),
            (e.getElementById("save-state").textContent = r.receipt
              ? `Saved to Inbox. Result ${r.receipt.resultId}, revision ${r.receipt.revision}.`
              : "The original report is still unconfirmed. Keep its encrypted retry record."));
        }),
      );
    (e.getElementById("show-offer").addEventListener("click", () => {
      try {
        f.textContent = JSON.stringify(l.publicOffer(), null, 2);
      } catch (t) {
        y(t);
      }
    }),
      e.getElementById("agent-run").addEventListener("click", async () => {
        try {
          if (!l) throw new o("owner_setup_required");
          let t = e.getElementById("agent-operation").value,
            a = JSON.parse(e.getElementById("agent-args").value || "{}"),
            i = await l.dispatchAgent({ op: t, args: a });
          if (e.visibilityState === "hidden") return;
          ((h.textContent = JSON.stringify(i, null, 2)),
            ["sealResult", "reviseResult"].includes(t) &&
              ((e.getElementById("agent-args").value = ""),
              (m.textContent =
                "Original encrypted result saved to this device's outbox. This page has NOT verified a server save. Use the authenticated agent API; receipt/revision confirmation needs a trusted authenticated host.")));
        } catch (t) {
          y(t);
        }
      }),
      e.getElementById("lock").addEventListener("click", () => {
        (S?.close("user_locked"), l?.lock(), (h.textContent = ""), (f.textContent = ""));
      }),
      e.addEventListener("visibilitychange", () => {
        (l?.setVisible(e.visibilityState !== "hidden"),
          e.visibilityState === "hidden" &&
            (b(), E(), (h.textContent = ""), (e.getElementById("agent-args").value = "")));
      }),
      g.addEventListener("pagehide", () => {
        (S?.close("page_closed"), l?.lock(), b(), E(), (h.textContent = ""), (f.textContent = ""));
      }));
  } catch (n) {
    (y(n), (e.getElementById("agent-run").disabled = !0));
  }
}
$();
