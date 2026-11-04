const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const runtime = require("react/jsx-runtime");
const { renderToStaticMarkup } = require("react-dom/server");
const { createTranslator } = require("next-intl");
const { transformSync } = require("next/dist/build/swc");
function harness(changes = {}, locale = "en") {
  let cursor = 0,
    nodes = [],
    effects = [];
  const slots = [],
    calls = [];
  const workspace = {
    owner: "synthetic_owner_A",
    authenticated: true,
    vaultConfigured: true,
    vault: { vaultId: "vault_A", rootKeyId: "PUBLIC_ROOT_FINGERPRINT" },
    vaultGeneration: 1,
    phase: "unlocked",
    busy: null,
    archiveDeletion: null,
    archiveDeletionReview: null,
    archiveDeletionError: "",
    keyNotice: "",
    archiveChange: null,
    ...Object.fromEntries(
      [
        "reviewArchiveDeletion",
        "confirmArchiveDeletion",
        "cancelArchiveDeletionReview",
        "refreshArchiveDeletion",
        "resumeArchiveDeletion",
        "withdrawArchiveDeletion",
      ].map((name) => [name, (...args) => calls.push([name, ...args])]),
    ),
    ...changes,
  };
  const react = {
    ...React,
    useState(initial) {
      const slot = cursor++;
      slots[slot] ??= { value: initial };
      return [
        slots[slot].value,
        (value) => {
          slots[slot].value = typeof value === "function" ? value(slots[slot].value) : value;
        },
      ];
    },
    useRef(initial) {
      const slot = cursor++;
      slots[slot] ??= { current: initial };
      return slots[slot];
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      if (slots[slot]?.deps?.every((v, i) => v === deps[i])) return;
      const old = slots[slot];
      slots[slot] = { deps };
      effects.push(() => {
        old?.cleanup?.();
        slots[slot].cleanup = effect();
      });
    },
  };
  const wrap =
    (name) =>
    (type, props, ...rest) => {
      if (typeof type === "string") nodes.push({ type, props });
      return runtime[name](type, props, ...rest);
    };
  const filename = path.resolve(__dirname, "../components/VaultArchiveDeletionPanel.tsx");
  const { code } = transformSync(readFileSync(filename, "utf8"), {
    filename,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  const imports = {
    react,
    "react/jsx-runtime": { ...runtime, jsx: wrap("jsx"), jsxs: wrap("jsxs") },
    "next-intl": {
      useTranslations: (namespace) =>
        createTranslator({
          locale,
          namespace,
          messages: require("../messages/" + locale + ".json"),
        }),
    },
    "./VaultManagementPanel.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_, name) => name }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert(Object.hasOwn(imports, name), name);
      return imports[name];
    },
  });
  return {
    workspace,
    calls,
    render() {
      cursor = 0;
      nodes = [];
      const html = renderToStaticMarkup(React.createElement(module.exports.default, { workspace }));
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      return html;
    },
    button(text) {
      const matches = nodes.filter(
        (node) => node.type === "button" && node.props.children === text,
      );
      assert.equal(matches.length, 1, text);
      return matches[0].props;
    },
    checkbox() {
      return nodes.find((node) => node.type === "input" && node.props.type === "checkbox")?.props;
    },
  };
}
const review = {
  rootKeyId: "PUBLIC_ROOT_FINGERPRINT",
  lifecycleVersion: 1,
  archiveDigest: "a".repeat(64),
};
const pending = {
  operationId: "synthetic_original_deletion_0001",
  outcome: "unresolved",
  canWithdraw: true,
  withdrawalPending: false,
};

test("merely rendering or reviewing deletion never signs, submits, exports or prompts for a Passkey", () => {
  for (const [locale, label] of [
    ["en", "Review cloud key archive removal"],
    ["zh", "审阅移除云端密钥包"],
  ]) {
    const h = harness({}, locale);
    const html = h.render();
    assert.deepEqual(h.calls, []);
    assert(!html.includes("rootPrivateJwk"));
    h.button(label).onClick();
    assert.deepEqual(h.calls, [["reviewArchiveDeletion"]]);
  }
});
test("explicit backup acknowledgement gates final deletion and cancel keeps the cloud archive", () => {
  const h = harness({ archiveDeletionReview: review });
  h.render();
  assert.equal(h.button("Confirm and remove cloud key archive").disabled, true);
  h.checkbox().onChange({ currentTarget: { checked: true } });
  h.render();
  assert.equal(h.button("Confirm and remove cloud key archive").disabled, false);
  h.button("Confirm and remove cloud key archive").onClick();
  assert.deepEqual(h.calls, [["confirmArchiveDeletion", true]]);
  const cancel = harness({ archiveDeletionReview: review });
  cancel.render();
  cancel.button("Keep cloud key archive").onClick();
  assert.deepEqual(cancel.calls, [["cancelArchiveDeletionReview"]]);
});
test("revised review, account switch and in-flight operations invalidate old acknowledgements and callbacks", () => {
  const h = harness({ archiveDeletionReview: review });
  h.render();
  h.checkbox().onChange({ currentTarget: { checked: true } });
  h.render();
  const stale = h.button("Confirm and remove cloud key archive").onClick;
  h.workspace.owner = "synthetic_owner_B";
  h.workspace.vaultGeneration++;
  h.render();
  stale();
  assert.deepEqual(h.calls, []);
  assert.equal(h.checkbox().checked, false);
  h.workspace.archiveDeletionReview = { ...review, archiveDigest: "b".repeat(64) };
  h.render();
  assert.equal(h.button("Confirm and remove cloud key archive").disabled, true);
  h.workspace.busy = "loading";
  h.render();
  assert.equal(h.button("Keep cloud key archive").disabled, true);
});
test("unknown requests offer read-only checks or original replay; withdrawing is a separate reviewed Passkey action", () => {
  const h = harness({ phase: "archive-pending", archiveDeletion: pending });
  h.render();
  h.button("Check again").onClick();
  h.button("Continue original removal").onClick();
  h.button("Review withdrawal").onClick();
  h.render();
  assert.deepEqual(h.calls, [["refreshArchiveDeletion"], ["resumeArchiveDeletion"]]);
  h.button("Verify original Passkey and withdraw").onClick();
  assert.deepEqual(h.calls.at(-1), ["withdrawArchiveDeletion"]);
  const other = harness({ phase: "archive-pending", archiveDeletion: pending });
  other.render();
  other.button("Review withdrawal").onClick();
  other.render();
  other.button("Verify another way and withdraw").onClick();
  assert.deepEqual(other.calls, [["withdrawArchiveDeletion", "other"]]);
});
test("retained withdrawal cannot be rendered as permission to retry deletion and deleted state points to recovery", () => {
  const h = harness({
    phase: "archive-pending",
    archiveDeletion: { ...pending, withdrawalPending: true },
  });
  const html = h.render();
  assert(html.includes("does not send the removal command again"));
  h.button("Continue original withdrawal").onClick();
  assert.deepEqual(h.calls, [["resumeArchiveDeletion"]]);
  const deleted = harness({
    phase: "archive-deleted",
    vault: { vaultId: "vault_A", archive: null },
  });
  const state = deleted.render();
  assert(state.includes("independent recovery package"));
  assert(state.includes('href="#vault-recovery-title"'));
  assert(!state.includes("Confirm and remove"));
  assert.deepEqual(deleted.calls, []);
});
test("anonymous and renewal-only states hide controls, and raw errors never reach deletion UI", () => {
  for (const changes of [{ authenticated: false }, { phase: "renewal-only" }, { vault: null }])
    assert.equal(harness(changes).render(), "");
  const h = harness({ archiveDeletionError: "PRIVATE_CANARY" });
  assert(!h.render().includes("PRIVATE_CANARY"));
});
