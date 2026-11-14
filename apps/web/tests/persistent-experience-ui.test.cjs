const assert = require("node:assert/strict"),
  test = require("node:test"),
  React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"),
  { createTranslator } = require("next-intl");
const { compile } = require("./resource-library-helpers.cjs");
const jsx = require("react/jsx-runtime");
function render(locale, unlocked, plan, credential = null, duration = null, state = {}) {
  const imports = {
    react: React,
    "@/lib/provider-groups": compile("../lib/provider-groups.ts"),
    "./ProviderMark": {
      ProviderMark: ({ provider }) =>
        React.createElement("span", { "data-provider": provider }, provider),
    },
    "./ReportDialog": { ReportDialog: () => null },
    "./WorkspaceFeedback": { LoadingIndicator: () => null, InlineError: () => null },
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
    loading: false,
    loaded: true,
    loadError: false,
    error: "",
    enabled: true,
    providerStates: {},
    views: [
      {
        connection: {
          connectionId: "connection_A",
          clientId: "muse_A",
          provider: "muse",
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
    ...state.model,
    ...(state.slots
      ? {
          loaded: state.slots.loaded ?? true,
          loading: state.slots.loading ?? false,
          loadError: state.slots.error ?? false,
          providerStates: state.slots.states ?? {},
        }
      : {}),
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
test("connection management links private tasks back to the task center and conceals them while locked", () => {
  for (const locale of ["zh", "en"]) {
    const open = render(locale, true, { reported: null, observed: { receivedAt: 1001 } });
    assert.match(open, /PRIVATE_TASK_CANARY/);
    assert.match(open, /href="\/tasks#task\/task_A"/);
    assert.doesNotMatch(open, /09:00|America\/Toronto|Waiting for Agent confirmation|已收到报告/);
    const locked = render(locale, false, null);
    assert.doesNotMatch(locked, /PRIVATE_TASK_CANARY/);
    assert.match(locked, locale === "zh" ? /解锁/ : /Unlock/);
    assert.match(open, /Claude/);
    assert.match(open, /Gemini/);
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

test("slow or failed connection reads never render an invented disconnection or enable reconnect", () => {
  for (const locale of ["en", "zh"]) {
    for (const state of [
      { model: { loaded: false, loading: true, views: [] } },
      { slots: { loaded: false, loading: true } },
      {
        model: {
          loaded: false,
          loading: false,
          loadError: true,
          error: "request_failed",
          views: [],
        },
      },
      { slots: { loaded: false, error: true } },
    ]) {
      const out = render(locale, true, null, null, null, state);
      assert.doesNotMatch(
        out,
        /Disconnected|已断开|Authorization needed|需要重新授权|PRIVATE_TASK_CANARY/,
      );
      assert.match(
        out,
        state.model?.loadError || state.slots?.error
          ? /Status unavailable|状态暂不可用/
          : /Loading connections|正在加载连接/,
      );
      const cards = out.match(/<article[^>]*>[\s\S]*?<\/article>/g).slice(0, 2);
      const buttons = cards.map((card) => [card.match(/<button[^>]*>/)[0]]);
      assert.equal(buttons.length, 2);
      assert.ok(buttons.every(([tag]) => tag.includes('disabled=""')));
    }
    const empty = render(locale, true, null, null, null, { model: { views: [] } });
    assert.equal((empty.match(/Disconnected|已断开/g) ?? []).length, 2);
    assert.ok(
      empty
        .match(/<article[^>]*>[\s\S]*?<\/article>/g)
        .slice(0, 2)
        .every((card) => !card.match(/<button[^>]*>/)[0].includes("disabled")),
    );
  }
});

test("refreshing keeps the last loaded connection visible and adds a busy indicator", () => {
  for (const locale of ["en", "zh"]) {
    const out = render(
      locale,
      true,
      null,
      {
        status: "active",
        expiresAt: Date.now() / 1000 + 7776000,
      },
      null,
      { model: { loading: true, busy: true } },
    );
    const muse = out.match(/<article[^>]*>[\s\S]*?<\/article>/)[0];
    assert.match(muse, /Connected|已连接/);
    assert.doesNotMatch(muse, /Disconnected|已断开/);
    assert.match(muse, /aria-busy="true"/);
    assert.match(muse, /data-checking="true"/);
    assert.match(muse, /<button disabled="">Authorize again|<button disabled="">重新授权/);
  }
});

test("background summary refresh preserves actions on the last verified connection", () => {
  const out = render(
    "en",
    true,
    null,
    { status: "active", expiresAt: Date.now() / 1000 + 7776000 },
    null,
    { model: { loading: true, busy: false } },
  );
  const muse = out.match(/<article[^>]*>[\s\S]*?<\/article>/)[0];
  assert.match(muse, /aria-busy="true"/);
  assert.match(muse, /<button>Authorize again/);
});
