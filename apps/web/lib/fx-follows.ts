/** Presentation-only FX preferences. Never import the private crypto bundle here. */
import {
  effectivePortfolioCurrency,
  portfolioCurrency,
  type CurrencyPreferencesSnapshot,
  type PortfolioCurrency as Currency,
} from "./currency-preferences";
export type Pair = Readonly<{ base: Currency; quote: Currency }>;
export type DefaultContext = Readonly<{ currency: Currency; currencyGeneration: number }>;
export type FxPreferences = Readonly<{
  pairs: readonly Pair[];
  suppressedDefault: DefaultContext | null;
}>;
export type FxSnapshot = Readonly<{
  contractVersion: "folioview.valuation.v1";
  profile: "folioview.fx-preferences.v1";
  preferences: FxPreferences | null;
  version: number;
}>;
export type FxIntent = { kind: "add" | "remove"; pair: Pair; context: DefaultContext | null };
export const FX_FOLLOWS_PATH = "/api/v1/fx-follows";
export const pairKey = (p: Pair) => `${p.base}/${p.quote}`;
export const exact = (v: unknown, keys: string[]): v is Record<string, any> =>
  Boolean(
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).sort().join("\0") === [...keys].sort().join("\0"),
  );
export function pair(value: unknown): Pair {
  if (!exact(value, ["base", "quote"])) throw Error("invalid_fx");
  const result = { base: portfolioCurrency(value.base), quote: portfolioCurrency(value.quote) };
  if (result.base === result.quote) throw Error("invalid_fx");
  return Object.freeze(result);
}
export function fxPreferences(value: unknown): FxPreferences {
  if (
    !exact(value, ["pairs", "suppressedDefault"]) ||
    !Array.isArray(value.pairs) ||
    value.pairs.length > 12
  )
    throw Error("invalid_fx");
  const pairs = value.pairs.map(pair);
  if (new Set(pairs.map(pairKey)).size !== pairs.length) throw Error("invalid_fx");
  let suppressedDefault: DefaultContext | null = null;
  if (value.suppressedDefault !== null) {
    const v = value.suppressedDefault;
    if (
      !exact(v, ["currency", "currencyGeneration"]) ||
      !Number.isSafeInteger(v.currencyGeneration) ||
      v.currencyGeneration < 0 ||
      portfolioCurrency(v.currency) === "USD"
    )
      throw Error("invalid_fx");
    suppressedDefault = Object.freeze({
      currency: v.currency as Currency,
      currencyGeneration: v.currencyGeneration,
    });
  }
  return Object.freeze({ pairs: Object.freeze(pairs), suppressedDefault });
}
export function fxSnapshot(value: unknown): FxSnapshot {
  if (
    !exact(value, ["contractVersion", "profile", "preferences", "version"]) ||
    value.contractVersion !== "folioview.valuation.v1" ||
    value.profile !== "folioview.fx-preferences.v1" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    (value.version === 0) !== (value.preferences === null)
  )
    throw Error("invalid_fx");
  return Object.freeze({
    contractVersion: value.contractVersion,
    profile: value.profile,
    version: value.version,
    preferences: value.preferences === null ? null : fxPreferences(value.preferences),
  });
}
export function defaultContext(
  snapshot: CurrencyPreferencesSnapshot | null,
): DefaultContext | null {
  return snapshot
    ? {
        currency: effectivePortfolioCurrency(snapshot),
        currencyGeneration: snapshot.currencyGeneration,
      }
    : null;
}
const sameContext = (a: DefaultContext | null, b: DefaultContext | null) =>
  a?.currency === b?.currency && a?.currencyGeneration === b?.currencyGeneration;
export function effectivePairs(
  snapshot: FxSnapshot,
  context: DefaultContext | null,
): Array<Pair & { origin: "manual" | "default" }> {
  const current = snapshot.preferences ?? { pairs: [], suppressedDefault: null },
    manual = current.pairs.map((p) => ({ ...p, origin: "manual" as const }));
  if (
    !context ||
    context.currency === "USD" ||
    sameContext(current.suppressedDefault, context) ||
    manual.some((p) => p.base === "USD" && p.quote === context.currency)
  )
    return manual;
  return [{ base: "USD", quote: context.currency, origin: "default" }, ...manual];
}
export function applyFxIntent(snapshot: FxSnapshot, intent: FxIntent): FxPreferences {
  const current = snapshot.preferences ?? { pairs: [], suppressedDefault: null },
    key = pairKey(pair(intent.pair));
  let pairs = [...current.pairs],
    suppressedDefault = current.suppressedDefault;
  if (intent.kind === "add") {
    if (!pairs.some((p) => pairKey(p) === key)) pairs.push(intent.pair);
  } else {
    pairs = pairs.filter((p) => pairKey(p) !== key);
    if (
      intent.context &&
      intent.context.currency !== "USD" &&
      intent.pair.base === "USD" &&
      intent.pair.quote === intent.context.currency &&
      (!suppressedDefault ||
        suppressedDefault.currencyGeneration <= intent.context.currencyGeneration)
    )
      suppressedDefault = intent.context;
  }
  return fxPreferences({ pairs, suppressedDefault });
}
export const samePreferences = (a: FxPreferences | null, b: FxPreferences) =>
  JSON.stringify(a) === JSON.stringify(b);
export type { Currency };
