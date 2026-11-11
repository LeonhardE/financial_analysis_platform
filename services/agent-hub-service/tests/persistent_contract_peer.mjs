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
} from "../../../packages/encrypted-workspace/dist/core.mjs";
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
  assert.equal(checked.fingerprint, await fingerprint(v.carrier.proof));
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
}
