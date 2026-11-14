import type { PublicJson } from "../../dist/core.mjs";
type ContentContext = PublicJson;
type PublicJWK = PublicJson;
export type Currency =
  "USD" | "CAD" | "CNY" | "EUR" | "GBP" | "JPY" | "HKD" | "AUD" | "CHF" | "SGD" | "NZD" | "TWD";
export interface Instrument {
  symbol: string;
  market: string;
  currency: Currency;
}
export interface FactInstrument {
  symbol: string | null;
  market: string;
  currency: Currency;
}
export interface Money {
  currency: Currency;
  amount: string;
}
export interface Provenance {
  origin: "import" | "manual" | "derived" | "legacy" | "unknown";
  recordedAt: string | null;
  sourceDate: string | null;
  lastEditedAt: string | null;
}
export interface Position {
  assetId: string;
  brokerAssetId: string | null;
  instrument: FactInstrument;
  name: string | null;
  assetType: "stock" | "etf" | "unsupported";
  quantity: string;
  unitCost: Money | null;
  bookCost: Money | null;
  bookCostCad: Money | null;
  reportedValues: {
    unitPrice: Money | null;
    marketValue: Money | null;
    unrealizedReturn: Money | null;
  } | null;
  provenance: Record<
    "instrument" | "quantity" | "unitCost" | "bookCost" | "bookCostCad",
    Provenance
  >;
}
export interface Account {
  accountId: string;
  displayName: string;
  balances: { currency: Currency; cashBalance: string | null; buyingPower: string | null }[];
  positions: Position[];
}
export interface HoldingsFacts {
  state: "ready" | "empty";
  coverage: { state: "complete" | "partial" | "unknown"; issues: string[] };
  sourceAsOf: string | null;
  fetchedAt: string;
  freshness: "fresh" | "stale" | "unknown";
  data: {
    kind: "holdings";
    profile: "folioview.holdings-facts.v2";
    snapshotId: string;
    editKind: "import" | "manual" | "edit";
    reportDate: string | null;
    importSnapshot: { snapshotId: string; sourceRevision: number } | null;
    previousSnapshot: { snapshotId: string; sourceRevision: number } | null;
    accounts: Account[];
    excludedAssets: { brokerAssetId: string; reason: string }[];
  };
}
export interface SourceTime {
  status: "available" | "stale" | "missing" | "unsupported";
  sourceAsOf: string | null;
  sourceDate: string | null;
  fetchedAt: string;
  reason: string | null;
}
export interface QuoteItem extends SourceTime {
  instrument: Instrument;
  price: string | null;
  source: "yahoo_finance" | "none";
}
export interface Pair {
  base: Currency;
  quote: Currency;
}
export interface FxItem extends SourceTime, Pair {
  rate: string | null;
  source: "bank_of_canada" | "identity" | "none";
  route: {
    kind: "identity" | "direct" | "inverse" | "cross";
    via: "CAD" | null;
    legs: (Pair & { rate: string; sourceDate: string })[];
  } | null;
}
export interface Batch<T> {
  contractVersion: "folioview.valuation.v1";
  profile: string;
  snapshotId: string;
  fetchedAt: string;
  items: T[];
}
export interface CurrencySnapshot {
  contractVersion: "folioview.valuation.v1";
  profile: "folioview.currency-preferences.v2";
  preferences: { defaultPortfolioCurrency: Currency } | null;
  version: number;
  currencyGeneration: number;
}
export interface FxPreferences {
  pairs: Pair[];
  suppressedDefault: { currency: Currency; currencyGeneration: number } | null;
}
export interface FxPreferencesSnapshot {
  contractVersion: "folioview.valuation.v1";
  profile: "folioview.fx-preferences.v1";
  preferences: FxPreferences | null;
  version: number;
}
export interface Valuation {
  currency: Currency;
  subtotal: string | null;
  complete: boolean;
  valuedCount: number;
  positionCount: number;
  stale: boolean;
  quoteSnapshotId: string;
  fxSnapshotId: string;
  rows: {
    accountId: string;
    assetId: string;
    status: "unresolved" | "missing_quote" | "missing_fx" | "valued";
    value: string | null;
    weightPercent: string | null;
    stale: boolean;
  }[];
}
export const VALUATION_CONTRACT: "folioview.valuation.v1";
export const HOLDINGS_FACTS_PROFILE: "folioview.holdings-facts.v2";
export const DEFAULT_PREFERENCES: Readonly<{
  defaultPortfolioCurrency: "USD";
  language: "en";
  theme: "light";
  defaultChartRange: "1m";
}>;
export function validateValuation(name: string, value: unknown): unknown;
export function quoteRequest(value: unknown): { instruments: Instrument[]; cached?: boolean };
export function fxRequest(value: unknown): { pairs: Pair[]; cached?: boolean };
export function holdingsFacts(
  value: unknown,
  binding?: { snapshotId?: string | null; revision?: number | null },
): HoldingsFacts;
export function holdingsPrivate(value: unknown, context: ContentContext): HoldingsFacts;
export function openHoldings(
  value: unknown,
  privateKey: CryptoKey,
  expectedContext: ContentContext,
): Promise<HoldingsFacts | Record<string, unknown>>;
export function sealHoldingsFacts(
  payload: HoldingsFacts,
  context: ContentContext,
  publicKeys: Record<string, PublicJWK>,
  rootPrivateKey: CryptoKey,
): Promise<Record<string, unknown>>;
export function crossRate(cadPerBase: string, cadPerQuote: string): string;
export function quoteBatch(value: unknown, requested?: Instrument[] | null): Batch<QuoteItem>;
export function fxBatch(value: unknown, requested?: Pair[] | null): Batch<FxItem>;
export function currencySnapshot(value: unknown): CurrencySnapshot;
export function resolvePreferences(
  ui: unknown,
  currency: unknown,
): {
  defaultPortfolioCurrency: Currency;
  language: "en" | "zh";
  theme: "light" | "dark" | "system";
  defaultChartRange: string;
};
export function fxPreferences(value: unknown): FxPreferences;
export function fxPreferencesSnapshot(value: unknown): FxPreferencesSnapshot;
export function effectiveFxPairs(
  preferences: unknown,
  currency: unknown,
): (Pair & { origin: "manual" | "default" })[];
export function displayCurrencies(holdings: HoldingsFacts, defaultCurrency: Currency): Currency[];
export function valueHoldings(
  holdings: HoldingsFacts,
  quotes: Batch<QuoteItem>,
  fx: Batch<FxItem>,
  displayCurrency: Currency,
): Valuation;
export function roundDisplayAmount(value: string, currency: Currency): string;
