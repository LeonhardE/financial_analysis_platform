"use strict";
exports.HoldingsFactsContent = validate159;
const schema64 = {
  $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/HoldingsFactsContent",
};
const schema65 = {
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
  additionalProperties: false,
};
const schema66 = {
  type: "object",
  properties: {
    state: { type: "string", enum: ["complete", "partial", "unknown"] },
    issues: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 80 },
      minItems: 0,
      maxItems: 20,
      uniqueItems: true,
    },
  },
  required: ["state", "issues"],
  additionalProperties: false,
};
const func1 = require("ajv/dist/runtime/ucs2length").default;
function validate161(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate161.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.state === undefined && (missing0 = "state")) ||
        (data.issues === undefined && (missing0 = "issues"))
      ) {
        validate161.errors = [
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
          if (!(key0 === "state" || key0 === "issues")) {
            validate161.errors = [
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
          if (data.state !== undefined) {
            let data0 = data.state;
            const _errs2 = errors;
            if (typeof data0 !== "string") {
              validate161.errors = [
                {
                  instancePath: instancePath + "/state",
                  schemaPath: "#/properties/state/type",
                  keyword: "type",
                  params: { type: "string" },
                },
              ];
              return false;
            }
            if (!(data0 === "complete" || data0 === "partial" || data0 === "unknown")) {
              validate161.errors = [
                {
                  instancePath: instancePath + "/state",
                  schemaPath: "#/properties/state/enum",
                  keyword: "enum",
                  params: { allowedValues: schema66.properties.state.enum },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.issues !== undefined) {
              let data1 = data.issues;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (Array.isArray(data1)) {
                  if (data1.length > 20) {
                    validate161.errors = [
                      {
                        instancePath: instancePath + "/issues",
                        schemaPath: "#/properties/issues/maxItems",
                        keyword: "maxItems",
                        params: { limit: 20 },
                      },
                    ];
                    return false;
                  } else {
                    if (data1.length < 0) {
                      validate161.errors = [
                        {
                          instancePath: instancePath + "/issues",
                          schemaPath: "#/properties/issues/minItems",
                          keyword: "minItems",
                          params: { limit: 0 },
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
                          if (typeof data2 === "string") {
                            if (func1(data2) > 80) {
                              validate161.errors = [
                                {
                                  instancePath: instancePath + "/issues/" + i0,
                                  schemaPath: "#/properties/issues/items/maxLength",
                                  keyword: "maxLength",
                                  params: { limit: 80 },
                                },
                              ];
                              return false;
                            } else {
                              if (func1(data2) < 1) {
                                validate161.errors = [
                                  {
                                    instancePath: instancePath + "/issues/" + i0,
                                    schemaPath: "#/properties/issues/items/minLength",
                                    keyword: "minLength",
                                    params: { limit: 1 },
                                  },
                                ];
                                return false;
                              }
                            }
                          } else {
                            validate161.errors = [
                              {
                                instancePath: instancePath + "/issues/" + i0,
                                schemaPath: "#/properties/issues/items/type",
                                keyword: "type",
                                params: { type: "string" },
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
                          const indices0 = {};
                          for (; i1--;) {
                            let item0 = data1[i1];
                            if (typeof item0 !== "string") {
                              continue;
                            }
                            if (typeof indices0[item0] == "number") {
                              j0 = indices0[item0];
                              validate161.errors = [
                                {
                                  instancePath: instancePath + "/issues",
                                  schemaPath: "#/properties/issues/uniqueItems",
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
                  }
                } else {
                  validate161.errors = [
                    {
                      instancePath: instancePath + "/issues",
                      schemaPath: "#/properties/issues/type",
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
      validate161.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate161.errors = vErrors;
  return errors === 0;
}
validate161.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema25 = {
  type: "string",
  minLength: 1,
  maxLength: 32,
  format: "date-time",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$",
};
const formats2 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const pattern4 = new RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$", "u");
function validate84(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate84.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (errors === 0) {
      if (typeof data === "string") {
        if (func1(data) > 32) {
          validate84.errors = [
            {
              instancePath,
              schemaPath: "#/maxLength",
              keyword: "maxLength",
              params: { limit: 32 },
            },
          ];
          return false;
        } else {
          if (func1(data) < 1) {
            validate84.errors = [
              {
                instancePath,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ];
            return false;
          } else {
            if (!pattern4.test(data)) {
              validate84.errors = [
                {
                  instancePath,
                  schemaPath: "#/pattern",
                  keyword: "pattern",
                  params: {
                    pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$",
                  },
                },
              ];
              return false;
            } else {
              if (!formats2.test(data)) {
                validate84.errors = [
                  {
                    instancePath,
                    schemaPath: "#/format",
                    keyword: "format",
                    params: { format: "date-time" },
                  },
                ];
                return false;
              }
            }
          }
        }
      } else {
        validate84.errors = [
          { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
        ];
        return false;
      }
    }
  }
  validate84.errors = vErrors;
  return errors === 0;
}
validate84.evaluated = { dynamicProps: false, dynamicItems: false };
const schema67 = {
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
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 1000,
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
  additionalProperties: false,
};
const func17 = Object.prototype.hasOwnProperty;
const schema37 = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
};
const pattern7 = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "u");
function validate82(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate82.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 128) {
        validate82.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 128 } },
        ];
        return false;
      } else {
        if (func1(data) < 1) {
          validate82.errors = [
            { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 1 } },
          ];
          return false;
        } else {
          if (!pattern7.test(data)) {
            validate82.errors = [
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
      validate82.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate82.errors = vErrors;
  return errors === 0;
}
validate82.evaluated = { dynamicProps: false, dynamicItems: false };
const schema23 = {
  type: "string",
  minLength: 1,
  maxLength: 10,
  format: "date",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
};
const formats0 = /^\d{4}-\d{2}-\d{2}$/;
const pattern3 = new RegExp("^\\d{4}-\\d{2}-\\d{2}$", "u");
function validate91(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate91.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (errors === 0) {
      if (typeof data === "string") {
        if (func1(data) > 10) {
          validate91.errors = [
            {
              instancePath,
              schemaPath: "#/maxLength",
              keyword: "maxLength",
              params: { limit: 10 },
            },
          ];
          return false;
        } else {
          if (func1(data) < 1) {
            validate91.errors = [
              {
                instancePath,
                schemaPath: "#/minLength",
                keyword: "minLength",
                params: { limit: 1 },
              },
            ];
            return false;
          } else {
            if (!pattern3.test(data)) {
              validate91.errors = [
                {
                  instancePath,
                  schemaPath: "#/pattern",
                  keyword: "pattern",
                  params: { pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                },
              ];
              return false;
            } else {
              if (!formats0.test(data)) {
                validate91.errors = [
                  {
                    instancePath,
                    schemaPath: "#/format",
                    keyword: "format",
                    params: { format: "date" },
                  },
                ];
                return false;
              }
            }
          }
        }
      } else {
        validate91.errors = [
          { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
        ];
        return false;
      }
    }
  }
  validate91.errors = vErrors;
  return errors === 0;
}
validate91.evaluated = { dynamicProps: false, dynamicItems: false };
const schema68 = {
  type: "object",
  properties: {
    snapshotId: { $ref: "#/$defs/Identifier" },
    sourceRevision: { $ref: "#/$defs/Revision", minimum: 1 },
  },
  required: ["snapshotId", "sourceRevision"],
  additionalProperties: false,
};
const schema50 = { type: "integer", minimum: 0, maximum: 9007199254740991 };
function validate122(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate122.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (!(typeof data == "number" && !(data % 1) && !isNaN(data))) {
    validate122.errors = [
      { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "integer" } },
    ];
    return false;
  }
  if (errors === 0) {
    if (typeof data == "number") {
      if (data > 9007199254740991 || isNaN(data)) {
        validate122.errors = [
          {
            instancePath,
            schemaPath: "#/maximum",
            keyword: "maximum",
            params: { comparison: "<=", limit: 9007199254740991 },
          },
        ];
        return false;
      } else {
        if (data < 0 || isNaN(data)) {
          validate122.errors = [
            {
              instancePath,
              schemaPath: "#/minimum",
              keyword: "minimum",
              params: { comparison: ">=", limit: 0 },
            },
          ];
          return false;
        }
      }
    }
  }
  validate122.errors = vErrors;
  return errors === 0;
}
validate122.evaluated = { dynamicProps: false, dynamicItems: false };
function validate168(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate168.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.snapshotId === undefined && (missing0 = "snapshotId")) ||
        (data.sourceRevision === undefined && (missing0 = "sourceRevision"))
      ) {
        validate168.errors = [
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
          if (!(key0 === "snapshotId" || key0 === "sourceRevision")) {
            validate168.errors = [
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
          if (data.snapshotId !== undefined) {
            const _errs2 = errors;
            if (
              !validate82(data.snapshotId, {
                instancePath: instancePath + "/snapshotId",
                parentData: data,
                parentDataProperty: "snapshotId",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.sourceRevision !== undefined) {
              let data1 = data.sourceRevision;
              const _errs3 = errors;
              if (
                !validate122(data1, {
                  instancePath: instancePath + "/sourceRevision",
                  parentData: data,
                  parentDataProperty: "sourceRevision",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
                errors = vErrors.length;
              }
              if (errors === _errs3) {
                if (typeof data1 == "number") {
                  if (data1 < 1 || isNaN(data1)) {
                    validate168.errors = [
                      {
                        instancePath: instancePath + "/sourceRevision",
                        schemaPath: "#/properties/sourceRevision/minimum",
                        keyword: "minimum",
                        params: { comparison: ">=", limit: 1 },
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate168.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate168.errors = vErrors;
  return errors === 0;
}
validate168.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema69 = {
  type: "object",
  properties: {
    accountId: { $ref: "#/$defs/Identifier" },
    displayName: { type: "string", minLength: 1, maxLength: 180 },
    balances: { type: "array", items: { $ref: "#/$defs/Balance" }, minItems: 0, maxItems: 12 },
    positions: { type: "array", items: { $ref: "#/$defs/Position" }, minItems: 0, maxItems: 1000 },
  },
  required: ["accountId", "displayName", "balances", "positions"],
  additionalProperties: false,
};
const schema70 = {
  type: "object",
  properties: {
    currency: { $ref: "#/$defs/Currency" },
    cashBalance: { anyOf: [{ $ref: "#/$defs/SignedDecimal" }, { type: "null" }] },
    buyingPower: { const: null },
  },
  required: ["currency", "cashBalance", "buyingPower"],
  additionalProperties: false,
};
const schema21 = {
  enum: ["USD", "CAD", "CNY", "EUR", "GBP", "JPY", "HKD", "AUD", "CHF", "NZD", "SGD", "TWD"],
};
function validate69(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate69.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (!(
    data === "USD" ||
    data === "CAD" ||
    data === "CNY" ||
    data === "EUR" ||
    data === "GBP" ||
    data === "JPY" ||
    data === "HKD" ||
    data === "AUD" ||
    data === "CHF" ||
    data === "NZD" ||
    data === "SGD" ||
    data === "TWD"
  )) {
    validate69.errors = [
      {
        instancePath,
        schemaPath: "#/enum",
        keyword: "enum",
        params: { allowedValues: schema21.enum },
      },
    ];
    return false;
  }
  validate69.errors = vErrors;
  return errors === 0;
}
validate69.evaluated = { dynamicProps: false, dynamicItems: false };
const schema71 = {
  type: "string",
  minLength: 1,
  maxLength: 40,
  pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$",
};
const pattern11 = new RegExp("^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$", "u");
function validate177(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate177.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 40) {
        validate177.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 40 } },
        ];
        return false;
      } else {
        if (func1(data) < 1) {
          validate177.errors = [
            { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 1 } },
          ];
          return false;
        } else {
          if (!pattern11.test(data)) {
            validate177.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^-?(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate177.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate177.errors = vErrors;
  return errors === 0;
}
validate177.evaluated = { dynamicProps: false, dynamicItems: false };
function validate175(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate175.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.currency === undefined && (missing0 = "currency")) ||
        (data.cashBalance === undefined && (missing0 = "cashBalance")) ||
        (data.buyingPower === undefined && (missing0 = "buyingPower"))
      ) {
        validate175.errors = [
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
          if (!(key0 === "currency" || key0 === "cashBalance" || key0 === "buyingPower")) {
            validate175.errors = [
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
          if (data.currency !== undefined) {
            const _errs2 = errors;
            if (
              !validate69(data.currency, {
                instancePath: instancePath + "/currency",
                parentData: data,
                parentDataProperty: "currency",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.cashBalance !== undefined) {
              let data1 = data.cashBalance;
              const _errs3 = errors;
              const _errs4 = errors;
              let valid1 = false;
              const _errs5 = errors;
              if (
                !validate177(data1, {
                  instancePath: instancePath + "/cashBalance",
                  parentData: data,
                  parentDataProperty: "cashBalance",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate177.errors : vErrors.concat(validate177.errors);
                errors = vErrors.length;
              }
              var _valid0 = _errs5 === errors;
              valid1 = valid1 || _valid0;
              const _errs6 = errors;
              if (data1 !== null) {
                const err0 = {
                  instancePath: instancePath + "/cashBalance",
                  schemaPath: "#/properties/cashBalance/anyOf/1/type",
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
              var _valid0 = _errs6 === errors;
              valid1 = valid1 || _valid0;
              if (!valid1) {
                const err1 = {
                  instancePath: instancePath + "/cashBalance",
                  schemaPath: "#/properties/cashBalance/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                if (vErrors === null) {
                  vErrors = [err1];
                } else {
                  vErrors.push(err1);
                }
                errors++;
                validate175.errors = vErrors;
                return false;
              } else {
                errors = _errs4;
                if (vErrors !== null) {
                  if (_errs4) {
                    vErrors.length = _errs4;
                  } else {
                    vErrors = null;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.buyingPower !== undefined) {
                const _errs8 = errors;
                if (null !== data.buyingPower) {
                  validate175.errors = [
                    {
                      instancePath: instancePath + "/buyingPower",
                      schemaPath: "#/properties/buyingPower/const",
                      keyword: "const",
                      params: { allowedValue: schema70.properties.buyingPower.const },
                    },
                  ];
                  return false;
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate175.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate175.errors = vErrors;
  return errors === 0;
}
validate175.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema72 = {
  type: "object",
  properties: {
    assetId: { $ref: "#/$defs/Identifier" },
    brokerAssetId: { anyOf: [{ type: "string", minLength: 1, maxLength: 180 }, { type: "null" }] },
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
      additionalProperties: false,
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
  additionalProperties: false,
};
const schema73 = {
  type: "object",
  properties: {
    symbol: { anyOf: [{ $ref: "#/$defs/Symbol" }, { type: "null" }] },
    market: { $ref: "#/$defs/Market" },
    currency: { $ref: "#/$defs/Currency" },
  },
  required: ["symbol", "market", "currency"],
  additionalProperties: false,
};
const schema29 = {
  type: "string",
  minLength: 1,
  maxLength: 32,
  pattern: "^[A-Z0-9][A-Z0-9.\\-^]{0,31}$",
};
const pattern5 = new RegExp("^[A-Z0-9][A-Z0-9.\\-^]{0,31}$", "u");
function validate65(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate65.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 32) {
        validate65.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 32 } },
        ];
        return false;
      } else {
        if (func1(data) < 1) {
          validate65.errors = [
            { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 1 } },
          ];
          return false;
        } else {
          if (!pattern5.test(data)) {
            validate65.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^[A-Z0-9][A-Z0-9.\\-^]{0,31}$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate65.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate65.errors = vErrors;
  return errors === 0;
}
validate65.evaluated = { dynamicProps: false, dynamicItems: false };
const schema30 = {
  type: "string",
  minLength: 4,
  maxLength: 7,
  pattern: "^(?:[A-Z0-9]{4}|UNKNOWN)$",
};
const pattern6 = new RegExp("^(?:[A-Z0-9]{4}|UNKNOWN)$", "u");
function validate67(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate67.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 7) {
        validate67.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 7 } },
        ];
        return false;
      } else {
        if (func1(data) < 4) {
          validate67.errors = [
            { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 4 } },
          ];
          return false;
        } else {
          if (!pattern6.test(data)) {
            validate67.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^(?:[A-Z0-9]{4}|UNKNOWN)$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate67.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate67.errors = vErrors;
  return errors === 0;
}
validate67.evaluated = { dynamicProps: false, dynamicItems: false };
function validate182(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate182.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.symbol === undefined && (missing0 = "symbol")) ||
        (data.market === undefined && (missing0 = "market")) ||
        (data.currency === undefined && (missing0 = "currency"))
      ) {
        validate182.errors = [
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
          if (!(key0 === "symbol" || key0 === "market" || key0 === "currency")) {
            validate182.errors = [
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
          if (data.symbol !== undefined) {
            let data0 = data.symbol;
            const _errs2 = errors;
            const _errs3 = errors;
            let valid1 = false;
            const _errs4 = errors;
            if (
              !validate65(data0, {
                instancePath: instancePath + "/symbol",
                parentData: data,
                parentDataProperty: "symbol",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate65.errors : vErrors.concat(validate65.errors);
              errors = vErrors.length;
            }
            var _valid0 = _errs4 === errors;
            valid1 = valid1 || _valid0;
            const _errs5 = errors;
            if (data0 !== null) {
              const err0 = {
                instancePath: instancePath + "/symbol",
                schemaPath: "#/properties/symbol/anyOf/1/type",
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
            var _valid0 = _errs5 === errors;
            valid1 = valid1 || _valid0;
            if (!valid1) {
              const err1 = {
                instancePath: instancePath + "/symbol",
                schemaPath: "#/properties/symbol/anyOf",
                keyword: "anyOf",
                params: {},
              };
              if (vErrors === null) {
                vErrors = [err1];
              } else {
                vErrors.push(err1);
              }
              errors++;
              validate182.errors = vErrors;
              return false;
            } else {
              errors = _errs3;
              if (vErrors !== null) {
                if (_errs3) {
                  vErrors.length = _errs3;
                } else {
                  vErrors = null;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.market !== undefined) {
              const _errs7 = errors;
              if (
                !validate67(data.market, {
                  instancePath: instancePath + "/market",
                  parentData: data,
                  parentDataProperty: "market",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate67.errors : vErrors.concat(validate67.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs7 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.currency !== undefined) {
                const _errs8 = errors;
                if (
                  !validate69(data.currency, {
                    instancePath: instancePath + "/currency",
                    parentData: data,
                    parentDataProperty: "currency",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
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
    } else {
      validate182.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate182.errors = vErrors;
  return errors === 0;
}
validate182.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema74 = {
  type: "string",
  minLength: 1,
  maxLength: 33,
  pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$",
};
const pattern12 = new RegExp("^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$", "u");
function validate187(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate187.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 33) {
        validate187.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 33 } },
        ];
        return false;
      } else {
        if (func1(data) < 1) {
          validate187.errors = [
            { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 1 } },
          ];
          return false;
        } else {
          if (!pattern12.test(data)) {
            validate187.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,12})?$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate187.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate187.errors = vErrors;
  return errors === 0;
}
validate187.evaluated = { dynamicProps: false, dynamicItems: false };
const schema75 = {
  type: "object",
  properties: { currency: { $ref: "#/$defs/Currency" }, amount: { $ref: "#/$defs/Decimal" } },
  required: ["currency", "amount"],
  additionalProperties: false,
};
const schema40 = {
  type: "string",
  minLength: 1,
  maxLength: 39,
  pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$",
};
const pattern9 = new RegExp("^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$", "u");
function validate88(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate88.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (typeof data === "string") {
      if (func1(data) > 39) {
        validate88.errors = [
          { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 39 } },
        ];
        return false;
      } else {
        if (func1(data) < 1) {
          validate88.errors = [
            { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 1 } },
          ];
          return false;
        } else {
          if (!pattern9.test(data)) {
            validate88.errors = [
              {
                instancePath,
                schemaPath: "#/pattern",
                keyword: "pattern",
                params: { pattern: "^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,18})?$" },
              },
            ];
            return false;
          }
        }
      }
    } else {
      validate88.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
      ];
      return false;
    }
  }
  validate88.errors = vErrors;
  return errors === 0;
}
validate88.evaluated = { dynamicProps: false, dynamicItems: false };
function validate189(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate189.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.currency === undefined && (missing0 = "currency")) ||
        (data.amount === undefined && (missing0 = "amount"))
      ) {
        validate189.errors = [
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
          if (!(key0 === "currency" || key0 === "amount")) {
            validate189.errors = [
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
          if (data.currency !== undefined) {
            const _errs2 = errors;
            if (
              !validate69(data.currency, {
                instancePath: instancePath + "/currency",
                parentData: data,
                parentDataProperty: "currency",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.amount !== undefined) {
              const _errs3 = errors;
              if (
                !validate88(data.amount, {
                  instancePath: instancePath + "/amount",
                  parentData: data,
                  parentDataProperty: "amount",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate88.errors : vErrors.concat(validate88.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate189.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate189.errors = vErrors;
  return errors === 0;
}
validate189.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema76 = {
  type: "object",
  properties: {
    origin: { enum: ["import", "manual", "derived", "legacy", "unknown"] },
    recordedAt: { anyOf: [{ $ref: "#/$defs/Timestamp" }, { type: "null" }] },
    sourceDate: { anyOf: [{ $ref: "#/$defs/Date" }, { type: "null" }] },
    lastEditedAt: { anyOf: [{ $ref: "#/$defs/Timestamp" }, { type: "null" }] },
  },
  required: ["origin", "recordedAt", "sourceDate", "lastEditedAt"],
  additionalProperties: false,
};
function validate195(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate195.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.origin === undefined && (missing0 = "origin")) ||
        (data.recordedAt === undefined && (missing0 = "recordedAt")) ||
        (data.sourceDate === undefined && (missing0 = "sourceDate")) ||
        (data.lastEditedAt === undefined && (missing0 = "lastEditedAt"))
      ) {
        validate195.errors = [
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
            key0 === "origin" ||
            key0 === "recordedAt" ||
            key0 === "sourceDate" ||
            key0 === "lastEditedAt"
          )) {
            validate195.errors = [
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
          if (data.origin !== undefined) {
            let data0 = data.origin;
            const _errs2 = errors;
            if (!(
              data0 === "import" ||
              data0 === "manual" ||
              data0 === "derived" ||
              data0 === "legacy" ||
              data0 === "unknown"
            )) {
              validate195.errors = [
                {
                  instancePath: instancePath + "/origin",
                  schemaPath: "#/properties/origin/enum",
                  keyword: "enum",
                  params: { allowedValues: schema76.properties.origin.enum },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.recordedAt !== undefined) {
              let data1 = data.recordedAt;
              const _errs3 = errors;
              const _errs4 = errors;
              let valid1 = false;
              const _errs5 = errors;
              if (
                !validate84(data1, {
                  instancePath: instancePath + "/recordedAt",
                  parentData: data,
                  parentDataProperty: "recordedAt",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
                errors = vErrors.length;
              }
              var _valid0 = _errs5 === errors;
              valid1 = valid1 || _valid0;
              const _errs6 = errors;
              if (data1 !== null) {
                const err0 = {
                  instancePath: instancePath + "/recordedAt",
                  schemaPath: "#/properties/recordedAt/anyOf/1/type",
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
              var _valid0 = _errs6 === errors;
              valid1 = valid1 || _valid0;
              if (!valid1) {
                const err1 = {
                  instancePath: instancePath + "/recordedAt",
                  schemaPath: "#/properties/recordedAt/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                if (vErrors === null) {
                  vErrors = [err1];
                } else {
                  vErrors.push(err1);
                }
                errors++;
                validate195.errors = vErrors;
                return false;
              } else {
                errors = _errs4;
                if (vErrors !== null) {
                  if (_errs4) {
                    vErrors.length = _errs4;
                  } else {
                    vErrors = null;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.sourceDate !== undefined) {
                let data2 = data.sourceDate;
                const _errs8 = errors;
                const _errs9 = errors;
                let valid2 = false;
                const _errs10 = errors;
                if (
                  !validate91(data2, {
                    instancePath: instancePath + "/sourceDate",
                    parentData: data,
                    parentDataProperty: "sourceDate",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate91.errors : vErrors.concat(validate91.errors);
                  errors = vErrors.length;
                }
                var _valid1 = _errs10 === errors;
                valid2 = valid2 || _valid1;
                const _errs11 = errors;
                if (data2 !== null) {
                  const err2 = {
                    instancePath: instancePath + "/sourceDate",
                    schemaPath: "#/properties/sourceDate/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  if (vErrors === null) {
                    vErrors = [err2];
                  } else {
                    vErrors.push(err2);
                  }
                  errors++;
                }
                var _valid1 = _errs11 === errors;
                valid2 = valid2 || _valid1;
                if (!valid2) {
                  const err3 = {
                    instancePath: instancePath + "/sourceDate",
                    schemaPath: "#/properties/sourceDate/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  if (vErrors === null) {
                    vErrors = [err3];
                  } else {
                    vErrors.push(err3);
                  }
                  errors++;
                  validate195.errors = vErrors;
                  return false;
                } else {
                  errors = _errs9;
                  if (vErrors !== null) {
                    if (_errs9) {
                      vErrors.length = _errs9;
                    } else {
                      vErrors = null;
                    }
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.lastEditedAt !== undefined) {
                  let data3 = data.lastEditedAt;
                  const _errs13 = errors;
                  const _errs14 = errors;
                  let valid3 = false;
                  const _errs15 = errors;
                  if (
                    !validate84(data3, {
                      instancePath: instancePath + "/lastEditedAt",
                      parentData: data,
                      parentDataProperty: "lastEditedAt",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
                    errors = vErrors.length;
                  }
                  var _valid2 = _errs15 === errors;
                  valid3 = valid3 || _valid2;
                  const _errs16 = errors;
                  if (data3 !== null) {
                    const err4 = {
                      instancePath: instancePath + "/lastEditedAt",
                      schemaPath: "#/properties/lastEditedAt/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    if (vErrors === null) {
                      vErrors = [err4];
                    } else {
                      vErrors.push(err4);
                    }
                    errors++;
                  }
                  var _valid2 = _errs16 === errors;
                  valid3 = valid3 || _valid2;
                  if (!valid3) {
                    const err5 = {
                      instancePath: instancePath + "/lastEditedAt",
                      schemaPath: "#/properties/lastEditedAt/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    if (vErrors === null) {
                      vErrors = [err5];
                    } else {
                      vErrors.push(err5);
                    }
                    errors++;
                    validate195.errors = vErrors;
                    return false;
                  } else {
                    errors = _errs14;
                    if (vErrors !== null) {
                      if (_errs14) {
                        vErrors.length = _errs14;
                      } else {
                        vErrors = null;
                      }
                    }
                  }
                  var valid0 = _errs13 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate195.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate195.errors = vErrors;
  return errors === 0;
}
validate195.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema77 = {
  type: "object",
  properties: {
    unitPrice: { anyOf: [{ $ref: "#/$defs/Money" }, { type: "null" }] },
    marketValue: { anyOf: [{ $ref: "#/$defs/ReportedMoney" }, { type: "null" }] },
    unrealizedReturn: { anyOf: [{ $ref: "#/$defs/ReportedMoney" }, { type: "null" }] },
  },
  required: ["unitPrice", "marketValue", "unrealizedReturn"],
  additionalProperties: false,
};
const schema78 = {
  type: "object",
  properties: { currency: { $ref: "#/$defs/Currency" }, amount: { $ref: "#/$defs/SignedDecimal" } },
  required: ["currency", "amount"],
  additionalProperties: false,
};
function validate206(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate206.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.currency === undefined && (missing0 = "currency")) ||
        (data.amount === undefined && (missing0 = "amount"))
      ) {
        validate206.errors = [
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
          if (!(key0 === "currency" || key0 === "amount")) {
            validate206.errors = [
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
          if (data.currency !== undefined) {
            const _errs2 = errors;
            if (
              !validate69(data.currency, {
                instancePath: instancePath + "/currency",
                parentData: data,
                parentDataProperty: "currency",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.amount !== undefined) {
              const _errs3 = errors;
              if (
                !validate177(data.amount, {
                  instancePath: instancePath + "/amount",
                  parentData: data,
                  parentDataProperty: "amount",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate177.errors : vErrors.concat(validate177.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate206.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate206.errors = vErrors;
  return errors === 0;
}
validate206.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate204(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate204.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.unitPrice === undefined && (missing0 = "unitPrice")) ||
        (data.marketValue === undefined && (missing0 = "marketValue")) ||
        (data.unrealizedReturn === undefined && (missing0 = "unrealizedReturn"))
      ) {
        validate204.errors = [
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
          if (!(key0 === "unitPrice" || key0 === "marketValue" || key0 === "unrealizedReturn")) {
            validate204.errors = [
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
          if (data.unitPrice !== undefined) {
            let data0 = data.unitPrice;
            const _errs2 = errors;
            const _errs3 = errors;
            let valid1 = false;
            const _errs4 = errors;
            if (
              !validate189(data0, {
                instancePath: instancePath + "/unitPrice",
                parentData: data,
                parentDataProperty: "unitPrice",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate189.errors : vErrors.concat(validate189.errors);
              errors = vErrors.length;
            }
            var _valid0 = _errs4 === errors;
            valid1 = valid1 || _valid0;
            const _errs5 = errors;
            if (data0 !== null) {
              const err0 = {
                instancePath: instancePath + "/unitPrice",
                schemaPath: "#/properties/unitPrice/anyOf/1/type",
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
            var _valid0 = _errs5 === errors;
            valid1 = valid1 || _valid0;
            if (!valid1) {
              const err1 = {
                instancePath: instancePath + "/unitPrice",
                schemaPath: "#/properties/unitPrice/anyOf",
                keyword: "anyOf",
                params: {},
              };
              if (vErrors === null) {
                vErrors = [err1];
              } else {
                vErrors.push(err1);
              }
              errors++;
              validate204.errors = vErrors;
              return false;
            } else {
              errors = _errs3;
              if (vErrors !== null) {
                if (_errs3) {
                  vErrors.length = _errs3;
                } else {
                  vErrors = null;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.marketValue !== undefined) {
              let data1 = data.marketValue;
              const _errs7 = errors;
              const _errs8 = errors;
              let valid2 = false;
              const _errs9 = errors;
              if (
                !validate206(data1, {
                  instancePath: instancePath + "/marketValue",
                  parentData: data,
                  parentDataProperty: "marketValue",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate206.errors : vErrors.concat(validate206.errors);
                errors = vErrors.length;
              }
              var _valid1 = _errs9 === errors;
              valid2 = valid2 || _valid1;
              const _errs10 = errors;
              if (data1 !== null) {
                const err2 = {
                  instancePath: instancePath + "/marketValue",
                  schemaPath: "#/properties/marketValue/anyOf/1/type",
                  keyword: "type",
                  params: { type: "null" },
                };
                if (vErrors === null) {
                  vErrors = [err2];
                } else {
                  vErrors.push(err2);
                }
                errors++;
              }
              var _valid1 = _errs10 === errors;
              valid2 = valid2 || _valid1;
              if (!valid2) {
                const err3 = {
                  instancePath: instancePath + "/marketValue",
                  schemaPath: "#/properties/marketValue/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                if (vErrors === null) {
                  vErrors = [err3];
                } else {
                  vErrors.push(err3);
                }
                errors++;
                validate204.errors = vErrors;
                return false;
              } else {
                errors = _errs8;
                if (vErrors !== null) {
                  if (_errs8) {
                    vErrors.length = _errs8;
                  } else {
                    vErrors = null;
                  }
                }
              }
              var valid0 = _errs7 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.unrealizedReturn !== undefined) {
                let data2 = data.unrealizedReturn;
                const _errs12 = errors;
                const _errs13 = errors;
                let valid3 = false;
                const _errs14 = errors;
                if (
                  !validate206(data2, {
                    instancePath: instancePath + "/unrealizedReturn",
                    parentData: data,
                    parentDataProperty: "unrealizedReturn",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate206.errors : vErrors.concat(validate206.errors);
                  errors = vErrors.length;
                }
                var _valid2 = _errs14 === errors;
                valid3 = valid3 || _valid2;
                const _errs15 = errors;
                if (data2 !== null) {
                  const err4 = {
                    instancePath: instancePath + "/unrealizedReturn",
                    schemaPath: "#/properties/unrealizedReturn/anyOf/1/type",
                    keyword: "type",
                    params: { type: "null" },
                  };
                  if (vErrors === null) {
                    vErrors = [err4];
                  } else {
                    vErrors.push(err4);
                  }
                  errors++;
                }
                var _valid2 = _errs15 === errors;
                valid3 = valid3 || _valid2;
                if (!valid3) {
                  const err5 = {
                    instancePath: instancePath + "/unrealizedReturn",
                    schemaPath: "#/properties/unrealizedReturn/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  if (vErrors === null) {
                    vErrors = [err5];
                  } else {
                    vErrors.push(err5);
                  }
                  errors++;
                  validate204.errors = vErrors;
                  return false;
                } else {
                  errors = _errs13;
                  if (vErrors !== null) {
                    if (_errs13) {
                      vErrors.length = _errs13;
                    } else {
                      vErrors = null;
                    }
                  }
                }
                var valid0 = _errs12 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate204.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate204.errors = vErrors;
  return errors === 0;
}
validate204.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate180(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate180.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.assetId === undefined && (missing0 = "assetId")) ||
        (data.brokerAssetId === undefined && (missing0 = "brokerAssetId")) ||
        (data.instrument === undefined && (missing0 = "instrument")) ||
        (data.name === undefined && (missing0 = "name")) ||
        (data.assetType === undefined && (missing0 = "assetType")) ||
        (data.quantity === undefined && (missing0 = "quantity")) ||
        (data.unitCost === undefined && (missing0 = "unitCost")) ||
        (data.bookCost === undefined && (missing0 = "bookCost")) ||
        (data.bookCostCad === undefined && (missing0 = "bookCostCad")) ||
        (data.provenance === undefined && (missing0 = "provenance")) ||
        (data.reportedValues === undefined && (missing0 = "reportedValues"))
      ) {
        validate180.errors = [
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
          if (!func17.call(schema72.properties, key0)) {
            validate180.errors = [
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
          if (data.assetId !== undefined) {
            const _errs2 = errors;
            if (
              !validate82(data.assetId, {
                instancePath: instancePath + "/assetId",
                parentData: data,
                parentDataProperty: "assetId",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.brokerAssetId !== undefined) {
              let data1 = data.brokerAssetId;
              const _errs3 = errors;
              const _errs4 = errors;
              let valid1 = false;
              const _errs5 = errors;
              if (errors === _errs5) {
                if (typeof data1 === "string") {
                  if (func1(data1) > 180) {
                    const err0 = {
                      instancePath: instancePath + "/brokerAssetId",
                      schemaPath: "#/properties/brokerAssetId/anyOf/0/maxLength",
                      keyword: "maxLength",
                      params: { limit: 180 },
                    };
                    if (vErrors === null) {
                      vErrors = [err0];
                    } else {
                      vErrors.push(err0);
                    }
                    errors++;
                  } else {
                    if (func1(data1) < 1) {
                      const err1 = {
                        instancePath: instancePath + "/brokerAssetId",
                        schemaPath: "#/properties/brokerAssetId/anyOf/0/minLength",
                        keyword: "minLength",
                        params: { limit: 1 },
                      };
                      if (vErrors === null) {
                        vErrors = [err1];
                      } else {
                        vErrors.push(err1);
                      }
                      errors++;
                    }
                  }
                } else {
                  const err2 = {
                    instancePath: instancePath + "/brokerAssetId",
                    schemaPath: "#/properties/brokerAssetId/anyOf/0/type",
                    keyword: "type",
                    params: { type: "string" },
                  };
                  if (vErrors === null) {
                    vErrors = [err2];
                  } else {
                    vErrors.push(err2);
                  }
                  errors++;
                }
              }
              var _valid0 = _errs5 === errors;
              valid1 = valid1 || _valid0;
              const _errs7 = errors;
              if (data1 !== null) {
                const err3 = {
                  instancePath: instancePath + "/brokerAssetId",
                  schemaPath: "#/properties/brokerAssetId/anyOf/1/type",
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
              var _valid0 = _errs7 === errors;
              valid1 = valid1 || _valid0;
              if (!valid1) {
                const err4 = {
                  instancePath: instancePath + "/brokerAssetId",
                  schemaPath: "#/properties/brokerAssetId/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                if (vErrors === null) {
                  vErrors = [err4];
                } else {
                  vErrors.push(err4);
                }
                errors++;
                validate180.errors = vErrors;
                return false;
              } else {
                errors = _errs4;
                if (vErrors !== null) {
                  if (_errs4) {
                    vErrors.length = _errs4;
                  } else {
                    vErrors = null;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.instrument !== undefined) {
                const _errs9 = errors;
                if (
                  !validate182(data.instrument, {
                    instancePath: instancePath + "/instrument",
                    parentData: data,
                    parentDataProperty: "instrument",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate182.errors : vErrors.concat(validate182.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs9 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.name !== undefined) {
                  let data3 = data.name;
                  const _errs10 = errors;
                  const _errs11 = errors;
                  let valid2 = false;
                  const _errs12 = errors;
                  if (errors === _errs12) {
                    if (typeof data3 === "string") {
                      if (func1(data3) > 180) {
                        const err5 = {
                          instancePath: instancePath + "/name",
                          schemaPath: "#/properties/name/anyOf/0/maxLength",
                          keyword: "maxLength",
                          params: { limit: 180 },
                        };
                        if (vErrors === null) {
                          vErrors = [err5];
                        } else {
                          vErrors.push(err5);
                        }
                        errors++;
                      } else {
                        if (func1(data3) < 1) {
                          const err6 = {
                            instancePath: instancePath + "/name",
                            schemaPath: "#/properties/name/anyOf/0/minLength",
                            keyword: "minLength",
                            params: { limit: 1 },
                          };
                          if (vErrors === null) {
                            vErrors = [err6];
                          } else {
                            vErrors.push(err6);
                          }
                          errors++;
                        }
                      }
                    } else {
                      const err7 = {
                        instancePath: instancePath + "/name",
                        schemaPath: "#/properties/name/anyOf/0/type",
                        keyword: "type",
                        params: { type: "string" },
                      };
                      if (vErrors === null) {
                        vErrors = [err7];
                      } else {
                        vErrors.push(err7);
                      }
                      errors++;
                    }
                  }
                  var _valid1 = _errs12 === errors;
                  valid2 = valid2 || _valid1;
                  const _errs14 = errors;
                  if (data3 !== null) {
                    const err8 = {
                      instancePath: instancePath + "/name",
                      schemaPath: "#/properties/name/anyOf/1/type",
                      keyword: "type",
                      params: { type: "null" },
                    };
                    if (vErrors === null) {
                      vErrors = [err8];
                    } else {
                      vErrors.push(err8);
                    }
                    errors++;
                  }
                  var _valid1 = _errs14 === errors;
                  valid2 = valid2 || _valid1;
                  if (!valid2) {
                    const err9 = {
                      instancePath: instancePath + "/name",
                      schemaPath: "#/properties/name/anyOf",
                      keyword: "anyOf",
                      params: {},
                    };
                    if (vErrors === null) {
                      vErrors = [err9];
                    } else {
                      vErrors.push(err9);
                    }
                    errors++;
                    validate180.errors = vErrors;
                    return false;
                  } else {
                    errors = _errs11;
                    if (vErrors !== null) {
                      if (_errs11) {
                        vErrors.length = _errs11;
                      } else {
                        vErrors = null;
                      }
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.assetType !== undefined) {
                    let data4 = data.assetType;
                    const _errs16 = errors;
                    if (!(data4 === "stock" || data4 === "etf" || data4 === "unsupported")) {
                      validate180.errors = [
                        {
                          instancePath: instancePath + "/assetType",
                          schemaPath: "#/properties/assetType/enum",
                          keyword: "enum",
                          params: { allowedValues: schema72.properties.assetType.enum },
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs16 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.quantity !== undefined) {
                      const _errs17 = errors;
                      if (
                        !validate187(data.quantity, {
                          instancePath: instancePath + "/quantity",
                          parentData: data,
                          parentDataProperty: "quantity",
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null
                            ? validate187.errors
                            : vErrors.concat(validate187.errors);
                        errors = vErrors.length;
                      }
                      var valid0 = _errs17 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.unitCost !== undefined) {
                        let data6 = data.unitCost;
                        const _errs18 = errors;
                        const _errs19 = errors;
                        let valid3 = false;
                        const _errs20 = errors;
                        if (
                          !validate189(data6, {
                            instancePath: instancePath + "/unitCost",
                            parentData: data,
                            parentDataProperty: "unitCost",
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate189.errors
                              : vErrors.concat(validate189.errors);
                          errors = vErrors.length;
                        }
                        var _valid2 = _errs20 === errors;
                        valid3 = valid3 || _valid2;
                        const _errs21 = errors;
                        if (data6 !== null) {
                          const err10 = {
                            instancePath: instancePath + "/unitCost",
                            schemaPath: "#/properties/unitCost/anyOf/1/type",
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
                        var _valid2 = _errs21 === errors;
                        valid3 = valid3 || _valid2;
                        if (!valid3) {
                          const err11 = {
                            instancePath: instancePath + "/unitCost",
                            schemaPath: "#/properties/unitCost/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          if (vErrors === null) {
                            vErrors = [err11];
                          } else {
                            vErrors.push(err11);
                          }
                          errors++;
                          validate180.errors = vErrors;
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
                        if (data.bookCost !== undefined) {
                          let data7 = data.bookCost;
                          const _errs23 = errors;
                          const _errs24 = errors;
                          let valid4 = false;
                          const _errs25 = errors;
                          if (
                            !validate189(data7, {
                              instancePath: instancePath + "/bookCost",
                              parentData: data,
                              parentDataProperty: "bookCost",
                              rootData,
                              dynamicAnchors,
                            })
                          ) {
                            vErrors =
                              vErrors === null
                                ? validate189.errors
                                : vErrors.concat(validate189.errors);
                            errors = vErrors.length;
                          }
                          var _valid3 = _errs25 === errors;
                          valid4 = valid4 || _valid3;
                          const _errs26 = errors;
                          if (data7 !== null) {
                            const err12 = {
                              instancePath: instancePath + "/bookCost",
                              schemaPath: "#/properties/bookCost/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            if (vErrors === null) {
                              vErrors = [err12];
                            } else {
                              vErrors.push(err12);
                            }
                            errors++;
                          }
                          var _valid3 = _errs26 === errors;
                          valid4 = valid4 || _valid3;
                          if (!valid4) {
                            const err13 = {
                              instancePath: instancePath + "/bookCost",
                              schemaPath: "#/properties/bookCost/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            if (vErrors === null) {
                              vErrors = [err13];
                            } else {
                              vErrors.push(err13);
                            }
                            errors++;
                            validate180.errors = vErrors;
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
                          if (data.bookCostCad !== undefined) {
                            let data8 = data.bookCostCad;
                            const _errs28 = errors;
                            const _errs29 = errors;
                            let valid5 = false;
                            const _errs30 = errors;
                            if (
                              !validate189(data8, {
                                instancePath: instancePath + "/bookCostCad",
                                parentData: data,
                                parentDataProperty: "bookCostCad",
                                rootData,
                                dynamicAnchors,
                              })
                            ) {
                              vErrors =
                                vErrors === null
                                  ? validate189.errors
                                  : vErrors.concat(validate189.errors);
                              errors = vErrors.length;
                            }
                            var _valid4 = _errs30 === errors;
                            valid5 = valid5 || _valid4;
                            const _errs31 = errors;
                            if (data8 !== null) {
                              const err14 = {
                                instancePath: instancePath + "/bookCostCad",
                                schemaPath: "#/properties/bookCostCad/anyOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                              };
                              if (vErrors === null) {
                                vErrors = [err14];
                              } else {
                                vErrors.push(err14);
                              }
                              errors++;
                            }
                            var _valid4 = _errs31 === errors;
                            valid5 = valid5 || _valid4;
                            if (!valid5) {
                              const err15 = {
                                instancePath: instancePath + "/bookCostCad",
                                schemaPath: "#/properties/bookCostCad/anyOf",
                                keyword: "anyOf",
                                params: {},
                              };
                              if (vErrors === null) {
                                vErrors = [err15];
                              } else {
                                vErrors.push(err15);
                              }
                              errors++;
                              validate180.errors = vErrors;
                              return false;
                            } else {
                              errors = _errs29;
                              if (vErrors !== null) {
                                if (_errs29) {
                                  vErrors.length = _errs29;
                                } else {
                                  vErrors = null;
                                }
                              }
                            }
                            var valid0 = _errs28 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.provenance !== undefined) {
                              let data9 = data.provenance;
                              const _errs33 = errors;
                              if (errors === _errs33) {
                                if (data9 && typeof data9 == "object" && !Array.isArray(data9)) {
                                  let missing1;
                                  if (
                                    (data9.instrument === undefined && (missing1 = "instrument")) ||
                                    (data9.quantity === undefined && (missing1 = "quantity")) ||
                                    (data9.unitCost === undefined && (missing1 = "unitCost")) ||
                                    (data9.bookCost === undefined && (missing1 = "bookCost")) ||
                                    (data9.bookCostCad === undefined && (missing1 = "bookCostCad"))
                                  ) {
                                    validate180.errors = [
                                      {
                                        instancePath: instancePath + "/provenance",
                                        schemaPath: "#/properties/provenance/required",
                                        keyword: "required",
                                        params: { missingProperty: missing1 },
                                      },
                                    ];
                                    return false;
                                  } else {
                                    const _errs35 = errors;
                                    for (const key1 in data9) {
                                      if (!(
                                        key1 === "instrument" ||
                                        key1 === "quantity" ||
                                        key1 === "unitCost" ||
                                        key1 === "bookCost" ||
                                        key1 === "bookCostCad"
                                      )) {
                                        validate180.errors = [
                                          {
                                            instancePath: instancePath + "/provenance",
                                            schemaPath:
                                              "#/properties/provenance/additionalProperties",
                                            keyword: "additionalProperties",
                                            params: { additionalProperty: key1 },
                                          },
                                        ];
                                        return false;
                                        break;
                                      }
                                    }
                                    if (_errs35 === errors) {
                                      if (data9.instrument !== undefined) {
                                        const _errs36 = errors;
                                        if (
                                          !validate195(data9.instrument, {
                                            instancePath: instancePath + "/provenance/instrument",
                                            parentData: data9,
                                            parentDataProperty: "instrument",
                                            rootData,
                                            dynamicAnchors,
                                          })
                                        ) {
                                          vErrors =
                                            vErrors === null
                                              ? validate195.errors
                                              : vErrors.concat(validate195.errors);
                                          errors = vErrors.length;
                                        }
                                        var valid6 = _errs36 === errors;
                                      } else {
                                        var valid6 = true;
                                      }
                                      if (valid6) {
                                        if (data9.quantity !== undefined) {
                                          const _errs37 = errors;
                                          if (
                                            !validate195(data9.quantity, {
                                              instancePath: instancePath + "/provenance/quantity",
                                              parentData: data9,
                                              parentDataProperty: "quantity",
                                              rootData,
                                              dynamicAnchors,
                                            })
                                          ) {
                                            vErrors =
                                              vErrors === null
                                                ? validate195.errors
                                                : vErrors.concat(validate195.errors);
                                            errors = vErrors.length;
                                          }
                                          var valid6 = _errs37 === errors;
                                        } else {
                                          var valid6 = true;
                                        }
                                        if (valid6) {
                                          if (data9.unitCost !== undefined) {
                                            const _errs38 = errors;
                                            if (
                                              !validate195(data9.unitCost, {
                                                instancePath: instancePath + "/provenance/unitCost",
                                                parentData: data9,
                                                parentDataProperty: "unitCost",
                                                rootData,
                                                dynamicAnchors,
                                              })
                                            ) {
                                              vErrors =
                                                vErrors === null
                                                  ? validate195.errors
                                                  : vErrors.concat(validate195.errors);
                                              errors = vErrors.length;
                                            }
                                            var valid6 = _errs38 === errors;
                                          } else {
                                            var valid6 = true;
                                          }
                                          if (valid6) {
                                            if (data9.bookCost !== undefined) {
                                              const _errs39 = errors;
                                              if (
                                                !validate195(data9.bookCost, {
                                                  instancePath:
                                                    instancePath + "/provenance/bookCost",
                                                  parentData: data9,
                                                  parentDataProperty: "bookCost",
                                                  rootData,
                                                  dynamicAnchors,
                                                })
                                              ) {
                                                vErrors =
                                                  vErrors === null
                                                    ? validate195.errors
                                                    : vErrors.concat(validate195.errors);
                                                errors = vErrors.length;
                                              }
                                              var valid6 = _errs39 === errors;
                                            } else {
                                              var valid6 = true;
                                            }
                                            if (valid6) {
                                              if (data9.bookCostCad !== undefined) {
                                                const _errs40 = errors;
                                                if (
                                                  !validate195(data9.bookCostCad, {
                                                    instancePath:
                                                      instancePath + "/provenance/bookCostCad",
                                                    parentData: data9,
                                                    parentDataProperty: "bookCostCad",
                                                    rootData,
                                                    dynamicAnchors,
                                                  })
                                                ) {
                                                  vErrors =
                                                    vErrors === null
                                                      ? validate195.errors
                                                      : vErrors.concat(validate195.errors);
                                                  errors = vErrors.length;
                                                }
                                                var valid6 = _errs40 === errors;
                                              } else {
                                                var valid6 = true;
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                } else {
                                  validate180.errors = [
                                    {
                                      instancePath: instancePath + "/provenance",
                                      schemaPath: "#/properties/provenance/type",
                                      keyword: "type",
                                      params: { type: "object" },
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs33 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.reportedValues !== undefined) {
                                let data15 = data.reportedValues;
                                const _errs41 = errors;
                                const _errs42 = errors;
                                let valid7 = false;
                                const _errs43 = errors;
                                if (
                                  !validate204(data15, {
                                    instancePath: instancePath + "/reportedValues",
                                    parentData: data,
                                    parentDataProperty: "reportedValues",
                                    rootData,
                                    dynamicAnchors,
                                  })
                                ) {
                                  vErrors =
                                    vErrors === null
                                      ? validate204.errors
                                      : vErrors.concat(validate204.errors);
                                  errors = vErrors.length;
                                }
                                var _valid5 = _errs43 === errors;
                                valid7 = valid7 || _valid5;
                                const _errs44 = errors;
                                if (data15 !== null) {
                                  const err16 = {
                                    instancePath: instancePath + "/reportedValues",
                                    schemaPath: "#/properties/reportedValues/anyOf/1/type",
                                    keyword: "type",
                                    params: { type: "null" },
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err16];
                                  } else {
                                    vErrors.push(err16);
                                  }
                                  errors++;
                                }
                                var _valid5 = _errs44 === errors;
                                valid7 = valid7 || _valid5;
                                if (!valid7) {
                                  const err17 = {
                                    instancePath: instancePath + "/reportedValues",
                                    schemaPath: "#/properties/reportedValues/anyOf",
                                    keyword: "anyOf",
                                    params: {},
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err17];
                                  } else {
                                    vErrors.push(err17);
                                  }
                                  errors++;
                                  validate180.errors = vErrors;
                                  return false;
                                } else {
                                  errors = _errs42;
                                  if (vErrors !== null) {
                                    if (_errs42) {
                                      vErrors.length = _errs42;
                                    } else {
                                      vErrors = null;
                                    }
                                  }
                                }
                                var valid0 = _errs41 === errors;
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
    } else {
      validate180.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate180.errors = vErrors;
  return errors === 0;
}
validate180.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate173(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate173.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.accountId === undefined && (missing0 = "accountId")) ||
        (data.displayName === undefined && (missing0 = "displayName")) ||
        (data.balances === undefined && (missing0 = "balances")) ||
        (data.positions === undefined && (missing0 = "positions"))
      ) {
        validate173.errors = [
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
            key0 === "accountId" ||
            key0 === "displayName" ||
            key0 === "balances" ||
            key0 === "positions"
          )) {
            validate173.errors = [
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
          if (data.accountId !== undefined) {
            const _errs2 = errors;
            if (
              !validate82(data.accountId, {
                instancePath: instancePath + "/accountId",
                parentData: data,
                parentDataProperty: "accountId",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.displayName !== undefined) {
              let data1 = data.displayName;
              const _errs3 = errors;
              if (errors === _errs3) {
                if (typeof data1 === "string") {
                  if (func1(data1) > 180) {
                    validate173.errors = [
                      {
                        instancePath: instancePath + "/displayName",
                        schemaPath: "#/properties/displayName/maxLength",
                        keyword: "maxLength",
                        params: { limit: 180 },
                      },
                    ];
                    return false;
                  } else {
                    if (func1(data1) < 1) {
                      validate173.errors = [
                        {
                          instancePath: instancePath + "/displayName",
                          schemaPath: "#/properties/displayName/minLength",
                          keyword: "minLength",
                          params: { limit: 1 },
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate173.errors = [
                    {
                      instancePath: instancePath + "/displayName",
                      schemaPath: "#/properties/displayName/type",
                      keyword: "type",
                      params: { type: "string" },
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
              if (data.balances !== undefined) {
                let data2 = data.balances;
                const _errs5 = errors;
                if (errors === _errs5) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 12) {
                      validate173.errors = [
                        {
                          instancePath: instancePath + "/balances",
                          schemaPath: "#/properties/balances/maxItems",
                          keyword: "maxItems",
                          params: { limit: 12 },
                        },
                      ];
                      return false;
                    } else {
                      if (data2.length < 0) {
                        validate173.errors = [
                          {
                            instancePath: instancePath + "/balances",
                            schemaPath: "#/properties/balances/minItems",
                            keyword: "minItems",
                            params: { limit: 0 },
                          },
                        ];
                        return false;
                      } else {
                        var valid1 = true;
                        const len0 = data2.length;
                        for (let i0 = 0; i0 < len0; i0++) {
                          const _errs7 = errors;
                          if (
                            !validate175(data2[i0], {
                              instancePath: instancePath + "/balances/" + i0,
                              parentData: data2,
                              parentDataProperty: i0,
                              rootData,
                              dynamicAnchors,
                            })
                          ) {
                            vErrors =
                              vErrors === null
                                ? validate175.errors
                                : vErrors.concat(validate175.errors);
                            errors = vErrors.length;
                          }
                          var valid1 = _errs7 === errors;
                          if (!valid1) {
                            break;
                          }
                        }
                      }
                    }
                  } else {
                    validate173.errors = [
                      {
                        instancePath: instancePath + "/balances",
                        schemaPath: "#/properties/balances/type",
                        keyword: "type",
                        params: { type: "array" },
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs5 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.positions !== undefined) {
                  let data4 = data.positions;
                  const _errs8 = errors;
                  if (errors === _errs8) {
                    if (Array.isArray(data4)) {
                      if (data4.length > 1000) {
                        validate173.errors = [
                          {
                            instancePath: instancePath + "/positions",
                            schemaPath: "#/properties/positions/maxItems",
                            keyword: "maxItems",
                            params: { limit: 1000 },
                          },
                        ];
                        return false;
                      } else {
                        if (data4.length < 0) {
                          validate173.errors = [
                            {
                              instancePath: instancePath + "/positions",
                              schemaPath: "#/properties/positions/minItems",
                              keyword: "minItems",
                              params: { limit: 0 },
                            },
                          ];
                          return false;
                        } else {
                          var valid2 = true;
                          const len1 = data4.length;
                          for (let i1 = 0; i1 < len1; i1++) {
                            const _errs10 = errors;
                            if (
                              !validate180(data4[i1], {
                                instancePath: instancePath + "/positions/" + i1,
                                parentData: data4,
                                parentDataProperty: i1,
                                rootData,
                                dynamicAnchors,
                              })
                            ) {
                              vErrors =
                                vErrors === null
                                  ? validate180.errors
                                  : vErrors.concat(validate180.errors);
                              errors = vErrors.length;
                            }
                            var valid2 = _errs10 === errors;
                            if (!valid2) {
                              break;
                            }
                          }
                        }
                      }
                    } else {
                      validate173.errors = [
                        {
                          instancePath: instancePath + "/positions",
                          schemaPath: "#/properties/positions/type",
                          keyword: "type",
                          params: { type: "array" },
                        },
                      ];
                      return false;
                    }
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
    } else {
      validate173.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate173.errors = vErrors;
  return errors === 0;
}
validate173.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate165(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate165.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.kind === undefined && (missing0 = "kind")) ||
        (data.profile === undefined && (missing0 = "profile")) ||
        (data.snapshotId === undefined && (missing0 = "snapshotId")) ||
        (data.editKind === undefined && (missing0 = "editKind")) ||
        (data.reportDate === undefined && (missing0 = "reportDate")) ||
        (data.importSnapshot === undefined && (missing0 = "importSnapshot")) ||
        (data.previousSnapshot === undefined && (missing0 = "previousSnapshot")) ||
        (data.accounts === undefined && (missing0 = "accounts")) ||
        (data.excludedAssets === undefined && (missing0 = "excludedAssets"))
      ) {
        validate165.errors = [
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
          if (!func17.call(schema67.properties, key0)) {
            validate165.errors = [
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
          if (data.kind !== undefined) {
            const _errs2 = errors;
            if ("holdings" !== data.kind) {
              validate165.errors = [
                {
                  instancePath: instancePath + "/kind",
                  schemaPath: "#/properties/kind/const",
                  keyword: "const",
                  params: { allowedValue: "holdings" },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.profile !== undefined) {
              const _errs3 = errors;
              if ("folioview.holdings-facts.v2" !== data.profile) {
                validate165.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.holdings-facts.v2" },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.snapshotId !== undefined) {
                const _errs4 = errors;
                if (
                  !validate82(data.snapshotId, {
                    instancePath: instancePath + "/snapshotId",
                    parentData: data,
                    parentDataProperty: "snapshotId",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.editKind !== undefined) {
                  let data3 = data.editKind;
                  const _errs5 = errors;
                  if (!(data3 === "import" || data3 === "manual" || data3 === "edit")) {
                    validate165.errors = [
                      {
                        instancePath: instancePath + "/editKind",
                        schemaPath: "#/properties/editKind/enum",
                        keyword: "enum",
                        params: { allowedValues: schema67.properties.editKind.enum },
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs5 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.reportDate !== undefined) {
                    let data4 = data.reportDate;
                    const _errs6 = errors;
                    const _errs7 = errors;
                    let valid1 = false;
                    const _errs8 = errors;
                    if (
                      !validate91(data4, {
                        instancePath: instancePath + "/reportDate",
                        parentData: data,
                        parentDataProperty: "reportDate",
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate91.errors : vErrors.concat(validate91.errors);
                      errors = vErrors.length;
                    }
                    var _valid0 = _errs8 === errors;
                    valid1 = valid1 || _valid0;
                    const _errs9 = errors;
                    if (data4 !== null) {
                      const err0 = {
                        instancePath: instancePath + "/reportDate",
                        schemaPath: "#/properties/reportDate/anyOf/1/type",
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
                    var _valid0 = _errs9 === errors;
                    valid1 = valid1 || _valid0;
                    if (!valid1) {
                      const err1 = {
                        instancePath: instancePath + "/reportDate",
                        schemaPath: "#/properties/reportDate/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      if (vErrors === null) {
                        vErrors = [err1];
                      } else {
                        vErrors.push(err1);
                      }
                      errors++;
                      validate165.errors = vErrors;
                      return false;
                    } else {
                      errors = _errs7;
                      if (vErrors !== null) {
                        if (_errs7) {
                          vErrors.length = _errs7;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                    var valid0 = _errs6 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.importSnapshot !== undefined) {
                      let data5 = data.importSnapshot;
                      const _errs11 = errors;
                      const _errs12 = errors;
                      let valid2 = false;
                      const _errs13 = errors;
                      if (
                        !validate168(data5, {
                          instancePath: instancePath + "/importSnapshot",
                          parentData: data,
                          parentDataProperty: "importSnapshot",
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null
                            ? validate168.errors
                            : vErrors.concat(validate168.errors);
                        errors = vErrors.length;
                      }
                      var _valid1 = _errs13 === errors;
                      valid2 = valid2 || _valid1;
                      const _errs14 = errors;
                      if (data5 !== null) {
                        const err2 = {
                          instancePath: instancePath + "/importSnapshot",
                          schemaPath: "#/properties/importSnapshot/anyOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                        };
                        if (vErrors === null) {
                          vErrors = [err2];
                        } else {
                          vErrors.push(err2);
                        }
                        errors++;
                      }
                      var _valid1 = _errs14 === errors;
                      valid2 = valid2 || _valid1;
                      if (!valid2) {
                        const err3 = {
                          instancePath: instancePath + "/importSnapshot",
                          schemaPath: "#/properties/importSnapshot/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        if (vErrors === null) {
                          vErrors = [err3];
                        } else {
                          vErrors.push(err3);
                        }
                        errors++;
                        validate165.errors = vErrors;
                        return false;
                      } else {
                        errors = _errs12;
                        if (vErrors !== null) {
                          if (_errs12) {
                            vErrors.length = _errs12;
                          } else {
                            vErrors = null;
                          }
                        }
                      }
                      var valid0 = _errs11 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.previousSnapshot !== undefined) {
                        let data6 = data.previousSnapshot;
                        const _errs16 = errors;
                        const _errs17 = errors;
                        let valid3 = false;
                        const _errs18 = errors;
                        if (
                          !validate168(data6, {
                            instancePath: instancePath + "/previousSnapshot",
                            parentData: data,
                            parentDataProperty: "previousSnapshot",
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate168.errors
                              : vErrors.concat(validate168.errors);
                          errors = vErrors.length;
                        }
                        var _valid2 = _errs18 === errors;
                        valid3 = valid3 || _valid2;
                        const _errs19 = errors;
                        if (data6 !== null) {
                          const err4 = {
                            instancePath: instancePath + "/previousSnapshot",
                            schemaPath: "#/properties/previousSnapshot/anyOf/1/type",
                            keyword: "type",
                            params: { type: "null" },
                          };
                          if (vErrors === null) {
                            vErrors = [err4];
                          } else {
                            vErrors.push(err4);
                          }
                          errors++;
                        }
                        var _valid2 = _errs19 === errors;
                        valid3 = valid3 || _valid2;
                        if (!valid3) {
                          const err5 = {
                            instancePath: instancePath + "/previousSnapshot",
                            schemaPath: "#/properties/previousSnapshot/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          if (vErrors === null) {
                            vErrors = [err5];
                          } else {
                            vErrors.push(err5);
                          }
                          errors++;
                          validate165.errors = vErrors;
                          return false;
                        } else {
                          errors = _errs17;
                          if (vErrors !== null) {
                            if (_errs17) {
                              vErrors.length = _errs17;
                            } else {
                              vErrors = null;
                            }
                          }
                        }
                        var valid0 = _errs16 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.accounts !== undefined) {
                          let data7 = data.accounts;
                          const _errs21 = errors;
                          if (errors === _errs21) {
                            if (Array.isArray(data7)) {
                              if (data7.length > 20) {
                                validate165.errors = [
                                  {
                                    instancePath: instancePath + "/accounts",
                                    schemaPath: "#/properties/accounts/maxItems",
                                    keyword: "maxItems",
                                    params: { limit: 20 },
                                  },
                                ];
                                return false;
                              } else {
                                if (data7.length < 0) {
                                  validate165.errors = [
                                    {
                                      instancePath: instancePath + "/accounts",
                                      schemaPath: "#/properties/accounts/minItems",
                                      keyword: "minItems",
                                      params: { limit: 0 },
                                    },
                                  ];
                                  return false;
                                } else {
                                  var valid4 = true;
                                  const len0 = data7.length;
                                  for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs23 = errors;
                                    if (
                                      !validate173(data7[i0], {
                                        instancePath: instancePath + "/accounts/" + i0,
                                        parentData: data7,
                                        parentDataProperty: i0,
                                        rootData,
                                        dynamicAnchors,
                                      })
                                    ) {
                                      vErrors =
                                        vErrors === null
                                          ? validate173.errors
                                          : vErrors.concat(validate173.errors);
                                      errors = vErrors.length;
                                    }
                                    var valid4 = _errs23 === errors;
                                    if (!valid4) {
                                      break;
                                    }
                                  }
                                }
                              }
                            } else {
                              validate165.errors = [
                                {
                                  instancePath: instancePath + "/accounts",
                                  schemaPath: "#/properties/accounts/type",
                                  keyword: "type",
                                  params: { type: "array" },
                                },
                              ];
                              return false;
                            }
                          }
                          var valid0 = _errs21 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.excludedAssets !== undefined) {
                            let data9 = data.excludedAssets;
                            const _errs24 = errors;
                            if (errors === _errs24) {
                              if (Array.isArray(data9)) {
                                if (data9.length > 1000) {
                                  validate165.errors = [
                                    {
                                      instancePath: instancePath + "/excludedAssets",
                                      schemaPath: "#/properties/excludedAssets/maxItems",
                                      keyword: "maxItems",
                                      params: { limit: 1000 },
                                    },
                                  ];
                                  return false;
                                } else {
                                  if (data9.length < 0) {
                                    validate165.errors = [
                                      {
                                        instancePath: instancePath + "/excludedAssets",
                                        schemaPath: "#/properties/excludedAssets/minItems",
                                        keyword: "minItems",
                                        params: { limit: 0 },
                                      },
                                    ];
                                    return false;
                                  } else {
                                    var valid5 = true;
                                    const len1 = data9.length;
                                    for (let i1 = 0; i1 < len1; i1++) {
                                      let data10 = data9[i1];
                                      const _errs26 = errors;
                                      if (errors === _errs26) {
                                        if (
                                          data10 &&
                                          typeof data10 == "object" &&
                                          !Array.isArray(data10)
                                        ) {
                                          let missing1;
                                          if (
                                            (data10.brokerAssetId === undefined &&
                                              (missing1 = "brokerAssetId")) ||
                                            (data10.reason === undefined && (missing1 = "reason"))
                                          ) {
                                            validate165.errors = [
                                              {
                                                instancePath:
                                                  instancePath + "/excludedAssets/" + i1,
                                                schemaPath:
                                                  "#/properties/excludedAssets/items/required",
                                                keyword: "required",
                                                params: { missingProperty: missing1 },
                                              },
                                            ];
                                            return false;
                                          } else {
                                            const _errs28 = errors;
                                            for (const key1 in data10) {
                                              if (!(
                                                key1 === "brokerAssetId" || key1 === "reason"
                                              )) {
                                                validate165.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + "/excludedAssets/" + i1,
                                                    schemaPath:
                                                      "#/properties/excludedAssets/items/additionalProperties",
                                                    keyword: "additionalProperties",
                                                    params: { additionalProperty: key1 },
                                                  },
                                                ];
                                                return false;
                                                break;
                                              }
                                            }
                                            if (_errs28 === errors) {
                                              if (data10.brokerAssetId !== undefined) {
                                                let data11 = data10.brokerAssetId;
                                                const _errs29 = errors;
                                                if (errors === _errs29) {
                                                  if (typeof data11 === "string") {
                                                    if (func1(data11) > 180) {
                                                      validate165.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath +
                                                            "/excludedAssets/" +
                                                            i1 +
                                                            "/brokerAssetId",
                                                          schemaPath:
                                                            "#/properties/excludedAssets/items/properties/brokerAssetId/maxLength",
                                                          keyword: "maxLength",
                                                          params: { limit: 180 },
                                                        },
                                                      ];
                                                      return false;
                                                    } else {
                                                      if (func1(data11) < 1) {
                                                        validate165.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath +
                                                              "/excludedAssets/" +
                                                              i1 +
                                                              "/brokerAssetId",
                                                            schemaPath:
                                                              "#/properties/excludedAssets/items/properties/brokerAssetId/minLength",
                                                            keyword: "minLength",
                                                            params: { limit: 1 },
                                                          },
                                                        ];
                                                        return false;
                                                      }
                                                    }
                                                  } else {
                                                    validate165.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          "/excludedAssets/" +
                                                          i1 +
                                                          "/brokerAssetId",
                                                        schemaPath:
                                                          "#/properties/excludedAssets/items/properties/brokerAssetId/type",
                                                        keyword: "type",
                                                        params: { type: "string" },
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                }
                                                var valid6 = _errs29 === errors;
                                              } else {
                                                var valid6 = true;
                                              }
                                              if (valid6) {
                                                if (data10.reason !== undefined) {
                                                  let data12 = data10.reason;
                                                  const _errs31 = errors;
                                                  if (errors === _errs31) {
                                                    if (typeof data12 === "string") {
                                                      if (func1(data12) > 64) {
                                                        validate165.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath +
                                                              "/excludedAssets/" +
                                                              i1 +
                                                              "/reason",
                                                            schemaPath:
                                                              "#/properties/excludedAssets/items/properties/reason/maxLength",
                                                            keyword: "maxLength",
                                                            params: { limit: 64 },
                                                          },
                                                        ];
                                                        return false;
                                                      } else {
                                                        if (func1(data12) < 1) {
                                                          validate165.errors = [
                                                            {
                                                              instancePath:
                                                                instancePath +
                                                                "/excludedAssets/" +
                                                                i1 +
                                                                "/reason",
                                                              schemaPath:
                                                                "#/properties/excludedAssets/items/properties/reason/minLength",
                                                              keyword: "minLength",
                                                              params: { limit: 1 },
                                                            },
                                                          ];
                                                          return false;
                                                        }
                                                      }
                                                    } else {
                                                      validate165.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath +
                                                            "/excludedAssets/" +
                                                            i1 +
                                                            "/reason",
                                                          schemaPath:
                                                            "#/properties/excludedAssets/items/properties/reason/type",
                                                          keyword: "type",
                                                          params: { type: "string" },
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                  }
                                                  var valid6 = _errs31 === errors;
                                                } else {
                                                  var valid6 = true;
                                                }
                                              }
                                            }
                                          }
                                        } else {
                                          validate165.errors = [
                                            {
                                              instancePath: instancePath + "/excludedAssets/" + i1,
                                              schemaPath: "#/properties/excludedAssets/items/type",
                                              keyword: "type",
                                              params: { type: "object" },
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                      var valid5 = _errs26 === errors;
                                      if (!valid5) {
                                        break;
                                      }
                                    }
                                  }
                                }
                              } else {
                                validate165.errors = [
                                  {
                                    instancePath: instancePath + "/excludedAssets",
                                    schemaPath: "#/properties/excludedAssets/type",
                                    keyword: "type",
                                    params: { type: "array" },
                                  },
                                ];
                                return false;
                              }
                            }
                            var valid0 = _errs24 === errors;
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
    } else {
      validate165.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate165.errors = vErrors;
  return errors === 0;
}
validate165.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate160(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate160.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.state === undefined && (missing0 = "state")) ||
        (data.coverage === undefined && (missing0 = "coverage")) ||
        (data.sourceAsOf === undefined && (missing0 = "sourceAsOf")) ||
        (data.fetchedAt === undefined && (missing0 = "fetchedAt")) ||
        (data.freshness === undefined && (missing0 = "freshness")) ||
        (data.data === undefined && (missing0 = "data"))
      ) {
        validate160.errors = [
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
            key0 === "state" ||
            key0 === "coverage" ||
            key0 === "sourceAsOf" ||
            key0 === "fetchedAt" ||
            key0 === "freshness" ||
            key0 === "data"
          )) {
            validate160.errors = [
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
          if (data.state !== undefined) {
            let data0 = data.state;
            const _errs2 = errors;
            if (!(data0 === "ready" || data0 === "empty")) {
              validate160.errors = [
                {
                  instancePath: instancePath + "/state",
                  schemaPath: "#/properties/state/enum",
                  keyword: "enum",
                  params: { allowedValues: schema65.properties.state.enum },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.coverage !== undefined) {
              const _errs3 = errors;
              if (
                !validate161(data.coverage, {
                  instancePath: instancePath + "/coverage",
                  parentData: data,
                  parentDataProperty: "coverage",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate161.errors : vErrors.concat(validate161.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.sourceAsOf !== undefined) {
                let data2 = data.sourceAsOf;
                const _errs4 = errors;
                const _errs5 = errors;
                let valid1 = false;
                const _errs6 = errors;
                if (
                  !validate84(data2, {
                    instancePath: instancePath + "/sourceAsOf",
                    parentData: data,
                    parentDataProperty: "sourceAsOf",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
                  errors = vErrors.length;
                }
                var _valid0 = _errs6 === errors;
                valid1 = valid1 || _valid0;
                const _errs7 = errors;
                if (data2 !== null) {
                  const err0 = {
                    instancePath: instancePath + "/sourceAsOf",
                    schemaPath: "#/properties/sourceAsOf/anyOf/1/type",
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
                var _valid0 = _errs7 === errors;
                valid1 = valid1 || _valid0;
                if (!valid1) {
                  const err1 = {
                    instancePath: instancePath + "/sourceAsOf",
                    schemaPath: "#/properties/sourceAsOf/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  if (vErrors === null) {
                    vErrors = [err1];
                  } else {
                    vErrors.push(err1);
                  }
                  errors++;
                  validate160.errors = vErrors;
                  return false;
                } else {
                  errors = _errs5;
                  if (vErrors !== null) {
                    if (_errs5) {
                      vErrors.length = _errs5;
                    } else {
                      vErrors = null;
                    }
                  }
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.fetchedAt !== undefined) {
                  const _errs9 = errors;
                  if (
                    !validate84(data.fetchedAt, {
                      instancePath: instancePath + "/fetchedAt",
                      parentData: data,
                      parentDataProperty: "fetchedAt",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.freshness !== undefined) {
                    let data4 = data.freshness;
                    const _errs10 = errors;
                    if (!(data4 === "fresh" || data4 === "stale" || data4 === "unknown")) {
                      validate160.errors = [
                        {
                          instancePath: instancePath + "/freshness",
                          schemaPath: "#/properties/freshness/enum",
                          keyword: "enum",
                          params: { allowedValues: schema65.properties.freshness.enum },
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs10 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.data !== undefined) {
                      const _errs11 = errors;
                      if (
                        !validate165(data.data, {
                          instancePath: instancePath + "/data",
                          parentData: data,
                          parentDataProperty: "data",
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null
                            ? validate165.errors
                            : vErrors.concat(validate165.errors);
                        errors = vErrors.length;
                      }
                      var valid0 = _errs11 === errors;
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
      validate160.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate160.errors = vErrors;
  return errors === 0;
}
validate160.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate159(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate159.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate160(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate160.errors : vErrors.concat(validate160.errors);
    errors = vErrors.length;
  }
  validate159.errors = vErrors;
  return errors === 0;
}
validate159.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
