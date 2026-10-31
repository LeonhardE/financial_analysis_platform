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

const code = "R".repeat(43);
const encryptedFile = '{"profile":"synthetic-encrypted-kit","ciphertext":"SYNTHETIC_CIPHER"}';

function harness(changes = {}, locale = "en") {
  const calls = [],
    slots = [],
    downloaded = [],
    urls = [];
  let cursor = 0,
    elements = [],
    effects = [];
  const workspace = {
    authenticated: true,
    vaultConfigured: true,
    vault: { vaultId: "vault_A", rootKeyId: "root_A" },
    owner: "synthetic_owner_A",
    vaultGeneration: 1,
    phase: "unlocked",
    needsDeviceApproval: false,
    busy: null,
    recoveryExport: null,
    archiveChange: null,
    ...Object.fromEntries(
      [
        "exportRecoveryKit",
        "clearRecoveryExport",
        "changePasskey",
        "recoverWithKit",
        "refreshArchiveChange",
        "confirmArchiveChange",
        "cancelRecovery",
        "cancelOperation",
        "resumeArchiveWithNewPasskey",
        "cancelArchiveChange",
      ].map((name) => [name, (...args) => calls.push([name, ...args])]),
    ),
    ...changes,
  };
  const hooks = {
    ...React,
    useState(initial) {
      const slot = cursor++;
      if (!slots[slot]) slots[slot] = { value: initial };
      return [
        slots[slot].value,
        (next) => {
          slots[slot].value = typeof next === "function" ? next(slots[slot].value) : next;
        },
      ];
    },
    useRef(initial) {
      const slot = cursor++;
      if (!slots[slot]) slots[slot] = { current: initial };
      return slots[slot];
    },
    useEffect(effect, dependencies) {
      const slot = cursor++;
      if (slots[slot]?.dependencies?.every((value, index) => value === dependencies[index])) return;
      const previous = slots[slot];
      slots[slot] = { dependencies };
      effects.push(() => {
        previous?.cleanup?.();
        slots[slot].cleanup = effect();
      });
    },
  };
  const jsx =
    (method) =>
    (type, props, ...rest) => {
      if (typeof type === "string") elements.push({ type, props });
      return runtime[method](type, props, ...rest);
    };
  const imports = {
    react: hooks,
    "react/jsx-runtime": { ...runtime, jsx: jsx("jsx"), jsxs: jsx("jsxs") },
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
      default: new Proxy({}, { get: (_target, key) => key }),
    },
  };
  const module = { exports: {} };
  const filename = path.join(__dirname, "../components/VaultRecoveryPanel.tsx");
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
      Blob,
      URL: {
        createObjectURL(blob) {
          downloaded.push(blob);
          urls.push("blob:synthetic-recovery");
          return "blob:synthetic-recovery";
        },
        revokeObjectURL(url) {
          assert.equal(url, "blob:synthetic-recovery");
          urls.pop();
        },
      },
      document: {
        createElement(tag) {
          assert.equal(tag, "a");
          return { click() {}, remove() {} };
        },
        body: { appendChild() {} },
      },
      require(name) {
        assert.ok(Object.hasOwn(imports, name), "Unexpected recovery UI import: " + name);
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
    for (const effect of pending) effect();
    return html;
  };
  const button = (label) => {
    const matches = elements.filter((row) => row.type === "button" && row.props.children === label);
    assert.equal(matches.length, 1, "Expected button: " + label);
    return matches[0].props;
  };
  const input = (id) => {
    const result = elements.find((row) => row.type === "input" && row.props.id === id);
    assert.ok(result, "Expected input: " + id);
    return result.props;
  };
  const unmount = () => {
    for (const slot of slots) slot?.cleanup?.();
  };
  return { workspace, calls, downloaded, urls, view, button, input, unmount };
}

test("recovery is explicit and localized; merely rendering never prompts, exports, or changes a Passkey", () => {
  for (const locale of ["en", "zh"]) {
    const f = harness({}, locale),
      html = f.view();
    assert.ok(html.includes(locale === "en" ? "Recovery and a new Passkey" : "恢复与更换 Passkey"));
    assert.ok(
      html.includes(locale === "en" ? "does not revoke old recovery kits" : "不会使旧恢复包失效"),
    );
    assert.deepEqual(f.calls, []);
    assert.equal(f.downloaded.length, 0);
    f.button(locale === "en" ? "Create independent recovery kit" : "创建独立恢复包").onClick();
    assert.deepEqual(f.calls, [["exportRecoveryKit"]]);
    f.unmount();
  }
});

test("a recovery kit from before renewal shows a localized refusal without starting another recovery", () => {
  for (const locale of ["en", "zh"]) {
    const f = harness({ phase: "locked", error: "stale_recovery_kit" }, locale);
    const html = f.view();
    assert.ok(
      html.includes(locale === "en" ? "currently eligible recovery key" : "当前有效的恢复密钥"),
    );
    assert.ok(html.includes(locale === "en" ? "Use the latest recovery kit" : "请使用最新恢复包"));
    assert.deepEqual(f.calls, []);
    f.unmount();
  }
});

test("Passkey replacement first presents a review; phone/security-key choice stays explicit", () => {
  const f = harness();
  f.view();
  f.button("Replace library Passkey").onClick();
  assert.deepEqual(f.calls, []);
  const html = f.view();
  assert.ok(html.includes("Finish any pending local drafts") && html.includes("Bluetooth"));
  f.button("Create and verify a replacement Passkey").onClick();
  assert.deepEqual(f.calls, [["changePasskey"]]);
  f.view();
  f.button("Replace library Passkey").onClick();
  f.view();
  f.button("Create replacement on the selected authenticator").onClick();
  assert.deepEqual(f.calls.at(-1), ["changePasskey", "other"]);
  f.workspace.busy = "changing-passkey";
  f.view();
  assert.equal(f.button("Replace library Passkey").disabled, true);
  f.button("Cancel and lock library").onClick();
  assert.deepEqual(f.calls.at(-1), ["cancelOperation"]);
});

test("the downloaded kit never contains the separately displayed recovery code and releases its object URL", async () => {
  const f = harness({
    recoveryExport: {
      file: encryptedFile,
      code,
      createdAt: "2026-10-30",
      vaultId: "vault_A",
      rootKeyId: "root_A",
    },
  });
  assert.ok(f.view().includes(code));
  assert.equal(f.input("vault-recovery-export-code").readOnly, true);
  f.button("Download encrypted recovery file").onClick();
  assert.equal(f.downloaded.length, 1);
  assert.equal(await f.downloaded[0].text(), encryptedFile);
  assert.ok(!(await f.downloaded[0].text()).includes(code));
  assert.equal(f.urls.length, 0);
  f.button("Done — hide this code").onClick();
  assert.deepEqual(f.calls, [["clearRecoveryExport"]]);
  for (const changes of [
    { phase: "locked" },
    { authenticated: false },
    { vaultConfigured: false },
    { phase: "needs-device", needsDeviceApproval: true },
    { vault: { vaultId: "vault_B", rootKeyId: "root_B" } },
  ]) {
    const masked = harness({ recoveryExport: f.workspace.recoveryExport, ...changes });
    assert.ok(!masked.view().includes(code));
  }
});

test("locked recovery validates file/code locally, sends only explicit action inputs, then immediately clears the form", async () => {
  const f = harness({ phase: "locked" });
  let html = f.view();
  assert.ok(html.includes("You do not need the old Passkey"));
  assert.ok(!html.includes("Create independent recovery kit"));
  assert.equal(f.button("Recover and create a new Passkey").disabled, true);
  const selection = {
    currentTarget: {
      value: "selected",
      files: [
        { size: encryptedFile.length, name: "synthetic.json", text: async () => encryptedFile },
      ],
    },
  };
  f.input("vault-recovery-file").onChange(selection);
  await new Promise(setImmediate);
  assert.equal(selection.currentTarget.value, "");
  f.view();
  f.input("vault-recovery-code").onChange({ currentTarget: { value: "incorrect" } });
  f.view();
  assert.equal(f.button("Recover and create a new Passkey").disabled, true);
  f.input("vault-recovery-code").onChange({ currentTarget: { value: code } });
  f.view();
  assert.equal(f.button("Recover and create a new Passkey").disabled, false);
  f.button("Recover and create a new Passkey").onClick();
  assert.deepEqual(f.calls, [["recoverWithKit", encryptedFile, code, "local"]]);
  html = f.view();
  assert.equal(f.input("vault-recovery-code").value, "");
  assert.ok(!html.includes("synthetic.json") && !html.includes(code));
});

test("recovery file reads, codes and reviews cannot cross account/session boundaries or revive after unmount", async () => {
  const f = harness({ phase: "locked" });
  f.view();
  let finishRead;
  f.input("vault-recovery-file").onChange({
    currentTarget: {
      value: "x",
      files: [
        {
          size: 128,
          name: "STALE_FILE_A.json",
          text: () =>
            new Promise((resolve) => {
              finishRead = resolve;
            }),
        },
      ],
    },
  });
  f.input("vault-recovery-code").onChange({ currentTarget: { value: code } });
  Object.assign(f.workspace, {
    owner: "synthetic_owner_B",
    vault: { vaultId: "vault_B", rootKeyId: "root_B" },
    vaultGeneration: 2,
  });
  let html = f.view();
  assert.ok(!html.includes(code));
  finishRead(encryptedFile);
  await new Promise(setImmediate);
  html = f.view();
  assert.ok(!html.includes("STALE_FILE_A"));
  assert.equal(f.input("vault-recovery-code").value, "");
  assert.equal(f.button("Recover and create a new Passkey").disabled, true);
  assert.deepEqual(f.calls, []);
  f.unmount();
});

test("oversized files are rejected without reading them, and clear only clears local recovery inputs", () => {
  const f = harness({ phase: "locked" });
  f.view();
  f.input("vault-recovery-file").onChange({
    currentTarget: {
      value: "x",
      files: [
        {
          size: 128 * 1024 + 1,
          text() {
            throw new Error("must not read");
          },
        },
      ],
    },
  });
  assert.ok(f.view().includes("smaller than 128 KiB"));
  f.button("Clear recovery inputs").onClick();
  assert.deepEqual(f.calls, [["cancelRecovery"]]);
});

test("uncertain archive changes expose check/original replay only, while locked or conflicting states cannot submit a new candidate", () => {
  const f = harness({
    archiveChange: {
      operationId: "synthetic-original-op",
      mode: "passkey_change",
      state: "ready",
      privateKey: "PRIVATE_CANDIDATE",
    },
  });
  let html = f.view();
  assert.ok(html.includes("synthetic-original-op") && !html.includes("PRIVATE_CANDIDATE"));
  assert.ok(!html.includes("Replace library Passkey") && !html.includes("Use your recovery kit"));
  f.button("Check archive update").onClick();
  f.button("Retry original archive update").onClick();
  assert.deepEqual(f.calls, [["refreshArchiveChange"], ["confirmArchiveChange"]]);
  f.workspace.phase = "locked";
  f.view();
  assert.equal(f.button("Retry original archive update").disabled, false);
  f.button("Resume with the new Passkey").onClick();
  assert.deepEqual(f.calls.at(-1), ["resumeArchiveWithNewPasskey"]);
  f.workspace.phase = "unlocked";
  f.workspace.archiveChange.state = "applied";
  f.view();
  f.button("Finish confirmed archive update").onClick();
  assert.deepEqual(f.calls.at(-1), ["confirmArchiveChange"]);
  f.workspace.archiveChange.state = "conflict";
  html = f.view();
  assert.ok(html.includes("A newer verified archive conflicts"));
  assert.ok(!html.includes("Retry original archive update") && !html.includes("Discard"));
  const before = f.calls.length;
  f.button("Cancel unfinished change safely").onClick();
  assert.equal(f.calls.length, before, "Reviewing cancellation cannot discard or write");
  html = f.view();
  assert.ok(html.includes("the encrypted candidate is kept"));
  f.button("Confirm safe cancellation").onClick();
  assert.deepEqual(f.calls.at(-1), ["cancelArchiveChange"]);
});
