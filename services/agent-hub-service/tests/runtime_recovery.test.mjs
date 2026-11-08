import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeStorage } from "../runtime/src/storage.mjs";
import { PersistentRuntime } from "../runtime/src/session.mjs";
import { recoveryDiagnostic } from "../runtime/src/recovery.mjs";
import { CONTRACT, keyId } from "../runtime/src/crypto.mjs";
import { IDBFactory } from "./fixtures/idb-runtime.mjs";
const origin = "https://synthetic-hub.example";
const actor = {
  issuer: origin,
  ownerSubject: "owner",
  vaultId: "vault",
  connectionId: "conn",
  clientId: "client",
};
test("missing restore is read-only and identifies exactly the expected namespace", async () => {
  const storage = new RuntimeStorage(new IDBFactory());
  const namespace = await storage.profileKey(actor);
  const before = await storage.transact(namespace, (value) => ({ result: value }));
  await assert.rejects(
    () => storage.profile(actor),
    (error) => {
      assert.equal(error.code, "lost_private_keys");
      assert.deepEqual(error.diagnostic, { stage: "profile_record_missing", namespace });
      return true;
    },
  );
  assert.equal(before, null);
  assert.equal(await storage.transact(namespace, (value) => ({ result: value })), null);
});
test("an invalid stored profile remains intact without projecting its values", async () => {
  const storage = new RuntimeStorage(new IDBFactory());
  const namespace = await storage.profileKey(actor);
  const original = { version: 1, actor, signingPrivateKey: "synthetic-invalid-private-key" };
  await storage.transact(namespace, () => ({ write: original }));
  await assert.rejects(
    () => storage.profile(actor),
    (error) => {
      assert.equal(error.code, "invalid_runtime_profile");
      assert.deepEqual(error.diagnostic, { stage: "profile_validation_failed", namespace });
      return true;
    },
  );
  assert.deepEqual(await storage.transact(namespace, (value) => ({ result: value })), original);
});
test("existing different public keys report mismatch, keep original nonextractable keys and stop before financial requests", async () => {
  const storage = new RuntimeStorage(new IDBFactory());
  const profile = await storage.profile(actor, { create: true });
  const { issuer, ...inputActor } = actor;
  const encryptionKeyId = await keyId(profile.encryptionPublicJwk);
  const paths = [];
  const runtime = new PersistentRuntime({
    origin,
    storage,
    monotonic: () => 0,
    fetch: async (url) => {
      paths.push(new URL(url).pathname);
      return new Response(
        JSON.stringify({
          issuer,
          contractVersion: CONTRACT,
          runtimeVersion: "1.0.0",
          serverNow: 1000,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });
  await assert.rejects(
    () =>
      runtime.initialize({
        actor: inputActor,
        rootKeyId: "A".repeat(43),
        identity: {
          contractVersion: CONTRACT,
          profile: "folioview.persistent-agent-identity.v1",
          ...inputActor,
          rootKeyId: "A".repeat(43),
          agentId: "agent",
          agentSigningKeyId: "B".repeat(43),
          agentEncryptionKeyId: encryptionKeyId,
          identityEpoch: 1,
          bindingFingerprint: "a".repeat(64),
          status: "active",
          registeredAt: 1000,
          revokedAt: null,
        },
      }),
    (error) => {
      assert.equal(error.code, "lost_private_keys");
      assert.deepEqual(error.diagnostic, {
        stage: "identity_key_mismatch",
        namespace: "profile:" + expectedNamespace,
        signingKeyMatches: false,
        encryptionKeyMatches: true,
        identityActive: true,
      });
      return true;
    },
  );
  assert.deepEqual(paths, ["/agent/v3/runtime/config"]);
  const restored = await storage.profile(actor);
  assert.deepEqual(restored.signingPublicJwk, profile.signingPublicJwk);
  assert.deepEqual(restored.encryptionPublicJwk, profile.encryptionPublicJwk);
  assert.equal(restored.signingPrivateKey.extractable, false);
});
const expectedNamespace = (await new RuntimeStorage(new IDBFactory()).profileKey(actor)).slice(8);
test("diagnostic projection drops all unlisted data and rejects arbitrary stages and namespaces", () => {
  const safe = { stage: "profile_record_missing", namespace: "profile:" + "a".repeat(64) };
  assert.deepEqual(
    recoveryDiagnostic({ ...safe, privateKey: {}, token: "secret", actor, stack: "secret" }),
    safe,
  );
  for (const value of [
    null,
    {},
    { ...safe, stage: "secret" },
    { ...safe, namespace: "secret" },
    { ...safe, stage: "identity_key_mismatch" },
  ])
    assert.equal(recoveryDiagnostic(value), null);
});
