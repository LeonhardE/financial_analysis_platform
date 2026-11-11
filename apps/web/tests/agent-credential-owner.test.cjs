const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { createHarness, createOwner } = require("./full-flow-crypto-fixture.cjs");
const clone = (v) => structuredClone(v);
const b64 = (b) => Buffer.from(b).toString("base64url");
async function fixture(t, { provider = "muse" } = {}) {
  const h = await createHarness();
  t.after(() => h.close());
  const owner = await createOwner(h),
    sdk = await import(
      pathToFileURL(path.resolve(__dirname, "../../../packages/encrypted-workspace/dist/core.mjs"))
        .href
    );
  const sig = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]),
    enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
  const clean = (j) => Object.fromEntries(["kty", "crv", "x", "y"].map((k) => [k, j[k]]));
  const publicSig = clean(await crypto.subtle.exportKey("jwk", sig.publicKey)),
    publicEnc = clean(await crypto.subtle.exportKey("jwk", enc.publicKey));
  const actor = {
      connectionId: "synthetic_owned_connection",
      clientId: provider + "_synthetic_client",
    },
    origin = "https://synthetic-hub.example",
    secret = crypto.getRandomValues(new Uint8Array(32));
  const setup = {
    setupIntentId: "setup_synthetic_owner_credential_01",
    ownerSubject: owner.owner,
    vaultId: owner.vault.vaultId,
    ...actor,
    authorizationId: "synthetic_native_authorization",
    issuedAt: 1000,
    expiresAt: 1600,
    expectedGeneration: 0,
    expectedCredentialFingerprint: null,
    offer: null,
    consumedBy: null,
    issuer: origin,
    provider,
    predecessorConnectionId: null,
  };
  const fields = [
      "setupIntentId",
      "ownerSubject",
      "vaultId",
      "connectionId",
      "clientId",
      "authorizationId",
      "issuedAt",
      "expiresAt",
      "expectedGeneration",
      "expectedCredentialFingerprint",
    ],
    context = {
      profile: "folioview.agent-pairing.v1",
      issuer: origin,
      provider,
      ...Object.fromEntries(fields.map((k) => [k, setup[k]])),
    };
  const signed = await sdk.sign(
    {
      contractVersion: sdk.CONTRACT,
      profile: "folioview.agent-key-offer.v1",
      artifactType: "agent_key_offer",
      ...Object.fromEntries(Object.entries(context).filter(([k]) => k !== "profile")),
      agentId: "agent_" + (await sdk.keyId(publicSig)),
      signingPublicJwk: publicSig,
      encryptionPublicJwk: publicEnc,
    },
    sig.privateKey,
    await sdk.keyId(publicSig),
    "fv-control+jws",
  );
  const key = await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]),
    iv = crypto.getRandomValues(new Uint8Array(12));
  setup.offer = {
    version: 1,
    iv: b64(iv),
    ciphertext: b64(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: sdk.canonical({ ...context, phase: "offer" }) },
        key,
        sdk.canonical(signed),
      ),
    ),
  };
  const current = {
    contractVersion: sdk.CONTRACT,
    profile: "folioview.agent-credential.v1",
    identity: null,
    binding: null,
    lease: null,
    approval: null,
    status: "reauthorization_required",
    defaultValiditySeconds: 7776000,
    noticeSeconds: 604800,
  };
  const args = {
    actor,
    setup,
    current,
    hubOrigin: origin,
    handoff: {
      version: 1,
      issuer: origin,
      vaultId: owner.vault.vaultId,
      connectionId: actor.connectionId,
      setupIntentId: setup.setupIntentId,
      secret: b64(secret),
    },
  };
  return { h, owner, sdk, args, context, key, sig, enc, provider, origin };
}
async function install(f, packet) {
  const update = packet.registryUpdate;
  if (update) {
    f.owner.vault.registryHistory.push(update.registryBundle);
    f.owner.vault.version++;
    await f.owner.session.acceptVault(f.owner.vault);
  }
}
test("Owner Worker verifies encrypted offer and signs one 90-day credential without exposing private keys", async (t) => {
  const f = await fixture(t),
    { owner, args, sdk } = f;
  const review = await owner.session.inspectAgentCredentialSetup(args);
  assert.equal(review.provider, "muse");
  assert.deepEqual(Object.keys(review).sort(), ["expiresAt", "provider", "reviewDigest"]);
  const packet = await owner.session.prepareAgentCredential(args);
  assert.equal(packet.kind, "credential");
  assert.equal(packet.expectedLease.expiresAt, 1000 + 7776000);
  assert.equal(packet.expectedLease.generation, 1);
  assert.equal(packet.expectedLease.previousCredentialFingerprint, null);
  assert.equal(JSON.stringify(packet).includes(args.handoff.secret), false);
  const command = packet.body.command;
  const activation = JSON.parse(
    Buffer.from(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: Buffer.from(command.activation.iv, "base64url"),
          additionalData: sdk.canonical({ ...f.context, phase: "activation" }),
        },
        f.key,
        Buffer.from(command.activation.ciphertext, "base64url"),
      ),
    ),
  );
  assert.equal(activation.rootKeyId, owner.vault.rootKeyId);
  assert.deepEqual(activation.lease, packet.expectedLease);
  const publicSig = await crypto.subtle.exportKey("jwk", f.sig.publicKey);
  assert.equal(
    activation.identity.agentSigningKeyId,
    await sdk.keyId(Object.fromEntries(["kty", "crv", "x", "y"].map((k) => [k, publicSig[k]]))),
  );
  await install(f, packet);
  const receipt = {
    contractVersion: sdk.CONTRACT,
    profile: "folioview.agent-credential.v1",
    operationId: packet.operationId,
    fingerprint: await sdk.fingerprint(command.approval),
    identity: packet.identity,
    binding: command.binding,
    approval: command.approval,
    lease: packet.expectedLease,
  };
  assert.deepEqual(await owner.session.verifyPersistentReceipt({ packet, receipt }), {
    operationId: packet.operationId,
  });
  const state = {
    ...args.current,
    ...{
      identity: receipt.identity,
      binding: receipt.binding,
      lease: receipt.lease,
      approval: receipt.approval,
      status: "active",
    },
  };
  assert.equal(
    (await owner.session.inspectAgentCredential({ actor: args.actor, state, hubOrigin: f.origin }))
      .status,
    "active",
  );
  owner.time(1000 + 7776000 - 604800);
  assert.equal(
    (await owner.session.inspectAgentCredential({ actor: args.actor, state, hubOrigin: f.origin }))
      .status,
    "expiring",
  );
  owner.time(1000 + 7776000);
  assert.equal(
    (await owner.session.inspectAgentCredential({ actor: args.actor, state, hubOrigin: f.origin }))
      .status,
    "expired",
  );
  assert.deepEqual(await owner.session.verifyPersistentReceipt({ packet, receipt }), {
    operationId: packet.operationId,
  });
});
test("wrong Owner/provider/intent/secret/origin and expired setup fail before producing a registry update", async (t) => {
  const f = await fixture(t, { provider: "chatgpt" });
  assert.equal((await f.owner.session.inspectAgentCredentialSetup(f.args)).provider, "chatgpt");
  for (const change of [
    (a) => (a.handoff.issuer = "https://wrong.example"),
    (a) => (a.setup.provider = "muse"),
    (a) => (a.setup.ownerSubject = "b".repeat(64)),
    (a) => (a.handoff.secret = b64(new Uint8Array(32))),
    (a) => (a.setup.expectedGeneration = 2),
    (a) => (a.setup.expiresAt = 1000),
  ]) {
    const a = clone(f.args);
    change(a);
    await assert.rejects(() => f.owner.session.prepareAgentCredential(a));
  }
  assert.equal(f.owner.vault.registryHistory.length, 1);
});

test("explicit renewal uses fresh keys, preserves old certificates through CAS and advances the lease once", async (t) => {
  const f = await fixture(t),
    { owner, sdk, args } = f;
  const first = await owner.session.prepareAgentCredential(args);
  await install(f, first);
  const a = clone(args),
    sig = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]),
    enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
  const clean = (j) => Object.fromEntries(["kty", "crv", "x", "y"].map((k) => [k, j[k]]));
  const signingPublicJwk = clean(await crypto.subtle.exportKey("jwk", sig.publicKey)),
    encryptionPublicJwk = clean(await crypto.subtle.exportKey("jwk", enc.publicKey));
  a.current = {
    ...a.current,
    identity: first.identity,
    binding: first.body.command.binding,
    approval: first.body.command.approval,
    lease: first.expectedLease,
    status: "active",
  };
  a.setup.setupIntentId = "setup_synthetic_owner_credential_02";
  a.handoff.setupIntentId = a.setup.setupIntentId;
  owner.time(1000 + 7776000);
  a.current.status = "expired";
  a.setup.issuedAt = owner.now();
  a.setup.expiresAt = owner.now() + 600;
  a.setup.expectedGeneration = 1;
  a.setup.expectedCredentialFingerprint = first.expectedLease.credentialFingerprint;
  const context = {
    ...f.context,
    setupIntentId: a.setup.setupIntentId,
    issuedAt: a.setup.issuedAt,
    expiresAt: a.setup.expiresAt,
    expectedGeneration: 1,
    expectedCredentialFingerprint: first.expectedLease.credentialFingerprint,
  };
  const signed = await sdk.sign(
    {
      contractVersion: sdk.CONTRACT,
      profile: "folioview.agent-key-offer.v1",
      artifactType: "agent_key_offer",
      ...Object.fromEntries(Object.entries(context).filter(([k]) => k !== "profile")),
      agentId: "agent_" + (await sdk.keyId(signingPublicJwk)),
      signingPublicJwk,
      encryptionPublicJwk,
    },
    sig.privateKey,
    await sdk.keyId(signingPublicJwk),
    "fv-control+jws",
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  a.setup.offer = {
    version: 1,
    iv: b64(iv),
    ciphertext: b64(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: sdk.canonical({ ...context, phase: "offer" }) },
        f.key,
        sdk.canonical(signed),
      ),
    ),
  };
  const renewed = await owner.session.prepareAgentCredential(a);
  assert.equal(renewed.expectedLease.generation, 2);
  assert.equal(
    renewed.expectedLease.previousCredentialFingerprint,
    first.expectedLease.credentialFingerprint,
  );
  assert.notEqual(renewed.identity.agentSigningKeyId, first.identity.agentSigningKeyId);
  assert.notEqual(renewed.identity.agentEncryptionKeyId, first.identity.agentEncryptionKeyId);
  const old = renewed.registryUpdate.registryBundle.entries.filter((e) =>
    [first.identity.agentSigningKeyId, first.identity.agentEncryptionKeyId].includes(
      JSON.parse(Buffer.from(e.certificate.payload, "base64url")).keyId,
    ),
  );
  assert.equal(old.length, 2);
  assert.ok(old.every((e) => e.active));
  assert.equal(
    owner.vault.registryHistory.length,
    2,
    "preparing cannot commit a directory or invalidate old credentials",
  );
  const wrong = clone(a);
  wrong.setup.expectedGeneration = 0;
  await assert.rejects(() => owner.session.prepareAgentCredential(wrong));
});
