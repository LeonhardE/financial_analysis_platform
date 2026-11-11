import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  Registry,
  keyId,
  bytes,
  parsed,
  approveCredential,
  credentialStatus,
  requireCurrentCredential,
  DEFAULT_CREDENTIAL_SECONDS,
  CREDENTIAL_NOTICE_SECONDS,
} from "../dist/core.mjs";
const v = JSON.parse(
  await readFile(
    new URL("../../../services/common/tests/fixtures/agent_credentials.json", import.meta.url),
    "utf8",
  ),
);
async function setup() {
  const a = v.anchor;
  const cp = parsed(bytes(v.registryBundle.checkpoint.payload), true);
  const registry = await new Registry({
    rootJwk: a.root_jwk,
    rootKeyId: await keyId(a.root_jwk),
    ownerSubject: a.owner_subject,
    vaultId: a.vault_id,
    rootEpoch: 1,
    registrySequence: 1,
    checkpointDigest: v.identityBinding
      ? parsed(bytes(v.identityBinding.payload), true).checkpointDigest
      : cp.checkpointDigest,
  }).load([v.registryBundle], 1000);
  await registry.binding(v.identityBinding, v.identity, v.identity, 1000);
  return {
    registry,
    identity: v.identity,
    currentLease: null,
    setupIntentId: v.setupIntentId,
    audience: v.audience,
    now: 1000,
  };
}
test("Python and independent Node approvals share strict Owner verification", async () => {
  const args = await setup();
  for (const signed of [v.pythonApproval, v.nodeApproval]) {
    const lease = await approveCredential(signed, args);
    assert.equal(lease.generation, 1);
    assert.equal(credentialStatus(lease, 4899), "expiring");
    assert.equal(credentialStatus(lease, 4900), "expired");
    assert.throws(() => requireCurrentCredential(lease, { ...args, now: 4900 }));
    assert.throws(() =>
      requireCurrentCredential(lease, { ...args, audience: "https://evil.example.test" }),
    );
    await assert.rejects(() => approveCredential(signed, { ...args, currentLease: lease }));
  }
  assert.equal(DEFAULT_CREDENTIAL_SECONDS, 7776000);
  assert.equal(CREDENTIAL_NOTICE_SECONDS, 604800);
});
test("intent, recipient, current registry, signature and closed fields are mandatory", async () => {
  const args = await setup();
  for (const changes of [
    { setupIntentId: "other_intent_operation_0001" },
    { audience: "https://evil.example.test" },
    { now: 4900 },
    { identity: { ...v.identity, clientId: "other_client" } },
  ])
    await assert.rejects(() => approveCredential(v.pythonApproval, { ...args, ...changes }));
  await assert.rejects(() =>
    approveCredential({ ...v.pythonApproval, signature: "A".repeat(86) }, args),
  );
});
