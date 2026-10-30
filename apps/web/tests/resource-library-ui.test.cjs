const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createTranslator } = require("next-intl");
const {
  compile,
  contracts,
  catalogue,
  channels,
  stocks,
} = require("./resource-library-helpers.cjs");
const loaded = (data) => ({ data, loading: false, error: "", stale: false });
function model(patch = {}) {
  return {
    owner: "owner_A:1",
    authenticated: true,
    configured: true,
    catalogue: loaded(catalogue()),
    watchlist: loaded(stocks()),
    follows: loaded(channels()),
    busy: false,
    writeError: "",
    reload() {},
    saveFollows() {},
    useForTask() {},
    ...patch,
  };
}
function render(value, { locale = "en", onCreateTask } = {}) {
  const messages = require(`../messages/${locale}.json`);
  const { ResourceLibraryView } = compile("../components/ResourceLibrary.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next-intl": {
      useTranslations: (namespace) => createTranslator({ locale, messages, namespace }),
    },
    "./useResourceLibrary": {},
    "@/lib/resource-library": contracts,
    "./ResourceLibrary.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_object, name) => name }),
    },
  });
  return renderToStaticMarkup(
    React.createElement(
      ResourceLibraryView,
      { model: value, onCreateTask, onOpenWatchlist() {} },
      React.createElement("p", null, "EXISTING_ENCRYPTED_HOLDINGS"),
    ),
  );
}

test("three-kind library reuses Market watchlist and manual follows without broker/agent claims", () => {
  const html = render(model());
  assert.ok(html.includes("All resources"));
  assert.ok(html.includes("YouTube follows"));
  assert.ok(html.includes("Holdings"));
  assert.ok(html.includes("EXISTING_ENCRYPTED_HOLDINGS"));
  assert.ok(html.includes("SYNTH"));
  assert.ok(html.includes("Manage in Market"));
  assert.ok(html.includes("No YouTube account connection"));
  assert.ok(html.includes("not protected by the holdings passkey"));
  assert.ok(html.includes("not independently verified"));
  assert.ok(html.includes("Edit"));
  assert.ok(html.includes("Remove"));
  assert.ok(!html.includes("Use in task"));
  assert.ok(!html.includes("Market value"));
  assert.ok(!html.includes("Weight"));
});

test("source failure stays unavailable while empty lists have explicit distinct guidance", () => {
  const failed = render(model({ watchlist: { ...loaded(null), error: "unavailable" } }));
  assert.ok(failed.includes("Its contents are not confirmed empty"));
  assert.ok(!failed.includes("Your watchlist is empty"));
  const empty = render(
    model({
      watchlist: loaded({ items: [], limit: 50 }),
      follows: loaded({ revision: 0, items: [], limit: 50 }),
    }),
  );
  assert.ok(empty.includes("without connecting a broker"));
  assert.ok(empty.includes("No creators yet"));
  assert.ok(empty.includes("Add creator"));
});

test("metadata task CTA requires consumer callback and hides pending/revoked/empty pointers", () => {
  const value = catalogue();
  for (const state of ["pending", "revoking", "disconnected", "deleted", "empty", "unavailable"]) {
    const current = structuredClone(value);
    current.groups.forEach((group) => group.items.forEach((item) => (item.state = state)));
    assert.ok(
      !render(model({ catalogue: loaded(current) }), { onCreateTask() {} }).includes("Use in task"),
    );
  }
  const html = render(model(), { onCreateTask() {} });
  assert.equal((html.match(/Use in task/g) || []).length, 3);
  assert.ok(html.includes("does not authorize an agent"));
  assert.ok(html.includes("saved task and run evidence keeps its original version"));
});

test("account unavailable UI omits private list rows and escapes manual text in both languages", () => {
  const follows = channels('<img src=x onerror="bad">');
  follows.items[0].note = "<script>private</script>";
  const html = render(model({ follows: loaded(follows) }));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script>"));
  const guest = render(model({ authenticated: false, owner: null }));
  assert.ok(!guest.includes("Synthetic Creator"));
  assert.ok(!guest.includes("SYNTH"));
  assert.ok(guest.includes("Sign in with Google"));
  const zh = render(model(), { locale: "zh" });
  assert.ok(zh.includes("自选股"));
  assert.ok(zh.includes("手动维护创作者名单"));
  assert.ok(zh.includes("不受持仓通行密钥加密保护"));
});
