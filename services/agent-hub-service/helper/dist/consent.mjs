var m = "folioview.owner-consent-bridge.v1",
  g = "folioview.agent-workspace.v2.0",
  x = new TextEncoder(),
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
  C = (i, e) => {
    if (
      (h(
        e,
        i === "claim"
          ? ["contractVersion"]
          : i === "prepare_encrypted"
            ? ["contractVersion", "taskIds", "connectionId", "approvedScopes", "historyPolicy"]
            : ["contractVersion", "decision", "signedGrants"],
      ),
      e.contractVersion !== g && r("unsupported_contract"),
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
function I(i, e, s) {
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
  let a = [...t.searchParams.keys()].sort(),
    o = t.searchParams.has("error");
  (a.join("\0") !== (o ? ["error", "iss", "state"] : ["code", "iss", "state"]).join("\0") ||
    t.searchParams.get("iss") !== e.issuer ||
    !t.searchParams.get("state") ||
    (o ? t.searchParams.get("error") !== "access_denied" : !t.searchParams.get("code"))) &&
    r("invalid_redirect");
  for (let n of t.searchParams.values())
    (n.length > 4096 || /[\x00-\x1f\x7f]/.test(n)) && r("invalid_redirect");
  return t.href;
}
async function k(i, e, s = 1048576) {
  (i.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" ||
    !i.body) &&
    r("invalid_response");
  let t = i.body.getReader(),
    d = [],
    a = 0,
    o = () => {
      t.cancel().catch(() => {});
    };
  e.addEventListener("abort", o, { once: !0 });
  try {
    for (;;) {
      let l = await t.read();
      if ((e.aborted && r("bridge_closed"), l.done)) break;
      ((a += l.value.length), a > s && r("invalid_response"), d.push(l.value));
    }
    let n = new Uint8Array(a),
      c = 0;
    for (let l of d) (n.set(l, c), (c += l.length));
    return JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(n));
  } catch (n) {
    if (n instanceof u) throw n;
    r("invalid_response");
  } finally {
    (e.removeEventListener("abort", o), t.cancel().catch(() => {}), t.releaseLock());
  }
}
var y = class {
  #o;
  #a;
  #s;
  #c;
  #e;
  #d;
  #t;
  #u = !1;
  #i = !1;
  #h = !1;
  #l = new Set();
  #p = new Set();
  #r;
  #f;
  #g;
  #n;
  #y;
  #w;
  constructor({
    config: e,
    requestId: s,
    host: t = window,
    fetchImpl: d = fetch,
    navigate: a = (n) => t.location.assign(n),
    onState: o = () => {},
  }) {
    ((e?.profile !== m ||
      e.contractVersion !== g ||
      e.issuer !== t.location.origin ||
      !Array.isArray(e.ownerOrigins) ||
      !e.ownerOrigins.length ||
      e.ownerOrigins.length > 8 ||
      e.ownerOrigins.some((c) => {
        try {
          let l = new URL(c);
          return l.origin !== c || !["https:", "http:"].includes(l.protocol);
        } catch {
          return !0;
        }
      }) ||
      !Array.isArray(e.clients)) &&
      r("invalid_configuration"),
      (this.#o = e),
      (this.#s = f(s)),
      (this.#a = t),
      (this.#f = d),
      (this.#g = a),
      (this.#n = o));
    let n = crypto.getRandomValues(new Uint8Array(32));
    ((this.#c = btoa(String.fromCharCode(...n))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")),
      t.addEventListener("message", this.#m),
      t.addEventListener("pagehide", this.#_),
      (this.#y = setTimeout(() => this.close("bridge_expired"), 6e5)));
  }
  open(e) {
    ((this.#i || this.#e || !this.#o.ownerOrigins.includes(e)) && r("invalid_owner_origin"),
      (this.#d = e));
    let s = new URL("/", e);
    (s.searchParams.set("agent_request", this.#s),
      s.searchParams.set("agent_nonce", this.#c),
      (this.#e = this.#a.open(s.href, "_blank")),
      this.#e || ((this.#d = void 0), r("popup_blocked")),
      (this.#w = setInterval(() => {
        this.#e?.closed && this.close("owner_closed");
      }, 1e3)),
      this.#n("owner_opened"));
  }
  #_ = () => this.close("bridge_closed");
  #m = (e) => {
    if (
      e.isTrusted !== !0 ||
      this.#i ||
      this.#u ||
      !this.#e ||
      e.source !== this.#e ||
      e.origin !== this.#d ||
      e.ports?.length
    )
      return;
    try {
      if (
        (h(e.data, ["type", "requestId", "nonce"]),
        e.data.type !== "fv-owner-consent-ready" ||
          e.data.requestId !== this.#s ||
          e.data.nonce !== this.#c)
      )
        return;
    } catch {
      return;
    }
    this.#u = !0;
    let s = new MessageChannel();
    ((this.#t = s.port1),
      (this.#t.onmessage = ({ data: t }) => {
        this.#b(t);
      }),
      this.#t.start(),
      this.#e.postMessage(
        { type: "fv-owner-consent-attached", profile: m, requestId: this.#s, nonce: this.#c },
        this.#d,
        [s.port2],
      ),
      this.#n("owner_attached"));
  };
  async #b(e) {
    let s = "invalid",
      t,
      d = !1;
    try {
      ((this.#i || this.#h) && r("bridge_busy"),
        x.encode(JSON.stringify(e)).length > 131072 && r("payload_too_large"),
        h(e, ["id", "profile", "requestId", "op", "authorization", "json"]),
        (s = f(e.id)),
        (e.profile !== m ||
          e.requestId !== this.#s ||
          !["claim", "prepare_encrypted", "decision"].includes(e.op) ||
          typeof e.authorization != "string" ||
          e.authorization.length > 16384 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(e.authorization) ||
          this.#p.has(s) ||
          this.#p.size >= 128) &&
          r("invalid_message"),
        C(e.op, e.json),
        e.op !== "claim" && !this.#r && r("claim_required"),
        this.#p.add(s),
        (this.#h = !0),
        (d = !0),
        (t = new AbortController()),
        this.#l.add(t));
      let a = setTimeout(() => t.abort(), 2e4),
        o;
      try {
        let n = `/api/v2/agent-authorizations/${this.#s}/${e.op === "prepare_encrypted" ? "prepare-encrypted" : e.op}`,
          c = await this.#f(n, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal: t.signal,
            headers: {
              Authorization: `Bearer ${e.authorization}`,
              "X-FolioView-Contract": g,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(e.json),
          });
        ((e.authorization = ""),
          c.ok ||
            ((c.status === 401 || c.status === 403) &&
              (this.#t.postMessage({
                id: s,
                ok: !1,
                data: { code: c.status === 401 ? "session_expired" : "insufficient_scope" },
              }),
              this.close("authorization_denied"),
              r("authorization_denied")),
            r(c.status === 409 ? "version_conflict" : "request_failed")),
          (o = await k(c, t.signal)));
      } finally {
        (clearTimeout(a), (e.authorization = ""));
      }
      if (
        ((this.#i || t.signal.aborted || this.#e?.closed) && r("bridge_closed"),
        e.op === "decision")
      ) {
        h(o, ["redirectUri"]);
        let n = I(o.redirectUri, this.#o, this.#r);
        (this.#t.postMessage({ id: s, ok: !0, data: { completed: !0 } }),
          this.#n("completed"),
          this.close("completed"),
          this.#g(n));
      } else
        (h(o, [
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
          (o.contractVersion !== g ||
            o.provider !== "muse" ||
            !this.#o.clients.some((n) => n.clientId === o.clientId) ||
            (this.#r && this.#r !== o.clientId)) &&
            r("invalid_response"),
          (this.#r = o.clientId),
          this.#t.postMessage({ id: s, ok: !0, data: o }));
    } catch (a) {
      (e && typeof e == "object" && (e.authorization = ""),
        this.#i ||
          this.#t?.postMessage({
            id: s,
            ok: !1,
            data: { code: a instanceof u ? a.code : "request_failed" },
          }));
    } finally {
      (t && this.#l.delete(t), d && (this.#h = !1));
    }
  }
  close(e = "bridge_closed") {
    if (!this.#i) {
      ((this.#i = !0), clearTimeout(this.#y), clearInterval(this.#w));
      for (let s of this.#l) s.abort();
      (this.#l.clear(),
        this.#a.removeEventListener("message", this.#m),
        this.#a.removeEventListener("pagehide", this.#_),
        this.#t?.close(),
        (this.#t = void 0),
        (this.#e = void 0),
        this.#n(e));
    }
  }
};
async function b({ host: i = window, document: e = document, fetchImpl: s = fetch } = {}) {
  let t = e.getElementById("status"),
    d = e.getElementById("owner-origin"),
    a = e.getElementById("continue"),
    o = (n) => {
      ((t.textContent =
        {
          owner_opened: "Review the connection in your FolioView window.",
          owner_attached: "Connected to your owner window. Review and approve there.",
          completed: "Decision completed. Returning to Muse\u2026",
          owner_closed: "The owner window closed. Restart the Muse connection to continue.",
          authorization_denied: "Authorization was denied. Restart from Muse and sign in again.",
          bridge_expired: "This request expired. Restart the Muse connection.",
        }[n] ?? "Connection closed. Restart from Muse to continue."),
        [
          "completed",
          "owner_closed",
          "authorization_denied",
          "bridge_expired",
          "bridge_closed",
        ].includes(n) && (a.disabled = !0));
    };
  try {
    (i.top !== i || i.location.hash) && r("top_level_required");
    let n = new URLSearchParams(i.location.search);
    [...n.keys()].join() !== "request" && r("invalid_request");
    let c = f(n.get("request")),
      l = new AbortController(),
      A = setTimeout(() => l.abort(), 1e4),
      w;
    try {
      let p = await s("/agent/v2/controller/config", {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: l.signal,
      });
      (p.ok || r("configuration_unavailable"), (w = await k(p, l.signal, 32768)));
    } finally {
      clearTimeout(A);
    }
    let v = new y({ config: w, requestId: c, host: i, fetchImpl: s, onState: o });
    for (let p of w.ownerOrigins) {
      let _ = e.createElement("option");
      ((_.value = p), (_.textContent = p), d.append(_));
    }
    ((t.textContent =
      "Continue in your FolioView window to sign in, unlock and review the requested access."),
      (a.disabled = !1),
      a.addEventListener("click", () => {
        try {
          (v.open(d.value), (a.disabled = !0));
        } catch {
          t.textContent =
            "Could not open the owner window. Allow this popup and restart the connection.";
        }
      }),
      e.getElementById("cancel").addEventListener("click", () => v.close()));
  } catch {
    ((t.textContent =
      "This connection page is unavailable or expired. Return to Muse and restart the connection."),
      (a.disabled = !0));
  }
}
typeof document < "u" && b();
export { y as OwnerConsentBridge, I as checkedCallback, b as startConsentPage };
