"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    try {
      return (
        mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
        mod.exports
      );
    } catch (e) {
      throw ((mod = 0), e);
    }
  };

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320) pos++;
        }
      }
      return length;
    }
    exports2.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  },
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports2, module2) {
    "use strict";
    module2.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0;) if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0;)
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0;) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  },
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports2.default = equal;
  },
});

// <stdin>
exports.CenterSchedule = validate52;
var schema21 = {
  type: "object",
  properties: {
    frequency: { enum: ["daily", "weekly"] },
    days: {
      type: "array",
      items: { type: "integer", minimum: 1, maximum: 7 },
      maxItems: 7,
      uniqueItems: true,
    },
    localTime: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
    timeZone: { type: "string", minLength: 1, maxLength: 80 },
    graceMinutes: { type: "integer", minimum: 0, maximum: 1440 },
    effectiveFrom: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    dstGap: { const: "skip" },
    dstFold: { const: "first" },
  },
  required: [
    "frequency",
    "days",
    "localTime",
    "timeZone",
    "graceMinutes",
    "effectiveFrom",
    "dstGap",
    "dstFold",
  ],
  additionalProperties: false,
};
var pattern3 = new RegExp("^([01][0-9]|2[0-3]):[0-5][0-9]$", "u");
var func1 = require_ucs2length().default;
function validate54(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate54.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.frequency === void 0 && (missing0 = "frequency")) ||
        (data.days === void 0 && (missing0 = "days")) ||
        (data.localTime === void 0 && (missing0 = "localTime")) ||
        (data.timeZone === void 0 && (missing0 = "timeZone")) ||
        (data.graceMinutes === void 0 && (missing0 = "graceMinutes")) ||
        (data.effectiveFrom === void 0 && (missing0 = "effectiveFrom")) ||
        (data.dstGap === void 0 && (missing0 = "dstGap")) ||
        (data.dstFold === void 0 && (missing0 = "dstFold"))
      ) {
        validate54.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === "frequency" ||
            key0 === "days" ||
            key0 === "localTime" ||
            key0 === "timeZone" ||
            key0 === "graceMinutes" ||
            key0 === "effectiveFrom" ||
            key0 === "dstGap" ||
            key0 === "dstFold"
          )) {
            validate54.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.frequency !== void 0) {
            let data0 = data.frequency;
            const _errs2 = errors;
            if (!(data0 === "daily" || data0 === "weekly")) {
              validate54.errors = [
                {
                  instancePath: instancePath + "/frequency",
                  schemaPath: "#/properties/frequency/enum",
                  keyword: "enum",
                  params: { allowedValues: schema21.properties.frequency.enum },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.days !== void 0) {
              let data1 = data.days;
              const _errs3 = errors;
              if (errors === _errs3) {
                if (Array.isArray(data1)) {
                  if (data1.length > 7) {
                    validate54.errors = [
                      {
                        instancePath: instancePath + "/days",
                        schemaPath: "#/properties/days/maxItems",
                        keyword: "maxItems",
                        params: { limit: 7 },
                      },
                    ];
                    return false;
                  } else {
                    var valid1 = true;
                    const len0 = data1.length;
                    for (let i0 = 0; i0 < len0; i0++) {
                      let data2 = data1[i0];
                      const _errs5 = errors;
                      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2))) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + "/days/" + i0,
                            schemaPath: "#/properties/days/items/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs5) {
                        if (typeof data2 == "number") {
                          if (data2 > 7 || isNaN(data2)) {
                            validate54.errors = [
                              {
                                instancePath: instancePath + "/days/" + i0,
                                schemaPath: "#/properties/days/items/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 7 },
                              },
                            ];
                            return false;
                          } else {
                            if (data2 < 1 || isNaN(data2)) {
                              validate54.errors = [
                                {
                                  instancePath: instancePath + "/days/" + i0,
                                  schemaPath: "#/properties/days/items/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      }
                      var valid1 = _errs5 === errors;
                      if (!valid1) {
                        break;
                      }
                    }
                    if (valid1) {
                      let i1 = data1.length;
                      let j0;
                      if (i1 > 1) {
                        const indices0 = {};
                        for (; i1--;) {
                          let item0 = data1[i1];
                          if (!(typeof item0 == "number" && !(item0 % 1) && !isNaN(item0))) {
                            continue;
                          }
                          if (typeof indices0[item0] == "number") {
                            j0 = indices0[item0];
                            validate54.errors = [
                              {
                                instancePath: instancePath + "/days",
                                schemaPath: "#/properties/days/uniqueItems",
                                keyword: "uniqueItems",
                                params: { i: i1, j: j0 },
                              },
                            ];
                            return false;
                            break;
                          }
                          indices0[item0] = i1;
                        }
                      }
                    }
                  }
                } else {
                  validate54.errors = [
                    {
                      instancePath: instancePath + "/days",
                      schemaPath: "#/properties/days/type",
                      keyword: "type",
                      params: { type: "array" },
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.localTime !== void 0) {
                let data3 = data.localTime;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (typeof data3 === "string") {
                    if (!pattern3.test(data3)) {
                      validate54.errors = [
                        {
                          instancePath: instancePath + "/localTime",
                          schemaPath: "#/properties/localTime/pattern",
                          keyword: "pattern",
                          params: { pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate54.errors = [
                      {
                        instancePath: instancePath + "/localTime",
                        schemaPath: "#/properties/localTime/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.timeZone !== void 0) {
                  let data4 = data.timeZone;
                  const _errs9 = errors;
                  if (errors === _errs9) {
                    if (typeof data4 === "string") {
                      if (func1(data4) > 80) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + "/timeZone",
                            schemaPath: "#/properties/timeZone/maxLength",
                            keyword: "maxLength",
                            params: { limit: 80 },
                          },
                        ];
                        return false;
                      } else {
                        if (func1(data4) < 1) {
                          validate54.errors = [
                            {
                              instancePath: instancePath + "/timeZone",
                              schemaPath: "#/properties/timeZone/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ];
                          return false;
                        }
                      }
                    } else {
                      validate54.errors = [
                        {
                          instancePath: instancePath + "/timeZone",
                          schemaPath: "#/properties/timeZone/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.graceMinutes !== void 0) {
                    let data5 = data.graceMinutes;
                    const _errs11 = errors;
                    if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5))) {
                      validate54.errors = [
                        {
                          instancePath: instancePath + "/graceMinutes",
                          schemaPath: "#/properties/graceMinutes/type",
                          keyword: "type",
                          params: { type: "integer" },
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs11) {
                      if (typeof data5 == "number") {
                        if (data5 > 1440 || isNaN(data5)) {
                          validate54.errors = [
                            {
                              instancePath: instancePath + "/graceMinutes",
                              schemaPath: "#/properties/graceMinutes/maximum",
                              keyword: "maximum",
                              params: { comparison: "<=", limit: 1440 },
                            },
                          ];
                          return false;
                        } else {
                          if (data5 < 0 || isNaN(data5)) {
                            validate54.errors = [
                              {
                                instancePath: instancePath + "/graceMinutes",
                                schemaPath: "#/properties/graceMinutes/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 0 },
                              },
                            ];
                            return false;
                          }
                        }
                      }
                    }
                    var valid0 = _errs11 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.effectiveFrom !== void 0) {
                      let data6 = data.effectiveFrom;
                      const _errs13 = errors;
                      if (!(typeof data6 == "number" && !(data6 % 1) && !isNaN(data6))) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + "/effectiveFrom",
                            schemaPath: "#/properties/effectiveFrom/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs13) {
                        if (typeof data6 == "number") {
                          if (data6 > 9007199254740991 || isNaN(data6)) {
                            validate54.errors = [
                              {
                                instancePath: instancePath + "/effectiveFrom",
                                schemaPath: "#/properties/effectiveFrom/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 9007199254740991 },
                              },
                            ];
                            return false;
                          } else {
                            if (data6 < 0 || isNaN(data6)) {
                              validate54.errors = [
                                {
                                  instancePath: instancePath + "/effectiveFrom",
                                  schemaPath: "#/properties/effectiveFrom/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 0 },
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      }
                      var valid0 = _errs13 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.dstGap !== void 0) {
                        const _errs15 = errors;
                        if ("skip" !== data.dstGap) {
                          validate54.errors = [
                            {
                              instancePath: instancePath + "/dstGap",
                              schemaPath: "#/properties/dstGap/const",
                              keyword: "const",
                              params: { allowedValue: "skip" },
                            },
                          ];
                          return false;
                        }
                        var valid0 = _errs15 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.dstFold !== void 0) {
                          const _errs16 = errors;
                          if ("first" !== data.dstFold) {
                            validate54.errors = [
                              {
                                instancePath: instancePath + "/dstFold",
                                schemaPath: "#/properties/dstFold/const",
                                keyword: "const",
                                params: { allowedValue: "first" },
                              },
                            ];
                            return false;
                          }
                          var valid0 = _errs16 === errors;
                        } else {
                          var valid0 = true;
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
    } else {
      validate54.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate54.errors = vErrors;
  return errors === 0;
}
validate54.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate52(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate52.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (
    !validate54(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
    errors = vErrors.length;
  }
  validate52.errors = vErrors;
  return errors === 0;
}
validate52.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.CenterTaskDefinition = validate56;
var schema23 = {
  type: "object",
  properties: {
    contractVersion: { const: "folioview.agent-workspace.v2.0" },
    profile: { const: "folioview.task-center.v1" },
    ownerSubject: { $ref: "#/$defs/Identifier" },
    vaultId: { $ref: "#/$defs/Identifier" },
    taskId: { $ref: "#/$defs/Identifier" },
    taskVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    executionEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    ruleVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    lifecycleEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    definitionVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    status: { enum: ["active", "trashed", "purged"] },
    schedule: { anyOf: [{ $ref: "#/$defs/CenterSchedule" }, { type: "null" }] },
    deletedAt: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 9007199254740991 }, { type: "null" }],
    },
    purgeAfter: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 9007199254740991 }, { type: "null" }],
    },
  },
  required: [
    "contractVersion",
    "profile",
    "ownerSubject",
    "vaultId",
    "taskId",
    "taskVersion",
    "executionEpoch",
    "ruleVersion",
    "lifecycleEpoch",
    "definitionVersion",
    "status",
    "schedule",
    "deletedAt",
    "purgeAfter",
  ],
  additionalProperties: false,
};
var func3 = Object.prototype.hasOwnProperty;
var pattern4 = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "u");
function validate58(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate58.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 128) {
        validate58.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 128 } },
        ];
        return false;
      } else {
        if (func1(data) < 1) {
          validate58.errors = [
            { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 1 } },
          ];
          return false;
        } else {
          if (!pattern4.test(data)) {
            validate58.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate58.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate58.errors = vErrors;
  return errors === 0;
}
validate58.evaluated = { dynamicProps: false, dynamicItems: false };
function validate62(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate62.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.frequency === void 0 && (missing0 = "frequency")) ||
        (data.days === void 0 && (missing0 = "days")) ||
        (data.localTime === void 0 && (missing0 = "localTime")) ||
        (data.timeZone === void 0 && (missing0 = "timeZone")) ||
        (data.graceMinutes === void 0 && (missing0 = "graceMinutes")) ||
        (data.effectiveFrom === void 0 && (missing0 = "effectiveFrom")) ||
        (data.dstGap === void 0 && (missing0 = "dstGap")) ||
        (data.dstFold === void 0 && (missing0 = "dstFold"))
      ) {
        validate62.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === "frequency" ||
            key0 === "days" ||
            key0 === "localTime" ||
            key0 === "timeZone" ||
            key0 === "graceMinutes" ||
            key0 === "effectiveFrom" ||
            key0 === "dstGap" ||
            key0 === "dstFold"
          )) {
            validate62.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.frequency !== void 0) {
            let data0 = data.frequency;
            const _errs2 = errors;
            if (!(data0 === "daily" || data0 === "weekly")) {
              validate62.errors = [
                {
                  instancePath: instancePath + "/frequency",
                  schemaPath: "#/properties/frequency/enum",
                  keyword: "enum",
                  params: { allowedValues: schema21.properties.frequency.enum },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.days !== void 0) {
              let data1 = data.days;
              const _errs3 = errors;
              if (errors === _errs3) {
                if (Array.isArray(data1)) {
                  if (data1.length > 7) {
                    validate62.errors = [
                      {
                        instancePath: instancePath + "/days",
                        schemaPath: "#/properties/days/maxItems",
                        keyword: "maxItems",
                        params: { limit: 7 },
                      },
                    ];
                    return false;
                  } else {
                    var valid1 = true;
                    const len0 = data1.length;
                    for (let i0 = 0; i0 < len0; i0++) {
                      let data2 = data1[i0];
                      const _errs5 = errors;
                      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2))) {
                        validate62.errors = [
                          {
                            instancePath: instancePath + "/days/" + i0,
                            schemaPath: "#/properties/days/items/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs5) {
                        if (typeof data2 == "number") {
                          if (data2 > 7 || isNaN(data2)) {
                            validate62.errors = [
                              {
                                instancePath: instancePath + "/days/" + i0,
                                schemaPath: "#/properties/days/items/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 7 },
                              },
                            ];
                            return false;
                          } else {
                            if (data2 < 1 || isNaN(data2)) {
                              validate62.errors = [
                                {
                                  instancePath: instancePath + "/days/" + i0,
                                  schemaPath: "#/properties/days/items/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      }
                      var valid1 = _errs5 === errors;
                      if (!valid1) {
                        break;
                      }
                    }
                    if (valid1) {
                      let i1 = data1.length;
                      let j0;
                      if (i1 > 1) {
                        const indices0 = {};
                        for (; i1--;) {
                          let item0 = data1[i1];
                          if (!(typeof item0 == "number" && !(item0 % 1) && !isNaN(item0))) {
                            continue;
                          }
                          if (typeof indices0[item0] == "number") {
                            j0 = indices0[item0];
                            validate62.errors = [
                              {
                                instancePath: instancePath + "/days",
                                schemaPath: "#/properties/days/uniqueItems",
                                keyword: "uniqueItems",
                                params: { i: i1, j: j0 },
                              },
                            ];
                            return false;
                            break;
                          }
                          indices0[item0] = i1;
                        }
                      }
                    }
                  }
                } else {
                  validate62.errors = [
                    {
                      instancePath: instancePath + "/days",
                      schemaPath: "#/properties/days/type",
                      keyword: "type",
                      params: { type: "array" },
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.localTime !== void 0) {
                let data3 = data.localTime;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (typeof data3 === "string") {
                    if (!pattern3.test(data3)) {
                      validate62.errors = [
                        {
                          instancePath: instancePath + "/localTime",
                          schemaPath: "#/properties/localTime/pattern",
                          keyword: "pattern",
                          params: { pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate62.errors = [
                      {
                        instancePath: instancePath + "/localTime",
                        schemaPath: "#/properties/localTime/type",
                        keyword: "type",
                        params: { type: "string" },
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.timeZone !== void 0) {
                  let data4 = data.timeZone;
                  const _errs9 = errors;
                  if (errors === _errs9) {
                    if (typeof data4 === "string") {
                      if (func1(data4) > 80) {
                        validate62.errors = [
                          {
                            instancePath: instancePath + "/timeZone",
                            schemaPath: "#/properties/timeZone/maxLength",
                            keyword: "maxLength",
                            params: { limit: 80 },
                          },
                        ];
                        return false;
                      } else {
                        if (func1(data4) < 1) {
                          validate62.errors = [
                            {
                              instancePath: instancePath + "/timeZone",
                              schemaPath: "#/properties/timeZone/minLength",
                              keyword: "minLength",
                              params: { limit: 1 },
                            },
                          ];
                          return false;
                        }
                      }
                    } else {
                      validate62.errors = [
                        {
                          instancePath: instancePath + "/timeZone",
                          schemaPath: "#/properties/timeZone/type",
                          keyword: "type",
                          params: { type: "string" },
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.graceMinutes !== void 0) {
                    let data5 = data.graceMinutes;
                    const _errs11 = errors;
                    if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5))) {
                      validate62.errors = [
                        {
                          instancePath: instancePath + "/graceMinutes",
                          schemaPath: "#/properties/graceMinutes/type",
                          keyword: "type",
                          params: { type: "integer" },
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs11) {
                      if (typeof data5 == "number") {
                        if (data5 > 1440 || isNaN(data5)) {
                          validate62.errors = [
                            {
                              instancePath: instancePath + "/graceMinutes",
                              schemaPath: "#/properties/graceMinutes/maximum",
                              keyword: "maximum",
                              params: { comparison: "<=", limit: 1440 },
                            },
                          ];
                          return false;
                        } else {
                          if (data5 < 0 || isNaN(data5)) {
                            validate62.errors = [
                              {
                                instancePath: instancePath + "/graceMinutes",
                                schemaPath: "#/properties/graceMinutes/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 0 },
                              },
                            ];
                            return false;
                          }
                        }
                      }
                    }
                    var valid0 = _errs11 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.effectiveFrom !== void 0) {
                      let data6 = data.effectiveFrom;
                      const _errs13 = errors;
                      if (!(typeof data6 == "number" && !(data6 % 1) && !isNaN(data6))) {
                        validate62.errors = [
                          {
                            instancePath: instancePath + "/effectiveFrom",
                            schemaPath: "#/properties/effectiveFrom/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs13) {
                        if (typeof data6 == "number") {
                          if (data6 > 9007199254740991 || isNaN(data6)) {
                            validate62.errors = [
                              {
                                instancePath: instancePath + "/effectiveFrom",
                                schemaPath: "#/properties/effectiveFrom/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 9007199254740991 },
                              },
                            ];
                            return false;
                          } else {
                            if (data6 < 0 || isNaN(data6)) {
                              validate62.errors = [
                                {
                                  instancePath: instancePath + "/effectiveFrom",
                                  schemaPath: "#/properties/effectiveFrom/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 0 },
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      }
                      var valid0 = _errs13 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.dstGap !== void 0) {
                        const _errs15 = errors;
                        if ("skip" !== data.dstGap) {
                          validate62.errors = [
                            {
                              instancePath: instancePath + "/dstGap",
                              schemaPath: "#/properties/dstGap/const",
                              keyword: "const",
                              params: { allowedValue: "skip" },
                            },
                          ];
                          return false;
                        }
                        var valid0 = _errs15 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.dstFold !== void 0) {
                          const _errs16 = errors;
                          if ("first" !== data.dstFold) {
                            validate62.errors = [
                              {
                                instancePath: instancePath + "/dstFold",
                                schemaPath: "#/properties/dstFold/const",
                                keyword: "const",
                                params: { allowedValue: "first" },
                              },
                            ];
                            return false;
                          }
                          var valid0 = _errs16 === errors;
                        } else {
                          var valid0 = true;
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
    } else {
      validate62.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate62.errors = vErrors;
  return errors === 0;
}
validate62.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate57(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate57.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.contractVersion === void 0 && (missing0 = "contractVersion")) ||
        (data.profile === void 0 && (missing0 = "profile")) ||
        (data.ownerSubject === void 0 && (missing0 = "ownerSubject")) ||
        (data.vaultId === void 0 && (missing0 = "vaultId")) ||
        (data.taskId === void 0 && (missing0 = "taskId")) ||
        (data.taskVersion === void 0 && (missing0 = "taskVersion")) ||
        (data.executionEpoch === void 0 && (missing0 = "executionEpoch")) ||
        (data.ruleVersion === void 0 && (missing0 = "ruleVersion")) ||
        (data.lifecycleEpoch === void 0 && (missing0 = "lifecycleEpoch")) ||
        (data.definitionVersion === void 0 && (missing0 = "definitionVersion")) ||
        (data.status === void 0 && (missing0 = "status")) ||
        (data.schedule === void 0 && (missing0 = "schedule")) ||
        (data.deletedAt === void 0 && (missing0 = "deletedAt")) ||
        (data.purgeAfter === void 0 && (missing0 = "purgeAfter"))
      ) {
        validate57.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func3.call(schema23.properties, key0)) {
            validate57.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.contractVersion !== void 0) {
            const _errs2 = errors;
            if ("folioview.agent-workspace.v2.0" !== data.contractVersion) {
              validate57.errors = [
                {
                  instancePath: instancePath + "/contractVersion",
                  schemaPath: "#/properties/contractVersion/const",
                  keyword: "const",
                  params: { allowedValue: "folioview.agent-workspace.v2.0" },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.profile !== void 0) {
              const _errs3 = errors;
              if ("folioview.task-center.v1" !== data.profile) {
                validate57.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.task-center.v1" },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.ownerSubject !== void 0) {
                const _errs4 = errors;
                if (
                  !validate58(data.ownerSubject, {
                    instancePath: instancePath + "/ownerSubject",
                    parentData: data,
                    parentDataProperty: "ownerSubject",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.vaultId !== void 0) {
                  const _errs5 = errors;
                  if (
                    !validate58(data.vaultId, {
                      instancePath: instancePath + "/vaultId",
                      parentData: data,
                      parentDataProperty: "vaultId",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs5 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.taskId !== void 0) {
                    const _errs6 = errors;
                    if (
                      !validate58(data.taskId, {
                        instancePath: instancePath + "/taskId",
                        parentData: data,
                        parentDataProperty: "taskId",
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs6 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.taskVersion !== void 0) {
                      let data5 = data.taskVersion;
                      const _errs7 = errors;
                      if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5))) {
                        validate57.errors = [
                          {
                            instancePath: instancePath + "/taskVersion",
                            schemaPath: "#/properties/taskVersion/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs7) {
                        if (typeof data5 == "number") {
                          if (data5 > 9007199254740991 || isNaN(data5)) {
                            validate57.errors = [
                              {
                                instancePath: instancePath + "/taskVersion",
                                schemaPath: "#/properties/taskVersion/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 9007199254740991 },
                              },
                            ];
                            return false;
                          } else {
                            if (data5 < 1 || isNaN(data5)) {
                              validate57.errors = [
                                {
                                  instancePath: instancePath + "/taskVersion",
                                  schemaPath: "#/properties/taskVersion/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      }
                      var valid0 = _errs7 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.executionEpoch !== void 0) {
                        let data6 = data.executionEpoch;
                        const _errs9 = errors;
                        if (!(typeof data6 == "number" && !(data6 % 1) && !isNaN(data6))) {
                          validate57.errors = [
                            {
                              instancePath: instancePath + "/executionEpoch",
                              schemaPath: "#/properties/executionEpoch/type",
                              keyword: "type",
                              params: { type: "integer" },
                            },
                          ];
                          return false;
                        }
                        if (errors === _errs9) {
                          if (typeof data6 == "number") {
                            if (data6 > 9007199254740991 || isNaN(data6)) {
                              validate57.errors = [
                                {
                                  instancePath: instancePath + "/executionEpoch",
                                  schemaPath: "#/properties/executionEpoch/maximum",
                                  keyword: "maximum",
                                  params: { comparison: "<=", limit: 9007199254740991 },
                                },
                              ];
                              return false;
                            } else {
                              if (data6 < 1 || isNaN(data6)) {
                                validate57.errors = [
                                  {
                                    instancePath: instancePath + "/executionEpoch",
                                    schemaPath: "#/properties/executionEpoch/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                        }
                        var valid0 = _errs9 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.ruleVersion !== void 0) {
                          let data7 = data.ruleVersion;
                          const _errs11 = errors;
                          if (!(typeof data7 == "number" && !(data7 % 1) && !isNaN(data7))) {
                            validate57.errors = [
                              {
                                instancePath: instancePath + "/ruleVersion",
                                schemaPath: "#/properties/ruleVersion/type",
                                keyword: "type",
                                params: { type: "integer" },
                              },
                            ];
                            return false;
                          }
                          if (errors === _errs11) {
                            if (typeof data7 == "number") {
                              if (data7 > 9007199254740991 || isNaN(data7)) {
                                validate57.errors = [
                                  {
                                    instancePath: instancePath + "/ruleVersion",
                                    schemaPath: "#/properties/ruleVersion/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  },
                                ];
                                return false;
                              } else {
                                if (data7 < 1 || isNaN(data7)) {
                                  validate57.errors = [
                                    {
                                      instancePath: instancePath + "/ruleVersion",
                                      schemaPath: "#/properties/ruleVersion/minimum",
                                      keyword: "minimum",
                                      params: { comparison: ">=", limit: 1 },
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                          }
                          var valid0 = _errs11 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.lifecycleEpoch !== void 0) {
                            let data8 = data.lifecycleEpoch;
                            const _errs13 = errors;
                            if (!(typeof data8 == "number" && !(data8 % 1) && !isNaN(data8))) {
                              validate57.errors = [
                                {
                                  instancePath: instancePath + "/lifecycleEpoch",
                                  schemaPath: "#/properties/lifecycleEpoch/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs13) {
                              if (typeof data8 == "number") {
                                if (data8 > 9007199254740991 || isNaN(data8)) {
                                  validate57.errors = [
                                    {
                                      instancePath: instancePath + "/lifecycleEpoch",
                                      schemaPath: "#/properties/lifecycleEpoch/maximum",
                                      keyword: "maximum",
                                      params: { comparison: "<=", limit: 9007199254740991 },
                                    },
                                  ];
                                  return false;
                                } else {
                                  if (data8 < 1 || isNaN(data8)) {
                                    validate57.errors = [
                                      {
                                        instancePath: instancePath + "/lifecycleEpoch",
                                        schemaPath: "#/properties/lifecycleEpoch/minimum",
                                        keyword: "minimum",
                                        params: { comparison: ">=", limit: 1 },
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              }
                            }
                            var valid0 = _errs13 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.definitionVersion !== void 0) {
                              let data9 = data.definitionVersion;
                              const _errs15 = errors;
                              if (!(typeof data9 == "number" && !(data9 % 1) && !isNaN(data9))) {
                                validate57.errors = [
                                  {
                                    instancePath: instancePath + "/definitionVersion",
                                    schemaPath: "#/properties/definitionVersion/type",
                                    keyword: "type",
                                    params: { type: "integer" },
                                  },
                                ];
                                return false;
                              }
                              if (errors === _errs15) {
                                if (typeof data9 == "number") {
                                  if (data9 > 9007199254740991 || isNaN(data9)) {
                                    validate57.errors = [
                                      {
                                        instancePath: instancePath + "/definitionVersion",
                                        schemaPath: "#/properties/definitionVersion/maximum",
                                        keyword: "maximum",
                                        params: { comparison: "<=", limit: 9007199254740991 },
                                      },
                                    ];
                                    return false;
                                  } else {
                                    if (data9 < 1 || isNaN(data9)) {
                                      validate57.errors = [
                                        {
                                          instancePath: instancePath + "/definitionVersion",
                                          schemaPath: "#/properties/definitionVersion/minimum",
                                          keyword: "minimum",
                                          params: { comparison: ">=", limit: 1 },
                                        },
                                      ];
                                      return false;
                                    }
                                  }
                                }
                              }
                              var valid0 = _errs15 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.status !== void 0) {
                                let data10 = data.status;
                                const _errs17 = errors;
                                if (!(
                                  data10 === "active" ||
                                  data10 === "trashed" ||
                                  data10 === "purged"
                                )) {
                                  validate57.errors = [
                                    {
                                      instancePath: instancePath + "/status",
                                      schemaPath: "#/properties/status/enum",
                                      keyword: "enum",
                                      params: { allowedValues: schema23.properties.status.enum },
                                    },
                                  ];
                                  return false;
                                }
                                var valid0 = _errs17 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.schedule !== void 0) {
                                  let data11 = data.schedule;
                                  const _errs18 = errors;
                                  const _errs19 = errors;
                                  let valid1 = false;
                                  const _errs20 = errors;
                                  if (
                                    !validate62(data11, {
                                      instancePath: instancePath + "/schedule",
                                      parentData: data,
                                      parentDataProperty: "schedule",
                                      rootData,
                                      dynamicAnchors,
                                    })
                                  ) {
                                    vErrors =
                                      vErrors === null
                                        ? validate62.errors
                                        : vErrors.concat(validate62.errors);
                                    errors = vErrors.length;
                                  }
                                  var _valid0 = _errs20 === errors;
                                  valid1 = valid1 || _valid0;
                                  const _errs21 = errors;
                                  if (data11 !== null) {
                                    const err0 = {
                                      instancePath: instancePath + "/schedule",
                                      schemaPath: "#/properties/schedule/anyOf/1/type",
                                      keyword: "type",
                                      params: { type: "null" },
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err0];
                                    } else {
                                      vErrors.push(err0);
                                    }
                                    errors++;
                                  }
                                  var _valid0 = _errs21 === errors;
                                  valid1 = valid1 || _valid0;
                                  if (!valid1) {
                                    const err1 = {
                                      instancePath: instancePath + "/schedule",
                                      schemaPath: "#/properties/schedule/anyOf",
                                      keyword: "anyOf",
                                      params: {},
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err1];
                                    } else {
                                      vErrors.push(err1);
                                    }
                                    errors++;
                                    validate57.errors = vErrors;
                                    return false;
                                  } else {
                                    errors = _errs19;
                                    if (vErrors !== null) {
                                      if (_errs19) {
                                        vErrors.length = _errs19;
                                      } else {
                                        vErrors = null;
                                      }
                                    }
                                  }
                                  var valid0 = _errs18 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (data.deletedAt !== void 0) {
                                    let data12 = data.deletedAt;
                                    const _errs23 = errors;
                                    const _errs24 = errors;
                                    let valid2 = false;
                                    const _errs25 = errors;
                                    if (!(
                                      typeof data12 == "number" &&
                                      !(data12 % 1) &&
                                      !isNaN(data12)
                                    )) {
                                      const err2 = {
                                        instancePath: instancePath + "/deletedAt",
                                        schemaPath: "#/properties/deletedAt/anyOf/0/type",
                                        keyword: "type",
                                        params: { type: "integer" },
                                      };
                                      if (vErrors === null) {
                                        vErrors = [err2];
                                      } else {
                                        vErrors.push(err2);
                                      }
                                      errors++;
                                    }
                                    if (errors === _errs25) {
                                      if (typeof data12 == "number") {
                                        if (data12 > 9007199254740991 || isNaN(data12)) {
                                          const err3 = {
                                            instancePath: instancePath + "/deletedAt",
                                            schemaPath: "#/properties/deletedAt/anyOf/0/maximum",
                                            keyword: "maximum",
                                            params: { comparison: "<=", limit: 9007199254740991 },
                                          };
                                          if (vErrors === null) {
                                            vErrors = [err3];
                                          } else {
                                            vErrors.push(err3);
                                          }
                                          errors++;
                                        } else {
                                          if (data12 < 0 || isNaN(data12)) {
                                            const err4 = {
                                              instancePath: instancePath + "/deletedAt",
                                              schemaPath: "#/properties/deletedAt/anyOf/0/minimum",
                                              keyword: "minimum",
                                              params: { comparison: ">=", limit: 0 },
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err4];
                                            } else {
                                              vErrors.push(err4);
                                            }
                                            errors++;
                                          }
                                        }
                                      }
                                    }
                                    var _valid1 = _errs25 === errors;
                                    valid2 = valid2 || _valid1;
                                    const _errs27 = errors;
                                    if (data12 !== null) {
                                      const err5 = {
                                        instancePath: instancePath + "/deletedAt",
                                        schemaPath: "#/properties/deletedAt/anyOf/1/type",
                                        keyword: "type",
                                        params: { type: "null" },
                                      };
                                      if (vErrors === null) {
                                        vErrors = [err5];
                                      } else {
                                        vErrors.push(err5);
                                      }
                                      errors++;
                                    }
                                    var _valid1 = _errs27 === errors;
                                    valid2 = valid2 || _valid1;
                                    if (!valid2) {
                                      const err6 = {
                                        instancePath: instancePath + "/deletedAt",
                                        schemaPath: "#/properties/deletedAt/anyOf",
                                        keyword: "anyOf",
                                        params: {},
                                      };
                                      if (vErrors === null) {
                                        vErrors = [err6];
                                      } else {
                                        vErrors.push(err6);
                                      }
                                      errors++;
                                      validate57.errors = vErrors;
                                      return false;
                                    } else {
                                      errors = _errs24;
                                      if (vErrors !== null) {
                                        if (_errs24) {
                                          vErrors.length = _errs24;
                                        } else {
                                          vErrors = null;
                                        }
                                      }
                                    }
                                    var valid0 = _errs23 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                  if (valid0) {
                                    if (data.purgeAfter !== void 0) {
                                      let data13 = data.purgeAfter;
                                      const _errs29 = errors;
                                      const _errs30 = errors;
                                      let valid3 = false;
                                      const _errs31 = errors;
                                      if (!(
                                        typeof data13 == "number" &&
                                        !(data13 % 1) &&
                                        !isNaN(data13)
                                      )) {
                                        const err7 = {
                                          instancePath: instancePath + "/purgeAfter",
                                          schemaPath: "#/properties/purgeAfter/anyOf/0/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                        };
                                        if (vErrors === null) {
                                          vErrors = [err7];
                                        } else {
                                          vErrors.push(err7);
                                        }
                                        errors++;
                                      }
                                      if (errors === _errs31) {
                                        if (typeof data13 == "number") {
                                          if (data13 > 9007199254740991 || isNaN(data13)) {
                                            const err8 = {
                                              instancePath: instancePath + "/purgeAfter",
                                              schemaPath: "#/properties/purgeAfter/anyOf/0/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err8];
                                            } else {
                                              vErrors.push(err8);
                                            }
                                            errors++;
                                          } else {
                                            if (data13 < 0 || isNaN(data13)) {
                                              const err9 = {
                                                instancePath: instancePath + "/purgeAfter",
                                                schemaPath:
                                                  "#/properties/purgeAfter/anyOf/0/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 0 },
                                              };
                                              if (vErrors === null) {
                                                vErrors = [err9];
                                              } else {
                                                vErrors.push(err9);
                                              }
                                              errors++;
                                            }
                                          }
                                        }
                                      }
                                      var _valid2 = _errs31 === errors;
                                      valid3 = valid3 || _valid2;
                                      const _errs33 = errors;
                                      if (data13 !== null) {
                                        const err10 = {
                                          instancePath: instancePath + "/purgeAfter",
                                          schemaPath: "#/properties/purgeAfter/anyOf/1/type",
                                          keyword: "type",
                                          params: { type: "null" },
                                        };
                                        if (vErrors === null) {
                                          vErrors = [err10];
                                        } else {
                                          vErrors.push(err10);
                                        }
                                        errors++;
                                      }
                                      var _valid2 = _errs33 === errors;
                                      valid3 = valid3 || _valid2;
                                      if (!valid3) {
                                        const err11 = {
                                          instancePath: instancePath + "/purgeAfter",
                                          schemaPath: "#/properties/purgeAfter/anyOf",
                                          keyword: "anyOf",
                                          params: {},
                                        };
                                        if (vErrors === null) {
                                          vErrors = [err11];
                                        } else {
                                          vErrors.push(err11);
                                        }
                                        errors++;
                                        validate57.errors = vErrors;
                                        return false;
                                      } else {
                                        errors = _errs30;
                                        if (vErrors !== null) {
                                          if (_errs30) {
                                            vErrors.length = _errs30;
                                          } else {
                                            vErrors = null;
                                          }
                                        }
                                      }
                                      var valid0 = _errs29 === errors;
                                    } else {
                                      var valid0 = true;
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
    } else {
      validate57.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate57.errors = vErrors;
  return errors === 0;
}
validate57.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate56(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate56.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (
    !validate57(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
    errors = vErrors.length;
  }
  validate56.errors = vErrors;
  return errors === 0;
}
validate56.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.CenterAssignment = validate65;
var schema27 = {
  type: "object",
  properties: {
    contractVersion: { const: "folioview.agent-workspace.v2.0" },
    profile: { const: "folioview.task-center.v1" },
    ownerSubject: { $ref: "#/$defs/Identifier" },
    vaultId: { $ref: "#/$defs/Identifier" },
    taskId: { $ref: "#/$defs/Identifier" },
    taskVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    executionEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    ruleVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    lifecycleEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    assignmentId: { $ref: "#/$defs/Identifier" },
    assignmentVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    slotId: { $ref: "#/$defs/Identifier" },
    provider: { enum: ["muse", "chatgpt"] },
    slotGeneration: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    credential: { $ref: "#/$defs/ProviderCredentialRef" },
    agentId: { $ref: "#/$defs/Identifier" },
    authorityFingerprint: { $ref: "#/$defs/Digest" },
    status: { enum: ["active", "removed"] },
  },
  required: [
    "contractVersion",
    "profile",
    "ownerSubject",
    "vaultId",
    "taskId",
    "taskVersion",
    "executionEpoch",
    "ruleVersion",
    "lifecycleEpoch",
    "assignmentId",
    "assignmentVersion",
    "slotId",
    "provider",
    "slotGeneration",
    "credential",
    "agentId",
    "authorityFingerprint",
    "status",
  ],
  additionalProperties: false,
};
var pattern6 = new RegExp("^[a-f0-9]{64}$", "u");
function validate75(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate75.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 64) {
        validate75.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 64 } },
        ];
        return false;
      } else {
        if (func1(data) < 64) {
          validate75.errors = [
            {
              instancePath,
              schemaPath: "#/minLength",
              keyword: "minLength",
              params: { limit: 64 },
            },
          ];
          return false;
        } else {
          if (!pattern6.test(data)) {
            validate75.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[a-f0-9]{64}$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate75.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate75.errors = vErrors;
  return errors === 0;
}
validate75.evaluated = { dynamicProps: false, dynamicItems: false };
function validate72(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate72.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.connectionId === void 0 && (missing0 = "connectionId")) ||
        (data.clientId === void 0 && (missing0 = "clientId")) ||
        (data.credentialGeneration === void 0 && (missing0 = "credentialGeneration")) ||
        (data.credentialFingerprint === void 0 && (missing0 = "credentialFingerprint"))
      ) {
        validate72.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === "connectionId" ||
            key0 === "clientId" ||
            key0 === "credentialGeneration" ||
            key0 === "credentialFingerprint"
          )) {
            validate72.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.connectionId !== void 0) {
            const _errs2 = errors;
            if (
              !validate58(data.connectionId, {
                instancePath: instancePath + "/connectionId",
                parentData: data,
                parentDataProperty: "connectionId",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.clientId !== void 0) {
              const _errs3 = errors;
              if (
                !validate58(data.clientId, {
                  instancePath: instancePath + "/clientId",
                  parentData: data,
                  parentDataProperty: "clientId",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.credentialGeneration !== void 0) {
                let data2 = data.credentialGeneration;
                const _errs4 = errors;
                if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2))) {
                  validate72.errors = [
                    {
                      instancePath: instancePath + "/credentialGeneration",
                      schemaPath: "#/properties/credentialGeneration/type",
                      keyword: "type",
                      params: { type: "integer" },
                    },
                  ];
                  return false;
                }
                if (errors === _errs4) {
                  if (typeof data2 == "number") {
                    if (data2 > 9007199254740991 || isNaN(data2)) {
                      validate72.errors = [
                        {
                          instancePath: instancePath + "/credentialGeneration",
                          schemaPath: "#/properties/credentialGeneration/maximum",
                          keyword: "maximum",
                          params: { comparison: "<=", limit: 9007199254740991 },
                        },
                      ];
                      return false;
                    } else {
                      if (data2 < 1 || isNaN(data2)) {
                        validate72.errors = [
                          {
                            instancePath: instancePath + "/credentialGeneration",
                            schemaPath: "#/properties/credentialGeneration/minimum",
                            keyword: "minimum",
                            params: { comparison: ">=", limit: 1 },
                          },
                        ];
                        return false;
                      }
                    }
                  }
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.credentialFingerprint !== void 0) {
                  const _errs6 = errors;
                  if (
                    !validate75(data.credentialFingerprint, {
                      instancePath: instancePath + "/credentialFingerprint",
                      parentData: data,
                      parentDataProperty: "credentialFingerprint",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs6 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate72.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate72.errors = vErrors;
  return errors === 0;
}
validate72.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate66(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate66.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.contractVersion === void 0 && (missing0 = "contractVersion")) ||
        (data.profile === void 0 && (missing0 = "profile")) ||
        (data.ownerSubject === void 0 && (missing0 = "ownerSubject")) ||
        (data.vaultId === void 0 && (missing0 = "vaultId")) ||
        (data.taskId === void 0 && (missing0 = "taskId")) ||
        (data.taskVersion === void 0 && (missing0 = "taskVersion")) ||
        (data.executionEpoch === void 0 && (missing0 = "executionEpoch")) ||
        (data.ruleVersion === void 0 && (missing0 = "ruleVersion")) ||
        (data.lifecycleEpoch === void 0 && (missing0 = "lifecycleEpoch")) ||
        (data.assignmentId === void 0 && (missing0 = "assignmentId")) ||
        (data.assignmentVersion === void 0 && (missing0 = "assignmentVersion")) ||
        (data.slotId === void 0 && (missing0 = "slotId")) ||
        (data.provider === void 0 && (missing0 = "provider")) ||
        (data.slotGeneration === void 0 && (missing0 = "slotGeneration")) ||
        (data.credential === void 0 && (missing0 = "credential")) ||
        (data.agentId === void 0 && (missing0 = "agentId")) ||
        (data.authorityFingerprint === void 0 && (missing0 = "authorityFingerprint")) ||
        (data.status === void 0 && (missing0 = "status"))
      ) {
        validate66.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func3.call(schema27.properties, key0)) {
            validate66.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.contractVersion !== void 0) {
            const _errs2 = errors;
            if ("folioview.agent-workspace.v2.0" !== data.contractVersion) {
              validate66.errors = [
                {
                  instancePath: instancePath + "/contractVersion",
                  schemaPath: "#/properties/contractVersion/const",
                  keyword: "const",
                  params: { allowedValue: "folioview.agent-workspace.v2.0" },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.profile !== void 0) {
              const _errs3 = errors;
              if ("folioview.task-center.v1" !== data.profile) {
                validate66.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.task-center.v1" },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.ownerSubject !== void 0) {
                const _errs4 = errors;
                if (
                  !validate58(data.ownerSubject, {
                    instancePath: instancePath + "/ownerSubject",
                    parentData: data,
                    parentDataProperty: "ownerSubject",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.vaultId !== void 0) {
                  const _errs5 = errors;
                  if (
                    !validate58(data.vaultId, {
                      instancePath: instancePath + "/vaultId",
                      parentData: data,
                      parentDataProperty: "vaultId",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs5 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.taskId !== void 0) {
                    const _errs6 = errors;
                    if (
                      !validate58(data.taskId, {
                        instancePath: instancePath + "/taskId",
                        parentData: data,
                        parentDataProperty: "taskId",
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs6 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.taskVersion !== void 0) {
                      let data5 = data.taskVersion;
                      const _errs7 = errors;
                      if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5))) {
                        validate66.errors = [
                          {
                            instancePath: instancePath + "/taskVersion",
                            schemaPath: "#/properties/taskVersion/type",
                            keyword: "type",
                            params: { type: "integer" },
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs7) {
                        if (typeof data5 == "number") {
                          if (data5 > 9007199254740991 || isNaN(data5)) {
                            validate66.errors = [
                              {
                                instancePath: instancePath + "/taskVersion",
                                schemaPath: "#/properties/taskVersion/maximum",
                                keyword: "maximum",
                                params: { comparison: "<=", limit: 9007199254740991 },
                              },
                            ];
                            return false;
                          } else {
                            if (data5 < 1 || isNaN(data5)) {
                              validate66.errors = [
                                {
                                  instancePath: instancePath + "/taskVersion",
                                  schemaPath: "#/properties/taskVersion/minimum",
                                  keyword: "minimum",
                                  params: { comparison: ">=", limit: 1 },
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      }
                      var valid0 = _errs7 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.executionEpoch !== void 0) {
                        let data6 = data.executionEpoch;
                        const _errs9 = errors;
                        if (!(typeof data6 == "number" && !(data6 % 1) && !isNaN(data6))) {
                          validate66.errors = [
                            {
                              instancePath: instancePath + "/executionEpoch",
                              schemaPath: "#/properties/executionEpoch/type",
                              keyword: "type",
                              params: { type: "integer" },
                            },
                          ];
                          return false;
                        }
                        if (errors === _errs9) {
                          if (typeof data6 == "number") {
                            if (data6 > 9007199254740991 || isNaN(data6)) {
                              validate66.errors = [
                                {
                                  instancePath: instancePath + "/executionEpoch",
                                  schemaPath: "#/properties/executionEpoch/maximum",
                                  keyword: "maximum",
                                  params: { comparison: "<=", limit: 9007199254740991 },
                                },
                              ];
                              return false;
                            } else {
                              if (data6 < 1 || isNaN(data6)) {
                                validate66.errors = [
                                  {
                                    instancePath: instancePath + "/executionEpoch",
                                    schemaPath: "#/properties/executionEpoch/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                        }
                        var valid0 = _errs9 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.ruleVersion !== void 0) {
                          let data7 = data.ruleVersion;
                          const _errs11 = errors;
                          if (!(typeof data7 == "number" && !(data7 % 1) && !isNaN(data7))) {
                            validate66.errors = [
                              {
                                instancePath: instancePath + "/ruleVersion",
                                schemaPath: "#/properties/ruleVersion/type",
                                keyword: "type",
                                params: { type: "integer" },
                              },
                            ];
                            return false;
                          }
                          if (errors === _errs11) {
                            if (typeof data7 == "number") {
                              if (data7 > 9007199254740991 || isNaN(data7)) {
                                validate66.errors = [
                                  {
                                    instancePath: instancePath + "/ruleVersion",
                                    schemaPath: "#/properties/ruleVersion/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 9007199254740991 },
                                  },
                                ];
                                return false;
                              } else {
                                if (data7 < 1 || isNaN(data7)) {
                                  validate66.errors = [
                                    {
                                      instancePath: instancePath + "/ruleVersion",
                                      schemaPath: "#/properties/ruleVersion/minimum",
                                      keyword: "minimum",
                                      params: { comparison: ">=", limit: 1 },
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                          }
                          var valid0 = _errs11 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.lifecycleEpoch !== void 0) {
                            let data8 = data.lifecycleEpoch;
                            const _errs13 = errors;
                            if (!(typeof data8 == "number" && !(data8 % 1) && !isNaN(data8))) {
                              validate66.errors = [
                                {
                                  instancePath: instancePath + "/lifecycleEpoch",
                                  schemaPath: "#/properties/lifecycleEpoch/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs13) {
                              if (typeof data8 == "number") {
                                if (data8 > 9007199254740991 || isNaN(data8)) {
                                  validate66.errors = [
                                    {
                                      instancePath: instancePath + "/lifecycleEpoch",
                                      schemaPath: "#/properties/lifecycleEpoch/maximum",
                                      keyword: "maximum",
                                      params: { comparison: "<=", limit: 9007199254740991 },
                                    },
                                  ];
                                  return false;
                                } else {
                                  if (data8 < 1 || isNaN(data8)) {
                                    validate66.errors = [
                                      {
                                        instancePath: instancePath + "/lifecycleEpoch",
                                        schemaPath: "#/properties/lifecycleEpoch/minimum",
                                        keyword: "minimum",
                                        params: { comparison: ">=", limit: 1 },
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              }
                            }
                            var valid0 = _errs13 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.assignmentId !== void 0) {
                              const _errs15 = errors;
                              if (
                                !validate58(data.assignmentId, {
                                  instancePath: instancePath + "/assignmentId",
                                  parentData: data,
                                  parentDataProperty: "assignmentId",
                                  rootData,
                                  dynamicAnchors,
                                })
                              ) {
                                vErrors =
                                  vErrors === null
                                    ? validate58.errors
                                    : vErrors.concat(validate58.errors);
                                errors = vErrors.length;
                              }
                              var valid0 = _errs15 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.assignmentVersion !== void 0) {
                                let data10 = data.assignmentVersion;
                                const _errs16 = errors;
                                if (!(
                                  typeof data10 == "number" &&
                                  !(data10 % 1) &&
                                  !isNaN(data10)
                                )) {
                                  validate66.errors = [
                                    {
                                      instancePath: instancePath + "/assignmentVersion",
                                      schemaPath: "#/properties/assignmentVersion/type",
                                      keyword: "type",
                                      params: { type: "integer" },
                                    },
                                  ];
                                  return false;
                                }
                                if (errors === _errs16) {
                                  if (typeof data10 == "number") {
                                    if (data10 > 9007199254740991 || isNaN(data10)) {
                                      validate66.errors = [
                                        {
                                          instancePath: instancePath + "/assignmentVersion",
                                          schemaPath: "#/properties/assignmentVersion/maximum",
                                          keyword: "maximum",
                                          params: { comparison: "<=", limit: 9007199254740991 },
                                        },
                                      ];
                                      return false;
                                    } else {
                                      if (data10 < 1 || isNaN(data10)) {
                                        validate66.errors = [
                                          {
                                            instancePath: instancePath + "/assignmentVersion",
                                            schemaPath: "#/properties/assignmentVersion/minimum",
                                            keyword: "minimum",
                                            params: { comparison: ">=", limit: 1 },
                                          },
                                        ];
                                        return false;
                                      }
                                    }
                                  }
                                }
                                var valid0 = _errs16 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.slotId !== void 0) {
                                  const _errs18 = errors;
                                  if (
                                    !validate58(data.slotId, {
                                      instancePath: instancePath + "/slotId",
                                      parentData: data,
                                      parentDataProperty: "slotId",
                                      rootData,
                                      dynamicAnchors,
                                    })
                                  ) {
                                    vErrors =
                                      vErrors === null
                                        ? validate58.errors
                                        : vErrors.concat(validate58.errors);
                                    errors = vErrors.length;
                                  }
                                  var valid0 = _errs18 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (data.provider !== void 0) {
                                    let data12 = data.provider;
                                    const _errs19 = errors;
                                    if (!(data12 === "muse" || data12 === "chatgpt")) {
                                      validate66.errors = [
                                        {
                                          instancePath: instancePath + "/provider",
                                          schemaPath: "#/properties/provider/enum",
                                          keyword: "enum",
                                          params: {
                                            allowedValues: schema27.properties.provider.enum,
                                          },
                                        },
                                      ];
                                      return false;
                                    }
                                    var valid0 = _errs19 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                  if (valid0) {
                                    if (data.slotGeneration !== void 0) {
                                      let data13 = data.slotGeneration;
                                      const _errs20 = errors;
                                      if (!(
                                        typeof data13 == "number" &&
                                        !(data13 % 1) &&
                                        !isNaN(data13)
                                      )) {
                                        validate66.errors = [
                                          {
                                            instancePath: instancePath + "/slotGeneration",
                                            schemaPath: "#/properties/slotGeneration/type",
                                            keyword: "type",
                                            params: { type: "integer" },
                                          },
                                        ];
                                        return false;
                                      }
                                      if (errors === _errs20) {
                                        if (typeof data13 == "number") {
                                          if (data13 > 9007199254740991 || isNaN(data13)) {
                                            validate66.errors = [
                                              {
                                                instancePath: instancePath + "/slotGeneration",
                                                schemaPath: "#/properties/slotGeneration/maximum",
                                                keyword: "maximum",
                                                params: {
                                                  comparison: "<=",
                                                  limit: 9007199254740991,
                                                },
                                              },
                                            ];
                                            return false;
                                          } else {
                                            if (data13 < 1 || isNaN(data13)) {
                                              validate66.errors = [
                                                {
                                                  instancePath: instancePath + "/slotGeneration",
                                                  schemaPath: "#/properties/slotGeneration/minimum",
                                                  keyword: "minimum",
                                                  params: { comparison: ">=", limit: 1 },
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                        }
                                      }
                                      var valid0 = _errs20 === errors;
                                    } else {
                                      var valid0 = true;
                                    }
                                    if (valid0) {
                                      if (data.credential !== void 0) {
                                        const _errs22 = errors;
                                        if (
                                          !validate72(data.credential, {
                                            instancePath: instancePath + "/credential",
                                            parentData: data,
                                            parentDataProperty: "credential",
                                            rootData,
                                            dynamicAnchors,
                                          })
                                        ) {
                                          vErrors =
                                            vErrors === null
                                              ? validate72.errors
                                              : vErrors.concat(validate72.errors);
                                          errors = vErrors.length;
                                        }
                                        var valid0 = _errs22 === errors;
                                      } else {
                                        var valid0 = true;
                                      }
                                      if (valid0) {
                                        if (data.agentId !== void 0) {
                                          const _errs23 = errors;
                                          if (
                                            !validate58(data.agentId, {
                                              instancePath: instancePath + "/agentId",
                                              parentData: data,
                                              parentDataProperty: "agentId",
                                              rootData,
                                              dynamicAnchors,
                                            })
                                          ) {
                                            vErrors =
                                              vErrors === null
                                                ? validate58.errors
                                                : vErrors.concat(validate58.errors);
                                            errors = vErrors.length;
                                          }
                                          var valid0 = _errs23 === errors;
                                        } else {
                                          var valid0 = true;
                                        }
                                        if (valid0) {
                                          if (data.authorityFingerprint !== void 0) {
                                            const _errs24 = errors;
                                            if (
                                              !validate75(data.authorityFingerprint, {
                                                instancePath:
                                                  instancePath + "/authorityFingerprint",
                                                parentData: data,
                                                parentDataProperty: "authorityFingerprint",
                                                rootData,
                                                dynamicAnchors,
                                              })
                                            ) {
                                              vErrors =
                                                vErrors === null
                                                  ? validate75.errors
                                                  : vErrors.concat(validate75.errors);
                                              errors = vErrors.length;
                                            }
                                            var valid0 = _errs24 === errors;
                                          } else {
                                            var valid0 = true;
                                          }
                                          if (valid0) {
                                            if (data.status !== void 0) {
                                              let data17 = data.status;
                                              const _errs25 = errors;
                                              if (!(data17 === "active" || data17 === "removed")) {
                                                validate66.errors = [
                                                  {
                                                    instancePath: instancePath + "/status",
                                                    schemaPath: "#/properties/status/enum",
                                                    keyword: "enum",
                                                    params: {
                                                      allowedValues:
                                                        schema27.properties.status.enum,
                                                    },
                                                  },
                                                ];
                                                return false;
                                              }
                                              var valid0 = _errs25 === errors;
                                            } else {
                                              var valid0 = true;
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
    } else {
      validate66.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate66.errors = vErrors;
  return errors === 0;
}
validate66.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate65(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate65.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (
    !validate66(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
    errors = vErrors.length;
  }
  validate65.errors = vErrors;
  return errors === 0;
}
validate65.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.CenterOwnerControl = validate81;
var schema31 = {
  type: "object",
  properties: {
    contractVersion: { const: "folioview.agent-workspace.v2.0" },
    profile: { const: "folioview.task-center.v1" },
    ownerSubject: { $ref: "#/$defs/Identifier" },
    vaultId: { $ref: "#/$defs/Identifier" },
    taskId: { $ref: "#/$defs/Identifier" },
    artifactType: { const: "task_center_control" },
    action: {
      enum: [
        "set_rules",
        "set_assignment",
        "remove_assignment",
        "trash",
        "restore",
        "purge",
        "manual_intent",
      ],
    },
    rootKeyId: { $ref: "#/$defs/KeyId" },
    deviceSigningKeyId: { $ref: "#/$defs/KeyId" },
    registrySequence: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    checkpointDigest: { $ref: "#/$defs/Digest" },
    keyEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    issuedAt: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    stableOperationId: { $ref: "#/$defs/OperationIdentifier" },
    expectedDefinitionVersion: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    expectedAssignmentVersion: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 9007199254740991 }, { type: "null" }],
    },
    assignmentId: { anyOf: [{ $ref: "#/$defs/Identifier" }, { type: "null" }] },
    schedule: { anyOf: [{ $ref: "#/$defs/CenterSchedule" }, { type: "null" }] },
    assignment: { anyOf: [{ $ref: "#/$defs/CenterAssignmentTarget" }, { type: "null" }] },
    intent: { anyOf: [{ $ref: "#/$defs/CenterIntentTarget" }, { type: "null" }] },
    taskVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    executionEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
  },
  required: [
    "contractVersion",
    "profile",
    "ownerSubject",
    "vaultId",
    "taskId",
    "artifactType",
    "action",
    "rootKeyId",
    "deviceSigningKeyId",
    "registrySequence",
    "checkpointDigest",
    "keyEpoch",
    "issuedAt",
    "stableOperationId",
    "expectedDefinitionVersion",
    "expectedAssignmentVersion",
    "assignmentId",
    "schedule",
    "assignment",
    "intent",
    "taskVersion",
    "executionEpoch",
  ],
  additionalProperties: false,
};
var pattern7 = new RegExp("^[A-Za-z0-9_-]{43}$", "u");
function validate86(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate86.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 43) {
        validate86.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 43 } },
        ];
        return false;
      } else {
        if (func1(data) < 43) {
          validate86.errors = [
            {
              instancePath,
              schemaPath: "#/minLength",
              keyword: "minLength",
              params: { limit: 43 },
            },
          ];
          return false;
        } else {
          if (!pattern7.test(data)) {
            validate86.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9_-]{43}$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate86.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate86.errors = vErrors;
  return errors === 0;
}
validate86.evaluated = { dynamicProps: false, dynamicItems: false };
var pattern8 = new RegExp("^[A-Za-z0-9_-]+$", "u");
function validate90(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate90.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 128) {
        validate90.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 128 } },
        ];
        return false;
      } else {
        if (func1(data) < 22) {
          validate90.errors = [
            {
              instancePath,
              schemaPath: "#/minLength",
              keyword: "minLength",
              params: { limit: 22 },
            },
          ];
          return false;
        } else {
          if (!pattern8.test(data)) {
            validate90.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Za-z0-9_-]+$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate90.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate90.errors = vErrors;
  return errors === 0;
}
validate90.evaluated = { dynamicProps: false, dynamicItems: false };
var schema34 = {
  type: "object",
  properties: {
    slotId: { $ref: "#/$defs/Identifier" },
    provider: { enum: ["muse", "chatgpt"] },
    slotGeneration: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    credential: { $ref: "#/$defs/ProviderCredentialRef" },
    agentId: { $ref: "#/$defs/Identifier" },
    authorityFingerprint: { $ref: "#/$defs/Digest" },
  },
  required: [
    "slotId",
    "provider",
    "slotGeneration",
    "credential",
    "agentId",
    "authorityFingerprint",
  ],
  additionalProperties: false,
};
function validate94(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate94.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.slotId === void 0 && (missing0 = "slotId")) ||
        (data.provider === void 0 && (missing0 = "provider")) ||
        (data.slotGeneration === void 0 && (missing0 = "slotGeneration")) ||
        (data.credential === void 0 && (missing0 = "credential")) ||
        (data.agentId === void 0 && (missing0 = "agentId")) ||
        (data.authorityFingerprint === void 0 && (missing0 = "authorityFingerprint"))
      ) {
        validate94.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === "slotId" ||
            key0 === "provider" ||
            key0 === "slotGeneration" ||
            key0 === "credential" ||
            key0 === "agentId" ||
            key0 === "authorityFingerprint"
          )) {
            validate94.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.slotId !== void 0) {
            const _errs2 = errors;
            if (
              !validate58(data.slotId, {
                instancePath: instancePath + "/slotId",
                parentData: data,
                parentDataProperty: "slotId",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.provider !== void 0) {
              let data1 = data.provider;
              const _errs3 = errors;
              if (!(data1 === "muse" || data1 === "chatgpt")) {
                validate94.errors = [
                  {
                    instancePath: instancePath + "/provider",
                    schemaPath: "#/properties/provider/enum",
                    keyword: "enum",
                    params: { allowedValues: schema34.properties.provider.enum },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.slotGeneration !== void 0) {
                let data2 = data.slotGeneration;
                const _errs4 = errors;
                if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2))) {
                  validate94.errors = [
                    {
                      instancePath: instancePath + "/slotGeneration",
                      schemaPath: "#/properties/slotGeneration/type",
                      keyword: "type",
                      params: { type: "integer" },
                    },
                  ];
                  return false;
                }
                if (errors === _errs4) {
                  if (typeof data2 == "number") {
                    if (data2 > 9007199254740991 || isNaN(data2)) {
                      validate94.errors = [
                        {
                          instancePath: instancePath + "/slotGeneration",
                          schemaPath: "#/properties/slotGeneration/maximum",
                          keyword: "maximum",
                          params: { comparison: "<=", limit: 9007199254740991 },
                        },
                      ];
                      return false;
                    } else {
                      if (data2 < 1 || isNaN(data2)) {
                        validate94.errors = [
                          {
                            instancePath: instancePath + "/slotGeneration",
                            schemaPath: "#/properties/slotGeneration/minimum",
                            keyword: "minimum",
                            params: { comparison: ">=", limit: 1 },
                          },
                        ];
                        return false;
                      }
                    }
                  }
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.credential !== void 0) {
                  const _errs6 = errors;
                  if (
                    !validate72(data.credential, {
                      instancePath: instancePath + "/credential",
                      parentData: data,
                      parentDataProperty: "credential",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs6 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.agentId !== void 0) {
                    const _errs7 = errors;
                    if (
                      !validate58(data.agentId, {
                        instancePath: instancePath + "/agentId",
                        parentData: data,
                        parentDataProperty: "agentId",
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs7 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.authorityFingerprint !== void 0) {
                      const _errs8 = errors;
                      if (
                        !validate75(data.authorityFingerprint, {
                          instancePath: instancePath + "/authorityFingerprint",
                          parentData: data,
                          parentDataProperty: "authorityFingerprint",
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
                        errors = vErrors.length;
                      }
                      var valid0 = _errs8 === errors;
                    } else {
                      var valid0 = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate94.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate94.errors = vErrors;
  return errors === 0;
}
validate94.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var func0 = require_equal().default;
function validate100(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate100.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.expiresAt === void 0 && (missing0 = "expiresAt")) ||
        (data.assignments === void 0 && (missing0 = "assignments"))
      ) {
        validate100.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "expiresAt" || key0 === "assignments")) {
            validate100.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.expiresAt !== void 0) {
            let data0 = data.expiresAt;
            const _errs2 = errors;
            if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0))) {
              validate100.errors = [
                {
                  instancePath: instancePath + "/expiresAt",
                  schemaPath: "#/properties/expiresAt/type",
                  keyword: "type",
                  params: { type: "integer" },
                },
              ];
              return false;
            }
            if (errors === _errs2) {
              if (typeof data0 == "number") {
                if (data0 > 9007199254740991 || isNaN(data0)) {
                  validate100.errors = [
                    {
                      instancePath: instancePath + "/expiresAt",
                      schemaPath: "#/properties/expiresAt/maximum",
                      keyword: "maximum",
                      params: { comparison: "<=", limit: 9007199254740991 },
                    },
                  ];
                  return false;
                } else {
                  if (data0 < 1 || isNaN(data0)) {
                    validate100.errors = [
                      {
                        instancePath: instancePath + "/expiresAt",
                        schemaPath: "#/properties/expiresAt/minimum",
                        keyword: "minimum",
                        params: { comparison: ">=", limit: 1 },
                      },
                    ];
                    return false;
                  }
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.assignments !== void 0) {
              let data1 = data.assignments;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (Array.isArray(data1)) {
                  if (data1.length > 32) {
                    validate100.errors = [
                      {
                        instancePath: instancePath + "/assignments",
                        schemaPath: "#/properties/assignments/maxItems",
                        keyword: "maxItems",
                        params: { limit: 32 },
                      },
                    ];
                    return false;
                  } else {
                    if (data1.length < 1) {
                      validate100.errors = [
                        {
                          instancePath: instancePath + "/assignments",
                          schemaPath: "#/properties/assignments/minItems",
                          keyword: "minItems",
                          params: { limit: 1 },
                        },
                      ];
                      return false;
                    } else {
                      var valid1 = true;
                      const len0 = data1.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        let data2 = data1[i0];
                        const _errs6 = errors;
                        if (errors === _errs6) {
                          if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                            let missing1;
                            if (
                              (data2.assignmentId === void 0 && (missing1 = "assignmentId")) ||
                              (data2.assignmentVersion === void 0 &&
                                (missing1 = "assignmentVersion"))
                            ) {
                              validate100.errors = [
                                {
                                  instancePath: instancePath + "/assignments/" + i0,
                                  schemaPath: "#/properties/assignments/items/required",
                                  keyword: "required",
                                  params: { missingProperty: missing1 },
                                },
                              ];
                              return false;
                            } else {
                              const _errs8 = errors;
                              for (const key1 in data2) {
                                if (!(key1 === "assignmentId" || key1 === "assignmentVersion")) {
                                  validate100.errors = [
                                    {
                                      instancePath: instancePath + "/assignments/" + i0,
                                      schemaPath:
                                        "#/properties/assignments/items/additionalProperties",
                                      keyword: "additionalProperties",
                                      params: { additionalProperty: key1 },
                                    },
                                  ];
                                  return false;
                                  break;
                                }
                              }
                              if (_errs8 === errors) {
                                if (data2.assignmentId !== void 0) {
                                  const _errs9 = errors;
                                  if (
                                    !validate58(data2.assignmentId, {
                                      instancePath:
                                        instancePath + "/assignments/" + i0 + "/assignmentId",
                                      parentData: data2,
                                      parentDataProperty: "assignmentId",
                                      rootData,
                                      dynamicAnchors,
                                    })
                                  ) {
                                    vErrors =
                                      vErrors === null
                                        ? validate58.errors
                                        : vErrors.concat(validate58.errors);
                                    errors = vErrors.length;
                                  }
                                  var valid2 = _errs9 === errors;
                                } else {
                                  var valid2 = true;
                                }
                                if (valid2) {
                                  if (data2.assignmentVersion !== void 0) {
                                    let data4 = data2.assignmentVersion;
                                    const _errs10 = errors;
                                    if (!(
                                      typeof data4 == "number" &&
                                      !(data4 % 1) &&
                                      !isNaN(data4)
                                    )) {
                                      validate100.errors = [
                                        {
                                          instancePath:
                                            instancePath +
                                            "/assignments/" +
                                            i0 +
                                            "/assignmentVersion",
                                          schemaPath:
                                            "#/properties/assignments/items/properties/assignmentVersion/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                        },
                                      ];
                                      return false;
                                    }
                                    if (errors === _errs10) {
                                      if (typeof data4 == "number") {
                                        if (data4 > 9007199254740991 || isNaN(data4)) {
                                          validate100.errors = [
                                            {
                                              instancePath:
                                                instancePath +
                                                "/assignments/" +
                                                i0 +
                                                "/assignmentVersion",
                                              schemaPath:
                                                "#/properties/assignments/items/properties/assignmentVersion/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            },
                                          ];
                                          return false;
                                        } else {
                                          if (data4 < 1 || isNaN(data4)) {
                                            validate100.errors = [
                                              {
                                                instancePath:
                                                  instancePath +
                                                  "/assignments/" +
                                                  i0 +
                                                  "/assignmentVersion",
                                                schemaPath:
                                                  "#/properties/assignments/items/properties/assignmentVersion/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 1 },
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                      }
                                    }
                                    var valid2 = _errs10 === errors;
                                  } else {
                                    var valid2 = true;
                                  }
                                }
                              }
                            }
                          } else {
                            validate100.errors = [
                              {
                                instancePath: instancePath + "/assignments/" + i0,
                                schemaPath: "#/properties/assignments/items/type",
                                keyword: "type",
                                params: { type: "object" },
                              },
                            ];
                            return false;
                          }
                        }
                        var valid1 = _errs6 === errors;
                        if (!valid1) {
                          break;
                        }
                      }
                      if (valid1) {
                        let i1 = data1.length;
                        let j0;
                        if (i1 > 1) {
                          outer0: for (; i1--;) {
                            for (j0 = i1; j0--;) {
                              if (func0(data1[i1], data1[j0])) {
                                validate100.errors = [
                                  {
                                    instancePath: instancePath + "/assignments",
                                    schemaPath: "#/properties/assignments/uniqueItems",
                                    keyword: "uniqueItems",
                                    params: { i: i1, j: j0 },
                                  },
                                ];
                                return false;
                                break outer0;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                } else {
                  validate100.errors = [
                    {
                      instancePath: instancePath + "/assignments",
                      schemaPath: "#/properties/assignments/type",
                      keyword: "type",
                      params: { type: "array" },
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate100.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate100.errors = vErrors;
  return errors === 0;
}
validate100.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate82(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate82.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.contractVersion === void 0 && (missing0 = "contractVersion")) ||
        (data.profile === void 0 && (missing0 = "profile")) ||
        (data.ownerSubject === void 0 && (missing0 = "ownerSubject")) ||
        (data.vaultId === void 0 && (missing0 = "vaultId")) ||
        (data.taskId === void 0 && (missing0 = "taskId")) ||
        (data.artifactType === void 0 && (missing0 = "artifactType")) ||
        (data.action === void 0 && (missing0 = "action")) ||
        (data.rootKeyId === void 0 && (missing0 = "rootKeyId")) ||
        (data.deviceSigningKeyId === void 0 && (missing0 = "deviceSigningKeyId")) ||
        (data.registrySequence === void 0 && (missing0 = "registrySequence")) ||
        (data.checkpointDigest === void 0 && (missing0 = "checkpointDigest")) ||
        (data.keyEpoch === void 0 && (missing0 = "keyEpoch")) ||
        (data.issuedAt === void 0 && (missing0 = "issuedAt")) ||
        (data.stableOperationId === void 0 && (missing0 = "stableOperationId")) ||
        (data.expectedDefinitionVersion === void 0 && (missing0 = "expectedDefinitionVersion")) ||
        (data.expectedAssignmentVersion === void 0 && (missing0 = "expectedAssignmentVersion")) ||
        (data.assignmentId === void 0 && (missing0 = "assignmentId")) ||
        (data.schedule === void 0 && (missing0 = "schedule")) ||
        (data.assignment === void 0 && (missing0 = "assignment")) ||
        (data.intent === void 0 && (missing0 = "intent")) ||
        (data.taskVersion === void 0 && (missing0 = "taskVersion")) ||
        (data.executionEpoch === void 0 && (missing0 = "executionEpoch"))
      ) {
        validate82.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func3.call(schema31.properties, key0)) {
            validate82.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.contractVersion !== void 0) {
            const _errs2 = errors;
            if ("folioview.agent-workspace.v2.0" !== data.contractVersion) {
              validate82.errors = [
                {
                  instancePath: instancePath + "/contractVersion",
                  schemaPath: "#/properties/contractVersion/const",
                  keyword: "const",
                  params: { allowedValue: "folioview.agent-workspace.v2.0" },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.profile !== void 0) {
              const _errs3 = errors;
              if ("folioview.task-center.v1" !== data.profile) {
                validate82.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.task-center.v1" },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.ownerSubject !== void 0) {
                const _errs4 = errors;
                if (
                  !validate58(data.ownerSubject, {
                    instancePath: instancePath + "/ownerSubject",
                    parentData: data,
                    parentDataProperty: "ownerSubject",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.vaultId !== void 0) {
                  const _errs5 = errors;
                  if (
                    !validate58(data.vaultId, {
                      instancePath: instancePath + "/vaultId",
                      parentData: data,
                      parentDataProperty: "vaultId",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs5 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.taskId !== void 0) {
                    const _errs6 = errors;
                    if (
                      !validate58(data.taskId, {
                        instancePath: instancePath + "/taskId",
                        parentData: data,
                        parentDataProperty: "taskId",
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs6 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.artifactType !== void 0) {
                      const _errs7 = errors;
                      if ("task_center_control" !== data.artifactType) {
                        validate82.errors = [
                          {
                            instancePath: instancePath + "/artifactType",
                            schemaPath: "#/properties/artifactType/const",
                            keyword: "const",
                            params: { allowedValue: "task_center_control" },
                          },
                        ];
                        return false;
                      }
                      var valid0 = _errs7 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.action !== void 0) {
                        let data6 = data.action;
                        const _errs8 = errors;
                        if (!(
                          data6 === "set_rules" ||
                          data6 === "set_assignment" ||
                          data6 === "remove_assignment" ||
                          data6 === "trash" ||
                          data6 === "restore" ||
                          data6 === "purge" ||
                          data6 === "manual_intent"
                        )) {
                          validate82.errors = [
                            {
                              instancePath: instancePath + "/action",
                              schemaPath: "#/properties/action/enum",
                              keyword: "enum",
                              params: { allowedValues: schema31.properties.action.enum },
                            },
                          ];
                          return false;
                        }
                        var valid0 = _errs8 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.rootKeyId !== void 0) {
                          const _errs9 = errors;
                          if (
                            !validate86(data.rootKeyId, {
                              instancePath: instancePath + "/rootKeyId",
                              parentData: data,
                              parentDataProperty: "rootKeyId",
                              rootData,
                              dynamicAnchors,
                            })
                          ) {
                            vErrors =
                              vErrors === null
                                ? validate86.errors
                                : vErrors.concat(validate86.errors);
                            errors = vErrors.length;
                          }
                          var valid0 = _errs9 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.deviceSigningKeyId !== void 0) {
                            const _errs10 = errors;
                            if (
                              !validate86(data.deviceSigningKeyId, {
                                instancePath: instancePath + "/deviceSigningKeyId",
                                parentData: data,
                                parentDataProperty: "deviceSigningKeyId",
                                rootData,
                                dynamicAnchors,
                              })
                            ) {
                              vErrors =
                                vErrors === null
                                  ? validate86.errors
                                  : vErrors.concat(validate86.errors);
                              errors = vErrors.length;
                            }
                            var valid0 = _errs10 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.registrySequence !== void 0) {
                              let data9 = data.registrySequence;
                              const _errs11 = errors;
                              if (!(typeof data9 == "number" && !(data9 % 1) && !isNaN(data9))) {
                                validate82.errors = [
                                  {
                                    instancePath: instancePath + "/registrySequence",
                                    schemaPath: "#/properties/registrySequence/type",
                                    keyword: "type",
                                    params: { type: "integer" },
                                  },
                                ];
                                return false;
                              }
                              if (errors === _errs11) {
                                if (typeof data9 == "number") {
                                  if (data9 > 9007199254740991 || isNaN(data9)) {
                                    validate82.errors = [
                                      {
                                        instancePath: instancePath + "/registrySequence",
                                        schemaPath: "#/properties/registrySequence/maximum",
                                        keyword: "maximum",
                                        params: { comparison: "<=", limit: 9007199254740991 },
                                      },
                                    ];
                                    return false;
                                  } else {
                                    if (data9 < 1 || isNaN(data9)) {
                                      validate82.errors = [
                                        {
                                          instancePath: instancePath + "/registrySequence",
                                          schemaPath: "#/properties/registrySequence/minimum",
                                          keyword: "minimum",
                                          params: { comparison: ">=", limit: 1 },
                                        },
                                      ];
                                      return false;
                                    }
                                  }
                                }
                              }
                              var valid0 = _errs11 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.checkpointDigest !== void 0) {
                                const _errs13 = errors;
                                if (
                                  !validate75(data.checkpointDigest, {
                                    instancePath: instancePath + "/checkpointDigest",
                                    parentData: data,
                                    parentDataProperty: "checkpointDigest",
                                    rootData,
                                    dynamicAnchors,
                                  })
                                ) {
                                  vErrors =
                                    vErrors === null
                                      ? validate75.errors
                                      : vErrors.concat(validate75.errors);
                                  errors = vErrors.length;
                                }
                                var valid0 = _errs13 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.keyEpoch !== void 0) {
                                  let data11 = data.keyEpoch;
                                  const _errs14 = errors;
                                  if (!(
                                    typeof data11 == "number" &&
                                    !(data11 % 1) &&
                                    !isNaN(data11)
                                  )) {
                                    validate82.errors = [
                                      {
                                        instancePath: instancePath + "/keyEpoch",
                                        schemaPath: "#/properties/keyEpoch/type",
                                        keyword: "type",
                                        params: { type: "integer" },
                                      },
                                    ];
                                    return false;
                                  }
                                  if (errors === _errs14) {
                                    if (typeof data11 == "number") {
                                      if (data11 > 9007199254740991 || isNaN(data11)) {
                                        validate82.errors = [
                                          {
                                            instancePath: instancePath + "/keyEpoch",
                                            schemaPath: "#/properties/keyEpoch/maximum",
                                            keyword: "maximum",
                                            params: { comparison: "<=", limit: 9007199254740991 },
                                          },
                                        ];
                                        return false;
                                      } else {
                                        if (data11 < 1 || isNaN(data11)) {
                                          validate82.errors = [
                                            {
                                              instancePath: instancePath + "/keyEpoch",
                                              schemaPath: "#/properties/keyEpoch/minimum",
                                              keyword: "minimum",
                                              params: { comparison: ">=", limit: 1 },
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                    }
                                  }
                                  var valid0 = _errs14 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (data.issuedAt !== void 0) {
                                    let data12 = data.issuedAt;
                                    const _errs16 = errors;
                                    if (!(
                                      typeof data12 == "number" &&
                                      !(data12 % 1) &&
                                      !isNaN(data12)
                                    )) {
                                      validate82.errors = [
                                        {
                                          instancePath: instancePath + "/issuedAt",
                                          schemaPath: "#/properties/issuedAt/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                        },
                                      ];
                                      return false;
                                    }
                                    if (errors === _errs16) {
                                      if (typeof data12 == "number") {
                                        if (data12 > 9007199254740991 || isNaN(data12)) {
                                          validate82.errors = [
                                            {
                                              instancePath: instancePath + "/issuedAt",
                                              schemaPath: "#/properties/issuedAt/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            },
                                          ];
                                          return false;
                                        } else {
                                          if (data12 < 0 || isNaN(data12)) {
                                            validate82.errors = [
                                              {
                                                instancePath: instancePath + "/issuedAt",
                                                schemaPath: "#/properties/issuedAt/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 0 },
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                      }
                                    }
                                    var valid0 = _errs16 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                  if (valid0) {
                                    if (data.stableOperationId !== void 0) {
                                      const _errs18 = errors;
                                      if (
                                        !validate90(data.stableOperationId, {
                                          instancePath: instancePath + "/stableOperationId",
                                          parentData: data,
                                          parentDataProperty: "stableOperationId",
                                          rootData,
                                          dynamicAnchors,
                                        })
                                      ) {
                                        vErrors =
                                          vErrors === null
                                            ? validate90.errors
                                            : vErrors.concat(validate90.errors);
                                        errors = vErrors.length;
                                      }
                                      var valid0 = _errs18 === errors;
                                    } else {
                                      var valid0 = true;
                                    }
                                    if (valid0) {
                                      if (data.expectedDefinitionVersion !== void 0) {
                                        let data14 = data.expectedDefinitionVersion;
                                        const _errs19 = errors;
                                        if (!(
                                          typeof data14 == "number" &&
                                          !(data14 % 1) &&
                                          !isNaN(data14)
                                        )) {
                                          validate82.errors = [
                                            {
                                              instancePath:
                                                instancePath + "/expectedDefinitionVersion",
                                              schemaPath:
                                                "#/properties/expectedDefinitionVersion/type",
                                              keyword: "type",
                                              params: { type: "integer" },
                                            },
                                          ];
                                          return false;
                                        }
                                        if (errors === _errs19) {
                                          if (typeof data14 == "number") {
                                            if (data14 > 9007199254740991 || isNaN(data14)) {
                                              validate82.errors = [
                                                {
                                                  instancePath:
                                                    instancePath + "/expectedDefinitionVersion",
                                                  schemaPath:
                                                    "#/properties/expectedDefinitionVersion/maximum",
                                                  keyword: "maximum",
                                                  params: {
                                                    comparison: "<=",
                                                    limit: 9007199254740991,
                                                  },
                                                },
                                              ];
                                              return false;
                                            } else {
                                              if (data14 < 0 || isNaN(data14)) {
                                                validate82.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + "/expectedDefinitionVersion",
                                                    schemaPath:
                                                      "#/properties/expectedDefinitionVersion/minimum",
                                                    keyword: "minimum",
                                                    params: { comparison: ">=", limit: 0 },
                                                  },
                                                ];
                                                return false;
                                              }
                                            }
                                          }
                                        }
                                        var valid0 = _errs19 === errors;
                                      } else {
                                        var valid0 = true;
                                      }
                                      if (valid0) {
                                        if (data.expectedAssignmentVersion !== void 0) {
                                          let data15 = data.expectedAssignmentVersion;
                                          const _errs21 = errors;
                                          const _errs22 = errors;
                                          let valid1 = false;
                                          const _errs23 = errors;
                                          if (!(
                                            typeof data15 == "number" &&
                                            !(data15 % 1) &&
                                            !isNaN(data15)
                                          )) {
                                            const err0 = {
                                              instancePath:
                                                instancePath + "/expectedAssignmentVersion",
                                              schemaPath:
                                                "#/properties/expectedAssignmentVersion/anyOf/0/type",
                                              keyword: "type",
                                              params: { type: "integer" },
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err0];
                                            } else {
                                              vErrors.push(err0);
                                            }
                                            errors++;
                                          }
                                          if (errors === _errs23) {
                                            if (typeof data15 == "number") {
                                              if (data15 > 9007199254740991 || isNaN(data15)) {
                                                const err1 = {
                                                  instancePath:
                                                    instancePath + "/expectedAssignmentVersion",
                                                  schemaPath:
                                                    "#/properties/expectedAssignmentVersion/anyOf/0/maximum",
                                                  keyword: "maximum",
                                                  params: {
                                                    comparison: "<=",
                                                    limit: 9007199254740991,
                                                  },
                                                };
                                                if (vErrors === null) {
                                                  vErrors = [err1];
                                                } else {
                                                  vErrors.push(err1);
                                                }
                                                errors++;
                                              } else {
                                                if (data15 < 0 || isNaN(data15)) {
                                                  const err2 = {
                                                    instancePath:
                                                      instancePath + "/expectedAssignmentVersion",
                                                    schemaPath:
                                                      "#/properties/expectedAssignmentVersion/anyOf/0/minimum",
                                                    keyword: "minimum",
                                                    params: { comparison: ">=", limit: 0 },
                                                  };
                                                  if (vErrors === null) {
                                                    vErrors = [err2];
                                                  } else {
                                                    vErrors.push(err2);
                                                  }
                                                  errors++;
                                                }
                                              }
                                            }
                                          }
                                          var _valid0 = _errs23 === errors;
                                          valid1 = valid1 || _valid0;
                                          const _errs25 = errors;
                                          if (data15 !== null) {
                                            const err3 = {
                                              instancePath:
                                                instancePath + "/expectedAssignmentVersion",
                                              schemaPath:
                                                "#/properties/expectedAssignmentVersion/anyOf/1/type",
                                              keyword: "type",
                                              params: { type: "null" },
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err3];
                                            } else {
                                              vErrors.push(err3);
                                            }
                                            errors++;
                                          }
                                          var _valid0 = _errs25 === errors;
                                          valid1 = valid1 || _valid0;
                                          if (!valid1) {
                                            const err4 = {
                                              instancePath:
                                                instancePath + "/expectedAssignmentVersion",
                                              schemaPath:
                                                "#/properties/expectedAssignmentVersion/anyOf",
                                              keyword: "anyOf",
                                              params: {},
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err4];
                                            } else {
                                              vErrors.push(err4);
                                            }
                                            errors++;
                                            validate82.errors = vErrors;
                                            return false;
                                          } else {
                                            errors = _errs22;
                                            if (vErrors !== null) {
                                              if (_errs22) {
                                                vErrors.length = _errs22;
                                              } else {
                                                vErrors = null;
                                              }
                                            }
                                          }
                                          var valid0 = _errs21 === errors;
                                        } else {
                                          var valid0 = true;
                                        }
                                        if (valid0) {
                                          if (data.assignmentId !== void 0) {
                                            let data16 = data.assignmentId;
                                            const _errs27 = errors;
                                            const _errs28 = errors;
                                            let valid2 = false;
                                            const _errs29 = errors;
                                            if (
                                              !validate58(data16, {
                                                instancePath: instancePath + "/assignmentId",
                                                parentData: data,
                                                parentDataProperty: "assignmentId",
                                                rootData,
                                                dynamicAnchors,
                                              })
                                            ) {
                                              vErrors =
                                                vErrors === null
                                                  ? validate58.errors
                                                  : vErrors.concat(validate58.errors);
                                              errors = vErrors.length;
                                            }
                                            var _valid1 = _errs29 === errors;
                                            valid2 = valid2 || _valid1;
                                            const _errs30 = errors;
                                            if (data16 !== null) {
                                              const err5 = {
                                                instancePath: instancePath + "/assignmentId",
                                                schemaPath:
                                                  "#/properties/assignmentId/anyOf/1/type",
                                                keyword: "type",
                                                params: { type: "null" },
                                              };
                                              if (vErrors === null) {
                                                vErrors = [err5];
                                              } else {
                                                vErrors.push(err5);
                                              }
                                              errors++;
                                            }
                                            var _valid1 = _errs30 === errors;
                                            valid2 = valid2 || _valid1;
                                            if (!valid2) {
                                              const err6 = {
                                                instancePath: instancePath + "/assignmentId",
                                                schemaPath: "#/properties/assignmentId/anyOf",
                                                keyword: "anyOf",
                                                params: {},
                                              };
                                              if (vErrors === null) {
                                                vErrors = [err6];
                                              } else {
                                                vErrors.push(err6);
                                              }
                                              errors++;
                                              validate82.errors = vErrors;
                                              return false;
                                            } else {
                                              errors = _errs28;
                                              if (vErrors !== null) {
                                                if (_errs28) {
                                                  vErrors.length = _errs28;
                                                } else {
                                                  vErrors = null;
                                                }
                                              }
                                            }
                                            var valid0 = _errs27 === errors;
                                          } else {
                                            var valid0 = true;
                                          }
                                          if (valid0) {
                                            if (data.schedule !== void 0) {
                                              let data17 = data.schedule;
                                              const _errs32 = errors;
                                              const _errs33 = errors;
                                              let valid3 = false;
                                              const _errs34 = errors;
                                              if (
                                                !validate62(data17, {
                                                  instancePath: instancePath + "/schedule",
                                                  parentData: data,
                                                  parentDataProperty: "schedule",
                                                  rootData,
                                                  dynamicAnchors,
                                                })
                                              ) {
                                                vErrors =
                                                  vErrors === null
                                                    ? validate62.errors
                                                    : vErrors.concat(validate62.errors);
                                                errors = vErrors.length;
                                              }
                                              var _valid2 = _errs34 === errors;
                                              valid3 = valid3 || _valid2;
                                              const _errs35 = errors;
                                              if (data17 !== null) {
                                                const err7 = {
                                                  instancePath: instancePath + "/schedule",
                                                  schemaPath: "#/properties/schedule/anyOf/1/type",
                                                  keyword: "type",
                                                  params: { type: "null" },
                                                };
                                                if (vErrors === null) {
                                                  vErrors = [err7];
                                                } else {
                                                  vErrors.push(err7);
                                                }
                                                errors++;
                                              }
                                              var _valid2 = _errs35 === errors;
                                              valid3 = valid3 || _valid2;
                                              if (!valid3) {
                                                const err8 = {
                                                  instancePath: instancePath + "/schedule",
                                                  schemaPath: "#/properties/schedule/anyOf",
                                                  keyword: "anyOf",
                                                  params: {},
                                                };
                                                if (vErrors === null) {
                                                  vErrors = [err8];
                                                } else {
                                                  vErrors.push(err8);
                                                }
                                                errors++;
                                                validate82.errors = vErrors;
                                                return false;
                                              } else {
                                                errors = _errs33;
                                                if (vErrors !== null) {
                                                  if (_errs33) {
                                                    vErrors.length = _errs33;
                                                  } else {
                                                    vErrors = null;
                                                  }
                                                }
                                              }
                                              var valid0 = _errs32 === errors;
                                            } else {
                                              var valid0 = true;
                                            }
                                            if (valid0) {
                                              if (data.assignment !== void 0) {
                                                let data18 = data.assignment;
                                                const _errs37 = errors;
                                                const _errs38 = errors;
                                                let valid4 = false;
                                                const _errs39 = errors;
                                                if (
                                                  !validate94(data18, {
                                                    instancePath: instancePath + "/assignment",
                                                    parentData: data,
                                                    parentDataProperty: "assignment",
                                                    rootData,
                                                    dynamicAnchors,
                                                  })
                                                ) {
                                                  vErrors =
                                                    vErrors === null
                                                      ? validate94.errors
                                                      : vErrors.concat(validate94.errors);
                                                  errors = vErrors.length;
                                                }
                                                var _valid3 = _errs39 === errors;
                                                valid4 = valid4 || _valid3;
                                                const _errs40 = errors;
                                                if (data18 !== null) {
                                                  const err9 = {
                                                    instancePath: instancePath + "/assignment",
                                                    schemaPath:
                                                      "#/properties/assignment/anyOf/1/type",
                                                    keyword: "type",
                                                    params: { type: "null" },
                                                  };
                                                  if (vErrors === null) {
                                                    vErrors = [err9];
                                                  } else {
                                                    vErrors.push(err9);
                                                  }
                                                  errors++;
                                                }
                                                var _valid3 = _errs40 === errors;
                                                valid4 = valid4 || _valid3;
                                                if (!valid4) {
                                                  const err10 = {
                                                    instancePath: instancePath + "/assignment",
                                                    schemaPath: "#/properties/assignment/anyOf",
                                                    keyword: "anyOf",
                                                    params: {},
                                                  };
                                                  if (vErrors === null) {
                                                    vErrors = [err10];
                                                  } else {
                                                    vErrors.push(err10);
                                                  }
                                                  errors++;
                                                  validate82.errors = vErrors;
                                                  return false;
                                                } else {
                                                  errors = _errs38;
                                                  if (vErrors !== null) {
                                                    if (_errs38) {
                                                      vErrors.length = _errs38;
                                                    } else {
                                                      vErrors = null;
                                                    }
                                                  }
                                                }
                                                var valid0 = _errs37 === errors;
                                              } else {
                                                var valid0 = true;
                                              }
                                              if (valid0) {
                                                if (data.intent !== void 0) {
                                                  let data19 = data.intent;
                                                  const _errs42 = errors;
                                                  const _errs43 = errors;
                                                  let valid5 = false;
                                                  const _errs44 = errors;
                                                  if (
                                                    !validate100(data19, {
                                                      instancePath: instancePath + "/intent",
                                                      parentData: data,
                                                      parentDataProperty: "intent",
                                                      rootData,
                                                      dynamicAnchors,
                                                    })
                                                  ) {
                                                    vErrors =
                                                      vErrors === null
                                                        ? validate100.errors
                                                        : vErrors.concat(validate100.errors);
                                                    errors = vErrors.length;
                                                  }
                                                  var _valid4 = _errs44 === errors;
                                                  valid5 = valid5 || _valid4;
                                                  const _errs45 = errors;
                                                  if (data19 !== null) {
                                                    const err11 = {
                                                      instancePath: instancePath + "/intent",
                                                      schemaPath:
                                                        "#/properties/intent/anyOf/1/type",
                                                      keyword: "type",
                                                      params: { type: "null" },
                                                    };
                                                    if (vErrors === null) {
                                                      vErrors = [err11];
                                                    } else {
                                                      vErrors.push(err11);
                                                    }
                                                    errors++;
                                                  }
                                                  var _valid4 = _errs45 === errors;
                                                  valid5 = valid5 || _valid4;
                                                  if (!valid5) {
                                                    const err12 = {
                                                      instancePath: instancePath + "/intent",
                                                      schemaPath: "#/properties/intent/anyOf",
                                                      keyword: "anyOf",
                                                      params: {},
                                                    };
                                                    if (vErrors === null) {
                                                      vErrors = [err12];
                                                    } else {
                                                      vErrors.push(err12);
                                                    }
                                                    errors++;
                                                    validate82.errors = vErrors;
                                                    return false;
                                                  } else {
                                                    errors = _errs43;
                                                    if (vErrors !== null) {
                                                      if (_errs43) {
                                                        vErrors.length = _errs43;
                                                      } else {
                                                        vErrors = null;
                                                      }
                                                    }
                                                  }
                                                  var valid0 = _errs42 === errors;
                                                } else {
                                                  var valid0 = true;
                                                }
                                                if (valid0) {
                                                  if (data.taskVersion !== void 0) {
                                                    let data20 = data.taskVersion;
                                                    const _errs47 = errors;
                                                    if (!(
                                                      typeof data20 == "number" &&
                                                      !(data20 % 1) &&
                                                      !isNaN(data20)
                                                    )) {
                                                      validate82.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath + "/taskVersion",
                                                          schemaPath:
                                                            "#/properties/taskVersion/type",
                                                          keyword: "type",
                                                          params: { type: "integer" },
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                    if (errors === _errs47) {
                                                      if (typeof data20 == "number") {
                                                        if (
                                                          data20 > 9007199254740991 ||
                                                          isNaN(data20)
                                                        ) {
                                                          validate82.errors = [
                                                            {
                                                              instancePath:
                                                                instancePath + "/taskVersion",
                                                              schemaPath:
                                                                "#/properties/taskVersion/maximum",
                                                              keyword: "maximum",
                                                              params: {
                                                                comparison: "<=",
                                                                limit: 9007199254740991,
                                                              },
                                                            },
                                                          ];
                                                          return false;
                                                        } else {
                                                          if (data20 < 1 || isNaN(data20)) {
                                                            validate82.errors = [
                                                              {
                                                                instancePath:
                                                                  instancePath + "/taskVersion",
                                                                schemaPath:
                                                                  "#/properties/taskVersion/minimum",
                                                                keyword: "minimum",
                                                                params: {
                                                                  comparison: ">=",
                                                                  limit: 1,
                                                                },
                                                              },
                                                            ];
                                                            return false;
                                                          }
                                                        }
                                                      }
                                                    }
                                                    var valid0 = _errs47 === errors;
                                                  } else {
                                                    var valid0 = true;
                                                  }
                                                  if (valid0) {
                                                    if (data.executionEpoch !== void 0) {
                                                      let data21 = data.executionEpoch;
                                                      const _errs49 = errors;
                                                      if (!(
                                                        typeof data21 == "number" &&
                                                        !(data21 % 1) &&
                                                        !isNaN(data21)
                                                      )) {
                                                        validate82.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath + "/executionEpoch",
                                                            schemaPath:
                                                              "#/properties/executionEpoch/type",
                                                            keyword: "type",
                                                            params: { type: "integer" },
                                                          },
                                                        ];
                                                        return false;
                                                      }
                                                      if (errors === _errs49) {
                                                        if (typeof data21 == "number") {
                                                          if (
                                                            data21 > 9007199254740991 ||
                                                            isNaN(data21)
                                                          ) {
                                                            validate82.errors = [
                                                              {
                                                                instancePath:
                                                                  instancePath + "/executionEpoch",
                                                                schemaPath:
                                                                  "#/properties/executionEpoch/maximum",
                                                                keyword: "maximum",
                                                                params: {
                                                                  comparison: "<=",
                                                                  limit: 9007199254740991,
                                                                },
                                                              },
                                                            ];
                                                            return false;
                                                          } else {
                                                            if (data21 < 1 || isNaN(data21)) {
                                                              validate82.errors = [
                                                                {
                                                                  instancePath:
                                                                    instancePath +
                                                                    "/executionEpoch",
                                                                  schemaPath:
                                                                    "#/properties/executionEpoch/minimum",
                                                                  keyword: "minimum",
                                                                  params: {
                                                                    comparison: ">=",
                                                                    limit: 1,
                                                                  },
                                                                },
                                                              ];
                                                              return false;
                                                            }
                                                          }
                                                        }
                                                      }
                                                      var valid0 = _errs49 === errors;
                                                    } else {
                                                      var valid0 = true;
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
    } else {
      validate82.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate82.errors = vErrors;
  return errors === 0;
}
validate82.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate81(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate81.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (
    !validate82(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
    errors = vErrors.length;
  }
  validate81.errors = vErrors;
  return errors === 0;
}
validate81.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.CenterAgentRequestPayload = validate104;
var schema37 = {
  type: "object",
  properties: {
    contractVersion: { const: "folioview.agent-workspace.v2.0" },
    profile: { const: "folioview.task-center.v1" },
    artifactType: { const: "task_center_agent_request" },
    purpose: { const: "authenticated_request" },
    ownerSubject: { $ref: "#/$defs/Identifier" },
    vaultId: { $ref: "#/$defs/Identifier" },
    connectionId: { $ref: "#/$defs/Identifier" },
    agentId: { $ref: "#/$defs/Identifier" },
    clientId: { $ref: "#/$defs/Identifier" },
    rootKeyId: { $ref: "#/$defs/KeyId" },
    agentSigningKeyId: { $ref: "#/$defs/KeyId" },
    agentEncryptionKeyId: { $ref: "#/$defs/KeyId" },
    identityEpoch: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    bindingFingerprint: { $ref: "#/$defs/Digest" },
    audience: { type: "string", format: "uri", maxLength: 2048 },
    method: { enum: ["GET", "POST"] },
    path: {
      type: "string",
      pattern:
        "^/agent/v3/persistent/owners/[A-Za-z0-9_-]{1,128}/vaults/[A-Za-z0-9_-]{1,128}/connections/[A-Za-z0-9_-]{1,128}/task-center/(context|prepare|plans/report)$",
    },
    bodyDigest: { $ref: "#/$defs/Digest" },
    requestId: { $ref: "#/$defs/OperationIdentifier" },
    nonce: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$", maxLength: 43 },
    issuedAt: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    expiresAt: { type: "integer", minimum: 1, maximum: 9007199254740991 },
  },
  required: [
    "contractVersion",
    "profile",
    "artifactType",
    "purpose",
    "ownerSubject",
    "vaultId",
    "connectionId",
    "agentId",
    "clientId",
    "rootKeyId",
    "agentSigningKeyId",
    "agentEncryptionKeyId",
    "identityEpoch",
    "bindingFingerprint",
    "audience",
    "method",
    "path",
    "bodyDigest",
    "requestId",
    "nonce",
    "issuedAt",
    "expiresAt",
  ],
  additionalProperties: false,
};
var formats0 = /^https:\/\/[^\s\\]+$/;
var pattern9 = new RegExp(
  "^/agent/v3/persistent/owners/[A-Za-z0-9_-]{1,128}/vaults/[A-Za-z0-9_-]{1,128}/connections/[A-Za-z0-9_-]{1,128}/task-center/(context|prepare|plans/report)$",
  "u",
);
function validate105(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate105.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.contractVersion === void 0 && (missing0 = "contractVersion")) ||
        (data.profile === void 0 && (missing0 = "profile")) ||
        (data.artifactType === void 0 && (missing0 = "artifactType")) ||
        (data.purpose === void 0 && (missing0 = "purpose")) ||
        (data.ownerSubject === void 0 && (missing0 = "ownerSubject")) ||
        (data.vaultId === void 0 && (missing0 = "vaultId")) ||
        (data.connectionId === void 0 && (missing0 = "connectionId")) ||
        (data.agentId === void 0 && (missing0 = "agentId")) ||
        (data.clientId === void 0 && (missing0 = "clientId")) ||
        (data.rootKeyId === void 0 && (missing0 = "rootKeyId")) ||
        (data.agentSigningKeyId === void 0 && (missing0 = "agentSigningKeyId")) ||
        (data.agentEncryptionKeyId === void 0 && (missing0 = "agentEncryptionKeyId")) ||
        (data.identityEpoch === void 0 && (missing0 = "identityEpoch")) ||
        (data.bindingFingerprint === void 0 && (missing0 = "bindingFingerprint")) ||
        (data.audience === void 0 && (missing0 = "audience")) ||
        (data.method === void 0 && (missing0 = "method")) ||
        (data.path === void 0 && (missing0 = "path")) ||
        (data.bodyDigest === void 0 && (missing0 = "bodyDigest")) ||
        (data.requestId === void 0 && (missing0 = "requestId")) ||
        (data.nonce === void 0 && (missing0 = "nonce")) ||
        (data.issuedAt === void 0 && (missing0 = "issuedAt")) ||
        (data.expiresAt === void 0 && (missing0 = "expiresAt"))
      ) {
        validate105.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func3.call(schema37.properties, key0)) {
            validate105.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.contractVersion !== void 0) {
            const _errs2 = errors;
            if ("folioview.agent-workspace.v2.0" !== data.contractVersion) {
              validate105.errors = [
                {
                  instancePath: instancePath + "/contractVersion",
                  schemaPath: "#/properties/contractVersion/const",
                  keyword: "const",
                  params: { allowedValue: "folioview.agent-workspace.v2.0" },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.profile !== void 0) {
              const _errs3 = errors;
              if ("folioview.task-center.v1" !== data.profile) {
                validate105.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.task-center.v1" },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.artifactType !== void 0) {
                const _errs4 = errors;
                if ("task_center_agent_request" !== data.artifactType) {
                  validate105.errors = [
                    {
                      instancePath: instancePath + "/artifactType",
                      schemaPath: "#/properties/artifactType/const",
                      keyword: "const",
                      params: { allowedValue: "task_center_agent_request" },
                    },
                  ];
                  return false;
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.purpose !== void 0) {
                  const _errs5 = errors;
                  if ("authenticated_request" !== data.purpose) {
                    validate105.errors = [
                      {
                        instancePath: instancePath + "/purpose",
                        schemaPath: "#/properties/purpose/const",
                        keyword: "const",
                        params: { allowedValue: "authenticated_request" },
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs5 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.ownerSubject !== void 0) {
                    const _errs6 = errors;
                    if (
                      !validate58(data.ownerSubject, {
                        instancePath: instancePath + "/ownerSubject",
                        parentData: data,
                        parentDataProperty: "ownerSubject",
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs6 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.vaultId !== void 0) {
                      const _errs7 = errors;
                      if (
                        !validate58(data.vaultId, {
                          instancePath: instancePath + "/vaultId",
                          parentData: data,
                          parentDataProperty: "vaultId",
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                        errors = vErrors.length;
                      }
                      var valid0 = _errs7 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.connectionId !== void 0) {
                        const _errs8 = errors;
                        if (
                          !validate58(data.connectionId, {
                            instancePath: instancePath + "/connectionId",
                            parentData: data,
                            parentDataProperty: "connectionId",
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate58.errors
                              : vErrors.concat(validate58.errors);
                          errors = vErrors.length;
                        }
                        var valid0 = _errs8 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.agentId !== void 0) {
                          const _errs9 = errors;
                          if (
                            !validate58(data.agentId, {
                              instancePath: instancePath + "/agentId",
                              parentData: data,
                              parentDataProperty: "agentId",
                              rootData,
                              dynamicAnchors,
                            })
                          ) {
                            vErrors =
                              vErrors === null
                                ? validate58.errors
                                : vErrors.concat(validate58.errors);
                            errors = vErrors.length;
                          }
                          var valid0 = _errs9 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.clientId !== void 0) {
                            const _errs10 = errors;
                            if (
                              !validate58(data.clientId, {
                                instancePath: instancePath + "/clientId",
                                parentData: data,
                                parentDataProperty: "clientId",
                                rootData,
                                dynamicAnchors,
                              })
                            ) {
                              vErrors =
                                vErrors === null
                                  ? validate58.errors
                                  : vErrors.concat(validate58.errors);
                              errors = vErrors.length;
                            }
                            var valid0 = _errs10 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.rootKeyId !== void 0) {
                              const _errs11 = errors;
                              if (
                                !validate86(data.rootKeyId, {
                                  instancePath: instancePath + "/rootKeyId",
                                  parentData: data,
                                  parentDataProperty: "rootKeyId",
                                  rootData,
                                  dynamicAnchors,
                                })
                              ) {
                                vErrors =
                                  vErrors === null
                                    ? validate86.errors
                                    : vErrors.concat(validate86.errors);
                                errors = vErrors.length;
                              }
                              var valid0 = _errs11 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.agentSigningKeyId !== void 0) {
                                const _errs12 = errors;
                                if (
                                  !validate86(data.agentSigningKeyId, {
                                    instancePath: instancePath + "/agentSigningKeyId",
                                    parentData: data,
                                    parentDataProperty: "agentSigningKeyId",
                                    rootData,
                                    dynamicAnchors,
                                  })
                                ) {
                                  vErrors =
                                    vErrors === null
                                      ? validate86.errors
                                      : vErrors.concat(validate86.errors);
                                  errors = vErrors.length;
                                }
                                var valid0 = _errs12 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.agentEncryptionKeyId !== void 0) {
                                  const _errs13 = errors;
                                  if (
                                    !validate86(data.agentEncryptionKeyId, {
                                      instancePath: instancePath + "/agentEncryptionKeyId",
                                      parentData: data,
                                      parentDataProperty: "agentEncryptionKeyId",
                                      rootData,
                                      dynamicAnchors,
                                    })
                                  ) {
                                    vErrors =
                                      vErrors === null
                                        ? validate86.errors
                                        : vErrors.concat(validate86.errors);
                                    errors = vErrors.length;
                                  }
                                  var valid0 = _errs13 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (data.identityEpoch !== void 0) {
                                    let data12 = data.identityEpoch;
                                    const _errs14 = errors;
                                    if (!(
                                      typeof data12 == "number" &&
                                      !(data12 % 1) &&
                                      !isNaN(data12)
                                    )) {
                                      validate105.errors = [
                                        {
                                          instancePath: instancePath + "/identityEpoch",
                                          schemaPath: "#/properties/identityEpoch/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                        },
                                      ];
                                      return false;
                                    }
                                    if (errors === _errs14) {
                                      if (typeof data12 == "number") {
                                        if (data12 > 9007199254740991 || isNaN(data12)) {
                                          validate105.errors = [
                                            {
                                              instancePath: instancePath + "/identityEpoch",
                                              schemaPath: "#/properties/identityEpoch/maximum",
                                              keyword: "maximum",
                                              params: { comparison: "<=", limit: 9007199254740991 },
                                            },
                                          ];
                                          return false;
                                        } else {
                                          if (data12 < 1 || isNaN(data12)) {
                                            validate105.errors = [
                                              {
                                                instancePath: instancePath + "/identityEpoch",
                                                schemaPath: "#/properties/identityEpoch/minimum",
                                                keyword: "minimum",
                                                params: { comparison: ">=", limit: 1 },
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                      }
                                    }
                                    var valid0 = _errs14 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                  if (valid0) {
                                    if (data.bindingFingerprint !== void 0) {
                                      const _errs16 = errors;
                                      if (
                                        !validate75(data.bindingFingerprint, {
                                          instancePath: instancePath + "/bindingFingerprint",
                                          parentData: data,
                                          parentDataProperty: "bindingFingerprint",
                                          rootData,
                                          dynamicAnchors,
                                        })
                                      ) {
                                        vErrors =
                                          vErrors === null
                                            ? validate75.errors
                                            : vErrors.concat(validate75.errors);
                                        errors = vErrors.length;
                                      }
                                      var valid0 = _errs16 === errors;
                                    } else {
                                      var valid0 = true;
                                    }
                                    if (valid0) {
                                      if (data.audience !== void 0) {
                                        let data14 = data.audience;
                                        const _errs17 = errors;
                                        if (errors === _errs17) {
                                          if (errors === _errs17) {
                                            if (typeof data14 === "string") {
                                              if (func1(data14) > 2048) {
                                                validate105.errors = [
                                                  {
                                                    instancePath: instancePath + "/audience",
                                                    schemaPath: "#/properties/audience/maxLength",
                                                    keyword: "maxLength",
                                                    params: { limit: 2048 },
                                                  },
                                                ];
                                                return false;
                                              } else {
                                                if (!formats0.test(data14)) {
                                                  validate105.errors = [
                                                    {
                                                      instancePath: instancePath + "/audience",
                                                      schemaPath: "#/properties/audience/format",
                                                      keyword: "format",
                                                      params: { format: "uri" },
                                                    },
                                                  ];
                                                  return false;
                                                }
                                              }
                                            } else {
                                              validate105.errors = [
                                                {
                                                  instancePath: instancePath + "/audience",
                                                  schemaPath: "#/properties/audience/type",
                                                  keyword: "type",
                                                  params: { type: "string" },
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                        }
                                        var valid0 = _errs17 === errors;
                                      } else {
                                        var valid0 = true;
                                      }
                                      if (valid0) {
                                        if (data.method !== void 0) {
                                          let data15 = data.method;
                                          const _errs19 = errors;
                                          if (!(data15 === "GET" || data15 === "POST")) {
                                            validate105.errors = [
                                              {
                                                instancePath: instancePath + "/method",
                                                schemaPath: "#/properties/method/enum",
                                                keyword: "enum",
                                                params: {
                                                  allowedValues: schema37.properties.method.enum,
                                                },
                                              },
                                            ];
                                            return false;
                                          }
                                          var valid0 = _errs19 === errors;
                                        } else {
                                          var valid0 = true;
                                        }
                                        if (valid0) {
                                          if (data.path !== void 0) {
                                            let data16 = data.path;
                                            const _errs20 = errors;
                                            if (errors === _errs20) {
                                              if (typeof data16 === "string") {
                                                if (!pattern9.test(data16)) {
                                                  validate105.errors = [
                                                    {
                                                      instancePath: instancePath + "/path",
                                                      schemaPath: "#/properties/path/pattern",
                                                      keyword: "pattern",
                                                      params: {
                                                        pattern:
                                                          "^/agent/v3/persistent/owners/[A-Za-z0-9_-]{1,128}/vaults/[A-Za-z0-9_-]{1,128}/connections/[A-Za-z0-9_-]{1,128}/task-center/(context|prepare|plans/report)$",
                                                      },
                                                    },
                                                  ];
                                                  return false;
                                                }
                                              } else {
                                                validate105.errors = [
                                                  {
                                                    instancePath: instancePath + "/path",
                                                    schemaPath: "#/properties/path/type",
                                                    keyword: "type",
                                                    params: { type: "string" },
                                                  },
                                                ];
                                                return false;
                                              }
                                            }
                                            var valid0 = _errs20 === errors;
                                          } else {
                                            var valid0 = true;
                                          }
                                          if (valid0) {
                                            if (data.bodyDigest !== void 0) {
                                              const _errs22 = errors;
                                              if (
                                                !validate75(data.bodyDigest, {
                                                  instancePath: instancePath + "/bodyDigest",
                                                  parentData: data,
                                                  parentDataProperty: "bodyDigest",
                                                  rootData,
                                                  dynamicAnchors,
                                                })
                                              ) {
                                                vErrors =
                                                  vErrors === null
                                                    ? validate75.errors
                                                    : vErrors.concat(validate75.errors);
                                                errors = vErrors.length;
                                              }
                                              var valid0 = _errs22 === errors;
                                            } else {
                                              var valid0 = true;
                                            }
                                            if (valid0) {
                                              if (data.requestId !== void 0) {
                                                const _errs23 = errors;
                                                if (
                                                  !validate90(data.requestId, {
                                                    instancePath: instancePath + "/requestId",
                                                    parentData: data,
                                                    parentDataProperty: "requestId",
                                                    rootData,
                                                    dynamicAnchors,
                                                  })
                                                ) {
                                                  vErrors =
                                                    vErrors === null
                                                      ? validate90.errors
                                                      : vErrors.concat(validate90.errors);
                                                  errors = vErrors.length;
                                                }
                                                var valid0 = _errs23 === errors;
                                              } else {
                                                var valid0 = true;
                                              }
                                              if (valid0) {
                                                if (data.nonce !== void 0) {
                                                  let data19 = data.nonce;
                                                  const _errs24 = errors;
                                                  if (errors === _errs24) {
                                                    if (typeof data19 === "string") {
                                                      if (func1(data19) > 43) {
                                                        validate105.errors = [
                                                          {
                                                            instancePath: instancePath + "/nonce",
                                                            schemaPath:
                                                              "#/properties/nonce/maxLength",
                                                            keyword: "maxLength",
                                                            params: { limit: 43 },
                                                          },
                                                        ];
                                                        return false;
                                                      } else {
                                                        if (!pattern7.test(data19)) {
                                                          validate105.errors = [
                                                            {
                                                              instancePath: instancePath + "/nonce",
                                                              schemaPath:
                                                                "#/properties/nonce/pattern",
                                                              keyword: "pattern",
                                                              params: {
                                                                pattern: "^[A-Za-z0-9_-]{43}$",
                                                              },
                                                            },
                                                          ];
                                                          return false;
                                                        }
                                                      }
                                                    } else {
                                                      validate105.errors = [
                                                        {
                                                          instancePath: instancePath + "/nonce",
                                                          schemaPath: "#/properties/nonce/type",
                                                          keyword: "type",
                                                          params: { type: "string" },
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                  }
                                                  var valid0 = _errs24 === errors;
                                                } else {
                                                  var valid0 = true;
                                                }
                                                if (valid0) {
                                                  if (data.issuedAt !== void 0) {
                                                    let data20 = data.issuedAt;
                                                    const _errs26 = errors;
                                                    if (!(
                                                      typeof data20 == "number" &&
                                                      !(data20 % 1) &&
                                                      !isNaN(data20)
                                                    )) {
                                                      validate105.errors = [
                                                        {
                                                          instancePath: instancePath + "/issuedAt",
                                                          schemaPath: "#/properties/issuedAt/type",
                                                          keyword: "type",
                                                          params: { type: "integer" },
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                    if (errors === _errs26) {
                                                      if (typeof data20 == "number") {
                                                        if (
                                                          data20 > 9007199254740991 ||
                                                          isNaN(data20)
                                                        ) {
                                                          validate105.errors = [
                                                            {
                                                              instancePath:
                                                                instancePath + "/issuedAt",
                                                              schemaPath:
                                                                "#/properties/issuedAt/maximum",
                                                              keyword: "maximum",
                                                              params: {
                                                                comparison: "<=",
                                                                limit: 9007199254740991,
                                                              },
                                                            },
                                                          ];
                                                          return false;
                                                        } else {
                                                          if (data20 < 0 || isNaN(data20)) {
                                                            validate105.errors = [
                                                              {
                                                                instancePath:
                                                                  instancePath + "/issuedAt",
                                                                schemaPath:
                                                                  "#/properties/issuedAt/minimum",
                                                                keyword: "minimum",
                                                                params: {
                                                                  comparison: ">=",
                                                                  limit: 0,
                                                                },
                                                              },
                                                            ];
                                                            return false;
                                                          }
                                                        }
                                                      }
                                                    }
                                                    var valid0 = _errs26 === errors;
                                                  } else {
                                                    var valid0 = true;
                                                  }
                                                  if (valid0) {
                                                    if (data.expiresAt !== void 0) {
                                                      let data21 = data.expiresAt;
                                                      const _errs28 = errors;
                                                      if (!(
                                                        typeof data21 == "number" &&
                                                        !(data21 % 1) &&
                                                        !isNaN(data21)
                                                      )) {
                                                        validate105.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath + "/expiresAt",
                                                            schemaPath:
                                                              "#/properties/expiresAt/type",
                                                            keyword: "type",
                                                            params: { type: "integer" },
                                                          },
                                                        ];
                                                        return false;
                                                      }
                                                      if (errors === _errs28) {
                                                        if (typeof data21 == "number") {
                                                          if (
                                                            data21 > 9007199254740991 ||
                                                            isNaN(data21)
                                                          ) {
                                                            validate105.errors = [
                                                              {
                                                                instancePath:
                                                                  instancePath + "/expiresAt",
                                                                schemaPath:
                                                                  "#/properties/expiresAt/maximum",
                                                                keyword: "maximum",
                                                                params: {
                                                                  comparison: "<=",
                                                                  limit: 9007199254740991,
                                                                },
                                                              },
                                                            ];
                                                            return false;
                                                          } else {
                                                            if (data21 < 1 || isNaN(data21)) {
                                                              validate105.errors = [
                                                                {
                                                                  instancePath:
                                                                    instancePath + "/expiresAt",
                                                                  schemaPath:
                                                                    "#/properties/expiresAt/minimum",
                                                                  keyword: "minimum",
                                                                  params: {
                                                                    comparison: ">=",
                                                                    limit: 1,
                                                                  },
                                                                },
                                                              ];
                                                              return false;
                                                            }
                                                          }
                                                        }
                                                      }
                                                      var valid0 = _errs28 === errors;
                                                    } else {
                                                      var valid0 = true;
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
    } else {
      validate105.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate105.errors = vErrors;
  return errors === 0;
}
validate105.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate104(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate104.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (
    !validate105(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate105.errors : vErrors.concat(validate105.errors);
    errors = vErrors.length;
  }
  validate104.errors = vErrors;
  return errors === 0;
}
validate104.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
