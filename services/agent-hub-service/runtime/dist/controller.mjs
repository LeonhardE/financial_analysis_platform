var u = new Map(),
  p;
async function m() {
  let s = await fetch("/agent/v3/runtime/config", {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!s.ok) throw Error("runtime_unavailable");
  let t = await s.json();
  if (
    t.issuer !== location.origin ||
    t.runtimeVersion !== "1.0.0" ||
    t.workerPath !== "/agent/v3/runtime/1.0.0/worker.mjs" ||
    !/^[a-f0-9]{64}$/.test(t.workerSha256)
  )
    throw Error("invalid_runtime_configuration");
  let o = await fetch(t.workerPath, { credentials: "omit", cache: "no-store", redirect: "error" });
  if (!o.ok) throw Error("runtime_unavailable");
  let a = await o.arrayBuffer();
  if (a.byteLength > 2097152) throw Error("runtime_unavailable");
  if (
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", a))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("") !== t.workerSha256
  )
    throw Error("runtime_integrity_mismatch");
  let c = URL.createObjectURL(new Blob([a], { type: "text/javascript" }));
  try {
    p = new Worker(c, { type: "module", name: "FolioView persistent Agent" });
  } finally {
    URL.revokeObjectURL(c);
  }
  return (
    (p.onmessage = ({ data: n }) => {
      let e = u.get(n?.id);
      e &&
        (u.delete(n.id),
        clearTimeout(e.timer),
        n.ok ? e.resolve(n.value) : e.reject(Error(n.error)));
    }),
    (p.onerror = () => {
      for (let n of u.values()) (clearTimeout(n.timer), n.reject(Error("runtime_unavailable")));
      u.clear();
    }),
    t
  );
}
function r(s, t = {}) {
  if (!p) return Promise.reject(Error("runtime_unavailable"));
  let o = crypto.randomUUID();
  return new Promise((a, d) => {
    let c = setTimeout(() => {
      (u.delete(o), d(Error("runtime_request_timeout")));
    }, 12e4);
    (u.set(o, { resolve: a, reject: d, timer: c }), p.postMessage({ id: o, op: s, args: t }));
  });
}
async function f() {
  let s = await m(),
    t = new URLSearchParams(location.hash.slice(1)),
    o;
  if (t.has("setup")) {
    if ([...t.keys()].sort().join(",") !== "rootKeyId,setup") throw Error("invalid_runtime_link");
    o = { intentId: t.get("setup"), rootKeyId: t.get("rootKeyId") };
  } else {
    if (
      [...t.keys()].sort().join(",") !==
      "clientId,connectionId,descriptor,ownerSubject,rootKeyId,vaultId"
    )
      throw Error("invalid_runtime_link");
    let e = t.get("descriptor");
    if (!e || e.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(e)) throw Error("invalid_runtime_link");
    let i = JSON.parse(
      new TextDecoder("utf-8", { fatal: !0 }).decode(
        Uint8Array.from(atob(e.replaceAll("-", "+").replaceAll("_", "/")), (l) => l.charCodeAt(0)),
      ),
    );
    o = {
      actor: Object.fromEntries(
        ["ownerSubject", "vaultId", "connectionId", "clientId"].map((l) => [l, t.get(l)]),
      ),
      identity: i,
      rootKeyId: t.get("rootKeyId"),
    };
  }
  let a = await r("initialize", o),
    d = Object.freeze({
      status: () => r("status"),
      refreshConnection: () => r("synchronize"),
      pairingStatus: () => r("pairing"),
      listTasks: () => r("tasks"),
      dueTasks: () => r("due"),
      planStatus: (e) => r("planStatus", { taskId: e }),
      reportPlan: (e, i, l = null) => r("reportPlan", { taskId: e, status: i, planReference: l }),
      retryPlanReport: (e) => r("retryPlanReport", { taskId: e }),
      beginRun: (e, i) => r("begin", { taskId: e, triggerId: i }),
      readInput: (e, i) => r("input", { runId: e, publicationId: i }),
      saveReport: (e, i) => r("submit", { runId: e, report: i }),
      resultReceipt: (e) => r("receipt", { runId: e }),
      clearPlaintext: () => r("clear"),
    });
  Object.defineProperty(window, "folioview", { value: d, writable: !1, configurable: !1 });
  let c = s.ownerOrigins[0],
    n = new URL("/agents", c);
  return (
    o.intentId && n.searchParams.set("runtime_setup", o.intentId),
    { state: a, approvalUrl: n.href }
  );
}
export { f as connect };
