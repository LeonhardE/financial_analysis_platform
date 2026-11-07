/** Memory-only owner Worker. No key/PRF persistence or generic decrypt endpoint. */
import { createVaultKernel } from "./encrypted-vault-engine";
type Reply = { id: number; ok: boolean; result?: unknown; error?: string };
const scope = globalThis as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
  close: () => void;
};
const ports = new Set<MessagePort>();
const bindings = new Map<MessagePort, string>();
const pending = new Map<number, (reply: Reply) => void>();
let uid = "";
let worker: ReturnType<typeof createVaultKernel> | null = null;
let ready: Promise<unknown> | null = null;
let next = 0;
let generation = 0;
let published = false;

function notify(event: "available" | "locked") {
  for (const port of ports) port.postMessage({ event });
}
function invalidate() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  ready = null;
  published = false;
  ++generation;
  const callbacks = [...pending.values()];
  pending.clear();
  for (const callback of callbacks) callback({ id: 0, ok: false, error: "locked" });
  notify("locked");
  // Terminate the global, including any in-flight crypto, rather than retaining
  // old key handles in suspended closures after an explicit lock or logout.
  scope.close();
}
function invoke(method: string, args: any) {
  const id = ++next;
  return new Promise<Reply>((resolve) => {
    pending.set(id, resolve);
    try {
      worker!.postMessage({ id, method, args });
    } catch {
      pending.delete(id);
      resolve({ id, ok: false, error: "crypto_failed" });
    }
  });
}
function initialize(owner: string) {
  if (!owner || owner.length > 128 || (uid && uid !== owner))
    return Promise.reject(new Error("wrong_account"));
  uid = owner;
  if (!worker) {
    const current = ++generation;
    worker = createVaultKernel((reply) => {
      if (current !== generation) return;
      const resolve = pending.get(reply.id);
      if (!resolve) return;
      pending.delete(reply.id);
      resolve(reply);
    });
    ready = invoke("init", { uid }).then((reply) => {
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    });
  }
  return ready!;
}
scope.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.onmessage = async (message) => {
    const data = message.data;
    if (!data || typeof data !== "object") return;
    if (data.action === "release") {
      ports.delete(port);
      bindings.delete(port);
      port.close();
      return;
    }
    if (
      typeof data.uid !== "string" ||
      !data.uid ||
      data.uid.length > 128 ||
      (bindings.has(port) && bindings.get(port) !== data.uid)
    )
      return;
    try {
      if (uid && uid !== data.uid) throw new Error("wrong_account");
      bindings.set(port, data.uid);
      if (data.action === "lock") {
        invalidate();
        return;
      }
      const initializedPromise = initialize(data.uid);
      const attachedGeneration = generation;
      const initialized = await initializedPromise;
      if (!ports.has(port)) return;
      if (attachedGeneration !== generation) throw new Error("locked");
      if (data.action === "observe") {
        if (published) port.postMessage({ event: "available" });
        return;
      }
      if (data.action === "publish") {
        const version = generation;
        const status = await invoke("ownerUnlockStatus", {});
        if (
          version === generation &&
          status.ok &&
          (status.result as { unlocked?: boolean })?.unlocked &&
          !published
        ) {
          published = true;
          notify("available");
        }
        return;
      }
      if (
        data.action !== "rpc" ||
        !Number.isSafeInteger(data.id) ||
        typeof data.method !== "string"
      )
        return;
      const version = generation;
      const reply =
        data.method === "init"
          ? { id: data.id, ok: true, result: initialized }
          : await invoke(data.method, data.args);
      if (ports.has(port))
        port.postMessage(
          version === generation
            ? { ...reply, id: data.id }
            : { id: data.id, ok: false, error: "locked" },
        );
    } catch (error) {
      if (ports.has(port) && Number.isSafeInteger(data.id))
        port.postMessage({
          id: data.id,
          ok: false,
          error:
            error instanceof Error && error.message === "wrong_account"
              ? "wrong_account"
              : "locked",
        });
    }
  };
  port.start();
};
