const assert = require("node:assert/strict");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createTranslator } = require("next-intl");
const { transformSync } = require("next/dist/build/swc");

const components = path.resolve(__dirname, "../components");
const catalogs = {
  en: require("../messages/en.json"),
  zh: require("../messages/zh.json"),
};
function compile(name) {
  return transformSync(readFileSync(path.join(components, name + ".tsx"), "utf8"), {
    filename: name + ".tsx",
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  }).code;
}
const markdownCode = compile("SafeReportMarkdown");
const inboxCode = compile("InboxPanel");

function load(code, imports) {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), "Unexpected UI import " + name);
      return imports[name];
    },
    URL,
    Intl,
    fetch() {
      assert.fail("Rendering report content must not fetch links or private data");
    },
  });
  return module.exports;
}

const markdown = load(markdownCode, { "react/jsx-runtime": require("react/jsx-runtime") });
const noop = () => {};
const meta = (overrides = {}) => ({
  resultId: "result_synthetic_A",
  taskId: "task_synthetic_daily",
  runId: "run_synthetic_02",
  revision: 2,
  deliveryRevision: 1,
  envelopeFingerprint: "a".repeat(64),
  connectionId: "connection_synthetic_muse_A",
  receivedAt: "2026-10-29T13:00:00Z",
  taskVersion: 3,
  stateVersion: 4,
  read: false,
  starred: false,
  archived: false,
  manifestId: "manifest_synthetic_02",
  keyEpoch: 2,
  ...overrides,
});
function content(overrides = {}) {
  return {
    title: "Daily portfolio brief · synthetic example",
    summary: "A measured review of your synthetic holdings, watchlist and followed channels.",
    sections: [
      {
        sectionId: "portfolio_overview",
        markdown:
          "## Keep the whole picture in view\n\nYour synthetic portfolio is unchanged. **No trade is suggested.**\n\n- SYNTH: 12.5 units in the sample account\n- Reported cash: CAD 50.25\n- Watchlist: 3 synthetic symbols\n\nThe report uses the resource versions frozen when this run began.",
      },
      {
        sectionId: "what_to_watch",
        markdown:
          "Views from your followed channels are opinions. Compare their evidence and time horizon before making a decision.\n\nSee the [synthetic source](https://example.test/synthetic-source) if you choose to review it.",
      },
    ],
    citations: [
      {
        citationId: "citation_synthetic_A",
        title: "Synthetic channel commentary",
        url: "https://example.test/synthetic-source",
        provenance: "agent_provided",
        publishedAt: "2026-10-29T12:00:00Z",
      },
    ],
    limitations: [
      "All data shown here is synthetic. This fixture contains no real account or investment advice.",
      "No exchange rate or current market price was supplied for this run.",
    ],
    ...overrides,
  };
}

function fixture(overrides = {}, workspaceOverrides = {}) {
  const metadata = meta();
  const privateContent = content();
  const evidence = {
    receipt: { receivedAt: "2026-10-30T13:10:00Z" },
    provenance: { provider: "muse", kind: "authorized_connection_submission" },
    manifest: {
      entries: [
        { ref: { kind: "holdings" }, revision: 2, sourceEpoch: 1 },
        { ref: { kind: "watchlist" }, revision: 3, sourceEpoch: 1 },
        { ref: { kind: "channel_follows" }, revision: 1, sourceEpoch: 1 },
      ],
    },
  };
  const workspace = {
    owner: "session_synthetic_A",
    vaultGeneration: 1,
    phase: "unlocked",
    authenticated: true,
    authStatus: "authenticated",
    vaultConfigured: true,
    configured: true,
    busy: null,
    error: "",
    lock: noop,
    unlock: noop,
    create: noop,
    signIn: noop,
    ...workspaceOverrides,
  };
  const model = {
    authenticated: true,
    configured: true,
    unlocked: true,
    canWriteState: true,
    filter: "all",
    query: "",
    items: [
      { metadata, content: privateContent },
      {
        metadata: meta({
          resultId: "result_synthetic_B",
          connectionId: "connection_synthetic_muse_B",
          revision: 1,
          read: true,
          starred: true,
        }),
        content: {
          ...content(),
          title: "A second connected agent’s weekly review",
          summary: "Saved results from your own other connection stay together in this inbox.",
        },
      },
      { metadata: meta({ resultId: "result_synthetic_unopened", revision: 1 }), content: null },
    ],
    counts: { all: 3, unread: 2, starred: 1, archived: 1, total: 4 },
    loading: false,
    busy: null,
    error: "",
    notice: "",
    hasMore: true,
    nextCursor: "synthetic_cursor",
    selected: { metadata, content: privateContent, evidence, historical: false },
    history: [metadata, meta({ revision: 1 })],
    historyHasMore: false,
    pendingState: false,
    setFilter: noop,
    setQuery: noop,
    reload: noop,
    loadMore: noop,
    openResult: noop,
    closeDetail: noop,
    updateState: noop,
    retryPendingState: noop,
    discardPendingState: noop,
    loadMoreHistory: noop,
    copyText: () => "Synthetic plain-text report",
    ...overrides,
  };
  return { model, workspace };
}

function render(
  state = fixture(),
  locale = "en",
  { copyConfirm = false, captureButtons = null } = {},
) {
  const messages = catalogs[locale];
  let stateIndex = 0;
  const runtime = require("react/jsx-runtime");
  const renderJsx =
    (name) =>
    (type, props, ...rest) => {
      if (captureButtons && type === "button") captureButtons.push(props);
      return runtime[name](type, props, ...rest);
    };
  const imports = {
    react: {
      ...React,
      useState(initial) {
        return React.useState(stateIndex++ === 0 && copyConfirm ? true : initial);
      },
    },
    "react/jsx-runtime": captureButtons
      ? { ...runtime, jsx: renderJsx("jsx"), jsxs: renderJsx("jsxs") }
      : runtime,
    "next-intl": {
      useLocale: () => locale,
      useTranslations: (namespace) =>
        createTranslator({
          locale,
          messages,
          namespace,
          onError(error) {
            throw error;
          },
        }),
    },
    "./useInbox": { useInbox: () => state.model },
    "./SafeReportMarkdown": markdown,
    "./PasskeyHelp": { PasskeyHelp: () => null },
    "@/lib/inbox-link": load(
      transformSync(readFileSync(path.resolve(components, "../lib/inbox-link.ts"), "utf8"), {
        filename: "inbox-link.ts",
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "commonjs" },
      }).code,
      {},
    ),
    "./InboxPanel.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_object, name) => "inbox_" + String(name) }),
    },
  };
  const { InboxView } = load(inboxCode, imports);
  return renderToStaticMarkup(React.createElement(InboxView, state));
}

test("locked and account-transition views immediately mask stale plaintext, query, detail and export controls", () => {
  const canary = "PRIVATE_STALE_CANARY";
  const base = fixture({ query: canary });
  base.model.items[0].content = content({ title: canary, summary: canary });
  base.model.selected.content = content({
    title: canary,
    sections: [{ sectionId: "private", markdown: canary }],
  });
  for (const workspace of [
    { ...base.workspace, phase: "locked" },
    { ...base.workspace, phase: "checking", owner: "session_synthetic_B" },
    { ...base.workspace, authenticated: false, phase: "unlocked" },
  ]) {
    const html = render({ ...base, workspace }, "en", { copyConfirm: true });
    assert.ok(!html.includes(canary));
    assert.ok(!html.includes('id="result-title"'));
    assert.ok(!html.includes("Copy plain text"));
    assert.match(html, /Encrypted result/);
    assert.match(html, /<input[^>]*disabled=""[^>]*value=""/);
    assert.ok(html.includes("connection_s"));
  }
});

test("anonymous and disabled instances do not render a stale authenticated result or search index", () => {
  for (const override of [{ authenticated: false }, { configured: false }]) {
    const state = fixture(override);
    const html = render(state);
    assert.ok(!html.includes(state.model.selected.content.title));
    assert.ok(!html.includes('id="result-title"'));
    assert.ok(!html.includes('type="search"'));
    assert.ok(!html.includes("Copy report"));
  }
});

test("unlocked English and Chinese views display original revision evidence, limits and bounded search scope", () => {
  for (const locale of ["en", "zh"]) {
    const state = fixture();
    const html = render(state, locale);
    assert.ok(html.includes(state.model.selected.content.title));
    assert.ok(html.includes(state.model.selected.metadata.connectionId));
    assert.ok(html.includes(state.model.selected.metadata.manifestId));
    assert.match(html, /aria-labelledby="result-title"/);
    assert.match(html, /<details[^>]*>/);
    assert.match(html, /target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/);
    assert.ok(html.includes(catalogs[locale].inbox.searchScope));
    assert.ok(html.includes(catalogs[locale].inbox.evidenceHelp));
    assert.ok(html.includes(catalogs[locale].inbox.frozenHelp));
    assert.match(html, /href="\/#inbox\/result\/result_synthetic_A\/revisions\/2"/);
    assert.ok(html.includes(catalogs[locale].inbox.resultLink));
    assert.ok(!html.includes("Copy plain text"));
    assert.ok(!html.includes("复制明文"));
  }
});

test("historical revisions retain explicit historical context and current logical controls", () => {
  const state = fixture();
  state.model.selected = {
    ...state.model.selected,
    historical: true,
    metadata: meta({ revision: 1, starred: true, archived: true }),
  };
  const html = render(state);
  assert.ok(html.includes(catalogs.en.inbox.historicalHelp));
  assert.ok(html.includes("Historical revision"));
  assert.ok(html.includes("Restore to inbox"));
  assert.ok(html.includes("Unstar"));
  assert.match(html, /aria-label="Revision history"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /href="\/#inbox\/result\/result_synthetic_A\/revisions\/1"/);
});

test("a revision permalink starts at the canonical root without inheriting an old OAuth handoff query", () => {
  const html = render(fixture());
  const href = /href="(\/#inbox\/result\/result_synthetic_A\/revisions\/2)"/.exec(html)?.[1];
  assert.ok(href);
  const previous = new URL(
    "https://owner.synthetic.test/?agent_request=request_old&agent_nonce=nonce_old",
  );
  const linked = new URL(href, previous);
  assert.equal(linked.pathname, "/");
  assert.equal(linked.search, "");
  assert.equal(linked.hash, "#inbox/result/result_synthetic_A/revisions/2");
  assert.ok(!linked.href.includes("request_old"));
  assert.ok(!linked.href.includes("nonce_old"));
  const ordinary = new URL(href, "https://owner.synthetic.test/");
  assert.equal(
    ordinary.origin + ordinary.pathname + ordinary.search,
    "https://owner.synthetic.test/",
  );
});

test("result fields and unsupported Markdown remain React text; dangerous URLs cannot become navigation", () => {
  const payload = '<img src=x onerror="window.EXECUTED=true"><script>SECRET_SCRIPT</script>';
  const state = fixture();
  const privateContent = content({
    title: payload,
    summary: payload,
    sections: [
      {
        sectionId: "security",
        markdown:
          payload +
          "\n\n[script](javascript:alert(1))\n![image](https://example.test/never-fetch.png)",
      },
    ],
    citations: [
      { citationId: "unsafe", title: payload, url: "javascript:alert(1)", publishedAt: null },
      {
        citationId: "safe",
        title: "Safe navigation",
        url: "https://example.test/citation",
        publishedAt: null,
      },
    ],
    limitations: [payload],
  });
  state.model.selected.content = privateContent;
  state.model.items[0].content = privateContent;
  const html = render(state);
  assert.ok(!/<(?:img|script|iframe|object|embed)\b/i.test(html));
  assert.ok(!/\shref="(?:javascript|data|http):/i.test(html));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("SECRET_SCRIPT"));
  assert.ok(html.includes('href="https://example.test/citation"'));
  assert.ok(!html.includes('href="https://example.test/never-fetch.png"'));
});

test("safe navigation requires explicit credential-free HTTPS without whitespace or alternate ports", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://example.test",
    "//example.test",
    "/relative",
    "https://user:secret@example.test",
    "https://example.test:444/a",
    "https://example.test/ spaced",
    "https://example.test\\path",
    " https://example.test",
    "https://example.test/\n",
  ])
    assert.equal(markdown.reportLink(url), null, url);
  for (const url of ["https://example.test/a?x=1#source", "https://example.test:443/a"])
    assert.equal(markdown.reportLink(url), url);
});

test("restricted Markdown formats text and code but bounds large line counts without truncating the report", () => {
  const html = renderToStaticMarkup(
    React.createElement(markdown.SafeReportMarkdown, {
      markdown:
        "## Heading\n\n**Bold** and `sample`\n\n- First\n- Second\n\n```text\n<img src=x>\n```",
    }),
  );
  assert.match(html, /<h3>Heading<\/h3>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<ul><li>First<\/li><li>Second<\/li><\/ul>/);
  assert.match(html, /<pre><code>&lt;img src=x&gt;<\/code><\/pre>/);
  const large = "line\n".repeat(500) + "FINAL_SENTINEL";
  const bounded = renderToStaticMarkup(
    React.createElement(markdown.SafeReportMarkdown, { markdown: large }),
  );
  assert.equal((bounded.match(/<p/g) ?? []).length, 1);
  assert.ok(bounded.includes("FINAL_SENTINEL"));
});

test("unknown errors are mapped to a localized fixed explanation instead of rendering diagnostics", () => {
  for (const locale of ["en", "zh"]) {
    const state = fixture({ error: "PRIVATE_RAW_DIAGNOSTIC_42" });
    const html = render(state, locale);
    assert.ok(!html.includes("PRIVATE_RAW_DIAGNOSTIC_42"));
    assert.ok(html.includes(catalogs[locale].inbox.errors.request_failed));
    assert.match(html, /role="alert"/);
  }
});

test("clipboard export requires a separate plaintext warning and explicit confirmation", () => {
  const state = fixture();
  const ordinary = render(state);
  assert.ok(ordinary.includes("Copy report"));
  assert.ok(!ordinary.includes("Copy plain text"));
  const confirmed = render(state, "en", { copyConfirm: true });
  assert.ok(confirmed.includes(catalogs.en.inbox.copyWarning));
  assert.ok(confirmed.includes("Copy plain text"));
  assert.ok(confirmed.includes("Cancel"));
});

test("pending state recovery exposes exact saved retry rather than automatic overwrite", () => {
  const html = render(fixture({ pendingState: true, error: "state_outcome_unknown" }));
  assert.ok(html.includes(catalogs.en.inbox.pendingHelp));
  assert.ok(html.includes("Retry saved change"));
  assert.ok(html.includes("Discard retry and refresh"));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Mark read<\/button>/);
});

test("read-only historical access keeps content visible and enables current device changes only through the shared Passkey path", () => {
  for (const locale of ["en", "zh"]) {
    const calls = [];
    const buttons = [];
    const state = fixture({ canWriteState: false }, { unlock: (options) => calls.push(options) });
    const html = render(state, locale, { captureButtons: buttons });
    const t = catalogs[locale].inbox;
    assert.ok(html.includes(state.model.selected.content.title));
    assert.ok(html.includes(t.readOnlyHelp));
    assert.ok(html.includes(t.enableChanges));
    for (const text of [t.markRead, t.star, t.archive]) {
      const button = buttons.find((props) => props.children === text);
      assert.ok(button, text);
      assert.equal(button.disabled, true, text);
    }
    const enable = buttons.find((props) => props.children === t.enableChanges);
    assert.equal(enable.disabled, false);
    enable.onClick();
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(calls[0]), JSON.stringify({ forResults: true, enableState: true }));
    assert.ok(!render(fixture(), locale).includes(t.readOnlyHelp));
  }
});

function writeVisualFixtures() {
  const directory = path.resolve(__dirname, "../../../local-docs/validation/web-007-inbox");
  mkdirSync(directory, { recursive: true });
  const globals = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
  const styles = readFileSync(path.join(components, "InboxPanel.module.css"), "utf8").replace(
    /\.([a-zA-Z_][\w-]*)/g,
    ".inbox_$1",
  );
  const root = fixture();
  const historical = fixture();
  historical.model.selected.historical = true;
  historical.model.selected.metadata = meta({ revision: 1 });
  historical.model.canWriteState = false;
  const variants = [
    { file: "desktop-en-unlocked.html", locale: "en", theme: "dark", state: root },
    { file: "mobile-zh-history.html", locale: "zh", theme: "dark", state: historical },
    {
      file: "light-en-locked.html",
      locale: "en",
      theme: "light",
      state: fixture({ unlocked: false, selected: null }, { phase: "locked" }),
    },
    {
      file: "mobile-zh-empty.html",
      locale: "zh",
      theme: "light",
      state: fixture({
        items: [],
        selected: null,
        hasMore: false,
        counts: { all: 0, unread: 0, starred: 0, archived: 0, total: 0 },
      }),
    },
  ];
  for (const variant of variants) {
    const body = render(variant.state, variant.locale);
    writeFileSync(
      path.join(directory, variant.file),
      `<!doctype html><html lang="${variant.locale}" data-theme="${variant.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WEB-007 synthetic visual fixture</title><style>${globals}\n${styles}\n.fixture-note{padding:12px 22px;border-bottom:1px solid var(--border);color:var(--muted);font-size:11px;line-height:1.6}.fixture-shell{max-width:1280px;margin:0 auto;padding:24px 28px}@media(max-width:760px){.fixture-shell{padding:20px 15px}}</style></head><body><div class="fixture-note">Synthetic visual fixture · actual InboxView and CSS · no account, network or encryption keys · static controls are not connected</div><main class="fixture-shell">${body}</main></body></html>`,
    );
  }
  const sourceHashes = Object.fromEntries(
    ["InboxPanel.tsx", "InboxPanel.module.css", "SafeReportMarkdown.tsx"].map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(path.join(components, name)))
        .digest("hex"),
    ]),
  );
  writeFileSync(
    path.join(directory, "visual-fixtures.evidence.json"),
    JSON.stringify(
      {
        date: "2026-10-30",
        ticket: "WEB-007",
        syntheticOnly: true,
        realAccountsOrKeys: false,
        source:
          "Actual InboxView/SafeReportMarkdown SSR with actual global and module CSS; synthetic already-verified model fixture only",
        staticControls: true,
        noNetworkOrServerStartedByGenerator: true,
        sourceHashes,
        files: variants.map(({ file, locale, theme }) => ({ file, locale, theme })),
        regenerate: "FOLIOVIEW_WRITE_INBOX_FIXTURES=1 node --test apps/web/tests/inbox-ui.test.cjs",
      },
      null,
      2,
    ) + "\n",
  );
}
if (process.env.FOLIOVIEW_WRITE_INBOX_FIXTURES === "1") writeVisualFixtures();
