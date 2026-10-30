const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createTranslator } = require("next-intl");
const jsxRuntime = require("react/jsx-runtime");
const { compile, connection, grant, taskPacket } = require("./agent-connections-helpers.cjs");
const catalogs = { en: require("../messages/en.json"), zh: require("../messages/zh.json") };
const noop = () => {};
const content = {
  name: "PRIVATE_TASK <script>",
  goal: "PRIVATE_GOAL <img src=https://example.test/secret>",
  outputSpec: {
    sections: [{ sectionId: "overview", title: "Overview", instructions: "PRIVATE_INSTRUCTIONS" }],
  },
};
const workspace = (patch = {}) => ({
  owner: "session_A",
  vaultGeneration: 1,
  phase: "unlocked",
  authenticated: true,
  authStatus: "authenticated",
  busy: null,
  lock: noop,
  unlock: noop,
  create: noop,
  signIn: noop,
  ...patch,
});
const model = (patch = {}) => ({
  owner: "session_A",
  configured: true,
  authenticated: true,
  unlocked: true,
  items: [connection()],
  attempts: [],
  selected: connection(),
  privateTask: { metadata: taskPacket().metadata, content },
  loading: false,
  busy: false,
  error: "",
  notice: "",
  uncertain: false,
  confirmation: null,
  reload: noop,
  select: noop,
  inspectGrant: noop,
  reviewRevoke: noop,
  revoke: noop,
  cancelRevoke: noop,
  ...patch,
});
function render(name, props, locale = "en", buttons = []) {
  const jsx =
    (method) =>
    (type, properties, ...rest) => {
      if (type === "button") buttons.push(properties);
      return jsxRuntime[method](type, properties, ...rest);
    };
  const imports = {
    react: React,
    "react/jsx-runtime": { ...jsxRuntime, jsx: jsx("jsx"), jsxs: jsx("jsxs") },
    "next-intl": {
      useLocale: () => locale,
      useTranslations: (namespace) =>
        createTranslator({ locale, messages: catalogs[locale], namespace }),
    },
    "./AgentsPanel.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_, key) => key }),
    },
    "./AgentConsentCard.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_, key) => key }),
    },
    "./useAgentConnections": {},
    "./useAgentLinkConfiguration": {},
    "./useAgentConsent": {},
    "./AgentConsentCard": {},
    "@/lib/owner-consent-bridge": {},
  };
  const module = compile(`../components/${name}.tsx`, imports, { Intl });
  return renderToStaticMarkup(
    React.createElement(module[name === "AgentsPanel" ? "AgentsView" : "AgentConsentCard"], props),
  );
}
const configuration = {
  data: {
    schemaVersion: 1,
    enabled: true,
    hubOrigin: "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
  },
  loading: false,
  error: false,
};
const consentModel = (patch = {}) => ({
  owner: "session_A",
  configured: true,
  unlocked: true,
  canWrite: true,
  hasHandoff: true,
  stage: "keys",
  busy: false,
  error: "",
  notice: "",
  authorization: {
    clientId: "muse_client",
    expiresAt: 1793372400,
    scopes: ["tasks:read"],
    prepared: null,
  },
  tasks: [taskPacket().metadata],
  selected: taskPacket(),
  content,
  scopes: ["tasks:read"],
  registered: false,
  setupCard: null,
  offer: null,
  offerReview: null,
  keysConfirmed: false,
  replacementConfirmed: false,
  grantConfirmed: false,
  decisionSent: false,
  mode: null,
  signedGrant: null,
  published: null,
  helperConfirmed: false,
  outbox: [],
  claim: noop,
  selectTask: noop,
  selectScopes: noop,
  pairHelper: noop,
  createManualCard: noop,
  importOffer: noop,
  confirmKeys: noop,
  registerKeys: noop,
  prepareGrant: noop,
  confirmGrant: noop,
  approve: noop,
  deny: noop,
  publish: noop,
  recover: noop,
  discardPending: noop,
  lockHelper: noop,
  confirmOriginalHelper: noop,
  ...patch,
});

test("agent UI distinguishes API grants, content signatures and observations in both languages", () => {
  for (const locale of ["en", "zh"]) {
    const buttons = [],
      html = render(
        "AgentsPanel",
        { workspace: workspace(), model: model(), configuration },
        locale,
        buttons,
      );
    assert.match(html, /Meta Muse/);
    for (const name of ["ChatGPT", "Gemini", "Claude"]) assert.match(html, new RegExp(name));
    assert.equal(
      buttons.filter(
        (button) =>
          button.disabled && /ChatGPT|Gemini|Claude/.test(JSON.stringify(button.children)),
      ).length,
      3,
    );
    assert.match(html, /PRIVATE_TASK &lt;script&gt;/);
    assert.match(html, /PRIVATE_GOAL &lt;img/);
    assert.doesNotMatch(html, /<img|<script/);
    assert.ok(html.includes(locale === "en" ? "not proof" : "不证明"));
  }
});
test("locked and switched accounts never render private task previews", () => {
  for (const value of [
    workspace({ phase: "locked" }),
    workspace({ owner: "session_B" }),
    workspace({ authenticated: false, authStatus: "anonymous" }),
  ]) {
    const html = render("AgentsPanel", { workspace: value, model: model(), configuration });
    assert.doesNotMatch(html, /PRIVATE_TASK|PRIVATE_GOAL|PRIVATE_INSTRUCTIONS/);
  }
});
test("connection and selected-task revocation require a separate confirmation and retention warning", () => {
  let calls = 0;
  const buttons = [];
  const html = render(
    "AgentsPanel",
    {
      workspace: workspace(),
      model: model({
        confirmation: { connectionId: "connection_A", grantId: "grant_A" },
        revoke: () => calls++,
      }),
      configuration,
    },
    "en",
    buttons,
  );
  assert.match(html, /Other task grants remain independent/);
  assert.match(html, /Revocation cannot erase/);
  assert.equal(calls, 0);
  buttons.find((button) => button.children === "Revoke access").onClick();
  assert.equal(calls, 1);
});
test("consent rules are local text, other-owner and locked views mask them, and registration alone is not content approval", () => {
  for (const locale of ["en", "zh"]) {
    const html = render(
      "AgentConsentCard",
      { workspace: workspace(), model: consentModel() },
      locale,
    );
    assert.match(html, /PRIVATE_TASK &lt;script&gt;/);
    assert.doesNotMatch(html, /<img|<script/);
    assert.ok(html.includes(locale === "en" ? "one task" : "一项任务"));
  }
  for (const value of [
    workspace({ phase: "locked" }),
    workspace({ owner: "session_B" }),
    workspace({ authenticated: false }),
  ])
    assert.doesNotMatch(
      render("AgentConsentCard", { workspace: value, model: consentModel() }),
      /PRIVATE_TASK|PRIVATE_GOAL/,
    );
});
test("approval recovery never offers another decision and unknown helper keys do not become ready", () => {
  const buttons = [],
    authorization = {
      clientId: "muse_client",
      expiresAt: 1793372400,
      scopes: ["tasks:read"],
      prepared: { tasks: [{ taskId: "task_A", taskVersion: 1, selectedResourceVersions: [] }] },
    };
  const html = render(
    "AgentConsentCard",
    {
      workspace: workspace(),
      model: consentModel({
        authorization,
        stage: "grant",
        decisionSent: true,
        grantConfirmed: true,
      }),
    },
    "en",
    buttons,
  );
  assert.equal(
    buttons.find((button) => button.children === "Approve content access").disabled,
    true,
  );
  assert.match(html, /do not submit another decision/);
  const recovery = render("AgentConsentCard", {
    workspace: workspace(),
    model: consentModel({ authorization, stage: "approved", mode: null }),
  });
  assert.match(recovery, /cannot recreate private helper keys/);
  assert.match(recovery, /original helper/);
  const recoveredWithoutHandoff = render("AgentConsentCard", {
    workspace: workspace(),
    model: consentModel({
      hasHandoff: false,
      authorization,
      stage: "approved",
      mode: null,
      signedGrant: { operationId: "approval_A", offerFingerprint: "original_offer_fingerprint" },
      offer: {
        agentSigningKeyId: "original_signing_key",
        agentEncryptionKeyId: "original_encryption_key",
      },
      outbox: [],
    }),
  });
  assert.match(recoveredWithoutHandoff, /cannot recreate private helper keys/);
  assert.match(recoveredWithoutHandoff, /Encrypt and publish selected inputs/);
  assert.match(recoveredWithoutHandoff, /original_signing_key/);
  assert.match(recoveredWithoutHandoff, /original_encryption_key/);
  assert.match(recoveredWithoutHandoff, /original_offer_fingerprint/);
  assert.doesNotMatch(recoveredWithoutHandoff, /Review this request/);
});
