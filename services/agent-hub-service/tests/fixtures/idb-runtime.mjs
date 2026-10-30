var S = {
    AbortError: "A request was aborted, for example through a call to IDBTransaction.abort.",
    ConstraintError:
      "A mutation operation in the transaction failed because a constraint was not satisfied. For example, an object such as an object store or index already exists and a request attempted to create a new one.",
    DataCloneError:
      "The data being stored could not be cloned by the internal structured cloning algorithm.",
    DataError: "Data provided to an operation does not meet requirements.",
    InvalidAccessError:
      "An invalid operation was performed on an object. For example transaction creation attempt was made, but an empty scope was provided.",
    InvalidStateError:
      "An operation was called on an object on which it is not allowed or at a time when it is not allowed. Also occurs if a request is made on a source object that has been deleted or removed. Use TransactionInactiveError or ReadOnlyError when possible, as they are more specific variations of InvalidStateError.",
    NotFoundError:
      "The operation failed because the requested database object could not be found. For example, an object store did not exist but was being opened.",
    ReadOnlyError: 'The mutating operation was attempted in a "readonly" transaction.',
    TransactionInactiveError:
      "A request was placed against a transaction which is currently not active, or which is finished.",
    SyntaxError: "The keypath argument contains an invalid key path",
    VersionError:
      "An attempt was made to open a database using a lower version than the existing version.",
  },
  Y = (n, e) => {
    Object.defineProperty(n, "code", { value: e, writable: !1, enumerable: !0, configurable: !1 });
  },
  V = class extends DOMException {
    constructor(e = S.AbortError) {
      super(e, "AbortError");
    }
  },
  y = class extends DOMException {
    constructor(e = S.ConstraintError) {
      super(e, "ConstraintError");
    }
  };
var w = class extends DOMException {
    constructor(e = S.DataError) {
      (super(e, "DataError"), Y(this, 0));
    }
  },
  v = class extends DOMException {
    constructor(e = S.InvalidAccessError) {
      super(e, "InvalidAccessError");
    }
  },
  d = class extends DOMException {
    constructor(e = S.InvalidStateError) {
      (super(e, "InvalidStateError"), Y(this, 11));
    }
  },
  x = class extends DOMException {
    constructor(e = S.NotFoundError) {
      super(e, "NotFoundError");
    }
  },
  j = class extends DOMException {
    constructor(e = S.ReadOnlyError) {
      super(e, "ReadOnlyError");
    }
  },
  K = class extends DOMException {
    constructor(e = S.VersionError) {
      (super(e, "SyntaxError"), Y(this, 12));
    }
  },
  D = class extends DOMException {
    constructor(e = S.TransactionInactiveError) {
      (super(e, "TransactionInactiveError"), Y(this, 0));
    }
  },
  H = class extends DOMException {
    constructor(e = S.VersionError) {
      super(e, "VersionError");
    }
  };
function Q(n) {
  return typeof SharedArrayBuffer < "u" && n instanceof SharedArrayBuffer;
}
var L = Symbol("INVALID_TYPE"),
  O = Symbol("INVALID_VALUE"),
  ke = (n, e) => {
    if (typeof n == "number") return isNaN(n) ? O : n;
    if (Object.prototype.toString.call(n) === "[object Date]") {
      let t = n.valueOf();
      return isNaN(t) ? O : new Date(t);
    } else {
      if (typeof n == "string") return n;
      if (
        n instanceof ArrayBuffer ||
        Q(n) ||
        (typeof ArrayBuffer < "u" && ArrayBuffer.isView && ArrayBuffer.isView(n))
      ) {
        if ("detached" in n ? n.detached : n.byteLength === 0) return O;
        let t,
          r = 0,
          u = 0;
        return (
          n instanceof ArrayBuffer || Q(n)
            ? ((t = n), (u = n.byteLength))
            : ((t = n.buffer), (r = n.byteOffset), (u = n.byteLength)),
          t.slice(r, r + u)
        );
      } else if (Array.isArray(n)) {
        if (e === void 0) e = new Set();
        else if (e.has(n)) return O;
        e.add(n);
        let t = !1,
          r = Array.from({ length: n.length }, (u, s) => {
            if (t) return;
            if (!Object.hasOwn(n, s)) {
              t = !0;
              return;
            }
            let i = n[s],
              o = ke(i, e);
            if (o === O || o === L) {
              t = !0;
              return;
            }
            return o;
          });
        return t ? O : r;
      } else return L;
    }
  },
  X = ke;
var tt = (n, e) => {
    let t = X(n, e);
    if (t === O || t === L) throw new w();
    return t;
  },
  f = tt;
var Ne = (n) => {
    if (typeof n == "number") return "Number";
    if (Object.prototype.toString.call(n) === "[object Date]") return "Date";
    if (Array.isArray(n)) return "Array";
    if (typeof n == "string") return "String";
    if (n instanceof ArrayBuffer) return "Binary";
    throw new w();
  },
  A = (n, e) => {
    let t = Ne(n),
      r = Ne(e);
    if (t !== r)
      return t === "Array" ||
        (t === "Binary" && (r === "String" || r === "Date" || r === "Number")) ||
        (t === "String" && (r === "Date" || r === "Number")) ||
        (t === "Date" && r === "Number")
        ? 1
        : -1;
    if (t === "Binary") {
      let u = new Uint8Array(n),
        s = new Uint8Array(e),
        a = u.length,
        i = s.length,
        o = Math.min(a, i);
      for (let c = 0; c < o; c++) {
        if (u[c] > s[c]) return 1;
        if (u[c] < s[c]) return -1;
      }
      return a > i ? 1 : a < i ? -1 : 0;
    }
    if (t === "Array") {
      let u = Math.min(n.length, e.length);
      for (let s = 0; s < u; s++) {
        let a = A(n[s], e[s]);
        if (a !== 0) return a;
      }
      return n.length > e.length ? 1 : n.length < e.length ? -1 : 0;
    }
    if (t === "Date") {
      if (n.getTime() === e.getTime()) return 0;
    } else if (n === e) return 0;
    return n > e ? 1 : -1;
  },
  rt = (n, e) => {
    if (e === void 0) throw new TypeError();
    return A(f(n), f(e));
  },
  Z = rt;
var ae = class n {
    static only(e) {
      if (arguments.length === 0) throw new TypeError();
      return ((e = f(e)), new n(e, e, !1, !1));
    }
    static lowerBound(e, t = !1) {
      if (arguments.length === 0) throw new TypeError();
      return ((e = f(e)), new n(e, void 0, t, !0));
    }
    static upperBound(e, t = !1) {
      if (arguments.length === 0) throw new TypeError();
      return ((e = f(e)), new n(void 0, e, !0, t));
    }
    static bound(e, t, r = !1, u = !1) {
      if (arguments.length < 2) throw new TypeError();
      ((e = f(e)), (t = f(t)));
      let s = A(e, t);
      if (s === 1 || (s === 0 && (r || u))) throw new w();
      return new n(e, t, r, u);
    }
    constructor(e, t, r, u) {
      ((this.lower = e), (this.upper = t), (this.lowerOpen = r), (this.upperOpen = u));
    }
    includes(e) {
      if (arguments.length === 0) throw new TypeError();
      if (((e = f(e)), this.lower !== void 0)) {
        let t = A(this.lower, e);
        if (t === 1 || (t === 0 && this.lowerOpen)) return !1;
      }
      if (this.upper !== void 0) {
        let t = A(this.upper, e);
        if (t === -1 || (t === 0 && this.upperOpen)) return !1;
      }
      return !0;
    }
    get [Symbol.toStringTag]() {
      return "IDBKeyRange";
    }
  },
  l = ae;
var Ve = (n, e) => {
    if (Array.isArray(n)) {
      let u = [];
      for (let s of n) {
        s != null && typeof s != "string" && s.toString && (s = s.toString());
        let a = Ve(s, e).key;
        u.push(f(a));
      }
      return { type: "found", key: u };
    }
    if (n === "") return { type: "found", key: e };
    let t = n,
      r = e;
    for (; t !== null;) {
      let u,
        s = t.indexOf(".");
      if (
        (s >= 0 ? ((u = t.slice(0, s)), (t = t.slice(s + 1))) : ((u = t), (t = null)),
        !(
          (u === "length" && (typeof r == "string" || Array.isArray(r))) ||
          ((u === "size" || u === "type") && typeof Blob < "u" && r instanceof Blob) ||
          ((u === "name" || u === "lastModified") && typeof File < "u" && r instanceof File)
        ) &&
          (typeof r != "object" || r === null || !Object.hasOwn(r, u)))
      )
        return { type: "notFound" };
      r = r[u];
    }
    return { type: "found", key: r };
  },
  T = Ve;
function J(n, e) {
  if (e._state !== "active") throw new Error("Assert: transaction state is active");
  e._state = "inactive";
  try {
    return structuredClone(n);
  } finally {
    e._state = "active";
  }
}
var U = (n) => (n.source instanceof B ? n.source : n.source.objectStore),
  ee = (n, e, t) => {
    let r = n !== void 0 ? n.lower : void 0,
      u = n !== void 0 ? n.upper : void 0;
    for (let s of e) s !== void 0 && (r === void 0 || A(r, s) === 1) && (r = s);
    for (let s of t) s !== void 0 && (u === void 0 || A(u, s) === -1) && (u = s);
    if (r !== void 0 && u !== void 0) return l.bound(r, u);
    if (r !== void 0) return l.lowerBound(r);
    if (u !== void 0) return l.upperBound(u);
  },
  ce = class {
    _gotValue = !1;
    _position = void 0;
    _objectStorePosition = void 0;
    _keyOnly = !1;
    _key = void 0;
    _primaryKey = void 0;
    constructor(e, t, r = "next", u, s = !1) {
      ((this._range = t),
        (this._source = e),
        (this._direction = r),
        (this._request = u),
        (this._keyOnly = s));
    }
    get source() {
      return this._source;
    }
    set source(e) {}
    get request() {
      return this._request;
    }
    set request(e) {}
    get direction() {
      return this._direction;
    }
    set direction(e) {}
    get key() {
      return this._key;
    }
    set key(e) {}
    get primaryKey() {
      return this._primaryKey;
    }
    set primaryKey(e) {}
    _iterate(e, t) {
      let r = this.source instanceof B,
        u =
          this.source instanceof B
            ? this.source._rawObjectStore.records
            : this.source._rawIndex.records,
        s;
      if (this.direction === "next") {
        let i = ee(this._range, [e, this._position], []);
        for (let o of u.values(i)) {
          let c = e !== void 0 ? A(o.key, e) : void 0,
            h = this._position !== void 0 ? A(o.key, this._position) : void 0;
          if (!(e !== void 0 && c === -1)) {
            if (t !== void 0) {
              if (c === -1) continue;
              let p = A(o.value, t);
              if (c === 0 && p === -1) continue;
            }
            if (
              !(this._position !== void 0 && r && h !== 1) &&
              !(
                this._position !== void 0 &&
                !r &&
                (h === -1 || (h === 0 && A(o.value, this._objectStorePosition) !== 1))
              ) &&
              !(this._range !== void 0 && !this._range.includes(o.key))
            ) {
              s = o;
              break;
            }
          }
        }
      } else if (this.direction === "nextunique") {
        let i = ee(this._range, [e, this._position], []);
        for (let o of u.values(i))
          if (
            !(e !== void 0 && A(o.key, e) === -1) &&
            !(this._position !== void 0 && A(o.key, this._position) !== 1) &&
            !(this._range !== void 0 && !this._range.includes(o.key))
          ) {
            s = o;
            break;
          }
      } else if (this.direction === "prev") {
        let i = ee(this._range, [], [e, this._position]);
        for (let o of u.values(i, "prev")) {
          let c = e !== void 0 ? A(o.key, e) : void 0,
            h = this._position !== void 0 ? A(o.key, this._position) : void 0;
          if (!(e !== void 0 && c === 1)) {
            if (t !== void 0) {
              if (c === 1) continue;
              let p = A(o.value, t);
              if (c === 0 && p === 1) continue;
            }
            if (
              !(this._position !== void 0 && r && h !== -1) &&
              !(
                this._position !== void 0 &&
                !r &&
                (h === 1 || (h === 0 && A(o.value, this._objectStorePosition) !== -1))
              ) &&
              !(this._range !== void 0 && !this._range.includes(o.key))
            ) {
              s = o;
              break;
            }
          }
        }
      } else if (this.direction === "prevunique") {
        let i,
          o = ee(this._range, [], [e, this._position]);
        for (let c of u.values(o, "prev"))
          if (
            !(e !== void 0 && A(c.key, e) === 1) &&
            !(this._position !== void 0 && A(c.key, this._position) !== -1) &&
            !(this._range !== void 0 && !this._range.includes(c.key))
          ) {
            i = c;
            break;
          }
        i && (s = u.get(i.key));
      }
      let a;
      if (!s)
        ((this._key = void 0),
          r || (this._objectStorePosition = void 0),
          !this._keyOnly &&
            this.toString() === "[object IDBCursorWithValue]" &&
            (this.value = void 0),
          (a = null));
      else {
        if (
          ((this._position = s.key),
          r || (this._objectStorePosition = s.value),
          (this._key = s.key),
          r)
        )
          ((this._primaryKey = structuredClone(s.key)),
            !this._keyOnly &&
              this.toString() === "[object IDBCursorWithValue]" &&
              (this.value = structuredClone(s.value)));
        else if (
          ((this._primaryKey = structuredClone(s.value)),
          !this._keyOnly && this.toString() === "[object IDBCursorWithValue]")
        ) {
          if (this.source instanceof B) throw new Error("This should never happen");
          let i = this.source.objectStore._rawObjectStore.getValue(s.value);
          this.value = structuredClone(i);
        }
        ((this._gotValue = !0), (a = this));
      }
      return a;
    }
    update(e) {
      if (e === void 0) throw new TypeError();
      let t = U(this),
        r = Object.hasOwn(this.source, "_rawIndex") ? this.primaryKey : this._position,
        u = t.transaction;
      if (u._state !== "active") throw new D();
      if (u.mode === "readonly") throw new j();
      if (t._rawObjectStore.deleted) throw new d();
      if (!(this.source instanceof B) && this.source._rawIndex.deleted) throw new d();
      if (!this._gotValue || !Object.hasOwn(this, "value")) throw new d();
      let s = J(e, u);
      if (t.keyPath !== null) {
        let i;
        try {
          i = T(t.keyPath, s).key;
        } catch {}
        if (Z(i, r) !== 0) throw new w();
      }
      let a = { key: r, value: s };
      return u._execRequestAsync({
        operation: t._rawObjectStore.storeRecord.bind(t._rawObjectStore, a, !1, u._rollbackLog),
        source: this,
      });
    }
    advance(e) {
      if (!Number.isInteger(e) || e <= 0) throw new TypeError();
      let t = U(this),
        r = t.transaction;
      if (r._state !== "active") throw new D();
      if (t._rawObjectStore.deleted) throw new d();
      if (!(this.source instanceof B) && this.source._rawIndex.deleted) throw new d();
      if (!this._gotValue) throw new d();
      (this._request && (this._request.readyState = "pending"),
        r._execRequestAsync({
          operation: () => {
            let u;
            for (let s = 0; s < e && ((u = this._iterate()), !!u); s++);
            return u;
          },
          request: this._request,
          source: this.source,
        }),
        (this._gotValue = !1));
    }
    continue(e) {
      let t = U(this),
        r = t.transaction;
      if (r._state !== "active") throw new D();
      if (t._rawObjectStore.deleted) throw new d();
      if (!(this.source instanceof B) && this.source._rawIndex.deleted) throw new d();
      if (!this._gotValue) throw new d();
      if (e !== void 0) {
        e = f(e);
        let u = A(e, this._position);
        if (
          (u <= 0 && (this.direction === "next" || this.direction === "nextunique")) ||
          (u >= 0 && (this.direction === "prev" || this.direction === "prevunique"))
        )
          throw new w();
      }
      (this._request && (this._request.readyState = "pending"),
        r._execRequestAsync({
          operation: this._iterate.bind(this, e),
          request: this._request,
          source: this.source,
        }),
        (this._gotValue = !1));
    }
    continuePrimaryKey(e, t) {
      let r = U(this),
        u = r.transaction;
      if (u._state !== "active") throw new D();
      if (r._rawObjectStore.deleted) throw new d();
      if (!(this.source instanceof B) && this.source._rawIndex.deleted) throw new d();
      if (this.source instanceof B || (this.direction !== "next" && this.direction !== "prev"))
        throw new v();
      if (!this._gotValue) throw new d();
      if (e === void 0 || t === void 0) throw new w();
      e = f(e);
      let s = A(e, this._position);
      if ((s === -1 && this.direction === "next") || (s === 1 && this.direction === "prev"))
        throw new w();
      t = f(t);
      let a = A(t, this._objectStorePosition);
      if (
        s === 0 &&
        ((a <= 0 && this.direction === "next") || (a >= 0 && this.direction === "prev"))
      )
        throw new w();
      (this._request && (this._request.readyState = "pending"),
        u._execRequestAsync({
          operation: this._iterate.bind(this, e, t),
          request: this._request,
          source: this.source,
        }),
        (this._gotValue = !1));
    }
    delete() {
      let e = U(this),
        t = Object.hasOwn(this.source, "_rawIndex") ? this.primaryKey : this._position,
        r = e.transaction;
      if (r._state !== "active") throw new D();
      if (r.mode === "readonly") throw new j();
      if (e._rawObjectStore.deleted) throw new d();
      if (!(this.source instanceof B) && this.source._rawIndex.deleted) throw new d();
      if (!this._gotValue || !Object.hasOwn(this, "value")) throw new d();
      return r._execRequestAsync({
        operation: e._rawObjectStore.deleteRecord.bind(e._rawObjectStore, t, r._rollbackLog),
        source: this,
      });
    }
    get [Symbol.toStringTag]() {
      return "IDBCursor";
    }
  },
  P = ce;
var de = class extends P {
    value = void 0;
    constructor(e, t, r, u) {
      super(e, t, r, u);
    }
    get [Symbol.toStringTag]() {
      return "IDBCursorWithValue";
    }
  },
  W = de;
var Ke = (n, e) =>
    n.immediatePropagationStopped ||
    (n.eventPhase === n.CAPTURING_PHASE && e.capture === !1) ||
    (n.eventPhase === n.BUBBLING_PHASE && e.capture === !0),
  le = (n, e) => {
    n.currentTarget = e;
    let t = [],
      r = (i) => {
        try {
          (typeof i == "function" ? i : i.handleEvent).call(n.currentTarget, n);
        } catch (o) {
          t.push(o);
        }
      };
    for (let i of e.listeners.slice()) n.type !== i.type || Ke(n, i) || r(i.callback);
    let s = {
      abort: "onabort",
      blocked: "onblocked",
      close: "onclose",
      complete: "oncomplete",
      error: "onerror",
      success: "onsuccess",
      upgradeneeded: "onupgradeneeded",
      versionchange: "onversionchange",
    }[n.type];
    if (s === void 0) throw new Error(`Unknown event type: "${n.type}"`);
    let a = n.currentTarget[s];
    if (a) {
      let i = { callback: a, capture: !1, type: n.type };
      Ke(n, i) || r(i.callback);
    }
    if (t.length) throw new AggregateError(t);
  },
  fe = class {
    listeners = [];
    addEventListener(e, t, r) {
      let u = !!(typeof r == "object" && r ? r.capture : r);
      this.listeners.push({ callback: t, capture: u, type: e });
    }
    removeEventListener(e, t, r) {
      let u = !!(typeof r == "object" && r ? r.capture : r),
        s = this.listeners.findIndex((a) => a.type === e && a.callback === t && a.capture === u);
      this.listeners.splice(s, 1);
    }
    dispatchEvent(e) {
      if (e.dispatched || !e.initialized) throw new d("The object is in an invalid state.");
      ((e.isTrusted = !1),
        (e.dispatched = !0),
        (e.target = this),
        (e.eventPhase = e.CAPTURING_PHASE));
      for (let t of e.eventPath) e.propagationStopped || le(e, t);
      if (((e.eventPhase = e.AT_TARGET), e.propagationStopped || le(e, e.target), e.bubbles)) {
        (e.eventPath.reverse(), (e.eventPhase = e.BUBBLING_PHASE));
        for (let t of e.eventPath) e.propagationStopped || le(e, t);
      }
      return ((e.dispatched = !1), (e.eventPhase = e.NONE), (e.currentTarget = null), !e.canceled);
    }
  },
  M = fe;
var he = class extends M {
    _result = null;
    _error = null;
    source = null;
    transaction = null;
    readyState = "pending";
    onsuccess = null;
    onerror = null;
    get error() {
      if (this.readyState === "pending") throw new d();
      return this._error;
    }
    set error(e) {
      this._error = e;
    }
    get result() {
      if (this.readyState === "pending") throw new d();
      return this._result;
    }
    set result(e) {
      this._result = e;
    }
    get [Symbol.toStringTag]() {
      return "IDBRequest";
    }
  },
  C = he;
var Ae = class {
    constructor(...e) {
      this._values = e;
      for (let t = 0; t < e.length; t++) this[t] = e[t];
    }
    contains(e) {
      return this._values.includes(e);
    }
    item(e) {
      return e < 0 || e >= this._values.length ? null : this._values[e];
    }
    get length() {
      return this._values.length;
    }
    [Symbol.iterator]() {
      return this._values[Symbol.iterator]();
    }
    _push(...e) {
      for (let t = 0; t < e.length; t++) this[this._values.length + t] = e[t];
      this._values.push(...e);
    }
    _sort(...e) {
      this._values.sort(...e);
      for (let t = 0; t < this._values.length; t++) this[t] = this._values[t];
      return this;
    }
  },
  _ = Ae;
var ut = (n, e = !1) => {
    if (n instanceof l) return n;
    if (n == null) {
      if (e) throw new w();
      return new l(void 0, void 0, !1, !1);
    }
    let t = f(n);
    return l.only(t);
  },
  R = ut;
var Pe = (n) => (typeof n == "object" && n ? n + "" : n);
function te(n) {
  return Array.isArray(n) ? n.map(Pe) : Pe(n);
}
var nt = (n) => (n instanceof l ? !0 : X(n) !== L),
  Le = nt;
var st = (n, e) => {
    let r = e === "unsigned long" ? 4294967295 : 9007199254740991;
    if (isNaN(n) || n < 0 || n > r) throw new TypeError();
    if (n >= 0) return Math.floor(n);
  },
  I = st;
var ot = (n, e, t) => {
    let r, u;
    if (n == null || Le(n)) ((r = n), t > 1 && e !== void 0 && (e = I(e, "unsigned long")));
    else {
      let s = n;
      (s.query !== void 0 && (r = s.query),
        s.count !== void 0 && (e = I(s.count, "unsigned long")),
        s.direction !== void 0 && (u = s.direction));
    }
    return { query: r, count: e, direction: u };
  },
  G = ot;
var q = (n) => {
    if (n._rawIndex.deleted || n.objectStore._rawObjectStore.deleted) throw new d();
    if (n.objectStore.transaction._state !== "active") throw new D();
  },
  pe = class {
    constructor(e, t) {
      ((this._rawIndex = t),
        (this._name = t.name),
        (this.objectStore = e),
        (this.keyPath = te(t.keyPath)),
        (this.multiEntry = t.multiEntry),
        (this.unique = t.unique));
    }
    get name() {
      return this._name;
    }
    set name(e) {
      let t = this.objectStore.transaction;
      if (!t.db._runningVersionchangeTransaction) throw t._state === "active" ? new d() : new D();
      if (t._state !== "active") throw new D();
      if (this._rawIndex.deleted || this.objectStore._rawObjectStore.deleted) throw new d();
      if (((e = String(e)), e === this._name)) return;
      if (this.objectStore.indexNames.contains(e)) throw new y();
      let r = this._name,
        u = [...this.objectStore.indexNames];
      ((this._name = e),
        (this._rawIndex.name = e),
        this.objectStore._indexesCache.delete(r),
        this.objectStore._indexesCache.set(e, this),
        this.objectStore._rawObjectStore.rawIndexes.delete(r),
        this.objectStore._rawObjectStore.rawIndexes.set(e, this._rawIndex),
        (this.objectStore.indexNames = new _(
          ...Array.from(this.objectStore._rawObjectStore.rawIndexes.keys())
            .filter((s) => {
              let a = this.objectStore._rawObjectStore.rawIndexes.get(s);
              return a && !a.deleted;
            })
            .sort(),
        )),
        this.objectStore.transaction._createdIndexes.has(this._rawIndex) ||
          t._rollbackLog.push(() => {
            ((this._name = r),
              (this._rawIndex.name = r),
              this.objectStore._indexesCache.delete(e),
              this.objectStore._indexesCache.set(r, this),
              this.objectStore._rawObjectStore.rawIndexes.delete(e),
              this.objectStore._rawObjectStore.rawIndexes.set(r, this._rawIndex),
              (this.objectStore.indexNames = new _(...u)));
          }));
    }
    openCursor(e, t) {
      (q(this),
        e === null && (e = void 0),
        e !== void 0 && !(e instanceof l) && (e = l.only(f(e))));
      let r = new C();
      ((r.source = this), (r.transaction = this.objectStore.transaction));
      let u = new W(this, e, t, r);
      return this.objectStore.transaction._execRequestAsync({
        operation: u._iterate.bind(u),
        request: r,
        source: this,
      });
    }
    openKeyCursor(e, t) {
      (q(this),
        e === null && (e = void 0),
        e !== void 0 && !(e instanceof l) && (e = l.only(f(e))));
      let r = new C();
      ((r.source = this), (r.transaction = this.objectStore.transaction));
      let u = new P(this, e, t, r, !0);
      return this.objectStore.transaction._execRequestAsync({
        operation: u._iterate.bind(u),
        request: r,
        source: this,
      });
    }
    get(e) {
      return (
        q(this),
        e instanceof l || (e = f(e)),
        this.objectStore.transaction._execRequestAsync({
          operation: this._rawIndex.getValue.bind(this._rawIndex, e),
          source: this,
        })
      );
    }
    getAll(e, t) {
      let r = G(e, t, arguments.length);
      q(this);
      let u = R(r.query);
      return this.objectStore.transaction._execRequestAsync({
        operation: this._rawIndex.getAllValues.bind(this._rawIndex, u, r.count, r.direction),
        source: this,
      });
    }
    getKey(e) {
      return (
        q(this),
        e instanceof l || (e = f(e)),
        this.objectStore.transaction._execRequestAsync({
          operation: this._rawIndex.getKey.bind(this._rawIndex, e),
          source: this,
        })
      );
    }
    getAllKeys(e, t) {
      let r = G(e, t, arguments.length);
      q(this);
      let u = R(r.query);
      return this.objectStore.transaction._execRequestAsync({
        operation: this._rawIndex.getAllKeys.bind(this._rawIndex, u, r.count, r.direction),
        source: this,
      });
    }
    getAllRecords(e) {
      let t, r, u;
      (e !== void 0 &&
        (e.query !== void 0 && (t = e.query),
        e.count !== void 0 && (r = I(e.count, "unsigned long")),
        e.direction !== void 0 && (u = e.direction)),
        q(this));
      let s = R(t);
      return this.objectStore.transaction._execRequestAsync({
        operation: this._rawIndex.getAllRecords.bind(this._rawIndex, s, r, u),
        source: this,
      });
    }
    count(e) {
      return (
        q(this),
        e === null && (e = void 0),
        e !== void 0 && !(e instanceof l) && (e = l.only(f(e))),
        this.objectStore.transaction._execRequestAsync({
          operation: () => this._rawIndex.count(e),
          source: this,
        })
      );
    }
    get [Symbol.toStringTag]() {
      return "IDBIndex";
    }
  },
  re = pe;
var it = (n, e) => {
    if (Array.isArray(n))
      throw new Error(
        "The key paths used in this section are always strings and never sequences, since it is not possible to create a object store which has a key generator and also has a key path that is a sequence.",
      );
    let t = n.split(".");
    if (t.length === 0) throw new Error("Assert: identifiers is not empty");
    t.pop();
    for (let r of t) {
      if (typeof e != "object" && !Array.isArray(e)) return !1;
      if (!Object.hasOwn(e, r)) return !0;
      e = e[r];
    }
    return typeof e == "object" || Array.isArray(e);
  },
  Me = it;
var we = class {
    constructor(e, t, r) {
      ((this._key = e), (this._primaryKey = t), (this._value = r));
    }
    get key() {
      return this._key;
    }
    set key(e) {}
    get primaryKey() {
      return this._primaryKey;
    }
    set primaryKey(e) {}
    get value() {
      return this._value;
    }
    set value(e) {}
    get [Symbol.toStringTag]() {
      return "IDBRecord";
    }
  },
  $ = we;
var at = 2 / 3,
  ct = new l(void 0, void 0, !1, !1),
  z = class {
    _numTombstones = 0;
    _numNodes = 0;
    constructor(e) {
      this._keysAreUnique = !!e;
    }
    size() {
      return this._numNodes - this._numTombstones;
    }
    get(e) {
      return this._getByComparator(this._root, (t) => this._compare(e, t));
    }
    contains(e) {
      return !!this.get(e);
    }
    _compare(e, t) {
      let r = A(e.key, t.key);
      return r !== 0 ? r : this._keysAreUnique ? 0 : A(e.value, t.value);
    }
    _getByComparator(e, t) {
      let r = e;
      for (; r;) {
        let u = t(r.record);
        if (u < 0) r = r.left;
        else if (u > 0) r = r.right;
        else return r.record;
      }
    }
    put(e, t = !1) {
      if (!this._root) {
        ((this._root = {
          record: e,
          left: void 0,
          right: void 0,
          parent: void 0,
          deleted: !1,
          red: !1,
        }),
          this._numNodes++);
        return;
      }
      return this._put(this._root, e, t);
    }
    _put(e, t, r) {
      let u = this._compare(t, e.record);
      if (u < 0) {
        if (e.left) return this._put(e.left, t, r);
        ((e.left = { record: t, left: void 0, right: void 0, parent: e, deleted: !1, red: !0 }),
          this._onNewNodeInserted(e.left));
      } else if (u > 0) {
        if (e.right) return this._put(e.right, t, r);
        ((e.right = { record: t, left: void 0, right: void 0, parent: e, deleted: !1, red: !0 }),
          this._onNewNodeInserted(e.right));
      } else if (e.deleted) ((e.deleted = !1), (e.record = t), this._numTombstones--);
      else {
        if (r) throw new y();
        {
          let s = e.record;
          return ((e.record = t), s);
        }
      }
    }
    delete(e) {
      if (this._root && (this._delete(this._root, e), this._numTombstones > this._numNodes * at)) {
        let t = [...this.getAllRecords()];
        ((this._root = this._rebuild(t, void 0, !1)),
          (this._numNodes = t.length),
          (this._numTombstones = 0));
      }
    }
    _delete(e, t) {
      if (!e) return;
      let r = this._compare(t, e.record);
      r < 0
        ? this._delete(e.left, t)
        : r > 0
          ? this._delete(e.right, t)
          : e.deleted || (this._numTombstones++, (e.deleted = !0));
    }
    *getAllRecords(e = !1) {
      yield* this.getRecords(ct, e);
    }
    *getRecords(e, t = !1) {
      yield* this._getRecordsForNode(this._root, e, t);
    }
    *_getRecordsForNode(e, t, r = !1) {
      e && (yield* this._findRecords(e, t, r));
    }
    *_findRecords(e, t, r = !1) {
      let { lower: u, upper: s, lowerOpen: a, upperOpen: i } = t,
        {
          record: { key: o },
        } = e,
        c = u === void 0 ? -1 : A(u, o),
        h = s === void 0 ? 1 : A(s, o),
        p = this._keysAreUnique ? c < 0 : c <= 0,
        b = this._keysAreUnique ? h > 0 : h >= 0,
        F = r ? b : p,
        N = r ? p : b,
        Re = r ? "right" : "left",
        qe = r ? "left" : "right",
        Je = a ? c < 0 : c <= 0,
        et = i ? h > 0 : h >= 0;
      (F && e[Re] && (yield* this._findRecords(e[Re], t, r)),
        Je && et && !e.deleted && (yield e.record),
        N && e[qe] && (yield* this._findRecords(e[qe], t, r)));
    }
    _onNewNodeInserted(e) {
      (this._numNodes++, this._rebalanceTree(e));
    }
    _rebalanceTree(e) {
      let t = e.parent;
      do {
        if (!t.red) return;
        let r = t.parent;
        if (!r) {
          t.red = !1;
          return;
        }
        let u = t === r.right,
          s = u ? r.left : r.right;
        if (!s || !s.red) {
          (e === (u ? t.left : t.right) &&
            (this._rotateSubtree(t, u), (e = t), (t = u ? r.right : r.left)),
            this._rotateSubtree(r, !u),
            (t.red = !1),
            (r.red = !0));
          return;
        }
        ((t.red = !1), (s.red = !1), (r.red = !0), (e = r));
      } while (e.parent && (t = e.parent));
    }
    _rotateSubtree(e, t) {
      let r = e.parent,
        u = t ? e.left : e.right,
        s = t ? u.right : u.left;
      return (
        (e[t ? "left" : "right"] = s),
        s && (s.parent = e),
        (u[t ? "right" : "left"] = e),
        (u.parent = r),
        (e.parent = u),
        r ? (r[e === r.right ? "right" : "left"] = u) : (this._root = u),
        u
      );
    }
    _rebuild(e, t, r, u = 0, s = e.length) {
      let a = s - u;
      if (a <= 0) return;
      let i = u + (a >>> 1),
        o = { record: e[i], left: void 0, right: void 0, parent: t, deleted: !1, red: r },
        c = this._rebuild(e, o, !r, u, i),
        h = this._rebuild(e, o, !r, i + 1, s);
      return ((o.left = c), (o.right = h), o);
    }
  };
var me = class {
    constructor(e) {
      ((this.keysAreUnique = e), (this.records = new z(this.keysAreUnique)));
    }
    get(e) {
      let t = e instanceof l ? e : l.only(e);
      return this.records.getRecords(t).next().value;
    }
    put(e, t = !1) {
      return this.records.put(e, t);
    }
    delete(e) {
      let t = e instanceof l ? e : l.only(e),
        r = [...this.records.getRecords(t)];
      for (let u of r) this.records.delete(u);
      return r;
    }
    deleteByValue(e) {
      let t = e instanceof l ? e : l.only(e),
        r = [];
      for (let u of this.records.getAllRecords())
        t.includes(u.value) && (this.records.delete(u), r.push(u));
      return r;
    }
    clear() {
      let e = [...this.records.getAllRecords()];
      return ((this.records = new z(this.keysAreUnique)), e);
    }
    values(e, t = "next") {
      let r = t === "prev" || t === "prevunique",
        u = e ? this.records.getRecords(e, r) : this.records.getAllRecords(r);
      return {
        [Symbol.iterator]: () => {
          let s = () => u.next();
          if (t === "next" || t === "prev") return { next: s };
          if (t === "nextunique") {
            let o;
            return {
              next: () => {
                let c = s();
                for (; !c.done && o !== void 0 && A(o.key, c.value.key) === 0;) c = s();
                return ((o = c.value), c);
              },
            };
          }
          let a = s(),
            i = s();
          return {
            next: () => {
              for (; !i.done && A(a.value.key, i.value.key) === 0;) ((a = i), (i = s()));
              let o = a;
              return ((a = i), (i = s()), o);
            },
          };
        },
      };
    }
    size() {
      return this.records.size();
    }
  },
  ue = me;
var _e = class {
    deleted = !1;
    initialized = !1;
    constructor(e, t, r, u, s) {
      ((this.rawObjectStore = e),
        (this.name = t),
        (this.keyPath = r),
        (this.multiEntry = u),
        (this.unique = s),
        (this.records = new ue(s)));
    }
    getKey(e) {
      let t = this.records.get(e);
      return t !== void 0 ? t.value : void 0;
    }
    getAllKeys(e, t, r) {
      (t === void 0 || t === 0) && (t = 1 / 0);
      let u = [];
      for (let s of this.records.values(e, r))
        if ((u.push(structuredClone(s.value)), u.length >= t)) break;
      return u;
    }
    getValue(e) {
      let t = this.records.get(e);
      return t !== void 0 ? this.rawObjectStore.getValue(t.value) : void 0;
    }
    getAllValues(e, t, r) {
      (t === void 0 || t === 0) && (t = 1 / 0);
      let u = [];
      for (let s of this.records.values(e, r))
        if ((u.push(this.rawObjectStore.getValue(s.value)), u.length >= t)) break;
      return u;
    }
    getAllRecords(e, t, r) {
      (t === void 0 || t === 0) && (t = 1 / 0);
      let u = [];
      for (let s of this.records.values(e, r))
        if (
          (u.push(
            new $(
              structuredClone(s.key),
              structuredClone(this.rawObjectStore.getKey(s.value)),
              this.rawObjectStore.getValue(s.value),
            ),
          ),
          u.length >= t)
        )
          break;
      return u;
    }
    storeRecord(e) {
      let t;
      try {
        t = T(this.keyPath, e.value).key;
      } catch (r) {
        if (r.name === "DataError") return;
        throw r;
      }
      if (!this.multiEntry || !Array.isArray(t))
        try {
          f(t);
        } catch {
          return;
        }
      else {
        let r = [];
        for (let u of t)
          if (r.indexOf(u) < 0)
            try {
              r.push(f(u));
            } catch {}
        t = r;
      }
      if (!this.multiEntry || !Array.isArray(t)) {
        if (this.unique && this.records.get(t)) throw new y();
      } else if (this.unique) {
        for (let r of t) if (this.records.get(r)) throw new y();
      }
      if (!this.multiEntry || !Array.isArray(t)) this.records.put({ key: t, value: e.key });
      else for (let r of t) this.records.put({ key: r, value: e.key });
    }
    initialize(e) {
      if (this.initialized) throw new Error("Index already initialized");
      e._execRequestAsync({
        operation: () => {
          try {
            for (let t of this.rawObjectStore.records.values()) this.storeRecord(t);
            this.initialized = !0;
          } catch (t) {
            e._abort(t.name);
          }
        },
        source: null,
      });
    }
    count(e) {
      let t = 0;
      for (let r of this.records.values(e)) t += 1;
      return t;
    }
  },
  Ge = _e;
var Fe = (n, e) => {
    if (
      (n != null &&
        typeof n != "string" &&
        n.toString &&
        (e === "array" || !Array.isArray(n)) &&
        (n = n.toString()),
      typeof n == "string")
    ) {
      if (n === "" && e !== "string") return;
      try {
        let t =
          /^(?:[$A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B2\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC])(?:[$0-9A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B2\u08E4-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA69D\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2D\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC])*$/;
        if (n.length >= 1 && t.test(n)) return;
      } catch (t) {
        throw new K(t.message);
      }
      if (n.indexOf(" ") >= 0)
        throw new K("The keypath argument contains an invalid key path (no spaces allowed).");
    }
    if (Array.isArray(n) && n.length > 0) {
      if (e) throw new K("The keypath argument contains an invalid key path (nested arrays).");
      for (let t of n) Fe(t, "array");
      return;
    } else if (typeof n == "string" && n.indexOf(".") >= 0) {
      n = n.split(".");
      for (let t of n) Fe(t, "string");
      return;
    }
    throw new K();
  },
  ne = Fe;
var g = (n) => {
    if (n._rawObjectStore.deleted) throw new d();
    if (n.transaction._state !== "active") throw new D();
  },
  ze = (n, e, t) => {
    if ((g(n), n.transaction.mode === "readonly")) throw new j();
    if (n.keyPath !== null && t !== void 0) throw new w();
    let r = J(e, n.transaction);
    if (n.keyPath !== null) {
      let u = T(n.keyPath, r);
      if (u.type === "found") f(u.key);
      else if (n._rawObjectStore.keyGenerator) {
        if (!Me(n.keyPath, r)) throw new w();
      } else throw new w();
    }
    if (n.keyPath === null && n._rawObjectStore.keyGenerator === null && t === void 0)
      throw new w();
    return (t !== void 0 && (t = f(t)), { key: t, value: r });
  },
  De = class {
    _indexesCache = new Map();
    constructor(e, t) {
      ((this._rawObjectStore = t),
        (this._name = t.name),
        (this.keyPath = te(t.keyPath)),
        (this.autoIncrement = t.autoIncrement),
        (this.transaction = e),
        (this.indexNames = new _(...Array.from(t.rawIndexes.keys()).sort())));
    }
    get name() {
      return this._name;
    }
    set name(e) {
      let t = this.transaction;
      if (!t.db._runningVersionchangeTransaction) throw t._state === "active" ? new d() : new D();
      if ((g(this), (e = String(e)), e === this._name)) return;
      if (this._rawObjectStore.rawDatabase.rawObjectStores.has(e)) throw new y();
      let r = this._name,
        u = [...t.db.objectStoreNames];
      ((this._name = e),
        (this._rawObjectStore.name = e),
        this.transaction._objectStoresCache.delete(r),
        this.transaction._objectStoresCache.set(e, this),
        this._rawObjectStore.rawDatabase.rawObjectStores.delete(r),
        this._rawObjectStore.rawDatabase.rawObjectStores.set(e, this._rawObjectStore),
        (t.db.objectStoreNames = new _(
          ...Array.from(this._rawObjectStore.rawDatabase.rawObjectStores.keys())
            .filter((i) => {
              let o = this._rawObjectStore.rawDatabase.rawObjectStores.get(i);
              return o && !o.deleted;
            })
            .sort(),
        )));
      let s = new Set(t._scope),
        a = [...t.objectStoreNames];
      (this.transaction._scope.delete(r),
        t._scope.add(e),
        (t.objectStoreNames = new _(...Array.from(t._scope).sort())),
        this.transaction._createdObjectStores.has(this._rawObjectStore) ||
          t._rollbackLog.push(() => {
            ((this._name = r),
              (this._rawObjectStore.name = r),
              this.transaction._objectStoresCache.delete(e),
              this.transaction._objectStoresCache.set(r, this),
              this._rawObjectStore.rawDatabase.rawObjectStores.delete(e),
              this._rawObjectStore.rawDatabase.rawObjectStores.set(r, this._rawObjectStore),
              (t.db.objectStoreNames = new _(...u)),
              (t._scope = s),
              (t.objectStoreNames = new _(...a)));
          }));
    }
    put(e, t) {
      if (arguments.length === 0) throw new TypeError();
      let r = ze(this, e, t);
      return this.transaction._execRequestAsync({
        operation: this._rawObjectStore.storeRecord.bind(
          this._rawObjectStore,
          r,
          !1,
          this.transaction._rollbackLog,
        ),
        source: this,
      });
    }
    add(e, t) {
      if (arguments.length === 0) throw new TypeError();
      let r = ze(this, e, t);
      return this.transaction._execRequestAsync({
        operation: this._rawObjectStore.storeRecord.bind(
          this._rawObjectStore,
          r,
          !0,
          this.transaction._rollbackLog,
        ),
        source: this,
      });
    }
    delete(e) {
      if (arguments.length === 0) throw new TypeError();
      if ((g(this), this.transaction.mode === "readonly")) throw new j();
      return (
        e instanceof l || (e = f(e)),
        this.transaction._execRequestAsync({
          operation: this._rawObjectStore.deleteRecord.bind(
            this._rawObjectStore,
            e,
            this.transaction._rollbackLog,
          ),
          source: this,
        })
      );
    }
    get(e) {
      if (arguments.length === 0) throw new TypeError();
      return (
        g(this),
        e instanceof l || (e = f(e)),
        this.transaction._execRequestAsync({
          operation: this._rawObjectStore.getValue.bind(this._rawObjectStore, e),
          source: this,
        })
      );
    }
    getAll(e, t) {
      let r = G(e, t, arguments.length);
      g(this);
      let u = R(r.query);
      return this.transaction._execRequestAsync({
        operation: this._rawObjectStore.getAllValues.bind(
          this._rawObjectStore,
          u,
          r.count,
          r.direction,
        ),
        source: this,
      });
    }
    getKey(e) {
      if (arguments.length === 0) throw new TypeError();
      return (
        g(this),
        e instanceof l || (e = f(e)),
        this.transaction._execRequestAsync({
          operation: this._rawObjectStore.getKey.bind(this._rawObjectStore, e),
          source: this,
        })
      );
    }
    getAllKeys(e, t) {
      let r = G(e, t, arguments.length);
      g(this);
      let u = R(r.query);
      return this.transaction._execRequestAsync({
        operation: this._rawObjectStore.getAllKeys.bind(
          this._rawObjectStore,
          u,
          r.count,
          r.direction,
        ),
        source: this,
      });
    }
    getAllRecords(e) {
      let t, r, u;
      (e !== void 0 &&
        (e.query !== void 0 && (t = e.query),
        e.count !== void 0 && (r = I(e.count, "unsigned long")),
        e.direction !== void 0 && (u = e.direction)),
        g(this));
      let s = R(t);
      return this.transaction._execRequestAsync({
        operation: this._rawObjectStore.getAllRecords.bind(this._rawObjectStore, s, r, u),
        source: this,
      });
    }
    clear() {
      if ((g(this), this.transaction.mode === "readonly")) throw new j();
      return this.transaction._execRequestAsync({
        operation: this._rawObjectStore.clear.bind(
          this._rawObjectStore,
          this.transaction._rollbackLog,
        ),
        source: this,
      });
    }
    openCursor(e, t) {
      (g(this),
        e === null && (e = void 0),
        e !== void 0 && !(e instanceof l) && (e = l.only(f(e))));
      let r = new C();
      ((r.source = this), (r.transaction = this.transaction));
      let u = new W(this, e, t, r);
      return this.transaction._execRequestAsync({
        operation: u._iterate.bind(u),
        request: r,
        source: this,
      });
    }
    openKeyCursor(e, t) {
      (g(this),
        e === null && (e = void 0),
        e !== void 0 && !(e instanceof l) && (e = l.only(f(e))));
      let r = new C();
      ((r.source = this), (r.transaction = this.transaction));
      let u = new P(this, e, t, r, !0);
      return this.transaction._execRequestAsync({
        operation: u._iterate.bind(u),
        request: r,
        source: this,
      });
    }
    createIndex(e, t, r = {}) {
      if (arguments.length < 2) throw new TypeError();
      let u = r.multiEntry !== void 0 ? r.multiEntry : !1,
        s = r.unique !== void 0 ? r.unique : !1;
      if (this.transaction.mode !== "versionchange") throw new d();
      if ((g(this), this.indexNames.contains(e))) throw new y();
      if ((ne(t), Array.isArray(t) && u)) throw new v();
      let a = [...this.indexNames],
        i = new Ge(this._rawObjectStore, e, t, u, s);
      return (
        this.indexNames._push(e),
        this.indexNames._sort(),
        this.transaction._createdIndexes.add(i),
        this._rawObjectStore.rawIndexes.set(e, i),
        i.initialize(this.transaction),
        this.transaction._rollbackLog.push(() => {
          ((i.deleted = !0),
            (this.indexNames = new _(...a)),
            this._rawObjectStore.rawIndexes.delete(i.name));
        }),
        new re(this, i)
      );
    }
    index(e) {
      if (arguments.length === 0) throw new TypeError();
      if (this._rawObjectStore.deleted || this.transaction._state === "finished") throw new d();
      let t = this._indexesCache.get(e);
      if (t !== void 0) return t;
      let r = this._rawObjectStore.rawIndexes.get(e);
      if (!this.indexNames.contains(e) || r === void 0) throw new x();
      let u = new re(this, r);
      return (this._indexesCache.set(e, u), u);
    }
    deleteIndex(e) {
      if (arguments.length === 0) throw new TypeError();
      if (this.transaction.mode !== "versionchange") throw new d();
      g(this);
      let t = this._rawObjectStore.rawIndexes.get(e);
      if (t === void 0) throw new x();
      (this.transaction._rollbackLog.push(() => {
        ((t.deleted = !1),
          this._rawObjectStore.rawIndexes.set(t.name, t),
          this.indexNames._push(t.name),
          this.indexNames._sort());
      }),
        (this.indexNames = new _(...Array.from(this.indexNames).filter((r) => r !== e))),
        (t.deleted = !0),
        this.transaction._execRequestAsync({
          operation: () => {
            let r = this._rawObjectStore.rawIndexes.get(e);
            t === r && this._rawObjectStore.rawIndexes.delete(e);
          },
          source: this,
        }));
    }
    count(e) {
      return (
        g(this),
        e === null && (e = void 0),
        e !== void 0 && !(e instanceof l) && (e = l.only(f(e))),
        this.transaction._execRequestAsync({
          operation: () => this._rawObjectStore.count(e),
          source: this,
        })
      );
    }
    get [Symbol.toStringTag]() {
      return "IDBObjectStore";
    }
  },
  B = De;
var be = class {
    eventPath = [];
    NONE = 0;
    CAPTURING_PHASE = 1;
    AT_TARGET = 2;
    BUBBLING_PHASE = 3;
    propagationStopped = !1;
    immediatePropagationStopped = !1;
    canceled = !1;
    initialized = !0;
    dispatched = !1;
    target = null;
    currentTarget = null;
    eventPhase = 0;
    defaultPrevented = !1;
    isTrusted = !1;
    timeStamp = Date.now();
    constructor(e, t = {}) {
      ((this.type = e),
        (this.bubbles = t.bubbles !== void 0 ? t.bubbles : !1),
        (this.cancelable = t.cancelable !== void 0 ? t.cancelable : !1));
    }
    preventDefault() {
      this.cancelable && (this.canceled = !0);
    }
    stopPropagation() {
      this.propagationStopped = !0;
    }
    stopImmediatePropagation() {
      ((this.propagationStopped = !0), (this.immediatePropagationStopped = !0));
    }
  },
  E = be;
function dt() {
  if (typeof navigator < "u" && /jsdom/.test(navigator.userAgent)) {
    let n = Node.constructor;
    return new n("return setImmediate")();
  } else return;
}
var lt = typeof scheduler < "u" && ((n) => scheduler.postTask(n)),
  ft = (n) => setTimeout(n, 0),
  m = (n) => {
    (globalThis.setImmediate || dt() || lt || ft)(n);
  };
var ht = ["error", "abort", "complete"],
  ye = class extends M {
    _state = "active";
    _started = !1;
    _rollbackLog = [];
    _objectStoresCache = new Map();
    _openRequest = null;
    error = null;
    onabort = null;
    oncomplete = null;
    onerror = null;
    _prioritizedListeners = new Map();
    _requests = [];
    _createdIndexes = new Set();
    _createdObjectStores = new Set();
    constructor(e, t, r, u) {
      (super(),
        (this._scope = new Set(e)),
        (this.mode = t),
        (this.durability = r),
        (this.db = u),
        (this.objectStoreNames = new _(...Array.from(this._scope).sort())));
      for (let s of ht)
        this.addEventListener(s, () => {
          this._prioritizedListeners.get(s)?.();
        });
    }
    _abort(e) {
      for (let t of this._rollbackLog.reverse()) t();
      if (e !== null) {
        let t = new DOMException(void 0, e);
        this.error = t;
      }
      for (let { request: t } of this._requests)
        t.readyState !== "done" &&
          ((t.readyState = "done"),
          t.source &&
            m(() => {
              ((t.result = void 0), (t.error = new V()));
              let r = new E("error", { bubbles: !0, cancelable: !0 });
              r.eventPath = [this.db, this];
              try {
                t.dispatchEvent(r);
              } catch {
                this._state === "active" && this._abort("AbortError");
              }
            }));
      (m(() => {
        let t = this.mode === "versionchange";
        t &&
          (this.db._rawDatabase.connections = this.db._rawDatabase.connections.filter(
            (u) => !u._rawDatabase.transactions.includes(this),
          ));
        let r = new E("abort", { bubbles: !0, cancelable: !1 });
        if (((r.eventPath = [this.db]), this.dispatchEvent(r), t)) {
          let u = this._openRequest;
          ((u.transaction = null), (u.result = void 0));
        }
      }),
        this._markFinished());
    }
    abort() {
      if (this._state === "committing" || this._state === "finished") throw new d();
      ((this._state = "active"), this._abort(null));
    }
    objectStore(e) {
      if (this._state !== "active") throw new d();
      let t = this._objectStoresCache.get(e);
      if (t !== void 0) return t;
      let r = this.db._rawDatabase.rawObjectStores.get(e);
      if (!this._scope.has(e) || r === void 0) throw new x();
      let u = new B(this, r);
      return (this._objectStoresCache.set(e, u), u);
    }
    _execRequestAsync(e) {
      let t = e.source,
        r = e.operation,
        u = Object.hasOwn(e, "request") ? e.request : null;
      if (this._state !== "active") throw new D();
      return (
        u || (t ? ((u = new C()), (u.source = t), (u.transaction = t.transaction)) : (u = new C())),
        this._requests.push({ operation: r, request: u }),
        u
      );
    }
    _start() {
      this._started = !0;
      let e, t;
      for (; this._requests.length > 0;) {
        let r = this._requests.shift();
        if (r && r.request.readyState !== "done") {
          ((t = r.request), (e = r.operation));
          break;
        }
      }
      if (t && e) {
        if (!t.source) e();
        else {
          let r, u;
          try {
            let s = e();
            ((t.readyState = "done"),
              (t.result = s),
              (t.error = void 0),
              this._state === "inactive" && (this._state = "active"),
              (u = new E("success", { bubbles: !1, cancelable: !1 })));
          } catch (s) {
            ((t.readyState = "done"),
              (t.result = void 0),
              (t.error = s),
              this._state === "inactive" && (this._state = "active"),
              (u = new E("error", { bubbles: !0, cancelable: !0 })),
              (r = this._abort.bind(this, s.name)));
          }
          try {
            ((u.eventPath = [this.db, this]), t.dispatchEvent(u));
          } catch {
            this._state === "active" && (this._abort("AbortError"), (r = void 0));
          }
          u.canceled || (r && r());
        }
        m(this._start.bind(this));
        return;
      }
      if (this._state !== "finished" && (this._markFinished(), !this.error)) {
        let r = new E("complete");
        this.dispatchEvent(r);
      }
    }
    _markFinished() {
      ((this._state = "finished"),
        m(() => {
          let { transactions: e } = this.db._rawDatabase,
            t = e.indexOf(this);
          if (t !== -1) e.splice(t, 1);
          else throw new Error("should have been able to remove transaction");
        }));
    }
    commit() {
      if (this._state !== "active") throw new d();
      this._state = "committing";
    }
    get [Symbol.toStringTag]() {
      return "IDBTransaction";
    }
  },
  Be = ye;
var Ue = 9007199254740992,
  ge = class {
    num = 0;
    next() {
      if (this.num >= Ue) throw new y();
      return ((this.num += 1), this.num);
    }
    setIfLarger(e) {
      let t = Math.floor(Math.min(e, Ue)) - 1;
      t >= this.num && (this.num = t + 1);
    }
  },
  We = ge;
var Ee = class {
    deleted = !1;
    records = new ue(!0);
    rawIndexes = new Map();
    constructor(e, t, r, u) {
      ((this.rawDatabase = e),
        (this.keyGenerator = u === !0 ? new We() : null),
        (this.deleted = !1),
        (this.name = t),
        (this.keyPath = r),
        (this.autoIncrement = u));
    }
    getKey(e) {
      let t = this.records.get(e);
      return t !== void 0 ? structuredClone(t.key) : void 0;
    }
    getAllKeys(e, t, r) {
      (t === void 0 || t === 0) && (t = 1 / 0);
      let u = [];
      for (let s of this.records.values(e, r))
        if ((u.push(structuredClone(s.key)), u.length >= t)) break;
      return u;
    }
    getValue(e) {
      let t = this.records.get(e);
      return t !== void 0 ? structuredClone(t.value) : void 0;
    }
    getAllValues(e, t, r) {
      (t === void 0 || t === 0) && (t = 1 / 0);
      let u = [];
      for (let s of this.records.values(e, r))
        if ((u.push(structuredClone(s.value)), u.length >= t)) break;
      return u;
    }
    getAllRecords(e, t, r) {
      (t === void 0 || t === 0) && (t = 1 / 0);
      let u = [];
      for (let s of this.records.values(e, r))
        if (
          (u.push(new $(structuredClone(s.key), structuredClone(s.key), structuredClone(s.value))),
          u.length >= t)
        )
          break;
      return u;
    }
    storeRecord(e, t, r) {
      if (this.keyPath !== null) {
        let o = T(this.keyPath, e.value).key;
        o !== void 0 && (e.key = o);
      }
      let u = [];
      if (this.keyGenerator !== null && e.key === void 0) {
        let o = !1,
          c = this.keyGenerator.num,
          h = () => {
            o || ((o = !0), this.keyGenerator && (this.keyGenerator.num = c));
          };
        if (
          (u.push(h), r && r.push(h), (e.key = this.keyGenerator.next()), this.keyPath !== null)
        ) {
          if (Array.isArray(this.keyPath))
            throw new Error(
              "Cannot have an array key path in an object store with a key generator",
            );
          let p = this.keyPath,
            b = e.value,
            F,
            N = 0;
          for (; N >= 0;) {
            if (typeof b != "object") throw new w();
            ((N = p.indexOf(".")),
              N >= 0 &&
                ((F = p.slice(0, N)),
                (p = p.slice(N + 1)),
                Object.hasOwn(b, F) ||
                  Object.defineProperty(b, F, {
                    configurable: !0,
                    enumerable: !0,
                    writable: !0,
                    value: {},
                  }),
                (b = b[F])));
          }
          ((F = p),
            Object.defineProperty(b, F, {
              configurable: !0,
              enumerable: !0,
              writable: !0,
              value: e.key,
            }));
        }
      } else
        this.keyGenerator !== null &&
          typeof e.key == "number" &&
          this.keyGenerator.setIfLarger(e.key);
      let s = this.records.put(e, t),
        a = !1,
        i = () => {
          a || ((a = !0), s ? this.storeRecord(s, !1) : this.deleteRecord(e.key));
        };
      if ((u.push(i), r && r.push(i), s))
        for (let o of this.rawIndexes.values()) o.records.deleteByValue(e.key);
      try {
        for (let o of this.rawIndexes.values()) o.initialized && o.storeRecord(e);
      } catch (o) {
        if (o.name === "ConstraintError") for (let c of u) c();
        throw o;
      }
      return e.key;
    }
    deleteRecord(e, t) {
      let r = this.records.delete(e);
      if (t)
        for (let u of r)
          t.push(() => {
            this.storeRecord(u, !0);
          });
      for (let u of this.rawIndexes.values()) u.records.deleteByValue(e);
    }
    clear(e) {
      let t = this.records.clear();
      if (e)
        for (let r of t)
          e.push(() => {
            this.storeRecord(r, !0);
          });
      for (let r of this.rawIndexes.values()) r.records.clear();
    }
    count(e) {
      if (e === void 0 || (e.lower === void 0 && e.upper === void 0)) return this.records.size();
      let t = 0;
      for (let r of this.records.values(e)) t += 1;
      return t;
    }
  },
  $e = Ee;
var He = (n, e = !1) => {
    if (
      ((n._closePending = !0), n._rawDatabase.transactions.every((r) => r._state === "finished"))
    ) {
      if (
        ((n._closed = !0),
        (n._rawDatabase.connections = n._rawDatabase.connections.filter((r) => n !== r)),
        e)
      ) {
        let r = new E("close", { bubbles: !1, cancelable: !1 });
        ((r.eventPath = []), n.dispatchEvent(r));
      }
    } else
      m(() => {
        He(n, e);
      });
  },
  Ce = He;
var Ye = (n) => {
    let e;
    if (
      (n._runningVersionchangeTransaction &&
        (e = n._rawDatabase.transactions.findLast((t) => t.mode === "versionchange")),
      !e)
    )
      throw new d();
    if (e._state !== "active") throw new D();
    return e;
  },
  xe = class extends M {
    _closePending = !1;
    _closed = !1;
    _runningVersionchangeTransaction = !1;
    constructor(e) {
      (super(),
        (this._rawDatabase = e),
        this._rawDatabase.connections.push(this),
        (this.name = e.name),
        (this.version = e.version),
        (this.objectStoreNames = new _(...Array.from(e.rawObjectStores.keys()).sort())));
    }
    createObjectStore(e, t = {}) {
      if (e === void 0) throw new TypeError();
      let r = Ye(this),
        u = t !== null && t.keyPath !== void 0 ? t.keyPath : null,
        s = t !== null && t.autoIncrement !== void 0 ? t.autoIncrement : !1;
      if ((u !== null && ne(u), this._rawDatabase.rawObjectStores.has(e))) throw new y();
      if (s && (u === "" || Array.isArray(u))) throw new v();
      let a = [...this.objectStoreNames],
        i = [...r.objectStoreNames],
        o = new $e(this._rawDatabase, e, u, s);
      return (
        this.objectStoreNames._push(e),
        this.objectStoreNames._sort(),
        r._scope.add(e),
        r._createdObjectStores.add(o),
        this._rawDatabase.rawObjectStores.set(e, o),
        (r.objectStoreNames = new _(...this.objectStoreNames)),
        r._rollbackLog.push(() => {
          ((o.deleted = !0),
            (this.objectStoreNames = new _(...a)),
            (r.objectStoreNames = new _(...i)),
            r._scope.delete(o.name),
            this._rawDatabase.rawObjectStores.delete(o.name));
        }),
        r.objectStore(e)
      );
    }
    deleteObjectStore(e) {
      if (e === void 0) throw new TypeError();
      let t = Ye(this),
        r = this._rawDatabase.rawObjectStores.get(e);
      if (r === void 0) throw new x();
      ((this.objectStoreNames = new _(...Array.from(this.objectStoreNames).filter((a) => a !== e))),
        (t.objectStoreNames = new _(...this.objectStoreNames)));
      let u = t._objectStoresCache.get(e),
        s;
      (u && ((s = [...u.indexNames]), (u.indexNames = new _())),
        t._rollbackLog.push(() => {
          ((r.deleted = !1),
            this._rawDatabase.rawObjectStores.set(r.name, r),
            this.objectStoreNames._push(r.name),
            t.objectStoreNames._push(r.name),
            this.objectStoreNames._sort(),
            u && s && (u.indexNames = new _(...s)));
        }),
        (r.deleted = !0),
        this._rawDatabase.rawObjectStores.delete(e),
        t._objectStoresCache.delete(e));
    }
    transaction(e, t, r) {
      if (
        ((t = t !== void 0 ? t : "readonly"),
        t !== "readonly" && t !== "readwrite" && t !== "versionchange")
      )
        throw new TypeError("Invalid mode: " + t);
      if (
        this._rawDatabase.transactions.some(
          (i) => i._state === "active" && i.mode === "versionchange" && i.db === this,
        )
      )
        throw new d();
      if (this._closePending) throw new d();
      if ((Array.isArray(e) || (e = [e]), e.length === 0 && t !== "versionchange")) throw new v();
      for (let i of e)
        if (!this.objectStoreNames.contains(i))
          throw new x("No objectStore named " + i + " in this database");
      let s = r?.durability ?? "default";
      if (s !== "default" && s !== "strict" && s !== "relaxed")
        throw new TypeError(
          `'${s}' (value of 'durability' member of IDBTransactionOptions) is not a valid value for enumeration IDBTransactionDurability`,
        );
      let a = new Be(e, t, s, this);
      return (this._rawDatabase.transactions.push(a), this._rawDatabase.processTransactions(), a);
    }
    close() {
      Ce(this);
    }
    get [Symbol.toStringTag]() {
      return "IDBDatabase";
    }
  },
  Se = xe;
var ve = class extends C {
    onupgradeneeded = null;
    onblocked = null;
    get [Symbol.toStringTag]() {
      return "IDBOpenDBRequest";
    }
  },
  se = ve;
var je = class extends E {
    constructor(e, t = {}) {
      (super(e),
        (this.newVersion = t.newVersion !== void 0 ? t.newVersion : null),
        (this.oldVersion = t.oldVersion !== void 0 ? t.oldVersion : 0));
    }
    get [Symbol.toStringTag]() {
      return "IDBVersionChangeEvent";
    }
  },
  k = je;
function Ie(n, e) {
  return "intersection" in n ? n.intersection(e) : new Set([...n].filter((t) => e.has(t)));
}
var Oe = class {
    transactions = [];
    rawObjectStores = new Map();
    connections = [];
    constructor(e, t) {
      ((this.name = e),
        (this.version = t),
        (this.processTransactions = this.processTransactions.bind(this)));
    }
    processTransactions() {
      m(() => {
        let e = this.transactions.filter((u) => u._started && u._state !== "finished"),
          t = this.transactions.filter((u) => !u._started && u._state !== "finished"),
          r = t.find((u, s) =>
            e.some(
              (o) =>
                !(u.mode === "readonly" && o.mode === "readonly") &&
                Ie(o._scope, u._scope).size > 0,
            )
              ? !1
              : !t.slice(0, s).some((o) => Ie(o._scope, u._scope).size > 0),
          );
        r &&
          (r.addEventListener("complete", this.processTransactions),
          r.addEventListener("abort", this.processTransactions),
          r._start());
      });
    }
  },
  Qe = Oe;
function oe(n, e, t) {
  if (n < e)
    throw new TypeError(
      `${t}: At least ${e} ${e === 1 ? "argument" : "arguments"} required, but only ${arguments.length} passed`,
    );
}
var Xe = (n, e, t) => {
    let r = n.get(e) ?? Promise.resolve();
    n.set(e, r.then(t));
  },
  Ze = (n, e, t, r) => {
    if (t.some((s) => !s._closed && !s._closePending)) {
      m(() => Ze(n, e, t, r));
      return;
    }
    (n.delete(e), r(null));
  },
  At = (n, e, t, r, u) => {
    Xe(
      e,
      t,
      () =>
        new Promise((a) => {
          let i = n.get(t),
            o = i !== void 0 ? i.version : 0,
            c = (h) => {
              try {
                h ? u(h) : u(null, o);
              } finally {
                a();
              }
            };
          try {
            let h = n.get(t);
            if (h === void 0) {
              c(null);
              return;
            }
            let p = h.connections.filter((b) => !b._closed);
            for (let b of p)
              b._closePending ||
                m(() => {
                  let F = new k("versionchange", { newVersion: null, oldVersion: h.version });
                  b.dispatchEvent(F);
                });
            m(() => {
              (p.some((F) => !F._closed && !F._closePending) &&
                m(() => {
                  let F = new k("blocked", { newVersion: null, oldVersion: h.version });
                  r.dispatchEvent(F);
                }),
                Ze(n, t, p, c));
            });
          } catch (h) {
            c(h);
          }
        }),
    );
  },
  pt = (n, e, t, r) => {
    n._runningVersionchangeTransaction = !0;
    let u = (n._oldVersion = n.version),
      s = n._rawDatabase.connections.filter((a) => n !== a);
    for (let a of s)
      !a._closed &&
        !a._closePending &&
        m(() => {
          let i = new k("versionchange", { newVersion: e, oldVersion: u });
          a.dispatchEvent(i);
        });
    m(() => {
      s.some((o) => !o._closed && !o._closePending) &&
        m(() => {
          let o = new k("blocked", { newVersion: e, oldVersion: u });
          t.dispatchEvent(o);
        });
      let i = () => {
        if (s.some((F) => !F._closed && !F._closePending)) {
          m(i);
          return;
        }
        ((n._rawDatabase.version = e), (n.version = e));
        let c = n.transaction(Array.from(n.objectStoreNames), "versionchange");
        ((c._openRequest = t),
          (t.result = n),
          (t.readyState = "done"),
          (t.transaction = c),
          c._rollbackLog.push(() => {
            ((n._rawDatabase.version = u), (n.version = u));
          }),
          (c._state = "active"));
        let h = new k("upgradeneeded", { newVersion: e, oldVersion: u }),
          p = !1;
        try {
          t.dispatchEvent(h);
        } catch {
          p = !0;
        }
        let b = () => {
          c._state === "active" && ((c._state = "inactive"), p && c._abort("AbortError"));
        };
        (p ? b() : m(b),
          c._prioritizedListeners.set("error", () => {
            ((n._runningVersionchangeTransaction = !1), (n._oldVersion = void 0));
          }),
          c._prioritizedListeners.set("abort", () => {
            ((n._runningVersionchangeTransaction = !1),
              (n._oldVersion = void 0),
              m(() => {
                ((t.transaction = null), r(new V()));
              }));
          }),
          c._prioritizedListeners.set("complete", () => {
            ((n._runningVersionchangeTransaction = !1),
              (n._oldVersion = void 0),
              m(() => {
                ((t.transaction = null), n._closePending ? r(new V()) : r(null));
              }));
          }));
      };
      i();
    });
  },
  wt = (n, e, t, r, u, s) => {
    Xe(
      e,
      t,
      () =>
        new Promise((i) => {
          let o = (p) => {
              try {
                p ? s(p) : s(null, h);
              } finally {
                i();
              }
            },
            c = n.get(t);
          if (
            (c === void 0 && ((c = new Qe(t, 0)), n.set(t, c)),
            r === void 0 && (r = c.version !== 0 ? c.version : 1),
            c.version > r)
          )
            return o(new H());
          let h = new Se(c);
          c.version < r
            ? pt(h, r, u, (p) => {
                o(p);
              })
            : o(null);
        }),
    );
  },
  Te = class {
    _databases = new Map();
    _connectionQueues = new Map();
    cmp(e, t) {
      return (oe(arguments.length, 2, "IDBFactory.cmp"), Z(e, t));
    }
    deleteDatabase(e) {
      oe(arguments.length, 1, "IDBFactory.deleteDatabase");
      let t = new se();
      return (
        (t.source = null),
        m(() => {
          At(this._databases, this._connectionQueues, e, t, (r, u) => {
            if (r) {
              ((t.error = new DOMException(r.message, r.name)), (t.readyState = "done"));
              let a = new E("error", { bubbles: !0, cancelable: !0 });
              ((a.eventPath = []), t.dispatchEvent(a));
              return;
            }
            ((t.result = void 0), (t.readyState = "done"));
            let s = new k("success", { newVersion: null, oldVersion: u });
            t.dispatchEvent(s);
          });
        }),
        t
      );
    }
    open(e, t) {
      if (
        (oe(arguments.length, 1, "IDBFactory.open"),
        arguments.length > 1 && t !== void 0 && (t = I(t, "MAX_SAFE_INTEGER")),
        t === 0)
      )
        throw new TypeError("Database version cannot be 0");
      let r = new se();
      return (
        (r.source = null),
        m(() => {
          wt(this._databases, this._connectionQueues, e, t, r, (u, s) => {
            if (u) {
              ((r.result = void 0),
                (r.readyState = "done"),
                (r.error = new DOMException(u.message, u.name)));
              let i = new E("error", { bubbles: !0, cancelable: !0 });
              ((i.eventPath = []), r.dispatchEvent(i));
              return;
            }
            ((r.result = s), (r.readyState = "done"));
            let a = new E("success");
            ((a.eventPath = []), r.dispatchEvent(a));
          });
        }),
        r
      );
    }
    databases() {
      return Promise.resolve(
        Array.from(this._databases.entries(), ([e, t]) => {
          let r = t.connections.find((s) => s._runningVersionchangeTransaction),
            u = r ? r._oldVersion : t.version;
          return { name: e, version: u };
        }).filter(({ version: e }) => e > 0),
      );
    }
    get [Symbol.toStringTag]() {
      return "IDBFactory";
    }
  },
  ie = Te;
var Zu = new ie();
export { ie as IDBFactory, l as IDBKeyRange };
