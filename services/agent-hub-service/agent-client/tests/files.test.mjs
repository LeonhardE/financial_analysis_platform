import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, lstat, readdir, rename, writeFile, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { HostStorage, AgentClient, prepare } from "../dist/index.mjs";
const origin = "https://synthetic-hub.example",
  actor = {
    ownerSubject: "a".repeat(64),
    vaultId: "synthetic_vault",
    connectionId: "synthetic_connection",
    clientId: "synthetic_client",
  };
const bootstrap = {
  issuer: origin,
  provider: "muse",
  actor,
  ownerUrl: "https://owner.example/agents",
  setup: {
    ...actor,
    setupIntentId: "setup_synthetic_private_host_0001",
    authorizationId: "synthetic_authorization",
    issuedAt: 1000,
    expiresAt: 1600,
    expectedGeneration: 0,
    expectedCredentialFingerprint: null,
    offer: null,
    consumedBy: null,
  },
};
async function fixture(t) {
  const temp = await mkdtemp(tmpdir() + "/folioview-host-");
  t.after(() => rm(temp, { recursive: true, force: true }));
  const storage = new HostStorage({
    directory: temp + "/private",
    origin,
    actor,
    provider: "muse",
  });
  return { temp, storage, path: () => storage.folder().then((x) => x + "/credentials.sqlite") };
}
function client(storage) {
  return new AgentClient({
    origin,
    storage,
    clock: () => 1000,
    fetch: () => {
      throw Error("must not fetch without active credentials");
    },
  });
}
test("missing credentials stop load-only without creating a replacement", async (t) => {
  const { storage } = await fixture(t);
  await assert.rejects(
    () => client(storage).initialize(),
    (e) => e.code === "reauthorization_required",
  );
  assert.deepEqual(await readdir(await storage.folder()), []);
});
test("explicit preparation is private, immutable on retry and never exposes keys or paths", async (t) => {
  const { storage, path } = await fixture(t);
  const first = await prepare(storage, bootstrap, { clock: () => 1000 });
  assert.deepEqual(await prepare(storage, bootstrap, { clock: () => 1000 }), first);
  assert.equal((await lstat(await storage.folder())).mode & 0o777, 0o700);
  assert.equal((await lstat(await path())).mode & 0o777, 0o600);
  const db = new DatabaseSync(await path());
  const value = JSON.parse(db.prepare("SELECT value FROM state").get().value);
  db.close();
  assert.equal(value.active, null);
  assert.equal(typeof value.pending.profile.signingPrivateJwk.d, "string");
  assert.equal(JSON.stringify(first).includes(value.pending.profile.signingPrivateJwk.d), false);
  assert.equal(JSON.stringify(first).includes(await storage.folder()), false);
  await assert.rejects(
    () => client(storage).initialize(),
    (e) => e.code === "reauthorization_required",
  );
});
test("loss/corruption stop ordinary work; only explicit authorization prepares fresh pending keys", async (t) => {
  const { storage, path } = await fixture(t);
  await prepare(storage, bootstrap, { clock: () => 1000 });
  const filename = await path();
  await rename(filename, filename + ".synthetic-lost");
  await assert.rejects(() => client(storage).initialize());
  assert.equal((await readdir(await storage.folder())).includes("credentials.sqlite"), false);
  await prepare(storage, bootstrap, { clock: () => 1000 });
  await writeFile(filename, "synthetic-corruption", { mode: 0o600 });
  await assert.rejects(() => client(storage).initialize());
  const next = await prepare(
    storage,
    {
      ...bootstrap,
      setup: { ...bootstrap.setup, setupIntentId: "setup_synthetic_private_host_0002" },
    },
    { clock: () => 1000 },
  );
  assert.equal(next.setupIntentId, "setup_synthetic_private_host_0002");
  await assert.rejects(
    () => client(storage).initialize(),
    (e) => e.code === "reauthorization_required",
  );
});
test("permissive files, symlinks, wrong origin and expired intents fail closed", async (t) => {
  const { storage, path } = await fixture(t);
  await prepare(storage, bootstrap, { clock: () => 1000 });
  const filename = await path();
  await chmod(filename, 0o644);
  await assert.rejects(() => client(storage).initialize());
  await chmod(filename, 0o600);
  await rename(filename, filename + ".original");
  await symlink(filename + ".original", filename);
  await assert.rejects(() => prepare(storage, bootstrap, { clock: () => 1000 }));
  await assert.rejects(() =>
    prepare(storage, { ...bootstrap, issuer: "https://wrong.example" }, { clock: () => 1000 }),
  );
  await assert.rejects(() => prepare(storage, bootstrap, { clock: () => 1600 }));
});
