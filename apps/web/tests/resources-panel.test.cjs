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
