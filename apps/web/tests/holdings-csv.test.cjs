const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

const { code } = transformSync(
  readFileSync(path.join(__dirname, "../lib/holdings-csv.ts"), "utf8"),
  {
    filename: "holdings-csv.ts",
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  },
);
const moduleUnderTest = { exports: {} };
vm.runInNewContext(code, {
  module: moduleUnderTest,
  exports: moduleUnderTest.exports,
  TextEncoder,
  crypto: webcrypto,
  structuredClone,
});
const {
  WEALTHSIMPLE_HOLDINGS_HEADERS: headers,
  HOLDINGS_CSV_MAX_BYTES,
  HOLDINGS_RESOURCE_MAX_BYTES,
  HOLDINGS_CSV_ADAPTERS,
  parseHoldingsCsv,
  selectHoldingsAccounts,
} = moduleUnderTest.exports;

const clean = (value) => JSON.parse(JSON.stringify(value));
const field = (value) =>
  /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
const row = (changes = {}) => ({
  "Account Name": "Synthetic TFSA",
  "Account Type": "TFSA",
  "Account Classification": "individual",
  "Account Number": "SYNTH_ACCOUNT_A_4821",
  Symbol: "SYNTH",
  Exchange: "SYNTH Exchange",
  MIC: "XSYN",
  Name: "Synthetic Holdings",
  "Security Type": "EQUITY",
  Quantity: "12.5",
  "Position Direction": "LONG",
  "Market Price": "10",
  "Market Price Currency": "CAD",
  "Book Value (CAD)": "100",
  "Book Value Currency (CAD)": "CAD",
  "Book Value (Market)": "100",
  "Book Value Currency (Market)": "CAD",
  "Market Value": "125",
  "Market Value Currency": "CAD",
  "Market Unrealized Returns": "25",
  "Market Unrealized Returns Currency": "CAD",
  ...changes,
});
const cash = (changes = {}) =>
  row({
    Symbol: "CAD",
    Name: "Canadian dollars",
    "Security Type": "CURRENCY",
    Quantity: "50.25",
    "Market Price": "1",
    "Market Value": "50.25",
    ...changes,
  });
function csv(
  rows,
  { columns = headers, footer = "Data as of: 2026-10-22", newline = "\r\n" } = {},
) {
  const records = [columns.map(field).join(",")];
  for (const item of rows) records.push(columns.map((name) => field(item[name] ?? "")).join(","));
  if (footer !== null) records.push("", field(footer));
  return records.join(newline);
}
const parse = (text, changes = {}) =>
  parseHoldingsCsv({
    text,
    brokerId: "wealthsimple",
    ownerUid: "synthetic_owner_a",
    snapshotId: "synthetic_snapshot_a",
    importedAt: "2026-10-28T19:15:00Z",
    ...changes,
  });
async function rejects(code, action) {
  await assert.rejects(action, (error) => {
    assert.equal(error.name, "HoldingsCsvError");
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test("sampled 21-column adapter produces exact contract shapes, separate source date and reported cash", async () => {
  const preview = await parse(csv([row(), cash()]));
  assert.equal(preview.reportDate, "2026-10-22");
  assert.equal(preview.resourceContent.sourceAsOf, null);
  assert.equal(preview.resourceContent.freshness, "unknown");
  assert.equal(preview.resourceContent.fetchedAt, "2026-10-28T19:15:00Z");
  assert.equal(preview.resourceContent.coverage.state, "unknown");
  assert.equal(preview.stats.positions, 1);
  assert.deepEqual(clean(preview.stats.totals), { CAD: "175.25" });
  const account = preview.resourceContent.data.accounts[0];
  assert.match(account.accountId, /^ws_account_[a-f0-9]{64}$/);
  assert.equal(account.displayName, "Synthetic TFSA · ••••4821");
  assert.deepEqual(clean(account.balances), [
    { currency: "CAD", cashBalance: "50.25", buyingPower: null },
  ]);
  const position = account.positions[0];
  assert.deepEqual(
    Object.keys(position).sort(),
    [
      "assetId",
      "assetType",
      "brokerAssetId",
      "currency",
      "exchange",
      "marketValue",
      "name",
      "quantity",
      "symbol",
    ].sort(),
  );
  assert.equal(position.quantity, "12.5");
  assert.equal(position.assetType, "stock");
  assert.equal(JSON.stringify(preview).includes("SYNTH_ACCOUNT_A_4821"), false);
});

test("RFC CSV handles BOM, reorder, CRLF, quoted comma, doubled quotes and multiline names", async () => {
  const name = 'Synthetic, "quoted"\nsecurity';
  const preview = await parse(
    "\uFEFF" + csv([row({ Name: name })], { columns: [...headers].reverse() }),
  );
  assert.equal(preview.resourceContent.data.accounts[0].positions[0].name, name);
});

test("exact decimals above JS integer precision sum with fractional values and CAD/USD remain separate", async () => {
  const preview = await parse(
    csv([
      row({
        Symbol: "BIG",
        Quantity: "9007199254740993.000000000001",
        "Market Value": "9007199254740993.000000000001",
      }),
      row({ Symbol: "SMALL", "Market Value": "0.000000000001" }),
      row({
        Symbol: "USD",
        "Market Price Currency": "USD",
        "Market Value Currency": "USD",
        "Market Value": "2,345.60",
      }),
    ]),
  );
  assert.deepEqual(clean(preview.stats.totals), {
    CAD: "9007199254740993.000000000002",
    USD: "2345.6",
  });
  assert.equal(
    preview.resourceContent.data.accounts[0].positions[0].quantity,
    "9007199254740993.000000000001",
  );
});

test("cash conversion or incomplete fields stay unknown instead of inventing balance, buying power or zero", async () => {
  const preview = await parse(
    csv([row(), cash({ "Market Value": "68", "Market Value Currency": "USD" })]),
  );
  assert.deepEqual(clean(preview.resourceContent.data.accounts[0].balances), [
    { currency: "CAD", cashBalance: null, buyingPower: null },
  ]);
  assert.equal(preview.stats.excluded, 1);
  assert.equal(preview.resourceContent.data.excludedAssets[0].reason, "cash_balance_unverified");
  assert.deepEqual(clean(preview.stats.totals), { CAD: "125" });
});

test("currency assets create balances only; cash-only files are ready with no fake equity", async () => {
  const preview = await parse(csv([cash()]));
  assert.equal(preview.resourceContent.state, "ready");
  assert.equal(preview.stats.positions, 0);
  assert.equal(preview.resourceContent.data.accounts[0].positions.length, 0);
  assert.deepEqual(clean(preview.stats.totals), { CAD: "50.25" });
});

test("negative reported cash remains a liability instead of disappearing as a short security", async () => {
  const preview = await parse(csv([row(), cash({ Quantity: "-50.25", "Market Value": "-50.25" })]));
  assert.equal(preview.resourceContent.data.accounts[0].balances[0].cashBalance, "-50.25");
  assert.deepEqual(clean(preview.stats.totals), { CAD: "74.75" });
  assert.ok(preview.warnings.some((item) => item.code === "negative_cash_balance"));
});

test("equivalent positions and cash rows deduplicate visibly; conflicting rows reject", async () => {
  const preview = await parse(csv([row(), row(), cash(), cash()]));
  assert.equal(preview.stats.duplicates, 2);
  assert.equal(preview.stats.positions, 1);
  assert.deepEqual(clean(preview.stats.totals), { CAD: "175.25" });
  assert.equal(preview.resourceContent.coverage.state, "partial");
  assert.ok(preview.warnings.some((item) => item.code === "duplicate_position_row"));
  await rejects("conflicting_position_rows", () => parse(csv([row(), row({ Quantity: "3" })])));
  await rejects("conflicting_position_rows", () =>
    parse(csv([row(), row({ Name: "Changed same security" })])),
  );
  await rejects("conflicting_cash_rows", () =>
    parse(csv([cash(), cash({ Quantity: "1", "Market Value": "1" })])),
  );
});

test("unsupported security, short direction and unsupported currency are explicit exclusions", async () => {
  const preview = await parse(
    csv([
      row(),
      row({ Symbol: "CRYPTO", "Security Type": "CRYPTO", Quantity: "0.0000000000000000001" }),
      row({ Symbol: "SHORT", "Position Direction": "SHORT" }),
      row({ Symbol: "OTHER", "Market Price Currency": "EUR" }),
      row({ Symbol: "NEG", Quantity: "-1" }),
      row({ Symbol: "UNKNOWN", "Position Direction": "" }),
    ]),
  );
  assert.equal(preview.stats.positions, 1);
  assert.equal(preview.stats.excluded, 5);
  assert.equal(preview.resourceContent.coverage.state, "partial");
  assert.deepEqual(
    new Set(preview.resourceContent.data.excludedAssets.map((item) => item.reason)),
    new Set([
      "unsupported_security_type",
      "short_position",
      "unsupported_currency",
      "unknown_position_direction",
    ]),
  );
});

test("ETF classification works and unknown market value remains null", async () => {
  const preview = await parse(
    csv([row({ "Security Type": "EXCHANGE_TRADED_FUND", "Market Value": "N/A" })]),
  );
  const position = preview.resourceContent.data.accounts[0].positions[0];
  assert.equal(position.assetType, "etf");
  assert.equal(position.marketValue, null);
  assert.deepEqual(clean(preview.stats.totals), {});
  assert.ok(preview.warnings.some((warning) => warning.code === "market_value_unknown"));
});

test("valuation currency is retained independently from security currency", async () => {
  const preview = await parse(
    csv([row({ "Market Price Currency": "USD", "Market Value Currency": "CAD" })]),
  );
  assert.equal(preview.resourceContent.data.accounts[0].positions[0].currency, "USD");
  assert.equal(preview.resourceContent.data.accounts[0].positions[0].marketValue.currency, "CAD");
  assert.deepEqual(clean(preview.stats.totals), { CAD: "125" });
  assert.ok(preview.warnings.some((warning) => warning.code === "market_value_currency_differs"));
});

test("account selection excludes unselected private holdings; stable account IDs are owner-scoped", async () => {
  const text = csv([
    row(),
    row({
      "Account Number": "SYNTH_ACCOUNT_B_1234",
      "Account Name": "Synthetic RRSP",
      Symbol: "SECOND",
    }),
  ]);
  const preview = await parse(text);
  const selected = selectHoldingsAccounts(preview, [preview.accounts[1].accountId]);
  assert.equal(selected.accounts.length, 2);
  assert.equal(selected.resourceContent.data.accounts.length, 1);
  assert.equal(selected.resourceContent.data.accounts[0].positions[0].symbol, "SECOND");
  assert.equal(JSON.stringify(selected.resourceContent).includes('"symbol":"SYNTH"'), false);
  assert.equal(selected.resourceContent.coverage.state, "partial");
  assert.equal(
    selectHoldingsAccounts(selected, preview.selectedAccountIds).resourceContent.data.accounts
      .length,
    2,
  );
  const again = await parse(text);
  const foreign = await parse(text, { ownerUid: "synthetic_owner_b" });
  assert.equal(again.accounts[0].accountId, preview.accounts[0].accountId);
  assert.notEqual(foreign.accounts[0].accountId, preview.accounts[0].accountId);
  assert.throws(() => selectHoldingsAccounts(preview, []), { code: "invalid_account_selection" });
  assert.throws(() => selectHoldingsAccounts(preview, ["foreign"]), {
    code: "invalid_account_selection",
  });
  assert.throws(() => selectHoldingsAccounts(clean(preview), preview.selectedAccountIds), {
    code: "invalid_preview",
  });
});

test("account labels mask full identifiers including short numbers and embedded long numeric labels", async () => {
  const preview = await parse(
    csv([row({ "Account Number": "123", "Account Name": "Account 123 number 999999999" })]),
  );
  const name = preview.accounts[0].displayName;
  assert.equal(name.includes("123"), false);
  assert.equal(name.includes("999999999"), false);
});

test("non-holdings brokers/activity CSV and changed/duplicated headers fail explicitly", async () => {
  await rejects("unsupported_broker", () => parse(csv([row()]), { brokerId: "robinhood" }));
  await rejects("unsupported_headers", () =>
    parse("Activity Date,Instrument,Quantity\n2026-10-01,SYNTH,3"),
  );
  await rejects("unsupported_headers", () =>
    parse(csv([row()], { columns: [...headers, "Unexpected"] })),
  );
  await rejects("unsupported_headers", () =>
    parse(csv([row()], { columns: [...headers.slice(0, -1), headers[0]] })),
  );
  assert.equal(HOLDINGS_CSV_ADAPTERS.filter((entry) => entry.enabled).length, 1);
});

test("malformed records, quotes and unknown footer do not silently drop data", async () => {
  await rejects("invalid_csv", () => parse(csv([row()], { footer: null }) + '\n"unterminated'));
  await rejects("invalid_csv", () => parse(csv([row()], { footer: null }) + '\n"closed"garbage'));
  await rejects("invalid_row_width", () => parse(csv([row()], { footer: "Unknown note" })));
  await rejects("invalid_row_width", () =>
    parse(csv([row()], { footer: null }) + "\nmissing,columns"),
  );
  await rejects("invalid_csv", () => parse(csv([row({ Name: "hidden\0character" })])));
});

test("footer dates are date-only metadata, missing dates remain unknown, invalid dates reject", async () => {
  const noDate = await parse(csv([row()], { footer: null }));
  assert.equal(noDate.reportDate, null);
  assert.equal(noDate.resourceContent.sourceAsOf, null);
  await rejects("invalid_report_date", () =>
    parse(csv([row()], { footer: "Data as of: 2026-02-31" })),
  );
  await rejects("invalid_report_date", () =>
    parse(csv([row()], { footer: "Data as of: 2026-99-99" })),
  );
  await rejects("invalid_report_date", () =>
    parse(csv([row()], { footer: "Data as of: October unknown" })),
  );
});

test("numbers reject lossy decimals, exponent, invalid grouping, unknown quantities and negative long values", async () => {
  for (const quantity of ["1e10", "1,2", "NaN", "Infinity", "--", "0.0000000000001"]) {
    await assert.rejects(
      () => parse(csv([row({ Quantity: quantity })])),
      (error) => error.code === "invalid_number" || error.code === "number_out_of_range",
    );
  }
  await rejects("number_out_of_range", () =>
    parse(csv([row({ Quantity: "100000000000000000000" })])),
  );
  await rejects("invalid_market_value", () => parse(csv([row({ "Market Value": "-3" })])));
  const normalized = await parse(csv([row({ Quantity: "00001.230000000000000" })]));
  assert.equal(normalized.resourceContent.data.accounts[0].positions[0].quantity, "1.23");
});

test("file, field, account and formal private payload budgets fail before any partial truncation", async () => {
  await rejects("file_too_large", () => parse("a".repeat(HOLDINGS_CSV_MAX_BYTES + 1)));
  await rejects("field_too_large", () => parse(csv([row({ Name: "a".repeat(2049) })])));
  await rejects("too_many_accounts", () =>
    parse(
      csv(Array.from({ length: 11 }, (_, i) => row({ "Account Number": `SYNTH_ACCOUNT_${i}` }))),
    ),
  );
  const many = Array.from({ length: 600 }, (_, i) =>
    row({ Symbol: `SYNTH${i}`, Name: "Synthetic security " + "x".repeat(100) }),
  );
  await rejects("resource_too_large", () => parse(csv(many)));
  assert.ok(HOLDINGS_RESOURCE_MAX_BYTES < 196_608);
});

test("excluded-asset and position limits are enforced without dropping excess rows", async () => {
  const manyExcluded = Array.from({ length: 101 }, (_, i) =>
    row({ Symbol: `SYNTH${i}`, "Security Type": "CRYPTO" }),
  );
  await rejects("too_many_exclusions", () => parse(csv(manyExcluded)));
  const tooManyPositions = Array.from({ length: 1001 }, (_, i) => row({ Symbol: `SYNTH${i}` }));
  await rejects("too_many_positions", () => parse(csv(tooManyPositions)));
});

test("import context is required, valid UTC and does not expose CSV contents in errors", async () => {
  await rejects("invalid_import_context", () => parse(csv([row()]), { ownerUid: "" }));
  await rejects("invalid_import_context", () => parse(csv([row()]), { snapshotId: undefined }));
  await rejects("invalid_import_context", () => parse(csv([row()]), { importedAt: "2026-10-22" }));
  await rejects("invalid_import_context", () =>
    parse(csv([row()]), { importedAt: "2026-02-31T00:00:00Z" }),
  );
  try {
    await parse(csv([row({ Quantity: "SENSITIVE_SENTINEL" })]));
  } catch (error) {
    assert.equal(
      JSON.stringify({ message: error.message, code: error.code, row: error.row }).includes(
        "SENSITIVE_SENTINEL",
      ),
      false,
    );
  }
});
