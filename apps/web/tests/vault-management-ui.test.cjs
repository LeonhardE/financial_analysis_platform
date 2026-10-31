const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const React = require("react");
const runtime = require("react/jsx-runtime");
const { renderToStaticMarkup } = require("react-dom/server");
const { createTranslator } = require("next-intl");
const { transformSync } = require("next/dist/build/swc");

function load(name, imports) {
  const filename = path.join(__dirname, "../components", name + ".tsx");
  const { code } = transformSync(readFileSync(filename, "utf8"), {
    filename,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Intl,
    Date,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), "Unexpected management UI import " + name);
      return imports[name];
    },
  });
  return module.exports;
}

const noop = () => {};
function fixture(changes = {}) {
  const calls = [];
  const device = (deviceId, current) => ({
    deviceId,
    signingKeyId: "sig_" + deviceId,
    encryptionKeyId: "enc_" + deviceId,
    current,
    active: true,
    notBefore: Date.parse("2026-10-01T12:00:00Z") / 1000,
    expiresAt: Date.parse("2027-10-01T12:00:00Z") / 1000,
  });
  const summary = {
    vaultId: "vault_synthetic_A",
    rootKeyId: "root_synthetic_A",
    registrySequence: 3,
    checkpointDigest: "a".repeat(64),
    keyEpoch: 1,
    currentDeviceId: "device_A1",
    canManage: true,
    devices: [device("device_A1", true), device("device_A2", false)],
    recovery: {
      keyId: "recovery_key_A",
      active: true,
      notBefore: Date.parse("2026-10-01T12:00:00Z") / 1000,
      expiresAt: Date.parse("2027-10-01T12:00:00Z") / 1000,
    },
    pendingChange: null,
  };
  const workspace = {
    authenticated: true,
    authStatus: "authenticated",
    owner: "synthetic_A:1",
    vaultConfigured: true,
    configured: true,
    phase: "unlocked",
    busy: null,
    error: "",
    notice: "",
    keyNotice: "",
    vault: { vaultId: summary.vaultId, rootKeyId: summary.rootKeyId },
    vaultGeneration: 1,
    keyManagement: summary,
    deviceReview: null,
    deviceChange: null,
    needsDeviceApproval: false,
    recoveryCheck: null,
    recoveryExport: null,
    archiveChange: null,
    ...Object.fromEntries(
      [
        "signIn",
        "create",
        "unlock",
        "lock",
        "refreshKeyManagement",
        "reviewDeviceChange",
        "confirmDeviceChange",
        "discardDeviceChange",
        "confirmDeviceRegistration",
        "cancelOperation",
        "verifyRecovery",
        "exportRecoveryKit",
        "clearRecoveryExport",
        "changePasskey",
        "recoverWithKit",
        "refreshArchiveChange",
        "confirmArchiveChange",
        "cancelRecovery",
        "resumeArchiveWithNewPasskey",
        "cancelArchiveChange",
      ].map((name) => [name, (...args) => calls.push([name, ...args])]),
    ),
    ...changes,
  };
  return { workspace, calls, summary };
}

function render(f, { locale = "en", component = "panel", mode = "unlock", unlockOptions } = {}) {
  const buttons = [];
  const jsx =
    (name) =>
    (type, props, ...rest) => {
      if (type === "button") buttons.push(props);
      return runtime[name](type, props, ...rest);
    };
  const imports = {
    react: React,
    "react/jsx-runtime": { ...runtime, jsx: jsx("jsx"), jsxs: jsx("jsxs") },
    "next-intl": {
      useLocale: () => locale,
      useTranslations: (namespace) =>
        createTranslator({
          locale,
          namespace,
          messages: require("../messages/" + locale + ".json"),
        }),
    },
    "./VaultManagementPanel.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_target, name) => name }),
    },
  };
  const help = load("PasskeyHelp", imports);
  const recovery = load("VaultRecoveryPanel", imports);
  const renewal = load("VaultKeyRenewalPanel", imports);
  const panel = load("VaultManagementPanel", {
    ...imports,
    "./PasskeyHelp": help,
    "./VaultRecoveryPanel": recovery,
    "./VaultKeyRenewalPanel": renewal,
  });
  const settings = load("SettingsPanel", {
    ...imports,
    "./SettingsPanel.module.css": { __esModule: true, default: {} },
    "./VaultManagementPanel": { __esModule: true, default: panel.default },
    "@/components/PreferencesProvider": {
      usePreferences: () => ({
        preferences: { theme: "system", language: locale, defaultChartRange: "1m" },
        authenticated: false,
        loading: false,
        saving: false,
        status: "guest",
        error: null,
        updatePreferences: noop,
        retry: noop,
      }),
    },
  });
  const target =
    component === "help"
      ? help.PasskeyHelp
      : component === "settings"
        ? settings.default
        : panel.default;
  const html = renderToStaticMarkup(
    React.createElement(target, { workspace: f.workspace, mode, unlockOptions }),
  );
  return { html, buttons };
}
function button(view, label) {
  const found = view.buttons.filter((row) => row.children === label);
  assert.equal(found.length, 1, "Expected one button: " + label);
  return found[0];
}

test("Settings adds localized key management while normal preferences remain available; directory shows public fingerprints only", () => {
  for (const locale of ["en", "zh"]) {
    const f = fixture();
    f.workspace.keyManagement.privateKey = "PRIVATE_SECRET_NOT_FOR_DOM";
    const view = render(f, { component: "settings", locale });
    assert.ok(view.html.includes(locale === "en" ? "Appearance" : "外观"));
    assert.ok(
      view.html.includes(locale === "en" ? "Library keys and devices" : "资源库密钥与设备"),
    );
    assert.ok(view.html.includes("sig_device_A1") && view.html.includes("enc_device_A2"));
    assert.ok(!view.html.includes("PRIVATE_SECRET_NOT_FOR_DOM"));
    assert.equal(f.calls.length, 0, "Rendering never prompts, fetches, signs or changes access");
  }
});

test("locked, logged-out, unavailable and mismatched-vault views mask device/recovery details", () => {
  for (const changes of [
    { phase: "locked" },
    { owner: null, authenticated: false, authStatus: "anonymous" },
    { vaultConfigured: false },
    { vault: { vaultId: "vault_B", rootKeyId: "root_B" } },
    { phase: "needs-device", needsDeviceApproval: true },
  ]) {
    const f = fixture(changes);
    f.workspace.recoveryCheck = {
      rootKeyId: "root_synthetic_A",
      registrySequence: 3,
      checkedAt: "2026-10-30T12:00:00Z",
    };
    const { html } = render(f);
    assert.ok(!html.includes("sig_device_A1") && !html.includes("enc_device_A2"));
    assert.ok(!html.includes("decrypted this archive successfully at"));
    assert.ok(!html.includes("recovery_key_A"));
    assert.equal(f.calls.length, 0);
  }
});

test("current-device rotation and other-device revocation begin with public review, never a direct write", () => {
  const f = fixture(),
    view = render(f);
  button(view, "Review replacement of these keys").onClick();
  button(view, "Review revoking this device").onClick();
  assert.deepEqual(f.calls, [
    ["reviewDeviceChange", "rotate", "device_A1"],
    ["reviewDeviceChange", "revoke", "device_A2"],
  ]);
  assert.ok(!view.html.includes("Confirm device revocation"));
  assert.ok(!view.html.includes("Confirm key replacement"));
  const readonly = fixture();
  readonly.workspace.keyManagement.canManage = false;
  const readOnlyView = render(readonly);
  assert.equal(button(readOnlyView, "Review revoking this device").disabled, true);
  button(readOnlyView, "Review write access for this browser").onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(readonly.calls)), [
    ["unlock", { forResults: true, enableState: true }],
  ]);
});

test("an exact current-directory review explains retained Passkey and agent-grant impact before explicit confirm or cancel", () => {
  const f = fixture();
  f.workspace.deviceReview = {
    action: "revoke",
    deviceId: "device_A2",
    registrySequence: 3,
    checkpointDigest: "a".repeat(64),
  };
  let view = render(f);
  assert.ok(view.html.includes("does not revoke the Passkey or root authority"));
  assert.ok(view.html.includes("may stop future report writes"));
  assert.ok(view.html.includes("enc_device_A2"));
  assert.equal(button(view, "Confirm device revocation").disabled, false);
  button(view, "Cancel review").onClick();
  assert.deepEqual(f.calls, [["discardDeviceChange"]]);
  button(view, "Confirm device revocation").onClick();
  assert.deepEqual(f.calls.at(-1), ["confirmDeviceChange"]);
  f.workspace.keyManagement.registrySequence = 4;
  view = render(f);
  assert.equal(button(view, "Confirm device revocation").disabled, true);
  assert.ok(view.html.includes("directory changed"));
});

test("uncertain signed packets expose only exact replay/check, applied packets recover, and only a proven conflict can be discarded", () => {
  const f = fixture();
  f.workspace.deviceChange = {
    operationId: "operation_original_synthetic",
    privateKey: "PRIVATE_PACKET_KEY",
  };
  for (const state of ["ready", "applied", "conflict"]) {
    f.workspace.keyManagement.pendingChange = {
      operationId: "operation_original_synthetic",
      action: "rotate",
      deviceId: "device_A1",
      newDeviceId: "device_new",
      state,
    };
    const view = render(f);
    assert.ok(!view.html.includes("PRIVATE_PACKET_KEY"));
    assert.ok(view.html.includes("operation_original_synthetic"));
    if (state === "conflict") {
      assert.ok(!view.html.includes("Retry the original operation"));
      button(view, "Discard the unsubmitted candidate").onClick();
      assert.deepEqual(f.calls.at(-1), ["discardDeviceChange"]);
    } else {
      assert.ok(!view.html.includes("Discard the unsubmitted candidate"));
      button(
        view,
        state === "ready" ? "Retry the original operation" : "Recover the confirmed operation",
      ).onClick();
      assert.deepEqual(f.calls.at(-1), ["confirmDeviceChange"]);
      f.workspace.keyManagement.canManage = false;
      const readOnly = render(f);
      assert.equal(
        button(
          readOnly,
          state === "ready" ? "Retry the original operation" : "Recover the confirmed operation",
        ).disabled,
        state === "ready",
      );
      f.workspace.keyManagement.canManage = true;
    }
  }
});

test("current library Passkey check remains distinct from the new independent recovery kit, and a stale proof is hidden", () => {
  const f = fixture();
  f.workspace.recoveryCheck = {
    rootKeyId: "root_synthetic_A",
    registrySequence: 3,
    checkedAt: "2026-10-30T12:00:00Z",
  };
  let view = render(f);
  assert.ok(view.html.includes("Independent recovery requires an encrypted recovery file"));
  assert.ok(view.html.includes("Create independent recovery kit"));
  assert.ok(view.html.includes("not proof of an independent backup"));
  assert.ok(
    view.html.includes("Recovery recipient certificate") && view.html.includes("does not renew"),
  );
  button(view, "Check the current library Passkey on this device").onClick();
  button(view, "Check the current library Passkey elsewhere").onClick();
  assert.deepEqual(f.calls, [["verifyRecovery"], ["verifyRecovery", "other"]]);
  f.workspace.recoveryCheck.registrySequence = 2;
  view = render(f);
  assert.ok(!view.html.includes("decrypted this archive successfully at"));
  f.workspace.keyManagement.recovery.active = false;
  view = render(f);
  assert.equal(button(view, "Check the current library Passkey on this device").disabled, true);
  assert.ok(view.html.includes("cannot confirm current recovery capability"));
});

test("Passkey alternatives are explicit user actions and preserve the requested read-only/write-enabled mode", () => {
  const f = fixture({ phase: "locked", keyManagement: null });
  const options = { forResults: true, enableState: true };
  const view = render(f, { component: "help", unlockOptions: options });
  assert.ok(view.html.includes("Bluetooth") && view.html.includes("not an automatic retry"));
  assert.equal(f.calls.length, 0);
  button(view, "Use the current library Passkey there").onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    ["unlock", { ...options, method: "other" }],
  ]);
  const creating = fixture({ phase: "needs-vault", keyManagement: null });
  const created = render(creating, { component: "help", mode: "create" });
  assert.ok(created.html.includes("lost") && created.html.includes("new library Passkey"));
  creating.workspace.error = "passkey_unsupported";
  assert.ok(
    render(creating, { component: "help", mode: "create" }).html.includes(
      "this page cannot delete it",
    ),
  );
  button(created, "Create with the selected authenticator").onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(creating.calls)), [["create", { method: "other" }]]);
});

test("new-device approval is explicit, ordinary unlock paths are absent, and cancel locks instead of registering", () => {
  const f = fixture({ phase: "needs-device", needsDeviceApproval: true });
  const view = render(f, { component: "help" });
  assert.ok(view.html.includes("not yet registered to write"));
  assert.ok(view.html.includes("cannot prove") && view.html.includes("root_synthetic_A"));
  assert.ok(!view.html.includes("Use the current library Passkey there"));
  assert.equal(f.calls.length, 0);
  button(view, "Cancel and lock").onClick();
  assert.deepEqual(f.calls, [["lock"]]);
  button(view, "Approve this browser").onClick();
  assert.deepEqual(f.calls.at(-1), ["confirmDeviceRegistration"]);
});

test("pending Passkey operations may be canceled; raw errors are reduced to localized safe messages", () => {
  const f = fixture({ phase: "locked", busy: "unlocking", error: "PRIVATE_UNTRUSTED_DIAGNOSTIC" });
  const view = render(f);
  button(view, "Cancel this operation").onClick();
  assert.deepEqual(f.calls, [["cancelOperation"]]);
  assert.ok(!view.html.includes("PRIVATE_UNTRUSTED_DIAGNOSTIC"));
  assert.ok(view.html.includes("could not be verified"));
});
