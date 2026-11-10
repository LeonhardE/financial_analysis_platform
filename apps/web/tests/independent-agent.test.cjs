const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { compile } = require("./resource-library-helpers.cjs");
const { createHarness, createOwner, decoded } = require("./full-flow-crypto-fixture.cjs");
const publicConfig = compile(
  "../lib/independent-agent.ts",
  {},
  { structuredClone, URL, URLSearchParams },
);
const routes = compile("../lib/persistent-owner-routes.ts");
const sharedUrl = pathToFileURL(
  path.resolve(__dirname, "../../../packages/encrypted-workspace/dist/core.mjs"),
).href;
const copy = (v) => structuredClone(v);
const pub = async (key) =>
  Object.fromEntries(
    Object.entries(await crypto.subtle.exportKey("jwk", key)).filter(([k]) =>
      ["kty", "crv", "x", "y"].includes(k),
    ),
  );
async function fixture() {
  const h = await createHarness(),
    f = await createOwner(h),
    shared = await import(sharedUrl);
  const key = () =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const agent = await key(),
    encryption = await key(),
    tls = await key(),
    policy = await key();
  const signingJwk = await pub(agent.publicKey),
    encJwk = await pub(encryption.publicKey);
  const kid = await shared.keyId(signingJwk),
    encId = await shared.keyId(encJwk);
  const actor = { connectionId: "executor_synthetic", clientId: "native_synthetic" };
  const setup = {
    intentId: "synthetic_persistent_setup_001",
    ownerSubject: f.owner,
    vaultId: f.vault.vaultId,
    ...actor,
    authorizationId: "synthetic_native_authorization",
    nonce: Buffer.alloc(32, 3).toString("base64url"),
    issuedAt: 1000,
    expiresAt: 1300,
    confirmed: true,
  };
  const { confirmed, ...locator } = setup;
  const offer = {
    contractVersion: shared.CONTRACT,
    profile: "folioview.runtime-pairing.v1",
    artifactType: "runtime_key_offer",
    ...locator,
    expiresAt: 1200,
    agentId: "agent_" + kid,
    signingPublicJwk: signingJwk,
    encryptionPublicJwk: encJwk,
  };
  const command = await shared.sign(offer, agent.privateKey, kid, "fv-control+jws");
  const packet = await f.session.preparePersistentEnrollment({
    actor,
    intentId: setup.intentId,
    setup: {
      contractVersion: shared.CONTRACT,
      profile: "folioview.runtime-pairing.v1",
      setup,
      offer: {
        command,
        agentId: offer.agentId,
        signingKeyId: kid,
        encryptionKeyId: encId,
        fingerprint: await shared.fingerprint(command),
      },
      protectedHostAttested: false,
      authority: "pairing_observation_only",
    },
  });
  f.vault = {
    ...f.vault,
    version: 2,
    registryHistory: [...f.vault.registryHistory, packet.registryUpdate.registryBundle],
  };
  await f.session.acceptVault(f.vault);
  const recipients = f.vault.registryHistory
    .at(-1)
    .entries.map((e) => decoded(e.certificate))
    .filter((e) => ["device_enc", "recovery_enc"].includes(e.role))
    .map((e) => e.keyId)
    .sort();
  const scope = {
    profile: "folioview.hub-executor-ciphertext-scope.v1",
    purpose: "analysis",
    resultPolicy: "owner_inbox",
    resourceBindings: [
      {
        ref: {
          kind: "watchlist",
          sourceService: "user",
          resourceId: "watchlist_synthetic",
          incarnation: "incarnation_A",
        },
        sourceEpoch: 1,
      },
    ],
  };
  const cfg = {
    ...actor,
    issuer: "https://policy.example.com",
    audience: "https://executor.example.com/mcp",
    policyJwk: await pub(policy.publicKey),
    nativeRedirectUris: ["https://chatgpt.com/connector_platform/oauth/callback"],
  };
  const identity = packet.identity,
    b = {
      ...Object.fromEntries(
        [
          "ownerSubject",
          "vaultId",
          "connectionId",
          "agentId",
          "clientId",
          "rootKeyId",
          "agentSigningKeyId",
          "agentEncryptionKeyId",
          "identityEpoch",
          "bindingFingerprint",
        ].map((k) => [k, identity[k]]),
      ),
      provider: "openai_chatgpt",
      providerClientId: actor.clientId,
      policySigningKeyId: await shared.keyId(cfg.policyJwk),
      tlsKeyId: await shared.keyId(await pub(tls.publicKey)),
      scopeDigest: await shared.digest(scope),
      workloadDigest: "b".repeat(64),
      issuer: cfg.issuer,
      audience: cfg.audience,
      recipientKeyIds: recipients,
    };
  const approvalPayload = {
    contractVersion: shared.CONTRACT,
    profile: "folioview.executor-trust.v1",
    artifactType: "executor_approval",
    binding: b,
    operationId: packet.operationId,
    issuedAt: 1000,
    expiresAt: 2000,
  };
  const approval = await shared.sign(
    approvalPayload,
    f.session.root,
    f.vault.rootKeyId,
    "fv-control+jws",
  );
  const cp = {
    contractVersion: shared.CONTRACT,
    profile: "folioview.executor-trust.v1",
    artifactType: "executor_checkpoint",
    bindingDigest: await shared.digest(b),
    approvalFingerprint: await shared.fingerprint(approval),
    stateVersion: 1,
    stateHead: "c".repeat(64),
    authorizationEpoch: 1,
    revoked: false,
    issuedAt: 1000,
    expiresAt: 1120,
  };
  const args = {
    actor,
    configuration: cfg,
    hubState: {
      contractVersion: shared.CONTRACT,
      profile: "folioview.hub-executor-ciphertext.v1",
      identity,
      command: packet.body.command,
      revocation: null,
      binding: b,
      scope,
      approval,
      receipt: {},
    },
    policyState: {
      profile: "folioview.agent-policy.v1",
      connectionId: actor.connectionId,
      binding: b,
      status: "active",
      stateVersion: 1,
      stateHead: cp.stateHead,
      authorizationEpoch: 1,
      approval,
      scope,
    },
    checkpoint: await shared.sign(cp, policy.privateKey, b.policySigningKeyId, "fv-control+jws"),
  };
  return {
    h,
    f,
    shared,
    args,
    cp,
    policy,
    async signedCheckpoint(value) {
      return shared.sign(value, policy.privateKey, b.policySigningKeyId, "fv-control+jws");
    },
  };
}
test("the same unlocked Owner verifies original keys and live Policy, signs only bounded native/revoke controls, and never claims schedule installation", async () => {
  const x = await fixture();
  try {
    const v = await x.f.session.verifyIndependentAgent(x.args);
    assert.equal(v.identity.agentId, x.args.hubState.identity.agentId);
    assert.equal(v.nativeScheduleStatus, "not_observed");
    assert.equal(v.continuousExecutionAcceptance, "pending");
    const pending = {
      pendingId: "pauth_" + "a".repeat(43),
      requestDigest: "e".repeat(64),
      clientId: x.args.actor.clientId,
      resource: x.args.configuration.audience,
      scope: "executor:execute executor:write_report executor:recover",
      expiresAt: 1250,
    };
    const { command } = await x.f.session.signIndependentPolicyControl({
      ...x.args,
      action: "oauth_approve",
      pending,
    });
    const signed = await x.shared.verify(command, x.f.vault.rootJwk, "fv-control+jws");
    assert.equal(signed.expectedVersion, 1);
    assert.equal(signed.expectedHead, x.cp.stateHead);
    assert.equal(
      signed.parametersDigest,
      await x.shared.digest({ pendingId: pending.pendingId, requestDigest: pending.requestDigest }),
    );
    assert.equal(signed.expiresAt - signed.issuedAt, 120);
    const result = require("node:child_process").spawnSync(
      process.env.FOLIOVIEW_TEST_PYTHON ||
        path.resolve(__dirname, "../../../services/market-data-service/.venv/bin/python"),
      [path.resolve(__dirname, "fixtures/policy_owner_control.py")],
      {
        cwd: path.resolve(__dirname, "../../.."),
        encoding: "utf8",
        timeout: 10000,
        input: JSON.stringify({
          command,
          rootJwk: x.f.vault.rootJwk,
          owner: x.f.owner,
          action: "oauth_approve",
          connection: x.args.actor.connectionId,
          version: 1,
          head: x.cp.stateHead,
          parameters: { pendingId: pending.pendingId, requestDigest: pending.requestDigest },
          now: 1000,
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ACTUAL POLICY VERIFIED ROOT CONTROL/);
    for (const patch of [
      { clientId: "wrong" },
      { resource: "https://other.example.com/mcp" },
      { scope: "executor:admin" },
      { expiresAt: 999 },
    ])
      await assert.rejects(
        x.f.session.signIndependentPolicyControl({
          ...x.args,
          action: "oauth_approve",
          pending: { ...pending, ...patch },
        }),
      );
    await assert.rejects(
      x.f.session.signIndependentPolicyControl({ ...x.args, action: "register", pending: null }),
    );
    const revoked = await x.f.session.signIndependentPolicyControl({
      ...x.args,
      action: "revoke",
      pending: null,
    });
    assert.equal(
      decoded(revoked.command).parametersDigest,
      await x.shared.digest({ parameters: {}, approval: null }),
    );
    assert.ok(!JSON.stringify(v).includes('"d":'));
  } finally {
    await x.h.close();
  }
});
test("wrong Owner/endpoint/keys, altered scope, stale current head and signed rollback all fail before authority", async () => {
  const x = await fixture();
  try {
    await x.f.session.verifyIndependentAgent(x.args);
    for (const change of [
      (a) => (a.configuration.issuer = "https://wrong.example.com"),
      (a) => (a.hubState.binding.tlsKeyId = a.hubState.binding.rootKeyId),
      (a) => (a.policyState.stateHead = "f".repeat(64)),
      (a) => (a.hubState.scope.resourceBindings[0].sourceEpoch = 2),
      (a) => (a.hubState.identity.ownerSubject = "0".repeat(64)),
      (a) => (a.configuration.policyJwk.x = "A".repeat(43)),
    ]) {
      const a = copy(x.args);
      change(a);
      await assert.rejects(x.f.session.verifyIndependentAgent(a));
    }
    const higher = copy(x.args);
    higher.policyState.stateVersion = 2;
    higher.policyState.stateHead = "d".repeat(64);
    higher.checkpoint = await x.signedCheckpoint({
      ...x.cp,
      stateVersion: 2,
      stateHead: higher.policyState.stateHead,
    });
    await x.f.session.verifyIndependentAgent(higher);
    await assert.rejects(x.f.session.verifyIndependentAgent(x.args), /stale_policy/);
    x.f.time(1121);
    await assert.rejects(x.f.session.verifyIndependentAgent(higher));
    x.f.time(2100);
    const terminal = await x.f.session.signIndependentPolicyControl({
      ...higher,
      hubState: null,
      checkpoint: null,
      action: "revoke",
      pending: null,
    });
    assert.equal(decoded(terminal.command).action, "revoke");
    assert.equal(decoded(terminal.command).expectedVersion, 2);
    await assert.rejects(
      x.f.session.signIndependentPolicyControl({
        ...higher,
        hubState: null,
        checkpoint: null,
        action: "oauth_approve",
        pending: null,
      }),
    );
  } finally {
    await x.h.close();
  }
});
test("public selection and direct Policy transport reject private keys, arbitrary routes and non-exact native callbacks", async () => {
  const x = await fixture();
  try {
    const cfg = publicConfig.independentConfiguration(x.args.configuration),
      contract = "folioview.agent-workspace.v2.0";
    const server = compile(
      "../lib/server/independent-agent.ts",
      {
        "server-only": {},
        "../independent-agent": publicConfig,
      },
      { Buffer, process },
    );
    assert.equal(server.independentAgentConfiguration({}).enabled, false);
    assert.equal(
      server.independentAgentConfiguration({
        FOLIOVIEW_INDEPENDENT_AGENT_ENABLED: "true",
        FOLIOVIEW_INDEPENDENT_AGENT_CONFIG: JSON.stringify(cfg),
      }).enabled,
      true,
    );
    assert.equal(
      server.independentAgentConfiguration({
        FOLIOVIEW_INDEPENDENT_AGENT_ENABLED: "true",
        FOLIOVIEW_INDEPENDENT_AGENT_CONFIG: JSON.stringify({ ...cfg, privateKey: "CANARY" }),
      }).enabled,
      false,
    );
    const created = () =>
      new Response('{"revoked":true}', {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    assert.equal(
      (await publicConfig.independentJson(created(), undefined, 2048, 201)).revoked,
      true,
    );
    await assert.rejects(publicConfig.independentJson(created()));
    assert.throws(() =>
      publicConfig.independentConfiguration({
        ...cfg,
        policyJwk: { ...cfg.policyJwk, d: "PRIVATE" },
      }),
    );
    assert.throws(() =>
      publicConfig.independentConfiguration({
        ...cfg,
        nativeRedirectUris: ["https://chatgpt.com/*"],
      }),
    );
    publicConfig.policyRequest(
      cfg,
      `/api/v1/connections/${cfg.connectionId}/checkpoint`,
      "POST",
      {
        contractVersion: contract,
      },
      cfg.issuer,
    );
    for (const route of [
      "/oauth/token",
      "/v1/connections/x/releases",
      "https://evil.example.com",
      `/api/v1/connections/${cfg.connectionId}?x=y`,
    ])
      assert.throws(() => publicConfig.policyRequest(cfg, route, "GET", undefined, cfg.issuer));
    assert.equal(
      publicConfig.independentHandoff("?request=pauth_" + "a".repeat(43)),
      "pauth_" + "a".repeat(43),
    );
    assert.throws(() =>
      publicConfig.independentHandoff("?request=pauth_" + "a".repeat(43) + "&request=x"),
    );
    const redirect =
      cfg.nativeRedirectUris[0] +
      "?code=opaque&state=original&iss=" +
      encodeURIComponent(cfg.issuer);
    assert.equal(publicConfig.policyRedirect(redirect, cfg), redirect);
    assert.throws(() =>
      publicConfig.policyRedirect(redirect.replace("chatgpt.com", "evil.example.com"), cfg),
    );
    assert.throws(() => publicConfig.policyRedirect(redirect + "&code=other", cfg));
    assert.equal(
      routes.executorLegacyPath(
        "/api/v2/executor-connections/vault_A/connection_A/publication-operations/" +
          "a".repeat(24),
      ),
      "/api/v2/persistent-content/vault_A/connections/connection_A/operations/" + "a".repeat(24),
    );
    assert.ok(
      routes.persistentOwnerRoute(
        "/api/v2/executor-connections/vault_A/connection_A/resource-approvals",
        "POST",
      ),
    );
    assert.equal(
      routes.persistentOwnerRoute(
        "/api/v2/executor-connections/vault_A/connection_A/bindings",
        "POST",
      ),
      null,
    );
  } finally {
    await x.h.close();
  }
});
test("independent publication retries retain the exact original ciphertext and Policy revocation blocks the next new write", async () => {
  const resources = require("./resource-library-helpers.cjs").contracts;
  const taskTypes = compile("../lib/task-types.ts");
  const persistent = compile(
    "../lib/persistent-experience-controller.ts",
    { "./resource-library": resources, "./task-types": taskTypes },
    { Map, Set, Date },
  );
  const { IndependentExperienceController: Controller } = compile(
    "../lib/independent-experience-controller.ts",
    {
      "./persistent-experience-controller": persistent,
      "./independent-agent": publicConfig,
    },
  );
  const x = await fixture();
  try {
    let saved = null,
      revoked = false,
      posts = 0,
      finishes = 0,
      originalBody;
    const workspace = {
      phase: "unlocked",
      vault: { vaultId: x.f.vault.vaultId },
      verifyIndependentAgent: async () => ({ scope: x.args.hubState.scope }),
      verifyIndependentDestination: async () => ({ issuer: x.args.configuration.issuer }),
      finishPersistentPending: async () => {
        finishes++;
      },
    };
    const api = async (service, path, options = {}) => {
      if (service === "agent-policy")
        return path.endsWith("/checkpoint")
          ? { checkpoint: x.args.checkpoint }
          : { ...x.args.policyState, status: revoked ? "revoked" : "active" };
      if (path.includes("publication-operations/")) {
        if (saved) return saved;
        throw new persistent.PersistentExperienceError("not_found");
      }
      if (options.method === "POST") {
        posts++;
        originalBody = options.json;
        saved = { fingerprint: "a".repeat(64) };
        throw Error("lost_ack");
      }
      return x.args.hubState;
    };
    const c = new Controller(
      x.args.configuration,
      api,
      () => workspace,
      () => {},
      new AbortController().signal,
    );
    const body = {
      contractVersion: "folioview.agent-workspace.v2.0",
      envelope: { ciphertext: "ORIGINAL_CIPHERTEXT" },
    };
    const packet = {
      kind: "publication",
      connectionId: x.args.actor.connectionId,
      operationId: "original_publication_operation_001",
      body,
    };
    await assert.rejects(c.content.send(c.connection(), packet), /lost_ack/);
    assert.equal(originalBody, body);
    revoked = true;
    await c.content.send(c.connection(), packet);
    assert.equal(posts, 1);
    assert.equal(finishes, 1);
    saved = null;
    await assert.rejects(
      c.content.send(c.connection(), {
        ...packet,
        operationId: "different_publication_operation_01",
      }),
      /connection_revoked/,
    );
    assert.equal(posts, 1);
  } finally {
    await x.h.close();
  }
});
test("Root-approved destination is checked before Policy credentials and a reloaded issuer cannot replace the approved destination", async () => {
  const x = await fixture();
  try {
    const resources = require("./resource-library-helpers.cjs").contracts;
    const taskTypes = compile("../lib/task-types.ts");
    const persistent = compile(
      "../lib/persistent-experience-controller.ts",
      { "./resource-library": resources, "./task-types": taskTypes },
      { Map, Set, Date },
    );
    const { IndependentExperienceController: Controller } = compile(
      "../lib/independent-experience-controller.ts",
      {
        "./persistent-experience-controller": persistent,
        "./independent-agent": publicConfig,
      },
    );
    let policyCalls = 0;
    const api = async (service, path) => {
      if (service === "agent-hub") return x.args.hubState;
      policyCalls++;
      return path.endsWith("/checkpoint") ? { checkpoint: x.args.checkpoint } : x.args.policyState;
    };
    const workspace = {
      phase: "unlocked",
      vault: x.f.vault,
      verifyIndependentDestination: (args) => x.f.session.verifyIndependentDestination(args),
      verifyIndependentAgent: (args) => x.f.session.verifyIndependentAgent(args),
    };
    const make = (cfg) =>
      new Controller(
        cfg,
        api,
        () => workspace,
        () => {},
        new AbortController().signal,
      );
    await assert.rejects(
      make({ ...x.args.configuration, issuer: "https://unapproved.example.com" }).current(),
    );
    assert.equal(policyCalls, 0);
    await make(x.args.configuration).current();
    assert.equal(policyCalls, 2);
    assert.throws(
      () =>
        publicConfig.policyRequest(
          { ...x.args.configuration, issuer: "https://changed.example.com" },
          `/api/v1/connections/${x.args.actor.connectionId}`,
          "GET",
          undefined,
          x.args.configuration.issuer,
        ),
      /policy_destination_changed/,
    );
    assert.throws(
      () =>
        publicConfig.policyRequest(
          x.args.configuration,
          `/api/v1/connections/${x.args.actor.connectionId}`,
          "GET",
        ),
      /policy_destination_changed/,
    );
    x.f.time(2100);
    const destination = {
      actor: x.args.actor,
      configuration: x.args.configuration,
      hubState: x.args.hubState,
      historical: false,
    };
    await assert.rejects(x.f.session.verifyIndependentDestination(destination));
    assert.equal(
      (await x.f.session.verifyIndependentDestination({ ...destination, historical: true })).issuer,
      x.args.configuration.issuer,
    );
  } finally {
    await x.h.close();
  }
});
test("the bilingual independent UI masks stale private tasks when locked and separates expected schedules from acceptance", () => {
  const React = require("react"),
    { renderToStaticMarkup } = require("react-dom/server"),
    { createTranslator } = require("next-intl");
  for (const locale of ["en", "zh"]) {
    const Panel = compile(
      "../components/IndependentAgentPanel.tsx",
      {
        react: React,
        "react/jsx-runtime": require("react/jsx-runtime"),
        "next-intl": {
          useLocale: () => locale,
          useTranslations: (namespace) =>
            createTranslator({
              locale,
              messages: require("../messages/" + locale + ".json"),
              namespace,
            }),
        },
        "@/lib/independent-agent": publicConfig,
        "@/lib/independent-experience-controller": {
          independentBindingKey: (r) => JSON.stringify(r),
        },
        "./AgentsPanel.module.css": new Proxy({}, { get: (_, key) => String(key) }),
      },
      { Intl, Set },
    ).IndependentAgentPanel;
    const view = {
      verified: { scope: { resourceBindings: [] }, approvalExpiresAt: 2000 },
      review: { policy: { permissions: [] } },
      tasks: [
        {
          taskId: "task_A",
          title: "PRIVATE_INDEPENDENT_TASK",
          authority: { authority: { context: { connectionId: "connection_A" } } },
          content: { deliveryExpectation: null },
        },
      ],
    };
    const render = (scope) =>
      renderToStaticMarkup(
        React.createElement(Panel, {
          workspace: {
            authenticated: true,
            phase: scope ? "unlocked" : "locked",
            canWriteState: true,
          },
          model: {
            configuration: {
              audience: "https://executor.example.com/mcp",
              connectionId: "connection_A",
            },
            scope,
            view,
            error: "",
            busy: false,
          },
          active: true,
        }),
      );
    assert.ok(!render(null).includes("PRIVATE_INDEPENDENT_TASK"));
    const html = render("owner:1");
    assert.ok(html.includes("PRIVATE_INDEPENDENT_TASK"));
    assert.match(
      html,
      locale === "zh" ? /尚未核实安装或执行/ : /installation and execution not verified/,
    );
    assert.match(
      html,
      locale === "zh" ? /持续执行待验收/ : /Continuous execution awaits acceptance/,
    );
    assert.ok(!html.includes("helper card"));
  }
});
