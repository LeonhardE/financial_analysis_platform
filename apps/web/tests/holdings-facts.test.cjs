const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const facts = require("./resource-library-helpers.cjs").compile("../lib/holdings-facts.ts");
const copy = (v) => JSON.parse(JSON.stringify(v));
const at = "2026-11-14T06:00:00Z",
  later = "2026-11-14T07:00:00Z";
const instrument = {
  symbol: "AAPL",
  market: "XNAS",
  currency: "USD",
  name: "Apple",
  assetType: "stock",
};
const account = { accountId: "account_A", displayName: "Synthetic account" };
const edit = (patch = {}) => ({
  accountId: account.accountId,
  assetId: null,
  instrument,
  quantity: "2.5",
  unitCost: "10.25",
  ...patch,
});
const create = (patch = {}) =>
  facts.editHoldings({
    content: null,
    base: null,
    snapshotId: "snapshot_A",
    at,
    edit: edit(),
    newAccount: account,
    ...patch,
  });
const base = {
  snapshotId: "snapshot_A",
  sourceRevision: 1,
  sourceId: "private_source",
  sourceEpoch: 3,
  authorityVersion: 7,
  incarnation: "private_inc",
};
let shared;
test.before(async () => {
  shared = await import(
    pathToFileURL(
      path.resolve(__dirname, "../../../packages/encrypted-workspace/valuation/dist/holdings.mjs"),
    ).href
  );
});
const valid = (value, revision) =>
  shared.holdingsFacts(copy(value), { snapshotId: value.data.snapshotId, revision });
const rejects = (code, fn) => assert.throws(fn, (e) => e.code === code);

test("manual facts preserve exact decimals and zero cost, without a fictitious import or cash transaction", () => {
  const value = create({ edit: edit({ unitCost: "0", quantity: "9007199254740993.125" }) });
  valid(value, 1);
  const position = value.data.accounts[0].positions[0];
  assert.equal(position.quantity, "9007199254740993.125");
  assert.equal(position.bookCost.amount, "0");
  assert.equal(value.data.importSnapshot, null);
  assert.deepEqual(copy(value.data.accounts[0].balances), []);
  assert.equal(position.provenance.quantity.origin, "manual");
  assert.equal(position.provenance.quantity.lastEditedAt, at);
  assert.equal(position.reportedValues, null);
  assert.equal(facts.multiplyCost("9007199254740993.01", "2"), "18014398509481986.02");
  assert.equal(facts.divideCost("1", "3"), "0.333333333333333333");
});
test("non-finite, negative, exponential, oversized and excess-precision inputs fail before a snapshot", () => {
  for (const value of ["-1", "NaN", "Infinity", "1e3", "+1", "", " 1", "1.", "0x10"])
    rejects("invalid_number", () => facts.inputDecimal(value));
  for (const value of ["1".repeat(21), "0." + "1".repeat(19)])
    rejects("number_out_of_range", () => facts.inputDecimal(value));
  rejects("number_out_of_range", () => create({ edit: edit({ quantity: "0.1234567890123" }) }));
  rejects("number_out_of_range", () => facts.multiplyCost("99999999999999999999", "2"));
});
test("editing is immutable, changes exact field provenance and strips display preconditions from private references", () => {
  const original = create(),
    saved = copy(original),
    p = original.data.accounts[0].positions[0];
  const result = facts.editHoldings({
    content: original,
    base,
    snapshotId: "snapshot_B",
    at: later,
    edit: edit({ assetId: p.assetId, instrument: null, quantity: "3" }),
  });
  valid(result, 2);
  assert.deepEqual(copy(original), saved);
  assert.equal(result.data.accounts[0].positions[0].bookCost.amount, "30.75");
  assert.equal(result.data.accounts[0].positions[0].provenance.quantity.lastEditedAt, later);
  assert.equal(result.data.accounts[0].positions[0].provenance.unitCost.lastEditedAt, at);
  assert.deepEqual(copy(result.data.previousSnapshot), {
    snapshotId: "snapshot_A",
    sourceRevision: 1,
  });
  assert.ok(!JSON.stringify(result).includes("private_source"));
  assert.equal(facts.holdingsChanges(original, result)[0].kind, "changed");
});
test("duplicates are keyed by canonical market/symbol/currency rather than object key order, per account", () => {
  const original = create();
  const reordered = { ...instrument, currency: "USD", market: "XNAS", symbol: "AAPL" };
  original.data.accounts[0].positions[0].instrument = {
    currency: "USD",
    market: "XNAS",
    symbol: "AAPL",
  };
  rejects("duplicate_position", () =>
    facts.editHoldings({
      content: original,
      base,
      snapshotId: "snapshot_B",
      at: later,
      edit: edit({ instrument: reordered }),
    }),
  );
  original.data.accounts.push({
    accountId: "account_B",
    displayName: "Other",
    balances: [],
    positions: [],
  });
  const next = facts.editHoldings({
    content: original,
    base,
    snapshotId: "snapshot_B",
    at: later,
    edit: edit({ accountId: "account_B" }),
  });
  valid(next, 2);
  assert.equal(next.data.accounts.length, 2);
  assert.equal(next.data.accounts[0].positions.length, 1);
  assert.equal(next.data.accounts[1].positions.length, 1);
});
test("zero quantity needs explicit removal, and removal keeps the original snapshot intact", () => {
  const original = create(),
    p = original.data.accounts[0].positions[0];
  const args = {
    content: original,
    base,
    snapshotId: "snapshot_B",
    at: later,
    edit: edit({ assetId: p.assetId, quantity: "0.00" }),
  };
  rejects("confirm_position_removal", () => facts.editHoldings(args));
  const removed = facts.editHoldings({ ...args, edit: { ...args.edit, removeConfirmed: true } });
  valid(removed, 2);
  assert.equal(removed.state, "empty");
  assert.equal(removed.data.accounts[0].positions.length, 0);
  assert.equal(original.data.accounts[0].positions.length, 1);
});
test("unknown legacy cost stays null and ticker changes do not label an old reported value as the new security", () => {
  const legacy = {
    state: "ready",
    coverage: { state: "unknown", issues: [] },
    sourceAsOf: null,
    fetchedAt: at,
    freshness: "unknown",
    data: {
      kind: "holdings",
      snapshotId: "snapshot_A",
      excludedAssets: [],
      accounts: [
        {
          ...account,
          balances: [],
          positions: [
            {
              assetId: "old_A",
              brokerAssetId: "broker_A",
              symbol: "AAPL",
              exchange: "XNAS",
              currency: "USD",
              name: "Apple",
              assetType: "stock",
              quantity: "2",
              marketValue: { currency: "USD", amount: "100" },
            },
          ],
        },
      ],
    },
  };
  assert.equal(facts.importedMarket("NYSE"), "XNYS");
  assert.equal(facts.importedMarket("XNAS"), "XNAS");
  assert.equal(facts.importedMarket("unknown exchange"), "UNKNOWN");
  const current = facts.asFacts(legacy);
  assert.equal(current.data.accounts[0].positions[0].unitCost, null);
  assert.equal(current.data.accounts[0].positions[0].provenance.unitCost.origin, "unknown");
  const result = facts.editHoldings({
    content: legacy,
    base,
    snapshotId: "snapshot_B",
    at: later,
    edit: edit({ assetId: "old_A", instrument: null, quantity: "3", unitCost: "" }),
  });
  valid(result, 2);
  assert.equal(result.data.accounts[0].positions[0].bookCost, null);
  assert.equal(result.data.accounts[0].positions[0].reportedValues.marketValue.amount, "100");
  const changed = facts.editHoldings({
    content: legacy,
    base,
    snapshotId: "snapshot_C",
    at: later,
    edit: edit({ assetId: "old_A", instrument: { ...instrument, symbol: "MSFT" }, quantity: "3" }),
  });
  assert.equal(changed.data.accounts[0].positions[0].reportedValues, null);
  valid(changed, 2);
});
function imported() {
  const value = create({
    snapshotId: "snapshot_IMPORT",
    at: later,
    edit: edit({ quantity: "7", unitCost: "20" }),
  });
  value.data.editKind = "import";
  value.data.importSnapshot = { snapshotId: "snapshot_IMPORT", sourceRevision: 1 };
  for (const p of value.data.accounts[0].positions)
    for (const field of Object.keys(p.provenance))
      if (p.provenance[field].origin !== "unknown")
        p.provenance[field] = facts.provenance("import", later);
  return value;
}
test("reimport replace requires explicit manual overwrite; merge keeps manual edits and absent positions", () => {
  const current = create(),
    incoming = imported();
  rejects("confirm_manual_overwrite", () =>
    facts.importHoldings({ incoming, current, base, mode: "replace", overwriteManual: false }),
  );
  const merged = facts.bindFacts(
    facts.importHoldings({ incoming, current, base, mode: "merge", overwriteManual: false }),
    2,
    base,
  );
  valid(merged, 2);
  assert.equal(merged.data.accounts[0].positions[0].quantity, "2.5");
  const overwritten = facts.bindFacts(
    facts.importHoldings({ incoming, current, base, mode: "merge", overwriteManual: true }),
    2,
    base,
  );
  valid(overwritten, 2);
  assert.equal(overwritten.data.accounts[0].positions[0].quantity, "7");
  const replaced = facts.bindFacts(
    facts.importHoldings({ incoming, current, base, mode: "replace", overwriteManual: true }),
    2,
    base,
  );
  valid(replaced, 2);
  assert.deepEqual(copy(replaced.data.importSnapshot), {
    snapshotId: "snapshot_IMPORT",
    sourceRevision: 2,
  });
  assert.equal(current.data.accounts[0].positions[0].quantity, "2.5");
});
test("stale base, absent account and snapshot limits reject without altering the original", () => {
  const value = create();
  rejects("version_conflict", () =>
    facts.editHoldings({
      content: value,
      base: { ...base, snapshotId: "other" },
      snapshotId: "snapshot_B",
      at: later,
      edit: edit(),
    }),
  );
  rejects("invalid_account_selection", () =>
    facts.editHoldings({
      content: value,
      base,
      snapshotId: "snapshot_B",
      at: later,
      edit: edit({ accountId: "absent" }),
    }),
  );
  rejects("resource_too_large", () =>
    facts.boundedFacts({ ...value, largeUnknown: "x".repeat(200000) }),
  );
});
