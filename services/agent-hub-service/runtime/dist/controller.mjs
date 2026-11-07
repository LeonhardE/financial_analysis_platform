var l = new Map(),
  d;
async function p() {
  let s = await fetch("/agent/v3/runtime/config", {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!s.ok) throw Error("runtime_unavailable");
  let e = await s.json();
  if (
    e.issuer !== location.origin ||
    e.runtimeVersion !== "1.0.0" ||
    e.workerPath !== "/agent/v3/runtime/1.0.0/worker.mjs" ||
    !/^[a-f0-9]{64}$/.test(e.workerSha256)
  )
    throw Error("invalid_runtime_configuration");
  let i = await fetch(e.workerPath, { credentials: "omit", cache: "no-store", redirect: "error" });
  if (!i.ok) throw Error("runtime_unavailable");
  let n = await i.arrayBuffer();
  if (n.byteLength > 2097152) throw Error("runtime_unavailable");
  if (
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", n))]
      .map((r) => r.toString(16).padStart(2, "0"))
      .join("") !== e.workerSha256
  )
    throw Error("runtime_integrity_mismatch");
  let c = URL.createObjectURL(new Blob([n], { type: "text/javascript" }));
  try {
    d = new Worker(c, { type: "module", name: "FolioView persistent Agent" });
  } finally {
    URL.revokeObjectURL(c);
  }
  return (
    (d.onmessage = ({ data: r }) => {
      let t = l.get(r?.id);
      t &&
        (l.delete(r.id),
        clearTimeout(t.timer),
        r.ok ? t.resolve(r.value) : t.reject(Error(r.error)));
    }),
    (d.onerror = () => {
      for (let r of l.values()) (clearTimeout(r.timer), r.reject(Error("runtime_unavailable")));
      l.clear();
    }),
    e
  );
}
function o(s, e = {}) {
  if (!d) return Promise.reject(Error("runtime_unavailable"));
  let i = crypto.randomUUID();
  return new Promise((n, u) => {
    let c = setTimeout(() => {
      (l.delete(i), u(Error("runtime_request_timeout")));
    }, 12e4);
    (l.set(i, { resolve: n, reject: u, timer: c }), d.postMessage({ id: i, op: s, args: e }));
  });
}
async function f() {
  let s = await p(),
    e = new URLSearchParams(location.hash.slice(1)),
    i;
  if (e.has("setup")) {
    if ([...e.keys()].sort().join(",") !== "rootKeyId,setup") throw Error("invalid_runtime_link");
    i = { intentId: e.get("setup"), rootKeyId: e.get("rootKeyId") };
  } else {
    if (
      [...e.keys()].sort().join(",") !==
      "clientId,connectionId,descriptor,ownerSubject,rootKeyId,vaultId"
    )
      throw Error("invalid_runtime_link");
    let t = e.get("descriptor");
    if (!t || t.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(t)) throw Error("invalid_runtime_link");
    let a = JSON.parse(
      new TextDecoder("utf-8", { fatal: !0 }).decode(
        Uint8Array.from(atob(t.replaceAll("-", "+").replaceAll("_", "/")), (m) => m.charCodeAt(0)),
      ),
    );
    i = {
      actor: Object.fromEntries(
        ["ownerSubject", "vaultId", "connectionId", "clientId"].map((m) => [m, e.get(m)]),
      ),
      identity: a,
      rootKeyId: e.get("rootKeyId"),
    };
  }
  let n = await o("initialize", i),
    u = Object.freeze({
      status: () => o("status"),
      pairingStatus: () => o("pairing"),
      listTasks: () => o("tasks"),
      dueTasks: () => o("due"),
      beginRun: (t, a) => o("begin", { taskId: t, triggerId: a }),
      readInput: (t, a) => o("input", { runId: t, publicationId: a }),
      saveReport: (t, a) => o("submit", { runId: t, report: a }),
      resultReceipt: (t) => o("receipt", { runId: t }),
      clearPlaintext: () => o("clear"),
    });
  Object.defineProperty(window, "folioview", { value: u, writable: !1, configurable: !1 });
  let c = s.ownerOrigins[0],
    r = new URL("/agents", c);
  return (
    i.intentId && r.searchParams.set("runtime_setup", i.intentId),
    { state: n, approvalUrl: r.href }
  );
}
export { f as connect };
