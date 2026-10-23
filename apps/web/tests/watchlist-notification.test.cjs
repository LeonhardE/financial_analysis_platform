const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const jsx = require("react/jsx-runtime");
const { createTranslator } = require("next-intl");

function notification(locale, overrides = {}) {
  const { code } = transformSync(
    readFileSync(path.join(__dirname, "../components/WatchlistNotification.tsx"), "utf8"),
    {
      filename: "WatchlistNotification.tsx",
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        target: "es2022",
        transform: { react: { runtime: "automatic" } },
      },
      module: { type: "commonjs" },
    },
  );
  const module = { exports: {} };
  const imports = {
    "react/jsx-runtime": jsx,
    "next-intl": {
      useLocale: () => locale,
      useTranslations: () =>
        createTranslator({ locale, messages: require(`../messages/${locale}.json`) }),
    },
    "@/lib/ui-messages": {
      localizeMessage: (value, t) => t("watchlist.removed", { symbol: value.split(" ")[0] }),
    },
    "./WatchlistNotification.module.css": { __esModule: true, default: {} },
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  });
  let dismissed = false;
  const root = module.exports.WatchlistNotification({
    watchlist: {
      authenticated: true,
      message: "AAPL removed from your watchlist.",
      messageId: 2,
      dismissMessage: () => (dismissed = true),
      ...overrides,
    },
  });
  return { root, dismissed: () => dismissed };
}

test("watchlist confirmations are localized, announced politely and manually dismissible", () => {
  for (const locale of ["en", "zh"]) {
    const view = notification(locale);
    const [, status, button] = view.root.props.children;
    assert.equal(status.props.role, "status");
    assert.equal(status.props["aria-live"], "polite");
    assert.equal(status.props["aria-atomic"], "true");
    assert.match(status.props.children, /AAPL/);
    assert.equal(button.props["aria-label"], locale === "en" ? "Dismiss notification" : "关闭通知");
    button.props.onClick();
    assert.equal(view.dismissed(), true);
  }
});

test("signed-out sessions and expired confirmations render no notification", () => {
  assert.equal(notification("en", { authenticated: false }).root, null);
  assert.equal(notification("en", { message: "" }).root, null);
});
