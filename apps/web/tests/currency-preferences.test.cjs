const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { compile, settle } = require("./resource-library-helpers.cjs");
function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}
const contract = compile("../lib/currency-preferences.ts");
const { CurrencyPreferenceStore } = compile(
  "../lib/currency-preferences-store.ts",
  {
    "./currency-preferences": contract,
  },
  { setTimeout, clearTimeout },
);
const snapshot = (
  code = null,
  version = code === null ? 0 : 1,
  generation = code === null ? 0 : 1,
) => ({
  contractVersion: "folioview.valuation.v1",
  profile: "folioview.currency-preferences.v2",
  preferences: code === null ? null : { defaultPortfolioCurrency: code },
  version,
  currencyGeneration: generation,
});
const reply = (value, status = 200) => Response.json(value, { status });
const clean = (value) => JSON.parse(JSON.stringify(value));
function store(owner = "owner_A", timeout) {
  const requests = [],
    states = [];
  const value = new CurrencyPreferenceStore(
    owner,
    (path, options) => {
      const pending = deferred();
      requests.push({ path, options, pending });
      return pending.promise;
    },
    (state) => states.push(state),
    timeout,
  );
  value.start();
  return { value, requests, states };
}
test("small currency reader matches the shared enum and rejects malformed saved state", () => {
  const schema = JSON.parse(
    readFileSync(
      path.join(__dirname, "../../../services/common/folioview_shared/valuation_schemas.json"),
    ),
  );
  assert.deepEqual(clean(contract.PORTFOLIO_CURRENCIES), schema.$defs.Currency.enum);
  assert.equal(
    contract.effectivePortfolioCurrency(contract.readCurrencyPreferences(snapshot())),
    "USD",
  );
  for (const bad of [
    { ...snapshot(), version: 1 },
    { ...snapshot("CAD"), currencyGeneration: 0 },
    { ...snapshot("CAD"), currencyGeneration: 2 },
    { ...snapshot("CAD"), version: 2 ** 53 },
    { ...snapshot("CAD"), owner: "other" },
    { ...snapshot("CAD"), preferences: { defaultPortfolioCurrency: "cad" } },
    { ...snapshot("CAD"), preferences: { defaultPortfolioCurrency: "CAD", theme: "dark" } },
  ])
    assert.throws(() => contract.readCurrencyPreferences(bad));
  assert.throws(() =>
    contract.currencyUpdate({
      expectedVersion: 1,
      defaultPortfolioCurrency: "USD",
      language: "en",
    }),
  );
});
test("confirmed absence resolves USD without creating a preference or touching legacy UI settings", async () => {
  const app = store();
  try {
    assert.equal(app.value.state.snapshot, null);
    app.requests[0].pending.resolve(reply(snapshot()));
    await settle();
    assert.equal(app.value.state.status, "saved");
    assert.equal(app.value.state.selected, "USD");
    app.value.select("USD");
    await settle();
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].path, "/api/v2/preferences/currency");
  } finally {
    app.value.dispose();
  }
});
test("rapid changes serialize confirmed CAS saves while preserving the latest choice", async () => {
  const app = store();
  try {
    app.requests[0].pending.resolve(reply(snapshot("CNY", 4, 2)));
    await settle();
    app.value.select("CAD");
    app.value.select("EUR");
    assert.equal(app.value.state.selected, "EUR");
    assert.deepEqual(clean(app.requests[1].options.json), {
      expectedVersion: 4,
      defaultPortfolioCurrency: "CAD",
    });
    app.requests[1].pending.resolve(reply(snapshot("CAD", 5, 3)));
    await settle();
    assert.deepEqual(clean(app.requests[2].options.json), {
      expectedVersion: 5,
      defaultPortfolioCurrency: "EUR",
    });
    app.requests[2].pending.resolve(reply(snapshot("EUR", 6, 4)));
    await settle();
    assert.equal(app.value.state.selected, "EUR");
    assert.equal(app.value.state.status, "saved");
    assert.equal(app.value.state.snapshot.currencyGeneration, 4);
    assert.ok(app.requests.every((r) => r.path === contract.CURRENCY_PREFERENCES_PATH));
  } finally {
    app.value.dispose();
  }
});
test("an unknown successful write is read back before retry and never increments its version twice", async () => {
  const app = store();
  try {
    app.requests[0].pending.resolve(reply(snapshot("USD")));
    await settle();
    app.value.select("CAD");
    app.requests[1].pending.reject(new Error("synthetic lost reply"));
    await settle();
    assert.equal(app.value.state.error, "save");
    assert.equal(app.value.state.snapshot.preferences.defaultPortfolioCurrency, "USD");
    app.value.retry();
    assert.equal(app.requests[2].options.method, "GET");
    app.requests[2].pending.resolve(reply(snapshot("CAD", 2, 2)));
    await settle();
    assert.equal(app.value.state.error, null);
    assert.equal(app.value.state.status, "saved");
    assert.equal(app.requests.filter((r) => r.options.method === "PUT").length, 1);
  } finally {
    app.value.dispose();
  }
});
test("returning to the original value during an unknown write retains that latest intent", async () => {
  const app = store();
  try {
    app.requests[0].pending.resolve(reply(snapshot("USD")));
    await settle();
    app.value.select("CAD");
    app.value.select("USD");
    app.requests[1].pending.reject(new Error("synthetic lost reply"));
    await settle();
    app.value.retry();
    app.requests[2].pending.resolve(reply(snapshot("CAD", 2, 2)));
    await settle();
    assert.deepEqual(clean(app.requests[3].options.json), {
      expectedVersion: 2,
      defaultPortfolioCurrency: "USD",
    });
    app.requests[3].pending.resolve(reply(snapshot("USD", 3, 3)));
    await settle();
    assert.equal(app.value.state.selected, "USD");
    assert.equal(app.value.state.status, "saved");
  } finally {
    app.value.dispose();
  }
});
test("conflicts reload current versions, stop after two reloads and retain a retryable draft", async () => {
  const app = store();
  try {
    app.requests[0].pending.resolve(reply(snapshot("USD")));
    await settle();
    app.value.select("CAD");
    app.requests[1].pending.resolve(reply({}, 409));
    await settle();
    app.requests[2].pending.resolve(reply(snapshot("USD", 2, 1)));
    await settle();
    app.requests[3].pending.resolve(reply({}, 409));
    await settle();
    app.requests[4].pending.resolve(reply(snapshot("USD", 3, 1)));
    await settle();
    app.requests[5].pending.resolve(reply({}, 409));
    await settle();
    assert.equal(app.requests.length, 6);
    assert.equal(app.value.state.error, "save");
    assert.equal(app.value.state.selected, "CAD");
  } finally {
    app.value.dispose();
  }
});
test("a failed reconciliation or malformed save never becomes a blind follow-up write", async () => {
  const app = store();
  try {
    app.requests[0].pending.resolve(reply(snapshot("USD")));
    await settle();
    app.value.select("CAD");
    app.requests[1].pending.resolve(reply(snapshot("CAD", 2, 1)));
    await settle();
    assert.equal(app.value.state.error, "save"); // currency changed without advancing its semantic generation
    app.value.retry();
    app.requests[2].pending.resolve(reply({}, 503));
    await settle();
    assert.equal(app.requests.length, 3);
    assert.equal(app.value.state.error, "save");
    assert.equal(app.value.state.snapshot.version, 1);
  } finally {
    app.value.dispose();
  }
});
test("timeouts, cancellation and late responses cannot replace a newer confirmed snapshot", async () => {
  const app = store("owner_A", 5);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(app.value.state.error, "load");
    assert.equal(app.requests[0].options.signal.aborted, true);
    app.value.retry();
    app.requests[1].pending.resolve(reply(snapshot("EUR")));
    await settle();
    app.requests[0].pending.resolve(reply(snapshot("CNY", 2, 2)));
    await settle();
    assert.equal(app.value.state.selected, "EUR");
    assert.equal(app.requests.length, 2);
  } finally {
    app.value.dispose();
  }
});
test("currency response bodies are byte-bounded, typed and abortable", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() =>
    contract.readCurrencyResponse(
      new Response(" ".repeat(4097), { headers: { "Content-Type": "application/json" } }),
      signal,
    ),
  );
  await assert.rejects(() =>
    contract.readCurrencyResponse(
      new Response("{}", { headers: { "Content-Type": "application/json-other" } }),
      signal,
    ),
  );
  await assert.rejects(() =>
    contract.readCurrencyResponse(reply({ ...snapshot(), unexpected: true }), signal),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => contract.readCurrencyResponse(reply(snapshot()), controller.signal));
});

function mountCurrency(owner = "owner_A") {
  const requests = [],
    cells = [],
    effects = [];
  let index = 0,
    dirty = false;
  const requestPrivate = (service, path, actor, options) => {
    const pending = deferred();
    requests.push({ service, path, actor, options, pending });
    return pending.promise;
  };
  let auth = { status: owner ? "authenticated" : "anonymous", sessionKey: owner, requestPrivate };
  const changed = (a, b) => !a || b.some((value, i) => a[i] !== value);
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useState: (value) => {
      const i = index++;
      cells[i] ??= { value };
      return [
        cells[i].value,
        (v) => {
          dirty ||= !Object.is(cells[i].value, v);
          cells[i].value = v;
        },
      ];
    },
    useRef: (value) => {
      const i = index++;
      cells[i] ??= { current: value };
      return cells[i];
    },
    useMemo: (fn, deps) => {
      const i = index++;
      if (!cells[i] || changed(cells[i].deps, deps)) cells[i] = { deps, value: fn() };
      return cells[i].value;
    },
    useCallback: (fn, deps) => {
      const i = index++;
      if (!cells[i] || changed(cells[i].deps, deps)) cells[i] = { deps, value: fn };
      return cells[i].value;
    },
    useEffect: (effect, deps) => {
      const i = index++;
      if (!cells[i] || changed(cells[i].deps, deps)) {
        effects.push({ i, effect });
        cells[i] = { deps, cleanup: cells[i]?.cleanup };
      }
    },
  };
  const provider = compile("../components/CurrencyPreferencesProvider.tsx", {
    react,
    "react/jsx-runtime": { jsx: (_, props) => ({ props }) },
    "./AuthProvider": { useAuth: () => auth },
    "@/lib/currency-preferences-store": { CurrencyPreferenceStore },
    "@/lib/currency-preferences": contract,
  });
  return {
    requests,
    owner(next) {
      auth = { ...auth, status: next ? "authenticated" : "anonymous", sessionKey: next };
    },
    render(flush = true) {
      let tree;
      do {
        index = 0;
        dirty = false;
        tree = provider.CurrencyPreferencesProvider({ children: null });
        if (flush)
          for (const { i, effect } of effects.splice(0)) {
            cells[i].cleanup?.();
            cells[i].cleanup = effect();
          }
      } while (flush && dirty);
      return tree.props.value;
    },
    dispose() {
      for (const cell of cells) cell?.cleanup?.();
    },
  };
}
test("provider masks an old account before cleanup, rejects old callbacks and retains route state", async () => {
  const app = mountCurrency();
  try {
    app.render();
    app.requests[0].pending.resolve(reply(snapshot("CNY")));
    await settle();
    const old = app.render();
    assert.equal(old.defaultPortfolioCurrency, "CNY");
    app.owner("owner_B");
    const masked = app.render(false);
    assert.equal(masked.defaultPortfolioCurrency, null);
    assert.equal(masked.loaded, false);
    old.select("CAD");
    assert.equal(app.requests.length, 1);
    app.render();
    assert.equal(app.requests.length, 2);
    assert.equal(app.requests[1].actor, "owner_B");
    app.requests[1].pending.resolve(reply(snapshot("EUR")));
    await settle();
    const current = app.render();
    assert.equal(current.defaultPortfolioCurrency, "EUR");
    for (let n = 0; n < 4; n++) app.render();
    assert.equal(app.requests.length, 2);
    old.retry();
    old.select("USD");
    assert.equal(app.requests.length, 2);
    app.owner(null);
    const guest = app.render(false);
    assert.equal(guest.defaultPortfolioCurrency, "USD");
    assert.equal(guest.snapshot, null);
    app.render();
  } finally {
    app.dispose();
  }
});

test("provider cancels an unresolved old-account read before accepting another account's reply", async () => {
  const app = mountCurrency();
  try {
    const old = app.render();
    app.owner("owner_B");
    app.render();
    assert.equal(app.requests[0].options.signal.aborted, true);
    app.requests[1].pending.resolve(reply(snapshot("EUR")));
    await settle();
    app.requests[0].pending.resolve(reply(snapshot("CNY")));
    await settle();
    old.select("CAD");
    assert.equal(app.render().defaultPortfolioCurrency, "EUR");
    assert.equal(app.requests.length, 2);
  } finally {
    app.dispose();
  }
});
