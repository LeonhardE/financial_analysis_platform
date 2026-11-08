import { createInterface } from "node:readline";
import { PersistentRuntime } from "../runtime/dist/session.mjs";
import { RuntimeStorage, digest } from "../runtime/dist/core.mjs";
import { IDBFactory } from "./fixtures/idb-runtime.mjs";
const storage = new RuntimeStorage(new IDBFactory()),
  requests = new Map();
let next = 0,
  runtime;
const send = (v) => process.stdout.write(JSON.stringify(v) + "\n");
const fetch = async (url, options) => {
  const id = "fetch_" + ++next;
  const response = await new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    send({
      fetch: id,
      path: new URL(url).pathname,
      method: options.method,
      headers: Object.fromEntries(new Headers(options.headers)),
      body: options.body ? JSON.parse(options.body) : null,
    });
  });
  if (response.networkError) throw Error("synthetic_network_drop");
  return new Response(JSON.stringify(response.value), {
    status: response.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
};
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const v = JSON.parse(line);
  if (v.response) {
    const p = requests.get(v.response);
    requests.delete(v.response);
    p.resolve(v);
    return;
  }
  void (async () => {
    try {
      let value;
      if (v.method === "tamperPlan") {
        const actor = { issuer: v.origin, ...v.args.actor };
        const key = "public:" + (await digest([actor, "plan-pending:" + v.args.taskId]));
        value = await storage.transact(key, (pending) => {
          if (!pending) throw Error("missing_synthetic_plan");
          pending.request.reportedStatus = v.args.status;
          return { write: pending, result: null };
        });
      } else if (v.method === "keys") {
        const p = await storage.profile(v.args, { create: true });
        value = {
          signingPublicJwk: p.signingPublicJwk,
          encryptionPublicJwk: p.encryptionPublicJwk,
        };
      } else if (v.method === "initialize") {
        runtime = new PersistentRuntime({ origin: v.origin, fetch, storage, monotonic: () => 0 });
        value = await runtime.initialize(v.args);
      } else value = await runtime[v.method](v.args);
      send({ id: v.id, ok: true, value });
    } catch (error) {
      send({ id: v.id, ok: false, error: error.code ?? error.message });
    }
  })();
});
