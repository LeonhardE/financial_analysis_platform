import { ForegroundController as J, ControllerDenied as i } from "./controller.mjs";
import { OwnerHelperBridge as T } from "./owner-helper.mjs";
var e = document,
  g = window,
  v = e.getElementById("status"),
  m = e.getElementById("output"),
  h = e.getElementById("public-offer"),
  s,
  S,
  f,
  y,
  L,
  C = 0,
  R = 0,
  O = !1,
  P = ["report-title", "report-summary", "report-limits"],
  b = [],
  _ = () => {
    (R++,
      (e.getElementById("transport-packet").value = ""),
      (e.getElementById("transport-packet-file").value = ""));
  },
  E = () => {
    e.getElementById("analysis-inputs").textContent = "";
    for (let r of P) e.getElementById(r).value = "";
    for (let r of b) r.input.value = "";
  },
  $ = (r) => {
    (r.state === "LOCKED" &&
      (C++,
      (f = y = L = null),
      (e.getElementById("read-analysis").textContent = "Read approved task and start analysis"),
      E(),
      (b = []),
      e.getElementById("report-sections").replaceChildren(),
      _(),
      (e.getElementById("analysis-state").textContent =
        "Session ended. Start a new approved session before reading."),
      (e.getElementById("save-state").textContent =
        "Session ended. Original encrypted retry records remain on this device."),
      (m.textContent = ""),
      (h.textContent = ""),
      (e.getElementById("agent-args").value = "")),
      (v.textContent =
        r.state === "LOCKED"
          ? "Locked. Private key handles were discarded. Pending encrypted operations stay on this device."
          : r.state === "READY"
            ? "Foreground session active. Agent access still requires your FolioView approval and exact encrypted delivery."
            : "Waiting for independent owner setup."));
  },
  u = (r) => {
    v.textContent = `Operation refused: ${r instanceof i ? r.code : "controller_rejected"}.`;
  },
  A = () =>
    new J({
      issuer: g.location.origin,
      developmentLoopback: ["localhost", "127.0.0.1", "[::1]"].includes(g.location.hostname),
      onState: $,
    }),
  x = async (r) => {
    if (O || !s || e.visibilityState === "hidden") return;
    O = !0;
    let I = s,
      t = C,
      a = () => {
        if (I !== s || t !== C || I.status().state === "LOCKED" || e.visibilityState === "hidden")
          throw new i("foreground_required");
      };
    try {
      await r(I, a);
    } catch (o) {
      t === C && u(o);
    } finally {
      O = !1;
    }
  },
  N = (r) => `${r}_${crypto.randomUUID().replaceAll("-", "")}`;
async function D() {
  try {
    if (g.top !== g || g.location.hash) throw new i("top_level_required");
    let r = new URLSearchParams(g.location.search);
    if (r.has("owner_nonce") || r.has("owner_origin")) {
      if ([...r.keys()].sort().join() !== "owner_nonce,owner_origin")
        throw new i("invalid_owner_pairing");
      e.getElementById("manual-owner").remove();
      let t = new AbortController(),
        a = setTimeout(() => t.abort(), 1e4),
        o;
      try {
        let l = await fetch("/agent/v2/controller/config/1.3.0", {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: t.signal,
        });
        if (!l.ok) throw new i("configuration_unavailable");
        let n = await l.text();
        if (new TextEncoder().encode(n).length > 32768) throw new i("invalid_configuration");
        o = JSON.parse(n);
      } finally {
        clearTimeout(a);
      }
      ((s = A()),
        (S = new T({
          config: o,
          controller: s,
          ownerOrigin: r.get("owner_origin"),
          nonce: r.get("owner_nonce"),
          onState: (l) => {
            l !== "owner_attached" &&
              ((m.textContent = ""),
              (h.textContent = ""),
              (v.textContent = "The owner connection closed. Start a new foreground session."));
          },
        })),
        (v.textContent =
          "Waiting for your paired FolioView window. Keep both windows open; private views are hidden when this helper is in the background."));
    } else {
      if ([...r.keys()].length) throw new i("invalid_owner_pairing");
      (e.getElementById("initialize").addEventListener("click", async () => {
        try {
          if (s && s.status().state !== "LOCKED") throw new i("session_already_initialized");
          s = A();
          let t = await s.initialize(JSON.parse(e.getElementById("owner-card").value));
          h.textContent = JSON.stringify(t, null, 2);
        } catch (t) {
          u(t);
        }
      }),
        e.getElementById("confirm-delivery").addEventListener("click", async () => {
          try {
            if (!s) throw new i("owner_setup_required");
            await s.confirmDelivery({ pin: JSON.parse(e.getElementById("delivery-pin").value) });
          } catch (t) {
            u(t);
          }
        }));
    }
    (e.getElementById("copy-offer").addEventListener("click", async () => {
      try {
        if (!s) throw new i("owner_setup_required");
        (await navigator.clipboard.writeText(JSON.stringify(s.publicOffer())),
          (v.textContent =
            "Public key offer copied. Review it in your signed-in FolioView window."));
      } catch (t) {
        u(t);
      }
    }),
      e.getElementById("connect-transport").addEventListener("click", () =>
        x(async (t, a) => {
          let o = e.getElementById("transport-packet").value,
            l = [...(e.getElementById("transport-packet-file").files ?? [])];
          _();
          let n = R;
          if (l.length > 1 || (l.length && o.trim())) throw new i("invalid_transport");
          if (l.length) {
            let d = l[0];
            if (d.size < 1 || d.size > 12288) throw new i("invalid_transport");
            try {
              o = await d.text();
            } catch {
              throw new i("invalid_transport");
            }
            if ((a(), n !== R)) throw new i("foreground_required");
          }
          if (o.length > 12288) throw new i("invalid_transport");
          (await t.connectTransport(JSON.parse(o)),
            a(),
            (e.getElementById("analysis-state").textContent =
              "Approved session connected. Read the selected task to begin."));
        }),
      ),
      e.getElementById("read-analysis").addEventListener("click", () =>
        x(async (t, a) => {
          if (f || y) throw new i("analysis_already_started");
          E();
          let o = await t.loadPreparation();
          a();
          for (let p of o.objects) (await t.readPreparedObject(p.objectId), a());
          ((L ??= N("analysis")),
            (e.getElementById("read-analysis").textContent = "Continue the original analysis"),
            (e.getElementById("analysis-state").textContent =
              "Checking this analysis. If it is interrupted, continue the original analysis to check the same request."));
          let l = await t.beginRun(L);
          (a(), (f = l.run.runId));
          let n = [],
            d = new Set(),
            c = null;
          do {
            if (n.length >= 16 || (c !== null && d.has(c))) throw new i("invalid_response");
            d.add(c);
            let p = await t.readRunPage(f, c);
            (a(), n.push(p), (c = p.nextCursor));
          } while (c !== null);
          let B = n.find((p) => p.componentIndex === 0)?.payload?.outputSpec?.sections;
          if (!Array.isArray(B) || !B.length || B.length > 8) throw new i("invalid_response");
          (e.getElementById("report-sections").replaceChildren(),
            (b = B.map((p, q) => {
              let k = e.createElement("label"),
                w = e.createElement("textarea");
              return (
                (w.id = `report-section-${q}`),
                (w.maxLength = 16384),
                (w.autocomplete = "off"),
                (k.htmlFor = w.id),
                (k.textContent = `Section ${q + 1}`),
                e.getElementById("report-sections").append(k, w),
                { sectionId: p.sectionId, input: w }
              );
            })),
            (e.getElementById("analysis-inputs").textContent = JSON.stringify(n, null, 2)),
            (e.getElementById("analysis-state").textContent =
              "Approved frozen task and resources are ready. Read them and write the report below."));
        }),
      ),
      e.getElementById("save-analysis").addEventListener("click", () =>
        x(async (t, a) => {
          if (!f || y) throw new i("run_required");
          let o = {
            title: e.getElementById("report-title").value,
            summary: e.getElementById("report-summary").value,
            sections: b.map((n) => ({ sectionId: n.sectionId, markdown: n.input.value })),
            citations: [],
            limitations: e
              .getElementById("report-limits")
              .value.split(
                `
`,
              )
              .map((n) => n.trim())
              .filter(Boolean),
          };
          if (
            !o.title.trim() ||
            !o.summary.trim() ||
            !o.sections.length ||
            o.sections.some((n) => !n.markdown.trim())
          )
            throw new i("report_required");
          let l = N("report");
          E();
          try {
            let n = await t.submitResult(f, l, o);
            (a(),
              (y = l),
              (e.getElementById("save-state").textContent =
                `Saved to Inbox. Result ${n.receipt.resultId}, revision ${n.receipt.revision}.`));
          } catch (n) {
            a();
            let d = (await t.listOutbox()).some((c) => c.stableOperationId === l);
            throw (
              a(),
              d &&
                ((y = l),
                (e.getElementById("save-state").textContent =
                  "Save outcome is unknown. Check or retry this original encrypted report; do not create another report.")),
              n
            );
          }
        }),
      ));
    for (let [t, a] of [
      ["check-analysis", "recoverReceipt"],
      ["retry-analysis", "replay"],
    ])
      e.getElementById(t).addEventListener("click", () =>
        x(async (o, l) => {
          if (!y) throw new i("run_required");
          let n = await o[a](y);
          (l(),
            (e.getElementById("save-state").textContent = n.receipt
              ? `Saved to Inbox. Result ${n.receipt.resultId}, revision ${n.receipt.revision}.`
              : "The original report is still unconfirmed. Keep its encrypted retry record."));
        }),
      );
    (e.getElementById("show-offer").addEventListener("click", () => {
      try {
        h.textContent = JSON.stringify(s.publicOffer(), null, 2);
      } catch (t) {
        u(t);
      }
    }),
      e.getElementById("agent-run").addEventListener("click", async () => {
        try {
          if (!s) throw new i("owner_setup_required");
          let t = e.getElementById("agent-operation").value,
            a = JSON.parse(e.getElementById("agent-args").value || "{}"),
            o = await s.dispatchAgent({ op: t, args: a });
          if (e.visibilityState === "hidden") return;
          ((m.textContent = JSON.stringify(o, null, 2)),
            ["sealResult", "reviseResult"].includes(t) &&
              ((e.getElementById("agent-args").value = ""),
              (v.textContent =
                "Original encrypted result saved to this device's outbox. This page has NOT verified a server save. Use the authenticated agent API; receipt/revision confirmation needs a trusted authenticated host.")));
        } catch (t) {
          u(t);
        }
      }),
      e.getElementById("lock").addEventListener("click", () => {
        (S?.close("user_locked"), s?.lock(), (m.textContent = ""), (h.textContent = ""));
      }),
      e.addEventListener("visibilitychange", () => {
        (s?.setVisible(e.visibilityState !== "hidden"),
          e.visibilityState === "hidden" &&
            (_(), E(), (m.textContent = ""), (e.getElementById("agent-args").value = "")));
      }),
      g.addEventListener("pagehide", () => {
        (S?.close("page_closed"), s?.lock(), _(), E(), (m.textContent = ""), (h.textContent = ""));
      }));
  } catch (r) {
    (u(r), (e.getElementById("agent-run").disabled = !0));
  }
}
D();
