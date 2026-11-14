var Yr = Object.create;
var br = Object.defineProperty;
var Jr = Object.getOwnPropertyDescriptor;
var Qr = Object.getOwnPropertyNames;
var Xr = Object.getPrototypeOf,
  es = Object.prototype.hasOwnProperty;
var cr = (e, t) => () => {
  try {
    return (t || e((t = { exports: {} }).exports, t), t.exports);
  } catch (p) {
    throw ((t = 0), p);
  }
};
var rs = (e, t, p, h) => {
  if ((t && typeof t == "object") || typeof t == "function")
    for (let i of Qr(t))
      !es.call(e, i) &&
        i !== p &&
        br(e, i, { get: () => t[i], enumerable: !(h = Jr(t, i)) || h.enumerable });
  return e;
};
var _r = (e, t, p) => (
  (p = e != null ? Yr(Xr(e)) : {}),
  rs(t || !e || !e.__esModule ? br(p, "default", { value: e, enumerable: !0 }) : p, e)
);
var mr = cr((dr) => {
  "use strict";
  Object.defineProperty(dr, "__esModule", { value: !0 });
  function Ir(e) {
    let t = e.length,
      p = 0,
      h = 0,
      i;
    for (; h < t;)
      (p++,
        (i = e.charCodeAt(h++)),
        i >= 55296 && i <= 56319 && h < t && ((i = e.charCodeAt(h)), (i & 64512) === 56320 && h++));
    return p;
  }
  dr.default = Ir;
  Ir.code = 'require("ajv/dist/runtime/ucs2length").default';
});
var qr = cr((Q) => {
  "use strict";
  Q.Currency = Ke;
  var Ar = {
    enum: ["USD", "CAD", "CNY", "EUR", "GBP", "JPY", "HKD", "AUD", "CHF", "NZD", "SGD", "TWD"],
  };
  function Ee(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Ee.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      e === "USD" ||
      e === "CAD" ||
      e === "CNY" ||
      e === "EUR" ||
      e === "GBP" ||
      e === "JPY" ||
      e === "HKD" ||
      e === "AUD" ||
      e === "CHF" ||
      e === "NZD" ||
      e === "SGD" ||
      e === "TWD"
        ? ((Ee.errors = s), r === 0)
        : ((Ee.errors = [
            {
              instancePath: t,
              schemaPath: "#/enum",
              keyword: "enum",
              params: { allowedValues: Ar.enum },
            },
          ]),
          !1)
    );
  }
  Ee.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function Ke(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Ke.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      Ee(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? Ee.errors : s.concat(Ee.errors)), (r = s.length)),
      (Ke.errors = s),
      r === 0
    );
  }
  Ke.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  Q.Date = ze;
  var $r = /^\d{4}-\d{2}-\d{2}$/,
    K = mr().default,
    xr = new RegExp("^\\d{4}-\\d{2}-\\d{2}$", "u");
  function he(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = he.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      r === 0 && r === 0)
    )
      if (typeof e == "string") {
        if (K(e) > 10)
          return (
            (he.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 10 },
              },
            ]),
            !1
          );
        if (K(e) < 1)
          return (
            (he.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (xr.test(e)) {
          if (!$r.test(e))
            return (
              (he.errors = [
                {
                  instancePath: t,
                  schemaPath: "#/format",
                  keyword: "format",
                  params: { format: "date" },
                },
              ]),
              !1
            );
        } else
          return (
            (he.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (he.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((he.errors = s), r === 0);
  }
  he.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function ze(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ze.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      he(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? he.errors : s.concat(he.errors)), (r = s.length)),
      (ze.errors = s),
      r === 0
    );
  }
  ze.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  Q.Timestamp = Be;
  var Or = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/,
    Cr = new RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$", "u");
  function ve(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ve.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      r === 0 && r === 0)
    )
      if (typeof e == "string") {
        if (K(e) > 32)
          return (
            (ve.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 32 },
              },
            ]),
            !1
          );
        if (K(e) < 1)
          return (
            (ve.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (Cr.test(e)) {
          if (!Or.test(e))
            return (
              (ve.errors = [
                {
                  instancePath: t,
                  schemaPath: "#/format",
                  keyword: "format",
                  params: { format: "date-time" },
                },
              ]),
              !1
            );
        } else
          return (
            (ve.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$" },
              },
            ]),
            !1
          );
      } else
        return (
          (ve.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((ve.errors = s), r === 0);
  }
  ve.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function Be(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Be.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      ve(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? ve.errors : s.concat(ve.errors)), (r = s.length)),
      (Be.errors = s),
      r === 0
    );
  }
  Be.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  Q.QuoteRequest = He;
  var ss = new RegExp("^[A-Z0-9][A-Z0-9.\\-^]{0,31}$", "u");
  function ge(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ge.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (K(e) > 32)
          return (
            (ge.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 32 },
              },
            ]),
            !1
          );
        if (K(e) < 1)
          return (
            (ge.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!ss.test(e))
          return (
            (ge.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Z0-9][A-Z0-9.\\-^]{0,31}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (ge.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((ge.errors = s), r === 0);
  }
  ge.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var ts = new RegExp("^(?:[A-Z0-9]{4}|UNKNOWN)$", "u");
  function ke(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ke.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (K(e) > 7)
          return (
            (ke.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 7 },
              },
            ]),
            !1
          );
        if (K(e) < 4)
          return (
            (ke.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 4 },
              },
            ]),
            !1
          );
        if (!ts.test(e))
          return (
            (ke.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^(?:[A-Z0-9]{4}|UNKNOWN)$" },
              },
            ]),
            !1
          );
      } else
        return (
          (ke.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((ke.errors = s), r === 0);
  }
  ke.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function $(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = $.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      e === "USD" ||
      e === "CAD" ||
      e === "CNY" ||
      e === "EUR" ||
      e === "GBP" ||
      e === "JPY" ||
      e === "HKD" ||
      e === "AUD" ||
      e === "CHF" ||
      e === "NZD" ||
      e === "SGD" ||
      e === "TWD"
        ? (($.errors = s), r === 0)
        : (($.errors = [
            {
              instancePath: t,
              schemaPath: "#/enum",
              keyword: "enum",
              params: { allowedValues: Ar.enum },
            },
          ]),
          !1)
    );
  }
  $.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function pe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = pe.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (
          (e.symbol === void 0 && (m = "symbol")) ||
          (e.market === void 0 && (m = "market")) ||
          (e.currency === void 0 && (m = "currency"))
        )
          return (
            (pe.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "symbol" || f === "market" || f === "currency")) {
              return (
                (pe.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.symbol !== void 0) {
              let f = r;
              ge(e.symbol, {
                instancePath: t + "/symbol",
                parentData: e,
                parentDataProperty: "symbol",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? ge.errors : s.concat(ge.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n) {
              if (e.market !== void 0) {
                let f = r;
                ke(e.market, {
                  instancePath: t + "/market",
                  parentData: e,
                  parentDataProperty: "market",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? ke.errors : s.concat(ke.errors)), (r = s.length));
                var n = f === r;
              } else var n = !0;
              if (n)
                if (e.currency !== void 0) {
                  let f = r;
                  $(e.currency, {
                    instancePath: t + "/currency",
                    parentData: e,
                    parentDataProperty: "currency",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
                  var n = f === r;
                } else var n = !0;
            }
          }
        }
      } else
        return (
          (pe.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((pe.errors = s), r === 0);
  }
  pe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ae(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ae.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (e.instruments === void 0 && (m = "instruments"))
          return (
            (ae.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (f !== "instruments") {
              return (
                (ae.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r && e.instruments !== void 0) {
            let f = e.instruments;
            if (r === r)
              if (Array.isArray(f)) {
                if (f.length > 50)
                  return (
                    (ae.errors = [
                      {
                        instancePath: t + "/instruments",
                        schemaPath: "#/properties/instruments/maxItems",
                        keyword: "maxItems",
                        params: { limit: 50 },
                      },
                    ]),
                    !1
                  );
                if (f.length < 1)
                  return (
                    (ae.errors = [
                      {
                        instancePath: t + "/instruments",
                        schemaPath: "#/properties/instruments/minItems",
                        keyword: "minItems",
                        params: { limit: 1 },
                      },
                    ]),
                    !1
                  );
                {
                  var n = !0;
                  let P = f.length;
                  for (let g = 0; g < P; g++) {
                    let y = r;
                    pe(f[g], {
                      instancePath: t + "/instruments/" + g,
                      parentData: f,
                      parentDataProperty: g,
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? pe.errors : s.concat(pe.errors)), (r = s.length));
                    var n = y === r;
                    if (!n) break;
                  }
                }
              } else
                return (
                  (ae.errors = [
                    {
                      instancePath: t + "/instruments",
                      schemaPath: "#/properties/instruments/type",
                      keyword: "type",
                      params: { type: "array" },
                    },
                  ]),
                  !1
                );
          }
        }
      } else
        return (
          (ae.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ae.errors = s), r === 0);
  }
  ae.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function He(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = He.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      ae(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? ae.errors : s.concat(ae.errors)), (r = s.length)),
      (He.errors = s),
      r === 0
    );
  }
  He.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.FxRequest = We;
  function H(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = H.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if ((e.base === void 0 && (m = "base")) || (e.quote === void 0 && (m = "quote")))
          return (
            (H.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "base" || f === "quote")) {
              return (
                (H.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.base !== void 0) {
              let f = r;
              $(e.base, {
                instancePath: t + "/base",
                parentData: e,
                parentDataProperty: "base",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n)
              if (e.quote !== void 0) {
                let f = r;
                $(e.quote, {
                  instancePath: t + "/quote",
                  parentData: e,
                  parentDataProperty: "quote",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
                var n = f === r;
              } else var n = !0;
          }
        }
      } else
        return (
          (H.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((H.errors = s), r === 0);
  }
  H.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ie(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ie.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (e.pairs === void 0 && (m = "pairs"))
          return (
            (ie.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (f !== "pairs") {
              return (
                (ie.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r && e.pairs !== void 0) {
            let f = e.pairs;
            if (r === r)
              if (Array.isArray(f)) {
                if (f.length > 20)
                  return (
                    (ie.errors = [
                      {
                        instancePath: t + "/pairs",
                        schemaPath: "#/properties/pairs/maxItems",
                        keyword: "maxItems",
                        params: { limit: 20 },
                      },
                    ]),
                    !1
                  );
                if (f.length < 1)
                  return (
                    (ie.errors = [
                      {
                        instancePath: t + "/pairs",
                        schemaPath: "#/properties/pairs/minItems",
                        keyword: "minItems",
                        params: { limit: 1 },
                      },
                    ]),
                    !1
                  );
                {
                  var n = !0;
                  let P = f.length;
                  for (let g = 0; g < P; g++) {
                    let y = r;
                    H(f[g], {
                      instancePath: t + "/pairs/" + g,
                      parentData: f,
                      parentDataProperty: g,
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? H.errors : s.concat(H.errors)), (r = s.length));
                    var n = y === r;
                    if (!n) break;
                  }
                }
              } else
                return (
                  (ie.errors = [
                    {
                      instancePath: t + "/pairs",
                      schemaPath: "#/properties/pairs/type",
                      keyword: "type",
                      params: { type: "array" },
                    },
                  ]),
                  !1
                );
          }
        }
      } else
        return (
          (ie.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ie.errors = s), r === 0);
  }
  ie.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function We(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = We.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      ie(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? ie.errors : s.concat(ie.errors)), (r = s.length)),
      (We.errors = s),
      r === 0
    );
  }
  We.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.QuoteBatch = Me;
  var ns = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "u");
  function re(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = re.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (K(e) > 128)
          return (
            (re.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 128 },
              },
            ]),
            !1
          );
        if (K(e) < 1)
          return (
            (re.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!ns.test(e))
          return (
            (re.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (re.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((re.errors = s), r === 0);
  }
  re.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function q(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = q.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      r === 0 && r === 0)
    )
      if (typeof e == "string") {
        if (K(e) > 32)
          return (
            (q.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 32 },
              },
            ]),
            !1
          );
        if (K(e) < 1)
          return (
            (q.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (Cr.test(e)) {
          if (!Or.test(e))
            return (
              (q.errors = [
                {
                  instancePath: t,
                  schemaPath: "#/format",
                  keyword: "format",
                  params: { format: "date-time" },
                },
              ]),
              !1
            );
        } else
          return (
            (q.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$" },
              },
            ]),
            !1
          );
      } else
        return (
          (q.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((q.errors = s), r === 0);
  }
  q.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var yr = {
      type: "object",
      properties: {
        instrument: { $ref: "#/$defs/Instrument" },
        price: { anyOf: [{ $ref: "#/$defs/Decimal" }, { type: "null" }] },
        source: { enum: ["yahoo_finance", "none"] },
        status: { enum: ["available", "stale", "missing", "unsupported"] },
        sourceAsOf: { anyOf: [{ $ref: "#/$defs/Timestamp" }, { type: "null" }] },
        sourceDate: { anyOf: [{ $ref: "#/$defs/Date" }, { type: "null" }] },
        fetchedAt: { $ref: "#/$defs/Timestamp" },
        reason: {
          anyOf: [
            {
              enum: [
                "not_found",
                "unsupported_market",
                "currency_mismatch",
                "invalid_value",
                "unknown_time",
                "upstream_unavailable",
                "rate_limited",
                "budget_exhausted",
                "missing_leg",
                "mixed_dates",
              ],
            },
            { type: "null" },
          ],
        },
      },
      required: [
        "instrument",
        "price",
        "source",
        "status",
        "sourceAsOf",
        "sourceDate",
        "fetchedAt",
        "reason",
      ],
      additionalProperties: !1,
    },
    as = new RegExp("^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$", "u");
  function G(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = G.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (K(e) > 39)
          return (
            (G.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 39 },
              },
            ]),
            !1
          );
        if (K(e) < 1)
          return (
            (G.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!as.test(e))
          return (
            (G.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$" },
              },
            ]),
            !1
          );
      } else
        return (
          (G.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((G.errors = s), r === 0);
  }
  G.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function Z(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Z.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      r === 0 && r === 0)
    )
      if (typeof e == "string") {
        if (K(e) > 10)
          return (
            (Z.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 10 },
              },
            ]),
            !1
          );
        if (K(e) < 1)
          return (
            (Z.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (xr.test(e)) {
          if (!$r.test(e))
            return (
              (Z.errors = [
                {
                  instancePath: t,
                  schemaPath: "#/format",
                  keyword: "format",
                  params: { format: "date" },
                },
              ]),
              !1
            );
        } else
          return (
            (Z.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (Z.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((Z.errors = s), r === 0);
  }
  Z.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function B(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = B.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let P;
        if (
          (e.instrument === void 0 && (P = "instrument")) ||
          (e.price === void 0 && (P = "price")) ||
          (e.source === void 0 && (P = "source")) ||
          (e.status === void 0 && (P = "status")) ||
          (e.sourceAsOf === void 0 && (P = "sourceAsOf")) ||
          (e.sourceDate === void 0 && (P = "sourceDate")) ||
          (e.fetchedAt === void 0 && (P = "fetchedAt")) ||
          (e.reason === void 0 && (P = "reason"))
        )
          return (
            (B.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: P },
              },
            ]),
            !1
          );
        {
          let g = r;
          for (let y in e)
            if (!(
              y === "instrument" ||
              y === "price" ||
              y === "source" ||
              y === "status" ||
              y === "sourceAsOf" ||
              y === "sourceDate" ||
              y === "fetchedAt" ||
              y === "reason"
            )) {
              return (
                (B.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: y },
                  },
                ]),
                !1
              );
              break;
            }
          if (g === r) {
            if (e.instrument !== void 0) {
              let y = r;
              pe(e.instrument, {
                instancePath: t + "/instrument",
                parentData: e,
                parentDataProperty: "instrument",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? pe.errors : s.concat(pe.errors)), (r = s.length));
              var n = y === r;
            } else var n = !0;
            if (n) {
              if (e.price !== void 0) {
                let y = e.price,
                  u = r,
                  d = r,
                  c = !1,
                  k = r;
                G(y, {
                  instancePath: t + "/price",
                  parentData: e,
                  parentDataProperty: "price",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? G.errors : s.concat(G.errors)), (r = s.length));
                var m = k === r;
                c = c || m;
                let D = r;
                if (y !== null) {
                  let _ = {
                    instancePath: t + "/price",
                    schemaPath: "#/properties/price/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (s === null ? (s = [_]) : s.push(_), r++);
                }
                var m = D === r;
                if (((c = c || m), c)) ((r = d), s !== null && (d ? (s.length = d) : (s = null)));
                else {
                  let _ = {
                    instancePath: t + "/price",
                    schemaPath: "#/properties/price/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (s === null ? (s = [_]) : s.push(_), r++, (B.errors = s), !1);
                }
                var n = u === r;
              } else var n = !0;
              if (n) {
                if (e.source !== void 0) {
                  let y = e.source,
                    u = r;
                  if (!(y === "yahoo_finance" || y === "none"))
                    return (
                      (B.errors = [
                        {
                          instancePath: t + "/source",
                          schemaPath: "#/properties/source/enum",
                          keyword: "enum",
                          params: { allowedValues: yr.properties.source.enum },
                        },
                      ]),
                      !1
                    );
                  var n = u === r;
                } else var n = !0;
                if (n) {
                  if (e.status !== void 0) {
                    let y = e.status,
                      u = r;
                    if (!(
                      y === "available" ||
                      y === "stale" ||
                      y === "missing" ||
                      y === "unsupported"
                    ))
                      return (
                        (B.errors = [
                          {
                            instancePath: t + "/status",
                            schemaPath: "#/properties/status/enum",
                            keyword: "enum",
                            params: { allowedValues: yr.properties.status.enum },
                          },
                        ]),
                        !1
                      );
                    var n = u === r;
                  } else var n = !0;
                  if (n) {
                    if (e.sourceAsOf !== void 0) {
                      let y = e.sourceAsOf,
                        u = r,
                        d = r,
                        c = !1,
                        k = r;
                      q(y, {
                        instancePath: t + "/sourceAsOf",
                        parentData: e,
                        parentDataProperty: "sourceAsOf",
                        rootData: i,
                        dynamicAnchors: o,
                      }) || ((s = s === null ? q.errors : s.concat(q.errors)), (r = s.length));
                      var v = k === r;
                      c = c || v;
                      let D = r;
                      if (y !== null) {
                        let _ = {
                          instancePath: t + "/sourceAsOf",
                          schemaPath: "#/properties/sourceAsOf/anyOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                        };
                        (s === null ? (s = [_]) : s.push(_), r++);
                      }
                      var v = D === r;
                      if (((c = c || v), c))
                        ((r = d), s !== null && (d ? (s.length = d) : (s = null)));
                      else {
                        let _ = {
                          instancePath: t + "/sourceAsOf",
                          schemaPath: "#/properties/sourceAsOf/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        return (s === null ? (s = [_]) : s.push(_), r++, (B.errors = s), !1);
                      }
                      var n = u === r;
                    } else var n = !0;
                    if (n) {
                      if (e.sourceDate !== void 0) {
                        let y = e.sourceDate,
                          u = r,
                          d = r,
                          c = !1,
                          k = r;
                        Z(y, {
                          instancePath: t + "/sourceDate",
                          parentData: e,
                          parentDataProperty: "sourceDate",
                          rootData: i,
                          dynamicAnchors: o,
                        }) || ((s = s === null ? Z.errors : s.concat(Z.errors)), (r = s.length));
                        var f = k === r;
                        c = c || f;
                        let D = r;
                        if (y !== null) {
                          let _ = {
                            instancePath: t + "/sourceDate",
                            schemaPath: "#/properties/sourceDate/anyOf/1/type",
                            keyword: "type",
                            params: { type: "null" },
                          };
                          (s === null ? (s = [_]) : s.push(_), r++);
                        }
                        var f = D === r;
                        if (((c = c || f), c))
                          ((r = d), s !== null && (d ? (s.length = d) : (s = null)));
                        else {
                          let _ = {
                            instancePath: t + "/sourceDate",
                            schemaPath: "#/properties/sourceDate/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          return (s === null ? (s = [_]) : s.push(_), r++, (B.errors = s), !1);
                        }
                        var n = u === r;
                      } else var n = !0;
                      if (n) {
                        if (e.fetchedAt !== void 0) {
                          let y = r;
                          q(e.fetchedAt, {
                            instancePath: t + "/fetchedAt",
                            parentData: e,
                            parentDataProperty: "fetchedAt",
                            rootData: i,
                            dynamicAnchors: o,
                          }) || ((s = s === null ? q.errors : s.concat(q.errors)), (r = s.length));
                          var n = y === r;
                        } else var n = !0;
                        if (n)
                          if (e.reason !== void 0) {
                            let y = e.reason,
                              u = r,
                              d = r,
                              c = !1,
                              k = r;
                            if (!(
                              y === "not_found" ||
                              y === "unsupported_market" ||
                              y === "currency_mismatch" ||
                              y === "invalid_value" ||
                              y === "unknown_time" ||
                              y === "upstream_unavailable" ||
                              y === "rate_limited" ||
                              y === "budget_exhausted" ||
                              y === "missing_leg" ||
                              y === "mixed_dates"
                            )) {
                              let _ = {
                                instancePath: t + "/reason",
                                schemaPath: "#/properties/reason/anyOf/0/enum",
                                keyword: "enum",
                                params: { allowedValues: yr.properties.reason.anyOf[0].enum },
                              };
                              (s === null ? (s = [_]) : s.push(_), r++);
                            }
                            var l = k === r;
                            c = c || l;
                            let D = r;
                            if (y !== null) {
                              let _ = {
                                instancePath: t + "/reason",
                                schemaPath: "#/properties/reason/anyOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                              };
                              (s === null ? (s = [_]) : s.push(_), r++);
                            }
                            var l = D === r;
                            if (((c = c || l), c))
                              ((r = d), s !== null && (d ? (s.length = d) : (s = null)));
                            else {
                              let _ = {
                                instancePath: t + "/reason",
                                schemaPath: "#/properties/reason/anyOf",
                                keyword: "anyOf",
                                params: {},
                              };
                              return (s === null ? (s = [_]) : s.push(_), r++, (B.errors = s), !1);
                            }
                            var n = u === r;
                          } else var n = !0;
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
          (B.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((B.errors = s), r === 0);
  }
  B.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function M(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = M.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (
          (e.contractVersion === void 0 && (v = "contractVersion")) ||
          (e.profile === void 0 && (v = "profile")) ||
          (e.snapshotId === void 0 && (v = "snapshotId")) ||
          (e.fetchedAt === void 0 && (v = "fetchedAt")) ||
          (e.items === void 0 && (v = "items"))
        )
          return (
            (M.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(
              l === "contractVersion" ||
              l === "profile" ||
              l === "snapshotId" ||
              l === "fetchedAt" ||
              l === "items"
            )) {
              return (
                (M.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.contractVersion !== void 0) {
              let l = r;
              if (e.contractVersion !== "folioview.valuation.v1")
                return (
                  (M.errors = [
                    {
                      instancePath: t + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.valuation.v1" },
                    },
                  ]),
                  !1
                );
              var n = l === r;
            } else var n = !0;
            if (n) {
              if (e.profile !== void 0) {
                let l = r;
                if (e.profile !== "folioview.quote-batch.v1")
                  return (
                    (M.errors = [
                      {
                        instancePath: t + "/profile",
                        schemaPath: "#/properties/profile/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.quote-batch.v1" },
                      },
                    ]),
                    !1
                  );
                var n = l === r;
              } else var n = !0;
              if (n) {
                if (e.snapshotId !== void 0) {
                  let l = r;
                  re(e.snapshotId, {
                    instancePath: t + "/snapshotId",
                    parentData: e,
                    parentDataProperty: "snapshotId",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? re.errors : s.concat(re.errors)), (r = s.length));
                  var n = l === r;
                } else var n = !0;
                if (n) {
                  if (e.fetchedAt !== void 0) {
                    let l = r;
                    q(e.fetchedAt, {
                      instancePath: t + "/fetchedAt",
                      parentData: e,
                      parentDataProperty: "fetchedAt",
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? q.errors : s.concat(q.errors)), (r = s.length));
                    var n = l === r;
                  } else var n = !0;
                  if (n)
                    if (e.items !== void 0) {
                      let l = e.items,
                        P = r;
                      if (r === P)
                        if (Array.isArray(l)) {
                          if (l.length > 50)
                            return (
                              (M.errors = [
                                {
                                  instancePath: t + "/items",
                                  schemaPath: "#/properties/items/maxItems",
                                  keyword: "maxItems",
                                  params: { limit: 50 },
                                },
                              ]),
                              !1
                            );
                          if (l.length < 0)
                            return (
                              (M.errors = [
                                {
                                  instancePath: t + "/items",
                                  schemaPath: "#/properties/items/minItems",
                                  keyword: "minItems",
                                  params: { limit: 0 },
                                },
                              ]),
                              !1
                            );
                          {
                            var m = !0;
                            let y = l.length;
                            for (let u = 0; u < y; u++) {
                              let d = r;
                              B(l[u], {
                                instancePath: t + "/items/" + u,
                                parentData: l,
                                parentDataProperty: u,
                                rootData: i,
                                dynamicAnchors: o,
                              }) ||
                                ((s = s === null ? B.errors : s.concat(B.errors)), (r = s.length));
                              var m = d === r;
                              if (!m) break;
                            }
                          }
                        } else
                          return (
                            (M.errors = [
                              {
                                instancePath: t + "/items",
                                schemaPath: "#/properties/items/type",
                                keyword: "type",
                                params: { type: "array" },
                              },
                            ]),
                            !1
                          );
                      var n = P === r;
                    } else var n = !0;
                }
              }
            }
          }
        }
      } else
        return (
          (M.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((M.errors = s), r === 0);
  }
  M.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Me(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Me.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      M(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? M.errors : s.concat(M.errors)), (r = s.length)),
      (Me.errors = s),
      r === 0
    );
  }
  Me.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.FxBatch = Ye;
  var Ge = {
      type: "object",
      properties: {
        base: { $ref: "#/$defs/Currency" },
        quote: { $ref: "#/$defs/Currency" },
        rate: { anyOf: [{ $ref: "#/$defs/Decimal" }, { type: "null" }] },
        source: { enum: ["bank_of_canada", "identity", "none"] },
        route: { anyOf: [{ $ref: "#/$defs/FxRoute" }, { type: "null" }] },
        status: { enum: ["available", "stale", "missing", "unsupported"] },
        sourceAsOf: { anyOf: [{ $ref: "#/$defs/Timestamp" }, { type: "null" }] },
        sourceDate: { anyOf: [{ $ref: "#/$defs/Date" }, { type: "null" }] },
        fetchedAt: { $ref: "#/$defs/Timestamp" },
        reason: {
          anyOf: [
            {
              enum: [
                "not_found",
                "unsupported_market",
                "currency_mismatch",
                "invalid_value",
                "unknown_time",
                "upstream_unavailable",
                "rate_limited",
                "budget_exhausted",
                "missing_leg",
                "mixed_dates",
              ],
            },
            { type: "null" },
          ],
        },
      },
      required: [
        "base",
        "quote",
        "rate",
        "source",
        "route",
        "status",
        "sourceAsOf",
        "sourceDate",
        "fetchedAt",
        "reason",
      ],
      additionalProperties: !1,
    },
    is = Object.prototype.hasOwnProperty,
    os = {
      type: "object",
      properties: {
        kind: { enum: ["identity", "direct", "inverse", "cross"] },
        via: { anyOf: [{ $ref: "#/$defs/Currency" }, { type: "null" }] },
        legs: { type: "array", items: { $ref: "#/$defs/FxLeg" }, minItems: 0, maxItems: 2 },
      },
      required: ["kind", "via", "legs"],
      additionalProperties: !1,
    };
  function $e(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = $e.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (
          (e.base === void 0 && (m = "base")) ||
          (e.quote === void 0 && (m = "quote")) ||
          (e.rate === void 0 && (m = "rate")) ||
          (e.sourceDate === void 0 && (m = "sourceDate"))
        )
          return (
            ($e.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "base" || f === "quote" || f === "rate" || f === "sourceDate")) {
              return (
                ($e.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.base !== void 0) {
              let f = r;
              $(e.base, {
                instancePath: t + "/base",
                parentData: e,
                parentDataProperty: "base",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n) {
              if (e.quote !== void 0) {
                let f = r;
                $(e.quote, {
                  instancePath: t + "/quote",
                  parentData: e,
                  parentDataProperty: "quote",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
                var n = f === r;
              } else var n = !0;
              if (n) {
                if (e.rate !== void 0) {
                  let f = r;
                  G(e.rate, {
                    instancePath: t + "/rate",
                    parentData: e,
                    parentDataProperty: "rate",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? G.errors : s.concat(G.errors)), (r = s.length));
                  var n = f === r;
                } else var n = !0;
                if (n)
                  if (e.sourceDate !== void 0) {
                    let f = r;
                    Z(e.sourceDate, {
                      instancePath: t + "/sourceDate",
                      parentData: e,
                      parentDataProperty: "sourceDate",
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? Z.errors : s.concat(Z.errors)), (r = s.length));
                    var n = f === r;
                  } else var n = !0;
              }
            }
          }
        }
      } else
        return (
          ($e.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return (($e.errors = s), r === 0);
  }
  $e.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Y(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Y.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let f;
        if (
          (e.kind === void 0 && (f = "kind")) ||
          (e.via === void 0 && (f = "via")) ||
          (e.legs === void 0 && (f = "legs"))
        )
          return (
            (Y.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: f },
              },
            ]),
            !1
          );
        {
          let l = r;
          for (let P in e)
            if (!(P === "kind" || P === "via" || P === "legs")) {
              return (
                (Y.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: P },
                  },
                ]),
                !1
              );
              break;
            }
          if (l === r) {
            if (e.kind !== void 0) {
              let P = e.kind,
                g = r;
              if (!(P === "identity" || P === "direct" || P === "inverse" || P === "cross"))
                return (
                  (Y.errors = [
                    {
                      instancePath: t + "/kind",
                      schemaPath: "#/properties/kind/enum",
                      keyword: "enum",
                      params: { allowedValues: os.properties.kind.enum },
                    },
                  ]),
                  !1
                );
              var n = g === r;
            } else var n = !0;
            if (n) {
              if (e.via !== void 0) {
                let P = e.via,
                  g = r,
                  y = r,
                  u = !1,
                  d = r;
                $(P, {
                  instancePath: t + "/via",
                  parentData: e,
                  parentDataProperty: "via",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
                var m = d === r;
                u = u || m;
                let c = r;
                if (P !== null) {
                  let D = {
                    instancePath: t + "/via",
                    schemaPath: "#/properties/via/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (s === null ? (s = [D]) : s.push(D), r++);
                }
                var m = c === r;
                if (((u = u || m), u)) ((r = y), s !== null && (y ? (s.length = y) : (s = null)));
                else {
                  let D = {
                    instancePath: t + "/via",
                    schemaPath: "#/properties/via/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (s === null ? (s = [D]) : s.push(D), r++, (Y.errors = s), !1);
                }
                var n = g === r;
              } else var n = !0;
              if (n)
                if (e.legs !== void 0) {
                  let P = e.legs,
                    g = r;
                  if (r === g)
                    if (Array.isArray(P)) {
                      if (P.length > 2)
                        return (
                          (Y.errors = [
                            {
                              instancePath: t + "/legs",
                              schemaPath: "#/properties/legs/maxItems",
                              keyword: "maxItems",
                              params: { limit: 2 },
                            },
                          ]),
                          !1
                        );
                      if (P.length < 0)
                        return (
                          (Y.errors = [
                            {
                              instancePath: t + "/legs",
                              schemaPath: "#/properties/legs/minItems",
                              keyword: "minItems",
                              params: { limit: 0 },
                            },
                          ]),
                          !1
                        );
                      {
                        var v = !0;
                        let u = P.length;
                        for (let d = 0; d < u; d++) {
                          let c = r;
                          $e(P[d], {
                            instancePath: t + "/legs/" + d,
                            parentData: P,
                            parentDataProperty: d,
                            rootData: i,
                            dynamicAnchors: o,
                          }) ||
                            ((s = s === null ? $e.errors : s.concat($e.errors)), (r = s.length));
                          var v = c === r;
                          if (!v) break;
                        }
                      }
                    } else
                      return (
                        (Y.errors = [
                          {
                            instancePath: t + "/legs",
                            schemaPath: "#/properties/legs/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ]),
                        !1
                      );
                  var n = g === r;
                } else var n = !0;
            }
          }
        }
      } else
        return (
          (Y.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Y.errors = s), r === 0);
  }
  Y.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function F(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = F.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let g;
        if (
          (e.base === void 0 && (g = "base")) ||
          (e.quote === void 0 && (g = "quote")) ||
          (e.rate === void 0 && (g = "rate")) ||
          (e.source === void 0 && (g = "source")) ||
          (e.route === void 0 && (g = "route")) ||
          (e.status === void 0 && (g = "status")) ||
          (e.sourceAsOf === void 0 && (g = "sourceAsOf")) ||
          (e.sourceDate === void 0 && (g = "sourceDate")) ||
          (e.fetchedAt === void 0 && (g = "fetchedAt")) ||
          (e.reason === void 0 && (g = "reason"))
        )
          return (
            (F.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: g },
              },
            ]),
            !1
          );
        {
          let y = r;
          for (let u in e)
            if (!is.call(Ge.properties, u)) {
              return (
                (F.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: u },
                  },
                ]),
                !1
              );
              break;
            }
          if (y === r) {
            if (e.base !== void 0) {
              let u = r;
              $(e.base, {
                instancePath: t + "/base",
                parentData: e,
                parentDataProperty: "base",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
              var n = u === r;
            } else var n = !0;
            if (n) {
              if (e.quote !== void 0) {
                let u = r;
                $(e.quote, {
                  instancePath: t + "/quote",
                  parentData: e,
                  parentDataProperty: "quote",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
                var n = u === r;
              } else var n = !0;
              if (n) {
                if (e.rate !== void 0) {
                  let u = e.rate,
                    d = r,
                    c = r,
                    k = !1,
                    D = r;
                  G(u, {
                    instancePath: t + "/rate",
                    parentData: e,
                    parentDataProperty: "rate",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? G.errors : s.concat(G.errors)), (r = s.length));
                  var m = D === r;
                  k = k || m;
                  let w = r;
                  if (u !== null) {
                    let b = {
                      instancePath: t + "/rate",
                      schemaPath: "#/properties/rate/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (s === null ? (s = [b]) : s.push(b), r++);
                  }
                  var m = w === r;
                  if (((k = k || m), k)) ((r = c), s !== null && (c ? (s.length = c) : (s = null)));
                  else {
                    let b = {
                      instancePath: t + "/rate",
                      schemaPath: "#/properties/rate/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (s === null ? (s = [b]) : s.push(b), r++, (F.errors = s), !1);
                  }
                  var n = d === r;
                } else var n = !0;
                if (n) {
                  if (e.source !== void 0) {
                    let u = e.source,
                      d = r;
                    if (!(u === "bank_of_canada" || u === "identity" || u === "none"))
                      return (
                        (F.errors = [
                          {
                            instancePath: t + "/source",
                            schemaPath: "#/properties/source/enum",
                            keyword: "enum",
                            params: { allowedValues: Ge.properties.source.enum },
                          },
                        ]),
                        !1
                      );
                    var n = d === r;
                  } else var n = !0;
                  if (n) {
                    if (e.route !== void 0) {
                      let u = e.route,
                        d = r,
                        c = r,
                        k = !1,
                        D = r;
                      Y(u, {
                        instancePath: t + "/route",
                        parentData: e,
                        parentDataProperty: "route",
                        rootData: i,
                        dynamicAnchors: o,
                      }) || ((s = s === null ? Y.errors : s.concat(Y.errors)), (r = s.length));
                      var v = D === r;
                      k = k || v;
                      let w = r;
                      if (u !== null) {
                        let b = {
                          instancePath: t + "/route",
                          schemaPath: "#/properties/route/anyOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                        };
                        (s === null ? (s = [b]) : s.push(b), r++);
                      }
                      var v = w === r;
                      if (((k = k || v), k))
                        ((r = c), s !== null && (c ? (s.length = c) : (s = null)));
                      else {
                        let b = {
                          instancePath: t + "/route",
                          schemaPath: "#/properties/route/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        return (s === null ? (s = [b]) : s.push(b), r++, (F.errors = s), !1);
                      }
                      var n = d === r;
                    } else var n = !0;
                    if (n) {
                      if (e.status !== void 0) {
                        let u = e.status,
                          d = r;
                        if (!(
                          u === "available" ||
                          u === "stale" ||
                          u === "missing" ||
                          u === "unsupported"
                        ))
                          return (
                            (F.errors = [
                              {
                                instancePath: t + "/status",
                                schemaPath: "#/properties/status/enum",
                                keyword: "enum",
                                params: { allowedValues: Ge.properties.status.enum },
                              },
                            ]),
                            !1
                          );
                        var n = d === r;
                      } else var n = !0;
                      if (n) {
                        if (e.sourceAsOf !== void 0) {
                          let u = e.sourceAsOf,
                            d = r,
                            c = r,
                            k = !1,
                            D = r;
                          q(u, {
                            instancePath: t + "/sourceAsOf",
                            parentData: e,
                            parentDataProperty: "sourceAsOf",
                            rootData: i,
                            dynamicAnchors: o,
                          }) || ((s = s === null ? q.errors : s.concat(q.errors)), (r = s.length));
                          var f = D === r;
                          k = k || f;
                          let w = r;
                          if (u !== null) {
                            let b = {
                              instancePath: t + "/sourceAsOf",
                              schemaPath: "#/properties/sourceAsOf/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            (s === null ? (s = [b]) : s.push(b), r++);
                          }
                          var f = w === r;
                          if (((k = k || f), k))
                            ((r = c), s !== null && (c ? (s.length = c) : (s = null)));
                          else {
                            let b = {
                              instancePath: t + "/sourceAsOf",
                              schemaPath: "#/properties/sourceAsOf/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            return (s === null ? (s = [b]) : s.push(b), r++, (F.errors = s), !1);
                          }
                          var n = d === r;
                        } else var n = !0;
                        if (n) {
                          if (e.sourceDate !== void 0) {
                            let u = e.sourceDate,
                              d = r,
                              c = r,
                              k = !1,
                              D = r;
                            Z(u, {
                              instancePath: t + "/sourceDate",
                              parentData: e,
                              parentDataProperty: "sourceDate",
                              rootData: i,
                              dynamicAnchors: o,
                            }) ||
                              ((s = s === null ? Z.errors : s.concat(Z.errors)), (r = s.length));
                            var l = D === r;
                            k = k || l;
                            let w = r;
                            if (u !== null) {
                              let b = {
                                instancePath: t + "/sourceDate",
                                schemaPath: "#/properties/sourceDate/anyOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                              };
                              (s === null ? (s = [b]) : s.push(b), r++);
                            }
                            var l = w === r;
                            if (((k = k || l), k))
                              ((r = c), s !== null && (c ? (s.length = c) : (s = null)));
                            else {
                              let b = {
                                instancePath: t + "/sourceDate",
                                schemaPath: "#/properties/sourceDate/anyOf",
                                keyword: "anyOf",
                                params: {},
                              };
                              return (s === null ? (s = [b]) : s.push(b), r++, (F.errors = s), !1);
                            }
                            var n = d === r;
                          } else var n = !0;
                          if (n) {
                            if (e.fetchedAt !== void 0) {
                              let u = r;
                              q(e.fetchedAt, {
                                instancePath: t + "/fetchedAt",
                                parentData: e,
                                parentDataProperty: "fetchedAt",
                                rootData: i,
                                dynamicAnchors: o,
                              }) ||
                                ((s = s === null ? q.errors : s.concat(q.errors)), (r = s.length));
                              var n = u === r;
                            } else var n = !0;
                            if (n)
                              if (e.reason !== void 0) {
                                let u = e.reason,
                                  d = r,
                                  c = r,
                                  k = !1,
                                  D = r;
                                if (!(
                                  u === "not_found" ||
                                  u === "unsupported_market" ||
                                  u === "currency_mismatch" ||
                                  u === "invalid_value" ||
                                  u === "unknown_time" ||
                                  u === "upstream_unavailable" ||
                                  u === "rate_limited" ||
                                  u === "budget_exhausted" ||
                                  u === "missing_leg" ||
                                  u === "mixed_dates"
                                )) {
                                  let b = {
                                    instancePath: t + "/reason",
                                    schemaPath: "#/properties/reason/anyOf/0/enum",
                                    keyword: "enum",
                                    params: { allowedValues: Ge.properties.reason.anyOf[0].enum },
                                  };
                                  (s === null ? (s = [b]) : s.push(b), r++);
                                }
                                var P = D === r;
                                k = k || P;
                                let w = r;
                                if (u !== null) {
                                  let b = {
                                    instancePath: t + "/reason",
                                    schemaPath: "#/properties/reason/anyOf/1/type",
                                    keyword: "type",
                                    params: { type: "null" },
                                  };
                                  (s === null ? (s = [b]) : s.push(b), r++);
                                }
                                var P = w === r;
                                if (((k = k || P), k))
                                  ((r = c), s !== null && (c ? (s.length = c) : (s = null)));
                                else {
                                  let b = {
                                    instancePath: t + "/reason",
                                    schemaPath: "#/properties/reason/anyOf",
                                    keyword: "anyOf",
                                    params: {},
                                  };
                                  return (
                                    s === null ? (s = [b]) : s.push(b),
                                    r++,
                                    (F.errors = s),
                                    !1
                                  );
                                }
                                var n = d === r;
                              } else var n = !0;
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
          (F.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((F.errors = s), r === 0);
  }
  F.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function J(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = J.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (
          (e.contractVersion === void 0 && (v = "contractVersion")) ||
          (e.profile === void 0 && (v = "profile")) ||
          (e.snapshotId === void 0 && (v = "snapshotId")) ||
          (e.fetchedAt === void 0 && (v = "fetchedAt")) ||
          (e.items === void 0 && (v = "items"))
        )
          return (
            (J.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(
              l === "contractVersion" ||
              l === "profile" ||
              l === "snapshotId" ||
              l === "fetchedAt" ||
              l === "items"
            )) {
              return (
                (J.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.contractVersion !== void 0) {
              let l = r;
              if (e.contractVersion !== "folioview.valuation.v1")
                return (
                  (J.errors = [
                    {
                      instancePath: t + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.valuation.v1" },
                    },
                  ]),
                  !1
                );
              var n = l === r;
            } else var n = !0;
            if (n) {
              if (e.profile !== void 0) {
                let l = r;
                if (e.profile !== "folioview.fx-batch.v1")
                  return (
                    (J.errors = [
                      {
                        instancePath: t + "/profile",
                        schemaPath: "#/properties/profile/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.fx-batch.v1" },
                      },
                    ]),
                    !1
                  );
                var n = l === r;
              } else var n = !0;
              if (n) {
                if (e.snapshotId !== void 0) {
                  let l = r;
                  re(e.snapshotId, {
                    instancePath: t + "/snapshotId",
                    parentData: e,
                    parentDataProperty: "snapshotId",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? re.errors : s.concat(re.errors)), (r = s.length));
                  var n = l === r;
                } else var n = !0;
                if (n) {
                  if (e.fetchedAt !== void 0) {
                    let l = r;
                    q(e.fetchedAt, {
                      instancePath: t + "/fetchedAt",
                      parentData: e,
                      parentDataProperty: "fetchedAt",
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? q.errors : s.concat(q.errors)), (r = s.length));
                    var n = l === r;
                  } else var n = !0;
                  if (n)
                    if (e.items !== void 0) {
                      let l = e.items,
                        P = r;
                      if (r === P)
                        if (Array.isArray(l)) {
                          if (l.length > 20)
                            return (
                              (J.errors = [
                                {
                                  instancePath: t + "/items",
                                  schemaPath: "#/properties/items/maxItems",
                                  keyword: "maxItems",
                                  params: { limit: 20 },
                                },
                              ]),
                              !1
                            );
                          if (l.length < 0)
                            return (
                              (J.errors = [
                                {
                                  instancePath: t + "/items",
                                  schemaPath: "#/properties/items/minItems",
                                  keyword: "minItems",
                                  params: { limit: 0 },
                                },
                              ]),
                              !1
                            );
                          {
                            var m = !0;
                            let y = l.length;
                            for (let u = 0; u < y; u++) {
                              let d = r;
                              F(l[u], {
                                instancePath: t + "/items/" + u,
                                parentData: l,
                                parentDataProperty: u,
                                rootData: i,
                                dynamicAnchors: o,
                              }) ||
                                ((s = s === null ? F.errors : s.concat(F.errors)), (r = s.length));
                              var m = d === r;
                              if (!m) break;
                            }
                          }
                        } else
                          return (
                            (J.errors = [
                              {
                                instancePath: t + "/items",
                                schemaPath: "#/properties/items/type",
                                keyword: "type",
                                params: { type: "array" },
                              },
                            ]),
                            !1
                          );
                      var n = P === r;
                    } else var n = !0;
                }
              }
            }
          }
        }
      } else
        return (
          (J.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((J.errors = s), r === 0);
  }
  J.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Ye(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Ye.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      J(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? J.errors : s.concat(J.errors)), (r = s.length)),
      (Ye.errors = s),
      r === 0
    );
  }
  Ye.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.UiPreferencesSnapshotV1 = Je;
  var hr = {
    type: "object",
    properties: {
      theme: { enum: ["system", "light", "dark"] },
      language: { enum: ["en", "zh"] },
      defaultChartRange: { enum: ["1d", "1w", "1m", "3m", "1y"] },
    },
    required: ["theme", "language", "defaultChartRange"],
    additionalProperties: !1,
  };
  function oe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = oe.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (
          (e.theme === void 0 && (m = "theme")) ||
          (e.language === void 0 && (m = "language")) ||
          (e.defaultChartRange === void 0 && (m = "defaultChartRange"))
        )
          return (
            (oe.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "theme" || f === "language" || f === "defaultChartRange")) {
              return (
                (oe.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.theme !== void 0) {
              let f = e.theme,
                l = r;
              if (!(f === "system" || f === "light" || f === "dark"))
                return (
                  (oe.errors = [
                    {
                      instancePath: t + "/theme",
                      schemaPath: "#/properties/theme/enum",
                      keyword: "enum",
                      params: { allowedValues: hr.properties.theme.enum },
                    },
                  ]),
                  !1
                );
              var n = l === r;
            } else var n = !0;
            if (n) {
              if (e.language !== void 0) {
                let f = e.language,
                  l = r;
                if (!(f === "en" || f === "zh"))
                  return (
                    (oe.errors = [
                      {
                        instancePath: t + "/language",
                        schemaPath: "#/properties/language/enum",
                        keyword: "enum",
                        params: { allowedValues: hr.properties.language.enum },
                      },
                    ]),
                    !1
                  );
                var n = l === r;
              } else var n = !0;
              if (n)
                if (e.defaultChartRange !== void 0) {
                  let f = e.defaultChartRange,
                    l = r;
                  if (!(f === "1d" || f === "1w" || f === "1m" || f === "3m" || f === "1y"))
                    return (
                      (oe.errors = [
                        {
                          instancePath: t + "/defaultChartRange",
                          schemaPath: "#/properties/defaultChartRange/enum",
                          keyword: "enum",
                          params: { allowedValues: hr.properties.defaultChartRange.enum },
                        },
                      ]),
                      !1
                    );
                  var n = l === r;
                } else var n = !0;
            }
          }
        }
      } else
        return (
          (oe.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((oe.errors = s), r === 0);
  }
  oe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function C(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = C.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      !(typeof e == "number" && !(e % 1) && !isNaN(e)))
    )
      return (
        (C.errors = [
          { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "integer" } },
        ]),
        !1
      );
    if (r === 0 && typeof e == "number") {
      if (e > 9007199254740991 || isNaN(e))
        return (
          (C.errors = [
            {
              instancePath: t,
              schemaPath: "#/maximum",
              keyword: "maximum",
              params: { comparison: "<=", limit: 9007199254740991 },
            },
          ]),
          !1
        );
      if (e < 0 || isNaN(e))
        return (
          (C.errors = [
            {
              instancePath: t,
              schemaPath: "#/minimum",
              keyword: "minimum",
              params: { comparison: ">=", limit: 0 },
            },
          ]),
          !1
        );
    }
    return ((C.errors = s), r === 0);
  }
  C.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function we(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = we.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (
          (e.preferences === void 0 && (v = "preferences")) ||
          (e.version === void 0 && (v = "version"))
        )
          return (
            (we.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(l === "preferences" || l === "version")) {
              return (
                (we.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.preferences !== void 0) {
              let l = e.preferences,
                P = r,
                g = r,
                y = !1,
                u = r;
              oe(l, {
                instancePath: t + "/preferences",
                parentData: e,
                parentDataProperty: "preferences",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? oe.errors : s.concat(oe.errors)), (r = s.length));
              var n = u === r;
              y = y || n;
              let d = r;
              if (l !== null) {
                let c = {
                  instancePath: t + "/preferences",
                  schemaPath: "#/properties/preferences/anyOf/1/type",
                  keyword: "type",
                  params: { type: "null" },
                };
                (s === null ? (s = [c]) : s.push(c), r++);
              }
              var n = d === r;
              if (((y = y || n), y)) ((r = g), s !== null && (g ? (s.length = g) : (s = null)));
              else {
                let c = {
                  instancePath: t + "/preferences",
                  schemaPath: "#/properties/preferences/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                return (s === null ? (s = [c]) : s.push(c), r++, (we.errors = s), !1);
              }
              var m = P === r;
            } else var m = !0;
            if (m)
              if (e.version !== void 0) {
                let l = r;
                C(e.version, {
                  instancePath: t + "/version",
                  parentData: e,
                  parentDataProperty: "version",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? C.errors : s.concat(C.errors)), (r = s.length));
                var m = l === r;
              } else var m = !0;
          }
        }
      } else
        return (
          (we.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((we.errors = s), r === 0);
  }
  we.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Je(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Je.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      we(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? we.errors : s.concat(we.errors)), (r = s.length)),
      (Je.errors = s),
      r === 0
    );
  }
  Je.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.CurrencyPreferencesSnapshot = Qe;
  function xe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = xe.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let n;
        if (e.defaultPortfolioCurrency === void 0 && (n = "defaultPortfolioCurrency"))
          return (
            (xe.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: n },
              },
            ]),
            !1
          );
        {
          let m = r;
          for (let v in e)
            if (v !== "defaultPortfolioCurrency") {
              return (
                (xe.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: v },
                  },
                ]),
                !1
              );
              break;
            }
          m === r &&
            e.defaultPortfolioCurrency !== void 0 &&
            ($(e.defaultPortfolioCurrency, {
              instancePath: t + "/defaultPortfolioCurrency",
              parentData: e,
              parentDataProperty: "defaultPortfolioCurrency",
              rootData: i,
              dynamicAnchors: o,
            }) ||
              ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length)));
        }
      } else
        return (
          (xe.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((xe.errors = s), r === 0);
  }
  xe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function le(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = le.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (
          (e.contractVersion === void 0 && (v = "contractVersion")) ||
          (e.profile === void 0 && (v = "profile")) ||
          (e.preferences === void 0 && (v = "preferences")) ||
          (e.version === void 0 && (v = "version")) ||
          (e.currencyGeneration === void 0 && (v = "currencyGeneration"))
        )
          return (
            (le.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(
              l === "contractVersion" ||
              l === "profile" ||
              l === "preferences" ||
              l === "version" ||
              l === "currencyGeneration"
            )) {
              return (
                (le.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.contractVersion !== void 0) {
              let l = r;
              if (e.contractVersion !== "folioview.valuation.v1")
                return (
                  (le.errors = [
                    {
                      instancePath: t + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.valuation.v1" },
                    },
                  ]),
                  !1
                );
              var n = l === r;
            } else var n = !0;
            if (n) {
              if (e.profile !== void 0) {
                let l = r;
                if (e.profile !== "folioview.currency-preferences.v2")
                  return (
                    (le.errors = [
                      {
                        instancePath: t + "/profile",
                        schemaPath: "#/properties/profile/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.currency-preferences.v2" },
                      },
                    ]),
                    !1
                  );
                var n = l === r;
              } else var n = !0;
              if (n) {
                if (e.preferences !== void 0) {
                  let l = e.preferences,
                    P = r,
                    g = r,
                    y = !1,
                    u = r;
                  xe(l, {
                    instancePath: t + "/preferences",
                    parentData: e,
                    parentDataProperty: "preferences",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? xe.errors : s.concat(xe.errors)), (r = s.length));
                  var m = u === r;
                  y = y || m;
                  let d = r;
                  if (l !== null) {
                    let k = {
                      instancePath: t + "/preferences",
                      schemaPath: "#/properties/preferences/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (s === null ? (s = [k]) : s.push(k), r++);
                  }
                  var m = d === r;
                  if (((y = y || m), y)) ((r = g), s !== null && (g ? (s.length = g) : (s = null)));
                  else {
                    let k = {
                      instancePath: t + "/preferences",
                      schemaPath: "#/properties/preferences/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (s === null ? (s = [k]) : s.push(k), r++, (le.errors = s), !1);
                  }
                  var n = P === r;
                } else var n = !0;
                if (n) {
                  if (e.version !== void 0) {
                    let l = r;
                    C(e.version, {
                      instancePath: t + "/version",
                      parentData: e,
                      parentDataProperty: "version",
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? C.errors : s.concat(C.errors)), (r = s.length));
                    var n = l === r;
                  } else var n = !0;
                  if (n)
                    if (e.currencyGeneration !== void 0) {
                      let l = r;
                      C(e.currencyGeneration, {
                        instancePath: t + "/currencyGeneration",
                        parentData: e,
                        parentDataProperty: "currencyGeneration",
                        rootData: i,
                        dynamicAnchors: o,
                      }) || ((s = s === null ? C.errors : s.concat(C.errors)), (r = s.length));
                      var n = l === r;
                    } else var n = !0;
                }
              }
            }
          }
        }
      } else
        return (
          (le.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((le.errors = s), r === 0);
  }
  le.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Qe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Qe.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      le(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? le.errors : s.concat(le.errors)), (r = s.length)),
      (Qe.errors = s),
      r === 0
    );
  }
  Qe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.CurrencyPreferencesUpdate = Xe;
  function Oe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Oe.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (
          (e.defaultPortfolioCurrency === void 0 && (m = "defaultPortfolioCurrency")) ||
          (e.expectedVersion === void 0 && (m = "expectedVersion"))
        )
          return (
            (Oe.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "defaultPortfolioCurrency" || f === "expectedVersion")) {
              return (
                (Oe.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.defaultPortfolioCurrency !== void 0) {
              let f = r;
              $(e.defaultPortfolioCurrency, {
                instancePath: t + "/defaultPortfolioCurrency",
                parentData: e,
                parentDataProperty: "defaultPortfolioCurrency",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n)
              if (e.expectedVersion !== void 0) {
                let f = r;
                C(e.expectedVersion, {
                  instancePath: t + "/expectedVersion",
                  parentData: e,
                  parentDataProperty: "expectedVersion",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? C.errors : s.concat(C.errors)), (r = s.length));
                var n = f === r;
              } else var n = !0;
          }
        }
      } else
        return (
          (Oe.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Oe.errors = s), r === 0);
  }
  Oe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Xe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Xe.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      Oe(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? Oe.errors : s.concat(Oe.errors)), (r = s.length)),
      (Xe.errors = s),
      r === 0
    );
  }
  Xe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.FxPreferences = er;
  function se(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = se.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (
          (e.currency === void 0 && (m = "currency")) ||
          (e.currencyGeneration === void 0 && (m = "currencyGeneration"))
        )
          return (
            (se.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "currency" || f === "currencyGeneration")) {
              return (
                (se.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.currency !== void 0) {
              let f = r;
              $(e.currency, {
                instancePath: t + "/currency",
                parentData: e,
                parentDataProperty: "currency",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? $.errors : s.concat($.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n)
              if (e.currencyGeneration !== void 0) {
                let f = e.currencyGeneration,
                  l = r;
                if (
                  (C(f, {
                    instancePath: t + "/currencyGeneration",
                    parentData: e,
                    parentDataProperty: "currencyGeneration",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? C.errors : s.concat(C.errors)), (r = s.length)),
                  r === l && typeof f == "number" && (f < 1 || isNaN(f)))
                )
                  return (
                    (se.errors = [
                      {
                        instancePath: t + "/currencyGeneration",
                        schemaPath: "#/properties/currencyGeneration/minimum",
                        keyword: "minimum",
                        params: { comparison: ">=", limit: 1 },
                      },
                    ]),
                    !1
                  );
                var n = l === r;
              } else var n = !0;
          }
        }
      } else
        return (
          (se.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((se.errors = s), r === 0);
  }
  se.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ee(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ee.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let f;
        if (
          (e.pairs === void 0 && (f = "pairs")) ||
          (e.suppressedDefault === void 0 && (f = "suppressedDefault"))
        )
          return (
            (ee.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: f },
              },
            ]),
            !1
          );
        {
          let l = r;
          for (let P in e)
            if (!(P === "pairs" || P === "suppressedDefault")) {
              return (
                (ee.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: P },
                  },
                ]),
                !1
              );
              break;
            }
          if (l === r) {
            if (e.pairs !== void 0) {
              let P = e.pairs,
                g = r;
              if (r === g)
                if (Array.isArray(P)) {
                  if (P.length > 12)
                    return (
                      (ee.errors = [
                        {
                          instancePath: t + "/pairs",
                          schemaPath: "#/properties/pairs/maxItems",
                          keyword: "maxItems",
                          params: { limit: 12 },
                        },
                      ]),
                      !1
                    );
                  if (P.length < 0)
                    return (
                      (ee.errors = [
                        {
                          instancePath: t + "/pairs",
                          schemaPath: "#/properties/pairs/minItems",
                          keyword: "minItems",
                          params: { limit: 0 },
                        },
                      ]),
                      !1
                    );
                  {
                    var n = !0;
                    let y = P.length;
                    for (let u = 0; u < y; u++) {
                      let d = r;
                      H(P[u], {
                        instancePath: t + "/pairs/" + u,
                        parentData: P,
                        parentDataProperty: u,
                        rootData: i,
                        dynamicAnchors: o,
                      }) || ((s = s === null ? H.errors : s.concat(H.errors)), (r = s.length));
                      var n = d === r;
                      if (!n) break;
                    }
                  }
                } else
                  return (
                    (ee.errors = [
                      {
                        instancePath: t + "/pairs",
                        schemaPath: "#/properties/pairs/type",
                        keyword: "type",
                        params: { type: "array" },
                      },
                    ]),
                    !1
                  );
              var m = g === r;
            } else var m = !0;
            if (m)
              if (e.suppressedDefault !== void 0) {
                let P = e.suppressedDefault,
                  g = r,
                  y = r,
                  u = !1,
                  d = r;
                se(P, {
                  instancePath: t + "/suppressedDefault",
                  parentData: e,
                  parentDataProperty: "suppressedDefault",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? se.errors : s.concat(se.errors)), (r = s.length));
                var v = d === r;
                u = u || v;
                let c = r;
                if (P !== null) {
                  let D = {
                    instancePath: t + "/suppressedDefault",
                    schemaPath: "#/properties/suppressedDefault/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (s === null ? (s = [D]) : s.push(D), r++);
                }
                var v = c === r;
                if (((u = u || v), u)) ((r = y), s !== null && (y ? (s.length = y) : (s = null)));
                else {
                  let D = {
                    instancePath: t + "/suppressedDefault",
                    schemaPath: "#/properties/suppressedDefault/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (s === null ? (s = [D]) : s.push(D), r++, (ee.errors = s), !1);
                }
                var m = g === r;
              } else var m = !0;
          }
        }
      } else
        return (
          (ee.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ee.errors = s), r === 0);
  }
  ee.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function er(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = er.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      ee(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? ee.errors : s.concat(ee.errors)), (r = s.length)),
      (er.errors = s),
      r === 0
    );
  }
  er.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.FxPreferencesSnapshot = rr;
  function U(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = U.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let f;
        if (
          (e.pairs === void 0 && (f = "pairs")) ||
          (e.suppressedDefault === void 0 && (f = "suppressedDefault"))
        )
          return (
            (U.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: f },
              },
            ]),
            !1
          );
        {
          let l = r;
          for (let P in e)
            if (!(P === "pairs" || P === "suppressedDefault")) {
              return (
                (U.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: P },
                  },
                ]),
                !1
              );
              break;
            }
          if (l === r) {
            if (e.pairs !== void 0) {
              let P = e.pairs,
                g = r;
              if (r === g)
                if (Array.isArray(P)) {
                  if (P.length > 12)
                    return (
                      (U.errors = [
                        {
                          instancePath: t + "/pairs",
                          schemaPath: "#/properties/pairs/maxItems",
                          keyword: "maxItems",
                          params: { limit: 12 },
                        },
                      ]),
                      !1
                    );
                  if (P.length < 0)
                    return (
                      (U.errors = [
                        {
                          instancePath: t + "/pairs",
                          schemaPath: "#/properties/pairs/minItems",
                          keyword: "minItems",
                          params: { limit: 0 },
                        },
                      ]),
                      !1
                    );
                  {
                    var n = !0;
                    let y = P.length;
                    for (let u = 0; u < y; u++) {
                      let d = r;
                      H(P[u], {
                        instancePath: t + "/pairs/" + u,
                        parentData: P,
                        parentDataProperty: u,
                        rootData: i,
                        dynamicAnchors: o,
                      }) || ((s = s === null ? H.errors : s.concat(H.errors)), (r = s.length));
                      var n = d === r;
                      if (!n) break;
                    }
                  }
                } else
                  return (
                    (U.errors = [
                      {
                        instancePath: t + "/pairs",
                        schemaPath: "#/properties/pairs/type",
                        keyword: "type",
                        params: { type: "array" },
                      },
                    ]),
                    !1
                  );
              var m = g === r;
            } else var m = !0;
            if (m)
              if (e.suppressedDefault !== void 0) {
                let P = e.suppressedDefault,
                  g = r,
                  y = r,
                  u = !1,
                  d = r;
                se(P, {
                  instancePath: t + "/suppressedDefault",
                  parentData: e,
                  parentDataProperty: "suppressedDefault",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? se.errors : s.concat(se.errors)), (r = s.length));
                var v = d === r;
                u = u || v;
                let c = r;
                if (P !== null) {
                  let D = {
                    instancePath: t + "/suppressedDefault",
                    schemaPath: "#/properties/suppressedDefault/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (s === null ? (s = [D]) : s.push(D), r++);
                }
                var v = c === r;
                if (((u = u || v), u)) ((r = y), s !== null && (y ? (s.length = y) : (s = null)));
                else {
                  let D = {
                    instancePath: t + "/suppressedDefault",
                    schemaPath: "#/properties/suppressedDefault/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (s === null ? (s = [D]) : s.push(D), r++, (U.errors = s), !1);
                }
                var m = g === r;
              } else var m = !0;
          }
        }
      } else
        return (
          (U.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((U.errors = s), r === 0);
  }
  U.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function fe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = fe.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (
          (e.contractVersion === void 0 && (v = "contractVersion")) ||
          (e.profile === void 0 && (v = "profile")) ||
          (e.preferences === void 0 && (v = "preferences")) ||
          (e.version === void 0 && (v = "version"))
        )
          return (
            (fe.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(
              l === "contractVersion" ||
              l === "profile" ||
              l === "preferences" ||
              l === "version"
            )) {
              return (
                (fe.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.contractVersion !== void 0) {
              let l = r;
              if (e.contractVersion !== "folioview.valuation.v1")
                return (
                  (fe.errors = [
                    {
                      instancePath: t + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.valuation.v1" },
                    },
                  ]),
                  !1
                );
              var n = l === r;
            } else var n = !0;
            if (n) {
              if (e.profile !== void 0) {
                let l = r;
                if (e.profile !== "folioview.fx-preferences.v1")
                  return (
                    (fe.errors = [
                      {
                        instancePath: t + "/profile",
                        schemaPath: "#/properties/profile/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.fx-preferences.v1" },
                      },
                    ]),
                    !1
                  );
                var n = l === r;
              } else var n = !0;
              if (n) {
                if (e.preferences !== void 0) {
                  let l = e.preferences,
                    P = r,
                    g = r,
                    y = !1,
                    u = r;
                  U(l, {
                    instancePath: t + "/preferences",
                    parentData: e,
                    parentDataProperty: "preferences",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? U.errors : s.concat(U.errors)), (r = s.length));
                  var m = u === r;
                  y = y || m;
                  let d = r;
                  if (l !== null) {
                    let k = {
                      instancePath: t + "/preferences",
                      schemaPath: "#/properties/preferences/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (s === null ? (s = [k]) : s.push(k), r++);
                  }
                  var m = d === r;
                  if (((y = y || m), y)) ((r = g), s !== null && (g ? (s.length = g) : (s = null)));
                  else {
                    let k = {
                      instancePath: t + "/preferences",
                      schemaPath: "#/properties/preferences/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (s === null ? (s = [k]) : s.push(k), r++, (fe.errors = s), !1);
                  }
                  var n = P === r;
                } else var n = !0;
                if (n)
                  if (e.version !== void 0) {
                    let l = r;
                    C(e.version, {
                      instancePath: t + "/version",
                      parentData: e,
                      parentDataProperty: "version",
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? C.errors : s.concat(C.errors)), (r = s.length));
                    var n = l === r;
                  } else var n = !0;
              }
            }
          }
        }
      } else
        return (
          (fe.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((fe.errors = s), r === 0);
  }
  fe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function rr(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = rr.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      fe(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? fe.errors : s.concat(fe.errors)), (r = s.length)),
      (rr.errors = s),
      r === 0
    );
  }
  rr.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  Q.FxPreferencesUpdate = sr;
  function Ce(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Ce.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (
          (e.preferences === void 0 && (m = "preferences")) ||
          (e.expectedVersion === void 0 && (m = "expectedVersion"))
        )
          return (
            (Ce.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "preferences" || f === "expectedVersion")) {
              return (
                (Ce.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.preferences !== void 0) {
              let f = r;
              U(e.preferences, {
                instancePath: t + "/preferences",
                parentData: e,
                parentDataProperty: "preferences",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? U.errors : s.concat(U.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n)
              if (e.expectedVersion !== void 0) {
                let f = r;
                C(e.expectedVersion, {
                  instancePath: t + "/expectedVersion",
                  parentData: e,
                  parentDataProperty: "expectedVersion",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? C.errors : s.concat(C.errors)), (r = s.length));
                var n = f === r;
              } else var n = !0;
          }
        }
      } else
        return (
          (Ce.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Ce.errors = s), r === 0);
  }
  Ce.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function sr(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = sr.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      Ce(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? Ce.errors : s.concat(Ce.errors)), (r = s.length)),
      (sr.errors = s),
      r === 0
    );
  }
  sr.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
});
var Tr = cr((Nr) => {
  "use strict";
  Nr.HoldingsFactsContent = nr;
  var Vr = {
      type: "object",
      properties: {
        state: { enum: ["ready", "empty"] },
        coverage: { $ref: "#/$defs/Coverage" },
        sourceAsOf: { anyOf: [{ $ref: "#/$defs/Timestamp" }, { type: "null" }] },
        fetchedAt: { $ref: "#/$defs/Timestamp" },
        freshness: { enum: ["fresh", "stale", "unknown"] },
        data: { $ref: "#/$defs/HoldingsFactsData" },
      },
      required: ["state", "coverage", "sourceAsOf", "fetchedAt", "freshness", "data"],
      additionalProperties: !1,
    },
    ps = {
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
    },
    O = mr().default;
  function R(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = R.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if ((e.state === void 0 && (v = "state")) || (e.issues === void 0 && (v = "issues")))
          return (
            (R.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(l === "state" || l === "issues")) {
              return (
                (R.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.state !== void 0) {
              let l = e.state,
                P = r;
              if (typeof l != "string")
                return (
                  (R.errors = [
                    {
                      instancePath: t + "/state",
                      schemaPath: "#/properties/state/type",
                      keyword: "type",
                      params: { type: "string" },
                    },
                  ]),
                  !1
                );
              if (!(l === "complete" || l === "partial" || l === "unknown"))
                return (
                  (R.errors = [
                    {
                      instancePath: t + "/state",
                      schemaPath: "#/properties/state/enum",
                      keyword: "enum",
                      params: { allowedValues: ps.properties.state.enum },
                    },
                  ]),
                  !1
                );
              var n = P === r;
            } else var n = !0;
            if (n)
              if (e.issues !== void 0) {
                let l = e.issues,
                  P = r;
                if (r === P)
                  if (Array.isArray(l)) {
                    if (l.length > 20)
                      return (
                        (R.errors = [
                          {
                            instancePath: t + "/issues",
                            schemaPath: "#/properties/issues/maxItems",
                            keyword: "maxItems",
                            params: { limit: 20 },
                          },
                        ]),
                        !1
                      );
                    if (l.length < 0)
                      return (
                        (R.errors = [
                          {
                            instancePath: t + "/issues",
                            schemaPath: "#/properties/issues/minItems",
                            keyword: "minItems",
                            params: { limit: 0 },
                          },
                        ]),
                        !1
                      );
                    {
                      var m = !0;
                      let y = l.length;
                      for (let u = 0; u < y; u++) {
                        let d = l[u],
                          c = r;
                        if (r === c)
                          if (typeof d == "string") {
                            if (O(d) > 80)
                              return (
                                (R.errors = [
                                  {
                                    instancePath: t + "/issues/" + u,
                                    schemaPath: "#/properties/issues/items/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 80 },
                                  },
                                ]),
                                !1
                              );
                            if (O(d) < 1)
                              return (
                                (R.errors = [
                                  {
                                    instancePath: t + "/issues/" + u,
                                    schemaPath: "#/properties/issues/items/minLength",
                                    keyword: "minLength",
                                    params: { limit: 1 },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (R.errors = [
                                {
                                  instancePath: t + "/issues/" + u,
                                  schemaPath: "#/properties/issues/items/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var m = c === r;
                        if (!m) break;
                      }
                      if (m) {
                        let u = l.length,
                          d;
                        if (u > 1) {
                          let c = {};
                          for (; u--;) {
                            let k = l[u];
                            if (typeof k == "string") {
                              if (typeof c[k] == "number") {
                                return (
                                  (d = c[k]),
                                  (R.errors = [
                                    {
                                      instancePath: t + "/issues",
                                      schemaPath: "#/properties/issues/uniqueItems",
                                      keyword: "uniqueItems",
                                      params: { i: u, j: d },
                                    },
                                  ]),
                                  !1
                                );
                                break;
                              }
                              c[k] = u;
                            }
                          }
                        }
                      }
                    }
                  } else
                    return (
                      (R.errors = [
                        {
                          instancePath: t + "/issues",
                          schemaPath: "#/properties/issues/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ]),
                      !1
                    );
                var n = P === r;
              } else var n = !0;
          }
        }
      } else
        return (
          (R.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((R.errors = s), r === 0);
  }
  R.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var us = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/,
    cs = new RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$", "u");
  function j(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = j.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      r === 0 && r === 0)
    )
      if (typeof e == "string") {
        if (O(e) > 32)
          return (
            (j.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 32 },
              },
            ]),
            !1
          );
        if (O(e) < 1)
          return (
            (j.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (cs.test(e)) {
          if (!us.test(e))
            return (
              (j.errors = [
                {
                  instancePath: t,
                  schemaPath: "#/format",
                  keyword: "format",
                  params: { format: "date-time" },
                },
              ]),
              !1
            );
        } else
          return (
            (j.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$" },
              },
            ]),
            !1
          );
      } else
        return (
          (j.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((j.errors = s), r === 0);
  }
  j.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var Er = {
      type: "object",
      properties: {
        kind: { const: "holdings" },
        profile: { const: "folioview.holdings-facts.v2" },
        snapshotId: { $ref: "#/$defs/Identifier" },
        editKind: { enum: ["import", "manual", "edit"] },
        reportDate: { anyOf: [{ $ref: "#/$defs/Date" }, { type: "null" }] },
        importSnapshot: { anyOf: [{ $ref: "#/$defs/SnapshotReference" }, { type: "null" }] },
        previousSnapshot: { anyOf: [{ $ref: "#/$defs/SnapshotReference" }, { type: "null" }] },
        accounts: { type: "array", items: { $ref: "#/$defs/Account" }, minItems: 0, maxItems: 20 },
        excludedAssets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              brokerAssetId: { type: "string", minLength: 1, maxLength: 180 },
              reason: { type: "string", minLength: 1, maxLength: 64 },
            },
            required: ["brokerAssetId", "reason"],
            additionalProperties: !1,
          },
          minItems: 0,
          maxItems: 1e3,
        },
      },
      required: [
        "kind",
        "profile",
        "snapshotId",
        "editKind",
        "reportDate",
        "importSnapshot",
        "previousSnapshot",
        "accounts",
        "excludedAssets",
      ],
      additionalProperties: !1,
    },
    Sr = Object.prototype.hasOwnProperty,
    ds = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "u");
  function E(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = E.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (O(e) > 128)
          return (
            (E.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 128 },
              },
            ]),
            !1
          );
        if (O(e) < 1)
          return (
            (E.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!ds.test(e))
          return (
            (E.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (E.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((E.errors = s), r === 0);
  }
  E.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var ms = /^\d{4}-\d{2}-\d{2}$/,
    ys = new RegExp("^\\d{4}-\\d{2}-\\d{2}$", "u");
  function X(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = X.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      r === 0 && r === 0)
    )
      if (typeof e == "string") {
        if (O(e) > 10)
          return (
            (X.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 10 },
              },
            ]),
            !1
          );
        if (O(e) < 1)
          return (
            (X.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (ys.test(e)) {
          if (!ms.test(e))
            return (
              (X.errors = [
                {
                  instancePath: t,
                  schemaPath: "#/format",
                  keyword: "format",
                  params: { format: "date" },
                },
              ]),
              !1
            );
        } else
          return (
            (X.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (X.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((X.errors = s), r === 0);
  }
  X.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function qe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = qe.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      !(typeof e == "number" && !(e % 1) && !isNaN(e)))
    )
      return (
        (qe.errors = [
          { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "integer" } },
        ]),
        !1
      );
    if (r === 0 && typeof e == "number") {
      if (e > 9007199254740991 || isNaN(e))
        return (
          (qe.errors = [
            {
              instancePath: t,
              schemaPath: "#/maximum",
              keyword: "maximum",
              params: { comparison: "<=", limit: 9007199254740991 },
            },
          ]),
          !1
        );
      if (e < 0 || isNaN(e))
        return (
          (qe.errors = [
            {
              instancePath: t,
              schemaPath: "#/minimum",
              keyword: "minimum",
              params: { comparison: ">=", limit: 0 },
            },
          ]),
          !1
        );
    }
    return ((qe.errors = s), r === 0);
  }
  qe.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function te(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = te.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if (
          (e.snapshotId === void 0 && (m = "snapshotId")) ||
          (e.sourceRevision === void 0 && (m = "sourceRevision"))
        )
          return (
            (te.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "snapshotId" || f === "sourceRevision")) {
              return (
                (te.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.snapshotId !== void 0) {
              let f = r;
              E(e.snapshotId, {
                instancePath: t + "/snapshotId",
                parentData: e,
                parentDataProperty: "snapshotId",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? E.errors : s.concat(E.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n)
              if (e.sourceRevision !== void 0) {
                let f = e.sourceRevision,
                  l = r;
                if (
                  (qe(f, {
                    instancePath: t + "/sourceRevision",
                    parentData: e,
                    parentDataProperty: "sourceRevision",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? qe.errors : s.concat(qe.errors)), (r = s.length)),
                  r === l && typeof f == "number" && (f < 1 || isNaN(f)))
                )
                  return (
                    (te.errors = [
                      {
                        instancePath: t + "/sourceRevision",
                        schemaPath: "#/properties/sourceRevision/minimum",
                        keyword: "minimum",
                        params: { comparison: ">=", limit: 1 },
                      },
                    ]),
                    !1
                  );
                var n = l === r;
              } else var n = !0;
          }
        }
      } else
        return (
          (te.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((te.errors = s), r === 0);
  }
  te.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var hs = {
      type: "object",
      properties: {
        currency: { $ref: "#/$defs/Currency" },
        cashBalance: { anyOf: [{ $ref: "#/$defs/SignedDecimal" }, { type: "null" }] },
        buyingPower: { const: null },
      },
      required: ["currency", "cashBalance", "buyingPower"],
      additionalProperties: !1,
    },
    vs = {
      enum: ["USD", "CAD", "CNY", "EUR", "GBP", "JPY", "HKD", "AUD", "CHF", "NZD", "SGD", "TWD"],
    };
  function z(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = z.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      e === "USD" ||
      e === "CAD" ||
      e === "CNY" ||
      e === "EUR" ||
      e === "GBP" ||
      e === "JPY" ||
      e === "HKD" ||
      e === "AUD" ||
      e === "CHF" ||
      e === "NZD" ||
      e === "SGD" ||
      e === "TWD"
        ? ((z.errors = s), r === 0)
        : ((z.errors = [
            {
              instancePath: t,
              schemaPath: "#/enum",
              keyword: "enum",
              params: { allowedValues: vs.enum },
            },
          ]),
          !1)
    );
  }
  z.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var Ps = new RegExp("^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$", "u");
  function ne(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ne.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (O(e) > 40)
          return (
            (ne.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 40 },
              },
            ]),
            !1
          );
        if (O(e) < 1)
          return (
            (ne.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!Ps.test(e))
          return (
            (ne.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$" },
              },
            ]),
            !1
          );
      } else
        return (
          (ne.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((ne.errors = s), r === 0);
  }
  ne.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function Pe(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Pe.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (
          (e.currency === void 0 && (v = "currency")) ||
          (e.cashBalance === void 0 && (v = "cashBalance")) ||
          (e.buyingPower === void 0 && (v = "buyingPower"))
        )
          return (
            (Pe.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(l === "currency" || l === "cashBalance" || l === "buyingPower")) {
              return (
                (Pe.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.currency !== void 0) {
              let l = r;
              z(e.currency, {
                instancePath: t + "/currency",
                parentData: e,
                parentDataProperty: "currency",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? z.errors : s.concat(z.errors)), (r = s.length));
              var n = l === r;
            } else var n = !0;
            if (n) {
              if (e.cashBalance !== void 0) {
                let l = e.cashBalance,
                  P = r,
                  g = r,
                  y = !1,
                  u = r;
                ne(l, {
                  instancePath: t + "/cashBalance",
                  parentData: e,
                  parentDataProperty: "cashBalance",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? ne.errors : s.concat(ne.errors)), (r = s.length));
                var m = u === r;
                y = y || m;
                let d = r;
                if (l !== null) {
                  let k = {
                    instancePath: t + "/cashBalance",
                    schemaPath: "#/properties/cashBalance/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (s === null ? (s = [k]) : s.push(k), r++);
                }
                var m = d === r;
                if (((y = y || m), y)) ((r = g), s !== null && (g ? (s.length = g) : (s = null)));
                else {
                  let k = {
                    instancePath: t + "/cashBalance",
                    schemaPath: "#/properties/cashBalance/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (s === null ? (s = [k]) : s.push(k), r++, (Pe.errors = s), !1);
                }
                var n = P === r;
              } else var n = !0;
              if (n)
                if (e.buyingPower !== void 0) {
                  let l = r;
                  if (e.buyingPower !== null)
                    return (
                      (Pe.errors = [
                        {
                          instancePath: t + "/buyingPower",
                          schemaPath: "#/properties/buyingPower/const",
                          keyword: "const",
                          params: { allowedValue: hs.properties.buyingPower.const },
                        },
                      ]),
                      !1
                    );
                  var n = l === r;
                } else var n = !0;
            }
          }
        }
      } else
        return (
          (Pe.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Pe.errors = s), r === 0);
  }
  Pe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Rr = {
      type: "object",
      properties: {
        assetId: { $ref: "#/$defs/Identifier" },
        brokerAssetId: {
          anyOf: [{ type: "string", minLength: 1, maxLength: 180 }, { type: "null" }],
        },
        instrument: { $ref: "#/$defs/FactInstrument" },
        name: { anyOf: [{ type: "string", minLength: 1, maxLength: 180 }, { type: "null" }] },
        assetType: { enum: ["stock", "etf", "unsupported"] },
        quantity: { $ref: "#/$defs/Quantity" },
        unitCost: { anyOf: [{ $ref: "#/$defs/Money" }, { type: "null" }] },
        bookCost: { anyOf: [{ $ref: "#/$defs/Money" }, { type: "null" }] },
        bookCostCad: { anyOf: [{ $ref: "#/$defs/Money" }, { type: "null" }] },
        provenance: {
          type: "object",
          properties: {
            instrument: { $ref: "#/$defs/Provenance" },
            quantity: { $ref: "#/$defs/Provenance" },
            unitCost: { $ref: "#/$defs/Provenance" },
            bookCost: { $ref: "#/$defs/Provenance" },
            bookCostCad: { $ref: "#/$defs/Provenance" },
          },
          required: ["instrument", "quantity", "unitCost", "bookCost", "bookCostCad"],
          additionalProperties: !1,
        },
        reportedValues: { anyOf: [{ $ref: "#/$defs/ReportedValues" }, { type: "null" }] },
      },
      required: [
        "assetId",
        "brokerAssetId",
        "instrument",
        "name",
        "assetType",
        "quantity",
        "unitCost",
        "bookCost",
        "bookCostCad",
        "provenance",
        "reportedValues",
      ],
      additionalProperties: !1,
    },
    gs = new RegExp("^[A-Z0-9][A-Z0-9.\\-^]{0,31}$", "u");
  function De(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = De.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (O(e) > 32)
          return (
            (De.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 32 },
              },
            ]),
            !1
          );
        if (O(e) < 1)
          return (
            (De.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!gs.test(e))
          return (
            (De.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Z0-9][A-Z0-9.\\-^]{0,31}$" },
              },
            ]),
            !1
          );
      } else
        return (
          (De.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((De.errors = s), r === 0);
  }
  De.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var ks = new RegExp("^(?:[A-Z0-9]{4}|UNKNOWN)$", "u");
  function be(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = be.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (O(e) > 7)
          return (
            (be.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 7 },
              },
            ]),
            !1
          );
        if (O(e) < 4)
          return (
            (be.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 4 },
              },
            ]),
            !1
          );
        if (!ks.test(e))
          return (
            (be.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^(?:[A-Z0-9]{4}|UNKNOWN)$" },
              },
            ]),
            !1
          );
      } else
        return (
          (be.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((be.errors = s), r === 0);
  }
  be.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function _e(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = _e.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (
          (e.symbol === void 0 && (v = "symbol")) ||
          (e.market === void 0 && (v = "market")) ||
          (e.currency === void 0 && (v = "currency"))
        )
          return (
            (_e.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(l === "symbol" || l === "market" || l === "currency")) {
              return (
                (_e.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.symbol !== void 0) {
              let l = e.symbol,
                P = r,
                g = r,
                y = !1,
                u = r;
              De(l, {
                instancePath: t + "/symbol",
                parentData: e,
                parentDataProperty: "symbol",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? De.errors : s.concat(De.errors)), (r = s.length));
              var n = u === r;
              y = y || n;
              let d = r;
              if (l !== null) {
                let c = {
                  instancePath: t + "/symbol",
                  schemaPath: "#/properties/symbol/anyOf/1/type",
                  keyword: "type",
                  params: { type: "null" },
                };
                (s === null ? (s = [c]) : s.push(c), r++);
              }
              var n = d === r;
              if (((y = y || n), y)) ((r = g), s !== null && (g ? (s.length = g) : (s = null)));
              else {
                let c = {
                  instancePath: t + "/symbol",
                  schemaPath: "#/properties/symbol/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                return (s === null ? (s = [c]) : s.push(c), r++, (_e.errors = s), !1);
              }
              var m = P === r;
            } else var m = !0;
            if (m) {
              if (e.market !== void 0) {
                let l = r;
                be(e.market, {
                  instancePath: t + "/market",
                  parentData: e,
                  parentDataProperty: "market",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? be.errors : s.concat(be.errors)), (r = s.length));
                var m = l === r;
              } else var m = !0;
              if (m)
                if (e.currency !== void 0) {
                  let l = r;
                  z(e.currency, {
                    instancePath: t + "/currency",
                    parentData: e,
                    parentDataProperty: "currency",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? z.errors : s.concat(z.errors)), (r = s.length));
                  var m = l === r;
                } else var m = !0;
            }
          }
        }
      } else
        return (
          (_e.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((_e.errors = s), r === 0);
  }
  _e.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var ws = new RegExp("^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$", "u");
  function Ie(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Ie.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (O(e) > 33)
          return (
            (Ie.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 33 },
              },
            ]),
            !1
          );
        if (O(e) < 1)
          return (
            (Ie.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!ws.test(e))
          return (
            (Ie.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$" },
              },
            ]),
            !1
          );
      } else
        return (
          (Ie.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((Ie.errors = s), r === 0);
  }
  Ie.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var Ds = new RegExp("^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$", "u");
  function Ae(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = Ae.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (typeof e == "string") {
        if (O(e) > 39)
          return (
            (Ae.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 39 },
              },
            ]),
            !1
          );
        if (O(e) < 1)
          return (
            (Ae.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!Ds.test(e))
          return (
            (Ae.errors = [
              {
                instancePath: t,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$" },
              },
            ]),
            !1
          );
      } else
        return (
          (Ae.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((Ae.errors = s), r === 0);
  }
  Ae.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function N(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = N.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if ((e.currency === void 0 && (m = "currency")) || (e.amount === void 0 && (m = "amount")))
          return (
            (N.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "currency" || f === "amount")) {
              return (
                (N.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.currency !== void 0) {
              let f = r;
              z(e.currency, {
                instancePath: t + "/currency",
                parentData: e,
                parentDataProperty: "currency",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? z.errors : s.concat(z.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n)
              if (e.amount !== void 0) {
                let f = r;
                Ae(e.amount, {
                  instancePath: t + "/amount",
                  parentData: e,
                  parentDataProperty: "amount",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? Ae.errors : s.concat(Ae.errors)), (r = s.length));
                var n = f === r;
              } else var n = !0;
          }
        }
      } else
        return (
          (N.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((N.errors = s), r === 0);
  }
  N.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var bs = {
    type: "object",
    properties: {
      origin: { enum: ["import", "manual", "derived", "legacy", "unknown"] },
      recordedAt: { anyOf: [{ $ref: "#/$defs/Timestamp" }, { type: "null" }] },
      sourceDate: { anyOf: [{ $ref: "#/$defs/Date" }, { type: "null" }] },
      lastEditedAt: { anyOf: [{ $ref: "#/$defs/Timestamp" }, { type: "null" }] },
    },
    required: ["origin", "recordedAt", "sourceDate", "lastEditedAt"],
    additionalProperties: !1,
  };
  function L(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = L.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let l;
        if (
          (e.origin === void 0 && (l = "origin")) ||
          (e.recordedAt === void 0 && (l = "recordedAt")) ||
          (e.sourceDate === void 0 && (l = "sourceDate")) ||
          (e.lastEditedAt === void 0 && (l = "lastEditedAt"))
        )
          return (
            (L.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: l },
              },
            ]),
            !1
          );
        {
          let P = r;
          for (let g in e)
            if (!(
              g === "origin" ||
              g === "recordedAt" ||
              g === "sourceDate" ||
              g === "lastEditedAt"
            )) {
              return (
                (L.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: g },
                  },
                ]),
                !1
              );
              break;
            }
          if (P === r) {
            if (e.origin !== void 0) {
              let g = e.origin,
                y = r;
              if (!(
                g === "import" ||
                g === "manual" ||
                g === "derived" ||
                g === "legacy" ||
                g === "unknown"
              ))
                return (
                  (L.errors = [
                    {
                      instancePath: t + "/origin",
                      schemaPath: "#/properties/origin/enum",
                      keyword: "enum",
                      params: { allowedValues: bs.properties.origin.enum },
                    },
                  ]),
                  !1
                );
              var n = y === r;
            } else var n = !0;
            if (n) {
              if (e.recordedAt !== void 0) {
                let g = e.recordedAt,
                  y = r,
                  u = r,
                  d = !1,
                  c = r;
                j(g, {
                  instancePath: t + "/recordedAt",
                  parentData: e,
                  parentDataProperty: "recordedAt",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? j.errors : s.concat(j.errors)), (r = s.length));
                var m = c === r;
                d = d || m;
                let k = r;
                if (g !== null) {
                  let w = {
                    instancePath: t + "/recordedAt",
                    schemaPath: "#/properties/recordedAt/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (s === null ? (s = [w]) : s.push(w), r++);
                }
                var m = k === r;
                if (((d = d || m), d)) ((r = u), s !== null && (u ? (s.length = u) : (s = null)));
                else {
                  let w = {
                    instancePath: t + "/recordedAt",
                    schemaPath: "#/properties/recordedAt/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (s === null ? (s = [w]) : s.push(w), r++, (L.errors = s), !1);
                }
                var n = y === r;
              } else var n = !0;
              if (n) {
                if (e.sourceDate !== void 0) {
                  let g = e.sourceDate,
                    y = r,
                    u = r,
                    d = !1,
                    c = r;
                  X(g, {
                    instancePath: t + "/sourceDate",
                    parentData: e,
                    parentDataProperty: "sourceDate",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? X.errors : s.concat(X.errors)), (r = s.length));
                  var v = c === r;
                  d = d || v;
                  let k = r;
                  if (g !== null) {
                    let w = {
                      instancePath: t + "/sourceDate",
                      schemaPath: "#/properties/sourceDate/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (s === null ? (s = [w]) : s.push(w), r++);
                  }
                  var v = k === r;
                  if (((d = d || v), d)) ((r = u), s !== null && (u ? (s.length = u) : (s = null)));
                  else {
                    let w = {
                      instancePath: t + "/sourceDate",
                      schemaPath: "#/properties/sourceDate/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (s === null ? (s = [w]) : s.push(w), r++, (L.errors = s), !1);
                  }
                  var n = y === r;
                } else var n = !0;
                if (n)
                  if (e.lastEditedAt !== void 0) {
                    let g = e.lastEditedAt,
                      y = r,
                      u = r,
                      d = !1,
                      c = r;
                    j(g, {
                      instancePath: t + "/lastEditedAt",
                      parentData: e,
                      parentDataProperty: "lastEditedAt",
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? j.errors : s.concat(j.errors)), (r = s.length));
                    var f = c === r;
                    d = d || f;
                    let k = r;
                    if (g !== null) {
                      let w = {
                        instancePath: t + "/lastEditedAt",
                        schemaPath: "#/properties/lastEditedAt/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (s === null ? (s = [w]) : s.push(w), r++);
                    }
                    var f = k === r;
                    if (((d = d || f), d))
                      ((r = u), s !== null && (u ? (s.length = u) : (s = null)));
                    else {
                      let w = {
                        instancePath: t + "/lastEditedAt",
                        schemaPath: "#/properties/lastEditedAt/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (s === null ? (s = [w]) : s.push(w), r++, (L.errors = s), !1);
                    }
                    var n = y === r;
                  } else var n = !0;
              }
            }
          }
        }
      } else
        return (
          (L.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((L.errors = s), r === 0);
  }
  L.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function de(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = de.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let m;
        if ((e.currency === void 0 && (m = "currency")) || (e.amount === void 0 && (m = "amount")))
          return (
            (de.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: m },
              },
            ]),
            !1
          );
        {
          let v = r;
          for (let f in e)
            if (!(f === "currency" || f === "amount")) {
              return (
                (de.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: f },
                  },
                ]),
                !1
              );
              break;
            }
          if (v === r) {
            if (e.currency !== void 0) {
              let f = r;
              z(e.currency, {
                instancePath: t + "/currency",
                parentData: e,
                parentDataProperty: "currency",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? z.errors : s.concat(z.errors)), (r = s.length));
              var n = f === r;
            } else var n = !0;
            if (n)
              if (e.amount !== void 0) {
                let f = r;
                ne(e.amount, {
                  instancePath: t + "/amount",
                  parentData: e,
                  parentDataProperty: "amount",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? ne.errors : s.concat(ne.errors)), (r = s.length));
                var n = f === r;
              } else var n = !0;
          }
        }
      } else
        return (
          (de.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((de.errors = s), r === 0);
  }
  de.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ue(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ue.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let l;
        if (
          (e.unitPrice === void 0 && (l = "unitPrice")) ||
          (e.marketValue === void 0 && (l = "marketValue")) ||
          (e.unrealizedReturn === void 0 && (l = "unrealizedReturn"))
        )
          return (
            (ue.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: l },
              },
            ]),
            !1
          );
        {
          let P = r;
          for (let g in e)
            if (!(g === "unitPrice" || g === "marketValue" || g === "unrealizedReturn")) {
              return (
                (ue.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: g },
                  },
                ]),
                !1
              );
              break;
            }
          if (P === r) {
            if (e.unitPrice !== void 0) {
              let g = e.unitPrice,
                y = r,
                u = r,
                d = !1,
                c = r;
              N(g, {
                instancePath: t + "/unitPrice",
                parentData: e,
                parentDataProperty: "unitPrice",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? N.errors : s.concat(N.errors)), (r = s.length));
              var n = c === r;
              d = d || n;
              let k = r;
              if (g !== null) {
                let D = {
                  instancePath: t + "/unitPrice",
                  schemaPath: "#/properties/unitPrice/anyOf/1/type",
                  keyword: "type",
                  params: { type: "null" },
                };
                (s === null ? (s = [D]) : s.push(D), r++);
              }
              var n = k === r;
              if (((d = d || n), d)) ((r = u), s !== null && (u ? (s.length = u) : (s = null)));
              else {
                let D = {
                  instancePath: t + "/unitPrice",
                  schemaPath: "#/properties/unitPrice/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                return (s === null ? (s = [D]) : s.push(D), r++, (ue.errors = s), !1);
              }
              var m = y === r;
            } else var m = !0;
            if (m) {
              if (e.marketValue !== void 0) {
                let g = e.marketValue,
                  y = r,
                  u = r,
                  d = !1,
                  c = r;
                de(g, {
                  instancePath: t + "/marketValue",
                  parentData: e,
                  parentDataProperty: "marketValue",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? de.errors : s.concat(de.errors)), (r = s.length));
                var v = c === r;
                d = d || v;
                let k = r;
                if (g !== null) {
                  let w = {
                    instancePath: t + "/marketValue",
                    schemaPath: "#/properties/marketValue/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (s === null ? (s = [w]) : s.push(w), r++);
                }
                var v = k === r;
                if (((d = d || v), d)) ((r = u), s !== null && (u ? (s.length = u) : (s = null)));
                else {
                  let w = {
                    instancePath: t + "/marketValue",
                    schemaPath: "#/properties/marketValue/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (s === null ? (s = [w]) : s.push(w), r++, (ue.errors = s), !1);
                }
                var m = y === r;
              } else var m = !0;
              if (m)
                if (e.unrealizedReturn !== void 0) {
                  let g = e.unrealizedReturn,
                    y = r,
                    u = r,
                    d = !1,
                    c = r;
                  de(g, {
                    instancePath: t + "/unrealizedReturn",
                    parentData: e,
                    parentDataProperty: "unrealizedReturn",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? de.errors : s.concat(de.errors)), (r = s.length));
                  var f = c === r;
                  d = d || f;
                  let k = r;
                  if (g !== null) {
                    let w = {
                      instancePath: t + "/unrealizedReturn",
                      schemaPath: "#/properties/unrealizedReturn/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (s === null ? (s = [w]) : s.push(w), r++);
                  }
                  var f = k === r;
                  if (((d = d || f), d)) ((r = u), s !== null && (u ? (s.length = u) : (s = null)));
                  else {
                    let w = {
                      instancePath: t + "/unrealizedReturn",
                      schemaPath: "#/properties/unrealizedReturn/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (s === null ? (s = [w]) : s.push(w), r++, (ue.errors = s), !1);
                  }
                  var m = y === r;
                } else var m = !0;
            }
          }
        }
      } else
        return (
          (ue.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ue.errors = s), r === 0);
  }
  ue.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function V(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = V.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let u;
        if (
          (e.assetId === void 0 && (u = "assetId")) ||
          (e.brokerAssetId === void 0 && (u = "brokerAssetId")) ||
          (e.instrument === void 0 && (u = "instrument")) ||
          (e.name === void 0 && (u = "name")) ||
          (e.assetType === void 0 && (u = "assetType")) ||
          (e.quantity === void 0 && (u = "quantity")) ||
          (e.unitCost === void 0 && (u = "unitCost")) ||
          (e.bookCost === void 0 && (u = "bookCost")) ||
          (e.bookCostCad === void 0 && (u = "bookCostCad")) ||
          (e.provenance === void 0 && (u = "provenance")) ||
          (e.reportedValues === void 0 && (u = "reportedValues"))
        )
          return (
            (V.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: u },
              },
            ]),
            !1
          );
        {
          let d = r;
          for (let c in e)
            if (!Sr.call(Rr.properties, c)) {
              return (
                (V.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (d === r) {
            if (e.assetId !== void 0) {
              let c = r;
              E(e.assetId, {
                instancePath: t + "/assetId",
                parentData: e,
                parentDataProperty: "assetId",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? E.errors : s.concat(E.errors)), (r = s.length));
              var n = c === r;
            } else var n = !0;
            if (n) {
              if (e.brokerAssetId !== void 0) {
                let c = e.brokerAssetId,
                  k = r,
                  D = r,
                  w = !1,
                  _ = r;
                if (r === _)
                  if (typeof c == "string") {
                    if (O(c) > 180) {
                      let I = {
                        instancePath: t + "/brokerAssetId",
                        schemaPath: "#/properties/brokerAssetId/anyOf/0/maxLength",
                        keyword: "maxLength",
                        params: { limit: 180 },
                      };
                      (s === null ? (s = [I]) : s.push(I), r++);
                    } else if (O(c) < 1) {
                      let I = {
                        instancePath: t + "/brokerAssetId",
                        schemaPath: "#/properties/brokerAssetId/anyOf/0/minLength",
                        keyword: "minLength",
                        params: { limit: 1 },
                      };
                      (s === null ? (s = [I]) : s.push(I), r++);
                    }
                  } else {
                    let I = {
                      instancePath: t + "/brokerAssetId",
                      schemaPath: "#/properties/brokerAssetId/anyOf/0/type",
                      keyword: "type",
                      params: { type: "string" },
                    };
                    (s === null ? (s = [I]) : s.push(I), r++);
                  }
                var m = _ === r;
                w = w || m;
                let b = r;
                if (c !== null) {
                  let I = {
                    instancePath: t + "/brokerAssetId",
                    schemaPath: "#/properties/brokerAssetId/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (s === null ? (s = [I]) : s.push(I), r++);
                }
                var m = b === r;
                if (((w = w || m), w)) ((r = D), s !== null && (D ? (s.length = D) : (s = null)));
                else {
                  let I = {
                    instancePath: t + "/brokerAssetId",
                    schemaPath: "#/properties/brokerAssetId/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (s === null ? (s = [I]) : s.push(I), r++, (V.errors = s), !1);
                }
                var n = k === r;
              } else var n = !0;
              if (n) {
                if (e.instrument !== void 0) {
                  let c = r;
                  _e(e.instrument, {
                    instancePath: t + "/instrument",
                    parentData: e,
                    parentDataProperty: "instrument",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? _e.errors : s.concat(_e.errors)), (r = s.length));
                  var n = c === r;
                } else var n = !0;
                if (n) {
                  if (e.name !== void 0) {
                    let c = e.name,
                      k = r,
                      D = r,
                      w = !1,
                      _ = r;
                    if (r === _)
                      if (typeof c == "string") {
                        if (O(c) > 180) {
                          let I = {
                            instancePath: t + "/name",
                            schemaPath: "#/properties/name/anyOf/0/maxLength",
                            keyword: "maxLength",
                            params: { limit: 180 },
                          };
                          (s === null ? (s = [I]) : s.push(I), r++);
                        } else if (O(c) < 1) {
                          let I = {
                            instancePath: t + "/name",
                            schemaPath: "#/properties/name/anyOf/0/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          };
                          (s === null ? (s = [I]) : s.push(I), r++);
                        }
                      } else {
                        let I = {
                          instancePath: t + "/name",
                          schemaPath: "#/properties/name/anyOf/0/type",
                          keyword: "type",
                          params: { type: "string" },
                        };
                        (s === null ? (s = [I]) : s.push(I), r++);
                      }
                    var v = _ === r;
                    w = w || v;
                    let b = r;
                    if (c !== null) {
                      let I = {
                        instancePath: t + "/name",
                        schemaPath: "#/properties/name/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (s === null ? (s = [I]) : s.push(I), r++);
                    }
                    var v = b === r;
                    if (((w = w || v), w))
                      ((r = D), s !== null && (D ? (s.length = D) : (s = null)));
                    else {
                      let I = {
                        instancePath: t + "/name",
                        schemaPath: "#/properties/name/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (s === null ? (s = [I]) : s.push(I), r++, (V.errors = s), !1);
                    }
                    var n = k === r;
                  } else var n = !0;
                  if (n) {
                    if (e.assetType !== void 0) {
                      let c = e.assetType,
                        k = r;
                      if (!(c === "stock" || c === "etf" || c === "unsupported"))
                        return (
                          (V.errors = [
                            {
                              instancePath: t + "/assetType",
                              schemaPath: "#/properties/assetType/enum",
                              keyword: "enum",
                              params: { allowedValues: Rr.properties.assetType.enum },
                            },
                          ]),
                          !1
                        );
                      var n = k === r;
                    } else var n = !0;
                    if (n) {
                      if (e.quantity !== void 0) {
                        let c = r;
                        Ie(e.quantity, {
                          instancePath: t + "/quantity",
                          parentData: e,
                          parentDataProperty: "quantity",
                          rootData: i,
                          dynamicAnchors: o,
                        }) || ((s = s === null ? Ie.errors : s.concat(Ie.errors)), (r = s.length));
                        var n = c === r;
                      } else var n = !0;
                      if (n) {
                        if (e.unitCost !== void 0) {
                          let c = e.unitCost,
                            k = r,
                            D = r,
                            w = !1,
                            _ = r;
                          N(c, {
                            instancePath: t + "/unitCost",
                            parentData: e,
                            parentDataProperty: "unitCost",
                            rootData: i,
                            dynamicAnchors: o,
                          }) || ((s = s === null ? N.errors : s.concat(N.errors)), (r = s.length));
                          var f = _ === r;
                          w = w || f;
                          let b = r;
                          if (c !== null) {
                            let I = {
                              instancePath: t + "/unitCost",
                              schemaPath: "#/properties/unitCost/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            (s === null ? (s = [I]) : s.push(I), r++);
                          }
                          var f = b === r;
                          if (((w = w || f), w))
                            ((r = D), s !== null && (D ? (s.length = D) : (s = null)));
                          else {
                            let I = {
                              instancePath: t + "/unitCost",
                              schemaPath: "#/properties/unitCost/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            return (s === null ? (s = [I]) : s.push(I), r++, (V.errors = s), !1);
                          }
                          var n = k === r;
                        } else var n = !0;
                        if (n) {
                          if (e.bookCost !== void 0) {
                            let c = e.bookCost,
                              k = r,
                              D = r,
                              w = !1,
                              _ = r;
                            N(c, {
                              instancePath: t + "/bookCost",
                              parentData: e,
                              parentDataProperty: "bookCost",
                              rootData: i,
                              dynamicAnchors: o,
                            }) ||
                              ((s = s === null ? N.errors : s.concat(N.errors)), (r = s.length));
                            var l = _ === r;
                            w = w || l;
                            let b = r;
                            if (c !== null) {
                              let I = {
                                instancePath: t + "/bookCost",
                                schemaPath: "#/properties/bookCost/anyOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                              };
                              (s === null ? (s = [I]) : s.push(I), r++);
                            }
                            var l = b === r;
                            if (((w = w || l), w))
                              ((r = D), s !== null && (D ? (s.length = D) : (s = null)));
                            else {
                              let I = {
                                instancePath: t + "/bookCost",
                                schemaPath: "#/properties/bookCost/anyOf",
                                keyword: "anyOf",
                                params: {},
                              };
                              return (s === null ? (s = [I]) : s.push(I), r++, (V.errors = s), !1);
                            }
                            var n = k === r;
                          } else var n = !0;
                          if (n) {
                            if (e.bookCostCad !== void 0) {
                              let c = e.bookCostCad,
                                k = r,
                                D = r,
                                w = !1,
                                _ = r;
                              N(c, {
                                instancePath: t + "/bookCostCad",
                                parentData: e,
                                parentDataProperty: "bookCostCad",
                                rootData: i,
                                dynamicAnchors: o,
                              }) ||
                                ((s = s === null ? N.errors : s.concat(N.errors)), (r = s.length));
                              var P = _ === r;
                              w = w || P;
                              let b = r;
                              if (c !== null) {
                                let I = {
                                  instancePath: t + "/bookCostCad",
                                  schemaPath: "#/properties/bookCostCad/anyOf/1/type",
                                  keyword: "type",
                                  params: { type: "null" },
                                };
                                (s === null ? (s = [I]) : s.push(I), r++);
                              }
                              var P = b === r;
                              if (((w = w || P), w))
                                ((r = D), s !== null && (D ? (s.length = D) : (s = null)));
                              else {
                                let I = {
                                  instancePath: t + "/bookCostCad",
                                  schemaPath: "#/properties/bookCostCad/anyOf",
                                  keyword: "anyOf",
                                  params: {},
                                };
                                return (
                                  s === null ? (s = [I]) : s.push(I),
                                  r++,
                                  (V.errors = s),
                                  !1
                                );
                              }
                              var n = k === r;
                            } else var n = !0;
                            if (n) {
                              if (e.provenance !== void 0) {
                                let c = e.provenance,
                                  k = r;
                                if (r === k)
                                  if (c && typeof c == "object" && !Array.isArray(c)) {
                                    let w;
                                    if (
                                      (c.instrument === void 0 && (w = "instrument")) ||
                                      (c.quantity === void 0 && (w = "quantity")) ||
                                      (c.unitCost === void 0 && (w = "unitCost")) ||
                                      (c.bookCost === void 0 && (w = "bookCost")) ||
                                      (c.bookCostCad === void 0 && (w = "bookCostCad"))
                                    )
                                      return (
                                        (V.errors = [
                                          {
                                            instancePath: t + "/provenance",
                                            schemaPath: "#/properties/provenance/required",
                                            keyword: "required",
                                            params: { missingProperty: w },
                                          },
                                        ]),
                                        !1
                                      );
                                    {
                                      let _ = r;
                                      for (let b in c)
                                        if (!(
                                          b === "instrument" ||
                                          b === "quantity" ||
                                          b === "unitCost" ||
                                          b === "bookCost" ||
                                          b === "bookCostCad"
                                        )) {
                                          return (
                                            (V.errors = [
                                              {
                                                instancePath: t + "/provenance",
                                                schemaPath:
                                                  "#/properties/provenance/additionalProperties",
                                                keyword: "additionalProperties",
                                                params: { additionalProperty: b },
                                              },
                                            ]),
                                            !1
                                          );
                                          break;
                                        }
                                      if (_ === r) {
                                        if (c.instrument !== void 0) {
                                          let b = r;
                                          L(c.instrument, {
                                            instancePath: t + "/provenance/instrument",
                                            parentData: c,
                                            parentDataProperty: "instrument",
                                            rootData: i,
                                            dynamicAnchors: o,
                                          }) ||
                                            ((s = s === null ? L.errors : s.concat(L.errors)),
                                            (r = s.length));
                                          var g = b === r;
                                        } else var g = !0;
                                        if (g) {
                                          if (c.quantity !== void 0) {
                                            let b = r;
                                            L(c.quantity, {
                                              instancePath: t + "/provenance/quantity",
                                              parentData: c,
                                              parentDataProperty: "quantity",
                                              rootData: i,
                                              dynamicAnchors: o,
                                            }) ||
                                              ((s = s === null ? L.errors : s.concat(L.errors)),
                                              (r = s.length));
                                            var g = b === r;
                                          } else var g = !0;
                                          if (g) {
                                            if (c.unitCost !== void 0) {
                                              let b = r;
                                              L(c.unitCost, {
                                                instancePath: t + "/provenance/unitCost",
                                                parentData: c,
                                                parentDataProperty: "unitCost",
                                                rootData: i,
                                                dynamicAnchors: o,
                                              }) ||
                                                ((s = s === null ? L.errors : s.concat(L.errors)),
                                                (r = s.length));
                                              var g = b === r;
                                            } else var g = !0;
                                            if (g) {
                                              if (c.bookCost !== void 0) {
                                                let b = r;
                                                L(c.bookCost, {
                                                  instancePath: t + "/provenance/bookCost",
                                                  parentData: c,
                                                  parentDataProperty: "bookCost",
                                                  rootData: i,
                                                  dynamicAnchors: o,
                                                }) ||
                                                  ((s = s === null ? L.errors : s.concat(L.errors)),
                                                  (r = s.length));
                                                var g = b === r;
                                              } else var g = !0;
                                              if (g)
                                                if (c.bookCostCad !== void 0) {
                                                  let b = r;
                                                  L(c.bookCostCad, {
                                                    instancePath: t + "/provenance/bookCostCad",
                                                    parentData: c,
                                                    parentDataProperty: "bookCostCad",
                                                    rootData: i,
                                                    dynamicAnchors: o,
                                                  }) ||
                                                    ((s =
                                                      s === null ? L.errors : s.concat(L.errors)),
                                                    (r = s.length));
                                                  var g = b === r;
                                                } else var g = !0;
                                            }
                                          }
                                        }
                                      }
                                    }
                                  } else
                                    return (
                                      (V.errors = [
                                        {
                                          instancePath: t + "/provenance",
                                          schemaPath: "#/properties/provenance/type",
                                          keyword: "type",
                                          params: { type: "object" },
                                        },
                                      ]),
                                      !1
                                    );
                                var n = k === r;
                              } else var n = !0;
                              if (n)
                                if (e.reportedValues !== void 0) {
                                  let c = e.reportedValues,
                                    k = r,
                                    D = r,
                                    w = !1,
                                    _ = r;
                                  ue(c, {
                                    instancePath: t + "/reportedValues",
                                    parentData: e,
                                    parentDataProperty: "reportedValues",
                                    rootData: i,
                                    dynamicAnchors: o,
                                  }) ||
                                    ((s = s === null ? ue.errors : s.concat(ue.errors)),
                                    (r = s.length));
                                  var y = _ === r;
                                  w = w || y;
                                  let b = r;
                                  if (c !== null) {
                                    let I = {
                                      instancePath: t + "/reportedValues",
                                      schemaPath: "#/properties/reportedValues/anyOf/1/type",
                                      keyword: "type",
                                      params: { type: "null" },
                                    };
                                    (s === null ? (s = [I]) : s.push(I), r++);
                                  }
                                  var y = b === r;
                                  if (((w = w || y), w))
                                    ((r = D), s !== null && (D ? (s.length = D) : (s = null)));
                                  else {
                                    let I = {
                                      instancePath: t + "/reportedValues",
                                      schemaPath: "#/properties/reportedValues/anyOf",
                                      keyword: "anyOf",
                                      params: {},
                                    };
                                    return (
                                      s === null ? (s = [I]) : s.push(I),
                                      r++,
                                      (V.errors = s),
                                      !1
                                    );
                                  }
                                  var n = k === r;
                                } else var n = !0;
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
          (V.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((V.errors = s), r === 0);
  }
  V.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function S(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = S.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let f;
        if (
          (e.accountId === void 0 && (f = "accountId")) ||
          (e.displayName === void 0 && (f = "displayName")) ||
          (e.balances === void 0 && (f = "balances")) ||
          (e.positions === void 0 && (f = "positions"))
        )
          return (
            (S.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: f },
              },
            ]),
            !1
          );
        {
          let l = r;
          for (let P in e)
            if (!(
              P === "accountId" ||
              P === "displayName" ||
              P === "balances" ||
              P === "positions"
            )) {
              return (
                (S.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: P },
                  },
                ]),
                !1
              );
              break;
            }
          if (l === r) {
            if (e.accountId !== void 0) {
              let P = r;
              E(e.accountId, {
                instancePath: t + "/accountId",
                parentData: e,
                parentDataProperty: "accountId",
                rootData: i,
                dynamicAnchors: o,
              }) || ((s = s === null ? E.errors : s.concat(E.errors)), (r = s.length));
              var n = P === r;
            } else var n = !0;
            if (n) {
              if (e.displayName !== void 0) {
                let P = e.displayName,
                  g = r;
                if (r === g)
                  if (typeof P == "string") {
                    if (O(P) > 180)
                      return (
                        (S.errors = [
                          {
                            instancePath: t + "/displayName",
                            schemaPath: "#/properties/displayName/maxLength",
                            keyword: "maxLength",
                            params: { limit: 180 },
                          },
                        ]),
                        !1
                      );
                    if (O(P) < 1)
                      return (
                        (S.errors = [
                          {
                            instancePath: t + "/displayName",
                            schemaPath: "#/properties/displayName/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (S.errors = [
                        {
                          instancePath: t + "/displayName",
                          schemaPath: "#/properties/displayName/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var n = g === r;
              } else var n = !0;
              if (n) {
                if (e.balances !== void 0) {
                  let P = e.balances,
                    g = r;
                  if (r === g)
                    if (Array.isArray(P)) {
                      if (P.length > 12)
                        return (
                          (S.errors = [
                            {
                              instancePath: t + "/balances",
                              schemaPath: "#/properties/balances/maxItems",
                              keyword: "maxItems",
                              params: { limit: 12 },
                            },
                          ]),
                          !1
                        );
                      if (P.length < 0)
                        return (
                          (S.errors = [
                            {
                              instancePath: t + "/balances",
                              schemaPath: "#/properties/balances/minItems",
                              keyword: "minItems",
                              params: { limit: 0 },
                            },
                          ]),
                          !1
                        );
                      {
                        var m = !0;
                        let u = P.length;
                        for (let d = 0; d < u; d++) {
                          let c = r;
                          Pe(P[d], {
                            instancePath: t + "/balances/" + d,
                            parentData: P,
                            parentDataProperty: d,
                            rootData: i,
                            dynamicAnchors: o,
                          }) ||
                            ((s = s === null ? Pe.errors : s.concat(Pe.errors)), (r = s.length));
                          var m = c === r;
                          if (!m) break;
                        }
                      }
                    } else
                      return (
                        (S.errors = [
                          {
                            instancePath: t + "/balances",
                            schemaPath: "#/properties/balances/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ]),
                        !1
                      );
                  var n = g === r;
                } else var n = !0;
                if (n)
                  if (e.positions !== void 0) {
                    let P = e.positions,
                      g = r;
                    if (r === g)
                      if (Array.isArray(P)) {
                        if (P.length > 1e3)
                          return (
                            (S.errors = [
                              {
                                instancePath: t + "/positions",
                                schemaPath: "#/properties/positions/maxItems",
                                keyword: "maxItems",
                                params: { limit: 1e3 },
                              },
                            ]),
                            !1
                          );
                        if (P.length < 0)
                          return (
                            (S.errors = [
                              {
                                instancePath: t + "/positions",
                                schemaPath: "#/properties/positions/minItems",
                                keyword: "minItems",
                                params: { limit: 0 },
                              },
                            ]),
                            !1
                          );
                        {
                          var v = !0;
                          let u = P.length;
                          for (let d = 0; d < u; d++) {
                            let c = r;
                            V(P[d], {
                              instancePath: t + "/positions/" + d,
                              parentData: P,
                              parentDataProperty: d,
                              rootData: i,
                              dynamicAnchors: o,
                            }) ||
                              ((s = s === null ? V.errors : s.concat(V.errors)), (r = s.length));
                            var v = c === r;
                            if (!v) break;
                          }
                        }
                      } else
                        return (
                          (S.errors = [
                            {
                              instancePath: t + "/positions",
                              schemaPath: "#/properties/positions/type",
                              keyword: "type",
                              params: { type: "array" },
                            },
                          ]),
                          !1
                        );
                    var n = g === r;
                  } else var n = !0;
              }
            }
          }
        }
      } else
        return (
          (S.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((S.errors = s), r === 0);
  }
  S.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function x(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = x.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let y;
        if (
          (e.kind === void 0 && (y = "kind")) ||
          (e.profile === void 0 && (y = "profile")) ||
          (e.snapshotId === void 0 && (y = "snapshotId")) ||
          (e.editKind === void 0 && (y = "editKind")) ||
          (e.reportDate === void 0 && (y = "reportDate")) ||
          (e.importSnapshot === void 0 && (y = "importSnapshot")) ||
          (e.previousSnapshot === void 0 && (y = "previousSnapshot")) ||
          (e.accounts === void 0 && (y = "accounts")) ||
          (e.excludedAssets === void 0 && (y = "excludedAssets"))
        )
          return (
            (x.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: y },
              },
            ]),
            !1
          );
        {
          let u = r;
          for (let d in e)
            if (!Sr.call(Er.properties, d)) {
              return (
                (x.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: d },
                  },
                ]),
                !1
              );
              break;
            }
          if (u === r) {
            if (e.kind !== void 0) {
              let d = r;
              if (e.kind !== "holdings")
                return (
                  (x.errors = [
                    {
                      instancePath: t + "/kind",
                      schemaPath: "#/properties/kind/const",
                      keyword: "const",
                      params: { allowedValue: "holdings" },
                    },
                  ]),
                  !1
                );
              var n = d === r;
            } else var n = !0;
            if (n) {
              if (e.profile !== void 0) {
                let d = r;
                if (e.profile !== "folioview.holdings-facts.v2")
                  return (
                    (x.errors = [
                      {
                        instancePath: t + "/profile",
                        schemaPath: "#/properties/profile/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.holdings-facts.v2" },
                      },
                    ]),
                    !1
                  );
                var n = d === r;
              } else var n = !0;
              if (n) {
                if (e.snapshotId !== void 0) {
                  let d = r;
                  E(e.snapshotId, {
                    instancePath: t + "/snapshotId",
                    parentData: e,
                    parentDataProperty: "snapshotId",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? E.errors : s.concat(E.errors)), (r = s.length));
                  var n = d === r;
                } else var n = !0;
                if (n) {
                  if (e.editKind !== void 0) {
                    let d = e.editKind,
                      c = r;
                    if (!(d === "import" || d === "manual" || d === "edit"))
                      return (
                        (x.errors = [
                          {
                            instancePath: t + "/editKind",
                            schemaPath: "#/properties/editKind/enum",
                            keyword: "enum",
                            params: { allowedValues: Er.properties.editKind.enum },
                          },
                        ]),
                        !1
                      );
                    var n = c === r;
                  } else var n = !0;
                  if (n) {
                    if (e.reportDate !== void 0) {
                      let d = e.reportDate,
                        c = r,
                        k = r,
                        D = !1,
                        w = r;
                      X(d, {
                        instancePath: t + "/reportDate",
                        parentData: e,
                        parentDataProperty: "reportDate",
                        rootData: i,
                        dynamicAnchors: o,
                      }) || ((s = s === null ? X.errors : s.concat(X.errors)), (r = s.length));
                      var m = w === r;
                      D = D || m;
                      let _ = r;
                      if (d !== null) {
                        let T = {
                          instancePath: t + "/reportDate",
                          schemaPath: "#/properties/reportDate/anyOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                        };
                        (s === null ? (s = [T]) : s.push(T), r++);
                      }
                      var m = _ === r;
                      if (((D = D || m), D))
                        ((r = k), s !== null && (k ? (s.length = k) : (s = null)));
                      else {
                        let T = {
                          instancePath: t + "/reportDate",
                          schemaPath: "#/properties/reportDate/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        return (s === null ? (s = [T]) : s.push(T), r++, (x.errors = s), !1);
                      }
                      var n = c === r;
                    } else var n = !0;
                    if (n) {
                      if (e.importSnapshot !== void 0) {
                        let d = e.importSnapshot,
                          c = r,
                          k = r,
                          D = !1,
                          w = r;
                        te(d, {
                          instancePath: t + "/importSnapshot",
                          parentData: e,
                          parentDataProperty: "importSnapshot",
                          rootData: i,
                          dynamicAnchors: o,
                        }) || ((s = s === null ? te.errors : s.concat(te.errors)), (r = s.length));
                        var v = w === r;
                        D = D || v;
                        let _ = r;
                        if (d !== null) {
                          let T = {
                            instancePath: t + "/importSnapshot",
                            schemaPath: "#/properties/importSnapshot/anyOf/1/type",
                            keyword: "type",
                            params: { type: "null" },
                          };
                          (s === null ? (s = [T]) : s.push(T), r++);
                        }
                        var v = _ === r;
                        if (((D = D || v), D))
                          ((r = k), s !== null && (k ? (s.length = k) : (s = null)));
                        else {
                          let T = {
                            instancePath: t + "/importSnapshot",
                            schemaPath: "#/properties/importSnapshot/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          return (s === null ? (s = [T]) : s.push(T), r++, (x.errors = s), !1);
                        }
                        var n = c === r;
                      } else var n = !0;
                      if (n) {
                        if (e.previousSnapshot !== void 0) {
                          let d = e.previousSnapshot,
                            c = r,
                            k = r,
                            D = !1,
                            w = r;
                          te(d, {
                            instancePath: t + "/previousSnapshot",
                            parentData: e,
                            parentDataProperty: "previousSnapshot",
                            rootData: i,
                            dynamicAnchors: o,
                          }) ||
                            ((s = s === null ? te.errors : s.concat(te.errors)), (r = s.length));
                          var f = w === r;
                          D = D || f;
                          let _ = r;
                          if (d !== null) {
                            let T = {
                              instancePath: t + "/previousSnapshot",
                              schemaPath: "#/properties/previousSnapshot/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            (s === null ? (s = [T]) : s.push(T), r++);
                          }
                          var f = _ === r;
                          if (((D = D || f), D))
                            ((r = k), s !== null && (k ? (s.length = k) : (s = null)));
                          else {
                            let T = {
                              instancePath: t + "/previousSnapshot",
                              schemaPath: "#/properties/previousSnapshot/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            return (s === null ? (s = [T]) : s.push(T), r++, (x.errors = s), !1);
                          }
                          var n = c === r;
                        } else var n = !0;
                        if (n) {
                          if (e.accounts !== void 0) {
                            let d = e.accounts,
                              c = r;
                            if (r === c)
                              if (Array.isArray(d)) {
                                if (d.length > 20)
                                  return (
                                    (x.errors = [
                                      {
                                        instancePath: t + "/accounts",
                                        schemaPath: "#/properties/accounts/maxItems",
                                        keyword: "maxItems",
                                        params: { limit: 20 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (d.length < 0)
                                  return (
                                    (x.errors = [
                                      {
                                        instancePath: t + "/accounts",
                                        schemaPath: "#/properties/accounts/minItems",
                                        keyword: "minItems",
                                        params: { limit: 0 },
                                      },
                                    ]),
                                    !1
                                  );
                                {
                                  var l = !0;
                                  let D = d.length;
                                  for (let w = 0; w < D; w++) {
                                    let _ = r;
                                    S(d[w], {
                                      instancePath: t + "/accounts/" + w,
                                      parentData: d,
                                      parentDataProperty: w,
                                      rootData: i,
                                      dynamicAnchors: o,
                                    }) ||
                                      ((s = s === null ? S.errors : s.concat(S.errors)),
                                      (r = s.length));
                                    var l = _ === r;
                                    if (!l) break;
                                  }
                                }
                              } else
                                return (
                                  (x.errors = [
                                    {
                                      instancePath: t + "/accounts",
                                      schemaPath: "#/properties/accounts/type",
                                      keyword: "type",
                                      params: { type: "array" },
                                    },
                                  ]),
                                  !1
                                );
                            var n = c === r;
                          } else var n = !0;
                          if (n)
                            if (e.excludedAssets !== void 0) {
                              let d = e.excludedAssets,
                                c = r;
                              if (r === c)
                                if (Array.isArray(d)) {
                                  if (d.length > 1e3)
                                    return (
                                      (x.errors = [
                                        {
                                          instancePath: t + "/excludedAssets",
                                          schemaPath: "#/properties/excludedAssets/maxItems",
                                          keyword: "maxItems",
                                          params: { limit: 1e3 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (d.length < 0)
                                    return (
                                      (x.errors = [
                                        {
                                          instancePath: t + "/excludedAssets",
                                          schemaPath: "#/properties/excludedAssets/minItems",
                                          keyword: "minItems",
                                          params: { limit: 0 },
                                        },
                                      ]),
                                      !1
                                    );
                                  {
                                    var P = !0;
                                    let D = d.length;
                                    for (let w = 0; w < D; w++) {
                                      let _ = d[w],
                                        b = r;
                                      if (r === b)
                                        if (_ && typeof _ == "object" && !Array.isArray(_)) {
                                          let I;
                                          if (
                                            (_.brokerAssetId === void 0 && (I = "brokerAssetId")) ||
                                            (_.reason === void 0 && (I = "reason"))
                                          )
                                            return (
                                              (x.errors = [
                                                {
                                                  instancePath: t + "/excludedAssets/" + w,
                                                  schemaPath:
                                                    "#/properties/excludedAssets/items/required",
                                                  keyword: "required",
                                                  params: { missingProperty: I },
                                                },
                                              ]),
                                              !1
                                            );
                                          {
                                            let Mr = r;
                                            for (let ye in _)
                                              if (!(ye === "brokerAssetId" || ye === "reason")) {
                                                return (
                                                  (x.errors = [
                                                    {
                                                      instancePath: t + "/excludedAssets/" + w,
                                                      schemaPath:
                                                        "#/properties/excludedAssets/items/additionalProperties",
                                                      keyword: "additionalProperties",
                                                      params: { additionalProperty: ye },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                                break;
                                              }
                                            if (Mr === r) {
                                              if (_.brokerAssetId !== void 0) {
                                                let ye = _.brokerAssetId,
                                                  Ne = r;
                                                if (r === Ne)
                                                  if (typeof ye == "string") {
                                                    if (O(ye) > 180)
                                                      return (
                                                        (x.errors = [
                                                          {
                                                            instancePath:
                                                              t +
                                                              "/excludedAssets/" +
                                                              w +
                                                              "/brokerAssetId",
                                                            schemaPath:
                                                              "#/properties/excludedAssets/items/properties/brokerAssetId/maxLength",
                                                            keyword: "maxLength",
                                                            params: { limit: 180 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (O(ye) < 1)
                                                      return (
                                                        (x.errors = [
                                                          {
                                                            instancePath:
                                                              t +
                                                              "/excludedAssets/" +
                                                              w +
                                                              "/brokerAssetId",
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
                                                      (x.errors = [
                                                        {
                                                          instancePath:
                                                            t +
                                                            "/excludedAssets/" +
                                                            w +
                                                            "/brokerAssetId",
                                                          schemaPath:
                                                            "#/properties/excludedAssets/items/properties/brokerAssetId/type",
                                                          keyword: "type",
                                                          params: { type: "string" },
                                                        },
                                                      ]),
                                                      !1
                                                    );
                                                var g = Ne === r;
                                              } else var g = !0;
                                              if (g)
                                                if (_.reason !== void 0) {
                                                  let ye = _.reason,
                                                    Ne = r;
                                                  if (r === Ne)
                                                    if (typeof ye == "string") {
                                                      if (O(ye) > 64)
                                                        return (
                                                          (x.errors = [
                                                            {
                                                              instancePath:
                                                                t +
                                                                "/excludedAssets/" +
                                                                w +
                                                                "/reason",
                                                              schemaPath:
                                                                "#/properties/excludedAssets/items/properties/reason/maxLength",
                                                              keyword: "maxLength",
                                                              params: { limit: 64 },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                      if (O(ye) < 1)
                                                        return (
                                                          (x.errors = [
                                                            {
                                                              instancePath:
                                                                t +
                                                                "/excludedAssets/" +
                                                                w +
                                                                "/reason",
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
                                                        (x.errors = [
                                                          {
                                                            instancePath:
                                                              t +
                                                              "/excludedAssets/" +
                                                              w +
                                                              "/reason",
                                                            schemaPath:
                                                              "#/properties/excludedAssets/items/properties/reason/type",
                                                            keyword: "type",
                                                            params: { type: "string" },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                  var g = Ne === r;
                                                } else var g = !0;
                                            }
                                          }
                                        } else
                                          return (
                                            (x.errors = [
                                              {
                                                instancePath: t + "/excludedAssets/" + w,
                                                schemaPath:
                                                  "#/properties/excludedAssets/items/type",
                                                keyword: "type",
                                                params: { type: "object" },
                                              },
                                            ]),
                                            !1
                                          );
                                      var P = b === r;
                                      if (!P) break;
                                    }
                                  }
                                } else
                                  return (
                                    (x.errors = [
                                      {
                                        instancePath: t + "/excludedAssets",
                                        schemaPath: "#/properties/excludedAssets/type",
                                        keyword: "type",
                                        params: { type: "array" },
                                      },
                                    ]),
                                    !1
                                  );
                              var n = c === r;
                            } else var n = !0;
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
          (x.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((x.errors = s), r === 0);
  }
  x.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ce(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = ce.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), r === 0))
      if (e && typeof e == "object" && !Array.isArray(e)) {
        let v;
        if (
          (e.state === void 0 && (v = "state")) ||
          (e.coverage === void 0 && (v = "coverage")) ||
          (e.sourceAsOf === void 0 && (v = "sourceAsOf")) ||
          (e.fetchedAt === void 0 && (v = "fetchedAt")) ||
          (e.freshness === void 0 && (v = "freshness")) ||
          (e.data === void 0 && (v = "data"))
        )
          return (
            (ce.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: v },
              },
            ]),
            !1
          );
        {
          let f = r;
          for (let l in e)
            if (!(
              l === "state" ||
              l === "coverage" ||
              l === "sourceAsOf" ||
              l === "fetchedAt" ||
              l === "freshness" ||
              l === "data"
            )) {
              return (
                (ce.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (f === r) {
            if (e.state !== void 0) {
              let l = e.state,
                P = r;
              if (!(l === "ready" || l === "empty"))
                return (
                  (ce.errors = [
                    {
                      instancePath: t + "/state",
                      schemaPath: "#/properties/state/enum",
                      keyword: "enum",
                      params: { allowedValues: Vr.properties.state.enum },
                    },
                  ]),
                  !1
                );
              var n = P === r;
            } else var n = !0;
            if (n) {
              if (e.coverage !== void 0) {
                let l = r;
                R(e.coverage, {
                  instancePath: t + "/coverage",
                  parentData: e,
                  parentDataProperty: "coverage",
                  rootData: i,
                  dynamicAnchors: o,
                }) || ((s = s === null ? R.errors : s.concat(R.errors)), (r = s.length));
                var n = l === r;
              } else var n = !0;
              if (n) {
                if (e.sourceAsOf !== void 0) {
                  let l = e.sourceAsOf,
                    P = r,
                    g = r,
                    y = !1,
                    u = r;
                  j(l, {
                    instancePath: t + "/sourceAsOf",
                    parentData: e,
                    parentDataProperty: "sourceAsOf",
                    rootData: i,
                    dynamicAnchors: o,
                  }) || ((s = s === null ? j.errors : s.concat(j.errors)), (r = s.length));
                  var m = u === r;
                  y = y || m;
                  let d = r;
                  if (l !== null) {
                    let k = {
                      instancePath: t + "/sourceAsOf",
                      schemaPath: "#/properties/sourceAsOf/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (s === null ? (s = [k]) : s.push(k), r++);
                  }
                  var m = d === r;
                  if (((y = y || m), y)) ((r = g), s !== null && (g ? (s.length = g) : (s = null)));
                  else {
                    let k = {
                      instancePath: t + "/sourceAsOf",
                      schemaPath: "#/properties/sourceAsOf/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (s === null ? (s = [k]) : s.push(k), r++, (ce.errors = s), !1);
                  }
                  var n = P === r;
                } else var n = !0;
                if (n) {
                  if (e.fetchedAt !== void 0) {
                    let l = r;
                    j(e.fetchedAt, {
                      instancePath: t + "/fetchedAt",
                      parentData: e,
                      parentDataProperty: "fetchedAt",
                      rootData: i,
                      dynamicAnchors: o,
                    }) || ((s = s === null ? j.errors : s.concat(j.errors)), (r = s.length));
                    var n = l === r;
                  } else var n = !0;
                  if (n) {
                    if (e.freshness !== void 0) {
                      let l = e.freshness,
                        P = r;
                      if (!(l === "fresh" || l === "stale" || l === "unknown"))
                        return (
                          (ce.errors = [
                            {
                              instancePath: t + "/freshness",
                              schemaPath: "#/properties/freshness/enum",
                              keyword: "enum",
                              params: { allowedValues: Vr.properties.freshness.enum },
                            },
                          ]),
                          !1
                        );
                      var n = P === r;
                    } else var n = !0;
                    if (n)
                      if (e.data !== void 0) {
                        let l = r;
                        x(e.data, {
                          instancePath: t + "/data",
                          parentData: e,
                          parentDataProperty: "data",
                          rootData: i,
                          dynamicAnchors: o,
                        }) || ((s = s === null ? x.errors : s.concat(x.errors)), (r = s.length));
                        var n = l === r;
                      } else var n = !0;
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (ce.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((ce.errors = s), r === 0);
  }
  ce.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function nr(
    e,
    {
      instancePath: t = "",
      parentData: p,
      parentDataProperty: h,
      rootData: i = e,
      dynamicAnchors: o = {},
    } = {},
  ) {
    let s = null,
      r = 0,
      a = nr.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      ce(e, {
        instancePath: t,
        parentData: p,
        parentDataProperty: h,
        rootData: i,
        dynamicAnchors: o,
      }) || ((s = s === null ? ce.errors : s.concat(ce.errors)), (r = s.length)),
      (nr.errors = s),
      r === 0
    );
  }
  nr.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
});
var wr = _r(qr(), 1);
import { same as Ze } from "../../dist/core.mjs";
import { canonical as ls, deny as Lr, utc as fs } from "../../dist/core.mjs";
var A = (e) => {
    e || Lr("invalid_valuation");
  },
  je = (e) => A(new Set(e).size === e.length),
  W = (e) => (
    fs(e),
    A(e.slice(0, 4) !== "0000"),
    e.slice(0, 19) + "." + (e.slice(19, -1).replace(/^\./, "") || "").padEnd(6, "0")
  );
function vr(e) {
  (A(/^\d{4}-\d{2}-\d{2}$/.test(e)), W(e + "T00:00:00Z"));
}
function jr(e) {
  if (!(!e || typeof e != "object"))
    for (let [t, p] of Object.entries(e))
      p !== null && ["fetchedAt", "sourceAsOf", "recordedAt", "lastEditedAt"].includes(t)
        ? W(p)
        : p !== null && ["sourceDate", "reportDate"].includes(t)
          ? vr(p)
          : typeof p == "object" && jr(p);
}
function tr(e, t, p = 524288) {
  return (ls(t).length > p && Lr("payload_too_large"), A(e(t)), jr(t), structuredClone(t));
}
var Gr = _r(Tr(), 1);
import {
  canonical as or,
  same as ar,
  exact as _s,
  deny as Is,
  parsed as As,
  inspect as Fr,
  context as $s,
  privatePayload as xs,
  jose as Pr,
  JWE_HEADER as Ur,
  CONTRACT as Zr,
  PROFILE as ir,
  sign as Os,
  digest as Cs,
} from "../../dist/core.mjs";
var Kr = "folioview.holdings-facts.v2";
function Re(e, { snapshotId: t = null, revision: p = null } = {}) {
  let h = tr(Gr.default.HoldingsFactsContent, e, 196608),
    i = h.data;
  (p !== null && A(Number.isSafeInteger(p) && p >= 1),
    t !== null && A(i.snapshotId === t),
    je(i.accounts.map((o) => o.accountId)),
    A(i.accounts.reduce((o, s) => o + s.positions.length, 0) <= 1e3),
    A(h.sourceAsOf === null || W(h.sourceAsOf) <= W(h.fetchedAt)),
    A(i.reportDate === null || i.reportDate <= h.fetchedAt.slice(0, 10)),
    p !== null &&
      (i.previousSnapshot !== null &&
        A(i.previousSnapshot.sourceRevision < p && i.previousSnapshot.snapshotId !== i.snapshotId),
      i.importSnapshot !== null &&
        A(
          i.importSnapshot.sourceRevision <= p &&
            (i.importSnapshot.sourceRevision === p) ==
              (i.importSnapshot.snapshotId === i.snapshotId),
        )),
    i.editKind === "import" &&
      A(
        i.importSnapshot !== null &&
          (p === null || ar(i.importSnapshot, { snapshotId: i.snapshotId, sourceRevision: p })),
      ),
    i.editKind === "manual" && A(i.importSnapshot === null),
    i.editKind === "edit" && A(i.previousSnapshot !== null));
  for (let o of i.accounts) {
    (je(o.balances.map((s) => s.currency)), je(o.positions.map((s) => s.assetId)));
    for (let s of o.positions) {
      A(i.importSnapshot !== null || s.reportedValues === null);
      for (let r of ["unitCost", "bookCost", "bookCostCad"])
        A(s[r] === null || s[r].currency === (r === "bookCostCad" ? "CAD" : s.instrument.currency));
      for (let [r, a] of Object.entries(s.provenance)) {
        let { recordedAt: n, lastEditedAt: m, sourceDate: v, origin: f } = a;
        (A(n === null || W(n) <= W(h.fetchedAt)),
          A(m === null || (n !== null && W(m) <= W(n))),
          A(v === null || v <= h.fetchedAt.slice(0, 10)),
          f === "manual" && A(n !== null && m === n),
          f === "unknown" && A(n === null && m === null && v === null),
          ["unitCost", "bookCost", "bookCostCad"].includes(r) &&
            s[r] !== null &&
            A(f !== "unknown"));
      }
    }
  }
  return h;
}
function gr(e) {
  ($s(e),
    A(
      e.objectType === "holdings_snapshot" &&
        e.ref.kind === "holdings" &&
        e.ref.sourceService === "portfolio",
    ));
}
function kr(e, t) {
  (gr(t),
    _s(e, ["privateSchemaVersion", "profile", "objectId", "objectType", "revision", "payload"]),
    A(e.privateSchemaVersion === 1 && e.profile === ir));
  for (let p of ["objectId", "objectType", "revision"]) A(e[p] === t[p]);
  return (
    or(e).length > 196608 && Is("payload_too_large"),
    Re(e.payload, { snapshotId: t.objectId, revision: t.revision })
  );
}
async function qs(e, t, p) {
  gr(p);
  let h = Fr(e);
  A(ar(h.context, p));
  let i = await Pr.generalDecrypt(e.jwe, t, {
    keyManagementAlgorithms: ["ECDH-ES+A256KW"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  A(ar(i.protectedHeader, Ur) && ar(Array.from(i.additionalAuthenticatedData), Array.from(or(p))));
  let o = As(i.plaintext, !0);
  return o?.payload?.data?.profile === Kr ? kr(o, p) : xs(o, p);
}
async function Ls(e, t, p, h) {
  gr(t);
  let i = {
    privateSchemaVersion: 1,
    profile: ir,
    objectId: t.objectId,
    objectType: t.objectType,
    revision: t.revision,
    payload: e,
  };
  kr(i, t);
  let o = new Pr.GeneralEncrypt(or(i)).setProtectedHeader(Ur).setAdditionalAuthenticatedData(or(t));
  for (let n of t.recipients)
    o.addRecipient(await Pr.importJWK(p[n.keyId], "ECDH-ES+A256KW")).setUnprotectedHeader({
      kid: n.keyId,
    });
  let s = await o.encrypt(),
    r = await Os(
      {
        contractVersion: Zr,
        profile: ir,
        artifactType: "persistent_content_publication",
        context: t,
        ciphertextDigest: await Cs(s),
      },
      h,
      t.rootKeyId,
      "fv-control+jws",
    ),
    a = { contractVersion: Zr, profile: ir, proof: r, jwe: s };
  return (Fr(a), a);
}
import { deny as lr } from "../../dist/core.mjs";
function me(e, t = !1) {
  (typeof e != "string" ||
    !(
      t ? /^-?(0|[1-9][0-9]{0,79})(\.[0-9]{1,60})?$/ : /^(0|[1-9][0-9]{0,19})(\.[0-9]{1,18})?$/
    ).test(e)) &&
    lr("invalid_valuation");
  let [p, h = ""] = e.split(".");
  return { n: BigInt(p + h), s: h.length };
}
var fr = (e) => 10n ** BigInt(e);
function zr(e, t) {
  let p = Math.max(e.s, t.s);
  return { n: e.n * fr(p - e.s) + t.n * fr(p - t.s), s: p };
}
function pr(e, t) {
  return { n: e.n * t.n, s: e.s + t.s };
}
function Ve({ n: e, s: t }, p = !1) {
  let h = e < 0n,
    i = (h ? -e : e).toString().padStart(t + 1, "0");
  return (
    t && (i = i.slice(0, -t) + "." + i.slice(-t)),
    !p && t && (i = i.replace(/0+$/, "").replace(/\.$/, "")),
    (h && e !== 0n ? "-" : "") + i
  );
}
function ur(e, t, p) {
  t.n <= 0n && lr("invalid_valuation");
  let h = e.n * fr(t.s + p),
    i = t.n * fr(e.s),
    o = h < 0n;
  o && (h = -h);
  let s = h / i,
    r = h % i;
  return ((r * 2n > i || (r * 2n === i && s % 2n !== 0n)) && s++, { n: o ? -s : s, s: p });
}
function Te(e, t) {
  let p = me(e),
    h = me(t);
  (p.n <= 0n || h.n <= 0n) && lr("invalid_valuation");
  let i = Ve(ur(p, h, 18));
  return (me(i).n <= 0n && lr("invalid_valuation"), i);
}
var et = "folioview.valuation.v1",
  Br = Object.freeze({
    defaultPortfolioCurrency: "USD",
    language: "en",
    theme: "light",
    defaultChartRange: "1m",
  }),
  Fe = (e) => JSON.stringify([e.symbol, e.market, e.currency]),
  Se = (e) => JSON.stringify([e.base, e.quote]),
  Ue = (e) => {
    let t = me(e);
    return (A(t.n > 0n), t);
  };
function Le(e, t) {
  if (e === "HoldingsFactsContent") return Re(t);
  A(Object.hasOwn(wr.default, e));
  let p = tr(wr.default[e], t);
  return (e === "Timestamp" && W(p), e === "Date" && vr(p), p);
}
function js(e) {
  let t = Le("QuoteRequest", e);
  return ((t.instruments = [...new Map(t.instruments.map((p) => [Fe(p), p])).values()]), t);
}
function Vs(e) {
  let t = Le("FxRequest", e);
  return ((t.pairs = [...new Map(t.pairs.map((p) => [Se(p), p])).values()]), t);
}
function Hr(e, t) {
  (A(W(e.fetchedAt) <= W(t.fetchedAt)),
    A(e.sourceAsOf === null || W(e.sourceAsOf) <= W(e.fetchedAt)),
    A(e.sourceDate === null || e.sourceDate <= e.fetchedAt.slice(0, 10)));
}
function Es(e, t = null) {
  let p = Le("QuoteBatch", e),
    h = p.items.map((i) => Fe(i.instrument));
  (je(h), t !== null && A(Ze([...h].sort(), js({ instruments: t }).instruments.map(Fe).sort())));
  for (let i of p.items)
    (Hr(i, p),
      ["available", "stale"].includes(i.status)
        ? (Ue(i.price),
          A(
            i.source === "yahoo_finance" &&
              i.sourceAsOf !== null &&
              i.reason === null &&
              i.instrument.market !== "UNKNOWN",
          ))
        : A(i.price === null && i.reason !== null));
  return p;
}
function Rs(e, t = null) {
  let p = Le("FxBatch", e),
    h = new Set(),
    i = p.items.map(Se);
  (je(i), t !== null && A(Ze([...i].sort(), Vs({ pairs: t }).pairs.map(Se).sort())));
  for (let o of p.items) {
    if ((Hr(o, p), !["available", "stale"].includes(o.status))) {
      A(o.rate === null && o.route === null && o.reason !== null);
      continue;
    }
    let s = Ue(o.rate),
      { base: r, quote: a, route: n } = o;
    if ((A(n !== null && o.reason === null), r === a)) {
      A(
        Ve(s) === "1" &&
          o.source === "identity" &&
          o.status === "available" &&
          Ze(n, { kind: "identity", via: null, legs: [] }) &&
          o.sourceDate === null &&
          o.sourceAsOf === null,
      );
      continue;
    }
    (A(o.source === "bank_of_canada" && o.sourceDate !== null), h.add(o.sourceDate));
    for (let v of n.legs)
      (Ue(v.rate), A(v.sourceDate === o.sourceDate && v.quote === "CAD" && v.base !== "CAD"));
    let m;
    (a === "CAD"
      ? (A(n.kind === "direct" && n.via === null && n.legs.length === 1 && n.legs[0].base === r),
        (m = Te(n.legs[0].rate, "1")))
      : r === "CAD"
        ? (A(n.kind === "inverse" && n.via === null && n.legs.length === 1 && n.legs[0].base === a),
          (m = Te("1", n.legs[0].rate)))
        : (A(
            n.kind === "cross" &&
              n.via === "CAD" &&
              n.legs.length === 2 &&
              Ze(
                n.legs.map((v) => v.base),
                [r, a],
              ),
          ),
          (m = Te(n.legs[0].rate, n.legs[1].rate))),
      A(Ve(s) === m));
  }
  return (A(h.size <= 1), p);
}
function Dr(e, t) {
  let p = Le(t, e);
  return (A((p.version === 0) == (p.preferences === null)), p);
}
function Wr(e) {
  let t = Dr(e, "CurrencyPreferencesSnapshot");
  return (
    A(
      (t.currencyGeneration === 0) == (t.preferences === null) && t.currencyGeneration <= t.version,
    ),
    t
  );
}
function rt(e, t) {
  return {
    ...Br,
    ...(Dr(e, "UiPreferencesSnapshotV1").preferences ?? {}),
    ...(Wr(t).preferences ?? {}),
  };
}
function Ss(e) {
  let t = Le("FxPreferences", e);
  return (
    je(t.pairs.map(Se)),
    A(t.pairs.every((p) => p.base !== p.quote)),
    A(t.suppressedDefault === null || t.suppressedDefault.currency !== "USD"),
    t
  );
}
function Ns(e) {
  let t = Dr(e, "FxPreferencesSnapshot");
  return (t.preferences !== null && Ss(t.preferences), t);
}
function st(e, t) {
  let p = Ns(e).preferences ?? { pairs: [], suppressedDefault: null },
    h = p.pairs.map((s) => ({ ...s, origin: "manual" }));
  if (t === null) return h;
  let i = Wr(t),
    o = (i.preferences ?? Br).defaultPortfolioCurrency;
  return o === "USD" ||
    Ze(p.suppressedDefault, { currency: o, currencyGeneration: i.currencyGeneration }) ||
    h.some((s) => s.base === "USD" && s.quote === o)
    ? h
    : [{ base: "USD", quote: o, origin: "default" }, ...h];
}
function tt(e, t) {
  let p = [Le("Currency", t)];
  for (let h of Re(e).data.accounts)
    for (let i of h.positions) p.includes(i.instrument.currency) || p.push(i.instrument.currency);
  return p;
}
function nt(e, t, p, h) {
  ((e = Re(e)), (t = Es(t)), (p = Rs(p)), Le("Currency", h));
  let i = new Map(t.items.map((n) => [Fe(n.instrument), n])),
    o = new Map(p.items.map((n) => [Se(n), n])),
    s = [],
    r = { n: 0n, s: 0 };
  for (let n of e.data.accounts)
    for (let m of n.positions) {
      let v = m.instrument,
        f = i.get(Fe(v)),
        l = o.get(Se({ base: v.currency, quote: h })),
        P = v.currency === h,
        g =
          v.market === "UNKNOWN" || v.symbol === null || m.assetType === "unsupported"
            ? "unresolved"
            : !f || !["available", "stale"].includes(f.status)
              ? "missing_quote"
              : !P && (!l || !["available", "stale"].includes(l.status))
                ? "missing_fx"
                : "valued",
        y = null,
        u = !1;
      if (me(m.quantity).n === 0n) ((g = "valued"), (y = "0"));
      else if (g === "valued") {
        let d = pr(pr(me(m.quantity), Ue(f.price)), P ? me("1") : Ue(l.rate));
        ((r = zr(r, d)), (y = Ve(d)), (u = f.status === "stale" || (!P && l.status === "stale")));
      }
      s.push({
        accountId: n.accountId,
        assetId: m.assetId,
        status: g,
        value: y,
        weightPercent: null,
        stale: u,
      });
    }
  for (let n of s)
    n.value !== null &&
      r.n !== 0n &&
      (n.weightPercent = Ve(ur(pr(me(n.value, !0), me("100")), r, 6)));
  let a = s.filter((n) => n.value !== null).length;
  return {
    currency: h,
    subtotal: a || !s.length ? Ve(r) : null,
    complete: a === s.length,
    valuedCount: a,
    positionCount: s.length,
    stale: s.some((n) => n.stale),
    quoteSnapshotId: t.snapshotId,
    fxSnapshotId: p.snapshotId,
    rows: s,
  };
}
function at(e, t) {
  return (Le("Currency", t), Ve(ur(me(e, !0), me("1"), t === "JPY" ? 0 : 2), !0));
}
export {
  Br as DEFAULT_PREFERENCES,
  Kr as HOLDINGS_FACTS_PROFILE,
  et as VALUATION_CONTRACT,
  Te as crossRate,
  Wr as currencySnapshot,
  tt as displayCurrencies,
  st as effectiveFxPairs,
  Rs as fxBatch,
  Ss as fxPreferences,
  Ns as fxPreferencesSnapshot,
  Vs as fxRequest,
  Re as holdingsFacts,
  kr as holdingsPrivate,
  qs as openHoldings,
  Es as quoteBatch,
  js as quoteRequest,
  rt as resolvePreferences,
  at as roundDisplayAmount,
  Ls as sealHoldingsFacts,
  Le as validateValuation,
  nt as valueHoldings,
};
