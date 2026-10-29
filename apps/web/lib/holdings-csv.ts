/** Browser-only holdings import. Returned objects omit the raw file/account-number column. */

export const HOLDINGS_CSV_MAX_BYTES = 4 * 1024 * 1024;
export const HOLDINGS_CSV_MAX_ROWS = 10_000;
export const HOLDINGS_RESOURCE_MAX_BYTES = 196_608 - 4_096;

export const WEALTHSIMPLE_HOLDINGS_HEADERS = [
  "Account Name",
  "Account Type",
  "Account Classification",
  "Account Number",
  "Symbol",
  "Exchange",
  "MIC",
  "Name",
  "Security Type",
  "Quantity",
  "Position Direction",
  "Market Price",
  "Market Price Currency",
  "Book Value (CAD)",
  "Book Value Currency (CAD)",
  "Book Value (Market)",
  "Book Value Currency (Market)",
  "Market Value",
  "Market Value Currency",
  "Market Unrealized Returns",
  "Market Unrealized Returns Currency",
] as const;

export const HOLDINGS_CSV_ADAPTERS = [
  { brokerId: "wealthsimple", reportType: "holdings_snapshot", enabled: true },
  { brokerId: "robinhood", reportType: "activity_ledger", enabled: false },
  { brokerId: "ibkr", reportType: "holdings_snapshot", enabled: false },
] as const;

export type HoldingCurrency = "CAD" | "USD";
export type HoldingMoney = { currency: HoldingCurrency; amount: string };
export type HoldingPosition = {
  assetId: string;
  brokerAssetId: string;
  symbol: string | null;
  exchange: string | null;
  name: string;
  assetType: "stock" | "etf" | "unsupported";
  quantity: string;
  currency: HoldingCurrency;
  marketValue: HoldingMoney | null;
};
export type HoldingAccount = {
  accountId: string;
  displayName: string;
  balances: {
    currency: HoldingCurrency;
    cashBalance: string | null;
    buyingPower: null;
  }[];
  positions: HoldingPosition[];
};
export type HoldingsResourceContent = {
  state: "ready" | "empty";
  coverage: { state: "partial" | "unknown"; issues: string[] };
  sourceAsOf: null;
  fetchedAt: string;
  freshness: "unknown";
  data: {
    kind: "holdings";
    snapshotId: string;
    accounts: HoldingAccount[];
    excludedAssets: { brokerAssetId: string; reason: string }[];
  };
};
export type HoldingsCsvWarning = { code: string; row: number | null; count: number };
export type HoldingsCsvPreview = {
  brokerId: "wealthsimple";
  reportType: "holdings_snapshot";
  adapterId: "wealthsimple-holdings-21-v1";
  reportDate: string | null;
  resourceContent: HoldingsResourceContent;
  selectedAccountIds: string[];
  accounts: {
    accountId: string;
    displayName: string;
    positionCount: number;
    excludedCount: number;
    totals: Partial<Record<HoldingCurrency, string>>;
  }[];
  warnings: HoldingsCsvWarning[];
  stats: {
    inputRows: number;
    positions: number;
    excluded: number;
    duplicates: number;
    accounts: number;
    totals: Partial<Record<HoldingCurrency, string>>;
  };
};

export class HoldingsCsvError extends Error {
  constructor(
    public readonly code: string,
    public readonly row: number | null = null,
  ) {
    // Error diagnostics deliberately contain no file content, cell, ticker or account number.
    super(code);
    this.name = "HoldingsCsvError";
  }
}

type CsvRecord = { fields: string[]; row: number };
type SourceAccount = {
  account: HoldingAccount;
  exclusions: { brokerAssetId: string; reason: string }[];
  duplicates: number;
  cashCurrencies: Set<HoldingCurrency>;
  seenPositions: Map<string, string>;
  seenCash: Map<HoldingCurrency, string>;
};
type PreviewSource = {
  accounts: SourceAccount[];
  warnings: HoldingsCsvWarning[];
  inputRows: number;
  reportDate: string | null;
  snapshotId: string;
  importedAt: string;
};
// Selection retains private local source data without serializing unselected holdings.
const previewSources = new WeakMap<HoldingsCsvPreview, PreviewSource>();
const encoder = new TextEncoder();
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const unknownNumber = /^(?:|n\/a|na|none|null|--|—)$/i;
const scale = BigInt(1_000_000_000_000);

function fail(code: string, row: number | null = null): never {
  throw new HoldingsCsvError(code, row);
}

function parseRecords(text: string): CsvRecord[] {
  if (typeof text !== "string" || encoder.encode(text).length > HOLDINGS_CSV_MAX_BYTES) {
    fail("file_too_large");
  }
  if (text.includes("\0")) fail("invalid_csv");
  const value = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let line = 1;
  let recordLine = 1;
  const finishField = () => {
    if (encoder.encode(field).length > 2_048 || fields.length >= 64) {
      fail("field_too_large", recordLine);
    }
    fields.push(field);
    field = "";
    closed = false;
  };
  const finishRecord = () => {
    finishField();
    if (!fields.every((cell) => cell.trim() === "")) {
      if (records.length > HOLDINGS_CSV_MAX_ROWS + 1) fail("too_many_rows", recordLine);
      records.push({ fields, row: recordLine });
    }
    fields = [];
  };
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && value[index + 1] === "\n") index += 1;
        field += "\n";
        line += 1;
      } else {
        field += char;
      }
      if (field.length > 2_048) fail("field_too_large", recordLine);
      continue;
    }
    if (closed && char !== "," && char !== "\r" && char !== "\n") {
      if (char === " " || char === "\t") continue;
      fail("invalid_csv", recordLine);
    }
    if (char === '"') {
      if (field !== "" || closed) fail("invalid_csv", recordLine);
      quoted = true;
    } else if (char === ",") {
      finishField();
    } else if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && value[index + 1] === "\n") index += 1;
      line += 1;
      recordLine = line;
    } else {
      field += char;
      if (field.length > 2_048) fail("field_too_large", recordLine);
    }
  }
  if (quoted) fail("invalid_csv", recordLine);
  if (field !== "" || fields.length || closed) finishRecord();
  if (!records.length) fail("empty_file");
  return records;
}

function decimal(value: string, row: number, required = true): string | null {
  const raw = value.trim();
  if (unknownNumber.test(raw)) {
    if (required) fail("invalid_number", row);
    return null;
  }
  if (raw.length > 80 || !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) {
    fail("invalid_number", row);
  }
  const cleaned = raw.replaceAll(",", "");
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const fraction = fractionRaw.replace(/0+$/, "");
  if (whole.length > 20 || fraction.length > 12) fail("number_out_of_range", row);
  const zero = whole === "0" && !fraction;
  return `${negative && !zero ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function scaled(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0"));
  return negative ? -result : result;
}

function displayScaled(value: bigint): string {
  const negative = value < BigInt(0);
  const unsigned = negative ? -value : value;
  const whole = String(unsigned / scale);
  if (whole.length > 20) fail("total_out_of_range");
  const fraction = String(unsigned % scale)
    .padStart(12, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function currency(value: string): HoldingCurrency | null {
  return value === "CAD" || value === "USD" ? value : null;
}

function normalizedCategory(value: string): string {
  return value.trim().toUpperCase().replace(/[ -]+/g, "_");
}

async function digest(namespace: string, value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("crypto_unavailable");
  const bytes = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${namespace}\0${value}`),
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function boundedText(value: string, max: number, row: number, required = true): string | null {
  const text = value.trim();
  if (!text) {
    if (required) fail("invalid_field", row);
    return null;
  }
  if (text.length > max) fail("invalid_field", row);
  return text;
}

function warning(warnings: HoldingsCsvWarning[], code: string, row: number | null = null) {
  const existing = warnings.find((item) => item.code === code);
  if (existing) existing.count += 1;
  else warnings.push({ code, row, count: 1 });
}

function footerDate(record: CsvRecord): string | null {
  if (record.fields.length !== 1) return null;
  const text = record.fields[0].trim();
  if (!/^(?:data\s+)?as\s+of\s*:?[ A-Za-z,0-9:./+\-]+$/i.test(text)) return null;
  const match = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const parsed = match ? new Date(`${match[1]}T00:00:00Z`) : null;
  if (
    !match ||
    !parsed ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== match[1]
  ) {
    fail("invalid_report_date", record.row);
  }
  return match[1];
}

function accountTotals(account: HoldingAccount): Partial<Record<HoldingCurrency, string>> {
  const totals: Partial<Record<HoldingCurrency, bigint>> = {};
  for (const position of account.positions) {
    if (position.marketValue) {
      const { currency: key, amount } = position.marketValue;
      totals[key] = (totals[key] ?? BigInt(0)) + scaled(amount);
    }
  }
  for (const balance of account.balances) {
    if (balance.cashBalance !== null) {
      totals[balance.currency] =
        (totals[balance.currency] ?? BigInt(0)) + scaled(balance.cashBalance);
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([key, amount]) => [key, displayScaled(amount)]),
  );
}

function makePreview(source: PreviewSource, ids: readonly string[]): HoldingsCsvPreview {
  if (!Array.isArray(ids) || ids.length < 1 || new Set(ids).size !== ids.length) {
    fail("invalid_account_selection");
  }
  const selected = new Set(ids);
  if (source.accounts.some((entry) => selected.has(entry.account.accountId))) {
    for (const id of selected) {
      if (!source.accounts.some((entry) => entry.account.accountId === id)) {
        fail("invalid_account_selection");
      }
    }
  } else fail("invalid_account_selection");
  const entries = source.accounts.filter((entry) => selected.has(entry.account.accountId));
  const accounts = structuredClone(entries.map((entry) => entry.account));
  const excludedAssets = entries.flatMap((entry) => entry.exclusions);
  if (excludedAssets.length > 100) fail("too_many_exclusions");
  const warnings = source.warnings.map((entry) => ({ ...entry }));
  const omitted = entries.length !== source.accounts.length;
  if (omitted) warning(warnings, "accounts_not_selected");
  const totals: Partial<Record<HoldingCurrency, bigint>> = {};
  const summaries = source.accounts.map((entry) => ({
    accountId: entry.account.accountId,
    displayName: entry.account.displayName,
    positionCount: entry.account.positions.length,
    excludedCount: entry.exclusions.length,
    totals: accountTotals(entry.account),
  }));
  for (const account of accounts) {
    for (const [key, amount] of Object.entries(accountTotals(account))) {
      const code = key as HoldingCurrency;
      totals[code] = (totals[code] ?? BigInt(0)) + scaled(amount);
    }
  }
  const issues = Array.from(new Set(warnings.map((entry) => entry.code))).slice(0, 20);
  const positions = accounts.reduce((sum, account) => sum + account.positions.length, 0);
  const duplicates = entries.reduce((sum, entry) => sum + entry.duplicates, 0);
  const resourceContent: HoldingsResourceContent = {
    state:
      positions || accounts.some((account) => account.balances.some((b) => b.cashBalance !== null))
        ? "ready"
        : "empty",
    coverage: {
      state: excludedAssets.length || omitted || duplicates ? "partial" : "unknown",
      issues,
    },
    sourceAsOf: null,
    fetchedAt: source.importedAt,
    freshness: "unknown",
    data: { kind: "holdings", snapshotId: source.snapshotId, accounts, excludedAssets },
  };
  if (encoder.encode(JSON.stringify(resourceContent)).length > HOLDINGS_RESOURCE_MAX_BYTES) {
    fail("resource_too_large");
  }
  const preview: HoldingsCsvPreview = {
    brokerId: "wealthsimple",
    reportType: "holdings_snapshot",
    adapterId: "wealthsimple-holdings-21-v1",
    reportDate: source.reportDate,
    resourceContent,
    selectedAccountIds: [...ids],
    accounts: summaries,
    warnings,
    stats: {
      inputRows: source.inputRows,
      positions,
      excluded: excludedAssets.length,
      duplicates,
      accounts: accounts.length,
      totals: Object.fromEntries(
        Object.entries(totals).map(([key, amount]) => [key, displayScaled(amount)]),
      ),
    },
  };
  previewSources.set(preview, source);
  return preview;
}

/** This API accepts only the sampled holdings export, never activity/tax CSV reports. */
export async function parseHoldingsCsv(input: {
  text: string;
  brokerId: string;
  ownerUid: string;
  snapshotId: string;
  importedAt: string;
}): Promise<HoldingsCsvPreview> {
  if (input.brokerId !== "wealthsimple") fail("unsupported_broker");
  if (
    typeof input.ownerUid !== "string" ||
    !input.ownerUid ||
    input.ownerUid.length > 128 ||
    typeof input.snapshotId !== "string" ||
    !identifier.test(input.snapshotId)
  )
    fail("invalid_import_context");
  if (
    typeof input.importedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.importedAt) ||
    !Number.isFinite(Date.parse(input.importedAt)) ||
    input.importedAt.length > 40 ||
    new Date(input.importedAt).toISOString().slice(0, 19) !== input.importedAt.slice(0, 19)
  )
    fail("invalid_import_context");
  const records = parseRecords(input.text);
  const headers = records.shift()!.fields.map((cell) => cell.trim());
  if (
    headers.length !== WEALTHSIMPLE_HOLDINGS_HEADERS.length ||
    new Set(headers).size !== headers.length ||
    !WEALTHSIMPLE_HOLDINGS_HEADERS.every((name) => headers.includes(name))
  )
    fail("unsupported_headers");
  const index = new Map(headers.map((name, position) => [name, position]));
  let reportDate: string | null = null;
  if (records.length) {
    reportDate = footerDate(records[records.length - 1]);
    if (reportDate) records.pop();
  }
  if (!records.length) fail("no_holdings_rows");
  if (records.length > HOLDINGS_CSV_MAX_ROWS) fail("too_many_rows");
  const source: PreviewSource = {
    accounts: [],
    warnings: [],
    inputRows: records.length,
    reportDate,
    snapshotId: input.snapshotId,
    importedAt: input.importedAt,
  };
  warning(source.warnings, "manual_snapshot");
  warning(source.warnings, "account_coverage_unverified");
  warning(source.warnings, "valuation_timestamp_unknown");
  warning(source.warnings, "buying_power_unknown");
  const grouped = new Map<string, SourceAccount>();
  const assetHashes = new Map<string, string>();
  for (const record of records) {
    if (record.fields.length !== headers.length) fail("invalid_row_width", record.row);
    const cell = (name: (typeof WEALTHSIMPLE_HOLDINGS_HEADERS)[number]) =>
      record.fields[index.get(name)!].trim();
    const rawAccount = boundedText(cell("Account Number"), 128, record.row)!;
    if (/[\r\n\t]/.test(rawAccount)) fail("invalid_field", record.row);
    let entry = grouped.get(rawAccount);
    if (!entry) {
      if (grouped.size >= 10) fail("too_many_accounts", record.row);
      const accountId =
        "ws_account_" +
        (await digest("folioview.account.wealthsimple.v1", `${input.ownerUid}\0${rawAccount}`));
      const label = cell("Account Name") || cell("Account Type") || "Wealthsimple";
      const safeLabel = label
        .split(rawAccount)
        .join("••••")
        .replace(/[\r\n\t]/g, " ")
        .replace(/\d{5,}/g, "••••");
      const tail = rawAccount.length > 4 ? rawAccount.slice(-4) : "";
      const displayName = `${safeLabel.slice(0, 65)} · ••••${tail}`.slice(0, 80);
      entry = {
        account: { accountId, displayName, balances: [], positions: [] },
        exclusions: [],
        duplicates: 0,
        cashCurrencies: new Set(),
        seenPositions: new Map(),
        seenCash: new Map(),
      };
      grouped.set(rawAccount, entry);
      source.accounts.push(entry);
    }
    const account = entry.account;
    const symbol = boundedText(cell("Symbol"), 32, record.row, false);
    const name = boundedText(cell("Name"), 180, record.row)!;
    const exchange = boundedText(cell("Exchange") || cell("MIC"), 40, record.row, false);
    const kind = normalizedCategory(cell("Security Type"));
    const direction = normalizedCategory(cell("Position Direction"));
    const positionCurrency = currency(cell("Market Price Currency"));
    const valueCurrency = currency(cell("Market Value Currency"));
    const assetKind = ["EXCHANGE_TRADED_FUND", "ETF"].includes(kind) ? "etf" : kind;
    const identity = JSON.stringify([
      symbol || name,
      cell("MIC") || exchange,
      assetKind,
      positionCurrency,
    ]);
    let hash = assetHashes.get(identity);
    if (!hash) {
      hash = await digest("folioview.asset.v1", identity);
      assetHashes.set(identity, hash);
    }
    const brokerAssetId = `ws_csv_asset:${hash}`;
    const exclude = (reason: string) => {
      if (entry!.exclusions.length >= 100) fail("too_many_exclusions", record.row);
      entry!.exclusions.push({ brokerAssetId, reason });
      warning(source.warnings, reason, record.row);
    };
    if (direction !== "LONG") {
      exclude(direction === "SHORT" ? "short_position" : "unknown_position_direction");
      continue;
    }
    if (!positionCurrency) {
      exclude("unsupported_currency");
      continue;
    }
    if (
      kind !== "CURRENCY" &&
      !["EQUITY", "STOCK", "COMMON_STOCK", "EXCHANGE_TRADED_FUND", "ETF"].includes(kind)
    ) {
      exclude("unsupported_security_type");
      continue;
    }
    const quantity = decimal(cell("Quantity"), record.row)!;
    const marketValue = decimal(cell("Market Value"), record.row, false);
    if (kind === "CURRENCY") {
      const price = decimal(cell("Market Price"), record.row, false);
      if (
        symbol !== positionCurrency ||
        price !== "1" ||
        valueCurrency !== positionCurrency ||
        marketValue !== quantity
      ) {
        exclude("cash_balance_unverified");
        continue;
      }
      const old = entry.seenCash.get(positionCurrency);
      if (old !== undefined) {
        if (old !== quantity) fail("conflicting_cash_rows", record.row);
        entry.duplicates += 1;
        warning(source.warnings, "duplicate_cash_row", record.row);
        continue;
      }
      if (quantity.startsWith("-")) warning(source.warnings, "negative_cash_balance", record.row);
      entry.seenCash.set(positionCurrency, quantity);
      entry.cashCurrencies.add(positionCurrency);
      account.balances.push({
        currency: positionCurrency,
        cashBalance: quantity,
        buyingPower: null,
      });
      continue;
    }
    if (quantity.startsWith("-")) {
      exclude("short_position");
      continue;
    }
    if (account.positions.length >= 1_000) fail("too_many_positions", record.row);
    if (marketValue !== null && marketValue.startsWith("-"))
      fail("invalid_market_value", record.row);
    if (!symbol) warning(source.warnings, "symbol_unknown", record.row);
    if (!exchange) warning(source.warnings, "exchange_unknown", record.row);
    if (marketValue === null || !valueCurrency)
      warning(source.warnings, "market_value_unknown", record.row);
    if (valueCurrency && valueCurrency !== positionCurrency)
      warning(source.warnings, "market_value_currency_differs", record.row);
    const position: HoldingPosition = {
      assetId: "ws_asset_" + hash,
      brokerAssetId,
      symbol,
      exchange,
      name,
      assetType: ["EXCHANGE_TRADED_FUND", "ETF"].includes(kind) ? "etf" : "stock",
      quantity,
      currency: positionCurrency,
      marketValue:
        marketValue !== null && valueCurrency
          ? { currency: valueCurrency, amount: marketValue }
          : null,
    };
    const previous = entry.seenPositions.get(hash);
    if (previous !== undefined) {
      if (previous !== JSON.stringify(position)) fail("conflicting_position_rows", record.row);
      entry.duplicates += 1;
      warning(source.warnings, "duplicate_position_row", record.row);
      continue;
    }
    entry.seenPositions.set(hash, JSON.stringify(position));
    account.positions.push(position);
  }
  for (const entry of source.accounts) {
    const used = new Set(entry.account.positions.map((position) => position.currency));
    for (const code of used) {
      if (!entry.cashCurrencies.has(code)) {
        entry.account.balances.push({ currency: code, cashBalance: null, buyingPower: null });
        warning(source.warnings, "cash_balance_unknown");
      }
    }
    entry.account.balances.sort((a, b) => a.currency.localeCompare(b.currency));
  }
  return makePreview(
    source,
    source.accounts.map((entry) => entry.account.accountId),
  );
}

/** Select only from the local preview object; serialized previews cannot reconstruct private input. */
export function selectHoldingsAccounts(
  preview: HoldingsCsvPreview,
  accountIds: readonly string[],
): HoldingsCsvPreview {
  const source = previewSources.get(preview);
  if (!source) fail("invalid_preview");
  return makePreview(source, accountIds);
}
