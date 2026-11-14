const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const { createHarness, createOwner } = require("./full-flow-crypto-fixture.cjs"),
  { compile } = require("./resource-library-helpers.cjs");
const copy = (v) => structuredClone(v),
  decode = (s) => JSON.parse(Buffer.from(s.payload, "base64url"));
let modern, legacy, owner, shared, vault;
async function extend(f, generations = 23) {
  const certificates = f.vault.registryHistory[0].entries.map((e) => ({
    payload: decode(e.certificate),
    signed: copy(e.certificate),
  }));
  const history = copy(f.vault.registryHistory),
    root = { privateKey: f.session.root, publicJwk: f.vault.rootJwk, kid: f.vault.rootKeyId };
  for (let generation = 1; generation < generations; generation++) {
    for (const role of ["agent_sig", "agent_enc"]) {
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
          "sign",
          "verify",
        ]),
        jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      const publicJwk = Object.fromEntries(["kty", "crv", "x", "y"].map((k) => [k, jwk[k]])),
        kid = await shared.keyId(publicJwk);
      const payload = {
        artifactType: "key_certificate",
        contractVersion: shared.CONTRACT,
        ownerSubject: f.owner,
        vaultId: f.vault.vaultId,
        certificateId: `certificate_${generation}_${role}`,
        keyId: kid,
        role,
        publicJwk,
        principalId: `agent_${generation}`,
        connectionId: `connection_${generation}`,
        keyEpoch: 1,
        issuerKeyId: root.kid,
        notBefore: 1000,
        expiresAt: 5000,
        capabilities: role === "agent_sig" ? ["run_request", "result_write"] : [],
      };
      certificates.push({
        payload,
        signed: await shared.sign(payload, root.privateKey, root.kid, "fv-control+jws"),
      });
    }
    const previous = decode(history.at(-1).checkpoint),
      descriptions = await Promise.all(
        certificates.map(async (c) => ({
          certificateId: c.payload.certificateId,
          payloadDigest: await shared.digest(c.payload),
          active: true,
        })),
      );
    descriptions.sort((a, b) => (a.certificateId < b.certificateId ? -1 : 1));
    const cp = {
      ...previous,
      registrySequence: generation + 1,
      previousDigest: await shared.digest(previous),
      entriesDigest: await shared.digest(descriptions),
      issuedAt: previous.issuedAt + 1,
    };
    history.push({
      contractVersion: shared.CONTRACT,
      checkpoint: await shared.sign(cp, root.privateKey, root.kid, "fv-control+jws"),
      entries: certificates.map((c) => ({ certificate: copy(c.signed), active: true })),
    });
  }
  return { ...copy(f.vault), registryHistory: history, version: generations };
}
function kernel(h, instance) {
  const module = compile("../lib/encrypted-vault-engine.ts", {
    "./encrypted-core": h.core,
    "./encrypted-types": h.types,
  });
  const replies = [],
    waiters = new Map();
  let id = 0;
  const engine = module.createVaultKernel(
    (reply) => {
      replies.push(reply);
      waiters.get(reply.id)?.(reply);
      waiters.delete(reply.id);
    },
    () => instance,
  );
  return {
    replies,
    engine,
    call(method, args = {}) {
      const n = ++id;
      return new Promise((resolve) => {
        waiters.set(n, resolve);
        engine.postMessage({ id: n, method, args });
      });
    },
  };
}
async function warmed(h, uid = owner.uid) {
  let now = 2000;
  const instance = new h.core.VaultCore(uid, () => now);
  if (uid === owner.uid)
    await instance.unlockForResults(copy(owner.vault), owner.material(), copy(owner.local));
  const worker = kernel(h, instance);
  await worker.call("init", { uid });
  return { ...worker, instance, time: (v) => (now = v) };
}
async function counted(action) {
  const subtle = crypto.subtle,
    counts = { verify: 0, importKey: 0, digest: 0 },
    original = {};
  for (const name of Object.keys(counts)) {
    original[name] = subtle[name];
    subtle[name] = function (...args) {
      counts[name]++;
      return original[name].apply(this, args);
    };
  }
  try {
    return { value: await action(), counts };
  } finally {
    for (const name of Object.keys(counts)) subtle[name] = original[name];
  }
}
test.before(async () => {
  shared = await import(
    pathToFileURL(
      process.env.FOLIOVIEW_TEST_REGISTRY_CORE ||
        path.resolve(__dirname, "../../../packages/encrypted-workspace/dist/core.mjs"),
    ).href
  );
  modern = await createHarness();
  const baseline = process.env.FOLIOVIEW_TEST_REGISTRY_BASELINE;
  legacy = baseline ? await createHarness({ coreSource: baseline }) : null;
  owner = await createOwner(legacy || modern, "synthetic_registry_worker_owner");
  owner.time(2000);
  vault = await extend(owner);
});
test.after(async () => {
  await modern?.close();
  await legacy?.close();
});
test("actual production Worker kernel verifies all 23 generations and 47 certificates with 70 signatures per attempt", async () => {
  assert.equal(vault.registryHistory.length, 23);
  assert.equal(vault.registryHistory.at(-1).entries.length, 47);
  const current = await warmed(modern);
  try {
    const result = await counted(() => current.call("acceptResultVault", { vault: copy(vault) }));
    assert.equal(result.value.ok, true);
    assert.equal(result.value.result.canWriteState, true);
    assert.equal(result.counts.verify, 70);
    if (legacy) {
      const old = await warmed(legacy);
      try {
        const before = await counted(() => old.call("acceptResultVault", { vault: copy(vault) }));
        assert.equal(before.value.ok, true);
        assert.equal(before.counts.verify, 598);
        assert.deepEqual(result.value.result, before.value.result);
        assert.ok(result.counts.importKey < before.counts.importKey);
        assert.ok(result.counts.digest < before.counts.digest);
        console.log(
          JSON.stringify({ actualWorker: { baseline: before.counts, optimized: result.counts } }),
        );
      } finally {
        old.engine.terminate();
      }
    }
    const repeated = await counted(() => current.call("acceptResultVault", { vault: copy(vault) }));
    assert.equal(repeated.value.ok, true);
    assert.equal(
      repeated.counts.verify,
      70,
      "a new Worker operation cannot reuse certificate success from an earlier attempt",
    );
  } finally {
    current.engine.terminate();
  }
});
test("actual Worker still rejects wrong Owner old checkpoints nested corruption and clock rollback", async () => {
  const w = await warmed(modern);
  try {
    assert.equal((await w.call("acceptResultVault", { vault: copy(vault) })).ok, true);
    for (const mutate of [
      (v) => (v.registryHistory.at(-1).checkpoint = copy(v.registryHistory[0].checkpoint)),
      (v) => (v.registryHistory.at(-1).entries[0].certificate.extra = "FORBIDDEN"),
      (v) => (v.registryHistory.at(-1).entries[0].active = false),
      (v) => (v.registryHistory.at(-1).entries[0].certificate.signature = "A".repeat(86)),
      (v) => (v.rootJwk.x = v.rootJwk.y),
    ]) {
      const invalid = copy(vault);
      mutate(invalid);
      const r = await w.call("acceptResultVault", { vault: invalid });
      assert.equal(r.ok, false);
      assert.ok(!JSON.stringify(r).includes("FORBIDDEN"));
    }
    w.time(999);
    assert.equal((await w.call("acceptResultVault", { vault: copy(vault) })).ok, false);
    w.time(2000);
    assert.equal((await w.call("acceptResultVault", { vault: copy(vault) })).ok, true);
    const foreign = await createOwner(modern, "synthetic_other_registry_owner"),
      other = kernel(modern, foreign.session);
    try {
      await other.call("init", { uid: foreign.uid });
      assert.equal((await other.call("acceptResultVault", { vault: copy(vault) })).ok, false);
    } finally {
      other.engine.terminate();
    }
  } finally {
    w.engine.terminate();
  }
});
test("a verified certificate never caches current expiry or revoked device write authority", async () => {
  const w = await warmed(modern);
  try {
    assert.equal((await w.call("acceptResultVault", { vault: copy(vault) })).ok, true);
    assert.equal((await w.call("acceptVault", { vault: copy(vault) })).ok, true);
    w.time(1000000000);
    const expired = await w.call("acceptVault", { vault: copy(vault) });
    assert.equal(expired.ok, false);
    w.time(2000);
    const revoked = copy(vault),
      prior = decode(revoked.registryHistory.at(-1).checkpoint),
      device = revoked.registryHistory[0].entries
        .map((e) => decode(e.certificate))
        .find((c) => c.role === "device_sig").keyId;
    const entries = copy(revoked.registryHistory.at(-1).entries);
    for (const e of entries) if (decode(e.certificate).keyId === device) e.active = false;
    const descriptions = await Promise.all(
      entries.map(async (e) => {
        const c = decode(e.certificate);
        return {
          certificateId: c.certificateId,
          payloadDigest: await shared.digest(c),
          active: e.active,
        };
      }),
    );
    descriptions.sort((a, b) => (a.certificateId < b.certificateId ? -1 : 1));
    const cp = {
      ...prior,
      registrySequence: 24,
      previousDigest: await shared.digest(prior),
      entriesDigest: await shared.digest(descriptions),
      revokedKeyIds: [device],
      issuedAt: prior.issuedAt + 1,
    };
    revoked.registryHistory.push({
      contractVersion: shared.CONTRACT,
      checkpoint: await shared.sign(cp, owner.session.root, vault.rootKeyId, "fv-control+jws"),
      entries,
    });
    revoked.version++;
    const read = await w.call("acceptResultVault", { vault: revoked });
    assert.equal(read.ok, true);
    assert.equal(read.result.canWriteState, false);
    assert.equal((await w.call("acceptVault", { vault: revoked })).ok, false);
  } finally {
    w.engine.terminate();
  }
});
test("after-await Root and JWS mutation cannot change the Worker private verified input or seed another attempt", async () => {
  const w = await warmed(modern),
    input = copy(vault),
    original = crypto.subtle.verify;
  let reached, release;
  const atVerify = new Promise((r) => (reached = r)),
    gate = new Promise((r) => (release = r));
  let first = true;
  crypto.subtle.verify = async function (...args) {
    if (first) {
      first = false;
      reached();
      await gate;
    }
    return original.apply(this, args);
  };
  try {
    const action = w.call("acceptResultVault", { vault: input });
    await atVerify;
    input.rootJwk.x = input.rootJwk.y;
    input.registryHistory[0].entries[0].certificate.signature = "A".repeat(86);
    release();
    const result = await action;
    assert.equal(result.ok, true);
    assert.equal(result.result.pin.rootKeyId, vault.rootKeyId);
    assert.equal((await w.call("acceptResultVault", { vault: input })).ok, false);
  } finally {
    release?.();
    crypto.subtle.verify = original;
    w.engine.terminate();
  }
});
test("terminated actual Worker suppresses a late crypto reply", async () => {
  const w = await warmed(modern),
    original = crypto.subtle.verify;
  let reached, release;
  const atVerify = new Promise((r) => (reached = r)),
    gate = new Promise((r) => (release = r));
  let first = true;
  crypto.subtle.verify = async function (...args) {
    if (first) {
      first = false;
      reached();
      await gate;
    }
    return original.apply(this, args);
  };
  try {
    const count = w.replies.length;
    void w.call("acceptResultVault", { vault: copy(vault) });
    await atVerify;
    w.engine.terminate();
    release();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(w.replies.length, count);
  } finally {
    release?.();
    crypto.subtle.verify = original;
    w.engine.terminate();
  }
});

async function resignLast(value, change) {
  const v = copy(value),
    b = v.registryHistory.at(-1),
    c = decode(b.entries[0].certificate);
  change(c);
  b.entries[0].certificate = await shared.sign(
    c,
    owner.session.root,
    v.rootKeyId,
    "fv-control+jws",
  );
  const descriptions = await Promise.all(
    b.entries.map(async (e) => {
      const p = decode(e.certificate);
      return {
        certificateId: p.certificateId,
        payloadDigest: await shared.digest(p),
        active: e.active,
      };
    }),
  );
  descriptions.sort((a, b) => (a.certificateId < b.certificateId ? -1 : 1));
  const cp = decode(b.checkpoint);
  cp.entriesDigest = await shared.digest(descriptions);
  b.checkpoint = await shared.sign(cp, owner.session.root, v.rootKeyId, "fv-control+jws");
  return v;
}
test("Root-signed static success cannot replace dynamic Owner vault issuer role key identity or epoch checks", async () => {
  const w = await warmed(modern);
  try {
    assert.equal((await w.call("acceptResultVault", { vault: copy(vault) })).ok, true);
    for (const change of [
      (c) => (c.ownerSubject = "foreign_owner"),
      (c) => (c.vaultId = "foreign_vault"),
      (c) => (c.issuerKeyId = "A".repeat(43)),
      (c) => (c.keyId = "A".repeat(43)),
      (c) => {
        c.role = "agent_sig";
        c.connectionId = null;
      },
      (c) => (c.keyEpoch = 2),
    ]) {
      const changed = await resignLast(vault, change);
      assert.equal((await w.call("acceptResultVault", { vault: changed })).ok, false);
    }
    for (const change of [
      (c) => (c.previousDigest = "a".repeat(64)),
      (c) => (c.keyEpoch = 0),
      (c) => (c.issuedAt = 999999),
    ]) {
      const changed = copy(vault),
        b = changed.registryHistory.at(-1),
        cp = decode(b.checkpoint);
      change(cp);
      b.checkpoint = await shared.sign(cp, owner.session.root, changed.rootKeyId, "fv-control+jws");
      assert.equal((await w.call("acceptResultVault", { vault: changed })).ok, false);
    }
  } finally {
    w.engine.terminate();
  }
});
test("an equivalent re-signed certificate requires a real extra verification while preserving the authenticated directory", async () => {
  const w = await warmed(modern);
  try {
    const normal = await w.call("acceptResultVault", { vault: copy(vault) });
    const changed = copy(vault),
      entry = changed.registryHistory.at(-1).entries[0],
      old = entry.certificate.signature;
    entry.certificate = await shared.sign(
      decode(entry.certificate),
      owner.session.root,
      changed.rootKeyId,
      "fv-control+jws",
    );
    assert.notEqual(entry.certificate.signature, old);
    const result = await counted(() => w.call("acceptResultVault", { vault: changed }));
    assert.equal(result.value.ok, true);
    assert.equal(result.counts.verify, 71);
    assert.deepEqual(result.value.result, normal.result);
  } finally {
    w.engine.terminate();
  }
});
