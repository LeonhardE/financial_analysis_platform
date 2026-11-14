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
import {validate as checkedValidate} from ${distributionUrl};
let observer=()=>{};
export function setSchemaObserver(value){observer=value}
export function validate(name,value){observer(name);return checkedValidate(name,value)}
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
  const counts = { signatures: 0, schemas: {} };
  bridge.setSchemaObserver((name) => {
    counts.schemas[name] = (counts.schemas[name] ?? 0) + 1;
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

test("23-generation source and distribution retain authority and every schema check with 598 to 70 signatures", async () => {
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
    RegistryBundle: 23,
    RegistryCheckpointPayload: 23,
    KeyCertificatePayload: 575,
  });
  assert.deepEqual(reused.counts.schemas, baseline.counts.schemas);
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
  await observed(async (counts) => {
    const check = certificateVerifier(f.root.publicJwk, f.root.kid);
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
    await assert.rejects(() => certificateVerifier(other.publicJwk, other.kid)(original));
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
