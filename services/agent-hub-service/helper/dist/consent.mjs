var y = "folioview.owner-consent-bridge.v1";
var w = "folioview.agent-workspace.v2.0",
  E = new TextEncoder(),
  u = class extends Error {
    constructor(e = "bridge_rejected") {
      (super(e), (this.code = e));
    }
  },
  r = (i) => {
    throw new u(i);
  },
  h = (i, e) => {
    (!i ||
      typeof i != "object" ||
      Array.isArray(i) ||
      Object.keys(i).sort().join("\0") !== [...e].sort().join("\0")) &&
      r("invalid_message");
  },
  f = (i) => (
    (typeof i != "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(i)) && r("invalid_message"),
    i
  ),
  z = new Set([
    "tasks:read",
    "runs:create",
    "runs:read",
    "results:create",
    "results:revise",
    "receipts:read",
    "watchlist:read",
    "channel_follows:read",
    "portfolio:read",
  ]),
  S = (i, e) => {
    if (
      (h(
        e,
        i === "claim"
          ? ["contractVersion"]
          : i === "prepare_encrypted"
            ? ["contractVersion", "taskIds", "connectionId", "approvedScopes", "historyPolicy"]
            : ["contractVersion", "decision", "signedGrants"],
      ),
      e.contractVersion !== w && r("unsupported_contract"),
      i === "prepare_encrypted")
    )
      ((!Array.isArray(e.taskIds) ||
        e.taskIds.length !== 1 ||
        new Set(e.taskIds).size !== e.taskIds.length ||
        (e.connectionId !== null && !f(e.connectionId)) ||
        !Array.isArray(e.approvedScopes) ||
        !e.approvedScopes.length ||
        e.approvedScopes.length > 9 ||
        new Set(e.approvedScopes).size !== e.approvedScopes.length ||
        e.approvedScopes.some((s) => !z.has(s)) ||
        e.historyPolicy !== "selected") &&
        r("invalid_message"),
        e.taskIds.forEach(f));
    else if (i === "decision") {
      (!["approve", "deny", "cancel"].includes(e.decision) ||
        !Array.isArray(e.signedGrants) ||
        (e.decision === "approve" ? e.signedGrants.length !== 1 : e.signedGrants.length !== 0)) &&
        r("invalid_message");
      for (let s of e.signedGrants)
        (h(s, ["protected", "payload", "signature"]),
          Object.values(s).some((t) => typeof t != "string" || !/^[A-Za-z0-9_-]+$/.test(t)) &&
            r("invalid_message"));
    }
  };
function q(i, e, s) {
  (typeof i != "string" || i.length > 8192) && r("invalid_redirect");
  let t;
  try {
    t = new URL(i);
  } catch {
    r("invalid_redirect");
  }
  let d = e.clients.find((n) => n.clientId === s);
  (!d ||
    t.protocol !== "https:" ||
    t.username ||
    t.password ||
    t.hash ||
    !d.redirectUris.some((n) => new URL(n).href === t.origin + t.pathname)) &&
    r("invalid_redirect");
  let c = [...t.searchParams.keys()].sort(),
    a = t.searchParams.has("error");
  (c.join("\0") !== (a ? ["error", "iss", "state"] : ["code", "iss", "state"]).join("\0") ||
    t.searchParams.get("iss") !== e.issuer ||
    !t.searchParams.get("state") ||
    (a ? t.searchParams.get("error") !== "access_denied" : !t.searchParams.get("code"))) &&
    r("invalid_redirect");
  for (let n of t.searchParams.values())
    (n.length > 4096 || /[\x00-\x1f\x7f]/.test(n)) && r("invalid_redirect");
  return t.href;
}
async function A(i, e, s = 1048576) {
  (i.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" ||
    !i.body) &&
    r("invalid_response");
  let t = i.body.getReader(),
    d = [],
    c = 0,
    a = () => {
      t.cancel().catch(() => {});
    };
  e.addEventListener("abort", a, { once: !0 });
  try {
    for (;;) {
      let l = await t.read();
      if ((e.aborted && r("bridge_closed"), l.done)) break;
      ((c += l.value.length), c > s && r("invalid_response"), d.push(l.value));
    }
    let n = new Uint8Array(c),
      o = 0;
    for (let l of d) (n.set(l, o), (o += l.length));
    return JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(n));
  } catch (n) {
    if (n instanceof u) throw n;
    r("invalid_response");
  } finally {
    (e.removeEventListener("abort", a), t.cancel().catch(() => {}), t.releaseLock());
  }
}
var _ = class {
  #n;
  #i;
  #r;
  #a;
  #e;
  #c;
  #u = !1;
  #t;
  #f = !1;
  #s = !1;
  #h = !1;
  #l = new Set();
  #p = new Set();
  #d;
  #g;
  #y;
  #o;
  #w;
  #_;
  constructor({
    config: e,
    requestId: s,
    host: t = window,
    fetchImpl: d = fetch,
    navigate: c = (n) => t.location.assign(n),
    onState: a = () => {},
  }) {
    ((e?.profile !== y ||
      e.contractVersion !== w ||
      e.issuer !== t.location.origin ||
      !Array.isArray(e.ownerOrigins) ||
      !e.ownerOrigins.length ||
      e.ownerOrigins.length > 8 ||
      e.ownerOrigins.some((o) => {
        try {
          let l = new URL(o);
          return l.origin !== o || !["https:", "http:"].includes(l.protocol);
        } catch {
          return !0;
        }
      }) ||
      !Array.isArray(e.clients)) &&
      r("invalid_configuration"),
      (this.#n = e),
      (this.#r = f(s)),
      (this.#i = t),
      (this.#g = (...o) => d(...o)),
      (this.#y = c),
      (this.#o = a));
    let n = crypto.getRandomValues(new Uint8Array(32));
    ((this.#a = btoa(String.fromCharCode(...n))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")),
      t.addEventListener("message", this.#v),
      t.addEventListener("pagehide", this.#b),
      (this.#w = setTimeout(() => this.close("bridge_expired"), 18e5)));
  }
  open(e) {
    ((this.#s || this.#e || !this.#n.ownerOrigins.includes(e)) && r("invalid_owner_origin"),
      (this.#c = e));
    let s = new URL("/", e);
    (s.searchParams.set("agent_request", this.#r),
      s.searchParams.set("agent_nonce", this.#a),
      (this.#e = this.#i.open(s.href, "_blank")),
      this.#e || ((this.#c = void 0), r("popup_blocked")),
      this.#m(),
      this.#o("owner_opened"));
  }
  offer() {
    let e = this.#i.opener;
    ((this.#s || this.#e || !e || e === this.#i || e.closed) && r("invalid_owner_origin"),
      (this.#e = e),
      (this.#u = !0));
    try {
      this.#i.opener = null;
    } catch {
      (this.close(), r("invalid_owner_origin"));
    }
    this.#i.opener !== null && (this.close(), r("invalid_owner_origin"));
    for (let s of this.#n.ownerOrigins)
      e.postMessage(
        { type: "fv-owner-consent-offer", profile: y, requestId: this.#r, nonce: this.#a },
        s,
      );
    (this.#m(), this.#o("owner_offered"));
  }
  #m() {
    this.#_ = setInterval(() => {
      this.#e?.closed && this.close("owner_closed");
    }, 1e3);
  }
  #b = () => this.close("bridge_closed");
  #v = (e) => {
    if (
      e.isTrusted !== !0 ||
      this.#s ||
      this.#f ||
      !this.#e ||
      e.source !== this.#e ||
      (this.#u ? !this.#n.ownerOrigins.includes(e.origin) : e.origin !== this.#c) ||
      e.ports?.length
    )
      return;
    try {
      if (
        (h(e.data, ["type", "requestId", "nonce"]),
        e.data.type !== "fv-owner-consent-ready" ||
          e.data.requestId !== this.#r ||
          e.data.nonce !== this.#a)
      )
        return;
    } catch {
      return;
    }
    ((this.#c = e.origin), (this.#f = !0));
    let s = new MessageChannel();
    ((this.#t = s.port1),
      (this.#t.onmessage = ({ data: t }) => {
        this.#I(t);
      }),
      this.#t.start(),
      this.#e.postMessage(
        { type: "fv-owner-consent-attached", profile: y, requestId: this.#r, nonce: this.#a },
        this.#c,
        [s.port2],
      ),
      this.#o("owner_attached"));
  };
  async #I(e) {
    let s = "invalid",
      t,
      d = !1;
    try {
      ((this.#s || this.#h) && r("bridge_busy"),
        E.encode(JSON.stringify(e)).length > 131072 && r("payload_too_large"),
        h(e, ["id", "profile", "requestId", "op", "authorization", "json"]),
        (s = f(e.id)),
        (e.profile !== y ||
          e.requestId !== this.#r ||
          !["claim", "prepare_encrypted", "decision"].includes(e.op) ||
          typeof e.authorization != "string" ||
          e.authorization.length > 16384 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(e.authorization) ||
          this.#p.has(s) ||
          this.#p.size >= 128) &&
          r("invalid_message"),
        S(e.op, e.json),
        e.op !== "claim" && !this.#d && r("claim_required"),
        this.#p.add(s),
        (this.#h = !0),
        (d = !0),
        (t = new AbortController()),
        this.#l.add(t));
      let c = setTimeout(() => t.abort(), 2e4),
        a;
      try {
        let n = `/api/v2/agent-authorizations/${this.#r}/${e.op === "prepare_encrypted" ? "prepare-encrypted" : e.op}`,
          o = await this.#g(n, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal: t.signal,
            headers: {
              Authorization: `Bearer ${e.authorization}`,
              "X-FolioView-Contract": w,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(e.json),
          });
        ((e.authorization = ""),
          o.ok ||
            ((o.status === 401 || o.status === 403) &&
              (this.#t.postMessage({
                id: s,
                ok: !1,
                data: { code: o.status === 401 ? "session_expired" : "insufficient_scope" },
              }),
              this.close("authorization_denied"),
              r("authorization_denied")),
            r(o.status === 409 ? "version_conflict" : "request_failed")),
          (a = await A(o, t.signal)));
      } finally {
        (clearTimeout(c), (e.authorization = ""));
      }
      if (
        ((this.#s || t.signal.aborted || this.#e?.closed) && r("bridge_closed"),
        e.op === "decision")
      ) {
        h(a, ["redirectUri"]);
        let n = q(a.redirectUri, this.#n, this.#d);
        (this.#t.postMessage({ id: s, ok: !0, data: { completed: !0 } }),
          this.#o("completed"),
          this.close("completed"),
          this.#y(n));
      } else
        (h(a, [
          "contractVersion",
          "provider",
          "status",
          "clientId",
          "scopes",
          "connectionId",
          "authorizationId",
          "expiresAt",
          "prepared",
        ]),
          (a.contractVersion !== w ||
            a.provider !== "muse" ||
            !this.#n.clients.some((n) => n.clientId === a.clientId) ||
            (this.#d && this.#d !== a.clientId)) &&
            r("invalid_response"),
          (this.#d = a.clientId),
          this.#t.postMessage({ id: s, ok: !0, data: a }));
    } catch (c) {
      (e && typeof e == "object" && (e.authorization = ""),
        this.#s ||
          this.#t?.postMessage({
            id: s,
            ok: !1,
            data: { code: c instanceof u ? c.code : "request_failed" },
          }));
    } finally {
      (t && this.#l.delete(t), d && (this.#h = !1));
    }
  }
  close(e = "bridge_closed") {
    if (!this.#s) {
      ((this.#s = !0), clearTimeout(this.#w), clearInterval(this.#_));
      for (let s of this.#l) s.abort();
      (this.#l.clear(),
        this.#i.removeEventListener("message", this.#v),
        this.#i.removeEventListener("pagehide", this.#b),
        this.#t?.close(),
        (this.#t = void 0),
        (this.#e = void 0),
        this.#o(e));
    }
  }
};
async function I({ host: i = window, document: e = document, fetchImpl: s = fetch } = {}) {
  let t = e.getElementById("status"),
    d = e.getElementById("owner-origin"),
    c = e.getElementById("continue"),
    a = (o) => {
      ((t.textContent =
        {
          owner_offered:
            "Return to your original unlocked FolioView page and review this request there.",
          owner_opened: "Review the connection in your FolioView window.",
          owner_attached: "Connected to your owner window. Review and approve there.",
          completed: "Decision completed. Returning to Muse\u2026",
          owner_closed: "The owner window closed. Restart the Muse connection to continue.",
          authorization_denied: "Authorization was denied. Restart from Muse and sign in again.",
          bridge_expired: "This request expired. Restart the Muse connection.",
        }[o] ?? "Connection closed. Restart from Muse to continue."),
        [
          "completed",
          "owner_closed",
          "authorization_denied",
          "bridge_expired",
          "bridge_closed",
        ].includes(o) && (c.disabled = !0));
    },
    n;
  try {
    (i.top !== i || i.location.hash) && r("top_level_required");
    let o = new URLSearchParams(i.location.search),
      l = o.get("owner_reuse") === "1";
    [...o.keys()].sort().join() !== (l ? "owner_reuse,request" : "request") && r("invalid_request");
    let k = f(o.get("request")),
      m = new AbortController(),
      x = setTimeout(() => m.abort(), 1e4),
      g;
    try {
      let p = await s("/agent/v2/controller/config", {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: m.signal,
      });
      (p.ok || r("configuration_unavailable"), (g = await A(p, m.signal, 32768)));
    } finally {
      clearTimeout(x);
    }
    n = new _({ config: g, requestId: k, host: i, fetchImpl: s, onState: a });
    let b = new URL("/agent/v2/helper/consent.html", g.issuer);
    b.searchParams.set("request", k);
    let C = e.getElementById("request-link");
    if (
      ((C.value = b.href),
      e.getElementById("copy-request").addEventListener("click", async () => {
        try {
          (await i.navigator.clipboard.writeText(b.href),
            (e.getElementById("copy-status").textContent = "Request link copied."));
        } catch {
          e.getElementById("copy-status").textContent = "Select and copy the request link above.";
        }
      }),
      e.getElementById("cancel").addEventListener("click", () => n.close()),
      l)
    ) {
      ((d.hidden = !0),
        (e.querySelector('label[for="owner-origin"]').hidden = !0),
        (c.hidden = !0),
        (e.getElementById("existing-page").hidden = !0),
        n.offer());
      return;
    }
    for (let p of g.ownerOrigins) {
      let v = e.createElement("option");
      ((v.value = p), (v.textContent = p), d.append(v));
    }
    ((t.textContent =
      "Continue in your FolioView window to sign in, unlock and review the requested access."),
      (c.disabled = !1),
      c.addEventListener("click", () => {
        try {
          (n.open(d.value), (c.disabled = !0));
        } catch {
          t.textContent =
            "Could not open the owner window. Allow this popup and restart the connection.";
        }
      }));
  } catch {
    (n?.close(),
      (t.textContent =
        "This connection page is unavailable or expired. Return to Muse and restart the connection."),
      (c.disabled = !0));
  }
}
typeof document < "u" && I();
export { _ as OwnerConsentBridge, q as checkedCallback, I as startConsentPage };
