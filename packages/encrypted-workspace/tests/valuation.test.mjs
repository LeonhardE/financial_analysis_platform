/** Offline synthetic fixtures; no providers, accounts, storage or network. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  holdingsFacts,
  holdingsPrivate,
  openHoldings,
  sealHoldingsFacts,
  quoteRequest,
  fxRequest,
  quoteBatch,
  fxBatch,
  valueHoldings,
  crossRate,
  roundDisplayAmount,
  displayCurrencies,
  currencySnapshot,
  resolvePreferences,
  fxPreferencesSnapshot,
  effectiveFxPairs,
  validateValuation,
} from "../valuation/dist/index.mjs";
import {
  openHoldings as openHoldingsOnly,
  holdingsFacts as holdingsFactsOnly,
} from "../valuation/dist/holdings.mjs";
import {
  canonical,
  digest,
  keyId,
  jose,
  verify,
  open,
  privatePayload,
  bytes,
  parsed,
} from "../dist/core.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const vectors = JSON.parse(await readFile(join(root, "valuation/reference-vectors.json"), "utf8"));
const fixture = JSON.parse(
  await readFile(
    join(root, "../../services/common/tests/fixtures/persistent_content_node.json"),
    "utf8",
  ),
);
const base = vectors.cases[0];
const clone = structuredClone;
const hash = (data) => createHash("sha256").update(data).digest("hex");

test("Python synthetic valuation vectors match exact JS arithmetic, coverage and rounding", () => {
  for (const v of vectors.cases)
    assert.deepEqual(valueHoldings(v.holdings, v.quotes, v.fx, v.currency), v.expected, v.name);
  for (const [a, b, expected] of vectors.crosses) assert.equal(crossRate(a, b), expected);
  for (const [value, code, expected] of vectors.rounds)
    assert.equal(roundDisplayAmount(value, code), expected);
  assert.throws(() => crossRate("0.000000000000000001", "2"));
  assert.throws(() => crossRate("1", "0"));
  assert.throws(() => roundDisplayAmount("1e3", "USD"));
  assert.deepEqual(displayCurrencies(vectors.cases[4].holdings, "CNY"), ["CNY", "USD", "CAD"]);
});
test("closed facts reject binding, decimal, import, date, cost and provenance inconsistencies", () => {
  const original = clone(base.holdings);
  assert.deepEqual(holdingsFacts(original, { snapshotId: "snapshot_1", revision: 1 }), original);
  for (const mutate of [
    (h) => {
      h.unexpected = true;
    },
    (h) => {
      h.fetchedAt = "2026-02-30T22:00:00Z";
    },
    (h) => {
      h.data.reportDate = "0000-01-01";
    },
    (h) => {
      h.data.importSnapshot.snapshotId = "other";
    },
    (h) => {
      h.data.editKind = "edit";
    },
    (h) => {
      h.data.accounts.push(clone(h.data.accounts[0]));
    },
    (h) => {
      h.data.accounts[0].positions.push(clone(h.data.accounts[0].positions[0]));
    },
    (h) => {
      h.data.accounts[0].positions[0].quantity = 2;
    },
    (h) => {
      h.data.accounts[0].positions[0].quantity = "0.0000000000001";
    },
    (h) => {
      h.data.accounts[0].positions[0].unitCost.currency = "CAD";
    },
    (h) => {
      h.data.accounts[0].positions[0].provenance.unitCost.origin = "unknown";
    },
    (h) => {
      h.data.accounts[0].positions[0].provenance.quantity.recordedAt = "2026-11-14T22:00:00Z";
    },
    (h) => {
      h.data.editKind = "manual";
      h.data.importSnapshot = null;
    },
  ]) {
    const changed = clone(original);
    mutate(changed);
    assert.throws(() => holdingsFacts(changed, { snapshotId: "snapshot_1", revision: 1 }));
  }
  assert.throws(() => holdingsFacts(original, { snapshotId: "other" }));
  assert.throws(() => holdingsFacts(original, { revision: 0 }));
  const checked = holdingsFacts(original);
  checked.data.accounts[0].displayName = "changed";
  assert.notEqual(checked.data.accounts[0].displayName, original.data.accounts[0].displayName);
});
test("timestamp ordering preserves microseconds and rejects future report observations", () => {
  const h = clone(base.holdings);
  h.fetchedAt = "2026-11-13T22:00:00.000001Z";
  h.sourceAsOf = "2026-11-13T22:00:00.000002Z";
  assert.throws(() => holdingsFacts(h));
  h.sourceAsOf = "2026-11-13T22:00:00Z";
  assert.doesNotThrow(() => holdingsFacts(h));
  assert.throws(() => validateValuation("Date", "0000-01-01"));
  assert.throws(() => validateValuation("Timestamp", "2026-02-30T00:00:00Z"));
});
test("manual and subsequent edits preserve nullable facts and immutable source references", () => {
  const h = clone(base.holdings),
    p = h.data.accounts[0].positions[0];
  h.data.editKind = "manual";
  h.data.importSnapshot = null;
  p.reportedValues = null;
  for (const field of ["instrument", "quantity", "unitCost"])
    p.provenance[field] = {
      origin: "manual",
      recordedAt: h.fetchedAt,
      lastEditedAt: h.fetchedAt,
      sourceDate: null,
    };
  assert.doesNotThrow(() => holdingsFacts(h, { revision: 1 }));
  const edit = clone(h);
  edit.data.editKind = "edit";
  edit.data.snapshotId = "snapshot_2";
  edit.data.previousSnapshot = { snapshotId: "snapshot_1", sourceRevision: 1 };
  assert.doesNotThrow(() => holdingsFacts(edit, { snapshotId: "snapshot_2", revision: 2 }));
  edit.data.previousSnapshot.sourceRevision = 2;
  assert.throws(() => holdingsFacts(edit, { revision: 2 }));
});
test("identity, direct and inverse rates validate independently without fabricated observations", () => {
  const f = clone(base.fx),
    item = f.items[0];
  item.quote = "CAD";
  item.rate = "1.4";
  item.route = { kind: "direct", via: null, legs: [item.route.legs[0]] };
  assert.doesNotThrow(() => fxBatch(f));
  item.base = "CAD";
  item.quote = "USD";
  item.rate = crossRate("1", "1.4");
  item.route.kind = "inverse";
  assert.doesNotThrow(() => fxBatch(f));
  item.base = "USD";
  item.quote = "USD";
  item.rate = "1";
  item.source = "identity";
  item.route = { kind: "identity", via: null, legs: [] };
  item.sourceAsOf = null;
  item.sourceDate = null;
  assert.doesNotThrow(() => fxBatch(f));
  item.sourceDate = "2026-11-13";
  assert.throws(() => fxBatch(f));
});
test("quote and FX batches bind exact requests and reject invented prices and mixed-date crosses", () => {
  assert.deepEqual(quoteBatch(base.quotes, [base.quotes.items[0].instrument]), base.quotes);
  assert.deepEqual(fxBatch(base.fx, [{ base: "USD", quote: "CNY" }]), base.fx);
  assert.throws(() =>
    quoteBatch(base.quotes, [{ symbol: "OTHER", market: "XNAS", currency: "USD" }]),
  );
  assert.throws(() => fxBatch(base.fx, [{ base: "CAD", quote: "CNY" }]));
  for (const mutate of [
    (q) => {
      q.items[0].price = "0";
    },
    (q) => {
      q.items[0].sourceAsOf = null;
    },
    (q) => {
      q.items[0].instrument.market = "UNKNOWN";
    },
    (q) => {
      q.items[0].status = "missing";
    },
    (q) => {
      q.items.push(clone(q.items[0]));
    },
  ]) {
    const q = clone(base.quotes);
    mutate(q);
    assert.throws(() => quoteBatch(q));
  }
  for (const mutate of [
    (f) => {
      f.items[0].rate = "7.01";
    },
    (f) => {
      f.items[0].route.legs[1].sourceDate = "2026-11-12";
    },
    (f) => {
      f.items[0].route.legs.reverse();
    },
    (f) => {
      f.items[0].route.via = null;
    },
    (f) => {
      f.items[0].sourceDate = "2026-11-14";
    },
    (f) => {
      f.items.push(clone(f.items[0]));
    },
  ]) {
    const f = clone(base.fx);
    mutate(f);
    assert.throws(() => fxBatch(f));
  }
  const i = base.quotes.items[0].instrument;
  assert.deepEqual(quoteRequest({ instruments: [i, i] }).instruments, [i]);
  assert.deepEqual(
    fxRequest({
      pairs: [
        { base: "USD", quote: "CAD" },
        { base: "USD", quote: "CAD" },
      ],
    }).pairs,
    [{ base: "USD", quote: "CAD" }],
  );
  assert.throws(() => validateValuation("__proto__", {}));
});
test("preference absence, defaults, suppression and failed Config reads preserve semantics", () => {
  const currency = {
    contractVersion: "folioview.valuation.v1",
    profile: "folioview.currency-preferences.v2",
    preferences: null,
    version: 0,
    currencyGeneration: 0,
  };
  const fx = {
    contractVersion: "folioview.valuation.v1",
    profile: "folioview.fx-preferences.v1",
    preferences: null,
    version: 0,
  };
  assert.deepEqual(resolvePreferences({ preferences: null, version: 0 }, currency), {
    defaultPortfolioCurrency: "USD",
    language: "en",
    theme: "light",
    defaultChartRange: "1m",
  });
  assert.throws(() => currencySnapshot({ ...currency, version: 1 }));
  assert.throws(() =>
    fxPreferencesSnapshot({
      ...fx,
      preferences: { pairs: [{ base: "USD", quote: "USD" }], suppressedDefault: null },
      version: 1,
    }),
  );
  currency.preferences = { defaultPortfolioCurrency: "CNY" };
  currency.version = 3;
  currency.currencyGeneration = 2;
  assert.deepEqual(effectiveFxPairs(fx, currency), [
    { base: "USD", quote: "CNY", origin: "default" },
  ]);
  fx.preferences = {
    pairs: [{ base: "CAD", quote: "USD" }],
    suppressedDefault: { currency: "CNY", currencyGeneration: 2 },
  };
  fx.version = 1;
  assert.deepEqual(effectiveFxPairs(fx, currency), [
    { base: "CAD", quote: "USD", origin: "manual" },
  ]);
  currency.currencyGeneration = 3;
  assert.equal(effectiveFxPairs(fx, currency)[0].origin, "default");
  assert.deepEqual(effectiveFxPairs(fx, null), [{ base: "CAD", quote: "USD", origin: "manual" }]);
});
async function newKeys() {
  const root = await jose.generateKeyPair("ES256", { extractable: true });
  const recipient = await jose.generateKeyPair("ECDH-ES+A256KW", { extractable: true });
  const recovery = await jose.generateKeyPair("ECDH-ES+A256KW", { extractable: true });
  const rootJwk = await jose.exportJWK(root.publicKey),
    recipientJwk = await jose.exportJWK(recipient.publicKey),
    recoveryJwk = await jose.exportJWK(recovery.publicKey);
  const recipientId = await keyId(recipientJwk),
    recoveryId = await keyId(recoveryJwk);
  const c = {
    ...clone(fixture.context),
    rootKeyId: await keyId(rootJwk),
    agentEncryptionKeyId: recipientId,
    recipients: [
      { keyId: recipientId, role: "agent_enc" },
      { keyId: recoveryId, role: "recovery_enc" },
    ].sort((a, b) => (a.keyId < b.keyId ? -1 : 1)),
  };
  const privateJwk = await jose.exportJWK(recipient.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  return {
    root,
    rootJwk,
    c,
    privateKey,
    publicKeys: { [recipientId]: recipientJwk, [recoveryId]: recoveryJwk },
  };
}
test("typed facts writer and nonexportable recipient decrypt preserve signed context and legacy strictness", async () => {
  const keys = await newKeys(),
    h = clone(base.holdings),
    c = keys.c;
  h.data.snapshotId = c.objectId;
  h.data.importSnapshot.snapshotId = c.objectId;
  const carrier = await sealHoldingsFacts(h, c, keys.publicKeys, keys.root.privateKey);
  const proof = await verify(carrier.proof, keys.rootJwk, "fv-control+jws");
  assert.deepEqual(proof.context, c);
  assert.equal(proof.ciphertextDigest, await digest(carrier.jwe));
  assert.equal(keys.privateKey.extractable, false);
  assert.deepEqual(await openHoldings(carrier, keys.privateKey, c), h);
  assert.deepEqual(await openHoldingsOnly(carrier, keys.privateKey, c), h);
  assert.deepEqual(holdingsFactsOnly(h), h);
  // The old frozen decoder still rejects new facts until a consumer explicitly opts in.
  await assert.rejects(() => open(carrier, keys.privateKey, c));
  const wrapper = {
    privateSchemaVersion: 1,
    profile: c.profile,
    objectId: c.objectId,
    objectType: c.objectType,
    revision: c.revision,
    payload: h,
  };
  assert.throws(() => privatePayload(wrapper, c));
  assert.deepEqual(holdingsPrivate(wrapper, c), h);
  for (const field of ["ownerSubject", "connectionId", "objectId", "permissionId"])
    await assert.rejects(() => openHoldings(carrier, keys.privateKey, { ...c, [field]: "other" }));
  const bad = clone(carrier),
    raw = bytes(bad.jwe.tag);
  raw[0] ^= 1;
  bad.jwe.tag = jose.base64url.encode(raw);
  await assert.rejects(() => openHoldings(bad, keys.privateKey, c));
  await assert.rejects(() =>
    sealHoldingsFacts(h, { ...c, objectType: "task" }, keys.publicKeys, keys.root.privateKey),
  );
  await assert.rejects(() => sealHoldingsFacts(h, c, {}, keys.root.privateKey));
});
test("typed reader retains independent pre-existing Python legacy content compatibility", async () => {
  const c = fixture.context,
    row = fixture.registryBundle.entries
      .map((e) => parsed(bytes(e.certificate.payload), true))
      .find((e) => e.keyId === c.agentEncryptionKeyId);
  const d = BigInt(fixture.recipientTestScalar).toString(16).padStart(64, "0");
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { ...row.publicJwk, d: Buffer.from(d, "hex").toString("base64url") },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  assert.deepEqual(
    await openHoldings(fixture.carrier, privateKey, c),
    fixture.privatePayload.payload,
  );
});
test("add-on manifest pins the common schema, frozen core and isolated dependency-free distribution", async () => {
  const manifest = JSON.parse(await readFile(join(root, "valuation/integrity.json"), "utf8"));
  for (const [file, sha] of Object.entries(manifest.files))
    assert.equal(hash(await readFile(join(root, "valuation", file))), sha, file);
  const schema = await readFile(
    join(root, "../../services/common/folioview_shared/valuation_schemas.json"),
  );
  assert.equal(hash(schema), manifest.schemaSha256);
  assert.deepEqual(schema, await readFile(join(root, "valuation/schemas.json")));
  assert.equal(hash(await readFile(join(root, "dist/core.mjs"))), manifest.frozenCoreSha256);
  assert.ok(
    (await readFile(join(root, "valuation/dist/holdings.mjs"))).length < 262144,
    "holdings reader must fit within the Agent distribution's existing cap",
  );
  const temporary = await mkdtemp(join(tmpdir(), "folioview-valuation-"));
  try {
    await mkdir(join(temporary, "dist"));
    await mkdir(join(temporary, "valuation/dist"), { recursive: true });
    await copyFile(join(root, "dist/core.mjs"), join(temporary, "dist/core.mjs"));
    await copyFile(
      join(root, "valuation/dist/index.mjs"),
      join(temporary, "valuation/dist/index.mjs"),
    );
    const isolated = await import(pathToFileURL(join(temporary, "valuation/dist/index.mjs")).href);
    assert.deepEqual(
      isolated.valueHoldings(base.holdings, base.quotes, base.fx, "CNY"),
      base.expected,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
