const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createHarness, createOwner, decoded } = require("./full-flow-crypto-fixture.cjs");
const clone = structuredClone;
async function fixture(native = false) {
  const h = await createHarness(),
    f = await createOwner(h);
  const shared = await import(
    pathToFileURL(path.resolve(__dirname, "../../../packages/encrypted-workspace/dist/core.mjs"))
      .href
  );
  const pair = () =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const pub = async (p) =>
    Object.fromEntries(
      Object.entries(await crypto.subtle.exportKey("jwk", p.publicKey)).filter(([k]) =>
        ["kty", "crv", "x", "y"].includes(k),
      ),
    );
  const policy = await pair(),
    sig = await pair(),
    enc = await pair(),
    tls = await pair();
  const actor = {
    connectionId: "synthetic_executor",
    clientId: "synthetic_native",
  };
  const configuration = {
    ...actor,
    issuer: "https://policy.example",
    audience: "https://executor.example/mcp",
    policyJwk: await pub(policy),
    nativeRedirectUris: ["https://native.example/callback"],
  };
  const policyConfig = {
    issuer: configuration.issuer,
    consentUrl: "https://owner.example/agents",
    ownerSubject: f.owner,
    vaultId: f.vault.vaultId,
    rootJwk: f.vault.rootJwk,
    policyJwk: configuration.policyJwk,
    stateEpoch: "synthetic_epoch",
    provider: "openai_chatgpt",
    providerClientId: actor.clientId,
    audience: configuration.audience,
    kmsSigningKeyVersion:
      "projects/demo-policy-alpha/locations/global/keyRings/policy/cryptoKeys/signing/cryptoKeyVersions/1",
    kmsRecoveryKey:
      "projects/demo-policy-alpha/locations/global/keyRings/policy/cryptoKeys/recovery",
    clients: [
      {
        clientId: actor.clientId,
        redirectUris: configuration.nativeRedirectUris,
        tokenEndpointAuthMethod: "none",
        secretSha256: null,
      },
    ],
    witnessProject: "demo-policy-alpha",
    witnessDatabase: "policy-witness",
    snapshotBucket: "demo-policy-alpha-policy-state",
  };
  const recipients = f.vault.registryHistory
    .at(-1)
    .entries.map((e) => decoded(e.certificate))
    .filter((c) => ["device_enc", "recovery_enc"].includes(c.role))
    .map((c) => c.keyId)
    .sort();
  const workload = {
    projectId: "demo-executor-alpha",
    projectNumber: "123456789012",
    zone: "northamerica-northeast2-b",
    instanceName: "synthetic-executor",
    serviceAccount: "runtime@demo-executor-alpha.iam.gserviceaccount.com",
    imageDigest: "sha256:" + "a".repeat(64),
    args: ["python", "-m", "app.main"],
    environment: { EXECUTOR_NATIVE_ENABLED: native ? "1" : "0" },
    hwmodel: "GCP_AMD_SEV",
    attestationAudience: configuration.issuer + "/attestation",
  };
  const scope = {
    profile: "folioview.hub-executor-ciphertext-scope.v1",
    purpose: "analysis",
    resultPolicy: "owner_inbox",
    resourceBindings: [
      {
        ref: {
          kind: "holdings",
          sourceService: "portfolio",
          resourceId: "synthetic_source",
          incarnation: "synthetic_incarnation",
        },
        sourceEpoch: 1,
      },
    ],
  };
  const draft = {
    ownerSubject: f.owner,
    vaultId: f.vault.vaultId,
    ...actor,
    agentId: "synthetic_agent",
    provider: "openai_chatgpt",
    providerClientId: actor.clientId,
    identityEpoch: 1,
    issuer: configuration.issuer,
    audience: configuration.audience,
    policyJwk: configuration.policyJwk,
    recipientKeyIds: recipients,
    scope,
    workload,
    creationWorkload: {
      ...workload,
      serviceAccount: "creator@demo-executor-alpha.iam.gserviceaccount.com",
      attestationAudience: configuration.issuer + "/enrollment",
    },
    kmsRecoveryKey: policyConfig.kmsRecoveryKey,
    snapshotBucket: "demo-executor-alpha-executor-state",
  };
  const run = (request) =>
    f.session.prepareIndependentSetup({
      actor,
      request: { configuration, policyConfig, ...request },
    });
  const initial = await run({ action: "initialize", draft });
  const pendingOffer = {
    profile: "folioview.agent-executor.v1",
    enrollmentId: await shared.digest(
      Object.fromEntries(
        ["ownerSubject", "vaultId", "connectionId", "identityEpoch"].map((k) => [k, draft[k]]),
      ),
    ),
    draft,
    permit: initial.permit,
    agentSigningJwk: await pub(sig),
    agentEncryptionJwk: await pub(enc),
    tlsJwk: await pub(tls),
    certificateRequest: "synthetic-public-CSR",
    creationAttestation: {
      statement: { profile: "synthetic_producer_statement", action: "offer" },
      token: "synthetic.proof.token",
    },
  };
  const signed = (p) =>
    shared.sign(p, policy.privateKey, shared.keyId(configuration.policyJwk), "fv-control+jws");
  // Actual Policy producer checks CSR/Google evidence separately; this consumer
  // fixture signs only public receipt shapes with an independent synthetic key.
  const review = async (stage, offer = pendingOffer, certificateDigest = null, extra = {}) =>
    shared.sign(
      {
        profile: "folioview.executor-enrollment-review.v1",
        stage,
        domain: await shared.digest(policyConfig),
        ownerSubject: f.owner,
        vaultId: f.vault.vaultId,
        rootKeyId: f.vault.rootKeyId,
        policySigningKeyId: await shared.keyId(configuration.policyJwk),
        pendingOfferDigest: await shared.digest(pendingOffer),
        offerDigest: await shared.digest(offer),
        draftDigest: await shared.digest(draft),
        creationWorkloadDigest: await shared.digest(draft.creationWorkload),
        statementDigest: await shared.digest(offer.creationAttestation.statement),
        certificateDigest,
        instanceId: "123456789",
        issuedAt: f.now(),
        expiresAt: f.now() + 120,
        ...extra,
      },
      policy.privateKey,
      await shared.keyId(configuration.policyJwk),
      "fv-control+jws",
    );
  return {
    h,
    f,
    shared,
    actor,
    configuration,
    policyConfig,
    draft,
    initial,
    pendingOffer,
    run,
    review,
    policy,
  };
}
test("Owner Worker prepares fixed Root controls, original-key directory/binding/finalization and exact registration", async () => {
  const x = await fixture();
  try {
    const { run, f, shared, pendingOffer } = x;
    const bootstrap = await run({ action: "bootstrap" });
    assert.equal(decoded(bootstrap.command).action, "bootstrap");
    assert.equal(decoded(x.initial.permit).draftDigest, await shared.digest(x.draft));
    await run({
      action: "review_pending",
      pendingOffer,
      review: await x.review("pending"),
    });
    const prepared = await run({
      action: "finalize",
      pendingOffer,
      hubAudience: "https://hub.example",
      approvalExpiresAt: 2000,
    });
    assert.equal(
      prepared.identity.agentSigningKeyId,
      await shared.keyId(pendingOffer.agentSigningJwk),
    );
    assert.equal(prepared.setupIntentId, null);
    assert.equal(
      decoded(prepared.finalization).bindingFingerprint,
      prepared.identity.bindingFingerprint,
    );
    assert.equal(decoded(prepared.approval).operationId, prepared.operationId);
    assert.deepEqual(
      prepared,
      await run({
        action: "finalize",
        pendingOffer,
        hubAudience: "https://hub.example",
        approvalExpiresAt: 2000,
      }),
    );
    const finalOffer = {
      profile: "folioview.agent-executor.v1",
      binding: prepared.binding,
      workload: prepared.workload,
      ...Object.fromEntries(
        ["agentSigningJwk", "agentEncryptionJwk", "tlsJwk", "certificateRequest", "permit"].map(
          (k) => [k, pendingOffer[k]],
        ),
      ),
      initialStateHead: "b".repeat(64),
      wrappedStateKey: "c3ludGhldGlj",
      offerDigest: await shared.digest(pendingOffer),
      finalization: prepared.finalization,
      creationAttestation: {
        statement: {
          profile: "synthetic_producer_statement",
          action: "finalize",
        },
        token: "synthetic.proof.token",
      },
    };
    const certificateChain = "synthetic-public-chain";
    const certDigest = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(certificateChain)),
    ).toString("hex");
    const request = {
      action: "register",
      pendingOffer,
      finalOffer,
      review: await x.review("final", finalOffer, certDigest),
      certificateChain,
    };
    const ready = await run(request);
    assert.equal(ready.coreConfig.tlsJwk.x, pendingOffer.tlsJwk.x);
    assert.equal(
      decoded(ready.policy.command).parametersDigest,
      await shared.digest({
        enrollment: ready.policy.parameters,
        approval: ready.policy.approval,
      }),
    );
    assert.equal(ready.hub.body.command.signature, prepared.body.command.signature);
    assert.equal(JSON.stringify(ready).includes("PrivateJwk"), false);
    assert.equal(JSON.stringify(ready).includes('"d":'), false);
    await assert.rejects(run({ ...request, certificateChain: "tampered" }));
    await assert.rejects(
      run({
        ...request,
        finalOffer: { ...finalOffer, initialStateHead: "a".repeat(64) },
      }),
    );
  } finally {
    await x.h.close();
  }
});
test("Owner Worker refuses unsigned, expired, foreign-domain and unreviewed original enrollment", async () => {
  const x = await fixture();
  try {
    const request = {
      action: "review_pending",
      pendingOffer: x.pendingOffer,
      review: await x.review("pending"),
    };
    for (const extra of [
      { domain: "a".repeat(64) },
      { expiresAt: 1000 },
      { expiresAt: 1121 },
      { ownerSubject: "a".repeat(64) },
      { pendingOfferDigest: "a".repeat(64) },
    ])
      await assert.rejects(
        x.run({
          ...request,
          review: await x.review("pending", x.pendingOffer, null, extra),
        }),
      );
    await assert.rejects(
      x.run({
        action: "finalize",
        pendingOffer: x.pendingOffer,
        hubAudience: "https://hub.example",
        approvalExpiresAt: 2000,
      }),
    );
    await assert.rejects(
      x.run({
        action: "initialize",
        draft: { ...x.draft, rootPrivateJwk: { d: "private" } },
      }),
    );
    await assert.rejects(
      x.run({
        action: "initialize",
        draft: { ...x.draft, recipientKeyIds: [] },
      }),
    );
    await assert.rejects(
      x.f.session.prepareIndependentSetup({
        actor: x.actor,
        request: {
          action: "bootstrap",
          configuration: x.configuration,
          policyConfig: {
            ...x.policyConfig,
            rootJwk: x.configuration.policyJwk,
          },
        },
      }),
    );
    await x.run(request);
    x.f.time(1600);
    await assert.rejects(
      x.run({
        action: "finalize",
        pendingOffer: x.pendingOffer,
        hubAudience: "https://hub.example",
        approvalExpiresAt: 2000,
      }),
    );
  } finally {
    await x.h.close();
  }
});
test("native first-key sealing pins the actual Root directory hash without inventing a binding", async () => {
  const x = await fixture(true);
  try {
    await x.run({
      action: "review_pending",
      pendingOffer: x.pendingOffer,
      review: await x.review("pending"),
    });
    const prepared = await x.run({
      action: "finalize",
      pendingOffer: x.pendingOffer,
      hubAudience: "https://hub.example",
      approvalExpiresAt: 2000,
    });
    assert.equal(
      prepared.workload.environment.EXECUTOR_NATIVE_CONFIG_SHA256,
      await x.shared.digest(prepared.nativeConfig),
    );
    assert.equal(
      decoded(prepared.finalization).workload.environment.EXECUTOR_NATIVE_CONFIG_SHA256,
      await x.shared.digest(prepared.nativeConfig),
    );
    assert.deepEqual(prepared.nativeConfig.registryAnchor, prepared.registryUpdate.registryBundle);
    await x.run({
      action: "review_pending",
      pendingOffer: x.pendingOffer,
      review: await x.review("pending"),
    });
    assert.deepEqual(
      prepared,
      await x.run({
        action: "finalize",
        pendingOffer: x.pendingOffer,
        hubAudience: "https://hub.example",
        approvalExpiresAt: 2000,
      }),
    );
    assert.equal(
      (await x.run({ action: "registry_status", pendingOffer: x.pendingOffer })).needsUpdate,
      true,
    );
    const receipt = {
      contractVersion: x.shared.CONTRACT,
      profile: "folioview.hub-executor-ciphertext.v1",
      operationId: prepared.operationId,
      registrationDigest: await x.shared.digest({
        command: prepared.body.command,
        approval: prepared.approval,
        scope: x.draft.scope,
      }),
      identity: prepared.identity,
    };
    assert.equal(
      (
        await x.run({
          action: "verify_hub",
          pendingOffer: x.pendingOffer,
          receipt,
        })
      ).bindingFingerprint,
      prepared.identity.bindingFingerprint,
    );
    await assert.rejects(
      x.run({
        action: "verify_hub",
        pendingOffer: x.pendingOffer,
        receipt: { ...receipt, registrationDigest: "a".repeat(64) },
      }),
    );
    await assert.rejects(
      x.run({
        action: "finalize",
        pendingOffer: x.pendingOffer,
        hubAudience: "https://changed.example",
        approvalExpiresAt: 2000,
      }),
    );
  } finally {
    await x.h.close();
  }
});
test("certificate renewal control requires the current original binding and a fresh Policy certificate digest", async () => {
  const x = await fixture();
  try {
    await x.run({
      action: "review_pending",
      pendingOffer: x.pendingOffer,
      review: await x.review("pending"),
    });
    const prepared = await x.run({
      action: "finalize",
      pendingOffer: x.pendingOffer,
      hubAudience: "https://hub.example",
      approvalExpiresAt: 2000,
    });
    const certificateChain = "synthetic-renewed-chain",
      certificateDigest = Buffer.from(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(certificateChain)),
      ).toString("hex");
    const policyState = {
      profile: "folioview.agent-policy.v1",
      connectionId: x.actor.connectionId,
      status: "active",
      binding: prepared.binding,
      approval: prepared.approval,
      stateVersion: 3,
      stateHead: "b".repeat(64),
    };
    const payload = {
      profile: "folioview.executor-certificate-review.v1",
      domain: await x.shared.digest(x.policyConfig),
      bindingDigest: await x.shared.digest(prepared.binding),
      certificateDigest,
      stateVersion: 3,
      stateHead: policyState.stateHead,
      issuedAt: 1000,
      expiresAt: 1120,
    };
    const review = await x.shared.sign(
      payload,
      x.policy.privateKey,
      await x.shared.keyId(x.configuration.policyJwk),
      "fv-control+jws",
    );
    const request = {
      action: "certificate",
      policyState,
      review,
      certificateChain,
    };
    const ready = await x.run(request);
    assert.equal(ready.action, "certificate");
    assert.equal(ready.approval, null);
    assert.equal(
      decoded(ready.command).parametersDigest,
      await x.shared.digest({
        parameters: { certificateDigest },
        approval: null,
      }),
    );
    await assert.rejects(x.run({ ...request, certificateChain: "changed" }));
    await assert.rejects(x.run({ ...request, policyState: { ...policyState, stateVersion: 4 } }));
    x.f.time(1120);
    await assert.rejects(x.run(request));
  } finally {
    await x.h.close();
  }
});
test("public preparation accepts only the new fixed review/control routes and selected executor binding grammar", async () => {
  const { compile } = require("./resource-library-helpers.cjs");
  const routes = compile("../lib/persistent-owner-routes.ts");
  const api = compile("../lib/independent-agent.ts", {}, { structuredClone, URL, URLSearchParams });
  const x = await fixture();
  try {
    const route = routes.persistentOwnerRoute(
      "/api/v2/executor-connections/vault_A/connection_A/bindings",
      "POST",
    );
    assert.equal(route.kind, "executor-binding");
    assert.equal(route.max, 69632);
    assert.equal(
      routes.persistentOwnerRoute("/api/v2/persistent-agents/vault_A/connection_A/bindings", "POST")
        .kind,
      "control",
    );
    const json = {
      contractVersion: x.shared.CONTRACT,
      request: {
        pendingOffer: x.pendingOffer,
        finalOffer: null,
        certificateChain: null,
      },
    };
    api.policyRequest(
      x.configuration,
      "/api/v1/enrollment-reviews",
      "POST",
      json,
      x.configuration.issuer,
    );
    assert.throws(() =>
      api.policyRequest(
        x.configuration,
        "/api/v1/enrollment-reviews",
        "POST",
        json,
        "https://other.example",
      ),
    );
    assert.throws(() =>
      api.policyRequest(
        x.configuration,
        "/api/v1/enrollment-reviews",
        "POST",
        { ...json, privateKey: {} },
        x.configuration.issuer,
      ),
    );
  } finally {
    await x.h.close();
  }
});
