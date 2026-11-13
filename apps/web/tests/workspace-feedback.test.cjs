const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { compile } = require("./resource-library-helpers.cjs");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const { component } = require("./workspace-feedback-helpers.cjs");
const feedback = component("./WorkspaceFeedback");

function mount(name, initial, reduced = false) {
  const cells = [],
    effects = [],
    timers = new Map();
  let index = 0,
    dirty = false,
    serial = 0,
    props = initial;
  const document = { activeElement: null };
  class Element {
    isConnected = true;
    tabIndex = 0;
    disabled = false;
    focused = 0;
    focus() {
      this.focused++;
      document.activeElement = this;
    }
    getClientRects() {
      return [{}];
    }
  }
  const opener = new Element(),
    first = new Element(),
    last = new Element();
  document.activeElement = opener;
  const dialog = new Element();
  Object.assign(dialog, {
    open: false,
    showModal() {
      this.open = true;
      first.focus();
    },
    close() {
      this.open = false;
    },
    querySelectorAll() {
      return [first, last];
    },
    getBoundingClientRect() {
      return { left: 10, right: 300, top: 10, bottom: 300 };
    },
  });
  const hooks = {
    useRef(value) {
      const slot = index++;
      cells[slot] ??= { current: value };
      return cells[slot];
    },
    useState(value) {
      const slot = index++;
      cells[slot] ??= { value: typeof value === "function" ? value() : value };
      return [
        cells[slot].value,
        (next) => {
          const value = typeof next === "function" ? next(cells[slot].value) : next;
          dirty ||= value !== cells[slot].value;
          cells[slot].value = value;
        },
      ];
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!cells[slot] || deps.some((d, n) => d !== cells[slot].deps[n]))
        effects.push({ slot, effect, deps });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = compile(
    `../components/${name === "ReportDialog" ? "ReportDialog" : "WorkspaceFeedback"}.tsx`,
    {
      react: hooks,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "./WorkspaceFeedback.module.css": {
        __esModule: true,
        default: new Proxy({}, { get: (_, key) => String(key) }),
      },
    },
    {
      document,
      HTMLElement: Element,
      window: {
        matchMedia: () => ({ matches: reduced }),
        setTimeout(callback, delay) {
          const id = ++serial;
          timers.set(id, { callback, delay });
          return id;
        },
        clearTimeout(id) {
          timers.delete(id);
        },
      },
    },
  );
  const render = () => {
    let tree;
    do {
      dirty = false;
      index = 0;
      tree = exports[name](props);
      if (tree?.type === "dialog") tree.props.ref.current = dialog;
      for (const entry of effects.splice(0)) {
        cells[entry.slot]?.cleanup?.();
        cells[entry.slot] = { deps: entry.deps, cleanup: entry.effect() };
      }
    } while (dirty);
    return tree;
  };
  return {
    render,
    dialog,
    first,
    last,
    opener,
    document,
    set(next) {
      props = { ...props, ...next };
    },
    advance(ms) {
      for (const [id, t] of [...timers])
        if (t.delay <= ms) {
          timers.delete(id);
          t.callback();
        }
    },
    pending: () => timers.size,
    unmount() {
      for (const c of cells) c?.cleanup?.();
    },
  };
}

test("first-load feedback waits150ms, keeps content during refresh and never invents percent progress", () => {
  const h = mount("LoadingIndicator", { busy: true, label: "Loading", hasContent: false });
  assert.equal(h.render(), null);
  h.advance(149);
  assert.equal(h.render(), null);
  h.advance(150);
  const tree = h.render();
  assert.equal(tree.props.role, "status");
  assert.match(JSON.stringify(tree), /skeleton/);
  assert.doesNotMatch(JSON.stringify(tree), /aria-valuenow|%/);
  h.set({ hasContent: true });
  assert.doesNotMatch(JSON.stringify(h.render()), /"className":"skeleton"/);
  h.set({ busy: false });
  assert.equal(h.render(), null);
  assert.equal(h.pending(), 0);
  h.unmount();
});

test("unread badges and dots reflect actual state, disappear at zero/read and retain accessible counts", () => {
  const badge = renderToStaticMarkup(
    React.createElement(feedback.UnreadBadge, { count: 2, label: "2 unread reports" }),
  );
  assert.match(badge, /aria-label="2 unread reports"/);
  assert.match(badge, />2</);
  assert.equal(
    renderToStaticMarkup(React.createElement(feedback.UnreadBadge, { count: 0, label: "none" })),
    "",
  );
  assert.equal(
    renderToStaticMarkup(React.createElement(feedback.UnreadDot, { unread: false })),
    "",
  );
  assert.match(
    renderToStaticMarkup(
      React.createElement(feedback.RunIndicator, { state: "waiting", label: "Waiting for Agent" }),
    ),
    /data-state="waiting"/,
  );
});

test("report dialog traps Tab, intercepts Escape, animates closure and returns focus without scrolling", () => {
  let closes = 0;
  const h = mount("ReportDialog", {
    id: "report",
    open: true,
    identity: "A",
    title: "Private",
    closeLabel: "Close",
    onClose: () => closes++,
    children: "PRIVATE_REPORT",
  });
  let tree = h.render();
  assert.equal(h.dialog.open, true);
  assert.equal(h.document.activeElement, h.first);
  let prevented = false;
  tree.props.onKeyDown({
    key: "Tab",
    shiftKey: true,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(h.document.activeElement, h.last);
  tree.props.onKeyDown({ key: "Escape", preventDefault() {} });
  tree = h.render();
  assert.equal(tree.props["data-closing"], true);
  assert.equal(closes, 0);
  h.advance(160);
  assert.equal(closes, 1);
  assert.equal(h.dialog.open, false);
  assert.equal(h.document.activeElement, h.opener);
  h.unmount();
});

test("lock/hidden closure clears private markup immediately; a new report interrupts an old exit", () => {
  let closes = 0;
  const h = mount("ReportDialog", {
    id: "report",
    open: true,
    identity: "A",
    title: "Private",
    closeLabel: "Close",
    onClose: () => closes++,
    children: "PRIVATE_REPORT",
  });
  let tree = h.render();
  tree.props.onCancel({ preventDefault() {} });
  h.render();
  h.set({ identity: "B", children: "PRIVATE_B" });
  h.render();
  h.advance(160);
  assert.equal(closes, 0);
  assert.equal(h.dialog.open, true);
  h.set({ open: false, children: null });
  tree = h.render();
  assert.equal(h.dialog.open, false);
  assert.doesNotMatch(JSON.stringify(tree), /PRIVATE_REPORT|PRIVATE_B/);
  assert.equal(h.pending(), 0);
  h.unmount();
});

test("reduced motion closes immediately and backdrop clicks use the same controlled exit", () => {
  let closes = 0;
  const h = mount(
    "ReportDialog",
    {
      id: "report",
      open: true,
      identity: "A",
      title: "Private",
      closeLabel: "Close",
      onClose: () => closes++,
      children: "private",
    },
    true,
  );
  const tree = h.render();
  tree.props.onClick({ target: h.dialog, clientX: 0, clientY: 0 });
  assert.equal(closes, 1);
  assert.equal(h.pending(), 0);
  assert.equal(h.dialog.open, false);
  h.unmount();
  const css = readFileSync(
    path.join(__dirname, "../components/WorkspaceFeedback.module.css"),
    "utf8",
  );
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /transition:\s*all/);
});
