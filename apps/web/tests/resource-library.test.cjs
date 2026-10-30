const assert = require("node:assert/strict");
const test = require("node:test");
const {
  contracts: c,
  catalogue,
  channels,
  stocks,
  item,
} = require("./resource-library-helpers.cjs");

test("resource catalogue accepts actual pending, disconnected and partial sources; never grants execution evidence", () => {
  const value = catalogue();
  value.groups[0].status = "partial";
  value.groups[0].items.push(
    item("holdings", {
      ref: { ...item("holdings").ref, resourceId: "pending_A" },
      state: "pending",
      revision: null,
      snapshotId: null,
    }),
  );
  value.groups[0].items.push(
    item("holdings", {
      ref: { ...item("holdings").ref, resourceId: "disconnected_A" },
      state: "disconnected",
      revision: null,
      snapshotId: null,
    }),
  );
  value.groups[0].items.push(
    item("holdings", {
      ref: null,
      state: "unavailable",
      revision: null,
      sourceEpoch: null,
      snapshotId: null,
    }),
  );
  assert.equal(c.readResourceCatalogue(value).groups[0].status, "partial");
  assert.equal(c.resourceSelection(value.groups[0].items[1]), null);
  const selected = c.resourceSelection(value.groups[1].items[0]);
  assert.deepEqual(Object.keys(selected).sort(), ["ref", "sourceEpoch"]);
  assert.ok(!JSON.stringify(selected).includes("encryptedEvidence"));
});

test("closed catalogue rejects mixed services, inherited fields, duplicate kinds/refs and inconsistent availability", () => {
  const alter = [
    (value) => (value.groups[1].items[0].ref.sourceService = "portfolio"),
    (value) => value.groups[0].items.push(value.groups[0].items[0]),
    (value) => (value.groups[1].kind = "holdings"),
    (value) => (value.groups[0].status = "unavailable"),
    (value) => (value.groups[1].items[0].ref.resourceId = "resource\n"),
    (value) => (value.groups[1].items[0].snapshotId = "fake_snapshot"),
    (value) => (value.groups[1].items[0].revision = 0),
    (value) => (value.groups[1].items[0].encryptedEvidence = "ready"),
    (value) => (value.readAt = "2026-02-30T00:00:00Z"),
  ];
  for (const change of alter) {
    const value = catalogue();
    change(value);
    assert.throws(() => c.readResourceCatalogue(value));
  }
  const value = catalogue();
  const inherited = Object.create({ profile: value.profile });
  Object.assign(inherited, value);
  delete inherited.profile;
  assert.throws(() => c.readResourceCatalogue(inherited));
});

test("manual creators use exact normalized handle locators, reject lookalikes/video links/duplicates and bound UTF-8", () => {
  assert.equal(
    c.channelInputs([{ name: "Creator", handleOrUrl: "@CrEaTor", note: "" }])[0].handleOrUrl,
    "https://www.youtube.com/@creator",
  );
  for (const handleOrUrl of [
    "https://youtube.com.evil.test/@a",
    "https://youtube.com/@a?x=1",
    "https://youtube.com/watch?v=x",
    "http://youtube.com/@a",
    "https://youtube.com/@a\n",
    " @a",
    "@a/b",
  ])
    assert.throws(() => c.channelInputs([{ name: "Creator", handleOrUrl, note: "" }]));
  assert.throws(
    () =>
      c.channelInputs([
        { name: "A", handleOrUrl: "@a", note: "" },
        { name: "B", handleOrUrl: "https://www.youtube.com/@A", note: "" },
      ]),
    /duplicate/,
  );
  assert.throws(() => c.channelInputs([{ name: "A", handleOrUrl: "@a", note: "\ud800" }]));
  assert.throws(
    () =>
      c.channelInputs(
        Array.from({ length: 50 }, (_, index) => ({
          name: "A",
          handleOrUrl: `@a${index}`,
          note: "字".repeat(1000),
        })),
      ),
    /too_large/,
  );
  const inherited = Object.create({ note: "" });
  Object.assign(inherited, { name: "A", handleOrUrl: "@a" });
  assert.throws(() => c.channelInputs([inherited]));
});

test("list readers reject malformed and unverified rows instead of showing an empty list", () => {
  assert.equal(c.readChannelFollows(channels()).items.length, 1);
  assert.equal(c.readResourceWatchlist(stocks()).items.length, 1);
  const bad = channels();
  bad.items[0].verification = "youtube_verified";
  assert.throws(() => c.readChannelFollows(bad));
  const duplicate = channels();
  duplicate.items.push(duplicate.items[0]);
  assert.throws(() => c.readChannelFollows(duplicate));
  const old = channels();
  old.items[0].addedAt = "invalid";
  assert.throws(() => c.readChannelFollows(old));
  const extra = stocks();
  extra.items[0].weight = "1";
  assert.throws(() => c.readResourceWatchlist(extra));
});

test("holdings task selection requires an existing snapshot and positive revision", () => {
  assert.equal(c.resourceSelection(item("holdings", { revision: 0, snapshotId: null })), null);
  assert.equal(c.resourceSelection(item("holdings", { revision: 1, snapshotId: null })), null);
  assert.ok(c.resourceSelection(item("holdings")));
});
