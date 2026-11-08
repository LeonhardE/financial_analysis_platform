const assert = require("node:assert/strict"),
  test = require("node:test"),
  React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"),
  { createTranslator } = require("next-intl");
const { compile } = require("./resource-library-helpers.cjs");
const jsx = require("react/jsx-runtime");
function render(locale, unlocked, plan) {
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
    "./AgentsPanel.module.css": new Proxy({}, { get: (_t, k) => String(k) }),
  };
  const Panel = compile("../components/PersistentAgentsPanel.tsx", imports, {
    Intl,
  }).PersistentAgentsPanel;
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
    assert.match(open, locale === "zh" ? /尚未确认/ : /Unconfirmed/);
    assert.match(open, locale === "zh" ? /已收到报告/ : /Report received/);
    const locked = render(locale, false, plan);
    assert.doesNotMatch(locked, /PRIVATE_TASK_CANARY|09:00|America\/Toronto/);
    assert.match(locked, locale === "zh" ? /使用通行密钥解锁/ : /Unlock with Passkey/);
    const out = render(locale, true, {
      ...plan,
      reported: { reportedStatus: "enabled", taskPublicationFingerprint: "b".repeat(64) },
    });
    assert.match(out, locale === "zh" ? /计划待同步/ : /plan synchronization needed/);
  }
});
