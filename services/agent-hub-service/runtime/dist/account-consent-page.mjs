var _ = "folioview.native-account-bridge.v1",
  l = "folioview.agent-workspace.v2.0",
  d = class extends Error {
    constructor(t) {
      (super(t), (this.code = t));
    }
  },
  o = (i) => {
    throw new d(i);
  };
function f(i, t) {
  (!i ||
    typeof i != "object" ||
    Array.isArray(i) ||
    Object.keys(i).sort().join("\0") !== [...t].sort().join("\0")) &&
    o("invalid_message");
}
function g(i) {
  return (
    (typeof i != "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(i)) && o("invalid_message"),
    i
  );
}
function w(i, t, s) {
  (typeof i != "string" || i.length > 8192 || /[\x00-\x20\x7f\\]/.test(i)) && o("invalid_callback");
  let e = new URL(i),
    n = t.clients.find((r) => r.clientId === s);
  return (
    (!n ||
      e.protocol !== "https:" ||
      e.username ||
      e.password ||
      e.hash ||
      !n.redirectUris.includes(e.origin + e.pathname) ||
      [...e.searchParams.keys()].sort().join(",") !== "code,iss,state" ||
      e.searchParams.get("iss") !== t.issuer + "/oauth/persistent" ||
      !e.searchParams.get("code") ||
      !e.searchParams.get("state")) &&
      o("invalid_callback"),
    e.href
  );
}
async function m(i, t) {
  (!i.headers.get("content-type")?.startsWith("application/json") || !i.body) &&
    o("invalid_response");
  let s = i.body.getReader(),
    e = [],
    n = 0;
  try {
    for (;;) {
      let a = await s.read();
      if ((t.aborted && o("bridge_closed"), a.done)) break;
      ((n += a.value.length), n > 32768 && o("invalid_response"), e.push(a.value));
    }
    let r = new Uint8Array(n),
      c = 0;
    for (let a of e) (r.set(a, c), (c += a.length));
    return JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(r));
  } finally {
    (s.cancel().catch(() => {}), s.releaseLock());
  }
}
var p = class {
  #r;
  #a;
  #t;
  #c;
  #s;
  #h;
  #e;
  #u = !1;
  #i = !1;
  #l = !1;
  #d = new Set();
  #p = null;
  #f;
  #g;
  #n;
  #o;
  #y;
  #_;
  constructor({
    config: t,
    requestId: s,
    host: e = window,
    fetchImpl: n = fetch,
    navigate: r = (a) => e.location.assign(a),
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
    for (let a of t.ownerOrigins) {
      let h = new URL(a);
      (h.origin !== a ||
        !["https:", "http:"].includes(h.protocol) ||
        (h.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(h.hostname))) &&
        o("invalid_configuration");
    }
    ((this.#a = t),
      (this.#t = g(s)),
      (this.#r = e),
      (this.#f = (...a) => n(...a)),
      (this.#g = r),
      (this.#n = c),
      (this.#c = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "")),
      e.addEventListener("message", this.#m),
      e.addEventListener("pagehide", this.#w),
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
  #w = () => this.close();
  #m = (t) => {
    if (
      t.isTrusted !== !0 ||
      this.#i ||
      this.#u ||
      t.source !== this.#s ||
      t.origin !== this.#h ||
      t.ports?.length
    )
      return;
    try {
      if (
        (f(t.data, ["type", "requestId", "nonce"]),
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
      (this.#u = !0),
      (this.#e.onmessage = ({ data: e }) => {
        this.#b(e);
      }),
      this.#e.start(),
      this.#s.postMessage(
        { type: "fv-native-owner-attached", profile: _, requestId: this.#t, nonce: this.#c },
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
        f(t, ["id", "profile", "requestId", "op", "authorization", "json"]),
        (s = g(t.id)),
        (t.profile !== _ ||
          t.requestId !== this.#t ||
          !["pending", "approve"].includes(t.op) ||
          typeof t.authorization != "string" ||
          t.authorization.length > 16384 ||
          !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(t.authorization) ||
          this.#d.has(s) ||
          this.#d.size >= 32) &&
          o("invalid_message"),
        f(t.json, t.op === "pending" ? ["contractVersion"] : ["contractVersion", "vaultId"]),
        t.json.contractVersion !== l && o("unsupported_contract"),
        t.op === "approve" && (g(t.json.vaultId), this.#p || o("pending_required")),
        this.#d.add(s),
        (this.#l = !0),
        (e = !0),
        (this.#o = new AbortController()));
      let n = setTimeout(() => this.#o?.abort(), 2e4),
        r;
      try {
        let c =
            "/api/v2/persistent-account-authorizations/" +
            this.#t +
            (t.op === "approve" ? "/approvals" : "/pending"),
          a = await this.#f(c, {
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
          a.ok || o(a.status === 401 ? "session_expired" : "account_link_unavailable"),
          (r = await m(a, this.#o.signal)));
      } finally {
        (clearTimeout(n), (t.authorization = ""));
      }
      if ((this.#i && o("bridge_closed"), t.op === "pending"))
        ((r.contractVersion !== l ||
          r.profile !== "folioview.persistent-account.v1" ||
          r.requestId !== this.#t ||
          r.scope !== "runtime:connect" ||
          r.authority !== "account_link_only" ||
          !this.#a.clients.some((c) => c.clientId === r.clientId)) &&
          o("invalid_response"),
          (this.#p = r.clientId),
          this.#e.postMessage({ id: s, ok: !0, value: r }));
      else {
        let c = w(r.redirectTo, this.#a, this.#p);
        (this.#e.postMessage({
          id: s,
          ok: !0,
          value: { state: "connected", authority: "account_link_only" },
        }),
          this.#n("connected"),
          this.#g(c),
          this.close());
      }
    } catch (n) {
      this.#i ||
        this.#e?.postMessage({
          id: s,
          ok: !1,
          error: n instanceof d ? n.code : "account_link_unavailable",
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
      this.#r.removeEventListener("message", this.#m),
      this.#r.removeEventListener("pagehide", this.#w),
      this.#e?.close(),
      this.#n("closed"));
  }
};
var u = document.querySelector("#status"),
  y = document.querySelector("#continue");
try {
  let i = new URLSearchParams(location.search);
  if ([...i.keys()].join(",") !== "request") throw Error("invalid_request");
  let t = await fetch("/agent/v3/runtime/config", {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!t.ok) throw Error("unavailable");
  let s = await t.json(),
    e = new p({
      config: s,
      requestId: i.get("request"),
      onState: (n) => {
        n === "connected"
          ? (u.textContent = "\u5DF2\u5173\u8054 Muse\uFF0C\u6B63\u5728\u8FD4\u56DE\u2026")
          : (n === "owner_opened" || n === "owner_attached") &&
            (u.textContent = "\u8BF7\u5728 FolioView \u4E2D\u786E\u8BA4\u8FDE\u63A5\u3002");
      },
    });
  ((y.hidden = !1),
    (y.onclick = () => {
      try {
        (e.open(s.ownerOrigins[0]), (y.disabled = !0));
      } catch {
        u.textContent =
          "\u8BF7\u5141\u8BB8\u6253\u5F00 FolioView \u9875\u9762\u540E\u91CD\u8BD5\u3002";
      }
    }));
} catch {
  u.textContent =
    "\u8FDE\u63A5\u8BF7\u6C42\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u4ECE Muse \u91CD\u8BD5\u3002";
}
