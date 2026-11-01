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
          case "unlockForKeyRenewal":
            result = await core.unlockForKeyRenewal(args.vault, args.material, args.local);
            break;
          case "inspectKeyRenewal":
            result = await core.inspectKeyRenewal(args.vault, args.state, args.record, args.prior);
            break;
          case "inspectRenewalHoldingsPending":
            result = await core.inspectRenewalHoldingsPending(args.pending);
            break;
          case "inspectRenewalTaskPending":
            result = await core.inspectRenewalTaskPending(args.pending);
            break;
          case "verifyRenewalTaskReceipt":
            result = await core.verifyRenewalTaskReceipt(args.pending, args.value);
            break;
          case "verifyRenewalHoldingsReceipt":
            result = await core.verifyRenewalHoldingsReceipt(
              args.pending,
              args.receipt,
              args.value,
            );
            break;
          case "prepareKeyRenewal":
            result = await core.prepareKeyRenewal(args.vault, args.state, args.prior);
            break;
          case "getKeyRenewal":
            result = await core.getKeyRenewal(args.vault, args.state, args.record, args.prior);
            break;
          case "finishKeyRenewal":
            result = await core.finishKeyRenewal(
              args.vault,
              args.state,
              args.record,
              args.receipt,
              args.prior,
            );
            break;
          case "prepareKeyRenewalCancellation":
            result = await core.prepareKeyRenewalCancellation(
              args.vault,
              args.state,
              args.record,
              args.prior,
            );
            break;
          case "discardKeyRenewal":
            result = await core.discardKeyRenewal(
              args.vault,
              args.state,
              args.record,
              args.operationId,
              args.prior,
            );
            break;
          case "verifyLifecycle":
            {
              const pin = await core.verifyLifecycle(args.vault, args.state, args.prior);
              result =
                args.includeRegistryPin === true
                  ? { pin, record: await core.verifiedVaultPin(args.vault) }
                  : pin;
            }
            break;
          case "createRecoveryKit":
            result = await core.createRecoveryKit(args.vault, args.state, args.prior);
            break;
          case "importRecoveryKit":
            result = await core.importRecoveryKit(
              args.vault,
              args.state,
              args.file,
              args.code,
              args.prior,
            );
            break;
          case "prepareArchiveChange":
            result = await core.prepareArchiveChange(
              args.vault,
              args.state,
              args.material,
              args.mode,
              args.prior,
            );
            break;
          case "inspectArchiveChange":
            result = await core.inspectArchiveChange(
              args.vault,
              args.state,
              args.record,
              args.prior,
            );
            break;
          case "prepareArchiveCancellation":
            result = await core.prepareArchiveCancellation(
              args.vault,
              args.state,
              args.record,
              args.prior,
            );
            break;
          case "discardArchiveChange":
            result = await core.discardArchiveChange(
              args.vault,
              args.state,
              args.record,
              args.operationId,
              args.prior,
            );
            break;
          case "getArchiveChange":
            result = await core.getArchiveChange(
              args.vault,
              args.state,
              args.record,
              args.material,
              args.prior,
            );
            break;
          case "finishArchiveChange":
            result = await core.finishArchiveChange(
              args.vault,
              args.state,
              args.operationId,
              args.prior,
            );
            break;
          case "revokeRecoveryAuthorization":
            result = await core.revokeRecoveryAuthorization(args.vault, args.state, args.prior);
            break;
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
            result = await core.prepareDeviceRegistration(args.vault, args.options);
            break;
          case "deviceManagement":
            result = await core.deviceManagement(args.vault, args.record);
            break;
          case "prepareDeviceChange":
            result = await core.prepareDeviceChange(args);
            break;
          case "loadDeviceChange":
            result = await core.loadDeviceChange(args.vault, args.record);
            break;
          case "acceptDeviceChange":
            result = await core.acceptDeviceChange(args.vault, args.record);
            break;
          case "discardDeviceChange":
            result = await core.discardDeviceChange(args.vault, args.record, args.operationId);
            break;
          case "verifyRecovery":
            result = await core.verifyRecovery(args.vault);
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
          case "publicAgentAnchor":
            result = await core.publicAgentAnchor(args);
            break;
          case "inspectAgentOffer":
            result = await core.inspectAgentOffer(args);
            break;
          case "prepareAgentRegistration":
            result = await core.prepareAgentRegistration(args);
            break;
          case "openAgentPending":
            result = await core.openAgentPending(args);
            break;
          case "signAgentGrants":
            result = await core.signAgentGrants(args);
            break;
          case "sealAgentPreparation":
            result = await core.sealAgentPreparation(args);
            break;
          case "prepareSourceCreation":
            result = await core.prepareSourceCreation(args.sourceId);
            break;
          case "validateSourceCreation":
            result = await core.validateSourceCreation(args.packet);
            break;
          case "discardSourceCreation":
            result = await core.discardSourceCreation(args.packet, args.currentVault, args.sources);
            break;
          case "verifySourceCreation":
            result = await core.verifySourceCreation(args.packet, args.source);
            break;
          case "signSourceMutation":
            result = await core.signSourceMutation(args);
            break;
          case "validateSourceMutation":
            result = await core.validateSourceMutation(args.packet);
            break;
          case "discardSourceMutation":
            result = await core.discardSourceMutation(
              args.packet,
              args.currentSource,
              args.currentAuthorityVersion,
            );
            break;
          case "verifySourceMutationReceipt":
            result = await core.verifySourceMutationReceipt(args.packet, args.receipt);
            break;
          case "signSource":
            result = await core.signSource(args.sourceId);
            break;
          case "openTask":
            result = await core.openTask(args.task);
            break;
          case "taskAuthority":
            result = await core.taskAuthority(args.current);
            break;
          case "sealTask":
            result = await core.sealTask(args);
            break;
          case "transitionTask":
            result = await core.transitionTask(args);
            break;
          case "validateTaskPending":
            result = await core.validateTaskPending(args.pending);
            break;
          case "sealDraft":
            result = await core.sealDraft(args);
            break;
          case "openDraft":
            result = await core.openDraft(args.record);
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
