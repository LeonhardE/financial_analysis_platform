const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");

const encoded = (value) => Buffer.from(value).toString("base64url");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { resolve, promise };
};
function compile(name, imports = {}, globals = {}) {
  const file = path.join(__dirname, "../lib/" + name + ".ts");
  const { code } = transformSync(readFileSync(file, "utf8"), {
    filename: file,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), name);
      return imports[name];
    },
    ...globals,
  });
  return module.exports;
}
const types = compile("encrypted-types");
const rawId = Uint8Array.from({ length: 32 }, (_value, i) => i + 1).buffer;
const archive = () => ({ credentialId: encoded(rawId), prfSalt: encoded(new Uint8Array(32)) });
const secret = (n = 17, length = 32) => new Uint8Array(length).fill(n).buffer;
function credential({
  id = rawId,
  first = secret(),
  second,
  uv = true,
  enabled = true,
  type = "public-key",
} = {}) {
  const auth = () => {
    const data = new Uint8Array(37);
    data[32] = uv ? 4 : 0;
    return data.buffer;
  };
  return {
    type,
    rawId: id,
    response: { authenticatorData: auth(), getAuthenticatorData: auth },
    getClientExtensionResults: () => ({ prf: { enabled, results: { first, second } } }),
    toJSON() {
      throw new Error("Credential serialization is forbidden");
    },
  };
}
function harness({
  secureContext = true,
  credentialApi = true,
  publicKey = true,
  platform,
  capabilities,
} = {}) {
  const calls = [],
    timers = new Map();
  let serial = 0;
  const native = { create: async () => credential(), get: async () => credential() };
  class PublicKey {}
  if (platform) PublicKey.isUserVerifyingPlatformAuthenticatorAvailable = platform;
  if (capabilities) PublicKey.getClientCapabilities = capabilities;
  const module = compile(
    "encrypted-passkey",
    { "./encrypted-types": types },
    {
      window: { isSecureContext: secureContext },
      navigator: credentialApi
        ? {
            credentials: Object.fromEntries(
              ["create", "get"].map((op) => [
                op,
                async (options) => {
                  calls.push({ op, options });
                  return native[op](options);
                },
              ]),
            ),
          }
        : {},
      PublicKeyCredential: publicKey ? PublicKey : undefined,
      ArrayBuffer,
      Uint8Array,
      TextEncoder,
      crypto,
      btoa,
      atob,
      setTimeout(callback, delay) {
        const id = ++serial;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
  );
  return {
    ...module,
    native,
    calls,
    timers,
    flushTimers() {
      for (const row of [...timers.values()]) row.callback();
    },
  };
}
const zero = (value) => assert.ok(new Uint8Array(value).every((n) => n === 0));

test("replacement keeps the old credential intact and verifies the exact new credential with the same PRF", async () => {
  const h = harness(),
    id = new Uint8Array(32).fill(91).buffer;
  const created = secret(41),
    checked = secret(41);
  h.native.create = async () => credential({ id, first: created });
  h.native.get = async () => credential({ id, first: checked });
  const result = await h.replaceVaultPasskey("synthetic_owner_A", archive());
  assert.equal(h.calls.length, 2);
  const creation = h.calls[0].options.publicKey;
  assert.notDeepEqual(
    Buffer.from(creation.user.id),
    Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("synthetic_owner_A")),
    ),
  );
  assert.equal(creation.excludeCredentials, undefined);
  assert.equal(creation.authenticatorSelection.authenticatorAttachment, "platform");
  assert.deepEqual(
    Buffer.from(h.calls[1].options.publicKey.allowCredentials[0].id),
    Buffer.from(id),
  );
  assert.equal(result.credentialId, encoded(id));
  assert.ok(new Uint8Array(result.secret).every((n) => n === 41));
  zero(created);
  zero(checked);
});

test("replacement rejects reused credentials, inconsistent PRF and cancelled confirmation without retaining native secrets", async () => {
  const same = harness(),
    first = secret();
  same.native.create = async () => credential({ first });
  await assert.rejects(same.replaceVaultPasskey("owner", archive()), { code: "invalid_operation" });
  zero(first);
  assert.equal(same.calls.length, 1);
  const h = harness(),
    id = new Uint8Array(32).fill(88).buffer;
  const created = secret(1),
    checked = secret(2);
  h.native.create = async () => credential({ id, first: created });
  h.native.get = async () => credential({ id, first: checked });
  await assert.rejects(h.replaceVaultPasskey("owner", archive()), { code: "unlock_failed" });
  zero(created);
  zero(checked);
  const cancelled = harness(),
    material = secret(3);
  cancelled.native.create = async () => credential({ id, first: material });
  cancelled.native.get = async () => null;
  await assert.rejects(cancelled.replaceVaultPasskey("owner", archive()), {
    code: "passkey_cancelled",
  });
  zero(material);
});

test("creation defaults to local platform UV/PRF without exporting the credential or retaining the native PRF buffers", async () => {
  const h = harness(),
    first = secret(),
    second = secret(22);
  h.native.create = async () => credential({ first, second });
  const made = await h.createVaultPasskey("synthetic_owner_A");
  assert.equal(h.calls.length, 1);
  const options = h.calls[0].options.publicKey;
  assert.equal(options.authenticatorSelection.authenticatorAttachment, "platform");
  assert.equal(options.authenticatorSelection.userVerification, "required");
  assert.equal(options.authenticatorSelection.residentKey, "required");
  assert.equal(options.hints.join(","), "client-device");
  assert.equal(options.attestation, "none");
  assert.equal(options.user.name, "FolioView account");
  assert.equal(options.user.displayName, "FolioView encrypted resources");
  const domain = new TextEncoder().encode("FolioView/device-keystore/v1");
  assert.deepEqual(options.extensions.prf.eval.first.slice(0, domain.length), domain);
  assert.equal(options.extensions.prf.eval.first[domain.length], 0);
  assert.equal(options.extensions.prf.eval.first.length, domain.length + 33);
  assert.equal(made.credentialId, encoded(rawId));
  assert.equal(made.prfSalt.length, 43);
  assert.ok(new Uint8Array(made.secret).every((n) => n === 17));
  assert.notEqual(made.secret, first);
  zero(first);
  zero(second);
});

test("an explicit other-device choice is a single operation, while unlock always retains the exact credential allowlist", async () => {
  const h = harness(),
    controller = new AbortController();
  await h.createVaultPasskey("synthetic_owner_A", { method: "other", signal: controller.signal });
  assert.equal(h.calls.length, 1);
  assert.equal(
    h.calls[0].options.publicKey.authenticatorSelection.authenticatorAttachment,
    "cross-platform",
  );
  assert.equal(h.calls[0].options.publicKey.hints.join(","), "hybrid,security-key");
  assert.equal(h.calls[0].options.signal, controller.signal);
  const first = secret(33);
  h.native.get = async () => credential({ first });
  const opened = await h.unlockVaultPasskey(archive(), {
    method: "other",
    signal: controller.signal,
  });
  const options = h.calls[1].options;
  assert.equal(options.signal, controller.signal);
  assert.equal(options.publicKey.hints.join(","), "hybrid,security-key");
  assert.equal(options.publicKey.userVerification, "required");
  assert.equal(options.publicKey.allowCredentials.length, 1);
  assert.deepEqual(options.publicKey.allowCredentials[0].id, new Uint8Array(rawId));
  assert.equal(options.publicKey.allowCredentials[0].transports, undefined);
  assert.equal(options.publicKey.authenticatorAttachment, undefined);
  assert.ok(new Uint8Array(opened.secret).every((n) => n === 33));
  zero(first);
});

test("capability inspection is public hint data, never a credential prompt or proof of a usable PRF credential", async () => {
  const h = harness({
    platform: async () => true,
    capabilities: async () => ({ "extension:prf": true, hybridTransport: true }),
  });
  const support = await h.inspectVaultPasskeySupport();
  assert.deepEqual(JSON.parse(JSON.stringify(support)), {
    secureContext: true,
    credentialApi: true,
    platform: "available",
    prf: "advertised",
  });
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
  const absent = harness({
    platform: async () => false,
    capabilities: async () => ({ "extension:prf": false }),
  });
  assert.equal((await absent.inspectVaultPasskeySupport()).prf, "not_advertised");
  assert.equal((await absent.inspectVaultPasskeySupport()).platform, "unavailable");
  const unknown = harness({
    platform: async () => {
      throw new Error("unavailable capability");
    },
    capabilities: async () => ({ prf: true }),
  });
  const result = await unknown.inspectVaultPasskeySupport();
  assert.equal(result.platform, "unknown");
  assert.equal(result.prf, "unknown");
  assert.equal(unknown.calls.length, 0);
});

test("unresolved capability probes time out as unknown, and cancellation leaves no timers or late state update", async () => {
  const platform = deferred(),
    capabilities = deferred();
  const h = harness({ platform: () => platform.promise, capabilities: () => capabilities.promise });
  const pending = h.inspectVaultPasskeySupport();
  await tick();
  assert.equal(h.timers.size, 2);
  assert.ok([...h.timers.values()].every((row) => row.delay <= 1500));
  h.flushTimers();
  const result = await pending;
  assert.equal(result.platform, "unknown");
  assert.equal(result.prf, "unknown");
  platform.resolve(true);
  capabilities.resolve({ "extension:prf": true });
  await tick();
  assert.equal(result.prf, "unknown");
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.length, 0);
  const wait = deferred(),
    controller = new AbortController();
  const canceled = harness({ platform: () => wait.promise });
  const probe = canceled.inspectVaultPasskeySupport({ signal: controller.signal });
  const rejected = assert.rejects(probe, { code: "passkey_cancelled" });
  await tick();
  controller.abort();
  await rejected;
  wait.resolve(true);
  await tick();
  assert.equal(canceled.timers.size, 0);
  assert.equal(canceled.calls.length, 0);
});

test("insecure or missing credential APIs fail closed without a native request or capability chooser", async () => {
  for (const options of [
    { secureContext: false },
    { credentialApi: false },
    { publicKey: false },
  ]) {
    const h = harness(options);
    await assert.rejects(h.createVaultPasskey("synthetic_owner_A"), {
      code: "passkey_unsupported",
    });
    await assert.rejects(h.unlockVaultPasskey(archive()), { code: "passkey_unsupported" });
    const support = await h.inspectVaultPasskeySupport();
    assert.equal(support.platform, "unknown");
    assert.equal(support.prf, "unknown");
    assert.equal(h.calls.length, 0);
  }
});

test("already canceled operations and unknown method values never reach native credential creation or retrieval", async () => {
  const h = harness(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(h.createVaultPasskey("synthetic_owner_A", { signal: controller.signal }), {
    code: "passkey_cancelled",
  });
  await assert.rejects(h.unlockVaultPasskey(archive(), { signal: controller.signal }), {
    code: "passkey_cancelled",
  });
  await assert.rejects(h.inspectVaultPasskeySupport({ signal: controller.signal }), {
    code: "passkey_cancelled",
  });
  await assert.rejects(h.createVaultPasskey("synthetic_owner_A", { method: "automatic" }), {
    code: "invalid_data",
  });
  await assert.rejects(h.unlockVaultPasskey(archive(), { method: "automatic" }), {
    code: "invalid_data",
  });
  assert.equal(h.calls.length, 0);
});

test("a browser ignoring create abort cannot publish a late PRF result or fall back to another prompt", async () => {
  const h = harness(),
    answer = deferred(),
    controller = new AbortController();
  h.native.create = () => answer.promise;
  const pending = h.createVaultPasskey("synthetic_owner_A", { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "passkey_cancelled" });
  await tick();
  assert.equal(h.calls.length, 1);
  controller.abort();
  await rejected;
  const first = secret(),
    second = secret(44);
  answer.resolve(credential({ first, second }));
  await tick();
  zero(first);
  zero(second);
  assert.equal(h.calls.length, 1);
});

test("a browser ignoring assertion abort cannot publish or retain a late decryption result", async () => {
  const h = harness(),
    answer = deferred(),
    controller = new AbortController();
  h.native.get = () => answer.promise;
  const pending = h.unlockVaultPasskey(archive(), { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "passkey_cancelled" });
  await tick();
  controller.abort();
  await rejected;
  const first = secret(71),
    second = secret(72);
  answer.resolve(credential({ first, second }));
  await tick();
  zero(first);
  zero(second);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.signal, controller.signal);
});

test("wrong credentials, missing user verification and unsupported assertion PRF values never yield material", async () => {
  for (const change of [
    { id: secret(2) },
    { uv: false },
    { type: "password" },
    { enabled: false },
  ]) {
    const h = harness(),
      first = secret();
    h.native.get = async () => credential({ first, ...change });
    await assert.rejects(h.unlockVaultPasskey(archive()), {
      code: change.enabled === false ? "passkey_unsupported" : "unlock_failed",
    });
    zero(first);
    assert.equal(h.calls.length, 1);
  }
  for (const first of [secret(3, 31), undefined]) {
    const h = harness();
    h.native.get = async () => ({
      ...credential(),
      getClientExtensionResults: () => ({ prf: { results: { first } } }),
    });
    await assert.rejects(h.unlockVaultPasskey(archive()), { code: "passkey_unsupported" });
    if (first) zero(first);
    assert.equal(h.calls.length, 1);
  }
});

test("unsupported or malformed creation PRF and native cancellation never auto-create or switch authenticators", async () => {
  for (const change of [{ enabled: false }, { first: secret(6, 31) }]) {
    const h = harness(),
      first = change.first ?? secret();
    h.native.create = async () => credential({ first, ...change });
    await assert.rejects(h.createVaultPasskey("synthetic_owner_A"), {
      code: "passkey_unsupported",
    });
    zero(first);
    assert.equal(h.calls.length, 1);
  }
  for (const name of ["AbortError", "NotAllowedError", "NotSupportedError"]) {
    const h = harness();
    h.native.create = async () => {
      throw new DOMException("synthetic native outcome", name);
    };
    await assert.rejects(h.createVaultPasskey("synthetic_owner_A"), {
      code: name === "NotSupportedError" ? "passkey_unsupported" : "passkey_cancelled",
    });
    assert.equal(h.calls.length, 1);
  }
  for (const op of ["create", "get"]) {
    const h = harness();
    h.native[op] = async () => null;
    await assert.rejects(
      op === "create" ? h.createVaultPasskey("synthetic_owner_A") : h.unlockVaultPasskey(archive()),
      { code: "passkey_cancelled" },
    );
    assert.equal(h.calls.length, 1);
  }
});

test("creation that only advertises PRF finishes with one exact-credential UV assertion, not another key or device", async () => {
  const h = harness(),
    first = secret(81),
    controller = new AbortController();
  h.native.create = async () => ({
    ...credential(),
    getClientExtensionResults: () => ({ prf: { enabled: true } }),
  });
  h.native.get = async () => credential({ first });
  const made = await h.createVaultPasskey("synthetic_owner_A", {
    method: "local",
    signal: controller.signal,
  });
  assert.equal(h.calls.map((row) => row.op).join(","), "create,get");
  assert.equal(h.calls[1].options.signal, controller.signal);
  assert.equal(h.calls[1].options.publicKey.userVerification, "required");
  assert.equal(h.calls[1].options.publicKey.hints.join(","), "client-device");
  assert.deepEqual(h.calls[1].options.publicKey.allowCredentials[0].id, new Uint8Array(rawId));
  assert.equal(made.credentialId, encoded(rawId));
  assert.ok(new Uint8Array(made.secret).every((n) => n === 81));
  zero(first);
  const failed = harness();
  failed.native.create = async () => credential({ uv: false });
  failed.native.get = async () => credential({ uv: false });
  await assert.rejects(failed.createVaultPasskey("synthetic_owner_A"), { code: "unlock_failed" });
  assert.equal(failed.calls.map((row) => row.op).join(","), "create,get");
});

test("noncanonical stored credential identifiers and salts are rejected before a chooser can run", async () => {
  for (const change of [
    { credentialId: "bad\n" },
    { credentialId: "a".repeat(2049) },
    { prfSalt: encoded(new Uint8Array(31)) },
    { credentialId: null },
  ]) {
    const h = harness();
    await assert.rejects(h.unlockVaultPasskey({ ...archive(), ...change }), {
      code: "invalid_data",
    });
    assert.equal(h.calls.length, 0);
  }
});
