import { portfolioCurrency, type PortfolioCurrency as Currency } from "./currency-preferences";
import { exact, pairKey, type Pair } from "./fx-follows";
import { readPublicValuation } from "./public-market-json";
export type FxRate = Pair & {
  rate: string | null;
  status: "available" | "stale" | "missing" | "unsupported";
  sourceDate: string | null;
  sourceAsOf: string | null;
  fetchedAt: string;
};
export type FxRates = { snapshotId: string; fetchedAt: string; items: FxRate[] };
function invalid(): never {
  throw Error("invalid_rates");
}
function timestamp(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(v))
    invalid();
  const n = Date.parse(v as string);
  if (
    !Number.isFinite(n) ||
    new Date(n).toISOString().slice(0, 19) !== (v as string).slice(0, 19) ||
    (v as string).startsWith("0000")
  )
    invalid();
  return (
    (v as string).slice(0, 19) + "." + (v as string).slice(19, -1).replace(/^\./, "").padEnd(6, "0")
  );
}
function date(v: unknown) {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\d$/.test(v)) invalid();
  timestamp(v + "T00:00:00Z");
  return v as string;
}
function positive(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^(0|[1-9][0-9]{0,19})(\.[0-9]{1,18})?$/.test(v) ||
    !/[1-9]/.test(v)
  )
    invalid();
  const [whole, tail = ""] = (v as string).split(".");
  return { n: BigInt(whole + tail), s: tail.length };
}
function cross(a: string, b: string) {
  const x = positive(a),
    y = positive(b),
    numerator = x.n * BigInt(10) ** BigInt(y.s + 18),
    denominator = y.n * BigInt(10) ** BigInt(x.s);
  let n = numerator / denominator;
  const r = numerator % denominator;
  if (r * BigInt(2) > denominator || (r * BigInt(2) === denominator && n % BigInt(2) !== BigInt(0)))
    n++;
  const text = String(n).padStart(19, "0");
  return (text.slice(0, -18) + "." + text.slice(-18)).replace(/0+$/, "").replace(/\.$/, "");
}
export function readFxRates(value: unknown, requested: readonly Pair[]): FxRates {
  if (
    !exact(value, ["contractVersion", "profile", "snapshotId", "fetchedAt", "items"]) ||
    value.contractVersion !== "folioview.valuation.v1" ||
    value.profile !== "folioview.fx-batch.v1" ||
    typeof value.snapshotId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.snapshotId) ||
    !Array.isArray(value.items) ||
    value.items.length > 20
  )
    invalid();
  const at = timestamp(value.fetchedAt),
    dates = new Set<string>();
  const items: FxRate[] = value.items.map((v: unknown) => {
    if (
      !exact(v, [
        "base",
        "quote",
        "rate",
        "source",
        "status",
        "sourceAsOf",
        "sourceDate",
        "fetchedAt",
        "reason",
        "route",
      ])
    )
      invalid();
    const base = portfolioCurrency(v.base),
      quote = portfolioCurrency(v.quote),
      fetched = timestamp(v.fetchedAt);
    if (
      fetched > at ||
      (v.sourceAsOf !== null && timestamp(v.sourceAsOf) > fetched) ||
      (v.sourceDate !== null && date(v.sourceDate) > v.fetchedAt.slice(0, 10))
    )
      invalid();
    if (!["available", "stale", "missing", "unsupported"].includes(v.status)) invalid();
    if (["available", "stale"].includes(v.status)) {
      positive(v.rate);
      if (
        base === quote ||
        v.source !== "bank_of_canada" ||
        v.reason !== null ||
        v.sourceDate === null ||
        !exact(v.route, ["kind", "via", "legs"]) ||
        !Array.isArray(v.route.legs) ||
        v.route.legs.length > 2
      )
        invalid();
      dates.add(v.sourceDate);
      const legs = v.route.legs.map((l: unknown) => {
        if (
          !exact(l, ["base", "quote", "rate", "sourceDate"]) ||
          portfolioCurrency(l.quote) !== "CAD" ||
          portfolioCurrency(l.base) === "CAD" ||
          l.sourceDate !== v.sourceDate
        )
          invalid();
        positive(l.rate);
        return l;
      });
      let expected;
      if (quote === "CAD") {
        if (
          v.route.kind !== "direct" ||
          v.route.via !== null ||
          legs.length !== 1 ||
          legs[0].base !== base
        )
          invalid();
        expected = cross(legs[0].rate, "1");
      } else if (base === "CAD") {
        if (
          v.route.kind !== "inverse" ||
          v.route.via !== null ||
          legs.length !== 1 ||
          legs[0].base !== quote
        )
          invalid();
        expected = cross("1", legs[0].rate);
      } else {
        if (
          v.route.kind !== "cross" ||
          v.route.via !== "CAD" ||
          legs.length !== 2 ||
          legs[0].base !== base ||
          legs[1].base !== quote
        )
          invalid();
        expected = cross(legs[0].rate, legs[1].rate);
      }
      if (v.rate !== expected) invalid();
    } else if (
      v.rate !== null ||
      v.route !== null ||
      !["none", "bank_of_canada"].includes(v.source) ||
      typeof v.reason !== "string" ||
      !/^[a-z_]{1,80}$/.test(v.reason)
    )
      invalid();
    return {
      base,
      quote,
      rate: v.rate,
      status: v.status,
      sourceDate: v.sourceDate,
      sourceAsOf: v.sourceAsOf,
      fetchedAt: v.fetchedAt,
    };
  });
  const keys = items.map(pairKey);
  if (
    new Set(keys).size !== keys.length ||
    [...keys].sort().join("\0") !== requested.map(pairKey).sort().join("\0") ||
    dates.size > 1
  )
    invalid();
  return { snapshotId: value.snapshotId, fetchedAt: value.fetchedAt, items };
}
export async function fetchFxRates(
  pairs: readonly Pair[],
  cached: boolean,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const origin = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const response = await request(`${origin}/api/valuation/fx${cached ? "?cached=true" : ""}`, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairs: pairs.map(({ base, quote }) => ({ base, quote })) }),
  });
  return readPublicValuation(response, (v) => readFxRates(v, pairs), signal);
}
export function rateLabel(value: string | null) {
  if (value === null) return "—";
  const d = positive(value),
    denominator = BigInt(10) ** BigInt(d.s),
    numerator = d.n * BigInt(1_000_000);
  let n = numerator / denominator;
  const r = numerator % denominator;
  if (r * BigInt(2) > denominator || (r * BigInt(2) === denominator && n % BigInt(2) !== BigInt(0)))
    n++;
  if (n === BigInt(0)) return "<0.000001";
  const text = String(n).padStart(7, "0");
  return (text.slice(0, -6) + "." + text.slice(-6)).replace(/0+$/, "").replace(/\.$/, "");
}
export type { Currency };
