/** Dedicated fallback: browser termination destroys its in-memory crypto kernel. */
import { createVaultKernel } from "./encrypted-vault-engine";
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
const kernel = createVaultKernel((reply) => scope.postMessage(reply));
scope.onmessage = (event) => kernel.postMessage(event.data);
