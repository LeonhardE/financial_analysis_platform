const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const { renderToStaticMarkup } = require("react-dom/server");
const jsx = require("react/jsx-runtime");
const { createTranslator } = require("next-intl");

function mountAccount(changes = {}, locale = "en") {
  const calls = [];
  const auth = {
    status: "anonymous",
    profile: null,
    error: null,
    hasFirebaseUser: false,
    signIn: async () => calls.push("sign-in"),
    signOut: async () => calls.push("sign-out"),
    retry: async () => calls.push("retry"),
    ...changes,
  };
  let failedPhoto = null;
  const file = "../components/AccountControls.tsx";
  const { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
    filename: file,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  const imports = {
    react: { useState: () => [failedPhoto, (value) => (failedPhoto = value)] },
    "react/jsx-runtime": jsx,
    "next-intl": {
      useLocale: () => locale,
      useTranslations: () =>
        createTranslator({ locale, messages: require(`../messages/${locale}.json`) }),
    },
    "@/components/AuthProvider": { useAuth: () => auth },
    "@/lib/ui-messages": { localizeMessage: (message) => message },
    "./AccountControls.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_target, key) => String(key) }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return {
    calls,
    render: (collapsed = false) => module.exports.AccountControls({ collapsed }),
  };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat()) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

test("collapsed guest sign-in keeps its accessible name, tooltip and action", () => {
  const account = mountAccount();
  const tree = account.render(true);
  const button = find(tree, (node) => node.type === "button");
  assert.equal(button.props["aria-label"], "Sign in with Google");
  assert.equal(button.props.title, "Sign in with Google");
  assert.equal(button.props.children[1], false);
  button.props.onClick();
  assert.deepEqual(account.calls, ["sign-in"]);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Guest/);
  assert.match(html, /visuallyHidden/);
});

test("verified account renders its photo and name before the final sign-out action", () => {
  const account = mountAccount({
    status: "authenticated",
    hasFirebaseUser: true,
    profile: {
      uid: "user-a",
      email: "alice@example.com",
      displayName: "Alice",
      photoURL: "https://example.com/alice.png",
    },
  });
  const tree = account.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /title="alice@example.com"/);
  assert.match(html, /src="https:\/\/example.com\/alice.png"/);
  assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.ok(html.indexOf(">Alice<") < html.lastIndexOf(">Sign out<"));
  const button = find(tree, (node) => node.type === "button");
  button.props.onClick();
  assert.deepEqual(account.calls, ["sign-out"]);
});

test("a failed profile photo falls back to initials without hiding the account name", () => {
  const account = mountAccount({
    status: "authenticated",
    hasFirebaseUser: true,
    profile: { displayName: "Alice", email: null, photoURL: "https://example.com/broken.png" },
  });
  const avatar = find(
    account.render(),
    (node) => typeof node.type === "function" && node.props.name === "Alice",
  );
  const photo = avatar.type(avatar.props).props.children;
  assert.equal(photo.type, "img");
  photo.props.onError();
  const fallback = avatar.type(avatar.props);
  assert.equal(fallback.props.children, "A");
  assert.match(renderToStaticMarkup(account.render()), />Alice</);
});

test("collapsed verification errors remain visible, expandable and actionable", () => {
  const account = mountAccount({
    status: "error",
    hasFirebaseUser: true,
    error: "Could not verify your account. Please try again.",
  });
  const tree = account.render(true);
  const details = find(tree, (node) => node.type === "details");
  assert.ok(details);
  const summary = find(details, (node) => node.type === "summary");
  assert.match(summary.props["aria-label"], /Could not verify/);
  assert.equal(find(details, (node) => node.type === "p").props.role, "alert");
  const retry = find(
    tree,
    (node) => node.type === "button" && node.props["aria-label"] === "Retry",
  );
  retry.props.onClick();
  assert.deepEqual(account.calls, ["retry"]);
  assert.match(renderToStaticMarkup(tree), /aria-label="Sign out"/);
});

test("pending and unavailable sign-in stays disabled without extra unavailable copy", () => {
  const pending = mountAccount({ status: "signing-in" });
  const pendingButton = find(pending.render(true), (node) => node.type === "button");
  assert.equal(pendingButton.props.disabled, true);
  assert.equal(pendingButton.props["aria-label"], "Opening Google…");
  const unavailable = mountAccount({ status: "unavailable" }, "zh");
  for (const collapsed of [false, true]) {
    const tree = unavailable.render(collapsed);
    const button = find(tree, (node) => node.type === "button");
    assert.equal(button.props.disabled, true);
    assert.equal(button.props["aria-label"], "通过 Google 登录");
    assert.equal(
      find(tree, (node) => node.type === "details"),
      null,
    );
    assert.equal(
      find(tree, (node) => node.type === "p"),
      null,
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, /访客/);
    assert.doesNotMatch(html, /登录暂不可用|自由浏览|Sign-in will be available soon/);
  }
});
