const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const jsxRuntime = require("react/jsx-runtime");
const { createTranslator } = require("next-intl");

function compile(file, imports, globals = {}) {
  const { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
    filename: file,
    jsc: {
      parser: { syntax: "typescript", tsx: file.endsWith(".tsx") },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return module.exports;
}

function mountList(locale = "en") {
  const stores = new Map();
  const pendingEffects = [];
  const observers = [];
  const visible = [];
  const removed = [];
  const selected = [];
  let activeCells;
  let index;
  let nodes;
  const props = {
    watchlist: {
      authenticated: true,
      loaded: true,
      items: ["AAPL", "NFLX"].map((symbol) => ({
        symbol,
        name: symbol === "AAPL" ? "Apple" : "Netflix",
        currency: "USD",
        instrumentType: "stock",
        addedAt: "2026-10-23T12:00:00Z",
      })),
      limit: 50,
      remove: (symbol) => removed.push(symbol),
    },
    selectedSymbol: "AAPL",
    onSelect: (instrument) => selected.push(instrument.symbol),
    onQuoteVisible: (symbol) => visible.push(symbol),
  };
  const { PersonalWatchlist } = compile(
    "../components/PersonalWatchlist.tsx",
    {
      react: {
        useState: (initial) => {
          const cells = activeCells;
          const slot = index++;
          cells[slot] ??= { value: initial };
          return [cells[slot].value, (value) => (cells[slot].value = value)];
        },
        useRef: (current) => {
          const slot = index++;
          activeCells[slot] ??= { current };
          return activeCells[slot];
        },
        useEffect: (effect, dependencies) => {
          const cells = activeCells;
          const slot = index++;
          if (
            !cells[slot] ||
            dependencies.some((value, position) => value !== cells[slot].dependencies[position])
          ) {
            pendingEffects.push(() => {
              cells[slot]?.cleanup?.();
              cells[slot] = { dependencies, cleanup: effect() };
            });
          }
        },
      },
      "react/jsx-runtime": jsxRuntime,
      "next-intl": {
        useLocale: () => locale,
        useTranslations: () =>
          createTranslator({ locale, messages: require(`../messages/${locale}.json`) }),
      },
      "@/lib/ui-messages": compile("../lib/ui-messages.ts", {}),
      "@/lib/market-data": compile("../lib/market-data.ts", {}),
      "@/components/AuthProvider": { useAuth: () => ({ status: "authenticated" }) },
      "./PersonalWatchlist.module.css": {
        __esModule: true,
        default: new Proxy({}, { get: (_, name) => String(name) }),
      },
    },
    {
      IntersectionObserver: class {
        constructor(callback) {
          this.callback = callback;
          observers.push(this);
        }
        observe(target) {
          this.target = target;
        }
        disconnect() {
          this.disconnected = true;
        }
      },
    },
  );
  function invoke(component, componentProps) {
    const key = `${component.name}:${componentProps.item?.symbol ?? "list"}`;
    if (!stores.has(key)) stores.set(key, []);
    activeCells = stores.get(key);
    index = 0;
    return component(componentProps);
  }
  function visit(node, symbol) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, symbol));
    if (typeof node.type === "function") {
      return visit(invoke(node.type, node.props), node.props.item?.symbol ?? symbol);
    }
    nodes.push({ ...node, symbol });
    if (node.props?.ref && typeof node.props.ref === "object") {
      node.props.ref.current ??= { symbol, focus: () => {} };
    }
    visit(node.props?.children, symbol);
  }
  function render(next = {}) {
    Object.assign(props, next);
    nodes = [];
    visit(invoke(PersonalWatchlist, props));
    if (pendingEffects.length) {
      pendingEffects.splice(0).forEach((effect) => effect());
      nodes = [];
      visit(invoke(PersonalWatchlist, props));
    }
    return nodes;
  }
  function find(symbol, predicate) {
    return nodes.find((node) => node.symbol === symbol && predicate(node));
  }
  render();
  return {
    render,
    props,
    removed,
    selected,
    visible,
    row: (symbol) => find(symbol, (node) => node.type === "li"),
    foreground: (symbol) => find(symbol, (node) => node.props?.onPointerDown),
    select: (symbol) => find(symbol, (node) => node.props?.className === "select"),
    action: (symbol) => find(symbol, (node) => node.props?.["aria-expanded"] !== undefined),
    remove: (symbol) => find(symbol, (node) => node.props?.className === "remove"),
    visibility: (symbol, isIntersecting) => {
      for (const observer of observers) {
        if (!observer.disconnected && observer.target?.symbol === symbol) {
          observer.callback([{ isIntersecting }]);
        }
      }
    },
  };
}

function pointerSequence() {
  const captured = new Set();
  const target = {
    setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id),
    releasePointerCapture: (id) => captured.delete(id),
  };
  let prevented = 0;
  return {
    captured,
    prevented: () => prevented,
    event: (x, y) => ({
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: x,
      clientY: y,
      currentTarget: target,
      preventDefault: () => prevented++,
    }),
  };
}

test("swiping reveals a separate Remove action and never deletes or selects by itself", () => {
  const app = mountList();
  const foreground = app.foreground("NFLX");
  const pointer = pointerSequence();
  foreground.props.onPointerDown(pointer.event(200, 100));
  foreground.props.onPointerMove(pointer.event(140, 103));
  foreground.props.onPointerUp(pointer.event(140, 103));
  app.render();
  assert.equal(app.action("NFLX").props["aria-expanded"], true);
  assert.equal(app.remove("NFLX").props.tabIndex, 0);
  assert.deepEqual(app.removed, []);
  assert.deepEqual(app.selected, []);
  let suppressed = false;
  app.foreground("NFLX").props.onClickCapture({
    preventDefault() {},
    stopPropagation: () => (suppressed = true),
  });
  assert.equal(suppressed, true);
  app.remove("NFLX").props.onClick();
  assert.deepEqual(app.removed, ["NFLX"]);
  assert.equal(pointer.captured.size, 0);
});

test("vertical intent and cancelled drags leave scrolling and selection intact", () => {
  for (const cancel of [false, true]) {
    const app = mountList();
    const foreground = app.foreground("NFLX");
    const pointer = pointerSequence();
    foreground.props.onPointerDown(pointer.event(200, 100));
    foreground.props.onPointerMove(pointer.event(cancel ? 140 : 198, cancel ? 102 : 135));
    if (cancel) foreground.props.onPointerCancel(pointer.event(140, 102));
    else foreground.props.onPointerUp(pointer.event(198, 135));
    app.render();
    assert.equal(app.action("NFLX").props["aria-expanded"], false);
    assert.equal(pointer.captured.size, 0);
    if (!cancel) assert.equal(pointer.prevented(), 0);
    app.select("NFLX").props.onClick();
    assert.deepEqual(app.selected, ["NFLX"]);
  }
});

test("mouse and keyboard controls reveal only one row, and Escape or selection closes it", () => {
  const app = mountList();
  app.action("NFLX").props.onClick();
  app.render();
  assert.equal(app.action("NFLX").props["aria-expanded"], true);
  app.action("AAPL").props.onClick();
  app.render();
  assert.equal(app.action("NFLX").props["aria-expanded"], false);
  assert.equal(app.remove("NFLX").props.tabIndex, -1);
  assert.equal(app.action("AAPL").props["aria-expanded"], true);
  app.row("AAPL").props.onKeyDown({
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
  app.render();
  assert.equal(app.action("AAPL").props["aria-expanded"], false);
  app.action("NFLX").props.onClick();
  app.render();
  app.select("NFLX").props.onClick();
  app.render();
  assert.equal(app.action("NFLX").props["aria-expanded"], false);
  assert.deepEqual(app.selected, ["NFLX"]);
});

test("quote loading begins on intersection, including reopened lists, never on hidden rows", () => {
  const app = mountList();
  assert.deepEqual(app.visible, []);
  app.visibility("NFLX", false);
  assert.deepEqual(app.visible, []);
  app.visibility("NFLX", true);
  app.visibility("NFLX", true);
  assert.deepEqual(app.visible, ["NFLX"]);
  app.render({ onQuoteVisible: (symbol) => app.visible.push(symbol) });
  app.visibility("NFLX", true);
  assert.deepEqual(app.visible, ["NFLX", "NFLX"]);
  assert.equal(app.visible.includes("AAPL"), false);
});

test("success messages no longer persist inside the list, but failures retain reload controls", () => {
  const app = mountList();
  app.props.watchlist.message = "AAPL removed from your watchlist.";
  const nodes = app.render();
  assert.equal(
    nodes.some((node) => node.props?.children === app.props.watchlist.message),
    false,
  );
  app.props.watchlist.error = "Your watchlist is temporarily unavailable. Please try again.";
  app.props.watchlist.reload = () => {};
  assert.ok(app.render().some((node) => node.props?.children === "Reload watchlist"));
});
