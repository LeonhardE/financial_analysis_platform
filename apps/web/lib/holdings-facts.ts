/** Local snapshot editing. Crypto/authority validation remains in the private Worker. */
import type {
  HoldingsFacts,
  Position,
  Provenance,
  Currency,
} from "../../../packages/encrypted-workspace/valuation/dist/index.mjs";
import type { HoldingsCsvPreview, HoldingsResourceContent } from "./holdings-csv";

export type { HoldingsFacts, Position, Currency };
export type SavedHoldings = HoldingsResourceContent | HoldingsFacts;
export type SnapshotReference = { snapshotId: string; sourceRevision: number };
export type HoldingsPreview = Omit<
  HoldingsCsvPreview,
  "resourceContent" | "brokerId" | "adapterId"
> & {
  brokerId: "wealthsimple" | "manual";
  adapterId: string;
  resourceContent: SavedHoldings;
  intent?: "import" | "edit" | "manual";
  base?: SnapshotReference & {
    sourceId: string;
    incarnation: string;
    sourceEpoch: number;
    authorityVersion: number;
  };
  changes?: HoldingChange[];
  importPlan?: {
    mode: "replace" | "merge";
    overwriteManual: boolean;
    protectedManualCount: number;
  };
};
export type ConfirmedInstrument = {
  symbol: string;
  market: string;
  currency: Currency;
  name: string;
  assetType: "stock" | "etf";
};
export type PositionEdit = {
  accountId: string;
  assetId: string | null;
  instrument: ConfirmedInstrument | null;
  quantity: string;
  unitCost: string;
  removeConfirmed?: boolean;
};
export type HoldingChange = {
  account: string;
  symbol: string;
  kind: "added" | "changed" | "removed";
  before: { quantity: string; unitCost: string | null; currency: Currency } | null;
  after: { quantity: string; unitCost: string | null; currency: Currency } | null;
  manualConflict: boolean;
};
export class HoldingsEditError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new HoldingsEditError(code);
}
const zero = BigInt(0),
  ten = BigInt(10);
const encoder = new TextEncoder();
export function factsContent(value: SavedHoldings): value is HoldingsFacts {
  return "profile" in value.data && value.data.profile === "folioview.holdings-facts.v2";
}
export function inputDecimal(value: string, precision = 18) {
  if (typeof value !== "string" || value.length > 40 || !/^\d+(?:\.\d+)?$/.test(value))
    fail("invalid_number");
  const [raw, fraction = ""] = value.split(".");
  const whole = raw.replace(/^0+(?=\d)/, ""),
    tail = fraction.replace(/0+$/, "");
  if (whole.length > 20 || tail.length > precision) fail("number_out_of_range");
  return whole + (tail ? "." + tail : "");
}
function integer(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return { n: BigInt(whole + fraction), scale: fraction.length };
}
function decimal(n: bigint, scale: number) {
  const raw = String(n).padStart(scale + 1, "0");
  return inputDecimal(scale ? raw.slice(0, -scale) + "." + raw.slice(-scale) : raw);
}
export function multiplyCost(cost: string, quantity: string) {
  const a = integer(inputDecimal(cost)),
    b = integer(inputDecimal(quantity, 12));
  return decimal(a.n * b.n, a.scale + b.scale);
}
/** Derived import unit cost, half-even to the contract's 18 fractional places. */
export function divideCost(cost: string, quantity: string): string | null {
  const a = integer(inputDecimal(cost)),
    b = integer(inputDecimal(quantity, 12));
  if (b.n === zero) return null;
  const numerator = a.n * ten ** BigInt(b.scale + 18),
    denominator = b.n * ten ** BigInt(a.scale);
  let n = numerator / denominator;
  const remainder = numerator % denominator;
  if (
    remainder * BigInt(2) > denominator ||
    (remainder * BigInt(2) === denominator && n % BigInt(2) !== zero)
  )
    n += BigInt(1);
  return decimal(n, 18);
}
export function provenance(
  origin: Provenance["origin"],
  at: string,
  date: string | null = null,
): Provenance {
  return origin === "unknown"
    ? { origin, recordedAt: null, sourceDate: null, lastEditedAt: null }
    : { origin, recordedAt: at, sourceDate: date, lastEditedAt: origin === "manual" ? at : null };
}
const MIC: Record<string, string> = {
  NASDAQ: "XNAS",
  NYSE: "XNYS",
  TSX: "XTSE",
  "TORONTO STOCK EXCHANGE": "XTSE",
  "TSX VENTURE": "XTSX",
  "TSX VENTURE EXCHANGE": "XTSX",
  TSXV: "XTSX",
  "NYSE ARCA": "ARCX",
  CSE: "CNSX",
  NEO: "NEOE",
};
export function importedMarket(value: string | null) {
  const market = value?.trim().toUpperCase() ?? "";
  return MIC[market] ?? (/^[A-Z0-9]{4}$/.test(market) ? market : "UNKNOWN");
}
export function legacyFacts(value: HoldingsResourceContent): HoldingsFacts {
  return {
    ...structuredClone(value),
    data: {
      kind: "holdings",
      profile: "folioview.holdings-facts.v2",
      snapshotId: value.data.snapshotId,
      editKind: "import",
      reportDate: null,
      importSnapshot: { snapshotId: value.data.snapshotId, sourceRevision: 1 },
      previousSnapshot: null,
      excludedAssets: structuredClone(value.data.excludedAssets),
      accounts: value.data.accounts.map((account) => ({
        ...structuredClone(account),
        positions: account.positions.map((p) => ({
          assetId: p.assetId,
          brokerAssetId: p.brokerAssetId,
          instrument: {
            symbol: p.symbol,
            market: importedMarket(p.exchange),
            currency: p.currency,
          },
          name: p.name,
          assetType: p.assetType,
          quantity: p.quantity,
          unitCost: null,
          bookCost: null,
          bookCostCad: null,
          reportedValues: { unitPrice: null, marketValue: p.marketValue, unrealizedReturn: null },
          provenance: {
            instrument: provenance("legacy", value.fetchedAt),
            quantity: provenance("legacy", value.fetchedAt),
            unitCost: provenance("unknown", value.fetchedAt),
            bookCost: provenance("unknown", value.fetchedAt),
            bookCostCad: provenance("unknown", value.fetchedAt),
          },
        })),
      })),
    },
  };
}
export function asFacts(value: SavedHoldings): HoldingsFacts {
  return factsContent(value) ? structuredClone(value) : legacyFacts(value);
}
export function boundedFacts(value: HoldingsFacts) {
  if (encoder.encode(JSON.stringify(value)).length > 192512) fail("resource_too_large");
  if (value.data.accounts.reduce((n, a) => n + a.positions.length, 0) > 1000)
    fail("too_many_positions");
  return value;
}
function state(value: HoldingsFacts) {
  value.state = value.data.accounts.some(
    (a) => a.positions.length || a.balances.some((b) => b.cashBalance !== null),
  )
    ? "ready"
    : "empty";
  return boundedFacts(value);
}
const instrumentKey = (p: Position["instrument"]) =>
  JSON.stringify([p.market, p.symbol, p.currency]);
const identity = (p: Position) => instrumentKey(p.instrument);
const observation = (p: Position) => ({
  quantity: p.quantity,
  unitCost: p.unitCost?.amount ?? null,
  currency: p.instrument.currency,
});
const equalPosition = (a: Position, b: Position) =>
  JSON.stringify([
    identity(a),
    a.quantity,
    a.unitCost?.amount ?? null,
    a.bookCost?.amount ?? null,
  ]) ===
  JSON.stringify([identity(b), b.quantity, b.unitCost?.amount ?? null, b.bookCost?.amount ?? null]);
export function holdingsChanges(before: HoldingsFacts, after: HoldingsFacts): HoldingChange[] {
  const changes: HoldingChange[] = [];
  for (const account of after.data.accounts) {
    const previous = before.data.accounts.find((a) => a.accountId === account.accountId);
    for (const p of account.positions) {
      const old = previous?.positions.find(
        (row) => row.assetId === p.assetId || identity(row) === identity(p),
      );
      if (!old || !equalPosition(old, p))
        changes.push({
          account: account.displayName,
          symbol: p.instrument.symbol ?? p.name ?? "—",
          kind: old ? "changed" : "added",
          before: old ? observation(old) : null,
          after: observation(p),
          manualConflict: Boolean(
            old && Object.values(old.provenance).some((v) => v.origin === "manual"),
          ),
        });
    }
  }
  for (const account of before.data.accounts)
    for (const p of account.positions) {
      const next = after.data.accounts.find((a) => a.accountId === account.accountId);
      if (
        !next?.positions.some((row) => row.assetId === p.assetId || identity(row) === identity(p))
      )
        changes.push({
          account: account.displayName,
          symbol: p.instrument.symbol ?? p.name ?? "—",
          kind: "removed",
          before: observation(p),
          after: null,
          manualConflict: Object.values(p.provenance).some((v) => v.origin === "manual"),
        });
    }
  return changes;
}
const reference = (v: SnapshotReference | null) =>
  v ? { snapshotId: v.snapshotId, sourceRevision: v.sourceRevision } : null;
export function editHoldings(args: {
  content: SavedHoldings | null;
  base: SnapshotReference | null;
  snapshotId: string;
  at: string;
  edit: PositionEdit;
  newAccount?: { accountId: string; displayName: string };
}): HoldingsFacts {
  const { edit, at, base } = args;
  const value: HoldingsFacts = args.content
    ? asFacts(args.content)
    : {
        state: "empty",
        coverage: { state: "unknown", issues: ["manual_snapshot"] },
        sourceAsOf: null,
        fetchedAt: at,
        freshness: "unknown",
        data: {
          kind: "holdings",
          profile: "folioview.holdings-facts.v2",
          snapshotId: args.snapshotId,
          editKind: "manual",
          reportDate: null,
          importSnapshot: null,
          previousSnapshot: null,
          accounts: args.newAccount ? [{ ...args.newAccount, balances: [], positions: [] }] : [],
          excludedAssets: [],
        },
      };
  if (args.content && (!base || base.snapshotId !== args.content.data.snapshotId))
    fail("version_conflict");
  const account = value.data.accounts.find((a) => a.accountId === edit.accountId);
  if (!account) fail("invalid_account_selection");
  const old = edit.assetId ? account.positions.find((p) => p.assetId === edit.assetId) : undefined;
  if (edit.assetId && !old) fail("version_conflict");
  const quantity = inputDecimal(edit.quantity, 12);
  if (quantity === "0") {
    if (!old || !edit.removeConfirmed) fail("confirm_position_removal");
    account.positions = account.positions.filter((p) => p !== old);
  } else {
    if (!old && !edit.instrument) fail("select_instrument");
    const instrument = edit.instrument
      ? {
          symbol: edit.instrument.symbol,
          market: edit.instrument.market,
          currency: edit.instrument.currency,
        }
      : old!.instrument;
    if (account.positions.some((p) => p !== old && identity(p) === instrumentKey(instrument)))
      fail("duplicate_position");
    const unitCost = edit.unitCost === "" && old ? null : inputDecimal(edit.unitCost);
    const changedIdentity = !old || identity(old) !== instrumentKey(instrument);
    const changedQuantity = !old || old.quantity !== quantity;
    const changedCost = !old || (old.unitCost?.amount ?? null) !== unitCost || changedIdentity;
    const unknown = provenance("unknown", at),
      manual = provenance("manual", at),
      derived = provenance("derived", at);
    // IDs stay within the existing contract even for the longest supported ticker.
    const compactId =
      old?.assetId ??
      `asset_${instrument.market}_${instrument.currency}_${Array.from(encoder.encode(instrument.symbol!), (n) => n.toString(16).padStart(2, "0")).join("")}`;
    const position: Position = {
      assetId: compactId,
      brokerAssetId: old?.brokerAssetId ?? null,
      instrument,
      name: edit.instrument?.name ?? old?.name ?? null,
      assetType: edit.instrument?.assetType ?? old?.assetType ?? "stock",
      quantity,
      unitCost: unitCost === null ? null : { currency: instrument.currency, amount: unitCost },
      bookCost:
        !changedQuantity && !changedCost
          ? old!.bookCost
          : unitCost === null
            ? null
            : { currency: instrument.currency, amount: multiplyCost(unitCost, quantity) },
      bookCostCad: !changedQuantity && !changedCost ? old!.bookCostCad : null,
      reportedValues: changedIdentity ? null : (old?.reportedValues ?? null),
      provenance: {
        instrument: changedIdentity ? manual : old!.provenance.instrument,
        quantity: changedQuantity ? manual : old!.provenance.quantity,
        unitCost: !changedCost ? old!.provenance.unitCost : unitCost === null ? unknown : manual,
        bookCost:
          !changedQuantity && !changedCost
            ? old!.provenance.bookCost
            : unitCost === null
              ? unknown
              : derived,
        bookCostCad: !changedQuantity && !changedCost ? old!.provenance.bookCostCad : unknown,
      },
    };
    if (old) account.positions[account.positions.indexOf(old)] = position;
    else account.positions.push(position);
  }
  value.data = {
    ...value.data,
    snapshotId: args.snapshotId,
    editKind: args.content ? "edit" : "manual",
    previousSnapshot: reference(base),
  };
  if (args.content && !factsContent(args.content)) value.data.importSnapshot = reference(base);
  value.fetchedAt = at;
  value.freshness = "unknown";
  return state(value);
}
export function importHoldings(args: {
  incoming: HoldingsFacts;
  current: SavedHoldings | null;
  base: SnapshotReference | null;
  mode: "replace" | "merge";
  overwriteManual: boolean;
}): HoldingsFacts {
  const incoming = structuredClone(args.incoming);
  if (!args.current) return state(incoming);
  if (!args.base || args.current.data.snapshotId !== args.base.snapshotId) fail("version_conflict");
  const current = asFacts(args.current);
  if (args.mode === "replace") {
    if (!args.overwriteManual && holdingsChanges(current, incoming).some((c) => c.manualConflict))
      fail("confirm_manual_overwrite");
    return state({
      ...incoming,
      data: { ...incoming.data, previousSnapshot: reference(args.base) },
    });
  }
  const value = structuredClone(current);
  for (const next of incoming.data.accounts) {
    const account = value.data.accounts.find((a) => a.accountId === next.accountId);
    if (!account) {
      value.data.accounts.push(next);
      continue;
    }
    account.balances = next.balances;
    for (const p of next.positions) {
      const i = account.positions.findIndex(
        (old) => old.assetId === p.assetId || identity(old) === identity(p),
      );
      if (i < 0) account.positions.push(p);
      else if (
        args.overwriteManual ||
        !Object.values(account.positions[i].provenance).some((v) => v.origin === "manual")
      )
        account.positions[i] = p;
    }
  }
  value.data = {
    ...value.data,
    snapshotId: incoming.data.snapshotId,
    previousSnapshot: reference(args.base),
    editKind: "edit",
    reportDate: incoming.data.reportDate,
    importSnapshot: factsContent(args.current)
      ? (current.data.importSnapshot ?? incoming.data.importSnapshot)
      : reference(args.base),
    excludedAssets: Array.from(
      new Map(
        [...value.data.excludedAssets, ...incoming.data.excludedAssets].map((v) => [
          JSON.stringify(v),
          v,
        ]),
      ).values(),
    ),
  };
  value.fetchedAt = incoming.fetchedAt;
  value.freshness = "unknown";
  value.coverage = {
    state: "unknown",
    issues: [...new Set([...current.coverage.issues, ...incoming.coverage.issues])].slice(0, 20),
  };
  return state(value);
}
export function bindFacts(
  value: HoldingsFacts,
  revision: number,
  previous: SnapshotReference | null,
) {
  const result = structuredClone(value);
  if (
    result.data.editKind === "import" ||
    result.data.importSnapshot?.snapshotId === result.data.snapshotId
  )
    result.data.importSnapshot = { snapshotId: result.data.snapshotId, sourceRevision: revision };
  if (result.data.editKind !== "manual" || previous)
    result.data.previousSnapshot = reference(previous);
  return boundedFacts(result);
}

export function formatHoldingsTime(value: string, locale: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "—";
}
