const test = require("node:test");
const assert = require("node:assert/strict");
const { compile, settle } = require("./resource-library-helpers.cjs");
function deferred() {
  let resolve, reject;
  return {
    promise: new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    get resolve() {
      return resolve;
    },
    get reject() {
      return reject;
    },
  };
}
const contract = compile("../lib/language-preferences.ts");
const { LanguagePreferenceStore } = compile(
  "../lib/language-preferences-store.ts",
  { "./language-preferences": contract },
  { setTimeout, clearTimeout },
);
const snapshot = (language = null, version = language === null ? 0 : 1) => ({
  preferences: language === null ? null : { language },
  version,
});
const reply = (value, status = 200) => Response.json(value, { status });
const clean = (value) => JSON.parse(JSON.stringify(value));

test("language snapshots and CAS bodies remain closed and separate from frozen v1 preferences", () => {
  assert.deepEqual(clean(contract.UI_LANGUAGES), ["en", "zh", "zh-Hant"]);
  for (const language of contract.UI_LANGUAGES)
    assert.equal(
      contract.readLanguagePreferences(snapshot(language)).preferences.language,
      language,
    );
  for (const value of [
    snapshot("zh-TW"),
    { ...snapshot(), version: 1 },
    { ...snapshot("zh-Hant"), version: 0 },
    { ...snapshot("en"), owner: "other" },
    { preferences: { language: "en", theme: "dark" }, version: 1 },
    snapshot("en", 2 ** 53),
  ])
    assert.throws(() => contract.readLanguagePreferences(value));
  for (const value of [
    { language: "zh-Hant", expectedVersion: -1 },
    { language: "zh-Hant", expectedVersion: true },
    { language: "zh-Hant", expectedVersion: 0, owner: "other" },
  ])
    assert.throws(() => contract.languageUpdate(value));
});

test("confirmed absence inherits legacy language without writing, while an explicit Traditional choice persists", async () => {
  const requests = [];
  let remote = snapshot();
  const store = new LanguagePreferenceStore(
    "a",
    async (path, options) => {
      requests.push({ path, ...options });
      if (options.method === "PUT") remote = snapshot(options.json.language, remote.version + 1);
      return reply(remote);
    },
    () => {},
  );
  try {
    store.fallback("zh");
    store.start();
    await settle();
    assert.equal(store.state.selected, "zh");
    assert.equal(store.state.hasIntent, false);
    assert.deepEqual(
      requests.map((r) => r.method),
      ["GET"],
    );
    store.select("zh-Hant");
    await settle();
    assert.deepEqual(clean(requests[1].json), { language: "zh-Hant", expectedVersion: 0 });
    assert.equal(store.state.snapshot.preferences.language, "zh-Hant");
    assert.equal(store.state.hasIntent, false);
    store.fallback("en");
    assert.equal(store.state.selected, "zh-Hant");
    assert.ok(requests.every((r) => r.path === contract.LANGUAGE_PREFERENCES_PATH));
  } finally {
    store.dispose();
  }
});

test("lost language save acknowledgement is read back without another save and survives a fresh controller", async () => {
  const requests = [];
  let remote = snapshot(),
    fail = true;
  const request = async (_path, options) => {
    requests.push(options.method);
    if (options.method === "PUT") {
      remote = snapshot(options.json.language, remote.version + 1);
      if (fail) {
        fail = false;
        throw Error("lost reply");
      }
    }
    return reply(remote);
  };
  const store = new LanguagePreferenceStore("a", request, () => {});
  let restored;
  try {
    store.start();
    await settle();
    store.select("zh-Hant");
    await settle();
    assert.equal(store.state.error, "save");
    assert.equal(store.state.selected, "zh-Hant");
    assert.equal(store.state.hasIntent, true);
    store.retry();
    await settle();
    assert.deepEqual(requests, ["GET", "PUT", "GET"]);
    assert.equal(store.state.error, null);
    assert.equal(store.state.hasIntent, false);
    restored = new LanguagePreferenceStore("a", request, () => {});
    restored.start();
    await settle();
    assert.equal(restored.state.selected, "zh-Hant");
  } finally {
    store.dispose();
    restored?.dispose();
  }
});

test("rapid language changes serialize and an unknown outcome checks the current fence first", async () => {
  const requests = [],
    pending = [];
  const store = new LanguagePreferenceStore(
    "a",
    (_path, options) => {
      const d = deferred();
      requests.push(options);
      pending.push(d);
      return d.promise;
    },
    () => {},
  );
  try {
    store.start();
    pending[0].resolve(reply(snapshot("zh", 3)));
    await settle();
    store.select("zh-Hant");
    store.select("en");
    pending[1].reject(Error("unknown"));
    await settle();
    store.retry();
    assert.equal(requests[2].method, "GET");
    pending[2].resolve(reply(snapshot("zh-Hant", 4)));
    await settle();
    assert.deepEqual(clean(requests[3].json), { language: "en", expectedVersion: 4 });
    pending[3].resolve(reply(snapshot("en", 5)));
    await settle();
    assert.equal(store.state.selected, "en");
    assert.equal(store.state.status, "saved");
  } finally {
    store.dispose();
  }
});

test("language conflict retries use fresh revisions and disposal fences late replies", async () => {
  let remote = snapshot("en", 3),
    conflict = true;
  const versions = [];
  const store = new LanguagePreferenceStore(
    "a",
    async (_path, options) => {
      if (options.method === "PUT") {
        versions.push(options.json.expectedVersion);
        if (conflict) {
          conflict = false;
          remote = snapshot("zh", 4);
          return reply({}, 409);
        }
        remote = snapshot(options.json.language, 5);
      }
      return reply(remote);
    },
    () => {},
  );
  try {
    store.start();
    await settle();
    store.select("zh-Hant");
    await settle();
    await settle();
    assert.deepEqual(versions, [3, 4]);
    assert.equal(store.state.selected, "zh-Hant");
  } finally {
    store.dispose();
  }
  const d = deferred(),
    states = [];
  const abandoned = new LanguagePreferenceStore(
    "old",
    () => d.promise,
    (s) => states.push(s),
  );
  abandoned.start();
  abandoned.dispose();
  const count = states.length;
  d.resolve(reply(snapshot("zh-Hant")));
  await settle();
  assert.equal(states.length, count);
});

test("streamed language responses are bounded and timeout settles an ignored abort", async () => {
  await assert.rejects(
    contract.readLanguageResponse(
      new Response(" ".repeat(4097), { headers: { "Content-Type": "application/json" } }),
      new AbortController().signal,
    ),
  );
  const store = new LanguagePreferenceStore(
    "a",
    () => new Promise(() => {}),
    () => {},
    5,
  );
  try {
    store.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(store.state.status, "error");
    assert.equal(store.state.error, "load");
  } finally {
    store.dispose();
  }
});
