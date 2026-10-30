import { ForegroundController as f, ControllerDenied as o } from "./controller.mjs";
import { OwnerHelperBridge as p } from "./owner-helper.mjs";
var e = document,
  r = window,
  c = e.getElementById("status"),
  s = e.getElementById("output"),
  l = e.getElementById("public-offer"),
  n,
  u,
  v = (i) => {
    (i.state === "LOCKED" &&
      ((s.textContent = ""), (l.textContent = ""), (e.getElementById("agent-args").value = "")),
      (c.textContent =
        i.state === "LOCKED"
          ? "Locked. Private key handles were discarded. Pending encrypted operations stay on this device."
          : i.state === "READY"
            ? "Foreground session active. Agent access still requires your FolioView approval and exact encrypted delivery."
            : "Waiting for independent owner setup."));
  },
  a = (i) => {
    c.textContent = `Operation refused: ${i instanceof o ? i.code : "controller_rejected"}.`;
  },
  h = () =>
    new f({
      issuer: r.location.origin,
      developmentLoopback: ["localhost", "127.0.0.1", "[::1]"].includes(r.location.hostname),
      onState: v,
    });
async function m() {
  try {
    if (r.top !== r || r.location.hash) throw new o("top_level_required");
    let i = new URLSearchParams(r.location.search);
    if (i.has("owner_nonce") || i.has("owner_origin")) {
      if ([...i.keys()].sort().join() !== "owner_nonce,owner_origin")
        throw new o("invalid_owner_pairing");
      e.getElementById("manual-owner").remove();
      let t = new AbortController(),
        w = setTimeout(() => t.abort(), 1e4),
        d;
      try {
        let g = await fetch("/agent/v2/controller/config", {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: t.signal,
        });
        if (!g.ok) throw new o("configuration_unavailable");
        let y = await g.text();
        if (new TextEncoder().encode(y).length > 32768) throw new o("invalid_configuration");
        d = JSON.parse(y);
      } finally {
        clearTimeout(w);
      }
      ((n = h()),
        (u = new p({
          config: d,
          controller: n,
          ownerOrigin: i.get("owner_origin"),
          nonce: i.get("owner_nonce"),
          onState: (g) => {
            g !== "owner_attached" &&
              ((s.textContent = ""),
              (l.textContent = ""),
              (c.textContent = "The owner connection closed. Start a new foreground session."));
          },
        })),
        (c.textContent =
          "Waiting for your paired FolioView window. Keep both windows open; private views are hidden when this helper is in the background."));
    } else {
      if ([...i.keys()].length) throw new o("invalid_owner_pairing");
      (e.getElementById("initialize").addEventListener("click", async () => {
        try {
          if (n && n.status().state !== "LOCKED") throw new o("session_already_initialized");
          n = h();
          let t = await n.initialize(JSON.parse(e.getElementById("owner-card").value));
          l.textContent = JSON.stringify(t, null, 2);
        } catch (t) {
          a(t);
        }
      }),
        e.getElementById("confirm-delivery").addEventListener("click", async () => {
          try {
            if (!n) throw new o("owner_setup_required");
            await n.confirmDelivery({ pin: JSON.parse(e.getElementById("delivery-pin").value) });
          } catch (t) {
            a(t);
          }
        }));
    }
    (e.getElementById("copy-offer").addEventListener("click", async () => {
      try {
        if (!n) throw new o("owner_setup_required");
        (await navigator.clipboard.writeText(JSON.stringify(n.publicOffer())),
          (c.textContent =
            "Public key offer copied. Review it in your signed-in FolioView window."));
      } catch (t) {
        a(t);
      }
    }),
      e.getElementById("show-offer").addEventListener("click", () => {
        try {
          l.textContent = JSON.stringify(n.publicOffer(), null, 2);
        } catch (t) {
          a(t);
        }
      }),
      e.getElementById("agent-run").addEventListener("click", async () => {
        try {
          if (!n) throw new o("owner_setup_required");
          let t = e.getElementById("agent-operation").value,
            w = JSON.parse(e.getElementById("agent-args").value || "{}"),
            d = await n.dispatchAgent({ op: t, args: w });
          if (e.visibilityState === "hidden") return;
          ((s.textContent = JSON.stringify(d, null, 2)),
            ["sealResult", "reviseResult"].includes(t) &&
              ((e.getElementById("agent-args").value = ""),
              (c.textContent =
                "Original encrypted result saved to this device's outbox. This page has NOT verified a server save. Use the authenticated agent API; receipt/revision confirmation needs a trusted authenticated host.")));
        } catch (t) {
          a(t);
        }
      }),
      e.getElementById("lock").addEventListener("click", () => {
        (u?.close("user_locked"), n?.lock(), (s.textContent = ""), (l.textContent = ""));
      }),
      e.addEventListener("visibilitychange", () => {
        (n?.setVisible(e.visibilityState !== "hidden"),
          e.visibilityState === "hidden" &&
            ((s.textContent = ""), (e.getElementById("agent-args").value = "")));
      }),
      r.addEventListener("pagehide", () => {
        (u?.close("page_closed"), n?.lock(), (s.textContent = ""), (l.textContent = ""));
      }));
  } catch (i) {
    (a(i), (e.getElementById("agent-run").disabled = !0));
  }
}
m();
