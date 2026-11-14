const test = require("node:test");
const assert = require("node:assert/strict");
const { compile } = require("./resource-library-helpers.cjs");
const { hooks, jsx, all } = require("./resource-ui-harness.cjs");
const facts = compile("../lib/holdings-facts.ts"),
  currency = compile("../lib/currency-preferences.ts");
const searchContract = compile("../lib/instrument-search.ts", {
  "./currency-preferences": currency,
});
const item = {
  symbol: "SHOP",
  market: "XNYS",
  currency: "USD",
  name: "Synthetic",
  assetType: "stock",
};
const response = (patch = {}) => ({
  profile: "folioview.instrument-search.v1",
  items: [item],
  status: "available",
  complete: true,
  fetchedAt: "2026-11-14T06:00:00Z",
  reason: null,
  ...patch,
});
const reply = (value) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { resolve, promise };
};
function mount(patch = {}, loader = async () => reply(response())) {
  const h = hooks(),
    calls = [],
    requests = [];
  let closed = 0;
  const model = {
    authenticated: true,
    owner: "owner_A",
    vaultGeneration: 1,
    selectedSourceId: "source_A",
    phase: "unlocked",
    content: null,
    busy: null,
    hasPending: false,
    error: "",
    stagePositionEdit: (...args) => {
      calls.push(args);
      return true;
    },
    ...patch,
  };
  const props = {
    model,
    editing: {
      accountId: null,
      assetId: null,
      snapshotId: model.content?.data.snapshotId ?? null,
      scope: "editor_scope_A",
    },
    onClose: () => closed++,
  };
  const t = (key) => key;
  t.has = () => true;
  const view = compile(
    "../components/HoldingsEditor.tsx",
    {
      react: h.react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "next-intl": { useTranslations: () => t },
      "@/lib/holdings-facts": facts,
      "@/lib/instrument-search": searchContract,
      "@/lib/currency-preferences": currency,
      "./ResourcesPanel.module.css": { default: {} },
    },
    {
      process: { env: {} },
      setTimeout,
      clearTimeout,
      fetch: async (...args) => {
        requests.push(args);
        return loader(...args);
      },
    },
  );
  return {
    model,
    props,
    calls,
    requests,
    closed: () => closed,
    close: h.close,
    render: () => h.render(() => view.default(props)),
  };
}
function field(tree, name) {
  const label = all(
    tree,
    (n) => n.type === "label" && Array.isArray(n.props.children) && n.props.children[0] === name,
  )[0];
  assert.ok(label, name);
  return all(label, (n) => n.type === "input" || n.type === "select")[0];
}
const button = (tree, name) =>
  all(tree, (n) => n.type === "button" && n.props.children === name)[0];
const submit = (app) =>
  all(app.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
function fill(app) {
  for (const [name, value] of [
    ["ticker", "SHOP"],
    ["quantity", "2.5"],
    ["unitCost", "10.25"],
  ])
    field(app.render(), name).props.onChange({ target: { value } });
}
test("new position uses one query-only request, confirms a unique listing and stages a local review before any save", async () => {
  const app = mount();
  fill(app);
  submit(app);
  assert.equal(app.calls.length, 0, "unresolved ticker cannot stage a position");
  button(app.render(), "search").props.onClick();
  await tick();
  assert.equal(app.requests.length, 1);
  const [url, options] = app.requests[0];
  assert.match(url, /\/api\/valuation\/instruments\/search$/);
  assert.equal(options.credentials, "omit");
  assert.deepEqual(JSON.parse(options.body), { query: "SHOP" });
  assert.equal(options.headers.Authorization, undefined);
  submit(app);
  assert.equal(app.calls.length, 1);
  const [draft, expected, account] = app.calls[0];
  assert.equal(draft.instrument.market, "XNYS");
  assert.equal(draft.quantity, "2.5");
  assert.equal(draft.unitCost, "10.25");
  assert.equal(expected, null);
  assert.equal(app.calls[0][3], "editor_scope_A");
  assert.equal(account.accountId, "manual_account");
  assert.equal(app.closed(), 1);
  app.close();
});
test("ambiguous and incomplete results require explicit market choice; currency mismatch never stages", async () => {
  for (const result of [
    response({ items: [item, { ...item, market: "XTSE", currency: "CAD" }] }),
    response({ complete: false }),
  ]) {
    const app = mount({}, async () => reply(result));
    fill(app);
    button(app.render(), "search").props.onClick();
    await tick();
    submit(app);
    assert.equal(app.calls.length, 0);
    const choices = all(
      app.render(),
      (n) => n.type === "button" && all(n, (child) => child.type === "strong").length,
    );
    assert.equal(choices.length, result.items.length);
    choices.at(-1).props.onClick();
    field(app.render(), "currency").props.onChange({ target: { value: "CNY" } });
    submit(app);
    assert.equal(app.calls.length, 0);
    field(app.render(), "currency").props.onChange({
      target: { value: result.items.at(-1).currency },
    });
    submit(app);
    assert.equal(app.calls.length, 1);
    app.close();
  }
});
test("ticker edits and closing cancel the pending search; ignored late responses cannot select another listing", async () => {
  const pending = deferred(),
    app = mount({}, () => pending.promise);
  fill(app);
  button(app.render(), "search").props.onClick();
  const signal = app.requests[0][1].signal;
  field(app.render(), "ticker").props.onChange({ target: { value: "OTHER" } });
  assert.equal(signal.aborted, true);
  pending.resolve(reply(response()));
  await tick();
  submit(app);
  assert.equal(app.calls.length, 0);
  assert.equal(field(app.render(), "ticker").props.value, "OTHER");
  app.close();
  const stalled = deferred(),
    closing = mount({}, () => stalled.promise);
  fill(closing);
  button(closing.render(), "search").props.onClick();
  const closingSignal = closing.requests[0][1].signal;
  closing.close();
  assert.equal(closingSignal.aborted, true);
  stalled.resolve(reply(response()));
  await tick();
  assert.equal(closing.calls.length, 0);
});
test("existing unknown costs may stay blank, zero quantity requires removal confirmation, and a lock renders nothing", () => {
  const content = facts.editHoldings({
    content: null,
    base: null,
    snapshotId: "snapshot_A",
    at: "2026-11-14T06:00:00Z",
    newAccount: { accountId: "account_A", displayName: "A" },
    edit: {
      accountId: "account_A",
      assetId: null,
      instrument: item,
      quantity: "2",
      unitCost: "10",
    },
  });
  content.data.accounts[0].positions[0].unitCost = null;
  const app = mount({ content });
  app.props.editing = {
    accountId: "account_A",
    assetId: content.data.accounts[0].positions[0].assetId,
    snapshotId: "snapshot_A",
    scope: "editor_scope_A",
  };
  assert.equal(field(app.render(), "unitCost").props.value, "");
  field(app.render(), "quantity").props.onChange({ target: { value: "0.00" } });
  const checkbox = all(app.render(), (n) => n.type === "input" && n.props.type === "checkbox")[0];
  assert.ok(checkbox);
  checkbox.props.onChange({ target: { checked: true } });
  submit(app);
  assert.equal(app.calls[0][0].removeConfirmed, true);
  assert.equal(app.calls[0][1], "snapshot_A");
  app.model.phase = "locked";
  assert.equal(app.render(), null);
  app.close();
});
test("search response rejects extra/private fields, duplicate identities, bad currency and oversized/aborted streams", async () => {
  for (const bad of [
    { ...response(), account: "private" },
    response({ items: [item, item] }),
    response({ items: [{ ...item, currency: "ZZZ" }] }),
    response({ items: [{ ...item, market: "UNKNOWN" }] }),
    response({ fetchedAt: null }),
    response({ status: "missing" }),
  ])
    assert.throws(() => searchContract.instrumentSearch(bad));
  const controller = new AbortController();
  await assert.rejects(() =>
    searchContract.readInstrumentSearch(
      reply({ ...response(), big: "x".repeat(17000) }),
      controller.signal,
    ),
  );
  controller.abort();
  await assert.rejects(() =>
    searchContract.readInstrumentSearch(reply(response()), controller.signal),
  );
  assert.equal(
    (await searchContract.readInstrumentSearch(reply(response()), new AbortController().signal))
      .items[0].market,
    "XNYS",
  );
});
