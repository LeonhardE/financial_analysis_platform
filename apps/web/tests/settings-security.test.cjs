const test = require("node:test");
const assert = require("node:assert/strict");
const { createTranslator } = require("next-intl");
const jsx = require("react/jsx-runtime");
const { compile } = require("./resource-library-helpers.cjs");
const translator = (namespace) =>
  createTranslator({ locale: "en", namespace, messages: require("../messages/en.json") });
const children = (root) => {
  const nodes = [];
  function visit(node, ancestors = []) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, ancestors));
    nodes.push({ ...node, ancestors });
    visit(node.props?.children, [...ancestors, node]);
  }
  visit(root);
  return nodes;
};
function disclosure(initial = {}) {
  const cells = [],
    effects = [];
  let index = 0,
    dirty = false,
    opened = 0;
  const props = {
    title: "Devices",
    children: jsx.jsx("p", { id: "private-controls", children: "Controls" }),
    onOpen: () => opened++,
    ...initial,
  };
  const changed = (a, b) => !a || b.some((v, i) => a[i] !== v);
  const react = {
    useId: () => "disclosure_id",
    useRef: (value) => {
      const i = index++;
      cells[i] ??= { current: value };
      return cells[i];
    },
    useState: (value) => {
      const i = index++;
      cells[i] ??= { value };
      return [
        cells[i].value,
        (v) => {
          dirty ||= cells[i].value !== v;
          cells[i].value = v;
        },
      ];
    },
    useEffect: (fn, deps) => {
      const i = index++;
      if (!cells[i] || changed(cells[i].deps, deps)) {
        effects.push({ i, fn });
        cells[i] = { deps };
      }
    },
  };
  const view = compile("../components/Disclosure.tsx", {
    react,
    "react/jsx-runtime": jsx,
    "./Disclosure.module.css": { default: {} },
  });
  return {
    opened: () => opened,
    render(next = {}) {
      Object.assign(props, next);
      let result;
      do {
        index = 0;
        dirty = false;
        result = view.default(props);
        for (const { fn } of effects.splice(0)) fn();
      } while (dirty);
      return children(result);
    },
  };
}
test("disclosure defers hidden controls, preserves mounted state and restores focus on Escape", () => {
  const app = disclosure();
  let nodes = app.render();
  assert.equal(
    nodes.some((n) => n.props?.id === "private-controls"),
    false,
  );
  nodes.find((n) => n.type === "button").props.onClick();
  nodes = app.render();
  assert.equal(nodes.find((n) => n.type === "button").props["aria-expanded"], true);
  assert.equal(app.opened(), 1);
  assert.ok(nodes.some((n) => n.props?.id === "private-controls"));
  let focused = 0,
    stopped = 0;
  nodes.find((n) => n.type === "button").props.ref.current = { focus: () => focused++ };
  nodes
    .find((n) => n.props?.id === "disclosure_id")
    .props.onKeyDown({ key: "Escape", stopPropagation: () => stopped++ });
  nodes = app.render();
  assert.equal(focused, 1);
  assert.equal(stopped, 1);
  assert.equal(nodes.find((n) => n.props?.id === "disclosure_id").props.inert, true);
  assert.ok(nodes.some((n) => n.props?.id === "private-controls"));
});
test("pending security work opens its section and keeps confirmation visible after completion", () => {
  const app = disclosure();
  let nodes = app.render({ forceOpen: true });
  nodes.find((n) => n.type === "button").props.onClick();
  nodes = app.render();
  assert.equal(nodes.find((n) => n.type === "button").props["aria-expanded"], true);
  nodes = app.render({ forceOpen: false });
  assert.equal(nodes.find((n) => n.type === "button").props["aria-expanded"], true);
  assert.equal(app.opened(), 1);
});
const lazy = () => null;
const security = compile("../components/SettingsSecurityPanel.tsx", {
  "react/jsx-runtime": jsx,
  "next/dynamic": { __esModule: true, default: () => lazy },
  "next-intl": { useTranslations: translator },
  "./Disclosure": { __esModule: true, default: () => null },
  "./SettingsPanel.module.css": { default: {} },
});
function workspace(patch = {}) {
  const calls = [];
  return {
    calls,
    authenticated: true,
    vaultConfigured: true,
    phase: "unlocked",
    authStatus: "authenticated",
    busy: null,
    needsDeviceApproval: false,
    error: "",
    keyManagement: null,
    lock: () => calls.push(["lock"]),
    unlock: (options) => calls.push(["unlock", options]),
    signIn: () => calls.push(["signIn"]),
    create: () => calls.push(["create"]),
    cancelOperation: () => calls.push(["cancel"]),
    refreshKeyManagement: () => calls.push(["refresh"]),
    ...patch,
  };
}
test("routine security summary delegates existing actions and reads device metadata only on demand", () => {
  const unlocked = workspace(),
    nodes = children(security.default({ workspace: unlocked }));
  assert.equal(unlocked.calls.length, 0);
  nodes.find((n) => n.type === "button").props.onClick();
  assert.deepEqual(unlocked.calls, [["lock"]]);
  const manager = nodes.find((n) => n.props?.onOpen);
  manager.props.onOpen();
  assert.deepEqual(unlocked.calls[1], ["refresh"]);
  const locked = workspace({ phase: "locked" });
  children(security.default({ workspace: locked }))
    .find((n) => n.type === "button")
    .props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(locked.calls)), [
    ["unlock", { forResults: true, enableState: true }],
  ]);
  for (const [patch, expected] of [
    [{ phase: "needs-vault" }, "create"],
    [{ authenticated: false, authStatus: "anonymous" }, "signIn"],
  ]) {
    const value = workspace(patch);
    children(security.default({ workspace: value }))
      .find((n) => n.type === "button")
      .props.onClick();
    assert.equal(value.calls[0][0], expected);
  }
});
test("security summary keeps pending approvals and recovery states out of ordinary unlock", () => {
  for (const patch of [
    { needsDeviceApproval: true },
    { vault: { archive: null } },
    ...["renewal-only", "archive-pending", "archive-deleted"].map((phase) => ({ phase })),
  ]) {
    const value = workspace(patch);
    const nodes = children(security.default({ workspace: value }));
    assert.equal(nodes.filter((n) => n.type === "button").length, 0);
    const sections = nodes.filter((n) => n.props?.forceOpen !== undefined);
    assert.ok(sections.some((n) => n.props.forceOpen));
    if (patch.needsDeviceApproval) assert.equal(sections[0].props.forceOpen, true);
    if (patch.vault) assert.equal(sections[1].props.forceOpen, true);
    assert.equal(value.calls.length, 0);
  }
  const unavailable = children(
    security.default({ workspace: workspace({ vaultConfigured: false }) }),
  );
  assert.equal(unavailable.find((n) => n.type === "button").props.disabled, true);
});
test("security summary can cancel passkey verification and only shows known access errors", () => {
  const value = workspace({ busy: "verifying", error: "unlock_failed" });
  const nodes = children(security.default({ workspace: value }));
  const cancel = nodes.find((n) => n.type === "button");
  assert.equal(cancel.props.children, "Cancel");
  cancel.props.onClick();
  assert.deepEqual(value.calls, [["cancel"]]);
  assert.equal(
    nodes.find((n) => n.props?.role === "alert").props.children,
    translator("vaultManagement.errors")("unlock_failed"),
  );
  const unknown = children(
    security.default({ workspace: workspace({ error: "raw_private_error" }) }),
  );
  assert.equal(unknown.filter((n) => n.props?.role === "alert").length, 0);
});
test("device, recovery and dangerous pending states retain their distinct existing controls", () => {
  const value = workspace({ deviceReview: {}, archiveChange: {}, keyRenewalFailure: {} });
  const nodes = children(security.default({ workspace: value }));
  const sections = nodes.filter((n) => n.props?.forceOpen !== undefined);
  assert.equal(sections.length, 3);
  assert.ok(sections.every((n) => n.props.forceOpen));
  assert.deepEqual(
    nodes.filter((n) => n.type === lazy).map((n) => n.props.section),
    ["devices", "recovery", "advanced"],
  );
});
const RecoveryControl = () => null,
  RenewalControl = () => null,
  DeletionControl = () => null;
const management = compile("../components/VaultManagementPanel.tsx", {
  "react/jsx-runtime": jsx,
  "next-intl": { useTranslations: translator, useLocale: () => "en" },
  "./PasskeyHelp": { PasskeyHelp: () => null },
  "./VaultRecoveryPanel": { __esModule: true, default: RecoveryControl },
  "./VaultKeyRenewalPanel": { __esModule: true, default: RenewalControl },
  "./VaultArchiveDeletionPanel": { __esModule: true, default: DeletionControl },
  "./VaultManagementPanel.module.css": { default: {} },
});
test("device identifiers stay in closed verification details and stale reviews remain disabled", () => {
  const value = workspace({
    vault: { vaultId: "vault_A", rootKeyId: "root_A" },
    error: "",
    keyManagement: {
      vaultId: "vault_A",
      rootKeyId: "root_A",
      canManage: true,
      registrySequence: 2,
      checkpointDigest: "checkpoint_A",
      devices: [
        {
          deviceId: "private_device_A",
          signingKeyId: "sign_A",
          encryptionKeyId: "enc_A",
          current: true,
          active: true,
          notBefore: 1000,
          expiresAt: 2000,
        },
      ],
    },
    reviewDeviceChange: (...args) => value.calls.push(args),
  });
  const nodes = children(management.default({ workspace: value, section: "devices" }));
  const identifiers = nodes.filter((n) => n.type === "code");
  assert.equal(identifiers.length, 5);
  for (const id of ["private_device_A", "sign_A", "enc_A"])
    assert.ok(identifiers.some((n) => n.props.children === id));
  for (const node of identifiers)
    assert.ok(node.ancestors.some((a) => a.type === "details" && !a.props.open));
  assert.equal(value.calls.length, 0);
  nodes
    .find(
      (n) =>
        n.type === "button" && n.props.children === translator("vaultManagement")("reviewRotate"),
    )
    .props.onClick();
  assert.deepEqual(value.calls, [["rotate", "private_device_A"]]);
  value.deviceReview = {
    deviceId: "private_device_A",
    action: "rotate",
    registrySequence: 1,
    checkpointDigest: "checkpoint_A",
  };
  const review = children(management.default({ workspace: value, section: "devices" }));
  const confirm = review.find(
    (n) =>
      n.type === "button" && n.props.children === translator("vaultManagement")("confirmRotate"),
  );
  assert.equal(confirm.props.disabled, true);
});

test("recovery and advanced sections keep all original recovery, renewal and deletion controls", () => {
  const value = workspace({ error: "" });
  const recovery = children(management.default({ workspace: value, section: "recovery" }));
  assert.ok(recovery.some((n) => n.type === RecoveryControl));
  assert.ok(!recovery.some((n) => n.type === RenewalControl || n.type === DeletionControl));
  const advanced = children(management.default({ workspace: value, section: "advanced" }));
  assert.ok(advanced.some((n) => n.type === RenewalControl));
  assert.ok(advanced.some((n) => n.type === DeletionControl));
  assert.ok(!advanced.some((n) => n.type === RecoveryControl));
  const all = children(management.default({ workspace: value }));
  for (const type of [RecoveryControl, RenewalControl, DeletionControl])
    assert.ok(all.some((n) => n.type === type));
});
