// Synthetic test-only transport for the checked browser distribution; no server.
import { createInterface } from "node:readline";
import { Worker, MessageChannel } from "node:worker_threads";
const worker = new Worker(new URL("./helper_worker_host.mjs", import.meta.url));
await new Promise((resolve, reject) => {
  worker.once("message", resolve);
  worker.once("error", reject);
});
const owner = new MessageChannel(),
  agent = new MessageChannel();
worker.postMessage({ op: "attach", ownerPort: owner.port2, agentPort: agent.port2 }, [
  owner.port2,
  agent.port2,
]);
const pending = new Map();
for (const port of [owner.port1, agent.port1])
  port.on("message", (response) => {
    const resolve = pending.get(response.id);
    if (resolve) {
      pending.delete(response.id);
      resolve(response);
    }
  });
const dispatch = (message, trusted = false) =>
  new Promise((resolve) => {
    pending.set(message.id, resolve);
    (trusted ? owner.port1 : agent.port1).postMessage(message);
  });
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  try {
    const command = JSON.parse(line);
    if (command.race) {
      const read = dispatch(command.read),
        locked = await dispatch(command.lock);
      process.stdout.write(
        JSON.stringify({ ok: true, value: { read: await read, locked: locked.value } }) + "\n",
      );
    } else if (command.flood) {
      const replies = await Promise.all(command.messages.map((message) => dispatch(message)));
      process.stdout.write(JSON.stringify({ ok: true, value: replies }) + "\n");
    } else {
      const response = await dispatch(command.message, command.trusted === true);
      if (!response.ok) response.error = response.error.code;
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "test_transport_failed" }) + "\n");
  }
}
await worker.terminate();
owner.port1.close();
agent.port1.close();
