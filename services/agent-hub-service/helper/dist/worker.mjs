var Hi = Object.create;
var kt = Object.defineProperty;
var Gi = Object.getOwnPropertyDescriptor;
var Xi = Object.getOwnPropertyNames;
var Yi = Object.getPrototypeOf,
  Qi = Object.prototype.hasOwnProperty;
var Or = (e, r) => () => {
    try {
      return (r || e((r = { exports: {} }).exports, r), r.exports);
    } catch (l) {
      throw ((r = 0), l);
    }
  },
  es = (e, r) => {
    for (var l in r) kt(e, l, { get: r[l], enumerable: !0 });
  },
  rs = (e, r, l, f) => {
    if ((r && typeof r == "object") || typeof r == "function")
      for (let d of Xi(r))
        !Qi.call(e, d) &&
          d !== l &&
          kt(e, d, { get: () => r[d], enumerable: !(f = Gi(r, d)) || f.enumerable });
    return e;
  };
var ts = (e, r, l) => (
  (l = e != null ? Hi(Yi(e)) : {}),
  rs(r || !e || !e.__esModule ? kt(l, "default", { value: e, enumerable: !0 }) : l, e)
);
var xi = Or((Jt) => {
  "use strict";
  Object.defineProperty(Jt, "__esModule", { value: !0 });
  function Ai(e) {
    let r = e.length,
      l = 0,
      f = 0,
      d;
    for (; f < r;)
      (l++,
        (d = e.charCodeAt(f++)),
        d >= 55296 && d <= 56319 && f < r && ((d = e.charCodeAt(f)), (d & 64512) === 56320 && f++));
    return l;
  }
  Jt.default = Ai;
  Ai.code = 'require("ajv/dist/runtime/ucs2length").default';
});
var Li = Or((Ua, Ei) => {
  "use strict";
  Ei.exports = function e(r, l) {
    if (r === l) return !0;
    if (r && l && typeof r == "object" && typeof l == "object") {
      if (r.constructor !== l.constructor) return !1;
      var f, d, y;
      if (Array.isArray(r)) {
        if (((f = r.length), f != l.length)) return !1;
        for (d = f; d-- !== 0;) if (!e(r[d], l[d])) return !1;
        return !0;
      }
      if (r.constructor === RegExp) return r.source === l.source && r.flags === l.flags;
      if (r.valueOf !== Object.prototype.valueOf) return r.valueOf() === l.valueOf();
      if (r.toString !== Object.prototype.toString) return r.toString() === l.toString();
      if (((y = Object.keys(r)), (f = y.length), f !== Object.keys(l).length)) return !1;
      for (d = f; d-- !== 0;) if (!Object.prototype.hasOwnProperty.call(l, y[d])) return !1;
      for (d = f; d-- !== 0;) {
        var i = y[d];
        if (!e(r[i], l[i])) return !1;
      }
      return !0;
    }
    return r !== r && l !== l;
  };
});
var ji = Or((Bt) => {
  "use strict";
  Object.defineProperty(Bt, "__esModule", { value: !0 });
  var Si = Li();
  Si.code = 'require("ajv/dist/runtime/equal").default';
  Bt.default = Si;
});
var $i = Or((Ae) => {
  "use strict";
  Ae.Identifier = Qr;
  var k = xi().default,
    q = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "u");
  function Re(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Re.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (typeof e == "string") {
        if (k(e) > 128)
          return (
            (Re.errors = [
              {
                instancePath: r,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 128 },
              },
            ]),
            !1
          );
        if (k(e) < 1)
          return (
            (Re.errors = [
              {
                instancePath: r,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!q.test(e))
          return (
            (Re.errors = [
              {
                instancePath: r,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (Re.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((Re.errors = i), t === 0);
  }
  Re.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function Qr(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Qr.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      Re(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? Re.errors : i.concat(Re.errors)), (t = i.length)),
      (Qr.errors = i),
      t === 0
    );
  }
  Qr.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  Ae.KeyId = et;
  var ue = new RegExp("^[A-Za-z0-9_-]{43}$", "u");
  function ze(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ze.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (typeof e == "string") {
        if (k(e) > 43)
          return (
            (ze.errors = [
              {
                instancePath: r,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 43 },
              },
            ]),
            !1
          );
        if (k(e) < 43)
          return (
            (ze.errors = [
              {
                instancePath: r,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 43 },
              },
            ]),
            !1
          );
        if (!ue.test(e))
          return (
            (ze.errors = [
              {
                instancePath: r,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9_-]{43}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (ze.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((ze.errors = i), t === 0);
  }
  ze.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function et(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = et.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      ze(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? ze.errors : i.concat(ze.errors)), (t = i.length)),
      (et.errors = i),
      t === 0
    );
  }
  et.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  Ae.PublicJWK = rt;
  function fe(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = fe.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.kty === void 0 && (u = "kty")) ||
          (e.crv === void 0 && (u = "crv")) ||
          (e.x === void 0 && (u = "x")) ||
          (e.y === void 0 && (u = "y"))
        )
          return (
            (fe.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "kty" || c === "crv" || c === "x" || c === "y")) {
              return (
                (fe.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.kty !== void 0) {
              let c = t;
              if (e.kty !== "EC")
                return (
                  (fe.errors = [
                    {
                      instancePath: r + "/kty",
                      schemaPath: "#/properties/kty/const",
                      keyword: "const",
                      params: { allowedValue: "EC" },
                    },
                  ]),
                  !1
                );
              var s = c === t;
            } else var s = !0;
            if (s) {
              if (e.crv !== void 0) {
                let c = t;
                if (e.crv !== "P-256")
                  return (
                    (fe.errors = [
                      {
                        instancePath: r + "/crv",
                        schemaPath: "#/properties/crv/const",
                        keyword: "const",
                        params: { allowedValue: "P-256" },
                      },
                    ]),
                    !1
                  );
                var s = c === t;
              } else var s = !0;
              if (s) {
                if (e.x !== void 0) {
                  let c = e.x,
                    a = t;
                  if (t === a)
                    if (typeof c == "string") {
                      if (k(c) > 43)
                        return (
                          (fe.errors = [
                            {
                              instancePath: r + "/x",
                              schemaPath: "#/properties/x/maxLength",
                              keyword: "maxLength",
                              params: { limit: 43 },
                            },
                          ]),
                          !1
                        );
                      if (k(c) < 43)
                        return (
                          (fe.errors = [
                            {
                              instancePath: r + "/x",
                              schemaPath: "#/properties/x/minLength",
                              keyword: "minLength",
                              params: { limit: 43 },
                            },
                          ]),
                          !1
                        );
                      if (!ue.test(c))
                        return (
                          (fe.errors = [
                            {
                              instancePath: r + "/x",
                              schemaPath: "#/properties/x/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (fe.errors = [
                          {
                            instancePath: r + "/x",
                            schemaPath: "#/properties/x/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = a === t;
                } else var s = !0;
                if (s)
                  if (e.y !== void 0) {
                    let c = e.y,
                      a = t;
                    if (t === a)
                      if (typeof c == "string") {
                        if (k(c) > 43)
                          return (
                            (fe.errors = [
                              {
                                instancePath: r + "/y",
                                schemaPath: "#/properties/y/maxLength",
                                keyword: "maxLength",
                                params: { limit: 43 },
                              },
                            ]),
                            !1
                          );
                        if (k(c) < 43)
                          return (
                            (fe.errors = [
                              {
                                instancePath: r + "/y",
                                schemaPath: "#/properties/y/minLength",
                                keyword: "minLength",
                                params: { limit: 43 },
                              },
                            ]),
                            !1
                          );
                        if (!ue.test(c))
                          return (
                            (fe.errors = [
                              {
                                instancePath: r + "/y",
                                schemaPath: "#/properties/y/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (fe.errors = [
                            {
                              instancePath: r + "/y",
                              schemaPath: "#/properties/y/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = a === t;
                  } else var s = !0;
              }
            }
          }
        }
      } else
        return (
          (fe.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((fe.errors = i), t === 0);
  }
  fe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function rt(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = rt.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      fe(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? fe.errors : i.concat(fe.errors)), (t = i.length)),
      (rt.errors = i),
      t === 0
    );
  }
  rt.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.SignedObject = tt;
  var Ke = new RegExp("^[A-Za-z0-9_-]+$", "u");
  function oe(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = oe.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.protected === void 0 && (u = "protected")) ||
          (e.payload === void 0 && (u = "payload")) ||
          (e.signature === void 0 && (u = "signature"))
        )
          return (
            (oe.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "protected" || c === "payload" || c === "signature")) {
              return (
                (oe.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.protected !== void 0) {
              let c = e.protected,
                a = t;
              if (t === a)
                if (typeof c == "string") {
                  if (k(c) > 1024)
                    return (
                      (oe.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/maxLength",
                          keyword: "maxLength",
                          params: { limit: 1024 },
                        },
                      ]),
                      !1
                    );
                  if (k(c) < 1)
                    return (
                      (oe.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!Ke.test(c))
                    return (
                      (oe.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9_-]+$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (oe.errors = [
                      {
                        instancePath: r + "/protected",
                        schemaPath: "#/properties/protected/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.payload !== void 0) {
                let c = e.payload,
                  a = t;
                if (t === a)
                  if (typeof c == "string") {
                    if (k(c) > 699051)
                      return (
                        (oe.errors = [
                          {
                            instancePath: r + "/payload",
                            schemaPath: "#/properties/payload/maxLength",
                            keyword: "maxLength",
                            params: { limit: 699051 },
                          },
                        ]),
                        !1
                      );
                    if (k(c) < 1)
                      return (
                        (oe.errors = [
                          {
                            instancePath: r + "/payload",
                            schemaPath: "#/properties/payload/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    if (!Ke.test(c))
                      return (
                        (oe.errors = [
                          {
                            instancePath: r + "/payload",
                            schemaPath: "#/properties/payload/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9_-]+$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (oe.errors = [
                        {
                          instancePath: r + "/payload",
                          schemaPath: "#/properties/payload/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = a === t;
              } else var s = !0;
              if (s)
                if (e.signature !== void 0) {
                  let c = e.signature,
                    a = t;
                  if (t === a)
                    if (typeof c == "string") {
                      if (k(c) > 86)
                        return (
                          (oe.errors = [
                            {
                              instancePath: r + "/signature",
                              schemaPath: "#/properties/signature/maxLength",
                              keyword: "maxLength",
                              params: { limit: 86 },
                            },
                          ]),
                          !1
                        );
                      if (k(c) < 86)
                        return (
                          (oe.errors = [
                            {
                              instancePath: r + "/signature",
                              schemaPath: "#/properties/signature/minLength",
                              keyword: "minLength",
                              params: { limit: 86 },
                            },
                          ]),
                          !1
                        );
                      if (!Ke.test(c))
                        return (
                          (oe.errors = [
                            {
                              instancePath: r + "/signature",
                              schemaPath: "#/properties/signature/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9_-]+$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (oe.errors = [
                          {
                            instancePath: r + "/signature",
                            schemaPath: "#/properties/signature/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = a === t;
                } else var s = !0;
            }
          }
        }
      } else
        return (
          (oe.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((oe.errors = i), t === 0);
  }
  oe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function tt(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = tt.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      oe(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? oe.errors : i.concat(oe.errors)), (t = i.length)),
      (tt.errors = i),
      t === 0
    );
  }
  tt.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.RegistryBundle = it;
  function X(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = X.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.protected === void 0 && (u = "protected")) ||
          (e.payload === void 0 && (u = "payload")) ||
          (e.signature === void 0 && (u = "signature"))
        )
          return (
            (X.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "protected" || c === "payload" || c === "signature")) {
              return (
                (X.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.protected !== void 0) {
              let c = e.protected,
                a = t;
              if (t === a)
                if (typeof c == "string") {
                  if (k(c) > 1024)
                    return (
                      (X.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/maxLength",
                          keyword: "maxLength",
                          params: { limit: 1024 },
                        },
                      ]),
                      !1
                    );
                  if (k(c) < 1)
                    return (
                      (X.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!Ke.test(c))
                    return (
                      (X.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9_-]+$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (X.errors = [
                      {
                        instancePath: r + "/protected",
                        schemaPath: "#/properties/protected/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.payload !== void 0) {
                let c = e.payload,
                  a = t;
                if (t === a)
                  if (typeof c == "string") {
                    if (k(c) > 699051)
                      return (
                        (X.errors = [
                          {
                            instancePath: r + "/payload",
                            schemaPath: "#/properties/payload/maxLength",
                            keyword: "maxLength",
                            params: { limit: 699051 },
                          },
                        ]),
                        !1
                      );
                    if (k(c) < 1)
                      return (
                        (X.errors = [
                          {
                            instancePath: r + "/payload",
                            schemaPath: "#/properties/payload/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    if (!Ke.test(c))
                      return (
                        (X.errors = [
                          {
                            instancePath: r + "/payload",
                            schemaPath: "#/properties/payload/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9_-]+$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (X.errors = [
                        {
                          instancePath: r + "/payload",
                          schemaPath: "#/properties/payload/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = a === t;
              } else var s = !0;
              if (s)
                if (e.signature !== void 0) {
                  let c = e.signature,
                    a = t;
                  if (t === a)
                    if (typeof c == "string") {
                      if (k(c) > 86)
                        return (
                          (X.errors = [
                            {
                              instancePath: r + "/signature",
                              schemaPath: "#/properties/signature/maxLength",
                              keyword: "maxLength",
                              params: { limit: 86 },
                            },
                          ]),
                          !1
                        );
                      if (k(c) < 86)
                        return (
                          (X.errors = [
                            {
                              instancePath: r + "/signature",
                              schemaPath: "#/properties/signature/minLength",
                              keyword: "minLength",
                              params: { limit: 86 },
                            },
                          ]),
                          !1
                        );
                      if (!Ke.test(c))
                        return (
                          (X.errors = [
                            {
                              instancePath: r + "/signature",
                              schemaPath: "#/properties/signature/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9_-]+$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (X.errors = [
                          {
                            instancePath: r + "/signature",
                            schemaPath: "#/properties/signature/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = a === t;
                } else var s = !0;
            }
          }
        }
      } else
        return (
          (X.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((X.errors = i), t === 0);
  }
  X.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Te(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Te.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.certificate === void 0 && (u = "certificate")) ||
          (e.active === void 0 && (u = "active"))
        )
          return (
            (Te.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "certificate" || c === "active")) {
              return (
                (Te.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.certificate !== void 0) {
              let c = t;
              X(e.certificate, {
                instancePath: r + "/certificate",
                parentData: e,
                parentDataProperty: "certificate",
                rootData: d,
                dynamicAnchors: y,
              }) || ((i = i === null ? X.errors : i.concat(X.errors)), (t = i.length));
              var s = c === t;
            } else var s = !0;
            if (s)
              if (e.active !== void 0) {
                let c = t;
                if (typeof e.active != "boolean")
                  return (
                    (Te.errors = [
                      {
                        instancePath: r + "/active",
                        schemaPath: "#/properties/active/type",
                        keyword: "type",
                        params: { type: "boolean" },
                      },
                    ]),
                    !1
                  );
                var s = c === t;
              } else var s = !0;
          }
        }
      } else
        return (
          (Te.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Te.errors = i), t === 0);
  }
  Te.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Ee(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Ee.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.contractVersion === void 0 && (w = "contractVersion")) ||
          (e.checkpoint === void 0 && (w = "checkpoint")) ||
          (e.entries === void 0 && (w = "entries"))
        )
          return (
            (Ee.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(a === "contractVersion" || a === "checkpoint" || a === "entries")) {
              return (
                (Ee.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.contractVersion !== void 0) {
              let a = t;
              if (e.contractVersion !== "folioview.agent-workspace.v2.0")
                return (
                  (Ee.errors = [
                    {
                      instancePath: r + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.agent-workspace.v2.0" },
                    },
                  ]),
                  !1
                );
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.checkpoint !== void 0) {
                let a = t;
                X(e.checkpoint, {
                  instancePath: r + "/checkpoint",
                  parentData: e,
                  parentDataProperty: "checkpoint",
                  rootData: d,
                  dynamicAnchors: y,
                }) || ((i = i === null ? X.errors : i.concat(X.errors)), (t = i.length));
                var s = a === t;
              } else var s = !0;
              if (s)
                if (e.entries !== void 0) {
                  let a = e.entries,
                    o = t;
                  if (t === o)
                    if (Array.isArray(a)) {
                      if (a.length > 64)
                        return (
                          (Ee.errors = [
                            {
                              instancePath: r + "/entries",
                              schemaPath: "#/properties/entries/maxItems",
                              keyword: "maxItems",
                              params: { limit: 64 },
                            },
                          ]),
                          !1
                        );
                      if (a.length < 1)
                        return (
                          (Ee.errors = [
                            {
                              instancePath: r + "/entries",
                              schemaPath: "#/properties/entries/minItems",
                              keyword: "minItems",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      {
                        var u = !0;
                        let p = a.length;
                        for (let h = 0; h < p; h++) {
                          let v = t;
                          Te(a[h], {
                            instancePath: r + "/entries/" + h,
                            parentData: a,
                            parentDataProperty: h,
                            rootData: d,
                            dynamicAnchors: y,
                          }) ||
                            ((i = i === null ? Te.errors : i.concat(Te.errors)), (t = i.length));
                          var u = v === t;
                          if (!u) break;
                        }
                      }
                    } else
                      return (
                        (Ee.errors = [
                          {
                            instancePath: r + "/entries",
                            schemaPath: "#/properties/entries/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ]),
                        !1
                      );
                  var s = o === t;
                } else var s = !0;
            }
          }
        }
      } else
        return (
          (Ee.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Ee.errors = i), t === 0);
  }
  Ee.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function it(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = it.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      Ee(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? Ee.errors : i.concat(Ee.errors)), (t = i.length)),
      (it.errors = i),
      t === 0
    );
  }
  it.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.RegistryCheckpointPayload = st;
  var Ks = {
      type: "object",
      properties: {
        artifactType: { const: "registry_checkpoint" },
        contractVersion: { const: "folioview.agent-workspace.v2.0" },
        vaultId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        ownerSubject: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        rootKeyId: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" },
        rootEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        registrySequence: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        previousDigest: {
          anyOf: [
            { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
            { type: "null" },
          ],
        },
        entriesDigest: { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
        keyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        revokedKeyIds: {
          type: "array",
          items: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" },
          minItems: 0,
          maxItems: 64,
          uniqueItems: !0,
        },
        issuedAt: { type: "integer", minimum: 0, maximum: 9007199254740991 },
      },
      required: [
        "artifactType",
        "contractVersion",
        "vaultId",
        "ownerSubject",
        "rootKeyId",
        "rootEpoch",
        "registrySequence",
        "previousDigest",
        "entriesDigest",
        "keyEpoch",
        "revokedKeyIds",
        "issuedAt",
      ],
      additionalProperties: !1,
    },
    Qe = Object.prototype.hasOwnProperty,
    qe = new RegExp("^[a-f0-9]{64}$", "u");
  function z(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = z.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let c;
        if (
          (e.artifactType === void 0 && (c = "artifactType")) ||
          (e.contractVersion === void 0 && (c = "contractVersion")) ||
          (e.vaultId === void 0 && (c = "vaultId")) ||
          (e.ownerSubject === void 0 && (c = "ownerSubject")) ||
          (e.rootKeyId === void 0 && (c = "rootKeyId")) ||
          (e.rootEpoch === void 0 && (c = "rootEpoch")) ||
          (e.registrySequence === void 0 && (c = "registrySequence")) ||
          (e.previousDigest === void 0 && (c = "previousDigest")) ||
          (e.entriesDigest === void 0 && (c = "entriesDigest")) ||
          (e.keyEpoch === void 0 && (c = "keyEpoch")) ||
          (e.revokedKeyIds === void 0 && (c = "revokedKeyIds")) ||
          (e.issuedAt === void 0 && (c = "issuedAt"))
        )
          return (
            (z.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: c },
              },
            ]),
            !1
          );
        {
          let a = t;
          for (let o in e)
            if (!Qe.call(Ks.properties, o)) {
              return (
                (z.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: o },
                  },
                ]),
                !1
              );
              break;
            }
          if (a === t) {
            if (e.artifactType !== void 0) {
              let o = t;
              if (e.artifactType !== "registry_checkpoint")
                return (
                  (z.errors = [
                    {
                      instancePath: r + "/artifactType",
                      schemaPath: "#/properties/artifactType/const",
                      keyword: "const",
                      params: { allowedValue: "registry_checkpoint" },
                    },
                  ]),
                  !1
                );
              var s = o === t;
            } else var s = !0;
            if (s) {
              if (e.contractVersion !== void 0) {
                let o = t;
                if (e.contractVersion !== "folioview.agent-workspace.v2.0")
                  return (
                    (z.errors = [
                      {
                        instancePath: r + "/contractVersion",
                        schemaPath: "#/properties/contractVersion/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.agent-workspace.v2.0" },
                      },
                    ]),
                    !1
                  );
                var s = o === t;
              } else var s = !0;
              if (s) {
                if (e.vaultId !== void 0) {
                  let o = e.vaultId,
                    n = t;
                  if (t === n)
                    if (typeof o == "string") {
                      if (k(o) > 128)
                        return (
                          (z.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (k(o) < 1)
                        return (
                          (z.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!q.test(o))
                        return (
                          (z.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (z.errors = [
                          {
                            instancePath: r + "/vaultId",
                            schemaPath: "#/properties/vaultId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = n === t;
                } else var s = !0;
                if (s) {
                  if (e.ownerSubject !== void 0) {
                    let o = e.ownerSubject,
                      n = t;
                    if (t === n)
                      if (typeof o == "string") {
                        if (k(o) > 128)
                          return (
                            (z.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (k(o) < 1)
                          return (
                            (z.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!q.test(o))
                          return (
                            (z.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (z.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = n === t;
                  } else var s = !0;
                  if (s) {
                    if (e.rootKeyId !== void 0) {
                      let o = e.rootKeyId,
                        n = t;
                      if (t === n)
                        if (typeof o == "string") {
                          if (k(o) > 43)
                            return (
                              (z.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 43 },
                                },
                              ]),
                              !1
                            );
                          if (k(o) < 43)
                            return (
                              (z.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/minLength",
                                  keyword: "minLength",
                                  params: { limit: 43 },
                                },
                              ]),
                              !1
                            );
                          if (!ue.test(o))
                            return (
                              (z.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (z.errors = [
                              {
                                instancePath: r + "/rootKeyId",
                                schemaPath: "#/properties/rootKeyId/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = n === t;
                    } else var s = !0;
                    if (s) {
                      if (e.rootEpoch !== void 0) {
                        let o = e.rootEpoch,
                          n = t;
                        if (!(typeof o == "number" && !(o % 1) && !isNaN(o)))
                          return (
                            (z.errors = [
                              {
                                instancePath: r + "/rootEpoch",
                                schemaPath: "#/properties/rootEpoch/type",
                                keyword: "type",
                                params: { type: "integer" },
                              },
                            ]),
                            !1
                          );
                        if (t === n && typeof o == "number") {
                          if (o > 9007199254740991 || isNaN(o))
                            return (
                              (z.errors = [
                                {
                                  instancePath: r + "/rootEpoch",
                                  schemaPath: "#/properties/rootEpoch/maximum",
                                  keyword: "maximum",
                                  params: { comparison: "<=", limit: 9007199254740991 },
                                },
                              ]),
                              !1
                            );
                          if (o < 1 || isNaN(o))
                            return (
                              (z.errors = [
                                {
                                  instancePath: r + "/rootEpoch",
                                  schemaPath: "#/properties/rootEpoch/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ]),
                              !1
                            );
                        }
                        var s = n === t;
                      } else var s = !0;
                      if (s) {
                        if (e.registrySequence !== void 0) {
                          let o = e.registrySequence,
                            n = t;
                          if (!(typeof o == "number" && !(o % 1) && !isNaN(o)))
                            return (
                              (z.errors = [
                                {
                                  instancePath: r + "/registrySequence",
                                  schemaPath: "#/properties/registrySequence/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                },
                              ]),
                              !1
                            );
                          if (t === n && typeof o == "number") {
                            if (o > 9007199254740991 || isNaN(o))
                              return (
                                (z.errors = [
                                  {
                                    instancePath: r + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  },
                                ]),
                                !1
                              );
                            if (o < 1 || isNaN(o))
                              return (
                                (z.errors = [
                                  {
                                    instancePath: r + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  },
                                ]),
                                !1
                              );
                          }
                          var s = n === t;
                        } else var s = !0;
                        if (s) {
                          if (e.previousDigest !== void 0) {
                            let o = e.previousDigest,
                              n = t,
                              p = t,
                              h = !1,
                              v = t;
                            if (t === v)
                              if (typeof o == "string") {
                                if (k(o) > 64) {
                                  let b = {
                                    instancePath: r + "/previousDigest",
                                    schemaPath: "#/properties/previousDigest/anyOf/0/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 64 },
                                  };
                                  (i === null ? (i = [b]) : i.push(b), t++);
                                } else if (k(o) < 64) {
                                  let b = {
                                    instancePath: r + "/previousDigest",
                                    schemaPath: "#/properties/previousDigest/anyOf/0/minLength",
                                    keyword: "minLength",
                                    params: { limit: 64 },
                                  };
                                  (i === null ? (i = [b]) : i.push(b), t++);
                                } else if (!qe.test(o)) {
                                  let b = {
                                    instancePath: r + "/previousDigest",
                                    schemaPath: "#/properties/previousDigest/anyOf/0/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[a-f0-9]{64}$" },
                                  };
                                  (i === null ? (i = [b]) : i.push(b), t++);
                                }
                              } else {
                                let b = {
                                  instancePath: r + "/previousDigest",
                                  schemaPath: "#/properties/previousDigest/anyOf/0/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                };
                                (i === null ? (i = [b]) : i.push(b), t++);
                              }
                            var u = v === t;
                            h = h || u;
                            let g = t;
                            if (o !== null) {
                              let b = {
                                instancePath: r + "/previousDigest",
                                schemaPath: "#/properties/previousDigest/anyOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                              };
                              (i === null ? (i = [b]) : i.push(b), t++);
                            }
                            var u = g === t;
                            if (((h = h || u), h))
                              ((t = p), i !== null && (p ? (i.length = p) : (i = null)));
                            else {
                              let b = {
                                instancePath: r + "/previousDigest",
                                schemaPath: "#/properties/previousDigest/anyOf",
                                keyword: "anyOf",
                                params: {},
                              };
                              return (i === null ? (i = [b]) : i.push(b), t++, (z.errors = i), !1);
                            }
                            var s = n === t;
                          } else var s = !0;
                          if (s) {
                            if (e.entriesDigest !== void 0) {
                              let o = e.entriesDigest,
                                n = t;
                              if (t === n)
                                if (typeof o == "string") {
                                  if (k(o) > 64)
                                    return (
                                      (z.errors = [
                                        {
                                          instancePath: r + "/entriesDigest",
                                          schemaPath: "#/properties/entriesDigest/maxLength",
                                          keyword: "maxLength",
                                          params: { limit: 64 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (k(o) < 64)
                                    return (
                                      (z.errors = [
                                        {
                                          instancePath: r + "/entriesDigest",
                                          schemaPath: "#/properties/entriesDigest/minLength",
                                          keyword: "minLength",
                                          params: { limit: 64 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (!qe.test(o))
                                    return (
                                      (z.errors = [
                                        {
                                          instancePath: r + "/entriesDigest",
                                          schemaPath: "#/properties/entriesDigest/pattern",
                                          keyword: "pattern",
                                          params: { pattern: "^[a-f0-9]{64}$" },
                                        },
                                      ]),
                                      !1
                                    );
                                } else
                                  return (
                                    (z.errors = [
                                      {
                                        instancePath: r + "/entriesDigest",
                                        schemaPath: "#/properties/entriesDigest/type",
                                        keyword: "type",
                                        params: { type: "string" },
                                      },
                                    ]),
                                    !1
                                  );
                              var s = n === t;
                            } else var s = !0;
                            if (s) {
                              if (e.keyEpoch !== void 0) {
                                let o = e.keyEpoch,
                                  n = t;
                                if (!(typeof o == "number" && !(o % 1) && !isNaN(o)))
                                  return (
                                    (z.errors = [
                                      {
                                        instancePath: r + "/keyEpoch",
                                        schemaPath: "#/properties/keyEpoch/type",
                                        keyword: "type",
                                        params: { type: "integer" },
                                      },
                                    ]),
                                    !1
                                  );
                                if (t === n && typeof o == "number") {
                                  if (o > 9007199254740991 || isNaN(o))
                                    return (
                                      (z.errors = [
                                        {
                                          instancePath: r + "/keyEpoch",
                                          schemaPath: "#/properties/keyEpoch/maximum",
                                          keyword: "maximum",
                                          params: { comparison: "<=", limit: 9007199254740991 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (o < 1 || isNaN(o))
                                    return (
                                      (z.errors = [
                                        {
                                          instancePath: r + "/keyEpoch",
                                          schemaPath: "#/properties/keyEpoch/minimum",
                                          keyword: "minimum",
                                          params: { comparison: ">=", limit: 1 },
                                        },
                                      ]),
                                      !1
                                    );
                                }
                                var s = n === t;
                              } else var s = !0;
                              if (s) {
                                if (e.revokedKeyIds !== void 0) {
                                  let o = e.revokedKeyIds,
                                    n = t;
                                  if (t === n)
                                    if (Array.isArray(o)) {
                                      if (o.length > 64)
                                        return (
                                          (z.errors = [
                                            {
                                              instancePath: r + "/revokedKeyIds",
                                              schemaPath: "#/properties/revokedKeyIds/maxItems",
                                              keyword: "maxItems",
                                              params: { limit: 64 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (o.length < 0)
                                        return (
                                          (z.errors = [
                                            {
                                              instancePath: r + "/revokedKeyIds",
                                              schemaPath: "#/properties/revokedKeyIds/minItems",
                                              keyword: "minItems",
                                              params: { limit: 0 },
                                            },
                                          ]),
                                          !1
                                        );
                                      {
                                        var w = !0;
                                        let h = o.length;
                                        for (let v = 0; v < h; v++) {
                                          let g = o[v],
                                            P = t;
                                          if (t === P)
                                            if (typeof g == "string") {
                                              if (k(g) > 43)
                                                return (
                                                  (z.errors = [
                                                    {
                                                      instancePath: r + "/revokedKeyIds/" + v,
                                                      schemaPath:
                                                        "#/properties/revokedKeyIds/items/maxLength",
                                                      keyword: "maxLength",
                                                      params: { limit: 43 },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              if (k(g) < 43)
                                                return (
                                                  (z.errors = [
                                                    {
                                                      instancePath: r + "/revokedKeyIds/" + v,
                                                      schemaPath:
                                                        "#/properties/revokedKeyIds/items/minLength",
                                                      keyword: "minLength",
                                                      params: { limit: 43 },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              if (!ue.test(g))
                                                return (
                                                  (z.errors = [
                                                    {
                                                      instancePath: r + "/revokedKeyIds/" + v,
                                                      schemaPath:
                                                        "#/properties/revokedKeyIds/items/pattern",
                                                      keyword: "pattern",
                                                      params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                            } else
                                              return (
                                                (z.errors = [
                                                  {
                                                    instancePath: r + "/revokedKeyIds/" + v,
                                                    schemaPath:
                                                      "#/properties/revokedKeyIds/items/type",
                                                    keyword: "type",
                                                    params: { type: "string" },
                                                  },
                                                ]),
                                                !1
                                              );
                                          var w = P === t;
                                          if (!w) break;
                                        }
                                        if (w) {
                                          let v = o.length,
                                            g;
                                          if (v > 1) {
                                            let P = {};
                                            for (; v--;) {
                                              let b = o[v];
                                              if (typeof b == "string") {
                                                if (typeof P[b] == "number") {
                                                  return (
                                                    (g = P[b]),
                                                    (z.errors = [
                                                      {
                                                        instancePath: r + "/revokedKeyIds",
                                                        schemaPath:
                                                          "#/properties/revokedKeyIds/uniqueItems",
                                                        keyword: "uniqueItems",
                                                        params: { i: v, j: g },
                                                      },
                                                    ]),
                                                    !1
                                                  );
                                                  break;
                                                }
                                                P[b] = v;
                                              }
                                            }
                                          }
                                        }
                                      }
                                    } else
                                      return (
                                        (z.errors = [
                                          {
                                            instancePath: r + "/revokedKeyIds",
                                            schemaPath: "#/properties/revokedKeyIds/type",
                                            keyword: "type",
                                            params: { type: "array" },
                                          },
                                        ]),
                                        !1
                                      );
                                  var s = n === t;
                                } else var s = !0;
                                if (s)
                                  if (e.issuedAt !== void 0) {
                                    let o = e.issuedAt,
                                      n = t;
                                    if (!(typeof o == "number" && !(o % 1) && !isNaN(o)))
                                      return (
                                        (z.errors = [
                                          {
                                            instancePath: r + "/issuedAt",
                                            schemaPath: "#/properties/issuedAt/type",
                                            keyword: "type",
                                            params: { type: "integer" },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (t === n && typeof o == "number") {
                                      if (o > 9007199254740991 || isNaN(o))
                                        return (
                                          (z.errors = [
                                            {
                                              instancePath: r + "/issuedAt",
                                              schemaPath: "#/properties/issuedAt/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (o < 0 || isNaN(o))
                                        return (
                                          (z.errors = [
                                            {
                                              instancePath: r + "/issuedAt",
                                              schemaPath: "#/properties/issuedAt/minimum",
                                              keyword: "minimum",
                                              params: { comparison: ">=", limit: 0 },
                                            },
                                          ]),
                                          !1
                                        );
                                    }
                                    var s = n === t;
                                  } else var s = !0;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (z.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((z.errors = i), t === 0);
  }
  z.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function st(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = st.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      z(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? z.errors : i.concat(z.errors)), (t = i.length)),
      (st.errors = i),
      t === 0
    );
  }
  st.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.KeyCertificatePayload = nt;
  var Wt = {
      type: "object",
      properties: {
        artifactType: { const: "key_certificate" },
        contractVersion: { const: "folioview.agent-workspace.v2.0" },
        vaultId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        ownerSubject: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        certificateId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        keyId: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" },
        role: {
          enum: ["root_sig", "device_sig", "device_enc", "agent_sig", "agent_enc", "recovery_enc"],
        },
        publicJwk: { $ref: "#/$defs/PublicJWK" },
        principalId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        connectionId: {
          anyOf: [
            {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
            },
            { type: "null" },
          ],
        },
        keyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        issuerKeyId: {
          type: "string",
          minLength: 43,
          maxLength: 43,
          pattern: "^[A-Za-z0-9_-]{43}$",
        },
        notBefore: { type: "integer", minimum: 0, maximum: 9007199254740991 },
        expiresAt: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        capabilities: {
          type: "array",
          items: {
            enum: ["object_write", "task_grant", "control_write", "run_request", "result_write"],
          },
          minItems: 0,
          maxItems: 5,
          uniqueItems: !0,
        },
      },
      required: [
        "artifactType",
        "contractVersion",
        "vaultId",
        "ownerSubject",
        "certificateId",
        "keyId",
        "role",
        "publicJwk",
        "principalId",
        "connectionId",
        "keyEpoch",
        "issuerKeyId",
        "notBefore",
        "expiresAt",
        "capabilities",
      ],
      additionalProperties: !1,
    },
    Ye = ji().default;
  function ne(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ne.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.kty === void 0 && (u = "kty")) ||
          (e.crv === void 0 && (u = "crv")) ||
          (e.x === void 0 && (u = "x")) ||
          (e.y === void 0 && (u = "y"))
        )
          return (
            (ne.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "kty" || c === "crv" || c === "x" || c === "y")) {
              return (
                (ne.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.kty !== void 0) {
              let c = t;
              if (e.kty !== "EC")
                return (
                  (ne.errors = [
                    {
                      instancePath: r + "/kty",
                      schemaPath: "#/properties/kty/const",
                      keyword: "const",
                      params: { allowedValue: "EC" },
                    },
                  ]),
                  !1
                );
              var s = c === t;
            } else var s = !0;
            if (s) {
              if (e.crv !== void 0) {
                let c = t;
                if (e.crv !== "P-256")
                  return (
                    (ne.errors = [
                      {
                        instancePath: r + "/crv",
                        schemaPath: "#/properties/crv/const",
                        keyword: "const",
                        params: { allowedValue: "P-256" },
                      },
                    ]),
                    !1
                  );
                var s = c === t;
              } else var s = !0;
              if (s) {
                if (e.x !== void 0) {
                  let c = e.x,
                    a = t;
                  if (t === a)
                    if (typeof c == "string") {
                      if (k(c) > 43)
                        return (
                          (ne.errors = [
                            {
                              instancePath: r + "/x",
                              schemaPath: "#/properties/x/maxLength",
                              keyword: "maxLength",
                              params: { limit: 43 },
                            },
                          ]),
                          !1
                        );
                      if (k(c) < 43)
                        return (
                          (ne.errors = [
                            {
                              instancePath: r + "/x",
                              schemaPath: "#/properties/x/minLength",
                              keyword: "minLength",
                              params: { limit: 43 },
                            },
                          ]),
                          !1
                        );
                      if (!ue.test(c))
                        return (
                          (ne.errors = [
                            {
                              instancePath: r + "/x",
                              schemaPath: "#/properties/x/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (ne.errors = [
                          {
                            instancePath: r + "/x",
                            schemaPath: "#/properties/x/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = a === t;
                } else var s = !0;
                if (s)
                  if (e.y !== void 0) {
                    let c = e.y,
                      a = t;
                    if (t === a)
                      if (typeof c == "string") {
                        if (k(c) > 43)
                          return (
                            (ne.errors = [
                              {
                                instancePath: r + "/y",
                                schemaPath: "#/properties/y/maxLength",
                                keyword: "maxLength",
                                params: { limit: 43 },
                              },
                            ]),
                            !1
                          );
                        if (k(c) < 43)
                          return (
                            (ne.errors = [
                              {
                                instancePath: r + "/y",
                                schemaPath: "#/properties/y/minLength",
                                keyword: "minLength",
                                params: { limit: 43 },
                              },
                            ]),
                            !1
                          );
                        if (!ue.test(c))
                          return (
                            (ne.errors = [
                              {
                                instancePath: r + "/y",
                                schemaPath: "#/properties/y/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (ne.errors = [
                            {
                              instancePath: r + "/y",
                              schemaPath: "#/properties/y/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = a === t;
                  } else var s = !0;
              }
            }
          }
        }
      } else
        return (
          (ne.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ne.errors = i), t === 0);
  }
  ne.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function R(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = R.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let c;
        if (
          (e.artifactType === void 0 && (c = "artifactType")) ||
          (e.contractVersion === void 0 && (c = "contractVersion")) ||
          (e.vaultId === void 0 && (c = "vaultId")) ||
          (e.ownerSubject === void 0 && (c = "ownerSubject")) ||
          (e.certificateId === void 0 && (c = "certificateId")) ||
          (e.keyId === void 0 && (c = "keyId")) ||
          (e.role === void 0 && (c = "role")) ||
          (e.publicJwk === void 0 && (c = "publicJwk")) ||
          (e.principalId === void 0 && (c = "principalId")) ||
          (e.connectionId === void 0 && (c = "connectionId")) ||
          (e.keyEpoch === void 0 && (c = "keyEpoch")) ||
          (e.issuerKeyId === void 0 && (c = "issuerKeyId")) ||
          (e.notBefore === void 0 && (c = "notBefore")) ||
          (e.expiresAt === void 0 && (c = "expiresAt")) ||
          (e.capabilities === void 0 && (c = "capabilities"))
        )
          return (
            (R.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: c },
              },
            ]),
            !1
          );
        {
          let a = t;
          for (let o in e)
            if (!Qe.call(Wt.properties, o)) {
              return (
                (R.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: o },
                  },
                ]),
                !1
              );
              break;
            }
          if (a === t) {
            if (e.artifactType !== void 0) {
              let o = t;
              if (e.artifactType !== "key_certificate")
                return (
                  (R.errors = [
                    {
                      instancePath: r + "/artifactType",
                      schemaPath: "#/properties/artifactType/const",
                      keyword: "const",
                      params: { allowedValue: "key_certificate" },
                    },
                  ]),
                  !1
                );
              var s = o === t;
            } else var s = !0;
            if (s) {
              if (e.contractVersion !== void 0) {
                let o = t;
                if (e.contractVersion !== "folioview.agent-workspace.v2.0")
                  return (
                    (R.errors = [
                      {
                        instancePath: r + "/contractVersion",
                        schemaPath: "#/properties/contractVersion/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.agent-workspace.v2.0" },
                      },
                    ]),
                    !1
                  );
                var s = o === t;
              } else var s = !0;
              if (s) {
                if (e.vaultId !== void 0) {
                  let o = e.vaultId,
                    n = t;
                  if (t === n)
                    if (typeof o == "string") {
                      if (k(o) > 128)
                        return (
                          (R.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (k(o) < 1)
                        return (
                          (R.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!q.test(o))
                        return (
                          (R.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (R.errors = [
                          {
                            instancePath: r + "/vaultId",
                            schemaPath: "#/properties/vaultId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = n === t;
                } else var s = !0;
                if (s) {
                  if (e.ownerSubject !== void 0) {
                    let o = e.ownerSubject,
                      n = t;
                    if (t === n)
                      if (typeof o == "string") {
                        if (k(o) > 128)
                          return (
                            (R.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (k(o) < 1)
                          return (
                            (R.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!q.test(o))
                          return (
                            (R.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (R.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = n === t;
                  } else var s = !0;
                  if (s) {
                    if (e.certificateId !== void 0) {
                      let o = e.certificateId,
                        n = t;
                      if (t === n)
                        if (typeof o == "string") {
                          if (k(o) > 128)
                            return (
                              (R.errors = [
                                {
                                  instancePath: r + "/certificateId",
                                  schemaPath: "#/properties/certificateId/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 128 },
                                },
                              ]),
                              !1
                            );
                          if (k(o) < 1)
                            return (
                              (R.errors = [
                                {
                                  instancePath: r + "/certificateId",
                                  schemaPath: "#/properties/certificateId/minLength",
                                  keyword: "minLength",
                                  params: { limit: 1 },
                                },
                              ]),
                              !1
                            );
                          if (!q.test(o))
                            return (
                              (R.errors = [
                                {
                                  instancePath: r + "/certificateId",
                                  schemaPath: "#/properties/certificateId/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (R.errors = [
                              {
                                instancePath: r + "/certificateId",
                                schemaPath: "#/properties/certificateId/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = n === t;
                    } else var s = !0;
                    if (s) {
                      if (e.keyId !== void 0) {
                        let o = e.keyId,
                          n = t;
                        if (t === n)
                          if (typeof o == "string") {
                            if (k(o) > 43)
                              return (
                                (R.errors = [
                                  {
                                    instancePath: r + "/keyId",
                                    schemaPath: "#/properties/keyId/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 43 },
                                  },
                                ]),
                                !1
                              );
                            if (k(o) < 43)
                              return (
                                (R.errors = [
                                  {
                                    instancePath: r + "/keyId",
                                    schemaPath: "#/properties/keyId/minLength",
                                    keyword: "minLength",
                                    params: { limit: 43 },
                                  },
                                ]),
                                !1
                              );
                            if (!ue.test(o))
                              return (
                                (R.errors = [
                                  {
                                    instancePath: r + "/keyId",
                                    schemaPath: "#/properties/keyId/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (R.errors = [
                                {
                                  instancePath: r + "/keyId",
                                  schemaPath: "#/properties/keyId/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var s = n === t;
                      } else var s = !0;
                      if (s) {
                        if (e.role !== void 0) {
                          let o = e.role,
                            n = t;
                          if (!(
                            o === "root_sig" ||
                            o === "device_sig" ||
                            o === "device_enc" ||
                            o === "agent_sig" ||
                            o === "agent_enc" ||
                            o === "recovery_enc"
                          ))
                            return (
                              (R.errors = [
                                {
                                  instancePath: r + "/role",
                                  schemaPath: "#/properties/role/enum",
                                  keyword: "enum",
                                  params: { allowedValues: Wt.properties.role.enum },
                                },
                              ]),
                              !1
                            );
                          var s = n === t;
                        } else var s = !0;
                        if (s) {
                          if (e.publicJwk !== void 0) {
                            let o = t;
                            ne(e.publicJwk, {
                              instancePath: r + "/publicJwk",
                              parentData: e,
                              parentDataProperty: "publicJwk",
                              rootData: d,
                              dynamicAnchors: y,
                            }) ||
                              ((i = i === null ? ne.errors : i.concat(ne.errors)), (t = i.length));
                            var s = o === t;
                          } else var s = !0;
                          if (s) {
                            if (e.principalId !== void 0) {
                              let o = e.principalId,
                                n = t;
                              if (t === n)
                                if (typeof o == "string") {
                                  if (k(o) > 128)
                                    return (
                                      (R.errors = [
                                        {
                                          instancePath: r + "/principalId",
                                          schemaPath: "#/properties/principalId/maxLength",
                                          keyword: "maxLength",
                                          params: { limit: 128 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (k(o) < 1)
                                    return (
                                      (R.errors = [
                                        {
                                          instancePath: r + "/principalId",
                                          schemaPath: "#/properties/principalId/minLength",
                                          keyword: "minLength",
                                          params: { limit: 1 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (!q.test(o))
                                    return (
                                      (R.errors = [
                                        {
                                          instancePath: r + "/principalId",
                                          schemaPath: "#/properties/principalId/pattern",
                                          keyword: "pattern",
                                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                        },
                                      ]),
                                      !1
                                    );
                                } else
                                  return (
                                    (R.errors = [
                                      {
                                        instancePath: r + "/principalId",
                                        schemaPath: "#/properties/principalId/type",
                                        keyword: "type",
                                        params: { type: "string" },
                                      },
                                    ]),
                                    !1
                                  );
                              var s = n === t;
                            } else var s = !0;
                            if (s) {
                              if (e.connectionId !== void 0) {
                                let o = e.connectionId,
                                  n = t,
                                  p = t,
                                  h = !1,
                                  v = t;
                                if (t === v)
                                  if (typeof o == "string") {
                                    if (k(o) > 128) {
                                      let b = {
                                        instancePath: r + "/connectionId",
                                        schemaPath: "#/properties/connectionId/anyOf/0/maxLength",
                                        keyword: "maxLength",
                                        params: { limit: 128 },
                                      };
                                      (i === null ? (i = [b]) : i.push(b), t++);
                                    } else if (k(o) < 1) {
                                      let b = {
                                        instancePath: r + "/connectionId",
                                        schemaPath: "#/properties/connectionId/anyOf/0/minLength",
                                        keyword: "minLength",
                                        params: { limit: 1 },
                                      };
                                      (i === null ? (i = [b]) : i.push(b), t++);
                                    } else if (!q.test(o)) {
                                      let b = {
                                        instancePath: r + "/connectionId",
                                        schemaPath: "#/properties/connectionId/anyOf/0/pattern",
                                        keyword: "pattern",
                                        params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                      };
                                      (i === null ? (i = [b]) : i.push(b), t++);
                                    }
                                  } else {
                                    let b = {
                                      instancePath: r + "/connectionId",
                                      schemaPath: "#/properties/connectionId/anyOf/0/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                    };
                                    (i === null ? (i = [b]) : i.push(b), t++);
                                  }
                                var u = v === t;
                                h = h || u;
                                let g = t;
                                if (o !== null) {
                                  let b = {
                                    instancePath: r + "/connectionId",
                                    schemaPath: "#/properties/connectionId/anyOf/1/type",
                                    keyword: "type",
                                    params: { type: "null" },
                                  };
                                  (i === null ? (i = [b]) : i.push(b), t++);
                                }
                                var u = g === t;
                                if (((h = h || u), h))
                                  ((t = p), i !== null && (p ? (i.length = p) : (i = null)));
                                else {
                                  let b = {
                                    instancePath: r + "/connectionId",
                                    schemaPath: "#/properties/connectionId/anyOf",
                                    keyword: "anyOf",
                                    params: {},
                                  };
                                  return (
                                    i === null ? (i = [b]) : i.push(b),
                                    t++,
                                    (R.errors = i),
                                    !1
                                  );
                                }
                                var s = n === t;
                              } else var s = !0;
                              if (s) {
                                if (e.keyEpoch !== void 0) {
                                  let o = e.keyEpoch,
                                    n = t;
                                  if (!(typeof o == "number" && !(o % 1) && !isNaN(o)))
                                    return (
                                      (R.errors = [
                                        {
                                          instancePath: r + "/keyEpoch",
                                          schemaPath: "#/properties/keyEpoch/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (t === n && typeof o == "number") {
                                    if (o > 9007199254740991 || isNaN(o))
                                      return (
                                        (R.errors = [
                                          {
                                            instancePath: r + "/keyEpoch",
                                            schemaPath: "#/properties/keyEpoch/maximum",
                                            keyword: "maximum",
                                            params: { comparison: "<=", limit: 9007199254740991 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (o < 1 || isNaN(o))
                                      return (
                                        (R.errors = [
                                          {
                                            instancePath: r + "/keyEpoch",
                                            schemaPath: "#/properties/keyEpoch/minimum",
                                            keyword: "minimum",
                                            params: { comparison: ">=", limit: 1 },
                                          },
                                        ]),
                                        !1
                                      );
                                  }
                                  var s = n === t;
                                } else var s = !0;
                                if (s) {
                                  if (e.issuerKeyId !== void 0) {
                                    let o = e.issuerKeyId,
                                      n = t;
                                    if (t === n)
                                      if (typeof o == "string") {
                                        if (k(o) > 43)
                                          return (
                                            (R.errors = [
                                              {
                                                instancePath: r + "/issuerKeyId",
                                                schemaPath: "#/properties/issuerKeyId/maxLength",
                                                keyword: "maxLength",
                                                params: { limit: 43 },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (k(o) < 43)
                                          return (
                                            (R.errors = [
                                              {
                                                instancePath: r + "/issuerKeyId",
                                                schemaPath: "#/properties/issuerKeyId/minLength",
                                                keyword: "minLength",
                                                params: { limit: 43 },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (!ue.test(o))
                                          return (
                                            (R.errors = [
                                              {
                                                instancePath: r + "/issuerKeyId",
                                                schemaPath: "#/properties/issuerKeyId/pattern",
                                                keyword: "pattern",
                                                params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                              },
                                            ]),
                                            !1
                                          );
                                      } else
                                        return (
                                          (R.errors = [
                                            {
                                              instancePath: r + "/issuerKeyId",
                                              schemaPath: "#/properties/issuerKeyId/type",
                                              keyword: "type",
                                              params: { type: "string" },
                                            },
                                          ]),
                                          !1
                                        );
                                    var s = n === t;
                                  } else var s = !0;
                                  if (s) {
                                    if (e.notBefore !== void 0) {
                                      let o = e.notBefore,
                                        n = t;
                                      if (!(typeof o == "number" && !(o % 1) && !isNaN(o)))
                                        return (
                                          (R.errors = [
                                            {
                                              instancePath: r + "/notBefore",
                                              schemaPath: "#/properties/notBefore/type",
                                              keyword: "type",
                                              params: { type: "integer" },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (t === n && typeof o == "number") {
                                        if (o > 9007199254740991 || isNaN(o))
                                          return (
                                            (R.errors = [
                                              {
                                                instancePath: r + "/notBefore",
                                                schemaPath: "#/properties/notBefore/maximum",
                                                keyword: "maximum",
                                                params: {
                                                  comparison: "<=",
                                                  limit: 9007199254740991,
                                                },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (o < 0 || isNaN(o))
                                          return (
                                            (R.errors = [
                                              {
                                                instancePath: r + "/notBefore",
                                                schemaPath: "#/properties/notBefore/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 0 },
                                              },
                                            ]),
                                            !1
                                          );
                                      }
                                      var s = n === t;
                                    } else var s = !0;
                                    if (s) {
                                      if (e.expiresAt !== void 0) {
                                        let o = e.expiresAt,
                                          n = t;
                                        if (!(typeof o == "number" && !(o % 1) && !isNaN(o)))
                                          return (
                                            (R.errors = [
                                              {
                                                instancePath: r + "/expiresAt",
                                                schemaPath: "#/properties/expiresAt/type",
                                                keyword: "type",
                                                params: { type: "integer" },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (t === n && typeof o == "number") {
                                          if (o > 9007199254740991 || isNaN(o))
                                            return (
                                              (R.errors = [
                                                {
                                                  instancePath: r + "/expiresAt",
                                                  schemaPath: "#/properties/expiresAt/maximum",
                                                  keyword: "maximum",
                                                  params: {
                                                    comparison: "<=",
                                                    limit: 9007199254740991,
                                                  },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (o < 1 || isNaN(o))
                                            return (
                                              (R.errors = [
                                                {
                                                  instancePath: r + "/expiresAt",
                                                  schemaPath: "#/properties/expiresAt/minimum",
                                                  keyword: "minimum",
                                                  params: { comparison: ">=", limit: 1 },
                                                },
                                              ]),
                                              !1
                                            );
                                        }
                                        var s = n === t;
                                      } else var s = !0;
                                      if (s)
                                        if (e.capabilities !== void 0) {
                                          let o = e.capabilities,
                                            n = t;
                                          if (t === n)
                                            if (Array.isArray(o)) {
                                              if (o.length > 5)
                                                return (
                                                  (R.errors = [
                                                    {
                                                      instancePath: r + "/capabilities",
                                                      schemaPath:
                                                        "#/properties/capabilities/maxItems",
                                                      keyword: "maxItems",
                                                      params: { limit: 5 },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              if (o.length < 0)
                                                return (
                                                  (R.errors = [
                                                    {
                                                      instancePath: r + "/capabilities",
                                                      schemaPath:
                                                        "#/properties/capabilities/minItems",
                                                      keyword: "minItems",
                                                      params: { limit: 0 },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              {
                                                var w = !0;
                                                let h = o.length;
                                                for (let v = 0; v < h; v++) {
                                                  let g = o[v],
                                                    P = t;
                                                  if (!(
                                                    g === "object_write" ||
                                                    g === "task_grant" ||
                                                    g === "control_write" ||
                                                    g === "run_request" ||
                                                    g === "result_write"
                                                  ))
                                                    return (
                                                      (R.errors = [
                                                        {
                                                          instancePath: r + "/capabilities/" + v,
                                                          schemaPath:
                                                            "#/properties/capabilities/items/enum",
                                                          keyword: "enum",
                                                          params: {
                                                            allowedValues:
                                                              Wt.properties.capabilities.items.enum,
                                                          },
                                                        },
                                                      ]),
                                                      !1
                                                    );
                                                  var w = P === t;
                                                  if (!w) break;
                                                }
                                                if (w) {
                                                  let v = o.length,
                                                    g;
                                                  if (v > 1) {
                                                    e: for (; v--;)
                                                      for (g = v; g--;)
                                                        if (Ye(o[v], o[g])) {
                                                          return (
                                                            (R.errors = [
                                                              {
                                                                instancePath: r + "/capabilities",
                                                                schemaPath:
                                                                  "#/properties/capabilities/uniqueItems",
                                                                keyword: "uniqueItems",
                                                                params: { i: v, j: g },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                          break e;
                                                        }
                                                  }
                                                }
                                              }
                                            } else
                                              return (
                                                (R.errors = [
                                                  {
                                                    instancePath: r + "/capabilities",
                                                    schemaPath: "#/properties/capabilities/type",
                                                    keyword: "type",
                                                    params: { type: "array" },
                                                  },
                                                ]),
                                                !1
                                              );
                                          var s = n === t;
                                        } else var s = !0;
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (R.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((R.errors = i), t === 0);
  }
  R.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function nt(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = nt.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      R(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? R.errors : i.concat(R.errors)), (t = i.length)),
      (nt.errors = i),
      t === 0
    );
  }
  nt.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.AgentKeyGrantPayload = at;
  var Ft = {
      type: "object",
      properties: {
        artifactType: { const: "agent_key_grant" },
        contractVersion: { const: "folioview.agent-workspace.v2.0" },
        vaultId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        ownerSubject: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        authorizationId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        deviceSigningKeyId: {
          type: "string",
          minLength: 43,
          maxLength: 43,
          pattern: "^[A-Za-z0-9_-]{43}$",
        },
        connectionId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        taskId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        taskVersions: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 9007199254740991 },
          minItems: 1,
          maxItems: 50,
          uniqueItems: !0,
        },
        executionEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        grantId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        grantEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        agentSigningKeyId: {
          type: "string",
          minLength: 43,
          maxLength: 43,
          pattern: "^[A-Za-z0-9_-]{43}$",
        },
        agentSigningKeyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        agentEncryptionKeyId: {
          type: "string",
          minLength: 43,
          maxLength: 43,
          pattern: "^[A-Za-z0-9_-]{43}$",
        },
        agentEncryptionKeyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        keyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        resourceBindings: {
          type: "array",
          items: { $ref: "#/$defs/GrantResourceBinding" },
          minItems: 0,
          maxItems: 10,
          uniqueItems: !0,
        },
        capabilities: {
          type: "array",
          items: { enum: ["decrypt_task", "decrypt_resources", "encrypt_result"] },
          minItems: 1,
          maxItems: 3,
          uniqueItems: !0,
        },
        writebackRecipientKeyIds: {
          type: "array",
          items: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" },
          minItems: 2,
          maxItems: 8,
          uniqueItems: !0,
        },
        historyPolicy: { enum: ["none", "selected"] },
        notBefore: { type: "integer", minimum: 0, maximum: 9007199254740991 },
        expiresAt: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        registrySequence: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        checkpointDigest: {
          type: "string",
          minLength: 64,
          maxLength: 64,
          pattern: "^[a-f0-9]{64}$",
        },
      },
      required: [
        "artifactType",
        "contractVersion",
        "vaultId",
        "ownerSubject",
        "authorizationId",
        "deviceSigningKeyId",
        "connectionId",
        "taskId",
        "taskVersions",
        "executionEpoch",
        "grantId",
        "grantEpoch",
        "agentSigningKeyId",
        "agentSigningKeyEpoch",
        "agentEncryptionKeyId",
        "agentEncryptionKeyEpoch",
        "keyEpoch",
        "resourceBindings",
        "capabilities",
        "writebackRecipientKeyIds",
        "historyPolicy",
        "notBefore",
        "expiresAt",
        "registrySequence",
        "checkpointDigest",
      ],
      additionalProperties: !1,
    },
    Os = {
      type: "object",
      properties: {
        ref: { $ref: "#/$defs/ResourceRef" },
        sourceEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        versionAccess: { enum: ["selected", "future_within_source_epoch"] },
        selectedVersions: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 9007199254740991 },
          minItems: 0,
          maxItems: 50,
          uniqueItems: !0,
        },
      },
      required: ["ref", "sourceEpoch", "versionAccess", "selectedVersions"],
      additionalProperties: !1,
    },
    Ki = {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["watchlist", "channel_follows", "holdings"] },
        sourceService: { type: "string", enum: ["user", "portfolio"] },
        resourceId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        incarnation: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
      },
      required: ["kind", "sourceService", "resourceId", "incarnation"],
      additionalProperties: !1,
      allOf: [
        {
          if: { properties: { kind: { const: "holdings" } } },
          then: { properties: { sourceService: { const: "portfolio" } } },
          else: { properties: { sourceService: { const: "user" } } },
        },
      ],
    };
  function B(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = B.evaluated;
    (m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0));
    let s = t,
      u = !0,
      w = t;
    if (
      e &&
      typeof e == "object" &&
      !Array.isArray(e) &&
      e.kind !== void 0 &&
      e.kind !== "holdings"
    ) {
      let p = {};
      (i === null ? (i = [p]) : i.push(p), t++);
    }
    var c = w === t;
    ((t = s), i !== null && (s ? (i.length = s) : (i = null)));
    let a;
    if (c) {
      let p = t;
      if (
        e &&
        typeof e == "object" &&
        !Array.isArray(e) &&
        e.sourceService !== void 0 &&
        e.sourceService !== "portfolio"
      )
        return (
          (B.errors = [
            {
              instancePath: r + "/sourceService",
              schemaPath: "#/allOf/0/then/properties/sourceService/const",
              keyword: "const",
              params: { allowedValue: "portfolio" },
            },
          ]),
          !1
        );
      var c = p === t;
      if (((u = c), u)) {
        var o = {};
        ((o.sourceService = !0), (o.kind = !0));
      }
      a = "then";
    } else {
      let p = t;
      if (
        e &&
        typeof e == "object" &&
        !Array.isArray(e) &&
        e.sourceService !== void 0 &&
        e.sourceService !== "user"
      )
        return (
          (B.errors = [
            {
              instancePath: r + "/sourceService",
              schemaPath: "#/allOf/0/else/properties/sourceService/const",
              keyword: "const",
              params: { allowedValue: "user" },
            },
          ]),
          !1
        );
      var c = p === t;
      ((u = c), u && o !== !0 && ((o = o || {}), (o.sourceService = !0)), (a = "else"));
    }
    if (!u) {
      let p = {
        instancePath: r,
        schemaPath: "#/allOf/0/if",
        keyword: "if",
        params: { failingKeyword: a },
      };
      return (i === null ? (i = [p]) : i.push(p), t++, (B.errors = i), !1);
    }
    if (t === 0)
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let p;
        if (
          (e.kind === void 0 && (p = "kind")) ||
          (e.sourceService === void 0 && (p = "sourceService")) ||
          (e.resourceId === void 0 && (p = "resourceId")) ||
          (e.incarnation === void 0 && (p = "incarnation"))
        )
          return (
            (B.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: p },
              },
            ]),
            !1
          );
        {
          let h = t;
          for (let v in e)
            if (!(
              v === "kind" ||
              v === "sourceService" ||
              v === "resourceId" ||
              v === "incarnation"
            )) {
              return (
                (B.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: v },
                  },
                ]),
                !1
              );
              break;
            }
          if (h === t) {
            if (e.kind !== void 0) {
              let v = e.kind,
                g = t;
              if (typeof v != "string")
                return (
                  (B.errors = [
                    {
                      instancePath: r + "/kind",
                      schemaPath: "#/properties/kind/type",
                      keyword: "type",
                      params: { type: "string" },
                    },
                  ]),
                  !1
                );
              if (!(v === "watchlist" || v === "channel_follows" || v === "holdings"))
                return (
                  (B.errors = [
                    {
                      instancePath: r + "/kind",
                      schemaPath: "#/properties/kind/enum",
                      keyword: "enum",
                      params: { allowedValues: Ki.properties.kind.enum },
                    },
                  ]),
                  !1
                );
              var n = g === t;
            } else var n = !0;
            if (n) {
              if (e.sourceService !== void 0) {
                let v = e.sourceService,
                  g = t;
                if (typeof v != "string")
                  return (
                    (B.errors = [
                      {
                        instancePath: r + "/sourceService",
                        schemaPath: "#/properties/sourceService/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
                if (!(v === "user" || v === "portfolio"))
                  return (
                    (B.errors = [
                      {
                        instancePath: r + "/sourceService",
                        schemaPath: "#/properties/sourceService/enum",
                        keyword: "enum",
                        params: { allowedValues: Ki.properties.sourceService.enum },
                      },
                    ]),
                    !1
                  );
                var n = g === t;
              } else var n = !0;
              if (n) {
                if (e.resourceId !== void 0) {
                  let v = e.resourceId,
                    g = t;
                  if (t === g)
                    if (typeof v == "string") {
                      if (k(v) > 128)
                        return (
                          (B.errors = [
                            {
                              instancePath: r + "/resourceId",
                              schemaPath: "#/properties/resourceId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (k(v) < 1)
                        return (
                          (B.errors = [
                            {
                              instancePath: r + "/resourceId",
                              schemaPath: "#/properties/resourceId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!q.test(v))
                        return (
                          (B.errors = [
                            {
                              instancePath: r + "/resourceId",
                              schemaPath: "#/properties/resourceId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (B.errors = [
                          {
                            instancePath: r + "/resourceId",
                            schemaPath: "#/properties/resourceId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var n = g === t;
                } else var n = !0;
                if (n)
                  if (e.incarnation !== void 0) {
                    let v = e.incarnation,
                      g = t;
                    if (t === g)
                      if (typeof v == "string") {
                        if (k(v) > 128)
                          return (
                            (B.errors = [
                              {
                                instancePath: r + "/incarnation",
                                schemaPath: "#/properties/incarnation/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (k(v) < 1)
                          return (
                            (B.errors = [
                              {
                                instancePath: r + "/incarnation",
                                schemaPath: "#/properties/incarnation/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!q.test(v))
                          return (
                            (B.errors = [
                              {
                                instancePath: r + "/incarnation",
                                schemaPath: "#/properties/incarnation/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (B.errors = [
                            {
                              instancePath: r + "/incarnation",
                              schemaPath: "#/properties/incarnation/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var n = g === t;
                  } else var n = !0;
              }
            }
          }
        }
      } else
        return (
          (B.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((B.errors = i), t === 0);
  }
  B.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function le(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = le.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.ref === void 0 && (w = "ref")) ||
          (e.sourceEpoch === void 0 && (w = "sourceEpoch")) ||
          (e.versionAccess === void 0 && (w = "versionAccess")) ||
          (e.selectedVersions === void 0 && (w = "selectedVersions"))
        )
          return (
            (le.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(
              a === "ref" ||
              a === "sourceEpoch" ||
              a === "versionAccess" ||
              a === "selectedVersions"
            )) {
              return (
                (le.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.ref !== void 0) {
              let a = t;
              B(e.ref, {
                instancePath: r + "/ref",
                parentData: e,
                parentDataProperty: "ref",
                rootData: d,
                dynamicAnchors: y,
              }) || ((i = i === null ? B.errors : i.concat(B.errors)), (t = i.length));
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.sourceEpoch !== void 0) {
                let a = e.sourceEpoch,
                  o = t;
                if (!(typeof a == "number" && !(a % 1) && !isNaN(a)))
                  return (
                    (le.errors = [
                      {
                        instancePath: r + "/sourceEpoch",
                        schemaPath: "#/properties/sourceEpoch/type",
                        keyword: "type",
                        params: { type: "integer" },
                      },
                    ]),
                    !1
                  );
                if (t === o && typeof a == "number") {
                  if (a > 9007199254740991 || isNaN(a))
                    return (
                      (le.errors = [
                        {
                          instancePath: r + "/sourceEpoch",
                          schemaPath: "#/properties/sourceEpoch/maximum",
                          keyword: "maximum",
                          params: { comparison: "<=", limit: 9007199254740991 },
                        },
                      ]),
                      !1
                    );
                  if (a < 1 || isNaN(a))
                    return (
                      (le.errors = [
                        {
                          instancePath: r + "/sourceEpoch",
                          schemaPath: "#/properties/sourceEpoch/minimum",
                          keyword: "minimum",
                          params: { comparison: ">=", limit: 1 },
                        },
                      ]),
                      !1
                    );
                }
                var s = o === t;
              } else var s = !0;
              if (s) {
                if (e.versionAccess !== void 0) {
                  let a = e.versionAccess,
                    o = t;
                  if (!(a === "selected" || a === "future_within_source_epoch"))
                    return (
                      (le.errors = [
                        {
                          instancePath: r + "/versionAccess",
                          schemaPath: "#/properties/versionAccess/enum",
                          keyword: "enum",
                          params: { allowedValues: Os.properties.versionAccess.enum },
                        },
                      ]),
                      !1
                    );
                  var s = o === t;
                } else var s = !0;
                if (s)
                  if (e.selectedVersions !== void 0) {
                    let a = e.selectedVersions,
                      o = t;
                    if (t === o)
                      if (Array.isArray(a)) {
                        if (a.length > 50)
                          return (
                            (le.errors = [
                              {
                                instancePath: r + "/selectedVersions",
                                schemaPath: "#/properties/selectedVersions/maxItems",
                                keyword: "maxItems",
                                params: { limit: 50 },
                              },
                            ]),
                            !1
                          );
                        if (a.length < 0)
                          return (
                            (le.errors = [
                              {
                                instancePath: r + "/selectedVersions",
                                schemaPath: "#/properties/selectedVersions/minItems",
                                keyword: "minItems",
                                params: { limit: 0 },
                              },
                            ]),
                            !1
                          );
                        {
                          var u = !0;
                          let p = a.length;
                          for (let h = 0; h < p; h++) {
                            let v = a[h],
                              g = t;
                            if (!(typeof v == "number" && !(v % 1) && !isNaN(v)))
                              return (
                                (le.errors = [
                                  {
                                    instancePath: r + "/selectedVersions/" + h,
                                    schemaPath: "#/properties/selectedVersions/items/type",
                                    keyword: "type",
                                    params: { type: "integer" },
                                  },
                                ]),
                                !1
                              );
                            if (t === g && typeof v == "number") {
                              if (v > 9007199254740991 || isNaN(v))
                                return (
                                  (le.errors = [
                                    {
                                      instancePath: r + "/selectedVersions/" + h,
                                      schemaPath: "#/properties/selectedVersions/items/maximum",
                                      keyword: "maximum",
                                      params: { comparison: "<=", limit: 9007199254740991 },
                                    },
                                  ]),
                                  !1
                                );
                              if (v < 1 || isNaN(v))
                                return (
                                  (le.errors = [
                                    {
                                      instancePath: r + "/selectedVersions/" + h,
                                      schemaPath: "#/properties/selectedVersions/items/minimum",
                                      keyword: "minimum",
                                      params: { comparison: ">=", limit: 1 },
                                    },
                                  ]),
                                  !1
                                );
                            }
                            var u = g === t;
                            if (!u) break;
                          }
                          if (u) {
                            let h = a.length,
                              v;
                            if (h > 1) {
                              let g = {};
                              for (; h--;) {
                                let P = a[h];
                                if (typeof P == "number" && !(P % 1) && !isNaN(P)) {
                                  if (typeof g[P] == "number") {
                                    return (
                                      (v = g[P]),
                                      (le.errors = [
                                        {
                                          instancePath: r + "/selectedVersions",
                                          schemaPath: "#/properties/selectedVersions/uniqueItems",
                                          keyword: "uniqueItems",
                                          params: { i: h, j: v },
                                        },
                                      ]),
                                      !1
                                    );
                                    break;
                                  }
                                  g[P] = h;
                                }
                              }
                            }
                          }
                        }
                      } else
                        return (
                          (le.errors = [
                            {
                              instancePath: r + "/selectedVersions",
                              schemaPath: "#/properties/selectedVersions/type",
                              keyword: "type",
                              params: { type: "array" },
                            },
                          ]),
                          !1
                        );
                    var s = o === t;
                  } else var s = !0;
              }
            }
          }
        }
      } else
        return (
          (le.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((le.errors = i), t === 0);
  }
  le.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function E(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = E.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let o;
        if (
          (e.artifactType === void 0 && (o = "artifactType")) ||
          (e.contractVersion === void 0 && (o = "contractVersion")) ||
          (e.vaultId === void 0 && (o = "vaultId")) ||
          (e.ownerSubject === void 0 && (o = "ownerSubject")) ||
          (e.authorizationId === void 0 && (o = "authorizationId")) ||
          (e.deviceSigningKeyId === void 0 && (o = "deviceSigningKeyId")) ||
          (e.connectionId === void 0 && (o = "connectionId")) ||
          (e.taskId === void 0 && (o = "taskId")) ||
          (e.taskVersions === void 0 && (o = "taskVersions")) ||
          (e.executionEpoch === void 0 && (o = "executionEpoch")) ||
          (e.grantId === void 0 && (o = "grantId")) ||
          (e.grantEpoch === void 0 && (o = "grantEpoch")) ||
          (e.agentSigningKeyId === void 0 && (o = "agentSigningKeyId")) ||
          (e.agentSigningKeyEpoch === void 0 && (o = "agentSigningKeyEpoch")) ||
          (e.agentEncryptionKeyId === void 0 && (o = "agentEncryptionKeyId")) ||
          (e.agentEncryptionKeyEpoch === void 0 && (o = "agentEncryptionKeyEpoch")) ||
          (e.keyEpoch === void 0 && (o = "keyEpoch")) ||
          (e.resourceBindings === void 0 && (o = "resourceBindings")) ||
          (e.capabilities === void 0 && (o = "capabilities")) ||
          (e.writebackRecipientKeyIds === void 0 && (o = "writebackRecipientKeyIds")) ||
          (e.historyPolicy === void 0 && (o = "historyPolicy")) ||
          (e.notBefore === void 0 && (o = "notBefore")) ||
          (e.expiresAt === void 0 && (o = "expiresAt")) ||
          (e.registrySequence === void 0 && (o = "registrySequence")) ||
          (e.checkpointDigest === void 0 && (o = "checkpointDigest"))
        )
          return (
            (E.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: o },
              },
            ]),
            !1
          );
        {
          let n = t;
          for (let p in e)
            if (!Qe.call(Ft.properties, p)) {
              return (
                (E.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: p },
                  },
                ]),
                !1
              );
              break;
            }
          if (n === t) {
            if (e.artifactType !== void 0) {
              let p = t;
              if (e.artifactType !== "agent_key_grant")
                return (
                  (E.errors = [
                    {
                      instancePath: r + "/artifactType",
                      schemaPath: "#/properties/artifactType/const",
                      keyword: "const",
                      params: { allowedValue: "agent_key_grant" },
                    },
                  ]),
                  !1
                );
              var s = p === t;
            } else var s = !0;
            if (s) {
              if (e.contractVersion !== void 0) {
                let p = t;
                if (e.contractVersion !== "folioview.agent-workspace.v2.0")
                  return (
                    (E.errors = [
                      {
                        instancePath: r + "/contractVersion",
                        schemaPath: "#/properties/contractVersion/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.agent-workspace.v2.0" },
                      },
                    ]),
                    !1
                  );
                var s = p === t;
              } else var s = !0;
              if (s) {
                if (e.vaultId !== void 0) {
                  let p = e.vaultId,
                    h = t;
                  if (t === h)
                    if (typeof p == "string") {
                      if (k(p) > 128)
                        return (
                          (E.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (k(p) < 1)
                        return (
                          (E.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!q.test(p))
                        return (
                          (E.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (E.errors = [
                          {
                            instancePath: r + "/vaultId",
                            schemaPath: "#/properties/vaultId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = h === t;
                } else var s = !0;
                if (s) {
                  if (e.ownerSubject !== void 0) {
                    let p = e.ownerSubject,
                      h = t;
                    if (t === h)
                      if (typeof p == "string") {
                        if (k(p) > 128)
                          return (
                            (E.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (k(p) < 1)
                          return (
                            (E.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!q.test(p))
                          return (
                            (E.errors = [
                              {
                                instancePath: r + "/ownerSubject",
                                schemaPath: "#/properties/ownerSubject/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (E.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = h === t;
                  } else var s = !0;
                  if (s) {
                    if (e.authorizationId !== void 0) {
                      let p = e.authorizationId,
                        h = t;
                      if (t === h)
                        if (typeof p == "string") {
                          if (k(p) > 128)
                            return (
                              (E.errors = [
                                {
                                  instancePath: r + "/authorizationId",
                                  schemaPath: "#/properties/authorizationId/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 128 },
                                },
                              ]),
                              !1
                            );
                          if (k(p) < 1)
                            return (
                              (E.errors = [
                                {
                                  instancePath: r + "/authorizationId",
                                  schemaPath: "#/properties/authorizationId/minLength",
                                  keyword: "minLength",
                                  params: { limit: 1 },
                                },
                              ]),
                              !1
                            );
                          if (!q.test(p))
                            return (
                              (E.errors = [
                                {
                                  instancePath: r + "/authorizationId",
                                  schemaPath: "#/properties/authorizationId/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (E.errors = [
                              {
                                instancePath: r + "/authorizationId",
                                schemaPath: "#/properties/authorizationId/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = h === t;
                    } else var s = !0;
                    if (s) {
                      if (e.deviceSigningKeyId !== void 0) {
                        let p = e.deviceSigningKeyId,
                          h = t;
                        if (t === h)
                          if (typeof p == "string") {
                            if (k(p) > 43)
                              return (
                                (E.errors = [
                                  {
                                    instancePath: r + "/deviceSigningKeyId",
                                    schemaPath: "#/properties/deviceSigningKeyId/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 43 },
                                  },
                                ]),
                                !1
                              );
                            if (k(p) < 43)
                              return (
                                (E.errors = [
                                  {
                                    instancePath: r + "/deviceSigningKeyId",
                                    schemaPath: "#/properties/deviceSigningKeyId/minLength",
                                    keyword: "minLength",
                                    params: { limit: 43 },
                                  },
                                ]),
                                !1
                              );
                            if (!ue.test(p))
                              return (
                                (E.errors = [
                                  {
                                    instancePath: r + "/deviceSigningKeyId",
                                    schemaPath: "#/properties/deviceSigningKeyId/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (E.errors = [
                                {
                                  instancePath: r + "/deviceSigningKeyId",
                                  schemaPath: "#/properties/deviceSigningKeyId/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var s = h === t;
                      } else var s = !0;
                      if (s) {
                        if (e.connectionId !== void 0) {
                          let p = e.connectionId,
                            h = t;
                          if (t === h)
                            if (typeof p == "string") {
                              if (k(p) > 128)
                                return (
                                  (E.errors = [
                                    {
                                      instancePath: r + "/connectionId",
                                      schemaPath: "#/properties/connectionId/maxLength",
                                      keyword: "maxLength",
                                      params: { limit: 128 },
                                    },
                                  ]),
                                  !1
                                );
                              if (k(p) < 1)
                                return (
                                  (E.errors = [
                                    {
                                      instancePath: r + "/connectionId",
                                      schemaPath: "#/properties/connectionId/minLength",
                                      keyword: "minLength",
                                      params: { limit: 1 },
                                    },
                                  ]),
                                  !1
                                );
                              if (!q.test(p))
                                return (
                                  (E.errors = [
                                    {
                                      instancePath: r + "/connectionId",
                                      schemaPath: "#/properties/connectionId/pattern",
                                      keyword: "pattern",
                                      params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                    },
                                  ]),
                                  !1
                                );
                            } else
                              return (
                                (E.errors = [
                                  {
                                    instancePath: r + "/connectionId",
                                    schemaPath: "#/properties/connectionId/type",
                                    keyword: "type",
                                    params: { type: "string" },
                                  },
                                ]),
                                !1
                              );
                          var s = h === t;
                        } else var s = !0;
                        if (s) {
                          if (e.taskId !== void 0) {
                            let p = e.taskId,
                              h = t;
                            if (t === h)
                              if (typeof p == "string") {
                                if (k(p) > 128)
                                  return (
                                    (E.errors = [
                                      {
                                        instancePath: r + "/taskId",
                                        schemaPath: "#/properties/taskId/maxLength",
                                        keyword: "maxLength",
                                        params: { limit: 128 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (k(p) < 1)
                                  return (
                                    (E.errors = [
                                      {
                                        instancePath: r + "/taskId",
                                        schemaPath: "#/properties/taskId/minLength",
                                        keyword: "minLength",
                                        params: { limit: 1 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (!q.test(p))
                                  return (
                                    (E.errors = [
                                      {
                                        instancePath: r + "/taskId",
                                        schemaPath: "#/properties/taskId/pattern",
                                        keyword: "pattern",
                                        params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                      },
                                    ]),
                                    !1
                                  );
                              } else
                                return (
                                  (E.errors = [
                                    {
                                      instancePath: r + "/taskId",
                                      schemaPath: "#/properties/taskId/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                    },
                                  ]),
                                  !1
                                );
                            var s = h === t;
                          } else var s = !0;
                          if (s) {
                            if (e.taskVersions !== void 0) {
                              let p = e.taskVersions,
                                h = t;
                              if (t === h)
                                if (Array.isArray(p)) {
                                  if (p.length > 50)
                                    return (
                                      (E.errors = [
                                        {
                                          instancePath: r + "/taskVersions",
                                          schemaPath: "#/properties/taskVersions/maxItems",
                                          keyword: "maxItems",
                                          params: { limit: 50 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (p.length < 1)
                                    return (
                                      (E.errors = [
                                        {
                                          instancePath: r + "/taskVersions",
                                          schemaPath: "#/properties/taskVersions/minItems",
                                          keyword: "minItems",
                                          params: { limit: 1 },
                                        },
                                      ]),
                                      !1
                                    );
                                  {
                                    var u = !0;
                                    let g = p.length;
                                    for (let P = 0; P < g; P++) {
                                      let b = p[P],
                                        A = t;
                                      if (!(typeof b == "number" && !(b % 1) && !isNaN(b)))
                                        return (
                                          (E.errors = [
                                            {
                                              instancePath: r + "/taskVersions/" + P,
                                              schemaPath: "#/properties/taskVersions/items/type",
                                              keyword: "type",
                                              params: { type: "integer" },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (t === A && typeof b == "number") {
                                        if (b > 9007199254740991 || isNaN(b))
                                          return (
                                            (E.errors = [
                                              {
                                                instancePath: r + "/taskVersions/" + P,
                                                schemaPath:
                                                  "#/properties/taskVersions/items/maximum",
                                                keyword: "maximum",
                                                params: {
                                                  comparison: "<=",
                                                  limit: 9007199254740991,
                                                },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (b < 1 || isNaN(b))
                                          return (
                                            (E.errors = [
                                              {
                                                instancePath: r + "/taskVersions/" + P,
                                                schemaPath:
                                                  "#/properties/taskVersions/items/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 1 },
                                              },
                                            ]),
                                            !1
                                          );
                                      }
                                      var u = A === t;
                                      if (!u) break;
                                    }
                                    if (u) {
                                      let P = p.length,
                                        b;
                                      if (P > 1) {
                                        let A = {};
                                        for (; P--;) {
                                          let V = p[P];
                                          if (typeof V == "number" && !(V % 1) && !isNaN(V)) {
                                            if (typeof A[V] == "number") {
                                              return (
                                                (b = A[V]),
                                                (E.errors = [
                                                  {
                                                    instancePath: r + "/taskVersions",
                                                    schemaPath:
                                                      "#/properties/taskVersions/uniqueItems",
                                                    keyword: "uniqueItems",
                                                    params: { i: P, j: b },
                                                  },
                                                ]),
                                                !1
                                              );
                                              break;
                                            }
                                            A[V] = P;
                                          }
                                        }
                                      }
                                    }
                                  }
                                } else
                                  return (
                                    (E.errors = [
                                      {
                                        instancePath: r + "/taskVersions",
                                        schemaPath: "#/properties/taskVersions/type",
                                        keyword: "type",
                                        params: { type: "array" },
                                      },
                                    ]),
                                    !1
                                  );
                              var s = h === t;
                            } else var s = !0;
                            if (s) {
                              if (e.executionEpoch !== void 0) {
                                let p = e.executionEpoch,
                                  h = t;
                                if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                  return (
                                    (E.errors = [
                                      {
                                        instancePath: r + "/executionEpoch",
                                        schemaPath: "#/properties/executionEpoch/type",
                                        keyword: "type",
                                        params: { type: "integer" },
                                      },
                                    ]),
                                    !1
                                  );
                                if (t === h && typeof p == "number") {
                                  if (p > 9007199254740991 || isNaN(p))
                                    return (
                                      (E.errors = [
                                        {
                                          instancePath: r + "/executionEpoch",
                                          schemaPath: "#/properties/executionEpoch/maximum",
                                          keyword: "maximum",
                                          params: { comparison: "<=", limit: 9007199254740991 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (p < 1 || isNaN(p))
                                    return (
                                      (E.errors = [
                                        {
                                          instancePath: r + "/executionEpoch",
                                          schemaPath: "#/properties/executionEpoch/minimum",
                                          keyword: "minimum",
                                          params: { comparison: ">=", limit: 1 },
                                        },
                                      ]),
                                      !1
                                    );
                                }
                                var s = h === t;
                              } else var s = !0;
                              if (s) {
                                if (e.grantId !== void 0) {
                                  let p = e.grantId,
                                    h = t;
                                  if (t === h)
                                    if (typeof p == "string") {
                                      if (k(p) > 128)
                                        return (
                                          (E.errors = [
                                            {
                                              instancePath: r + "/grantId",
                                              schemaPath: "#/properties/grantId/maxLength",
                                              keyword: "maxLength",
                                              params: { limit: 128 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (k(p) < 1)
                                        return (
                                          (E.errors = [
                                            {
                                              instancePath: r + "/grantId",
                                              schemaPath: "#/properties/grantId/minLength",
                                              keyword: "minLength",
                                              params: { limit: 1 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (!q.test(p))
                                        return (
                                          (E.errors = [
                                            {
                                              instancePath: r + "/grantId",
                                              schemaPath: "#/properties/grantId/pattern",
                                              keyword: "pattern",
                                              params: {
                                                pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
                                              },
                                            },
                                          ]),
                                          !1
                                        );
                                    } else
                                      return (
                                        (E.errors = [
                                          {
                                            instancePath: r + "/grantId",
                                            schemaPath: "#/properties/grantId/type",
                                            keyword: "type",
                                            params: { type: "string" },
                                          },
                                        ]),
                                        !1
                                      );
                                  var s = h === t;
                                } else var s = !0;
                                if (s) {
                                  if (e.grantEpoch !== void 0) {
                                    let p = e.grantEpoch,
                                      h = t;
                                    if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                      return (
                                        (E.errors = [
                                          {
                                            instancePath: r + "/grantEpoch",
                                            schemaPath: "#/properties/grantEpoch/type",
                                            keyword: "type",
                                            params: { type: "integer" },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (t === h && typeof p == "number") {
                                      if (p > 9007199254740991 || isNaN(p))
                                        return (
                                          (E.errors = [
                                            {
                                              instancePath: r + "/grantEpoch",
                                              schemaPath: "#/properties/grantEpoch/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (p < 1 || isNaN(p))
                                        return (
                                          (E.errors = [
                                            {
                                              instancePath: r + "/grantEpoch",
                                              schemaPath: "#/properties/grantEpoch/minimum",
                                              keyword: "minimum",
                                              params: { comparison: ">=", limit: 1 },
                                            },
                                          ]),
                                          !1
                                        );
                                    }
                                    var s = h === t;
                                  } else var s = !0;
                                  if (s) {
                                    if (e.agentSigningKeyId !== void 0) {
                                      let p = e.agentSigningKeyId,
                                        h = t;
                                      if (t === h)
                                        if (typeof p == "string") {
                                          if (k(p) > 43)
                                            return (
                                              (E.errors = [
                                                {
                                                  instancePath: r + "/agentSigningKeyId",
                                                  schemaPath:
                                                    "#/properties/agentSigningKeyId/maxLength",
                                                  keyword: "maxLength",
                                                  params: { limit: 43 },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (k(p) < 43)
                                            return (
                                              (E.errors = [
                                                {
                                                  instancePath: r + "/agentSigningKeyId",
                                                  schemaPath:
                                                    "#/properties/agentSigningKeyId/minLength",
                                                  keyword: "minLength",
                                                  params: { limit: 43 },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (!ue.test(p))
                                            return (
                                              (E.errors = [
                                                {
                                                  instancePath: r + "/agentSigningKeyId",
                                                  schemaPath:
                                                    "#/properties/agentSigningKeyId/pattern",
                                                  keyword: "pattern",
                                                  params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                                },
                                              ]),
                                              !1
                                            );
                                        } else
                                          return (
                                            (E.errors = [
                                              {
                                                instancePath: r + "/agentSigningKeyId",
                                                schemaPath: "#/properties/agentSigningKeyId/type",
                                                keyword: "type",
                                                params: { type: "string" },
                                              },
                                            ]),
                                            !1
                                          );
                                      var s = h === t;
                                    } else var s = !0;
                                    if (s) {
                                      if (e.agentSigningKeyEpoch !== void 0) {
                                        let p = e.agentSigningKeyEpoch,
                                          h = t;
                                        if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                          return (
                                            (E.errors = [
                                              {
                                                instancePath: r + "/agentSigningKeyEpoch",
                                                schemaPath:
                                                  "#/properties/agentSigningKeyEpoch/type",
                                                keyword: "type",
                                                params: { type: "integer" },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (t === h && typeof p == "number") {
                                          if (p > 9007199254740991 || isNaN(p))
                                            return (
                                              (E.errors = [
                                                {
                                                  instancePath: r + "/agentSigningKeyEpoch",
                                                  schemaPath:
                                                    "#/properties/agentSigningKeyEpoch/maximum",
                                                  keyword: "maximum",
                                                  params: {
                                                    comparison: "<=",
                                                    limit: 9007199254740991,
                                                  },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (p < 1 || isNaN(p))
                                            return (
                                              (E.errors = [
                                                {
                                                  instancePath: r + "/agentSigningKeyEpoch",
                                                  schemaPath:
                                                    "#/properties/agentSigningKeyEpoch/minimum",
                                                  keyword: "minimum",
                                                  params: { comparison: ">=", limit: 1 },
                                                },
                                              ]),
                                              !1
                                            );
                                        }
                                        var s = h === t;
                                      } else var s = !0;
                                      if (s) {
                                        if (e.agentEncryptionKeyId !== void 0) {
                                          let p = e.agentEncryptionKeyId,
                                            h = t;
                                          if (t === h)
                                            if (typeof p == "string") {
                                              if (k(p) > 43)
                                                return (
                                                  (E.errors = [
                                                    {
                                                      instancePath: r + "/agentEncryptionKeyId",
                                                      schemaPath:
                                                        "#/properties/agentEncryptionKeyId/maxLength",
                                                      keyword: "maxLength",
                                                      params: { limit: 43 },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              if (k(p) < 43)
                                                return (
                                                  (E.errors = [
                                                    {
                                                      instancePath: r + "/agentEncryptionKeyId",
                                                      schemaPath:
                                                        "#/properties/agentEncryptionKeyId/minLength",
                                                      keyword: "minLength",
                                                      params: { limit: 43 },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              if (!ue.test(p))
                                                return (
                                                  (E.errors = [
                                                    {
                                                      instancePath: r + "/agentEncryptionKeyId",
                                                      schemaPath:
                                                        "#/properties/agentEncryptionKeyId/pattern",
                                                      keyword: "pattern",
                                                      params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                            } else
                                              return (
                                                (E.errors = [
                                                  {
                                                    instancePath: r + "/agentEncryptionKeyId",
                                                    schemaPath:
                                                      "#/properties/agentEncryptionKeyId/type",
                                                    keyword: "type",
                                                    params: { type: "string" },
                                                  },
                                                ]),
                                                !1
                                              );
                                          var s = h === t;
                                        } else var s = !0;
                                        if (s) {
                                          if (e.agentEncryptionKeyEpoch !== void 0) {
                                            let p = e.agentEncryptionKeyEpoch,
                                              h = t;
                                            if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                              return (
                                                (E.errors = [
                                                  {
                                                    instancePath: r + "/agentEncryptionKeyEpoch",
                                                    schemaPath:
                                                      "#/properties/agentEncryptionKeyEpoch/type",
                                                    keyword: "type",
                                                    params: { type: "integer" },
                                                  },
                                                ]),
                                                !1
                                              );
                                            if (t === h && typeof p == "number") {
                                              if (p > 9007199254740991 || isNaN(p))
                                                return (
                                                  (E.errors = [
                                                    {
                                                      instancePath: r + "/agentEncryptionKeyEpoch",
                                                      schemaPath:
                                                        "#/properties/agentEncryptionKeyEpoch/maximum",
                                                      keyword: "maximum",
                                                      params: {
                                                        comparison: "<=",
                                                        limit: 9007199254740991,
                                                      },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              if (p < 1 || isNaN(p))
                                                return (
                                                  (E.errors = [
                                                    {
                                                      instancePath: r + "/agentEncryptionKeyEpoch",
                                                      schemaPath:
                                                        "#/properties/agentEncryptionKeyEpoch/minimum",
                                                      keyword: "minimum",
                                                      params: { comparison: ">=", limit: 1 },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                            }
                                            var s = h === t;
                                          } else var s = !0;
                                          if (s) {
                                            if (e.keyEpoch !== void 0) {
                                              let p = e.keyEpoch,
                                                h = t;
                                              if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                                return (
                                                  (E.errors = [
                                                    {
                                                      instancePath: r + "/keyEpoch",
                                                      schemaPath: "#/properties/keyEpoch/type",
                                                      keyword: "type",
                                                      params: { type: "integer" },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              if (t === h && typeof p == "number") {
                                                if (p > 9007199254740991 || isNaN(p))
                                                  return (
                                                    (E.errors = [
                                                      {
                                                        instancePath: r + "/keyEpoch",
                                                        schemaPath: "#/properties/keyEpoch/maximum",
                                                        keyword: "maximum",
                                                        params: {
                                                          comparison: "<=",
                                                          limit: 9007199254740991,
                                                        },
                                                      },
                                                    ]),
                                                    !1
                                                  );
                                                if (p < 1 || isNaN(p))
                                                  return (
                                                    (E.errors = [
                                                      {
                                                        instancePath: r + "/keyEpoch",
                                                        schemaPath: "#/properties/keyEpoch/minimum",
                                                        keyword: "minimum",
                                                        params: { comparison: ">=", limit: 1 },
                                                      },
                                                    ]),
                                                    !1
                                                  );
                                              }
                                              var s = h === t;
                                            } else var s = !0;
                                            if (s) {
                                              if (e.resourceBindings !== void 0) {
                                                let p = e.resourceBindings,
                                                  h = t;
                                                if (t === h)
                                                  if (Array.isArray(p)) {
                                                    if (p.length > 10)
                                                      return (
                                                        (E.errors = [
                                                          {
                                                            instancePath: r + "/resourceBindings",
                                                            schemaPath:
                                                              "#/properties/resourceBindings/maxItems",
                                                            keyword: "maxItems",
                                                            params: { limit: 10 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (p.length < 0)
                                                      return (
                                                        (E.errors = [
                                                          {
                                                            instancePath: r + "/resourceBindings",
                                                            schemaPath:
                                                              "#/properties/resourceBindings/minItems",
                                                            keyword: "minItems",
                                                            params: { limit: 0 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    {
                                                      var w = !0;
                                                      let g = p.length;
                                                      for (let P = 0; P < g; P++) {
                                                        let b = t;
                                                        le(p[P], {
                                                          instancePath:
                                                            r + "/resourceBindings/" + P,
                                                          parentData: p,
                                                          parentDataProperty: P,
                                                          rootData: d,
                                                          dynamicAnchors: y,
                                                        }) ||
                                                          ((i =
                                                            i === null
                                                              ? le.errors
                                                              : i.concat(le.errors)),
                                                          (t = i.length));
                                                        var w = b === t;
                                                        if (!w) break;
                                                      }
                                                      if (w) {
                                                        let P = p.length,
                                                          b;
                                                        if (P > 1) {
                                                          e: for (; P--;)
                                                            for (b = P; b--;)
                                                              if (Ye(p[P], p[b])) {
                                                                return (
                                                                  (E.errors = [
                                                                    {
                                                                      instancePath:
                                                                        r + "/resourceBindings",
                                                                      schemaPath:
                                                                        "#/properties/resourceBindings/uniqueItems",
                                                                      keyword: "uniqueItems",
                                                                      params: { i: P, j: b },
                                                                    },
                                                                  ]),
                                                                  !1
                                                                );
                                                                break e;
                                                              }
                                                        }
                                                      }
                                                    }
                                                  } else
                                                    return (
                                                      (E.errors = [
                                                        {
                                                          instancePath: r + "/resourceBindings",
                                                          schemaPath:
                                                            "#/properties/resourceBindings/type",
                                                          keyword: "type",
                                                          params: { type: "array" },
                                                        },
                                                      ]),
                                                      !1
                                                    );
                                                var s = h === t;
                                              } else var s = !0;
                                              if (s) {
                                                if (e.capabilities !== void 0) {
                                                  let p = e.capabilities,
                                                    h = t;
                                                  if (t === h)
                                                    if (Array.isArray(p)) {
                                                      if (p.length > 3)
                                                        return (
                                                          (E.errors = [
                                                            {
                                                              instancePath: r + "/capabilities",
                                                              schemaPath:
                                                                "#/properties/capabilities/maxItems",
                                                              keyword: "maxItems",
                                                              params: { limit: 3 },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                      if (p.length < 1)
                                                        return (
                                                          (E.errors = [
                                                            {
                                                              instancePath: r + "/capabilities",
                                                              schemaPath:
                                                                "#/properties/capabilities/minItems",
                                                              keyword: "minItems",
                                                              params: { limit: 1 },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                      {
                                                        var c = !0;
                                                        let g = p.length;
                                                        for (let P = 0; P < g; P++) {
                                                          let b = p[P],
                                                            A = t;
                                                          if (!(
                                                            b === "decrypt_task" ||
                                                            b === "decrypt_resources" ||
                                                            b === "encrypt_result"
                                                          ))
                                                            return (
                                                              (E.errors = [
                                                                {
                                                                  instancePath:
                                                                    r + "/capabilities/" + P,
                                                                  schemaPath:
                                                                    "#/properties/capabilities/items/enum",
                                                                  keyword: "enum",
                                                                  params: {
                                                                    allowedValues:
                                                                      Ft.properties.capabilities
                                                                        .items.enum,
                                                                  },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          var c = A === t;
                                                          if (!c) break;
                                                        }
                                                        if (c) {
                                                          let P = p.length,
                                                            b;
                                                          if (P > 1) {
                                                            e: for (; P--;)
                                                              for (b = P; b--;)
                                                                if (Ye(p[P], p[b])) {
                                                                  return (
                                                                    (E.errors = [
                                                                      {
                                                                        instancePath:
                                                                          r + "/capabilities",
                                                                        schemaPath:
                                                                          "#/properties/capabilities/uniqueItems",
                                                                        keyword: "uniqueItems",
                                                                        params: { i: P, j: b },
                                                                      },
                                                                    ]),
                                                                    !1
                                                                  );
                                                                  break e;
                                                                }
                                                          }
                                                        }
                                                      }
                                                    } else
                                                      return (
                                                        (E.errors = [
                                                          {
                                                            instancePath: r + "/capabilities",
                                                            schemaPath:
                                                              "#/properties/capabilities/type",
                                                            keyword: "type",
                                                            params: { type: "array" },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                  var s = h === t;
                                                } else var s = !0;
                                                if (s) {
                                                  if (e.writebackRecipientKeyIds !== void 0) {
                                                    let p = e.writebackRecipientKeyIds,
                                                      h = t;
                                                    if (t === h)
                                                      if (Array.isArray(p)) {
                                                        if (p.length > 8)
                                                          return (
                                                            (E.errors = [
                                                              {
                                                                instancePath:
                                                                  r + "/writebackRecipientKeyIds",
                                                                schemaPath:
                                                                  "#/properties/writebackRecipientKeyIds/maxItems",
                                                                keyword: "maxItems",
                                                                params: { limit: 8 },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                        if (p.length < 2)
                                                          return (
                                                            (E.errors = [
                                                              {
                                                                instancePath:
                                                                  r + "/writebackRecipientKeyIds",
                                                                schemaPath:
                                                                  "#/properties/writebackRecipientKeyIds/minItems",
                                                                keyword: "minItems",
                                                                params: { limit: 2 },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                        {
                                                          var a = !0;
                                                          let g = p.length;
                                                          for (let P = 0; P < g; P++) {
                                                            let b = p[P],
                                                              A = t;
                                                            if (t === A)
                                                              if (typeof b == "string") {
                                                                if (k(b) > 43)
                                                                  return (
                                                                    (E.errors = [
                                                                      {
                                                                        instancePath:
                                                                          r +
                                                                          "/writebackRecipientKeyIds/" +
                                                                          P,
                                                                        schemaPath:
                                                                          "#/properties/writebackRecipientKeyIds/items/maxLength",
                                                                        keyword: "maxLength",
                                                                        params: { limit: 43 },
                                                                      },
                                                                    ]),
                                                                    !1
                                                                  );
                                                                if (k(b) < 43)
                                                                  return (
                                                                    (E.errors = [
                                                                      {
                                                                        instancePath:
                                                                          r +
                                                                          "/writebackRecipientKeyIds/" +
                                                                          P,
                                                                        schemaPath:
                                                                          "#/properties/writebackRecipientKeyIds/items/minLength",
                                                                        keyword: "minLength",
                                                                        params: { limit: 43 },
                                                                      },
                                                                    ]),
                                                                    !1
                                                                  );
                                                                if (!ue.test(b))
                                                                  return (
                                                                    (E.errors = [
                                                                      {
                                                                        instancePath:
                                                                          r +
                                                                          "/writebackRecipientKeyIds/" +
                                                                          P,
                                                                        schemaPath:
                                                                          "#/properties/writebackRecipientKeyIds/items/pattern",
                                                                        keyword: "pattern",
                                                                        params: {
                                                                          pattern:
                                                                            "^[A-Za-z0-9_-]{43}$",
                                                                        },
                                                                      },
                                                                    ]),
                                                                    !1
                                                                  );
                                                              } else
                                                                return (
                                                                  (E.errors = [
                                                                    {
                                                                      instancePath:
                                                                        r +
                                                                        "/writebackRecipientKeyIds/" +
                                                                        P,
                                                                      schemaPath:
                                                                        "#/properties/writebackRecipientKeyIds/items/type",
                                                                      keyword: "type",
                                                                      params: { type: "string" },
                                                                    },
                                                                  ]),
                                                                  !1
                                                                );
                                                            var a = A === t;
                                                            if (!a) break;
                                                          }
                                                          if (a) {
                                                            let P = p.length,
                                                              b;
                                                            if (P > 1) {
                                                              let A = {};
                                                              for (; P--;) {
                                                                let V = p[P];
                                                                if (typeof V == "string") {
                                                                  if (typeof A[V] == "number") {
                                                                    return (
                                                                      (b = A[V]),
                                                                      (E.errors = [
                                                                        {
                                                                          instancePath:
                                                                            r +
                                                                            "/writebackRecipientKeyIds",
                                                                          schemaPath:
                                                                            "#/properties/writebackRecipientKeyIds/uniqueItems",
                                                                          keyword: "uniqueItems",
                                                                          params: { i: P, j: b },
                                                                        },
                                                                      ]),
                                                                      !1
                                                                    );
                                                                    break;
                                                                  }
                                                                  A[V] = P;
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      } else
                                                        return (
                                                          (E.errors = [
                                                            {
                                                              instancePath:
                                                                r + "/writebackRecipientKeyIds",
                                                              schemaPath:
                                                                "#/properties/writebackRecipientKeyIds/type",
                                                              keyword: "type",
                                                              params: { type: "array" },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                    var s = h === t;
                                                  } else var s = !0;
                                                  if (s) {
                                                    if (e.historyPolicy !== void 0) {
                                                      let p = e.historyPolicy,
                                                        h = t;
                                                      if (!(p === "none" || p === "selected"))
                                                        return (
                                                          (E.errors = [
                                                            {
                                                              instancePath: r + "/historyPolicy",
                                                              schemaPath:
                                                                "#/properties/historyPolicy/enum",
                                                              keyword: "enum",
                                                              params: {
                                                                allowedValues:
                                                                  Ft.properties.historyPolicy.enum,
                                                              },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                      var s = h === t;
                                                    } else var s = !0;
                                                    if (s) {
                                                      if (e.notBefore !== void 0) {
                                                        let p = e.notBefore,
                                                          h = t;
                                                        if (!(
                                                          typeof p == "number" &&
                                                          !(p % 1) &&
                                                          !isNaN(p)
                                                        ))
                                                          return (
                                                            (E.errors = [
                                                              {
                                                                instancePath: r + "/notBefore",
                                                                schemaPath:
                                                                  "#/properties/notBefore/type",
                                                                keyword: "type",
                                                                params: { type: "integer" },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                        if (t === h && typeof p == "number") {
                                                          if (p > 9007199254740991 || isNaN(p))
                                                            return (
                                                              (E.errors = [
                                                                {
                                                                  instancePath: r + "/notBefore",
                                                                  schemaPath:
                                                                    "#/properties/notBefore/maximum",
                                                                  keyword: "maximum",
                                                                  params: {
                                                                    comparison: "<=",
                                                                    limit: 9007199254740991,
                                                                  },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          if (p < 0 || isNaN(p))
                                                            return (
                                                              (E.errors = [
                                                                {
                                                                  instancePath: r + "/notBefore",
                                                                  schemaPath:
                                                                    "#/properties/notBefore/minimum",
                                                                  keyword: "minimum",
                                                                  params: {
                                                                    comparison: ">=",
                                                                    limit: 0,
                                                                  },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                        }
                                                        var s = h === t;
                                                      } else var s = !0;
                                                      if (s) {
                                                        if (e.expiresAt !== void 0) {
                                                          let p = e.expiresAt,
                                                            h = t;
                                                          if (!(
                                                            typeof p == "number" &&
                                                            !(p % 1) &&
                                                            !isNaN(p)
                                                          ))
                                                            return (
                                                              (E.errors = [
                                                                {
                                                                  instancePath: r + "/expiresAt",
                                                                  schemaPath:
                                                                    "#/properties/expiresAt/type",
                                                                  keyword: "type",
                                                                  params: { type: "integer" },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          if (t === h && typeof p == "number") {
                                                            if (p > 9007199254740991 || isNaN(p))
                                                              return (
                                                                (E.errors = [
                                                                  {
                                                                    instancePath: r + "/expiresAt",
                                                                    schemaPath:
                                                                      "#/properties/expiresAt/maximum",
                                                                    keyword: "maximum",
                                                                    params: {
                                                                      comparison: "<=",
                                                                      limit: 9007199254740991,
                                                                    },
                                                                  },
                                                                ]),
                                                                !1
                                                              );
                                                            if (p < 1 || isNaN(p))
                                                              return (
                                                                (E.errors = [
                                                                  {
                                                                    instancePath: r + "/expiresAt",
                                                                    schemaPath:
                                                                      "#/properties/expiresAt/minimum",
                                                                    keyword: "minimum",
                                                                    params: {
                                                                      comparison: ">=",
                                                                      limit: 1,
                                                                    },
                                                                  },
                                                                ]),
                                                                !1
                                                              );
                                                          }
                                                          var s = h === t;
                                                        } else var s = !0;
                                                        if (s) {
                                                          if (e.registrySequence !== void 0) {
                                                            let p = e.registrySequence,
                                                              h = t;
                                                            if (!(
                                                              typeof p == "number" &&
                                                              !(p % 1) &&
                                                              !isNaN(p)
                                                            ))
                                                              return (
                                                                (E.errors = [
                                                                  {
                                                                    instancePath:
                                                                      r + "/registrySequence",
                                                                    schemaPath:
                                                                      "#/properties/registrySequence/type",
                                                                    keyword: "type",
                                                                    params: { type: "integer" },
                                                                  },
                                                                ]),
                                                                !1
                                                              );
                                                            if (t === h && typeof p == "number") {
                                                              if (p > 9007199254740991 || isNaN(p))
                                                                return (
                                                                  (E.errors = [
                                                                    {
                                                                      instancePath:
                                                                        r + "/registrySequence",
                                                                      schemaPath:
                                                                        "#/properties/registrySequence/maximum",
                                                                      keyword: "maximum",
                                                                      params: {
                                                                        comparison: "<=",
                                                                        limit: 9007199254740991,
                                                                      },
                                                                    },
                                                                  ]),
                                                                  !1
                                                                );
                                                              if (p < 1 || isNaN(p))
                                                                return (
                                                                  (E.errors = [
                                                                    {
                                                                      instancePath:
                                                                        r + "/registrySequence",
                                                                      schemaPath:
                                                                        "#/properties/registrySequence/minimum",
                                                                      keyword: "minimum",
                                                                      params: {
                                                                        comparison: ">=",
                                                                        limit: 1,
                                                                      },
                                                                    },
                                                                  ]),
                                                                  !1
                                                                );
                                                            }
                                                            var s = h === t;
                                                          } else var s = !0;
                                                          if (s)
                                                            if (e.checkpointDigest !== void 0) {
                                                              let p = e.checkpointDigest,
                                                                h = t;
                                                              if (t === h)
                                                                if (typeof p == "string") {
                                                                  if (k(p) > 64)
                                                                    return (
                                                                      (E.errors = [
                                                                        {
                                                                          instancePath:
                                                                            r + "/checkpointDigest",
                                                                          schemaPath:
                                                                            "#/properties/checkpointDigest/maxLength",
                                                                          keyword: "maxLength",
                                                                          params: { limit: 64 },
                                                                        },
                                                                      ]),
                                                                      !1
                                                                    );
                                                                  if (k(p) < 64)
                                                                    return (
                                                                      (E.errors = [
                                                                        {
                                                                          instancePath:
                                                                            r + "/checkpointDigest",
                                                                          schemaPath:
                                                                            "#/properties/checkpointDigest/minLength",
                                                                          keyword: "minLength",
                                                                          params: { limit: 64 },
                                                                        },
                                                                      ]),
                                                                      !1
                                                                    );
                                                                  if (!qe.test(p))
                                                                    return (
                                                                      (E.errors = [
                                                                        {
                                                                          instancePath:
                                                                            r + "/checkpointDigest",
                                                                          schemaPath:
                                                                            "#/properties/checkpointDigest/pattern",
                                                                          keyword: "pattern",
                                                                          params: {
                                                                            pattern:
                                                                              "^[a-f0-9]{64}$",
                                                                          },
                                                                        },
                                                                      ]),
                                                                      !1
                                                                    );
                                                                } else
                                                                  return (
                                                                    (E.errors = [
                                                                      {
                                                                        instancePath:
                                                                          r + "/checkpointDigest",
                                                                        schemaPath:
                                                                          "#/properties/checkpointDigest/type",
                                                                        keyword: "type",
                                                                        params: { type: "string" },
                                                                      },
                                                                    ]),
                                                                    !1
                                                                  );
                                                              var s = h === t;
                                                            } else var s = !0;
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (E.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((E.errors = i), t === 0);
  }
  E.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function at(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = at.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      E(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? E.errors : i.concat(E.errors)), (t = i.length)),
      (at.errors = i),
      t === 0
    );
  }
  at.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.Carrier = ot;
  function Ve(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Ve.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.contractVersion === void 0 && (u = "contractVersion")) ||
          (e.signedObject === void 0 && (u = "signedObject"))
        )
          return (
            (Ve.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "contractVersion" || c === "signedObject")) {
              return (
                (Ve.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.contractVersion !== void 0) {
              let c = t;
              if (e.contractVersion !== "folioview.agent-workspace.v2.0")
                return (
                  (Ve.errors = [
                    {
                      instancePath: r + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.agent-workspace.v2.0" },
                    },
                  ]),
                  !1
                );
              var s = c === t;
            } else var s = !0;
            if (s)
              if (e.signedObject !== void 0) {
                let c = t;
                X(e.signedObject, {
                  instancePath: r + "/signedObject",
                  parentData: e,
                  parentDataProperty: "signedObject",
                  rootData: d,
                  dynamicAnchors: y,
                }) || ((i = i === null ? X.errors : i.concat(X.errors)), (t = i.length));
                var s = c === t;
              } else var s = !0;
          }
        }
      } else
        return (
          (Ve.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Ve.errors = i), t === 0);
  }
  Ve.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ot(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ot.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      Ve(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? Ve.errors : i.concat(Ve.errors)), (t = i.length)),
      (ot.errors = i),
      t === 0
    );
  }
  ot.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.ObjectMessage = pt;
  var ur = {
    type: "object",
    properties: {
      contractVersion: { const: "folioview.agent-workspace.v2.0" },
      profileId: { const: "P1" },
      ownerSubject: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
      },
      vaultId: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
      },
      rootKeyId: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" },
      rootEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
      registrySequence: { type: "integer", minimum: 1, maximum: 9007199254740991 },
      checkpointDigest: { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
      keyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
      objectId: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
      },
      objectType: {
        enum: [
          "task",
          "holdings_snapshot",
          "watchlist_evidence",
          "channel_follows_evidence",
          "result_revision",
        ],
      },
      revision: { type: "integer", minimum: 1, maximum: 9007199254740991 },
      deliveryRevision: { type: "integer", minimum: 1, maximum: 9007199254740991 },
      priorEnvelopeFingerprint: {
        anyOf: [
          { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
          { type: "null" },
        ],
      },
      expectedRevision: { type: "integer", minimum: 0, maximum: 9007199254740991 },
      stableOperationId: { $ref: "#/$defs/OperationIdentifier" },
      operationType: {
        enum: [
          "create_task",
          "update_task",
          "transition_task",
          "commit_snapshot",
          "commit_evidence",
          "submit_result",
          "revise_result",
          "reshare_delivery",
        ],
      },
      authorSigningKeyId: {
        type: "string",
        minLength: 43,
        maxLength: 43,
        pattern: "^[A-Za-z0-9_-]{43}$",
      },
      binding: { $ref: "#/$defs/Binding" },
      resourceBindings: {
        type: "array",
        items: { $ref: "#/$defs/ResourceBindingMetadata" },
        minItems: 0,
        maxItems: 10,
        uniqueItems: !0,
      },
      recipients: {
        type: "array",
        items: { $ref: "#/$defs/Recipient" },
        minItems: 1,
        maxItems: 8,
        uniqueItems: !0,
      },
    },
    required: [
      "contractVersion",
      "profileId",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "rootEpoch",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "objectId",
      "objectType",
      "revision",
      "deliveryRevision",
      "priorEnvelopeFingerprint",
      "expectedRevision",
      "stableOperationId",
      "operationType",
      "authorSigningKeyId",
      "binding",
      "resourceBindings",
      "recipients",
    ],
    additionalProperties: !1,
  };
  function je(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = je.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (typeof e == "string") {
        if (k(e) > 128)
          return (
            (je.errors = [
              {
                instancePath: r,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 128 },
              },
            ]),
            !1
          );
        if (k(e) < 22)
          return (
            (je.errors = [
              {
                instancePath: r,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 22 },
              },
            ]),
            !1
          );
        if (!Ke.test(e))
          return (
            (je.errors = [
              {
                instancePath: r,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9_-]+$" },
              },
            ]),
            !1
          );
      } else
        return (
          (je.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((je.errors = i), t === 0);
  }
  je.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var Ns = {
    type: "object",
    properties: {
      taskId: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
          },
          { type: "null" },
        ],
      },
      taskVersion: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 9007199254740991 }, { type: "null" }],
      },
      runId: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
          },
          { type: "null" },
        ],
      },
      manifestId: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
          },
          { type: "null" },
        ],
      },
      taskEnvelopeFingerprint: {
        anyOf: [
          { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
          { type: "null" },
        ],
      },
      manifestFingerprint: {
        anyOf: [
          { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
          { type: "null" },
        ],
      },
      connectionId: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
          },
          { type: "null" },
        ],
      },
      grantId: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
          },
          { type: "null" },
        ],
      },
      grantEpoch: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 9007199254740991 }, { type: "null" }],
      },
      executionEpoch: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 9007199254740991 }, { type: "null" }],
      },
      resourceRef: { anyOf: [{ $ref: "#/$defs/ResourceRef" }, { type: "null" }] },
      sourceRevision: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 9007199254740991 }, { type: "null" }],
      },
      sourceEpoch: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 9007199254740991 }, { type: "null" }],
      },
    },
    required: [
      "taskId",
      "taskVersion",
      "runId",
      "manifestId",
      "taskEnvelopeFingerprint",
      "manifestFingerprint",
      "connectionId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "resourceRef",
      "sourceRevision",
      "sourceEpoch",
    ],
    additionalProperties: !1,
  };
  function H(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = H.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let V;
        if (
          (e.taskId === void 0 && (V = "taskId")) ||
          (e.taskVersion === void 0 && (V = "taskVersion")) ||
          (e.runId === void 0 && (V = "runId")) ||
          (e.manifestId === void 0 && (V = "manifestId")) ||
          (e.taskEnvelopeFingerprint === void 0 && (V = "taskEnvelopeFingerprint")) ||
          (e.manifestFingerprint === void 0 && (V = "manifestFingerprint")) ||
          (e.connectionId === void 0 && (V = "connectionId")) ||
          (e.grantId === void 0 && (V = "grantId")) ||
          (e.grantEpoch === void 0 && (V = "grantEpoch")) ||
          (e.executionEpoch === void 0 && (V = "executionEpoch")) ||
          (e.resourceRef === void 0 && (V = "resourceRef")) ||
          (e.sourceRevision === void 0 && (V = "sourceRevision")) ||
          (e.sourceEpoch === void 0 && (V = "sourceEpoch"))
        )
          return (
            (H.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: V },
              },
            ]),
            !1
          );
        {
          let W = t;
          for (let _ in e)
            if (!Qe.call(Ns.properties, _)) {
              return (
                (H.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: _ },
                  },
                ]),
                !1
              );
              break;
            }
          if (W === t) {
            if (e.taskId !== void 0) {
              let _ = e.taskId,
                N = t,
                L = t,
                S = !1,
                $ = t;
              if (t === $)
                if (typeof _ == "string") {
                  if (k(_) > 128) {
                    let Y = {
                      instancePath: r + "/taskId",
                      schemaPath: "#/properties/taskId/anyOf/0/maxLength",
                      keyword: "maxLength",
                      params: { limit: 128 },
                    };
                    (i === null ? (i = [Y]) : i.push(Y), t++);
                  } else if (k(_) < 1) {
                    let Y = {
                      instancePath: r + "/taskId",
                      schemaPath: "#/properties/taskId/anyOf/0/minLength",
                      keyword: "minLength",
                      params: { limit: 1 },
                    };
                    (i === null ? (i = [Y]) : i.push(Y), t++);
                  } else if (!q.test(_)) {
                    let Y = {
                      instancePath: r + "/taskId",
                      schemaPath: "#/properties/taskId/anyOf/0/pattern",
                      keyword: "pattern",
                      params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                    };
                    (i === null ? (i = [Y]) : i.push(Y), t++);
                  }
                } else {
                  let Y = {
                    instancePath: r + "/taskId",
                    schemaPath: "#/properties/taskId/anyOf/0/type",
                    keyword: "type",
                    params: { type: "string" },
                  };
                  (i === null ? (i = [Y]) : i.push(Y), t++);
                }
              var s = $ === t;
              S = S || s;
              let T = t;
              if (_ !== null) {
                let Y = {
                  instancePath: r + "/taskId",
                  schemaPath: "#/properties/taskId/anyOf/1/type",
                  keyword: "type",
                  params: { type: "null" },
                };
                (i === null ? (i = [Y]) : i.push(Y), t++);
              }
              var s = T === t;
              if (((S = S || s), S)) ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
              else {
                let Y = {
                  instancePath: r + "/taskId",
                  schemaPath: "#/properties/taskId/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                return (i === null ? (i = [Y]) : i.push(Y), t++, (H.errors = i), !1);
              }
              var u = N === t;
            } else var u = !0;
            if (u) {
              if (e.taskVersion !== void 0) {
                let _ = e.taskVersion,
                  N = t,
                  L = t,
                  S = !1,
                  $ = t;
                if (!(typeof _ == "number" && !(_ % 1) && !isNaN(_))) {
                  let I = {
                    instancePath: r + "/taskVersion",
                    schemaPath: "#/properties/taskVersion/anyOf/0/type",
                    keyword: "type",
                    params: { type: "integer" },
                  };
                  (i === null ? (i = [I]) : i.push(I), t++);
                }
                if (t === $ && typeof _ == "number") {
                  if (_ > 9007199254740991 || isNaN(_)) {
                    let I = {
                      instancePath: r + "/taskVersion",
                      schemaPath: "#/properties/taskVersion/anyOf/0/maximum",
                      keyword: "maximum",
                      params: { comparison: "<=", limit: 9007199254740991 },
                    };
                    (i === null ? (i = [I]) : i.push(I), t++);
                  } else if (_ < 1 || isNaN(_)) {
                    let I = {
                      instancePath: r + "/taskVersion",
                      schemaPath: "#/properties/taskVersion/anyOf/0/minimum",
                      keyword: "minimum",
                      params: { comparison: ">=", limit: 1 },
                    };
                    (i === null ? (i = [I]) : i.push(I), t++);
                  }
                }
                var w = $ === t;
                S = S || w;
                let T = t;
                if (_ !== null) {
                  let I = {
                    instancePath: r + "/taskVersion",
                    schemaPath: "#/properties/taskVersion/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (i === null ? (i = [I]) : i.push(I), t++);
                }
                var w = T === t;
                if (((S = S || w), S)) ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                else {
                  let I = {
                    instancePath: r + "/taskVersion",
                    schemaPath: "#/properties/taskVersion/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (i === null ? (i = [I]) : i.push(I), t++, (H.errors = i), !1);
                }
                var u = N === t;
              } else var u = !0;
              if (u) {
                if (e.runId !== void 0) {
                  let _ = e.runId,
                    N = t,
                    L = t,
                    S = !1,
                    $ = t;
                  if (t === $)
                    if (typeof _ == "string") {
                      if (k(_) > 128) {
                        let I = {
                          instancePath: r + "/runId",
                          schemaPath: "#/properties/runId/anyOf/0/maxLength",
                          keyword: "maxLength",
                          params: { limit: 128 },
                        };
                        (i === null ? (i = [I]) : i.push(I), t++);
                      } else if (k(_) < 1) {
                        let I = {
                          instancePath: r + "/runId",
                          schemaPath: "#/properties/runId/anyOf/0/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        };
                        (i === null ? (i = [I]) : i.push(I), t++);
                      } else if (!q.test(_)) {
                        let I = {
                          instancePath: r + "/runId",
                          schemaPath: "#/properties/runId/anyOf/0/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                        };
                        (i === null ? (i = [I]) : i.push(I), t++);
                      }
                    } else {
                      let I = {
                        instancePath: r + "/runId",
                        schemaPath: "#/properties/runId/anyOf/0/type",
                        keyword: "type",
                        params: { type: "string" },
                      };
                      (i === null ? (i = [I]) : i.push(I), t++);
                    }
                  var c = $ === t;
                  S = S || c;
                  let T = t;
                  if (_ !== null) {
                    let I = {
                      instancePath: r + "/runId",
                      schemaPath: "#/properties/runId/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (i === null ? (i = [I]) : i.push(I), t++);
                  }
                  var c = T === t;
                  if (((S = S || c), S)) ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                  else {
                    let I = {
                      instancePath: r + "/runId",
                      schemaPath: "#/properties/runId/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (i === null ? (i = [I]) : i.push(I), t++, (H.errors = i), !1);
                  }
                  var u = N === t;
                } else var u = !0;
                if (u) {
                  if (e.manifestId !== void 0) {
                    let _ = e.manifestId,
                      N = t,
                      L = t,
                      S = !1,
                      $ = t;
                    if (t === $)
                      if (typeof _ == "string") {
                        if (k(_) > 128) {
                          let I = {
                            instancePath: r + "/manifestId",
                            schemaPath: "#/properties/manifestId/anyOf/0/maxLength",
                            keyword: "maxLength",
                            params: { limit: 128 },
                          };
                          (i === null ? (i = [I]) : i.push(I), t++);
                        } else if (k(_) < 1) {
                          let I = {
                            instancePath: r + "/manifestId",
                            schemaPath: "#/properties/manifestId/anyOf/0/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          };
                          (i === null ? (i = [I]) : i.push(I), t++);
                        } else if (!q.test(_)) {
                          let I = {
                            instancePath: r + "/manifestId",
                            schemaPath: "#/properties/manifestId/anyOf/0/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                          };
                          (i === null ? (i = [I]) : i.push(I), t++);
                        }
                      } else {
                        let I = {
                          instancePath: r + "/manifestId",
                          schemaPath: "#/properties/manifestId/anyOf/0/type",
                          keyword: "type",
                          params: { type: "string" },
                        };
                        (i === null ? (i = [I]) : i.push(I), t++);
                      }
                    var a = $ === t;
                    S = S || a;
                    let T = t;
                    if (_ !== null) {
                      let I = {
                        instancePath: r + "/manifestId",
                        schemaPath: "#/properties/manifestId/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (i === null ? (i = [I]) : i.push(I), t++);
                    }
                    var a = T === t;
                    if (((S = S || a), S))
                      ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                    else {
                      let I = {
                        instancePath: r + "/manifestId",
                        schemaPath: "#/properties/manifestId/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (i === null ? (i = [I]) : i.push(I), t++, (H.errors = i), !1);
                    }
                    var u = N === t;
                  } else var u = !0;
                  if (u) {
                    if (e.taskEnvelopeFingerprint !== void 0) {
                      let _ = e.taskEnvelopeFingerprint,
                        N = t,
                        L = t,
                        S = !1,
                        $ = t;
                      if (t === $)
                        if (typeof _ == "string") {
                          if (k(_) > 64) {
                            let I = {
                              instancePath: r + "/taskEnvelopeFingerprint",
                              schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/0/maxLength",
                              keyword: "maxLength",
                              params: { limit: 64 },
                            };
                            (i === null ? (i = [I]) : i.push(I), t++);
                          } else if (k(_) < 64) {
                            let I = {
                              instancePath: r + "/taskEnvelopeFingerprint",
                              schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/0/minLength",
                              keyword: "minLength",
                              params: { limit: 64 },
                            };
                            (i === null ? (i = [I]) : i.push(I), t++);
                          } else if (!qe.test(_)) {
                            let I = {
                              instancePath: r + "/taskEnvelopeFingerprint",
                              schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/0/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[a-f0-9]{64}$" },
                            };
                            (i === null ? (i = [I]) : i.push(I), t++);
                          }
                        } else {
                          let I = {
                            instancePath: r + "/taskEnvelopeFingerprint",
                            schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/0/type",
                            keyword: "type",
                            params: { type: "string" },
                          };
                          (i === null ? (i = [I]) : i.push(I), t++);
                        }
                      var o = $ === t;
                      S = S || o;
                      let T = t;
                      if (_ !== null) {
                        let I = {
                          instancePath: r + "/taskEnvelopeFingerprint",
                          schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                        };
                        (i === null ? (i = [I]) : i.push(I), t++);
                      }
                      var o = T === t;
                      if (((S = S || o), S))
                        ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                      else {
                        let I = {
                          instancePath: r + "/taskEnvelopeFingerprint",
                          schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        return (i === null ? (i = [I]) : i.push(I), t++, (H.errors = i), !1);
                      }
                      var u = N === t;
                    } else var u = !0;
                    if (u) {
                      if (e.manifestFingerprint !== void 0) {
                        let _ = e.manifestFingerprint,
                          N = t,
                          L = t,
                          S = !1,
                          $ = t;
                        if (t === $)
                          if (typeof _ == "string") {
                            if (k(_) > 64) {
                              let I = {
                                instancePath: r + "/manifestFingerprint",
                                schemaPath: "#/properties/manifestFingerprint/anyOf/0/maxLength",
                                keyword: "maxLength",
                                params: { limit: 64 },
                              };
                              (i === null ? (i = [I]) : i.push(I), t++);
                            } else if (k(_) < 64) {
                              let I = {
                                instancePath: r + "/manifestFingerprint",
                                schemaPath: "#/properties/manifestFingerprint/anyOf/0/minLength",
                                keyword: "minLength",
                                params: { limit: 64 },
                              };
                              (i === null ? (i = [I]) : i.push(I), t++);
                            } else if (!qe.test(_)) {
                              let I = {
                                instancePath: r + "/manifestFingerprint",
                                schemaPath: "#/properties/manifestFingerprint/anyOf/0/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[a-f0-9]{64}$" },
                              };
                              (i === null ? (i = [I]) : i.push(I), t++);
                            }
                          } else {
                            let I = {
                              instancePath: r + "/manifestFingerprint",
                              schemaPath: "#/properties/manifestFingerprint/anyOf/0/type",
                              keyword: "type",
                              params: { type: "string" },
                            };
                            (i === null ? (i = [I]) : i.push(I), t++);
                          }
                        var n = $ === t;
                        S = S || n;
                        let T = t;
                        if (_ !== null) {
                          let I = {
                            instancePath: r + "/manifestFingerprint",
                            schemaPath: "#/properties/manifestFingerprint/anyOf/1/type",
                            keyword: "type",
                            params: { type: "null" },
                          };
                          (i === null ? (i = [I]) : i.push(I), t++);
                        }
                        var n = T === t;
                        if (((S = S || n), S))
                          ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                        else {
                          let I = {
                            instancePath: r + "/manifestFingerprint",
                            schemaPath: "#/properties/manifestFingerprint/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          return (i === null ? (i = [I]) : i.push(I), t++, (H.errors = i), !1);
                        }
                        var u = N === t;
                      } else var u = !0;
                      if (u) {
                        if (e.connectionId !== void 0) {
                          let _ = e.connectionId,
                            N = t,
                            L = t,
                            S = !1,
                            $ = t;
                          if (t === $)
                            if (typeof _ == "string") {
                              if (k(_) > 128) {
                                let I = {
                                  instancePath: r + "/connectionId",
                                  schemaPath: "#/properties/connectionId/anyOf/0/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 128 },
                                };
                                (i === null ? (i = [I]) : i.push(I), t++);
                              } else if (k(_) < 1) {
                                let I = {
                                  instancePath: r + "/connectionId",
                                  schemaPath: "#/properties/connectionId/anyOf/0/minLength",
                                  keyword: "minLength",
                                  params: { limit: 1 },
                                };
                                (i === null ? (i = [I]) : i.push(I), t++);
                              } else if (!q.test(_)) {
                                let I = {
                                  instancePath: r + "/connectionId",
                                  schemaPath: "#/properties/connectionId/anyOf/0/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                };
                                (i === null ? (i = [I]) : i.push(I), t++);
                              }
                            } else {
                              let I = {
                                instancePath: r + "/connectionId",
                                schemaPath: "#/properties/connectionId/anyOf/0/type",
                                keyword: "type",
                                params: { type: "string" },
                              };
                              (i === null ? (i = [I]) : i.push(I), t++);
                            }
                          var p = $ === t;
                          S = S || p;
                          let T = t;
                          if (_ !== null) {
                            let I = {
                              instancePath: r + "/connectionId",
                              schemaPath: "#/properties/connectionId/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            (i === null ? (i = [I]) : i.push(I), t++);
                          }
                          var p = T === t;
                          if (((S = S || p), S))
                            ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                          else {
                            let I = {
                              instancePath: r + "/connectionId",
                              schemaPath: "#/properties/connectionId/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            return (i === null ? (i = [I]) : i.push(I), t++, (H.errors = i), !1);
                          }
                          var u = N === t;
                        } else var u = !0;
                        if (u) {
                          if (e.grantId !== void 0) {
                            let _ = e.grantId,
                              N = t,
                              L = t,
                              S = !1,
                              $ = t;
                            if (t === $)
                              if (typeof _ == "string") {
                                if (k(_) > 128) {
                                  let I = {
                                    instancePath: r + "/grantId",
                                    schemaPath: "#/properties/grantId/anyOf/0/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 128 },
                                  };
                                  (i === null ? (i = [I]) : i.push(I), t++);
                                } else if (k(_) < 1) {
                                  let I = {
                                    instancePath: r + "/grantId",
                                    schemaPath: "#/properties/grantId/anyOf/0/minLength",
                                    keyword: "minLength",
                                    params: { limit: 1 },
                                  };
                                  (i === null ? (i = [I]) : i.push(I), t++);
                                } else if (!q.test(_)) {
                                  let I = {
                                    instancePath: r + "/grantId",
                                    schemaPath: "#/properties/grantId/anyOf/0/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                  };
                                  (i === null ? (i = [I]) : i.push(I), t++);
                                }
                              } else {
                                let I = {
                                  instancePath: r + "/grantId",
                                  schemaPath: "#/properties/grantId/anyOf/0/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                };
                                (i === null ? (i = [I]) : i.push(I), t++);
                              }
                            var h = $ === t;
                            S = S || h;
                            let T = t;
                            if (_ !== null) {
                              let I = {
                                instancePath: r + "/grantId",
                                schemaPath: "#/properties/grantId/anyOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                              };
                              (i === null ? (i = [I]) : i.push(I), t++);
                            }
                            var h = T === t;
                            if (((S = S || h), S))
                              ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                            else {
                              let I = {
                                instancePath: r + "/grantId",
                                schemaPath: "#/properties/grantId/anyOf",
                                keyword: "anyOf",
                                params: {},
                              };
                              return (i === null ? (i = [I]) : i.push(I), t++, (H.errors = i), !1);
                            }
                            var u = N === t;
                          } else var u = !0;
                          if (u) {
                            if (e.grantEpoch !== void 0) {
                              let _ = e.grantEpoch,
                                N = t,
                                L = t,
                                S = !1,
                                $ = t;
                              if (!(typeof _ == "number" && !(_ % 1) && !isNaN(_))) {
                                let I = {
                                  instancePath: r + "/grantEpoch",
                                  schemaPath: "#/properties/grantEpoch/anyOf/0/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                };
                                (i === null ? (i = [I]) : i.push(I), t++);
                              }
                              if (t === $ && typeof _ == "number") {
                                if (_ > 9007199254740991 || isNaN(_)) {
                                  let I = {
                                    instancePath: r + "/grantEpoch",
                                    schemaPath: "#/properties/grantEpoch/anyOf/0/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  };
                                  (i === null ? (i = [I]) : i.push(I), t++);
                                } else if (_ < 1 || isNaN(_)) {
                                  let I = {
                                    instancePath: r + "/grantEpoch",
                                    schemaPath: "#/properties/grantEpoch/anyOf/0/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  };
                                  (i === null ? (i = [I]) : i.push(I), t++);
                                }
                              }
                              var v = $ === t;
                              S = S || v;
                              let T = t;
                              if (_ !== null) {
                                let I = {
                                  instancePath: r + "/grantEpoch",
                                  schemaPath: "#/properties/grantEpoch/anyOf/1/type",
                                  keyword: "type",
                                  params: { type: "null" },
                                };
                                (i === null ? (i = [I]) : i.push(I), t++);
                              }
                              var v = T === t;
                              if (((S = S || v), S))
                                ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                              else {
                                let I = {
                                  instancePath: r + "/grantEpoch",
                                  schemaPath: "#/properties/grantEpoch/anyOf",
                                  keyword: "anyOf",
                                  params: {},
                                };
                                return (
                                  i === null ? (i = [I]) : i.push(I),
                                  t++,
                                  (H.errors = i),
                                  !1
                                );
                              }
                              var u = N === t;
                            } else var u = !0;
                            if (u) {
                              if (e.executionEpoch !== void 0) {
                                let _ = e.executionEpoch,
                                  N = t,
                                  L = t,
                                  S = !1,
                                  $ = t;
                                if (!(typeof _ == "number" && !(_ % 1) && !isNaN(_))) {
                                  let I = {
                                    instancePath: r + "/executionEpoch",
                                    schemaPath: "#/properties/executionEpoch/anyOf/0/type",
                                    keyword: "type",
                                    params: { type: "integer" },
                                  };
                                  (i === null ? (i = [I]) : i.push(I), t++);
                                }
                                if (t === $ && typeof _ == "number") {
                                  if (_ > 9007199254740991 || isNaN(_)) {
                                    let I = {
                                      instancePath: r + "/executionEpoch",
                                      schemaPath: "#/properties/executionEpoch/anyOf/0/maximum",
                                      keyword: "maximum",
                                      params: { comparison: "<=", limit: 9007199254740991 },
                                    };
                                    (i === null ? (i = [I]) : i.push(I), t++);
                                  } else if (_ < 1 || isNaN(_)) {
                                    let I = {
                                      instancePath: r + "/executionEpoch",
                                      schemaPath: "#/properties/executionEpoch/anyOf/0/minimum",
                                      keyword: "minimum",
                                      params: { comparison: ">=", limit: 1 },
                                    };
                                    (i === null ? (i = [I]) : i.push(I), t++);
                                  }
                                }
                                var g = $ === t;
                                S = S || g;
                                let T = t;
                                if (_ !== null) {
                                  let I = {
                                    instancePath: r + "/executionEpoch",
                                    schemaPath: "#/properties/executionEpoch/anyOf/1/type",
                                    keyword: "type",
                                    params: { type: "null" },
                                  };
                                  (i === null ? (i = [I]) : i.push(I), t++);
                                }
                                var g = T === t;
                                if (((S = S || g), S))
                                  ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                                else {
                                  let I = {
                                    instancePath: r + "/executionEpoch",
                                    schemaPath: "#/properties/executionEpoch/anyOf",
                                    keyword: "anyOf",
                                    params: {},
                                  };
                                  return (
                                    i === null ? (i = [I]) : i.push(I),
                                    t++,
                                    (H.errors = i),
                                    !1
                                  );
                                }
                                var u = N === t;
                              } else var u = !0;
                              if (u) {
                                if (e.resourceRef !== void 0) {
                                  let _ = e.resourceRef,
                                    N = t,
                                    L = t,
                                    S = !1,
                                    $ = t;
                                  B(_, {
                                    instancePath: r + "/resourceRef",
                                    parentData: e,
                                    parentDataProperty: "resourceRef",
                                    rootData: d,
                                    dynamicAnchors: y,
                                  }) ||
                                    ((i = i === null ? B.errors : i.concat(B.errors)),
                                    (t = i.length));
                                  var P = $ === t;
                                  S = S || P;
                                  let T = t;
                                  if (_ !== null) {
                                    let I = {
                                      instancePath: r + "/resourceRef",
                                      schemaPath: "#/properties/resourceRef/anyOf/1/type",
                                      keyword: "type",
                                      params: { type: "null" },
                                    };
                                    (i === null ? (i = [I]) : i.push(I), t++);
                                  }
                                  var P = T === t;
                                  if (((S = S || P), S))
                                    ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                                  else {
                                    let I = {
                                      instancePath: r + "/resourceRef",
                                      schemaPath: "#/properties/resourceRef/anyOf",
                                      keyword: "anyOf",
                                      params: {},
                                    };
                                    return (
                                      i === null ? (i = [I]) : i.push(I),
                                      t++,
                                      (H.errors = i),
                                      !1
                                    );
                                  }
                                  var u = N === t;
                                } else var u = !0;
                                if (u) {
                                  if (e.sourceRevision !== void 0) {
                                    let _ = e.sourceRevision,
                                      N = t,
                                      L = t,
                                      S = !1,
                                      $ = t;
                                    if (!(typeof _ == "number" && !(_ % 1) && !isNaN(_))) {
                                      let I = {
                                        instancePath: r + "/sourceRevision",
                                        schemaPath: "#/properties/sourceRevision/anyOf/0/type",
                                        keyword: "type",
                                        params: { type: "integer" },
                                      };
                                      (i === null ? (i = [I]) : i.push(I), t++);
                                    }
                                    if (t === $ && typeof _ == "number") {
                                      if (_ > 9007199254740991 || isNaN(_)) {
                                        let I = {
                                          instancePath: r + "/sourceRevision",
                                          schemaPath: "#/properties/sourceRevision/anyOf/0/maximum",
                                          keyword: "maximum",
                                          params: { comparison: "<=", limit: 9007199254740991 },
                                        };
                                        (i === null ? (i = [I]) : i.push(I), t++);
                                      } else if (_ < 1 || isNaN(_)) {
                                        let I = {
                                          instancePath: r + "/sourceRevision",
                                          schemaPath: "#/properties/sourceRevision/anyOf/0/minimum",
                                          keyword: "minimum",
                                          params: { comparison: ">=", limit: 1 },
                                        };
                                        (i === null ? (i = [I]) : i.push(I), t++);
                                      }
                                    }
                                    var b = $ === t;
                                    S = S || b;
                                    let T = t;
                                    if (_ !== null) {
                                      let I = {
                                        instancePath: r + "/sourceRevision",
                                        schemaPath: "#/properties/sourceRevision/anyOf/1/type",
                                        keyword: "type",
                                        params: { type: "null" },
                                      };
                                      (i === null ? (i = [I]) : i.push(I), t++);
                                    }
                                    var b = T === t;
                                    if (((S = S || b), S))
                                      ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                                    else {
                                      let I = {
                                        instancePath: r + "/sourceRevision",
                                        schemaPath: "#/properties/sourceRevision/anyOf",
                                        keyword: "anyOf",
                                        params: {},
                                      };
                                      return (
                                        i === null ? (i = [I]) : i.push(I),
                                        t++,
                                        (H.errors = i),
                                        !1
                                      );
                                    }
                                    var u = N === t;
                                  } else var u = !0;
                                  if (u)
                                    if (e.sourceEpoch !== void 0) {
                                      let _ = e.sourceEpoch,
                                        N = t,
                                        L = t,
                                        S = !1,
                                        $ = t;
                                      if (!(typeof _ == "number" && !(_ % 1) && !isNaN(_))) {
                                        let I = {
                                          instancePath: r + "/sourceEpoch",
                                          schemaPath: "#/properties/sourceEpoch/anyOf/0/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                        };
                                        (i === null ? (i = [I]) : i.push(I), t++);
                                      }
                                      if (t === $ && typeof _ == "number") {
                                        if (_ > 9007199254740991 || isNaN(_)) {
                                          let I = {
                                            instancePath: r + "/sourceEpoch",
                                            schemaPath: "#/properties/sourceEpoch/anyOf/0/maximum",
                                            keyword: "maximum",
                                            params: { comparison: "<=", limit: 9007199254740991 },
                                          };
                                          (i === null ? (i = [I]) : i.push(I), t++);
                                        } else if (_ < 1 || isNaN(_)) {
                                          let I = {
                                            instancePath: r + "/sourceEpoch",
                                            schemaPath: "#/properties/sourceEpoch/anyOf/0/minimum",
                                            keyword: "minimum",
                                            params: { comparison: ">=", limit: 1 },
                                          };
                                          (i === null ? (i = [I]) : i.push(I), t++);
                                        }
                                      }
                                      var A = $ === t;
                                      S = S || A;
                                      let T = t;
                                      if (_ !== null) {
                                        let I = {
                                          instancePath: r + "/sourceEpoch",
                                          schemaPath: "#/properties/sourceEpoch/anyOf/1/type",
                                          keyword: "type",
                                          params: { type: "null" },
                                        };
                                        (i === null ? (i = [I]) : i.push(I), t++);
                                      }
                                      var A = T === t;
                                      if (((S = S || A), S))
                                        ((t = L), i !== null && (L ? (i.length = L) : (i = null)));
                                      else {
                                        let I = {
                                          instancePath: r + "/sourceEpoch",
                                          schemaPath: "#/properties/sourceEpoch/anyOf",
                                          keyword: "anyOf",
                                          params: {},
                                        };
                                        return (
                                          i === null ? (i = [I]) : i.push(I),
                                          t++,
                                          (H.errors = i),
                                          !1
                                        );
                                      }
                                      var u = N === t;
                                    } else var u = !0;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (H.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((H.errors = i), t === 0);
  }
  H.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ge(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ge.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if ((e.ref === void 0 && (u = "ref")) || (e.sourceEpoch === void 0 && (u = "sourceEpoch")))
          return (
            (ge.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "ref" || c === "sourceEpoch")) {
              return (
                (ge.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.ref !== void 0) {
              let c = t;
              B(e.ref, {
                instancePath: r + "/ref",
                parentData: e,
                parentDataProperty: "ref",
                rootData: d,
                dynamicAnchors: y,
              }) || ((i = i === null ? B.errors : i.concat(B.errors)), (t = i.length));
              var s = c === t;
            } else var s = !0;
            if (s)
              if (e.sourceEpoch !== void 0) {
                let c = e.sourceEpoch,
                  a = t;
                if (!(typeof c == "number" && !(c % 1) && !isNaN(c)))
                  return (
                    (ge.errors = [
                      {
                        instancePath: r + "/sourceEpoch",
                        schemaPath: "#/properties/sourceEpoch/type",
                        keyword: "type",
                        params: { type: "integer" },
                      },
                    ]),
                    !1
                  );
                if (t === a && typeof c == "number") {
                  if (c > 9007199254740991 || isNaN(c))
                    return (
                      (ge.errors = [
                        {
                          instancePath: r + "/sourceEpoch",
                          schemaPath: "#/properties/sourceEpoch/maximum",
                          keyword: "maximum",
                          params: { comparison: "<=", limit: 9007199254740991 },
                        },
                      ]),
                      !1
                    );
                  if (c < 1 || isNaN(c))
                    return (
                      (ge.errors = [
                        {
                          instancePath: r + "/sourceEpoch",
                          schemaPath: "#/properties/sourceEpoch/minimum",
                          keyword: "minimum",
                          params: { comparison: ">=", limit: 1 },
                        },
                      ]),
                      !1
                    );
                }
                var s = a === t;
              } else var s = !0;
          }
        }
      } else
        return (
          (ge.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ge.errors = i), t === 0);
  }
  ge.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Ds = {
    type: "object",
    properties: {
      keyId: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" },
      role: { enum: ["device_enc", "agent_enc", "recovery_enc"] },
      principalId: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
      },
      connectionId: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
          },
          { type: "null" },
        ],
      },
      keyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    },
    required: ["keyId", "role", "principalId", "connectionId", "keyEpoch"],
    additionalProperties: !1,
    allOf: [
      {
        if: { properties: { role: { const: "agent_enc" } } },
        then: {
          properties: {
            connectionId: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
            },
          },
        },
        else: { properties: { connectionId: { type: "null" } } },
      },
    ],
  };
  function C(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = C.evaluated;
    (m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0));
    let s = t,
      u = !0,
      w = t;
    if (
      e &&
      typeof e == "object" &&
      !Array.isArray(e) &&
      e.role !== void 0 &&
      e.role !== "agent_enc"
    ) {
      let h = {};
      (i === null ? (i = [h]) : i.push(h), t++);
    }
    var c = w === t;
    ((t = s), i !== null && (s ? (i.length = s) : (i = null)));
    let a;
    if (c) {
      let h = t;
      if (e && typeof e == "object" && !Array.isArray(e) && e.connectionId !== void 0) {
        let g = e.connectionId;
        if (t === t)
          if (typeof g == "string") {
            if (k(g) > 128)
              return (
                (C.errors = [
                  {
                    instancePath: r + "/connectionId",
                    schemaPath: "#/allOf/0/then/properties/connectionId/maxLength",
                    keyword: "maxLength",
                    params: { limit: 128 },
                  },
                ]),
                !1
              );
            if (k(g) < 1)
              return (
                (C.errors = [
                  {
                    instancePath: r + "/connectionId",
                    schemaPath: "#/allOf/0/then/properties/connectionId/minLength",
                    keyword: "minLength",
                    params: { limit: 1 },
                  },
                ]),
                !1
              );
            if (!q.test(g))
              return (
                (C.errors = [
                  {
                    instancePath: r + "/connectionId",
                    schemaPath: "#/allOf/0/then/properties/connectionId/pattern",
                    keyword: "pattern",
                    params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                  },
                ]),
                !1
              );
          } else
            return (
              (C.errors = [
                {
                  instancePath: r + "/connectionId",
                  schemaPath: "#/allOf/0/then/properties/connectionId/type",
                  keyword: "type",
                  params: { type: "string" },
                },
              ]),
              !1
            );
      }
      var c = h === t;
      if (((u = c), u)) {
        var o = {};
        ((o.connectionId = !0), (o.role = !0));
      }
      a = "then";
    } else {
      let h = t;
      if (
        e &&
        typeof e == "object" &&
        !Array.isArray(e) &&
        e.connectionId !== void 0 &&
        e.connectionId !== null
      )
        return (
          (C.errors = [
            {
              instancePath: r + "/connectionId",
              schemaPath: "#/allOf/0/else/properties/connectionId/type",
              keyword: "type",
              params: { type: "null" },
            },
          ]),
          !1
        );
      var c = h === t;
      ((u = c), u && o !== !0 && ((o = o || {}), (o.connectionId = !0)), (a = "else"));
    }
    if (!u) {
      let h = {
        instancePath: r,
        schemaPath: "#/allOf/0/if",
        keyword: "if",
        params: { failingKeyword: a },
      };
      return (i === null ? (i = [h]) : i.push(h), t++, (C.errors = i), !1);
    }
    if (t === 0)
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let h;
        if (
          (e.keyId === void 0 && (h = "keyId")) ||
          (e.role === void 0 && (h = "role")) ||
          (e.principalId === void 0 && (h = "principalId")) ||
          (e.connectionId === void 0 && (h = "connectionId")) ||
          (e.keyEpoch === void 0 && (h = "keyEpoch"))
        )
          return (
            (C.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: h },
              },
            ]),
            !1
          );
        {
          let v = t;
          for (let g in e)
            if (!(
              g === "keyId" ||
              g === "role" ||
              g === "principalId" ||
              g === "connectionId" ||
              g === "keyEpoch"
            )) {
              return (
                (C.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: g },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === t) {
            if (e.keyId !== void 0) {
              let g = e.keyId,
                P = t;
              if (t === P)
                if (typeof g == "string") {
                  if (k(g) > 43)
                    return (
                      (C.errors = [
                        {
                          instancePath: r + "/keyId",
                          schemaPath: "#/properties/keyId/maxLength",
                          keyword: "maxLength",
                          params: { limit: 43 },
                        },
                      ]),
                      !1
                    );
                  if (k(g) < 43)
                    return (
                      (C.errors = [
                        {
                          instancePath: r + "/keyId",
                          schemaPath: "#/properties/keyId/minLength",
                          keyword: "minLength",
                          params: { limit: 43 },
                        },
                      ]),
                      !1
                    );
                  if (!ue.test(g))
                    return (
                      (C.errors = [
                        {
                          instancePath: r + "/keyId",
                          schemaPath: "#/properties/keyId/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (C.errors = [
                      {
                        instancePath: r + "/keyId",
                        schemaPath: "#/properties/keyId/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var n = P === t;
            } else var n = !0;
            if (n) {
              if (e.role !== void 0) {
                let g = e.role,
                  P = t;
                if (!(g === "device_enc" || g === "agent_enc" || g === "recovery_enc"))
                  return (
                    (C.errors = [
                      {
                        instancePath: r + "/role",
                        schemaPath: "#/properties/role/enum",
                        keyword: "enum",
                        params: { allowedValues: Ds.properties.role.enum },
                      },
                    ]),
                    !1
                  );
                var n = P === t;
              } else var n = !0;
              if (n) {
                if (e.principalId !== void 0) {
                  let g = e.principalId,
                    P = t;
                  if (t === P)
                    if (typeof g == "string") {
                      if (k(g) > 128)
                        return (
                          (C.errors = [
                            {
                              instancePath: r + "/principalId",
                              schemaPath: "#/properties/principalId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (k(g) < 1)
                        return (
                          (C.errors = [
                            {
                              instancePath: r + "/principalId",
                              schemaPath: "#/properties/principalId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!q.test(g))
                        return (
                          (C.errors = [
                            {
                              instancePath: r + "/principalId",
                              schemaPath: "#/properties/principalId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (C.errors = [
                          {
                            instancePath: r + "/principalId",
                            schemaPath: "#/properties/principalId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var n = P === t;
                } else var n = !0;
                if (n) {
                  if (e.connectionId !== void 0) {
                    let g = e.connectionId,
                      P = t,
                      b = t,
                      A = !1,
                      V = t;
                    if (t === V)
                      if (typeof g == "string") {
                        if (k(g) > 128) {
                          let N = {
                            instancePath: r + "/connectionId",
                            schemaPath: "#/properties/connectionId/anyOf/0/maxLength",
                            keyword: "maxLength",
                            params: { limit: 128 },
                          };
                          (i === null ? (i = [N]) : i.push(N), t++);
                        } else if (k(g) < 1) {
                          let N = {
                            instancePath: r + "/connectionId",
                            schemaPath: "#/properties/connectionId/anyOf/0/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          };
                          (i === null ? (i = [N]) : i.push(N), t++);
                        } else if (!q.test(g)) {
                          let N = {
                            instancePath: r + "/connectionId",
                            schemaPath: "#/properties/connectionId/anyOf/0/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                          };
                          (i === null ? (i = [N]) : i.push(N), t++);
                        }
                      } else {
                        let N = {
                          instancePath: r + "/connectionId",
                          schemaPath: "#/properties/connectionId/anyOf/0/type",
                          keyword: "type",
                          params: { type: "string" },
                        };
                        (i === null ? (i = [N]) : i.push(N), t++);
                      }
                    var p = V === t;
                    A = A || p;
                    let W = t;
                    if (g !== null) {
                      let N = {
                        instancePath: r + "/connectionId",
                        schemaPath: "#/properties/connectionId/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (i === null ? (i = [N]) : i.push(N), t++);
                    }
                    var p = W === t;
                    if (((A = A || p), A))
                      ((t = b), i !== null && (b ? (i.length = b) : (i = null)));
                    else {
                      let N = {
                        instancePath: r + "/connectionId",
                        schemaPath: "#/properties/connectionId/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (i === null ? (i = [N]) : i.push(N), t++, (C.errors = i), !1);
                    }
                    var n = P === t;
                  } else var n = !0;
                  if (n)
                    if (e.keyEpoch !== void 0) {
                      let g = e.keyEpoch,
                        P = t;
                      if (!(typeof g == "number" && !(g % 1) && !isNaN(g)))
                        return (
                          (C.errors = [
                            {
                              instancePath: r + "/keyEpoch",
                              schemaPath: "#/properties/keyEpoch/type",
                              keyword: "type",
                              params: { type: "integer" },
                            },
                          ]),
                          !1
                        );
                      if (t === P && typeof g == "number") {
                        if (g > 9007199254740991 || isNaN(g))
                          return (
                            (C.errors = [
                              {
                                instancePath: r + "/keyEpoch",
                                schemaPath: "#/properties/keyEpoch/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 9007199254740991 },
                              },
                            ]),
                            !1
                          );
                        if (g < 1 || isNaN(g))
                          return (
                            (C.errors = [
                              {
                                instancePath: r + "/keyEpoch",
                                schemaPath: "#/properties/keyEpoch/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 1 },
                              },
                            ]),
                            !1
                          );
                      }
                      var n = P === t;
                    } else var n = !0;
                }
              }
            }
          }
        }
      } else
        return (
          (C.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((C.errors = i), t === 0);
  }
  C.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function K(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = K.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let a;
        if (
          (e.contractVersion === void 0 && (a = "contractVersion")) ||
          (e.profileId === void 0 && (a = "profileId")) ||
          (e.ownerSubject === void 0 && (a = "ownerSubject")) ||
          (e.vaultId === void 0 && (a = "vaultId")) ||
          (e.rootKeyId === void 0 && (a = "rootKeyId")) ||
          (e.rootEpoch === void 0 && (a = "rootEpoch")) ||
          (e.registrySequence === void 0 && (a = "registrySequence")) ||
          (e.checkpointDigest === void 0 && (a = "checkpointDigest")) ||
          (e.keyEpoch === void 0 && (a = "keyEpoch")) ||
          (e.objectId === void 0 && (a = "objectId")) ||
          (e.objectType === void 0 && (a = "objectType")) ||
          (e.revision === void 0 && (a = "revision")) ||
          (e.deliveryRevision === void 0 && (a = "deliveryRevision")) ||
          (e.priorEnvelopeFingerprint === void 0 && (a = "priorEnvelopeFingerprint")) ||
          (e.expectedRevision === void 0 && (a = "expectedRevision")) ||
          (e.stableOperationId === void 0 && (a = "stableOperationId")) ||
          (e.operationType === void 0 && (a = "operationType")) ||
          (e.authorSigningKeyId === void 0 && (a = "authorSigningKeyId")) ||
          (e.binding === void 0 && (a = "binding")) ||
          (e.resourceBindings === void 0 && (a = "resourceBindings")) ||
          (e.recipients === void 0 && (a = "recipients"))
        )
          return (
            (K.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: a },
              },
            ]),
            !1
          );
        {
          let o = t;
          for (let n in e)
            if (!Qe.call(ur.properties, n)) {
              return (
                (K.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: n },
                  },
                ]),
                !1
              );
              break;
            }
          if (o === t) {
            if (e.contractVersion !== void 0) {
              let n = t;
              if (e.contractVersion !== "folioview.agent-workspace.v2.0")
                return (
                  (K.errors = [
                    {
                      instancePath: r + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.agent-workspace.v2.0" },
                    },
                  ]),
                  !1
                );
              var s = n === t;
            } else var s = !0;
            if (s) {
              if (e.profileId !== void 0) {
                let n = t;
                if (e.profileId !== "P1")
                  return (
                    (K.errors = [
                      {
                        instancePath: r + "/profileId",
                        schemaPath: "#/properties/profileId/const",
                        keyword: "const",
                        params: { allowedValue: "P1" },
                      },
                    ]),
                    !1
                  );
                var s = n === t;
              } else var s = !0;
              if (s) {
                if (e.ownerSubject !== void 0) {
                  let n = e.ownerSubject,
                    p = t;
                  if (t === p)
                    if (typeof n == "string") {
                      if (k(n) > 128)
                        return (
                          (K.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (k(n) < 1)
                        return (
                          (K.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!q.test(n))
                        return (
                          (K.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (K.errors = [
                          {
                            instancePath: r + "/ownerSubject",
                            schemaPath: "#/properties/ownerSubject/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = p === t;
                } else var s = !0;
                if (s) {
                  if (e.vaultId !== void 0) {
                    let n = e.vaultId,
                      p = t;
                    if (t === p)
                      if (typeof n == "string") {
                        if (k(n) > 128)
                          return (
                            (K.errors = [
                              {
                                instancePath: r + "/vaultId",
                                schemaPath: "#/properties/vaultId/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (k(n) < 1)
                          return (
                            (K.errors = [
                              {
                                instancePath: r + "/vaultId",
                                schemaPath: "#/properties/vaultId/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!q.test(n))
                          return (
                            (K.errors = [
                              {
                                instancePath: r + "/vaultId",
                                schemaPath: "#/properties/vaultId/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (K.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = p === t;
                  } else var s = !0;
                  if (s) {
                    if (e.rootKeyId !== void 0) {
                      let n = e.rootKeyId,
                        p = t;
                      if (t === p)
                        if (typeof n == "string") {
                          if (k(n) > 43)
                            return (
                              (K.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 43 },
                                },
                              ]),
                              !1
                            );
                          if (k(n) < 43)
                            return (
                              (K.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/minLength",
                                  keyword: "minLength",
                                  params: { limit: 43 },
                                },
                              ]),
                              !1
                            );
                          if (!ue.test(n))
                            return (
                              (K.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (K.errors = [
                              {
                                instancePath: r + "/rootKeyId",
                                schemaPath: "#/properties/rootKeyId/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = p === t;
                    } else var s = !0;
                    if (s) {
                      if (e.rootEpoch !== void 0) {
                        let n = e.rootEpoch,
                          p = t;
                        if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                          return (
                            (K.errors = [
                              {
                                instancePath: r + "/rootEpoch",
                                schemaPath: "#/properties/rootEpoch/type",
                                keyword: "type",
                                params: { type: "integer" },
                              },
                            ]),
                            !1
                          );
                        if (t === p && typeof n == "number") {
                          if (n > 9007199254740991 || isNaN(n))
                            return (
                              (K.errors = [
                                {
                                  instancePath: r + "/rootEpoch",
                                  schemaPath: "#/properties/rootEpoch/maximum",
                                  keyword: "maximum",
                                  params: { comparison: "<=", limit: 9007199254740991 },
                                },
                              ]),
                              !1
                            );
                          if (n < 1 || isNaN(n))
                            return (
                              (K.errors = [
                                {
                                  instancePath: r + "/rootEpoch",
                                  schemaPath: "#/properties/rootEpoch/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ]),
                              !1
                            );
                        }
                        var s = p === t;
                      } else var s = !0;
                      if (s) {
                        if (e.registrySequence !== void 0) {
                          let n = e.registrySequence,
                            p = t;
                          if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                            return (
                              (K.errors = [
                                {
                                  instancePath: r + "/registrySequence",
                                  schemaPath: "#/properties/registrySequence/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                },
                              ]),
                              !1
                            );
                          if (t === p && typeof n == "number") {
                            if (n > 9007199254740991 || isNaN(n))
                              return (
                                (K.errors = [
                                  {
                                    instancePath: r + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  },
                                ]),
                                !1
                              );
                            if (n < 1 || isNaN(n))
                              return (
                                (K.errors = [
                                  {
                                    instancePath: r + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  },
                                ]),
                                !1
                              );
                          }
                          var s = p === t;
                        } else var s = !0;
                        if (s) {
                          if (e.checkpointDigest !== void 0) {
                            let n = e.checkpointDigest,
                              p = t;
                            if (t === p)
                              if (typeof n == "string") {
                                if (k(n) > 64)
                                  return (
                                    (K.errors = [
                                      {
                                        instancePath: r + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/maxLength",
                                        keyword: "maxLength",
                                        params: { limit: 64 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (k(n) < 64)
                                  return (
                                    (K.errors = [
                                      {
                                        instancePath: r + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/minLength",
                                        keyword: "minLength",
                                        params: { limit: 64 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (!qe.test(n))
                                  return (
                                    (K.errors = [
                                      {
                                        instancePath: r + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/pattern",
                                        keyword: "pattern",
                                        params: { pattern: "^[a-f0-9]{64}$" },
                                      },
                                    ]),
                                    !1
                                  );
                              } else
                                return (
                                  (K.errors = [
                                    {
                                      instancePath: r + "/checkpointDigest",
                                      schemaPath: "#/properties/checkpointDigest/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                    },
                                  ]),
                                  !1
                                );
                            var s = p === t;
                          } else var s = !0;
                          if (s) {
                            if (e.keyEpoch !== void 0) {
                              let n = e.keyEpoch,
                                p = t;
                              if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                                return (
                                  (K.errors = [
                                    {
                                      instancePath: r + "/keyEpoch",
                                      schemaPath: "#/properties/keyEpoch/type",
                                      keyword: "type",
                                      params: { type: "integer" },
                                    },
                                  ]),
                                  !1
                                );
                              if (t === p && typeof n == "number") {
                                if (n > 9007199254740991 || isNaN(n))
                                  return (
                                    (K.errors = [
                                      {
                                        instancePath: r + "/keyEpoch",
                                        schemaPath: "#/properties/keyEpoch/maximum",
                                        keyword: "maximum",
                                        params: { comparison: "<=", limit: 9007199254740991 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (n < 1 || isNaN(n))
                                  return (
                                    (K.errors = [
                                      {
                                        instancePath: r + "/keyEpoch",
                                        schemaPath: "#/properties/keyEpoch/minimum",
                                        keyword: "minimum",
                                        params: { comparison: ">=", limit: 1 },
                                      },
                                    ]),
                                    !1
                                  );
                              }
                              var s = p === t;
                            } else var s = !0;
                            if (s) {
                              if (e.objectId !== void 0) {
                                let n = e.objectId,
                                  p = t;
                                if (t === p)
                                  if (typeof n == "string") {
                                    if (k(n) > 128)
                                      return (
                                        (K.errors = [
                                          {
                                            instancePath: r + "/objectId",
                                            schemaPath: "#/properties/objectId/maxLength",
                                            keyword: "maxLength",
                                            params: { limit: 128 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (k(n) < 1)
                                      return (
                                        (K.errors = [
                                          {
                                            instancePath: r + "/objectId",
                                            schemaPath: "#/properties/objectId/minLength",
                                            keyword: "minLength",
                                            params: { limit: 1 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (!q.test(n))
                                      return (
                                        (K.errors = [
                                          {
                                            instancePath: r + "/objectId",
                                            schemaPath: "#/properties/objectId/pattern",
                                            keyword: "pattern",
                                            params: {
                                              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
                                            },
                                          },
                                        ]),
                                        !1
                                      );
                                  } else
                                    return (
                                      (K.errors = [
                                        {
                                          instancePath: r + "/objectId",
                                          schemaPath: "#/properties/objectId/type",
                                          keyword: "type",
                                          params: { type: "string" },
                                        },
                                      ]),
                                      !1
                                    );
                                var s = p === t;
                              } else var s = !0;
                              if (s) {
                                if (e.objectType !== void 0) {
                                  let n = e.objectType,
                                    p = t;
                                  if (!(
                                    n === "task" ||
                                    n === "holdings_snapshot" ||
                                    n === "watchlist_evidence" ||
                                    n === "channel_follows_evidence" ||
                                    n === "result_revision"
                                  ))
                                    return (
                                      (K.errors = [
                                        {
                                          instancePath: r + "/objectType",
                                          schemaPath: "#/properties/objectType/enum",
                                          keyword: "enum",
                                          params: { allowedValues: ur.properties.objectType.enum },
                                        },
                                      ]),
                                      !1
                                    );
                                  var s = p === t;
                                } else var s = !0;
                                if (s) {
                                  if (e.revision !== void 0) {
                                    let n = e.revision,
                                      p = t;
                                    if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                                      return (
                                        (K.errors = [
                                          {
                                            instancePath: r + "/revision",
                                            schemaPath: "#/properties/revision/type",
                                            keyword: "type",
                                            params: { type: "integer" },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (t === p && typeof n == "number") {
                                      if (n > 9007199254740991 || isNaN(n))
                                        return (
                                          (K.errors = [
                                            {
                                              instancePath: r + "/revision",
                                              schemaPath: "#/properties/revision/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (n < 1 || isNaN(n))
                                        return (
                                          (K.errors = [
                                            {
                                              instancePath: r + "/revision",
                                              schemaPath: "#/properties/revision/minimum",
                                              keyword: "minimum",
                                              params: { comparison: ">=", limit: 1 },
                                            },
                                          ]),
                                          !1
                                        );
                                    }
                                    var s = p === t;
                                  } else var s = !0;
                                  if (s) {
                                    if (e.deliveryRevision !== void 0) {
                                      let n = e.deliveryRevision,
                                        p = t;
                                      if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                                        return (
                                          (K.errors = [
                                            {
                                              instancePath: r + "/deliveryRevision",
                                              schemaPath: "#/properties/deliveryRevision/type",
                                              keyword: "type",
                                              params: { type: "integer" },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (t === p && typeof n == "number") {
                                        if (n > 9007199254740991 || isNaN(n))
                                          return (
                                            (K.errors = [
                                              {
                                                instancePath: r + "/deliveryRevision",
                                                schemaPath: "#/properties/deliveryRevision/maximum",
                                                keyword: "maximum",
                                                params: {
                                                  comparison: "<=",
                                                  limit: 9007199254740991,
                                                },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (n < 1 || isNaN(n))
                                          return (
                                            (K.errors = [
                                              {
                                                instancePath: r + "/deliveryRevision",
                                                schemaPath: "#/properties/deliveryRevision/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 1 },
                                              },
                                            ]),
                                            !1
                                          );
                                      }
                                      var s = p === t;
                                    } else var s = !0;
                                    if (s) {
                                      if (e.priorEnvelopeFingerprint !== void 0) {
                                        let n = e.priorEnvelopeFingerprint,
                                          p = t,
                                          h = t,
                                          v = !1,
                                          g = t;
                                        if (t === g)
                                          if (typeof n == "string") {
                                            if (k(n) > 64) {
                                              let A = {
                                                instancePath: r + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/maxLength",
                                                keyword: "maxLength",
                                                params: { limit: 64 },
                                              };
                                              (i === null ? (i = [A]) : i.push(A), t++);
                                            } else if (k(n) < 64) {
                                              let A = {
                                                instancePath: r + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/minLength",
                                                keyword: "minLength",
                                                params: { limit: 64 },
                                              };
                                              (i === null ? (i = [A]) : i.push(A), t++);
                                            } else if (!qe.test(n)) {
                                              let A = {
                                                instancePath: r + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/pattern",
                                                keyword: "pattern",
                                                params: { pattern: "^[a-f0-9]{64}$" },
                                              };
                                              (i === null ? (i = [A]) : i.push(A), t++);
                                            }
                                          } else {
                                            let A = {
                                              instancePath: r + "/priorEnvelopeFingerprint",
                                              schemaPath:
                                                "#/properties/priorEnvelopeFingerprint/anyOf/0/type",
                                              keyword: "type",
                                              params: { type: "string" },
                                            };
                                            (i === null ? (i = [A]) : i.push(A), t++);
                                          }
                                        var u = g === t;
                                        v = v || u;
                                        let P = t;
                                        if (n !== null) {
                                          let A = {
                                            instancePath: r + "/priorEnvelopeFingerprint",
                                            schemaPath:
                                              "#/properties/priorEnvelopeFingerprint/anyOf/1/type",
                                            keyword: "type",
                                            params: { type: "null" },
                                          };
                                          (i === null ? (i = [A]) : i.push(A), t++);
                                        }
                                        var u = P === t;
                                        if (((v = v || u), v))
                                          ((t = h),
                                            i !== null && (h ? (i.length = h) : (i = null)));
                                        else {
                                          let A = {
                                            instancePath: r + "/priorEnvelopeFingerprint",
                                            schemaPath:
                                              "#/properties/priorEnvelopeFingerprint/anyOf",
                                            keyword: "anyOf",
                                            params: {},
                                          };
                                          return (
                                            i === null ? (i = [A]) : i.push(A),
                                            t++,
                                            (K.errors = i),
                                            !1
                                          );
                                        }
                                        var s = p === t;
                                      } else var s = !0;
                                      if (s) {
                                        if (e.expectedRevision !== void 0) {
                                          let n = e.expectedRevision,
                                            p = t;
                                          if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                                            return (
                                              (K.errors = [
                                                {
                                                  instancePath: r + "/expectedRevision",
                                                  schemaPath: "#/properties/expectedRevision/type",
                                                  keyword: "type",
                                                  params: { type: "integer" },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (t === p && typeof n == "number") {
                                            if (n > 9007199254740991 || isNaN(n))
                                              return (
                                                (K.errors = [
                                                  {
                                                    instancePath: r + "/expectedRevision",
                                                    schemaPath:
                                                      "#/properties/expectedRevision/maximum",
                                                    keyword: "maximum",
                                                    params: {
                                                      comparison: "<=",
                                                      limit: 9007199254740991,
                                                    },
                                                  },
                                                ]),
                                                !1
                                              );
                                            if (n < 0 || isNaN(n))
                                              return (
                                                (K.errors = [
                                                  {
                                                    instancePath: r + "/expectedRevision",
                                                    schemaPath:
                                                      "#/properties/expectedRevision/minimum",
                                                    keyword: "minimum",
                                                    params: { comparison: ">=", limit: 0 },
                                                  },
                                                ]),
                                                !1
                                              );
                                          }
                                          var s = p === t;
                                        } else var s = !0;
                                        if (s) {
                                          if (e.stableOperationId !== void 0) {
                                            let n = t;
                                            je(e.stableOperationId, {
                                              instancePath: r + "/stableOperationId",
                                              parentData: e,
                                              parentDataProperty: "stableOperationId",
                                              rootData: d,
                                              dynamicAnchors: y,
                                            }) ||
                                              ((i = i === null ? je.errors : i.concat(je.errors)),
                                              (t = i.length));
                                            var s = n === t;
                                          } else var s = !0;
                                          if (s) {
                                            if (e.operationType !== void 0) {
                                              let n = e.operationType,
                                                p = t;
                                              if (!(
                                                n === "create_task" ||
                                                n === "update_task" ||
                                                n === "transition_task" ||
                                                n === "commit_snapshot" ||
                                                n === "commit_evidence" ||
                                                n === "submit_result" ||
                                                n === "revise_result" ||
                                                n === "reshare_delivery"
                                              ))
                                                return (
                                                  (K.errors = [
                                                    {
                                                      instancePath: r + "/operationType",
                                                      schemaPath: "#/properties/operationType/enum",
                                                      keyword: "enum",
                                                      params: {
                                                        allowedValues:
                                                          ur.properties.operationType.enum,
                                                      },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              var s = p === t;
                                            } else var s = !0;
                                            if (s) {
                                              if (e.authorSigningKeyId !== void 0) {
                                                let n = e.authorSigningKeyId,
                                                  p = t;
                                                if (t === p)
                                                  if (typeof n == "string") {
                                                    if (k(n) > 43)
                                                      return (
                                                        (K.errors = [
                                                          {
                                                            instancePath: r + "/authorSigningKeyId",
                                                            schemaPath:
                                                              "#/properties/authorSigningKeyId/maxLength",
                                                            keyword: "maxLength",
                                                            params: { limit: 43 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (k(n) < 43)
                                                      return (
                                                        (K.errors = [
                                                          {
                                                            instancePath: r + "/authorSigningKeyId",
                                                            schemaPath:
                                                              "#/properties/authorSigningKeyId/minLength",
                                                            keyword: "minLength",
                                                            params: { limit: 43 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (!ue.test(n))
                                                      return (
                                                        (K.errors = [
                                                          {
                                                            instancePath: r + "/authorSigningKeyId",
                                                            schemaPath:
                                                              "#/properties/authorSigningKeyId/pattern",
                                                            keyword: "pattern",
                                                            params: {
                                                              pattern: "^[A-Za-z0-9_-]{43}$",
                                                            },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                  } else
                                                    return (
                                                      (K.errors = [
                                                        {
                                                          instancePath: r + "/authorSigningKeyId",
                                                          schemaPath:
                                                            "#/properties/authorSigningKeyId/type",
                                                          keyword: "type",
                                                          params: { type: "string" },
                                                        },
                                                      ]),
                                                      !1
                                                    );
                                                var s = p === t;
                                              } else var s = !0;
                                              if (s) {
                                                if (e.binding !== void 0) {
                                                  let n = t;
                                                  H(e.binding, {
                                                    instancePath: r + "/binding",
                                                    parentData: e,
                                                    parentDataProperty: "binding",
                                                    rootData: d,
                                                    dynamicAnchors: y,
                                                  }) ||
                                                    ((i =
                                                      i === null ? H.errors : i.concat(H.errors)),
                                                    (t = i.length));
                                                  var s = n === t;
                                                } else var s = !0;
                                                if (s) {
                                                  if (e.resourceBindings !== void 0) {
                                                    let n = e.resourceBindings,
                                                      p = t;
                                                    if (t === p)
                                                      if (Array.isArray(n)) {
                                                        if (n.length > 10)
                                                          return (
                                                            (K.errors = [
                                                              {
                                                                instancePath:
                                                                  r + "/resourceBindings",
                                                                schemaPath:
                                                                  "#/properties/resourceBindings/maxItems",
                                                                keyword: "maxItems",
                                                                params: { limit: 10 },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                        if (n.length < 0)
                                                          return (
                                                            (K.errors = [
                                                              {
                                                                instancePath:
                                                                  r + "/resourceBindings",
                                                                schemaPath:
                                                                  "#/properties/resourceBindings/minItems",
                                                                keyword: "minItems",
                                                                params: { limit: 0 },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                        {
                                                          var w = !0;
                                                          let v = n.length;
                                                          for (let g = 0; g < v; g++) {
                                                            let P = t;
                                                            ge(n[g], {
                                                              instancePath:
                                                                r + "/resourceBindings/" + g,
                                                              parentData: n,
                                                              parentDataProperty: g,
                                                              rootData: d,
                                                              dynamicAnchors: y,
                                                            }) ||
                                                              ((i =
                                                                i === null
                                                                  ? ge.errors
                                                                  : i.concat(ge.errors)),
                                                              (t = i.length));
                                                            var w = P === t;
                                                            if (!w) break;
                                                          }
                                                          if (w) {
                                                            let g = n.length,
                                                              P;
                                                            if (g > 1) {
                                                              e: for (; g--;)
                                                                for (P = g; P--;)
                                                                  if (Ye(n[g], n[P])) {
                                                                    return (
                                                                      (K.errors = [
                                                                        {
                                                                          instancePath:
                                                                            r + "/resourceBindings",
                                                                          schemaPath:
                                                                            "#/properties/resourceBindings/uniqueItems",
                                                                          keyword: "uniqueItems",
                                                                          params: { i: g, j: P },
                                                                        },
                                                                      ]),
                                                                      !1
                                                                    );
                                                                    break e;
                                                                  }
                                                            }
                                                          }
                                                        }
                                                      } else
                                                        return (
                                                          (K.errors = [
                                                            {
                                                              instancePath: r + "/resourceBindings",
                                                              schemaPath:
                                                                "#/properties/resourceBindings/type",
                                                              keyword: "type",
                                                              params: { type: "array" },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                    var s = p === t;
                                                  } else var s = !0;
                                                  if (s)
                                                    if (e.recipients !== void 0) {
                                                      let n = e.recipients,
                                                        p = t;
                                                      if (t === p)
                                                        if (Array.isArray(n)) {
                                                          if (n.length > 8)
                                                            return (
                                                              (K.errors = [
                                                                {
                                                                  instancePath: r + "/recipients",
                                                                  schemaPath:
                                                                    "#/properties/recipients/maxItems",
                                                                  keyword: "maxItems",
                                                                  params: { limit: 8 },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          if (n.length < 1)
                                                            return (
                                                              (K.errors = [
                                                                {
                                                                  instancePath: r + "/recipients",
                                                                  schemaPath:
                                                                    "#/properties/recipients/minItems",
                                                                  keyword: "minItems",
                                                                  params: { limit: 1 },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          {
                                                            var c = !0;
                                                            let v = n.length;
                                                            for (let g = 0; g < v; g++) {
                                                              let P = t;
                                                              C(n[g], {
                                                                instancePath:
                                                                  r + "/recipients/" + g,
                                                                parentData: n,
                                                                parentDataProperty: g,
                                                                rootData: d,
                                                                dynamicAnchors: y,
                                                              }) ||
                                                                ((i =
                                                                  i === null
                                                                    ? C.errors
                                                                    : i.concat(C.errors)),
                                                                (t = i.length));
                                                              var c = P === t;
                                                              if (!c) break;
                                                            }
                                                            if (c) {
                                                              let g = n.length,
                                                                P;
                                                              if (g > 1) {
                                                                e: for (; g--;)
                                                                  for (P = g; P--;)
                                                                    if (Ye(n[g], n[P])) {
                                                                      return (
                                                                        (K.errors = [
                                                                          {
                                                                            instancePath:
                                                                              r + "/recipients",
                                                                            schemaPath:
                                                                              "#/properties/recipients/uniqueItems",
                                                                            keyword: "uniqueItems",
                                                                            params: { i: g, j: P },
                                                                          },
                                                                        ]),
                                                                        !1
                                                                      );
                                                                      break e;
                                                                    }
                                                              }
                                                            }
                                                          }
                                                        } else
                                                          return (
                                                            (K.errors = [
                                                              {
                                                                instancePath: r + "/recipients",
                                                                schemaPath:
                                                                  "#/properties/recipients/type",
                                                                keyword: "type",
                                                                params: { type: "array" },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                      var s = p === t;
                                                    } else var s = !0;
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (K.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((K.errors = i), t === 0);
  }
  K.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ce(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ce.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.header === void 0 && (w = "header")) ||
          (e.encrypted_key === void 0 && (w = "encrypted_key"))
        )
          return (
            (ce.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(a === "header" || a === "encrypted_key")) {
              return (
                (ce.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.header !== void 0) {
              let a = e.header,
                o = t;
              if (t === o)
                if (a && typeof a == "object" && !Array.isArray(a)) {
                  let n;
                  if ((a.kid === void 0 && (n = "kid")) || (a.epk === void 0 && (n = "epk")))
                    return (
                      (ce.errors = [
                        {
                          instancePath: r + "/header",
                          schemaPath: "#/properties/header/required",
                          keyword: "required",
                          params: { missingProperty: n },
                        },
                      ]),
                      !1
                    );
                  {
                    let p = t;
                    for (let h in a)
                      if (!(h === "kid" || h === "epk")) {
                        return (
                          (ce.errors = [
                            {
                              instancePath: r + "/header",
                              schemaPath: "#/properties/header/additionalProperties",
                              keyword: "additionalProperties",
                              params: { additionalProperty: h },
                            },
                          ]),
                          !1
                        );
                        break;
                      }
                    if (p === t) {
                      if (a.kid !== void 0) {
                        let h = a.kid,
                          v = t;
                        if (t === v)
                          if (typeof h == "string") {
                            if (k(h) > 43)
                              return (
                                (ce.errors = [
                                  {
                                    instancePath: r + "/header/kid",
                                    schemaPath: "#/properties/header/properties/kid/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 43 },
                                  },
                                ]),
                                !1
                              );
                            if (k(h) < 43)
                              return (
                                (ce.errors = [
                                  {
                                    instancePath: r + "/header/kid",
                                    schemaPath: "#/properties/header/properties/kid/minLength",
                                    keyword: "minLength",
                                    params: { limit: 43 },
                                  },
                                ]),
                                !1
                              );
                            if (!ue.test(h))
                              return (
                                (ce.errors = [
                                  {
                                    instancePath: r + "/header/kid",
                                    schemaPath: "#/properties/header/properties/kid/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (ce.errors = [
                                {
                                  instancePath: r + "/header/kid",
                                  schemaPath: "#/properties/header/properties/kid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var s = v === t;
                      } else var s = !0;
                      if (s)
                        if (a.epk !== void 0) {
                          let h = t;
                          ne(a.epk, {
                            instancePath: r + "/header/epk",
                            parentData: a,
                            parentDataProperty: "epk",
                            rootData: d,
                            dynamicAnchors: y,
                          }) ||
                            ((i = i === null ? ne.errors : i.concat(ne.errors)), (t = i.length));
                          var s = h === t;
                        } else var s = !0;
                    }
                  }
                } else
                  return (
                    (ce.errors = [
                      {
                        instancePath: r + "/header",
                        schemaPath: "#/properties/header/type",
                        keyword: "type",
                        params: { type: "object" },
                      },
                    ]),
                    !1
                  );
              var u = o === t;
            } else var u = !0;
            if (u)
              if (e.encrypted_key !== void 0) {
                let a = e.encrypted_key,
                  o = t;
                if (t === o)
                  if (typeof a == "string") {
                    if (k(a) > 54)
                      return (
                        (ce.errors = [
                          {
                            instancePath: r + "/encrypted_key",
                            schemaPath: "#/properties/encrypted_key/maxLength",
                            keyword: "maxLength",
                            params: { limit: 54 },
                          },
                        ]),
                        !1
                      );
                    if (k(a) < 54)
                      return (
                        (ce.errors = [
                          {
                            instancePath: r + "/encrypted_key",
                            schemaPath: "#/properties/encrypted_key/minLength",
                            keyword: "minLength",
                            params: { limit: 54 },
                          },
                        ]),
                        !1
                      );
                    if (!Ke.test(a))
                      return (
                        (ce.errors = [
                          {
                            instancePath: r + "/encrypted_key",
                            schemaPath: "#/properties/encrypted_key/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9_-]+$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (ce.errors = [
                        {
                          instancePath: r + "/encrypted_key",
                          schemaPath: "#/properties/encrypted_key/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var u = o === t;
              } else var u = !0;
          }
        }
      } else
        return (
          (ce.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ce.errors = i), t === 0);
  }
  ce.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Z(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Z.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.protected === void 0 && (w = "protected")) ||
          (e.recipients === void 0 && (w = "recipients")) ||
          (e.iv === void 0 && (w = "iv")) ||
          (e.ciphertext === void 0 && (w = "ciphertext")) ||
          (e.tag === void 0 && (w = "tag")) ||
          (e.aad === void 0 && (w = "aad"))
        )
          return (
            (Z.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(
              a === "protected" ||
              a === "recipients" ||
              a === "iv" ||
              a === "ciphertext" ||
              a === "tag" ||
              a === "aad"
            )) {
              return (
                (Z.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.protected !== void 0) {
              let a = e.protected,
                o = t;
              if (t === o)
                if (typeof a == "string") {
                  if (k(a) > 1024)
                    return (
                      (Z.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/maxLength",
                          keyword: "maxLength",
                          params: { limit: 1024 },
                        },
                      ]),
                      !1
                    );
                  if (k(a) < 1)
                    return (
                      (Z.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!Ke.test(a))
                    return (
                      (Z.errors = [
                        {
                          instancePath: r + "/protected",
                          schemaPath: "#/properties/protected/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9_-]+$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (Z.errors = [
                      {
                        instancePath: r + "/protected",
                        schemaPath: "#/properties/protected/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = o === t;
            } else var s = !0;
            if (s) {
              if (e.recipients !== void 0) {
                let a = e.recipients,
                  o = t;
                if (t === o)
                  if (Array.isArray(a)) {
                    if (a.length > 8)
                      return (
                        (Z.errors = [
                          {
                            instancePath: r + "/recipients",
                            schemaPath: "#/properties/recipients/maxItems",
                            keyword: "maxItems",
                            params: { limit: 8 },
                          },
                        ]),
                        !1
                      );
                    if (a.length < 1)
                      return (
                        (Z.errors = [
                          {
                            instancePath: r + "/recipients",
                            schemaPath: "#/properties/recipients/minItems",
                            keyword: "minItems",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    {
                      var u = !0;
                      let p = a.length;
                      for (let h = 0; h < p; h++) {
                        let v = t;
                        ce(a[h], {
                          instancePath: r + "/recipients/" + h,
                          parentData: a,
                          parentDataProperty: h,
                          rootData: d,
                          dynamicAnchors: y,
                        }) || ((i = i === null ? ce.errors : i.concat(ce.errors)), (t = i.length));
                        var u = v === t;
                        if (!u) break;
                      }
                    }
                  } else
                    return (
                      (Z.errors = [
                        {
                          instancePath: r + "/recipients",
                          schemaPath: "#/properties/recipients/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ]),
                      !1
                    );
                var s = o === t;
              } else var s = !0;
              if (s) {
                if (e.iv !== void 0) {
                  let a = e.iv,
                    o = t;
                  if (t === o)
                    if (typeof a == "string") {
                      if (k(a) > 16)
                        return (
                          (Z.errors = [
                            {
                              instancePath: r + "/iv",
                              schemaPath: "#/properties/iv/maxLength",
                              keyword: "maxLength",
                              params: { limit: 16 },
                            },
                          ]),
                          !1
                        );
                      if (k(a) < 16)
                        return (
                          (Z.errors = [
                            {
                              instancePath: r + "/iv",
                              schemaPath: "#/properties/iv/minLength",
                              keyword: "minLength",
                              params: { limit: 16 },
                            },
                          ]),
                          !1
                        );
                      if (!Ke.test(a))
                        return (
                          (Z.errors = [
                            {
                              instancePath: r + "/iv",
                              schemaPath: "#/properties/iv/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9_-]+$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (Z.errors = [
                          {
                            instancePath: r + "/iv",
                            schemaPath: "#/properties/iv/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = o === t;
                } else var s = !0;
                if (s) {
                  if (e.ciphertext !== void 0) {
                    let a = e.ciphertext,
                      o = t;
                    if (t === o)
                      if (typeof a == "string") {
                        if (k(a) > 262144)
                          return (
                            (Z.errors = [
                              {
                                instancePath: r + "/ciphertext",
                                schemaPath: "#/properties/ciphertext/maxLength",
                                keyword: "maxLength",
                                params: { limit: 262144 },
                              },
                            ]),
                            !1
                          );
                        if (k(a) < 1)
                          return (
                            (Z.errors = [
                              {
                                instancePath: r + "/ciphertext",
                                schemaPath: "#/properties/ciphertext/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!Ke.test(a))
                          return (
                            (Z.errors = [
                              {
                                instancePath: r + "/ciphertext",
                                schemaPath: "#/properties/ciphertext/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9_-]+$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (Z.errors = [
                            {
                              instancePath: r + "/ciphertext",
                              schemaPath: "#/properties/ciphertext/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = o === t;
                  } else var s = !0;
                  if (s) {
                    if (e.tag !== void 0) {
                      let a = e.tag,
                        o = t;
                      if (t === o)
                        if (typeof a == "string") {
                          if (k(a) > 22)
                            return (
                              (Z.errors = [
                                {
                                  instancePath: r + "/tag",
                                  schemaPath: "#/properties/tag/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 22 },
                                },
                              ]),
                              !1
                            );
                          if (k(a) < 22)
                            return (
                              (Z.errors = [
                                {
                                  instancePath: r + "/tag",
                                  schemaPath: "#/properties/tag/minLength",
                                  keyword: "minLength",
                                  params: { limit: 22 },
                                },
                              ]),
                              !1
                            );
                          if (!Ke.test(a))
                            return (
                              (Z.errors = [
                                {
                                  instancePath: r + "/tag",
                                  schemaPath: "#/properties/tag/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9_-]+$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (Z.errors = [
                              {
                                instancePath: r + "/tag",
                                schemaPath: "#/properties/tag/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = o === t;
                    } else var s = !0;
                    if (s)
                      if (e.aad !== void 0) {
                        let a = e.aad,
                          o = t;
                        if (t === o)
                          if (typeof a == "string") {
                            if (k(a) > 21846)
                              return (
                                (Z.errors = [
                                  {
                                    instancePath: r + "/aad",
                                    schemaPath: "#/properties/aad/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 21846 },
                                  },
                                ]),
                                !1
                              );
                            if (k(a) < 1)
                              return (
                                (Z.errors = [
                                  {
                                    instancePath: r + "/aad",
                                    schemaPath: "#/properties/aad/minLength",
                                    keyword: "minLength",
                                    params: { limit: 1 },
                                  },
                                ]),
                                !1
                              );
                            if (!Ke.test(a))
                              return (
                                (Z.errors = [
                                  {
                                    instancePath: r + "/aad",
                                    schemaPath: "#/properties/aad/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[A-Za-z0-9_-]+$" },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (Z.errors = [
                                {
                                  instancePath: r + "/aad",
                                  schemaPath: "#/properties/aad/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var s = o === t;
                      } else var s = !0;
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (Z.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Z.errors = i), t === 0);
  }
  Z.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function We(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = We.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if ((e.context === void 0 && (u = "context")) || (e.jwe === void 0 && (u = "jwe")))
          return (
            (We.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "context" || c === "jwe")) {
              return (
                (We.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.context !== void 0) {
              let c = t;
              K(e.context, {
                instancePath: r + "/context",
                parentData: e,
                parentDataProperty: "context",
                rootData: d,
                dynamicAnchors: y,
              }) || ((i = i === null ? K.errors : i.concat(K.errors)), (t = i.length));
              var s = c === t;
            } else var s = !0;
            if (s)
              if (e.jwe !== void 0) {
                let c = t;
                Z(e.jwe, {
                  instancePath: r + "/jwe",
                  parentData: e,
                  parentDataProperty: "jwe",
                  rootData: d,
                  dynamicAnchors: y,
                }) || ((i = i === null ? Z.errors : i.concat(Z.errors)), (t = i.length));
                var s = c === t;
              } else var s = !0;
          }
        }
      } else
        return (
          (We.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((We.errors = i), t === 0);
  }
  We.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function pt(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = pt.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      We(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? We.errors : i.concat(We.errors)), (t = i.length)),
      (pt.errors = i),
      t === 0
    );
  }
  pt.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.Context = lt;
  function O(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = O.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let a;
        if (
          (e.contractVersion === void 0 && (a = "contractVersion")) ||
          (e.profileId === void 0 && (a = "profileId")) ||
          (e.ownerSubject === void 0 && (a = "ownerSubject")) ||
          (e.vaultId === void 0 && (a = "vaultId")) ||
          (e.rootKeyId === void 0 && (a = "rootKeyId")) ||
          (e.rootEpoch === void 0 && (a = "rootEpoch")) ||
          (e.registrySequence === void 0 && (a = "registrySequence")) ||
          (e.checkpointDigest === void 0 && (a = "checkpointDigest")) ||
          (e.keyEpoch === void 0 && (a = "keyEpoch")) ||
          (e.objectId === void 0 && (a = "objectId")) ||
          (e.objectType === void 0 && (a = "objectType")) ||
          (e.revision === void 0 && (a = "revision")) ||
          (e.deliveryRevision === void 0 && (a = "deliveryRevision")) ||
          (e.priorEnvelopeFingerprint === void 0 && (a = "priorEnvelopeFingerprint")) ||
          (e.expectedRevision === void 0 && (a = "expectedRevision")) ||
          (e.stableOperationId === void 0 && (a = "stableOperationId")) ||
          (e.operationType === void 0 && (a = "operationType")) ||
          (e.authorSigningKeyId === void 0 && (a = "authorSigningKeyId")) ||
          (e.binding === void 0 && (a = "binding")) ||
          (e.resourceBindings === void 0 && (a = "resourceBindings")) ||
          (e.recipients === void 0 && (a = "recipients"))
        )
          return (
            (O.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: a },
              },
            ]),
            !1
          );
        {
          let o = t;
          for (let n in e)
            if (!Qe.call(ur.properties, n)) {
              return (
                (O.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: n },
                  },
                ]),
                !1
              );
              break;
            }
          if (o === t) {
            if (e.contractVersion !== void 0) {
              let n = t;
              if (e.contractVersion !== "folioview.agent-workspace.v2.0")
                return (
                  (O.errors = [
                    {
                      instancePath: r + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.agent-workspace.v2.0" },
                    },
                  ]),
                  !1
                );
              var s = n === t;
            } else var s = !0;
            if (s) {
              if (e.profileId !== void 0) {
                let n = t;
                if (e.profileId !== "P1")
                  return (
                    (O.errors = [
                      {
                        instancePath: r + "/profileId",
                        schemaPath: "#/properties/profileId/const",
                        keyword: "const",
                        params: { allowedValue: "P1" },
                      },
                    ]),
                    !1
                  );
                var s = n === t;
              } else var s = !0;
              if (s) {
                if (e.ownerSubject !== void 0) {
                  let n = e.ownerSubject,
                    p = t;
                  if (t === p)
                    if (typeof n == "string") {
                      if (k(n) > 128)
                        return (
                          (O.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (k(n) < 1)
                        return (
                          (O.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!q.test(n))
                        return (
                          (O.errors = [
                            {
                              instancePath: r + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (O.errors = [
                          {
                            instancePath: r + "/ownerSubject",
                            schemaPath: "#/properties/ownerSubject/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = p === t;
                } else var s = !0;
                if (s) {
                  if (e.vaultId !== void 0) {
                    let n = e.vaultId,
                      p = t;
                    if (t === p)
                      if (typeof n == "string") {
                        if (k(n) > 128)
                          return (
                            (O.errors = [
                              {
                                instancePath: r + "/vaultId",
                                schemaPath: "#/properties/vaultId/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (k(n) < 1)
                          return (
                            (O.errors = [
                              {
                                instancePath: r + "/vaultId",
                                schemaPath: "#/properties/vaultId/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!q.test(n))
                          return (
                            (O.errors = [
                              {
                                instancePath: r + "/vaultId",
                                schemaPath: "#/properties/vaultId/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (O.errors = [
                            {
                              instancePath: r + "/vaultId",
                              schemaPath: "#/properties/vaultId/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = p === t;
                  } else var s = !0;
                  if (s) {
                    if (e.rootKeyId !== void 0) {
                      let n = e.rootKeyId,
                        p = t;
                      if (t === p)
                        if (typeof n == "string") {
                          if (k(n) > 43)
                            return (
                              (O.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 43 },
                                },
                              ]),
                              !1
                            );
                          if (k(n) < 43)
                            return (
                              (O.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/minLength",
                                  keyword: "minLength",
                                  params: { limit: 43 },
                                },
                              ]),
                              !1
                            );
                          if (!ue.test(n))
                            return (
                              (O.errors = [
                                {
                                  instancePath: r + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (O.errors = [
                              {
                                instancePath: r + "/rootKeyId",
                                schemaPath: "#/properties/rootKeyId/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = p === t;
                    } else var s = !0;
                    if (s) {
                      if (e.rootEpoch !== void 0) {
                        let n = e.rootEpoch,
                          p = t;
                        if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                          return (
                            (O.errors = [
                              {
                                instancePath: r + "/rootEpoch",
                                schemaPath: "#/properties/rootEpoch/type",
                                keyword: "type",
                                params: { type: "integer" },
                              },
                            ]),
                            !1
                          );
                        if (t === p && typeof n == "number") {
                          if (n > 9007199254740991 || isNaN(n))
                            return (
                              (O.errors = [
                                {
                                  instancePath: r + "/rootEpoch",
                                  schemaPath: "#/properties/rootEpoch/maximum",
                                  keyword: "maximum",
                                  params: { comparison: "<=", limit: 9007199254740991 },
                                },
                              ]),
                              !1
                            );
                          if (n < 1 || isNaN(n))
                            return (
                              (O.errors = [
                                {
                                  instancePath: r + "/rootEpoch",
                                  schemaPath: "#/properties/rootEpoch/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ]),
                              !1
                            );
                        }
                        var s = p === t;
                      } else var s = !0;
                      if (s) {
                        if (e.registrySequence !== void 0) {
                          let n = e.registrySequence,
                            p = t;
                          if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                            return (
                              (O.errors = [
                                {
                                  instancePath: r + "/registrySequence",
                                  schemaPath: "#/properties/registrySequence/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                },
                              ]),
                              !1
                            );
                          if (t === p && typeof n == "number") {
                            if (n > 9007199254740991 || isNaN(n))
                              return (
                                (O.errors = [
                                  {
                                    instancePath: r + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  },
                                ]),
                                !1
                              );
                            if (n < 1 || isNaN(n))
                              return (
                                (O.errors = [
                                  {
                                    instancePath: r + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  },
                                ]),
                                !1
                              );
                          }
                          var s = p === t;
                        } else var s = !0;
                        if (s) {
                          if (e.checkpointDigest !== void 0) {
                            let n = e.checkpointDigest,
                              p = t;
                            if (t === p)
                              if (typeof n == "string") {
                                if (k(n) > 64)
                                  return (
                                    (O.errors = [
                                      {
                                        instancePath: r + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/maxLength",
                                        keyword: "maxLength",
                                        params: { limit: 64 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (k(n) < 64)
                                  return (
                                    (O.errors = [
                                      {
                                        instancePath: r + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/minLength",
                                        keyword: "minLength",
                                        params: { limit: 64 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (!qe.test(n))
                                  return (
                                    (O.errors = [
                                      {
                                        instancePath: r + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/pattern",
                                        keyword: "pattern",
                                        params: { pattern: "^[a-f0-9]{64}$" },
                                      },
                                    ]),
                                    !1
                                  );
                              } else
                                return (
                                  (O.errors = [
                                    {
                                      instancePath: r + "/checkpointDigest",
                                      schemaPath: "#/properties/checkpointDigest/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                    },
                                  ]),
                                  !1
                                );
                            var s = p === t;
                          } else var s = !0;
                          if (s) {
                            if (e.keyEpoch !== void 0) {
                              let n = e.keyEpoch,
                                p = t;
                              if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                                return (
                                  (O.errors = [
                                    {
                                      instancePath: r + "/keyEpoch",
                                      schemaPath: "#/properties/keyEpoch/type",
                                      keyword: "type",
                                      params: { type: "integer" },
                                    },
                                  ]),
                                  !1
                                );
                              if (t === p && typeof n == "number") {
                                if (n > 9007199254740991 || isNaN(n))
                                  return (
                                    (O.errors = [
                                      {
                                        instancePath: r + "/keyEpoch",
                                        schemaPath: "#/properties/keyEpoch/maximum",
                                        keyword: "maximum",
                                        params: { comparison: "<=", limit: 9007199254740991 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (n < 1 || isNaN(n))
                                  return (
                                    (O.errors = [
                                      {
                                        instancePath: r + "/keyEpoch",
                                        schemaPath: "#/properties/keyEpoch/minimum",
                                        keyword: "minimum",
                                        params: { comparison: ">=", limit: 1 },
                                      },
                                    ]),
                                    !1
                                  );
                              }
                              var s = p === t;
                            } else var s = !0;
                            if (s) {
                              if (e.objectId !== void 0) {
                                let n = e.objectId,
                                  p = t;
                                if (t === p)
                                  if (typeof n == "string") {
                                    if (k(n) > 128)
                                      return (
                                        (O.errors = [
                                          {
                                            instancePath: r + "/objectId",
                                            schemaPath: "#/properties/objectId/maxLength",
                                            keyword: "maxLength",
                                            params: { limit: 128 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (k(n) < 1)
                                      return (
                                        (O.errors = [
                                          {
                                            instancePath: r + "/objectId",
                                            schemaPath: "#/properties/objectId/minLength",
                                            keyword: "minLength",
                                            params: { limit: 1 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (!q.test(n))
                                      return (
                                        (O.errors = [
                                          {
                                            instancePath: r + "/objectId",
                                            schemaPath: "#/properties/objectId/pattern",
                                            keyword: "pattern",
                                            params: {
                                              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
                                            },
                                          },
                                        ]),
                                        !1
                                      );
                                  } else
                                    return (
                                      (O.errors = [
                                        {
                                          instancePath: r + "/objectId",
                                          schemaPath: "#/properties/objectId/type",
                                          keyword: "type",
                                          params: { type: "string" },
                                        },
                                      ]),
                                      !1
                                    );
                                var s = p === t;
                              } else var s = !0;
                              if (s) {
                                if (e.objectType !== void 0) {
                                  let n = e.objectType,
                                    p = t;
                                  if (!(
                                    n === "task" ||
                                    n === "holdings_snapshot" ||
                                    n === "watchlist_evidence" ||
                                    n === "channel_follows_evidence" ||
                                    n === "result_revision"
                                  ))
                                    return (
                                      (O.errors = [
                                        {
                                          instancePath: r + "/objectType",
                                          schemaPath: "#/properties/objectType/enum",
                                          keyword: "enum",
                                          params: { allowedValues: ur.properties.objectType.enum },
                                        },
                                      ]),
                                      !1
                                    );
                                  var s = p === t;
                                } else var s = !0;
                                if (s) {
                                  if (e.revision !== void 0) {
                                    let n = e.revision,
                                      p = t;
                                    if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                                      return (
                                        (O.errors = [
                                          {
                                            instancePath: r + "/revision",
                                            schemaPath: "#/properties/revision/type",
                                            keyword: "type",
                                            params: { type: "integer" },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (t === p && typeof n == "number") {
                                      if (n > 9007199254740991 || isNaN(n))
                                        return (
                                          (O.errors = [
                                            {
                                              instancePath: r + "/revision",
                                              schemaPath: "#/properties/revision/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (n < 1 || isNaN(n))
                                        return (
                                          (O.errors = [
                                            {
                                              instancePath: r + "/revision",
                                              schemaPath: "#/properties/revision/minimum",
                                              keyword: "minimum",
                                              params: { comparison: ">=", limit: 1 },
                                            },
                                          ]),
                                          !1
                                        );
                                    }
                                    var s = p === t;
                                  } else var s = !0;
                                  if (s) {
                                    if (e.deliveryRevision !== void 0) {
                                      let n = e.deliveryRevision,
                                        p = t;
                                      if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                                        return (
                                          (O.errors = [
                                            {
                                              instancePath: r + "/deliveryRevision",
                                              schemaPath: "#/properties/deliveryRevision/type",
                                              keyword: "type",
                                              params: { type: "integer" },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (t === p && typeof n == "number") {
                                        if (n > 9007199254740991 || isNaN(n))
                                          return (
                                            (O.errors = [
                                              {
                                                instancePath: r + "/deliveryRevision",
                                                schemaPath: "#/properties/deliveryRevision/maximum",
                                                keyword: "maximum",
                                                params: {
                                                  comparison: "<=",
                                                  limit: 9007199254740991,
                                                },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (n < 1 || isNaN(n))
                                          return (
                                            (O.errors = [
                                              {
                                                instancePath: r + "/deliveryRevision",
                                                schemaPath: "#/properties/deliveryRevision/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 1 },
                                              },
                                            ]),
                                            !1
                                          );
                                      }
                                      var s = p === t;
                                    } else var s = !0;
                                    if (s) {
                                      if (e.priorEnvelopeFingerprint !== void 0) {
                                        let n = e.priorEnvelopeFingerprint,
                                          p = t,
                                          h = t,
                                          v = !1,
                                          g = t;
                                        if (t === g)
                                          if (typeof n == "string") {
                                            if (k(n) > 64) {
                                              let A = {
                                                instancePath: r + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/maxLength",
                                                keyword: "maxLength",
                                                params: { limit: 64 },
                                              };
                                              (i === null ? (i = [A]) : i.push(A), t++);
                                            } else if (k(n) < 64) {
                                              let A = {
                                                instancePath: r + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/minLength",
                                                keyword: "minLength",
                                                params: { limit: 64 },
                                              };
                                              (i === null ? (i = [A]) : i.push(A), t++);
                                            } else if (!qe.test(n)) {
                                              let A = {
                                                instancePath: r + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/pattern",
                                                keyword: "pattern",
                                                params: { pattern: "^[a-f0-9]{64}$" },
                                              };
                                              (i === null ? (i = [A]) : i.push(A), t++);
                                            }
                                          } else {
                                            let A = {
                                              instancePath: r + "/priorEnvelopeFingerprint",
                                              schemaPath:
                                                "#/properties/priorEnvelopeFingerprint/anyOf/0/type",
                                              keyword: "type",
                                              params: { type: "string" },
                                            };
                                            (i === null ? (i = [A]) : i.push(A), t++);
                                          }
                                        var u = g === t;
                                        v = v || u;
                                        let P = t;
                                        if (n !== null) {
                                          let A = {
                                            instancePath: r + "/priorEnvelopeFingerprint",
                                            schemaPath:
                                              "#/properties/priorEnvelopeFingerprint/anyOf/1/type",
                                            keyword: "type",
                                            params: { type: "null" },
                                          };
                                          (i === null ? (i = [A]) : i.push(A), t++);
                                        }
                                        var u = P === t;
                                        if (((v = v || u), v))
                                          ((t = h),
                                            i !== null && (h ? (i.length = h) : (i = null)));
                                        else {
                                          let A = {
                                            instancePath: r + "/priorEnvelopeFingerprint",
                                            schemaPath:
                                              "#/properties/priorEnvelopeFingerprint/anyOf",
                                            keyword: "anyOf",
                                            params: {},
                                          };
                                          return (
                                            i === null ? (i = [A]) : i.push(A),
                                            t++,
                                            (O.errors = i),
                                            !1
                                          );
                                        }
                                        var s = p === t;
                                      } else var s = !0;
                                      if (s) {
                                        if (e.expectedRevision !== void 0) {
                                          let n = e.expectedRevision,
                                            p = t;
                                          if (!(typeof n == "number" && !(n % 1) && !isNaN(n)))
                                            return (
                                              (O.errors = [
                                                {
                                                  instancePath: r + "/expectedRevision",
                                                  schemaPath: "#/properties/expectedRevision/type",
                                                  keyword: "type",
                                                  params: { type: "integer" },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (t === p && typeof n == "number") {
                                            if (n > 9007199254740991 || isNaN(n))
                                              return (
                                                (O.errors = [
                                                  {
                                                    instancePath: r + "/expectedRevision",
                                                    schemaPath:
                                                      "#/properties/expectedRevision/maximum",
                                                    keyword: "maximum",
                                                    params: {
                                                      comparison: "<=",
                                                      limit: 9007199254740991,
                                                    },
                                                  },
                                                ]),
                                                !1
                                              );
                                            if (n < 0 || isNaN(n))
                                              return (
                                                (O.errors = [
                                                  {
                                                    instancePath: r + "/expectedRevision",
                                                    schemaPath:
                                                      "#/properties/expectedRevision/minimum",
                                                    keyword: "minimum",
                                                    params: { comparison: ">=", limit: 0 },
                                                  },
                                                ]),
                                                !1
                                              );
                                          }
                                          var s = p === t;
                                        } else var s = !0;
                                        if (s) {
                                          if (e.stableOperationId !== void 0) {
                                            let n = t;
                                            je(e.stableOperationId, {
                                              instancePath: r + "/stableOperationId",
                                              parentData: e,
                                              parentDataProperty: "stableOperationId",
                                              rootData: d,
                                              dynamicAnchors: y,
                                            }) ||
                                              ((i = i === null ? je.errors : i.concat(je.errors)),
                                              (t = i.length));
                                            var s = n === t;
                                          } else var s = !0;
                                          if (s) {
                                            if (e.operationType !== void 0) {
                                              let n = e.operationType,
                                                p = t;
                                              if (!(
                                                n === "create_task" ||
                                                n === "update_task" ||
                                                n === "transition_task" ||
                                                n === "commit_snapshot" ||
                                                n === "commit_evidence" ||
                                                n === "submit_result" ||
                                                n === "revise_result" ||
                                                n === "reshare_delivery"
                                              ))
                                                return (
                                                  (O.errors = [
                                                    {
                                                      instancePath: r + "/operationType",
                                                      schemaPath: "#/properties/operationType/enum",
                                                      keyword: "enum",
                                                      params: {
                                                        allowedValues:
                                                          ur.properties.operationType.enum,
                                                      },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              var s = p === t;
                                            } else var s = !0;
                                            if (s) {
                                              if (e.authorSigningKeyId !== void 0) {
                                                let n = e.authorSigningKeyId,
                                                  p = t;
                                                if (t === p)
                                                  if (typeof n == "string") {
                                                    if (k(n) > 43)
                                                      return (
                                                        (O.errors = [
                                                          {
                                                            instancePath: r + "/authorSigningKeyId",
                                                            schemaPath:
                                                              "#/properties/authorSigningKeyId/maxLength",
                                                            keyword: "maxLength",
                                                            params: { limit: 43 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (k(n) < 43)
                                                      return (
                                                        (O.errors = [
                                                          {
                                                            instancePath: r + "/authorSigningKeyId",
                                                            schemaPath:
                                                              "#/properties/authorSigningKeyId/minLength",
                                                            keyword: "minLength",
                                                            params: { limit: 43 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (!ue.test(n))
                                                      return (
                                                        (O.errors = [
                                                          {
                                                            instancePath: r + "/authorSigningKeyId",
                                                            schemaPath:
                                                              "#/properties/authorSigningKeyId/pattern",
                                                            keyword: "pattern",
                                                            params: {
                                                              pattern: "^[A-Za-z0-9_-]{43}$",
                                                            },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                  } else
                                                    return (
                                                      (O.errors = [
                                                        {
                                                          instancePath: r + "/authorSigningKeyId",
                                                          schemaPath:
                                                            "#/properties/authorSigningKeyId/type",
                                                          keyword: "type",
                                                          params: { type: "string" },
                                                        },
                                                      ]),
                                                      !1
                                                    );
                                                var s = p === t;
                                              } else var s = !0;
                                              if (s) {
                                                if (e.binding !== void 0) {
                                                  let n = t;
                                                  H(e.binding, {
                                                    instancePath: r + "/binding",
                                                    parentData: e,
                                                    parentDataProperty: "binding",
                                                    rootData: d,
                                                    dynamicAnchors: y,
                                                  }) ||
                                                    ((i =
                                                      i === null ? H.errors : i.concat(H.errors)),
                                                    (t = i.length));
                                                  var s = n === t;
                                                } else var s = !0;
                                                if (s) {
                                                  if (e.resourceBindings !== void 0) {
                                                    let n = e.resourceBindings,
                                                      p = t;
                                                    if (t === p)
                                                      if (Array.isArray(n)) {
                                                        if (n.length > 10)
                                                          return (
                                                            (O.errors = [
                                                              {
                                                                instancePath:
                                                                  r + "/resourceBindings",
                                                                schemaPath:
                                                                  "#/properties/resourceBindings/maxItems",
                                                                keyword: "maxItems",
                                                                params: { limit: 10 },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                        if (n.length < 0)
                                                          return (
                                                            (O.errors = [
                                                              {
                                                                instancePath:
                                                                  r + "/resourceBindings",
                                                                schemaPath:
                                                                  "#/properties/resourceBindings/minItems",
                                                                keyword: "minItems",
                                                                params: { limit: 0 },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                        {
                                                          var w = !0;
                                                          let v = n.length;
                                                          for (let g = 0; g < v; g++) {
                                                            let P = t;
                                                            ge(n[g], {
                                                              instancePath:
                                                                r + "/resourceBindings/" + g,
                                                              parentData: n,
                                                              parentDataProperty: g,
                                                              rootData: d,
                                                              dynamicAnchors: y,
                                                            }) ||
                                                              ((i =
                                                                i === null
                                                                  ? ge.errors
                                                                  : i.concat(ge.errors)),
                                                              (t = i.length));
                                                            var w = P === t;
                                                            if (!w) break;
                                                          }
                                                          if (w) {
                                                            let g = n.length,
                                                              P;
                                                            if (g > 1) {
                                                              e: for (; g--;)
                                                                for (P = g; P--;)
                                                                  if (Ye(n[g], n[P])) {
                                                                    return (
                                                                      (O.errors = [
                                                                        {
                                                                          instancePath:
                                                                            r + "/resourceBindings",
                                                                          schemaPath:
                                                                            "#/properties/resourceBindings/uniqueItems",
                                                                          keyword: "uniqueItems",
                                                                          params: { i: g, j: P },
                                                                        },
                                                                      ]),
                                                                      !1
                                                                    );
                                                                    break e;
                                                                  }
                                                            }
                                                          }
                                                        }
                                                      } else
                                                        return (
                                                          (O.errors = [
                                                            {
                                                              instancePath: r + "/resourceBindings",
                                                              schemaPath:
                                                                "#/properties/resourceBindings/type",
                                                              keyword: "type",
                                                              params: { type: "array" },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                    var s = p === t;
                                                  } else var s = !0;
                                                  if (s)
                                                    if (e.recipients !== void 0) {
                                                      let n = e.recipients,
                                                        p = t;
                                                      if (t === p)
                                                        if (Array.isArray(n)) {
                                                          if (n.length > 8)
                                                            return (
                                                              (O.errors = [
                                                                {
                                                                  instancePath: r + "/recipients",
                                                                  schemaPath:
                                                                    "#/properties/recipients/maxItems",
                                                                  keyword: "maxItems",
                                                                  params: { limit: 8 },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          if (n.length < 1)
                                                            return (
                                                              (O.errors = [
                                                                {
                                                                  instancePath: r + "/recipients",
                                                                  schemaPath:
                                                                    "#/properties/recipients/minItems",
                                                                  keyword: "minItems",
                                                                  params: { limit: 1 },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          {
                                                            var c = !0;
                                                            let v = n.length;
                                                            for (let g = 0; g < v; g++) {
                                                              let P = t;
                                                              C(n[g], {
                                                                instancePath:
                                                                  r + "/recipients/" + g,
                                                                parentData: n,
                                                                parentDataProperty: g,
                                                                rootData: d,
                                                                dynamicAnchors: y,
                                                              }) ||
                                                                ((i =
                                                                  i === null
                                                                    ? C.errors
                                                                    : i.concat(C.errors)),
                                                                (t = i.length));
                                                              var c = P === t;
                                                              if (!c) break;
                                                            }
                                                            if (c) {
                                                              let g = n.length,
                                                                P;
                                                              if (g > 1) {
                                                                e: for (; g--;)
                                                                  for (P = g; P--;)
                                                                    if (Ye(n[g], n[P])) {
                                                                      return (
                                                                        (O.errors = [
                                                                          {
                                                                            instancePath:
                                                                              r + "/recipients",
                                                                            schemaPath:
                                                                              "#/properties/recipients/uniqueItems",
                                                                            keyword: "uniqueItems",
                                                                            params: { i: g, j: P },
                                                                          },
                                                                        ]),
                                                                        !1
                                                                      );
                                                                      break e;
                                                                    }
                                                              }
                                                            }
                                                          }
                                                        } else
                                                          return (
                                                            (O.errors = [
                                                              {
                                                                instancePath: r + "/recipients",
                                                                schemaPath:
                                                                  "#/properties/recipients/type",
                                                                keyword: "type",
                                                                params: { type: "array" },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                      var s = p === t;
                                                    } else var s = !0;
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (O.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((O.errors = i), t === 0);
  }
  O.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function lt(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = lt.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      O(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? O.errors : i.concat(O.errors)), (t = i.length)),
      (lt.errors = i),
      t === 0
    );
  }
  lt.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.TaskMetadata = ct;
  var Oi = {
      type: "object",
      properties: {
        contractVersion: { const: "folioview.agent-workspace.v2.0" },
        vaultId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        taskId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        taskVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        executionEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        status: { enum: ["active", "paused", "archived"] },
        resourceBindings: {
          type: "array",
          items: { $ref: "#/$defs/ResourceBindingMetadata" },
          minItems: 0,
          maxItems: 10,
          uniqueItems: !0,
        },
        objectRevision: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        deliveryRevision: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        envelopeFingerprint: {
          type: "string",
          minLength: 64,
          maxLength: 64,
          pattern: "^[a-f0-9]{64}$",
        },
        keyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        createdAt: {
          type: "string",
          minLength: 1,
          maxLength: 40,
          format: "date-time",
          pattern: "Z$",
        },
        updatedAt: {
          type: "string",
          minLength: 1,
          maxLength: 40,
          format: "date-time",
          pattern: "Z$",
        },
      },
      required: [
        "contractVersion",
        "vaultId",
        "taskId",
        "taskVersion",
        "executionEpoch",
        "status",
        "resourceBindings",
        "objectRevision",
        "deliveryRevision",
        "envelopeFingerprint",
        "keyEpoch",
        "createdAt",
        "updatedAt",
      ],
      additionalProperties: !1,
    },
    or = new RegExp("Z$", "u"),
    pr = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  function D(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = D.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.contractVersion === void 0 && (w = "contractVersion")) ||
          (e.vaultId === void 0 && (w = "vaultId")) ||
          (e.taskId === void 0 && (w = "taskId")) ||
          (e.taskVersion === void 0 && (w = "taskVersion")) ||
          (e.executionEpoch === void 0 && (w = "executionEpoch")) ||
          (e.status === void 0 && (w = "status")) ||
          (e.resourceBindings === void 0 && (w = "resourceBindings")) ||
          (e.objectRevision === void 0 && (w = "objectRevision")) ||
          (e.deliveryRevision === void 0 && (w = "deliveryRevision")) ||
          (e.envelopeFingerprint === void 0 && (w = "envelopeFingerprint")) ||
          (e.keyEpoch === void 0 && (w = "keyEpoch")) ||
          (e.createdAt === void 0 && (w = "createdAt")) ||
          (e.updatedAt === void 0 && (w = "updatedAt"))
        )
          return (
            (D.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!Qe.call(Oi.properties, a)) {
              return (
                (D.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.contractVersion !== void 0) {
              let a = t;
              if (e.contractVersion !== "folioview.agent-workspace.v2.0")
                return (
                  (D.errors = [
                    {
                      instancePath: r + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.agent-workspace.v2.0" },
                    },
                  ]),
                  !1
                );
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.vaultId !== void 0) {
                let a = e.vaultId,
                  o = t;
                if (t === o)
                  if (typeof a == "string") {
                    if (k(a) > 128)
                      return (
                        (D.errors = [
                          {
                            instancePath: r + "/vaultId",
                            schemaPath: "#/properties/vaultId/maxLength",
                            keyword: "maxLength",
                            params: { limit: 128 },
                          },
                        ]),
                        !1
                      );
                    if (k(a) < 1)
                      return (
                        (D.errors = [
                          {
                            instancePath: r + "/vaultId",
                            schemaPath: "#/properties/vaultId/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    if (!q.test(a))
                      return (
                        (D.errors = [
                          {
                            instancePath: r + "/vaultId",
                            schemaPath: "#/properties/vaultId/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (D.errors = [
                        {
                          instancePath: r + "/vaultId",
                          schemaPath: "#/properties/vaultId/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = o === t;
              } else var s = !0;
              if (s) {
                if (e.taskId !== void 0) {
                  let a = e.taskId,
                    o = t;
                  if (t === o)
                    if (typeof a == "string") {
                      if (k(a) > 128)
                        return (
                          (D.errors = [
                            {
                              instancePath: r + "/taskId",
                              schemaPath: "#/properties/taskId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (k(a) < 1)
                        return (
                          (D.errors = [
                            {
                              instancePath: r + "/taskId",
                              schemaPath: "#/properties/taskId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!q.test(a))
                        return (
                          (D.errors = [
                            {
                              instancePath: r + "/taskId",
                              schemaPath: "#/properties/taskId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (D.errors = [
                          {
                            instancePath: r + "/taskId",
                            schemaPath: "#/properties/taskId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = o === t;
                } else var s = !0;
                if (s) {
                  if (e.taskVersion !== void 0) {
                    let a = e.taskVersion,
                      o = t;
                    if (!(typeof a == "number" && !(a % 1) && !isNaN(a)))
                      return (
                        (D.errors = [
                          {
                            instancePath: r + "/taskVersion",
                            schemaPath: "#/properties/taskVersion/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ]),
                        !1
                      );
                    if (t === o && typeof a == "number") {
                      if (a > 9007199254740991 || isNaN(a))
                        return (
                          (D.errors = [
                            {
                              instancePath: r + "/taskVersion",
                              schemaPath: "#/properties/taskVersion/maximum",
                              keyword: "maximum",
                              params: { comparison: "<=", limit: 9007199254740991 },
                            },
                          ]),
                          !1
                        );
                      if (a < 1 || isNaN(a))
                        return (
                          (D.errors = [
                            {
                              instancePath: r + "/taskVersion",
                              schemaPath: "#/properties/taskVersion/minimum",
                              keyword: "minimum",
                              params: { comparison: ">=", limit: 1 },
                            },
                          ]),
                          !1
                        );
                    }
                    var s = o === t;
                  } else var s = !0;
                  if (s) {
                    if (e.executionEpoch !== void 0) {
                      let a = e.executionEpoch,
                        o = t;
                      if (!(typeof a == "number" && !(a % 1) && !isNaN(a)))
                        return (
                          (D.errors = [
                            {
                              instancePath: r + "/executionEpoch",
                              schemaPath: "#/properties/executionEpoch/type",
                              keyword: "type",
                              params: { type: "integer" },
                            },
                          ]),
                          !1
                        );
                      if (t === o && typeof a == "number") {
                        if (a > 9007199254740991 || isNaN(a))
                          return (
                            (D.errors = [
                              {
                                instancePath: r + "/executionEpoch",
                                schemaPath: "#/properties/executionEpoch/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 9007199254740991 },
                              },
                            ]),
                            !1
                          );
                        if (a < 1 || isNaN(a))
                          return (
                            (D.errors = [
                              {
                                instancePath: r + "/executionEpoch",
                                schemaPath: "#/properties/executionEpoch/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 1 },
                              },
                            ]),
                            !1
                          );
                      }
                      var s = o === t;
                    } else var s = !0;
                    if (s) {
                      if (e.status !== void 0) {
                        let a = e.status,
                          o = t;
                        if (!(a === "active" || a === "paused" || a === "archived"))
                          return (
                            (D.errors = [
                              {
                                instancePath: r + "/status",
                                schemaPath: "#/properties/status/enum",
                                keyword: "enum",
                                params: { allowedValues: Oi.properties.status.enum },
                              },
                            ]),
                            !1
                          );
                        var s = o === t;
                      } else var s = !0;
                      if (s) {
                        if (e.resourceBindings !== void 0) {
                          let a = e.resourceBindings,
                            o = t;
                          if (t === o)
                            if (Array.isArray(a)) {
                              if (a.length > 10)
                                return (
                                  (D.errors = [
                                    {
                                      instancePath: r + "/resourceBindings",
                                      schemaPath: "#/properties/resourceBindings/maxItems",
                                      keyword: "maxItems",
                                      params: { limit: 10 },
                                    },
                                  ]),
                                  !1
                                );
                              if (a.length < 0)
                                return (
                                  (D.errors = [
                                    {
                                      instancePath: r + "/resourceBindings",
                                      schemaPath: "#/properties/resourceBindings/minItems",
                                      keyword: "minItems",
                                      params: { limit: 0 },
                                    },
                                  ]),
                                  !1
                                );
                              {
                                var u = !0;
                                let p = a.length;
                                for (let h = 0; h < p; h++) {
                                  let v = t;
                                  ge(a[h], {
                                    instancePath: r + "/resourceBindings/" + h,
                                    parentData: a,
                                    parentDataProperty: h,
                                    rootData: d,
                                    dynamicAnchors: y,
                                  }) ||
                                    ((i = i === null ? ge.errors : i.concat(ge.errors)),
                                    (t = i.length));
                                  var u = v === t;
                                  if (!u) break;
                                }
                                if (u) {
                                  let h = a.length,
                                    v;
                                  if (h > 1) {
                                    e: for (; h--;)
                                      for (v = h; v--;)
                                        if (Ye(a[h], a[v])) {
                                          return (
                                            (D.errors = [
                                              {
                                                instancePath: r + "/resourceBindings",
                                                schemaPath:
                                                  "#/properties/resourceBindings/uniqueItems",
                                                keyword: "uniqueItems",
                                                params: { i: h, j: v },
                                              },
                                            ]),
                                            !1
                                          );
                                          break e;
                                        }
                                  }
                                }
                              }
                            } else
                              return (
                                (D.errors = [
                                  {
                                    instancePath: r + "/resourceBindings",
                                    schemaPath: "#/properties/resourceBindings/type",
                                    keyword: "type",
                                    params: { type: "array" },
                                  },
                                ]),
                                !1
                              );
                          var s = o === t;
                        } else var s = !0;
                        if (s) {
                          if (e.objectRevision !== void 0) {
                            let a = e.objectRevision,
                              o = t;
                            if (!(typeof a == "number" && !(a % 1) && !isNaN(a)))
                              return (
                                (D.errors = [
                                  {
                                    instancePath: r + "/objectRevision",
                                    schemaPath: "#/properties/objectRevision/type",
                                    keyword: "type",
                                    params: { type: "integer" },
                                  },
                                ]),
                                !1
                              );
                            if (t === o && typeof a == "number") {
                              if (a > 9007199254740991 || isNaN(a))
                                return (
                                  (D.errors = [
                                    {
                                      instancePath: r + "/objectRevision",
                                      schemaPath: "#/properties/objectRevision/maximum",
                                      keyword: "maximum",
                                      params: { comparison: "<=", limit: 9007199254740991 },
                                    },
                                  ]),
                                  !1
                                );
                              if (a < 1 || isNaN(a))
                                return (
                                  (D.errors = [
                                    {
                                      instancePath: r + "/objectRevision",
                                      schemaPath: "#/properties/objectRevision/minimum",
                                      keyword: "minimum",
                                      params: { comparison: ">=", limit: 1 },
                                    },
                                  ]),
                                  !1
                                );
                            }
                            var s = o === t;
                          } else var s = !0;
                          if (s) {
                            if (e.deliveryRevision !== void 0) {
                              let a = e.deliveryRevision,
                                o = t;
                              if (!(typeof a == "number" && !(a % 1) && !isNaN(a)))
                                return (
                                  (D.errors = [
                                    {
                                      instancePath: r + "/deliveryRevision",
                                      schemaPath: "#/properties/deliveryRevision/type",
                                      keyword: "type",
                                      params: { type: "integer" },
                                    },
                                  ]),
                                  !1
                                );
                              if (t === o && typeof a == "number") {
                                if (a > 9007199254740991 || isNaN(a))
                                  return (
                                    (D.errors = [
                                      {
                                        instancePath: r + "/deliveryRevision",
                                        schemaPath: "#/properties/deliveryRevision/maximum",
                                        keyword: "maximum",
                                        params: { comparison: "<=", limit: 9007199254740991 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (a < 1 || isNaN(a))
                                  return (
                                    (D.errors = [
                                      {
                                        instancePath: r + "/deliveryRevision",
                                        schemaPath: "#/properties/deliveryRevision/minimum",
                                        keyword: "minimum",
                                        params: { comparison: ">=", limit: 1 },
                                      },
                                    ]),
                                    !1
                                  );
                              }
                              var s = o === t;
                            } else var s = !0;
                            if (s) {
                              if (e.envelopeFingerprint !== void 0) {
                                let a = e.envelopeFingerprint,
                                  o = t;
                                if (t === o)
                                  if (typeof a == "string") {
                                    if (k(a) > 64)
                                      return (
                                        (D.errors = [
                                          {
                                            instancePath: r + "/envelopeFingerprint",
                                            schemaPath:
                                              "#/properties/envelopeFingerprint/maxLength",
                                            keyword: "maxLength",
                                            params: { limit: 64 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (k(a) < 64)
                                      return (
                                        (D.errors = [
                                          {
                                            instancePath: r + "/envelopeFingerprint",
                                            schemaPath:
                                              "#/properties/envelopeFingerprint/minLength",
                                            keyword: "minLength",
                                            params: { limit: 64 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (!qe.test(a))
                                      return (
                                        (D.errors = [
                                          {
                                            instancePath: r + "/envelopeFingerprint",
                                            schemaPath: "#/properties/envelopeFingerprint/pattern",
                                            keyword: "pattern",
                                            params: { pattern: "^[a-f0-9]{64}$" },
                                          },
                                        ]),
                                        !1
                                      );
                                  } else
                                    return (
                                      (D.errors = [
                                        {
                                          instancePath: r + "/envelopeFingerprint",
                                          schemaPath: "#/properties/envelopeFingerprint/type",
                                          keyword: "type",
                                          params: { type: "string" },
                                        },
                                      ]),
                                      !1
                                    );
                                var s = o === t;
                              } else var s = !0;
                              if (s) {
                                if (e.keyEpoch !== void 0) {
                                  let a = e.keyEpoch,
                                    o = t;
                                  if (!(typeof a == "number" && !(a % 1) && !isNaN(a)))
                                    return (
                                      (D.errors = [
                                        {
                                          instancePath: r + "/keyEpoch",
                                          schemaPath: "#/properties/keyEpoch/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (t === o && typeof a == "number") {
                                    if (a > 9007199254740991 || isNaN(a))
                                      return (
                                        (D.errors = [
                                          {
                                            instancePath: r + "/keyEpoch",
                                            schemaPath: "#/properties/keyEpoch/maximum",
                                            keyword: "maximum",
                                            params: { comparison: "<=", limit: 9007199254740991 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (a < 1 || isNaN(a))
                                      return (
                                        (D.errors = [
                                          {
                                            instancePath: r + "/keyEpoch",
                                            schemaPath: "#/properties/keyEpoch/minimum",
                                            keyword: "minimum",
                                            params: { comparison: ">=", limit: 1 },
                                          },
                                        ]),
                                        !1
                                      );
                                  }
                                  var s = o === t;
                                } else var s = !0;
                                if (s) {
                                  if (e.createdAt !== void 0) {
                                    let a = e.createdAt,
                                      o = t;
                                    if (t === o && t === o)
                                      if (typeof a == "string") {
                                        if (k(a) > 40)
                                          return (
                                            (D.errors = [
                                              {
                                                instancePath: r + "/createdAt",
                                                schemaPath: "#/properties/createdAt/maxLength",
                                                keyword: "maxLength",
                                                params: { limit: 40 },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (k(a) < 1)
                                          return (
                                            (D.errors = [
                                              {
                                                instancePath: r + "/createdAt",
                                                schemaPath: "#/properties/createdAt/minLength",
                                                keyword: "minLength",
                                                params: { limit: 1 },
                                              },
                                            ]),
                                            !1
                                          );
                                        if (or.test(a)) {
                                          if (!pr.test(a))
                                            return (
                                              (D.errors = [
                                                {
                                                  instancePath: r + "/createdAt",
                                                  schemaPath: "#/properties/createdAt/format",
                                                  keyword: "format",
                                                  params: { format: "date-time" },
                                                },
                                              ]),
                                              !1
                                            );
                                        } else
                                          return (
                                            (D.errors = [
                                              {
                                                instancePath: r + "/createdAt",
                                                schemaPath: "#/properties/createdAt/pattern",
                                                keyword: "pattern",
                                                params: { pattern: "Z$" },
                                              },
                                            ]),
                                            !1
                                          );
                                      } else
                                        return (
                                          (D.errors = [
                                            {
                                              instancePath: r + "/createdAt",
                                              schemaPath: "#/properties/createdAt/type",
                                              keyword: "type",
                                              params: { type: "string" },
                                            },
                                          ]),
                                          !1
                                        );
                                    var s = o === t;
                                  } else var s = !0;
                                  if (s)
                                    if (e.updatedAt !== void 0) {
                                      let a = e.updatedAt,
                                        o = t;
                                      if (t === o && t === o)
                                        if (typeof a == "string") {
                                          if (k(a) > 40)
                                            return (
                                              (D.errors = [
                                                {
                                                  instancePath: r + "/updatedAt",
                                                  schemaPath: "#/properties/updatedAt/maxLength",
                                                  keyword: "maxLength",
                                                  params: { limit: 40 },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (k(a) < 1)
                                            return (
                                              (D.errors = [
                                                {
                                                  instancePath: r + "/updatedAt",
                                                  schemaPath: "#/properties/updatedAt/minLength",
                                                  keyword: "minLength",
                                                  params: { limit: 1 },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (or.test(a)) {
                                            if (!pr.test(a))
                                              return (
                                                (D.errors = [
                                                  {
                                                    instancePath: r + "/updatedAt",
                                                    schemaPath: "#/properties/updatedAt/format",
                                                    keyword: "format",
                                                    params: { format: "date-time" },
                                                  },
                                                ]),
                                                !1
                                              );
                                          } else
                                            return (
                                              (D.errors = [
                                                {
                                                  instancePath: r + "/updatedAt",
                                                  schemaPath: "#/properties/updatedAt/pattern",
                                                  keyword: "pattern",
                                                  params: { pattern: "Z$" },
                                                },
                                              ]),
                                              !1
                                            );
                                        } else
                                          return (
                                            (D.errors = [
                                              {
                                                instancePath: r + "/updatedAt",
                                                schemaPath: "#/properties/updatedAt/type",
                                                keyword: "type",
                                                params: { type: "string" },
                                              },
                                            ]),
                                            !1
                                          );
                                      var s = o === t;
                                    } else var s = !0;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (D.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((D.errors = i), t === 0);
  }
  D.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ct(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ct.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      D(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? D.errors : i.concat(D.errors)), (t = i.length)),
      (ct.errors = i),
      t === 0
    );
  }
  ct.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Ae.PrivatePayload = ft;
  var $s = {
      type: "object",
      properties: {
        privateSchemaVersion: { const: 2 },
        objectId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        objectType: {
          enum: [
            "task",
            "holdings_snapshot",
            "watchlist_evidence",
            "channel_follows_evidence",
            "result_revision",
          ],
        },
        revision: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        binding: { $ref: "#/$defs/Binding" },
        payload: { type: "object" },
      },
      required: [
        "privateSchemaVersion",
        "objectId",
        "objectType",
        "revision",
        "binding",
        "payload",
      ],
      additionalProperties: !1,
      allOf: [
        {
          if: { properties: { objectType: { const: "task" } } },
          then: { properties: { payload: { $ref: "#/$defs/TaskContent" } } },
        },
        {
          if: { properties: { objectType: { const: "holdings_snapshot" } } },
          then: { properties: { payload: { $ref: "#/$defs/ResourceContent" } } },
        },
        {
          if: { properties: { objectType: { const: "watchlist_evidence" } } },
          then: { properties: { payload: { $ref: "#/$defs/ResourceContent" } } },
        },
        {
          if: { properties: { objectType: { const: "channel_follows_evidence" } } },
          then: { properties: { payload: { $ref: "#/$defs/ResourceContent" } } },
        },
        {
          if: { properties: { objectType: { const: "result_revision" } } },
          then: { properties: { payload: { $ref: "#/$defs/ResultContent" } } },
        },
      ],
    },
    Rs = {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        template: { type: "string", enum: ["brief", "custom"] },
        goal: { type: "string", minLength: 1, maxLength: 2e3 },
        inputPolicy: { $ref: "#/$defs/InputPolicy" },
        outputSpec: { $ref: "#/$defs/OutputSpec" },
        deliveryExpectation: { anyOf: [{ $ref: "#/$defs/DeliveryExpectation" }, { type: "null" }] },
      },
      required: ["name", "template", "goal", "inputPolicy", "outputSpec", "deliveryExpectation"],
      additionalProperties: !1,
    };
  function be(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = be.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.allowPartial === void 0 && (u = "allowPartial")) ||
          (e.allowUnknownAsOf === void 0 && (u = "allowUnknownAsOf")) ||
          (e.maxFetchedAgeSeconds === void 0 && (u = "maxFetchedAgeSeconds"))
        )
          return (
            (be.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(
              c === "allowPartial" ||
              c === "allowUnknownAsOf" ||
              c === "maxFetchedAgeSeconds"
            )) {
              return (
                (be.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.allowPartial !== void 0) {
              let c = t;
              if (typeof e.allowPartial != "boolean")
                return (
                  (be.errors = [
                    {
                      instancePath: r + "/allowPartial",
                      schemaPath: "#/properties/allowPartial/type",
                      keyword: "type",
                      params: { type: "boolean" },
                    },
                  ]),
                  !1
                );
              var s = c === t;
            } else var s = !0;
            if (s) {
              if (e.allowUnknownAsOf !== void 0) {
                let c = t;
                if (typeof e.allowUnknownAsOf != "boolean")
                  return (
                    (be.errors = [
                      {
                        instancePath: r + "/allowUnknownAsOf",
                        schemaPath: "#/properties/allowUnknownAsOf/type",
                        keyword: "type",
                        params: { type: "boolean" },
                      },
                    ]),
                    !1
                  );
                var s = c === t;
              } else var s = !0;
              if (s)
                if (e.maxFetchedAgeSeconds !== void 0) {
                  let c = e.maxFetchedAgeSeconds,
                    a = t;
                  if (!(typeof c == "number" && !(c % 1) && !isNaN(c)))
                    return (
                      (be.errors = [
                        {
                          instancePath: r + "/maxFetchedAgeSeconds",
                          schemaPath: "#/properties/maxFetchedAgeSeconds/type",
                          keyword: "type",
                          params: { type: "integer" },
                        },
                      ]),
                      !1
                    );
                  if (t === a && typeof c == "number") {
                    if (c > 604800 || isNaN(c))
                      return (
                        (be.errors = [
                          {
                            instancePath: r + "/maxFetchedAgeSeconds",
                            schemaPath: "#/properties/maxFetchedAgeSeconds/maximum",
                            keyword: "maximum",
                            params: { comparison: "<=", limit: 604800 },
                          },
                        ]),
                        !1
                      );
                    if (c < 60 || isNaN(c))
                      return (
                        (be.errors = [
                          {
                            instancePath: r + "/maxFetchedAgeSeconds",
                            schemaPath: "#/properties/maxFetchedAgeSeconds/minimum",
                            keyword: "minimum",
                            params: { comparison: ">=", limit: 60 },
                          },
                        ]),
                        !1
                      );
                  }
                  var s = a === t;
                } else var s = !0;
            }
          }
        }
      } else
        return (
          (be.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((be.errors = i), t === 0);
  }
  be.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Ni = {
    type: "object",
    properties: {
      label: { type: "string", minLength: 1, maxLength: 40 },
      sections: { type: "array", items: { $ref: "#/$defs/SectionSpec" }, minItems: 1, maxItems: 8 },
      language: { type: "string", enum: ["zh", "en"] },
      verbosity: { type: "string", enum: ["concise", "standard"] },
    },
    required: ["label", "sections", "language", "verbosity"],
    additionalProperties: !1,
  };
  function me(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = me.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.sectionId === void 0 && (u = "sectionId")) ||
          (e.title === void 0 && (u = "title")) ||
          (e.instructions === void 0 && (u = "instructions"))
        )
          return (
            (me.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "sectionId" || c === "title" || c === "instructions")) {
              return (
                (me.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.sectionId !== void 0) {
              let c = e.sectionId,
                a = t;
              if (t === a)
                if (typeof c == "string") {
                  if (k(c) > 128)
                    return (
                      (me.errors = [
                        {
                          instancePath: r + "/sectionId",
                          schemaPath: "#/properties/sectionId/maxLength",
                          keyword: "maxLength",
                          params: { limit: 128 },
                        },
                      ]),
                      !1
                    );
                  if (k(c) < 1)
                    return (
                      (me.errors = [
                        {
                          instancePath: r + "/sectionId",
                          schemaPath: "#/properties/sectionId/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!q.test(c))
                    return (
                      (me.errors = [
                        {
                          instancePath: r + "/sectionId",
                          schemaPath: "#/properties/sectionId/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (me.errors = [
                      {
                        instancePath: r + "/sectionId",
                        schemaPath: "#/properties/sectionId/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.title !== void 0) {
                let c = e.title,
                  a = t;
                if (t === a)
                  if (typeof c == "string") {
                    if (k(c) > 120)
                      return (
                        (me.errors = [
                          {
                            instancePath: r + "/title",
                            schemaPath: "#/properties/title/maxLength",
                            keyword: "maxLength",
                            params: { limit: 120 },
                          },
                        ]),
                        !1
                      );
                    if (k(c) < 1)
                      return (
                        (me.errors = [
                          {
                            instancePath: r + "/title",
                            schemaPath: "#/properties/title/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (me.errors = [
                        {
                          instancePath: r + "/title",
                          schemaPath: "#/properties/title/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = a === t;
              } else var s = !0;
              if (s)
                if (e.instructions !== void 0) {
                  let c = e.instructions,
                    a = t;
                  if (t === a)
                    if (typeof c == "string") {
                      if (k(c) > 1e3)
                        return (
                          (me.errors = [
                            {
                              instancePath: r + "/instructions",
                              schemaPath: "#/properties/instructions/maxLength",
                              keyword: "maxLength",
                              params: { limit: 1e3 },
                            },
                          ]),
                          !1
                        );
                      if (k(c) < 0)
                        return (
                          (me.errors = [
                            {
                              instancePath: r + "/instructions",
                              schemaPath: "#/properties/instructions/minLength",
                              keyword: "minLength",
                              params: { limit: 0 },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (me.errors = [
                          {
                            instancePath: r + "/instructions",
                            schemaPath: "#/properties/instructions/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = a === t;
                } else var s = !0;
            }
          }
        }
      } else
        return (
          (me.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((me.errors = i), t === 0);
  }
  me.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function de(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = de.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.label === void 0 && (w = "label")) ||
          (e.sections === void 0 && (w = "sections")) ||
          (e.language === void 0 && (w = "language")) ||
          (e.verbosity === void 0 && (w = "verbosity"))
        )
          return (
            (de.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(a === "label" || a === "sections" || a === "language" || a === "verbosity")) {
              return (
                (de.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.label !== void 0) {
              let a = e.label,
                o = t;
              if (t === o)
                if (typeof a == "string") {
                  if (k(a) > 40)
                    return (
                      (de.errors = [
                        {
                          instancePath: r + "/label",
                          schemaPath: "#/properties/label/maxLength",
                          keyword: "maxLength",
                          params: { limit: 40 },
                        },
                      ]),
                      !1
                    );
                  if (k(a) < 1)
                    return (
                      (de.errors = [
                        {
                          instancePath: r + "/label",
                          schemaPath: "#/properties/label/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (de.errors = [
                      {
                        instancePath: r + "/label",
                        schemaPath: "#/properties/label/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = o === t;
            } else var s = !0;
            if (s) {
              if (e.sections !== void 0) {
                let a = e.sections,
                  o = t;
                if (t === o)
                  if (Array.isArray(a)) {
                    if (a.length > 8)
                      return (
                        (de.errors = [
                          {
                            instancePath: r + "/sections",
                            schemaPath: "#/properties/sections/maxItems",
                            keyword: "maxItems",
                            params: { limit: 8 },
                          },
                        ]),
                        !1
                      );
                    if (a.length < 1)
                      return (
                        (de.errors = [
                          {
                            instancePath: r + "/sections",
                            schemaPath: "#/properties/sections/minItems",
                            keyword: "minItems",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    {
                      var u = !0;
                      let p = a.length;
                      for (let h = 0; h < p; h++) {
                        let v = t;
                        me(a[h], {
                          instancePath: r + "/sections/" + h,
                          parentData: a,
                          parentDataProperty: h,
                          rootData: d,
                          dynamicAnchors: y,
                        }) || ((i = i === null ? me.errors : i.concat(me.errors)), (t = i.length));
                        var u = v === t;
                        if (!u) break;
                      }
                    }
                  } else
                    return (
                      (de.errors = [
                        {
                          instancePath: r + "/sections",
                          schemaPath: "#/properties/sections/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ]),
                      !1
                    );
                var s = o === t;
              } else var s = !0;
              if (s) {
                if (e.language !== void 0) {
                  let a = e.language,
                    o = t;
                  if (typeof a != "string")
                    return (
                      (de.errors = [
                        {
                          instancePath: r + "/language",
                          schemaPath: "#/properties/language/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                  if (!(a === "zh" || a === "en"))
                    return (
                      (de.errors = [
                        {
                          instancePath: r + "/language",
                          schemaPath: "#/properties/language/enum",
                          keyword: "enum",
                          params: { allowedValues: Ni.properties.language.enum },
                        },
                      ]),
                      !1
                    );
                  var s = o === t;
                } else var s = !0;
                if (s)
                  if (e.verbosity !== void 0) {
                    let a = e.verbosity,
                      o = t;
                    if (typeof a != "string")
                      return (
                        (de.errors = [
                          {
                            instancePath: r + "/verbosity",
                            schemaPath: "#/properties/verbosity/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                    if (!(a === "concise" || a === "standard"))
                      return (
                        (de.errors = [
                          {
                            instancePath: r + "/verbosity",
                            schemaPath: "#/properties/verbosity/enum",
                            keyword: "enum",
                            params: { allowedValues: Ni.properties.verbosity.enum },
                          },
                        ]),
                        !1
                      );
                    var s = o === t;
                  } else var s = !0;
              }
            }
          }
        }
      } else
        return (
          (de.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((de.errors = i), t === 0);
  }
  de.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var zs = {
      type: "object",
      properties: {
        cadence: { type: "string", enum: ["daily", "weekdays", "weekly"] },
        localTime: {
          type: "string",
          minLength: 5,
          maxLength: 5,
          pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
        },
        timeZone: { type: "string", minLength: 1, maxLength: 80, format: "iana-timezone" },
        graceMinutes: { type: "integer", minimum: 0, maximum: 1440 },
        weekday: { type: "integer", minimum: 0, maximum: 6 },
      },
      required: ["cadence", "localTime", "timeZone", "graceMinutes"],
      additionalProperties: !1,
      allOf: [
        {
          if: { properties: { cadence: { const: "weekly" } } },
          then: { required: ["weekday"] },
          else: { not: { required: ["weekday"] } },
        },
      ],
    },
    Ts = new RegExp("^([01][0-9]|2[0-3]):[0-5][0-9]$", "u"),
    Vs = /^[A-Za-z0-9_+./-]{1,80}$/;
  function M(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = M.evaluated;
    (m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0));
    let s = t,
      u = !0,
      w = t;
    if (
      e &&
      typeof e == "object" &&
      !Array.isArray(e) &&
      e.cadence !== void 0 &&
      e.cadence !== "weekly"
    ) {
      let p = {};
      (i === null ? (i = [p]) : i.push(p), t++);
    }
    var c = w === t;
    ((t = s), i !== null && (s ? (i.length = s) : (i = null)));
    let a;
    if (c) {
      let p = t;
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (e.weekday === void 0 && (v = "weekday"))
          return (
            (M.errors = [
              {
                instancePath: r,
                schemaPath: "#/allOf/0/then/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
      }
      var c = p === t;
      ((u = c), (a = "then"));
    } else {
      let p = t,
        h = t,
        v = t;
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let P;
        if (e.weekday === void 0 && (P = "weekday")) {
          let b = {};
          (i === null ? (i = [b]) : i.push(b), t++);
        }
      }
      var o = v === t;
      if (o)
        return (
          (M.errors = [
            { instancePath: r, schemaPath: "#/allOf/0/else/not", keyword: "not", params: {} },
          ]),
          !1
        );
      ((t = h), i !== null && (h ? (i.length = h) : (i = null)));
      var c = p === t;
      ((u = c), (a = "else"));
    }
    if (!u) {
      let p = {
        instancePath: r,
        schemaPath: "#/allOf/0/if",
        keyword: "if",
        params: { failingKeyword: a },
      };
      return (i === null ? (i = [p]) : i.push(p), t++, (M.errors = i), !1);
    }
    if (t === 0)
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let p;
        if (
          (e.cadence === void 0 && (p = "cadence")) ||
          (e.localTime === void 0 && (p = "localTime")) ||
          (e.timeZone === void 0 && (p = "timeZone")) ||
          (e.graceMinutes === void 0 && (p = "graceMinutes"))
        )
          return (
            (M.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: p },
              },
            ]),
            !1
          );
        {
          let h = t;
          for (let v in e)
            if (!(
              v === "cadence" ||
              v === "localTime" ||
              v === "timeZone" ||
              v === "graceMinutes" ||
              v === "weekday"
            )) {
              return (
                (M.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: v },
                  },
                ]),
                !1
              );
              break;
            }
          if (h === t) {
            if (e.cadence !== void 0) {
              let v = e.cadence,
                g = t;
              if (typeof v != "string")
                return (
                  (M.errors = [
                    {
                      instancePath: r + "/cadence",
                      schemaPath: "#/properties/cadence/type",
                      keyword: "type",
                      params: { type: "string" },
                    },
                  ]),
                  !1
                );
              if (!(v === "daily" || v === "weekdays" || v === "weekly"))
                return (
                  (M.errors = [
                    {
                      instancePath: r + "/cadence",
                      schemaPath: "#/properties/cadence/enum",
                      keyword: "enum",
                      params: { allowedValues: zs.properties.cadence.enum },
                    },
                  ]),
                  !1
                );
              var n = g === t;
            } else var n = !0;
            if (n) {
              if (e.localTime !== void 0) {
                let v = e.localTime,
                  g = t;
                if (t === g)
                  if (typeof v == "string") {
                    if (k(v) > 5)
                      return (
                        (M.errors = [
                          {
                            instancePath: r + "/localTime",
                            schemaPath: "#/properties/localTime/maxLength",
                            keyword: "maxLength",
                            params: { limit: 5 },
                          },
                        ]),
                        !1
                      );
                    if (k(v) < 5)
                      return (
                        (M.errors = [
                          {
                            instancePath: r + "/localTime",
                            schemaPath: "#/properties/localTime/minLength",
                            keyword: "minLength",
                            params: { limit: 5 },
                          },
                        ]),
                        !1
                      );
                    if (!Ts.test(v))
                      return (
                        (M.errors = [
                          {
                            instancePath: r + "/localTime",
                            schemaPath: "#/properties/localTime/pattern",
                            keyword: "pattern",
                            params: { pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (M.errors = [
                        {
                          instancePath: r + "/localTime",
                          schemaPath: "#/properties/localTime/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var n = g === t;
              } else var n = !0;
              if (n) {
                if (e.timeZone !== void 0) {
                  let v = e.timeZone,
                    g = t;
                  if (t === g && t === g)
                    if (typeof v == "string") {
                      if (k(v) > 80)
                        return (
                          (M.errors = [
                            {
                              instancePath: r + "/timeZone",
                              schemaPath: "#/properties/timeZone/maxLength",
                              keyword: "maxLength",
                              params: { limit: 80 },
                            },
                          ]),
                          !1
                        );
                      if (k(v) < 1)
                        return (
                          (M.errors = [
                            {
                              instancePath: r + "/timeZone",
                              schemaPath: "#/properties/timeZone/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!Vs.test(v))
                        return (
                          (M.errors = [
                            {
                              instancePath: r + "/timeZone",
                              schemaPath: "#/properties/timeZone/format",
                              keyword: "format",
                              params: { format: "iana-timezone" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (M.errors = [
                          {
                            instancePath: r + "/timeZone",
                            schemaPath: "#/properties/timeZone/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var n = g === t;
                } else var n = !0;
                if (n) {
                  if (e.graceMinutes !== void 0) {
                    let v = e.graceMinutes,
                      g = t;
                    if (!(typeof v == "number" && !(v % 1) && !isNaN(v)))
                      return (
                        (M.errors = [
                          {
                            instancePath: r + "/graceMinutes",
                            schemaPath: "#/properties/graceMinutes/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ]),
                        !1
                      );
                    if (t === g && typeof v == "number") {
                      if (v > 1440 || isNaN(v))
                        return (
                          (M.errors = [
                            {
                              instancePath: r + "/graceMinutes",
                              schemaPath: "#/properties/graceMinutes/maximum",
                              keyword: "maximum",
                              params: { comparison: "<=", limit: 1440 },
                            },
                          ]),
                          !1
                        );
                      if (v < 0 || isNaN(v))
                        return (
                          (M.errors = [
                            {
                              instancePath: r + "/graceMinutes",
                              schemaPath: "#/properties/graceMinutes/minimum",
                              keyword: "minimum",
                              params: { comparison: ">=", limit: 0 },
                            },
                          ]),
                          !1
                        );
                    }
                    var n = g === t;
                  } else var n = !0;
                  if (n)
                    if (e.weekday !== void 0) {
                      let v = e.weekday,
                        g = t;
                      if (!(typeof v == "number" && !(v % 1) && !isNaN(v)))
                        return (
                          (M.errors = [
                            {
                              instancePath: r + "/weekday",
                              schemaPath: "#/properties/weekday/type",
                              keyword: "type",
                              params: { type: "integer" },
                            },
                          ]),
                          !1
                        );
                      if (t === g && typeof v == "number") {
                        if (v > 6 || isNaN(v))
                          return (
                            (M.errors = [
                              {
                                instancePath: r + "/weekday",
                                schemaPath: "#/properties/weekday/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 6 },
                              },
                            ]),
                            !1
                          );
                        if (v < 0 || isNaN(v))
                          return (
                            (M.errors = [
                              {
                                instancePath: r + "/weekday",
                                schemaPath: "#/properties/weekday/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 0 },
                              },
                            ]),
                            !1
                          );
                      }
                      var n = g === t;
                    } else var n = !0;
                }
              }
            }
          }
        }
      } else
        return (
          (M.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((M.errors = i), t === 0);
  }
  M.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ye(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ye.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.name === void 0 && (w = "name")) ||
          (e.template === void 0 && (w = "template")) ||
          (e.goal === void 0 && (w = "goal")) ||
          (e.inputPolicy === void 0 && (w = "inputPolicy")) ||
          (e.outputSpec === void 0 && (w = "outputSpec")) ||
          (e.deliveryExpectation === void 0 && (w = "deliveryExpectation"))
        )
          return (
            (ye.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(
              a === "name" ||
              a === "template" ||
              a === "goal" ||
              a === "inputPolicy" ||
              a === "outputSpec" ||
              a === "deliveryExpectation"
            )) {
              return (
                (ye.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.name !== void 0) {
              let a = e.name,
                o = t;
              if (t === o)
                if (typeof a == "string") {
                  if (k(a) > 80)
                    return (
                      (ye.errors = [
                        {
                          instancePath: r + "/name",
                          schemaPath: "#/properties/name/maxLength",
                          keyword: "maxLength",
                          params: { limit: 80 },
                        },
                      ]),
                      !1
                    );
                  if (k(a) < 1)
                    return (
                      (ye.errors = [
                        {
                          instancePath: r + "/name",
                          schemaPath: "#/properties/name/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (ye.errors = [
                      {
                        instancePath: r + "/name",
                        schemaPath: "#/properties/name/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = o === t;
            } else var s = !0;
            if (s) {
              if (e.template !== void 0) {
                let a = e.template,
                  o = t;
                if (typeof a != "string")
                  return (
                    (ye.errors = [
                      {
                        instancePath: r + "/template",
                        schemaPath: "#/properties/template/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
                if (!(a === "brief" || a === "custom"))
                  return (
                    (ye.errors = [
                      {
                        instancePath: r + "/template",
                        schemaPath: "#/properties/template/enum",
                        keyword: "enum",
                        params: { allowedValues: Rs.properties.template.enum },
                      },
                    ]),
                    !1
                  );
                var s = o === t;
              } else var s = !0;
              if (s) {
                if (e.goal !== void 0) {
                  let a = e.goal,
                    o = t;
                  if (t === o)
                    if (typeof a == "string") {
                      if (k(a) > 2e3)
                        return (
                          (ye.errors = [
                            {
                              instancePath: r + "/goal",
                              schemaPath: "#/properties/goal/maxLength",
                              keyword: "maxLength",
                              params: { limit: 2e3 },
                            },
                          ]),
                          !1
                        );
                      if (k(a) < 1)
                        return (
                          (ye.errors = [
                            {
                              instancePath: r + "/goal",
                              schemaPath: "#/properties/goal/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (ye.errors = [
                          {
                            instancePath: r + "/goal",
                            schemaPath: "#/properties/goal/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = o === t;
                } else var s = !0;
                if (s) {
                  if (e.inputPolicy !== void 0) {
                    let a = t;
                    be(e.inputPolicy, {
                      instancePath: r + "/inputPolicy",
                      parentData: e,
                      parentDataProperty: "inputPolicy",
                      rootData: d,
                      dynamicAnchors: y,
                    }) || ((i = i === null ? be.errors : i.concat(be.errors)), (t = i.length));
                    var s = a === t;
                  } else var s = !0;
                  if (s) {
                    if (e.outputSpec !== void 0) {
                      let a = t;
                      de(e.outputSpec, {
                        instancePath: r + "/outputSpec",
                        parentData: e,
                        parentDataProperty: "outputSpec",
                        rootData: d,
                        dynamicAnchors: y,
                      }) || ((i = i === null ? de.errors : i.concat(de.errors)), (t = i.length));
                      var s = a === t;
                    } else var s = !0;
                    if (s)
                      if (e.deliveryExpectation !== void 0) {
                        let a = e.deliveryExpectation,
                          o = t,
                          n = t,
                          p = !1,
                          h = t;
                        M(a, {
                          instancePath: r + "/deliveryExpectation",
                          parentData: e,
                          parentDataProperty: "deliveryExpectation",
                          rootData: d,
                          dynamicAnchors: y,
                        }) || ((i = i === null ? M.errors : i.concat(M.errors)), (t = i.length));
                        var u = h === t;
                        p = p || u;
                        let v = t;
                        if (a !== null) {
                          let P = {
                            instancePath: r + "/deliveryExpectation",
                            schemaPath: "#/properties/deliveryExpectation/anyOf/1/type",
                            keyword: "type",
                            params: { type: "null" },
                          };
                          (i === null ? (i = [P]) : i.push(P), t++);
                        }
                        var u = v === t;
                        if (((p = p || u), p))
                          ((t = n), i !== null && (n ? (i.length = n) : (i = null)));
                        else {
                          let P = {
                            instancePath: r + "/deliveryExpectation",
                            schemaPath: "#/properties/deliveryExpectation/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          return (i === null ? (i = [P]) : i.push(P), t++, (ye.errors = i), !1);
                        }
                        var s = o === t;
                      } else var s = !0;
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (ye.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ye.errors = i), t === 0);
  }
  ye.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Di = {
      type: "object",
      properties: {
        state: { enum: ["ready", "empty"] },
        coverage: { $ref: "#/$defs/Coverage" },
        sourceAsOf: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 40, format: "date-time", pattern: "Z$" },
            { type: "null" },
          ],
        },
        fetchedAt: {
          type: "string",
          minLength: 1,
          maxLength: 40,
          format: "date-time",
          pattern: "Z$",
        },
        freshness: { enum: ["fresh", "stale", "unknown"] },
        data: { $ref: "#/$defs/ResourceData" },
      },
      required: ["state", "coverage", "sourceAsOf", "fetchedAt", "freshness", "data"],
      additionalProperties: !1,
    },
    qs = {
      type: "object",
      properties: {
        state: { type: "string", enum: ["complete", "partial", "unknown"] },
        issues: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 80 },
          minItems: 0,
          maxItems: 20,
          uniqueItems: !0,
        },
      },
      required: ["state", "issues"],
      additionalProperties: !1,
    };
  function he(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = he.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if ((e.state === void 0 && (w = "state")) || (e.issues === void 0 && (w = "issues")))
          return (
            (he.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(a === "state" || a === "issues")) {
              return (
                (he.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.state !== void 0) {
              let a = e.state,
                o = t;
              if (typeof a != "string")
                return (
                  (he.errors = [
                    {
                      instancePath: r + "/state",
                      schemaPath: "#/properties/state/type",
                      keyword: "type",
                      params: { type: "string" },
                    },
                  ]),
                  !1
                );
              if (!(a === "complete" || a === "partial" || a === "unknown"))
                return (
                  (he.errors = [
                    {
                      instancePath: r + "/state",
                      schemaPath: "#/properties/state/enum",
                      keyword: "enum",
                      params: { allowedValues: qs.properties.state.enum },
                    },
                  ]),
                  !1
                );
              var s = o === t;
            } else var s = !0;
            if (s)
              if (e.issues !== void 0) {
                let a = e.issues,
                  o = t;
                if (t === o)
                  if (Array.isArray(a)) {
                    if (a.length > 20)
                      return (
                        (he.errors = [
                          {
                            instancePath: r + "/issues",
                            schemaPath: "#/properties/issues/maxItems",
                            keyword: "maxItems",
                            params: { limit: 20 },
                          },
                        ]),
                        !1
                      );
                    if (a.length < 0)
                      return (
                        (he.errors = [
                          {
                            instancePath: r + "/issues",
                            schemaPath: "#/properties/issues/minItems",
                            keyword: "minItems",
                            params: { limit: 0 },
                          },
                        ]),
                        !1
                      );
                    {
                      var u = !0;
                      let p = a.length;
                      for (let h = 0; h < p; h++) {
                        let v = a[h],
                          g = t;
                        if (t === g)
                          if (typeof v == "string") {
                            if (k(v) > 80)
                              return (
                                (he.errors = [
                                  {
                                    instancePath: r + "/issues/" + h,
                                    schemaPath: "#/properties/issues/items/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 80 },
                                  },
                                ]),
                                !1
                              );
                            if (k(v) < 1)
                              return (
                                (he.errors = [
                                  {
                                    instancePath: r + "/issues/" + h,
                                    schemaPath: "#/properties/issues/items/minLength",
                                    keyword: "minLength",
                                    params: { limit: 1 },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (he.errors = [
                                {
                                  instancePath: r + "/issues/" + h,
                                  schemaPath: "#/properties/issues/items/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var u = g === t;
                        if (!u) break;
                      }
                      if (u) {
                        let h = a.length,
                          v;
                        if (h > 1) {
                          let g = {};
                          for (; h--;) {
                            let P = a[h];
                            if (typeof P == "string") {
                              if (typeof g[P] == "number") {
                                return (
                                  (v = g[P]),
                                  (he.errors = [
                                    {
                                      instancePath: r + "/issues",
                                      schemaPath: "#/properties/issues/uniqueItems",
                                      keyword: "uniqueItems",
                                      params: { i: h, j: v },
                                    },
                                  ]),
                                  !1
                                );
                                break;
                              }
                              g[P] = h;
                            }
                          }
                        }
                      }
                    }
                  } else
                    return (
                      (he.errors = [
                        {
                          instancePath: r + "/issues",
                          schemaPath: "#/properties/issues/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ]),
                      !1
                    );
                var s = o === t;
              } else var s = !0;
          }
        }
      } else
        return (
          (he.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((he.errors = i), t === 0);
  }
  he.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Zs = {
      type: "object",
      properties: {
        currency: { type: "string", enum: ["CAD", "USD"] },
        cashBalance: {
          anyOf: [
            {
              type: "string",
              minLength: 1,
              maxLength: 34,
              pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$",
            },
            { type: "null" },
          ],
        },
        buyingPower: {
          anyOf: [
            {
              type: "string",
              minLength: 1,
              maxLength: 34,
              pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$",
            },
            { type: "null" },
          ],
        },
      },
      required: ["currency", "cashBalance", "buyingPower"],
      additionalProperties: !1,
    },
    Mt = new RegExp("^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$", "u");
  function Le(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Le.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let c;
        if (
          (e.currency === void 0 && (c = "currency")) ||
          (e.cashBalance === void 0 && (c = "cashBalance")) ||
          (e.buyingPower === void 0 && (c = "buyingPower"))
        )
          return (
            (Le.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: c },
              },
            ]),
            !1
          );
        {
          let a = t;
          for (let o in e)
            if (!(o === "currency" || o === "cashBalance" || o === "buyingPower")) {
              return (
                (Le.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: o },
                  },
                ]),
                !1
              );
              break;
            }
          if (a === t) {
            if (e.currency !== void 0) {
              let o = e.currency,
                n = t;
              if (typeof o != "string")
                return (
                  (Le.errors = [
                    {
                      instancePath: r + "/currency",
                      schemaPath: "#/properties/currency/type",
                      keyword: "type",
                      params: { type: "string" },
                    },
                  ]),
                  !1
                );
              if (!(o === "CAD" || o === "USD"))
                return (
                  (Le.errors = [
                    {
                      instancePath: r + "/currency",
                      schemaPath: "#/properties/currency/enum",
                      keyword: "enum",
                      params: { allowedValues: Zs.properties.currency.enum },
                    },
                  ]),
                  !1
                );
              var s = n === t;
            } else var s = !0;
            if (s) {
              if (e.cashBalance !== void 0) {
                let o = e.cashBalance,
                  n = t,
                  p = t,
                  h = !1,
                  v = t;
                if (t === v)
                  if (typeof o == "string") {
                    if (k(o) > 34) {
                      let b = {
                        instancePath: r + "/cashBalance",
                        schemaPath: "#/properties/cashBalance/anyOf/0/maxLength",
                        keyword: "maxLength",
                        params: { limit: 34 },
                      };
                      (i === null ? (i = [b]) : i.push(b), t++);
                    } else if (k(o) < 1) {
                      let b = {
                        instancePath: r + "/cashBalance",
                        schemaPath: "#/properties/cashBalance/anyOf/0/minLength",
                        keyword: "minLength",
                        params: { limit: 1 },
                      };
                      (i === null ? (i = [b]) : i.push(b), t++);
                    } else if (!Mt.test(o)) {
                      let b = {
                        instancePath: r + "/cashBalance",
                        schemaPath: "#/properties/cashBalance/anyOf/0/pattern",
                        keyword: "pattern",
                        params: { pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$" },
                      };
                      (i === null ? (i = [b]) : i.push(b), t++);
                    }
                  } else {
                    let b = {
                      instancePath: r + "/cashBalance",
                      schemaPath: "#/properties/cashBalance/anyOf/0/type",
                      keyword: "type",
                      params: { type: "string" },
                    };
                    (i === null ? (i = [b]) : i.push(b), t++);
                  }
                var u = v === t;
                h = h || u;
                let g = t;
                if (o !== null) {
                  let b = {
                    instancePath: r + "/cashBalance",
                    schemaPath: "#/properties/cashBalance/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (i === null ? (i = [b]) : i.push(b), t++);
                }
                var u = g === t;
                if (((h = h || u), h)) ((t = p), i !== null && (p ? (i.length = p) : (i = null)));
                else {
                  let b = {
                    instancePath: r + "/cashBalance",
                    schemaPath: "#/properties/cashBalance/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (i === null ? (i = [b]) : i.push(b), t++, (Le.errors = i), !1);
                }
                var s = n === t;
              } else var s = !0;
              if (s)
                if (e.buyingPower !== void 0) {
                  let o = e.buyingPower,
                    n = t,
                    p = t,
                    h = !1,
                    v = t;
                  if (t === v)
                    if (typeof o == "string") {
                      if (k(o) > 34) {
                        let b = {
                          instancePath: r + "/buyingPower",
                          schemaPath: "#/properties/buyingPower/anyOf/0/maxLength",
                          keyword: "maxLength",
                          params: { limit: 34 },
                        };
                        (i === null ? (i = [b]) : i.push(b), t++);
                      } else if (k(o) < 1) {
                        let b = {
                          instancePath: r + "/buyingPower",
                          schemaPath: "#/properties/buyingPower/anyOf/0/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        };
                        (i === null ? (i = [b]) : i.push(b), t++);
                      } else if (!Mt.test(o)) {
                        let b = {
                          instancePath: r + "/buyingPower",
                          schemaPath: "#/properties/buyingPower/anyOf/0/pattern",
                          keyword: "pattern",
                          params: { pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$" },
                        };
                        (i === null ? (i = [b]) : i.push(b), t++);
                      }
                    } else {
                      let b = {
                        instancePath: r + "/buyingPower",
                        schemaPath: "#/properties/buyingPower/anyOf/0/type",
                        keyword: "type",
                        params: { type: "string" },
                      };
                      (i === null ? (i = [b]) : i.push(b), t++);
                    }
                  var w = v === t;
                  h = h || w;
                  let g = t;
                  if (o !== null) {
                    let b = {
                      instancePath: r + "/buyingPower",
                      schemaPath: "#/properties/buyingPower/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (i === null ? (i = [b]) : i.push(b), t++);
                  }
                  var w = g === t;
                  if (((h = h || w), h)) ((t = p), i !== null && (p ? (i.length = p) : (i = null)));
                  else {
                    let b = {
                      instancePath: r + "/buyingPower",
                      schemaPath: "#/properties/buyingPower/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (i === null ? (i = [b]) : i.push(b), t++, (Le.errors = i), !1);
                  }
                  var s = n === t;
                } else var s = !0;
            }
          }
        }
      } else
        return (
          (Le.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Le.errors = i), t === 0);
  }
  Le.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Ut = {
      type: "object",
      properties: {
        assetId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        brokerAssetId: { type: "string", minLength: 1, maxLength: 180 },
        symbol: { anyOf: [{ type: "string", minLength: 1, maxLength: 32 }, { type: "null" }] },
        exchange: { anyOf: [{ type: "string", minLength: 1, maxLength: 40 }, { type: "null" }] },
        name: { type: "string", minLength: 1, maxLength: 180 },
        assetType: { type: "string", enum: ["stock", "etf", "unsupported"] },
        quantity: {
          type: "string",
          minLength: 1,
          maxLength: 33,
          pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$",
        },
        currency: { type: "string", enum: ["CAD", "USD"] },
        marketValue: { anyOf: [{ $ref: "#/$defs/Money" }, { type: "null" }] },
      },
      required: [
        "assetId",
        "brokerAssetId",
        "symbol",
        "exchange",
        "name",
        "assetType",
        "quantity",
        "currency",
        "marketValue",
      ],
      additionalProperties: !1,
    },
    Cs = new RegExp("^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$", "u"),
    Js = {
      type: "object",
      properties: {
        currency: { type: "string", enum: ["CAD", "USD"] },
        amount: {
          type: "string",
          minLength: 1,
          maxLength: 34,
          pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$",
        },
      },
      required: ["currency", "amount"],
      additionalProperties: !1,
    };
  function Pe(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Pe.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if ((e.currency === void 0 && (u = "currency")) || (e.amount === void 0 && (u = "amount")))
          return (
            (Pe.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "currency" || c === "amount")) {
              return (
                (Pe.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.currency !== void 0) {
              let c = e.currency,
                a = t;
              if (typeof c != "string")
                return (
                  (Pe.errors = [
                    {
                      instancePath: r + "/currency",
                      schemaPath: "#/properties/currency/type",
                      keyword: "type",
                      params: { type: "string" },
                    },
                  ]),
                  !1
                );
              if (!(c === "CAD" || c === "USD"))
                return (
                  (Pe.errors = [
                    {
                      instancePath: r + "/currency",
                      schemaPath: "#/properties/currency/enum",
                      keyword: "enum",
                      params: { allowedValues: Js.properties.currency.enum },
                    },
                  ]),
                  !1
                );
              var s = a === t;
            } else var s = !0;
            if (s)
              if (e.amount !== void 0) {
                let c = e.amount,
                  a = t;
                if (t === a)
                  if (typeof c == "string") {
                    if (k(c) > 34)
                      return (
                        (Pe.errors = [
                          {
                            instancePath: r + "/amount",
                            schemaPath: "#/properties/amount/maxLength",
                            keyword: "maxLength",
                            params: { limit: 34 },
                          },
                        ]),
                        !1
                      );
                    if (k(c) < 1)
                      return (
                        (Pe.errors = [
                          {
                            instancePath: r + "/amount",
                            schemaPath: "#/properties/amount/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    if (!Mt.test(c))
                      return (
                        (Pe.errors = [
                          {
                            instancePath: r + "/amount",
                            schemaPath: "#/properties/amount/pattern",
                            keyword: "pattern",
                            params: { pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (Pe.errors = [
                        {
                          instancePath: r + "/amount",
                          schemaPath: "#/properties/amount/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = a === t;
              } else var s = !0;
          }
        }
      } else
        return (
          (Pe.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Pe.errors = i), t === 0);
  }
  Pe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function J(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = J.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let a;
        if (
          (e.assetId === void 0 && (a = "assetId")) ||
          (e.brokerAssetId === void 0 && (a = "brokerAssetId")) ||
          (e.symbol === void 0 && (a = "symbol")) ||
          (e.exchange === void 0 && (a = "exchange")) ||
          (e.name === void 0 && (a = "name")) ||
          (e.assetType === void 0 && (a = "assetType")) ||
          (e.quantity === void 0 && (a = "quantity")) ||
          (e.currency === void 0 && (a = "currency")) ||
          (e.marketValue === void 0 && (a = "marketValue"))
        )
          return (
            (J.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: a },
              },
            ]),
            !1
          );
        {
          let o = t;
          for (let n in e)
            if (!Qe.call(Ut.properties, n)) {
              return (
                (J.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: n },
                  },
                ]),
                !1
              );
              break;
            }
          if (o === t) {
            if (e.assetId !== void 0) {
              let n = e.assetId,
                p = t;
              if (t === p)
                if (typeof n == "string") {
                  if (k(n) > 128)
                    return (
                      (J.errors = [
                        {
                          instancePath: r + "/assetId",
                          schemaPath: "#/properties/assetId/maxLength",
                          keyword: "maxLength",
                          params: { limit: 128 },
                        },
                      ]),
                      !1
                    );
                  if (k(n) < 1)
                    return (
                      (J.errors = [
                        {
                          instancePath: r + "/assetId",
                          schemaPath: "#/properties/assetId/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!q.test(n))
                    return (
                      (J.errors = [
                        {
                          instancePath: r + "/assetId",
                          schemaPath: "#/properties/assetId/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (J.errors = [
                      {
                        instancePath: r + "/assetId",
                        schemaPath: "#/properties/assetId/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = p === t;
            } else var s = !0;
            if (s) {
              if (e.brokerAssetId !== void 0) {
                let n = e.brokerAssetId,
                  p = t;
                if (t === p)
                  if (typeof n == "string") {
                    if (k(n) > 180)
                      return (
                        (J.errors = [
                          {
                            instancePath: r + "/brokerAssetId",
                            schemaPath: "#/properties/brokerAssetId/maxLength",
                            keyword: "maxLength",
                            params: { limit: 180 },
                          },
                        ]),
                        !1
                      );
                    if (k(n) < 1)
                      return (
                        (J.errors = [
                          {
                            instancePath: r + "/brokerAssetId",
                            schemaPath: "#/properties/brokerAssetId/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (J.errors = [
                        {
                          instancePath: r + "/brokerAssetId",
                          schemaPath: "#/properties/brokerAssetId/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = p === t;
              } else var s = !0;
              if (s) {
                if (e.symbol !== void 0) {
                  let n = e.symbol,
                    p = t,
                    h = t,
                    v = !1,
                    g = t;
                  if (t === g)
                    if (typeof n == "string") {
                      if (k(n) > 32) {
                        let A = {
                          instancePath: r + "/symbol",
                          schemaPath: "#/properties/symbol/anyOf/0/maxLength",
                          keyword: "maxLength",
                          params: { limit: 32 },
                        };
                        (i === null ? (i = [A]) : i.push(A), t++);
                      } else if (k(n) < 1) {
                        let A = {
                          instancePath: r + "/symbol",
                          schemaPath: "#/properties/symbol/anyOf/0/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        };
                        (i === null ? (i = [A]) : i.push(A), t++);
                      }
                    } else {
                      let A = {
                        instancePath: r + "/symbol",
                        schemaPath: "#/properties/symbol/anyOf/0/type",
                        keyword: "type",
                        params: { type: "string" },
                      };
                      (i === null ? (i = [A]) : i.push(A), t++);
                    }
                  var u = g === t;
                  v = v || u;
                  let P = t;
                  if (n !== null) {
                    let A = {
                      instancePath: r + "/symbol",
                      schemaPath: "#/properties/symbol/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (i === null ? (i = [A]) : i.push(A), t++);
                  }
                  var u = P === t;
                  if (((v = v || u), v)) ((t = h), i !== null && (h ? (i.length = h) : (i = null)));
                  else {
                    let A = {
                      instancePath: r + "/symbol",
                      schemaPath: "#/properties/symbol/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (i === null ? (i = [A]) : i.push(A), t++, (J.errors = i), !1);
                  }
                  var s = p === t;
                } else var s = !0;
                if (s) {
                  if (e.exchange !== void 0) {
                    let n = e.exchange,
                      p = t,
                      h = t,
                      v = !1,
                      g = t;
                    if (t === g)
                      if (typeof n == "string") {
                        if (k(n) > 40) {
                          let A = {
                            instancePath: r + "/exchange",
                            schemaPath: "#/properties/exchange/anyOf/0/maxLength",
                            keyword: "maxLength",
                            params: { limit: 40 },
                          };
                          (i === null ? (i = [A]) : i.push(A), t++);
                        } else if (k(n) < 1) {
                          let A = {
                            instancePath: r + "/exchange",
                            schemaPath: "#/properties/exchange/anyOf/0/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          };
                          (i === null ? (i = [A]) : i.push(A), t++);
                        }
                      } else {
                        let A = {
                          instancePath: r + "/exchange",
                          schemaPath: "#/properties/exchange/anyOf/0/type",
                          keyword: "type",
                          params: { type: "string" },
                        };
                        (i === null ? (i = [A]) : i.push(A), t++);
                      }
                    var w = g === t;
                    v = v || w;
                    let P = t;
                    if (n !== null) {
                      let A = {
                        instancePath: r + "/exchange",
                        schemaPath: "#/properties/exchange/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (i === null ? (i = [A]) : i.push(A), t++);
                    }
                    var w = P === t;
                    if (((v = v || w), v))
                      ((t = h), i !== null && (h ? (i.length = h) : (i = null)));
                    else {
                      let A = {
                        instancePath: r + "/exchange",
                        schemaPath: "#/properties/exchange/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (i === null ? (i = [A]) : i.push(A), t++, (J.errors = i), !1);
                    }
                    var s = p === t;
                  } else var s = !0;
                  if (s) {
                    if (e.name !== void 0) {
                      let n = e.name,
                        p = t;
                      if (t === p)
                        if (typeof n == "string") {
                          if (k(n) > 180)
                            return (
                              (J.errors = [
                                {
                                  instancePath: r + "/name",
                                  schemaPath: "#/properties/name/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 180 },
                                },
                              ]),
                              !1
                            );
                          if (k(n) < 1)
                            return (
                              (J.errors = [
                                {
                                  instancePath: r + "/name",
                                  schemaPath: "#/properties/name/minLength",
                                  keyword: "minLength",
                                  params: { limit: 1 },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (J.errors = [
                              {
                                instancePath: r + "/name",
                                schemaPath: "#/properties/name/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = p === t;
                    } else var s = !0;
                    if (s) {
                      if (e.assetType !== void 0) {
                        let n = e.assetType,
                          p = t;
                        if (typeof n != "string")
                          return (
                            (J.errors = [
                              {
                                instancePath: r + "/assetType",
                                schemaPath: "#/properties/assetType/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                        if (!(n === "stock" || n === "etf" || n === "unsupported"))
                          return (
                            (J.errors = [
                              {
                                instancePath: r + "/assetType",
                                schemaPath: "#/properties/assetType/enum",
                                keyword: "enum",
                                params: { allowedValues: Ut.properties.assetType.enum },
                              },
                            ]),
                            !1
                          );
                        var s = p === t;
                      } else var s = !0;
                      if (s) {
                        if (e.quantity !== void 0) {
                          let n = e.quantity,
                            p = t;
                          if (t === p)
                            if (typeof n == "string") {
                              if (k(n) > 33)
                                return (
                                  (J.errors = [
                                    {
                                      instancePath: r + "/quantity",
                                      schemaPath: "#/properties/quantity/maxLength",
                                      keyword: "maxLength",
                                      params: { limit: 33 },
                                    },
                                  ]),
                                  !1
                                );
                              if (k(n) < 1)
                                return (
                                  (J.errors = [
                                    {
                                      instancePath: r + "/quantity",
                                      schemaPath: "#/properties/quantity/minLength",
                                      keyword: "minLength",
                                      params: { limit: 1 },
                                    },
                                  ]),
                                  !1
                                );
                              if (!Cs.test(n))
                                return (
                                  (J.errors = [
                                    {
                                      instancePath: r + "/quantity",
                                      schemaPath: "#/properties/quantity/pattern",
                                      keyword: "pattern",
                                      params: {
                                        pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$",
                                      },
                                    },
                                  ]),
                                  !1
                                );
                            } else
                              return (
                                (J.errors = [
                                  {
                                    instancePath: r + "/quantity",
                                    schemaPath: "#/properties/quantity/type",
                                    keyword: "type",
                                    params: { type: "string" },
                                  },
                                ]),
                                !1
                              );
                          var s = p === t;
                        } else var s = !0;
                        if (s) {
                          if (e.currency !== void 0) {
                            let n = e.currency,
                              p = t;
                            if (typeof n != "string")
                              return (
                                (J.errors = [
                                  {
                                    instancePath: r + "/currency",
                                    schemaPath: "#/properties/currency/type",
                                    keyword: "type",
                                    params: { type: "string" },
                                  },
                                ]),
                                !1
                              );
                            if (!(n === "CAD" || n === "USD"))
                              return (
                                (J.errors = [
                                  {
                                    instancePath: r + "/currency",
                                    schemaPath: "#/properties/currency/enum",
                                    keyword: "enum",
                                    params: { allowedValues: Ut.properties.currency.enum },
                                  },
                                ]),
                                !1
                              );
                            var s = p === t;
                          } else var s = !0;
                          if (s)
                            if (e.marketValue !== void 0) {
                              let n = e.marketValue,
                                p = t,
                                h = t,
                                v = !1,
                                g = t;
                              Pe(n, {
                                instancePath: r + "/marketValue",
                                parentData: e,
                                parentDataProperty: "marketValue",
                                rootData: d,
                                dynamicAnchors: y,
                              }) ||
                                ((i = i === null ? Pe.errors : i.concat(Pe.errors)),
                                (t = i.length));
                              var c = g === t;
                              v = v || c;
                              let P = t;
                              if (n !== null) {
                                let A = {
                                  instancePath: r + "/marketValue",
                                  schemaPath: "#/properties/marketValue/anyOf/1/type",
                                  keyword: "type",
                                  params: { type: "null" },
                                };
                                (i === null ? (i = [A]) : i.push(A), t++);
                              }
                              var c = P === t;
                              if (((v = v || c), v))
                                ((t = h), i !== null && (h ? (i.length = h) : (i = null)));
                              else {
                                let A = {
                                  instancePath: r + "/marketValue",
                                  schemaPath: "#/properties/marketValue/anyOf",
                                  keyword: "anyOf",
                                  params: {},
                                };
                                return (
                                  i === null ? (i = [A]) : i.push(A),
                                  t++,
                                  (J.errors = i),
                                  !1
                                );
                              }
                              var s = p === t;
                            } else var s = !0;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (J.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((J.errors = i), t === 0);
  }
  J.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function se(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = se.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let c;
        if (
          (e.accountId === void 0 && (c = "accountId")) ||
          (e.displayName === void 0 && (c = "displayName")) ||
          (e.balances === void 0 && (c = "balances")) ||
          (e.positions === void 0 && (c = "positions"))
        )
          return (
            (se.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: c },
              },
            ]),
            !1
          );
        {
          let a = t;
          for (let o in e)
            if (!(
              o === "accountId" ||
              o === "displayName" ||
              o === "balances" ||
              o === "positions"
            )) {
              return (
                (se.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: o },
                  },
                ]),
                !1
              );
              break;
            }
          if (a === t) {
            if (e.accountId !== void 0) {
              let o = e.accountId,
                n = t;
              if (t === n)
                if (typeof o == "string") {
                  if (k(o) > 128)
                    return (
                      (se.errors = [
                        {
                          instancePath: r + "/accountId",
                          schemaPath: "#/properties/accountId/maxLength",
                          keyword: "maxLength",
                          params: { limit: 128 },
                        },
                      ]),
                      !1
                    );
                  if (k(o) < 1)
                    return (
                      (se.errors = [
                        {
                          instancePath: r + "/accountId",
                          schemaPath: "#/properties/accountId/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!q.test(o))
                    return (
                      (se.errors = [
                        {
                          instancePath: r + "/accountId",
                          schemaPath: "#/properties/accountId/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (se.errors = [
                      {
                        instancePath: r + "/accountId",
                        schemaPath: "#/properties/accountId/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = n === t;
            } else var s = !0;
            if (s) {
              if (e.displayName !== void 0) {
                let o = e.displayName,
                  n = t;
                if (t === n)
                  if (typeof o == "string") {
                    if (k(o) > 80)
                      return (
                        (se.errors = [
                          {
                            instancePath: r + "/displayName",
                            schemaPath: "#/properties/displayName/maxLength",
                            keyword: "maxLength",
                            params: { limit: 80 },
                          },
                        ]),
                        !1
                      );
                    if (k(o) < 1)
                      return (
                        (se.errors = [
                          {
                            instancePath: r + "/displayName",
                            schemaPath: "#/properties/displayName/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (se.errors = [
                        {
                          instancePath: r + "/displayName",
                          schemaPath: "#/properties/displayName/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = n === t;
              } else var s = !0;
              if (s) {
                if (e.balances !== void 0) {
                  let o = e.balances,
                    n = t;
                  if (t === n)
                    if (Array.isArray(o)) {
                      if (o.length > 2)
                        return (
                          (se.errors = [
                            {
                              instancePath: r + "/balances",
                              schemaPath: "#/properties/balances/maxItems",
                              keyword: "maxItems",
                              params: { limit: 2 },
                            },
                          ]),
                          !1
                        );
                      if (o.length < 0)
                        return (
                          (se.errors = [
                            {
                              instancePath: r + "/balances",
                              schemaPath: "#/properties/balances/minItems",
                              keyword: "minItems",
                              params: { limit: 0 },
                            },
                          ]),
                          !1
                        );
                      {
                        var u = !0;
                        let h = o.length;
                        for (let v = 0; v < h; v++) {
                          let g = t;
                          Le(o[v], {
                            instancePath: r + "/balances/" + v,
                            parentData: o,
                            parentDataProperty: v,
                            rootData: d,
                            dynamicAnchors: y,
                          }) ||
                            ((i = i === null ? Le.errors : i.concat(Le.errors)), (t = i.length));
                          var u = g === t;
                          if (!u) break;
                        }
                      }
                    } else
                      return (
                        (se.errors = [
                          {
                            instancePath: r + "/balances",
                            schemaPath: "#/properties/balances/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ]),
                        !1
                      );
                  var s = n === t;
                } else var s = !0;
                if (s)
                  if (e.positions !== void 0) {
                    let o = e.positions,
                      n = t;
                    if (t === n)
                      if (Array.isArray(o)) {
                        if (o.length > 1e3)
                          return (
                            (se.errors = [
                              {
                                instancePath: r + "/positions",
                                schemaPath: "#/properties/positions/maxItems",
                                keyword: "maxItems",
                                params: { limit: 1e3 },
                              },
                            ]),
                            !1
                          );
                        if (o.length < 0)
                          return (
                            (se.errors = [
                              {
                                instancePath: r + "/positions",
                                schemaPath: "#/properties/positions/minItems",
                                keyword: "minItems",
                                params: { limit: 0 },
                              },
                            ]),
                            !1
                          );
                        {
                          var w = !0;
                          let h = o.length;
                          for (let v = 0; v < h; v++) {
                            let g = t;
                            J(o[v], {
                              instancePath: r + "/positions/" + v,
                              parentData: o,
                              parentDataProperty: v,
                              rootData: d,
                              dynamicAnchors: y,
                            }) ||
                              ((i = i === null ? J.errors : i.concat(J.errors)), (t = i.length));
                            var w = g === t;
                            if (!w) break;
                          }
                        }
                      } else
                        return (
                          (se.errors = [
                            {
                              instancePath: r + "/positions",
                              schemaPath: "#/properties/positions/type",
                              keyword: "type",
                              params: { type: "array" },
                            },
                          ]),
                          !1
                        );
                    var s = n === t;
                  } else var s = !0;
              }
            }
          }
        }
      } else
        return (
          (se.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((se.errors = i), t === 0);
  }
  se.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function U(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = U.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let a;
        if (
          (e.kind === void 0 && (a = "kind")) ||
          (e.snapshotId === void 0 && (a = "snapshotId")) ||
          (e.accounts === void 0 && (a = "accounts")) ||
          (e.excludedAssets === void 0 && (a = "excludedAssets"))
        )
          return (
            (U.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: a },
              },
            ]),
            !1
          );
        {
          let o = t;
          for (let n in e)
            if (!(
              n === "kind" ||
              n === "snapshotId" ||
              n === "accounts" ||
              n === "excludedAssets"
            )) {
              return (
                (U.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: n },
                  },
                ]),
                !1
              );
              break;
            }
          if (o === t) {
            if (e.kind !== void 0) {
              let n = t;
              if (e.kind !== "holdings")
                return (
                  (U.errors = [
                    {
                      instancePath: r + "/kind",
                      schemaPath: "#/properties/kind/const",
                      keyword: "const",
                      params: { allowedValue: "holdings" },
                    },
                  ]),
                  !1
                );
              var s = n === t;
            } else var s = !0;
            if (s) {
              if (e.snapshotId !== void 0) {
                let n = e.snapshotId,
                  p = t;
                if (t === p)
                  if (typeof n == "string") {
                    if (k(n) > 128)
                      return (
                        (U.errors = [
                          {
                            instancePath: r + "/snapshotId",
                            schemaPath: "#/properties/snapshotId/maxLength",
                            keyword: "maxLength",
                            params: { limit: 128 },
                          },
                        ]),
                        !1
                      );
                    if (k(n) < 1)
                      return (
                        (U.errors = [
                          {
                            instancePath: r + "/snapshotId",
                            schemaPath: "#/properties/snapshotId/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    if (!q.test(n))
                      return (
                        (U.errors = [
                          {
                            instancePath: r + "/snapshotId",
                            schemaPath: "#/properties/snapshotId/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (U.errors = [
                        {
                          instancePath: r + "/snapshotId",
                          schemaPath: "#/properties/snapshotId/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = p === t;
              } else var s = !0;
              if (s) {
                if (e.accounts !== void 0) {
                  let n = e.accounts,
                    p = t;
                  if (t === p)
                    if (Array.isArray(n)) {
                      if (n.length > 10)
                        return (
                          (U.errors = [
                            {
                              instancePath: r + "/accounts",
                              schemaPath: "#/properties/accounts/maxItems",
                              keyword: "maxItems",
                              params: { limit: 10 },
                            },
                          ]),
                          !1
                        );
                      if (n.length < 0)
                        return (
                          (U.errors = [
                            {
                              instancePath: r + "/accounts",
                              schemaPath: "#/properties/accounts/minItems",
                              keyword: "minItems",
                              params: { limit: 0 },
                            },
                          ]),
                          !1
                        );
                      {
                        var u = !0;
                        let v = n.length;
                        for (let g = 0; g < v; g++) {
                          let P = t;
                          se(n[g], {
                            instancePath: r + "/accounts/" + g,
                            parentData: n,
                            parentDataProperty: g,
                            rootData: d,
                            dynamicAnchors: y,
                          }) ||
                            ((i = i === null ? se.errors : i.concat(se.errors)), (t = i.length));
                          var u = P === t;
                          if (!u) break;
                        }
                      }
                    } else
                      return (
                        (U.errors = [
                          {
                            instancePath: r + "/accounts",
                            schemaPath: "#/properties/accounts/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ]),
                        !1
                      );
                  var s = p === t;
                } else var s = !0;
                if (s)
                  if (e.excludedAssets !== void 0) {
                    let n = e.excludedAssets,
                      p = t;
                    if (t === p)
                      if (Array.isArray(n)) {
                        if (n.length > 100)
                          return (
                            (U.errors = [
                              {
                                instancePath: r + "/excludedAssets",
                                schemaPath: "#/properties/excludedAssets/maxItems",
                                keyword: "maxItems",
                                params: { limit: 100 },
                              },
                            ]),
                            !1
                          );
                        if (n.length < 0)
                          return (
                            (U.errors = [
                              {
                                instancePath: r + "/excludedAssets",
                                schemaPath: "#/properties/excludedAssets/minItems",
                                keyword: "minItems",
                                params: { limit: 0 },
                              },
                            ]),
                            !1
                          );
                        {
                          var w = !0;
                          let v = n.length;
                          for (let g = 0; g < v; g++) {
                            let P = n[g],
                              b = t;
                            if (t === b)
                              if (P && typeof P == "object" && !Array.isArray(P)) {
                                let V;
                                if (
                                  (P.brokerAssetId === void 0 && (V = "brokerAssetId")) ||
                                  (P.reason === void 0 && (V = "reason"))
                                )
                                  return (
                                    (U.errors = [
                                      {
                                        instancePath: r + "/excludedAssets/" + g,
                                        schemaPath: "#/properties/excludedAssets/items/required",
                                        keyword: "required",
                                        params: { missingProperty: V },
                                      },
                                    ]),
                                    !1
                                  );
                                {
                                  let W = t;
                                  for (let _ in P)
                                    if (!(_ === "brokerAssetId" || _ === "reason")) {
                                      return (
                                        (U.errors = [
                                          {
                                            instancePath: r + "/excludedAssets/" + g,
                                            schemaPath:
                                              "#/properties/excludedAssets/items/additionalProperties",
                                            keyword: "additionalProperties",
                                            params: { additionalProperty: _ },
                                          },
                                        ]),
                                        !1
                                      );
                                      break;
                                    }
                                  if (W === t) {
                                    if (P.brokerAssetId !== void 0) {
                                      let _ = P.brokerAssetId,
                                        N = t;
                                      if (t === N)
                                        if (typeof _ == "string") {
                                          if (k(_) > 180)
                                            return (
                                              (U.errors = [
                                                {
                                                  instancePath:
                                                    r + "/excludedAssets/" + g + "/brokerAssetId",
                                                  schemaPath:
                                                    "#/properties/excludedAssets/items/properties/brokerAssetId/maxLength",
                                                  keyword: "maxLength",
                                                  params: { limit: 180 },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (k(_) < 1)
                                            return (
                                              (U.errors = [
                                                {
                                                  instancePath:
                                                    r + "/excludedAssets/" + g + "/brokerAssetId",
                                                  schemaPath:
                                                    "#/properties/excludedAssets/items/properties/brokerAssetId/minLength",
                                                  keyword: "minLength",
                                                  params: { limit: 1 },
                                                },
                                              ]),
                                              !1
                                            );
                                        } else
                                          return (
                                            (U.errors = [
                                              {
                                                instancePath:
                                                  r + "/excludedAssets/" + g + "/brokerAssetId",
                                                schemaPath:
                                                  "#/properties/excludedAssets/items/properties/brokerAssetId/type",
                                                keyword: "type",
                                                params: { type: "string" },
                                              },
                                            ]),
                                            !1
                                          );
                                      var c = N === t;
                                    } else var c = !0;
                                    if (c)
                                      if (P.reason !== void 0) {
                                        let _ = P.reason,
                                          N = t;
                                        if (t === N)
                                          if (typeof _ == "string") {
                                            if (k(_) > 120)
                                              return (
                                                (U.errors = [
                                                  {
                                                    instancePath:
                                                      r + "/excludedAssets/" + g + "/reason",
                                                    schemaPath:
                                                      "#/properties/excludedAssets/items/properties/reason/maxLength",
                                                    keyword: "maxLength",
                                                    params: { limit: 120 },
                                                  },
                                                ]),
                                                !1
                                              );
                                            if (k(_) < 1)
                                              return (
                                                (U.errors = [
                                                  {
                                                    instancePath:
                                                      r + "/excludedAssets/" + g + "/reason",
                                                    schemaPath:
                                                      "#/properties/excludedAssets/items/properties/reason/minLength",
                                                    keyword: "minLength",
                                                    params: { limit: 1 },
                                                  },
                                                ]),
                                                !1
                                              );
                                          } else
                                            return (
                                              (U.errors = [
                                                {
                                                  instancePath:
                                                    r + "/excludedAssets/" + g + "/reason",
                                                  schemaPath:
                                                    "#/properties/excludedAssets/items/properties/reason/type",
                                                  keyword: "type",
                                                  params: { type: "string" },
                                                },
                                              ]),
                                              !1
                                            );
                                        var c = N === t;
                                      } else var c = !0;
                                  }
                                }
                              } else
                                return (
                                  (U.errors = [
                                    {
                                      instancePath: r + "/excludedAssets/" + g,
                                      schemaPath: "#/properties/excludedAssets/items/type",
                                      keyword: "type",
                                      params: { type: "object" },
                                    },
                                  ]),
                                  !1
                                );
                            var w = b === t;
                            if (!w) break;
                          }
                        }
                      } else
                        return (
                          (U.errors = [
                            {
                              instancePath: r + "/excludedAssets",
                              schemaPath: "#/properties/excludedAssets/type",
                              keyword: "type",
                              params: { type: "array" },
                            },
                          ]),
                          !1
                        );
                    var s = p === t;
                  } else var s = !0;
              }
            }
          }
        }
      } else
        return (
          (U.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((U.errors = i), t === 0);
  }
  U.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Bs = {
    type: "object",
    properties: {
      symbol: { type: "string", minLength: 1, maxLength: 14 },
      name: { type: "string", minLength: 1, maxLength: 180 },
      instrumentType: { type: "string", enum: ["stock", "index"] },
      currency: { const: "USD" },
      addedAt: { type: "string", format: "date-time", pattern: "Z$" },
    },
    required: ["symbol", "name", "instrumentType", "currency", "addedAt"],
    additionalProperties: !1,
  };
  function pe(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = pe.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.symbol === void 0 && (u = "symbol")) ||
          (e.name === void 0 && (u = "name")) ||
          (e.instrumentType === void 0 && (u = "instrumentType")) ||
          (e.currency === void 0 && (u = "currency")) ||
          (e.addedAt === void 0 && (u = "addedAt"))
        )
          return (
            (pe.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(
              c === "symbol" ||
              c === "name" ||
              c === "instrumentType" ||
              c === "currency" ||
              c === "addedAt"
            )) {
              return (
                (pe.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.symbol !== void 0) {
              let c = e.symbol,
                a = t;
              if (t === a)
                if (typeof c == "string") {
                  if (k(c) > 14)
                    return (
                      (pe.errors = [
                        {
                          instancePath: r + "/symbol",
                          schemaPath: "#/properties/symbol/maxLength",
                          keyword: "maxLength",
                          params: { limit: 14 },
                        },
                      ]),
                      !1
                    );
                  if (k(c) < 1)
                    return (
                      (pe.errors = [
                        {
                          instancePath: r + "/symbol",
                          schemaPath: "#/properties/symbol/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (pe.errors = [
                      {
                        instancePath: r + "/symbol",
                        schemaPath: "#/properties/symbol/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.name !== void 0) {
                let c = e.name,
                  a = t;
                if (t === a)
                  if (typeof c == "string") {
                    if (k(c) > 180)
                      return (
                        (pe.errors = [
                          {
                            instancePath: r + "/name",
                            schemaPath: "#/properties/name/maxLength",
                            keyword: "maxLength",
                            params: { limit: 180 },
                          },
                        ]),
                        !1
                      );
                    if (k(c) < 1)
                      return (
                        (pe.errors = [
                          {
                            instancePath: r + "/name",
                            schemaPath: "#/properties/name/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (pe.errors = [
                        {
                          instancePath: r + "/name",
                          schemaPath: "#/properties/name/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = a === t;
              } else var s = !0;
              if (s) {
                if (e.instrumentType !== void 0) {
                  let c = e.instrumentType,
                    a = t;
                  if (typeof c != "string")
                    return (
                      (pe.errors = [
                        {
                          instancePath: r + "/instrumentType",
                          schemaPath: "#/properties/instrumentType/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                  if (!(c === "stock" || c === "index"))
                    return (
                      (pe.errors = [
                        {
                          instancePath: r + "/instrumentType",
                          schemaPath: "#/properties/instrumentType/enum",
                          keyword: "enum",
                          params: { allowedValues: Bs.properties.instrumentType.enum },
                        },
                      ]),
                      !1
                    );
                  var s = a === t;
                } else var s = !0;
                if (s) {
                  if (e.currency !== void 0) {
                    let c = t;
                    if (e.currency !== "USD")
                      return (
                        (pe.errors = [
                          {
                            instancePath: r + "/currency",
                            schemaPath: "#/properties/currency/const",
                            keyword: "const",
                            params: { allowedValue: "USD" },
                          },
                        ]),
                        !1
                      );
                    var s = c === t;
                  } else var s = !0;
                  if (s)
                    if (e.addedAt !== void 0) {
                      let c = e.addedAt,
                        a = t;
                      if (t === a && t === a)
                        if (typeof c == "string")
                          if (or.test(c)) {
                            if (!pr.test(c))
                              return (
                                (pe.errors = [
                                  {
                                    instancePath: r + "/addedAt",
                                    schemaPath: "#/properties/addedAt/format",
                                    keyword: "format",
                                    params: { format: "date-time" },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (pe.errors = [
                                {
                                  instancePath: r + "/addedAt",
                                  schemaPath: "#/properties/addedAt/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "Z$" },
                                },
                              ]),
                              !1
                            );
                        else
                          return (
                            (pe.errors = [
                              {
                                instancePath: r + "/addedAt",
                                schemaPath: "#/properties/addedAt/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = a === t;
                    } else var s = !0;
                }
              }
            }
          }
        }
      } else
        return (
          (pe.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((pe.errors = i), t === 0);
  }
  pe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Se(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Se.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if ((e.kind === void 0 && (w = "kind")) || (e.items === void 0 && (w = "items")))
          return (
            (Se.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(a === "kind" || a === "items")) {
              return (
                (Se.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.kind !== void 0) {
              let a = t;
              if (e.kind !== "watchlist")
                return (
                  (Se.errors = [
                    {
                      instancePath: r + "/kind",
                      schemaPath: "#/properties/kind/const",
                      keyword: "const",
                      params: { allowedValue: "watchlist" },
                    },
                  ]),
                  !1
                );
              var s = a === t;
            } else var s = !0;
            if (s)
              if (e.items !== void 0) {
                let a = e.items,
                  o = t;
                if (t === o)
                  if (Array.isArray(a)) {
                    if (a.length > 50)
                      return (
                        (Se.errors = [
                          {
                            instancePath: r + "/items",
                            schemaPath: "#/properties/items/maxItems",
                            keyword: "maxItems",
                            params: { limit: 50 },
                          },
                        ]),
                        !1
                      );
                    if (a.length < 0)
                      return (
                        (Se.errors = [
                          {
                            instancePath: r + "/items",
                            schemaPath: "#/properties/items/minItems",
                            keyword: "minItems",
                            params: { limit: 0 },
                          },
                        ]),
                        !1
                      );
                    {
                      var u = !0;
                      let p = a.length;
                      for (let h = 0; h < p; h++) {
                        let v = t;
                        pe(a[h], {
                          instancePath: r + "/items/" + h,
                          parentData: a,
                          parentDataProperty: h,
                          rootData: d,
                          dynamicAnchors: y,
                        }) || ((i = i === null ? pe.errors : i.concat(pe.errors)), (t = i.length));
                        var u = v === t;
                        if (!u) break;
                      }
                    }
                  } else
                    return (
                      (Se.errors = [
                        {
                          instancePath: r + "/items",
                          schemaPath: "#/properties/items/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ]),
                      !1
                    );
                var s = o === t;
              } else var s = !0;
          }
        }
      } else
        return (
          (Se.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Se.errors = i), t === 0);
  }
  Se.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Q(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = Q.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.followId === void 0 && (u = "followId")) ||
          (e.name === void 0 && (u = "name")) ||
          (e.handleOrUrl === void 0 && (u = "handleOrUrl")) ||
          (e.note === void 0 && (u = "note")) ||
          (e.verification === void 0 && (u = "verification")) ||
          (e.addedAt === void 0 && (u = "addedAt"))
        )
          return (
            (Q.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(
              c === "followId" ||
              c === "name" ||
              c === "handleOrUrl" ||
              c === "note" ||
              c === "verification" ||
              c === "addedAt"
            )) {
              return (
                (Q.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.followId !== void 0) {
              let c = e.followId,
                a = t;
              if (t === a)
                if (typeof c == "string") {
                  if (k(c) > 128)
                    return (
                      (Q.errors = [
                        {
                          instancePath: r + "/followId",
                          schemaPath: "#/properties/followId/maxLength",
                          keyword: "maxLength",
                          params: { limit: 128 },
                        },
                      ]),
                      !1
                    );
                  if (k(c) < 1)
                    return (
                      (Q.errors = [
                        {
                          instancePath: r + "/followId",
                          schemaPath: "#/properties/followId/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!q.test(c))
                    return (
                      (Q.errors = [
                        {
                          instancePath: r + "/followId",
                          schemaPath: "#/properties/followId/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (Q.errors = [
                      {
                        instancePath: r + "/followId",
                        schemaPath: "#/properties/followId/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.name !== void 0) {
                let c = e.name,
                  a = t;
                if (t === a)
                  if (typeof c == "string") {
                    if (k(c) > 120)
                      return (
                        (Q.errors = [
                          {
                            instancePath: r + "/name",
                            schemaPath: "#/properties/name/maxLength",
                            keyword: "maxLength",
                            params: { limit: 120 },
                          },
                        ]),
                        !1
                      );
                    if (k(c) < 1)
                      return (
                        (Q.errors = [
                          {
                            instancePath: r + "/name",
                            schemaPath: "#/properties/name/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (Q.errors = [
                        {
                          instancePath: r + "/name",
                          schemaPath: "#/properties/name/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = a === t;
              } else var s = !0;
              if (s) {
                if (e.handleOrUrl !== void 0) {
                  let c = e.handleOrUrl,
                    a = t;
                  if (t === a)
                    if (typeof c == "string") {
                      if (k(c) > 256)
                        return (
                          (Q.errors = [
                            {
                              instancePath: r + "/handleOrUrl",
                              schemaPath: "#/properties/handleOrUrl/maxLength",
                              keyword: "maxLength",
                              params: { limit: 256 },
                            },
                          ]),
                          !1
                        );
                      if (k(c) < 1)
                        return (
                          (Q.errors = [
                            {
                              instancePath: r + "/handleOrUrl",
                              schemaPath: "#/properties/handleOrUrl/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (Q.errors = [
                          {
                            instancePath: r + "/handleOrUrl",
                            schemaPath: "#/properties/handleOrUrl/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = a === t;
                } else var s = !0;
                if (s) {
                  if (e.note !== void 0) {
                    let c = e.note,
                      a = t;
                    if (t === a)
                      if (typeof c == "string") {
                        if (k(c) > 1e3)
                          return (
                            (Q.errors = [
                              {
                                instancePath: r + "/note",
                                schemaPath: "#/properties/note/maxLength",
                                keyword: "maxLength",
                                params: { limit: 1e3 },
                              },
                            ]),
                            !1
                          );
                        if (k(c) < 0)
                          return (
                            (Q.errors = [
                              {
                                instancePath: r + "/note",
                                schemaPath: "#/properties/note/minLength",
                                keyword: "minLength",
                                params: { limit: 0 },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (Q.errors = [
                            {
                              instancePath: r + "/note",
                              schemaPath: "#/properties/note/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = a === t;
                  } else var s = !0;
                  if (s) {
                    if (e.verification !== void 0) {
                      let c = t;
                      if (e.verification !== "user_provided")
                        return (
                          (Q.errors = [
                            {
                              instancePath: r + "/verification",
                              schemaPath: "#/properties/verification/const",
                              keyword: "const",
                              params: { allowedValue: "user_provided" },
                            },
                          ]),
                          !1
                        );
                      var s = c === t;
                    } else var s = !0;
                    if (s)
                      if (e.addedAt !== void 0) {
                        let c = e.addedAt,
                          a = t;
                        if (t === a && t === a)
                          if (typeof c == "string")
                            if (or.test(c)) {
                              if (!pr.test(c))
                                return (
                                  (Q.errors = [
                                    {
                                      instancePath: r + "/addedAt",
                                      schemaPath: "#/properties/addedAt/format",
                                      keyword: "format",
                                      params: { format: "date-time" },
                                    },
                                  ]),
                                  !1
                                );
                            } else
                              return (
                                (Q.errors = [
                                  {
                                    instancePath: r + "/addedAt",
                                    schemaPath: "#/properties/addedAt/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "Z$" },
                                  },
                                ]),
                                !1
                              );
                          else
                            return (
                              (Q.errors = [
                                {
                                  instancePath: r + "/addedAt",
                                  schemaPath: "#/properties/addedAt/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var s = a === t;
                      } else var s = !0;
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (Q.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Q.errors = i), t === 0);
  }
  Q.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function _e(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = _e.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.kind === void 0 && (w = "kind")) ||
          (e.items === void 0 && (w = "items")) ||
          (e.readableMaterialCount === void 0 && (w = "readableMaterialCount"))
        )
          return (
            (_e.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(a === "kind" || a === "items" || a === "readableMaterialCount")) {
              return (
                (_e.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.kind !== void 0) {
              let a = t;
              if (e.kind !== "channel_follows")
                return (
                  (_e.errors = [
                    {
                      instancePath: r + "/kind",
                      schemaPath: "#/properties/kind/const",
                      keyword: "const",
                      params: { allowedValue: "channel_follows" },
                    },
                  ]),
                  !1
                );
              var s = a === t;
            } else var s = !0;
            if (s) {
              if (e.items !== void 0) {
                let a = e.items,
                  o = t;
                if (t === o)
                  if (Array.isArray(a)) {
                    if (a.length > 50)
                      return (
                        (_e.errors = [
                          {
                            instancePath: r + "/items",
                            schemaPath: "#/properties/items/maxItems",
                            keyword: "maxItems",
                            params: { limit: 50 },
                          },
                        ]),
                        !1
                      );
                    if (a.length < 0)
                      return (
                        (_e.errors = [
                          {
                            instancePath: r + "/items",
                            schemaPath: "#/properties/items/minItems",
                            keyword: "minItems",
                            params: { limit: 0 },
                          },
                        ]),
                        !1
                      );
                    {
                      var u = !0;
                      let p = a.length;
                      for (let h = 0; h < p; h++) {
                        let v = t;
                        Q(a[h], {
                          instancePath: r + "/items/" + h,
                          parentData: a,
                          parentDataProperty: h,
                          rootData: d,
                          dynamicAnchors: y,
                        }) || ((i = i === null ? Q.errors : i.concat(Q.errors)), (t = i.length));
                        var u = v === t;
                        if (!u) break;
                      }
                    }
                  } else
                    return (
                      (_e.errors = [
                        {
                          instancePath: r + "/items",
                          schemaPath: "#/properties/items/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ]),
                      !1
                    );
                var s = o === t;
              } else var s = !0;
              if (s)
                if (e.readableMaterialCount !== void 0) {
                  let a = t;
                  if (e.readableMaterialCount !== 0)
                    return (
                      (_e.errors = [
                        {
                          instancePath: r + "/readableMaterialCount",
                          schemaPath: "#/properties/readableMaterialCount/const",
                          keyword: "const",
                          params: { allowedValue: 0 },
                        },
                      ]),
                      !1
                    );
                  var s = a === t;
                } else var s = !0;
            }
          }
        }
      } else
        return (
          (_e.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((_e.errors = i), t === 0);
  }
  _e.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ar(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ar.evaluated;
    (m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0));
    let s = t,
      u = !1,
      w = null,
      c = t;
    U(e, {
      instancePath: r,
      parentData: l,
      parentDataProperty: f,
      rootData: d,
      dynamicAnchors: y,
    }) || ((i = i === null ? U.errors : i.concat(U.errors)), (t = i.length));
    var n = c === t;
    if (n) {
      ((u = !0), (w = 0));
      var a = !0;
    }
    let o = t;
    Se(e, {
      instancePath: r,
      parentData: l,
      parentDataProperty: f,
      rootData: d,
      dynamicAnchors: y,
    }) || ((i = i === null ? Se.errors : i.concat(Se.errors)), (t = i.length));
    var n = o === t;
    if (n && u) ((u = !1), (w = [w, 1]));
    else {
      n && ((u = !0), (w = 1), a !== !0 && (a = !0));
      let p = t;
      _e(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? _e.errors : i.concat(_e.errors)), (t = i.length));
      var n = p === t;
      n && u ? ((u = !1), (w = [w, 2])) : n && ((u = !0), (w = 2), a !== !0 && (a = !0));
    }
    if (u) ((t = s), i !== null && (s ? (i.length = s) : (i = null)));
    else {
      let p = {
        instancePath: r,
        schemaPath: "#/oneOf",
        keyword: "oneOf",
        params: { passingSchemas: w },
      };
      return (i === null ? (i = [p]) : i.push(p), t++, (ar.errors = i), !1);
    }
    return ((ar.errors = i), (m.props = a), t === 0);
  }
  ar.evaluated = { dynamicProps: !0, dynamicItems: !1 };
  function te(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = te.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.state === void 0 && (w = "state")) ||
          (e.coverage === void 0 && (w = "coverage")) ||
          (e.sourceAsOf === void 0 && (w = "sourceAsOf")) ||
          (e.fetchedAt === void 0 && (w = "fetchedAt")) ||
          (e.freshness === void 0 && (w = "freshness")) ||
          (e.data === void 0 && (w = "data"))
        )
          return (
            (te.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(
              a === "state" ||
              a === "coverage" ||
              a === "sourceAsOf" ||
              a === "fetchedAt" ||
              a === "freshness" ||
              a === "data"
            )) {
              return (
                (te.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.state !== void 0) {
              let a = e.state,
                o = t;
              if (!(a === "ready" || a === "empty"))
                return (
                  (te.errors = [
                    {
                      instancePath: r + "/state",
                      schemaPath: "#/properties/state/enum",
                      keyword: "enum",
                      params: { allowedValues: Di.properties.state.enum },
                    },
                  ]),
                  !1
                );
              var s = o === t;
            } else var s = !0;
            if (s) {
              if (e.coverage !== void 0) {
                let a = t;
                he(e.coverage, {
                  instancePath: r + "/coverage",
                  parentData: e,
                  parentDataProperty: "coverage",
                  rootData: d,
                  dynamicAnchors: y,
                }) || ((i = i === null ? he.errors : i.concat(he.errors)), (t = i.length));
                var s = a === t;
              } else var s = !0;
              if (s) {
                if (e.sourceAsOf !== void 0) {
                  let a = e.sourceAsOf,
                    o = t,
                    n = t,
                    p = !1,
                    h = t;
                  if (t === h && t === h)
                    if (typeof a == "string")
                      if (k(a) > 40) {
                        let P = {
                          instancePath: r + "/sourceAsOf",
                          schemaPath: "#/properties/sourceAsOf/anyOf/0/maxLength",
                          keyword: "maxLength",
                          params: { limit: 40 },
                        };
                        (i === null ? (i = [P]) : i.push(P), t++);
                      } else if (k(a) < 1) {
                        let P = {
                          instancePath: r + "/sourceAsOf",
                          schemaPath: "#/properties/sourceAsOf/anyOf/0/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        };
                        (i === null ? (i = [P]) : i.push(P), t++);
                      } else if (or.test(a)) {
                        if (!pr.test(a)) {
                          let P = {
                            instancePath: r + "/sourceAsOf",
                            schemaPath: "#/properties/sourceAsOf/anyOf/0/format",
                            keyword: "format",
                            params: { format: "date-time" },
                          };
                          (i === null ? (i = [P]) : i.push(P), t++);
                        }
                      } else {
                        let P = {
                          instancePath: r + "/sourceAsOf",
                          schemaPath: "#/properties/sourceAsOf/anyOf/0/pattern",
                          keyword: "pattern",
                          params: { pattern: "Z$" },
                        };
                        (i === null ? (i = [P]) : i.push(P), t++);
                      }
                    else {
                      let P = {
                        instancePath: r + "/sourceAsOf",
                        schemaPath: "#/properties/sourceAsOf/anyOf/0/type",
                        keyword: "type",
                        params: { type: "string" },
                      };
                      (i === null ? (i = [P]) : i.push(P), t++);
                    }
                  var u = h === t;
                  p = p || u;
                  let v = t;
                  if (a !== null) {
                    let P = {
                      instancePath: r + "/sourceAsOf",
                      schemaPath: "#/properties/sourceAsOf/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (i === null ? (i = [P]) : i.push(P), t++);
                  }
                  var u = v === t;
                  if (((p = p || u), p)) ((t = n), i !== null && (n ? (i.length = n) : (i = null)));
                  else {
                    let P = {
                      instancePath: r + "/sourceAsOf",
                      schemaPath: "#/properties/sourceAsOf/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (i === null ? (i = [P]) : i.push(P), t++, (te.errors = i), !1);
                  }
                  var s = o === t;
                } else var s = !0;
                if (s) {
                  if (e.fetchedAt !== void 0) {
                    let a = e.fetchedAt,
                      o = t;
                    if (t === o && t === o)
                      if (typeof a == "string") {
                        if (k(a) > 40)
                          return (
                            (te.errors = [
                              {
                                instancePath: r + "/fetchedAt",
                                schemaPath: "#/properties/fetchedAt/maxLength",
                                keyword: "maxLength",
                                params: { limit: 40 },
                              },
                            ]),
                            !1
                          );
                        if (k(a) < 1)
                          return (
                            (te.errors = [
                              {
                                instancePath: r + "/fetchedAt",
                                schemaPath: "#/properties/fetchedAt/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (or.test(a)) {
                          if (!pr.test(a))
                            return (
                              (te.errors = [
                                {
                                  instancePath: r + "/fetchedAt",
                                  schemaPath: "#/properties/fetchedAt/format",
                                  keyword: "format",
                                  params: { format: "date-time" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (te.errors = [
                              {
                                instancePath: r + "/fetchedAt",
                                schemaPath: "#/properties/fetchedAt/pattern",
                                keyword: "pattern",
                                params: { pattern: "Z$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (te.errors = [
                            {
                              instancePath: r + "/fetchedAt",
                              schemaPath: "#/properties/fetchedAt/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = o === t;
                  } else var s = !0;
                  if (s) {
                    if (e.freshness !== void 0) {
                      let a = e.freshness,
                        o = t;
                      if (!(a === "fresh" || a === "stale" || a === "unknown"))
                        return (
                          (te.errors = [
                            {
                              instancePath: r + "/freshness",
                              schemaPath: "#/properties/freshness/enum",
                              keyword: "enum",
                              params: { allowedValues: Di.properties.freshness.enum },
                            },
                          ]),
                          !1
                        );
                      var s = o === t;
                    } else var s = !0;
                    if (s)
                      if (e.data !== void 0) {
                        let a = t;
                        ar(e.data, {
                          instancePath: r + "/data",
                          parentData: e,
                          parentDataProperty: "data",
                          rootData: d,
                          dynamicAnchors: y,
                        }) || ((i = i === null ? ar.errors : i.concat(ar.errors)), (t = i.length));
                        var s = a === t;
                      } else var s = !0;
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (te.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((te.errors = i), t === 0);
  }
  te.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ke(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ke.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.sectionId === void 0 && (u = "sectionId")) ||
          (e.markdown === void 0 && (u = "markdown"))
        )
          return (
            (ke.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let w = t;
          for (let c in e)
            if (!(c === "sectionId" || c === "markdown")) {
              return (
                (ke.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === t) {
            if (e.sectionId !== void 0) {
              let c = e.sectionId,
                a = t;
              if (t === a)
                if (typeof c == "string") {
                  if (k(c) > 128)
                    return (
                      (ke.errors = [
                        {
                          instancePath: r + "/sectionId",
                          schemaPath: "#/properties/sectionId/maxLength",
                          keyword: "maxLength",
                          params: { limit: 128 },
                        },
                      ]),
                      !1
                    );
                  if (k(c) < 1)
                    return (
                      (ke.errors = [
                        {
                          instancePath: r + "/sectionId",
                          schemaPath: "#/properties/sectionId/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!q.test(c))
                    return (
                      (ke.errors = [
                        {
                          instancePath: r + "/sectionId",
                          schemaPath: "#/properties/sectionId/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (ke.errors = [
                      {
                        instancePath: r + "/sectionId",
                        schemaPath: "#/properties/sectionId/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = a === t;
            } else var s = !0;
            if (s)
              if (e.markdown !== void 0) {
                let c = e.markdown,
                  a = t;
                if (t === a)
                  if (typeof c == "string") {
                    if (k(c) > 16384)
                      return (
                        (ke.errors = [
                          {
                            instancePath: r + "/markdown",
                            schemaPath: "#/properties/markdown/maxLength",
                            keyword: "maxLength",
                            params: { limit: 16384 },
                          },
                        ]),
                        !1
                      );
                    if (k(c) < 0)
                      return (
                        (ke.errors = [
                          {
                            instancePath: r + "/markdown",
                            schemaPath: "#/properties/markdown/minLength",
                            keyword: "minLength",
                            params: { limit: 0 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (ke.errors = [
                        {
                          instancePath: r + "/markdown",
                          schemaPath: "#/properties/markdown/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = a === t;
              } else var s = !0;
          }
        }
      } else
        return (
          (ke.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ke.errors = i), t === 0);
  }
  ke.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Ws = new RegExp("^https://", "u"),
    Fs = /^https:\/\/[^\s\\]+$/;
  function re(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = re.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let w;
        if (
          (e.citationId === void 0 && (w = "citationId")) ||
          (e.title === void 0 && (w = "title")) ||
          (e.url === void 0 && (w = "url")) ||
          (e.provenance === void 0 && (w = "provenance")) ||
          (e.publishedAt === void 0 && (w = "publishedAt"))
        )
          return (
            (re.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let c = t;
          for (let a in e)
            if (!(
              a === "citationId" ||
              a === "title" ||
              a === "url" ||
              a === "provenance" ||
              a === "publishedAt"
            )) {
              return (
                (re.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: a },
                  },
                ]),
                !1
              );
              break;
            }
          if (c === t) {
            if (e.citationId !== void 0) {
              let a = e.citationId,
                o = t;
              if (t === o)
                if (typeof a == "string") {
                  if (k(a) > 128)
                    return (
                      (re.errors = [
                        {
                          instancePath: r + "/citationId",
                          schemaPath: "#/properties/citationId/maxLength",
                          keyword: "maxLength",
                          params: { limit: 128 },
                        },
                      ]),
                      !1
                    );
                  if (k(a) < 1)
                    return (
                      (re.errors = [
                        {
                          instancePath: r + "/citationId",
                          schemaPath: "#/properties/citationId/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!q.test(a))
                    return (
                      (re.errors = [
                        {
                          instancePath: r + "/citationId",
                          schemaPath: "#/properties/citationId/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (re.errors = [
                      {
                        instancePath: r + "/citationId",
                        schemaPath: "#/properties/citationId/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = o === t;
            } else var s = !0;
            if (s) {
              if (e.title !== void 0) {
                let a = e.title,
                  o = t;
                if (t === o)
                  if (typeof a == "string") {
                    if (k(a) > 180)
                      return (
                        (re.errors = [
                          {
                            instancePath: r + "/title",
                            schemaPath: "#/properties/title/maxLength",
                            keyword: "maxLength",
                            params: { limit: 180 },
                          },
                        ]),
                        !1
                      );
                    if (k(a) < 1)
                      return (
                        (re.errors = [
                          {
                            instancePath: r + "/title",
                            schemaPath: "#/properties/title/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (re.errors = [
                        {
                          instancePath: r + "/title",
                          schemaPath: "#/properties/title/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = o === t;
              } else var s = !0;
              if (s) {
                if (e.url !== void 0) {
                  let a = e.url,
                    o = t;
                  if (t === o && t === o)
                    if (typeof a == "string") {
                      if (k(a) > 2048)
                        return (
                          (re.errors = [
                            {
                              instancePath: r + "/url",
                              schemaPath: "#/properties/url/maxLength",
                              keyword: "maxLength",
                              params: { limit: 2048 },
                            },
                          ]),
                          !1
                        );
                      if (k(a) < 1)
                        return (
                          (re.errors = [
                            {
                              instancePath: r + "/url",
                              schemaPath: "#/properties/url/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (Ws.test(a)) {
                        if (!Fs.test(a))
                          return (
                            (re.errors = [
                              {
                                instancePath: r + "/url",
                                schemaPath: "#/properties/url/format",
                                keyword: "format",
                                params: { format: "uri" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (re.errors = [
                            {
                              instancePath: r + "/url",
                              schemaPath: "#/properties/url/pattern",
                              keyword: "pattern",
                              params: { pattern: "^https://" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (re.errors = [
                          {
                            instancePath: r + "/url",
                            schemaPath: "#/properties/url/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = o === t;
                } else var s = !0;
                if (s) {
                  if (e.provenance !== void 0) {
                    let a = t;
                    if (e.provenance !== "agent_provided")
                      return (
                        (re.errors = [
                          {
                            instancePath: r + "/provenance",
                            schemaPath: "#/properties/provenance/const",
                            keyword: "const",
                            params: { allowedValue: "agent_provided" },
                          },
                        ]),
                        !1
                      );
                    var s = a === t;
                  } else var s = !0;
                  if (s)
                    if (e.publishedAt !== void 0) {
                      let a = e.publishedAt,
                        o = t,
                        n = t,
                        p = !1,
                        h = t;
                      if (t === h && t === h)
                        if (typeof a == "string")
                          if (or.test(a)) {
                            if (!pr.test(a)) {
                              let P = {
                                instancePath: r + "/publishedAt",
                                schemaPath: "#/properties/publishedAt/anyOf/0/format",
                                keyword: "format",
                                params: { format: "date-time" },
                              };
                              (i === null ? (i = [P]) : i.push(P), t++);
                            }
                          } else {
                            let P = {
                              instancePath: r + "/publishedAt",
                              schemaPath: "#/properties/publishedAt/anyOf/0/pattern",
                              keyword: "pattern",
                              params: { pattern: "Z$" },
                            };
                            (i === null ? (i = [P]) : i.push(P), t++);
                          }
                        else {
                          let P = {
                            instancePath: r + "/publishedAt",
                            schemaPath: "#/properties/publishedAt/anyOf/0/type",
                            keyword: "type",
                            params: { type: "string" },
                          };
                          (i === null ? (i = [P]) : i.push(P), t++);
                        }
                      var u = h === t;
                      p = p || u;
                      let v = t;
                      if (a !== null) {
                        let P = {
                          instancePath: r + "/publishedAt",
                          schemaPath: "#/properties/publishedAt/anyOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                        };
                        (i === null ? (i = [P]) : i.push(P), t++);
                      }
                      var u = v === t;
                      if (((p = p || u), p))
                        ((t = n), i !== null && (n ? (i.length = n) : (i = null)));
                      else {
                        let P = {
                          instancePath: r + "/publishedAt",
                          schemaPath: "#/properties/publishedAt/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        return (i === null ? (i = [P]) : i.push(P), t++, (re.errors = i), !1);
                      }
                      var s = o === t;
                    } else var s = !0;
                }
              }
            }
          }
        }
      } else
        return (
          (re.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((re.errors = i), t === 0);
  }
  re.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function G(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = G.evaluated;
    if ((m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0), t === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let a;
        if (
          (e.title === void 0 && (a = "title")) ||
          (e.summary === void 0 && (a = "summary")) ||
          (e.sections === void 0 && (a = "sections")) ||
          (e.citations === void 0 && (a = "citations")) ||
          (e.limitations === void 0 && (a = "limitations"))
        )
          return (
            (G.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: a },
              },
            ]),
            !1
          );
        {
          let o = t;
          for (let n in e)
            if (!(
              n === "title" ||
              n === "summary" ||
              n === "sections" ||
              n === "citations" ||
              n === "limitations"
            )) {
              return (
                (G.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: n },
                  },
                ]),
                !1
              );
              break;
            }
          if (o === t) {
            if (e.title !== void 0) {
              let n = e.title,
                p = t;
              if (t === p)
                if (typeof n == "string") {
                  if (k(n) > 160)
                    return (
                      (G.errors = [
                        {
                          instancePath: r + "/title",
                          schemaPath: "#/properties/title/maxLength",
                          keyword: "maxLength",
                          params: { limit: 160 },
                        },
                      ]),
                      !1
                    );
                  if (k(n) < 1)
                    return (
                      (G.errors = [
                        {
                          instancePath: r + "/title",
                          schemaPath: "#/properties/title/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (G.errors = [
                      {
                        instancePath: r + "/title",
                        schemaPath: "#/properties/title/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = p === t;
            } else var s = !0;
            if (s) {
              if (e.summary !== void 0) {
                let n = e.summary,
                  p = t;
                if (t === p)
                  if (typeof n == "string") {
                    if (k(n) > 600)
                      return (
                        (G.errors = [
                          {
                            instancePath: r + "/summary",
                            schemaPath: "#/properties/summary/maxLength",
                            keyword: "maxLength",
                            params: { limit: 600 },
                          },
                        ]),
                        !1
                      );
                    if (k(n) < 1)
                      return (
                        (G.errors = [
                          {
                            instancePath: r + "/summary",
                            schemaPath: "#/properties/summary/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (G.errors = [
                        {
                          instancePath: r + "/summary",
                          schemaPath: "#/properties/summary/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = p === t;
              } else var s = !0;
              if (s) {
                if (e.sections !== void 0) {
                  let n = e.sections,
                    p = t;
                  if (t === p)
                    if (Array.isArray(n)) {
                      if (n.length > 8)
                        return (
                          (G.errors = [
                            {
                              instancePath: r + "/sections",
                              schemaPath: "#/properties/sections/maxItems",
                              keyword: "maxItems",
                              params: { limit: 8 },
                            },
                          ]),
                          !1
                        );
                      if (n.length < 1)
                        return (
                          (G.errors = [
                            {
                              instancePath: r + "/sections",
                              schemaPath: "#/properties/sections/minItems",
                              keyword: "minItems",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      {
                        var u = !0;
                        let v = n.length;
                        for (let g = 0; g < v; g++) {
                          let P = t;
                          ke(n[g], {
                            instancePath: r + "/sections/" + g,
                            parentData: n,
                            parentDataProperty: g,
                            rootData: d,
                            dynamicAnchors: y,
                          }) ||
                            ((i = i === null ? ke.errors : i.concat(ke.errors)), (t = i.length));
                          var u = P === t;
                          if (!u) break;
                        }
                      }
                    } else
                      return (
                        (G.errors = [
                          {
                            instancePath: r + "/sections",
                            schemaPath: "#/properties/sections/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ]),
                        !1
                      );
                  var s = p === t;
                } else var s = !0;
                if (s) {
                  if (e.citations !== void 0) {
                    let n = e.citations,
                      p = t;
                    if (t === p)
                      if (Array.isArray(n)) {
                        if (n.length > 20)
                          return (
                            (G.errors = [
                              {
                                instancePath: r + "/citations",
                                schemaPath: "#/properties/citations/maxItems",
                                keyword: "maxItems",
                                params: { limit: 20 },
                              },
                            ]),
                            !1
                          );
                        if (n.length < 0)
                          return (
                            (G.errors = [
                              {
                                instancePath: r + "/citations",
                                schemaPath: "#/properties/citations/minItems",
                                keyword: "minItems",
                                params: { limit: 0 },
                              },
                            ]),
                            !1
                          );
                        {
                          var w = !0;
                          let v = n.length;
                          for (let g = 0; g < v; g++) {
                            let P = t;
                            re(n[g], {
                              instancePath: r + "/citations/" + g,
                              parentData: n,
                              parentDataProperty: g,
                              rootData: d,
                              dynamicAnchors: y,
                            }) ||
                              ((i = i === null ? re.errors : i.concat(re.errors)), (t = i.length));
                            var w = P === t;
                            if (!w) break;
                          }
                        }
                      } else
                        return (
                          (G.errors = [
                            {
                              instancePath: r + "/citations",
                              schemaPath: "#/properties/citations/type",
                              keyword: "type",
                              params: { type: "array" },
                            },
                          ]),
                          !1
                        );
                    var s = p === t;
                  } else var s = !0;
                  if (s)
                    if (e.limitations !== void 0) {
                      let n = e.limitations,
                        p = t;
                      if (t === p)
                        if (Array.isArray(n)) {
                          if (n.length > 20)
                            return (
                              (G.errors = [
                                {
                                  instancePath: r + "/limitations",
                                  schemaPath: "#/properties/limitations/maxItems",
                                  keyword: "maxItems",
                                  params: { limit: 20 },
                                },
                              ]),
                              !1
                            );
                          if (n.length < 0)
                            return (
                              (G.errors = [
                                {
                                  instancePath: r + "/limitations",
                                  schemaPath: "#/properties/limitations/minItems",
                                  keyword: "minItems",
                                  params: { limit: 0 },
                                },
                              ]),
                              !1
                            );
                          {
                            var c = !0;
                            let v = n.length;
                            for (let g = 0; g < v; g++) {
                              let P = n[g],
                                b = t;
                              if (t === b)
                                if (typeof P == "string") {
                                  if (k(P) > 500)
                                    return (
                                      (G.errors = [
                                        {
                                          instancePath: r + "/limitations/" + g,
                                          schemaPath: "#/properties/limitations/items/maxLength",
                                          keyword: "maxLength",
                                          params: { limit: 500 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (k(P) < 1)
                                    return (
                                      (G.errors = [
                                        {
                                          instancePath: r + "/limitations/" + g,
                                          schemaPath: "#/properties/limitations/items/minLength",
                                          keyword: "minLength",
                                          params: { limit: 1 },
                                        },
                                      ]),
                                      !1
                                    );
                                } else
                                  return (
                                    (G.errors = [
                                      {
                                        instancePath: r + "/limitations/" + g,
                                        schemaPath: "#/properties/limitations/items/type",
                                        keyword: "type",
                                        params: { type: "string" },
                                      },
                                    ]),
                                    !1
                                  );
                              var c = b === t;
                              if (!c) break;
                            }
                          }
                        } else
                          return (
                            (G.errors = [
                              {
                                instancePath: r + "/limitations",
                                schemaPath: "#/properties/limitations/type",
                                keyword: "type",
                                params: { type: "array" },
                              },
                            ]),
                            !1
                          );
                      var s = p === t;
                    } else var s = !0;
                }
              }
            }
          }
        }
      } else
        return (
          (G.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((G.errors = i), t === 0);
  }
  G.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ee(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ee.evaluated;
    (m.dynamicProps && (m.props = void 0), m.dynamicItems && (m.items = void 0));
    let s = t,
      u = t,
      w = !0,
      c = t;
    if (
      e &&
      typeof e == "object" &&
      !Array.isArray(e) &&
      e.objectType !== void 0 &&
      e.objectType !== "task"
    ) {
      let _ = {};
      (i === null ? (i = [_]) : i.push(_), t++);
    }
    var a = c === t;
    if (((t = u), i !== null && (u ? (i.length = u) : (i = null)), a)) {
      let _ = t;
      e &&
        typeof e == "object" &&
        !Array.isArray(e) &&
        e.payload !== void 0 &&
        (ye(e.payload, {
          instancePath: r + "/payload",
          parentData: e,
          parentDataProperty: "payload",
          rootData: d,
          dynamicAnchors: y,
        }) ||
          ((i = i === null ? ye.errors : i.concat(ye.errors)), (t = i.length)));
      var a = _ === t;
      if (((w = a), w)) {
        var o = {};
        ((o.payload = !0), (o.objectType = !0));
      }
    }
    if (!w) {
      let _ = {
        instancePath: r,
        schemaPath: "#/allOf/0/if",
        keyword: "if",
        params: { failingKeyword: "then" },
      };
      return (i === null ? (i = [_]) : i.push(_), t++, (ee.errors = i), !1);
    }
    var n = s === t;
    if (n) {
      let _ = t,
        N = t,
        L = !0,
        S = t;
      if (
        e &&
        typeof e == "object" &&
        !Array.isArray(e) &&
        e.objectType !== void 0 &&
        e.objectType !== "holdings_snapshot"
      ) {
        let T = {};
        (i === null ? (i = [T]) : i.push(T), t++);
      }
      var p = S === t;
      if (((t = N), i !== null && (N ? (i.length = N) : (i = null)), p)) {
        let T = t;
        e &&
          typeof e == "object" &&
          !Array.isArray(e) &&
          e.payload !== void 0 &&
          (te(e.payload, {
            instancePath: r + "/payload",
            parentData: e,
            parentDataProperty: "payload",
            rootData: d,
            dynamicAnchors: y,
          }) ||
            ((i = i === null ? te.errors : i.concat(te.errors)), (t = i.length)));
        var p = T === t;
        if (((L = p), L)) {
          var h = {};
          ((h.payload = !0), (h.objectType = !0));
        }
      }
      if (!L) {
        let T = {
          instancePath: r,
          schemaPath: "#/allOf/1/if",
          keyword: "if",
          params: { failingKeyword: "then" },
        };
        return (i === null ? (i = [T]) : i.push(T), t++, (ee.errors = i), !1);
      }
      var n = _ === t;
      if (n) {
        o !== !0 && h !== void 0 && (h === !0 ? (o = !0) : ((o = o || {}), Object.assign(o, h)));
        let T = t,
          Y = t,
          I = !0,
          Fi = t;
        if (
          e &&
          typeof e == "object" &&
          !Array.isArray(e) &&
          e.objectType !== void 0 &&
          e.objectType !== "watchlist_evidence"
        ) {
          let Ze = {};
          (i === null ? (i = [Ze]) : i.push(Ze), t++);
        }
        var v = Fi === t;
        if (((t = Y), i !== null && (Y ? (i.length = Y) : (i = null)), v)) {
          let Ze = t;
          e &&
            typeof e == "object" &&
            !Array.isArray(e) &&
            e.payload !== void 0 &&
            (te(e.payload, {
              instancePath: r + "/payload",
              parentData: e,
              parentDataProperty: "payload",
              rootData: d,
              dynamicAnchors: y,
            }) ||
              ((i = i === null ? te.errors : i.concat(te.errors)), (t = i.length)));
          var v = Ze === t;
          if (((I = v), I)) {
            var g = {};
            ((g.payload = !0), (g.objectType = !0));
          }
        }
        if (!I) {
          let Ze = {
            instancePath: r,
            schemaPath: "#/allOf/2/if",
            keyword: "if",
            params: { failingKeyword: "then" },
          };
          return (i === null ? (i = [Ze]) : i.push(Ze), t++, (ee.errors = i), !1);
        }
        var n = T === t;
        if (n) {
          o !== !0 && g !== void 0 && (g === !0 ? (o = !0) : ((o = o || {}), Object.assign(o, g)));
          let Ze = t,
            yt = t,
            ht = !0,
            Ui = t;
          if (
            e &&
            typeof e == "object" &&
            !Array.isArray(e) &&
            e.objectType !== void 0 &&
            e.objectType !== "channel_follows_evidence"
          ) {
            let Ce = {};
            (i === null ? (i = [Ce]) : i.push(Ce), t++);
          }
          var P = Ui === t;
          if (((t = yt), i !== null && (yt ? (i.length = yt) : (i = null)), P)) {
            let Ce = t;
            e &&
              typeof e == "object" &&
              !Array.isArray(e) &&
              e.payload !== void 0 &&
              (te(e.payload, {
                instancePath: r + "/payload",
                parentData: e,
                parentDataProperty: "payload",
                rootData: d,
                dynamicAnchors: y,
              }) ||
                ((i = i === null ? te.errors : i.concat(te.errors)), (t = i.length)));
            var P = Ce === t;
            if (((ht = P), ht)) {
              var b = {};
              ((b.payload = !0), (b.objectType = !0));
            }
          }
          if (!ht) {
            let Ce = {
              instancePath: r,
              schemaPath: "#/allOf/3/if",
              keyword: "if",
              params: { failingKeyword: "then" },
            };
            return (i === null ? (i = [Ce]) : i.push(Ce), t++, (ee.errors = i), !1);
          }
          var n = Ze === t;
          if (n) {
            o !== !0 &&
              b !== void 0 &&
              (b === !0 ? (o = !0) : ((o = o || {}), Object.assign(o, b)));
            let Ce = t,
              gt = t,
              vt = !0,
              Mi = t;
            if (
              e &&
              typeof e == "object" &&
              !Array.isArray(e) &&
              e.objectType !== void 0 &&
              e.objectType !== "result_revision"
            ) {
              let er = {};
              (i === null ? (i = [er]) : i.push(er), t++);
            }
            var A = Mi === t;
            if (((t = gt), i !== null && (gt ? (i.length = gt) : (i = null)), A)) {
              let er = t;
              e &&
                typeof e == "object" &&
                !Array.isArray(e) &&
                e.payload !== void 0 &&
                (G(e.payload, {
                  instancePath: r + "/payload",
                  parentData: e,
                  parentDataProperty: "payload",
                  rootData: d,
                  dynamicAnchors: y,
                }) ||
                  ((i = i === null ? G.errors : i.concat(G.errors)), (t = i.length)));
              var A = er === t;
              if (((vt = A), vt)) {
                var V = {};
                ((V.payload = !0), (V.objectType = !0));
              }
            }
            if (!vt) {
              let er = {
                instancePath: r,
                schemaPath: "#/allOf/4/if",
                keyword: "if",
                params: { failingKeyword: "then" },
              };
              return (i === null ? (i = [er]) : i.push(er), t++, (ee.errors = i), !1);
            }
            var n = Ce === t;
            n &&
              o !== !0 &&
              V !== void 0 &&
              (V === !0 ? (o = !0) : ((o = o || {}), Object.assign(o, V)));
          }
        }
      }
    }
    if (t === 0)
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let _;
        if (
          (e.privateSchemaVersion === void 0 && (_ = "privateSchemaVersion")) ||
          (e.objectId === void 0 && (_ = "objectId")) ||
          (e.objectType === void 0 && (_ = "objectType")) ||
          (e.revision === void 0 && (_ = "revision")) ||
          (e.binding === void 0 && (_ = "binding")) ||
          (e.payload === void 0 && (_ = "payload"))
        )
          return (
            (ee.errors = [
              {
                instancePath: r,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: _ },
              },
            ]),
            !1
          );
        {
          let N = t;
          for (let L in e)
            if (!(
              L === "privateSchemaVersion" ||
              L === "objectId" ||
              L === "objectType" ||
              L === "revision" ||
              L === "binding" ||
              L === "payload"
            )) {
              return (
                (ee.errors = [
                  {
                    instancePath: r,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: L },
                  },
                ]),
                !1
              );
              break;
            }
          if (N === t) {
            if (e.privateSchemaVersion !== void 0) {
              let L = t;
              if (e.privateSchemaVersion !== 2)
                return (
                  (ee.errors = [
                    {
                      instancePath: r + "/privateSchemaVersion",
                      schemaPath: "#/properties/privateSchemaVersion/const",
                      keyword: "const",
                      params: { allowedValue: 2 },
                    },
                  ]),
                  !1
                );
              var W = L === t;
            } else var W = !0;
            if (W) {
              if (e.objectId !== void 0) {
                let L = e.objectId,
                  S = t;
                if (t === S)
                  if (typeof L == "string") {
                    if (k(L) > 128)
                      return (
                        (ee.errors = [
                          {
                            instancePath: r + "/objectId",
                            schemaPath: "#/properties/objectId/maxLength",
                            keyword: "maxLength",
                            params: { limit: 128 },
                          },
                        ]),
                        !1
                      );
                    if (k(L) < 1)
                      return (
                        (ee.errors = [
                          {
                            instancePath: r + "/objectId",
                            schemaPath: "#/properties/objectId/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    if (!q.test(L))
                      return (
                        (ee.errors = [
                          {
                            instancePath: r + "/objectId",
                            schemaPath: "#/properties/objectId/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (ee.errors = [
                        {
                          instancePath: r + "/objectId",
                          schemaPath: "#/properties/objectId/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var W = S === t;
              } else var W = !0;
              if (W) {
                if (e.objectType !== void 0) {
                  let L = e.objectType,
                    S = t;
                  if (!(
                    L === "task" ||
                    L === "holdings_snapshot" ||
                    L === "watchlist_evidence" ||
                    L === "channel_follows_evidence" ||
                    L === "result_revision"
                  ))
                    return (
                      (ee.errors = [
                        {
                          instancePath: r + "/objectType",
                          schemaPath: "#/properties/objectType/enum",
                          keyword: "enum",
                          params: { allowedValues: $s.properties.objectType.enum },
                        },
                      ]),
                      !1
                    );
                  var W = S === t;
                } else var W = !0;
                if (W) {
                  if (e.revision !== void 0) {
                    let L = e.revision,
                      S = t;
                    if (!(typeof L == "number" && !(L % 1) && !isNaN(L)))
                      return (
                        (ee.errors = [
                          {
                            instancePath: r + "/revision",
                            schemaPath: "#/properties/revision/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ]),
                        !1
                      );
                    if (t === S && typeof L == "number") {
                      if (L > 9007199254740991 || isNaN(L))
                        return (
                          (ee.errors = [
                            {
                              instancePath: r + "/revision",
                              schemaPath: "#/properties/revision/maximum",
                              keyword: "maximum",
                              params: { comparison: "<=", limit: 9007199254740991 },
                            },
                          ]),
                          !1
                        );
                      if (L < 1 || isNaN(L))
                        return (
                          (ee.errors = [
                            {
                              instancePath: r + "/revision",
                              schemaPath: "#/properties/revision/minimum",
                              keyword: "minimum",
                              params: { comparison: ">=", limit: 1 },
                            },
                          ]),
                          !1
                        );
                    }
                    var W = S === t;
                  } else var W = !0;
                  if (W) {
                    if (e.binding !== void 0) {
                      let L = t;
                      H(e.binding, {
                        instancePath: r + "/binding",
                        parentData: e,
                        parentDataProperty: "binding",
                        rootData: d,
                        dynamicAnchors: y,
                      }) || ((i = i === null ? H.errors : i.concat(H.errors)), (t = i.length));
                      var W = L === t;
                    } else var W = !0;
                    if (W)
                      if (e.payload !== void 0) {
                        let L = e.payload,
                          S = t;
                        if (!(L && typeof L == "object" && !Array.isArray(L)))
                          return (
                            (ee.errors = [
                              {
                                instancePath: r + "/payload",
                                schemaPath: "#/properties/payload/type",
                                keyword: "type",
                                params: { type: "object" },
                              },
                            ]),
                            !1
                          );
                        var W = S === t;
                      } else var W = !0;
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (ee.errors = [
            { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ee.errors = i), t === 0);
  }
  ee.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ft(
    e,
    {
      instancePath: r = "",
      parentData: l,
      parentDataProperty: f,
      rootData: d = e,
      dynamicAnchors: y = {},
    } = {},
  ) {
    let i = null,
      t = 0,
      m = ft.evaluated;
    return (
      m.dynamicProps && (m.props = void 0),
      m.dynamicItems && (m.items = void 0),
      ee(e, {
        instancePath: r,
        parentData: l,
        parentDataProperty: f,
        rootData: d,
        dynamicAnchors: y,
      }) || ((i = i === null ? ee.errors : i.concat(ee.errors)), (t = i.length)),
      (ft.errors = i),
      t === 0
    );
  }
  ft.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
});
var kr = new TextEncoder(),
  Pt = new TextDecoder(),
  Xt = new TextDecoder("utf-8", { fatal: !0 }),
  Nr = 2 ** 32;
function Oe(...e) {
  let r = e.reduce((d, { length: y }) => d + y, 0),
    l = new Uint8Array(r),
    f = 0;
  for (let d of e) (l.set(d, f), (f += d.length));
  return l;
}
function wt(e, r, l) {
  if (r < 0 || r >= Nr) throw new RangeError(`value must be >= 0 and <= ${Nr - 1}. Received ${r}`);
  e.set([r >>> 24, r >>> 16, r >>> 8, r & 255], l);
}
function Yt(e) {
  let r = Math.floor(e / Nr),
    l = e % Nr,
    f = new Uint8Array(8);
  return (wt(f, r, 0), wt(f, l, 4), f);
}
function Dr(e) {
  let r = new Uint8Array(4);
  return (wt(r, e), r);
}
var is = /[^\x00-\x7f]/;
function $e(e) {
  if (typeof e == "string" && e.length >= 128) {
    if (is.test(e)) throw new TypeError("non-ASCII string encountered in encode()");
    return kr.encode(e);
  }
  let r = new Uint8Array(e.length);
  for (let l = 0; l < e.length; l++) {
    let f = e.charCodeAt(l);
    if (f > 127) throw new TypeError("non-ASCII string encountered in encode()");
    r[l] = f;
  }
  return r;
}
function Qt(e, r = !1) {
  if (Uint8Array.prototype.toBase64)
    return e.toBase64({ alphabet: r ? "base64url" : "base64", omitPadding: r });
  let l = 32768,
    f = [];
  for (let y = 0; y < e.length; y += l)
    f.push(String.fromCharCode.apply(null, e.subarray(y, y + l)));
  let d = btoa(f.join(""));
  return r ? d.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") : d;
}
function ei(e, r = !1) {
  if (Uint8Array.fromBase64)
    return Uint8Array.fromBase64(e, { alphabet: r ? "base64url" : "base64" });
  if (r) {
    if (e.includes("+") || e.includes("/")) throw new TypeError("Invalid base64url");
    e = e.replace(/-/g, "+").replace(/_/g, "/");
  }
  let l = atob(e),
    f = new Uint8Array(l.length);
  for (let d = 0; d < l.length; d++) f[d] = l.charCodeAt(d);
  return f;
}
async function $r(e, r) {
  let l = `SHA-${e.slice(-3)}`;
  return new Uint8Array(await crypto.subtle.digest(l, r));
}
var Je = class extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(r, l) {
    (super(r, l),
      (this.name = this.constructor.name),
      Error.captureStackTrace?.(this, this.constructor));
  }
};
var rr = class extends Je {
    static code = "ERR_JOSE_ALG_NOT_ALLOWED";
    code = "ERR_JOSE_ALG_NOT_ALLOWED";
  },
  F = class extends Je {
    static code = "ERR_JOSE_NOT_SUPPORTED";
    code = "ERR_JOSE_NOT_SUPPORTED";
  },
  Me = class extends Je {
    static code = "ERR_JWE_DECRYPTION_FAILED";
    code = "ERR_JWE_DECRYPTION_FAILED";
    constructor(r = "decryption operation failed", l) {
      super(r, l);
    }
  },
  j = class extends Je {
    static code = "ERR_JWE_INVALID";
    code = "ERR_JWE_INVALID";
  },
  ie = class extends Je {
    static code = "ERR_JWS_INVALID";
    code = "ERR_JWS_INVALID";
  };
var wr = class extends Je {
  static code = "ERR_JWK_INVALID";
  code = "ERR_JWK_INVALID";
};
var Pr = class extends Je {
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(r = "signature verification failed", l) {
    super(r, l);
  }
};
var br = {};
es(br, { decode: () => He, encode: () => Ir });
var ss = "The input to be decoded is not correctly encoded.";
function He(e) {
  try {
    return ei(typeof e == "string" ? e : Pt.decode(e), !0);
  } catch (r) {
    throw new TypeError(ss, { cause: r });
  }
}
function Ir(e) {
  return Qt(typeof e == "string" ? kr.encode(e) : e, !0);
}
function ae(e) {
  if (typeof e != "object" || e === null || Object.prototype.toString.call(e) !== "[object Object]")
    return !1;
  let r = Object.getPrototypeOf(e);
  return r === null || Object.getPrototypeOf(r) === null;
}
function Rr(...e) {
  let r = new Set();
  for (let l of e)
    if (l)
      for (let f of Object.keys(l)) {
        if (r.has(f)) return !1;
        r.add(f);
      }
  return !0;
}
function Ie(e, r, l) {
  try {
    return He(e);
  } catch (f) {
    throw new l(`Failed to base64url decode the ${r}`, { cause: f });
  }
}
function zr(e, r, l) {
  try {
    return $e(e);
  } catch (f) {
    throw new l(`The ${r} is not a valid base64url string`, { cause: f });
  }
}
function Tr(e, r, l) {
  let f;
  try {
    f = JSON.parse(Xt.decode(He(e)));
  } catch (d) {
    throw new r(l, { cause: d });
  }
  if (!ae(f)) throw new r(l);
  return f;
}
var ri = { __proto__: null, b64: !0 },
  ti = { __proto__: null };
function _r(e, r) {
  if (r !== void 0 && (!Array.isArray(r) || r.some((l) => typeof l != "string")))
    throw new TypeError(`"${e}" option must be an array of strings`);
  return r === void 0 ? void 0 : new Set(r);
}
function Vr(e, r, l, f, d) {
  if (d.crit !== void 0 && f?.crit === void 0)
    throw new e('"crit" (Critical) Header Parameter MUST be integrity protected');
  if (!f || f.crit === void 0) return [];
  if (
    !Array.isArray(f.crit) ||
    f.crit.length === 0 ||
    f.crit.some((i) => typeof i != "string" || i.length === 0)
  )
    throw new e(
      '"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present',
    );
  let y = l === void 0 ? r : { __proto__: null, ...l, ...r };
  for (let i of f.crit) {
    if (!(i in y)) throw new F(`Extension Header Parameter "${i}" is not recognized`);
    if (!Object.hasOwn(d, i) || d[i] === void 0)
      throw new e(`Extension Header Parameter "${i}" is missing`);
    if (y[i] && (!Object.hasOwn(f, i) || f[i] === void 0))
      throw new e(`Extension Header Parameter "${i}" MUST be integrity protected`);
  }
  return f.crit;
}
function ii(e, r) {
  if (r.includes("b64")) {
    let l = e.b64;
    if (typeof l != "boolean")
      throw new ie('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    return l;
  }
  return !0;
}
var ns = (e) => e[Symbol.toStringTag],
  as = (e, r, l) => {
    let { alg: f } = e;
    if (r.use !== void 0) {
      let d = l === "sign" || l === "verify" ? "sig" : "enc";
      if (r.use !== d)
        throw new TypeError(
          `Invalid key for this operation, its "use" must be "${d}" when present`,
        );
    }
    if (r.alg !== void 0 && r.alg !== f)
      throw new TypeError(`Invalid key for this operation, its "alg" must be "${f}" when present`);
    if (Array.isArray(r.key_ops)) {
      let d = l === "encrypt" || l === "decrypt" ? e.ops?.[l === "encrypt" ? 0 : 1] : l;
      if (d && !r.key_ops.includes(d))
        throw new TypeError(
          `Invalid key for this operation, its "key_ops" must include "${d}" when present`,
        );
    }
  };
async function Ar(e, r, l) {
  let { alg: f, secret: d } = e,
    y = l === "decrypt" || l === "sign";
  if (d && r instanceof Uint8Array) return r;
  let i, t;
  if (ae(r)) {
    if (((i = Lt(r)), typeof i.kty != "string")) throw si(f, r, d);
    if (
      !(d
        ? i.kty === "oct" && typeof i.k == "string"
        : i.kty !== "oct" &&
          (y
            ? (i.kty === "AKP" && typeof i.priv == "string") || typeof i.d == "string"
            : i.d === void 0 && i.priv === void 0))
    )
      throw new TypeError(
        d
          ? 'JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present'
          : `JSON Web Key for this operation must be a ${y ? "private" : "public"} JWK`,
      );
    if ((as(e, i, l), i.kty === "oct")) return He(i.k);
    if (!Object.isFrozen(r)) {
      let { key_ops: u } = r;
      (Array.isArray(u) && Object.freeze(u), Object.freeze(r));
    }
  } else {
    if (!At(r)) throw si(f, r, d);
    let u = d ? "secret" : y ? "private" : "public";
    if (r.type !== u && (d || ["secret", "public", "private"].includes(r.type)))
      throw new TypeError(`${ns(r)} instances must be of type "${u}" for the ${f} algorithm`);
    if (tr(r)) return r;
    if (((t = r), t.type === "secret")) return t.export();
  }
  It ||= new WeakMap();
  let m = r,
    s = It.get(m);
  if (s?.[f]) return s[f];
  if ((s || It.set(m, (s = {})), t && typeof t.toCryptoKey == "function")) {
    let u = t.type === "public",
      w = os[t.asymmetricKeyDetails?.namedCurve],
      c = e.resolve?.({ crv: w, asymmetricKeyType: t.asymmetricKeyType }) ?? e.subtle;
    return (s[f] = t.toCryptoKey(c, u, e.usages[u ? 0 : 1]));
  }
  return ((i ??= t.export({ format: "jwk" })), (i.alg = f), (s[f] = await lr(e, i)));
}
var It,
  os = { __proto__: null, prime256v1: "P-256", secp384r1: "P-384", secp521r1: "P-521" };
function bt(e) {
  if (!tr(e)) throw new Error("CryptoKey instance expected");
}
var tr = (e) => {
    if (e?.[Symbol.toStringTag] === "CryptoKey") return !0;
    try {
      return e instanceof CryptoKey;
    } catch {
      return !1;
    }
  },
  _t = (e) => e?.[Symbol.toStringTag] === "KeyObject",
  At = (e) => tr(e) || _t(e);
function ni(e, r, ...l) {
  if (l.length > 2) {
    let f = l.pop();
    e += `one of type ${l.join(", ")}, or ${f}.`;
  } else l.length === 2 ? (e += `one of type ${l[0]} or ${l[1]}.`) : (e += `of type ${l[0]}.`);
  return (
    r == null
      ? (e += ` Received ${r}`)
      : typeof r == "function" && r.name
        ? (e += ` Received function ${r.name}`)
        : typeof r == "object" &&
          r != null &&
          r.constructor?.name &&
          (e += ` Received an instance of ${r.constructor.name}`),
    e
  );
}
var Ge = (e, ...r) => ni("Key must be ", e, ...r);
function si(e, r, l) {
  let f = ["CryptoKey", "KeyObject", "JSON Web Key"];
  return (
    l && f.push("Uint8Array"),
    new TypeError(ni(`Key for the ${e} algorithm must be `, r, ...f))
  );
}
var qr = (e, r = "algorithm.name") =>
  new TypeError(`CryptoKey does not support this operation, its ${r} must be ${e}`);
function xt(e, r) {
  if (r && !e.usages.includes(r))
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${r}.`);
}
function Zr(e, r) {
  let { modulusLength: l } = r.algorithm;
  if (typeof l != "number" || l < 2048)
    throw new TypeError(`${e} requires key modulusLength to be 2048 bits or larger`);
}
function Et(e, r, l) {
  let f = e.algorithm;
  if (f.name !== r.name) throw qr(r.name);
  if (r.hash && f.hash?.name !== r.hash) throw qr(r.hash, "algorithm.hash");
  if (r.namedCurve && f.namedCurve !== r.namedCurve) throw qr(r.namedCurve, "algorithm.namedCurve");
  if (r.length !== void 0 && f.length !== r.length) throw qr(r.length, "algorithm.length");
  xt(e, l);
}
function Cr(e) {
  return { __proto__: null, ...e };
}
function Lt(e) {
  let r = Cr(e);
  if (r.ext !== void 0 && typeof r.ext != "boolean")
    throw new TypeError('"ext" (Extractable) Parameter must be a boolean');
  if (r.key_ops !== void 0) {
    let l = r.key_ops,
      f = Array.isArray(l) ? [...l] : void 0;
    if (!f || f.some((d) => typeof d != "string") || new Set(f).size !== f.length)
      throw new TypeError(
        '"key_ops" (Key Operations) Parameter must be an array of unique strings',
      );
    r.key_ops = f;
  }
  return r;
}
function Jr(e) {
  if (e !== void 0 && typeof e != "boolean")
    throw new TypeError('"extractable" option must be a boolean');
  return e;
}
async function lr(e, r, l) {
  if (!e.kty.includes(r.kty))
    throw new F('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
  let f = e.resolve?.({ kty: r.kty, crv: r.crv }) ?? e.subtle,
    d = !!(r.d || r.priv),
    y = { ...r, ext: l ?? r.ext };
  return (
    y.kty !== "AKP" && delete y.alg,
    delete y.use,
    crypto.subtle.importKey("jwk", y, f, y.ext ?? !d, r.key_ops ?? e.usages[d ? 1 : 0])
  );
}
async function ir(e, r, l, f = !1) {
  return (
    e instanceof Uint8Array && (e = await crypto.subtle.importKey("raw", e, r, f, [l])),
    Et(e, r, l),
    e
  );
}
var Br = (e) => crypto.getRandomValues(new Uint8Array(e.cekBits >> 3));
function ai(e, r) {
  let l = e.byteLength << 3;
  if (l !== r)
    throw new j(`Invalid Content Encryption Key length. Expected ${r} bits, got ${l} bits`);
}
function ps(e, r) {
  if (r.length << 3 !== e.ivBits) throw new j("Invalid Initialization Vector length");
}
async function ls(e, r, l) {
  if (!(r instanceof Uint8Array)) throw new TypeError(Ge(r, "Uint8Array"));
  let f = e.cekBits >> 1,
    d = await crypto.subtle.importKey("raw", r.subarray(f >> 3), "AES-CBC", !1, [l]),
    y = await crypto.subtle.importKey(
      "raw",
      r.subarray(0, f >> 3),
      { hash: `SHA-${f << 1}`, name: "HMAC" },
      !1,
      ["sign"],
    );
  return [d, y, f];
}
async function cs(e, r, l) {
  return new Uint8Array((await crypto.subtle.sign("HMAC", e, r)).slice(0, l >> 3));
}
async function fs(e, r) {
  let l = { name: "HMAC", hash: "SHA-256" },
    f = await crypto.subtle.generateKey(l, !1, ["sign", "verify"]),
    d = await crypto.subtle.sign(l, f, e);
  return crypto.subtle.verify(l, f, d, r);
}
async function ms(e, r, l, f, d, y) {
  let [i, t, m] = await ls(e, r, "decrypt"),
    s = Yt(y.length * 8),
    u = Oe(y, f, l, s),
    w = await cs(t, u, m);
  try {
    if (await fs(d, w))
      return new Uint8Array(await crypto.subtle.decrypt({ iv: f, name: "AES-CBC" }, i, l));
  } catch {}
  throw new Me();
}
async function Wr(e, r, l, f, d, y) {
  if (!tr(r) && !(r instanceof Uint8Array))
    throw new TypeError(Ge(r, "CryptoKey", "KeyObject", "Uint8Array", "JSON Web Key"));
  if (!f) throw new j("JWE Initialization Vector missing");
  if (!d) throw new j("JWE Authentication Tag missing");
  if (!e.cbc && d.length !== 16) throw new j("Invalid Authentication Tag length");
  if ((ps(e, f), r instanceof Uint8Array && ai(r, e.cekBits), e.cbc)) return ms(e, r, l, f, d, y);
  let i = await ir(r, e.subtle, "decrypt");
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { additionalData: y, iv: f, name: "AES-GCM", tagLength: 128 },
        i,
        Oe(l, d),
      ),
    );
  } catch {
    throw new Me();
  }
}
function xr(e) {
  let r = { __proto__: null };
  for (let l in e) r[l] = { ...e[l], alg: l };
  return r;
}
var ds = [
    ["encrypt", "wrapKey"],
    ["decrypt", "unwrapKey"],
  ],
  us = [[], ["deriveBits"]],
  Mr = [[], []];
function Fr(e) {
  return {
    kty: ["RSA"],
    mode: "key-encryption",
    subtle: { name: "RSA-OAEP", hash: `SHA-${e}` },
    usages: ds,
    ops: ["wrapKey", "unwrapKey"],
  };
}
function Ur(e) {
  return {
    kty: ["EC", "OKP"],
    mode: e,
    subtle: { name: "ECDH" },
    resolve: ({ kty: r, crv: l, asymmetricKeyType: f }) => {
      if (l === "X25519" || f === "x25519") return { name: "X25519" };
      if (r === "OKP") throw new F('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      return { name: "ECDH", namedCurve: l };
    },
    usages: us,
    ops: [void 0, "deriveBits"],
  };
}
function cr(e, r = !1) {
  return {
    kty: ["oct"],
    mode: "key-wrapping",
    secret: !0,
    subtle: { name: r ? "AES-GCM" : "AES-KW", length: e },
    usages: Mr,
    ops: r ? ["encrypt", "decrypt"] : ["wrapKey", "unwrapKey"],
  };
}
function St() {
  return {
    kty: ["oct"],
    mode: "key-wrapping",
    secret: !0,
    subtle: { name: "PBKDF2" },
    usages: Mr,
    ops: ["deriveBits", "deriveBits"],
  };
}
var sr = xr({
    dir: {
      kty: ["oct"],
      mode: "direct-encryption",
      secret: !0,
      subtle: { name: "AES-GCM" },
      usages: Mr,
      ops: ["encrypt", "decrypt"],
    },
    "RSA-OAEP": Fr(1),
    "RSA-OAEP-256": Fr(256),
    "RSA-OAEP-384": Fr(384),
    "RSA-OAEP-512": Fr(512),
    "ECDH-ES": Ur("direct-key-agreement"),
    "ECDH-ES+A128KW": Ur("key-agreement-with-key-wrapping"),
    "ECDH-ES+A192KW": Ur("key-agreement-with-key-wrapping"),
    "ECDH-ES+A256KW": Ur("key-agreement-with-key-wrapping"),
    A128KW: cr(128),
    A192KW: cr(192),
    A256KW: cr(256),
    A128GCMKW: cr(128, !0),
    A192GCMKW: cr(192, !0),
    A256GCMKW: cr(256, !0),
    "PBES2-HS256+A128KW": St(),
    "PBES2-HS384+A192KW": St(),
    "PBES2-HS512+A256KW": St(),
  }),
  ys = ["encrypt", "decrypt"];
function fr(e, r = !1) {
  return {
    kty: ["oct"],
    secret: !0,
    subtle: { name: r ? "AES-CBC" : "AES-GCM", length: e },
    usages: Mr,
    ops: ys,
    cekBits: e,
    ivBits: r ? 128 : 96,
    cbc: r,
  };
}
var hs = xr({
  A128GCM: fr(128),
  A192GCM: fr(192),
  A256GCM: fr(256),
  "A128CBC-HS256": fr(256, !0),
  "A192CBC-HS384": fr(384, !0),
  "A256CBC-HS512": fr(512, !0),
});
function oi(e, r) {
  throw new F(`Invalid or unsupported "${e}" (JWE ${r}) header value`);
}
function mr(e) {
  return (typeof e == "string" ? sr[e] : void 0) ?? oi("alg", "Algorithm");
}
function Xe(e) {
  return (
    e.mode === "key-wrapping" ||
    e.mode === "key-encryption" ||
    e.mode === "key-agreement-with-key-wrapping"
  );
}
function Hr(e) {
  return (typeof e == "string" ? hs[e] : void 0) ?? oi("enc", "Encryption Algorithm");
}
function pi(e, r) {
  if (e.algorithm.name !== "ECDH" && e.algorithm.name !== "X25519")
    throw new TypeError(
      "CryptoKey does not support this operation, its algorithm.name must be ECDH or X25519",
    );
  xt(e, r);
}
async function gs(e, r, l) {
  let f = await ir(r, mr(e).subtle, "unwrapKey", !0),
    d = await crypto.subtle.unwrapKey(
      "raw",
      l,
      f,
      "AES-KW",
      { hash: "SHA-256", name: "HMAC" },
      !0,
      ["sign"],
    );
  return new Uint8Array(await crypto.subtle.exportKey("raw", d));
}
function vs(e, r, l) {
  (Et(r, mr(e).subtle, l), Zr(e, r));
}
async function ks(e, r, l, f) {
  if (!(e instanceof Uint8Array) || e.length < 8)
    throw new j("PBES2 Salt Input must be 8 or more octets");
  if (!Number.isSafeInteger(l) || Math.sign(l) !== 1)
    throw new j("PBES2 Count Input must be a positive integer");
  let d = Oe($e(r), Uint8Array.of(0), e),
    y = parseInt(r.slice(13, 16), 10),
    i = { hash: `SHA-${r.slice(8, 11)}`, iterations: l, name: "PBKDF2", salt: d },
    t = await ir(f, mr(r).subtle, "deriveBits");
  return new Uint8Array(await crypto.subtle.deriveBits(i, t, y));
}
function jt(e) {
  return Oe(Dr(e.length), e);
}
async function ws(e, r, l) {
  let f = r >> 3,
    d = 32,
    y = Math.ceil(f / d),
    i = new Uint8Array(y * d);
  for (let t = 1; t <= y; t++) {
    let m = await $r("sha256", Oe(Dr(t), e, l));
    i.set(m, (t - 1) * d);
  }
  return i.slice(0, f);
}
async function Ps(e, r, l, f, d = new Uint8Array(), y = new Uint8Array()) {
  (pi(e), pi(r, "deriveBits"));
  let i = Oe(jt($e(l)), jt(d), jt(y), Dr(f)),
    t = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: e.algorithm.name, public: e },
        r,
        e.algorithm.name === "X25519"
          ? 256
          : Math.ceil(parseInt(e.algorithm.namedCurve.slice(-3), 10) / 8) << 3,
      ),
    );
  return ws(t, f, i);
}
function Is(e) {
  bt(e);
  let r = e.algorithm.namedCurve;
  if (r !== "P-256" && r !== "P-384" && r !== "P-521" && e.algorithm.name !== "X25519")
    throw new F(
      "ECDH with the provided key is not allowed or not supported by your javascript runtime",
    );
}
function li(e, r) {
  let l = e[r];
  if (l !== void 0) {
    if (typeof l != "string")
      throw new j(`JOSE Header "${r}" (Agreement Party${r === "apu" ? "U" : "V"}Info) invalid`);
    return Ie(l, r, j);
  }
}
function bs(e, r) {
  if (!(e === void 0 || r === void 0 || e.byteLength !== r.byteLength)) {
    for (let l = 0; l < e.byteLength; l++) if (e[l] !== r[l]) return;
    throw new j('JOSE Header "apu" and "apv" values must be distinct');
  }
}
function _s(e) {
  if (e === void 0) throw new j("JWE Encrypted Key missing");
}
function ci(e) {
  if (e !== void 0) throw new j("Encountered unexpected JWE Encrypted Key");
}
function As(e) {
  if (e !== void 0 && e !== 1 / 0 && (!Number.isSafeInteger(e) || e < 1))
    throw new TypeError("maxPBES2Count must be a positive safe integer or Infinity");
}
async function fi(e, r, l, f, d, y) {
  let { alg: i } = e,
    t = e.mode;
  if (t === "direct-encryption") return (ci(f), l);
  let m = t === "direct-key-agreement";
  switch ((m ? ci(f) : _s(f), e.subtle.name)) {
    case "ECDH": {
      let { epk: s } = d;
      if (
        !ae(s) ||
        ["d", "k", "p", "q", "dp", "dq", "qi", "oth", "priv"].some((o) => Object.hasOwn(s, o))
      )
        throw new j('JOSE Header "epk" (Ephemeral Public Key) missing or invalid');
      Is(l);
      let u = await lr(e, s),
        w = li(d, "apu"),
        c = li(d, "apv");
      bs(w, c);
      let a = await Ps(u, l, m ? r.alg : i, m ? r.cekBits : parseInt(i.slice(-5, -2), 10), w, c);
      if (m) return a;
      l = a;
      break;
    }
    case "RSA-OAEP":
      return (
        bt(l),
        vs(i, l, "decrypt"),
        new Uint8Array(await crypto.subtle.decrypt("RSA-OAEP", l, f))
      );
    case "PBKDF2": {
      if (typeof d.p2c != "number")
        throw new j('JOSE Header "p2c" (PBES2 Count) missing or invalid');
      As(y);
      let s = y ?? 1e4;
      if (d.p2c > s) throw new j('JOSE Header "p2c" (PBES2 Count) out is of acceptable bounds');
      if (typeof d.p2s != "string")
        throw new j('JOSE Header "p2s" (PBES2 Salt) missing or invalid');
      let u = Ie(d.p2s, "p2s", j);
      l = await ks(u, i, d.p2c, l);
      break;
    }
    case "AES-GCM": {
      if (typeof d.iv != "string")
        throw new j('JOSE Header "iv" (Initialization Vector) missing or invalid');
      if (typeof d.tag != "string")
        throw new j('JOSE Header "tag" (Authentication Tag) missing or invalid');
      let s = Ie(d.iv, "iv", j),
        u = Ie(d.tag, "tag", j);
      if (s.byteLength !== 12) throw new j("Invalid Initialization Vector length");
      if (u.byteLength !== 16) throw new j("Invalid Authentication Tag length");
      return Wr(Hr(i.slice(0, -2)), l, f, s, u, new Uint8Array());
    }
  }
  return gs(i.slice(-6), l, f);
}
function mi(e, r) {
  if (e.zip !== void 0 && e.zip !== "DEF")
    throw new F('Unsupported JWE "zip" (Compression Algorithm) Header Parameter value.');
  if (e.zip !== void 0 && !r?.zip)
    throw new j(
      'JWE "zip" (Compression Algorithm) Header Parameter MUST be in a protected header.',
    );
}
function xs(e) {
  if (typeof globalThis[e] > "u")
    throw new F(`JWE "zip" (Compression Algorithm) Header Parameter requires the ${e} API.`);
}
async function Es(e, r, l = 1 / 0) {
  let f = e.writable.getWriter();
  (f.write(r).catch(() => {}), f.close().catch(() => {}));
  let d = [],
    y = 0,
    i = e.readable.getReader();
  for (;;) {
    let { value: t, done: m } = await i.read();
    if (m) break;
    if ((d.push(t), (y += t.byteLength), l !== 1 / 0 && y > l))
      throw new j("Decompressed plaintext exceeded the configured limit");
  }
  return Oe(...d);
}
async function di(e, r) {
  return (xs("DecompressionStream"), Es(new DecompressionStream("deflate-raw"), e, r));
}
function ui(e) {
  let { aad: r, ciphertext: l, iv: f, protected: d, tag: y, unprotected: i } = e;
  if (f !== void 0 && (typeof f != "string" || !f))
    throw new j("JWE Initialization Vector incorrect type");
  if (typeof l != "string") throw new j("JWE Ciphertext missing or incorrect type");
  if (y !== void 0 && (typeof y != "string" || !y))
    throw new j("JWE Authentication Tag incorrect type");
  if (d !== void 0 && typeof d != "string") throw new j("JWE Protected Header incorrect type");
  if (r !== void 0 && (typeof r != "string" || !r)) throw new j("JWE AAD incorrect type");
  if (i !== void 0 && !ae(i)) throw new j("JWE Shared Unprotected Header incorrect type");
  return {
    aad: r,
    ciphertext: l,
    iv: f,
    protected: d,
    tag: y,
    unprotected: i === void 0 ? void 0 : { ...i },
  };
}
function yi(e) {
  let r, l;
  try {
    let { header: f } = e;
    if (ae(f)) {
      l = f.alg;
      let y = Object.keys(f);
      (y.includes("alg") || (l = void 0),
        (r = Object.fromEntries(y.map((i) => [i, i === "alg" ? l : f[i]]))));
    } else r = f;
    let { encrypted_key: d } = e;
    return [{ encrypted_key: d, header: r }, l];
  } catch (f) {
    return [void 0, l, f];
  }
}
function hi(e) {
  let { encrypted_key: r, header: l } = e;
  if (r !== void 0 && typeof r != "string") throw new j("JWE Encrypted Key incorrect type");
  if (l !== void 0 && !ae(l)) throw new j("JWE Per-Recipient Unprotected Header incorrect type");
  if (e.protected === void 0 && l === void 0 && e.unprotected === void 0)
    throw new j("JOSE Header missing");
}
function Kt(e) {
  let { protected: r, ciphertext: l, iv: f, tag: d, aad: y } = e,
    i;
  return (
    r !== void 0 && (i = Tr(r, j, "JWE Protected Header is invalid")),
    [
      i,
      Ie(l, "ciphertext", j),
      f !== void 0 ? Ie(f, "iv", j) : void 0,
      d !== void 0 ? Ie(d, "tag", j) : void 0,
      zr((r ?? "") + (y !== void 0 ? `.${y}` : ""), "aad", j),
    ]
  );
}
function gi(e) {
  return [
    e && _r("keyManagementAlgorithms", e.keyManagementAlgorithms),
    e && _r("contentEncryptionAlgorithms", e.contentEncryptionAlgorithms),
    e?.crit,
    e?.maxPBES2Count,
    e?.maxDecompressedLength,
  ];
}
async function vi(e, r, l, f = Kt(e)) {
  let [d, y, i, t, m] = f,
    { header: s, unprotected: u, aad: w } = e,
    c;
  if (s !== void 0 || u !== void 0) {
    if (!Rr(d, s, u))
      throw new j(
        "JWE Protected, JWE Unprotected Header, and JWE Per-Recipient Unprotected Header Parameter names must be disjoint",
      );
    c = { ...d, ...s, ...u };
  } else c = d ?? {};
  let [a, o, n, p, h] = r,
    { encrypted_key: v } = e;
  (Vr(j, ti, n, d, c), mi(c, d));
  let { alg: g, enc: P } = c;
  if (typeof g != "string" || !g) throw new j("missing JWE Algorithm (alg) in JWE Header");
  let b = sr[g];
  if (v === "" && (!b || !Xe(b))) throw new j("JWE Encrypted Key incorrect type");
  let A = b?.mode === "integrated-encryption";
  if (!A && (typeof P != "string" || !P))
    throw new j("missing JWE Encryption Algorithm (enc) in JWE Header");
  if ((a && !a.has(g)) || (!a && g.startsWith("PBES2")))
    throw new rr('"alg" (Algorithm) Header Parameter value not allowed');
  let V;
  if (A) {
    if (P !== void 0)
      throw new j(
        'JWE "enc" (Encryption Algorithm) Header Parameter must not be present for integrated encryption',
      );
    if (i?.byteLength)
      throw new j("JWE Initialization Vector must be empty for integrated encryption");
    if (t?.byteLength)
      throw new j("JWE Authentication Tag must be empty for integrated encryption");
  } else {
    if (o && !o.has(P))
      throw new rr('"enc" (Encryption Algorithm) Header Parameter value not allowed');
    V = Hr(P);
  }
  let W;
  if (v !== void 0)
    try {
      W = Ie(v, "encrypted_key", j);
    } catch ($) {
      if (!b || !Xe(b)) throw $;
      W = new Uint8Array();
    }
  let _ = !1;
  typeof l == "function" && ((l = await l(d, e)), (_ = !0));
  let N = b ?? mr(g);
  Xe(N) && W === void 0 && (W = new Uint8Array());
  let L = await Ar(N.mode === "direct-encryption" ? V : N, l, "decrypt"),
    S;
  if (N.mode === "integrated-encryption") S = await N.decrypt(L, W, y, m, d, c);
  else {
    let $ = V,
      T;
    try {
      ((T = await fi(N, $, L, W, c, p)),
        Xe(N) && T instanceof Uint8Array && T.byteLength << 3 !== $.cekBits && (T = Br($)));
    } catch (Y) {
      if (Y instanceof TypeError || Y instanceof j || Y instanceof F) throw Y;
      T = Br($);
    }
    S = await Wr($, T, y, i, t, m);
  }
  if (c.zip === "DEF") {
    let $ = h ?? 25e4;
    if ($ === 0)
      throw new F('JWE "zip" (Compression Algorithm) Header Parameter is not supported.');
    if ($ !== 1 / 0 && (!Number.isSafeInteger($) || $ < 1))
      throw new TypeError("maxDecompressedLength must be 0, a positive safe integer, or Infinity");
    S = await di(S, $).catch((T) => {
      throw T instanceof j ? T : new j("Failed to decompress plaintext", { cause: T });
    });
  }
  return {
    plaintext: S,
    ...(d && { protectedHeader: d }),
    ...(w !== void 0 && { additionalAuthenticatedData: Ie(w, "aad", j) }),
    ...(u && { sharedUnprotectedHeader: u }),
    ...(s && { unprotectedHeader: s }),
    ...(_ && { key: L }),
  };
}
async function Ot(e, r, l) {
  if (!ae(e)) throw new j("General JWE must be an object");
  let f = e.recipients;
  if (!Array.isArray(f)) throw new j("JWE Recipients missing or incorrect type");
  let d = Array.from(f);
  if (!d.every(ae)) throw new j("JWE Recipients missing or incorrect type");
  if (!d.length) throw new j("JWE Recipients has no members");
  let y, i, t;
  try {
    ((y = gi(l)), (i = ui(e)), (t = Kt(i)));
  } catch {
    throw new Me();
  }
  let m = d.map((s) => yi(s));
  if (d.length > 1)
    for (let [, s] of m) {
      let u = t[0]?.alg ?? s ?? i.unprotected?.alg,
        w = typeof u == "string" ? sr[u] : void 0;
      if (w && !Xe(w)) throw new j(`"${u}" alg may only have a single recipient`);
    }
  for (let [s] of m)
    if (s)
      try {
        let u = { ...i, ...s };
        return (hi(u), await vi(u, y, r, t));
      } catch {}
  throw new Me();
}
var Er = [["verify"], ["sign"]];
function Nt(e) {
  let r = { name: "HMAC", hash: `SHA-${e}` };
  return { kty: ["oct"], secret: !0, subtle: r, signing: r, usages: Er };
}
function dr(e, r) {
  let l = { name: r ? "RSA-PSS" : "RSASSA-PKCS1-v1_5", hash: `SHA-${e}` };
  return {
    kty: ["RSA"],
    subtle: l,
    signing: r ? { ...l, saltLength: r } : l,
    usages: Er,
    minRsaBits: 2048,
  };
}
function Dt(e, r) {
  return {
    kty: ["EC"],
    crv: e,
    subtle: { name: "ECDSA", namedCurve: e },
    signing: { name: "ECDSA", hash: `SHA-${r}` },
    usages: Er,
  };
}
function ki() {
  let e = { name: "Ed25519" };
  return { kty: ["OKP"], crv: "Ed25519", subtle: e, signing: e, usages: Er };
}
function $t(e) {
  let r = { name: `ML-DSA-${e}` };
  return { kty: ["AKP"], subtle: r, signing: r, usages: Er };
}
var Rt = xr({
  HS256: Nt(256),
  HS384: Nt(384),
  HS512: Nt(512),
  RS256: dr(256),
  RS384: dr(384),
  RS512: dr(512),
  PS256: dr(256, 32),
  PS384: dr(384, 48),
  PS512: dr(512, 64),
  ES256: Dt("P-256", 256),
  ES384: Dt("P-384", 384),
  ES512: Dt("P-521", 512),
  EdDSA: ki(),
  Ed25519: ki(),
  "ML-DSA-44": $t(44),
  "ML-DSA-65": $t(65),
  "ML-DSA-87": $t(87),
});
function wi(e) {
  let r = typeof e == "string" ? Rt[e] : void 0;
  if (!r) throw new F(`alg ${e} is not supported either by JOSE or your javascript runtime`);
  return r;
}
function Pi(e, r) {
  let l = e.protected,
    f = e.header,
    d = ae(f) ? { ...f } : f,
    y = r ? r[0] : e.payload;
  !r && y instanceof Uint8Array && (y = new Uint8Array(y));
  let i = e.signature,
    t = { payload: y, signature: i };
  if (
    (l !== void 0 && (t.protected = l),
    f !== void 0 && (t.header = d),
    l === void 0 && d === void 0)
  )
    throw new ie('Flattened JWS must have either of the "protected" or "header" members');
  if (l !== void 0 && typeof l != "string") throw new ie("JWS Protected Header incorrect type");
  if (y === void 0) throw new ie("JWS Payload missing");
  if (typeof i != "string") throw new ie("JWS Signature missing or incorrect type");
  if (d !== void 0 && !ae(d)) throw new ie("JWS Unprotected Header incorrect type");
  return t;
}
function Ii(e) {
  return [e && _r("algorithms", e.algorithms), e?.crit];
}
function Ls(e) {
  return e === void 0 ? {} : Tr(e, ie, "JWS Protected Header is invalid");
}
function bi(e) {
  let r = /[\p{Cs}\p{Cn}]/u.exec(e)?.[0];
  if (r !== void 0)
    throw new ie(
      /\p{Cs}/u.test(r)
        ? "JWS Payload must be a well-formed Unicode string"
        : "JWS Payload must not contain unassigned Unicode code points",
    );
  return kr.encode(e);
}
async function _i(e, r, l, f, d) {
  let { protected: y, header: i, payload: t } = e,
    m = d ?? Ls(y);
  if (!Rr(m, i))
    throw new ie("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  let s = { ...m, ...i },
    u = ii(m, Vr(ie, ri, r[1], m, s)),
    { alg: w } = s;
  if (typeof w != "string" || !w)
    throw new ie('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  if (r[0] && !r[0].has(w)) throw new rr('"alg" (Algorithm) Header Parameter value not allowed');
  if (u) {
    if (typeof t != "string") throw new ie("JWS Payload must be a string");
  } else if (typeof t != "string" && !(t instanceof Uint8Array))
    throw new ie("JWS Payload must be a string or an Uint8Array instance");
  let c = u || typeof t != "string" ? t : f(t),
    a = !1;
  typeof l == "function" && ((l = await l(m, e)), (a = !0));
  let o = wi(w),
    n = Oe(
      y !== void 0 ? $e(y) : new Uint8Array(),
      $e("."),
      typeof c == "string" ? (r[2] ??= zr(c, "payload", ie)) : c,
    ),
    p = Ie(e.signature, "signature", ie),
    h = await Ar(o, l, "verify"),
    v = await ir(h, o.subtle, "verify");
  o.minRsaBits && Zr(o.alg, v);
  let g = !1;
  try {
    g = await crypto.subtle.verify(o.signing, v, p, n);
  } catch (b) {
    throw new Pr(void 0, { cause: b });
  }
  if (!g) throw new Pr();
  let P = { payload: typeof c == "string" ? Ie(c, "payload", ie) : c };
  return (
    y !== void 0 && (P.protectedHeader = m),
    i !== void 0 && (P.unprotectedHeader = i),
    a ? [{ ...P, key: h }, u] : [P, u]
  );
}
async function zt(e, r, l) {
  if (!ae(e)) throw new ie("Flattened JWS must be an object");
  let f = Pi(e),
    [d] = await _i(f, Ii(l), r, bi);
  return d;
}
var Tt = '"alg" (Algorithm)';
function Vt(e = 'JWK "alg" (Algorithm) Parameter') {
  throw new F(`Invalid or unsupported ${e} value`);
}
function Lr(e, r) {
  return (typeof e == "string" ? (Rt[e] ?? sr[e]) : void 0) ?? Vt(r);
}
async function Sr(e) {
  if (_t(e))
    if (e.type === "secret") e = e.export();
    else return e.export({ format: "jwk" });
  if (e instanceof Uint8Array) return { kty: "oct", k: Ir(e) };
  if (!tr(e)) throw new TypeError(Ge(e, "CryptoKey", "KeyObject", "Uint8Array"));
  if (!e.extractable) throw new TypeError("non-extractable CryptoKey cannot be exported as a JWK");
  let r = await crypto.subtle.exportKey("jwk", e);
  (delete r.ext, delete r.key_ops, delete r.use, r.kty !== "AKP" && delete r.alg);
  for (let l of Object.keys(r)) r[l] === void 0 && delete r[l];
  return r;
}
var Be = (e, r) => {
  if (typeof e != "string" || !e) throw new wr(`${r} missing or invalid`);
};
async function qt(e, r) {
  let l;
  if (ae(e)) {
    if (((l = Cr(e)), typeof l.kty != "string"))
      throw new TypeError(Ge(e, "CryptoKey", "KeyObject", "JSON Web Key"));
  } else if (At(e)) l = Cr(await Sr(e));
  else throw new TypeError(Ge(e, "CryptoKey", "KeyObject", "JSON Web Key"));
  if (((r ??= "sha256"), r !== "sha256" && r !== "sha384" && r !== "sha512"))
    throw new TypeError('digestAlgorithm must one of "sha256", "sha384", or "sha512"');
  let f;
  switch (l.kty) {
    case "AKP":
      (Be(l.alg, '"alg" (Algorithm) Parameter'),
        Be(l.pub, '"pub" (Public key) Parameter'),
        (f = { alg: l.alg, kty: l.kty, pub: l.pub }));
      break;
    case "EC":
      (Be(l.crv, '"crv" (Curve) Parameter'),
        Be(l.x, '"x" (X Coordinate) Parameter'),
        Be(l.y, '"y" (Y Coordinate) Parameter'),
        (f = { crv: l.crv, kty: l.kty, x: l.x, y: l.y }));
      break;
    case "OKP":
      (Be(l.crv, '"crv" (Subtype of Key Pair) Parameter'),
        Be(l.x, '"x" (Public Key) Parameter'),
        (f = { crv: l.crv, kty: l.kty, x: l.x }));
      break;
    case "RSA":
      (Be(l.e, '"e" (Exponent) Parameter'),
        Be(l.n, '"n" (Modulus) Parameter'),
        (f = { e: l.e, kty: l.kty, n: l.n }));
      break;
    case "oct":
      if (typeof l.k != "string") throw new wr('"k" (Key Value) Parameter missing or invalid');
      f = { k: l.k, kty: l.kty };
      break;
    default:
      throw new F('"kty" (Key Type) Parameter missing or unsupported');
  }
  let d = $e(JSON.stringify(f));
  return Ir(await $r(r, d));
}
async function Gr(e, r, l) {
  if (!ae(e)) throw new TypeError("JWK must be an object");
  let f = Lt(e),
    d = Jr(l?.extractable),
    { alg: y } = f;
  if (((r ??= y), f.kty !== "oct" && !r))
    throw new TypeError('"alg" argument is required when "jwk.alg" is not present');
  switch (f.kty) {
    case "oct":
      if (typeof f.k != "string") throw new TypeError('missing "k" (Key Value) Parameter value');
      return He(f.k);
    case "AKP": {
      if (typeof y != "string" || !y)
        throw new TypeError('missing "alg" (Algorithm) Parameter value');
      if (r !== y) throw new TypeError("JWK alg and alg option value mismatch");
      return lr(Lr(r), f, d);
    }
    case "RSA":
    case "EC":
    case "OKP":
      return lr(Lr(r), f, d);
    default:
      throw new F('Unsupported "kty" (Key Type) Parameter value');
  }
}
function Ss(e) {
  let r = e?.modulusLength ?? 2048;
  if (typeof r != "number" || !Number.isInteger(r) || r < 2048)
    throw new F(
      "Invalid or unsupported modulusLength option provided, 2048 bits or larger keys must be used",
    );
  return r;
}
async function Xr(e, r) {
  let l = Jr(r?.extractable),
    f = Lr(e, Tt);
  f.secret && Vt(Tt);
  let d;
  if (f.resolve) {
    let y = r?.crv ?? "P-256";
    if (!["P-256", "P-384", "P-521", "X25519"].includes(y))
      throw new F(
        "Invalid or unsupported crv option provided, supported values are P-256, P-384, P-521, and X25519",
      );
    d = f.resolve({ crv: y });
  } else {
    if (f.crv !== void 0 && r?.crv !== void 0 && r.crv !== f.crv)
      throw new F(
        `Invalid or unsupported crv option provided, the only supported value for ${e} is ${f.crv}`,
      );
    d =
      f.kty[0] === "RSA"
        ? { ...f.subtle, publicExponent: Uint8Array.of(1, 0, 1), modulusLength: Ss(r) }
        : f.subtle;
  }
  return crypto.subtle.generateKey(d, l ?? !1, [...f.usages[1], ...f.usages[0]]);
}
function Ct(e) {
  if (!e.isWellFormed()) throw new Error("Lone surrogate is not allowed");
  return JSON.stringify(e);
}
function Yr(e) {
  switch (typeof e) {
    case "number":
      if (isNaN(e)) throw new Error("NaN is not allowed");
      if (!isFinite(e)) throw new Error("Infinity is not allowed");
      return JSON.stringify(e);
    case "string":
      return Ct(e);
    case "boolean":
      return e ? "true" : "false";
    default:
      return JSON.stringify(e);
  }
}
function Zt(e, r) {
  let l = null;
  for (; e !== null && typeof e == "object" && typeof e.toJSON == "function";) {
    if (r.has(e)) throw new Error("Circular reference detected");
    (r.add(e), (l ??= []).push(e), (e = e.toJSON()));
  }
  if (
    ((e instanceof Number || e instanceof String || e instanceof Boolean) && (e = e.valueOf()),
    e === null || typeof e != "object")
  ) {
    if (l !== null) for (let f of l) r.delete(f);
    return Yr(e);
  }
  if (r.has(e)) throw new Error("Circular reference detected");
  return (
    r.add(e),
    {
      container: e,
      keys: Array.isArray(e) ? null : Object.keys(e).sort(),
      index: 0,
      first: !0,
      wrappers: l,
    }
  );
}
function nr(e) {
  if (e === null || typeof e != "object") return Yr(e);
  let r = new Set(),
    l = Zt(e, r);
  if (typeof l != "object") return l;
  let f = l.keys === null ? "[" : "{",
    d = [l];
  e: for (; d.length > 0;) {
    let y = d[d.length - 1],
      i = y.container;
    if (y.keys === null) {
      for (; y.index < i.length;) {
        let t = y.index++;
        t > 0 && (f += ",");
        let m = i[t],
          s = m === void 0 || typeof m == "symbol" || typeof m == "function" ? null : m;
        if (s === null || typeof s != "object") {
          f += Yr(s);
          continue;
        }
        let u = Zt(s, r);
        if (typeof u != "object") {
          f += u === void 0 ? "null" : u;
          continue;
        }
        ((f += u.keys === null ? "[" : "{"), d.push(u));
        continue e;
      }
      f += "]";
    } else {
      let t = y.keys;
      for (; y.index < t.length;) {
        let m = t[y.index++],
          s = i[m];
        if (s === void 0 || typeof s == "symbol" || typeof s == "function") continue;
        if (s === null || typeof s != "object") {
          (y.first ? (y.first = !1) : (f += ","), (f += Ct(m) + ":" + Yr(s)));
          continue;
        }
        let u = Zt(s, r);
        if (u !== void 0) {
          if ((y.first ? (y.first = !1) : (f += ","), (f += Ct(m) + ":"), typeof u != "object")) {
            f += u;
            continue;
          }
          ((f += u.keys === null ? "[" : "{"), d.push(u));
          continue e;
        }
      }
      f += "}";
    }
    if ((r.delete(i), y.wrappers !== null)) for (let t of y.wrappers) r.delete(t);
    d.pop();
  }
  return f;
}
var Vi = ts($i(), 1),
  Us = "1.0.0",
  Ht = "folioview.agent-workspace.v2.0",
  Ms = "folioview.agent-preparation.v1",
  qi = new TextEncoder(),
  Hs = new TextDecoder("utf-8", { fatal: !0 }),
  Zi = 524288,
  Gs = 1048576,
  Xs = { alg: "ECDH-ES+A256KW", enc: "A256GCM", typ: "fv-private+jwe", cty: "application/json" },
  Ys = [
    "taskId",
    "taskVersion",
    "runId",
    "manifestId",
    "taskEnvelopeFingerprint",
    "manifestFingerprint",
    "connectionId",
    "grantId",
    "grantEpoch",
    "executionEpoch",
    "resourceRef",
    "sourceRevision",
    "sourceEpoch",
  ],
  Qs = ["root_sig", "device_sig", "device_enc", "agent_sig", "agent_enc", "recovery_enc"],
  Ri = { initialize: ["anchor", "now", "ttlSeconds"], confirmDelivery: ["pin"] },
  zi = {
    registry: ["bundles"],
    install: ["metadata"],
    decrypt: ["objectId", "envelope"],
    status: [],
    lock: [],
    revoke: [],
  },
  vr = class extends Error {
    constructor(r = "operation_rejected") {
      (super(r), (this.code = r));
    }
  };
function x(e) {
  throw new vr(e);
}
function Ci(e) {
  return (
    e !== null &&
    typeof e == "object" &&
    !Array.isArray(e) &&
    (Object.getPrototypeOf(e) === Object.prototype || Object.getPrototypeOf(e) === null)
  );
}
function xe(e, r) {
  (!Ci(e) || Object.keys(e).sort().join("\0") !== [...r].sort().join("\0")) && x("invalid_fields");
}
function Ue(e) {
  Kr(e);
  let r = nr(e);
  return (typeof r != "string" && x("invalid_json"), qi.encode(r));
}
function Kr(e, r = 0) {
  if ((r > 20 && x("json_too_deep"), !(e === null || typeof e == "boolean"))) {
    if (typeof e == "string") {
      e.isWellFormed() || x("invalid_unicode");
      return;
    }
    if (typeof e == "number") {
      (!Number.isFinite(e) || (Number.isInteger(e) && !Number.isSafeInteger(e))) &&
        x("invalid_number");
      return;
    }
    if (Array.isArray(e)) {
      for (let l of e) Kr(l, r + 1);
      return;
    }
    Ci(e) || x("invalid_json");
    for (let [l, f] of Object.entries(e)) (Kr(l), Kr(f, r + 1));
  }
}
function we(e, r) {
  return nr(e) === nr(r);
}
function Ne(e) {
  (typeof e != "string" || e.includes("=") || !/^[A-Za-z0-9_-]*$/.test(e)) &&
    x("invalid_base64url");
  let r = br.decode(e);
  return (br.encode(r) !== e && x("invalid_base64url"), r);
}
function hr(e, r = !1) {
  let l = Hs.decode(e),
    f = 0,
    d = () => {
      for (; /[\x20\x09\x0a\x0d]/.test(l[f] || "!");) f += 1;
    },
    y = () => {
      l[f] !== '"' && x("malformed_json");
      let m = f++;
      for (; f < l.length;) {
        if (l[f] === "\\") {
          f += 2;
          continue;
        }
        if (l[f++] === '"') return JSON.parse(l.slice(m, f));
      }
      x("malformed_json");
    },
    i = (m) => {
      if ((m > 20 && x("json_too_deep"), d(), l[f] === '"')) {
        y();
        return;
      }
      let s = l[f] === "{";
      if (s || l[f] === "[") {
        let w = s ? "}" : "]";
        ((f += 1), d());
        let c = new Set();
        if (l[f] === w) {
          f += 1;
          return;
        }
        for (;;) {
          if (s) {
            d();
            let a = y();
            (c.has(a) && x("duplicate_member"),
              c.add(a),
              d(),
              l[f++] !== ":" && x("malformed_json"));
          }
          if ((i(m + 1), d(), l[f] === w)) {
            f += 1;
            return;
          }
          l[f++] !== "," && x("malformed_json");
        }
      }
      let u = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(l.slice(f));
      (u || x("malformed_json"), (f += u[0].length));
    };
  (i(0), d(), f !== l.length && x("malformed_json"));
  let t = JSON.parse(l);
  return (Kr(t), r && !Ji(Ue(t), e) && x("noncanonical_json"), t);
}
function Ji(e, r) {
  return e.length === r.length && e.every((l, f) => l === r[f]);
}
function Fe(e, r = 0) {
  return ((!Number.isSafeInteger(e) || e < r) && x("invalid_integer"), e);
}
function Ti(e) {
  return (
    (typeof e != "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(e)) &&
      x("invalid_identifier"),
    e
  );
}
function yr(e) {
  return ((typeof e != "string" || !/^[a-f0-9]{64}$/.test(e)) && x("invalid_digest"), e);
}
async function Gt(e) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Ue(e)))]
    .map((r) => r.toString(16).padStart(2, "0"))
    .join("");
}
async function en(e) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        qi.encode(e.signedObject.protected + "." + e.signedObject.payload),
      ),
    ),
  ]
    .map((r) => r.toString(16).padStart(2, "0"))
    .join("");
}
function mt(e, r, l = 0) {
  return ((!Array.isArray(e) || e.length < l || e.length > r) && x("invalid_array"), e);
}
function De(e) {
  return (new Set(e).size !== e.length && x("duplicate_value"), e);
}
async function Bi(e) {
  return (
    xe(e, ["kty", "crv", "x", "y"]),
    (e.kty !== "EC" || e.crv !== "P-256" || Ne(e.x).length !== 32 || Ne(e.y).length !== 32) &&
      x("invalid_public_key"),
    await Gr(e, "ES256"),
    e
  );
}
async function jr(e) {
  return (await Bi(e), qt(e, "sha256"));
}
function rn(e, r, l) {
  xe(e, ["protected", "payload", "signature"]);
  let f = hr(Ne(e.protected));
  return (
    (!we(f, { alg: "ES256", kid: l, typ: r, cty: "application/json" }) ||
      Ne(e.signature).length !== 64) &&
      x("invalid_signature_profile"),
    f
  );
}
async function dt(e, r, l) {
  let f = await jr(r);
  (rn(e, l, f), Ue(e).length > (l === "fv-control+jws" ? 65536 : Zi) && x("payload_too_large"));
  let d = await zt(e, await Gr(r, "ES256"), { algorithms: ["ES256"] });
  return hr(d.payload, !0);
}
function ve(e, r) {
  let l = Vi.default[e];
  (!l || !l(r)) && x("invalid_schema");
}
function gr(e) {
  (typeof e != "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(e) ||
    !Number.isFinite(Date.parse(e)) ||
    new Date(e).toISOString().slice(0, 19) !== e.slice(0, 19)) &&
    x("private_schema_invalid");
}
function tn(e) {
  if (typeof e != "string" || /[\s\\\x00-\x1f]/.test(e)) return !1;
  try {
    let r = new URL(e);
    return (
      r.protocol === "https:" &&
      r.hostname &&
      !r.username &&
      !r.password &&
      (!r.port || r.port === "443")
    );
  } catch {
    return !1;
  }
}
function sn(e, r) {
  ve("PrivatePayload", e);
  for (let f of ["objectId", "objectType", "revision", "binding"])
    we(e[f], r[f]) || x("private_binding_mismatch");
  Ue(e).length > (r.objectType === "task" ? 65536 : 196608) && x("payload_too_large");
  let l = e.payload;
  if (r.objectType === "task") {
    if (
      (De(l.outputSpec.sections.map((f) => f.sectionId)),
      l.template === "brief" && !r.resourceBindings.length && x("private_schema_invalid"),
      l.deliveryExpectation !== null)
    )
      try {
        new Intl.DateTimeFormat("en", { timeZone: l.deliveryExpectation.timeZone });
      } catch {
        x("private_schema_invalid");
      }
  } else {
    let f = {
      holdings_snapshot: "holdings",
      watchlist_evidence: "watchlist",
      channel_follows_evidence: "channel_follows",
    }[r.objectType];
    (!f || l.data.kind !== f || r.binding.resourceRef.kind !== f) && x("private_schema_invalid");
    let d = l.data;
    if ((gr(l.fetchedAt), l.sourceAsOf !== null && gr(l.sourceAsOf), f === "holdings")) {
      (d.snapshotId !== r.objectId && x("private_binding_mismatch"),
        De(d.accounts.map((y) => y.accountId)),
        d.accounts.reduce((y, i) => y + i.positions.length, 0) > 1e3 &&
          x("private_schema_invalid"));
      for (let y of d.accounts)
        (De(y.balances.map((i) => i.currency)),
          De(y.positions.map((i) => i.assetId)),
          y.positions.some(
            (i) => i.marketValue !== null && i.marketValue.currency !== i.currency,
          ) && x("private_schema_invalid"));
    } else if (f === "watchlist") {
      De(d.items.map((y) => y.symbol));
      for (let y of d.items) gr(y.addedAt);
    } else {
      De(d.items.map((y) => y.followId));
      for (let y of d.items)
        (gr(y.addedAt),
          !/^@[^\s\x00-\x1f]+$/.test(y.handleOrUrl) &&
            !tn(y.handleOrUrl) &&
            x("private_schema_invalid"));
    }
  }
  return l;
}
var ut = class {
  #w;
  #i = "ABSENT";
  #n = 0;
  #h = null;
  #g = null;
  #e = null;
  #t = null;
  #P = 0;
  #a = new Map();
  #d = new Map();
  #l = null;
  #c = null;
  #u = null;
  #I = Promise.resolve();
  #v = 0;
  #b = null;
  #k = 0;
  #_ = 0;
  #A = 0;
  #p = null;
  #o = null;
  constructor({ onInvalidate: r = () => {} } = {}) {
    this.#w = r;
  }
  status() {
    return {
      helperVersion: Us,
      state: this.#i,
      sessionId: this.#h,
      generation: this.#n,
      privateKeysPresent: this.#g !== null,
      privateKeysExtractable: !1,
    };
  }
  #r(r, l = !1) {
    ((r !== this.#n || !["READY", "ACTIVE", ...(l ? ["SETTING_UP"] : [])].includes(this.#i)) &&
      x("session_locked"),
      performance.now() >= this.#_ && (this.#f("LOCKED"), x("session_expired")));
  }
  #f(r) {
    (clearTimeout(this.#b),
      this.#n++,
      (this.#i = r),
      (this.#g = null),
      (this.#t = null),
      (this.#l = null),
      (this.#c = null),
      (this.#u = null),
      this.#a.clear(),
      this.#d.clear(),
      this.#w({ event: "sessionEnded", ...this.status() }));
  }
  #m() {
    return this.#A + Math.floor((performance.now() - this.#k) / 1e3);
  }
  dispatch(r, l = !1) {
    if (["initialize", "status", "lock", "revoke"].includes(r?.op)) return this.#x(r, l);
    if (this.#v >= 8) return Promise.reject(new vr("queue_limit"));
    this.#v++;
    let f = this.#I
      .then(() => this.#x(r, l))
      .finally(() => {
        this.#v--;
      });
    return ((this.#I = f.catch(() => {})), f);
  }
  async #x(r, l) {
    (xe(r, ["id", "sessionId", "generation", "op", "args"]),
      Ti(r.id),
      Ti(r.sessionId),
      Fe(r.generation, 1),
      Ue(r).length > Gs && x("payload_too_large"));
    let f = Object.hasOwn(Ri, r.op);
    if (
      ((!(f || Object.hasOwn(zi, r.op)) || (f && !l)) && x("unsupported_operation"),
      xe(r.args, f ? Ri[r.op] : zi[r.op]),
      r.op === "initialize")
    ) {
      this.#i !== "ABSENT" && x("already_initialized");
      try {
        return await this.#L(r);
      } catch (y) {
        throw (
          this.#i === "SETTING_UP" &&
            this.#n === r.generation &&
            this.#h === r.sessionId &&
            this.#f("LOCKED"),
          y
        );
      }
    }
    if (
      ((r.sessionId !== this.#h || r.generation !== this.#n) && x("session_mismatch"),
      r.op === "status")
    )
      return this.status();
    if (["lock", "revoke"].includes(r.op))
      return (this.#f(r.op === "lock" ? "LOCKED" : "REVOKED"), this.status());
    let d = this.#n;
    if ((this.#r(d), r.op === "registry")) await this.#S(r.args.bundles, d);
    else if (r.op === "confirmDelivery") this.#j(r.args.pin);
    else if (r.op === "install") await this.#E(r.args.metadata, d);
    else if (r.op === "decrypt") return await this.#K(r.args.objectId, r.args.envelope, d);
    return (this.#r(d), this.status());
  }
  async #L(r) {
    let l = r.args.anchor;
    xe(l, [
      "ownerSubject",
      "vaultId",
      "rootJwk",
      "rootKeyId",
      "rootEpoch",
      "registrySequence",
      "checkpointDigest",
      "connectionId",
      "agentPrincipalId",
      "taskId",
    ]);
    for (let s of ["ownerSubject", "vaultId", "connectionId", "agentPrincipalId", "taskId"])
      ve("Identifier", l[s]);
    (ve("PublicJWK", l.rootJwk),
      ve("KeyId", l.rootKeyId),
      yr(l.checkpointDigest),
      Fe(l.rootEpoch, 1),
      Fe(l.registrySequence, 1),
      Fe(r.args.now, 1),
      Fe(r.args.ttlSeconds, 1),
      (l.rootEpoch !== 1 || l.registrySequence > 32 || r.args.ttlSeconds > 3600) &&
        x("invalid_anchor"),
      (this.#e = structuredClone(l)),
      (this.#h = r.sessionId),
      (this.#n = r.generation),
      (this.#A = r.args.now),
      (this.#k = performance.now()),
      (this.#_ = this.#k + r.args.ttlSeconds * 1e3),
      (this.#i = "SETTING_UP"));
    let f = this.#n;
    ((await jr(l.rootJwk)) !== l.rootKeyId && x("root_pin_mismatch"), this.#r(f, !0));
    let d = await Xr("ES256", { crv: "P-256", extractable: !1 });
    this.#r(f, !0);
    let y = await Xr("ECDH-ES+A256KW", { crv: "P-256", extractable: !1 });
    (this.#r(f, !0),
      (d.privateKey.extractable || y.privateKey.extractable) && x("unsafe_private_key"));
    let i = async (s) => {
        let u = await Sr(s);
        return { kty: u.kty, crv: u.crv, x: u.x, y: u.y };
      },
      t = await i(d.publicKey),
      m = await i(y.publicKey);
    (this.#r(f, !0),
      (this.#p = await jr(t)),
      (this.#o = await jr(m)),
      this.#r(f, !0),
      this.#p === this.#o && x("key_role_reuse"));
    for (let s of [d.privateKey, y.privateKey]) {
      let u = !1;
      try {
        await crypto.subtle.exportKey("jwk", s);
      } catch {
        u = !0;
      }
      (u || x("unsafe_private_key"), this.#r(f, !0));
    }
    return (
      (this.#g = { sig: d.privateKey, enc: y.privateKey }),
      (this.#i = "READY"),
      (this.#b = setTimeout(() => this.#f("LOCKED"), r.args.ttlSeconds * 1e3)),
      {
        ...this.status(),
        agentSigningPublicJwk: t,
        agentEncryptionPublicJwk: m,
        agentSigningKeyId: this.#p,
        agentEncryptionKeyId: this.#o,
        keyExportRejected: !0,
      }
    );
  }
  #y(r) {
    (r.contractVersion !== Ht ||
      r.ownerSubject !== this.#e.ownerSubject ||
      r.vaultId !== this.#e.vaultId) &&
      x("identity_mismatch");
  }
  #s(r, l = null, f = void 0) {
    let d = this.#t?.keys.get(r);
    return (
      (!d ||
        !d.active ||
        this.#t.revoked.has(r) ||
        !(d.notBefore <= this.#m() && this.#m() < d.expiresAt) ||
        d.keyEpoch !== this.#d.get([d.principalId, d.role, d.connectionId].join("/"))) &&
        x("key_revoked_or_expired"),
      l && d.role !== l && x("key_role_mismatch"),
      f !== void 0 && d.connectionId !== f && x("connection_mismatch"),
      d
    );
  }
  async #S(r, l) {
    mt(r, 8, 1);
    for (let f of r) {
      (ve("RegistryBundle", f), Ue(f).length > 131072 && x("payload_too_large"));
      let d = await dt(f.checkpoint, this.#e.rootJwk, "fv-control+jws");
      (this.#r(l),
        ve("RegistryCheckpointPayload", d),
        this.#y(d),
        (d.rootKeyId !== this.#e.rootKeyId ||
          d.rootEpoch !== this.#e.rootEpoch ||
          d.issuedAt > this.#m()) &&
          x("root_pin_mismatch"));
      let y = await Gt(d);
      if ((this.#r(l), this.#a.has(d.registrySequence))) {
        this.#a.get(d.registrySequence) !== y && x("registry_rollback");
        continue;
      }
      ((d.registrySequence !== this.#P + 1 ||
        d.registrySequence > 32 ||
        d.previousDigest !== (this.#t?.digest ?? null)) &&
        x("registry_chain_mismatch"),
        this.#t &&
          (d.keyEpoch < this.#t.keyEpoch ||
            d.issuedAt < this.#t.issuedAt ||
            [...this.#t.revoked].some((u) => !d.revokedKeyIds.includes(u))) &&
          x("registry_rollback"));
      let i = new Map(),
        t = [],
        m = [],
        s = new Set();
      for (let u of f.entries) {
        let w = await dt(u.certificate, this.#e.rootJwk, "fv-control+jws");
        (this.#r(l),
          ve("KeyCertificatePayload", w),
          this.#y(w),
          (w.issuerKeyId !== this.#e.rootKeyId ||
            w.keyId !== (await jr(w.publicJwk)) ||
            i.has(w.keyId) ||
            w.expiresAt <= w.notBefore ||
            !Qs.includes(w.role) ||
            w.role.startsWith("agent_") !== (w.connectionId !== null) ||
            u.active === d.revokedKeyIds.includes(w.keyId) ||
            (w.role === "root_sig") != (w.keyId === this.#e.rootKeyId)) &&
            x("invalid_certificate"),
          this.#r(l));
        let c =
          w.role === "device_sig"
            ? ["object_write", "task_grant", "control_write"]
            : w.role === "agent_sig"
              ? ["run_request", "result_write"]
              : [];
        w.capabilities.some((p) => !c.includes(p)) && x("invalid_certificate");
        let a = [w.principalId, w.role, w.connectionId].join("/"),
          o = a + "/" + w.keyEpoch;
        (s.has(o) && x("key_epoch_conflict"), s.add(o));
        let n = this.#t?.keys.get(w.keyId);
        (n &&
          !we(Object.fromEntries(Object.keys(w).map((p) => [p, n[p]])), w) &&
          x("registry_conflict"),
          !n && this.#t && w.keyEpoch <= (this.#d.get(a) ?? 0) && x("key_epoch_conflict"),
          i.set(w.keyId, { ...w, active: u.active }),
          t.push(w.certificateId),
          m.push({ certificateId: w.certificateId, payloadDigest: await Gt(w), active: u.active }),
          this.#r(l));
      }
      (De(t),
        (await Gt(
          m.sort((u, w) =>
            u.certificateId < w.certificateId ? -1 : u.certificateId > w.certificateId ? 1 : 0,
          ),
        )) !== d.entriesDigest && x("registry_digest_mismatch"),
        this.#r(l),
        d.registrySequence === this.#e.registrySequence &&
          y !== this.#e.checkpointDigest &&
          x("checkpoint_pin_mismatch"));
      for (let u of i.values()) {
        let w = [u.principalId, u.role, u.connectionId].join("/");
        this.#d.set(w, Math.max(u.keyEpoch, this.#d.get(w) ?? 0));
      }
      ((this.#P = d.registrySequence),
        this.#a.set(d.registrySequence, y),
        (this.#t = {
          keys: i,
          revoked: new Set(d.revokedKeyIds),
          digest: y,
          keyEpoch: d.keyEpoch,
          issuedAt: d.issuedAt,
        }));
    }
    if (this.#c)
      try {
        await this.#E(this.#l, l);
      } catch (f) {
        throw (this.#n === l && this.#f("REVOKED"), f);
      }
  }
  #j(r) {
    xe(r, [
      "preparationId",
      "taskVersion",
      "taskEnvelopeFingerprint",
      "taskDeliveryFingerprint",
      "objects",
      "deliveryRevision",
      "priorEnvelopeFingerprint",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
    ]);
    for (let l of ["preparationId", "authorizationId", "grantId"]) ve("Identifier", r[l]);
    for (let l of ["taskVersion", "deliveryRevision", "grantEpoch", "executionEpoch"]) Fe(r[l], 1);
    (yr(r.taskEnvelopeFingerprint), yr(r.taskDeliveryFingerprint), mt(r.objects, 11, 1));
    for (let l of r.objects)
      (xe(l, ["objectId", "envelopeFingerprint"]),
        ve("Identifier", l.objectId),
        yr(l.envelopeFingerprint));
    (we(
      r.objects,
      [...r.objects].sort((l, f) =>
        l.objectId < f.objectId ? -1 : l.objectId > f.objectId ? 1 : 0,
      ),
    ) || x("invalid_delivery_pin"),
      De(r.objects.map((l) => l.objectId)),
      yr(r.priorEnvelopeFingerprint),
      r.deliveryRevision < 2 && x("invalid_delivery_pin"),
      (this.#u = structuredClone(r)),
      (this.#l = null),
      (this.#c = null),
      (this.#i = "READY"));
  }
  async #E(r, l) {
    ((!this.#u || !this.#t || this.#a.get(this.#e.registrySequence) !== this.#e.checkpointDigest) &&
      x("trusted_pin_required"),
      xe(r, [
        "contractVersion",
        "profile",
        "preparationId",
        "connectionId",
        "authorizationId",
        "clientId",
        "taskId",
        "taskVersion",
        "grantId",
        "grantEpoch",
        "executionEpoch",
        "keyEpoch",
        "ownerSubject",
        "vaultId",
        "rootJwk",
        "rootKeyId",
        "rootEpoch",
        "agentKeyGrant",
        "authorizationExpiresAt",
        "registryProofs",
        "taskMetadata",
        "taskDeliveryBase",
        "objects",
      ]),
      (r.contractVersion !== Ht || r.profile !== Ms) && x("unsupported_contract"),
      this.#y(r));
    let f = this.#u;
    for (let n of [
      "preparationId",
      "taskVersion",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
    ])
      r[n] !== f[n] && x("delivery_binding_mismatch");
    ((r.taskId !== this.#e.taskId ||
      r.connectionId !== this.#e.connectionId ||
      r.rootKeyId !== this.#e.rootKeyId ||
      r.rootEpoch !== this.#e.rootEpoch ||
      !we(r.rootJwk, this.#e.rootJwk) ||
      r.keyEpoch !== this.#t.keyEpoch) &&
      x("identity_mismatch"),
      ve("TaskMetadata", r.taskMetadata),
      gr(r.taskMetadata.createdAt),
      gr(r.taskMetadata.updatedAt),
      xe(r.taskDeliveryBase, ["deliveryRevision", "envelopeFingerprint"]),
      (r.taskDeliveryBase.deliveryRevision !== f.deliveryRevision - 1 ||
        r.taskDeliveryBase.envelopeFingerprint !== f.priorEnvelopeFingerprint ||
        (f.deliveryRevision === 2 && f.priorEnvelopeFingerprint !== f.taskEnvelopeFingerprint)) &&
        x("delivery_binding_mismatch"),
      mt(r.registryProofs, 32, 1));
    for (let n = 0; n < r.registryProofs.length; n++) {
      let p = r.registryProofs[n];
      (xe(p, ["registrySequence", "checkpointDigest", "path"]),
        (p.registrySequence !== n + 1 ||
          this.#a.get(p.registrySequence) !== p.checkpointDigest ||
          p.path !== `/agent/v2/preparations/${r.preparationId}/registries/${n + 1}`) &&
          x("invalid_registry_proof"));
    }
    ((r.taskMetadata.taskId !== r.taskId ||
      r.taskMetadata.taskVersion !== r.taskVersion ||
      r.taskMetadata.status !== "active" ||
      r.taskMetadata.envelopeFingerprint !== f.taskEnvelopeFingerprint ||
      r.taskMetadata.executionEpoch !== r.executionEpoch) &&
      x("task_binding_mismatch"),
      ve("SignedObject", r.agentKeyGrant));
    let d = hr(Ne(r.agentKeyGrant.protected)),
      y = this.#s(d.kid, "device_sig", null);
    y.capabilities.includes("task_grant") || x("insufficient_capability");
    let i = await dt(r.agentKeyGrant, y.publicJwk, "fv-control+jws");
    (this.#r(l), ve("AgentKeyGrantPayload", i), this.#y(i));
    for (let n of [
      "taskId",
      "connectionId",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "keyEpoch",
    ])
      i[n] !== r[n] && x("grant_binding_mismatch");
    (i.deviceSigningKeyId !== y.keyId ||
      i.agentSigningKeyId !== this.#p ||
      i.agentEncryptionKeyId !== this.#o ||
      i.agentSigningKeyEpoch !== this.#s(this.#p, "agent_sig", this.#e.connectionId).keyEpoch ||
      i.agentEncryptionKeyEpoch !== this.#s(this.#o, "agent_enc", this.#e.connectionId).keyEpoch ||
      this.#s(this.#p).principalId !== this.#e.agentPrincipalId ||
      this.#s(this.#o).principalId !== this.#e.agentPrincipalId ||
      i.historyPolicy !== "selected" ||
      !we(i.taskVersions, [r.taskVersion]) ||
      this.#a.get(i.registrySequence) !== i.checkpointDigest) &&
      x("grant_binding_mismatch");
    let t = this.#s(this.#p),
      m = this.#s(this.#o);
    (Fe(r.authorizationExpiresAt, 1),
      (!(i.notBefore <= this.#m() && this.#m() < i.expiresAt) ||
        i.expiresAt - i.notBefore > 2592e3 ||
        i.notBefore < Math.max(y.notBefore, t.notBefore, m.notBefore) ||
        i.expiresAt > Math.min(r.authorizationExpiresAt, y.expiresAt, t.expiresAt, m.expiresAt)) &&
        x("grant_expired_or_untrusted"),
      we(i.writebackRecipientKeyIds, [...new Set(i.writebackRecipientKeyIds)].sort()) ||
        x("invalid_recipients"));
    let s = [];
    for (let n of i.writebackRecipientKeyIds) {
      let p = this.#s(n, null, null);
      (s.push(p.role),
        (!["device_enc", "recovery_enc"].includes(p.role) ||
          i.expiresAt > p.expiresAt ||
          i.notBefore < p.notBefore) &&
          x("invalid_recipients"));
    }
    (!s.includes("device_enc") || !s.includes("recovery_enc")) && x("invalid_recipients");
    let u = [];
    for (let n of i.resourceBindings)
      ((n.versionAccess !== "selected" || n.selectedVersions.length !== 1) &&
        x("resource_not_selected"),
        u.push(nr(n.ref)));
    (De(u),
      we(
        i.resourceBindings.map((n) => ({ ref: n.ref, sourceEpoch: n.sourceEpoch })),
        r.taskMetadata.resourceBindings,
      ) || x("resource_set_mismatch"),
      mt(r.objects, 11, 1));
    let w = r.objects
      .map((n) => ({ objectId: n.objectId, envelopeFingerprint: n.envelopeFingerprint }))
      .sort((n, p) => (n.objectId < p.objectId ? -1 : n.objectId > p.objectId ? 1 : 0));
    we(w, f.objects) || x("delivery_binding_mismatch");
    let c = [],
      a = [],
      o = 0;
    for (let n of r.objects) {
      xe(n, [
        "objectId",
        "objectType",
        "revision",
        "deliveryRevision",
        "priorEnvelopeFingerprint",
        "envelopeFingerprint",
        "resourceRef",
        "sourceEpoch",
        "sourceRevision",
        "producerSnapshotId",
        "path",
        "provenance",
      ]);
      for (let p of [
        "objectId",
        "objectType",
        "revision",
        "deliveryRevision",
        "envelopeFingerprint",
        "resourceRef",
        "sourceEpoch",
        "sourceRevision",
        "path",
        "provenance",
      ])
        Object.hasOwn(n, p) || x("invalid_descriptor");
      if (
        (ve("Identifier", n.objectId),
        Fe(n.revision, 1),
        Fe(n.deliveryRevision, 1),
        yr(n.envelopeFingerprint),
        n.path !== `/agent/v2/preparations/${r.preparationId}/objects/${n.objectId}` &&
          x("invalid_descriptor"),
        c.push(n.objectId),
        n.objectType === "task")
      )
        (o++,
          (n.objectId !== r.taskId ||
            n.revision !== r.taskVersion ||
            n.deliveryRevision !== f.deliveryRevision ||
            n.envelopeFingerprint !== f.taskDeliveryFingerprint ||
            n.priorEnvelopeFingerprint !== f.priorEnvelopeFingerprint ||
            n.producerSnapshotId !== null ||
            n.resourceRef !== null ||
            n.sourceEpoch !== null ||
            n.sourceRevision !== null ||
            n.provenance !== "task_reshare") &&
            x("task_binding_mismatch"));
      else {
        let p = i.resourceBindings.find((h) => we(h.ref, n.resourceRef));
        ((!p ||
          n.sourceEpoch !== p.sourceEpoch ||
          n.sourceRevision !== n.revision ||
          !p.selectedVersions.includes(n.revision) ||
          n.deliveryRevision !== 1 ||
          n.priorEnvelopeFingerprint !== null ||
          n.objectType !==
            {
              holdings: "holdings_snapshot",
              watchlist: "watchlist_evidence",
              channel_follows: "channel_follows_evidence",
            }[p.ref.kind] ||
          n.provenance !== "owner_attested_copy") &&
          x("resource_not_authorized"),
          a.push(nr(n.resourceRef)),
          n.producerSnapshotId !== null && ve("Identifier", n.producerSnapshotId));
      }
    }
    (De(c),
      De(a),
      (o !== 1 || a.length !== u.length || u.some((n) => !a.includes(n))) &&
        x("resource_set_mismatch"),
      (this.#l = structuredClone(r)),
      (this.#c = i),
      (this.#i = "ACTIVE"));
  }
  async #K(r, l, f) {
    (this.#i !== "ACTIVE" || !this.#l || !this.#c) && x("grant_required");
    let d = this.#l,
      y = this.#c,
      i = this.#u;
    this.#m() >= Math.min(y.expiresAt, d.authorizationExpiresAt) &&
      (this.#f("LOCKED"), x("grant_expired_or_untrusted"));
    let t = d.objects.find((v) => v.objectId === r);
    (t || x("object_not_authorized"),
      ve("Carrier", l),
      (l.contractVersion !== Ht || Ue(l).length > Zi) && x("unsupported_contract"),
      (await en(l)) !== t.envelopeFingerprint && x("component_fingerprint_mismatch"),
      this.#r(f));
    let m = hr(Ne(l.signedObject.payload), !0);
    ve("ObjectMessage", m);
    let s = m.context;
    (this.#y(s),
      ve("Context", s),
      (s.profileId !== "P1" ||
        s.objectId !== t.objectId ||
        s.objectType !== t.objectType ||
        s.revision !== t.revision ||
        s.deliveryRevision !== t.deliveryRevision ||
        s.rootKeyId !== this.#e.rootKeyId ||
        s.rootEpoch !== this.#e.rootEpoch ||
        s.keyEpoch !== this.#t.keyEpoch ||
        this.#a.get(s.registrySequence) !== s.checkpointDigest) &&
        x("object_binding_mismatch"));
    let u = Object.fromEntries(Ys.map((v) => [v, null]));
    (s.objectType === "task"
      ? (y.capabilities.includes("decrypt_task") || x("insufficient_capability"),
        (u.taskId = d.taskId),
        (u.taskVersion = d.taskVersion),
        (s.expectedRevision !== s.revision ||
          s.operationType !== "reshare_delivery" ||
          s.priorEnvelopeFingerprint !== i.priorEnvelopeFingerprint ||
          !we(s.resourceBindings, d.taskMetadata.resourceBindings)) &&
          x("task_binding_mismatch"))
      : (y.capabilities.includes("decrypt_resources") || x("insufficient_capability"),
        (u.resourceRef = t.resourceRef),
        (u.sourceRevision = t.sourceRevision),
        (u.sourceEpoch = t.sourceEpoch),
        (s.expectedRevision !== s.revision - 1 ||
          s.operationType !==
            (s.objectType === "holdings_snapshot" ? "commit_snapshot" : "commit_evidence") ||
          s.priorEnvelopeFingerprint !== null ||
          s.resourceBindings.length) &&
          x("resource_binding_mismatch")),
      we(s.binding, u) || x("object_binding_mismatch"));
    let w = this.#s(s.authorSigningKeyId, "device_sig", null);
    w.capabilities.includes("object_write") || x("insufficient_capability");
    let c = await dt(l.signedObject, w.publicJwk, "fv-object+jws");
    (this.#r(f), we(m, c) || x("invalid_signature"));
    let a = [...y.writebackRecipientKeyIds, this.#o].sort(),
      o = [];
    for (let v of s.recipients) {
      let g = this.#s(v.keyId);
      (o.push(v.keyId),
        we(
          v,
          Object.fromEntries(
            ["keyId", "role", "principalId", "connectionId", "keyEpoch"].map((P) => [P, g[P]]),
          ),
        ) || x("recipient_binding_mismatch"));
    }
    we(o, a) || x("recipient_binding_mismatch");
    let n = c.jwe;
    (xe(n, ["protected", "recipients", "iv", "ciphertext", "tag", "aad"]),
      (!we(hr(Ne(n.protected)), Xs) ||
        !Ji(Ne(n.aad), Ue(s)) ||
        Ne(n.iv).length !== 12 ||
        Ne(n.tag).length !== 16 ||
        Ne(n.ciphertext).length > (s.objectType === "task" ? 65536 : 196608) ||
        Ue(s).length > 16384 ||
        n.recipients.length !== o.length) &&
        x("invalid_jwe_profile"));
    for (let v = 0; v < o.length; v++) {
      let g = n.recipients[v];
      (xe(g, ["header", "encrypted_key"]),
        xe(g.header, ["kid", "epk"]),
        (g.header.kid !== o[v] || Ne(g.encrypted_key).length !== 40) &&
          x("recipient_binding_mismatch"),
        await Bi(g.header.epk),
        this.#r(f));
    }
    let p = await Ot(n, this.#g.enc, {
      keyManagementAlgorithms: ["ECDH-ES+A256KW"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    this.#r(f);
    let h = sn(hr(p.plaintext, !0), s);
    return (
      this.#r(f),
      {
        objectId: t.objectId,
        objectType: t.objectType,
        revision: t.revision,
        provenance: t.provenance,
        payload: h,
      }
    );
  }
};
var Wi = !1;
typeof self < "u" &&
  (self.onmessage = ({ data: e }) => {
    if (
      Wi ||
      e?.op !== "attach" ||
      !(e.ownerPort instanceof MessagePort) ||
      !(e.agentPort instanceof MessagePort) ||
      e.ownerPort === e.agentPort
    )
      return;
    Wi = !0;
    let r = new ut({
      onInvalidate: (l) => {
        (e.ownerPort.postMessage(l), e.agentPort.postMessage(l));
      },
    });
    for (let [l, f] of [
      [e.ownerPort, !0],
      [e.agentPort, !1],
    ])
      ((l.onmessage = async ({ data: d }) => {
        let y = typeof d?.id == "string" ? d.id : "invalid";
        try {
          let i = await r.dispatch(d, f);
          l.postMessage({ id: y, ok: !0, value: i });
        } catch (i) {
          l.postMessage({
            id: y,
            ok: !1,
            error: { code: i instanceof vr ? i.code : "crypto_operation_rejected" },
          });
        }
      }),
        l.start());
  });
export { ut as ForegroundSession, vr as HelperDenied };
