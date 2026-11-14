/** Bounded base-ten arithmetic; financial inputs never pass through Number. */
import { deny } from "../../dist/core.mjs";

export function decimal(value, signed = false) {
  if (
    typeof value !== "string" ||
    !(
      signed ? /^-?(0|[1-9][0-9]{0,79})(\.[0-9]{1,60})?$/ : /^(0|[1-9][0-9]{0,19})(\.[0-9]{1,18})?$/
    ).test(value)
  )
    deny("invalid_valuation");
  const [whole, fraction = ""] = value.split(".");
  return { n: BigInt(whole + fraction), s: fraction.length };
}
const power = (s) => 10n ** BigInt(s);
export function add(a, b) {
  const s = Math.max(a.s, b.s);
  return { n: a.n * power(s - a.s) + b.n * power(s - b.s), s };
}
export function multiply(a, b) {
  return { n: a.n * b.n, s: a.s + b.s };
}
export function plain({ n, s }, fixed = false) {
  const negative = n < 0n;
  let value = (negative ? -n : n).toString().padStart(s + 1, "0");
  if (s) value = value.slice(0, -s) + "." + value.slice(-s);
  if (!fixed && s) value = value.replace(/0+$/, "").replace(/\.$/, "");
  return (negative && n !== 0n ? "-" : "") + value;
}
/** Half-even rounding of a rational into exactly scale decimal places. */
export function divide(a, b, scale) {
  if (b.n <= 0n) deny("invalid_valuation");
  let numerator = a.n * power(b.s + scale),
    denominator = b.n * power(a.s);
  const negative = numerator < 0n;
  if (negative) numerator = -numerator;
  let n = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && n % 2n !== 0n)) n++;
  return { n: negative ? -n : n, s: scale };
}
export function crossRate(a, b) {
  const left = decimal(a),
    right = decimal(b);
  if (left.n <= 0n || right.n <= 0n) deny("invalid_valuation");
  const value = plain(divide(left, right, 18));
  if (decimal(value).n <= 0n) deny("invalid_valuation");
  return value;
}
