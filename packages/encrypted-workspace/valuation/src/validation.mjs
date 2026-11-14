/** Shared bounded shape/date validation; no policy or runtime state. */
import { canonical, deny, utc } from "../../dist/core.mjs";
export const need = (ok) => {
  if (!ok) deny("invalid_valuation");
};
export const unique = (values) => need(new Set(values).size === values.length);
export const time = (value) => {
  utc(value);
  need(value.slice(0, 4) !== "0000");
  return value.slice(0, 19) + "." + (value.slice(19, -1).replace(/^\./, "") || "").padEnd(6, "0");
};
export function date(value) {
  need(/^\d{4}-\d{2}-\d{2}$/.test(value));
  time(value + "T00:00:00Z");
}
function dates(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && ["fetchedAt", "sourceAsOf", "recordedAt", "lastEditedAt"].includes(key))
      time(entry);
    else if (entry !== null && ["sourceDate", "reportDate"].includes(key)) date(entry);
    else if (typeof entry === "object") dates(entry);
  }
}
export function validateShape(validator, value, limit = 524288) {
  if (canonical(value).length > limit) deny("payload_too_large");
  need(validator(value));
  dates(value);
  return structuredClone(value);
}
