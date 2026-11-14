/** Small presentation contract reader; do not load private crypto into the app shell. */
export const PORTFOLIO_CURRENCIES = [
  "USD",
  "CAD",
  "CNY",
  "EUR",
  "GBP",
  "JPY",
  "HKD",
  "AUD",
  "CHF",
  "NZD",
  "SGD",
  "TWD",
] as const;
export type PortfolioCurrency = (typeof PORTFOLIO_CURRENCIES)[number];
export const CURRENCY_PREFERENCES_PATH = "/api/v2/preferences/currency";
export type CurrencyPreferencesSnapshot = Readonly<{
  contractVersion: "folioview.valuation.v1";
  profile: "folioview.currency-preferences.v2";
  preferences: Readonly<{ defaultPortfolioCurrency: PortfolioCurrency }> | null;
  version: number;
  currencyGeneration: number;
}>;
function exact(value: unknown, fields: string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...fields].sort().join("\0"),
  );
}
export function portfolioCurrency(value: unknown): PortfolioCurrency {
  if (typeof value !== "string" || !PORTFOLIO_CURRENCIES.includes(value as PortfolioCurrency))
    throw new Error("Invalid currency preferences");
  return value as PortfolioCurrency;
}
export function currencyUpdate(value: unknown) {
  if (
    !exact(value, ["expectedVersion", "defaultPortfolioCurrency"]) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    (value.expectedVersion as number) < 0
  )
    throw new Error("Invalid currency preferences");
  return {
    expectedVersion: value.expectedVersion as number,
    defaultPortfolioCurrency: portfolioCurrency(value.defaultPortfolioCurrency),
  };
}
export function readCurrencyPreferences(value: unknown): CurrencyPreferencesSnapshot {
  if (
    !exact(value, ["contractVersion", "profile", "preferences", "version", "currencyGeneration"]) ||
    value.contractVersion !== "folioview.valuation.v1" ||
    value.profile !== "folioview.currency-preferences.v2" ||
    !Number.isSafeInteger(value.version) ||
    !Number.isSafeInteger(value.currencyGeneration) ||
    (value.version as number) < 0 ||
    (value.currencyGeneration as number) < 0 ||
    (value.currencyGeneration as number) > (value.version as number) ||
    (value.preferences === null) !== (value.version === 0) ||
    (value.preferences === null) !== (value.currencyGeneration === 0)
  )
    throw new Error("Invalid currency preferences");
  if (value.preferences !== null && !exact(value.preferences, ["defaultPortfolioCurrency"]))
    throw new Error("Invalid currency preferences");
  return Object.freeze({
    contractVersion: "folioview.valuation.v1",
    profile: "folioview.currency-preferences.v2",
    preferences:
      value.preferences === null
        ? null
        : Object.freeze({
            defaultPortfolioCurrency: portfolioCurrency(
              (value.preferences as Record<string, unknown>).defaultPortfolioCurrency,
            ),
          }),
    version: value.version as number,
    currencyGeneration: value.currencyGeneration as number,
  });
}
export const effectivePortfolioCurrency = (snapshot: CurrencyPreferencesSnapshot) =>
  snapshot.preferences?.defaultPortfolioCurrency ?? "USD";

export async function readCurrencyResponse(response: Response, signal: AbortSignal) {
  if (
    !response.body ||
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json"
  ) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Invalid currency response");
  }
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) {
    void response.body.cancel().catch(() => {});
    throw new Error("Invalid currency response");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("Currency request cancelled");
      const next = await reader.read();
      if (signal.aborted) throw new Error("Currency request cancelled");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) {
        cancel();
        throw new Error("Invalid currency response");
      }
      chunks.push(next.value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return readCurrencyPreferences(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)),
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}
