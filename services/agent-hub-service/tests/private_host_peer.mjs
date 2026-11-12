/** Synthetic local peer; never exports the generated private keys. */
import { createInterface } from "node:readline";
import { AgentClient, HostStorage, prepare, activate } from "../agent-client/dist/index.mjs";
const requests = new Map();
let next = 0,
  storage,
  client,
  clock = 1000;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const fetch = async (url, options) => {
  const id = "fetch_" + ++next;
  const response = await new Promise((resolve) => {
    requests.set(id, resolve);
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
createInterface({ input: process.stdin }).on("line", (line) => {
  const v = JSON.parse(line);
  if (v.response) {
    requests.get(v.response)(v);
    requests.delete(v.response);
    return;
  }
  void (async () => {
    try {
      let value;
      if (v.method === "load") {
        storage = new HostStorage({
          directory: v.args.directory,
          origin: v.origin,
          actor: v.args.actor,
          provider: v.args.provider,
        });
        value = null;
      } else if (v.method === "prepare") {
        storage = new HostStorage({
          directory: v.args.directory,
          origin: v.origin,
          actor: v.args.bootstrap.actor,
          provider: v.args.bootstrap.provider,
        });
        value = await prepare(storage, v.args.bootstrap, { clock: () => clock });
      } else if (v.method === "activate")
        value = await activate(storage, v.args, { fetch, clock: () => clock });
      else if (v.method === "initialize") {
        client = new AgentClient({
          origin: v.origin,
          storage,
          fetch,
          clock: () => clock,
          monotonic: v.args.advanceMonotonic ? () => performance.now() : () => 0,
        });
        value = await client.initialize();
      } else if (v.method === "clock") {
        clock = v.args.now;
        value = null;
      } else value = await client[v.method](v.args);
      send({ id: v.id, ok: true, value });
    } catch (error) {
      send({ id: v.id, ok: false, error: error.code ?? "unexpected_failure" });
    }
  })();
});
