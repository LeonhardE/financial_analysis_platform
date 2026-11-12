const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { createHarness, createOwner, createTask } = require("./full-flow-crypto-fixture.cjs");
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
test("Owner-selected temporary connection signs a bounded lease and expires without clock bypass", async (t) => {
  const f = await fixture(t);
  const packet = await f.owner.session.prepareAgentCredential({ ...f.args, lifetimeSeconds: 900 });
  assert.equal(packet.credentialLifetimeSeconds, 900);
  assert.equal(packet.expectedLease.expiresAt - packet.expectedLease.issuedAt, 900);
  await install(f, packet);
  const state = {
    ...f.args.current,
    identity: packet.identity,
    binding: packet.body.command.binding,
    approval: packet.body.command.approval,
    lease: packet.expectedLease,
    status: "active",
  };
  const inspect = () =>
    f.owner.session.inspectAgentCredential({ actor: f.args.actor, state, hubOrigin: f.origin });
  assert.equal((await inspect()).status, "expiring");
  f.owner.time(packet.expectedLease.expiresAt - 1);
  assert.equal((await inspect()).status, "expiring");
  f.owner.time(packet.expectedLease.expiresAt);
  assert.equal((await inspect()).status, "expired");
});

test("Owner Worker rejects unsupported or Agent-supplied connection lifetimes", async (t) => {
  const f = await fixture(t);
  for (const lifetimeSeconds of [0, 899, 901, 7776001, -1, "900", null, undefined])
    await assert.rejects(() =>
      f.owner.session.prepareAgentCredential({ ...f.args, lifetimeSeconds }),
    );
  await assert.rejects(() =>
    f.owner.session.prepareAgentCredential({
      ...f.args,
      handoff: { ...f.args.handoff, lifetimeSeconds: 900 },
    }),
  );
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
  const a = await renewalOffer(f, first);
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

async function renewalOffer(f, first) {
  const { args, owner, sdk } = f;
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
  return a;
}
function credential(f, packet) {
  return {
    ...f.args.current,
    identity: packet.identity,
    binding: packet.body.command.binding,
    approval: packet.body.command.approval,
    lease: packet.expectedLease,
    status: "active",
  };
}
const identityState = (state) => ({
  contractVersion: state.contractVersion,
  profile: "folioview.persistent-agent-identity.v1",
  identity: state.identity,
  binding: state.binding,
  revocation: null,
  connectionRevoked: false,
});
const resourceState = (state, receipts = []) => ({
  contractVersion: state.contractVersion,
  profile: "folioview.persistent-resource-consent.v1",
  consent: receipts.at(-1)?.consent ?? null,
  operations: receipts.map((r) => r.operationId),
  parentRevoked: false,
});
function source(state, receipts = [], predecessor = null) {
  return {
    state: {
      contractVersion: state.contractVersion,
      profile: "folioview.agent-restoration.v1",
      source: {
        connectionId: state.identity.connectionId,
        bindingFingerprint: state.identity.bindingFingerprint,
        credentialFingerprint: state.lease.credentialFingerprint,
        generation: state.lease.generation,
      },
      historical: false,
      identityState: identityState(state),
      credential: { lease: state.lease, approval: state.approval },
      resourceState: resourceState(state, receipts),
      predecessor,
    },
    receipts,
  };
}
async function consentReceipt(f, packet, resources, prior = null) {
  return {
    operationId: packet.operationId,
    command: packet.body.command,
    consent: packet.expected,
    fingerprint: await f.sdk.fingerprint(packet.body.command),
    priorDigest: prior ? await f.sdk.digest(prior) : null,
    sourceStates: resources.map((r) => ({
      ownerSubject: f.owner.owner,
      vaultId: f.owner.vault.vaultId,
      ref: r.ref,
      sourceEpoch: r.sourceEpoch,
      currentRevision: r.revision,
      state: "active",
    })),
  };
}
test("Root-verified renewal restores only original continuing scope; latest revocation and source changes prevent revival", async (t) => {
  const f = await fixture(t),
    first = await f.owner.session.prepareAgentCredential(f.args);
  await install(f, first);
  const state = credential(f, first),
    ref = {
      kind: "watchlist",
      sourceService: "user",
      resourceId: "synthetic_watchlist",
      incarnation: "synthetic_incarnation",
    },
    resources = [{ ref, sourceEpoch: 1, revision: 1, state: "active" }],
    common = {
      actor: f.args.actor,
      identityState: identityState(state),
      resourceState: resourceState(state),
      receipts: [],
    };
  const approved = await f.owner.session.preparePersistentConsent({ ...common, resources }),
    receipt = await consentReceipt(f, approved, resources);
  const oldSource = source(state, [receipt]);
  const { compile } = require("./resource-library-helpers.cjs");
  const transport = compile("../lib/server/owner-transport.ts", {
    "server-only": {},
    "node:crypto": require("node:crypto"),
    jose: {},
  });
  const dto = compile("../lib/server/persistent-owner-contracts.ts", {
    "server-only": {},
    "ajv/dist/2020": require("ajv/dist/2020"),
    "ajv-formats": require("ajv-formats"),
    "../../../../packages/encrypted-workspace/schemas.json": require("../../../packages/encrypted-workspace/schemas.json"),
    "./owner-transport": transport,
  });
  const route = `/api/v3/agent-credentials/${state.identity.vaultId}/${state.identity.connectionId}/restoration/${oldSource.state.source.connectionId}/${oldSource.state.source.bindingFingerprint}`;
  assert.equal(dto.persistentResponse(route, "GET", oldSource.state), true);
  assert.equal(
    dto.persistentResponse(route, "GET", { ...oldSource.state, secret: "FORBIDDEN" }),
    false,
  );
  assert.equal(
    dto.persistentResponse(
      route.replace(oldSource.state.source.bindingFingerprint, "f".repeat(64)),
      "GET",
      oldSource.state,
    ),
    false,
  );

  const task = (await createTask(f.h, f.owner, { bindings: [{ ref, sourceEpoch: 1 }] })).task;
  const originalTask = await f.owner.session.preparePersistentTask({
    ...common,
    resourceState: resourceState(state, [receipt]),
    receipts: [receipt],
    task,
    authority: {
      contractVersion: f.sdk.CONTRACT,
      profile: f.sdk.PROFILE,
      authority: null,
      envelope: null,
    },
    resultPolicy: "owner_inbox",
    allowReassign: false,
  });
  const authority = {
    contractVersion: f.sdk.CONTRACT,
    profile: f.sdk.PROFILE,
    authority: {
      publicationId: originalTask.operationId,
      fingerprint: originalTask.fingerprint,
      context: originalTask.context,
    },
    envelope: originalTask.body.envelope,
  };
  const pendingCheck = {
    actor: f.args.actor,
    current: state,
    hubOrigin: f.origin,
    packet: originalTask,
  };
  assert.equal(
    (await f.owner.session.verifySupersededPublicationPending(pendingCheck)).superseded,
    false,
    "the current directory cannot supersede its own original publication",
  );
  const renew = await renewalOffer(f, first),
    second = await f.owner.session.prepareAgentCredential(renew);
  await install(f, second);
  const current = credential(f, second),
    currentSource = source(current, [], oldSource.state.source),
    sources = [currentSource, oldSource],
    args = { actor: f.args.actor, current, sources, hubOrigin: f.origin, legacyConnectionId: null };
  const superseded = { ...pendingCheck, current };
  assert.deepEqual(await f.owner.session.verifySupersededPublicationPending(superseded), {
    operationId: originalTask.operationId,
    fingerprint: originalTask.fingerprint,
    superseded: true,
  });
  for (const change of [
    (v) => (v.packet.operationId = "synthetic_foreign_operation_0001"),
    (v) => (v.packet.fingerprint = "f".repeat(64)),
    (v) => v.packet.context.registrySequence++,
    (v) => (v.packet.identity.clientId = "foreign_client"),
    (v) => (v.packet.body.envelope.proof.signature = "a".repeat(86)),
    (v) => (v.actor.connectionId = "foreign_connection"),
    (v) => (v.current.status = "revoked"),
    (v) => (v.packet.kind = "credential"),
    (v) => (v.hubOrigin = "https://foreign.example"),
  ]) {
    const bad = clone(superseded);
    change(bad);
    await assert.rejects(() => f.owner.session.verifySupersededPublicationPending(bad));
  }
  const scope = await f.owner.session.verifyAgentRestoration(args);
  assert.equal(scope.permissions.length, 1);
  assert.equal(scope.identities.length, 2);
  const control = {
    actor: f.args.actor,
    identityState: identityState(current),
    resourceState: resourceState(current),
    receipts: [],
    credentialState: current,
    sources,
    hubOrigin: f.origin,
  };
  const restored = await f.owner.session.prepareRestoredConsent({
    ...control,
    resources: [{ ...resources[0], revision: 4 }],
  });
  assert.equal(restored.expected.permissions[0].fromRevision, 4);
  assert.deepEqual(restored.expected.permissions[0].selectedHistory, []);
  for (const change of [
    (v) => v.resources[0].sourceEpoch++,
    (v) => (v.resources[0].revision = 0),
    (v) => (v.resources[0].ref.resourceId = "foreign_source"),
  ]) {
    const bad = clone({ ...control, resources });
    change(bad);
    await assert.rejects(() => f.owner.session.prepareRestoredConsent(bad));
  }
  const restoredReceipt = await consentReceipt(f, restored, [{ ...resources[0], revision: 4 }]);
  const approvedControl = {
    ...control,
    resourceState: resourceState(current, [restoredReceipt]),
    receipts: [restoredReceipt],
  };
  const restoredTask = await f.owner.session.prepareRestoredTask({
    ...approvedControl,
    task,
    authority,
  });
  assert.equal(restoredTask.context.authorityVersion, originalTask.context.authorityVersion + 1);
  assert.equal(restoredTask.context.agentId, current.identity.agentId);
  const foreign = clone(authority);
  foreign.authority.context.connectionId = "other_connection";
  await assert.rejects(() =>
    f.owner.session.prepareRestoredTask({ ...approvedControl, task, authority: foreign }),
  );
  const revoked = await f.owner.session.preparePersistentRevocation({
    actor: f.args.actor,
    identityState: approvedControl.identityState,
    resourceState: approvedControl.resourceState,
    receipts: approvedControl.receipts,
    permissionIds: [restored.expected.permissions[0].permissionId],
  });
  const revokedReceipt = await consentReceipt(f, revoked, [], restored.expected),
    chain = [restoredReceipt, revokedReceipt];
  const newest = { ...control, resourceState: resourceState(current, chain), receipts: chain };
  await assert.rejects(
    () => f.owner.session.prepareRestoredConsent({ ...newest, resources }),
    /resource_not_approved/,
  );
  const newSources = [source(current, chain, oldSource.state.source), oldSource];
  assert.equal(
    (await f.owner.session.verifyAgentRestoration({ ...args, sources: newSources })).permissions
      .length,
    0,
  );
  for (const change of [
    (v) => v.sources.reverse(),
    (v) => (v.sources[0].state.predecessor = null),
    (v) => (v.sources[1].state.source.credentialFingerprint = "f".repeat(64)),
    (v) => (v.sources[1].receipts[0].consent.permissions[0].status = "revoked"),
    (v) => (v.sources[1].state.identityState.identity.clientId = "other_client"),
  ]) {
    const bad = clone(args);
    change(bad);
    await assert.rejects(() => f.owner.session.verifyAgentRestoration(bad));
  }
});

test("a fresh verified handoff may retire only an expired uncommitted credential journal", async (t) => {
  const f = await fixture(t),
    packet = await f.owner.session.prepareAgentCredential(f.args);
  await install(f, packet);
  const replacement = await renewalOffer(f, packet);
  const args = { ...replacement, packet, previousSetup: f.args.setup };
  assert.deepEqual(await f.owner.session.verifyExpiredCredentialPending(args), {
    operationId: packet.operationId,
  });
  for (const change of [
    (a) => (a.previousSetup.expiresAt = a.setup.issuedAt + 1),
    (a) => (a.previousSetup.consumedBy = packet.operationId),
    (a) => (a.previousSetup.connectionId = "other_connection"),
    (a) => (a.packet.kind = "consent"),
    (a) => (a.packet.operationId = "another_operation_0000000001"),
    (a) => (a.handoff.secret = b64(new Uint8Array(32))),
  ]) {
    const bad = clone(args);
    change(bad);
    await assert.rejects(() => f.owner.session.verifyExpiredCredentialPending(bad));
  }
});
