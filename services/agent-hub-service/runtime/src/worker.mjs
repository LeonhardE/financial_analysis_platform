/** Dedicated protected runtime Worker. Closed domain methods; no key/crypto/fetch RPC. */
import { PersistentRuntime } from "./session.mjs";
import { RuntimeDenied, exact, canonical } from "./crypto.mjs";
import { recoveryDiagnostic } from "./recovery.mjs";
let runtime = null,
  queued = 0,
  queue = Promise.resolve();
const seen = new Set();
const fields = {
  status: [],
  pairing: [],
  synchronize: [],
  tasks: [],
  due: [],
  planStatus: ["taskId"],
  reportPlan: ["taskId", "status", "planReference"],
  retryPlanReport: ["taskId"],
  begin: ["taskId", "triggerId"],
  input: ["runId", "publicationId"],
  submit: ["runId", "report"],
  receipt: ["runId"],
  clear: [],
};
self.onmessage = (event) => {
  const message = event.data;
  if (
    !message ||
    typeof message !== "object" ||
    typeof message.id !== "string" ||
    message.id.length > 80
  )
    return;
  const { id } = message;
  if (queued >= 16) {
    self.postMessage({ id, ok: false, error: "runtime_busy" });
    return;
  }
  queued++;
  queue = queue.then(async () => {
    try {
      exact(message, ["id", "op", "args"]);
      if (canonical(message).length > 1048576 || seen.has(id) || seen.size >= 4096)
        throw new RuntimeDenied("invalid_request");
      seen.add(id);
      let value;
      if (message.op === "initialize") {
        if (runtime) throw new RuntimeDenied("already_initialized");
        runtime = new PersistentRuntime({ origin: self.location.origin });
        value = await runtime.initialize(message.args);
      } else {
        if (!runtime || !Object.hasOwn(fields, message.op))
          throw new RuntimeDenied("invalid_operation");
        exact(message.args, fields[message.op]);
        value = await runtime[message.op](message.args);
      }
      self.postMessage({ id, ok: true, value });
    } catch (error) {
      const diagnostic =
        error instanceof RuntimeDenied ? recoveryDiagnostic(error.diagnostic) : null;
      self.postMessage({
        id,
        ok: false,
        error: error instanceof RuntimeDenied ? error.code : "runtime_operation_failed",
        ...(diagnostic ? { diagnostic } : {}),
      });
    } finally {
      queued--;
    }
  });
};
