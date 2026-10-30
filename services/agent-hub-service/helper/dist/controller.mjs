var Me = Object.create;
var Ae = Object.defineProperty;
var Ue = Object.getOwnPropertyDescriptor;
var We = Object.getOwnPropertyNames;
var He = Object.getPrototypeOf,
  Ge = Object.prototype.hasOwnProperty;
var ae = (t, e) => () => {
  try {
    return (e || t((e = { exports: {} }).exports, e), e.exports);
  } catch (a) {
    throw ((e = 0), a);
  }
};
var Xe = (t, e, a, n) => {
  if ((e && typeof e == "object") || typeof e == "function")
    for (let f of We(e))
      !Ge.call(t, f) &&
        f !== a &&
        Ae(t, f, { get: () => e[f], enumerable: !(n = Ue(e, f)) || n.enumerable });
  return t;
};
var Ye = (t, e, a) => (
  (a = t != null ? Me(He(t)) : {}),
  Xe(e || !t || !t.__esModule ? Ae(a, "default", { value: t, enumerable: !0 }) : a, t)
);
var Ee = ae((Ie) => {
  "use strict";
  Object.defineProperty(Ie, "__esModule", { value: !0 });
  function Oe(t) {
    let e = t.length,
      a = 0,
      n = 0,
      f;
    for (; n < e;)
      (a++,
        (f = t.charCodeAt(n++)),
        f >= 55296 && f <= 56319 && n < e && ((f = t.charCodeAt(n)), (f & 64512) === 56320 && n++));
    return a;
  }
  Ie.default = Oe;
  Oe.code = 'require("ajv/dist/runtime/ucs2length").default';
});
var ze = ae((dr, je) => {
  "use strict";
  je.exports = function t(e, a) {
    if (e === a) return !0;
    if (e && a && typeof e == "object" && typeof a == "object") {
      if (e.constructor !== a.constructor) return !1;
      var n, f, u;
      if (Array.isArray(e)) {
        if (((n = e.length), n != a.length)) return !1;
        for (f = n; f-- !== 0;) if (!t(e[f], a[f])) return !1;
        return !0;
      }
      if (e.constructor === RegExp) return e.source === a.source && e.flags === a.flags;
      if (e.valueOf !== Object.prototype.valueOf) return e.valueOf() === a.valueOf();
      if (e.toString !== Object.prototype.toString) return e.toString() === a.toString();
      if (((u = Object.keys(e)), (n = u.length), n !== Object.keys(a).length)) return !1;
      for (f = n; f-- !== 0;) if (!Object.prototype.hasOwnProperty.call(a, u[f])) return !1;
      for (f = n; f-- !== 0;) {
        var i = u[f];
        if (!t(e[i], a[i])) return !1;
      }
      return !0;
    }
    return e !== e && a !== a;
  };
});
var Re = ae((Pe) => {
  "use strict";
  Object.defineProperty(Pe, "__esModule", { value: !0 });
  var $e = ze();
  $e.code = 'require("ajv/dist/runtime/equal").default';
  Pe.default = $e;
});
var Ne = ae((fe) => {
  "use strict";
  fe.Carrier = pe;
  var g = Ee().default,
    G = new RegExp("^[A-Za-z0-9_-]+$", "u");
  function q(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = q.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let d;
        if (
          (t.protected === void 0 && (d = "protected")) ||
          (t.payload === void 0 && (d = "payload")) ||
          (t.signature === void 0 && (d = "signature"))
        )
          return (
            (q.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: d },
              },
            ]),
            !1
          );
        {
          let w = r;
          for (let l in t)
            if (!(l === "protected" || l === "payload" || l === "signature")) {
              return (
                (q.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === r) {
            if (t.protected !== void 0) {
              let l = t.protected,
                c = r;
              if (r === c)
                if (typeof l == "string") {
                  if (g(l) > 1024)
                    return (
                      (q.errors = [
                        {
                          instancePath: e + "/protected",
                          schemaPath: "#/properties/protected/maxLength",
                          keyword: "maxLength",
                          params: { limit: 1024 },
                        },
                      ]),
                      !1
                    );
                  if (g(l) < 1)
                    return (
                      (q.errors = [
                        {
                          instancePath: e + "/protected",
                          schemaPath: "#/properties/protected/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!G.test(l))
                    return (
                      (q.errors = [
                        {
                          instancePath: e + "/protected",
                          schemaPath: "#/properties/protected/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9_-]+$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (q.errors = [
                      {
                        instancePath: e + "/protected",
                        schemaPath: "#/properties/protected/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = c === r;
            } else var s = !0;
            if (s) {
              if (t.payload !== void 0) {
                let l = t.payload,
                  c = r;
                if (r === c)
                  if (typeof l == "string") {
                    if (g(l) > 699051)
                      return (
                        (q.errors = [
                          {
                            instancePath: e + "/payload",
                            schemaPath: "#/properties/payload/maxLength",
                            keyword: "maxLength",
                            params: { limit: 699051 },
                          },
                        ]),
                        !1
                      );
                    if (g(l) < 1)
                      return (
                        (q.errors = [
                          {
                            instancePath: e + "/payload",
                            schemaPath: "#/properties/payload/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    if (!G.test(l))
                      return (
                        (q.errors = [
                          {
                            instancePath: e + "/payload",
                            schemaPath: "#/properties/payload/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9_-]+$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (q.errors = [
                        {
                          instancePath: e + "/payload",
                          schemaPath: "#/properties/payload/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = c === r;
              } else var s = !0;
              if (s)
                if (t.signature !== void 0) {
                  let l = t.signature,
                    c = r;
                  if (r === c)
                    if (typeof l == "string") {
                      if (g(l) > 86)
                        return (
                          (q.errors = [
                            {
                              instancePath: e + "/signature",
                              schemaPath: "#/properties/signature/maxLength",
                              keyword: "maxLength",
                              params: { limit: 86 },
                            },
                          ]),
                          !1
                        );
                      if (g(l) < 86)
                        return (
                          (q.errors = [
                            {
                              instancePath: e + "/signature",
                              schemaPath: "#/properties/signature/minLength",
                              keyword: "minLength",
                              params: { limit: 86 },
                            },
                          ]),
                          !1
                        );
                      if (!G.test(l))
                        return (
                          (q.errors = [
                            {
                              instancePath: e + "/signature",
                              schemaPath: "#/properties/signature/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9_-]+$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (q.errors = [
                          {
                            instancePath: e + "/signature",
                            schemaPath: "#/properties/signature/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = c === r;
                } else var s = !0;
            }
          }
        }
      } else
        return (
          (q.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((q.errors = i), r === 0);
  }
  q.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function H(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = H.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let d;
        if (
          (t.contractVersion === void 0 && (d = "contractVersion")) ||
          (t.signedObject === void 0 && (d = "signedObject"))
        )
          return (
            (H.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: d },
              },
            ]),
            !1
          );
        {
          let w = r;
          for (let l in t)
            if (!(l === "contractVersion" || l === "signedObject")) {
              return (
                (H.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === r) {
            if (t.contractVersion !== void 0) {
              let l = r;
              if (t.contractVersion !== "folioview.agent-workspace.v2.0")
                return (
                  (H.errors = [
                    {
                      instancePath: e + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.agent-workspace.v2.0" },
                    },
                  ]),
                  !1
                );
              var s = l === r;
            } else var s = !0;
            if (s)
              if (t.signedObject !== void 0) {
                let l = r;
                q(t.signedObject, {
                  instancePath: e + "/signedObject",
                  parentData: t,
                  parentDataProperty: "signedObject",
                  rootData: f,
                  dynamicAnchors: u,
                }) || ((i = i === null ? q.errors : i.concat(q.errors)), (r = i.length));
                var s = l === r;
              } else var s = !0;
          }
        }
      } else
        return (
          (H.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((H.errors = i), r === 0);
  }
  H.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function pe(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = pe.evaluated;
    return (
      h.dynamicProps && (h.props = void 0),
      h.dynamicItems && (h.items = void 0),
      H(t, {
        instancePath: e,
        parentData: a,
        parentDataProperty: n,
        rootData: f,
        dynamicAnchors: u,
      }) || ((i = i === null ? H.errors : i.concat(H.errors)), (r = i.length)),
      (pe.errors = i),
      r === 0
    );
  }
  pe.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  fe.ObjectMessage = le;
  var _e = {
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
        checkpointDigest: {
          type: "string",
          minLength: 64,
          maxLength: 64,
          pattern: "^[a-f0-9]{64}$",
        },
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
    },
    xe = Object.prototype.hasOwnProperty,
    Se = Re().default,
    K = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "u"),
    te = new RegExp("^[A-Za-z0-9_-]{43}$", "u"),
    se = new RegExp("^[a-f0-9]{64}$", "u");
  function M(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = M.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (typeof t == "string") {
        if (g(t) > 128)
          return (
            (M.errors = [
              {
                instancePath: e,
                schemaPath: "#/maxLength",
                keyword: "maxLength",
                params: { limit: 128 },
              },
            ]),
            !1
          );
        if (g(t) < 22)
          return (
            (M.errors = [
              {
                instancePath: e,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 22 },
              },
            ]),
            !1
          );
        if (!G.test(t))
          return (
            (M.errors = [
              {
                instancePath: e,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9_-]+$" },
              },
            ]),
            !1
          );
      } else
        return (
          (M.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
          ]),
          !1
        );
    return ((M.errors = i), r === 0);
  }
  M.evaluated = { dynamicProps: !1, dynamicItems: !1 };
  var Qe = {
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
    },
    Ze = {
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
  function S(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = S.evaluated;
    (h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0));
    let s = r,
      d = !0,
      w = r;
    if (
      t &&
      typeof t == "object" &&
      !Array.isArray(t) &&
      t.kind !== void 0 &&
      t.kind !== "holdings"
    ) {
      let k = {};
      (i === null ? (i = [k]) : i.push(k), r++);
    }
    var l = w === r;
    ((r = s), i !== null && (s ? (i.length = s) : (i = null)));
    let c;
    if (l) {
      let k = r;
      if (
        t &&
        typeof t == "object" &&
        !Array.isArray(t) &&
        t.sourceService !== void 0 &&
        t.sourceService !== "portfolio"
      )
        return (
          (S.errors = [
            {
              instancePath: e + "/sourceService",
              schemaPath: "#/allOf/0/then/properties/sourceService/const",
              keyword: "const",
              params: { allowedValue: "portfolio" },
            },
          ]),
          !1
        );
      var l = k === r;
      if (((d = l), d)) {
        var _ = {};
        ((_.sourceService = !0), (_.kind = !0));
      }
      c = "then";
    } else {
      let k = r;
      if (
        t &&
        typeof t == "object" &&
        !Array.isArray(t) &&
        t.sourceService !== void 0 &&
        t.sourceService !== "user"
      )
        return (
          (S.errors = [
            {
              instancePath: e + "/sourceService",
              schemaPath: "#/allOf/0/else/properties/sourceService/const",
              keyword: "const",
              params: { allowedValue: "user" },
            },
          ]),
          !1
        );
      var l = k === r;
      ((d = l), d && _ !== !0 && ((_ = _ || {}), (_.sourceService = !0)), (c = "else"));
    }
    if (!d) {
      let k = {
        instancePath: e,
        schemaPath: "#/allOf/0/if",
        keyword: "if",
        params: { failingKeyword: c },
      };
      return (i === null ? (i = [k]) : i.push(k), r++, (S.errors = i), !1);
    }
    if (r === 0)
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let k;
        if (
          (t.kind === void 0 && (k = "kind")) ||
          (t.sourceService === void 0 && (k = "sourceService")) ||
          (t.resourceId === void 0 && (k = "resourceId")) ||
          (t.incarnation === void 0 && (k = "incarnation"))
        )
          return (
            (S.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: k },
              },
            ]),
            !1
          );
        {
          let A = r;
          for (let b in t)
            if (!(
              b === "kind" ||
              b === "sourceService" ||
              b === "resourceId" ||
              b === "incarnation"
            )) {
              return (
                (S.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: b },
                  },
                ]),
                !1
              );
              break;
            }
          if (A === r) {
            if (t.kind !== void 0) {
              let b = t.kind,
                y = r;
              if (typeof b != "string")
                return (
                  (S.errors = [
                    {
                      instancePath: e + "/kind",
                      schemaPath: "#/properties/kind/type",
                      keyword: "type",
                      params: { type: "string" },
                    },
                  ]),
                  !1
                );
              if (!(b === "watchlist" || b === "channel_follows" || b === "holdings"))
                return (
                  (S.errors = [
                    {
                      instancePath: e + "/kind",
                      schemaPath: "#/properties/kind/enum",
                      keyword: "enum",
                      params: { allowedValues: Ze.properties.kind.enum },
                    },
                  ]),
                  !1
                );
              var p = y === r;
            } else var p = !0;
            if (p) {
              if (t.sourceService !== void 0) {
                let b = t.sourceService,
                  y = r;
                if (typeof b != "string")
                  return (
                    (S.errors = [
                      {
                        instancePath: e + "/sourceService",
                        schemaPath: "#/properties/sourceService/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
                if (!(b === "user" || b === "portfolio"))
                  return (
                    (S.errors = [
                      {
                        instancePath: e + "/sourceService",
                        schemaPath: "#/properties/sourceService/enum",
                        keyword: "enum",
                        params: { allowedValues: Ze.properties.sourceService.enum },
                      },
                    ]),
                    !1
                  );
                var p = y === r;
              } else var p = !0;
              if (p) {
                if (t.resourceId !== void 0) {
                  let b = t.resourceId,
                    y = r;
                  if (r === y)
                    if (typeof b == "string") {
                      if (g(b) > 128)
                        return (
                          (S.errors = [
                            {
                              instancePath: e + "/resourceId",
                              schemaPath: "#/properties/resourceId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (g(b) < 1)
                        return (
                          (S.errors = [
                            {
                              instancePath: e + "/resourceId",
                              schemaPath: "#/properties/resourceId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!K.test(b))
                        return (
                          (S.errors = [
                            {
                              instancePath: e + "/resourceId",
                              schemaPath: "#/properties/resourceId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (S.errors = [
                          {
                            instancePath: e + "/resourceId",
                            schemaPath: "#/properties/resourceId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var p = y === r;
                } else var p = !0;
                if (p)
                  if (t.incarnation !== void 0) {
                    let b = t.incarnation,
                      y = r;
                    if (r === y)
                      if (typeof b == "string") {
                        if (g(b) > 128)
                          return (
                            (S.errors = [
                              {
                                instancePath: e + "/incarnation",
                                schemaPath: "#/properties/incarnation/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (g(b) < 1)
                          return (
                            (S.errors = [
                              {
                                instancePath: e + "/incarnation",
                                schemaPath: "#/properties/incarnation/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!K.test(b))
                          return (
                            (S.errors = [
                              {
                                instancePath: e + "/incarnation",
                                schemaPath: "#/properties/incarnation/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (S.errors = [
                            {
                              instancePath: e + "/incarnation",
                              schemaPath: "#/properties/incarnation/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var p = y === r;
                  } else var p = !0;
              }
            }
          }
        }
      } else
        return (
          (S.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((S.errors = i), r === 0);
  }
  S.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function N(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = N.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let T;
        if (
          (t.taskId === void 0 && (T = "taskId")) ||
          (t.taskVersion === void 0 && (T = "taskVersion")) ||
          (t.runId === void 0 && (T = "runId")) ||
          (t.manifestId === void 0 && (T = "manifestId")) ||
          (t.taskEnvelopeFingerprint === void 0 && (T = "taskEnvelopeFingerprint")) ||
          (t.manifestFingerprint === void 0 && (T = "manifestFingerprint")) ||
          (t.connectionId === void 0 && (T = "connectionId")) ||
          (t.grantId === void 0 && (T = "grantId")) ||
          (t.grantEpoch === void 0 && (T = "grantEpoch")) ||
          (t.executionEpoch === void 0 && (T = "executionEpoch")) ||
          (t.resourceRef === void 0 && (T = "resourceRef")) ||
          (t.sourceRevision === void 0 && (T = "sourceRevision")) ||
          (t.sourceEpoch === void 0 && (T = "sourceEpoch"))
        )
          return (
            (N.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: T },
              },
            ]),
            !1
          );
        {
          let ge = r;
          for (let m in t)
            if (!xe.call(Qe.properties, m)) {
              return (
                (N.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: m },
                  },
                ]),
                !1
              );
              break;
            }
          if (ge === r) {
            if (t.taskId !== void 0) {
              let m = t.taskId,
                O = r,
                x = r,
                v = !1,
                E = r;
              if (r === E)
                if (typeof m == "string") {
                  if (g(m) > 128) {
                    let C = {
                      instancePath: e + "/taskId",
                      schemaPath: "#/properties/taskId/anyOf/0/maxLength",
                      keyword: "maxLength",
                      params: { limit: 128 },
                    };
                    (i === null ? (i = [C]) : i.push(C), r++);
                  } else if (g(m) < 1) {
                    let C = {
                      instancePath: e + "/taskId",
                      schemaPath: "#/properties/taskId/anyOf/0/minLength",
                      keyword: "minLength",
                      params: { limit: 1 },
                    };
                    (i === null ? (i = [C]) : i.push(C), r++);
                  } else if (!K.test(m)) {
                    let C = {
                      instancePath: e + "/taskId",
                      schemaPath: "#/properties/taskId/anyOf/0/pattern",
                      keyword: "pattern",
                      params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                    };
                    (i === null ? (i = [C]) : i.push(C), r++);
                  }
                } else {
                  let C = {
                    instancePath: e + "/taskId",
                    schemaPath: "#/properties/taskId/anyOf/0/type",
                    keyword: "type",
                    params: { type: "string" },
                  };
                  (i === null ? (i = [C]) : i.push(C), r++);
                }
              var s = E === r;
              v = v || s;
              let Z = r;
              if (m !== null) {
                let C = {
                  instancePath: e + "/taskId",
                  schemaPath: "#/properties/taskId/anyOf/1/type",
                  keyword: "type",
                  params: { type: "null" },
                };
                (i === null ? (i = [C]) : i.push(C), r++);
              }
              var s = Z === r;
              if (((v = v || s), v)) ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
              else {
                let C = {
                  instancePath: e + "/taskId",
                  schemaPath: "#/properties/taskId/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                return (i === null ? (i = [C]) : i.push(C), r++, (N.errors = i), !1);
              }
              var d = O === r;
            } else var d = !0;
            if (d) {
              if (t.taskVersion !== void 0) {
                let m = t.taskVersion,
                  O = r,
                  x = r,
                  v = !1,
                  E = r;
                if (!(typeof m == "number" && !(m % 1) && !isNaN(m))) {
                  let o = {
                    instancePath: e + "/taskVersion",
                    schemaPath: "#/properties/taskVersion/anyOf/0/type",
                    keyword: "type",
                    params: { type: "integer" },
                  };
                  (i === null ? (i = [o]) : i.push(o), r++);
                }
                if (r === E && typeof m == "number") {
                  if (m > 9007199254740991 || isNaN(m)) {
                    let o = {
                      instancePath: e + "/taskVersion",
                      schemaPath: "#/properties/taskVersion/anyOf/0/maximum",
                      keyword: "maximum",
                      params: { comparison: "<=", limit: 9007199254740991 },
                    };
                    (i === null ? (i = [o]) : i.push(o), r++);
                  } else if (m < 1 || isNaN(m)) {
                    let o = {
                      instancePath: e + "/taskVersion",
                      schemaPath: "#/properties/taskVersion/anyOf/0/minimum",
                      keyword: "minimum",
                      params: { comparison: ">=", limit: 1 },
                    };
                    (i === null ? (i = [o]) : i.push(o), r++);
                  }
                }
                var w = E === r;
                v = v || w;
                let Z = r;
                if (m !== null) {
                  let o = {
                    instancePath: e + "/taskVersion",
                    schemaPath: "#/properties/taskVersion/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  (i === null ? (i = [o]) : i.push(o), r++);
                }
                var w = Z === r;
                if (((v = v || w), v)) ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                else {
                  let o = {
                    instancePath: e + "/taskVersion",
                    schemaPath: "#/properties/taskVersion/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  return (i === null ? (i = [o]) : i.push(o), r++, (N.errors = i), !1);
                }
                var d = O === r;
              } else var d = !0;
              if (d) {
                if (t.runId !== void 0) {
                  let m = t.runId,
                    O = r,
                    x = r,
                    v = !1,
                    E = r;
                  if (r === E)
                    if (typeof m == "string") {
                      if (g(m) > 128) {
                        let o = {
                          instancePath: e + "/runId",
                          schemaPath: "#/properties/runId/anyOf/0/maxLength",
                          keyword: "maxLength",
                          params: { limit: 128 },
                        };
                        (i === null ? (i = [o]) : i.push(o), r++);
                      } else if (g(m) < 1) {
                        let o = {
                          instancePath: e + "/runId",
                          schemaPath: "#/properties/runId/anyOf/0/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        };
                        (i === null ? (i = [o]) : i.push(o), r++);
                      } else if (!K.test(m)) {
                        let o = {
                          instancePath: e + "/runId",
                          schemaPath: "#/properties/runId/anyOf/0/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                        };
                        (i === null ? (i = [o]) : i.push(o), r++);
                      }
                    } else {
                      let o = {
                        instancePath: e + "/runId",
                        schemaPath: "#/properties/runId/anyOf/0/type",
                        keyword: "type",
                        params: { type: "string" },
                      };
                      (i === null ? (i = [o]) : i.push(o), r++);
                    }
                  var l = E === r;
                  v = v || l;
                  let Z = r;
                  if (m !== null) {
                    let o = {
                      instancePath: e + "/runId",
                      schemaPath: "#/properties/runId/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    (i === null ? (i = [o]) : i.push(o), r++);
                  }
                  var l = Z === r;
                  if (((v = v || l), v)) ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                  else {
                    let o = {
                      instancePath: e + "/runId",
                      schemaPath: "#/properties/runId/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    return (i === null ? (i = [o]) : i.push(o), r++, (N.errors = i), !1);
                  }
                  var d = O === r;
                } else var d = !0;
                if (d) {
                  if (t.manifestId !== void 0) {
                    let m = t.manifestId,
                      O = r,
                      x = r,
                      v = !1,
                      E = r;
                    if (r === E)
                      if (typeof m == "string") {
                        if (g(m) > 128) {
                          let o = {
                            instancePath: e + "/manifestId",
                            schemaPath: "#/properties/manifestId/anyOf/0/maxLength",
                            keyword: "maxLength",
                            params: { limit: 128 },
                          };
                          (i === null ? (i = [o]) : i.push(o), r++);
                        } else if (g(m) < 1) {
                          let o = {
                            instancePath: e + "/manifestId",
                            schemaPath: "#/properties/manifestId/anyOf/0/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          };
                          (i === null ? (i = [o]) : i.push(o), r++);
                        } else if (!K.test(m)) {
                          let o = {
                            instancePath: e + "/manifestId",
                            schemaPath: "#/properties/manifestId/anyOf/0/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                          };
                          (i === null ? (i = [o]) : i.push(o), r++);
                        }
                      } else {
                        let o = {
                          instancePath: e + "/manifestId",
                          schemaPath: "#/properties/manifestId/anyOf/0/type",
                          keyword: "type",
                          params: { type: "string" },
                        };
                        (i === null ? (i = [o]) : i.push(o), r++);
                      }
                    var c = E === r;
                    v = v || c;
                    let Z = r;
                    if (m !== null) {
                      let o = {
                        instancePath: e + "/manifestId",
                        schemaPath: "#/properties/manifestId/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (i === null ? (i = [o]) : i.push(o), r++);
                    }
                    var c = Z === r;
                    if (((v = v || c), v))
                      ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                    else {
                      let o = {
                        instancePath: e + "/manifestId",
                        schemaPath: "#/properties/manifestId/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (i === null ? (i = [o]) : i.push(o), r++, (N.errors = i), !1);
                    }
                    var d = O === r;
                  } else var d = !0;
                  if (d) {
                    if (t.taskEnvelopeFingerprint !== void 0) {
                      let m = t.taskEnvelopeFingerprint,
                        O = r,
                        x = r,
                        v = !1,
                        E = r;
                      if (r === E)
                        if (typeof m == "string") {
                          if (g(m) > 64) {
                            let o = {
                              instancePath: e + "/taskEnvelopeFingerprint",
                              schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/0/maxLength",
                              keyword: "maxLength",
                              params: { limit: 64 },
                            };
                            (i === null ? (i = [o]) : i.push(o), r++);
                          } else if (g(m) < 64) {
                            let o = {
                              instancePath: e + "/taskEnvelopeFingerprint",
                              schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/0/minLength",
                              keyword: "minLength",
                              params: { limit: 64 },
                            };
                            (i === null ? (i = [o]) : i.push(o), r++);
                          } else if (!se.test(m)) {
                            let o = {
                              instancePath: e + "/taskEnvelopeFingerprint",
                              schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/0/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[a-f0-9]{64}$" },
                            };
                            (i === null ? (i = [o]) : i.push(o), r++);
                          }
                        } else {
                          let o = {
                            instancePath: e + "/taskEnvelopeFingerprint",
                            schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/0/type",
                            keyword: "type",
                            params: { type: "string" },
                          };
                          (i === null ? (i = [o]) : i.push(o), r++);
                        }
                      var _ = E === r;
                      v = v || _;
                      let Z = r;
                      if (m !== null) {
                        let o = {
                          instancePath: e + "/taskEnvelopeFingerprint",
                          schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                        };
                        (i === null ? (i = [o]) : i.push(o), r++);
                      }
                      var _ = Z === r;
                      if (((v = v || _), v))
                        ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                      else {
                        let o = {
                          instancePath: e + "/taskEnvelopeFingerprint",
                          schemaPath: "#/properties/taskEnvelopeFingerprint/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        return (i === null ? (i = [o]) : i.push(o), r++, (N.errors = i), !1);
                      }
                      var d = O === r;
                    } else var d = !0;
                    if (d) {
                      if (t.manifestFingerprint !== void 0) {
                        let m = t.manifestFingerprint,
                          O = r,
                          x = r,
                          v = !1,
                          E = r;
                        if (r === E)
                          if (typeof m == "string") {
                            if (g(m) > 64) {
                              let o = {
                                instancePath: e + "/manifestFingerprint",
                                schemaPath: "#/properties/manifestFingerprint/anyOf/0/maxLength",
                                keyword: "maxLength",
                                params: { limit: 64 },
                              };
                              (i === null ? (i = [o]) : i.push(o), r++);
                            } else if (g(m) < 64) {
                              let o = {
                                instancePath: e + "/manifestFingerprint",
                                schemaPath: "#/properties/manifestFingerprint/anyOf/0/minLength",
                                keyword: "minLength",
                                params: { limit: 64 },
                              };
                              (i === null ? (i = [o]) : i.push(o), r++);
                            } else if (!se.test(m)) {
                              let o = {
                                instancePath: e + "/manifestFingerprint",
                                schemaPath: "#/properties/manifestFingerprint/anyOf/0/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[a-f0-9]{64}$" },
                              };
                              (i === null ? (i = [o]) : i.push(o), r++);
                            }
                          } else {
                            let o = {
                              instancePath: e + "/manifestFingerprint",
                              schemaPath: "#/properties/manifestFingerprint/anyOf/0/type",
                              keyword: "type",
                              params: { type: "string" },
                            };
                            (i === null ? (i = [o]) : i.push(o), r++);
                          }
                        var p = E === r;
                        v = v || p;
                        let Z = r;
                        if (m !== null) {
                          let o = {
                            instancePath: e + "/manifestFingerprint",
                            schemaPath: "#/properties/manifestFingerprint/anyOf/1/type",
                            keyword: "type",
                            params: { type: "null" },
                          };
                          (i === null ? (i = [o]) : i.push(o), r++);
                        }
                        var p = Z === r;
                        if (((v = v || p), v))
                          ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                        else {
                          let o = {
                            instancePath: e + "/manifestFingerprint",
                            schemaPath: "#/properties/manifestFingerprint/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          return (i === null ? (i = [o]) : i.push(o), r++, (N.errors = i), !1);
                        }
                        var d = O === r;
                      } else var d = !0;
                      if (d) {
                        if (t.connectionId !== void 0) {
                          let m = t.connectionId,
                            O = r,
                            x = r,
                            v = !1,
                            E = r;
                          if (r === E)
                            if (typeof m == "string") {
                              if (g(m) > 128) {
                                let o = {
                                  instancePath: e + "/connectionId",
                                  schemaPath: "#/properties/connectionId/anyOf/0/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 128 },
                                };
                                (i === null ? (i = [o]) : i.push(o), r++);
                              } else if (g(m) < 1) {
                                let o = {
                                  instancePath: e + "/connectionId",
                                  schemaPath: "#/properties/connectionId/anyOf/0/minLength",
                                  keyword: "minLength",
                                  params: { limit: 1 },
                                };
                                (i === null ? (i = [o]) : i.push(o), r++);
                              } else if (!K.test(m)) {
                                let o = {
                                  instancePath: e + "/connectionId",
                                  schemaPath: "#/properties/connectionId/anyOf/0/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                };
                                (i === null ? (i = [o]) : i.push(o), r++);
                              }
                            } else {
                              let o = {
                                instancePath: e + "/connectionId",
                                schemaPath: "#/properties/connectionId/anyOf/0/type",
                                keyword: "type",
                                params: { type: "string" },
                              };
                              (i === null ? (i = [o]) : i.push(o), r++);
                            }
                          var k = E === r;
                          v = v || k;
                          let Z = r;
                          if (m !== null) {
                            let o = {
                              instancePath: e + "/connectionId",
                              schemaPath: "#/properties/connectionId/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            (i === null ? (i = [o]) : i.push(o), r++);
                          }
                          var k = Z === r;
                          if (((v = v || k), v))
                            ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                          else {
                            let o = {
                              instancePath: e + "/connectionId",
                              schemaPath: "#/properties/connectionId/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            return (i === null ? (i = [o]) : i.push(o), r++, (N.errors = i), !1);
                          }
                          var d = O === r;
                        } else var d = !0;
                        if (d) {
                          if (t.grantId !== void 0) {
                            let m = t.grantId,
                              O = r,
                              x = r,
                              v = !1,
                              E = r;
                            if (r === E)
                              if (typeof m == "string") {
                                if (g(m) > 128) {
                                  let o = {
                                    instancePath: e + "/grantId",
                                    schemaPath: "#/properties/grantId/anyOf/0/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 128 },
                                  };
                                  (i === null ? (i = [o]) : i.push(o), r++);
                                } else if (g(m) < 1) {
                                  let o = {
                                    instancePath: e + "/grantId",
                                    schemaPath: "#/properties/grantId/anyOf/0/minLength",
                                    keyword: "minLength",
                                    params: { limit: 1 },
                                  };
                                  (i === null ? (i = [o]) : i.push(o), r++);
                                } else if (!K.test(m)) {
                                  let o = {
                                    instancePath: e + "/grantId",
                                    schemaPath: "#/properties/grantId/anyOf/0/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                  };
                                  (i === null ? (i = [o]) : i.push(o), r++);
                                }
                              } else {
                                let o = {
                                  instancePath: e + "/grantId",
                                  schemaPath: "#/properties/grantId/anyOf/0/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                };
                                (i === null ? (i = [o]) : i.push(o), r++);
                              }
                            var A = E === r;
                            v = v || A;
                            let Z = r;
                            if (m !== null) {
                              let o = {
                                instancePath: e + "/grantId",
                                schemaPath: "#/properties/grantId/anyOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                              };
                              (i === null ? (i = [o]) : i.push(o), r++);
                            }
                            var A = Z === r;
                            if (((v = v || A), v))
                              ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                            else {
                              let o = {
                                instancePath: e + "/grantId",
                                schemaPath: "#/properties/grantId/anyOf",
                                keyword: "anyOf",
                                params: {},
                              };
                              return (i === null ? (i = [o]) : i.push(o), r++, (N.errors = i), !1);
                            }
                            var d = O === r;
                          } else var d = !0;
                          if (d) {
                            if (t.grantEpoch !== void 0) {
                              let m = t.grantEpoch,
                                O = r,
                                x = r,
                                v = !1,
                                E = r;
                              if (!(typeof m == "number" && !(m % 1) && !isNaN(m))) {
                                let o = {
                                  instancePath: e + "/grantEpoch",
                                  schemaPath: "#/properties/grantEpoch/anyOf/0/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                };
                                (i === null ? (i = [o]) : i.push(o), r++);
                              }
                              if (r === E && typeof m == "number") {
                                if (m > 9007199254740991 || isNaN(m)) {
                                  let o = {
                                    instancePath: e + "/grantEpoch",
                                    schemaPath: "#/properties/grantEpoch/anyOf/0/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  };
                                  (i === null ? (i = [o]) : i.push(o), r++);
                                } else if (m < 1 || isNaN(m)) {
                                  let o = {
                                    instancePath: e + "/grantEpoch",
                                    schemaPath: "#/properties/grantEpoch/anyOf/0/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  };
                                  (i === null ? (i = [o]) : i.push(o), r++);
                                }
                              }
                              var b = E === r;
                              v = v || b;
                              let Z = r;
                              if (m !== null) {
                                let o = {
                                  instancePath: e + "/grantEpoch",
                                  schemaPath: "#/properties/grantEpoch/anyOf/1/type",
                                  keyword: "type",
                                  params: { type: "null" },
                                };
                                (i === null ? (i = [o]) : i.push(o), r++);
                              }
                              var b = Z === r;
                              if (((v = v || b), v))
                                ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                              else {
                                let o = {
                                  instancePath: e + "/grantEpoch",
                                  schemaPath: "#/properties/grantEpoch/anyOf",
                                  keyword: "anyOf",
                                  params: {},
                                };
                                return (
                                  i === null ? (i = [o]) : i.push(o),
                                  r++,
                                  (N.errors = i),
                                  !1
                                );
                              }
                              var d = O === r;
                            } else var d = !0;
                            if (d) {
                              if (t.executionEpoch !== void 0) {
                                let m = t.executionEpoch,
                                  O = r,
                                  x = r,
                                  v = !1,
                                  E = r;
                                if (!(typeof m == "number" && !(m % 1) && !isNaN(m))) {
                                  let o = {
                                    instancePath: e + "/executionEpoch",
                                    schemaPath: "#/properties/executionEpoch/anyOf/0/type",
                                    keyword: "type",
                                    params: { type: "integer" },
                                  };
                                  (i === null ? (i = [o]) : i.push(o), r++);
                                }
                                if (r === E && typeof m == "number") {
                                  if (m > 9007199254740991 || isNaN(m)) {
                                    let o = {
                                      instancePath: e + "/executionEpoch",
                                      schemaPath: "#/properties/executionEpoch/anyOf/0/maximum",
                                      keyword: "maximum",
                                      params: { comparison: "<=", limit: 9007199254740991 },
                                    };
                                    (i === null ? (i = [o]) : i.push(o), r++);
                                  } else if (m < 1 || isNaN(m)) {
                                    let o = {
                                      instancePath: e + "/executionEpoch",
                                      schemaPath: "#/properties/executionEpoch/anyOf/0/minimum",
                                      keyword: "minimum",
                                      params: { comparison: ">=", limit: 1 },
                                    };
                                    (i === null ? (i = [o]) : i.push(o), r++);
                                  }
                                }
                                var y = E === r;
                                v = v || y;
                                let Z = r;
                                if (m !== null) {
                                  let o = {
                                    instancePath: e + "/executionEpoch",
                                    schemaPath: "#/properties/executionEpoch/anyOf/1/type",
                                    keyword: "type",
                                    params: { type: "null" },
                                  };
                                  (i === null ? (i = [o]) : i.push(o), r++);
                                }
                                var y = Z === r;
                                if (((v = v || y), v))
                                  ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                                else {
                                  let o = {
                                    instancePath: e + "/executionEpoch",
                                    schemaPath: "#/properties/executionEpoch/anyOf",
                                    keyword: "anyOf",
                                    params: {},
                                  };
                                  return (
                                    i === null ? (i = [o]) : i.push(o),
                                    r++,
                                    (N.errors = i),
                                    !1
                                  );
                                }
                                var d = O === r;
                              } else var d = !0;
                              if (d) {
                                if (t.resourceRef !== void 0) {
                                  let m = t.resourceRef,
                                    O = r,
                                    x = r,
                                    v = !1,
                                    E = r;
                                  S(m, {
                                    instancePath: e + "/resourceRef",
                                    parentData: t,
                                    parentDataProperty: "resourceRef",
                                    rootData: f,
                                    dynamicAnchors: u,
                                  }) ||
                                    ((i = i === null ? S.errors : i.concat(S.errors)),
                                    (r = i.length));
                                  var j = E === r;
                                  v = v || j;
                                  let Z = r;
                                  if (m !== null) {
                                    let o = {
                                      instancePath: e + "/resourceRef",
                                      schemaPath: "#/properties/resourceRef/anyOf/1/type",
                                      keyword: "type",
                                      params: { type: "null" },
                                    };
                                    (i === null ? (i = [o]) : i.push(o), r++);
                                  }
                                  var j = Z === r;
                                  if (((v = v || j), v))
                                    ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                                  else {
                                    let o = {
                                      instancePath: e + "/resourceRef",
                                      schemaPath: "#/properties/resourceRef/anyOf",
                                      keyword: "anyOf",
                                      params: {},
                                    };
                                    return (
                                      i === null ? (i = [o]) : i.push(o),
                                      r++,
                                      (N.errors = i),
                                      !1
                                    );
                                  }
                                  var d = O === r;
                                } else var d = !0;
                                if (d) {
                                  if (t.sourceRevision !== void 0) {
                                    let m = t.sourceRevision,
                                      O = r,
                                      x = r,
                                      v = !1,
                                      E = r;
                                    if (!(typeof m == "number" && !(m % 1) && !isNaN(m))) {
                                      let o = {
                                        instancePath: e + "/sourceRevision",
                                        schemaPath: "#/properties/sourceRevision/anyOf/0/type",
                                        keyword: "type",
                                        params: { type: "integer" },
                                      };
                                      (i === null ? (i = [o]) : i.push(o), r++);
                                    }
                                    if (r === E && typeof m == "number") {
                                      if (m > 9007199254740991 || isNaN(m)) {
                                        let o = {
                                          instancePath: e + "/sourceRevision",
                                          schemaPath: "#/properties/sourceRevision/anyOf/0/maximum",
                                          keyword: "maximum",
                                          params: { comparison: "<=", limit: 9007199254740991 },
                                        };
                                        (i === null ? (i = [o]) : i.push(o), r++);
                                      } else if (m < 1 || isNaN(m)) {
                                        let o = {
                                          instancePath: e + "/sourceRevision",
                                          schemaPath: "#/properties/sourceRevision/anyOf/0/minimum",
                                          keyword: "minimum",
                                          params: { comparison: ">=", limit: 1 },
                                        };
                                        (i === null ? (i = [o]) : i.push(o), r++);
                                      }
                                    }
                                    var ee = E === r;
                                    v = v || ee;
                                    let Z = r;
                                    if (m !== null) {
                                      let o = {
                                        instancePath: e + "/sourceRevision",
                                        schemaPath: "#/properties/sourceRevision/anyOf/1/type",
                                        keyword: "type",
                                        params: { type: "null" },
                                      };
                                      (i === null ? (i = [o]) : i.push(o), r++);
                                    }
                                    var ee = Z === r;
                                    if (((v = v || ee), v))
                                      ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                                    else {
                                      let o = {
                                        instancePath: e + "/sourceRevision",
                                        schemaPath: "#/properties/sourceRevision/anyOf",
                                        keyword: "anyOf",
                                        params: {},
                                      };
                                      return (
                                        i === null ? (i = [o]) : i.push(o),
                                        r++,
                                        (N.errors = i),
                                        !1
                                      );
                                    }
                                    var d = O === r;
                                  } else var d = !0;
                                  if (d)
                                    if (t.sourceEpoch !== void 0) {
                                      let m = t.sourceEpoch,
                                        O = r,
                                        x = r,
                                        v = !1,
                                        E = r;
                                      if (!(typeof m == "number" && !(m % 1) && !isNaN(m))) {
                                        let o = {
                                          instancePath: e + "/sourceEpoch",
                                          schemaPath: "#/properties/sourceEpoch/anyOf/0/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                        };
                                        (i === null ? (i = [o]) : i.push(o), r++);
                                      }
                                      if (r === E && typeof m == "number") {
                                        if (m > 9007199254740991 || isNaN(m)) {
                                          let o = {
                                            instancePath: e + "/sourceEpoch",
                                            schemaPath: "#/properties/sourceEpoch/anyOf/0/maximum",
                                            keyword: "maximum",
                                            params: { comparison: "<=", limit: 9007199254740991 },
                                          };
                                          (i === null ? (i = [o]) : i.push(o), r++);
                                        } else if (m < 1 || isNaN(m)) {
                                          let o = {
                                            instancePath: e + "/sourceEpoch",
                                            schemaPath: "#/properties/sourceEpoch/anyOf/0/minimum",
                                            keyword: "minimum",
                                            params: { comparison: ">=", limit: 1 },
                                          };
                                          (i === null ? (i = [o]) : i.push(o), r++);
                                        }
                                      }
                                      var R = E === r;
                                      v = v || R;
                                      let Z = r;
                                      if (m !== null) {
                                        let o = {
                                          instancePath: e + "/sourceEpoch",
                                          schemaPath: "#/properties/sourceEpoch/anyOf/1/type",
                                          keyword: "type",
                                          params: { type: "null" },
                                        };
                                        (i === null ? (i = [o]) : i.push(o), r++);
                                      }
                                      var R = Z === r;
                                      if (((v = v || R), v))
                                        ((r = x), i !== null && (x ? (i.length = x) : (i = null)));
                                      else {
                                        let o = {
                                          instancePath: e + "/sourceEpoch",
                                          schemaPath: "#/properties/sourceEpoch/anyOf",
                                          keyword: "anyOf",
                                          params: {},
                                        };
                                        return (
                                          i === null ? (i = [o]) : i.push(o),
                                          r++,
                                          (N.errors = i),
                                          !1
                                        );
                                      }
                                      var d = O === r;
                                    } else var d = !0;
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
          (N.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((N.errors = i), r === 0);
  }
  N.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function U(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = U.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let d;
        if ((t.ref === void 0 && (d = "ref")) || (t.sourceEpoch === void 0 && (d = "sourceEpoch")))
          return (
            (U.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: d },
              },
            ]),
            !1
          );
        {
          let w = r;
          for (let l in t)
            if (!(l === "ref" || l === "sourceEpoch")) {
              return (
                (U.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === r) {
            if (t.ref !== void 0) {
              let l = r;
              S(t.ref, {
                instancePath: e + "/ref",
                parentData: t,
                parentDataProperty: "ref",
                rootData: f,
                dynamicAnchors: u,
              }) || ((i = i === null ? S.errors : i.concat(S.errors)), (r = i.length));
              var s = l === r;
            } else var s = !0;
            if (s)
              if (t.sourceEpoch !== void 0) {
                let l = t.sourceEpoch,
                  c = r;
                if (!(typeof l == "number" && !(l % 1) && !isNaN(l)))
                  return (
                    (U.errors = [
                      {
                        instancePath: e + "/sourceEpoch",
                        schemaPath: "#/properties/sourceEpoch/type",
                        keyword: "type",
                        params: { type: "integer" },
                      },
                    ]),
                    !1
                  );
                if (r === c && typeof l == "number") {
                  if (l > 9007199254740991 || isNaN(l))
                    return (
                      (U.errors = [
                        {
                          instancePath: e + "/sourceEpoch",
                          schemaPath: "#/properties/sourceEpoch/maximum",
                          keyword: "maximum",
                          params: { comparison: "<=", limit: 9007199254740991 },
                        },
                      ]),
                      !1
                    );
                  if (l < 1 || isNaN(l))
                    return (
                      (U.errors = [
                        {
                          instancePath: e + "/sourceEpoch",
                          schemaPath: "#/properties/sourceEpoch/minimum",
                          keyword: "minimum",
                          params: { comparison: ">=", limit: 1 },
                        },
                      ]),
                      !1
                    );
                }
                var s = c === r;
              } else var s = !0;
          }
        }
      } else
        return (
          (U.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((U.errors = i), r === 0);
  }
  U.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  var er = {
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
  function $(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = $.evaluated;
    (h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0));
    let s = r,
      d = !0,
      w = r;
    if (
      t &&
      typeof t == "object" &&
      !Array.isArray(t) &&
      t.role !== void 0 &&
      t.role !== "agent_enc"
    ) {
      let A = {};
      (i === null ? (i = [A]) : i.push(A), r++);
    }
    var l = w === r;
    ((r = s), i !== null && (s ? (i.length = s) : (i = null)));
    let c;
    if (l) {
      let A = r;
      if (t && typeof t == "object" && !Array.isArray(t) && t.connectionId !== void 0) {
        let y = t.connectionId;
        if (r === r)
          if (typeof y == "string") {
            if (g(y) > 128)
              return (
                ($.errors = [
                  {
                    instancePath: e + "/connectionId",
                    schemaPath: "#/allOf/0/then/properties/connectionId/maxLength",
                    keyword: "maxLength",
                    params: { limit: 128 },
                  },
                ]),
                !1
              );
            if (g(y) < 1)
              return (
                ($.errors = [
                  {
                    instancePath: e + "/connectionId",
                    schemaPath: "#/allOf/0/then/properties/connectionId/minLength",
                    keyword: "minLength",
                    params: { limit: 1 },
                  },
                ]),
                !1
              );
            if (!K.test(y))
              return (
                ($.errors = [
                  {
                    instancePath: e + "/connectionId",
                    schemaPath: "#/allOf/0/then/properties/connectionId/pattern",
                    keyword: "pattern",
                    params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                  },
                ]),
                !1
              );
          } else
            return (
              ($.errors = [
                {
                  instancePath: e + "/connectionId",
                  schemaPath: "#/allOf/0/then/properties/connectionId/type",
                  keyword: "type",
                  params: { type: "string" },
                },
              ]),
              !1
            );
      }
      var l = A === r;
      if (((d = l), d)) {
        var _ = {};
        ((_.connectionId = !0), (_.role = !0));
      }
      c = "then";
    } else {
      let A = r;
      if (
        t &&
        typeof t == "object" &&
        !Array.isArray(t) &&
        t.connectionId !== void 0 &&
        t.connectionId !== null
      )
        return (
          ($.errors = [
            {
              instancePath: e + "/connectionId",
              schemaPath: "#/allOf/0/else/properties/connectionId/type",
              keyword: "type",
              params: { type: "null" },
            },
          ]),
          !1
        );
      var l = A === r;
      ((d = l), d && _ !== !0 && ((_ = _ || {}), (_.connectionId = !0)), (c = "else"));
    }
    if (!d) {
      let A = {
        instancePath: e,
        schemaPath: "#/allOf/0/if",
        keyword: "if",
        params: { failingKeyword: c },
      };
      return (i === null ? (i = [A]) : i.push(A), r++, ($.errors = i), !1);
    }
    if (r === 0)
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let A;
        if (
          (t.keyId === void 0 && (A = "keyId")) ||
          (t.role === void 0 && (A = "role")) ||
          (t.principalId === void 0 && (A = "principalId")) ||
          (t.connectionId === void 0 && (A = "connectionId")) ||
          (t.keyEpoch === void 0 && (A = "keyEpoch"))
        )
          return (
            ($.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: A },
              },
            ]),
            !1
          );
        {
          let b = r;
          for (let y in t)
            if (!(
              y === "keyId" ||
              y === "role" ||
              y === "principalId" ||
              y === "connectionId" ||
              y === "keyEpoch"
            )) {
              return (
                ($.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: y },
                  },
                ]),
                !1
              );
              break;
            }
          if (b === r) {
            if (t.keyId !== void 0) {
              let y = t.keyId,
                j = r;
              if (r === j)
                if (typeof y == "string") {
                  if (g(y) > 43)
                    return (
                      ($.errors = [
                        {
                          instancePath: e + "/keyId",
                          schemaPath: "#/properties/keyId/maxLength",
                          keyword: "maxLength",
                          params: { limit: 43 },
                        },
                      ]),
                      !1
                    );
                  if (g(y) < 43)
                    return (
                      ($.errors = [
                        {
                          instancePath: e + "/keyId",
                          schemaPath: "#/properties/keyId/minLength",
                          keyword: "minLength",
                          params: { limit: 43 },
                        },
                      ]),
                      !1
                    );
                  if (!te.test(y))
                    return (
                      ($.errors = [
                        {
                          instancePath: e + "/keyId",
                          schemaPath: "#/properties/keyId/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    ($.errors = [
                      {
                        instancePath: e + "/keyId",
                        schemaPath: "#/properties/keyId/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var p = j === r;
            } else var p = !0;
            if (p) {
              if (t.role !== void 0) {
                let y = t.role,
                  j = r;
                if (!(y === "device_enc" || y === "agent_enc" || y === "recovery_enc"))
                  return (
                    ($.errors = [
                      {
                        instancePath: e + "/role",
                        schemaPath: "#/properties/role/enum",
                        keyword: "enum",
                        params: { allowedValues: er.properties.role.enum },
                      },
                    ]),
                    !1
                  );
                var p = j === r;
              } else var p = !0;
              if (p) {
                if (t.principalId !== void 0) {
                  let y = t.principalId,
                    j = r;
                  if (r === j)
                    if (typeof y == "string") {
                      if (g(y) > 128)
                        return (
                          ($.errors = [
                            {
                              instancePath: e + "/principalId",
                              schemaPath: "#/properties/principalId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (g(y) < 1)
                        return (
                          ($.errors = [
                            {
                              instancePath: e + "/principalId",
                              schemaPath: "#/properties/principalId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!K.test(y))
                        return (
                          ($.errors = [
                            {
                              instancePath: e + "/principalId",
                              schemaPath: "#/properties/principalId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        ($.errors = [
                          {
                            instancePath: e + "/principalId",
                            schemaPath: "#/properties/principalId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var p = j === r;
                } else var p = !0;
                if (p) {
                  if (t.connectionId !== void 0) {
                    let y = t.connectionId,
                      j = r,
                      ee = r,
                      R = !1,
                      T = r;
                    if (r === T)
                      if (typeof y == "string") {
                        if (g(y) > 128) {
                          let O = {
                            instancePath: e + "/connectionId",
                            schemaPath: "#/properties/connectionId/anyOf/0/maxLength",
                            keyword: "maxLength",
                            params: { limit: 128 },
                          };
                          (i === null ? (i = [O]) : i.push(O), r++);
                        } else if (g(y) < 1) {
                          let O = {
                            instancePath: e + "/connectionId",
                            schemaPath: "#/properties/connectionId/anyOf/0/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          };
                          (i === null ? (i = [O]) : i.push(O), r++);
                        } else if (!K.test(y)) {
                          let O = {
                            instancePath: e + "/connectionId",
                            schemaPath: "#/properties/connectionId/anyOf/0/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                          };
                          (i === null ? (i = [O]) : i.push(O), r++);
                        }
                      } else {
                        let O = {
                          instancePath: e + "/connectionId",
                          schemaPath: "#/properties/connectionId/anyOf/0/type",
                          keyword: "type",
                          params: { type: "string" },
                        };
                        (i === null ? (i = [O]) : i.push(O), r++);
                      }
                    var k = T === r;
                    R = R || k;
                    let ge = r;
                    if (y !== null) {
                      let O = {
                        instancePath: e + "/connectionId",
                        schemaPath: "#/properties/connectionId/anyOf/1/type",
                        keyword: "type",
                        params: { type: "null" },
                      };
                      (i === null ? (i = [O]) : i.push(O), r++);
                    }
                    var k = ge === r;
                    if (((R = R || k), R))
                      ((r = ee), i !== null && (ee ? (i.length = ee) : (i = null)));
                    else {
                      let O = {
                        instancePath: e + "/connectionId",
                        schemaPath: "#/properties/connectionId/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      return (i === null ? (i = [O]) : i.push(O), r++, ($.errors = i), !1);
                    }
                    var p = j === r;
                  } else var p = !0;
                  if (p)
                    if (t.keyEpoch !== void 0) {
                      let y = t.keyEpoch,
                        j = r;
                      if (!(typeof y == "number" && !(y % 1) && !isNaN(y)))
                        return (
                          ($.errors = [
                            {
                              instancePath: e + "/keyEpoch",
                              schemaPath: "#/properties/keyEpoch/type",
                              keyword: "type",
                              params: { type: "integer" },
                            },
                          ]),
                          !1
                        );
                      if (r === j && typeof y == "number") {
                        if (y > 9007199254740991 || isNaN(y))
                          return (
                            ($.errors = [
                              {
                                instancePath: e + "/keyEpoch",
                                schemaPath: "#/properties/keyEpoch/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 9007199254740991 },
                              },
                            ]),
                            !1
                          );
                        if (y < 1 || isNaN(y))
                          return (
                            ($.errors = [
                              {
                                instancePath: e + "/keyEpoch",
                                schemaPath: "#/properties/keyEpoch/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 1 },
                              },
                            ]),
                            !1
                          );
                      }
                      var p = j === r;
                    } else var p = !0;
                }
              }
            }
          }
        }
      } else
        return (
          ($.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return (($.errors = i), r === 0);
  }
  $.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function P(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = P.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let c;
        if (
          (t.contractVersion === void 0 && (c = "contractVersion")) ||
          (t.profileId === void 0 && (c = "profileId")) ||
          (t.ownerSubject === void 0 && (c = "ownerSubject")) ||
          (t.vaultId === void 0 && (c = "vaultId")) ||
          (t.rootKeyId === void 0 && (c = "rootKeyId")) ||
          (t.rootEpoch === void 0 && (c = "rootEpoch")) ||
          (t.registrySequence === void 0 && (c = "registrySequence")) ||
          (t.checkpointDigest === void 0 && (c = "checkpointDigest")) ||
          (t.keyEpoch === void 0 && (c = "keyEpoch")) ||
          (t.objectId === void 0 && (c = "objectId")) ||
          (t.objectType === void 0 && (c = "objectType")) ||
          (t.revision === void 0 && (c = "revision")) ||
          (t.deliveryRevision === void 0 && (c = "deliveryRevision")) ||
          (t.priorEnvelopeFingerprint === void 0 && (c = "priorEnvelopeFingerprint")) ||
          (t.expectedRevision === void 0 && (c = "expectedRevision")) ||
          (t.stableOperationId === void 0 && (c = "stableOperationId")) ||
          (t.operationType === void 0 && (c = "operationType")) ||
          (t.authorSigningKeyId === void 0 && (c = "authorSigningKeyId")) ||
          (t.binding === void 0 && (c = "binding")) ||
          (t.resourceBindings === void 0 && (c = "resourceBindings")) ||
          (t.recipients === void 0 && (c = "recipients"))
        )
          return (
            (P.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: c },
              },
            ]),
            !1
          );
        {
          let _ = r;
          for (let p in t)
            if (!xe.call(_e.properties, p)) {
              return (
                (P.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: p },
                  },
                ]),
                !1
              );
              break;
            }
          if (_ === r) {
            if (t.contractVersion !== void 0) {
              let p = r;
              if (t.contractVersion !== "folioview.agent-workspace.v2.0")
                return (
                  (P.errors = [
                    {
                      instancePath: e + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.agent-workspace.v2.0" },
                    },
                  ]),
                  !1
                );
              var s = p === r;
            } else var s = !0;
            if (s) {
              if (t.profileId !== void 0) {
                let p = r;
                if (t.profileId !== "P1")
                  return (
                    (P.errors = [
                      {
                        instancePath: e + "/profileId",
                        schemaPath: "#/properties/profileId/const",
                        keyword: "const",
                        params: { allowedValue: "P1" },
                      },
                    ]),
                    !1
                  );
                var s = p === r;
              } else var s = !0;
              if (s) {
                if (t.ownerSubject !== void 0) {
                  let p = t.ownerSubject,
                    k = r;
                  if (r === k)
                    if (typeof p == "string") {
                      if (g(p) > 128)
                        return (
                          (P.errors = [
                            {
                              instancePath: e + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (g(p) < 1)
                        return (
                          (P.errors = [
                            {
                              instancePath: e + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!K.test(p))
                        return (
                          (P.errors = [
                            {
                              instancePath: e + "/ownerSubject",
                              schemaPath: "#/properties/ownerSubject/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (P.errors = [
                          {
                            instancePath: e + "/ownerSubject",
                            schemaPath: "#/properties/ownerSubject/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = k === r;
                } else var s = !0;
                if (s) {
                  if (t.vaultId !== void 0) {
                    let p = t.vaultId,
                      k = r;
                    if (r === k)
                      if (typeof p == "string") {
                        if (g(p) > 128)
                          return (
                            (P.errors = [
                              {
                                instancePath: e + "/vaultId",
                                schemaPath: "#/properties/vaultId/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (g(p) < 1)
                          return (
                            (P.errors = [
                              {
                                instancePath: e + "/vaultId",
                                schemaPath: "#/properties/vaultId/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!K.test(p))
                          return (
                            (P.errors = [
                              {
                                instancePath: e + "/vaultId",
                                schemaPath: "#/properties/vaultId/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (P.errors = [
                            {
                              instancePath: e + "/vaultId",
                              schemaPath: "#/properties/vaultId/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = k === r;
                  } else var s = !0;
                  if (s) {
                    if (t.rootKeyId !== void 0) {
                      let p = t.rootKeyId,
                        k = r;
                      if (r === k)
                        if (typeof p == "string") {
                          if (g(p) > 43)
                            return (
                              (P.errors = [
                                {
                                  instancePath: e + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 43 },
                                },
                              ]),
                              !1
                            );
                          if (g(p) < 43)
                            return (
                              (P.errors = [
                                {
                                  instancePath: e + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/minLength",
                                  keyword: "minLength",
                                  params: { limit: 43 },
                                },
                              ]),
                              !1
                            );
                          if (!te.test(p))
                            return (
                              (P.errors = [
                                {
                                  instancePath: e + "/rootKeyId",
                                  schemaPath: "#/properties/rootKeyId/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (P.errors = [
                              {
                                instancePath: e + "/rootKeyId",
                                schemaPath: "#/properties/rootKeyId/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = k === r;
                    } else var s = !0;
                    if (s) {
                      if (t.rootEpoch !== void 0) {
                        let p = t.rootEpoch,
                          k = r;
                        if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                          return (
                            (P.errors = [
                              {
                                instancePath: e + "/rootEpoch",
                                schemaPath: "#/properties/rootEpoch/type",
                                keyword: "type",
                                params: { type: "integer" },
                              },
                            ]),
                            !1
                          );
                        if (r === k && typeof p == "number") {
                          if (p > 9007199254740991 || isNaN(p))
                            return (
                              (P.errors = [
                                {
                                  instancePath: e + "/rootEpoch",
                                  schemaPath: "#/properties/rootEpoch/maximum",
                                  keyword: "maximum",
                                  params: { comparison: "<=", limit: 9007199254740991 },
                                },
                              ]),
                              !1
                            );
                          if (p < 1 || isNaN(p))
                            return (
                              (P.errors = [
                                {
                                  instancePath: e + "/rootEpoch",
                                  schemaPath: "#/properties/rootEpoch/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ]),
                              !1
                            );
                        }
                        var s = k === r;
                      } else var s = !0;
                      if (s) {
                        if (t.registrySequence !== void 0) {
                          let p = t.registrySequence,
                            k = r;
                          if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                            return (
                              (P.errors = [
                                {
                                  instancePath: e + "/registrySequence",
                                  schemaPath: "#/properties/registrySequence/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                },
                              ]),
                              !1
                            );
                          if (r === k && typeof p == "number") {
                            if (p > 9007199254740991 || isNaN(p))
                              return (
                                (P.errors = [
                                  {
                                    instancePath: e + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  },
                                ]),
                                !1
                              );
                            if (p < 1 || isNaN(p))
                              return (
                                (P.errors = [
                                  {
                                    instancePath: e + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  },
                                ]),
                                !1
                              );
                          }
                          var s = k === r;
                        } else var s = !0;
                        if (s) {
                          if (t.checkpointDigest !== void 0) {
                            let p = t.checkpointDigest,
                              k = r;
                            if (r === k)
                              if (typeof p == "string") {
                                if (g(p) > 64)
                                  return (
                                    (P.errors = [
                                      {
                                        instancePath: e + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/maxLength",
                                        keyword: "maxLength",
                                        params: { limit: 64 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (g(p) < 64)
                                  return (
                                    (P.errors = [
                                      {
                                        instancePath: e + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/minLength",
                                        keyword: "minLength",
                                        params: { limit: 64 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (!se.test(p))
                                  return (
                                    (P.errors = [
                                      {
                                        instancePath: e + "/checkpointDigest",
                                        schemaPath: "#/properties/checkpointDigest/pattern",
                                        keyword: "pattern",
                                        params: { pattern: "^[a-f0-9]{64}$" },
                                      },
                                    ]),
                                    !1
                                  );
                              } else
                                return (
                                  (P.errors = [
                                    {
                                      instancePath: e + "/checkpointDigest",
                                      schemaPath: "#/properties/checkpointDigest/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                    },
                                  ]),
                                  !1
                                );
                            var s = k === r;
                          } else var s = !0;
                          if (s) {
                            if (t.keyEpoch !== void 0) {
                              let p = t.keyEpoch,
                                k = r;
                              if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                return (
                                  (P.errors = [
                                    {
                                      instancePath: e + "/keyEpoch",
                                      schemaPath: "#/properties/keyEpoch/type",
                                      keyword: "type",
                                      params: { type: "integer" },
                                    },
                                  ]),
                                  !1
                                );
                              if (r === k && typeof p == "number") {
                                if (p > 9007199254740991 || isNaN(p))
                                  return (
                                    (P.errors = [
                                      {
                                        instancePath: e + "/keyEpoch",
                                        schemaPath: "#/properties/keyEpoch/maximum",
                                        keyword: "maximum",
                                        params: { comparison: "<=", limit: 9007199254740991 },
                                      },
                                    ]),
                                    !1
                                  );
                                if (p < 1 || isNaN(p))
                                  return (
                                    (P.errors = [
                                      {
                                        instancePath: e + "/keyEpoch",
                                        schemaPath: "#/properties/keyEpoch/minimum",
                                        keyword: "minimum",
                                        params: { comparison: ">=", limit: 1 },
                                      },
                                    ]),
                                    !1
                                  );
                              }
                              var s = k === r;
                            } else var s = !0;
                            if (s) {
                              if (t.objectId !== void 0) {
                                let p = t.objectId,
                                  k = r;
                                if (r === k)
                                  if (typeof p == "string") {
                                    if (g(p) > 128)
                                      return (
                                        (P.errors = [
                                          {
                                            instancePath: e + "/objectId",
                                            schemaPath: "#/properties/objectId/maxLength",
                                            keyword: "maxLength",
                                            params: { limit: 128 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (g(p) < 1)
                                      return (
                                        (P.errors = [
                                          {
                                            instancePath: e + "/objectId",
                                            schemaPath: "#/properties/objectId/minLength",
                                            keyword: "minLength",
                                            params: { limit: 1 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (!K.test(p))
                                      return (
                                        (P.errors = [
                                          {
                                            instancePath: e + "/objectId",
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
                                      (P.errors = [
                                        {
                                          instancePath: e + "/objectId",
                                          schemaPath: "#/properties/objectId/type",
                                          keyword: "type",
                                          params: { type: "string" },
                                        },
                                      ]),
                                      !1
                                    );
                                var s = k === r;
                              } else var s = !0;
                              if (s) {
                                if (t.objectType !== void 0) {
                                  let p = t.objectType,
                                    k = r;
                                  if (!(
                                    p === "task" ||
                                    p === "holdings_snapshot" ||
                                    p === "watchlist_evidence" ||
                                    p === "channel_follows_evidence" ||
                                    p === "result_revision"
                                  ))
                                    return (
                                      (P.errors = [
                                        {
                                          instancePath: e + "/objectType",
                                          schemaPath: "#/properties/objectType/enum",
                                          keyword: "enum",
                                          params: { allowedValues: _e.properties.objectType.enum },
                                        },
                                      ]),
                                      !1
                                    );
                                  var s = k === r;
                                } else var s = !0;
                                if (s) {
                                  if (t.revision !== void 0) {
                                    let p = t.revision,
                                      k = r;
                                    if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                      return (
                                        (P.errors = [
                                          {
                                            instancePath: e + "/revision",
                                            schemaPath: "#/properties/revision/type",
                                            keyword: "type",
                                            params: { type: "integer" },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (r === k && typeof p == "number") {
                                      if (p > 9007199254740991 || isNaN(p))
                                        return (
                                          (P.errors = [
                                            {
                                              instancePath: e + "/revision",
                                              schemaPath: "#/properties/revision/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (p < 1 || isNaN(p))
                                        return (
                                          (P.errors = [
                                            {
                                              instancePath: e + "/revision",
                                              schemaPath: "#/properties/revision/minimum",
                                              keyword: "minimum",
                                              params: { comparison: ">=", limit: 1 },
                                            },
                                          ]),
                                          !1
                                        );
                                    }
                                    var s = k === r;
                                  } else var s = !0;
                                  if (s) {
                                    if (t.deliveryRevision !== void 0) {
                                      let p = t.deliveryRevision,
                                        k = r;
                                      if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                        return (
                                          (P.errors = [
                                            {
                                              instancePath: e + "/deliveryRevision",
                                              schemaPath: "#/properties/deliveryRevision/type",
                                              keyword: "type",
                                              params: { type: "integer" },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (r === k && typeof p == "number") {
                                        if (p > 9007199254740991 || isNaN(p))
                                          return (
                                            (P.errors = [
                                              {
                                                instancePath: e + "/deliveryRevision",
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
                                        if (p < 1 || isNaN(p))
                                          return (
                                            (P.errors = [
                                              {
                                                instancePath: e + "/deliveryRevision",
                                                schemaPath: "#/properties/deliveryRevision/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 1 },
                                              },
                                            ]),
                                            !1
                                          );
                                      }
                                      var s = k === r;
                                    } else var s = !0;
                                    if (s) {
                                      if (t.priorEnvelopeFingerprint !== void 0) {
                                        let p = t.priorEnvelopeFingerprint,
                                          k = r,
                                          A = r,
                                          b = !1,
                                          y = r;
                                        if (r === y)
                                          if (typeof p == "string") {
                                            if (g(p) > 64) {
                                              let R = {
                                                instancePath: e + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/maxLength",
                                                keyword: "maxLength",
                                                params: { limit: 64 },
                                              };
                                              (i === null ? (i = [R]) : i.push(R), r++);
                                            } else if (g(p) < 64) {
                                              let R = {
                                                instancePath: e + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/minLength",
                                                keyword: "minLength",
                                                params: { limit: 64 },
                                              };
                                              (i === null ? (i = [R]) : i.push(R), r++);
                                            } else if (!se.test(p)) {
                                              let R = {
                                                instancePath: e + "/priorEnvelopeFingerprint",
                                                schemaPath:
                                                  "#/properties/priorEnvelopeFingerprint/anyOf/0/pattern",
                                                keyword: "pattern",
                                                params: { pattern: "^[a-f0-9]{64}$" },
                                              };
                                              (i === null ? (i = [R]) : i.push(R), r++);
                                            }
                                          } else {
                                            let R = {
                                              instancePath: e + "/priorEnvelopeFingerprint",
                                              schemaPath:
                                                "#/properties/priorEnvelopeFingerprint/anyOf/0/type",
                                              keyword: "type",
                                              params: { type: "string" },
                                            };
                                            (i === null ? (i = [R]) : i.push(R), r++);
                                          }
                                        var d = y === r;
                                        b = b || d;
                                        let j = r;
                                        if (p !== null) {
                                          let R = {
                                            instancePath: e + "/priorEnvelopeFingerprint",
                                            schemaPath:
                                              "#/properties/priorEnvelopeFingerprint/anyOf/1/type",
                                            keyword: "type",
                                            params: { type: "null" },
                                          };
                                          (i === null ? (i = [R]) : i.push(R), r++);
                                        }
                                        var d = j === r;
                                        if (((b = b || d), b))
                                          ((r = A),
                                            i !== null && (A ? (i.length = A) : (i = null)));
                                        else {
                                          let R = {
                                            instancePath: e + "/priorEnvelopeFingerprint",
                                            schemaPath:
                                              "#/properties/priorEnvelopeFingerprint/anyOf",
                                            keyword: "anyOf",
                                            params: {},
                                          };
                                          return (
                                            i === null ? (i = [R]) : i.push(R),
                                            r++,
                                            (P.errors = i),
                                            !1
                                          );
                                        }
                                        var s = k === r;
                                      } else var s = !0;
                                      if (s) {
                                        if (t.expectedRevision !== void 0) {
                                          let p = t.expectedRevision,
                                            k = r;
                                          if (!(typeof p == "number" && !(p % 1) && !isNaN(p)))
                                            return (
                                              (P.errors = [
                                                {
                                                  instancePath: e + "/expectedRevision",
                                                  schemaPath: "#/properties/expectedRevision/type",
                                                  keyword: "type",
                                                  params: { type: "integer" },
                                                },
                                              ]),
                                              !1
                                            );
                                          if (r === k && typeof p == "number") {
                                            if (p > 9007199254740991 || isNaN(p))
                                              return (
                                                (P.errors = [
                                                  {
                                                    instancePath: e + "/expectedRevision",
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
                                            if (p < 0 || isNaN(p))
                                              return (
                                                (P.errors = [
                                                  {
                                                    instancePath: e + "/expectedRevision",
                                                    schemaPath:
                                                      "#/properties/expectedRevision/minimum",
                                                    keyword: "minimum",
                                                    params: { comparison: ">=", limit: 0 },
                                                  },
                                                ]),
                                                !1
                                              );
                                          }
                                          var s = k === r;
                                        } else var s = !0;
                                        if (s) {
                                          if (t.stableOperationId !== void 0) {
                                            let p = r;
                                            M(t.stableOperationId, {
                                              instancePath: e + "/stableOperationId",
                                              parentData: t,
                                              parentDataProperty: "stableOperationId",
                                              rootData: f,
                                              dynamicAnchors: u,
                                            }) ||
                                              ((i = i === null ? M.errors : i.concat(M.errors)),
                                              (r = i.length));
                                            var s = p === r;
                                          } else var s = !0;
                                          if (s) {
                                            if (t.operationType !== void 0) {
                                              let p = t.operationType,
                                                k = r;
                                              if (!(
                                                p === "create_task" ||
                                                p === "update_task" ||
                                                p === "transition_task" ||
                                                p === "commit_snapshot" ||
                                                p === "commit_evidence" ||
                                                p === "submit_result" ||
                                                p === "revise_result" ||
                                                p === "reshare_delivery"
                                              ))
                                                return (
                                                  (P.errors = [
                                                    {
                                                      instancePath: e + "/operationType",
                                                      schemaPath: "#/properties/operationType/enum",
                                                      keyword: "enum",
                                                      params: {
                                                        allowedValues:
                                                          _e.properties.operationType.enum,
                                                      },
                                                    },
                                                  ]),
                                                  !1
                                                );
                                              var s = k === r;
                                            } else var s = !0;
                                            if (s) {
                                              if (t.authorSigningKeyId !== void 0) {
                                                let p = t.authorSigningKeyId,
                                                  k = r;
                                                if (r === k)
                                                  if (typeof p == "string") {
                                                    if (g(p) > 43)
                                                      return (
                                                        (P.errors = [
                                                          {
                                                            instancePath: e + "/authorSigningKeyId",
                                                            schemaPath:
                                                              "#/properties/authorSigningKeyId/maxLength",
                                                            keyword: "maxLength",
                                                            params: { limit: 43 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (g(p) < 43)
                                                      return (
                                                        (P.errors = [
                                                          {
                                                            instancePath: e + "/authorSigningKeyId",
                                                            schemaPath:
                                                              "#/properties/authorSigningKeyId/minLength",
                                                            keyword: "minLength",
                                                            params: { limit: 43 },
                                                          },
                                                        ]),
                                                        !1
                                                      );
                                                    if (!te.test(p))
                                                      return (
                                                        (P.errors = [
                                                          {
                                                            instancePath: e + "/authorSigningKeyId",
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
                                                      (P.errors = [
                                                        {
                                                          instancePath: e + "/authorSigningKeyId",
                                                          schemaPath:
                                                            "#/properties/authorSigningKeyId/type",
                                                          keyword: "type",
                                                          params: { type: "string" },
                                                        },
                                                      ]),
                                                      !1
                                                    );
                                                var s = k === r;
                                              } else var s = !0;
                                              if (s) {
                                                if (t.binding !== void 0) {
                                                  let p = r;
                                                  N(t.binding, {
                                                    instancePath: e + "/binding",
                                                    parentData: t,
                                                    parentDataProperty: "binding",
                                                    rootData: f,
                                                    dynamicAnchors: u,
                                                  }) ||
                                                    ((i =
                                                      i === null ? N.errors : i.concat(N.errors)),
                                                    (r = i.length));
                                                  var s = p === r;
                                                } else var s = !0;
                                                if (s) {
                                                  if (t.resourceBindings !== void 0) {
                                                    let p = t.resourceBindings,
                                                      k = r;
                                                    if (r === k)
                                                      if (Array.isArray(p)) {
                                                        if (p.length > 10)
                                                          return (
                                                            (P.errors = [
                                                              {
                                                                instancePath:
                                                                  e + "/resourceBindings",
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
                                                            (P.errors = [
                                                              {
                                                                instancePath:
                                                                  e + "/resourceBindings",
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
                                                          let b = p.length;
                                                          for (let y = 0; y < b; y++) {
                                                            let j = r;
                                                            U(p[y], {
                                                              instancePath:
                                                                e + "/resourceBindings/" + y,
                                                              parentData: p,
                                                              parentDataProperty: y,
                                                              rootData: f,
                                                              dynamicAnchors: u,
                                                            }) ||
                                                              ((i =
                                                                i === null
                                                                  ? U.errors
                                                                  : i.concat(U.errors)),
                                                              (r = i.length));
                                                            var w = j === r;
                                                            if (!w) break;
                                                          }
                                                          if (w) {
                                                            let y = p.length,
                                                              j;
                                                            if (y > 1) {
                                                              e: for (; y--;)
                                                                for (j = y; j--;)
                                                                  if (Se(p[y], p[j])) {
                                                                    return (
                                                                      (P.errors = [
                                                                        {
                                                                          instancePath:
                                                                            e + "/resourceBindings",
                                                                          schemaPath:
                                                                            "#/properties/resourceBindings/uniqueItems",
                                                                          keyword: "uniqueItems",
                                                                          params: { i: y, j },
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
                                                          (P.errors = [
                                                            {
                                                              instancePath: e + "/resourceBindings",
                                                              schemaPath:
                                                                "#/properties/resourceBindings/type",
                                                              keyword: "type",
                                                              params: { type: "array" },
                                                            },
                                                          ]),
                                                          !1
                                                        );
                                                    var s = k === r;
                                                  } else var s = !0;
                                                  if (s)
                                                    if (t.recipients !== void 0) {
                                                      let p = t.recipients,
                                                        k = r;
                                                      if (r === k)
                                                        if (Array.isArray(p)) {
                                                          if (p.length > 8)
                                                            return (
                                                              (P.errors = [
                                                                {
                                                                  instancePath: e + "/recipients",
                                                                  schemaPath:
                                                                    "#/properties/recipients/maxItems",
                                                                  keyword: "maxItems",
                                                                  params: { limit: 8 },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          if (p.length < 1)
                                                            return (
                                                              (P.errors = [
                                                                {
                                                                  instancePath: e + "/recipients",
                                                                  schemaPath:
                                                                    "#/properties/recipients/minItems",
                                                                  keyword: "minItems",
                                                                  params: { limit: 1 },
                                                                },
                                                              ]),
                                                              !1
                                                            );
                                                          {
                                                            var l = !0;
                                                            let b = p.length;
                                                            for (let y = 0; y < b; y++) {
                                                              let j = r;
                                                              $(p[y], {
                                                                instancePath:
                                                                  e + "/recipients/" + y,
                                                                parentData: p,
                                                                parentDataProperty: y,
                                                                rootData: f,
                                                                dynamicAnchors: u,
                                                              }) ||
                                                                ((i =
                                                                  i === null
                                                                    ? $.errors
                                                                    : i.concat($.errors)),
                                                                (r = i.length));
                                                              var l = j === r;
                                                              if (!l) break;
                                                            }
                                                            if (l) {
                                                              let y = p.length,
                                                                j;
                                                              if (y > 1) {
                                                                e: for (; y--;)
                                                                  for (j = y; j--;)
                                                                    if (Se(p[y], p[j])) {
                                                                      return (
                                                                        (P.errors = [
                                                                          {
                                                                            instancePath:
                                                                              e + "/recipients",
                                                                            schemaPath:
                                                                              "#/properties/recipients/uniqueItems",
                                                                            keyword: "uniqueItems",
                                                                            params: { i: y, j },
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
                                                            (P.errors = [
                                                              {
                                                                instancePath: e + "/recipients",
                                                                schemaPath:
                                                                  "#/properties/recipients/type",
                                                                keyword: "type",
                                                                params: { type: "array" },
                                                              },
                                                            ]),
                                                            !1
                                                          );
                                                      var s = k === r;
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
          (P.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((P.errors = i), r === 0);
  }
  P.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function D(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = D.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let d;
        if (
          (t.kty === void 0 && (d = "kty")) ||
          (t.crv === void 0 && (d = "crv")) ||
          (t.x === void 0 && (d = "x")) ||
          (t.y === void 0 && (d = "y"))
        )
          return (
            (D.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: d },
              },
            ]),
            !1
          );
        {
          let w = r;
          for (let l in t)
            if (!(l === "kty" || l === "crv" || l === "x" || l === "y")) {
              return (
                (D.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === r) {
            if (t.kty !== void 0) {
              let l = r;
              if (t.kty !== "EC")
                return (
                  (D.errors = [
                    {
                      instancePath: e + "/kty",
                      schemaPath: "#/properties/kty/const",
                      keyword: "const",
                      params: { allowedValue: "EC" },
                    },
                  ]),
                  !1
                );
              var s = l === r;
            } else var s = !0;
            if (s) {
              if (t.crv !== void 0) {
                let l = r;
                if (t.crv !== "P-256")
                  return (
                    (D.errors = [
                      {
                        instancePath: e + "/crv",
                        schemaPath: "#/properties/crv/const",
                        keyword: "const",
                        params: { allowedValue: "P-256" },
                      },
                    ]),
                    !1
                  );
                var s = l === r;
              } else var s = !0;
              if (s) {
                if (t.x !== void 0) {
                  let l = t.x,
                    c = r;
                  if (r === c)
                    if (typeof l == "string") {
                      if (g(l) > 43)
                        return (
                          (D.errors = [
                            {
                              instancePath: e + "/x",
                              schemaPath: "#/properties/x/maxLength",
                              keyword: "maxLength",
                              params: { limit: 43 },
                            },
                          ]),
                          !1
                        );
                      if (g(l) < 43)
                        return (
                          (D.errors = [
                            {
                              instancePath: e + "/x",
                              schemaPath: "#/properties/x/minLength",
                              keyword: "minLength",
                              params: { limit: 43 },
                            },
                          ]),
                          !1
                        );
                      if (!te.test(l))
                        return (
                          (D.errors = [
                            {
                              instancePath: e + "/x",
                              schemaPath: "#/properties/x/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (D.errors = [
                          {
                            instancePath: e + "/x",
                            schemaPath: "#/properties/x/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = c === r;
                } else var s = !0;
                if (s)
                  if (t.y !== void 0) {
                    let l = t.y,
                      c = r;
                    if (r === c)
                      if (typeof l == "string") {
                        if (g(l) > 43)
                          return (
                            (D.errors = [
                              {
                                instancePath: e + "/y",
                                schemaPath: "#/properties/y/maxLength",
                                keyword: "maxLength",
                                params: { limit: 43 },
                              },
                            ]),
                            !1
                          );
                        if (g(l) < 43)
                          return (
                            (D.errors = [
                              {
                                instancePath: e + "/y",
                                schemaPath: "#/properties/y/minLength",
                                keyword: "minLength",
                                params: { limit: 43 },
                              },
                            ]),
                            !1
                          );
                        if (!te.test(l))
                          return (
                            (D.errors = [
                              {
                                instancePath: e + "/y",
                                schemaPath: "#/properties/y/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (D.errors = [
                            {
                              instancePath: e + "/y",
                              schemaPath: "#/properties/y/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = c === r;
                  } else var s = !0;
              }
            }
          }
        }
      } else
        return (
          (D.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((D.errors = i), r === 0);
  }
  D.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function F(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = F.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let w;
        if (
          (t.header === void 0 && (w = "header")) ||
          (t.encrypted_key === void 0 && (w = "encrypted_key"))
        )
          return (
            (F.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let l = r;
          for (let c in t)
            if (!(c === "header" || c === "encrypted_key")) {
              return (
                (F.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (l === r) {
            if (t.header !== void 0) {
              let c = t.header,
                _ = r;
              if (r === _)
                if (c && typeof c == "object" && !Array.isArray(c)) {
                  let p;
                  if ((c.kid === void 0 && (p = "kid")) || (c.epk === void 0 && (p = "epk")))
                    return (
                      (F.errors = [
                        {
                          instancePath: e + "/header",
                          schemaPath: "#/properties/header/required",
                          keyword: "required",
                          params: { missingProperty: p },
                        },
                      ]),
                      !1
                    );
                  {
                    let k = r;
                    for (let A in c)
                      if (!(A === "kid" || A === "epk")) {
                        return (
                          (F.errors = [
                            {
                              instancePath: e + "/header",
                              schemaPath: "#/properties/header/additionalProperties",
                              keyword: "additionalProperties",
                              params: { additionalProperty: A },
                            },
                          ]),
                          !1
                        );
                        break;
                      }
                    if (k === r) {
                      if (c.kid !== void 0) {
                        let A = c.kid,
                          b = r;
                        if (r === b)
                          if (typeof A == "string") {
                            if (g(A) > 43)
                              return (
                                (F.errors = [
                                  {
                                    instancePath: e + "/header/kid",
                                    schemaPath: "#/properties/header/properties/kid/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 43 },
                                  },
                                ]),
                                !1
                              );
                            if (g(A) < 43)
                              return (
                                (F.errors = [
                                  {
                                    instancePath: e + "/header/kid",
                                    schemaPath: "#/properties/header/properties/kid/minLength",
                                    keyword: "minLength",
                                    params: { limit: 43 },
                                  },
                                ]),
                                !1
                              );
                            if (!te.test(A))
                              return (
                                (F.errors = [
                                  {
                                    instancePath: e + "/header/kid",
                                    schemaPath: "#/properties/header/properties/kid/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[A-Za-z0-9_-]{43}$" },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (F.errors = [
                                {
                                  instancePath: e + "/header/kid",
                                  schemaPath: "#/properties/header/properties/kid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var s = b === r;
                      } else var s = !0;
                      if (s)
                        if (c.epk !== void 0) {
                          let A = r;
                          D(c.epk, {
                            instancePath: e + "/header/epk",
                            parentData: c,
                            parentDataProperty: "epk",
                            rootData: f,
                            dynamicAnchors: u,
                          }) || ((i = i === null ? D.errors : i.concat(D.errors)), (r = i.length));
                          var s = A === r;
                        } else var s = !0;
                    }
                  }
                } else
                  return (
                    (F.errors = [
                      {
                        instancePath: e + "/header",
                        schemaPath: "#/properties/header/type",
                        keyword: "type",
                        params: { type: "object" },
                      },
                    ]),
                    !1
                  );
              var d = _ === r;
            } else var d = !0;
            if (d)
              if (t.encrypted_key !== void 0) {
                let c = t.encrypted_key,
                  _ = r;
                if (r === _)
                  if (typeof c == "string") {
                    if (g(c) > 54)
                      return (
                        (F.errors = [
                          {
                            instancePath: e + "/encrypted_key",
                            schemaPath: "#/properties/encrypted_key/maxLength",
                            keyword: "maxLength",
                            params: { limit: 54 },
                          },
                        ]),
                        !1
                      );
                    if (g(c) < 54)
                      return (
                        (F.errors = [
                          {
                            instancePath: e + "/encrypted_key",
                            schemaPath: "#/properties/encrypted_key/minLength",
                            keyword: "minLength",
                            params: { limit: 54 },
                          },
                        ]),
                        !1
                      );
                    if (!G.test(c))
                      return (
                        (F.errors = [
                          {
                            instancePath: e + "/encrypted_key",
                            schemaPath: "#/properties/encrypted_key/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9_-]+$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (F.errors = [
                        {
                          instancePath: e + "/encrypted_key",
                          schemaPath: "#/properties/encrypted_key/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var d = _ === r;
              } else var d = !0;
          }
        }
      } else
        return (
          (F.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((F.errors = i), r === 0);
  }
  F.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function z(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = z.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let w;
        if (
          (t.protected === void 0 && (w = "protected")) ||
          (t.recipients === void 0 && (w = "recipients")) ||
          (t.iv === void 0 && (w = "iv")) ||
          (t.ciphertext === void 0 && (w = "ciphertext")) ||
          (t.tag === void 0 && (w = "tag")) ||
          (t.aad === void 0 && (w = "aad"))
        )
          return (
            (z.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: w },
              },
            ]),
            !1
          );
        {
          let l = r;
          for (let c in t)
            if (!(
              c === "protected" ||
              c === "recipients" ||
              c === "iv" ||
              c === "ciphertext" ||
              c === "tag" ||
              c === "aad"
            )) {
              return (
                (z.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: c },
                  },
                ]),
                !1
              );
              break;
            }
          if (l === r) {
            if (t.protected !== void 0) {
              let c = t.protected,
                _ = r;
              if (r === _)
                if (typeof c == "string") {
                  if (g(c) > 1024)
                    return (
                      (z.errors = [
                        {
                          instancePath: e + "/protected",
                          schemaPath: "#/properties/protected/maxLength",
                          keyword: "maxLength",
                          params: { limit: 1024 },
                        },
                      ]),
                      !1
                    );
                  if (g(c) < 1)
                    return (
                      (z.errors = [
                        {
                          instancePath: e + "/protected",
                          schemaPath: "#/properties/protected/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ]),
                      !1
                    );
                  if (!G.test(c))
                    return (
                      (z.errors = [
                        {
                          instancePath: e + "/protected",
                          schemaPath: "#/properties/protected/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[A-Za-z0-9_-]+$" },
                        },
                      ]),
                      !1
                    );
                } else
                  return (
                    (z.errors = [
                      {
                        instancePath: e + "/protected",
                        schemaPath: "#/properties/protected/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ]),
                    !1
                  );
              var s = _ === r;
            } else var s = !0;
            if (s) {
              if (t.recipients !== void 0) {
                let c = t.recipients,
                  _ = r;
                if (r === _)
                  if (Array.isArray(c)) {
                    if (c.length > 8)
                      return (
                        (z.errors = [
                          {
                            instancePath: e + "/recipients",
                            schemaPath: "#/properties/recipients/maxItems",
                            keyword: "maxItems",
                            params: { limit: 8 },
                          },
                        ]),
                        !1
                      );
                    if (c.length < 1)
                      return (
                        (z.errors = [
                          {
                            instancePath: e + "/recipients",
                            schemaPath: "#/properties/recipients/minItems",
                            keyword: "minItems",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    {
                      var d = !0;
                      let k = c.length;
                      for (let A = 0; A < k; A++) {
                        let b = r;
                        F(c[A], {
                          instancePath: e + "/recipients/" + A,
                          parentData: c,
                          parentDataProperty: A,
                          rootData: f,
                          dynamicAnchors: u,
                        }) || ((i = i === null ? F.errors : i.concat(F.errors)), (r = i.length));
                        var d = b === r;
                        if (!d) break;
                      }
                    }
                  } else
                    return (
                      (z.errors = [
                        {
                          instancePath: e + "/recipients",
                          schemaPath: "#/properties/recipients/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ]),
                      !1
                    );
                var s = _ === r;
              } else var s = !0;
              if (s) {
                if (t.iv !== void 0) {
                  let c = t.iv,
                    _ = r;
                  if (r === _)
                    if (typeof c == "string") {
                      if (g(c) > 16)
                        return (
                          (z.errors = [
                            {
                              instancePath: e + "/iv",
                              schemaPath: "#/properties/iv/maxLength",
                              keyword: "maxLength",
                              params: { limit: 16 },
                            },
                          ]),
                          !1
                        );
                      if (g(c) < 16)
                        return (
                          (z.errors = [
                            {
                              instancePath: e + "/iv",
                              schemaPath: "#/properties/iv/minLength",
                              keyword: "minLength",
                              params: { limit: 16 },
                            },
                          ]),
                          !1
                        );
                      if (!G.test(c))
                        return (
                          (z.errors = [
                            {
                              instancePath: e + "/iv",
                              schemaPath: "#/properties/iv/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9_-]+$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (z.errors = [
                          {
                            instancePath: e + "/iv",
                            schemaPath: "#/properties/iv/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = _ === r;
                } else var s = !0;
                if (s) {
                  if (t.ciphertext !== void 0) {
                    let c = t.ciphertext,
                      _ = r;
                    if (r === _)
                      if (typeof c == "string") {
                        if (g(c) > 262144)
                          return (
                            (z.errors = [
                              {
                                instancePath: e + "/ciphertext",
                                schemaPath: "#/properties/ciphertext/maxLength",
                                keyword: "maxLength",
                                params: { limit: 262144 },
                              },
                            ]),
                            !1
                          );
                        if (g(c) < 1)
                          return (
                            (z.errors = [
                              {
                                instancePath: e + "/ciphertext",
                                schemaPath: "#/properties/ciphertext/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!G.test(c))
                          return (
                            (z.errors = [
                              {
                                instancePath: e + "/ciphertext",
                                schemaPath: "#/properties/ciphertext/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9_-]+$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (z.errors = [
                            {
                              instancePath: e + "/ciphertext",
                              schemaPath: "#/properties/ciphertext/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = _ === r;
                  } else var s = !0;
                  if (s) {
                    if (t.tag !== void 0) {
                      let c = t.tag,
                        _ = r;
                      if (r === _)
                        if (typeof c == "string") {
                          if (g(c) > 22)
                            return (
                              (z.errors = [
                                {
                                  instancePath: e + "/tag",
                                  schemaPath: "#/properties/tag/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 22 },
                                },
                              ]),
                              !1
                            );
                          if (g(c) < 22)
                            return (
                              (z.errors = [
                                {
                                  instancePath: e + "/tag",
                                  schemaPath: "#/properties/tag/minLength",
                                  keyword: "minLength",
                                  params: { limit: 22 },
                                },
                              ]),
                              !1
                            );
                          if (!G.test(c))
                            return (
                              (z.errors = [
                                {
                                  instancePath: e + "/tag",
                                  schemaPath: "#/properties/tag/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9_-]+$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (z.errors = [
                              {
                                instancePath: e + "/tag",
                                schemaPath: "#/properties/tag/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = _ === r;
                    } else var s = !0;
                    if (s)
                      if (t.aad !== void 0) {
                        let c = t.aad,
                          _ = r;
                        if (r === _)
                          if (typeof c == "string") {
                            if (g(c) > 21846)
                              return (
                                (z.errors = [
                                  {
                                    instancePath: e + "/aad",
                                    schemaPath: "#/properties/aad/maxLength",
                                    keyword: "maxLength",
                                    params: { limit: 21846 },
                                  },
                                ]),
                                !1
                              );
                            if (g(c) < 1)
                              return (
                                (z.errors = [
                                  {
                                    instancePath: e + "/aad",
                                    schemaPath: "#/properties/aad/minLength",
                                    keyword: "minLength",
                                    params: { limit: 1 },
                                  },
                                ]),
                                !1
                              );
                            if (!G.test(c))
                              return (
                                (z.errors = [
                                  {
                                    instancePath: e + "/aad",
                                    schemaPath: "#/properties/aad/pattern",
                                    keyword: "pattern",
                                    params: { pattern: "^[A-Za-z0-9_-]+$" },
                                  },
                                ]),
                                !1
                              );
                          } else
                            return (
                              (z.errors = [
                                {
                                  instancePath: e + "/aad",
                                  schemaPath: "#/properties/aad/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                },
                              ]),
                              !1
                            );
                        var s = _ === r;
                      } else var s = !0;
                  }
                }
              }
            }
          }
        }
      } else
        return (
          (z.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((z.errors = i), r === 0);
  }
  z.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function Q(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = Q.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let d;
        if ((t.context === void 0 && (d = "context")) || (t.jwe === void 0 && (d = "jwe")))
          return (
            (Q.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: d },
              },
            ]),
            !1
          );
        {
          let w = r;
          for (let l in t)
            if (!(l === "context" || l === "jwe")) {
              return (
                (Q.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === r) {
            if (t.context !== void 0) {
              let l = r;
              P(t.context, {
                instancePath: e + "/context",
                parentData: t,
                parentDataProperty: "context",
                rootData: f,
                dynamicAnchors: u,
              }) || ((i = i === null ? P.errors : i.concat(P.errors)), (r = i.length));
              var s = l === r;
            } else var s = !0;
            if (s)
              if (t.jwe !== void 0) {
                let l = r;
                z(t.jwe, {
                  instancePath: e + "/jwe",
                  parentData: t,
                  parentDataProperty: "jwe",
                  rootData: f,
                  dynamicAnchors: u,
                }) || ((i = i === null ? z.errors : i.concat(z.errors)), (r = i.length));
                var s = l === r;
              } else var s = !0;
          }
        }
      } else
        return (
          (Q.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((Q.errors = i), r === 0);
  }
  Q.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function le(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = le.evaluated;
    return (
      h.dynamicProps && (h.props = void 0),
      h.dynamicItems && (h.items = void 0),
      Q(t, {
        instancePath: e,
        parentData: a,
        parentDataProperty: n,
        rootData: f,
        dynamicAnchors: u,
      }) || ((i = i === null ? Q.errors : i.concat(Q.errors)), (r = i.length)),
      (le.errors = i),
      r === 0
    );
  }
  le.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  fe.ResultReceipt = ce;
  var rr = {
      type: "object",
      properties: {
        contractVersion: { const: "folioview.agent-workspace.v2.0" },
        vaultId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        runId: {
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
        resultId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
        },
        revision: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        deliveryRevision: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        stableOperationId: { $ref: "#/$defs/OperationIdentifier" },
        envelopeFingerprint: {
          type: "string",
          minLength: 64,
          maxLength: 64,
          pattern: "^[a-f0-9]{64}$",
        },
        receivedAt: {
          type: "string",
          minLength: 1,
          maxLength: 40,
          format: "date-time",
          pattern: "Z$",
        },
        resultPath: {
          type: "string",
          minLength: 1,
          maxLength: 256,
          pattern: "^/results/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\?revision=[1-9][0-9]*$",
        },
      },
      required: [
        "contractVersion",
        "vaultId",
        "runId",
        "taskId",
        "resultId",
        "revision",
        "deliveryRevision",
        "stableOperationId",
        "envelopeFingerprint",
        "receivedAt",
        "resultPath",
      ],
      additionalProperties: !1,
    },
    tr = new RegExp("Z$", "u"),
    ir = new RegExp("^/results/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\?revision=[1-9][0-9]*$", "u"),
    sr = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  function L(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = L.evaluated;
    if ((h.dynamicProps && (h.props = void 0), h.dynamicItems && (h.items = void 0), r === 0))
      if (t && typeof t == "object" && !Array.isArray(t)) {
        let d;
        if (
          (t.contractVersion === void 0 && (d = "contractVersion")) ||
          (t.vaultId === void 0 && (d = "vaultId")) ||
          (t.runId === void 0 && (d = "runId")) ||
          (t.taskId === void 0 && (d = "taskId")) ||
          (t.resultId === void 0 && (d = "resultId")) ||
          (t.revision === void 0 && (d = "revision")) ||
          (t.deliveryRevision === void 0 && (d = "deliveryRevision")) ||
          (t.stableOperationId === void 0 && (d = "stableOperationId")) ||
          (t.envelopeFingerprint === void 0 && (d = "envelopeFingerprint")) ||
          (t.receivedAt === void 0 && (d = "receivedAt")) ||
          (t.resultPath === void 0 && (d = "resultPath"))
        )
          return (
            (L.errors = [
              {
                instancePath: e,
                schemaPath: "#/required",
                keyword: "required",
                params: { missingProperty: d },
              },
            ]),
            !1
          );
        {
          let w = r;
          for (let l in t)
            if (!xe.call(rr.properties, l)) {
              return (
                (L.errors = [
                  {
                    instancePath: e,
                    schemaPath: "#/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: l },
                  },
                ]),
                !1
              );
              break;
            }
          if (w === r) {
            if (t.contractVersion !== void 0) {
              let l = r;
              if (t.contractVersion !== "folioview.agent-workspace.v2.0")
                return (
                  (L.errors = [
                    {
                      instancePath: e + "/contractVersion",
                      schemaPath: "#/properties/contractVersion/const",
                      keyword: "const",
                      params: { allowedValue: "folioview.agent-workspace.v2.0" },
                    },
                  ]),
                  !1
                );
              var s = l === r;
            } else var s = !0;
            if (s) {
              if (t.vaultId !== void 0) {
                let l = t.vaultId,
                  c = r;
                if (r === c)
                  if (typeof l == "string") {
                    if (g(l) > 128)
                      return (
                        (L.errors = [
                          {
                            instancePath: e + "/vaultId",
                            schemaPath: "#/properties/vaultId/maxLength",
                            keyword: "maxLength",
                            params: { limit: 128 },
                          },
                        ]),
                        !1
                      );
                    if (g(l) < 1)
                      return (
                        (L.errors = [
                          {
                            instancePath: e + "/vaultId",
                            schemaPath: "#/properties/vaultId/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          },
                        ]),
                        !1
                      );
                    if (!K.test(l))
                      return (
                        (L.errors = [
                          {
                            instancePath: e + "/vaultId",
                            schemaPath: "#/properties/vaultId/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                          },
                        ]),
                        !1
                      );
                  } else
                    return (
                      (L.errors = [
                        {
                          instancePath: e + "/vaultId",
                          schemaPath: "#/properties/vaultId/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ]),
                      !1
                    );
                var s = c === r;
              } else var s = !0;
              if (s) {
                if (t.runId !== void 0) {
                  let l = t.runId,
                    c = r;
                  if (r === c)
                    if (typeof l == "string") {
                      if (g(l) > 128)
                        return (
                          (L.errors = [
                            {
                              instancePath: e + "/runId",
                              schemaPath: "#/properties/runId/maxLength",
                              keyword: "maxLength",
                              params: { limit: 128 },
                            },
                          ]),
                          !1
                        );
                      if (g(l) < 1)
                        return (
                          (L.errors = [
                            {
                              instancePath: e + "/runId",
                              schemaPath: "#/properties/runId/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ]),
                          !1
                        );
                      if (!K.test(l))
                        return (
                          (L.errors = [
                            {
                              instancePath: e + "/runId",
                              schemaPath: "#/properties/runId/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                            },
                          ]),
                          !1
                        );
                    } else
                      return (
                        (L.errors = [
                          {
                            instancePath: e + "/runId",
                            schemaPath: "#/properties/runId/type",
                            keyword: "type",
                            params: { type: "string" },
                          },
                        ]),
                        !1
                      );
                  var s = c === r;
                } else var s = !0;
                if (s) {
                  if (t.taskId !== void 0) {
                    let l = t.taskId,
                      c = r;
                    if (r === c)
                      if (typeof l == "string") {
                        if (g(l) > 128)
                          return (
                            (L.errors = [
                              {
                                instancePath: e + "/taskId",
                                schemaPath: "#/properties/taskId/maxLength",
                                keyword: "maxLength",
                                params: { limit: 128 },
                              },
                            ]),
                            !1
                          );
                        if (g(l) < 1)
                          return (
                            (L.errors = [
                              {
                                instancePath: e + "/taskId",
                                schemaPath: "#/properties/taskId/minLength",
                                keyword: "minLength",
                                params: { limit: 1 },
                              },
                            ]),
                            !1
                          );
                        if (!K.test(l))
                          return (
                            (L.errors = [
                              {
                                instancePath: e + "/taskId",
                                schemaPath: "#/properties/taskId/pattern",
                                keyword: "pattern",
                                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                              },
                            ]),
                            !1
                          );
                      } else
                        return (
                          (L.errors = [
                            {
                              instancePath: e + "/taskId",
                              schemaPath: "#/properties/taskId/type",
                              keyword: "type",
                              params: { type: "string" },
                            },
                          ]),
                          !1
                        );
                    var s = c === r;
                  } else var s = !0;
                  if (s) {
                    if (t.resultId !== void 0) {
                      let l = t.resultId,
                        c = r;
                      if (r === c)
                        if (typeof l == "string") {
                          if (g(l) > 128)
                            return (
                              (L.errors = [
                                {
                                  instancePath: e + "/resultId",
                                  schemaPath: "#/properties/resultId/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 128 },
                                },
                              ]),
                              !1
                            );
                          if (g(l) < 1)
                            return (
                              (L.errors = [
                                {
                                  instancePath: e + "/resultId",
                                  schemaPath: "#/properties/resultId/minLength",
                                  keyword: "minLength",
                                  params: { limit: 1 },
                                },
                              ]),
                              !1
                            );
                          if (!K.test(l))
                            return (
                              (L.errors = [
                                {
                                  instancePath: e + "/resultId",
                                  schemaPath: "#/properties/resultId/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
                                },
                              ]),
                              !1
                            );
                        } else
                          return (
                            (L.errors = [
                              {
                                instancePath: e + "/resultId",
                                schemaPath: "#/properties/resultId/type",
                                keyword: "type",
                                params: { type: "string" },
                              },
                            ]),
                            !1
                          );
                      var s = c === r;
                    } else var s = !0;
                    if (s) {
                      if (t.revision !== void 0) {
                        let l = t.revision,
                          c = r;
                        if (!(typeof l == "number" && !(l % 1) && !isNaN(l)))
                          return (
                            (L.errors = [
                              {
                                instancePath: e + "/revision",
                                schemaPath: "#/properties/revision/type",
                                keyword: "type",
                                params: { type: "integer" },
                              },
                            ]),
                            !1
                          );
                        if (r === c && typeof l == "number") {
                          if (l > 9007199254740991 || isNaN(l))
                            return (
                              (L.errors = [
                                {
                                  instancePath: e + "/revision",
                                  schemaPath: "#/properties/revision/maximum",
                                  keyword: "maximum",
                                  params: { comparison: "<=", limit: 9007199254740991 },
                                },
                              ]),
                              !1
                            );
                          if (l < 1 || isNaN(l))
                            return (
                              (L.errors = [
                                {
                                  instancePath: e + "/revision",
                                  schemaPath: "#/properties/revision/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ]),
                              !1
                            );
                        }
                        var s = c === r;
                      } else var s = !0;
                      if (s) {
                        if (t.deliveryRevision !== void 0) {
                          let l = t.deliveryRevision,
                            c = r;
                          if (!(typeof l == "number" && !(l % 1) && !isNaN(l)))
                            return (
                              (L.errors = [
                                {
                                  instancePath: e + "/deliveryRevision",
                                  schemaPath: "#/properties/deliveryRevision/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                },
                              ]),
                              !1
                            );
                          if (r === c && typeof l == "number") {
                            if (l > 9007199254740991 || isNaN(l))
                              return (
                                (L.errors = [
                                  {
                                    instancePath: e + "/deliveryRevision",
                                    schemaPath: "#/properties/deliveryRevision/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  },
                                ]),
                                !1
                              );
                            if (l < 1 || isNaN(l))
                              return (
                                (L.errors = [
                                  {
                                    instancePath: e + "/deliveryRevision",
                                    schemaPath: "#/properties/deliveryRevision/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  },
                                ]),
                                !1
                              );
                          }
                          var s = c === r;
                        } else var s = !0;
                        if (s) {
                          if (t.stableOperationId !== void 0) {
                            let l = r;
                            M(t.stableOperationId, {
                              instancePath: e + "/stableOperationId",
                              parentData: t,
                              parentDataProperty: "stableOperationId",
                              rootData: f,
                              dynamicAnchors: u,
                            }) ||
                              ((i = i === null ? M.errors : i.concat(M.errors)), (r = i.length));
                            var s = l === r;
                          } else var s = !0;
                          if (s) {
                            if (t.envelopeFingerprint !== void 0) {
                              let l = t.envelopeFingerprint,
                                c = r;
                              if (r === c)
                                if (typeof l == "string") {
                                  if (g(l) > 64)
                                    return (
                                      (L.errors = [
                                        {
                                          instancePath: e + "/envelopeFingerprint",
                                          schemaPath: "#/properties/envelopeFingerprint/maxLength",
                                          keyword: "maxLength",
                                          params: { limit: 64 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (g(l) < 64)
                                    return (
                                      (L.errors = [
                                        {
                                          instancePath: e + "/envelopeFingerprint",
                                          schemaPath: "#/properties/envelopeFingerprint/minLength",
                                          keyword: "minLength",
                                          params: { limit: 64 },
                                        },
                                      ]),
                                      !1
                                    );
                                  if (!se.test(l))
                                    return (
                                      (L.errors = [
                                        {
                                          instancePath: e + "/envelopeFingerprint",
                                          schemaPath: "#/properties/envelopeFingerprint/pattern",
                                          keyword: "pattern",
                                          params: { pattern: "^[a-f0-9]{64}$" },
                                        },
                                      ]),
                                      !1
                                    );
                                } else
                                  return (
                                    (L.errors = [
                                      {
                                        instancePath: e + "/envelopeFingerprint",
                                        schemaPath: "#/properties/envelopeFingerprint/type",
                                        keyword: "type",
                                        params: { type: "string" },
                                      },
                                    ]),
                                    !1
                                  );
                              var s = c === r;
                            } else var s = !0;
                            if (s) {
                              if (t.receivedAt !== void 0) {
                                let l = t.receivedAt,
                                  c = r;
                                if (r === c && r === c)
                                  if (typeof l == "string") {
                                    if (g(l) > 40)
                                      return (
                                        (L.errors = [
                                          {
                                            instancePath: e + "/receivedAt",
                                            schemaPath: "#/properties/receivedAt/maxLength",
                                            keyword: "maxLength",
                                            params: { limit: 40 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (g(l) < 1)
                                      return (
                                        (L.errors = [
                                          {
                                            instancePath: e + "/receivedAt",
                                            schemaPath: "#/properties/receivedAt/minLength",
                                            keyword: "minLength",
                                            params: { limit: 1 },
                                          },
                                        ]),
                                        !1
                                      );
                                    if (tr.test(l)) {
                                      if (!sr.test(l))
                                        return (
                                          (L.errors = [
                                            {
                                              instancePath: e + "/receivedAt",
                                              schemaPath: "#/properties/receivedAt/format",
                                              keyword: "format",
                                              params: { format: "date-time" },
                                            },
                                          ]),
                                          !1
                                        );
                                    } else
                                      return (
                                        (L.errors = [
                                          {
                                            instancePath: e + "/receivedAt",
                                            schemaPath: "#/properties/receivedAt/pattern",
                                            keyword: "pattern",
                                            params: { pattern: "Z$" },
                                          },
                                        ]),
                                        !1
                                      );
                                  } else
                                    return (
                                      (L.errors = [
                                        {
                                          instancePath: e + "/receivedAt",
                                          schemaPath: "#/properties/receivedAt/type",
                                          keyword: "type",
                                          params: { type: "string" },
                                        },
                                      ]),
                                      !1
                                    );
                                var s = c === r;
                              } else var s = !0;
                              if (s)
                                if (t.resultPath !== void 0) {
                                  let l = t.resultPath,
                                    c = r;
                                  if (r === c)
                                    if (typeof l == "string") {
                                      if (g(l) > 256)
                                        return (
                                          (L.errors = [
                                            {
                                              instancePath: e + "/resultPath",
                                              schemaPath: "#/properties/resultPath/maxLength",
                                              keyword: "maxLength",
                                              params: { limit: 256 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (g(l) < 1)
                                        return (
                                          (L.errors = [
                                            {
                                              instancePath: e + "/resultPath",
                                              schemaPath: "#/properties/resultPath/minLength",
                                              keyword: "minLength",
                                              params: { limit: 1 },
                                            },
                                          ]),
                                          !1
                                        );
                                      if (!ir.test(l))
                                        return (
                                          (L.errors = [
                                            {
                                              instancePath: e + "/resultPath",
                                              schemaPath: "#/properties/resultPath/pattern",
                                              keyword: "pattern",
                                              params: {
                                                pattern:
                                                  "^/results/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\?revision=[1-9][0-9]*$",
                                              },
                                            },
                                          ]),
                                          !1
                                        );
                                    } else
                                      return (
                                        (L.errors = [
                                          {
                                            instancePath: e + "/resultPath",
                                            schemaPath: "#/properties/resultPath/type",
                                            keyword: "type",
                                            params: { type: "string" },
                                          },
                                        ]),
                                        !1
                                      );
                                  var s = c === r;
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
      } else
        return (
          (L.errors = [
            { instancePath: e, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
          ]),
          !1
        );
    return ((L.errors = i), r === 0);
  }
  L.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
  function ce(
    t,
    {
      instancePath: e = "",
      parentData: a,
      parentDataProperty: n,
      rootData: f = t,
      dynamicAnchors: u = {},
    } = {},
  ) {
    let i = null,
      r = 0,
      h = ce.evaluated;
    return (
      h.dynamicProps && (h.props = void 0),
      h.dynamicItems && (h.items = void 0),
      L(t, {
        instancePath: e,
        parentData: a,
        parentDataProperty: n,
        rootData: f,
        dynamicAnchors: u,
      }) || ((i = i === null ? L.errors : i.concat(L.errors)), (r = i.length)),
      (ce.errors = i),
      r === 0
    );
  }
  ce.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
});
function ke(t) {
  if (!t.isWellFormed()) throw new Error("Lone surrogate is not allowed");
  return JSON.stringify(t);
}
function oe(t) {
  switch (typeof t) {
    case "number":
      if (isNaN(t)) throw new Error("NaN is not allowed");
      if (!isFinite(t)) throw new Error("Infinity is not allowed");
      return JSON.stringify(t);
    case "string":
      return ke(t);
    case "boolean":
      return t ? "true" : "false";
    default:
      return JSON.stringify(t);
  }
}
function ve(t, e) {
  let a = null;
  for (; t !== null && typeof t == "object" && typeof t.toJSON == "function";) {
    if (e.has(t)) throw new Error("Circular reference detected");
    (e.add(t), (a ??= []).push(t), (t = t.toJSON()));
  }
  if (
    ((t instanceof Number || t instanceof String || t instanceof Boolean) && (t = t.valueOf()),
    t === null || typeof t != "object")
  ) {
    if (a !== null) for (let n of a) e.delete(n);
    return oe(t);
  }
  if (e.has(t)) throw new Error("Circular reference detected");
  return (
    e.add(t),
    {
      container: t,
      keys: Array.isArray(t) ? null : Object.keys(t).sort(),
      index: 0,
      first: !0,
      wrappers: a,
    }
  );
}
function we(t) {
  if (t === null || typeof t != "object") return oe(t);
  let e = new Set(),
    a = ve(t, e);
  if (typeof a != "object") return a;
  let n = a.keys === null ? "[" : "{",
    f = [a];
  e: for (; f.length > 0;) {
    let u = f[f.length - 1],
      i = u.container;
    if (u.keys === null) {
      for (; u.index < i.length;) {
        let r = u.index++;
        r > 0 && (n += ",");
        let h = i[r],
          s = h === void 0 || typeof h == "symbol" || typeof h == "function" ? null : h;
        if (s === null || typeof s != "object") {
          n += oe(s);
          continue;
        }
        let d = ve(s, e);
        if (typeof d != "object") {
          n += d === void 0 ? "null" : d;
          continue;
        }
        ((n += d.keys === null ? "[" : "{"), f.push(d));
        continue e;
      }
      n += "]";
    } else {
      let r = u.keys;
      for (; u.index < r.length;) {
        let h = r[u.index++],
          s = i[h];
        if (s === void 0 || typeof s == "symbol" || typeof s == "function") continue;
        if (s === null || typeof s != "object") {
          (u.first ? (u.first = !1) : (n += ","), (n += ke(h) + ":" + oe(s)));
          continue;
        }
        let d = ve(s, e);
        if (d !== void 0) {
          if ((u.first ? (u.first = !1) : (n += ","), (n += ke(h) + ":"), typeof d != "object")) {
            n += d;
            continue;
          }
          ((n += d.keys === null ? "[" : "{"), f.push(d));
          continue e;
        }
      }
      n += "}";
    }
    if ((e.delete(i), u.wrappers !== null)) for (let r of u.wrappers) e.delete(r);
    f.pop();
  }
  return n;
}
var Ve = Ye(Ne(), 1),
  X = "folioview.agent-workspace.v2.0",
  he = "folioview.foreground-controller.v1",
  Te = new TextEncoder(),
  nr = new TextDecoder("utf-8", { fatal: !0 }),
  B = class extends Error {
    constructor(e = "controller_rejected") {
      (super(e), (this.code = e));
    }
  };
function I(t) {
  throw new B(t);
}
function W(t, e) {
  (!t ||
    typeof t != "object" ||
    Array.isArray(t) ||
    Object.keys(t).sort().join("\0") !== [...e].sort().join("\0")) &&
    I("invalid_fields");
}
function V(t) {
  return (
    (typeof t != "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(t)) &&
      I("invalid_identifier"),
    t
  );
}
function J(t) {
  let e;
  try {
    e = we(t);
  } catch {
    I("invalid_json");
  }
  return (typeof e != "string" && I("invalid_json"), e);
}
function ie(t, e = 1048576) {
  let a = J(t);
  return (Te.encode(a).length > e && I("payload_too_large"), a);
}
function be(t, e) {
  Ve.default[t]?.(e) || I("invalid_record");
}
function Ce(t) {
  (typeof t != "string" || !/^[A-Za-z0-9_-]+$/.test(t) || t.length > 786432) && I("invalid_record");
  let e;
  try {
    let n = atob(t.replaceAll("-", "+").replaceAll("_", "/"));
    e = Uint8Array.from(n, (f) => f.charCodeAt(0));
  } catch {
    I("invalid_record");
  }
  let a = "";
  for (let n of e) a += String.fromCharCode(n);
  return (
    btoa(a).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") !== t &&
      I("invalid_record"),
    e
  );
}
function qe(t, e = !1) {
  try {
    let a = nr.decode(Ce(t)),
      n = JSON.parse(a);
    return ((e ? J(n) : JSON.stringify(n)) !== a && I("invalid_record"), n);
  } catch {
    I("invalid_record");
  }
}
async function ar(t) {
  let e = await crypto.subtle.digest(
    "SHA-256",
    Te.encode(t.signedObject.protected + "." + t.signedObject.payload),
  );
  return [...new Uint8Array(e)].map((a) => a.toString(16).padStart(2, "0")).join("");
}
function me(t) {
  W(t, ["ownerSubject", "vaultId", "connectionId", "agentPrincipalId", "taskId"]);
  for (let e of Object.values(t)) V(e);
  return structuredClone(t);
}
function re(t) {
  return J(me(t));
}
async function ne(t, e) {
  (ie(t, 589824),
    me(e),
    W(t, [
      "contractVersion",
      "runId",
      "resultId",
      "revision",
      "expectedRevision",
      "stableOperationId",
      "envelopeFingerprint",
      "envelope",
    ]));
  for (let r of ["runId", "resultId", "stableOperationId"]) V(t[r]);
  ((t.contractVersion !== X ||
    !Number.isSafeInteger(t.expectedRevision) ||
    t.expectedRevision < 0 ||
    t.expectedRevision >= 32 ||
    t.revision !== t.expectedRevision + 1 ||
    !/^[a-f0-9]{64}$/.test(t.envelopeFingerprint)) &&
    I("invalid_record"),
    be("Carrier", t.envelope),
    t.envelope.contractVersion !== X && I("invalid_record"));
  let a = t.envelope.signedObject,
    n = qe(a.protected),
    f = qe(a.payload, !0);
  (W(n, ["alg", "typ", "kid", "cty"]), be("ObjectMessage", f));
  let u = f.context,
    i = u.binding;
  return (
    (n.alg !== "ES256" ||
      n.typ !== "fv-object+jws" ||
      n.cty !== "application/json" ||
      n.kid !== u.authorSigningKeyId ||
      Ce(a.signature).length !== 64 ||
      u.contractVersion !== X ||
      u.profileId !== "P1" ||
      u.objectType !== "result_revision" ||
      u.objectId !== t.resultId ||
      u.ownerSubject !== e.ownerSubject ||
      u.vaultId !== e.vaultId ||
      i.connectionId !== e.connectionId ||
      i.taskId !== e.taskId ||
      i.runId !== t.runId ||
      u.revision !== t.revision ||
      u.expectedRevision !== t.expectedRevision ||
      u.stableOperationId !== t.stableOperationId ||
      u.operationType !== (t.expectedRevision === 0 ? "submit_result" : "revise_result") ||
      u.deliveryRevision !== 1 ||
      u.resourceBindings.length ||
      u.priorEnvelopeFingerprint !== null) &&
      I("record_binding_mismatch"),
    (await ar(t.envelope)) !== t.envelopeFingerprint && I("record_fingerprint_mismatch"),
    { packet: structuredClone(t), context: u }
  );
}
function ye(t, e, a, n, f) {
  be("ResultReceipt", t);
  let u = {
    contractVersion: X,
    vaultId: a.vaultId,
    runId: e.runId,
    taskId: a.taskId,
    resultId: e.resultId,
    revision: e.revision,
    deliveryRevision: n.deliveryRevision,
    stableOperationId: e.stableOperationId,
    envelopeFingerprint: e.envelopeFingerprint,
    resultPath: `/results/${e.resultId}?revision=${e.revision}`,
  };
  return (
    (Object.keys(u).some((i) => t[i] !== u[i]) ||
      !Number.isFinite(Date.parse(t.receivedAt)) ||
      Date.parse(t.receivedAt) < Date.parse(f)) &&
      I("receipt_binding_mismatch"),
    structuredClone(t)
  );
}
async function Fe(t, e) {
  (ie(t),
    W(t, ["profile", "scope", "packet", "receipt", "runCreatedAt"]),
    (t.profile !== he ||
      re(t.scope) !== re(e) ||
      typeof t.runCreatedAt != "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(t.runCreatedAt) ||
      !Number.isFinite(Date.parse(t.runCreatedAt))) &&
      I("record_binding_mismatch"));
  let a = await ne(t.packet, e);
  return (
    t.receipt !== null && ye(t.receipt, t.packet, e, a.context, t.runCreatedAt),
    structuredClone(t)
  );
}
function de(t, e) {
  return re(t) + ":" + V(e);
}
function De(t) {
  return t instanceof B ? t : new B("storage_unavailable");
}
var ue = class {
  #l;
  #i;
  constructor({ indexedDB: e = globalThis.indexedDB } = {}) {
    this.#l = e;
  }
  async #v() {
    return (
      this.#l || I("storage_unavailable"),
      this.#i ||
        (this.#i = new Promise((e, a) => {
          let n = this.#l.open("folioview-agent-ciphertext-outbox-v1", 1);
          ((n.onupgradeneeded = () => n.result.createObjectStore("outbox", { keyPath: "key" })),
            (n.onerror = () => a(new B("storage_unavailable"))),
            (n.onblocked = () => a(new B("storage_unavailable"))),
            (n.onsuccess = () => {
              let f = n.result;
              ((f.onversionchange = () => {
                (f.close(), (this.#i = void 0));
              }),
                e(f));
            }));
        }).catch((e) => {
          throw ((this.#i = void 0), De(e));
        })),
      this.#i
    );
  }
  async #s(e, a) {
    let n = await this.#v();
    return new Promise((f, u) => {
      let i,
        r,
        h = n.transaction("outbox", e),
        s = h.objectStore("outbox"),
        d = (w) => {
          r = De(w);
          try {
            h.abort();
          } catch {}
        };
      ((h.oncomplete = () => f(i)),
        (h.onerror = h.onabort = () => u(r ?? new B("storage_unavailable"))));
      try {
        a(
          s,
          (w) => {
            i = w;
          },
          d,
        );
      } catch (w) {
        d(w);
      }
    });
  }
  async list(e) {
    let a = re(e),
      n = await this.#s("readonly", (i, r, h) => {
        let s = i.getAll();
        ((s.onerror = () => h(s.error)), (s.onsuccess = () => r(s.result)));
      });
    (!Array.isArray(n) || n.length > 256) && I("invalid_record");
    let f = n.filter((i) => i.scope === a);
    f.length > 32 && I("invalid_record");
    let u = [];
    for (let i of f) {
      let r = await Fe(i.value, e);
      (i.key !== de(e, r.packet.stableOperationId) && I("invalid_record"), u.push(r));
    }
    return u;
  }
  async get(e, a) {
    return (await this.list(e)).find((n) => n.packet.stableOperationId === V(a)) ?? null;
  }
  async stage(e, a) {
    let n = await Fe(a, e),
      f = de(e, n.packet.stableOperationId),
      u = re(e),
      i = ie(n);
    return (
      n.receipt !== null && I("invalid_record"),
      this.#s("readwrite", (r, h, s) => {
        let d = r.getAll();
        ((d.onerror = () => s(d.error)),
          (d.onsuccess = () => {
            try {
              let w = d.result;
              (!Array.isArray(w) || w.length > 256) && I("invalid_record");
              let l = w.find((c) => c.key === f);
              if (l) {
                ((l.scope !== u || J({ ...l.value, receipt: null }) !== i) && I("outbox_conflict"),
                  h(structuredClone(l.value)));
                return;
              }
              ((w.length >= 256 || w.filter((c) => c.scope === u).length >= 32) &&
                I("outbox_capacity"),
                r.add({ key: f, scope: u, value: n }),
                h(structuredClone(n)));
            } catch (w) {
              s(w);
            }
          }));
      })
    );
  }
  async accept(e, a, n, f) {
    let u = await this.get(e, a);
    (!u || u.packet.envelopeFingerprint !== n) && I("outbox_conflict");
    let { context: i } = await ne(u.packet, e),
      r = ye(f, u.packet, e, i, u.runCreatedAt),
      h = de(e, a),
      s = J(u);
    return this.#s("readwrite", (d, w, l) => {
      let c = d.get(h);
      ((c.onerror = () => l(c.error)),
        (c.onsuccess = () => {
          try {
            let _ = c.result;
            if (((!_ || _.scope !== re(e)) && I("outbox_conflict"), J(_.value) !== s)) {
              if (
                J({ ..._.value, receipt: null }) === J({ ...u, receipt: null }) &&
                J(_.value.receipt) === J(r)
              ) {
                w(structuredClone(_.value));
                return;
              }
              I("outbox_conflict");
            }
            (_.value.receipt !== null && J(_.value.receipt) !== J(r) && I("receipt_replacement"),
              (_.value.receipt = r),
              d.put(_),
              w(structuredClone(_.value)));
          } catch (_) {
            l(_);
          }
        }));
    });
  }
  async discard(e, a, n) {
    let f = de(e, a);
    return this.#s("readwrite", (u, i, r) => {
      let h = u.get(f);
      ((h.onerror = () => r(h.error)),
        (h.onsuccess = () => {
          try {
            let s = h.result;
            (s &&
              (s.scope !== re(e) || s.value.packet?.envelopeFingerprint !== n) &&
              I("outbox_conflict"),
              s && u.delete(f),
              i(null));
          } catch (s) {
            r(s);
          }
        }));
    });
  }
  async close() {
    this.#i && ((await this.#i).close(), (this.#i = void 0));
  }
};
var vr = new TextEncoder(),
  Le = "1.2.0",
  Ke = {
    status: [],
    lock: [],
    registry: ["bundles"],
    install: ["metadata"],
    decrypt: ["objectId", "envelope"],
    beginRun: ["stableOperationId"],
    installRun: ["response"],
    decryptRun: ["runId", "page"],
    sealResult: ["runId", "stableOperationId", "content"],
    reviseResult: ["runId", "stableOperationId", "expectedRevision", "content"],
    resultOutbox: ["runId", "stableOperationId"],
  };
async function or(t) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", t))]
    .map((e) => e.toString(16).padStart(2, "0"))
    .join("");
}
function pr(t, e) {
  let a;
  try {
    a = new URL(t);
  } catch {
    I("invalid_configuration");
  }
  return (
    (a.origin !== t ||
      a.username ||
      a.password ||
      (a.protocol !== "https:" &&
        !(
          e &&
          a.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(a.hostname)
        ))) &&
      I("invalid_configuration"),
    a.origin
  );
}
async function Be(t, e, a) {
  t.body || I("invalid_response");
  let n = t.body.getReader(),
    f = [],
    u = 0,
    i = () => {
      n.cancel().catch(() => {});
    };
  e.addEventListener("abort", i, { once: !0 });
  try {
    for (;;) {
      let s = await n.read();
      if ((e.aborted && I("request_cancelled"), s.done)) break;
      ((u += s.value.length), u > a && I("invalid_response"), f.push(s.value));
    }
    let r = new Uint8Array(u),
      h = 0;
    for (let s of f) (r.set(s, h), (h += s.length));
    return r;
  } finally {
    (e.removeEventListener("abort", i), n.cancel().catch(() => {}), n.releaseLock());
  }
}
function Y(t) {
  return structuredClone(t);
}
var Je = class {
  #l;
  #i;
  #v;
  #s;
  #k;
  #f;
  #c;
  #d;
  #u;
  #r;
  #E;
  #a;
  #m;
  #w;
  #I;
  #P;
  #j = null;
  #_ = !1;
  #t = 1;
  #R = 0;
  #x;
  #b = 1;
  #h = !1;
  #O = !0;
  #n = new Map();
  #o = new Set();
  #L;
  #y = new Map();
  #A = new Set();
  #z;
  constructor({
    issuer: e,
    developmentLoopback: a = !1,
    fetchImpl: n = fetch,
    createWorker: f = (h) => new Worker(h, { type: "module" }),
    outbox: u = new ue(),
    clock: i = Date.now,
    onState: r = () => {},
  }) {
    ((this.#l = pr(e, a)),
      (this.#i = n),
      (this.#v = f),
      (this.#s = u),
      (this.#k = i),
      (this.#f = r));
  }
  #e(e, a = !1) {
    ((this.#h || e !== this.#t || !this.#r) && I("session_ended"),
      a && !this.#O && I("foreground_required"),
      a && this.#_ && I("transport_refreshing"));
  }
  status() {
    return {
      profile: he,
      helperVersion: Le,
      sessionId: this.#x ?? null,
      generation: this.#b,
      expiresAt: this.#j,
      state: this.#h ? "LOCKED" : this.#m ? "READY" : "ABSENT",
      foreground: this.#O,
      authenticatedTransport: !!this.#w,
      independentDeliveryConfirmed: !!this.#a,
      privateKeysPersistent: !1,
    };
  }
  publicOffer() {
    return ((!this.#m || this.#h) && I("session_ended"), Y(this.#m));
  }
  async initialize(e) {
    (W(e, ["helperVersion", "workerSha256", "anchor", "ttlSeconds"]),
      (this.#h ||
        this.#c ||
        this.#r ||
        e.helperVersion !== Le ||
        typeof e.workerSha256 != "string" ||
        !/^[a-f0-9]{64}$/.test(e.workerSha256) ||
        !Number.isSafeInteger(e.ttlSeconds) ||
        e.ttlSeconds < 1 ||
        e.ttlSeconds > 3600) &&
        I("invalid_initialization"),
      W(e.anchor, [
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
      ]));
    let a = me(
      Object.fromEntries(
        ["ownerSubject", "vaultId", "connectionId", "agentPrincipalId", "taskId"].map((i) => [
          i,
          e.anchor[i],
        ]),
      ),
    );
    ((this.#r = a),
      (this.#E = Y(e.anchor)),
      (this.#x = `session_${crypto.randomUUID().replaceAll("-", "")}`));
    let n = this.#t,
      f = new AbortController();
    this.#o.add(f);
    let u = setTimeout(() => f.abort(), 1e4);
    try {
      let i = await this.#i(this.#l + "/agent/v2/helper/worker.mjs", {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: f.signal,
      });
      (!i.ok ||
        i.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "text/javascript") &&
        I("helper_unavailable");
      let r = await Be(i, f.signal, 2097152);
      (this.#e(n),
        (await or(r)) !== e.workerSha256 && I("helper_integrity_mismatch"),
        this.#e(n),
        (this.#P = URL.createObjectURL(new Blob([r], { type: "text/javascript" }))),
        (this.#c = this.#v(this.#P)));
      let h = new MessageChannel(),
        s = new MessageChannel();
      ((this.#d = h.port1), (this.#u = s.port1));
      let d = (l) => this.#S(l.data);
      ((this.#d.onmessage = d),
        (this.#u.onmessage = d),
        this.#d.start(),
        this.#u.start(),
        (this.#c.onerror = () => this.lock("worker_failed")),
        this.#c.postMessage({ op: "attach", ownerPort: h.port2, agentPort: s.port2 }, [
          h.port2,
          s.port2,
        ]));
      let w = await this.#g(
        "initialize",
        { anchor: e.anchor, now: Math.floor(this.#k() / 1e3), ttlSeconds: e.ttlSeconds },
        !0,
      );
      return (
        this.#e(n),
        (this.#m = {
          helperVersion: Le,
          sessionId: this.#x,
          generation: this.#b,
          anchor: Y(this.#E),
          agentSigningPublicJwk: w.agentSigningPublicJwk,
          agentEncryptionPublicJwk: w.agentEncryptionPublicJwk,
          agentSigningKeyId: w.agentSigningKeyId,
          agentEncryptionKeyId: w.agentEncryptionKeyId,
          keyExportRejected: w.keyExportRejected,
        }),
        (w.keyExportRejected !== !0 || w.privateKeysPresent !== !0) && I("unsafe_helper"),
        (this.#j = Math.floor(this.#k() / 1e3) + e.ttlSeconds),
        (this.#z = setTimeout(() => this.lock("session_expired"), e.ttlSeconds * 1e3)),
        this.#f(this.status()),
        this.publicOffer()
      );
    } catch (i) {
      throw (this.lock("initialization_failed"), i instanceof B ? i : new B("helper_unavailable"));
    } finally {
      (clearTimeout(u), this.#o.delete(f));
    }
  }
  #S(e) {
    if (e?.event === "sessionEnded") {
      this.lock("session_ended");
      return;
    }
    let a = this.#n.get(e?.id);
    if (a) {
      (this.#n.delete(e.id), clearTimeout(a.timeout));
      try {
        (this.#e(a.epoch, a.privateOperation),
          e.ok === !0
            ? a.resolve(e.value)
            : a.reject(new B(typeof e.error?.code == "string" ? e.error.code : "helper_rejected")));
      } catch (n) {
        a.reject(n);
      }
    }
  }
  async #g(e, a, n = !1) {
    let f = this.#t;
    (this.#e(f, !n && !["status", "lock"].includes(e)),
      (!this.#c || this.#n.size >= 8) && I("helper_busy"));
    let u = { id: `rpc_${++this.#R}`, sessionId: this.#x, generation: this.#b, op: e, args: a };
    return (
      ie(u),
      new Promise((i, r) => {
        let h = setTimeout(() => {
          (this.#n.delete(u.id), r(new B("helper_timeout")), this.lock("helper_timeout"));
        }, 2e4);
        this.#n.set(u.id, {
          resolve: i,
          reject: r,
          timeout: h,
          epoch: f,
          privateOperation: !n && e !== "status",
        });
        try {
          (n ? this.#d : this.#u).postMessage(u);
        } catch {
          (clearTimeout(h), this.#n.delete(u.id), r(new B("helper_unavailable")));
        }
      })
    );
  }
  async confirmDelivery({ pin: e }) {
    let a = this.#t;
    return (
      this.#e(a),
      await this.#g("confirmDelivery", { pin: e }, !0),
      this.#e(a),
      (this.#a = Y(e)),
      (this.#L = void 0),
      this.#y.clear(),
      this.#A.clear(),
      this.#f(this.status()),
      this.status()
    );
  }
  async dispatchAgent(e) {
    if (
      (W(e, ["op", "args"]),
      Object.hasOwn(Ke, e.op) || I("unsupported_operation"),
      W(e.args, Ke[e.op]),
      e.op === "status")
    )
      return this.status();
    if (e.op === "lock") return (this.lock(), this.status());
    let a = this.#t;
    this.#e(a, !0);
    let n = await this.#g(e.op, e.args);
    if (
      (this.#e(a, !0), e.op === "install" && (this.#L = Y(e.args.metadata)), e.op === "installRun")
    ) {
      let f = e.args.response;
      this.#y.set(f.run.runId, { createdAt: f.run.createdAt, response: Y(f) });
    }
    if (e.op === "sealResult" || e.op === "reviseResult") {
      let f = this.#y.get(e.args.runId);
      (f || I("run_required"),
        await this.#Z(n, f.createdAt, a),
        this.#e(a, !0),
        this.#A.add(n.runId + "/" + n.stableOperationId));
    }
    return n;
  }
  setVisible(e) {
    if ((typeof e != "boolean" && I("invalid_fields"), (this.#O = e), !e)) {
      for (let a of this.#o) a.abort();
      for (let [a, n] of this.#n)
        n.privateOperation &&
          (clearTimeout(n.timeout), n.reject(new B("foreground_required")), this.#n.delete(a));
    }
    this.#f(this.status());
  }
  async authenticate(e) {
    (typeof e != "string" || !/^[A-Za-z0-9_-]{43}$/.test(e)) && I("invalid_token");
    let a = this.#t;
    (this.#e(a), (this.#_ || this.#o.size || this.#n.size) && I("transport_busy"), (this.#_ = !0));
    try {
      let n = await this.#p("/agent/v2/authorization", { token: e, privateOperation: !1 });
      (this.#e(a),
        W(n, [
          "contractVersion",
          "connectionId",
          "authorizationId",
          "clientId",
          "scopes",
          "taskIds",
          "expiresAt",
        ]));
      let f = new Set([
        "tasks:read",
        "runs:create",
        "runs:read",
        "results:create",
        "results:revise",
        "receipts:read",
        "watchlist:read",
        "channel_follows:read",
        "portfolio:read",
      ]);
      ((n.contractVersion !== X ||
        n.connectionId !== this.#r.connectionId ||
        !Array.isArray(n.taskIds) ||
        n.taskIds.length > 10 ||
        !n.taskIds.includes(this.#r.taskId) ||
        n.taskIds.some((i) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(i)) ||
        new Set(n.taskIds).size !== n.taskIds.length ||
        !Array.isArray(n.scopes) ||
        n.scopes.length > 9 ||
        n.scopes.some((i) => !f.has(i)) ||
        new Set(n.scopes).size !== n.scopes.length ||
        !Number.isSafeInteger(n.expiresAt) ||
        n.expiresAt <= Math.floor(this.#k() / 1e3) ||
        (this.#a && n.authorizationId !== this.#a.authorizationId)) &&
        (this.lock("authorization_denied"), I("authorization_denied")),
        V(n.clientId),
        V(n.authorizationId));
      let u = (i) =>
        J({
          connectionId: i.connectionId,
          authorizationId: i.authorizationId,
          clientId: i.clientId,
          scopes: [...i.scopes].sort(),
          taskIds: [...i.taskIds].sort(),
        });
      return (
        this.#I &&
          u(this.#I) !== u(n) &&
          (this.lock("authorization_changed"), I("authorization_changed")),
        (this.#w = e),
        (this.#I = Y(n)),
        this.#f(this.status()),
        { connectionId: n.connectionId, authorizationId: n.authorizationId, expiresAt: n.expiresAt }
      );
    } finally {
      this.#_ = !1;
    }
  }
  async #p(
    e,
    { method: a = "GET", json: n, operation: f, token: u = this.#w, privateOperation: i = !0 } = {},
  ) {
    let r = this.#t;
    (this.#e(r, i),
      u || I("authenticated_host_required"),
      /^\/agent\/v2\/(?:authorization|tasks\/[A-Za-z0-9_-]+\/(?:preparation|runs)|preparations\/[A-Za-z0-9_-]+\/(?:objects\/[A-Za-z0-9_-]+|registries\/[1-9][0-9]?)|runs\/[A-Za-z0-9_-]+(?:\/(?:inputs(?:\?cursor=[A-Za-z0-9_-]{1,128})?|registries\/[1-9][0-9]?|results|receipts\/[A-Za-z0-9_-]+))?|results\/[A-Za-z0-9_-]+\/revisions)$/.test(
        e,
      ) || I("unsupported_operation"));
    let h = { Authorization: `Bearer ${u}`, "X-FolioView-Contract": X };
    (f && (h["Idempotency-Key"] = V(f)),
      n !== void 0 && ((h["Content-Type"] = "application/json"), ie(n, 589824)));
    let s = new AbortController();
    this.#o.add(s);
    let d = setTimeout(() => s.abort(), 2e4);
    try {
      let w = await this.#i(this.#l + e, {
        method: a,
        headers: h,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: s.signal,
        ...(n === void 0 ? {} : { body: JSON.stringify(n) }),
      });
      (this.#e(r, i),
        (w.status === 401 || w.status === 403) &&
          (this.lock("authorization_denied"), I("authorization_denied")),
        w.ok ||
          (w.status === 409 && this.lock("authority_changed"),
          I(
            w.status === 404
              ? "not_found"
              : w.status === 409
                ? "authority_changed"
                : "request_failed",
          )),
        w.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json" && I("invalid_response"));
      let l = await Be(w, s.signal, 1048576);
      this.#e(r, i);
      let c;
      try {
        c = JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(l));
      } catch {
        I("invalid_response");
      }
      return c;
    } catch (w) {
      if (w instanceof B) throw w;
      I(s.signal.aborted ? "request_cancelled" : "request_failed");
    } finally {
      (clearTimeout(d), this.#o.delete(s));
    }
  }
  async loadPreparation() {
    let e = this.#t;
    (this.#e(e, !0), this.#a || I("trusted_pin_required"));
    let a = await this.#p(`/agent/v2/tasks/${this.#r.taskId}/preparation`);
    (a.preparationId !== this.#a.preparationId ||
      !Array.isArray(a.registryProofs) ||
      a.registryProofs.length < 1 ||
      a.registryProofs.length > 32) &&
      I("invalid_response");
    for (let n = 0; n < a.registryProofs.length; n++) {
      let f = n + 1,
        u = `/agent/v2/preparations/${V(a.preparationId)}/registries/${f}`;
      (a.registryProofs[n].registrySequence !== f || a.registryProofs[n].path !== u) &&
        I("invalid_response");
      let i = await this.#p(u);
      (this.#e(e, !0),
        (i.preparationId !== a.preparationId || i.registrySequence !== f) && I("invalid_response"),
        await this.#g("registry", { bundles: [i.registryBundle] }));
    }
    return (
      await this.dispatchAgent({ op: "install", args: { metadata: a } }),
      this.#e(e, !0),
      { preparationId: a.preparationId, objects: Y(a.objects) }
    );
  }
  async readPreparedObject(e) {
    let a = this.#t;
    (this.#e(a, !0),
      V(e),
      this.#L?.objects.some((f) => f.objectId === e) || I("object_not_authorized"));
    let n = await this.#p(`/agent/v2/preparations/${V(this.#a.preparationId)}/objects/${e}`);
    return (
      this.#e(a, !0),
      W(n, ["contractVersion", "preparationId", "objectId", "envelope"]),
      (n.contractVersion !== X || n.preparationId !== this.#a.preparationId || n.objectId !== e) &&
        I("invalid_response"),
      this.dispatchAgent({ op: "decrypt", args: { objectId: e, envelope: n.envelope } })
    );
  }
  async beginRun(e) {
    let a = this.#t;
    (this.#e(a, !0), V(e));
    let n = await this.dispatchAgent({ op: "beginRun", args: { stableOperationId: e } });
    this.#e(a, !0);
    let f = await this.#p(`/agent/v2/tasks/${this.#r.taskId}/runs`, {
      method: "POST",
      json: { contractVersion: X, signedBeginIntent: n.signedBeginIntent },
      operation: e,
    });
    return (
      this.#e(a, !0),
      await this.dispatchAgent({ op: "installRun", args: { response: f } }),
      this.#e(a, !0),
      Y(f)
    );
  }
  async readRunPage(e, a = null) {
    let n = this.#t;
    (this.#e(n, !0),
      V(e),
      (!this.#y.has(e) ||
        (a !== null && (typeof a != "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(a)))) &&
        I("run_required"));
    let f = await this.#p(`/agent/v2/runs/${e}/inputs${a === null ? "" : "?cursor=" + a}`);
    return (this.#e(n, !0), this.dispatchAgent({ op: "decryptRun", args: { runId: e, page: f } }));
  }
  async #Z(e, a, n) {
    (await ne(e, this.#r), this.#e(n, !0));
    let f = await this.#s.stage(this.#r, {
      profile: he,
      scope: Y(this.#r),
      packet: e,
      receipt: null,
      runCreatedAt: a,
    });
    return (this.#e(n, !0), f);
  }
  async submitResult(e, a, n, f = 0) {
    let u = this.#t;
    (this.#e(u, !0), V(e), V(a));
    let i = await this.dispatchAgent({
      op: f === 0 ? "sealResult" : "reviseResult",
      args: {
        runId: e,
        stableOperationId: a,
        ...(f === 0 ? {} : { expectedRevision: f }),
        content: n,
      },
    });
    return (this.#e(u, !0), this.replay(i.stableOperationId));
  }
  async #$(e, a, n) {
    let { context: f } = await ne(e.packet, this.#r);
    this.#e(n, !0);
    let u = ye(a, e.packet, this.#r, f, e.runCreatedAt);
    (await this.#s.accept(this.#r, e.packet.stableOperationId, e.packet.envelopeFingerprint, u),
      this.#e(n, !0));
    let i = this.#A.has(e.packet.runId + "/" + e.packet.stableOperationId);
    return (
      i &&
        (await this.#g(
          "acceptReceipt",
          { runId: e.packet.runId, stableOperationId: e.packet.stableOperationId, receipt: u },
          !0,
        ),
        this.#e(n, !0)),
      { receipt: u, liveRevisionSession: i, recoveredWithoutPrivateKeys: !i }
    );
  }
  async replay(e) {
    let a = this.#t;
    (this.#e(a, !0), V(e));
    let n = await this.#s.get(this.#r, e);
    (this.#e(a, !0), n || I("not_found"));
    let f = n.packet,
      u = f.expectedRevision > 0,
      i = await this.#p(
        u ? `/agent/v2/results/${f.resultId}/revisions` : `/agent/v2/runs/${f.runId}/results`,
        {
          method: "POST",
          operation: e,
          json: u
            ? {
                contractVersion: X,
                expectedRevision: f.expectedRevision,
                signedObject: f.envelope.signedObject,
              }
            : f.envelope,
        },
      );
    return (this.#e(a, !0), this.#$(n, i, a));
  }
  async recoverReceipt(e) {
    let a = this.#t;
    (this.#e(a, !0), V(e));
    let n = await this.#s.get(this.#r, e);
    (this.#e(a, !0), n || I("not_found"));
    let f = await this.#p(`/agent/v2/runs/${n.packet.runId}/receipts/${e}`);
    return (this.#e(a, !0), f === null ? { receipt: null, pending: !0 } : this.#$(n, f, a));
  }
  async listOutbox() {
    let e = this.#t;
    this.#e(e);
    let a = await this.#s.list(this.#r);
    return (
      this.#e(e),
      a.map((n) => ({
        runId: n.packet.runId,
        resultId: n.packet.resultId,
        stableOperationId: n.packet.stableOperationId,
        revision: n.packet.revision,
        envelopeFingerprint: n.packet.envelopeFingerprint,
        receiptSaved: n.receipt !== null,
      }))
    );
  }
  async discardOutbox(e, a) {
    let n = this.#t;
    return (
      this.#e(n),
      V(e),
      (typeof a != "string" || !/^[a-f0-9]{64}$/.test(a)) && I("invalid_fields"),
      await this.#s.discard(this.#r, e, a),
      this.#e(n),
      this.listOutbox()
    );
  }
  lock(e = "locked") {
    if (!this.#h) {
      ((this.#h = !0), this.#t++, this.#b++, clearTimeout(this.#z));
      for (let a of this.#o) a.abort();
      this.#o.clear();
      for (let a of this.#n.values()) (clearTimeout(a.timeout), a.reject(new B("session_ended")));
      (this.#n.clear(),
        this.#c?.terminate(),
        this.#d?.close(),
        this.#u?.close(),
        this.#P && URL.revokeObjectURL(this.#P),
        (this.#c = this.#d = this.#u = void 0),
        (this.#w = this.#I = this.#L = this.#a = this.#m = void 0),
        this.#y.clear(),
        this.#A.clear(),
        this.#f({ ...this.status(), reason: e }));
    }
  }
};
export {
  X as CONTRACT,
  he as CONTROLLER_PROFILE,
  ue as CiphertextOutbox,
  B as ControllerDenied,
  Je as ForegroundController,
  Le as HELPER_VERSION,
  ie as bounded,
  W as exact,
  V as identifier,
  I as reject,
};
