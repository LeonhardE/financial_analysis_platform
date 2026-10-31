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

function harness(changes = {}, locale = "en") {
  const calls = [],
    slots = [];
  let cursor = 0,
    elements = [],
    effects = [];
  const summary = {
    vaultId: "synthetic_vault_A",
    rootKeyId: "synthetic_root_A",
    registrySequence: 1,
    checkpointDigest: "a".repeat(64),
    keyEpoch: 1,
    canRenew: true,
    reason: null,
    device: {
      deviceId: "device_A",
      signingKeyId: "old_sig",
      encryptionKeyId: "old_enc",
      expiresAt: 1000,
    },
    recovery: { keyId: "old_recovery", expiresAt: 1000 },
    pending: null,
  };
  const workspace = {
    authenticated: true,
    vaultConfigured: true,
    owner: "owner_A:1",
    vaultGeneration: 1,
    vault: { vaultId: summary.vaultId, rootKeyId: summary.rootKeyId },
    phase: "locked",
    busy: null,
    error: "",
    keyNotice: "",
    keyRenewal: null,
    keyRenewalCancellation: false,
    archiveChange: null,
    deviceChange: null,
    ...Object.fromEntries(
      [
        "reviewKeyRenewal",
        "confirmKeyRenewal",
        "refreshKeyRenewal",
        "cancelKeyRenewal",
        "discardKeyRenewal",
        "lock",
      ].map((name) => [name, (...args) => calls.push([name, ...args])]),
    ),
    ...changes,
  };
  const hooks = {
    ...React,
    useState(initial) {
      const slot = cursor++;
      slots[slot] ??= { value: initial };
      return [
        slots[slot].value,
        (next) => {
          slots[slot].value = typeof next === "function" ? next(slots[slot].value) : next;
        },
      ];
    },
    useEffect(effect, dependencies) {
      const slot = cursor++;
      if (slots[slot]?.dependencies?.every((value, index) => value === dependencies[index])) return;
      slots[slot] = { dependencies };
      effects.push(effect);
    },
  };
  const jsx =
    (name) =>
    (type, props, ...rest) => {
      if (typeof type === "string") elements.push({ type, props });
      return runtime[name](type, props, ...rest);
    };
  const imports = {
    react: hooks,
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
      default: new Proxy({}, { get: (_target, key) => key }),
    },
  };
  const module = { exports: {} },
    filename = path.join(__dirname, "../components/VaultKeyRenewalPanel.tsx");
  vm.runInNewContext(
    transformSync(readFileSync(filename, "utf8"), {
      filename,
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        target: "es2022",
        transform: { react: { runtime: "automatic" } },
      },
      module: { type: "commonjs" },
    }).code,
    {
      module,
      exports: module.exports,
      Intl,
      Date,
      require: (name) => {
        assert.ok(Object.hasOwn(imports, name), name);
        return imports[name];
      },
    },
  );
  const view = () => {
    cursor = 0;
    elements = [];
    const html = renderToStaticMarkup(React.createElement(module.exports.default, { workspace }));
    const pending = effects;
    effects = [];
    pending.forEach((effect) => effect());
    return html;
  };
  const button = (label) => {
    const found = elements.filter((row) => row.type === "button" && row.props.children === label);
    assert.equal(found.length, 1, "Expected button: " + label);
    return found[0].props;
  };
  return { workspace, summary, calls, view, button };
}

test("renewal review is explicit, localized, and never generates keys or prompts on render", () => {
  for (const locale of ["en", "zh"]) {
    const f = harness({}, locale),
      html = f.view();
    assert.ok(
      html.includes(
        locale === "en" ? "Your library Passkey stays the same" : "资源库 Passkey 保持不变",
      ),
    );
    assert.ok(
      html.includes(
        locale === "en"
          ? "Agents are not automatically authorized again"
          : "不会自动重新授权 agent",
      ),
    );
    assert.deepEqual(f.calls, []);
    f.button(locale === "en" ? "Review key renewal" : "审阅密钥续期").onClick();
    assert.deepEqual(f.calls, [["reviewKeyRenewal"]]);
    f.button(
      locale === "en" ? "Review with the selected authenticator" : "使用所选验证器审阅",
    ).onClick();
    assert.deepEqual(f.calls.at(-1), ["reviewKeyRenewal", "other"]);
  }
});

test("expired-certificate review remains restricted until a separate explicit confirmation", () => {
  const f = harness({ phase: "renewal-only" });
  f.workspace.keyRenewal = f.summary;
  const html = f.view();
  assert.ok(html.includes("Ordinary library access and agent authorization remain locked"));
  assert.ok(html.includes("does not replace it"));
  assert.deepEqual(f.calls, []);
  assert.equal(f.button("Confirm and renew keys").disabled, false);
  f.button("Confirm and renew keys").onClick();
  assert.deepEqual(f.calls, [["confirmKeyRenewal"]]);
  f.workspace.keyRenewal = { ...f.summary, canRenew: false, reason: "keys_revoked" };
  assert.ok(f.view().includes("Revoked keys cannot be renewed"));
  assert.equal(f.button("Confirm and renew keys").disabled, true);
  f.button("Close review and lock").onClick();
  assert.deepEqual(f.calls.at(-1), ["lock"]);
});

test("unknown outcomes expose receipt recovery and a two-step safe cancellation", () => {
  const f = harness({ phase: "renewal-only" });
  f.workspace.keyRenewal = {
    ...f.summary,
    pending: { operationId: "renew_original", state: "ready", expiresAt: 1200 },
  };
  assert.ok(f.view().includes("Check the original receipt"));
  f.button("Check original receipt").onClick();
  assert.deepEqual(f.calls, [["refreshKeyRenewal"]]);
  f.button("Cancel the pending renewal").onClick();
  assert.equal(f.calls.length, 1);
  assert.ok(f.view().includes("competing signed archive update"));
  f.button("Keep the pending renewal").onClick();
  f.view();
  f.button("Cancel the pending renewal").onClick();
  f.view();
  f.button("Confirm cancellation").onClick();
  assert.deepEqual(f.calls.at(-1), ["cancelKeyRenewal"]);
  f.workspace.keyRenewalCancellation = true;
  assert.ok(f.view().includes("Cancellation is pending"));
  assert.equal(f.button("Retry the original renewal").disabled, true);
  f.button("Stop and lock").onClick();
  assert.deepEqual(f.calls.at(-1), ["lock"]);
});

test("applied and conflicting requests offer different safe resolution actions", () => {
  const f = harness({ phase: "renewal-only" });
  f.workspace.keyRenewal = {
    ...f.summary,
    pending: { operationId: "renew_original", state: "applied", expiresAt: 1200 },
  };
  let html = f.view();
  assert.ok(!html.includes("Cancel the pending renewal"));
  f.button("Finish accepted renewal").onClick();
  assert.deepEqual(f.calls.at(-1), ["confirmKeyRenewal"]);
  f.workspace.keyRenewal.pending.state = "conflict";
  html = f.view();
  assert.ok(!html.includes("Retry the original renewal"));
  f.button("Clear superseded candidate and lock").onClick();
  assert.deepEqual(f.calls.at(-1), ["discardKeyRenewal"]);
});

test("lock, logout, account and vault changes cannot carry the old review or cancellation consent", () => {
  const f = harness({ phase: "renewal-only" });
  f.workspace.keyRenewal = {
    ...f.summary,
    pending: { operationId: "renew_original", state: "ready", expiresAt: 1200 },
  };
  f.view();
  f.button("Cancel the pending renewal").onClick();
  f.view();
  f.workspace.owner = "owner_B:1";
  f.workspace.vaultGeneration++;
  assert.ok(!f.view().includes("competing signed archive update"));
  for (const changes of [
    { phase: "locked" },
    { authenticated: false },
    { vaultConfigured: false },
    { vault: { vaultId: "other_vault", rootKeyId: "other_root" } },
  ]) {
    const masked = harness({
      phase: "renewal-only",
      keyRenewal: f.workspace.keyRenewal,
      ...changes,
    });
    assert.ok(!masked.view().includes("renew_original"));
  }
  assert.deepEqual(f.calls, []);
});

test("renewal errors stay localized and unfamiliar codes have a visible safe fallback", () => {
  for (const locale of ["en", "zh"]) {
    const f = harness({ keyRenewalFailure: true, error: "renewal_too_early" }, locale);
    assert.ok(f.view().includes(locale === "en" ? "issued too recently" : "刚刚签发"));
    f.workspace.error = "PRIVATE_UNKNOWN_DETAIL";
    const html = f.view();
    assert.ok(html.includes(locale === "en" ? "The renewal could not finish" : "续期暂未完成"));
    assert.ok(!html.includes("PRIVATE_UNKNOWN_DETAIL"));
    f.workspace.error = "storage_unavailable";
    assert.ok(
      f
        .view()
        .includes(
          locale === "en" ? "Encrypted browser storage is unavailable" : "浏览器加密存储不可用",
        ),
    );
  }
});

test("successful renewal asks for a new independent kit while keeping the old one until replacement", () => {
  for (const locale of ["en", "zh"]) {
    const f = harness({ keyNotice: "key_renewal_saved" }, locale),
      html = f.view();
    assert.ok(
      html.includes(
        locale === "en"
          ? "immediately create an updated independent recovery kit"
          : "立即更新独立恢复包",
      ),
    );
    assert.ok(
      html.includes(locale === "en" ? "keep the old kit until" : "妥善保管新包前，请保留旧包"),
    );
    assert.deepEqual(f.calls, []);
  }
});
