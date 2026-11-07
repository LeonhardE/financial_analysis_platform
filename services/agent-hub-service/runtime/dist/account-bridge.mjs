var u = "folioview.native-account-bridge.v1",
  l = "folioview.agent-workspace.v2.0",
  d = class extends Error {
    constructor(t) {
      (super(t), (this.code = t));
    }
  },
  o = (i) => {
    throw new d(i);
  };
function p(i, t) {
  (!i ||
    typeof i != "object" ||
    Array.isArray(i) ||
    Object.keys(i).sort().join("\0") !== [...t].sort().join("\0")) &&
    o("invalid_message");
}
function f(i) {
  return (
    (typeof i != "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(i)) && o("invalid_message"),
    i
  );
}
function y(i, t, s) {
  (typeof i != "string" || i.length > 8192 || /[\x00-\x20\x7f\\]/.test(i)) && o("invalid_callback");
  let e = new URL(i),
    a = t.clients.find((n) => n.clientId === s);
  return (
    (!a ||
      e.protocol !== "https:" ||
      e.username ||
      e.password ||
      e.hash ||
      !a.redirectUris.includes(e.origin + e.pathname) ||
      [...e.searchParams.keys()].sort().join(",") !== "code,iss,state" ||
      e.searchParams.get("iss") !== t.issuer + "/oauth/persistent" ||
      !e.searchParams.get("code") ||
      !e.searchParams.get("state")) &&
      o("invalid_callback"),
    e.href
  );
}
async function _(i, t) {
  (!i.headers.get("content-type")?.startsWith("application/json") || !i.body) &&
    o("invalid_response");
  let s = i.body.getReader(),
    e = [],
    a = 0;
  try {
    for (;;) {
      let r = await s.read();
      if ((t.aborted && o("bridge_closed"), r.done)) break;
      ((a += r.value.length), a > 32768 && o("invalid_response"), e.push(r.value));
    }
    let n = new Uint8Array(a),
      c = 0;
    for (let r of e) (n.set(r, c), (c += r.length));
    return JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(n));
  } finally {
    (s.cancel().catch(() => {}), s.releaseLock());
  }
}
var g = class {
  #r;
  #a;
  #t;
  #c;
  #s;
  #h;
  #e;
  #f = !1;
  #i = !1;
  #l = !1;
  #d = new Set();
  #p = null;
  #u;
  #g;
  #n;
  #o;
  #y;
  #_;
  constructor({
    config: t,
    requestId: s,
    host: e = window,
    fetchImpl: a = fetch,
    navigate: n = (r) => e.location.assign(r),
    onState: c = () => {},
  }) {
    (t?.contractVersion !== l ||
      t.runtimeVersion !== "1.0.0" ||
      t.issuer !== e.location.origin ||
      !Array.isArray(t.ownerOrigins) ||
      t.ownerOrigins.length < 1 ||
      t.ownerOrigins.length > 8 ||
      !Array.isArray(t.clients)) &&
      o("invalid_configuration");
    for (let r of t.ownerOrigins) {
      let h = new URL(r);
      (h.origin !== r ||
        !["https:", "http:"].includes(h.protocol) ||
        (h.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(h.hostname))) &&
        o("invalid_configuration");
    }
    ((this.#a = t),
      (this.#t = f(s)),
      (this.#r = e),
      (this.#u = (...r) => a(...r)),
      (this.#g = n),
      (this.#n = c),
      (this.#c = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "")),
      e.addEventListener("message", this.#w),
      e.addEventListener("pagehide", this.#m),
      (this.#y = setTimeout(() => this.close(), 18e5)));
  }
  open(t) {
    (this.#i || this.#s || !this.#a.ownerOrigins.includes(t)) && o("invalid_owner_origin");
    let s = new URL("/agents", t);
    (s.searchParams.set("native_request", this.#t),
      s.searchParams.set("native_nonce", this.#c),
      (this.#h = t),
      (this.#s = this.#r.open(s.href, "_blank")),
      this.#s || o("popup_blocked"),
      (this.#_ = setInterval(() => {
        this.#s.closed && this.close();
      }, 1e3)),
      this.#n("owner_opened"));
  }
  #m = () => this.close();
  #w = (t) => {
    if (
      t.isTrusted !== !0 ||
      this.#i ||
      this.#f ||
      t.source !== this.#s ||
      t.origin !== this.#h ||
      t.ports?.length
    )
      return;
    try {
      if (
        (p(t.data, ["type", "requestId", "nonce"]),
        t.data.type !== "fv-native-owner-ready" ||
          t.data.requestId !== this.#t ||
          t.data.nonce !== this.#c)
      )
        return;
    } catch {
      return;
    }
    let s = new MessageChannel();
    ((this.#e = s.port1),
      (this.#f = !0),
      (this.#e.onmessage = ({ data: e }) => {
        this.#b(e);
      }),
      this.#e.start(),
      this.#s.postMessage(
        { type: "fv-native-owner-attached", profile: u, requestId: this.#t, nonce: this.#c },
        this.#h,
        [s.port2],
      ),
      this.#n("owner_attached"));
  };
  async #b(t) {
    let s = "invalid",
      e = !1;
    try {
      ((this.#i || this.#l) && o("bridge_busy"),
        new TextEncoder().encode(JSON.stringify(t)).length > 24576 && o("payload_too_large"),
        p(t, ["id", "profile", "requestId", "op", "authorization", "json"]),
        (s = f(t.id)),
        (t.profile !== u ||
          t.requestId !== this.#t ||
          !["pending", "approve"].includes(t.op) ||
          typeof t.authorization != "string" ||
          t.authorization.length > 16384 ||
          !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(t.authorization) ||
          this.#d.has(s) ||
          this.#d.size >= 32) &&
          o("invalid_message"),
        p(t.json, t.op === "pending" ? ["contractVersion"] : ["contractVersion", "vaultId"]),
        t.json.contractVersion !== l && o("unsupported_contract"),
        t.op === "approve" && (f(t.json.vaultId), this.#p || o("pending_required")),
        this.#d.add(s),
        (this.#l = !0),
        (e = !0),
        (this.#o = new AbortController()));
      let a = setTimeout(() => this.#o?.abort(), 2e4),
        n;
      try {
        let c =
            "/api/v2/persistent-account-authorizations/" +
            this.#t +
            (t.op === "approve" ? "/approvals" : "/pending"),
          r = await this.#u(c, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: this.#o.signal,
            headers: {
              Authorization: "Bearer " + t.authorization,
              "Content-Type": "application/json",
              "X-FolioView-Contract": l,
            },
            body: JSON.stringify(t.json),
          });
        ((t.authorization = ""),
          r.ok || o(r.status === 401 ? "session_expired" : "account_link_unavailable"),
          (n = await _(r, this.#o.signal)));
      } finally {
        (clearTimeout(a), (t.authorization = ""));
      }
      if ((this.#i && o("bridge_closed"), t.op === "pending"))
        ((n.contractVersion !== l ||
          n.profile !== "folioview.persistent-account.v1" ||
          n.requestId !== this.#t ||
          n.scope !== "runtime:connect" ||
          n.authority !== "account_link_only" ||
          !this.#a.clients.some((c) => c.clientId === n.clientId)) &&
          o("invalid_response"),
          (this.#p = n.clientId),
          this.#e.postMessage({ id: s, ok: !0, value: n }));
      else {
        let c = y(n.redirectTo, this.#a, this.#p);
        (this.#e.postMessage({
          id: s,
          ok: !0,
          value: { state: "connected", authority: "account_link_only" },
        }),
          this.#n("connected"),
          this.#g(c),
          this.close());
      }
    } catch (a) {
      this.#i ||
        this.#e?.postMessage({
          id: s,
          ok: !1,
          error: a instanceof d ? a.code : "account_link_unavailable",
        });
    } finally {
      (e && (this.#l = !1),
        (this.#o = null),
        t && typeof t == "object" && "authorization" in t && (t.authorization = ""));
    }
  }
  close() {
    this.#i ||
      ((this.#i = !0),
      this.#o?.abort(),
      clearTimeout(this.#y),
      clearInterval(this.#_),
      this.#r.removeEventListener("message", this.#w),
      this.#r.removeEventListener("pagehide", this.#m),
      this.#e?.close(),
      this.#n("closed"));
  }
};
export {
  u as ACCOUNT_BRIDGE,
  d as AccountBridgeDenied,
  g as NativeAccountBridge,
  y as checkedNativeCallback,
};
