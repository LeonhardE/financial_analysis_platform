/** Dedicated, terminated-on-lock crypto execution boundary. No fetch/tool/decrypt endpoint. */
import { VaultCore } from "./encrypted-core";
import { VaultError } from "./encrypted-types";
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
let core: VaultCore | undefined;
let queue = Promise.resolve();
scope.onmessage = (event) => {
  const { id, method, args } = event.data;
  queue = queue.then(async () => {
    try {
      let result: unknown;
      if (method === "init") {
        if (core) throw new VaultError("locked");
        core = new VaultCore(args.uid);
        result = { ownerSubject: await core.owner };
      } else {
        if (!core) throw new VaultError("locked");
        switch (method) {
          case "beginCreate":
            result = await core.beginCreate(args.material);
            break;
          case "unlock":
            result = await core.unlock(args.vault, args.material, args.local);
            break;
          case "unlockForResults":
            result = await core.unlockForResults(args.vault, args.material, args.local);
            break;
          case "prepareDeviceRegistration":
            result = await core.prepareDeviceRegistration(args.vault);
            break;
          case "acceptVault":
            result = await core.acceptVault(args.vault);
            break;
          case "acceptResultVault":
            result = await core.acceptResultVault(args.vault);
            break;
          case "openResult":
            result = await core.openResult(args);
            break;
          case "signResultState":
            result = await core.signResultState(args);
            break;
          case "signSource":
            result = await core.signSource(args.sourceId);
            break;
          case "sealSnapshot":
            result = await core.sealSnapshot(args);
            break;
          case "openSnapshot":
            result = await core.openSnapshot(args.value, args.source);
            break;
          case "validatePending":
            result = await core.validatePending(args.pending);
            break;
          case "verifyReceipt":
            result = await core.verifyReceipt(args.pending, args.receipt);
            break;
          default:
            throw new VaultError("invalid_operation");
        }
      }
      scope.postMessage({ id, ok: true, result });
    } catch (error) {
      scope.postMessage({
        id,
        ok: false,
        error: error instanceof VaultError ? error.code : "crypto_failed",
      });
    } finally {
      if (args?.material?.secret instanceof ArrayBuffer && args.material.secret.byteLength)
        new Uint8Array(args.material.secret).fill(0);
    }
  });
};
