const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const React = require("react");
const jsxRuntime = require("react/jsx-runtime");
const { renderToStaticMarkup } = require("react-dom/server");
const { createTranslator } = require("next-intl");
const { transformSync } = require("next/dist/build/swc");
const { code } = transformSync(
  readFileSync(path.join(__dirname, "../components/ResourcesPanel.tsx"), "utf8"),
  {
    filename: "ResourcesPanel.tsx",
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  },
);
function render(model, locale = "en") {
  const messages = require(`../messages/${locale}.json`);
  const imports = {
    react: React,
    "./PasskeyHelp": { PasskeyHelp: () => null },
    "./ResourceLibrary": { __esModule: true, default: ({ children }) => children },
    "react/jsx-runtime": jsxRuntime,
    "next-intl": {
      useTranslations: (namespace) => createTranslator({ locale, messages, namespace }),
    },
    "@/components/useHoldingsWorkspace": { useHoldingsWorkspace: () => model },
    "./ResourcesPanel.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_object, name) => name }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in imports, name);
      return imports[name];
    },
  });
  return renderToStaticMarkup(
    React.createElement(module.exports.default, { onOpenWatchlist: () => {} }),
  );
}
const base = {
  authenticated: false,
  configured: true,
  authStatus: "anonymous",
  phase: "checking",
  busy: null,
  preview: null,
  content: null,
  hasPending: false,
  error: "",
  errorRow: null,
  notice: "",
  signIn() {},
  create() {},
  unlock() {},
  lock() {},
  reload() {},
  readStored() {},
  importFile() {},
  save() {},
  selectAccounts() {},
  discardPreview() {},
};
const content = {
  state: "ready",
  coverage: { state: "unknown", issues: [] },
  sourceAsOf: null,
  fetchedAt: "2026-10-28T19:00:00Z",
  freshness: "unknown",
  data: {
    kind: "holdings",
    snapshotId: "snapshot_a",
    accounts: [
      {
        accountId: "account_a",
        displayName: "Synthetic · ••••4821",
        balances: [{ currency: "CAD", cashBalance: null, buyingPower: null }],
        positions: [
          {
            assetId: "asset_a",
            symbol: "SYNTH",
            name: '<img src=x onerror="private">',
            exchange: "XSYN",
            currency: "CAD",
            quantity: "9007199254740993.000000000001",
            marketValue: { currency: "CAD", amount: "9007199254740993.000000000001" },
          },
        ],
      },
    ],
    excludedAssets: [],
  },
};

test("guest sees verified official export instructions and disabled future broker adapters", () => {
  const html = render(base);
  assert.ok(
    html.includes(
      "https://help.wealthsimple.com/hc/en-ca/articles/35654428540571-Request-a-custom-statement",
    ),
  );
  for (const step of [
    "Profile",
    "Documents",
    "Generate document",
    "Holdings report (CSV)",
    "As of date",
    "Download CSV",
  ])
    assert.ok(html.includes(step));
  assert.match(html, /disabled=""[^>]*><span[^>]*>R<\/span>/);
  assert.match(html, /disabled=""[^>]*><span[^>]*>IB<\/span>/);
  assert.ok(html.includes("Sign in with Google"));
  assert.ok(!html.includes('type="file"'));
  assert.ok(!html.includes("PRIVATE_SENTINEL"));
});

test("missing private origins show unavailable storage without fake success or import action", () => {
  const html = render({ ...base, authenticated: true, configured: false, phase: "unlocked" });
  assert.ok(html.includes("Holdings storage is not enabled"));
  assert.ok(!html.includes('type="file"'));
  assert.ok(!html.includes("Confirm, encrypt and save"));
  assert.ok(!html.includes("snapshot was saved"));
});

test("locked library does not render stale decrypted holdings even if a caller supplies them", () => {
  const html = render({ ...base, authenticated: true, phase: "locked", content });
  assert.ok(html.includes("Unlock with passkey"));
  assert.ok(!html.includes("9007199254740993"));
  assert.ok(!html.includes("onerror"));
});

test("a renewal-only session hides stale holdings and ordinary import or unlock actions", () => {
  for (const locale of ["en", "zh"]) {
    const html = render({ ...base, authenticated: true, phase: "renewal-only", content }, locale);
    assert.ok(html.includes(locale === "en" ? "Only key renewal is open" : "当前仅开放密钥续期"));
    assert.ok(!html.includes("9007199254740993"));
    assert.ok(!html.includes('type="file"'));
    assert.ok(!html.includes(locale === "en" ? "Unlock with passkey" : "使用通行密钥解锁"));
  }
});

test("unlocked private view escapes CSV text and retains all decimal precision", () => {
  const html = render({ ...base, authenticated: true, phase: "unlocked", content });
  assert.ok(html.includes("9,007,199,254,740,993.000000000001"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("Unknown"));
  assert.ok(html.includes("not a confirmed withdrawable balance or buying power"));
});

test("Chinese resources UI translates passkey errors and upload guide without a key-file workflow", () => {
  const html = render(
    { ...base, authenticated: true, phase: "locked", error: "passkey_unsupported" },
    "zh",
  );
  assert.ok(html.includes("通行密钥"));
  assert.ok(html.includes("不支持所需"));
  assert.ok(html.includes("不会改为上传明文"));
  assert.ok(html.includes("如何导出 Wealthsimple 持仓 CSV"));
  assert.ok(!html.includes('type="password"'));
  assert.ok(!html.includes('accept=".json"'));
});

const managedSource = {
  resourceRef: {
    kind: "holdings",
    sourceService: "portfolio",
    resourceId: "holdings_a",
    incarnation: "inc_a",
  },
  sourceEpoch: 2,
};
const managed = {
  ...base,
  authenticated: true,
  phase: "unlocked",
  canWriteState: true,
  sources: [managedSource],
  selectedSourceId: "holdings_a",
  newSource: false,
  sourceMetadata: {
    source: managedSource,
    authorityVersion: 3,
    revision: 1,
    snapshotId: "snapshot_a",
    snapshotSourceEpoch: 1,
    state: "active",
    pendingMutationId: null,
  },
};

test("source controls explain actual access effects without exposing internal source IDs", () => {
  for (const locale of ["en", "zh"]) {
    const html = render(managed, locale);
    assert.ok(html.includes(locale === "en" ? "Invalidate previous access" : "使旧授权失效"));
    assert.ok(html.includes(locale === "en" ? "previous scope" : "历史持仓"));
    assert.ok(!html.includes("inc_a"));
    assert.ok(!html.includes("sourceEpoch"));
  }
});

test("delete review states logical retention and copied-content limits in both languages", () => {
  for (const locale of ["en", "zh"]) {
    const html = render(
      {
        ...managed,
        sourceReview: { action: "delete", source: managedSource, authorityVersion: 3 },
      },
      locale,
    );
    assert.ok(html.includes("fieldset"));
    assert.ok(html.includes(locale === "en" ? "physical erasure" : "物理清除"));
    assert.ok(html.includes(locale === "en" ? "cannot be recalled" : "无法收回"));
    assert.ok(html.includes(locale === "en" ? "Cancel and keep" : "取消，保持"));
  }
});

test("pending or acknowledged deletion never renders stale supplied holdings plaintext", () => {
  for (const state of ["revoking", "deleted"]) {
    const html = render({
      ...managed,
      content,
      sourceMetadata: { ...managed.sourceMetadata, state },
      sourceMutation:
        state === "revoking"
          ? {
              action: "delete",
              state: "pending",
              operationId: "synthetic_delete_operation_0001",
              sourceEpoch: 2,
            }
          : null,
    });
    assert.ok(!html.includes("9007199254740993"));
    assert.ok(!html.includes("&lt;img"));
    assert.ok(!html.includes("snapshot was saved"));
  }
});

test("disconnected data retains readable owner history while the upload control is disabled", () => {
  const html = render({
    ...managed,
    content,
    sourceMetadata: { ...managed.sourceMetadata, state: "disconnected" },
  });
  assert.ok(html.includes("Existing holdings remain readable"));
  assert.ok(html.includes("9,007,199,254,740,993"));
  assert.match(html, /<input[^>]*type="file"[^>]*disabled/);
  assert.ok(html.includes("Add independent holdings data"));
});

test("locked and renewal-only phases hide source management and all prior private facts", () => {
  for (const phase of ["locked", "renewal-only"]) {
    const html = render({
      ...managed,
      phase,
      content,
      sourceReview: { action: "delete" },
      sourceMutation: { action: "delete" },
    });
    assert.ok(!html.includes("Manage holdings data"));
    assert.ok(!html.includes("9,007,199,254,740,993"));
    assert.ok(!html.includes("Confirm this change"));
  }
});

test("uncertain creation offers original-result recovery without declaring a completed upload", () => {
  const html = render({ ...managed, sourceCreationId: "source_synthetic_pending" });
  assert.ok(html.includes("Check original creation"));
  assert.ok(html.includes("without creating a duplicate"));
  assert.ok(html.includes("Only a request that can no longer be submitted"));
  assert.ok(!html.includes("snapshot was saved"));
  assert.match(html, /<input[^>]*type="file"[^>]*disabled/);
});
