/** Pure, offline protocol checks. Fixture keys are publicly known synthetic scalars. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, copyFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  Registry,
  keyId,
  fingerprint,
  verifyEnvelope,
  open,
  canonical,
  parsed,
  bytes,
  validate,
  digest,
} from "../dist/core.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(
  await readFile(
    process.env.FOLIOVIEW_PUBLIC_CONTENT_VECTOR ??
      resolve(root, "../../services/common/tests/fixtures/persistent_content_node.json"),
    "utf8",
  ),
);
const c = fixture.context;
async function registry() {
  return new Registry({
    rootJwk: fixture.rootPublicJwk,
    rootKeyId: await keyId(fixture.rootPublicJwk),
    ownerSubject: c.ownerSubject,
    vaultId: c.vaultId,
    rootEpoch: 1,
    registrySequence: 1,
    checkpointDigest: c.checkpointDigest,
  }).load([fixture.registryBundle], 1000);
}
test("independent public Node/Python vector verifies registry, original identity and Root ciphertext", async () => {
  const r = await registry();
  await r.binding(fixture.identityBinding, fixture.identity, fixture.identity, 1000);
  const verified = await verifyEnvelope(fixture.carrier, {
    registry: r,
    identity: fixture.identity,
    expected: c,
    now: 1000,
  });
  assert.equal(verified.fingerprint, await fingerprint(fixture.carrier.proof));
  const row = fixture.registryBundle.entries
    .map((e) => parsed(bytes(e.certificate.payload), true))
    .find((e) => e.keyId === c.agentEncryptionKeyId);
  const d = BigInt(fixture.recipientTestScalar).toString(16).padStart(64, "0");
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...row.publicJwk, d: Buffer.from(d, "hex").toString("base64url") },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  assert.equal(key.extractable, false);
  assert.deepEqual(await open(fixture.carrier, key, c), fixture.privatePayload.payload);
});
test("substituted identity, recipient, ciphertext and registry pins cannot verify", async () => {
  const r = await registry(),
    args = { registry: r, identity: fixture.identity, expected: c, now: 1000 };
  for (const field of ["connectionId", "clientId", "agentId", "bindingFingerprint"])
    await assert.rejects(() =>
      verifyEnvelope(fixture.carrier, {
        ...args,
        identity: { ...fixture.identity, [field]: "substitution" },
      }),
    );
  const forged = structuredClone(fixture.carrier),
    tag = Buffer.from(forged.jwe.tag, "base64url");
  tag[0] ^= 1;
  forged.jwe.tag = tag.toString("base64url");
  await assert.rejects(() => verifyEnvelope(forged, args));
  await assert.rejects(() =>
    new Registry({ ...r.anchor, checkpointDigest: "0".repeat(64) }).load(
      [fixture.registryBundle],
      1000,
    ),
  );
});
test("strict JSON, public-key schemas and exported owner contract validators are closed", async () => {
  for (const raw of ['{"x":1,"x":2}', '{"x":9007199254740992}', '{"x":"\\ud800"}'])
    assert.throws(() => parsed(new TextEncoder().encode(raw), true));
  for (const schema of ["Identifier", "KeyId", "Digest", "TaskMetadata"])
    assert.throws(() => validate(schema, {}));
  assert.throws(() => validate("PublicJWK", { ...fixture.rootPublicJwk, d: "private_material" }));
  assert.equal(new TextDecoder().decode(canonical({ b: 1, a: 2 })), '{"a":2,"b":1}');
});
test("distribution hashes and isolated module import need no installed packages or network", async () => {
  const manifest = JSON.parse(await readFile(join(root, "integrity.json"), "utf8"));
  for (const [file, hash] of Object.entries(manifest.files))
    assert.equal(
      createHash("sha256")
        .update(await readFile(join(root, file)))
        .digest("hex"),
      hash,
      file,
    );
  const temporary = await mkdtemp(join(tmpdir(), "folioview-contracts-"));
  try {
    await copyFile(join(root, "dist/core.mjs"), join(temporary, "core.mjs"));
    const isolated = await import(pathToFileURL(join(temporary, "core.mjs")).href);
    assert.equal(await isolated.digest({ same: "vector" }), await digest({ same: "vector" }));
    assert.equal("RuntimeStorage" in isolated, false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
