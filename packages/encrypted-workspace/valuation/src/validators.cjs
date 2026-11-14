"use strict";
exports.Currency = validate52;
const schema19 = { $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/Currency" };
const schema21 = {
  enum: ["USD", "CAD", "CNY", "EUR", "GBP", "JPY", "HKD", "AUD", "CHF", "NZD", "SGD", "TWD"],
};
function validate54(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate54.evaluated;
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
    validate54.errors = [
      {
        instancePath,
        schemaPath: "#/enum",
        keyword: "enum",
        params: { allowedValues: schema21.enum },
      },
    ];
    return false;
  }
  validate54.errors = vErrors;
  return errors === 0;
}
validate54.evaluated = { dynamicProps: false, dynamicItems: false };
function validate52(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate52.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
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
validate52.evaluated = { dynamicProps: false, dynamicItems: false };
exports.Date = validate56;
const schema22 = { $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/Date" };
const schema23 = {
  type: "string",
  minLength: 1,
  maxLength: 10,
  format: "date",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
};
const formats0 = /^\d{4}-\d{2}-\d{2}$/;
const func1 = require("ajv/dist/runtime/ucs2length").default;
const pattern3 = new RegExp("^\\d{4}-\\d{2}-\\d{2}$", "u");
function validate57(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate57.evaluated;
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
          validate57.errors = [
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
            validate57.errors = [
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
              validate57.errors = [
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
                validate57.errors = [
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
        validate57.errors = [
          { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
        ];
        return false;
      }
    }
  }
  validate57.errors = vErrors;
  return errors === 0;
}
validate57.evaluated = { dynamicProps: false, dynamicItems: false };
function validate56(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate56.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
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
validate56.evaluated = { dynamicProps: false, dynamicItems: false };
exports.Timestamp = validate59;
const schema24 = { $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/Timestamp" };
const schema25 = {
  type: "string",
  minLength: 1,
  maxLength: 32,
  format: "date-time",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$",
};
const formats2 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const pattern4 = new RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$", "u");
function validate60(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate60.evaluated;
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
          validate60.errors = [
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
            validate60.errors = [
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
              validate60.errors = [
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
                validate60.errors = [
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
        validate60.errors = [
          { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" } },
        ];
        return false;
      }
    }
  }
  validate60.errors = vErrors;
  return errors === 0;
}
validate60.evaluated = { dynamicProps: false, dynamicItems: false };
function validate59(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate59.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate60(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
    errors = vErrors.length;
  }
  validate59.errors = vErrors;
  return errors === 0;
}
validate59.evaluated = { dynamicProps: false, dynamicItems: false };
exports.QuoteRequest = validate62;
const schema26 = { $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/QuoteRequest" };
const schema27 = {
  type: "object",
  properties: {
    instruments: {
      type: "array",
      items: { $ref: "#/$defs/Instrument" },
      minItems: 1,
      maxItems: 50,
    },
  },
  required: ["instruments"],
  additionalProperties: false,
};
const schema28 = {
  type: "object",
  properties: {
    symbol: { $ref: "#/$defs/Symbol" },
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
function validate64(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate64.evaluated;
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
        validate64.errors = [
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
            validate64.errors = [
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
            const _errs2 = errors;
            if (
              !validate65(data.symbol, {
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
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.market !== undefined) {
              const _errs3 = errors;
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
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.currency !== undefined) {
                const _errs4 = errors;
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
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate64.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate64.errors = vErrors;
  return errors === 0;
}
validate64.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate63(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate63.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.instruments === undefined && (missing0 = "instruments")) {
        validate63.errors = [
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
          if (!(key0 === "instruments")) {
            validate63.errors = [
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
          if (data.instruments !== undefined) {
            let data0 = data.instruments;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (Array.isArray(data0)) {
                if (data0.length > 50) {
                  validate63.errors = [
                    {
                      instancePath: instancePath + "/instruments",
                      schemaPath: "#/properties/instruments/maxItems",
                      keyword: "maxItems",
                      params: { limit: 50 },
                    },
                  ];
                  return false;
                } else {
                  if (data0.length < 1) {
                    validate63.errors = [
                      {
                        instancePath: instancePath + "/instruments",
                        schemaPath: "#/properties/instruments/minItems",
                        keyword: "minItems",
                        params: { limit: 1 },
                      },
                    ];
                    return false;
                  } else {
                    var valid1 = true;
                    const len0 = data0.length;
                    for (let i0 = 0; i0 < len0; i0++) {
                      const _errs4 = errors;
                      if (
                        !validate64(data0[i0], {
                          instancePath: instancePath + "/instruments/" + i0,
                          parentData: data0,
                          parentDataProperty: i0,
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate64.errors : vErrors.concat(validate64.errors);
                        errors = vErrors.length;
                      }
                      var valid1 = _errs4 === errors;
                      if (!valid1) {
                        break;
                      }
                    }
                  }
                }
              } else {
                validate63.errors = [
                  {
                    instancePath: instancePath + "/instruments",
                    schemaPath: "#/properties/instruments/type",
                    keyword: "type",
                    params: { type: "array" },
                  },
                ];
                return false;
              }
            }
          }
        }
      }
    } else {
      validate63.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate63.errors = vErrors;
  return errors === 0;
}
validate63.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate62(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate62.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate63(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate63.errors : vErrors.concat(validate63.errors);
    errors = vErrors.length;
  }
  validate62.errors = vErrors;
  return errors === 0;
}
validate62.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.FxRequest = validate73;
const schema32 = { $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/FxRequest" };
const schema33 = {
  type: "object",
  properties: {
    pairs: { type: "array", items: { $ref: "#/$defs/Pair" }, minItems: 1, maxItems: 20 },
  },
  required: ["pairs"],
  additionalProperties: false,
};
const schema34 = {
  type: "object",
  properties: { base: { $ref: "#/$defs/Currency" }, quote: { $ref: "#/$defs/Currency" } },
  required: ["base", "quote"],
  additionalProperties: false,
};
function validate75(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate75.evaluated;
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
        (data.base === undefined && (missing0 = "base")) ||
        (data.quote === undefined && (missing0 = "quote"))
      ) {
        validate75.errors = [
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
          if (!(key0 === "base" || key0 === "quote")) {
            validate75.errors = [
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
          if (data.base !== undefined) {
            const _errs2 = errors;
            if (
              !validate69(data.base, {
                instancePath: instancePath + "/base",
                parentData: data,
                parentDataProperty: "base",
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
            if (data.quote !== undefined) {
              const _errs3 = errors;
              if (
                !validate69(data.quote, {
                  instancePath: instancePath + "/quote",
                  parentData: data,
                  parentDataProperty: "quote",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
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
      validate75.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate75.errors = vErrors;
  return errors === 0;
}
validate75.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate74(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate74.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.pairs === undefined && (missing0 = "pairs")) {
        validate74.errors = [
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
          if (!(key0 === "pairs")) {
            validate74.errors = [
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
          if (data.pairs !== undefined) {
            let data0 = data.pairs;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (Array.isArray(data0)) {
                if (data0.length > 20) {
                  validate74.errors = [
                    {
                      instancePath: instancePath + "/pairs",
                      schemaPath: "#/properties/pairs/maxItems",
                      keyword: "maxItems",
                      params: { limit: 20 },
                    },
                  ];
                  return false;
                } else {
                  if (data0.length < 1) {
                    validate74.errors = [
                      {
                        instancePath: instancePath + "/pairs",
                        schemaPath: "#/properties/pairs/minItems",
                        keyword: "minItems",
                        params: { limit: 1 },
                      },
                    ];
                    return false;
                  } else {
                    var valid1 = true;
                    const len0 = data0.length;
                    for (let i0 = 0; i0 < len0; i0++) {
                      const _errs4 = errors;
                      if (
                        !validate75(data0[i0], {
                          instancePath: instancePath + "/pairs/" + i0,
                          parentData: data0,
                          parentDataProperty: i0,
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
                        errors = vErrors.length;
                      }
                      var valid1 = _errs4 === errors;
                      if (!valid1) {
                        break;
                      }
                    }
                  }
                }
              } else {
                validate74.errors = [
                  {
                    instancePath: instancePath + "/pairs",
                    schemaPath: "#/properties/pairs/type",
                    keyword: "type",
                    params: { type: "array" },
                  },
                ];
                return false;
              }
            }
          }
        }
      }
    } else {
      validate74.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate74.errors = vErrors;
  return errors === 0;
}
validate74.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate73(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate73.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate74(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors);
    errors = vErrors.length;
  }
  validate73.errors = vErrors;
  return errors === 0;
}
validate73.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.QuoteBatch = validate80;
const schema35 = { $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/QuoteBatch" };
const schema36 = {
  type: "object",
  properties: {
    contractVersion: { const: "folioview.valuation.v1" },
    profile: { const: "folioview.quote-batch.v1" },
    snapshotId: { $ref: "#/$defs/Identifier" },
    fetchedAt: { $ref: "#/$defs/Timestamp" },
    items: { type: "array", items: { $ref: "#/$defs/QuoteItem" }, minItems: 0, maxItems: 50 },
  },
  required: ["contractVersion", "profile", "snapshotId", "fetchedAt", "items"],
  additionalProperties: false,
};
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
const schema39 = {
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
function validate86(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate86.evaluated;
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
        (data.instrument === undefined && (missing0 = "instrument")) ||
        (data.price === undefined && (missing0 = "price")) ||
        (data.source === undefined && (missing0 = "source")) ||
        (data.status === undefined && (missing0 = "status")) ||
        (data.sourceAsOf === undefined && (missing0 = "sourceAsOf")) ||
        (data.sourceDate === undefined && (missing0 = "sourceDate")) ||
        (data.fetchedAt === undefined && (missing0 = "fetchedAt")) ||
        (data.reason === undefined && (missing0 = "reason"))
      ) {
        validate86.errors = [
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
            key0 === "instrument" ||
            key0 === "price" ||
            key0 === "source" ||
            key0 === "status" ||
            key0 === "sourceAsOf" ||
            key0 === "sourceDate" ||
            key0 === "fetchedAt" ||
            key0 === "reason"
          )) {
            validate86.errors = [
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
          if (data.instrument !== undefined) {
            const _errs2 = errors;
            if (
              !validate64(data.instrument, {
                instancePath: instancePath + "/instrument",
                parentData: data,
                parentDataProperty: "instrument",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate64.errors : vErrors.concat(validate64.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.price !== undefined) {
              let data1 = data.price;
              const _errs3 = errors;
              const _errs4 = errors;
              let valid1 = false;
              const _errs5 = errors;
              if (
                !validate88(data1, {
                  instancePath: instancePath + "/price",
                  parentData: data,
                  parentDataProperty: "price",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate88.errors : vErrors.concat(validate88.errors);
                errors = vErrors.length;
              }
              var _valid0 = _errs5 === errors;
              valid1 = valid1 || _valid0;
              const _errs6 = errors;
              if (data1 !== null) {
                const err0 = {
                  instancePath: instancePath + "/price",
                  schemaPath: "#/properties/price/anyOf/1/type",
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
                  instancePath: instancePath + "/price",
                  schemaPath: "#/properties/price/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                if (vErrors === null) {
                  vErrors = [err1];
                } else {
                  vErrors.push(err1);
                }
                errors++;
                validate86.errors = vErrors;
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
              if (data.source !== undefined) {
                let data2 = data.source;
                const _errs8 = errors;
                if (!(data2 === "yahoo_finance" || data2 === "none")) {
                  validate86.errors = [
                    {
                      instancePath: instancePath + "/source",
                      schemaPath: "#/properties/source/enum",
                      keyword: "enum",
                      params: { allowedValues: schema39.properties.source.enum },
                    },
                  ];
                  return false;
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.status !== undefined) {
                  let data3 = data.status;
                  const _errs9 = errors;
                  if (!(
                    data3 === "available" ||
                    data3 === "stale" ||
                    data3 === "missing" ||
                    data3 === "unsupported"
                  )) {
                    validate86.errors = [
                      {
                        instancePath: instancePath + "/status",
                        schemaPath: "#/properties/status/enum",
                        keyword: "enum",
                        params: { allowedValues: schema39.properties.status.enum },
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.sourceAsOf !== undefined) {
                    let data4 = data.sourceAsOf;
                    const _errs10 = errors;
                    const _errs11 = errors;
                    let valid2 = false;
                    const _errs12 = errors;
                    if (
                      !validate84(data4, {
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
                    var _valid1 = _errs12 === errors;
                    valid2 = valid2 || _valid1;
                    const _errs13 = errors;
                    if (data4 !== null) {
                      const err2 = {
                        instancePath: instancePath + "/sourceAsOf",
                        schemaPath: "#/properties/sourceAsOf/anyOf/1/type",
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
                    var _valid1 = _errs13 === errors;
                    valid2 = valid2 || _valid1;
                    if (!valid2) {
                      const err3 = {
                        instancePath: instancePath + "/sourceAsOf",
                        schemaPath: "#/properties/sourceAsOf/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      if (vErrors === null) {
                        vErrors = [err3];
                      } else {
                        vErrors.push(err3);
                      }
                      errors++;
                      validate86.errors = vErrors;
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
                    if (data.sourceDate !== undefined) {
                      let data5 = data.sourceDate;
                      const _errs15 = errors;
                      const _errs16 = errors;
                      let valid3 = false;
                      const _errs17 = errors;
                      if (
                        !validate91(data5, {
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
                      var _valid2 = _errs17 === errors;
                      valid3 = valid3 || _valid2;
                      const _errs18 = errors;
                      if (data5 !== null) {
                        const err4 = {
                          instancePath: instancePath + "/sourceDate",
                          schemaPath: "#/properties/sourceDate/anyOf/1/type",
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
                      var _valid2 = _errs18 === errors;
                      valid3 = valid3 || _valid2;
                      if (!valid3) {
                        const err5 = {
                          instancePath: instancePath + "/sourceDate",
                          schemaPath: "#/properties/sourceDate/anyOf",
                          keyword: "anyOf",
                          params: {},
                        };
                        if (vErrors === null) {
                          vErrors = [err5];
                        } else {
                          vErrors.push(err5);
                        }
                        errors++;
                        validate86.errors = vErrors;
                        return false;
                      } else {
                        errors = _errs16;
                        if (vErrors !== null) {
                          if (_errs16) {
                            vErrors.length = _errs16;
                          } else {
                            vErrors = null;
                          }
                        }
                      }
                      var valid0 = _errs15 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.fetchedAt !== undefined) {
                        const _errs20 = errors;
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
                            vErrors === null
                              ? validate84.errors
                              : vErrors.concat(validate84.errors);
                          errors = vErrors.length;
                        }
                        var valid0 = _errs20 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.reason !== undefined) {
                          let data7 = data.reason;
                          const _errs21 = errors;
                          const _errs22 = errors;
                          let valid4 = false;
                          const _errs23 = errors;
                          if (!(
                            data7 === "not_found" ||
                            data7 === "unsupported_market" ||
                            data7 === "currency_mismatch" ||
                            data7 === "invalid_value" ||
                            data7 === "unknown_time" ||
                            data7 === "upstream_unavailable" ||
                            data7 === "rate_limited" ||
                            data7 === "budget_exhausted" ||
                            data7 === "missing_leg" ||
                            data7 === "mixed_dates"
                          )) {
                            const err6 = {
                              instancePath: instancePath + "/reason",
                              schemaPath: "#/properties/reason/anyOf/0/enum",
                              keyword: "enum",
                              params: { allowedValues: schema39.properties.reason.anyOf[0].enum },
                            };
                            if (vErrors === null) {
                              vErrors = [err6];
                            } else {
                              vErrors.push(err6);
                            }
                            errors++;
                          }
                          var _valid3 = _errs23 === errors;
                          valid4 = valid4 || _valid3;
                          const _errs24 = errors;
                          if (data7 !== null) {
                            const err7 = {
                              instancePath: instancePath + "/reason",
                              schemaPath: "#/properties/reason/anyOf/1/type",
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
                          var _valid3 = _errs24 === errors;
                          valid4 = valid4 || _valid3;
                          if (!valid4) {
                            const err8 = {
                              instancePath: instancePath + "/reason",
                              schemaPath: "#/properties/reason/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            if (vErrors === null) {
                              vErrors = [err8];
                            } else {
                              vErrors.push(err8);
                            }
                            errors++;
                            validate86.errors = vErrors;
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
      validate86.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate86.errors = vErrors;
  return errors === 0;
}
validate86.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate81(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate81.evaluated;
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
        (data.contractVersion === undefined && (missing0 = "contractVersion")) ||
        (data.profile === undefined && (missing0 = "profile")) ||
        (data.snapshotId === undefined && (missing0 = "snapshotId")) ||
        (data.fetchedAt === undefined && (missing0 = "fetchedAt")) ||
        (data.items === undefined && (missing0 = "items"))
      ) {
        validate81.errors = [
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
            key0 === "contractVersion" ||
            key0 === "profile" ||
            key0 === "snapshotId" ||
            key0 === "fetchedAt" ||
            key0 === "items"
          )) {
            validate81.errors = [
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
          if (data.contractVersion !== undefined) {
            const _errs2 = errors;
            if ("folioview.valuation.v1" !== data.contractVersion) {
              validate81.errors = [
                {
                  instancePath: instancePath + "/contractVersion",
                  schemaPath: "#/properties/contractVersion/const",
                  keyword: "const",
                  params: { allowedValue: "folioview.valuation.v1" },
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
              if ("folioview.quote-batch.v1" !== data.profile) {
                validate81.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.quote-batch.v1" },
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
                if (data.fetchedAt !== undefined) {
                  const _errs5 = errors;
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
                  var valid0 = _errs5 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.items !== undefined) {
                    let data4 = data.items;
                    const _errs6 = errors;
                    if (errors === _errs6) {
                      if (Array.isArray(data4)) {
                        if (data4.length > 50) {
                          validate81.errors = [
                            {
                              instancePath: instancePath + "/items",
                              schemaPath: "#/properties/items/maxItems",
                              keyword: "maxItems",
                              params: { limit: 50 },
                            },
                          ];
                          return false;
                        } else {
                          if (data4.length < 0) {
                            validate81.errors = [
                              {
                                instancePath: instancePath + "/items",
                                schemaPath: "#/properties/items/minItems",
                                keyword: "minItems",
                                params: { limit: 0 },
                              },
                            ];
                            return false;
                          } else {
                            var valid1 = true;
                            const len0 = data4.length;
                            for (let i0 = 0; i0 < len0; i0++) {
                              const _errs8 = errors;
                              if (
                                !validate86(data4[i0], {
                                  instancePath: instancePath + "/items/" + i0,
                                  parentData: data4,
                                  parentDataProperty: i0,
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
                              var valid1 = _errs8 === errors;
                              if (!valid1) {
                                break;
                              }
                            }
                          }
                        }
                      } else {
                        validate81.errors = [
                          {
                            instancePath: instancePath + "/items",
                            schemaPath: "#/properties/items/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ];
                        return false;
                      }
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
      }
    } else {
      validate81.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate81.errors = vErrors;
  return errors === 0;
}
validate81.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate80(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate80.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate81(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
    errors = vErrors.length;
  }
  validate80.errors = vErrors;
  return errors === 0;
}
validate80.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.FxBatch = validate96;
const schema42 = { $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/FxBatch" };
const schema43 = {
  type: "object",
  properties: {
    contractVersion: { const: "folioview.valuation.v1" },
    profile: { const: "folioview.fx-batch.v1" },
    snapshotId: { $ref: "#/$defs/Identifier" },
    fetchedAt: { $ref: "#/$defs/Timestamp" },
    items: { type: "array", items: { $ref: "#/$defs/FxItem" }, minItems: 0, maxItems: 20 },
  },
  required: ["contractVersion", "profile", "snapshotId", "fetchedAt", "items"],
  additionalProperties: false,
};
const schema44 = {
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
  additionalProperties: false,
};
const func17 = Object.prototype.hasOwnProperty;
const schema45 = {
  type: "object",
  properties: {
    kind: { enum: ["identity", "direct", "inverse", "cross"] },
    via: { anyOf: [{ $ref: "#/$defs/Currency" }, { type: "null" }] },
    legs: { type: "array", items: { $ref: "#/$defs/FxLeg" }, minItems: 0, maxItems: 2 },
  },
  required: ["kind", "via", "legs"],
  additionalProperties: false,
};
const schema46 = {
  type: "object",
  properties: {
    base: { $ref: "#/$defs/Currency" },
    quote: { $ref: "#/$defs/Currency" },
    rate: { $ref: "#/$defs/Decimal" },
    sourceDate: { $ref: "#/$defs/Date" },
  },
  required: ["base", "quote", "rate", "sourceDate"],
  additionalProperties: false,
};
function validate106(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate106.evaluated;
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
        (data.base === undefined && (missing0 = "base")) ||
        (data.quote === undefined && (missing0 = "quote")) ||
        (data.rate === undefined && (missing0 = "rate")) ||
        (data.sourceDate === undefined && (missing0 = "sourceDate"))
      ) {
        validate106.errors = [
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
          if (!(key0 === "base" || key0 === "quote" || key0 === "rate" || key0 === "sourceDate")) {
            validate106.errors = [
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
          if (data.base !== undefined) {
            const _errs2 = errors;
            if (
              !validate69(data.base, {
                instancePath: instancePath + "/base",
                parentData: data,
                parentDataProperty: "base",
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
            if (data.quote !== undefined) {
              const _errs3 = errors;
              if (
                !validate69(data.quote, {
                  instancePath: instancePath + "/quote",
                  parentData: data,
                  parentDataProperty: "quote",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.rate !== undefined) {
                const _errs4 = errors;
                if (
                  !validate88(data.rate, {
                    instancePath: instancePath + "/rate",
                    parentData: data,
                    parentDataProperty: "rate",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate88.errors : vErrors.concat(validate88.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.sourceDate !== undefined) {
                  const _errs5 = errors;
                  if (
                    !validate91(data.sourceDate, {
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
                  var valid0 = _errs5 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate106.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate106.errors = vErrors;
  return errors === 0;
}
validate106.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate104(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate104.evaluated;
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
        (data.via === undefined && (missing0 = "via")) ||
        (data.legs === undefined && (missing0 = "legs"))
      ) {
        validate104.errors = [
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
          if (!(key0 === "kind" || key0 === "via" || key0 === "legs")) {
            validate104.errors = [
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
            let data0 = data.kind;
            const _errs2 = errors;
            if (!(
              data0 === "identity" ||
              data0 === "direct" ||
              data0 === "inverse" ||
              data0 === "cross"
            )) {
              validate104.errors = [
                {
                  instancePath: instancePath + "/kind",
                  schemaPath: "#/properties/kind/enum",
                  keyword: "enum",
                  params: { allowedValues: schema45.properties.kind.enum },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.via !== undefined) {
              let data1 = data.via;
              const _errs3 = errors;
              const _errs4 = errors;
              let valid1 = false;
              const _errs5 = errors;
              if (
                !validate69(data1, {
                  instancePath: instancePath + "/via",
                  parentData: data,
                  parentDataProperty: "via",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
                errors = vErrors.length;
              }
              var _valid0 = _errs5 === errors;
              valid1 = valid1 || _valid0;
              const _errs6 = errors;
              if (data1 !== null) {
                const err0 = {
                  instancePath: instancePath + "/via",
                  schemaPath: "#/properties/via/anyOf/1/type",
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
                  instancePath: instancePath + "/via",
                  schemaPath: "#/properties/via/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                if (vErrors === null) {
                  vErrors = [err1];
                } else {
                  vErrors.push(err1);
                }
                errors++;
                validate104.errors = vErrors;
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
              if (data.legs !== undefined) {
                let data2 = data.legs;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 2) {
                      validate104.errors = [
                        {
                          instancePath: instancePath + "/legs",
                          schemaPath: "#/properties/legs/maxItems",
                          keyword: "maxItems",
                          params: { limit: 2 },
                        },
                      ];
                      return false;
                    } else {
                      if (data2.length < 0) {
                        validate104.errors = [
                          {
                            instancePath: instancePath + "/legs",
                            schemaPath: "#/properties/legs/minItems",
                            keyword: "minItems",
                            params: { limit: 0 },
                          },
                        ];
                        return false;
                      } else {
                        var valid2 = true;
                        const len0 = data2.length;
                        for (let i0 = 0; i0 < len0; i0++) {
                          const _errs10 = errors;
                          if (
                            !validate106(data2[i0], {
                              instancePath: instancePath + "/legs/" + i0,
                              parentData: data2,
                              parentDataProperty: i0,
                              rootData,
                              dynamicAnchors,
                            })
                          ) {
                            vErrors =
                              vErrors === null
                                ? validate106.errors
                                : vErrors.concat(validate106.errors);
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
                    validate104.errors = [
                      {
                        instancePath: instancePath + "/legs",
                        schemaPath: "#/properties/legs/type",
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
    } else {
      validate104.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate104.errors = vErrors;
  return errors === 0;
}
validate104.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate100(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate100.evaluated;
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
        (data.base === undefined && (missing0 = "base")) ||
        (data.quote === undefined && (missing0 = "quote")) ||
        (data.rate === undefined && (missing0 = "rate")) ||
        (data.source === undefined && (missing0 = "source")) ||
        (data.route === undefined && (missing0 = "route")) ||
        (data.status === undefined && (missing0 = "status")) ||
        (data.sourceAsOf === undefined && (missing0 = "sourceAsOf")) ||
        (data.sourceDate === undefined && (missing0 = "sourceDate")) ||
        (data.fetchedAt === undefined && (missing0 = "fetchedAt")) ||
        (data.reason === undefined && (missing0 = "reason"))
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
          if (!func17.call(schema44.properties, key0)) {
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
          if (data.base !== undefined) {
            const _errs2 = errors;
            if (
              !validate69(data.base, {
                instancePath: instancePath + "/base",
                parentData: data,
                parentDataProperty: "base",
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
            if (data.quote !== undefined) {
              const _errs3 = errors;
              if (
                !validate69(data.quote, {
                  instancePath: instancePath + "/quote",
                  parentData: data,
                  parentDataProperty: "quote",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.rate !== undefined) {
                let data2 = data.rate;
                const _errs4 = errors;
                const _errs5 = errors;
                let valid1 = false;
                const _errs6 = errors;
                if (
                  !validate88(data2, {
                    instancePath: instancePath + "/rate",
                    parentData: data,
                    parentDataProperty: "rate",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate88.errors : vErrors.concat(validate88.errors);
                  errors = vErrors.length;
                }
                var _valid0 = _errs6 === errors;
                valid1 = valid1 || _valid0;
                const _errs7 = errors;
                if (data2 !== null) {
                  const err0 = {
                    instancePath: instancePath + "/rate",
                    schemaPath: "#/properties/rate/anyOf/1/type",
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
                    instancePath: instancePath + "/rate",
                    schemaPath: "#/properties/rate/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  if (vErrors === null) {
                    vErrors = [err1];
                  } else {
                    vErrors.push(err1);
                  }
                  errors++;
                  validate100.errors = vErrors;
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
                if (data.source !== undefined) {
                  let data3 = data.source;
                  const _errs9 = errors;
                  if (!(data3 === "bank_of_canada" || data3 === "identity" || data3 === "none")) {
                    validate100.errors = [
                      {
                        instancePath: instancePath + "/source",
                        schemaPath: "#/properties/source/enum",
                        keyword: "enum",
                        params: { allowedValues: schema44.properties.source.enum },
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.route !== undefined) {
                    let data4 = data.route;
                    const _errs10 = errors;
                    const _errs11 = errors;
                    let valid2 = false;
                    const _errs12 = errors;
                    if (
                      !validate104(data4, {
                        instancePath: instancePath + "/route",
                        parentData: data,
                        parentDataProperty: "route",
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate104.errors : vErrors.concat(validate104.errors);
                      errors = vErrors.length;
                    }
                    var _valid1 = _errs12 === errors;
                    valid2 = valid2 || _valid1;
                    const _errs13 = errors;
                    if (data4 !== null) {
                      const err2 = {
                        instancePath: instancePath + "/route",
                        schemaPath: "#/properties/route/anyOf/1/type",
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
                    var _valid1 = _errs13 === errors;
                    valid2 = valid2 || _valid1;
                    if (!valid2) {
                      const err3 = {
                        instancePath: instancePath + "/route",
                        schemaPath: "#/properties/route/anyOf",
                        keyword: "anyOf",
                        params: {},
                      };
                      if (vErrors === null) {
                        vErrors = [err3];
                      } else {
                        vErrors.push(err3);
                      }
                      errors++;
                      validate100.errors = vErrors;
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
                    if (data.status !== undefined) {
                      let data5 = data.status;
                      const _errs15 = errors;
                      if (!(
                        data5 === "available" ||
                        data5 === "stale" ||
                        data5 === "missing" ||
                        data5 === "unsupported"
                      )) {
                        validate100.errors = [
                          {
                            instancePath: instancePath + "/status",
                            schemaPath: "#/properties/status/enum",
                            keyword: "enum",
                            params: { allowedValues: schema44.properties.status.enum },
                          },
                        ];
                        return false;
                      }
                      var valid0 = _errs15 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.sourceAsOf !== undefined) {
                        let data6 = data.sourceAsOf;
                        const _errs16 = errors;
                        const _errs17 = errors;
                        let valid3 = false;
                        const _errs18 = errors;
                        if (
                          !validate84(data6, {
                            instancePath: instancePath + "/sourceAsOf",
                            parentData: data,
                            parentDataProperty: "sourceAsOf",
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate84.errors
                              : vErrors.concat(validate84.errors);
                          errors = vErrors.length;
                        }
                        var _valid2 = _errs18 === errors;
                        valid3 = valid3 || _valid2;
                        const _errs19 = errors;
                        if (data6 !== null) {
                          const err4 = {
                            instancePath: instancePath + "/sourceAsOf",
                            schemaPath: "#/properties/sourceAsOf/anyOf/1/type",
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
                            instancePath: instancePath + "/sourceAsOf",
                            schemaPath: "#/properties/sourceAsOf/anyOf",
                            keyword: "anyOf",
                            params: {},
                          };
                          if (vErrors === null) {
                            vErrors = [err5];
                          } else {
                            vErrors.push(err5);
                          }
                          errors++;
                          validate100.errors = vErrors;
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
                        if (data.sourceDate !== undefined) {
                          let data7 = data.sourceDate;
                          const _errs21 = errors;
                          const _errs22 = errors;
                          let valid4 = false;
                          const _errs23 = errors;
                          if (
                            !validate91(data7, {
                              instancePath: instancePath + "/sourceDate",
                              parentData: data,
                              parentDataProperty: "sourceDate",
                              rootData,
                              dynamicAnchors,
                            })
                          ) {
                            vErrors =
                              vErrors === null
                                ? validate91.errors
                                : vErrors.concat(validate91.errors);
                            errors = vErrors.length;
                          }
                          var _valid3 = _errs23 === errors;
                          valid4 = valid4 || _valid3;
                          const _errs24 = errors;
                          if (data7 !== null) {
                            const err6 = {
                              instancePath: instancePath + "/sourceDate",
                              schemaPath: "#/properties/sourceDate/anyOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                            };
                            if (vErrors === null) {
                              vErrors = [err6];
                            } else {
                              vErrors.push(err6);
                            }
                            errors++;
                          }
                          var _valid3 = _errs24 === errors;
                          valid4 = valid4 || _valid3;
                          if (!valid4) {
                            const err7 = {
                              instancePath: instancePath + "/sourceDate",
                              schemaPath: "#/properties/sourceDate/anyOf",
                              keyword: "anyOf",
                              params: {},
                            };
                            if (vErrors === null) {
                              vErrors = [err7];
                            } else {
                              vErrors.push(err7);
                            }
                            errors++;
                            validate100.errors = vErrors;
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
                          if (data.fetchedAt !== undefined) {
                            const _errs26 = errors;
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
                                vErrors === null
                                  ? validate84.errors
                                  : vErrors.concat(validate84.errors);
                              errors = vErrors.length;
                            }
                            var valid0 = _errs26 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.reason !== undefined) {
                              let data9 = data.reason;
                              const _errs27 = errors;
                              const _errs28 = errors;
                              let valid5 = false;
                              const _errs29 = errors;
                              if (!(
                                data9 === "not_found" ||
                                data9 === "unsupported_market" ||
                                data9 === "currency_mismatch" ||
                                data9 === "invalid_value" ||
                                data9 === "unknown_time" ||
                                data9 === "upstream_unavailable" ||
                                data9 === "rate_limited" ||
                                data9 === "budget_exhausted" ||
                                data9 === "missing_leg" ||
                                data9 === "mixed_dates"
                              )) {
                                const err8 = {
                                  instancePath: instancePath + "/reason",
                                  schemaPath: "#/properties/reason/anyOf/0/enum",
                                  keyword: "enum",
                                  params: {
                                    allowedValues: schema44.properties.reason.anyOf[0].enum,
                                  },
                                };
                                if (vErrors === null) {
                                  vErrors = [err8];
                                } else {
                                  vErrors.push(err8);
                                }
                                errors++;
                              }
                              var _valid4 = _errs29 === errors;
                              valid5 = valid5 || _valid4;
                              const _errs30 = errors;
                              if (data9 !== null) {
                                const err9 = {
                                  instancePath: instancePath + "/reason",
                                  schemaPath: "#/properties/reason/anyOf/1/type",
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
                              var _valid4 = _errs30 === errors;
                              valid5 = valid5 || _valid4;
                              if (!valid5) {
                                const err10 = {
                                  instancePath: instancePath + "/reason",
                                  schemaPath: "#/properties/reason/anyOf",
                                  keyword: "anyOf",
                                  params: {},
                                };
                                if (vErrors === null) {
                                  vErrors = [err10];
                                } else {
                                  vErrors.push(err10);
                                }
                                errors++;
                                validate100.errors = vErrors;
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
function validate97(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate97.evaluated;
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
        (data.contractVersion === undefined && (missing0 = "contractVersion")) ||
        (data.profile === undefined && (missing0 = "profile")) ||
        (data.snapshotId === undefined && (missing0 = "snapshotId")) ||
        (data.fetchedAt === undefined && (missing0 = "fetchedAt")) ||
        (data.items === undefined && (missing0 = "items"))
      ) {
        validate97.errors = [
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
            key0 === "contractVersion" ||
            key0 === "profile" ||
            key0 === "snapshotId" ||
            key0 === "fetchedAt" ||
            key0 === "items"
          )) {
            validate97.errors = [
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
          if (data.contractVersion !== undefined) {
            const _errs2 = errors;
            if ("folioview.valuation.v1" !== data.contractVersion) {
              validate97.errors = [
                {
                  instancePath: instancePath + "/contractVersion",
                  schemaPath: "#/properties/contractVersion/const",
                  keyword: "const",
                  params: { allowedValue: "folioview.valuation.v1" },
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
              if ("folioview.fx-batch.v1" !== data.profile) {
                validate97.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.fx-batch.v1" },
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
                if (data.fetchedAt !== undefined) {
                  const _errs5 = errors;
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
                  var valid0 = _errs5 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.items !== undefined) {
                    let data4 = data.items;
                    const _errs6 = errors;
                    if (errors === _errs6) {
                      if (Array.isArray(data4)) {
                        if (data4.length > 20) {
                          validate97.errors = [
                            {
                              instancePath: instancePath + "/items",
                              schemaPath: "#/properties/items/maxItems",
                              keyword: "maxItems",
                              params: { limit: 20 },
                            },
                          ];
                          return false;
                        } else {
                          if (data4.length < 0) {
                            validate97.errors = [
                              {
                                instancePath: instancePath + "/items",
                                schemaPath: "#/properties/items/minItems",
                                keyword: "minItems",
                                params: { limit: 0 },
                              },
                            ];
                            return false;
                          } else {
                            var valid1 = true;
                            const len0 = data4.length;
                            for (let i0 = 0; i0 < len0; i0++) {
                              const _errs8 = errors;
                              if (
                                !validate100(data4[i0], {
                                  instancePath: instancePath + "/items/" + i0,
                                  parentData: data4,
                                  parentDataProperty: i0,
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
                              var valid1 = _errs8 === errors;
                              if (!valid1) {
                                break;
                              }
                            }
                          }
                        }
                      } else {
                        validate97.errors = [
                          {
                            instancePath: instancePath + "/items",
                            schemaPath: "#/properties/items/type",
                            keyword: "type",
                            params: { type: "array" },
                          },
                        ];
                        return false;
                      }
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
      }
    } else {
      validate97.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate97.errors = vErrors;
  return errors === 0;
}
validate97.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate96(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate96.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate97(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate97.errors : vErrors.concat(validate97.errors);
    errors = vErrors.length;
  }
  validate96.errors = vErrors;
  return errors === 0;
}
validate96.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.UiPreferencesSnapshotV1 = validate118;
const schema47 = {
  $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/UiPreferencesSnapshotV1",
};
const schema48 = {
  type: "object",
  properties: {
    preferences: { anyOf: [{ $ref: "#/$defs/UiPreferencesV1" }, { type: "null" }] },
    version: { $ref: "#/$defs/Revision" },
  },
  required: ["preferences", "version"],
  additionalProperties: false,
};
const schema49 = {
  type: "object",
  properties: {
    theme: { enum: ["system", "light", "dark"] },
    language: { enum: ["en", "zh"] },
    defaultChartRange: { enum: ["1d", "1w", "1m", "3m", "1y"] },
  },
  required: ["theme", "language", "defaultChartRange"],
  additionalProperties: false,
};
function validate120(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate120.evaluated;
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
        (data.theme === undefined && (missing0 = "theme")) ||
        (data.language === undefined && (missing0 = "language")) ||
        (data.defaultChartRange === undefined && (missing0 = "defaultChartRange"))
      ) {
        validate120.errors = [
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
          if (!(key0 === "theme" || key0 === "language" || key0 === "defaultChartRange")) {
            validate120.errors = [
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
          if (data.theme !== undefined) {
            let data0 = data.theme;
            const _errs2 = errors;
            if (!(data0 === "system" || data0 === "light" || data0 === "dark")) {
              validate120.errors = [
                {
                  instancePath: instancePath + "/theme",
                  schemaPath: "#/properties/theme/enum",
                  keyword: "enum",
                  params: { allowedValues: schema49.properties.theme.enum },
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.language !== undefined) {
              let data1 = data.language;
              const _errs3 = errors;
              if (!(data1 === "en" || data1 === "zh")) {
                validate120.errors = [
                  {
                    instancePath: instancePath + "/language",
                    schemaPath: "#/properties/language/enum",
                    keyword: "enum",
                    params: { allowedValues: schema49.properties.language.enum },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.defaultChartRange !== undefined) {
                let data2 = data.defaultChartRange;
                const _errs4 = errors;
                if (!(
                  data2 === "1d" ||
                  data2 === "1w" ||
                  data2 === "1m" ||
                  data2 === "3m" ||
                  data2 === "1y"
                )) {
                  validate120.errors = [
                    {
                      instancePath: instancePath + "/defaultChartRange",
                      schemaPath: "#/properties/defaultChartRange/enum",
                      keyword: "enum",
                      params: { allowedValues: schema49.properties.defaultChartRange.enum },
                    },
                  ];
                  return false;
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate120.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate120.errors = vErrors;
  return errors === 0;
}
validate120.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
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
function validate119(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate119.evaluated;
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
        (data.preferences === undefined && (missing0 = "preferences")) ||
        (data.version === undefined && (missing0 = "version"))
      ) {
        validate119.errors = [
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
          if (!(key0 === "preferences" || key0 === "version")) {
            validate119.errors = [
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
          if (data.preferences !== undefined) {
            let data0 = data.preferences;
            const _errs2 = errors;
            const _errs3 = errors;
            let valid1 = false;
            const _errs4 = errors;
            if (
              !validate120(data0, {
                instancePath: instancePath + "/preferences",
                parentData: data,
                parentDataProperty: "preferences",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate120.errors : vErrors.concat(validate120.errors);
              errors = vErrors.length;
            }
            var _valid0 = _errs4 === errors;
            valid1 = valid1 || _valid0;
            const _errs5 = errors;
            if (data0 !== null) {
              const err0 = {
                instancePath: instancePath + "/preferences",
                schemaPath: "#/properties/preferences/anyOf/1/type",
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
                instancePath: instancePath + "/preferences",
                schemaPath: "#/properties/preferences/anyOf",
                keyword: "anyOf",
                params: {},
              };
              if (vErrors === null) {
                vErrors = [err1];
              } else {
                vErrors.push(err1);
              }
              errors++;
              validate119.errors = vErrors;
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
            if (data.version !== undefined) {
              const _errs7 = errors;
              if (
                !validate122(data.version, {
                  instancePath: instancePath + "/version",
                  parentData: data,
                  parentDataProperty: "version",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs7 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate119.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate119.errors = vErrors;
  return errors === 0;
}
validate119.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate118(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate118.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate119(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate119.errors : vErrors.concat(validate119.errors);
    errors = vErrors.length;
  }
  validate118.errors = vErrors;
  return errors === 0;
}
validate118.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.CurrencyPreferencesSnapshot = validate125;
const schema51 = {
  $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/CurrencyPreferencesSnapshot",
};
const schema52 = {
  type: "object",
  properties: {
    contractVersion: { const: "folioview.valuation.v1" },
    profile: { const: "folioview.currency-preferences.v2" },
    preferences: { anyOf: [{ $ref: "#/$defs/CurrencyPreferences" }, { type: "null" }] },
    version: { $ref: "#/$defs/Revision" },
    currencyGeneration: { $ref: "#/$defs/Revision" },
  },
  required: ["contractVersion", "profile", "preferences", "version", "currencyGeneration"],
  additionalProperties: false,
};
const schema53 = {
  type: "object",
  properties: { defaultPortfolioCurrency: { $ref: "#/$defs/Currency" } },
  required: ["defaultPortfolioCurrency"],
  additionalProperties: false,
};
function validate127(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate127.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.defaultPortfolioCurrency === undefined && (missing0 = "defaultPortfolioCurrency")) {
        validate127.errors = [
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
          if (!(key0 === "defaultPortfolioCurrency")) {
            validate127.errors = [
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
          if (data.defaultPortfolioCurrency !== undefined) {
            if (
              !validate69(data.defaultPortfolioCurrency, {
                instancePath: instancePath + "/defaultPortfolioCurrency",
                parentData: data,
                parentDataProperty: "defaultPortfolioCurrency",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
              errors = vErrors.length;
            }
          }
        }
      }
    } else {
      validate127.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate127.errors = vErrors;
  return errors === 0;
}
validate127.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate126(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate126.evaluated;
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
        (data.contractVersion === undefined && (missing0 = "contractVersion")) ||
        (data.profile === undefined && (missing0 = "profile")) ||
        (data.preferences === undefined && (missing0 = "preferences")) ||
        (data.version === undefined && (missing0 = "version")) ||
        (data.currencyGeneration === undefined && (missing0 = "currencyGeneration"))
      ) {
        validate126.errors = [
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
            key0 === "contractVersion" ||
            key0 === "profile" ||
            key0 === "preferences" ||
            key0 === "version" ||
            key0 === "currencyGeneration"
          )) {
            validate126.errors = [
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
          if (data.contractVersion !== undefined) {
            const _errs2 = errors;
            if ("folioview.valuation.v1" !== data.contractVersion) {
              validate126.errors = [
                {
                  instancePath: instancePath + "/contractVersion",
                  schemaPath: "#/properties/contractVersion/const",
                  keyword: "const",
                  params: { allowedValue: "folioview.valuation.v1" },
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
              if ("folioview.currency-preferences.v2" !== data.profile) {
                validate126.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.currency-preferences.v2" },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.preferences !== undefined) {
                let data2 = data.preferences;
                const _errs4 = errors;
                const _errs5 = errors;
                let valid1 = false;
                const _errs6 = errors;
                if (
                  !validate127(data2, {
                    instancePath: instancePath + "/preferences",
                    parentData: data,
                    parentDataProperty: "preferences",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate127.errors : vErrors.concat(validate127.errors);
                  errors = vErrors.length;
                }
                var _valid0 = _errs6 === errors;
                valid1 = valid1 || _valid0;
                const _errs7 = errors;
                if (data2 !== null) {
                  const err0 = {
                    instancePath: instancePath + "/preferences",
                    schemaPath: "#/properties/preferences/anyOf/1/type",
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
                    instancePath: instancePath + "/preferences",
                    schemaPath: "#/properties/preferences/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  if (vErrors === null) {
                    vErrors = [err1];
                  } else {
                    vErrors.push(err1);
                  }
                  errors++;
                  validate126.errors = vErrors;
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
                if (data.version !== undefined) {
                  const _errs9 = errors;
                  if (
                    !validate122(data.version, {
                      instancePath: instancePath + "/version",
                      parentData: data,
                      parentDataProperty: "version",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.currencyGeneration !== undefined) {
                    const _errs10 = errors;
                    if (
                      !validate122(data.currencyGeneration, {
                        instancePath: instancePath + "/currencyGeneration",
                        parentData: data,
                        parentDataProperty: "currencyGeneration",
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs10 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate126.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate126.errors = vErrors;
  return errors === 0;
}
validate126.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate125(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate125.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate126(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate126.errors : vErrors.concat(validate126.errors);
    errors = vErrors.length;
  }
  validate125.errors = vErrors;
  return errors === 0;
}
validate125.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.CurrencyPreferencesUpdate = validate133;
const schema54 = {
  $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/CurrencyPreferencesUpdate",
};
const schema55 = {
  type: "object",
  properties: {
    defaultPortfolioCurrency: { $ref: "#/$defs/Currency" },
    expectedVersion: { $ref: "#/$defs/Revision" },
  },
  required: ["defaultPortfolioCurrency", "expectedVersion"],
  additionalProperties: false,
};
function validate134(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate134.evaluated;
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
        (data.defaultPortfolioCurrency === undefined && (missing0 = "defaultPortfolioCurrency")) ||
        (data.expectedVersion === undefined && (missing0 = "expectedVersion"))
      ) {
        validate134.errors = [
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
          if (!(key0 === "defaultPortfolioCurrency" || key0 === "expectedVersion")) {
            validate134.errors = [
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
          if (data.defaultPortfolioCurrency !== undefined) {
            const _errs2 = errors;
            if (
              !validate69(data.defaultPortfolioCurrency, {
                instancePath: instancePath + "/defaultPortfolioCurrency",
                parentData: data,
                parentDataProperty: "defaultPortfolioCurrency",
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
            if (data.expectedVersion !== undefined) {
              const _errs3 = errors;
              if (
                !validate122(data.expectedVersion, {
                  instancePath: instancePath + "/expectedVersion",
                  parentData: data,
                  parentDataProperty: "expectedVersion",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
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
      validate134.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate134.errors = vErrors;
  return errors === 0;
}
validate134.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate133(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate133.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate134(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate134.errors : vErrors.concat(validate134.errors);
    errors = vErrors.length;
  }
  validate133.errors = vErrors;
  return errors === 0;
}
validate133.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.FxPreferences = validate138;
const schema56 = { $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/FxPreferences" };
const schema57 = {
  type: "object",
  properties: {
    pairs: { type: "array", items: { $ref: "#/$defs/Pair" }, minItems: 0, maxItems: 12 },
    suppressedDefault: { anyOf: [{ $ref: "#/$defs/DefaultSuppression" }, { type: "null" }] },
  },
  required: ["pairs", "suppressedDefault"],
  additionalProperties: false,
};
const schema58 = {
  type: "object",
  properties: {
    currency: { $ref: "#/$defs/Currency" },
    currencyGeneration: { $ref: "#/$defs/Revision", minimum: 1 },
  },
  required: ["currency", "currencyGeneration"],
  additionalProperties: false,
};
function validate141(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate141.evaluated;
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
        (data.currencyGeneration === undefined && (missing0 = "currencyGeneration"))
      ) {
        validate141.errors = [
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
          if (!(key0 === "currency" || key0 === "currencyGeneration")) {
            validate141.errors = [
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
            if (data.currencyGeneration !== undefined) {
              let data1 = data.currencyGeneration;
              const _errs3 = errors;
              if (
                !validate122(data1, {
                  instancePath: instancePath + "/currencyGeneration",
                  parentData: data,
                  parentDataProperty: "currencyGeneration",
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
                    validate141.errors = [
                      {
                        instancePath: instancePath + "/currencyGeneration",
                        schemaPath: "#/properties/currencyGeneration/minimum",
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
      validate141.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate141.errors = vErrors;
  return errors === 0;
}
validate141.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate139(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate139.evaluated;
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
        (data.pairs === undefined && (missing0 = "pairs")) ||
        (data.suppressedDefault === undefined && (missing0 = "suppressedDefault"))
      ) {
        validate139.errors = [
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
          if (!(key0 === "pairs" || key0 === "suppressedDefault")) {
            validate139.errors = [
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
          if (data.pairs !== undefined) {
            let data0 = data.pairs;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (Array.isArray(data0)) {
                if (data0.length > 12) {
                  validate139.errors = [
                    {
                      instancePath: instancePath + "/pairs",
                      schemaPath: "#/properties/pairs/maxItems",
                      keyword: "maxItems",
                      params: { limit: 12 },
                    },
                  ];
                  return false;
                } else {
                  if (data0.length < 0) {
                    validate139.errors = [
                      {
                        instancePath: instancePath + "/pairs",
                        schemaPath: "#/properties/pairs/minItems",
                        keyword: "minItems",
                        params: { limit: 0 },
                      },
                    ];
                    return false;
                  } else {
                    var valid1 = true;
                    const len0 = data0.length;
                    for (let i0 = 0; i0 < len0; i0++) {
                      const _errs4 = errors;
                      if (
                        !validate75(data0[i0], {
                          instancePath: instancePath + "/pairs/" + i0,
                          parentData: data0,
                          parentDataProperty: i0,
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
                        errors = vErrors.length;
                      }
                      var valid1 = _errs4 === errors;
                      if (!valid1) {
                        break;
                      }
                    }
                  }
                }
              } else {
                validate139.errors = [
                  {
                    instancePath: instancePath + "/pairs",
                    schemaPath: "#/properties/pairs/type",
                    keyword: "type",
                    params: { type: "array" },
                  },
                ];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.suppressedDefault !== undefined) {
              let data2 = data.suppressedDefault;
              const _errs5 = errors;
              const _errs6 = errors;
              let valid2 = false;
              const _errs7 = errors;
              if (
                !validate141(data2, {
                  instancePath: instancePath + "/suppressedDefault",
                  parentData: data,
                  parentDataProperty: "suppressedDefault",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate141.errors : vErrors.concat(validate141.errors);
                errors = vErrors.length;
              }
              var _valid0 = _errs7 === errors;
              valid2 = valid2 || _valid0;
              const _errs8 = errors;
              if (data2 !== null) {
                const err0 = {
                  instancePath: instancePath + "/suppressedDefault",
                  schemaPath: "#/properties/suppressedDefault/anyOf/1/type",
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
              var _valid0 = _errs8 === errors;
              valid2 = valid2 || _valid0;
              if (!valid2) {
                const err1 = {
                  instancePath: instancePath + "/suppressedDefault",
                  schemaPath: "#/properties/suppressedDefault/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                if (vErrors === null) {
                  vErrors = [err1];
                } else {
                  vErrors.push(err1);
                }
                errors++;
                validate139.errors = vErrors;
                return false;
              } else {
                errors = _errs6;
                if (vErrors !== null) {
                  if (_errs6) {
                    vErrors.length = _errs6;
                  } else {
                    vErrors = null;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate139.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate139.errors = vErrors;
  return errors === 0;
}
validate139.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate138(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate138.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate139(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate139.errors : vErrors.concat(validate139.errors);
    errors = vErrors.length;
  }
  validate138.errors = vErrors;
  return errors === 0;
}
validate138.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.FxPreferencesSnapshot = validate146;
const schema59 = {
  $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/FxPreferencesSnapshot",
};
const schema60 = {
  type: "object",
  properties: {
    contractVersion: { const: "folioview.valuation.v1" },
    profile: { const: "folioview.fx-preferences.v1" },
    preferences: { anyOf: [{ $ref: "#/$defs/FxPreferences" }, { type: "null" }] },
    version: { $ref: "#/$defs/Revision" },
  },
  required: ["contractVersion", "profile", "preferences", "version"],
  additionalProperties: false,
};
function validate148(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate148.evaluated;
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
        (data.pairs === undefined && (missing0 = "pairs")) ||
        (data.suppressedDefault === undefined && (missing0 = "suppressedDefault"))
      ) {
        validate148.errors = [
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
          if (!(key0 === "pairs" || key0 === "suppressedDefault")) {
            validate148.errors = [
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
          if (data.pairs !== undefined) {
            let data0 = data.pairs;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (Array.isArray(data0)) {
                if (data0.length > 12) {
                  validate148.errors = [
                    {
                      instancePath: instancePath + "/pairs",
                      schemaPath: "#/properties/pairs/maxItems",
                      keyword: "maxItems",
                      params: { limit: 12 },
                    },
                  ];
                  return false;
                } else {
                  if (data0.length < 0) {
                    validate148.errors = [
                      {
                        instancePath: instancePath + "/pairs",
                        schemaPath: "#/properties/pairs/minItems",
                        keyword: "minItems",
                        params: { limit: 0 },
                      },
                    ];
                    return false;
                  } else {
                    var valid1 = true;
                    const len0 = data0.length;
                    for (let i0 = 0; i0 < len0; i0++) {
                      const _errs4 = errors;
                      if (
                        !validate75(data0[i0], {
                          instancePath: instancePath + "/pairs/" + i0,
                          parentData: data0,
                          parentDataProperty: i0,
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
                        errors = vErrors.length;
                      }
                      var valid1 = _errs4 === errors;
                      if (!valid1) {
                        break;
                      }
                    }
                  }
                }
              } else {
                validate148.errors = [
                  {
                    instancePath: instancePath + "/pairs",
                    schemaPath: "#/properties/pairs/type",
                    keyword: "type",
                    params: { type: "array" },
                  },
                ];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.suppressedDefault !== undefined) {
              let data2 = data.suppressedDefault;
              const _errs5 = errors;
              const _errs6 = errors;
              let valid2 = false;
              const _errs7 = errors;
              if (
                !validate141(data2, {
                  instancePath: instancePath + "/suppressedDefault",
                  parentData: data,
                  parentDataProperty: "suppressedDefault",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate141.errors : vErrors.concat(validate141.errors);
                errors = vErrors.length;
              }
              var _valid0 = _errs7 === errors;
              valid2 = valid2 || _valid0;
              const _errs8 = errors;
              if (data2 !== null) {
                const err0 = {
                  instancePath: instancePath + "/suppressedDefault",
                  schemaPath: "#/properties/suppressedDefault/anyOf/1/type",
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
              var _valid0 = _errs8 === errors;
              valid2 = valid2 || _valid0;
              if (!valid2) {
                const err1 = {
                  instancePath: instancePath + "/suppressedDefault",
                  schemaPath: "#/properties/suppressedDefault/anyOf",
                  keyword: "anyOf",
                  params: {},
                };
                if (vErrors === null) {
                  vErrors = [err1];
                } else {
                  vErrors.push(err1);
                }
                errors++;
                validate148.errors = vErrors;
                return false;
              } else {
                errors = _errs6;
                if (vErrors !== null) {
                  if (_errs6) {
                    vErrors.length = _errs6;
                  } else {
                    vErrors = null;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate148.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate148.errors = vErrors;
  return errors === 0;
}
validate148.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate147(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate147.evaluated;
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
        (data.contractVersion === undefined && (missing0 = "contractVersion")) ||
        (data.profile === undefined && (missing0 = "profile")) ||
        (data.preferences === undefined && (missing0 = "preferences")) ||
        (data.version === undefined && (missing0 = "version"))
      ) {
        validate147.errors = [
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
            key0 === "contractVersion" ||
            key0 === "profile" ||
            key0 === "preferences" ||
            key0 === "version"
          )) {
            validate147.errors = [
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
          if (data.contractVersion !== undefined) {
            const _errs2 = errors;
            if ("folioview.valuation.v1" !== data.contractVersion) {
              validate147.errors = [
                {
                  instancePath: instancePath + "/contractVersion",
                  schemaPath: "#/properties/contractVersion/const",
                  keyword: "const",
                  params: { allowedValue: "folioview.valuation.v1" },
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
              if ("folioview.fx-preferences.v1" !== data.profile) {
                validate147.errors = [
                  {
                    instancePath: instancePath + "/profile",
                    schemaPath: "#/properties/profile/const",
                    keyword: "const",
                    params: { allowedValue: "folioview.fx-preferences.v1" },
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.preferences !== undefined) {
                let data2 = data.preferences;
                const _errs4 = errors;
                const _errs5 = errors;
                let valid1 = false;
                const _errs6 = errors;
                if (
                  !validate148(data2, {
                    instancePath: instancePath + "/preferences",
                    parentData: data,
                    parentDataProperty: "preferences",
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate148.errors : vErrors.concat(validate148.errors);
                  errors = vErrors.length;
                }
                var _valid0 = _errs6 === errors;
                valid1 = valid1 || _valid0;
                const _errs7 = errors;
                if (data2 !== null) {
                  const err0 = {
                    instancePath: instancePath + "/preferences",
                    schemaPath: "#/properties/preferences/anyOf/1/type",
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
                    instancePath: instancePath + "/preferences",
                    schemaPath: "#/properties/preferences/anyOf",
                    keyword: "anyOf",
                    params: {},
                  };
                  if (vErrors === null) {
                    vErrors = [err1];
                  } else {
                    vErrors.push(err1);
                  }
                  errors++;
                  validate147.errors = vErrors;
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
                if (data.version !== undefined) {
                  const _errs9 = errors;
                  if (
                    !validate122(data.version, {
                      instancePath: instancePath + "/version",
                      parentData: data,
                      parentDataProperty: "version",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate147.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate147.errors = vErrors;
  return errors === 0;
}
validate147.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate146(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate146.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate147(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate147.errors : vErrors.concat(validate147.errors);
    errors = vErrors.length;
  }
  validate146.errors = vErrors;
  return errors === 0;
}
validate146.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
exports.FxPreferencesUpdate = validate154;
const schema62 = {
  $ref: "https://folioview.invalid/contracts/valuation-v1#/$defs/FxPreferencesUpdate",
};
const schema63 = {
  type: "object",
  properties: {
    preferences: { $ref: "#/$defs/FxPreferences" },
    expectedVersion: { $ref: "#/$defs/Revision" },
  },
  required: ["preferences", "expectedVersion"],
  additionalProperties: false,
};
function validate155(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate155.evaluated;
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
        (data.preferences === undefined && (missing0 = "preferences")) ||
        (data.expectedVersion === undefined && (missing0 = "expectedVersion"))
      ) {
        validate155.errors = [
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
          if (!(key0 === "preferences" || key0 === "expectedVersion")) {
            validate155.errors = [
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
          if (data.preferences !== undefined) {
            const _errs2 = errors;
            if (
              !validate148(data.preferences, {
                instancePath: instancePath + "/preferences",
                parentData: data,
                parentDataProperty: "preferences",
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors = vErrors === null ? validate148.errors : vErrors.concat(validate148.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.expectedVersion !== undefined) {
              const _errs3 = errors;
              if (
                !validate122(data.expectedVersion, {
                  instancePath: instancePath + "/expectedVersion",
                  parentData: data,
                  parentDataProperty: "expectedVersion",
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
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
      validate155.errors = [
        { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" } },
      ];
      return false;
    }
  }
  validate155.errors = vErrors;
  return errors === 0;
}
validate155.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate154(
  data,
  { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate154.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate155(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate155.errors : vErrors.concat(validate155.errors);
    errors = vErrors.length;
  }
  validate154.errors = vErrors;
  return errors === 0;
}
validate154.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
