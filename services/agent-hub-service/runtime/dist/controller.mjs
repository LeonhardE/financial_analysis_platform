var m = ["profile_record_missing", "profile_validation_failed", "identity_key_mismatch"];
function f(n) {
  if (!n || !m.includes(n.stage) || !/^profile:[a-f0-9]{64}$/.test(n.namespace)) return null;
  let t = { stage: n.stage, namespace: n.namespace };
  if (n.stage === "identity_key_mismatch")
    for (let r of ["signingKeyMatches", "encryptionKeyMatches", "identityActive"]) {
      if (typeof n[r] != "boolean") return null;
      t[r] = n[r];
    }
  return t;
}
var u = new Map(),
  d;
async function g() {
  let n = await fetch("/agent/v3/runtime/config", {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!n.ok) throw Error("runtime_unavailable");
  let t = await n.json();
  if (
    t.issuer !== location.origin ||
    t.runtimeVersion !== "1.0.0" ||
    t.workerPath !== "/agent/v3/runtime/1.0.0/worker.mjs" ||
    !/^[a-f0-9]{64}$/.test(t.workerSha256)
  )
    throw Error("invalid_runtime_configuration");
  let r = await fetch(t.workerPath, { credentials: "omit", cache: "no-store", redirect: "error" });
  if (!r.ok) throw Error("runtime_unavailable");
  let s = await r.arrayBuffer();
  if (s.byteLength > 2097152) throw Error("runtime_unavailable");
  if (
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", s))]
      .map((i) => i.toString(16).padStart(2, "0"))
      .join("") !== t.workerSha256
  )
    throw Error("runtime_integrity_mismatch");
  let c = URL.createObjectURL(new Blob([s], { type: "text/javascript" }));
  try {
    d = new Worker(c, { type: "module", name: "FolioView persistent Agent" });
  } finally {
    URL.revokeObjectURL(c);
  }
  return (
    (d.onmessage = ({ data: i }) => {
      let e = u.get(i?.id);
      if (e)
        if ((u.delete(i.id), clearTimeout(e.timer), i.ok)) e.resolve(i.value);
        else {
          let a = Error(i.error);
          ((a.diagnostic = f(i.diagnostic)), e.reject(a));
        }
    }),
    (d.onerror = () => {
      for (let i of u.values()) (clearTimeout(i.timer), i.reject(Error("runtime_unavailable")));
      u.clear();
    }),
    t
  );
}
function o(n, t = {}) {
  if (!d) return Promise.reject(Error("runtime_unavailable"));
  let r = crypto.randomUUID();
  return new Promise((s, p) => {
    let c = setTimeout(() => {
      (u.delete(r), p(Error("runtime_request_timeout")));
    }, 12e4);
    (u.set(r, { resolve: s, reject: p, timer: c }), d.postMessage({ id: r, op: n, args: t }));
  });
}
async function h() {
  let n = await g(),
    t = new URLSearchParams(location.hash.slice(1)),
    r;
  if (t.has("setup")) {
    if ([...t.keys()].sort().join(",") !== "rootKeyId,setup") throw Error("invalid_runtime_link");
    r = { intentId: t.get("setup"), rootKeyId: t.get("rootKeyId") };
  } else {
    if (
      [...t.keys()].sort().join(",") !==
      "clientId,connectionId,descriptor,ownerSubject,rootKeyId,vaultId"
    )
      throw Error("invalid_runtime_link");
    let e = t.get("descriptor");
    if (!e || e.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(e)) throw Error("invalid_runtime_link");
    let a = JSON.parse(
      new TextDecoder("utf-8", { fatal: !0 }).decode(
        Uint8Array.from(atob(e.replaceAll("-", "+").replaceAll("_", "/")), (l) => l.charCodeAt(0)),
      ),
    );
    r = {
      actor: Object.fromEntries(
        ["ownerSubject", "vaultId", "connectionId", "clientId"].map((l) => [l, t.get(l)]),
      ),
      identity: a,
      rootKeyId: t.get("rootKeyId"),
    };
  }
  let s = await o("initialize", r),
    p = Object.freeze({
      status: () => o("status"),
      refreshConnection: () => o("synchronize"),
      pairingStatus: () => o("pairing"),
      listTasks: () => o("tasks"),
      dueTasks: () => o("due"),
      planStatus: (e) => o("planStatus", { taskId: e }),
      reportPlan: (e, a, l = null) => o("reportPlan", { taskId: e, status: a, planReference: l }),
      retryPlanReport: (e) => o("retryPlanReport", { taskId: e }),
      beginRun: (e, a) => o("begin", { taskId: e, triggerId: a }),
      readInput: (e, a) => o("input", { runId: e, publicationId: a }),
      saveReport: (e, a) => o("submit", { runId: e, report: a }),
      resultReceipt: (e) => o("receipt", { runId: e }),
      clearPlaintext: () => o("clear"),
    });
  Object.defineProperty(window, "folioview", { value: p, writable: !1, configurable: !1 });
  let c = n.ownerOrigins[0],
    i = new URL("/agents", c);
  return (
    r.intentId && i.searchParams.set("runtime_setup", r.intentId),
    { state: s, approvalUrl: i.href }
  );
}
export { h as connect };
