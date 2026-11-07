import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Registry,
  verifyEnvelope,
  requestProof,
  open,
  seal,
  jose,
  keyId,
  verify,
  digest,
  fingerprint,
  verifyConsentChain,
  permissionFor,
  RuntimeStorage,
} from "../runtime/dist/core.mjs";
import { IDBFactory } from "./fixtures/idb-runtime.mjs";
const v = JSON.parse(readFileSync(0, "utf8"));
if (v.mode === "proof") {
  const privateKey = await jose.importJWK(v.signingPrivateJwk, "ES256");
  const args = {
    identity: v.identity,
    audience: "https://hub.example",
    path: v.path,
    request: v.request,
    now: 1000,
    privateKey,
  };
  const proof = await requestProof(args);
  await assert.rejects(() => requestProof({ ...args, path: v.path + "/../session" }));
  await assert.rejects(() => requestProof({ ...args, audience: "https://hub.example/path" }));
  console.log(JSON.stringify({ proof }));
} else if (v.mode === "content") {
  const c = v.context;
  const registry = await new Registry({
    rootJwk: v.rootJwk,
    rootKeyId: await keyId(v.rootJwk),
    ownerSubject: c.ownerSubject,
    vaultId: c.vaultId,
    rootEpoch: 1,
    registrySequence: 1,
    checkpointDigest: c.checkpointDigest,
  }).load([v.bundle], 1000);
  await registry.binding(v.binding, v.identity, v.identity, 1000);
  const checked = await verifyEnvelope(v.carrier, {
    registry,
    identity: v.identity,
    expected: c,
    now: 1000,
  });
  assert.equal(checked.fingerprint, await digestInput(v.carrier.proof));
  const privateKey = await jose.importJWK(v.recipientPrivateJwk, "ECDH-ES+A256KW");
  assert.deepEqual(await open(v.carrier, privateKey, c), v.privatePayload.payload);
  const signer = await jose.importJWK(v.signingPrivateJwk, "ES256");
  const carrier = await seal(v.privatePayload.payload, c, v.publicKeys, signer);
  await verifyEnvelope(carrier, {
    registry,
    identity: v.identity,
    expected: c,
    now: 1000,
    purpose: "new_publication",
  });
  assert.deepEqual(await open(carrier, privateKey, c), v.privatePayload.payload);
  const forged = structuredClone(carrier);
  const rawTag = jose.base64url.decode(forged.jwe.tag);
  rawTag[0] ^= 1;
  forged.jwe.tag = jose.base64url.encode(rawTag);
  await assert.rejects(() =>
    verifyEnvelope(forged, { registry, identity: v.identity, expected: c, now: 1000 }),
  );
  const other = structuredClone(c);
  other.connectionId = "wrong_connection";
  await assert.rejects(() =>
    verifyEnvelope(carrier, { registry, identity: v.identity, expected: other, now: 1000 }),
  ); // expected identity fields separately below
  console.log(JSON.stringify({ carrier }));
} else if (v.mode === "consent") {
  const registry = await new Registry(v.anchor).load(v.history, 1000);
  const state = await verifyConsentChain({ ...v, registry });
  assert.deepEqual(state, v.consent);
  const mutated = structuredClone(v);
  mutated.consent.permissions[0].fromRevision = 1;
  await assert.rejects(() => verifyConsentChain({ ...mutated, registry }));
  await assert.rejects(() =>
    verifyConsentChain({
      ...v,
      registry,
      pin: { version: v.consent.version + 1, digest: "0".repeat(64) },
    }),
  );
  const changedControl = structuredClone(v);
  const sig = jose.base64url.decode(changedControl.receipts[0].command.signature);
  sig[0] ^= 1;
  changedControl.receipts[0].command.signature = jose.base64url.encode(sig);
  await assert.rejects(() => verifyConsentChain({ ...changedControl, registry }));
  for (const p of state.permissions)
    if (p.status === "revoked")
      assert.throws(() =>
        permissionFor(state, {
          ...p,
          sourceRevision: Math.max(1, p.fromRevision),
          permissionEpoch: p.permissionEpoch - 1,
        }),
      );
  console.log("{}");
} else if (v.mode === "storage") {
  const actor = {
    issuer: "https://hub.example",
    ownerSubject: "owner",
    vaultId: "vault",
    connectionId: "conn",
    clientId: "client",
  };
  const factory = new IDBFactory(),
    one = new RuntimeStorage(factory),
    two = new RuntimeStorage(factory);
  await assert.rejects(
    () => one.profile(actor),
    (e) => e.code === "lost_private_keys",
  );
  const [a, b] = await Promise.all([
    one.profile(actor, { create: true }),
    two.profile(actor, { create: true }),
  ]);
  assert.deepEqual(a.signingPublicJwk, b.signingPublicJwk);
  assert.deepEqual(a.encryptionPublicJwk, b.encryptionPublicJwk);
  assert.equal(a.signingPrivateKey.extractable, false);
  assert.equal(a.encryptionPrivateKey.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey("jwk", a.signingPrivateKey));
  await assert.rejects(() => crypto.subtle.exportKey("jwk", a.encryptionPrivateKey));
  const restored = await new RuntimeStorage(factory).profile(actor);
  assert.deepEqual(restored.signingPublicJwk, a.signingPublicJwk);
  const proof = await requestProof({
    identity: {
      ...v.identity,
      ownerSubject: "owner",
      vaultId: "vault",
      connectionId: "conn",
      clientId: "client",
      agentSigningKeyId: await keyId(a.signingPublicJwk),
      agentEncryptionKeyId: await keyId(a.encryptionPublicJwk),
    },
    audience: actor.issuer,
    path: "/agent/v3/persistent/owners/owner/vaults/vault/connections/conn/session",
    request: {},
    now: 1000,
    privateKey: restored.signingPrivateKey,
  });
  const payload = await verify(proof, a.signingPublicJwk, "fv-control+jws");
  assert.equal(payload.bodyDigest, await digest({}));
  const op = v.context.stableOperationId;
  const first = await one.originalCiphertext(actor, op, v.carrier);
  const second = await two.originalCiphertext(actor, op, { ...v.carrier });
  assert.deepEqual(first, second);
  assert.deepEqual(await new RuntimeStorage(factory).outbox(actor, op), v.carrier);
  await assert.rejects(
    () =>
      one.bind(actor, v.identity, {
        rootKeyId: v.identity.rootKeyId,
        registrySequence: 1,
        checkpointDigest: v.context.checkpointDigest,
      }),
    (e) => e.code === "recipient_binding_mismatch",
  );
  console.log("{}");
}
async function digestInput(signed) {
  return fingerprint(signed);
}
