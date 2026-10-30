const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const { renderToStaticMarkup } = require("react-dom/server");
const jsxRuntime = require("react/jsx-runtime");
const { createTranslator } = require("next-intl");
const english = require("../messages/en.json");

function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

function mountSidebar({ mobile = false } = {}) {
  const cells = [];
  const effects = [];
  const navigations = [];
  const mediaListeners = new Set();
  const media = {
    matches: mobile,
    addEventListener: (_event, listener) => mediaListeners.add(listener),
    removeEventListener: (_event, listener) => mediaListeners.delete(listener),
  };
  const attributes = new Set();
  const content = {
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name) => attributes.add(name),
    removeAttribute: (name) => attributes.delete(name),
  };
  const document = {
    body: { style: { overflow: "auto" } },
    getElementById: (id) => (id === "workspace-content" ? content : null),
    activeElement: null,
  };
  let index = 0;
  let dirty = false;
  let activeView = "markets";
  const changed = (before, after) =>
    !before || after.some((value, position) => value !== before[position]);
  const imports = {
    react: {
      useState: (initial) => {
        const slot = index++;
        cells[slot] ??= { state: typeof initial === "function" ? initial() : initial };
        return [
          cells[slot].state,
          (next) => {
            const value = typeof next === "function" ? next(cells[slot].state) : next;
            dirty ||= !Object.is(value, cells[slot].state);
            cells[slot].state = value;
          },
        ];
      },
      useRef: (current) => {
        const slot = index++;
        cells[slot] ??= { current };
        return cells[slot];
      },
      useEffect: (effect, dependencies) => {
        const slot = index++;
        if (!cells[slot] || changed(cells[slot].dependencies, dependencies)) {
          effects.push({ slot, effect, dependencies });
        }
      },
    },
    "react/jsx-runtime": jsxRuntime,
    "next-intl": {
      useTranslations: () => createTranslator({ locale: "en", messages: english }),
    },
    "@/components/AccountControls": {
      AccountControls: ({ collapsed }) =>
        jsxRuntime.jsx("div", { "data-account-collapsed": collapsed }),
    },
    "./WorkspaceSidebar.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_target, name) => name }),
    },
  };
  const { code } = transformSync(
    readFileSync(path.join(__dirname, "../components/WorkspaceSidebar.tsx"), "utf8"),
    {
      filename: "WorkspaceSidebar.tsx",
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        target: "es2022",
        transform: { react: { runtime: "automatic" } },
      },
      module: { type: "commonjs" },
    },
  );
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    document,
    window: { matchMedia: () => media },
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return {
    document,
    attributes,
    navigations,
    render: () => {
      let tree;
      do {
        dirty = false;
        index = 0;
        tree = module.exports.WorkspaceSidebar({
          activeView,
          onNavigate: (view) => {
            navigations.push(view);
            activeView = view;
          },
        });
        for (const { slot, effect, dependencies } of effects.splice(0)) {
          cells[slot]?.cleanup?.();
          cells[slot] = { dependencies, cleanup: effect() };
        }
      } while (dirty);
      return tree;
    },
    unmount: () => cells.forEach((cell) => cell?.cleanup?.()),
    resize: (compact) => {
      media.matches = compact;
      mediaListeners.forEach((listener) => listener());
    },
  };
}

const button = (tree, label) => {
  const matches = nodes(
    tree,
    (node) => node.type === "button" && node.props["aria-label"] === label,
  );
  assert.equal(matches.length, 1, `Expected one ${label} button`);
  return matches[0];
};

test("the sidebar starts collapsed and keeps named navigation actions when expanded and collapsed again", () => {
  const sidebar = mountSidebar();
  let tree = sidebar.render();
  assert.equal(tree.props["data-collapsed"], true);
  assert.equal(button(tree, "Expand sidebar").props["aria-expanded"], false);
  assert.equal(button(tree, "Markets").props["aria-pressed"], true);
  assert.equal(button(tree, "Settings").props.title, "Settings");
  assert.match(renderToStaticMarkup(tree), /aria-hidden="true"/);
  assert.match(renderToStaticMarkup(tree), /data-account-collapsed="true"/);
  button(tree, "Expand sidebar").props.onClick();
  tree = sidebar.render();
  assert.equal(tree.props["data-collapsed"], false);
  assert.equal(button(tree, "Collapse sidebar").props["aria-expanded"], true);
  assert.match(renderToStaticMarkup(tree), /data-account-collapsed="false"/);
  button(tree, "Settings").props.onClick();
  tree = sidebar.render();
  assert.deepEqual(sidebar.navigations, ["settings"]);
  assert.equal(button(tree, "Settings").props["aria-pressed"], true);
  assert.equal(button(tree, "Markets").props["aria-pressed"], false);
  assert.equal(tree.props["data-collapsed"], false);
  button(tree, "Collapse sidebar").props.onClick();
  tree = sidebar.render();
  assert.equal(tree.props["data-collapsed"], true);
  assert.equal(button(tree, "Expand sidebar").props["aria-expanded"], false);
  assert.equal(button(tree, "Settings").props["aria-pressed"], true);
  assert.equal(button(tree, "Settings").props.title, "Settings");
  button(tree, "Markets").props.onClick();
  tree = sidebar.render();
  assert.deepEqual(sidebar.navigations, ["settings", "markets"]);
  assert.equal(button(tree, "Markets").props["aria-pressed"], true);
  assert.equal(tree.props["data-collapsed"], true);
  sidebar.unmount();
});

test("mobile expansion isolates content and closing with Escape restores focus and scrolling", () => {
  const sidebar = mountSidebar({ mobile: true });
  let tree = sidebar.render();
  assert.equal(tree.props["data-collapsed"], true);
  button(tree, "Expand sidebar").props.onClick();
  tree = sidebar.render();
  assert.equal(tree.props["data-mobile-open"], true);
  assert.equal(sidebar.attributes.has("inert"), true);
  assert.equal(sidebar.document.body.style.overflow, "hidden");
  const dialog = nodes(tree, (node) => node.props?.role === "dialog")[0];
  assert.equal(dialog.props["aria-modal"], true);
  const first = { offsetParent: {}, focus: () => (sidebar.document.activeElement = first) };
  const last = { offsetParent: {}, focus: () => (sidebar.document.activeElement = last) };
  dialog.props.ref.current = {
    querySelectorAll: () => [first, { offsetParent: null }, last],
  };
  let trapped = 0;
  sidebar.document.activeElement = last;
  dialog.props.onKeyDown({
    key: "Tab",
    shiftKey: false,
    preventDefault: () => trapped++,
  });
  assert.equal(sidebar.document.activeElement, first);
  dialog.props.onKeyDown({ key: "Tab", shiftKey: true, preventDefault: () => trapped++ });
  assert.equal(sidebar.document.activeElement, last);
  assert.equal(trapped, 2);
  let focused = false;
  button(tree, "Collapse sidebar").props.ref.current = { focus: () => (focused = true) };
  let prevented = false;
  dialog.props.onKeyDown({ key: "Escape", preventDefault: () => (prevented = true) });
  tree = sidebar.render();
  assert.equal(prevented, true);
  assert.equal(focused, true);
  assert.equal(tree.props["data-collapsed"], true);
  assert.equal(sidebar.attributes.has("inert"), false);
  assert.equal(sidebar.document.body.style.overflow, "auto");
  sidebar.unmount();
});

test("resizing out of mobile mode closes an open overlay and restores the page", () => {
  const sidebar = mountSidebar({ mobile: true });
  let tree = sidebar.render();
  button(tree, "Expand sidebar").props.onClick();
  sidebar.render();
  assert.equal(sidebar.attributes.has("inert"), true);
  sidebar.resize(false);
  tree = sidebar.render();
  assert.equal(tree.props["data-mobile-open"], false);
  assert.equal(sidebar.attributes.has("inert"), false);
  assert.equal(sidebar.document.body.style.overflow, "auto");
  assert.equal(nodes(tree, (node) => node.props?.role === "dialog").length, 0);
  sidebar.unmount();
});

test("navigating from an expanded mobile sidebar closes the overlay and releases content", () => {
  const sidebar = mountSidebar({ mobile: true });
  let tree = sidebar.render();
  button(tree, "Expand sidebar").props.onClick();
  tree = sidebar.render();
  button(tree, "Settings").props.onClick();
  tree = sidebar.render();
  assert.deepEqual(sidebar.navigations, ["settings"]);
  assert.equal(tree.props["data-mobile-open"], false);
  assert.equal(button(tree, "Settings").props["aria-pressed"], true);
  assert.equal(sidebar.attributes.has("inert"), false);
  assert.equal(sidebar.document.body.style.overflow, "auto");
  sidebar.unmount();
});

test("resources are reachable from bottom navigation while Markets remains the default", () => {
  const sidebar = mountSidebar();
  let tree = sidebar.render();
  assert.equal(button(tree, "Markets").props["aria-pressed"], true);
  button(tree, "Resources").props.onClick();
  tree = sidebar.render();
  assert.equal(button(tree, "Resources").props["aria-pressed"], true);
  assert.equal(button(tree, "Markets").props["aria-pressed"], false);
  button(tree, "Inbox").props.onClick();
  tree = sidebar.render();
  assert.equal(button(tree, "Inbox").props["aria-pressed"], true);
  assert.equal(button(tree, "Resources").props["aria-pressed"], false);
  button(tree, "Markets").props.onClick();
  tree = sidebar.render();
  assert.equal(button(tree, "Markets").props["aria-pressed"], true);
  sidebar.unmount();
});
