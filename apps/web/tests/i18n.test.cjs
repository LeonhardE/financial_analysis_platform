const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const { createTranslator } = require("next-intl");
const catalogs = { en: require("../messages/en.json"), zh: require("../messages/zh.json") };

function leaves(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  );
}
const source = readFileSync(path.join(__dirname, "../lib/ui-messages.ts"), "utf8");
const { code } = transformSync(source, {
  filename: "ui-messages.ts",
  jsc: { parser: { syntax: "typescript" }, target: "es2022" },
  module: { type: "commonjs" },
});
const compiled = { exports: {} };
vm.runInNewContext(code, { module: compiled, exports: compiled.exports });
const { localizeMessage } = compiled.exports;

test("English and Chinese catalogs cover identical keys and compile every ICU message", () => {
  assert.deepEqual(
    leaves(catalogs.en)
      .map(([key]) => key)
      .sort(),
    leaves(catalogs.zh)
      .map(([key]) => key)
      .sort(),
  );
  for (const [locale, messages] of Object.entries(catalogs)) {
    const t = createTranslator({
      locale,
      messages,
      onError: (error) => {
        throw error;
      },
    });
    for (const [key, message] of leaves(messages)) {
      const values = Object.fromEntries(
        [...message.matchAll(/\{(\w+)\}/g)].map(([, name]) => [
          name,
          name === "count" ? 5 : "sample",
        ]),
      );
      assert.ok(t(key, values).length > 0, `${locale}:${key}`);
    }
  }
});

test("application errors and dynamic watchlist feedback use the chosen language", () => {
  const t = createTranslator({ locale: "zh", messages: catalogs.zh });
  for (const message of [
    "Market data is temporarily unavailable. Please try again later.",
    "Could not finish signing out. Please try again.",
    "Could not restore your session. Please try again.",
  ]) {
    const translated = localizeMessage(message, t, "zh");
    assert.match(translated, /[\u4e00-\u9fff]/);
    assert.ok(!translated.includes(message));
  }
  assert.equal(
    localizeMessage("AAPL added to your watchlist.", t, "zh"),
    t("watchlist.added", { symbol: "AAPL" }),
  );
  assert.equal(
    localizeMessage("Some quotes could not be refreshed: AAPL, MSFT.", t, "zh"),
    t("errors.partialQuotes", { symbols: "AAPL, MSFT" }),
  );
});
