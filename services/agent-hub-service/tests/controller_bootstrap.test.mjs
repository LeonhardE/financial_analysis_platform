import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Worker, MessageChannel, MessagePort } from "node:worker_threads";
import { ForegroundController } from "../helper/releases/1.3.0/dist/controller.mjs";

globalThis.MessageChannel = MessageChannel;
globalThis.MessagePort = MessagePort;
const bytes = await readFile(new URL("../helper/releases/1.3.0/dist/worker.mjs", import.meta.url));
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
const rootJwk = { crv: "P-256", kty: "EC", x: publicKey.x, y: publicKey.y };
const card = {
  helperVersion: "1.3.0",
  workerSha256: createHash("sha256").update(bytes).digest("hex"),
  anchor: {
    ownerSubject: "a".repeat(64),
    vaultId: "vault_synthetic_bootstrap",
    rootJwk,
    rootKeyId: createHash("sha256").update(JSON.stringify(rootJwk)).digest("base64url"),
    rootEpoch: 1,
    registrySequence: 1,
    checkpointDigest: "b".repeat(64),
    connectionId: "connection_synthetic_bootstrap",
    agentPrincipalId: "agent_synthetic_bootstrap",
    taskId: "task_synthetic_bootstrap",
  },
  ttlSeconds: 3600,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stream,
    signal,
    cancelled = false;
  const workers = [];
  const controller = new ForegroundController({
    issuer: "https://synthetic-hub.example",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://synthetic-hub.example/agent/v2/helper/1.3.0/worker.mjs");
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers, undefined);
      signal = options.signal;
      return new Response(
        new ReadableStream({
          start(value) {
            stream = value;
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "text/javascript; charset=utf-8" } },
      );
    },
    createWorker(url) {
      assert.ok(url.startsWith("blob:"));
      const worker = new Worker(new URL("./helper_worker_host.mjs", import.meta.url), {
        env: { ...process.env, FOLIOVIEW_TEST_FOREGROUND_TRANSPORT: "1" },
      });
      workers.push(worker);
      return worker;
    },
  });
  t.after(async () => {
    controller.lock();
    await Promise.all(workers.map((worker) => worker.terminate()));
    t.mock.timers.reset();
  });
  return {
    controller,
    workers,
    get signal() {
      return signal;
    },
    get cancelled() {
      return cancelled;
    },
    complete(value = bytes) {
      stream.enqueue(value);
      stream.close();
    },
  };
}

test("a verified 46-second public download initializes the actual pinned Worker", async (t) => {
  const f = fixture(t),
    pending = f.controller.initialize(card);
  await tick();
  t.mock.timers.tick(46_000);
  assert.equal(f.signal.aborted, false);
  assert.equal(f.workers.length, 0, "No Worker executes before all bytes and SHA256 are checked");
  f.complete();
  const offer = await pending;
  assert.equal(offer.keyExportRejected, true);
  assert.equal(offer.anchor.connectionId, card.anchor.connectionId);
  assert.equal(f.workers.length, 1);
  assert.equal(f.controller.status().state, "READY");
  assert.equal(f.controller.status().authenticatedTransport, false);
});

test("the public download still cancels and locks exactly at sixty seconds", async (t) => {
  const f = fixture(t),
    pending = f.controller.initialize(card);
  const rejected = assert.rejects(pending, { code: "request_cancelled" });
  await tick();
  t.mock.timers.tick(59_999);
  assert.equal(f.signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(f.signal.aborted, true);
  assert.equal(f.cancelled, true);
  assert.equal(f.workers.length, 0);
  assert.equal(f.controller.status().state, "LOCKED");
  assert.throws(() => f.controller.publicOffer(), { code: "session_ended" });
});

test("explicit lock cancels a stalled public download before its deadline", async (t) => {
  const f = fixture(t),
    pending = f.controller.initialize(card);
  const rejected = assert.rejects(pending, { code: "request_cancelled" });
  await tick();
  f.controller.lock();
  await rejected;
  assert.equal(f.signal.aborted, true);
  assert.equal(f.cancelled, true);
  assert.equal(f.workers.length, 0);
});

for (const changed of ["oversized", "wrong-digest"])
  test(`a slow ${changed} public response cannot create a Worker`, async (t) => {
    const f = fixture(t),
      pending = f.controller.initialize(card);
    const rejected = assert.rejects(pending, {
      code: changed === "oversized" ? "invalid_response" : "helper_integrity_mismatch",
    });
    await tick();
    t.mock.timers.tick(46_000);
    f.complete(changed === "oversized" ? new Uint8Array(2_097_153) : new Uint8Array([1, 2, 3]));
    await rejected;
    assert.equal(f.workers.length, 0);
    assert.equal(f.controller.status().state, "LOCKED");
  });
