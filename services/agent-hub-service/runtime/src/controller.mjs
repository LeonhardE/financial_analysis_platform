/** Model-facing domain API. The page never receives private key handles or owner credentials. */
import { recoveryDiagnostic } from "./recovery.mjs";
const pending = new Map();
let worker;
async function checkedWorker() {
  const response = await fetch("/agent/v3/runtime/config", {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw Error("runtime_unavailable");
  const config = await response.json();
  if (
    config.issuer !== location.origin ||
    config.runtimeVersion !== "1.0.0" ||
    config.workerPath !== "/agent/v3/runtime/1.0.0/worker.mjs" ||
    !/^[a-f0-9]{64}$/.test(config.workerSha256)
  )
    throw Error("invalid_runtime_configuration");
  const script = await fetch(config.workerPath, {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!script.ok) throw Error("runtime_unavailable");
  const bytes = await script.arrayBuffer();
  if (bytes.byteLength > 2097152) throw Error("runtime_unavailable");
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== config.workerSha256) throw Error("runtime_integrity_mismatch");
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  try {
    worker = new Worker(url, { type: "module", name: "FolioView persistent Agent" });
  } finally {
    URL.revokeObjectURL(url);
  }
  worker.onmessage = ({ data }) => {
    const p = pending.get(data?.id);
    if (!p) return;
    pending.delete(data.id);
    clearTimeout(p.timer);
    if (data.ok) p.resolve(data.value);
    else {
      const error = Error(data.error);
      error.diagnostic = recoveryDiagnostic(data.diagnostic);
      p.reject(error);
    }
  };
  worker.onerror = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("runtime_unavailable"));
    }
    pending.clear();
  };
  return config;
}
function call(op, args = {}) {
  if (!worker) return Promise.reject(Error("runtime_unavailable"));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("runtime_request_timeout"));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, op, args });
  });
}
export async function connect() {
  const config = await checkedWorker();
  const params = new URLSearchParams(location.hash.slice(1));
  let args;
  if (params.has("setup")) {
    if ([...params.keys()].sort().join(",") !== "rootKeyId,setup")
      throw Error("invalid_runtime_link");
    args = { intentId: params.get("setup"), rootKeyId: params.get("rootKeyId") };
  } else {
    if (
      [...params.keys()].sort().join(",") !==
      "clientId,connectionId,descriptor,ownerSubject,rootKeyId,vaultId"
    )
      throw Error("invalid_runtime_link");
    const encoded = params.get("descriptor");
    if (!encoded || encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(encoded))
      throw Error("invalid_runtime_link");
    const identity = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (v) =>
          v.charCodeAt(0),
        ),
      ),
    );
    args = {
      actor: Object.fromEntries(
        ["ownerSubject", "vaultId", "connectionId", "clientId"].map((k) => [k, params.get(k)]),
      ),
      identity,
      rootKeyId: params.get("rootKeyId"),
    };
  }
  const initialized = await call("initialize", args);
  const api = Object.freeze({
    status: () => call("status"),
    refreshConnection: () => call("synchronize"),
    pairingStatus: () => call("pairing"),
    listTasks: () => call("tasks"),
    dueTasks: () => call("due"),
    planStatus: (taskId) => call("planStatus", { taskId }),
    reportPlan: (taskId, status, planReference = null) =>
      call("reportPlan", { taskId, status, planReference }),
    retryPlanReport: (taskId) => call("retryPlanReport", { taskId }),
    beginRun: (taskId, triggerId) => call("begin", { taskId, triggerId }),
    readInput: (runId, publicationId) => call("input", { runId, publicationId }),
    saveReport: (runId, report) => call("submit", { runId, report }),
    resultReceipt: (runId) => call("receipt", { runId }),
    clearPlaintext: () => call("clear"),
  });
  Object.defineProperty(window, "folioview", { value: api, writable: false, configurable: false });
  const owner = config.ownerOrigins[0];
  const approval = new URL("/agents", owner);
  if (args.intentId) approval.searchParams.set("runtime_setup", args.intentId);
  return { state: initialized, approvalUrl: approval.href };
}
