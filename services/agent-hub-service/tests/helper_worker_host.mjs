// Test-only browser Worker adapter. The checked asset itself has no Node imports.
import { parentPort, MessagePort } from "node:worker_threads";
globalThis.self = { onmessage: null };
globalThis.MessagePort = MessagePort;
const release =
  process.env.FOLIOVIEW_TEST_HELPER_RELEASE ??
  (process.env.FOLIOVIEW_TEST_FOREGROUND_TRANSPORT === "1" ? "1.3.0" : null);
if (release !== null && !["1.3.0", "1.4.0"].includes(release))
  throw new Error("test_release_not_allowed");
const realPerformance = globalThis.performance;
let fixtureOffset = 0;
globalThis.performance = { now: () => realPerformance.now() + fixtureOffset };
await import(
  release ? `../helper/releases/${release}/dist/worker.mjs` : "../helper/dist/worker.mjs"
);
parentPort.on("message", (data) => {
  if (Number.isSafeInteger(data?.fixtureAdvanceTime) && data.fixtureAdvanceTime >= 0) {
    fixtureOffset += data.fixtureAdvanceTime;
    parentPort.postMessage({ fixtureClockAdvanced: true });
  } else self.onmessage({ data });
});
parentPort.postMessage({ ready: true });
