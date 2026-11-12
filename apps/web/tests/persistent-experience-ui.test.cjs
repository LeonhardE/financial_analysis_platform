const assert = require("node:assert/strict"),
  test = require("node:test"),
  React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"),
  { createTranslator } = require("next-intl");
const { compile } = require("./resource-library-helpers.cjs");
const jsx = require("react/jsx-runtime");
function render(locale, unlocked, plan, credential = null, duration = null) {
  const imports = {
    react: React,
    "react/jsx-runtime": jsx,
    "next-intl": {
      useLocale: () => locale,
      useTranslations: (namespace) =>
        createTranslator({
          locale,
          messages: require("../messages/" + locale + ".json"),
          namespace,
        }),
    },
    "./AuthProvider": {
      useAuth: () => ({
        requestNativeAccount: async () => {
          throw Error("render cannot authorize");
        },
      }),
    },
    "@/lib/native-owner-bridge": {},
    "@/lib/agent-authorization": {},
    "@/lib/persistent-experience-controller": {
      DEFAULT_CONNECTION_SECONDS: 7776000,
      TEMPORARY_CONNECTION_SECONDS: 900,
    },
    "./AgentsPanel.module.css": new Proxy({}, { get: (_t, k) => String(k) }),
  };
  const components = compile("../components/PersistentAgentsPanel.tsx", imports, {
    Intl,
  });
  if (duration)
    return renderToStaticMarkup(
      React.createElement(components.AgentConnectionDuration, { ...duration, onChange() {} }),
    );
  const Panel = components.PersistentAgentsPanel;
  const workspace = {
    authenticated: true,
    owner: "owner_A",
    vaultGeneration: 1,
    phase: unlocked ? "unlocked" : "locked",
    canWriteState: unlocked,
    busy: false,
    unlock() {
      throw Error("render cannot unlock");
    },
  };
  const model = {
    owner: "owner_A",
    unlocked,
    busy: false,
    error: "",
    enabled: true,
    views: [
      {
        connection: {
          connectionId: "connection_A",
          clientId: "muse_A",
          status: "active",
          accountState: "connected",
          linkedAt: 1000,
        },
        identity: {},
        credential,
        policy: { permissions: [{ status: "active" }] },
        pending: false,
        tasks: [
          {
            taskId: "task_A",
            title: "PRIVATE_TASK_CANARY",
            content: {
              deliveryExpectation: {
                cadence: "daily",
                localTime: "09:00",
                timeZone: "America/Toronto",
              },
            },
            plan,
          },
        ],
      },
    ],
  };
  return renderToStaticMarkup(
    React.createElement(Panel, {
      workspace,
      model,
      origin: "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
      active: true,
    }),
  );
}
test("both locales distinguish an unconfirmed native plan from an actual Hub report, and conceal private tasks while locked", () => {
  for (const locale of ["zh", "en"]) {
    const plan = {
      reported: null,
      desired: { taskPublicationFingerprint: "a".repeat(64) },
      observed: { runCreatedAt: 1000, receivedAt: 1001, resultId: "result_A" },
    };
    const open = render(locale, true, plan);
    assert.match(open, /PRIVATE_TASK_CANARY/);
    assert.match(open, /09:00/);
    assert.match(open, /America\/Toronto/);
    assert.match(open, locale === "zh" ? /等待 Agent 确认/ : /Waiting for Agent confirmation/);
    assert.match(open, locale === "zh" ? /已收到报告/ : /Report received/);
    const awaitingResult = render(locale, true, {
      ...plan,
      observed: { ...plan.observed, receivedAt: null, resultId: null },
    });
    assert.doesNotMatch(awaitingResult, locale === "zh" ? /已收到报告/ : /Report received/);
    const locked = render(locale, false, plan);
    assert.doesNotMatch(locked, /PRIVATE_TASK_CANARY|09:00|America\/Toronto/);
    assert.match(locked, locale === "zh" ? /解锁/ : /Unlock/);
    const out = render(locale, true, {
      ...plan,
      reported: { reportedStatus: "enabled", taskPublicationFingerprint: "b".repeat(64) },
    });
    assert.match(out, locale === "zh" ? /等待 Agent 确认/ : /Waiting for Agent confirmation/);
  }
});

test("connection UI offers ordinary reauthorization and expiry notice without exposing credential internals", () => {
  for (const locale of ["zh", "en"]) {
    const out = render(locale, true, null, {
      status: "expiring",
      expiresAt: Date.now() / 1000 + 86400,
      privateKey: "PRIVATE_KEY_CANARY",
      bindingFingerprint: "BINDING_CANARY",
      generation: 9,
    });
    assert.match(out, locale === "zh" ? /即将到期/ : /Expires soon/);
    assert.match(out, locale === "zh" ? /重新授权/ : /Authorize again/);
    assert.match(out, /Muse/);
    assert.match(out, /ChatGPT/);
    assert.doesNotMatch(
      out,
      /PRIVATE_KEY_CANARY|BINDING_CANARY|fingerprint|certificate|恢复码|恢复文件|recovery code|recovery file|JSON/,
    );
  }
});

test("connection duration keeps ninety days selected by default and freezes pending originals", () => {
  for (const locale of ["zh", "en"]) {
    const normal = render(locale, true, null, null, {
      seconds: 7776000,
      pending: false,
      busy: false,
    });
    assert.match(normal, /<option value="7776000" selected=""/);
    assert.equal((normal.match(/<option\b/g) ?? []).length, 2);
    assert.match(normal, locale === "zh" ? /15 分钟（临时）/ : /15 minutes \(temporary\)/);
    const pending = render(locale, true, null, null, { seconds: 900, pending: true, busy: false });
    assert.match(pending, /<select[^>]*disabled=""/);
    assert.match(pending, /<option value="900" selected=""/);
    assert.match(pending, locale === "zh" ? /时长已固定/ : /duration is fixed/);
    assert.doesNotMatch(
      normal + pending,
      /fingerprint|certificate|恢复码|恢复文件|recovery code|JSON/,
    );
  }
});
