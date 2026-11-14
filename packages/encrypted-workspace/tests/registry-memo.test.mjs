/** Fresh synthetic public registries; every signature check uses real WebCrypto. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import * as distribution from "../dist/core.mjs";
import {
  Registry as DistributedRegistry,
  CONTRACT,
  canonical,
  parsed,
  bytes,
  digest,
  keyId,
  sign,
} from "../dist/core.mjs";

// Exercise an unexported implementation detail without adding a production API.
// Large valid JWS payloads reach the defensive byte bound, while the public
// certificate schema's current field limits reach the item bound first.
// Repository CI intentionally installs no runtime/build dependencies. Reuse the
// checked self-contained crypto distribution for this test-only source loader.
const moduleUrl = (text) => "data:text/javascript;base64," + Buffer.from(text).toString("base64");
const distributionUrl = JSON.stringify(new URL("../dist/core.mjs", import.meta.url).href);
const bridgeUrl = moduleUrl(`
export * from ${distributionUrl};
import {validate as checkedValidate,keyId as checkedKeyId,digest as checkedDigest} from ${distributionUrl};
let observer=()=>{},cryptoObserver=()=>{};
export function setSchemaObserver(value){observer=value}
export function validate(name,value){observer(name,value);return checkedValidate(name,value)}
export function setCryptoObserver(value){cryptoObserver=value}
export function keyId(value){cryptoObserver("keyIds");return checkedKeyId(value)}
export function digest(value){cryptoObserver("digests");return checkedDigest(value)}
`);
const bridge = await import(bridgeUrl);
const source = await import(
  moduleUrl(
    (await readFile(new URL("../src/registry.mjs", import.meta.url), "utf8")).replace(
      '"./crypto.mjs"',
      JSON.stringify(bridgeUrl),
    ) + "\nexport { certificateVerifier as testCertificateVerifier };\n",
  )
);
const certificateVerifier = source.testCertificateVerifier;
const clone = (v) => structuredClone(v);
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function observed(action, hooks = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const counts = { signatures: 0, schemas: {}, keyIds: 0, digests: 0 };
  bridge.setCryptoObserver((name) => counts[name]++);
  bridge.setSchemaObserver((name, value) => {
    counts.schemas[name] = (counts.schemas[name] ?? 0) + 1;
    hooks.schema?.(name, value);
  });
  const subtle = new Proxy(webcrypto.subtle, {
    get(target, name) {
      const value = Reflect.get(target, name, target);
      if (name === "verify")
        return async (...args) => {
          counts.signatures++;
          await hooks.verify?.(counts.signatures, args);
          return value.apply(target, args);
        };
      if (name === "importKey")
        return async (...args) => {
          await hooks.importKey?.(args);
          return value.apply(target, args);
        };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: new Proxy(webcrypto, {
      get(target, name) {
        if (name === "subtle") return subtle;
        const value = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  });
  try {
    return { result: await action(counts), counts };
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
    bridge.setSchemaObserver(() => {});
    bridge.setCryptoObserver(() => {});
  }
}
async function pair() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const full = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const publicJwk = Object.fromEntries(["kty", "crv", "x", "y"].map((k) => [k, full[k]]));
  return { privateKey: keys.privateKey, publicJwk, kid: await keyId(publicJwk) };
}
async function fixture(generations = 1) {
  const root = await pair();
  const f = {
    root,
    owner: "synthetic_memo_owner",
    vault: "synthetic_memo_vault",
    certificates: [],
    history: [],
  };
  for (const role of ["device_sig", "device_enc", "recovery_enc"]) await add(f, role, role);
  for (let n = 0; n < generations; n++) {
    if (n)
      for (const role of ["agent_sig", "agent_enc"])
        await add(f, `${role}_${n}`, role, `agent_${n}`, `connection_${n}`);
    f.history.push(await bundle(f, f.certificates, f.history.at(-1)));
  }
  return f;
}
async function add(f, name, role, principal = name, connection = null, epoch = 1) {
  const key = await pair();
  const payload = {
    artifactType: "key_certificate",
    contractVersion: CONTRACT,
    ownerSubject: f.owner,
    vaultId: f.vault,
    certificateId: `certificate_${name}`,
    keyId: key.kid,
    role,
    publicJwk: key.publicJwk,
    principalId: principal,
    connectionId: connection,
    keyEpoch: epoch,
    issuerKeyId: f.root.kid,
    notBefore: 100,
    expiresAt: 5000,
    capabilities:
      role === "device_sig"
        ? ["object_write", "task_grant", "control_write"]
        : role === "agent_sig"
          ? ["run_request", "result_write"]
          : [],
  };
  const value = {
    payload,
    signed: await sign(payload, f.root.privateKey, f.root.kid, "fv-control+jws"),
  };
  f.certificates.push(value);
  return value;
}
async function bundle(f, certificates, previous, overrides = {}, active = () => true) {
  const prior = previous ? parsed(bytes(previous.checkpoint.payload), true) : null;
  const entries = certificates.map((c) => ({ certificate: clone(c.signed), active: active(c) }));
  const descriptions = await Promise.all(
    certificates.map(async (c, i) => ({
      certificateId: c.payload.certificateId,
      payloadDigest: await digest(c.payload),
      active: entries[i].active,
    })),
  );
  descriptions.sort((a, b) =>
    a.certificateId < b.certificateId ? -1 : a.certificateId > b.certificateId ? 1 : 0,
  );
  const checkpoint = {
    artifactType: "registry_checkpoint",
    contractVersion: CONTRACT,
    ownerSubject: f.owner,
    vaultId: f.vault,
    rootKeyId: f.root.kid,
    rootEpoch: 1,
    registrySequence: prior ? prior.registrySequence + 1 : 1,
    previousDigest: prior ? await digest(prior) : null,
    entriesDigest: await digest(descriptions),
    keyEpoch: 1,
    revokedKeyIds: [],
    issuedAt: prior ? prior.issuedAt + 1 : 500,
    ...overrides,
  };
  return {
    contractVersion: CONTRACT,
    checkpoint: await sign(checkpoint, f.root.privateKey, f.root.kid, "fv-control+jws"),
    entries,
  };
}
async function anchor(f, history = f.history) {
  const cp = parsed(bytes(history.at(-1).checkpoint.payload), true);
  return {
    rootJwk: f.root.publicJwk,
    rootKeyId: f.root.kid,
    ownerSubject: f.owner,
    vaultId: f.vault,
    rootEpoch: 1,
    registrySequence: cp.registrySequence,
    checkpointDigest: await digest(cp),
  };
}
function sameAuthority(a, b) {
  for (const field of ["anchor", "sequence", "current", "history", "localEpochs", "snapshots"])
    assert.deepEqual(a[field], b[field], field);
}
const f = await fixture(23);

test("23-generation source and distribution retain authority with 598 to 70 signatures and 575 to 47 static checks", async () => {
  const noReuse = clone(f.history);
  for (const b of noReuse)
    for (const row of b.entries)
      row.certificate = await sign(
        parsed(bytes(row.certificate.payload), true),
        f.root.privateKey,
        f.root.kid,
        "fv-control+jws",
      );
  const pin = await anchor(f);
  const baseline = await observed(() => new source.Registry(pin).load(noReuse, 1000));
  const reused = await observed(() => new source.Registry(pin).load(f.history, 1000));
  assert.equal(baseline.counts.signatures, 598);
  assert.equal(reused.counts.signatures, 70);
  assert.deepEqual(reused.counts.schemas, {
    RegistryBundle: 46,
    RegistryCheckpointPayload: 23,
    KeyCertificatePayload: 47,
  });
  assert.equal(baseline.counts.schemas.KeyCertificatePayload, 575);
  assert.equal(reused.counts.keyIds, 49, "47 cert public keys and two Root pin checks");
  assert.equal(reused.counts.digests, 93, "47 payloads and all 46 checkpoint/list digests");
  sameAuthority(reused.result, baseline.result);
  const distributed = await observed(() => new DistributedRegistry(pin).load(f.history, 1000));
  assert.equal(distributed.counts.signatures, 70);
  sameAuthority(distributed.result, reused.result);
  assert.equal("certificateVerifier" in distribution, false);
  assert.equal("testCertificateVerifier" in distribution, false);
});

test("every checkpoint is reverified and a later load receives no certificate memo from an earlier load", async () => {
  const r = new source.Registry(await anchor(f, f.history.slice(0, 1)));
  assert.equal((await observed(() => r.load(f.history.slice(0, 2), 1000))).counts.signatures, 7);
  assert.equal((await observed(() => r.load(f.history.slice(0, 3), 1000))).counts.signatures, 10);
  assert.equal((await observed(() => r.load(f.history.slice(0, 3), 1000))).counts.signatures, 3);
  await assert.rejects(() => r.load(f.history.slice(0, 3), 499));
  const bad = clone(f.history.slice(0, 3));
  bad[1].checkpoint.signature = flip(bad[1].checkpoint.signature);
  await assert.rejects(() => r.load(bad, 1000));
});
const flip = (s) => {
  const b = Buffer.from(s, "base64url");
  b[0] ^= 1;
  return b.toString("base64url");
};
test("complete protected payload signature and Root inputs cannot borrow another successful verification", async () => {
  const original = f.certificates[0].signed,
    payload = f.certificates[0].payload;
  const resigned = await sign(payload, f.root.privateKey, f.root.kid, "fv-control+jws");
  assert.notEqual(original.signature, resigned.signature);
  const other = await pair();
  for (const factory of [certificateVerifier, source.createRegistryCertificateVerifier])
    await observed(async (counts) => {
      const check = factory(f.root.publicJwk, f.root.kid);
      await check(original);
      await check(clone(original));
      assert.equal(counts.signatures, 1);
      await check(resigned);
      assert.equal(counts.signatures, 2);
      const changedPayload = {
        ...original,
        payload: Buffer.from(canonical({ ...payload, keyEpoch: 2 })).toString("base64url"),
      };
      const changedHeader = {
        ...original,
        protected: Buffer.from(
          Buffer.from(original.protected, "base64url").toString() + " ",
        ).toString("base64url"),
      };
      const bad = { ...original, signature: flip(original.signature) };
      for (const signed of [changedPayload, changedHeader, bad, bad])
        await assert.rejects(() => check(signed));
      assert.equal(counts.signatures, 6, "bad signatures are attempted again, never cached");
      for (const signed of [
        await sign(payload, f.root.privateKey, f.root.kid, "wrong-profile"),
        await sign(payload, f.root.privateKey, other.kid, "fv-control+jws"),
      ])
        await assert.rejects(() => check(signed));
      await assert.rejects(() => factory(other.publicJwk, other.kid)(original));
    });
  await assert.rejects(async () =>
    new source.Registry({ ...(await anchor(f)), rootJwk: other.publicJwk }).load(f.history, 1000),
  );
});

test("memo copies preserve original cert behavior without aliasing results or history snapshots", async () => {
  const signed = f.certificates[0].signed,
    expected = f.certificates[0].payload;
  const check = certificateVerifier(f.root.publicJwk, f.root.kid);
  const first = await check(signed);
  first.capabilities.push("forged");
  first.publicJwk.x = "forged";
  const second = await check(signed);
  assert.deepEqual(second, expected);
  second.capabilities.length = 0;
  assert.deepEqual(await check(signed), expected);
  const r = await new source.Registry(await anchor(f)).load(f.history, 1000);
  const old = r.cert(expected.keyId, "device_sig", null, 1000, 1);
  assert.equal(
    old,
    r.cert(expected.keyId, "device_sig", null, 1000, 1),
    "cert keeps its existing return behavior",
  );
  old.publicJwk.x = "local_mutation";
  assert.equal(r.cert(expected.keyId, "device_sig", null, 1000).publicJwk.x, expected.publicJwk.x);
  assert.throws(() => r.cert(expected.keyId, "device_sig", null, 5000));
  assert.throws(() => r.cert(expected.keyId, "agent_sig", null, 1000));
  assert.throws(() => r.cert(expected.keyId, "device_sig", "foreign_connection", 1000));
});

test("128 successful items and 1 MiB encoded bytes fall back to normal verification", async () => {
  await observed(async (counts) => {
    const check = certificateVerifier(f.root.publicJwk, f.root.kid),
      signed = [];
    for (let i = 0; i < 129; i++) {
      signed.push(await sign({ n: i }, f.root.privateKey, f.root.kid, "fv-control+jws"));
      await check(signed.at(-1));
    }
    assert.equal(counts.signatures, 129);
    await check(signed.at(-1));
    assert.equal(counts.signatures, 130);
    await check(signed[0]);
    assert.equal(counts.signatures, 130);
    await assert.rejects(() =>
      check({ ...signed.at(-1), signature: flip(signed.at(-1).signature) }),
    );
  });
  await observed(async (counts) => {
    const check = certificateVerifier(f.root.publicJwk, f.root.kid),
      signed = [];
    let bytes = 0;
    for (let i = 0; i < 24; i++) {
      const payload = { n: i, padding: "x".repeat(24000) };
      const item = await sign(payload, f.root.privateKey, f.root.kid, "fv-control+jws");
      signed.push(item);
      bytes +=
        canonical([f.root.publicJwk, f.root.kid, "fv-control+jws", item]).length +
        canonical(payload).length;
      assert.deepEqual(await check(item), payload);
    }
    assert.ok(bytes > 1_048_576);
    assert.ok(signed.length < 128);
    assert.equal(counts.signatures, 24);
    await check(signed.at(-1));
    assert.equal(counts.signatures, 25, "byte-bound item was not retained");
    await check(signed[0]);
    assert.equal(counts.signatures, 25, "earlier successful item remains usable");
  });
});

test("Root and JWS mutation during an await cannot poison a later hit", async () => {
  const externalRoot = clone(f.root.publicJwk),
    other = await pair();
  const a = await sign({ marker: "A" }, f.root.privateKey, f.root.kid, "fv-control+jws");
  const b = await sign({ marker: "B" }, f.root.privateKey, f.root.kid, "fv-control+jws");
  const mutable = clone(a),
    entered = defer(),
    release = defer();
  let block = true;
  await observed(
    async (counts) => {
      const check = certificateVerifier(externalRoot, f.root.kid);
      const pending = check(mutable);
      await entered.promise;
      Object.assign(mutable, b);
      Object.assign(externalRoot, other.publicJwk);
      release.resolve();
      assert.deepEqual(await pending, { marker: "A" });
      assert.deepEqual(await check(a), { marker: "A" });
      assert.equal(counts.signatures, 1);
      assert.deepEqual(await check(mutable), { marker: "B" });
      assert.equal(counts.signatures, 2);
    },
    {
      importKey: async () => {
        if (block) {
          block = false;
          entered.resolve();
          await release.promise;
        }
      },
    },
  );
});

test("pending promises and verification failures are never retained", async () => {
  const entered = defer(),
    release = defer();
  await observed(
    async (counts) => {
      const check = certificateVerifier(f.root.publicJwk, f.root.kid),
        signed = f.certificates[0].signed;
      const a = check(signed);
      await entered.promise;
      const b = check(signed);
      try {
        const deadline = Date.now() + 2000;
        while (counts.signatures < 2) {
          assert.ok(Date.now() < deadline, "a pending verification was reused");
          await new Promise((r) => setImmediate(r));
        }
      } finally {
        release.resolve();
      }
      assert.deepEqual(await a, await b);
      assert.equal(counts.signatures, 2);
      await check(signed);
      assert.equal(counts.signatures, 2);
    },
    {
      verify: async () => {
        entered.resolve();
        await release.promise;
      },
    },
  );
});

test("memo hits cannot suppress schema identity active revocation chain or epoch checks", async () => {
  const small = await fixture();
  const first = small.history[0],
    key = small.certificates[0].payload.keyId;
  const revoked = await bundle(
    small,
    small.certificates,
    first,
    { revokedKeyIds: [key] },
    (c) => c.payload.keyId !== key,
  );
  const revokedRegistry = await new source.Registry(await anchor(small, [first, revoked])).load(
    [first, revoked],
    1000,
  );
  assert.throws(() => revokedRegistry.cert(key, "device_sig", null, 1000));
  const revived = await bundle(small, small.certificates, revoked);
  await assert.rejects(async () =>
    new source.Registry(await anchor(small, [first, revoked, revived])).load(
      [first, revoked, revived],
      1000,
    ),
  );
  const inactive = await bundle(small, small.certificates, first, {}, () => false);
  await assert.rejects(async () =>
    new source.Registry(await anchor(small, [first, inactive])).load([first, inactive], 1000),
  );
  const elevated = await bundle(small, small.certificates, first, { keyEpoch: 2 });
  const rollback = await bundle(small, small.certificates, elevated, { keyEpoch: 1 });
  await assert.rejects(async () =>
    new source.Registry(await anchor(small, [first, elevated, rollback])).load(
      [first, elevated, rollback],
      1000,
    ),
  );
  const wrongIdentity = await bundle(small, small.certificates, first, {
    ownerSubject: "foreign_owner",
  });
  await assert.rejects(async () =>
    new source.Registry(await anchor(small, [first, wrongIdentity])).load(
      [first, wrongIdentity],
      1000,
    ),
  );
  const malformed = clone(first);
  malformed.entries[0].unknown = true;
  await assert.rejects(async () =>
    new source.Registry(await anchor(small)).load([malformed], 1000),
  );
  for (const [changes, code] of [
    [{ unexpectedField: true }, "invalid_schema"],
    [{ capabilities: ["result_write"] }, "invalid_certificate"],
  ]) {
    const payload = { ...small.certificates[0].payload, ...changes };
    const invalid = {
      payload,
      signed: await sign(payload, small.root.privateKey, small.root.kid, "fv-control+jws"),
    };
    const bad = await bundle(small, [invalid, ...small.certificates.slice(1, 3)], first);
    await assert.rejects(
      async () => new source.Registry(await anchor(small, [first, bad])).load([first, bad], 1000),
      { code },
    );
  }
  const replacement = await add(small, "replacement", "device_sig", "device_sig", null, 1);
  const conflict = await bundle(small, [replacement, ...small.certificates.slice(1, 3)], first);
  await assert.rejects(async () =>
    new source.Registry(await anchor(small, [first, conflict])).load([first, conflict], 1000),
  );
  replacement.payload.keyEpoch = 2;
  replacement.signed = await sign(
    replacement.payload,
    small.root.privateKey,
    small.root.kid,
    "fv-control+jws",
  );
  const advanced = await bundle(small, small.certificates, first);
  const r = await new source.Registry(await anchor(small, [first, advanced])).load(
    [first, advanced],
    1000,
  );
  assert.throws(() => r.cert(key, "device_sig", null, 1000));
  assert.equal(r.cert(replacement.payload.keyId, "device_sig", null, 1000).keyEpoch, 2);
});

test("portable fixed-profile verifier returns isolated static evidence and never authority", async () => {
  const check = source.createRegistryCertificateVerifier(f.root.publicJwk, f.root.kid);
  const signed = f.certificates[0].signed,
    expected = f.certificates[0].payload;
  await observed(async (counts) => {
    const first = await check(signed);
    assert.deepEqual(first, {
      payload: expected,
      publicKeyId: expected.keyId,
      payloadDigest: await digest(expected),
    });
    first.payload.publicJwk.x = "forged";
    first.payload.capabilities.push("forged");
    const second = await check(clone(signed));
    assert.deepEqual(second.payload, expected);
    assert.equal(counts.signatures, 1);
    assert.equal(counts.schemas.KeyCertificatePayload, 1);
    assert.equal(counts.keyIds, 2);
    assert.equal(counts.digests, 1);
    const otherAttempt = source.createRegistryCertificateVerifier(f.root.publicJwk, f.root.kid);
    assert.deepEqual(await otherAttempt(signed), second);
    assert.equal(counts.signatures, 2);
    assert.equal(counts.schemas.KeyCertificatePayload, 2);
  });
  assert.equal(typeof distribution.createRegistryCertificateVerifier, "function");
  assert.deepEqual(
    await distribution.createRegistryCertificateVerifier(f.root.publicJwk, f.root.kid)(signed),
    await check(signed),
  );
  await assert.rejects(() =>
    source.createRegistryCertificateVerifier(f.root.publicJwk, "wrong")(signed),
  );
});

test("fixed certificate schema and complete curve checks fail every time without memo success", async () => {
  const p = f.certificates[0].payload;
  const missing = clone(p);
  delete missing.principalId;
  const candidates = [
    missing,
    { ...p, extra: true },
    { ...p, publicJwk: { ...p.publicJwk, extra: true } },
    { ...p, publicJwk: { ...p.publicJwk, d: "private" } },
    { ...p, publicJwk: { ...p.publicJwk, x: "A".repeat(43), y: "A".repeat(43) } },
    { ...p, publicJwk: { ...p.publicJwk, x: "malformed" } },
  ];
  for (const payload of candidates) {
    const signed = await sign(payload, f.root.privateKey, f.root.kid, "fv-control+jws");
    await observed(async (counts) => {
      const check = source.createRegistryCertificateVerifier(f.root.publicJwk, f.root.kid);
      for (let n = 0; n < 2; n++) await assert.rejects(() => check(signed));
      assert.equal(counts.signatures, 2);
      assert.equal(counts.schemas.KeyCertificatePayload, 2);
    });
  }
  for (const root of [
    { ...f.root.publicJwk, extra: true },
    { ...f.root.publicJwk, d: "private" },
    { ...f.root.publicJwk, x: "A".repeat(43), y: "A".repeat(43) },
  ])
    await assert.rejects(() =>
      source.createRegistryCertificateVerifier(root, f.root.kid)(f.certificates[0].signed),
    );
});

test("portable fixed verifier snapshots Root and signed bytes before its first await", async () => {
  const root = clone(f.root.publicJwk),
    mutable = clone(f.certificates[0].signed);
  const changed = await sign(
    { ...f.certificates[0].payload, keyEpoch: 2 },
    f.root.privateKey,
    f.root.kid,
    "fv-control+jws",
  );
  const entered = defer(),
    release = defer();
  let block = true;
  await observed(
    async (counts) => {
      const check = source.createRegistryCertificateVerifier(root, f.root.kid);
      const pending = check(mutable);
      await entered.promise;
      Object.assign(mutable, changed);
      root.x = "forged";
      release.resolve();
      assert.deepEqual((await pending).payload, f.certificates[0].payload);
      assert.deepEqual((await check(f.certificates[0].signed)).payload, f.certificates[0].payload);
      assert.equal(counts.signatures, 1);
      assert.equal((await check(mutable)).payload.keyEpoch, 2);
      assert.equal(counts.signatures, 2);
    },
    {
      importKey: async () => {
        if (block) {
          block = false;
          entered.resolve();
          await release.promise;
        }
      },
    },
  );
});

test("fixed verifier item capacity falls back with full static checks", async () => {
  const signed = [];
  for (let n = 0; n < 129; n++)
    signed.push(
      await sign(
        { ...f.certificates[0].payload, certificateId: `bounded_${n}` },
        f.root.privateKey,
        f.root.kid,
        "fv-control+jws",
      ),
    );
  await observed(async (counts) => {
    const check = source.createRegistryCertificateVerifier(f.root.publicJwk, f.root.kid);
    for (const item of signed) await check(item);
    await check(signed[0]);
    assert.equal(counts.signatures, 129);
    assert.equal(counts.schemas.KeyCertificatePayload, 129);
    await check(signed.at(-1));
    assert.equal(counts.signatures, 130);
    assert.equal(counts.schemas.KeyCertificatePayload, 130);
  });
});

test("Registry load isolates mutable rows across asynchronous static verification", async () => {
  const history = clone(f.history),
    pin = await anchor(f),
    entered = defer(),
    release = defer();
  let block = true,
    checkedPrivateBundle;
  await observed(
    async () => {
      const pending = new source.Registry(pin).load(history, 1000);
      await entered.promise;
      assert.ok(checkedPrivateBundle, "the actual private bundle passed schema validation");
      assert.notEqual(checkedPrivateBundle, history[0]);
      assert.notEqual(checkedPrivateBundle.entries[0], history[0].entries[0]);
      history[0].entries[0].active = false;
      history[0].entries[0].certificate.payload = "forged";
      assert.equal(checkedPrivateBundle.entries[0].active, true);
      release.resolve();
      const loaded = await pending;
      assert.equal(
        loaded.cert(f.certificates[0].payload.keyId, "device_sig", null, 1000).active,
        true,
      );
    },
    {
      schema: (name, value) => {
        if (
          name === "RegistryBundle" &&
          value !== history[0] &&
          value.checkpoint.payload === history[0].checkpoint.payload
        )
          checkedPrivateBundle = value;
      },
      verify: async () => {
        if (block) {
          block = false;
          entered.resolve();
          await release.promise;
        }
      },
    },
  );
});

test("static evidence does not replace each certificate's dynamic identity and role decisions", async () => {
  const small = await fixture(),
    first = small.history[0];
  const p = small.certificates[0].payload;
  for (const change of [
    { ownerSubject: "foreign_owner" },
    { vaultId: "foreign_vault" },
    { issuerKeyId: small.certificates[1].payload.keyId },
    { keyId: small.certificates[1].payload.keyId },
    { expiresAt: p.notBefore },
    { connectionId: "foreign_connection" },
    { capabilities: ["result_write"] },
    { role: "root_sig", capabilities: [] },
  ]) {
    const payload = { ...p, ...change };
    const signed = await sign(payload, small.root.privateKey, small.root.kid, "fv-control+jws");
    const bad = await bundle(small, [{ payload, signed }, ...small.certificates.slice(1)], first);
    await assert.rejects(async () =>
      new source.Registry(await anchor(small, [first, bad])).load([first, bad], 1000),
    );
  }
});
