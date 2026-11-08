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
      .map((r) => r.toString(16).padStart(2, "0"))
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
    (p.onmessage = ({ data: r }) => {
      let e = u.get(r?.id);
      e &&
        (u.delete(r.id),
        clearTimeout(e.timer),
        r.ok ? e.resolve(r.value) : e.reject(Error(r.error)));
    }),
    (p.onerror = () => {
      for (let r of u.values()) (clearTimeout(r.timer), r.reject(Error("runtime_unavailable")));
      u.clear();
    }),
    t
  );
}
function n(s, t = {}) {
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
  let a = await n("initialize", o),
    d = Object.freeze({
      status: () => n("status"),
      pairingStatus: () => n("pairing"),
      listTasks: () => n("tasks"),
      dueTasks: () => n("due"),
      planStatus: (e) => n("planStatus", { taskId: e }),
      reportPlan: (e, i, l = null) => n("reportPlan", { taskId: e, status: i, planReference: l }),
      retryPlanReport: (e) => n("retryPlanReport", { taskId: e }),
      beginRun: (e, i) => n("begin", { taskId: e, triggerId: i }),
      readInput: (e, i) => n("input", { runId: e, publicationId: i }),
      saveReport: (e, i) => n("submit", { runId: e, report: i }),
      resultReceipt: (e) => n("receipt", { runId: e }),
      clearPlaintext: () => n("clear"),
    });
  Object.defineProperty(window, "folioview", { value: d, writable: !1, configurable: !1 });
  let c = s.ownerOrigins[0],
    r = new URL("/agents", c);
  return (
    o.intentId && r.searchParams.set("runtime_setup", o.intentId),
    { state: a, approvalUrl: r.href }
  );
}
export { f as connect };
