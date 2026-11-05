import {
  ControllerDenied as d,
  reject as h,
  exact as o,
  identifier as c,
  bounded as p,
} from "./controller.mjs";
var n = "folioview.foreground-owner.v1",
  l = class {
    #r;
    #s;
    #a;
    #d;
    #i;
    #t;
    #c = !1;
    #e = !1;
    #o = !1;
    #h = new Set();
    #n;
    #p;
    #l;
    constructor({
      host: i = window,
      config: e,
      controller: s,
      ownerOrigin: t,
      nonce: r,
      onState: a = () => {},
    }) {
      ((i.top !== i ||
        !i.opener ||
        !e.ownerOrigins.includes(t) ||
        typeof r != "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(r) ||
        e.issuer !== i.location.origin) &&
        h("invalid_owner_pairing"),
        (this.#r = i),
        (this.#s = i.opener),
        (this.#a = t),
        (this.#d = r),
        (this.#t = s),
        (this.#l = a),
        i.addEventListener("message", this.#_),
        i.addEventListener("pagehide", this.#u),
        (this.#p = setInterval(() => {
          this.#s?.closed && this.close("owner_closed");
        }, 1e3)),
        this.#f(),
        this.#s.postMessage({ type: "fv-helper-owner-ready", profile: n, nonce: r }, t));
    }
    #f() {
      (clearTimeout(this.#n),
        (this.#n = setTimeout(() => this.close("owner_heartbeat_expired"), 9e4)));
    }
    #u = () => this.close("page_closed");
    #_ = (i) => {
      if (
        i.isTrusted === !0 &&
        !(this.#e || this.#c || i.source !== this.#s || i.origin !== this.#a)
      ) {
        try {
          if (
            (o(i.data, ["type", "profile", "nonce"]),
            i.data.type !== "fv-helper-owner-attached" ||
              i.data.profile !== n ||
              i.data.nonce !== this.#d ||
              i.ports?.length !== 1)
          )
            return;
        } catch {
          return;
        }
        this.#c = !0;
        try {
          this.#r.opener = null;
        } catch {}
        ((this.#i = i.ports[0]),
          (this.#i.onmessage = ({ data: e }) => {
            this.#w(e);
          }),
          (this.#i.onmessageerror = () => this.close("owner_disconnected")),
          this.#i.start(),
          this.#l("owner_attached"));
      }
    };
    async #w(i) {
      let e = "invalid",
        s = !1;
      try {
        ((this.#e || this.#o) && h("owner_channel_busy"),
          p(i, 131072),
          o(i, ["id", "profile", "op", "args"]),
          (e = c(i.id)),
          (i.profile !== n ||
            !["initialize", "confirm_delivery", "status", "lock"].includes(i.op) ||
            this.#h.has(e) ||
            this.#h.size >= 256) &&
            h("unsupported_operation"),
          i.op === "initialize"
            ? o(i.args, ["helperVersion", "workerSha256", "anchor", "ttlSeconds"])
            : o(i.args, i.op === "confirm_delivery" ? ["pin"] : []),
          this.#h.add(e),
          (this.#o = !0),
          (s = !0),
          this.#f());
        let t;
        if (
          (i.op === "initialize"
            ? (t = await this.#t.initialize(i.args))
            : i.op === "confirm_delivery"
              ? (t = await this.#t.confirmDelivery(i.args))
              : i.op === "status"
                ? (t = this.#t.status())
                : (this.#t.lock(), (t = this.#t.status())),
          this.#e)
        )
          return;
        (this.#i.postMessage({ id: e, ok: !0, data: t }),
          i.op === "lock" && this.close("owner_locked"));
      } catch (t) {
        this.#e ||
          this.#i?.postMessage({
            id: e,
            ok: !1,
            data: { code: t instanceof d ? t.code : "owner_operation_failed" },
          });
      } finally {
        s && (this.#o = !1);
      }
    }
    close(i = "owner_disconnected") {
      this.#e ||
        ((this.#e = !0),
        clearTimeout(this.#n),
        clearInterval(this.#p),
        this.#r.removeEventListener("message", this.#_),
        this.#r.removeEventListener("pagehide", this.#u),
        this.#i?.close(),
        (this.#i = void 0),
        (this.#s = void 0),
        this.#t.lock(i),
        this.#l(i));
    }
  };
export { n as OWNER_HELPER_PROFILE, l as OwnerHelperBridge };
