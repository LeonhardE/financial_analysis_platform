// Test-only browser Worker adapter. The checked asset itself has no Node imports.
import { parentPort, MessagePort } from "node:worker_threads";
globalThis.self = { onmessage: null };
globalThis.MessagePort = MessagePort;
await import("../helper/dist/worker.mjs");
parentPort.on("message", (data) => self.onmessage({ data }));
parentPort.postMessage({ ready: true });
