var Ce = Object.create;
var le = Object.defineProperty;
var xe = Object.getOwnPropertyDescriptor;
var $e = Object.getOwnPropertyNames;
var Oe = Object.getPrototypeOf,
  Le = Object.prototype.hasOwnProperty;
var pe = (s, t) => () => {
  try {
    return (t || s((t = { exports: {} }).exports, t), t.exports);
  } catch (c) {
    throw ((t = 0), c);
  }
};
var qe = (s, t, c, A) => {
  if ((t && typeof t == "object") || typeof t == "function")
    for (let o of $e(t))
      !Le.call(s, o) &&
        o !== c &&
        le(s, o, { get: () => t[o], enumerable: !(A = xe(t, o)) || A.enumerable });
  return s;
};
var je = (s, t, c) => (
  (c = s != null ? Ce(Oe(s)) : {}),
  qe(t || !s || !s.__esModule ? le(c, "default", { value: s, enumerable: !0 }) : c, s)
);
var fe = pe((ae) => {
  "use strict";
  Object.defineProperty(ae, "__esModule", { value: !0 });
  function ue(s) {
    let t = s.length,
      c = 0,
      A = 0,
      o;
    for (; A < t;)
      (c++,
        (o = s.charCodeAt(A++)),
        o >= 55296 && o <= 56319 && A < t && ((o = s.charCodeAt(A)), (o & 64512) === 56320 && A++));
    return c;
  }
  ae.default = ue;
  ue.code = 'require("ajv/dist/runtime/ucs2length").default';
});
var ve = pe((he) => {
  "use strict";
  he.HoldingsFactsContent = ee;
  var de = {
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
    Ee = {
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
    C = fe().default;
  function j(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = j.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let w;
        if ((s.state === void 0 && (w = "state")) || (s.issues === void 0 && (w = "issues")))
          return (
            (j.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let y = e;
          for (let u in s)
            if (!(u === "state" || u === "issues")) {
              return (
                (j.errors = [
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
          if (y === e) {
            if (s.state !== void 0) {
              let u = s.state,
                k = e;
              if (typeof u != "string")
                return (
                  (j.errors = [
                    {
                      instancePath: t + "/state",
                      schemaPath: "#/properties/state/type",
                      keyword: "type",
                      params: { type: "string" },
                    },
                  ]),
                  !1
                );
              if (!(u === "complete" || u === "partial" || u === "unknown"))
                return (
                  (j.errors = [
                    {
                      instancePath: t + "/state",
                      schemaPath: "#/properties/state/enum",
                      keyword: "enum",
                      params: { allowedValues: Ee.properties.state.enum },
                    },
                  ]),
                  !1
                );
              var n = k === e;
            } else var n = !0;
            if (n)
              if (s.issues !== void 0) {
                let u = s.issues,
                  k = e;
                if (e === k)
                  if (Array.isArray(u)) {
                    if (u.length > 20)
                      return (
                        (j.errors = [
                          {
                            instancePath: t + "/issues",
                            schemaPath: "#/properties/issues/maxItems",
                            keyword: "maxItems",
                            params: { limit: 20 },
                          },
                        ]),
                        !1
                      );
                    if (u.length < 0)
                      return (
                        (j.errors = [
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
                      var h = !0;
                      let b = u.length;
                      for (let m = 0; m < b; m++) {
                        let l = u[m],
                          i = e;
                        if (e === i)
                          if (typeof l == "string") {
                            if (C(l) > 80)
                              return (
                                (j.errors = [
                                  {
                                    instancePath: t + "/issues/" + m,
                                    schemaPath: "#/properties/issues/items/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 80 },
                                  },
                                ]),
                                !1
                              );
                            if (C(l) < 1)
                              return (
                                (j.errors = [
                                  {
                                    instancePath: t + "/issues/" + m,
                                    schemaPath: "#/properties/issues/items/minLength",
                                    keyword: "minLength",
                                    params: { limit: 1 },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (j.errors = [
                                {
                                  instancePath: t + "/issues/" + m,
                                  schemaPath: "#/properties/issues/items/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var h = i === e;
                        if (!h) break;
                      }
                      if (h) {
                        let m = u.length,
                          l;
                        if (m > 1) {
                          let i = {};
                          for (; m--;) {
                            let v = u[m];
                            if (typeof v == "string") {
                              if (typeof i[v] == "number") {
                                return (
                                  (l = i[v]),
                                  (j.errors = [
                                    {
                                      instancePath: t + "/issues",
                                      schemaPath: "#/properties/issues/uniqueItems",
                                      keyword: "uniqueItems",
                                      params: { i: m, j: l },
                                    },
                                  ]),
                                  !1
                                );
                                break;
                              }
                              i[v] = m;
                            }
                          }
                        }
                      }
                    }
                  } else
                    return (
                      (j.errors = [
                        {
                          instancePath: t + "/issues",
                          schemaPath: "#/properties/issues/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ]),
                      !1
                    );
                var n = k === e;
              } else var n = !0;
          }
        }
      } else
        return (
          (j.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((j.errors = r), e === 0);
  }
  j.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Se = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/,
    Re = new RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$", "u");
  function O(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = O.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      e === 0 && e === 0)
    )
      if (typeof s == "string") {
        if (C(s) > 32)
          return (
            (O.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 32 },
              },
            ]),
            !1
          );
        if (C(s) < 1)
          return (
            (O.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (Re.test(s)) {
          if (!Se.test(s))
            return (
              (O.errors = [
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
            (O.errors = [
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
          (O.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((O.errors = r), e === 0);
  }
  O.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var ce = {
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
    ye = Object.prototype.hasOwnProperty,
    Ve = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "u");
  function q(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = q.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (typeof s == "string") {
        if (C(s) > 128)
          return (
            (q.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 128 },
              },
            ]),
            !1
          );
        if (C(s) < 1)
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
        if (!Ve.test(s))
          return (
            (q.errors = [
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
          (q.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((q.errors = r), e === 0);
  }
  q.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var Ne = /^\d{4}-\d{2}-\d{2}$/,
    Te = new RegExp("^\\d{4}-\\d{2}-\\d{2}$", "u");
  function N(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = N.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      e === 0 && e === 0)
    )
      if (typeof s == "string") {
        if (C(s) > 10)
          return (
            (N.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 10 },
              },
            ]),
            !1
          );
        if (C(s) < 1)
          return (
            (N.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (Te.test(s)) {
          if (!Ne.test(s))
            return (
              (N.errors = [
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
            (N.errors = [
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
          (N.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((N.errors = r), e === 0);
  }
  N.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function Y(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = Y.evaluated;
    if (
      (a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      !(typeof s == "number" && !(s % 1) && !isNaN(s)))
    )
      return (
        (Y.errors = [
          { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "integer" } },
        ]),
        !1
      );
    if (e === 0 && typeof s == "number") {
      if (s > 9007199254740991 || isNaN(s))
        return (
          (Y.errors = [
            {
              instancePath: t,
              schemaPath: "#/maximum",
              keyword: "maximum",
              params: { comparison: "<=", limit: 9007199254740991 },
            },
          ]),
          !1
        );
      if (s < 0 || isNaN(s))
        return (
          (Y.errors = [
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
    return ((Y.errors = r), e === 0);
  }
  Y.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function T(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = T.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let h;
        if (
          (s.snapshotId === void 0 && (h = "snapshotId")) ||
          (s.sourceRevision === void 0 && (h = "sourceRevision"))
        )
          return (
            (T.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: h },
              },
            ]),
            !1
          );
        {
          let w = e;
          for (let y in s)
            if (!(y === "snapshotId" || y === "sourceRevision")) {
              return (
                (T.errors = [
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
          if (w === e) {
            if (s.snapshotId !== void 0) {
              let y = e;
              q(s.snapshotId, {
                instancePath: t + "/snapshotId",
                parentData: s,
                parentDataProperty: "snapshotId",
                rootData: o,
                dynamicAnchors: f,
              }) || ((r = r === null ? q.errors : r.concat(q.errors)), (e = r.length));
              var n = y === e;
            } else var n = !0;
            if (n)
              if (s.sourceRevision !== void 0) {
                let y = s.sourceRevision,
                  u = e;
                if (
                  (Y(y, {
                    instancePath: t + "/sourceRevision",
                    parentData: s,
                    parentDataProperty: "sourceRevision",
                    rootData: o,
                    dynamicAnchors: f,
                  }) || ((r = r === null ? Y.errors : r.concat(Y.errors)), (e = r.length)),
                  e === u && typeof y == "number" && (y < 1 || isNaN(y)))
                )
                  return (
                    (T.errors = [
                      {
                        instancePath: t + "/sourceRevision",
                        schemaPath: "#/properties/sourceRevision/minimum",
                        keyword: "minimum",
                        params: { comparison: ">=", limit: 1 },
                      },
                    ]),
                    !1
                  );
                var n = u === e;
              } else var n = !0;
          }
        }
      } else
        return (
          (T.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((T.errors = r), e === 0);
  }
  T.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Ze = {
      type: "object",
      properties: {
        currency: { $ref: "#/$defs/Currency" },
        cashBalance: { anyOf: [{ $ref: "#/$defs/SignedDecimal" }, { type: "null" }] },
        buyingPower: { const: null },
      },
      required: ["currency", "cashBalance", "buyingPower"],
      additionalProperties: !1,
    },
    Ke = {
      enum: ["USD", "CAD", "CNY", "EUR", "GBP", "JPY", "HKD", "AUD", "CHF", "NZD", "SGD", "TWD"],
    };
  function V(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = V.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      s === "USD" ||
      s === "CAD" ||
      s === "CNY" ||
      s === "EUR" ||
      s === "GBP" ||
      s === "JPY" ||
      s === "HKD" ||
      s === "AUD" ||
      s === "CHF" ||
      s === "NZD" ||
      s === "SGD" ||
      s === "TWD"
        ? ((V.errors = r), e === 0)
        : ((V.errors = [
            {
              instancePath: t,
              schemaPath: "#/enum",
              keyword: "enum",
              params: { allowedValues: Ke.enum },
            },
          ]),
          !1)
    );
  }
  V.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var ze = new RegExp("^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$", "u");
  function Z(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = Z.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (typeof s == "string") {
        if (C(s) > 40)
          return (
            (Z.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 40 },
              },
            ]),
            !1
          );
        if (C(s) < 1)
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
        if (!ze.test(s))
          return (
            (Z.errors = [
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
          (Z.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((Z.errors = r), e === 0);
  }
  Z.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function F(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = F.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let w;
        if (
          (s.currency === void 0 && (w = "currency")) ||
          (s.cashBalance === void 0 && (w = "cashBalance")) ||
          (s.buyingPower === void 0 && (w = "buyingPower"))
        )
          return (
            (F.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let y = e;
          for (let u in s)
            if (!(u === "currency" || u === "cashBalance" || u === "buyingPower")) {
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
          if (y === e) {
            if (s.currency !== void 0) {
              let u = e;
              V(s.currency, {
                instancePath: t + "/currency",
                parentData: s,
                parentDataProperty: "currency",
                rootData: o,
                dynamicAnchors: f,
              }) || ((r = r === null ? V.errors : r.concat(V.errors)), (e = r.length));
              var n = u === e;
            } else var n = !0;
            if (n) {
              if (s.cashBalance !== void 0) {
                let u = s.cashBalance,
                  k = e,
                  d = e,
                  b = !1,
                  m = e;
                Z(u, {
                  instancePath: t + "/cashBalance",
                  parentData: s,
                  parentDataProperty: "cashBalance",
                  rootData: o,
                  dynamicAnchors: f,
                }) || ((r = r === null ? Z.errors : r.concat(Z.errors)), (e = r.length));
                var h = m === e;
                b = b || h;
                let l = e;
                if (u !== null) {
                  let v = {
                    instancePath: t + "/cashBalance",
                    schemaPath: "#/properties/cashBalance/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (r === null ? (r = [v]) : r.push(v), e++);
                }
                var h = l === e;
                if (((b = b || h), b)) ((e = d), r !== null && (d ? (r.length = d) : (r = null)));
                else {
                  let v = {
                    instancePath: t + "/cashBalance",
                    schemaPath: "#/properties/cashBalance/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (r === null ? (r = [v]) : r.push(v), e++, (F.errors = r), !1);
                }
                var n = k === e;
              } else var n = !0;
              if (n)
                if (s.buyingPower !== void 0) {
                  let u = e;
                  if (s.buyingPower !== null)
                    return (
                      (F.errors = [
                        {
                          instancePath: t + "/buyingPower",
                          schemaPath: "#/properties/buyingPower/const",
                          keyword: "const",
                          params: { allowedValue: Ze.properties.buyingPower.const },
                        },
                      ]),
                      !1
                    );
                  var n = u === e;
                } else var n = !0;
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
    return ((F.errors = r), e === 0);
  }
  F.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var me = {
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
    He = new RegExp("^[A-Z0-9][A-Z0-9.\\-^]{0,31}$", "u");
  function M(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = M.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (typeof s == "string") {
        if (C(s) > 32)
          return (
            (M.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 32 },
              },
            ]),
            !1
          );
        if (C(s) < 1)
          return (
            (M.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!He.test(s))
          return (
            (M.errors = [
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
          (M.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((M.errors = r), e === 0);
  }
  M.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var Be = new RegExp("^(?:[A-Z0-9]{4}|UNKNOWN)$", "u");
  function U(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = U.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (typeof s == "string") {
        if (C(s) > 7)
          return (
            (U.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 7 },
              },
            ]),
            !1
          );
        if (C(s) < 4)
          return (
            (U.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 4 },
              },
            ]),
            !1
          );
        if (!Be.test(s))
          return (
            (U.errors = [
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
          (U.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((U.errors = r), e === 0);
  }
  U.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function W(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = W.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let w;
        if (
          (s.symbol === void 0 && (w = "symbol")) ||
          (s.market === void 0 && (w = "market")) ||
          (s.currency === void 0 && (w = "currency"))
        )
          return (
            (W.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let y = e;
          for (let u in s)
            if (!(u === "symbol" || u === "market" || u === "currency")) {
              return (
                (W.errors = [
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
          if (y === e) {
            if (s.symbol !== void 0) {
              let u = s.symbol,
                k = e,
                d = e,
                b = !1,
                m = e;
              M(u, {
                instancePath: t + "/symbol",
                parentData: s,
                parentDataProperty: "symbol",
                rootData: o,
                dynamicAnchors: f,
              }) || ((r = r === null ? M.errors : r.concat(M.errors)), (e = r.length));
              var n = m === e;
              b = b || n;
              let l = e;
              if (u !== null) {
                let i = {
                  instancePath: t + "/symbol",
                  schemaPath: "#/properties/symbol/anyOf/1/type",
                  keyword: "type",
                  params: { type: "null" },
                };
                (r === null ? (r = [i]) : r.push(i), e++);
              }
              var n = l === e;
              if (((b = b || n), b)) ((e = d), r !== null && (d ? (r.length = d) : (r = null)));
              else {
                let i = {
                  instancePath: t + "/symbol",
                  schemaPath: "#/properties/symbol/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                return (r === null ? (r = [i]) : r.push(i), e++, (W.errors = r), !1);
              }
              var h = k === e;
            } else var h = !0;
            if (h) {
              if (s.market !== void 0) {
                let u = e;
                U(s.market, {
                  instancePath: t + "/market",
                  parentData: s,
                  parentDataProperty: "market",
                  rootData: o,
                  dynamicAnchors: f,
                }) || ((r = r === null ? U.errors : r.concat(U.errors)), (e = r.length));
                var h = u === e;
              } else var h = !0;
              if (h)
                if (s.currency !== void 0) {
                  let u = e;
                  V(s.currency, {
                    instancePath: t + "/currency",
                    parentData: s,
                    parentDataProperty: "currency",
                    rootData: o,
                    dynamicAnchors: f,
                  }) || ((r = r === null ? V.errors : r.concat(V.errors)), (e = r.length));
                  var h = u === e;
                } else var h = !0;
            }
          }
        }
      } else
        return (
          (W.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((W.errors = r), e === 0);
  }
  W.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Fe = new RegExp("^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$", "u");
  function G(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = G.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (typeof s == "string") {
        if (C(s) > 33)
          return (
            (G.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 33 },
              },
            ]),
            !1
          );
        if (C(s) < 1)
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
        if (!Fe.test(s))
          return (
            (G.errors = [
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
          (G.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((G.errors = r), e === 0);
  }
  G.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var Me = new RegExp("^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$", "u");
  function J(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = J.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (typeof s == "string") {
        if (C(s) > 39)
          return (
            (J.errors = [
              {
                instancePath: t,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 39 },
              },
            ]),
            !1
          );
        if (C(s) < 1)
          return (
            (J.errors = [
              {
                instancePath: t,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ]),
            !1
          );
        if (!Me.test(s))
          return (
            (J.errors = [
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
          (J.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((J.errors = r), e === 0);
  }
  J.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  function S(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = S.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let h;
        if ((s.currency === void 0 && (h = "currency")) || (s.amount === void 0 && (h = "amount")))
          return (
            (S.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: h },
              },
            ]),
            !1
          );
        {
          let w = e;
          for (let y in s)
            if (!(y === "currency" || y === "amount")) {
              return (
                (S.errors = [
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
          if (w === e) {
            if (s.currency !== void 0) {
              let y = e;
              V(s.currency, {
                instancePath: t + "/currency",
                parentData: s,
                parentDataProperty: "currency",
                rootData: o,
                dynamicAnchors: f,
              }) || ((r = r === null ? V.errors : r.concat(V.errors)), (e = r.length));
              var n = y === e;
            } else var n = !0;
            if (n)
              if (s.amount !== void 0) {
                let y = e;
                J(s.amount, {
                  instancePath: t + "/amount",
                  parentData: s,
                  parentDataProperty: "amount",
                  rootData: o,
                  dynamicAnchors: f,
                }) || ((r = r === null ? J.errors : r.concat(J.errors)), (e = r.length));
                var n = y === e;
              } else var n = !0;
          }
        }
      } else
        return (
          (S.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((S.errors = r), e === 0);
  }
  S.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var Ue = {
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
  function $(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = $.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let u;
        if (
          (s.origin === void 0 && (u = "origin")) ||
          (s.recordedAt === void 0 && (u = "recordedAt")) ||
          (s.sourceDate === void 0 && (u = "sourceDate")) ||
          (s.lastEditedAt === void 0 && (u = "lastEditedAt"))
        )
          return (
            ($.errors = [
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
          let k = e;
          for (let d in s)
            if (!(
              d === "origin" ||
              d === "recordedAt" ||
              d === "sourceDate" ||
              d === "lastEditedAt"
            )) {
              return (
                ($.errors = [
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
          if (k === e) {
            if (s.origin !== void 0) {
              let d = s.origin,
                b = e;
              if (!(
                d === "import" ||
                d === "manual" ||
                d === "derived" ||
                d === "legacy" ||
                d === "unknown"
              ))
                return (
                  ($.errors = [
                    {
                      instancePath: t + "/origin",
                      schemaPath: "#/properties/origin/enum",
                      keyword: "enum",
                      params: { allowedValues: Ue.properties.origin.enum },
                    },
                  ]),
                  !1
                );
              var n = b === e;
            } else var n = !0;
            if (n) {
              if (s.recordedAt !== void 0) {
                let d = s.recordedAt,
                  b = e,
                  m = e,
                  l = !1,
                  i = e;
                O(d, {
                  instancePath: t + "/recordedAt",
                  parentData: s,
                  parentDataProperty: "recordedAt",
                  rootData: o,
                  dynamicAnchors: f,
                }) || ((r = r === null ? O.errors : r.concat(O.errors)), (e = r.length));
                var h = i === e;
                l = l || h;
                let v = e;
                if (d !== null) {
                  let p = {
                    instancePath: t + "/recordedAt",
                    schemaPath: "#/properties/recordedAt/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (r === null ? (r = [p]) : r.push(p), e++);
                }
                var h = v === e;
                if (((l = l || h), l)) ((e = m), r !== null && (m ? (r.length = m) : (r = null)));
                else {
                  let p = {
                    instancePath: t + "/recordedAt",
                    schemaPath: "#/properties/recordedAt/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (r === null ? (r = [p]) : r.push(p), e++, ($.errors = r), !1);
                }
                var n = b === e;
              } else var n = !0;
              if (n) {
                if (s.sourceDate !== void 0) {
                  let d = s.sourceDate,
                    b = e,
                    m = e,
                    l = !1,
                    i = e;
                  N(d, {
                    instancePath: t + "/sourceDate",
                    parentData: s,
                    parentDataProperty: "sourceDate",
                    rootData: o,
                    dynamicAnchors: f,
                  }) || ((r = r === null ? N.errors : r.concat(N.errors)), (e = r.length));
                  var w = i === e;
                  l = l || w;
                  let v = e;
                  if (d !== null) {
                    let p = {
                      instancePath: t + "/sourceDate",
                      schemaPath: "#/properties/sourceDate/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (r === null ? (r = [p]) : r.push(p), e++);
                  }
                  var w = v === e;
                  if (((l = l || w), l)) ((e = m), r !== null && (m ? (r.length = m) : (r = null)));
                  else {
                    let p = {
                      instancePath: t + "/sourceDate",
                      schemaPath: "#/properties/sourceDate/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (r === null ? (r = [p]) : r.push(p), e++, ($.errors = r), !1);
                  }
                  var n = b === e;
                } else var n = !0;
                if (n)
                  if (s.lastEditedAt !== void 0) {
                    let d = s.lastEditedAt,
                      b = e,
                      m = e,
                      l = !1,
                      i = e;
                    O(d, {
                      instancePath: t + "/lastEditedAt",
                      parentData: s,
                      parentDataProperty: "lastEditedAt",
                      rootData: o,
                      dynamicAnchors: f,
                    }) || ((r = r === null ? O.errors : r.concat(O.errors)), (e = r.length));
                    var y = i === e;
                    l = l || y;
                    let v = e;
                    if (d !== null) {
                      let p = {
                        instancePath: t + "/lastEditedAt",
                        schemaPath: "#/properties/lastEditedAt/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (r === null ? (r = [p]) : r.push(p), e++);
                    }
                    var y = v === e;
                    if (((l = l || y), l))
                      ((e = m), r !== null && (m ? (r.length = m) : (r = null)));
                    else {
                      let p = {
                        instancePath: t + "/lastEditedAt",
                        schemaPath: "#/properties/lastEditedAt/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (r === null ? (r = [p]) : r.push(p), e++, ($.errors = r), !1);
                    }
                    var n = b === e;
                  } else var n = !0;
              }
            }
          }
        }
      } else
        return (
          ($.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return (($.errors = r), e === 0);
  }
  $.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function H(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = H.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let h;
        if ((s.currency === void 0 && (h = "currency")) || (s.amount === void 0 && (h = "amount")))
          return (
            (H.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: h },
              },
            ]),
            !1
          );
        {
          let w = e;
          for (let y in s)
            if (!(y === "currency" || y === "amount")) {
              return (
                (H.errors = [
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
          if (w === e) {
            if (s.currency !== void 0) {
              let y = e;
              V(s.currency, {
                instancePath: t + "/currency",
                parentData: s,
                parentDataProperty: "currency",
                rootData: o,
                dynamicAnchors: f,
              }) || ((r = r === null ? V.errors : r.concat(V.errors)), (e = r.length));
              var n = y === e;
            } else var n = !0;
            if (n)
              if (s.amount !== void 0) {
                let y = e;
                Z(s.amount, {
                  instancePath: t + "/amount",
                  parentData: s,
                  parentDataProperty: "amount",
                  rootData: o,
                  dynamicAnchors: f,
                }) || ((r = r === null ? Z.errors : r.concat(Z.errors)), (e = r.length));
                var n = y === e;
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
    return ((H.errors = r), e === 0);
  }
  H.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function K(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = K.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let u;
        if (
          (s.unitPrice === void 0 && (u = "unitPrice")) ||
          (s.marketValue === void 0 && (u = "marketValue")) ||
          (s.unrealizedReturn === void 0 && (u = "unrealizedReturn"))
        )
          return (
            (K.errors = [
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
          let k = e;
          for (let d in s)
            if (!(d === "unitPrice" || d === "marketValue" || d === "unrealizedReturn")) {
              return (
                (K.errors = [
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
          if (k === e) {
            if (s.unitPrice !== void 0) {
              let d = s.unitPrice,
                b = e,
                m = e,
                l = !1,
                i = e;
              S(d, {
                instancePath: t + "/unitPrice",
                parentData: s,
                parentDataProperty: "unitPrice",
                rootData: o,
                dynamicAnchors: f,
              }) || ((r = r === null ? S.errors : r.concat(S.errors)), (e = r.length));
              var n = i === e;
              l = l || n;
              let v = e;
              if (d !== null) {
                let g = {
                  instancePath: t + "/unitPrice",
                  schemaPath: "#/properties/unitPrice/anyOf/1/type",
                  keyword: "type",
                  params: { type: "null" },
                };
                (r === null ? (r = [g]) : r.push(g), e++);
              }
              var n = v === e;
              if (((l = l || n), l)) ((e = m), r !== null && (m ? (r.length = m) : (r = null)));
              else {
                let g = {
                  instancePath: t + "/unitPrice",
                  schemaPath: "#/properties/unitPrice/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                return (r === null ? (r = [g]) : r.push(g), e++, (K.errors = r), !1);
              }
              var h = b === e;
            } else var h = !0;
            if (h) {
              if (s.marketValue !== void 0) {
                let d = s.marketValue,
                  b = e,
                  m = e,
                  l = !1,
                  i = e;
                H(d, {
                  instancePath: t + "/marketValue",
                  parentData: s,
                  parentDataProperty: "marketValue",
                  rootData: o,
                  dynamicAnchors: f,
                }) || ((r = r === null ? H.errors : r.concat(H.errors)), (e = r.length));
                var w = i === e;
                l = l || w;
                let v = e;
                if (d !== null) {
                  let p = {
                    instancePath: t + "/marketValue",
                    schemaPath: "#/properties/marketValue/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (r === null ? (r = [p]) : r.push(p), e++);
                }
                var w = v === e;
                if (((l = l || w), l)) ((e = m), r !== null && (m ? (r.length = m) : (r = null)));
                else {
                  let p = {
                    instancePath: t + "/marketValue",
                    schemaPath: "#/properties/marketValue/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (r === null ? (r = [p]) : r.push(p), e++, (K.errors = r), !1);
                }
                var h = b === e;
              } else var h = !0;
              if (h)
                if (s.unrealizedReturn !== void 0) {
                  let d = s.unrealizedReturn,
                    b = e,
                    m = e,
                    l = !1,
                    i = e;
                  H(d, {
                    instancePath: t + "/unrealizedReturn",
                    parentData: s,
                    parentDataProperty: "unrealizedReturn",
                    rootData: o,
                    dynamicAnchors: f,
                  }) || ((r = r === null ? H.errors : r.concat(H.errors)), (e = r.length));
                  var y = i === e;
                  l = l || y;
                  let v = e;
                  if (d !== null) {
                    let p = {
                      instancePath: t + "/unrealizedReturn",
                      schemaPath: "#/properties/unrealizedReturn/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (r === null ? (r = [p]) : r.push(p), e++);
                  }
                  var y = v === e;
                  if (((l = l || y), l)) ((e = m), r !== null && (m ? (r.length = m) : (r = null)));
                  else {
                    let p = {
                      instancePath: t + "/unrealizedReturn",
                      schemaPath: "#/properties/unrealizedReturn/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (r === null ? (r = [p]) : r.push(p), e++, (K.errors = r), !1);
                  }
                  var h = b === e;
                } else var h = !0;
            }
          }
        }
      } else
        return (
          (K.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((K.errors = r), e === 0);
  }
  K.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function L(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = L.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let m;
        if (
          (s.assetId === void 0 && (m = "assetId")) ||
          (s.brokerAssetId === void 0 && (m = "brokerAssetId")) ||
          (s.instrument === void 0 && (m = "instrument")) ||
          (s.name === void 0 && (m = "name")) ||
          (s.assetType === void 0 && (m = "assetType")) ||
          (s.quantity === void 0 && (m = "quantity")) ||
          (s.unitCost === void 0 && (m = "unitCost")) ||
          (s.bookCost === void 0 && (m = "bookCost")) ||
          (s.bookCostCad === void 0 && (m = "bookCostCad")) ||
          (s.provenance === void 0 && (m = "provenance")) ||
          (s.reportedValues === void 0 && (m = "reportedValues"))
        )
          return (
            (L.errors = [
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
          let l = e;
          for (let i in s)
            if (!ye.call(me.properties, i)) {
              return (
                (L.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: i },
                  },
                ]),
                !1
              );
              break;
            }
          if (l === e) {
            if (s.assetId !== void 0) {
              let i = e;
              q(s.assetId, {
                instancePath: t + "/assetId",
                parentData: s,
                parentDataProperty: "assetId",
                rootData: o,
                dynamicAnchors: f,
              }) || ((r = r === null ? q.errors : r.concat(q.errors)), (e = r.length));
              var n = i === e;
            } else var n = !0;
            if (n) {
              if (s.brokerAssetId !== void 0) {
                let i = s.brokerAssetId,
                  v = e,
                  g = e,
                  p = !1,
                  I = e;
                if (e === I)
                  if (typeof i == "string") {
                    if (C(i) > 180) {
                      let P = {
                        instancePath: t + "/brokerAssetId",
                        schemaPath: "#/properties/brokerAssetId/anyOf/0/maxLength",
                        keyword: "maxLength",
                        params: { limit: 180 },
                      };
                      (r === null ? (r = [P]) : r.push(P), e++);
                    } else if (C(i) < 1) {
                      let P = {
                        instancePath: t + "/brokerAssetId",
                        schemaPath: "#/properties/brokerAssetId/anyOf/0/minLength",
                        keyword: "minLength",
                        params: { limit: 1 },
                      };
                      (r === null ? (r = [P]) : r.push(P), e++);
                    }
                  } else {
                    let P = {
                      instancePath: t + "/brokerAssetId",
                      schemaPath: "#/properties/brokerAssetId/anyOf/0/type",
                      keyword: "type",
                      params: { type: "string" },
                    };
                    (r === null ? (r = [P]) : r.push(P), e++);
                  }
                var h = I === e;
                p = p || h;
                let D = e;
                if (i !== null) {
                  let P = {
                    instancePath: t + "/brokerAssetId",
                    schemaPath: "#/properties/brokerAssetId/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (r === null ? (r = [P]) : r.push(P), e++);
                }
                var h = D === e;
                if (((p = p || h), p)) ((e = g), r !== null && (g ? (r.length = g) : (r = null)));
                else {
                  let P = {
                    instancePath: t + "/brokerAssetId",
                    schemaPath: "#/properties/brokerAssetId/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (r === null ? (r = [P]) : r.push(P), e++, (L.errors = r), !1);
                }
                var n = v === e;
              } else var n = !0;
              if (n) {
                if (s.instrument !== void 0) {
                  let i = e;
                  W(s.instrument, {
                    instancePath: t + "/instrument",
                    parentData: s,
                    parentDataProperty: "instrument",
                    rootData: o,
                    dynamicAnchors: f,
                  }) || ((r = r === null ? W.errors : r.concat(W.errors)), (e = r.length));
                  var n = i === e;
                } else var n = !0;
                if (n) {
                  if (s.name !== void 0) {
                    let i = s.name,
                      v = e,
                      g = e,
                      p = !1,
                      I = e;
                    if (e === I)
                      if (typeof i == "string") {
                        if (C(i) > 180) {
                          let P = {
                            instancePath: t + "/name",
                            schemaPath: "#/properties/name/anyOf/0/maxLength",
                            keyword: "maxLength",
                            params: { limit: 180 },
                          };
                          (r === null ? (r = [P]) : r.push(P), e++);
                        } else if (C(i) < 1) {
                          let P = {
                            instancePath: t + "/name",
                            schemaPath: "#/properties/name/anyOf/0/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          };
                          (r === null ? (r = [P]) : r.push(P), e++);
                        }
                      } else {
                        let P = {
                          instancePath: t + "/name",
                          schemaPath: "#/properties/name/anyOf/0/type",
                          keyword: "type",
                          params: { type: "string" },
                        };
                        (r === null ? (r = [P]) : r.push(P), e++);
                      }
                    var w = I === e;
                    p = p || w;
                    let D = e;
                    if (i !== null) {
                      let P = {
                        instancePath: t + "/name",
                        schemaPath: "#/properties/name/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (r === null ? (r = [P]) : r.push(P), e++);
                    }
                    var w = D === e;
                    if (((p = p || w), p))
                      ((e = g), r !== null && (g ? (r.length = g) : (r = null)));
                    else {
                      let P = {
                        instancePath: t + "/name",
                        schemaPath: "#/properties/name/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (r === null ? (r = [P]) : r.push(P), e++, (L.errors = r), !1);
                    }
                    var n = v === e;
                  } else var n = !0;
                  if (n) {
                    if (s.assetType !== void 0) {
                      let i = s.assetType,
                        v = e;
                      if (!(i === "stock" || i === "etf" || i === "unsupported"))
                        return (
                          (L.errors = [
                            {
                              instancePath: t + "/assetType",
                              schemaPath: "#/properties/assetType/enum",
                              keyword: "enum",
                              params: { allowedValues: me.properties.assetType.enum },
                            },
                          ]),
                          !1
                        );
                      var n = v === e;
                    } else var n = !0;
                    if (n) {
                      if (s.quantity !== void 0) {
                        let i = e;
                        G(s.quantity, {
                          instancePath: t + "/quantity",
                          parentData: s,
                          parentDataProperty: "quantity",
                          rootData: o,
                          dynamicAnchors: f,
                        }) || ((r = r === null ? G.errors : r.concat(G.errors)), (e = r.length));
                        var n = i === e;
                      } else var n = !0;
                      if (n) {
                        if (s.unitCost !== void 0) {
                          let i = s.unitCost,
                            v = e,
                            g = e,
                            p = !1,
                            I = e;
                          S(i, {
                            instancePath: t + "/unitCost",
                            parentData: s,
                            parentDataProperty: "unitCost",
                            rootData: o,
                            dynamicAnchors: f,
                          }) || ((r = r === null ? S.errors : r.concat(S.errors)), (e = r.length));
                          var y = I === e;
                          p = p || y;
                          let D = e;
                          if (i !== null) {
                            let P = {
                              instancePath: t + "/unitCost",
                              schemaPath: "#/properties/unitCost/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            (r === null ? (r = [P]) : r.push(P), e++);
                          }
                          var y = D === e;
                          if (((p = p || y), p))
                            ((e = g), r !== null && (g ? (r.length = g) : (r = null)));
                          else {
                            let P = {
                              instancePath: t + "/unitCost",
                              schemaPath: "#/properties/unitCost/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            return (r === null ? (r = [P]) : r.push(P), e++, (L.errors = r), !1);
                          }
                          var n = v === e;
                        } else var n = !0;
                        if (n) {
                          if (s.bookCost !== void 0) {
                            let i = s.bookCost,
                              v = e,
                              g = e,
                              p = !1,
                              I = e;
                            S(i, {
                              instancePath: t + "/bookCost",
                              parentData: s,
                              parentDataProperty: "bookCost",
                              rootData: o,
                              dynamicAnchors: f,
                            }) ||
                              ((r = r === null ? S.errors : r.concat(S.errors)), (e = r.length));
                            var u = I === e;
                            p = p || u;
                            let D = e;
                            if (i !== null) {
                              let P = {
                                instancePath: t + "/bookCost",
                                schemaPath: "#/properties/bookCost/anyOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                              };
                              (r === null ? (r = [P]) : r.push(P), e++);
                            }
                            var u = D === e;
                            if (((p = p || u), p))
                              ((e = g), r !== null && (g ? (r.length = g) : (r = null)));
                            else {
                              let P = {
                                instancePath: t + "/bookCost",
                                schemaPath: "#/properties/bookCost/anyOf",
                                keyword: "anyOf",
                                params: {},
                              };
                              return (r === null ? (r = [P]) : r.push(P), e++, (L.errors = r), !1);
                            }
                            var n = v === e;
                          } else var n = !0;
                          if (n) {
                            if (s.bookCostCad !== void 0) {
                              let i = s.bookCostCad,
                                v = e,
                                g = e,
                                p = !1,
                                I = e;
                              S(i, {
                                instancePath: t + "/bookCostCad",
                                parentData: s,
                                parentDataProperty: "bookCostCad",
                                rootData: o,
                                dynamicAnchors: f,
                              }) ||
                                ((r = r === null ? S.errors : r.concat(S.errors)), (e = r.length));
                              var k = I === e;
                              p = p || k;
                              let D = e;
                              if (i !== null) {
                                let P = {
                                  instancePath: t + "/bookCostCad",
                                  schemaPath: "#/properties/bookCostCad/anyOf/1/type",
                                  keyword: "type",
                                  params: { type: "null" },
                                };
                                (r === null ? (r = [P]) : r.push(P), e++);
                              }
                              var k = D === e;
                              if (((p = p || k), p))
                                ((e = g), r !== null && (g ? (r.length = g) : (r = null)));
                              else {
                                let P = {
                                  instancePath: t + "/bookCostCad",
                                  schemaPath: "#/properties/bookCostCad/anyOf",
                                  keyword: "anyOf",
                                  params: {},
                                };
                                return (
                                  r === null ? (r = [P]) : r.push(P),
                                  e++,
                                  (L.errors = r),
                                  !1
                                );
                              }
                              var n = v === e;
                            } else var n = !0;
                            if (n) {
                              if (s.provenance !== void 0) {
                                let i = s.provenance,
                                  v = e;
                                if (e === v)
                                  if (i && typeof i == "object" && !Array.isArray(i)) {
                                    let p;
                                    if (
                                      (i.instrument === void 0 && (p = "instrument")) ||
                                      (i.quantity === void 0 && (p = "quantity")) ||
                                      (i.unitCost === void 0 && (p = "unitCost")) ||
                                      (i.bookCost === void 0 && (p = "bookCost")) ||
                                      (i.bookCostCad === void 0 && (p = "bookCostCad"))
                                    )
                                      return (
                                        (L.errors = [
                                          {
                                            instancePath: t + "/provenance",
                                            schemaPath: "#/properties/provenance/required",
                                            keyword: "required",
                                            params: { missingProperty: p },
                                          },
                                        ]),
                                        !1
                                      );
                                    {
                                      let I = e;
                                      for (let D in i)
                                        if (!(
                                          D === "instrument" ||
                                          D === "quantity" ||
                                          D === "unitCost" ||
                                          D === "bookCost" ||
                                          D === "bookCostCad"
                                        )) {
                                          return (
                                            (L.errors = [
                                              {
                                                instancePath: t + "/provenance",
                                                schemaPath:
                                                  "#/properties/provenance/additionalProperties",
                                                keyword: "additionalProperties",
                                                params: { additionalProperty: D },
                                              },
                                            ]),
                                            !1
                                          );
                                          break;
                                        }
                                      if (I === e) {
                                        if (i.instrument !== void 0) {
                                          let D = e;
                                          $(i.instrument, {
                                            instancePath: t + "/provenance/instrument",
                                            parentData: i,
                                            parentDataProperty: "instrument",
                                            rootData: o,
                                            dynamicAnchors: f,
                                          }) ||
                                            ((r = r === null ? $.errors : r.concat($.errors)),
                                            (e = r.length));
                                          var d = D === e;
                                        } else var d = !0;
                                        if (d) {
                                          if (i.quantity !== void 0) {
                                            let D = e;
                                            $(i.quantity, {
                                              instancePath: t + "/provenance/quantity",
                                              parentData: i,
                                              parentDataProperty: "quantity",
                                              rootData: o,
                                              dynamicAnchors: f,
                                            }) ||
                                              ((r = r === null ? $.errors : r.concat($.errors)),
                                              (e = r.length));
                                            var d = D === e;
                                          } else var d = !0;
                                          if (d) {
                                            if (i.unitCost !== void 0) {
                                              let D = e;
                                              $(i.unitCost, {
                                                instancePath: t + "/provenance/unitCost",
                                                parentData: i,
                                                parentDataProperty: "unitCost",
                                                rootData: o,
                                                dynamicAnchors: f,
                                              }) ||
                                                ((r = r === null ? $.errors : r.concat($.errors)),
                                                (e = r.length));
                                              var d = D === e;
                                            } else var d = !0;
                                            if (d) {
                                              if (i.bookCost !== void 0) {
                                                let D = e;
                                                $(i.bookCost, {
                                                  instancePath: t + "/provenance/bookCost",
                                                  parentData: i,
                                                  parentDataProperty: "bookCost",
                                                  rootData: o,
                                                  dynamicAnchors: f,
                                                }) ||
                                                  ((r = r === null ? $.errors : r.concat($.errors)),
                                                  (e = r.length));
                                                var d = D === e;
                                              } else var d = !0;
                                              if (d)
                                                if (i.bookCostCad !== void 0) {
                                                  let D = e;
                                                  $(i.bookCostCad, {
                                                    instancePath: t + "/provenance/bookCostCad",
                                                    parentData: i,
                                                    parentDataProperty: "bookCostCad",
                                                    rootData: o,
                                                    dynamicAnchors: f,
                                                  }) ||
                                                    ((r =
                                                      r === null ? $.errors : r.concat($.errors)),
                                                    (e = r.length));
                                                  var d = D === e;
                                                } else var d = !0;
                                            }
                                          }
                                        }
                                      }
                                    }
                                  } else
                                    return (
                                      (L.errors = [
                                        {
                                          instancePath: t + "/provenance",
                                          schemaPath: "#/properties/provenance/type",
                                          keyword: "type",
                                          params: { type: "object" },
                                        },
                                      ]),
                                      !1
                                    );
                                var n = v === e;
                              } else var n = !0;
                              if (n)
                                if (s.reportedValues !== void 0) {
                                  let i = s.reportedValues,
                                    v = e,
                                    g = e,
                                    p = !1,
                                    I = e;
                                  K(i, {
                                    instancePath: t + "/reportedValues",
                                    parentData: s,
                                    parentDataProperty: "reportedValues",
                                    rootData: o,
                                    dynamicAnchors: f,
                                  }) ||
                                    ((r = r === null ? K.errors : r.concat(K.errors)),
                                    (e = r.length));
                                  var b = I === e;
                                  p = p || b;
                                  let D = e;
                                  if (i !== null) {
                                    let P = {
                                      instancePath: t + "/reportedValues",
                                      schemaPath: "#/properties/reportedValues/anyOf/1/type",
                                      keyword: "type",
                                      params: { type: "null" },
                                    };
                                    (r === null ? (r = [P]) : r.push(P), e++);
                                  }
                                  var b = D === e;
                                  if (((p = p || b), p))
                                    ((e = g), r !== null && (g ? (r.length = g) : (r = null)));
                                  else {
                                    let P = {
                                      instancePath: t + "/reportedValues",
                                      schemaPath: "#/properties/reportedValues/anyOf",
                                      keyword: "anyOf",
                                      params: {},
                                    };
                                    return (
                                      r === null ? (r = [P]) : r.push(P),
                                      e++,
                                      (L.errors = r),
                                      !1
                                    );
                                  }
                                  var n = v === e;
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
          (L.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((L.errors = r), e === 0);
  }
  L.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function E(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = E.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let y;
        if (
          (s.accountId === void 0 && (y = "accountId")) ||
          (s.displayName === void 0 && (y = "displayName")) ||
          (s.balances === void 0 && (y = "balances")) ||
          (s.positions === void 0 && (y = "positions"))
        )
          return (
            (E.errors = [
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
          let u = e;
          for (let k in s)
            if (!(
              k === "accountId" ||
              k === "displayName" ||
              k === "balances" ||
              k === "positions"
            )) {
              return (
                (E.errors = [
                  {
                    instancePath: t,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: k },
                  },
                ]),
                !1
              );
              break;
            }
          if (u === e) {
            if (s.accountId !== void 0) {
              let k = e;
              q(s.accountId, {
                instancePath: t + "/accountId",
                parentData: s,
                parentDataProperty: "accountId",
                rootData: o,
                dynamicAnchors: f,
              }) || ((r = r === null ? q.errors : r.concat(q.errors)), (e = r.length));
              var n = k === e;
            } else var n = !0;
            if (n) {
              if (s.displayName !== void 0) {
                let k = s.displayName,
                  d = e;
                if (e === d)
                  if (typeof k == "string") {
                    if (C(k) > 180)
                      return (
                        (E.errors = [
                          {
                            instancePath: t + "/displayName",
                            schemaPath: "#/properties/displayName/maxLength",
                            keyword: "maxLength",
                            params: { limit: 180 },
                          },
                        ]),
                        !1
                      );
                    if (C(k) < 1)
                      return (
                        (E.errors = [
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
                      (E.errors = [
                        {
                          instancePath: t + "/displayName",
                          schemaPath: "#/properties/displayName/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var n = d === e;
              } else var n = !0;
              if (n) {
                if (s.balances !== void 0) {
                  let k = s.balances,
                    d = e;
                  if (e === d)
                    if (Array.isArray(k)) {
                      if (k.length > 12)
                        return (
                          (E.errors = [
                            {
                              instancePath: t + "/balances",
                              schemaPath: "#/properties/balances/maxItems",
                              keyword: "maxItems",
                              params: { limit: 12 },
                            },
                          ]),
                          !1
                        );
                      if (k.length < 0)
                        return (
                          (E.errors = [
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
                        var h = !0;
                        let m = k.length;
                        for (let l = 0; l < m; l++) {
                          let i = e;
                          F(k[l], {
                            instancePath: t + "/balances/" + l,
                            parentData: k,
                            parentDataProperty: l,
                            rootData: o,
                            dynamicAnchors: f,
                          }) || ((r = r === null ? F.errors : r.concat(F.errors)), (e = r.length));
                          var h = i === e;
                          if (!h) break;
                        }
                      }
                    } else
                      return (
                        (E.errors = [
                          {
                            instancePath: t + "/balances",
                            schemaPath: "#/properties/balances/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ]),
                        !1
                      );
                  var n = d === e;
                } else var n = !0;
                if (n)
                  if (s.positions !== void 0) {
                    let k = s.positions,
                      d = e;
                    if (e === d)
                      if (Array.isArray(k)) {
                        if (k.length > 1e3)
                          return (
                            (E.errors = [
                              {
                                instancePath: t + "/positions",
                                schemaPath: "#/properties/positions/maxItems",
                                keyword: "maxItems",
                                params: { limit: 1e3 },
                              },
                            ]),
                            !1
                          );
                        if (k.length < 0)
                          return (
                            (E.errors = [
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
                          var w = !0;
                          let m = k.length;
                          for (let l = 0; l < m; l++) {
                            let i = e;
                            L(k[l], {
                              instancePath: t + "/positions/" + l,
                              parentData: k,
                              parentDataProperty: l,
                              rootData: o,
                              dynamicAnchors: f,
                            }) ||
                              ((r = r === null ? L.errors : r.concat(L.errors)), (e = r.length));
                            var w = i === e;
                            if (!w) break;
                          }
                        }
                      } else
                        return (
                          (E.errors = [
                            {
                              instancePath: t + "/positions",
                              schemaPath: "#/properties/positions/type",
                              keyword: "type",
                              params: { type: "array" },
                            },
                          ]),
                          !1
                        );
                    var n = d === e;
                  } else var n = !0;
              }
            }
          }
        }
      } else
        return (
          (E.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((E.errors = r), e === 0);
  }
  E.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function _(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = _.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let b;
        if (
          (s.kind === void 0 && (b = "kind")) ||
          (s.profile === void 0 && (b = "profile")) ||
          (s.snapshotId === void 0 && (b = "snapshotId")) ||
          (s.editKind === void 0 && (b = "editKind")) ||
          (s.reportDate === void 0 && (b = "reportDate")) ||
          (s.importSnapshot === void 0 && (b = "importSnapshot")) ||
          (s.previousSnapshot === void 0 && (b = "previousSnapshot")) ||
          (s.accounts === void 0 && (b = "accounts")) ||
          (s.excludedAssets === void 0 && (b = "excludedAssets"))
        )
          return (
            (_.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: b },
              },
            ]),
            !1
          );
        {
          let m = e;
          for (let l in s)
            if (!ye.call(ce.properties, l)) {
              return (
                (_.errors = [
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
          if (m === e) {
            if (s.kind !== void 0) {
              let l = e;
              if (s.kind !== "holdings")
                return (
                  (_.errors = [
                    {
                      instancePath: t + "/kind",
                      schemaPath: "#/properties/kind/const",
                      keyword: "const",
                      params: { allowedValue: "holdings" },
                    },
                  ]),
                  !1
                );
              var n = l === e;
            } else var n = !0;
            if (n) {
              if (s.profile !== void 0) {
                let l = e;
                if (s.profile !== "folioview.holdings-facts.v2")
                  return (
                    (_.errors = [
                      {
                        instancePath: t + "/profile",
                        schemaPath: "#/properties/profile/const",
                        keyword: "const",
                        params: { allowedValue: "folioview.holdings-facts.v2" },
                      },
                    ]),
                    !1
                  );
                var n = l === e;
              } else var n = !0;
              if (n) {
                if (s.snapshotId !== void 0) {
                  let l = e;
                  q(s.snapshotId, {
                    instancePath: t + "/snapshotId",
                    parentData: s,
                    parentDataProperty: "snapshotId",
                    rootData: o,
                    dynamicAnchors: f,
                  }) || ((r = r === null ? q.errors : r.concat(q.errors)), (e = r.length));
                  var n = l === e;
                } else var n = !0;
                if (n) {
                  if (s.editKind !== void 0) {
                    let l = s.editKind,
                      i = e;
                    if (!(l === "import" || l === "manual" || l === "edit"))
                      return (
                        (_.errors = [
                          {
                            instancePath: t + "/editKind",
                            schemaPath: "#/properties/editKind/enum",
                            keyword: "enum",
                            params: { allowedValues: ce.properties.editKind.enum },
                          },
                        ]),
                        !1
                      );
                    var n = i === e;
                  } else var n = !0;
                  if (n) {
                    if (s.reportDate !== void 0) {
                      let l = s.reportDate,
                        i = e,
                        v = e,
                        g = !1,
                        p = e;
                      N(l, {
                        instancePath: t + "/reportDate",
                        parentData: s,
                        parentDataProperty: "reportDate",
                        rootData: o,
                        dynamicAnchors: f,
                      }) || ((r = r === null ? N.errors : r.concat(N.errors)), (e = r.length));
                      var h = p === e;
                      g = g || h;
                      let I = e;
                      if (l !== null) {
                        let R = {
                          instancePath: t + "/reportDate",
                          schemaPath: "#/properties/reportDate/anyOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                        };
                        (r === null ? (r = [R]) : r.push(R), e++);
                      }
                      var h = I === e;
                      if (((g = g || h), g))
                        ((e = v), r !== null && (v ? (r.length = v) : (r = null)));
                      else {
                        let R = {
                          instancePath: t + "/reportDate",
                          schemaPath: "#/properties/reportDate/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        return (r === null ? (r = [R]) : r.push(R), e++, (_.errors = r), !1);
                      }
                      var n = i === e;
                    } else var n = !0;
                    if (n) {
                      if (s.importSnapshot !== void 0) {
                        let l = s.importSnapshot,
                          i = e,
                          v = e,
                          g = !1,
                          p = e;
                        T(l, {
                          instancePath: t + "/importSnapshot",
                          parentData: s,
                          parentDataProperty: "importSnapshot",
                          rootData: o,
                          dynamicAnchors: f,
                        }) || ((r = r === null ? T.errors : r.concat(T.errors)), (e = r.length));
                        var w = p === e;
                        g = g || w;
                        let I = e;
                        if (l !== null) {
                          let R = {
                            instancePath: t + "/importSnapshot",
                            schemaPath: "#/properties/importSnapshot/anyOf/1/type",
                            keyword: "type",
                            params: { type: "null" },
                          };
                          (r === null ? (r = [R]) : r.push(R), e++);
                        }
                        var w = I === e;
                        if (((g = g || w), g))
                          ((e = v), r !== null && (v ? (r.length = v) : (r = null)));
                        else {
                          let R = {
                            instancePath: t + "/importSnapshot",
                            schemaPath: "#/properties/importSnapshot/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          return (r === null ? (r = [R]) : r.push(R), e++, (_.errors = r), !1);
                        }
                        var n = i === e;
                      } else var n = !0;
                      if (n) {
                        if (s.previousSnapshot !== void 0) {
                          let l = s.previousSnapshot,
                            i = e,
                            v = e,
                            g = !1,
                            p = e;
                          T(l, {
                            instancePath: t + "/previousSnapshot",
                            parentData: s,
                            parentDataProperty: "previousSnapshot",
                            rootData: o,
                            dynamicAnchors: f,
                          }) || ((r = r === null ? T.errors : r.concat(T.errors)), (e = r.length));
                          var y = p === e;
                          g = g || y;
                          let I = e;
                          if (l !== null) {
                            let R = {
                              instancePath: t + "/previousSnapshot",
                              schemaPath: "#/properties/previousSnapshot/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            (r === null ? (r = [R]) : r.push(R), e++);
                          }
                          var y = I === e;
                          if (((g = g || y), g))
                            ((e = v), r !== null && (v ? (r.length = v) : (r = null)));
                          else {
                            let R = {
                              instancePath: t + "/previousSnapshot",
                              schemaPath: "#/properties/previousSnapshot/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            return (r === null ? (r = [R]) : r.push(R), e++, (_.errors = r), !1);
                          }
                          var n = i === e;
                        } else var n = !0;
                        if (n) {
                          if (s.accounts !== void 0) {
                            let l = s.accounts,
                              i = e;
                            if (e === i)
                              if (Array.isArray(l)) {
                                if (l.length > 20)
                                  return (
                                    (_.errors = [
                                      {
                                        instancePath: t + "/accounts",
                                        schemaPath: "#/properties/accounts/maxItems",
                                        keyword: "maxItems",
                                        params: { limit: 20 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (l.length < 0)
                                  return (
                                    (_.errors = [
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
                                  var u = !0;
                                  let g = l.length;
                                  for (let p = 0; p < g; p++) {
                                    let I = e;
                                    E(l[p], {
                                      instancePath: t + "/accounts/" + p,
                                      parentData: l,
                                      parentDataProperty: p,
                                      rootData: o,
                                      dynamicAnchors: f,
                                    }) ||
                                      ((r = r === null ? E.errors : r.concat(E.errors)),
                                      (e = r.length));
                                    var u = I === e;
                                    if (!u) break;
                                  }
                                }
                              } else
                                return (
                                  (_.errors = [
                                    {
                                      instancePath: t + "/accounts",
                                      schemaPath: "#/properties/accounts/type",
                                      keyword: "type",
                                      params: { type: "array" },
                                    },
                                  ]),
                                  !1
                                );
                            var n = i === e;
                          } else var n = !0;
                          if (n)
                            if (s.excludedAssets !== void 0) {
                              let l = s.excludedAssets,
                                i = e;
                              if (e === i)
                                if (Array.isArray(l)) {
                                  if (l.length > 1e3)
                                    return (
                                      (_.errors = [
                                        {
                                          instancePath: t + "/excludedAssets",
                                          schemaPath: "#/properties/excludedAssets/maxItems",
                                          keyword: "maxItems",
                                          params: { limit: 1e3 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (l.length < 0)
                                    return (
                                      (_.errors = [
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
                                    var k = !0;
                                    let g = l.length;
                                    for (let p = 0; p < g; p++) {
                                      let I = l[p],
                                        D = e;
                                      if (e === D)
                                        if (I && typeof I == "object" && !Array.isArray(I)) {
                                          let P;
                                          if (
                                            (I.brokerAssetId === void 0 && (P = "brokerAssetId")) ||
                                            (I.reason === void 0 && (P = "reason"))
                                          )
                                            return (
                                              (_.errors = [
                                                {
                                                  instancePath: t + "/excludedAssets/" + p,
                                                  schemaPath:
                                                    "#/properties/excludedAssets/items/required",
                                                  keyword: "required",
                                                  params: { missingProperty: P },
                                                },
                                              ]),
                                              !1
                                            );
                                          {
                                            let _e = e;
                                            for (let B in I)
                                              if (!(B === "brokerAssetId" || B === "reason")) {
                                                return (
                                                  (_.errors = [
                                                    {
                                                      instancePath: t + "/excludedAssets/" + p,
                                                      schemaPath:
                                                        "#/properties/excludedAssets/items/additionalProperties",
                                                      keyword: "additionalProperties",
                                                      params: { additionalProperty: B },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                                break;
                                              }
                                            if (_e === e) {
                                              if (I.brokerAssetId !== void 0) {
                                                let B = I.brokerAssetId,
                                                  X = e;
                                                if (e === X)
                                                  if (typeof B == "string") {
                                                    if (C(B) > 180)
                                                      return (
                                                        (_.errors = [
                                                          {
                                                            instancePath:
                                                              t +
                                                              "/excludedAssets/" +
                                                              p +
                                                              "/brokerAssetId",
                                                            schemaPath:
                                                              "#/properties/excludedAssets/items/properties/brokerAssetId/maxLength",
                                                            keyword: "maxLength",
                                                            params: { limit: 180 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (C(B) < 1)
                                                      return (
                                                        (_.errors = [
                                                          {
                                                            instancePath:
                                                              t +
                                                              "/excludedAssets/" +
                                                              p +
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
                                                      (_.errors = [
                                                        {
                                                          instancePath:
                                                            t +
                                                            "/excludedAssets/" +
                                                            p +
                                                            "/brokerAssetId",
                                                          schemaPath:
                                                            "#/properties/excludedAssets/items/properties/brokerAssetId/type",
                                                          keyword: "type",
                                                          params: { type: "string" },
                                                        },
                                                      ]),
                                                      !1
                                                    );
                                                var d = X === e;
                                              } else var d = !0;
                                              if (d)
                                                if (I.reason !== void 0) {
                                                  let B = I.reason,
                                                    X = e;
                                                  if (e === X)
                                                    if (typeof B == "string") {
                                                      if (C(B) > 64)
                                                        return (
                                                          (_.errors = [
                                                            {
                                                              instancePath:
                                                                t +
                                                                "/excludedAssets/" +
                                                                p +
                                                                "/reason",
                                                              schemaPath:
                                                                "#/properties/excludedAssets/items/properties/reason/maxLength",
                                                              keyword: "maxLength",
                                                              params: { limit: 64 },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                      if (C(B) < 1)
                                                        return (
                                                          (_.errors = [
                                                            {
                                                              instancePath:
                                                                t +
                                                                "/excludedAssets/" +
                                                                p +
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
                                                        (_.errors = [
                                                          {
                                                            instancePath:
                                                              t +
                                                              "/excludedAssets/" +
                                                              p +
                                                              "/reason",
                                                            schemaPath:
                                                              "#/properties/excludedAssets/items/properties/reason/type",
                                                            keyword: "type",
                                                            params: { type: "string" },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                  var d = X === e;
                                                } else var d = !0;
                                            }
                                          }
                                        } else
                                          return (
                                            (_.errors = [
                                              {
                                                instancePath: t + "/excludedAssets/" + p,
                                                schemaPath:
                                                  "#/properties/excludedAssets/items/type",
                                                keyword: "type",
                                                params: { type: "object" },
                                              },
                                            ]),
                                            !1
                                          );
                                      var k = D === e;
                                      if (!k) break;
                                    }
                                  }
                                } else
                                  return (
                                    (_.errors = [
                                      {
                                        instancePath: t + "/excludedAssets",
                                        schemaPath: "#/properties/excludedAssets/type",
                                        keyword: "type",
                                        params: { type: "array" },
                                      },
                                    ]),
                                    !1
                                  );
                              var n = i === e;
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
          (_.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((_.errors = r), e === 0);
  }
  _.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function z(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = z.evaluated;
    if ((a.dynamicProps && (a.props = void 0), a.dynamicItems && (a.items = void 0), e === 0))
      if (s && typeof s == "object" && !Array.isArray(s)) {
        let w;
        if (
          (s.state === void 0 && (w = "state")) ||
          (s.coverage === void 0 && (w = "coverage")) ||
          (s.sourceAsOf === void 0 && (w = "sourceAsOf")) ||
          (s.fetchedAt === void 0 && (w = "fetchedAt")) ||
          (s.freshness === void 0 && (w = "freshness")) ||
          (s.data === void 0 && (w = "data"))
        )
          return (
            (z.errors = [
              {
                instancePath: t,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let y = e;
          for (let u in s)
            if (!(
              u === "state" ||
              u === "coverage" ||
              u === "sourceAsOf" ||
              u === "fetchedAt" ||
              u === "freshness" ||
              u === "data"
            )) {
              return (
                (z.errors = [
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
          if (y === e) {
            if (s.state !== void 0) {
              let u = s.state,
                k = e;
              if (!(u === "ready" || u === "empty"))
                return (
                  (z.errors = [
                    {
                      instancePath: t + "/state",
                      schemaPath: "#/properties/state/enum",
                      keyword: "enum",
                      params: { allowedValues: de.properties.state.enum },
                    },
                  ]),
                  !1
                );
              var n = k === e;
            } else var n = !0;
            if (n) {
              if (s.coverage !== void 0) {
                let u = e;
                j(s.coverage, {
                  instancePath: t + "/coverage",
                  parentData: s,
                  parentDataProperty: "coverage",
                  rootData: o,
                  dynamicAnchors: f,
                }) || ((r = r === null ? j.errors : r.concat(j.errors)), (e = r.length));
                var n = u === e;
              } else var n = !0;
              if (n) {
                if (s.sourceAsOf !== void 0) {
                  let u = s.sourceAsOf,
                    k = e,
                    d = e,
                    b = !1,
                    m = e;
                  O(u, {
                    instancePath: t + "/sourceAsOf",
                    parentData: s,
                    parentDataProperty: "sourceAsOf",
                    rootData: o,
                    dynamicAnchors: f,
                  }) || ((r = r === null ? O.errors : r.concat(O.errors)), (e = r.length));
                  var h = m === e;
                  b = b || h;
                  let l = e;
                  if (u !== null) {
                    let v = {
                      instancePath: t + "/sourceAsOf",
                      schemaPath: "#/properties/sourceAsOf/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (r === null ? (r = [v]) : r.push(v), e++);
                  }
                  var h = l === e;
                  if (((b = b || h), b)) ((e = d), r !== null && (d ? (r.length = d) : (r = null)));
                  else {
                    let v = {
                      instancePath: t + "/sourceAsOf",
                      schemaPath: "#/properties/sourceAsOf/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (r === null ? (r = [v]) : r.push(v), e++, (z.errors = r), !1);
                  }
                  var n = k === e;
                } else var n = !0;
                if (n) {
                  if (s.fetchedAt !== void 0) {
                    let u = e;
                    O(s.fetchedAt, {
                      instancePath: t + "/fetchedAt",
                      parentData: s,
                      parentDataProperty: "fetchedAt",
                      rootData: o,
                      dynamicAnchors: f,
                    }) || ((r = r === null ? O.errors : r.concat(O.errors)), (e = r.length));
                    var n = u === e;
                  } else var n = !0;
                  if (n) {
                    if (s.freshness !== void 0) {
                      let u = s.freshness,
                        k = e;
                      if (!(u === "fresh" || u === "stale" || u === "unknown"))
                        return (
                          (z.errors = [
                            {
                              instancePath: t + "/freshness",
                              schemaPath: "#/properties/freshness/enum",
                              keyword: "enum",
                              params: { allowedValues: de.properties.freshness.enum },
                            },
                          ]),
                          !1
                        );
                      var n = k === e;
                    } else var n = !0;
                    if (n)
                      if (s.data !== void 0) {
                        let u = e;
                        _(s.data, {
                          instancePath: t + "/data",
                          parentData: s,
                          parentDataProperty: "data",
                          rootData: o,
                          dynamicAnchors: f,
                        }) || ((r = r === null ? _.errors : r.concat(_.errors)), (e = r.length));
                        var n = u === e;
                      } else var n = !0;
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (z.errors = [
            { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((z.errors = r), e === 0);
  }
  z.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ee(
    s,
    {
      instancePath: t = "",
      parentData: c,
      parentDataProperty: A,
      rootData: o = s,
      dynamicAnchors: f = {},
    } = {},
  ) {
    let r = null,
      e = 0,
      a = ee.evaluated;
    return (
      a.dynamicProps && (a.props = void 0),
      a.dynamicItems && (a.items = void 0),
      z(s, {
        instancePath: t,
        parentData: c,
        parentDataProperty: A,
        rootData: o,
        dynamicAnchors: f,
      }) || ((r = r === null ? z.errors : r.concat(z.errors)), (e = r.length)),
      (ee.errors = r),
      e === 0
    );
  }
  ee.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
});
var Ie = je(ve(), 1);
import {
  canonical as ne,
  same as se,
  exact as Ye,
  deny as Qe,
  parsed as Xe,
  inspect as be,
  context as er,
  privatePayload as rr,
  jose as oe,
  JWE_HEADER as Ae,
  CONTRACT as we,
  PROFILE as te,
  sign as sr,
  digest as tr,
} from "../../dist/core.mjs";
import { canonical as We, deny as Pe, utc as Ge } from "../../dist/core.mjs";
var x = (s) => {
    s || Pe("invalid_valuation");
  },
  re = (s) => x(new Set(s).size === s.length),
  Q = (s) => (
    Ge(s),
    x(s.slice(0, 4) !== "0000"),
    s.slice(0, 19) + "." + (s.slice(19, -1).replace(/^\./, "") || "").padEnd(6, "0")
  );
function Je(s) {
  (x(/^\d{4}-\d{2}-\d{2}$/.test(s)), Q(s + "T00:00:00Z"));
}
function ke(s) {
  if (!(!s || typeof s != "object"))
    for (let [t, c] of Object.entries(s))
      c !== null && ["fetchedAt", "sourceAsOf", "recordedAt", "lastEditedAt"].includes(t)
        ? Q(c)
        : c !== null && ["sourceDate", "reportDate"].includes(t)
          ? Je(c)
          : typeof c == "object" && ke(c);
}
function ge(s, t, c = 524288) {
  return (We(t).length > c && Pe("payload_too_large"), x(s(t)), ke(t), structuredClone(t));
}
var nr = "folioview.holdings-facts.v2";
function ar(s, { snapshotId: t = null, revision: c = null } = {}) {
  let A = ge(Ie.default.HoldingsFactsContent, s, 196608),
    o = A.data;
  (c !== null && x(Number.isSafeInteger(c) && c >= 1),
    t !== null && x(o.snapshotId === t),
    re(o.accounts.map((f) => f.accountId)),
    x(o.accounts.reduce((f, r) => f + r.positions.length, 0) <= 1e3),
    x(A.sourceAsOf === null || Q(A.sourceAsOf) <= Q(A.fetchedAt)),
    x(o.reportDate === null || o.reportDate <= A.fetchedAt.slice(0, 10)),
    c !== null &&
      (o.previousSnapshot !== null &&
        x(o.previousSnapshot.sourceRevision < c && o.previousSnapshot.snapshotId !== o.snapshotId),
      o.importSnapshot !== null &&
        x(
          o.importSnapshot.sourceRevision <= c &&
            (o.importSnapshot.sourceRevision === c) ==
              (o.importSnapshot.snapshotId === o.snapshotId),
        )),
    o.editKind === "import" &&
      x(
        o.importSnapshot !== null &&
          (c === null || se(o.importSnapshot, { snapshotId: o.snapshotId, sourceRevision: c })),
      ),
    o.editKind === "manual" && x(o.importSnapshot === null),
    o.editKind === "edit" && x(o.previousSnapshot !== null));
  for (let f of o.accounts) {
    (re(f.balances.map((r) => r.currency)), re(f.positions.map((r) => r.assetId)));
    for (let r of f.positions) {
      x(o.importSnapshot !== null || r.reportedValues === null);
      for (let e of ["unitCost", "bookCost", "bookCostCad"])
        x(r[e] === null || r[e].currency === (e === "bookCostCad" ? "CAD" : r.instrument.currency));
      for (let [e, a] of Object.entries(r.provenance)) {
        let { recordedAt: n, lastEditedAt: h, sourceDate: w, origin: y } = a;
        (x(n === null || Q(n) <= Q(A.fetchedAt)),
          x(h === null || (n !== null && Q(h) <= Q(n))),
          x(w === null || w <= A.fetchedAt.slice(0, 10)),
          y === "manual" && x(n !== null && h === n),
          y === "unknown" && x(n === null && h === null && w === null),
          ["unitCost", "bookCost", "bookCostCad"].includes(e) &&
            r[e] !== null &&
            x(y !== "unknown"));
      }
    }
  }
  return A;
}
function ie(s) {
  (er(s),
    x(
      s.objectType === "holdings_snapshot" &&
        s.ref.kind === "holdings" &&
        s.ref.sourceService === "portfolio",
    ));
}
function De(s, t) {
  (ie(t),
    Ye(s, ["privateSchemaVersion", "profile", "objectId", "objectType", "revision", "payload"]),
    x(s.privateSchemaVersion === 1 && s.profile === te));
  for (let c of ["objectId", "objectType", "revision"]) x(s[c] === t[c]);
  return (
    ne(s).length > 196608 && Qe("payload_too_large"),
    ar(s.payload, { snapshotId: t.objectId, revision: t.revision })
  );
}
async function cr(s, t, c) {
  ie(c);
  let A = be(s);
  x(se(A.context, c));
  let o = await oe.generalDecrypt(s.jwe, t, {
    keyManagementAlgorithms: ["ECDH-ES+A256KW"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  x(se(o.protectedHeader, Ae) && se(Array.from(o.additionalAuthenticatedData), Array.from(ne(c))));
  let f = Xe(o.plaintext, !0);
  return f?.payload?.data?.profile === nr ? De(f, c) : rr(f, c);
}
async function mr(s, t, c, A) {
  ie(t);
  let o = {
    privateSchemaVersion: 1,
    profile: te,
    objectId: t.objectId,
    objectType: t.objectType,
    revision: t.revision,
    payload: s,
  };
  De(o, t);
  let f = new oe.GeneralEncrypt(ne(o)).setProtectedHeader(Ae).setAdditionalAuthenticatedData(ne(t));
  for (let n of t.recipients)
    f.addRecipient(await oe.importJWK(c[n.keyId], "ECDH-ES+A256KW")).setUnprotectedHeader({
      kid: n.keyId,
    });
  let r = await f.encrypt(),
    e = await sr(
      {
        contractVersion: we,
        profile: te,
        artifactType: "persistent_content_publication",
        context: t,
        ciphertextDigest: await tr(r),
      },
      A,
      t.rootKeyId,
      "fv-control+jws",
    ),
    a = { contractVersion: we, profile: te, proof: e, jwe: r };
  return (be(a), a);
}
export {
  nr as HOLDINGS_FACTS_PROFILE,
  ar as holdingsFacts,
  De as holdingsPrivate,
  cr as openHoldings,
  mr as sealHoldingsFacts,
};
