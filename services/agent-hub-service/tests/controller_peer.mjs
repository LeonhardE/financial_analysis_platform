// Test-only browser host. Production bundles perform real WebCrypto in an actual
// Worker; network requests cross this pipe to the real synthetic FastAPI service.
import { createInterface } from "node:readline";
import { Worker, MessagePort, MessageChannel } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ForegroundController, CiphertextOutbox } from "../helper/dist/controller.mjs";
import { IDBFactory, IDBKeyRange } from "./fixtures/idb-runtime.mjs";
globalThis.MessagePort = MessagePort;
globalThis.MessageChannel = MessageChannel;
globalThis.indexedDB = new IDBFactory();
globalThis.IDBKeyRange = IDBKeyRange;
const workerBytes = await readFile(new URL("../helper/dist/worker.mjs", import.meta.url)),
  workerSha256 = createHash("sha256").update(workerBytes).digest("hex");
const pendingHTTP = new Map(),
  workers = [],
  requests = [];
let httpCounter = 0,
  now = 1000000,
  controller,
  storage;
const fetchImpl = async (url, options = {}) => {
  if (new URL(url).pathname === "/agent/v2/helper/worker.mjs")
    return new Response(workerBytes, {
      headers: { "Content-Type": "text/javascript; charset=utf-8" },
    });
  const id = ++httpCounter,
    request = {
      type: "http",
      id,
      path: new URL(url).pathname + new URL(url).search,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body ?? null,
    };
  requests.push({ path: request.path, method: request.method, body: request.body });
  return new Promise((resolve, reject) => {
    const abort = () => {
      pendingHTTP.delete(id);
      reject(new Error("synthetic_abort"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    pendingHTTP.set(id, (reply) => {
      options.signal?.removeEventListener("abort", abort);
      if (reply.failure) {
        reject(new Error("synthetic_lost_response"));
        return;
      }
      resolve(
        new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { "Content-Type": reply.contentType ?? "application/json" },
        }),
      );
    });
    process.stdout.write(JSON.stringify(request) + "\n");
  });
};
const create = () => {
  storage = new CiphertextOutbox();
  controller = new ForegroundController({
    issuer: "https://hub.example",
    fetchImpl,
    outbox: storage,
    clock: () => now,
    createWorker() {
      const worker = new Worker(new URL("./helper_worker_host.mjs", import.meta.url));
      workers.push(worker);
      return worker;
    },
  });
};
create();
async function execute(command) {
  if (command.authRace) {
    if (command.authRace.mode === "whileRequest") {
      const reading = controller.loadPreparation();
      const refreshed = await controller.authenticate(command.authRace.token).then(
        () => "accepted",
        (error) => error.code,
      );
      const result = await reading;
      return { refreshed, loaded: result.preparationId };
    }
    const refreshed = controller.authenticate(command.authRace.token);
    const privateRead = await controller.loadPreparation().then(
      () => "accepted",
      (error) => error.code,
    );
    await refreshed;
    return { privateRead };
  }
  if (command.api) {
    const { method, args = [] } = command.api;
    if (
      ![
        "authenticate",
        "loadPreparation",
        "readPreparedObject",
        "beginRun",
        "readRunPage",
        "submitResult",
        "listOutbox",
        "recoverReceipt",
        "replay",
        "discardOutbox",
        "status",
        "publicOffer",
        "setVisible",
        "lock",
      ].includes(method)
    )
      throw new Error("test_method");
    return await controller[method](...args);
  }
  if (command.inspect) {
    const request = indexedDB.open("folioview-agent-ciphertext-outbox-v1", 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction("outbox", "readonly"),
        req = tx.objectStore("outbox").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return { rows, requests };
  }
  if (command.restart) {
    controller.lock();
    await storage.close();
    create();
    return controller.status();
  }
  if (command.now !== undefined) {
    now = command.now;
    return true;
  }
  const message = command.message;
  if (command.trusted && message.op === "initialize")
    return controller.initialize({
      helperVersion: "1.2.0",
      workerSha256,
      anchor: message.args.anchor,
      ttlSeconds: message.args.ttlSeconds,
    });
  if (command.trusted && message.op === "confirmDelivery")
    return controller.confirmDelivery(message.args);
  return controller.dispatchAgent({ op: message.op, args: message.args });
}
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    continue;
  }
  if (command.type === "httpResult") {
    const reply = pendingHTTP.get(command.id);
    pendingHTTP.delete(command.id);
    reply?.(command);
    continue;
  }
  void execute(command).then(
    (value) => process.stdout.write(JSON.stringify({ ok: true, value: value ?? null }) + "\n"),
    (error) =>
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: typeof error.code === "string" ? error.code : "test_operation_failed",
        }) + "\n",
      ),
  );
}
controller.lock();
await storage.close();
await Promise.allSettled(workers.map((worker) => worker.terminate()));
