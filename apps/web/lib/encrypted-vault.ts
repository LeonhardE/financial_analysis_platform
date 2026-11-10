/** Public worker bridge: returned objects contain public controls/ciphertext only. */
import {
  BrowserEncryptedStorage,
  sameEncryptedRecord,
  type EncryptedStorage,
} from "./encrypted-storage";
import {
  VaultError,
  requireArchive,
  type ArchiveDeletionPacket,
  type ArchiveDeletionRecord,
  type Vault,
  type PasskeyMaterial,
  type Source,
  type SourceCreationPacket,
  type SourceMutationAction,
  type SourceMutationPacket,
  type SourceMutationReceipt,
  type PendingSnapshot,
  type SnapshotResponse,
  type Json,
  type Archive,
  type RegistryBundle,
  type OpenResultArgs,
  type ResultContent,
  type ResultMetadata,
  type ResultStateChanges,
  type ResultStatePacket,
  type TaskContent,
  type TaskDraft,
  type TaskDraftSummary,
  type TaskDraftRecord,
  type TaskAction,
  type EncryptedTask,
  type PendingTask,
  type UploadCancellationKind,
  type UploadCancellationPacket,
  type PendingUploadCancellation,
  type SealTaskArgs,
  type TaskOutboxSummary,
  type AgentAnchor,
  type HelperPublicOffer,
  type AgentRegistration,
  type AgentGrantArgs,
  type AgentGrantPacket,
  type AgentApprovalPacket,
  type AgentPreparationArgs,
  type AgentPreparationPacket,
  type AgentPendingKind,
  type VaultManagementSummary,
  type DeviceChangePacket,
  type RecoveryVerification,
  type VaultLifecycleState,
  type VaultLifecyclePin,
  type RecoveryKitExport,
  type ArchiveChangePacket,
  type KeyRenewalPacket,
  type KeyRenewalCancellationPacket,
  type KeyRenewalSummary,
} from "./encrypted-types";
export type {
  Vault,
  Source,
  SourceCreationPacket,
  SourceMutationAction,
  SourceMutationPacket,
  SourceMutationReceipt,
  Archive,
  PasskeyMaterial,
  PendingSnapshot,
  SnapshotResponse,
  ResourceContent,
  ResultMetadata,
  ResultContent,
  ResultEvidence,
  OpenResultArgs,
  ResultStateChanges,
  ResultStatePacket,
  TaskContent,
  TaskDraft,
  TaskDraftSummary,
  TaskDraftRecord,
  TaskAction,
  EncryptedTask,
  TaskMetadata,
  PendingTask,
  SealTaskArgs,
  ResourceBindingMetadata,
  TaskOutboxSummary,
  VaultLifecycleState,
  VaultLifecyclePin,
  RecoveryKitExport,
  ArchiveChangePacket,
  KeyRenewalPacket,
  KeyRenewalCancellationPacket,
  KeyRenewalSummary,
} from "./encrypted-types";
export { VaultError };
type Bootstrap = {
  operationId: string;
  vaultId: string;
  rootJwk: Json;
  rootKeyId: string;
  registryBundle: RegistryBundle;
  archive: Archive;
};
type Registration = {
  operationId: string;
  expectedVersion: number;
  registryBundle: RegistryBundle;
};
// Only public owner identity and typed RPC cross these same-origin ports.
// No key, PRF, login token or decrypted session is written to browser storage.
type OwnerWorker = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: any, transfer: Transferable[]) => void;
  terminate: () => void;
  release?: () => void;
  publish?: () => void;
};
function ownerPort(uid: string): { port: MessagePort; worker: SharedWorker } {
  const worker = new SharedWorker(new URL("./encrypted-vault.shared.ts", import.meta.url), {
    type: "module",
    name:
      "folioview-owner-unlock-v1:" +
      (process.env.NEXT_PUBLIC_OWNER_UNLOCK_VERSION ?? "local") +
      ":" +
      uid,
    extendedLifetime: true,
  } as WorkerOptions & { extendedLifetime: boolean });
  worker.port.start();
  return { port: worker.port, worker };
}
function sharedOwnerWorker(uid: string): OwnerWorker | null {
  if (typeof SharedWorker === "undefined") return null;
  try {
    const { port, worker } = ownerPort(uid);
    let closed = false;
    const send = (action: string) => {
      if (!closed) port.postMessage({ action, uid });
    };
    const adapter: OwnerWorker = {
      onmessage: null,
      onerror: null,
      postMessage(message: any, transfer?: Transferable[]) {
        if (closed) throw new VaultError("locked");
        // Preserve ArrayBuffer transfer (not copy) through the broker and into crypto.
        port.postMessage(
          { action: "rpc", uid, ...message, transfer: transfer ?? [] },
          transfer ?? [],
        );
      },
      terminate() {
        send("lock");
        adapter.release!();
      },
      release() {
        send("release");
        closed = true;
        port.close();
      },
      publish() {
        send("publish");
      },
    };
    port.onmessage = (event) => {
      if (closed) return;
      if (event.data?.event === "locked") adapter.onerror?.(new ErrorEvent("error"));
      else if (Number.isSafeInteger(event.data?.id)) adapter.onmessage?.(event);
    };
    worker.onerror = (event) => adapter.onerror?.(event);
    return adapter;
  } catch {
    return null;
  }
}
export class EncryptedVaultSession {
  static async hasArchiveDeletion(uid: string) {
    if (!uid || uid.length > 128) throw new VaultError("wrong_account");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid));
    const owner = [...new Uint8Array(hash)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const storage = new BrowserEncryptedStorage();
    try {
      const pending = await storage.get(owner + ":archive-change");
      return pending?.profile === "folioview.archive-deletion-candidate.v1";
    } finally {
      await storage.close();
    }
  }
  static supportsSharedUnlock() {
    return typeof SharedWorker !== "undefined";
  }
  static lockSharedUnlock(uid: string) {
    if (!this.supportsSharedUnlock()) return;
    try {
      const { port } = ownerPort(uid);
      port.postMessage({ action: "lock", uid });
      port.postMessage({ action: "release" });
      port.close();
    } catch {
      // A missing/unavailable broker cannot retain accessible owner keys here.
    }
  }
  static watchUnlock(uid: string, available: () => void, locked: () => void) {
    if (!this.supportsSharedUnlock()) return () => {};
    let disposed = false;
    let active: ReturnType<typeof ownerPort> | null = null;
    const disconnect = () => {
      if (!active) return;
      active.port.onmessage = null;
      active.worker.onerror = null;
      active.port.postMessage({ action: "release" });
      active.port.close();
      active = null;
    };
    const connect = () => {
      if (disposed) return;
      try {
        active = ownerPort(uid);
        active.port.onmessage = (event) => {
          if (disposed) return;
          if (event.data?.event === "available") available();
          else if (event.data?.event === "locked") {
            disconnect();
            locked();
            // The old global has closed and destroyed its keys. Observe a new,
            // locked global so a later explicit unlock can update every view.
            queueMicrotask(connect);
          }
        };
        active.worker.onerror = () => {
          disconnect();
          locked();
        };
        active.port.postMessage({ action: "observe", uid });
      } catch {
        disconnect();
      }
    };
    connect();
    return () => {
      disposed = true;
      disconnect();
    };
  }
  private readonly worker: OwnerWorker;
  readonly sharedUnlock: boolean;
  private readonly storage: EncryptedStorage;
  private readonly started: Promise<void>;
  private owner = "";
  private vaultId = "";
  private generation = 0;
  private next = 0;
  private closed = false;
  private readonly lifetime = new AbortController();
  private renewalOnly = false;
  private deletionOnly = false;
  private saving: Promise<void> = Promise.resolve();
  private pending = new Map<
    number,
    { generation: number; resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  constructor(
    uid: string,
    options: {
      storage?: EncryptedStorage;
      workerFactory?: () => Worker;
      sharedUnlock?: boolean;
      onInvalidated?: () => void;
    } = {},
  ) {
    this.storage = options.storage ?? new BrowserEncryptedStorage();
    const shared = options.sharedUnlock && !options.workerFactory ? sharedOwnerWorker(uid) : null;
    this.sharedUnlock = Boolean(shared);
    this.worker =
      options.workerFactory?.() ??
      shared ??
      new Worker(new URL("./encrypted-vault.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      this.pending.delete(event.data.id);
      if (request.generation !== this.generation || this.closed) {
        request.reject(new VaultError("locked"));
        return;
      }
      if (event.data.ok) request.resolve(event.data.result);
      else request.reject(new VaultError(event.data.error));
    };
    this.worker.onerror = () => {
      this.lock();
      options.onInvalidated?.();
    };
    this.started = this.send("init", { uid }).then((value) => {
      this.owner = value.ownerSubject;
    });
  }
  publishUnlock() {
    this.worker.publish?.();
  }
  async resumeUnlock(vault: Vault): Promise<{ canWriteState: boolean } | null> {
    if (!this.sharedUnlock) return null;
    const status = await this.rpc("ownerUnlockStatus", {});
    if (
      !status.unlocked ||
      status.vaultId !== vault.vaultId ||
      status.rootKeyId !== vault.rootKeyId
    )
      return null;
    this.storage.setArchiveContext?.(
      this.owner,
      requireArchive(vault.archive).credentialId,
      requireArchive(vault.archive).prfSalt,
      requireArchive(vault.archive).iv,
    );
    return this.acceptResultVault(vault);
  }
  private send(method: string, args: any, transfer: Transferable[] = []): Promise<any> {
    if (this.closed) return Promise.reject(new VaultError("locked"));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { generation: this.generation, resolve, reject });
      try {
        this.worker.postMessage({ id, method, args }, transfer);
      } catch {
        this.pending.delete(id);
        reject(new VaultError("crypto_failed"));
      }
    });
  }
  private async rpc(method: string, args: any, transfer: Transferable[] = []) {
    await this.started;
    const renewal = [
      "unlockForKeyRenewal",
      "verifyLifecycle",
      "inspectKeyRenewal",
      "prepareKeyRenewal",
      "getKeyRenewal",
      "prepareKeyRenewalCancellation",
      "finishKeyRenewal",
      "discardKeyRenewal",
      "inspectRenewalHoldingsPending",
      "verifyRenewalHoldingsReceipt",
      "inspectRenewalTaskPending",
      "verifyRenewalTaskReceipt",
      "prepareUploadCancellation",
      "validateUploadCancellation",
      "verifyUploadCancellationReceipt",
      "validateSourceCreation",
      "verifySourceCreation",
      "discardSourceCreation",
      "validateSourceMutation",
      "verifySourceMutationReceipt",
      "discardSourceMutation",
    ].includes(method);
    if (!renewal) {
      if (this.renewalOnly || (await this.keyRenewalRow()))
        throw new VaultError("key_renewal_pending");
    }
    const deletionControl = [
      "verifyLifecycle",
      "prepareArchiveDeletion",
      "inspectArchiveDeletion",
      "unlockForArchiveDeletion",
      "prepareArchiveWithdrawal",
      "finishArchiveDeletion",
    ].includes(method);
    if (!deletionControl) {
      const pending = await this.storage.get(this.owner + ":archive-change");
      if (this.deletionOnly || pending?.profile === "folioview.archive-deletion-candidate.v1")
        throw new VaultError("archive_deletion_pending");
    }
    return this.send(method, args, transfer);
  }
  private assert(generation: number) {
    if (this.closed || generation !== this.generation) throw new VaultError("locked");
  }
  private async local(vaultId: string, archive?: Archive | null) {
    const g = this.generation;
    await this.started;
    const record = await this.storage.get(this.owner + ":device:" + vaultId),
      pin = await this.storage.get(this.owner + ":pin");
    const pending = await this.storage.get(this.owner + ":pending-device:" + vaultId);
    const change = await this.deviceChangeRow(vaultId);
    this.assert(g);
    if (record && record.ownerSubject !== this.owner) throw new VaultError("wrong_account");
    if (pin && pin.ownerSubject !== this.owner) throw new VaultError("wrong_account");
    if (pending && pending.ownerSubject !== this.owner) throw new VaultError("wrong_account");
    // A replacement made on another browser may leave a seal tied to the old PRF.
    // Retain it on disk, but never try to interpret it as the newly verified device.
    const staleSeal =
      archive &&
      record?.device &&
      (record.device.credentialId !== archive.credentialId ||
        record.device.prfSalt !== archive.prfSalt);
    return {
      pin: pin ?? undefined,
      device: staleSeal ? undefined : record?.device,
      pending: pending?.pending,
      ...(change ? { deviceChange: change.pending.record } : {}),
    };
  }
  async prepareCreate(): Promise<void> {
    const g = this.generation;
    await this.started;
    const pin = await this.storage.get(this.owner + ":pin");
    this.assert(g);
    if (pin) throw new VaultError("untrusted_vault");
  }
  async beginCreate(material: PasskeyMaterial): Promise<Bootstrap> {
    try {
      const g = this.generation;
      await this.started;
      const pin = await this.storage.get(this.owner + ":pin");
      this.assert(g);
      if (pin) throw new VaultError("untrusted_vault");
      const { localPending, previousPending, ...result } = await this.rpc(
        "beginCreate",
        { material },
        [material.secret],
      );
      this.assert(g);
      this.storage.setArchiveContext?.(
        this.owner,
        result.archive.credentialId,
        result.archive.prfSalt,
        result.archive.iv,
      );
      if (
        !(await this.storage.stageDevice(
          this.owner + ":pending-device:" + result.vaultId,
          { ownerSubject: this.owner, pending: localPending },
          previousPending,
        ))
      )
        throw new VaultError("pending_registration");
      this.assert(g);
      this.vaultId = result.vaultId;
      return result;
    } finally {
      if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
    }
  }
  async unlock(
    vault: Vault,
    material: PasskeyMaterial,
  ): Promise<{ needsDeviceRegistration: boolean }> {
    try {
      const g = this.generation;
      const local = await this.local(vault.vaultId, vault.archive);
      this.storage.setArchiveContext?.(
        this.owner,
        requireArchive(vault.archive).credentialId,
        requireArchive(vault.archive).prfSalt,
        requireArchive(vault.archive).iv,
      );
      const value = await this.rpc("unlock", { vault, material, local }, [material.secret]);
      this.assert(g);
      this.vaultId = vault.vaultId;
      return value;
    } finally {
      if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
    }
  }
  async prepareDeviceRegistration(
    vault: Vault,
    options?: { replaceInactive?: boolean },
  ): Promise<Registration> {
    const g = this.generation;
    if (await this.deviceChangeRow(vault.vaultId)) throw new VaultError("device_change_pending");
    this.assert(g);
    const { localPending, previousPending, ...result } = await this.rpc(
      "prepareDeviceRegistration",
      { vault, options },
    );
    this.assert(g);
    if (
      !(await this.storage.stageDevice(
        this.owner + ":pending-device:" + vault.vaultId,
        { ownerSubject: this.owner, pending: localPending },
        previousPending,
        this.deviceChangeKey(vault.vaultId),
      ))
    )
      throw new VaultError("pending_registration");
    this.assert(g);
    return result;
  }
  async unlockForResults(
    vault: Vault,
    material: PasskeyMaterial,
  ): Promise<{ canWriteState: boolean }> {
    try {
      const g = this.generation;
      const local = await this.local(vault.vaultId, vault.archive);
      this.storage.setArchiveContext?.(
        this.owner,
        requireArchive(vault.archive).credentialId,
        requireArchive(vault.archive).prfSalt,
        requireArchive(vault.archive).iv,
      );
      const result = await this.rpc("unlockForResults", { vault, material, local }, [
        material.secret,
      ]);
      this.assert(g);
      this.vaultId = vault.vaultId;
      return result;
    } finally {
      if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
    }
  }
  async acceptResultVault(vault: Vault): Promise<{ canWriteState: boolean }> {
    const g = this.generation;
    const { canWriteState, ...record } = await this.rpc("acceptResultVault", { vault });
    this.assert(g);
    try {
      await this.storage.commitVault(this.owner, record);
    } catch (error) {
      this.lock();
      throw error;
    }
    this.assert(g);
    this.vaultId = vault.vaultId;
    return { canWriteState };
  }
  private async lifecycleLocal(vault: Vault) {
    const g = this.generation;
    await this.started;
    const pin = await this.storage.get(this.owner + ":lifecycle");
    this.assert(g);
    if (
      pin &&
      (pin.ownerSubject !== this.owner ||
        pin.vaultId !== vault.vaultId ||
        pin.rootKeyId !== vault.rootKeyId)
    )
      throw new VaultError("wrong_account");
    return pin as VaultLifecyclePin | undefined;
  }
  private async keyRenewalRow() {
    const g = this.generation;
    await this.started;
    const row = await this.storage.get(this.owner + ":key-renewal");
    this.assert(g);
    if (
      row &&
      (row.ownerSubject !== this.owner ||
        typeof row.vaultId !== "string" ||
        typeof row.operationId !== "string" ||
        !row.pending)
    )
      throw new VaultError("wrong_account");
    return row;
  }
  async unlockForKeyRenewal(
    vault: Vault,
    material: PasskeyMaterial,
  ): Promise<{ renewalOnly: true }> {
    try {
      const g = this.generation,
        local = await this.local(vault.vaultId, vault.archive);
      this.storage.setArchiveContext?.(
        this.owner,
        requireArchive(vault.archive).credentialId,
        requireArchive(vault.archive).prfSalt,
        requireArchive(vault.archive).iv,
      );
      const result = await this.rpc("unlockForKeyRenewal", { vault, material, local }, [
        material.secret,
      ]);
      this.assert(g);
      this.renewalOnly = true;
      this.vaultId = vault.vaultId;
      return result;
    } catch (error) {
      this.lock();
      throw error;
    } finally {
      if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
    }
  }
  async inspectKeyRenewal(vault: Vault, state: VaultLifecycleState): Promise<KeyRenewalSummary> {
    await this.verifyLifecycle(vault, state);
    const g = this.generation,
      row = await this.keyRenewalRow(),
      prior = await this.lifecycleLocal(vault);
    if (row && row.vaultId !== vault.vaultId) throw new VaultError("wrong_account");
    const result = await this.rpc("inspectKeyRenewal", {
      vault,
      state,
      record: row?.pending,
      prior,
    });
    this.assert(g);
    return result;
  }
  prepareKeyRenewal(vault: Vault, state: VaultLifecycleState): Promise<KeyRenewalPacket> {
    return this.serial(async () => {
      const g = this.generation,
        prior = await this.lifecycleLocal(vault);
      if (await this.keyRenewalRow()) throw new VaultError("key_renewal_pending");
      if (!this.storage.stageKeyRenewal) throw new VaultError("storage_unavailable");
      try {
        const { packet, record } = await this.rpc("prepareKeyRenewal", { vault, state, prior });
        this.assert(g);
        const row = {
          ownerSubject: this.owner,
          vaultId: vault.vaultId,
          operationId: packet.operationId,
          pending: record,
        };
        if (!(await this.storage.stageKeyRenewal(this.owner, row)))
          throw new VaultError("key_renewal_pending");
        this.assert(g);
        this.renewalOnly = true;
        return packet;
      } catch (error) {
        this.lock();
        throw error;
      }
    });
  }
  async getKeyRenewal(
    vault: Vault,
    state: VaultLifecycleState,
  ): Promise<{
    packet: KeyRenewalPacket;
    state: "ready" | "applied" | "conflict";
    cancellation?: KeyRenewalCancellationPacket;
  } | null> {
    await this.verifyLifecycle(vault, state);
    const g = this.generation,
      row = await this.keyRenewalRow(),
      prior = await this.lifecycleLocal(vault);
    if (!row) return null;
    if (row.vaultId !== vault.vaultId) throw new VaultError("wrong_account");
    const result = await this.rpc("getKeyRenewal", { vault, state, record: row.pending, prior });
    this.assert(g);
    if (result.packet.operationId !== row.operationId) throw new VaultError("binding_mismatch");
    return result;
  }
  prepareKeyRenewalCancellation(
    vault: Vault,
    state: VaultLifecycleState,
  ): Promise<KeyRenewalCancellationPacket> {
    return this.serial(async () => {
      const g = this.generation,
        row = await this.keyRenewalRow(),
        prior = await this.lifecycleLocal(vault);
      if (!row || row.vaultId !== vault.vaultId || !this.storage.updateKeyRenewal)
        throw new VaultError("key_renewal_unknown");
      const result = await this.rpc("prepareKeyRenewalCancellation", {
        vault,
        state,
        record: row.pending,
        prior,
      });
      this.assert(g);
      await this.storage.updateKeyRenewal(this.owner, { ...row, pending: result.record }, row);
      this.assert(g);
      return result.packet;
    });
  }
  finishKeyRenewal(
    vault: Vault,
    state: VaultLifecycleState,
    receipt: unknown,
    operationId: string,
  ): Promise<void> {
    return this.finishRenewal("finishKeyRenewal", vault, state, operationId, receipt);
  }
  discardKeyRenewal(vault: Vault, state: VaultLifecycleState, operationId: string): Promise<void> {
    return this.finishRenewal("discardKeyRenewal", vault, state, operationId);
  }
  private finishRenewal(
    method: "finishKeyRenewal" | "discardKeyRenewal",
    vault: Vault,
    state: VaultLifecycleState,
    operationId: string,
    receipt?: unknown,
  ): Promise<void> {
    return this.serial(async () => {
      const g = this.generation,
        row = await this.keyRenewalRow(),
        prior = await this.lifecycleLocal(vault);
      if (
        !row ||
        row.vaultId !== vault.vaultId ||
        row.operationId !== operationId ||
        !this.storage.finishKeyRenewal
      )
        throw new VaultError("key_renewal_unknown");
      try {
        const result = await this.rpc(method, {
          vault,
          state,
          record: row.pending,
          receipt,
          operationId,
          prior,
        });
        this.assert(g);
        await this.storage.finishKeyRenewal(
          this.owner,
          result.pin,
          vault.archive,
          result.record,
          row,
        );
        this.assert(g);
        this.lock();
      } catch (error) {
        this.lock();
        throw error;
      }
    });
  }
  async verifyLifecycle(vault: Vault, state: VaultLifecycleState): Promise<VaultLifecyclePin> {
    const g = this.generation,
      prior = await this.lifecycleLocal(vault);
    try {
      const { pin, record } = await this.rpc("verifyLifecycle", {
        vault,
        state,
        prior,
        includeRegistryPin: true,
      });
      this.assert(g);
      if (!this.storage.commitLifecycle) throw new VaultError("storage_unavailable");
      await this.storage.commitLifecycle(this.owner, pin, vault.archive, record);
      this.assert(g);
      return pin;
    } catch (error) {
      this.lock();
      throw error;
    }
  }
  async prepareArchiveDeletion(
    vault: Vault,
    state: VaultLifecycleState,
  ): Promise<ArchiveDeletionPacket> {
    return this.serial(async () => {
      try {
        await this.verifyLifecycle(vault, state);
        const g = this.generation,
          prior = await this.lifecycleLocal(vault);
        if (!this.storage.stageArchiveChange || !this.storage.finishArchiveDeletion)
          throw new VaultError("storage_unavailable");
        const { packet, record } = await this.rpc("prepareArchiveDeletion", {
          vault,
          state,
          prior,
        });
        this.assert(g);
        if (!(await this.storage.stageArchiveChange(this.owner, record)))
          throw new VaultError("archive_change_pending");
        this.assert(g);
        this.deletionOnly = true;
        return packet;
      } catch (error) {
        this.lock();
        throw error;
      }
    });
  }
  async hasArchiveDeletion() {
    await this.started;
    const g = this.generation,
      record = await this.storage.get(this.owner + ":archive-change");
    this.assert(g);
    return record?.profile === "folioview.archive-deletion-candidate.v1";
  }
  async inspectArchiveDeletion(vault: Vault, state: VaultLifecycleState) {
    await this.started;
    const g = this.generation;
    const record = await this.storage.get(this.owner + ":archive-change");
    this.assert(g);
    if (!record || record.profile !== "folioview.archive-deletion-candidate.v1") return null;
    const prior = await this.lifecycleLocal(vault);
    const result = await this.rpc("inspectArchiveDeletion", { vault, state, record, prior });
    this.assert(g);
    await this.verifyLifecycle(vault, state);
    this.assert(g);
    return result as {
      operationId: string;
      commandFingerprint: string;
      outcome: import("./encrypted-types").ArchiveDeletionOutcome;
      canWithdraw: boolean;
      packet: ArchiveDeletionPacket;
      withdrawal: import("./encrypted-types").ArchiveWithdrawalPacket | null;
    };
  }
  async unlockForArchiveDeletion(vault: Vault, material: PasskeyMaterial) {
    return this.serial(async () => {
      try {
        await this.started;
        const g = this.generation;
        const pin = await this.storage.get(this.owner + ":pin");
        if (pin && pin.ownerSubject !== this.owner) throw new VaultError("wrong_account");
        await this.rpc("unlockForArchiveDeletion", { vault, material, pin }, [material.secret]);
        this.assert(g);
        this.vaultId = vault.vaultId;
        this.deletionOnly = true;
      } finally {
        if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
      }
    });
  }
  async prepareArchiveWithdrawal(vault: Vault, state: VaultLifecycleState) {
    return this.serial(async () => {
      const g = this.generation,
        prior = await this.lifecycleLocal(vault);
      const previous: ArchiveDeletionRecord = await this.storage.get(
        this.owner + ":archive-change",
      );
      if (!previous || !this.storage.updateArchiveChange)
        throw new VaultError("archive_deletion_missing");
      const result = await this.rpc("prepareArchiveWithdrawal", {
        vault,
        state,
        record: previous,
        prior,
      });
      this.assert(g);
      await this.storage.updateArchiveChange(this.owner, result.record, previous);
      this.assert(g);
      return result.packet as import("./encrypted-types").ArchiveWithdrawalPacket;
    });
  }
  async finishArchiveDeletion(vault: Vault, state: VaultLifecycleState) {
    return this.serial(async () => {
      const g = this.generation,
        prior = await this.lifecycleLocal(vault);
      const pending = await this.storage.get(this.owner + ":archive-change");
      if (!pending || !this.storage.finishArchiveDeletion)
        throw new VaultError("archive_deletion_missing");
      const result = await this.rpc("finishArchiveDeletion", {
        vault,
        state,
        record: pending,
        prior,
      });
      this.assert(g);
      await this.storage.finishArchiveDeletion(
        this.owner,
        result.pin,
        vault.archive,
        result.record,
        pending,
      );
      this.assert(g);
      return result.outcome as import("./encrypted-types").ArchiveDeletionOutcome;
    });
  }
  async createRecoveryKit(vault: Vault, state: VaultLifecycleState): Promise<RecoveryKitExport> {
    await this.verifyLifecycle(vault, state);
    const g = this.generation,
      prior = await this.lifecycleLocal(vault);
    const result = await this.rpc("createRecoveryKit", { vault, state, prior });
    this.assert(g);
    return result;
  }
  async importRecoveryKit(
    vault: Vault,
    state: VaultLifecycleState,
    file: string,
    code: string,
  ): Promise<{ needsDeviceRegistration: boolean }> {
    const g = this.generation,
      prior = await this.lifecycleLocal(vault);
    try {
      const result = await this.rpc("importRecoveryKit", { vault, state, file, code, prior });
      this.assert(g);
      this.vaultId = vault.vaultId;
      if (vault.archive)
        this.storage.setArchiveContext?.(
          this.owner,
          requireArchive(vault.archive).credentialId,
          requireArchive(vault.archive).prfSalt,
          requireArchive(vault.archive).iv,
        );
      await this.verifyLifecycle(vault, state);
      this.assert(g);
      return result;
    } catch (error) {
      this.lock();
      throw error;
    }
  }
  async prepareArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    material: PasskeyMaterial,
    mode: "passkey_change" | "recovery",
  ): Promise<ArchiveChangePacket> {
    return this.serial(async () => {
      try {
        const g = this.generation,
          prior = await this.lifecycleLocal(vault);
        if (!this.storage.stageArchiveChange) throw new VaultError("storage_unavailable");
        const { packet, record } = await this.rpc(
          "prepareArchiveChange",
          { vault, state, material, mode, prior },
          [material.secret],
        );
        this.assert(g);
        if (!(await this.storage.stageArchiveChange(this.owner, record)))
          throw new VaultError("archive_change_pending");
        this.assert(g);
        return packet;
      } finally {
        if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
      }
    });
  }
  async inspectArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
  ): Promise<{
    archive: Archive;
    operationId: string;
    mode: "passkey_change" | "recovery";
  } | null> {
    await this.verifyLifecycle(vault, state);
    const g = this.generation,
      prior = await this.lifecycleLocal(vault),
      record = await this.storage.get(this.owner + ":archive-change");
    this.assert(g);
    if (!record) return null;
    const result = await this.rpc("inspectArchiveChange", { vault, state, record, prior });
    this.assert(g);
    return result;
  }
  async prepareArchiveCancellation(
    vault: Vault,
    state: VaultLifecycleState,
  ): Promise<{
    commands: {
      operationId: string;
      action: "recovery_authorize" | "recovery_revoke";
      authorizationId: string;
      command: import("./encrypted-types").Signed;
    }[];
  }> {
    return this.serial(async () => {
      await this.verifyLifecycle(vault, state);
      const g = this.generation,
        prior = await this.lifecycleLocal(vault),
        previous = await this.storage.get(this.owner + ":archive-change");
      this.assert(g);
      if (!previous || !this.storage.updateArchiveChange)
        throw new VaultError("archive_change_unknown");
      const result = await this.rpc("prepareArchiveCancellation", {
        vault,
        state,
        record: previous,
        prior,
      });
      this.assert(g);
      await this.storage.updateArchiveChange(this.owner, result.record, previous);
      this.assert(g);
      return result.packet;
    });
  }
  async discardArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    operationId: string,
  ): Promise<void> {
    const g = this.generation,
      prior = await this.lifecycleLocal(vault),
      record = await this.storage.get(this.owner + ":archive-change");
    this.assert(g);
    if (!record || !this.storage.discardArchiveChange)
      throw new VaultError("archive_change_unknown");
    const result = await this.rpc("discardArchiveChange", {
      vault,
      state,
      record,
      operationId,
      prior,
    });
    this.assert(g);
    await this.storage.discardArchiveChange(this.owner, result.pin, vault.archive, operationId);
    this.assert(g);
  }
  async getArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    material?: PasskeyMaterial,
  ): Promise<{ packet: ArchiveChangePacket; state: "ready" | "applied" | "conflict" } | null> {
    try {
      await this.verifyLifecycle(vault, state);
      const g = this.generation,
        prior = await this.lifecycleLocal(vault),
        record = await this.storage.get(this.owner + ":archive-change");
      this.assert(g);
      if (!record) return null;
      const packet = await this.rpc(
        "getArchiveChange",
        { vault, state, record, material, prior },
        material ? [material.secret] : [],
      );
      this.assert(g);
      const payload = JSON.parse(
        atob(packet.command.payload.replace(/-/g, "+").replace(/_/g, "/")),
      );
      const present = state.history.some((i) => i.receipt.operationId === packet.operationId);
      const stillValid =
        Number.isSafeInteger(payload.expiresAt) &&
        payload.expiresAt > Math.floor(Date.now() / 1000);
      const sameFence =
        state.vaultVersion === payload.expectedVaultVersion &&
        state.registrySequence === payload.registrySequence &&
        state.checkpointDigest === payload.checkpointDigest &&
        state.keyEpoch === payload.keyEpoch;
      const phase = present
        ? "applied"
        : stillValid &&
            sameFence &&
            (state.lifecycleVersion === payload.expectedLifecycleVersion ||
              (packet.authorization &&
                state.lifecycleVersion === payload.expectedLifecycleVersion - 1))
          ? "ready"
          : "conflict";
      return { packet, state: phase };
    } finally {
      if (material?.secret.byteLength) new Uint8Array(material.secret).fill(0);
    }
  }
  async finishArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    operationId: string,
  ): Promise<{ applied: boolean; needsDeviceRegistration: boolean }> {
    return this.serial(async () => {
      const g = this.generation,
        prior = await this.lifecycleLocal(vault);
      const result = await this.rpc("finishArchiveChange", { vault, state, operationId, prior });
      this.assert(g);
      if (!this.storage.finishArchiveChange) throw new VaultError("storage_unavailable");
      await this.storage.finishArchiveChange(
        this.owner,
        result.pin,
        vault.archive,
        result.record,
        operationId,
      );
      this.assert(g);
      this.lock();
      return { applied: result.applied, needsDeviceRegistration: result.needsDeviceRegistration };
    });
  }
  async revokeRecoveryAuthorization(vault: Vault, state: VaultLifecycleState) {
    const g = this.generation,
      prior = await this.lifecycleLocal(vault),
      result = await this.rpc("revokeRecoveryAuthorization", { vault, state, prior });
    this.assert(g);
    return result as {
      operationId: string;
      authorizationId: string;
      command: import("./encrypted-types").Signed;
    };
  }
  async openResult(args: OpenResultArgs): Promise<ResultContent> {
    const g = this.generation;
    const result = await this.rpc("openResult", args);
    this.assert(g);
    return result;
  }
  async signResultState(args: {
    metadata: ResultMetadata;
    changes: ResultStateChanges;
  }): Promise<ResultStatePacket> {
    const g = this.generation;
    const result = await this.rpc("signResultState", args);
    this.assert(g);
    return result;
  }
  private deviceChangeKey(vaultId: string) {
    if (
      !vaultId ||
      vaultId.length > 128 ||
      !/^[A-Za-z0-9]/.test(vaultId) ||
      /[^A-Za-z0-9_-]/.test(vaultId)
    )
      throw new VaultError("invalid_data");
    return this.owner + ":device-change:" + vaultId;
  }
  private async deviceChangeRow(vaultId: string) {
    const g = this.generation;
    await this.started;
    this.assert(g);
    const row = await this.storage.get(this.deviceChangeKey(vaultId));
    this.assert(g);
    if (
      row &&
      (row.ownerSubject !== this.owner ||
        row.vaultId !== vaultId ||
        typeof row.pending?.operationId !== "string" ||
        !row.pending.record)
    )
      throw new VaultError("wrong_account");
    return row;
  }
  async deviceManagement(vault: Vault): Promise<VaultManagementSummary> {
    const g = this.generation;
    return this.serial(async () => {
      const row = await this.deviceChangeRow(vault.vaultId);
      this.assert(g);
      const result = await this.rpc("deviceManagement", { vault, record: row?.pending.record });
      this.assert(g);
      try {
        await this.storage.commitVault(this.owner, result.record);
      } catch (error) {
        this.lock();
        throw error;
      }
      this.assert(g);
      this.vaultId = vault.vaultId;
      return result.summary;
    });
  }
  async prepareDeviceChange(args: {
    vault: Vault;
    action: "revoke" | "rotate";
    deviceId: string;
  }): Promise<DeviceChangePacket> {
    const g = this.generation;
    return this.serial(async () => {
      const row = await this.deviceChangeRow(args.vault.vaultId);
      this.assert(g);
      if (row) throw new VaultError("device_change_pending");
      const { localPending, ...packet } = await this.rpc("prepareDeviceChange", args);
      this.assert(g);
      if (
        !(await this.storage.stageDevice(
          this.deviceChangeKey(args.vault.vaultId),
          {
            ownerSubject: this.owner,
            vaultId: args.vault.vaultId,
            pending: { operationId: packet.operationId, record: localPending },
          },
          null,
          this.owner + ":pending-device:" + args.vault.vaultId,
        ))
      )
        throw new VaultError("device_change_pending");
      this.assert(g);
      return packet;
    });
  }
  async loadDeviceChange(vault: Vault): Promise<DeviceChangePacket | null> {
    const g = this.generation;
    const row = await this.deviceChangeRow(vault.vaultId);
    this.assert(g);
    if (!row) return null;
    const packet = await this.rpc("loadDeviceChange", { vault, record: row.pending.record });
    this.assert(g);
    if (packet.operationId !== row.pending.operationId) throw new VaultError("binding_mismatch");
    return packet;
  }
  async acceptDeviceChange(vault: Vault): Promise<VaultManagementSummary> {
    const g = this.generation;
    return this.serial(async () => {
      const row = await this.deviceChangeRow(vault.vaultId);
      this.assert(g);
      if (!row) throw new VaultError("device_change_pending");
      const result = await this.rpc("acceptDeviceChange", { vault, record: row.pending.record });
      this.assert(g);
      if (result.operationId !== row.pending.operationId) throw new VaultError("binding_mismatch");
      try {
        await this.storage.commitVault(this.owner, result.record);
        this.assert(g);
        if (
          !(await this.storage.removeOperation(
            this.deviceChangeKey(vault.vaultId),
            result.operationId,
          ))
        )
          throw new VaultError("operation_conflict");
      } catch (error) {
        this.lock();
        throw error;
      }
      this.assert(g);
      return result.summary;
    });
  }
  async discardDeviceChange(vault: Vault, operationId: string): Promise<void> {
    const g = this.generation;
    return this.serial(async () => {
      const row = await this.deviceChangeRow(vault.vaultId);
      this.assert(g);
      if (!row || row.pending.operationId !== operationId)
        throw new VaultError("operation_conflict");
      await this.rpc("discardDeviceChange", { vault, record: row.pending.record, operationId });
      this.assert(g);
      if (!(await this.storage.removeOperation(this.deviceChangeKey(vault.vaultId), operationId)))
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  async verifyRecovery(vault: Vault): Promise<RecoveryVerification> {
    const g = this.generation,
      proof = await this.rpc("verifyRecovery", { vault });
    this.assert(g);
    return proof;
  }
  async acceptVault(vault: Vault): Promise<void> {
    const g = this.generation;
    const record = await this.rpc("acceptVault", { vault });
    this.assert(g);
    try {
      await this.storage.commitVault(this.owner, record);
    } catch (error) {
      this.lock();
      throw error;
    }
    this.assert(g);
    this.vaultId = vault.vaultId;
  }
  async signSource(
    sourceId: string,
  ): Promise<{ operationId: string; command: Json; authorKeyId: string }> {
    return this.rpc("signSource", { sourceId });
  }
  private sourceCreationKey() {
    if (!this.vaultId) throw new VaultError("locked");
    return this.owner + ":source-create:" + this.vaultId;
  }
  async prepareSourceCreation(sourceId: string): Promise<SourceCreationPacket> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      this.assert(g);
      const key = this.sourceCreationKey();
      if (await this.storage.get(key)) throw new VaultError("source_creation_pending");
      this.assert(g);
      const packet = await this.rpc("prepareSourceCreation", { sourceId });
      this.assert(g);
      if (
        !(await this.storage.stageDevice(
          key,
          { ownerSubject: this.owner, vaultId: this.vaultId, pending: packet },
          null,
          this.owner + ":outbox:" + sourceId,
        ))
      )
        throw new VaultError("source_creation_pending");
      this.assert(g);
      return packet;
    });
  }
  async loadSourceCreation(): Promise<SourceCreationPacket | null> {
    const g = this.generation;
    await this.started;
    this.assert(g);
    const row = await this.storage.get(this.sourceCreationKey());
    this.assert(g);
    if (!row) return null;
    if (
      row.ownerSubject !== this.owner ||
      row.vaultId !== this.vaultId ||
      Object.keys(row).length !== 3 ||
      !Object.hasOwn(row, "pending")
    )
      throw new VaultError("wrong_account");
    const packet = await this.rpc("validateSourceCreation", { packet: row.pending });
    this.assert(g);
    return packet;
  }
  async finishSourceCreation(
    packet: SourceCreationPacket,
    source: Source,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.serial(async () => {
      const g = this.generation;
      const cancellation = signal
        ? AbortSignal.any([this.lifetime.signal, signal])
        : this.lifetime.signal;
      cancellation.throwIfAborted();
      await this.rpc("verifySourceCreation", { packet, source });
      this.assert(g);
      cancellation.throwIfAborted();
      if (!this.storage.finishSourceCreation) throw new VaultError("storage_unavailable");
      if (
        !(await this.storage.finishSourceCreation(
          this.sourceCreationKey(),
          { ownerSubject: this.owner, vaultId: this.vaultId, pending: packet },
          cancellation,
        ))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  async discardSourceCreation(
    packet: SourceCreationPacket,
    currentVault: Vault,
    sources: Source[],
    signal?: AbortSignal,
  ): Promise<void> {
    return this.serial(async () => {
      const g = this.generation;
      const cancellation = signal
        ? AbortSignal.any([this.lifetime.signal, signal])
        : this.lifetime.signal;
      cancellation.throwIfAborted();
      await this.rpc("discardSourceCreation", { packet, currentVault, sources });
      this.assert(g);
      cancellation.throwIfAborted();
      if (!this.storage.finishSourceCreation) throw new VaultError("storage_unavailable");
      if (
        !(await this.storage.finishSourceCreation(
          this.sourceCreationKey(),
          { ownerSubject: this.owner, vaultId: this.vaultId, pending: packet },
          cancellation,
        ))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  private sourceMutationKey(sourceId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sourceId)) throw new VaultError("invalid_data");
    return this.owner + ":source-mutation:" + sourceId;
  }
  async prepareSourceMutation(args: {
    source: Source;
    expectedVersion: number;
    action: SourceMutationAction;
  }): Promise<SourceMutationPacket> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      this.assert(g);
      const sourceId = args.source.resourceRef.resourceId;
      const key = this.sourceMutationKey(sourceId);
      if (await this.storage.get(key)) throw new VaultError("source_mutation_pending");
      this.assert(g);
      const packet = await this.rpc("signSourceMutation", args);
      this.assert(g);
      if (
        !(await this.storage.stageDevice(
          key,
          { ownerSubject: this.owner, vaultId: this.vaultId, pending: packet },
          null,
          this.owner + ":outbox:" + sourceId,
        ))
      )
        throw new VaultError("source_mutation_pending");
      this.assert(g);
      return packet;
    });
  }
  async loadSourceMutation(sourceId: string): Promise<SourceMutationPacket | null> {
    const g = this.generation;
    await this.started;
    this.assert(g);
    const row = await this.storage.get(this.sourceMutationKey(sourceId));
    this.assert(g);
    if (!row) return null;
    if (
      row.ownerSubject !== this.owner ||
      row.vaultId !== this.vaultId ||
      row.pending?.source?.resourceRef?.resourceId !== sourceId ||
      Object.keys(row).length !== 3 ||
      !Object.hasOwn(row, "pending")
    )
      throw new VaultError("wrong_account");
    const packet = await this.rpc("validateSourceMutation", { packet: row.pending });
    this.assert(g);
    return packet;
  }
  async verifySourceMutationReceipt(
    packet: SourceMutationPacket,
    receipt: unknown,
  ): Promise<SourceMutationReceipt> {
    const g = this.generation;
    const result = await this.rpc("verifySourceMutationReceipt", { packet, receipt });
    this.assert(g);
    return result;
  }
  async discardSourceMutation(
    packet: SourceMutationPacket,
    currentSource: Source,
    signal?: AbortSignal,
    currentAuthorityVersion?: number,
  ): Promise<void> {
    return this.serial(async () => {
      const g = this.generation;
      const cancellation = signal
        ? AbortSignal.any([this.lifetime.signal, signal])
        : this.lifetime.signal;
      cancellation.throwIfAborted();
      await this.rpc("discardSourceMutation", { packet, currentSource, currentAuthorityVersion });
      this.assert(g);
      cancellation.throwIfAborted();
      if (!this.storage.finishSourceMutation) throw new VaultError("storage_unavailable");
      if (
        !(await this.storage.finishSourceMutation(
          this.sourceMutationKey(packet.source.resourceRef.resourceId),
          { ownerSubject: this.owner, vaultId: this.vaultId, pending: packet },
          cancellation,
        ))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  async finishSourceMutation(
    packet: SourceMutationPacket,
    receipt: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.serial(async () => {
      const g = this.generation;
      const cancellation = signal
        ? AbortSignal.any([this.lifetime.signal, signal])
        : this.lifetime.signal;
      cancellation.throwIfAborted();
      const checked = await this.verifySourceMutationReceipt(packet, receipt);
      this.assert(g);
      cancellation.throwIfAborted();
      if (checked.state !== "acknowledged") throw new VaultError("operation_conflict");
      if (!this.storage.finishSourceMutation) throw new VaultError("storage_unavailable");
      if (
        !(await this.storage.finishSourceMutation(
          this.sourceMutationKey(packet.source.resourceRef.resourceId),
          { ownerSubject: this.owner, vaultId: this.vaultId, pending: packet },
          cancellation,
        ))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  async openTask(task: EncryptedTask): Promise<TaskContent> {
    const g = this.generation,
      result = await this.rpc("openTask", { task });
    this.assert(g);
    return result;
  }
  async taskAuthority(current?: EncryptedTask | null): Promise<{
    keyEpoch: number;
    registrySequence: number;
    checkpointDigest: string;
    recipientKeyIds: string[];
    previousRecipientKeyIds?: string[];
  }> {
    const g = this.generation,
      result = await this.rpc("taskAuthority", { current });
    this.assert(g);
    return result;
  }
  private persistentKey(actor: { connectionId: string; clientId: string }) {
    if (
      !this.vaultId ||
      !actor ||
      Object.keys(actor).sort().join(",") !== "clientId,connectionId" ||
      ![actor.connectionId, actor.clientId].every((id) =>
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id),
      )
    )
      throw new VaultError("invalid_data");
    return `${this.owner}:persistent-owner:${this.vaultId}:${actor.connectionId}`;
  }
  private checkPersistentRow(row: any, actor: { connectionId: string; clientId: string }) {
    if (
      row &&
      (Object.keys(row).sort().join(",") !==
        "clientId,connectionId,kind,ownerSubject,pending,vaultId" ||
        row.ownerSubject !== this.owner ||
        row.vaultId !== this.vaultId ||
        row.connectionId !== actor.connectionId ||
        row.clientId !== actor.clientId ||
        !["identity", "consent", "revocation", "publication"].includes(row.kind) ||
        !/^[A-Za-z0-9_-]{22,128}$/.test(row.pending?.operationId ?? ""))
    )
      throw new VaultError("binding_mismatch");
  }
  private async preparePersistent(method: string, args: Json): Promise<Json> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      const actor = args.actor,
        key = this.persistentKey(actor),
        row = await this.storage.get(key);
      this.assert(g);
      this.checkPersistentRow(row, actor);
      if (row) throw new VaultError("persistent_operation_pending");
      const { localPending, ...packet } = await this.rpc(method, args);
      this.assert(g);
      if (packet.kind === "no_change") return packet;
      if (
        !localPending ||
        packet.connectionId !== actor.connectionId ||
        packet.operationId !== localPending.operationId
      )
        throw new VaultError("binding_mismatch");
      const stored = {
        ownerSubject: this.owner,
        vaultId: this.vaultId,
        ...actor,
        kind: packet.kind,
        pending: { operationId: packet.operationId, record: localPending },
      };
      this.checkPersistentRow(stored, actor);
      if (!(await this.storage.insert(key, stored)))
        throw new VaultError("persistent_operation_pending");
      this.assert(g);
      return packet;
    });
  }
  async preparePersistentEnrollment(args: Json) {
    return this.preparePersistent("preparePersistentEnrollment", args);
  }
  async preparePersistentConsent(args: Json) {
    return this.preparePersistent("preparePersistentConsent", args);
  }
  async preparePersistentRevocation(args: Json) {
    return this.preparePersistent("preparePersistentRevocation", args);
  }
  async preparePersistentTask(args: Json) {
    return this.preparePersistent("preparePersistentTask", args);
  }
  async preparePersistentResource(args: Json) {
    return this.preparePersistent("preparePersistentResource", args);
  }
  async verifyPersistentIdentity(args: Json) {
    const g = this.generation;
    const value = await this.rpc("verifyPersistentIdentity", args);
    this.assert(g);
    return value;
  }
  async verifyIndependentAgent(args: Json) {
    const g = this.generation,
      value = await this.rpc("verifyIndependentAgent", args);
    this.assert(g);
    return value;
  }
  async signIndependentPolicyControl(args: Json) {
    const g = this.generation,
      value = await this.rpc("signIndependentPolicyControl", args);
    this.assert(g);
    return value;
  }
  async verifyPersistentPolicy(args: Json) {
    const g = this.generation;
    const value = await this.rpc("verifyPersistentPolicy", args);
    this.assert(g);
    return value;
  }
  async loadPersistentPending(actor: {
    connectionId: string;
    clientId: string;
  }): Promise<Json | null> {
    const g = this.generation;
    await this.started;
    const row = await this.storage.get(this.persistentKey(actor));
    this.assert(g);
    this.checkPersistentRow(row, actor);
    if (!row) return null;
    const packet = await this.rpc("openPersistentPending", {
      record: row.pending.record,
      operationId: row.pending.operationId,
      connectionId: actor.connectionId,
    });
    this.assert(g);
    if (packet.kind !== row.kind) throw new VaultError("binding_mismatch");
    return packet;
  }
  async listPersistentOutbox() {
    const g = this.generation;
    await this.started;
    if (!this.vaultId) throw new VaultError("locked");
    const rows = await this.storage.list(`${this.owner}:persistent-owner:${this.vaultId}:`);
    this.assert(g);
    if (rows.length > 80) throw new VaultError("invalid_data");
    return rows.map(({ key, value }) => {
      const actor = { connectionId: value.connectionId, clientId: value.clientId };
      this.checkPersistentRow(value, actor);
      if (key !== this.persistentKey(actor)) throw new VaultError("binding_mismatch");
      return { ...actor, kind: value.kind, operationId: value.pending.operationId };
    });
  }
  async finishPersistentPending(actor: { connectionId: string; clientId: string }, receipt: Json) {
    return this.serial(async () => {
      const g = this.generation,
        packet = await this.loadPersistentPending(actor);
      this.assert(g);
      if (!packet) throw new VaultError("not_found");
      const result = await this.rpc("verifyPersistentReceipt", { packet, receipt });
      this.assert(g);
      if (
        result.operationId !== packet.operationId ||
        !(await this.storage.removeOperation(this.persistentKey(actor), result.operationId))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
      return result;
    });
  }
  async verifyPersistentPlan(args: Json) {
    const g = this.generation,
      value = await this.rpc("verifyPersistentPlan", args);
    this.assert(g);
    return value;
  }
  async signPersistentResultState(args: Json): Promise<ResultStatePacket> {
    const g = this.generation,
      value = await this.rpc("signPersistentResultState", args);
    this.assert(g);
    return value;
  }
  async openPersistentResult(args: Json) {
    const g = this.generation,
      value = await this.rpc("openPersistentResult", args);
    this.assert(g);
    return value;
  }

  async publicAgentAnchor(args: {
    connectionId: string;
    agentPrincipalId: string;
    taskId: string;
  }): Promise<AgentAnchor> {
    const g = this.generation,
      result = await this.rpc("publicAgentAnchor", args);
    this.assert(g);
    return result;
  }
  async inspectAgentOffer(args: { offer: HelperPublicOffer }) {
    const g = this.generation,
      result = await this.rpc("inspectAgentOffer", args);
    this.assert(g);
    return result as {
      offerFingerprint: string;
      registrySequence: number;
      checkpointDigest: string;
      existingConnectionKeyIds: string[];
      registered: boolean;
      registeredExpiresAt: number | null;
      agentSigningKeyEpoch: number;
      agentEncryptionKeyEpoch: number;
    };
  }
  private sameAgentPublic(a: unknown, b: unknown) {
    const ordered = (_key: string, value: any) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )
        : value;
    return JSON.stringify(a, ordered) === JSON.stringify(b, ordered);
  }
  private agentKey(kind: AgentPendingKind, connectionId: string, taskId: string) {
    if (
      !this.vaultId ||
      ![connectionId, taskId].every((id) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))
    )
      throw new VaultError("invalid_data");
    return this.owner + ":agent-" + kind + ":" + this.vaultId + ":" + connectionId + ":" + taskId;
  }
  private checkAgentRow(row: any, kind: AgentPendingKind, connectionId: string, taskId: string) {
    if (
      row &&
      (row.ownerSubject !== this.owner ||
        row.vaultId !== this.vaultId ||
        row.kind !== kind ||
        row.connectionId !== connectionId ||
        row.taskId !== taskId ||
        typeof row.pending?.operationId !== "string")
    )
      throw new VaultError("wrong_account");
  }
  async prepareAgentRegistration(args: {
    offer: HelperPublicOffer;
    ttlSeconds: number;
    replaceKeyIds?: string[];
  }): Promise<AgentRegistration> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      const connectionId = args.offer.anchor.connectionId,
        taskId = args.offer.anchor.taskId,
        key = this.agentKey("registration", connectionId, taskId),
        row = await this.storage.get(key);
      this.assert(g);
      this.checkAgentRow(row, "registration", connectionId, taskId);
      if (row) {
        const current = await this.loadAgentRegistration(connectionId, taskId),
          review = await this.inspectAgentOffer({ offer: args.offer });
        this.assert(g);
        if (current && current.offerFingerprint === review.offerFingerprint) return current;
        throw new VaultError("pending_registration");
      }
      const { localPending, ...packet } = await this.rpc("prepareAgentRegistration", args);
      this.assert(g);
      if (
        !(await this.storage.insert(key, {
          ownerSubject: this.owner,
          vaultId: this.vaultId,
          kind: "registration",
          connectionId,
          taskId,
          pending: { operationId: packet.operationId, record: localPending },
        }))
      )
        throw new VaultError("pending_registration");
      this.assert(g);
      return packet;
    });
  }
  async listAgentOutbox(): Promise<
    { kind: AgentPendingKind; connectionId: string; taskId: string; operationId: string }[]
  > {
    const g = this.generation;
    await this.started;
    if (!this.vaultId) throw new VaultError("locked");
    const output: {
      kind: AgentPendingKind;
      connectionId: string;
      taskId: string;
      operationId: string;
    }[] = [];
    for (const kind of ["registration", "approval", "preparation"] as const) {
      const prefix = this.owner + ":agent-" + kind + ":" + this.vaultId + ":";
      const rows = await this.storage.list(prefix);
      this.assert(g);
      if (rows.length > 80) throw new VaultError("invalid_data");
      for (const { key, value } of rows) {
        this.checkAgentRow(value, kind, value.connectionId, value.taskId);
        if (key !== this.agentKey(kind, value.connectionId, value.taskId))
          throw new VaultError("binding_mismatch");
        output.push({
          kind,
          connectionId: value.connectionId,
          taskId: value.taskId,
          operationId: value.pending.operationId,
        });
      }
    }
    return output;
  }
  async loadAgentRegistration(
    connectionId: string,
    taskId: string,
  ): Promise<AgentRegistration | null> {
    return this.loadAgentPending(
      "registration",
      connectionId,
      taskId,
    ) as Promise<AgentRegistration | null>;
  }
  async loadAgentApproval(
    connectionId: string,
    taskId: string,
  ): Promise<AgentApprovalPacket | null> {
    return this.loadAgentPending(
      "approval",
      connectionId,
      taskId,
    ) as Promise<AgentApprovalPacket | null>;
  }
  async clearAgentApproval(connectionId: string, taskId: string, operationId: string) {
    return this.clearAgentPending("approval", connectionId, taskId, operationId);
  }
  async loadAgentPreparation(
    connectionId: string,
    taskId: string,
  ): Promise<AgentPreparationPacket | null> {
    return this.loadAgentPending(
      "preparation",
      connectionId,
      taskId,
    ) as Promise<AgentPreparationPacket | null>;
  }
  private async loadAgentPending(kind: AgentPendingKind, connectionId: string, taskId: string) {
    const g = this.generation;
    await this.started;
    const row = await this.storage.get(this.agentKey(kind, connectionId, taskId));
    this.assert(g);
    this.checkAgentRow(row, kind, connectionId, taskId);
    if (!row) return null;
    const packet = await this.rpc("openAgentPending", {
      kind,
      connectionId,
      taskId,
      record: row.pending.record,
    });
    this.assert(g);
    const operationId = kind !== "preparation" ? packet.operationId : packet.commit.operationId;
    if (operationId !== row.pending.operationId) throw new VaultError("binding_mismatch");
    return packet;
  }
  async clearAgentRegistration(connectionId: string, taskId: string, operationId: string) {
    return this.clearAgentPending("registration", connectionId, taskId, operationId);
  }
  async clearAgentPreparation(connectionId: string, taskId: string, operationId: string) {
    return this.clearAgentPending("preparation", connectionId, taskId, operationId);
  }
  private async clearAgentPending(
    kind: AgentPendingKind,
    connectionId: string,
    taskId: string,
    operationId: string,
  ) {
    const g = this.generation;
    return this.serial(async () => {
      await this.started;
      this.assert(g);
      if (!/^[A-Za-z0-9_-]{22,128}$/.test(operationId)) throw new VaultError("invalid_data");
      if (
        !(await this.storage.removeOperation(
          this.agentKey(kind, connectionId, taskId),
          operationId,
        ))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  async signAgentGrants(args: AgentGrantArgs): Promise<AgentApprovalPacket> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      const connectionId = args.offer.anchor.connectionId,
        taskId = args.offer.anchor.taskId,
        key = this.agentKey("approval", connectionId, taskId),
        row = await this.storage.get(key);
      this.assert(g);
      this.checkAgentRow(row, "approval", connectionId, taskId);
      if (row) {
        const packet = await this.loadAgentApproval(connectionId, taskId),
          review = await this.inspectAgentOffer({ offer: args.offer });
        this.assert(g);
        if (
          packet &&
          packet.offerFingerprint === review.offerFingerprint &&
          this.sameAgentPublic(packet.authorization, args.authorization)
        )
          return packet;
        throw new VaultError("pending_approval");
      }
      const { localPending, ...packet } = await this.rpc("signAgentGrants", args);
      this.assert(g);
      if (
        !(await this.storage.insert(key, {
          ownerSubject: this.owner,
          vaultId: this.vaultId,
          kind: "approval",
          connectionId,
          taskId,
          pending: { operationId: packet.operationId, record: localPending },
        }))
      )
        throw new VaultError("pending_approval");
      this.assert(g);
      return packet;
    });
  }
  async sealAgentPreparation(args: AgentPreparationArgs): Promise<AgentPreparationPacket> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      const connectionId = args.intent.connectionId,
        taskId = args.intent.taskId,
        key = this.agentKey("preparation", connectionId, taskId),
        row = await this.storage.get(key);
      this.assert(g);
      this.checkAgentRow(row, "preparation", connectionId, taskId);
      if (row) throw new VaultError("pending_preparation");
      const { localPending, ...packet } = await this.rpc("sealAgentPreparation", args);
      this.assert(g);
      if (
        !(await this.storage.insert(key, {
          ownerSubject: this.owner,
          vaultId: this.vaultId,
          kind: "preparation",
          connectionId,
          taskId,
          pending: { operationId: packet.commit.operationId, record: localPending },
        }))
      )
        throw new VaultError("pending_preparation");
      this.assert(g);
      return packet;
    });
  }
  private taskKey(kind: "draft" | "outbox", slot: string) {
    if (!this.vaultId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(slot))
      throw new VaultError("invalid_data");
    return this.owner + ":task-" + kind + ":" + this.vaultId + ":" + slot;
  }
  private checkTaskRow(row: any, slot: string, kind: "draft" | "outbox") {
    if (
      row &&
      (row.ownerSubject !== this.owner ||
        row.vaultId !== this.vaultId ||
        row.slot !== slot ||
        row.kind !== kind ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 1)
    )
      throw new VaultError("wrong_account");
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const job = this.saving.then(action);
    this.saving = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
  private async prepareTaskOperation(
    method: "sealTask" | "transitionTask",
    args: SealTaskArgs | { current: EncryptedTask; action: TaskAction },
  ): Promise<PendingTask> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      const taskId =
        args.current?.metadata.taskId ??
        ("taskId" in args ? args.taskId : undefined) ??
        "task_" + crypto.randomUUID().replace(/-/g, "");
      const key = this.taskKey("outbox", taskId),
        row = await this.storage.get(key);
      this.assert(g);
      this.checkTaskRow(row, taskId, "outbox");
      if (row && !row.deleted) throw new VaultError("pending_upload");
      const value = await this.rpc(method, method === "sealTask" ? { ...args, taskId } : args);
      this.assert(g);
      if (
        !(await this.storage.compareTaskRecord(
          key,
          {
            ownerSubject: this.owner,
            vaultId: this.vaultId,
            slot: taskId,
            kind: "outbox",
            revision: (row?.revision ?? 0) + 1,
            pending: value,
          },
          row?.revision ?? 0,
        ))
      )
        throw new VaultError("pending_upload");
      this.assert(g);
      return value;
    });
  }
  sealTask(args: SealTaskArgs): Promise<PendingTask> {
    return this.prepareTaskOperation("sealTask", args);
  }
  transitionTask(args: { current: EncryptedTask; action: TaskAction }): Promise<PendingTask> {
    return this.prepareTaskOperation("transitionTask", args);
  }
  async validateTaskPending(pending: PendingTask): Promise<PendingTask> {
    const g = this.generation,
      result = await this.rpc("validateTaskPending", { pending });
    this.assert(g);
    return result;
  }
  async loadTaskOutbox(taskId: string): Promise<PendingTask | null> {
    const g = this.generation;
    await this.started;
    const row = await this.storage.get(this.taskKey("outbox", taskId));
    this.assert(g);
    this.checkTaskRow(row, taskId, "outbox");
    if (!row || row.deleted) return null;
    if (row.pending?.taskId !== taskId) throw new VaultError("binding_mismatch");
    return this.validateTaskPending(row.pending);
  }
  async listTaskOutbox(): Promise<TaskOutboxSummary[]> {
    const g = this.generation;
    await this.started;
    const prefix = this.taskKey("outbox", "prefix").slice(0, -6),
      rows = await this.storage.list(prefix);
    this.assert(g);
    return rows
      .filter(({ value }) => !value.deleted)
      .map(({ key, value }) => {
        const taskId = key.slice(prefix.length);
        this.checkTaskRow(value, taskId, "outbox");
        if (value.pending?.taskId !== taskId) throw new VaultError("binding_mismatch");
        const p = value.pending;
        return {
          taskId,
          operationId: p.operationId,
          mode: p.mode,
          keyEpoch: p.keyEpoch,
          expectedVersion: p.body.expectedVersion,
        };
      });
  }
  async clearTaskOutbox(taskId: string, operationId: string): Promise<void> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      this.assert(g);
      if (this.renewalOnly || (await this.keyRenewalRow()))
        throw new VaultError("key_renewal_pending");
      if (await this.storage.get(this.uploadCancellationKey("task", taskId)))
        throw new VaultError("upload_cancellation_pending");
      const key = this.taskKey("outbox", taskId),
        row = await this.storage.get(key);
      this.assert(g);
      this.checkTaskRow(row, taskId, "outbox");
      if (!row || row.deleted) return;
      if (
        row.pending?.operationId !== operationId ||
        !(await this.storage.compareTaskRecord(
          key,
          {
            ownerSubject: this.owner,
            vaultId: this.vaultId,
            slot: taskId,
            kind: "outbox",
            revision: row.revision + 1,
            deleted: true,
          },
          row.revision,
        ))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  private uploadCancellationKey(kind: UploadCancellationKind, slot: string) {
    if (
      !["task", "holdings"].includes(kind) ||
      !this.vaultId ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(slot)
    )
      throw new VaultError("invalid_data");
    return `${this.owner}:upload-cancellation:${this.vaultId}:${kind}:${slot}`;
  }
  private checkUploadCancellationRow(key: string, row: any) {
    if (
      !row ||
      row.ownerSubject !== this.owner ||
      row.vaultId !== this.vaultId ||
      key !== this.uploadCancellationKey(row.kind, row.slot) ||
      Object.keys(row).length !== 7 ||
      !["ownerSubject", "vaultId", "kind", "slot", "originalKey", "original", "packet"].every((f) =>
        Object.hasOwn(row, f),
      ) ||
      row.original?.ownerSubject !== this.owner ||
      row.original?.vaultId !== this.vaultId ||
      row.originalKey !==
        (row.kind === "task"
          ? this.taskKey("outbox", row.slot)
          : this.owner + ":outbox:" + row.slot)
    )
      throw new VaultError("wrong_account");
    if (row.kind === "task") {
      this.checkRenewalTaskRow(row.original, row.slot);
      if (row.original.deleted) throw new VaultError("binding_mismatch");
    } else if (
      Object.keys(row.original).length !== 3 ||
      row.original.pending?.source?.resourceRef?.resourceId !== row.slot
    )
      throw new VaultError("binding_mismatch");
  }
  async listRenewalUploadCancellations(
    kind: UploadCancellationKind,
  ): Promise<PendingUploadCancellation[]> {
    const g = this.generation;
    await this.started;
    this.assert(g);
    if (!this.renewalOnly) throw new VaultError("invalid_operation");
    const prefix = this.uploadCancellationKey(kind, "prefix").slice(0, -6);
    const rows = await this.storage.list(prefix);
    this.assert(g);
    if (rows.length > 32) throw new VaultError("capacity");
    const result: PendingUploadCancellation[] = [];
    for (const { key, value } of rows) {
      this.checkUploadCancellationRow(key, value);
      await this.rpc("validateUploadCancellation", {
        kind,
        pending: value.original.pending,
        packet: value.packet,
      });
      this.assert(g);
      result.push({
        kind,
        slot: value.slot,
        pending: value.original.pending,
        packet: value.packet,
      });
    }
    return result;
  }
  prepareRenewalUploadCancellation(
    kind: UploadCancellationKind,
    slot: string,
    expected: PendingTask | PendingSnapshot,
  ): Promise<PendingUploadCancellation> {
    const pending = structuredClone(expected);
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      this.assert(g);
      if (!this.renewalOnly) throw new VaultError("invalid_operation");
      if (await this.keyRenewalRow()) throw new VaultError("key_renewal_pending");
      const key = this.uploadCancellationKey(kind, slot),
        prior = await this.storage.get(key);
      this.assert(g);
      if (prior) {
        this.checkUploadCancellationRow(key, prior);
        if (!sameEncryptedRecord(prior.original.pending, pending))
          throw new VaultError("operation_conflict");
        await this.rpc("validateUploadCancellation", { kind, pending, packet: prior.packet });
        this.assert(g);
        return { kind, slot, pending, packet: prior.packet };
      }
      const originalKey =
        kind === "task" ? this.taskKey("outbox", slot) : this.owner + ":outbox:" + slot;
      const original = await this.storage.get(originalKey);
      this.assert(g);
      if (!original || !sameEncryptedRecord(original.pending, pending))
        throw new VaultError("operation_conflict");
      const packet: UploadCancellationPacket = await this.rpc("prepareUploadCancellation", {
        kind,
        pending,
      });
      this.assert(g);
      const row = {
        ownerSubject: this.owner,
        vaultId: this.vaultId,
        kind,
        slot,
        originalKey,
        original,
        packet,
      };
      this.checkUploadCancellationRow(key, row);
      if (
        !this.storage.stageUploadCancellation ||
        !(await this.storage.stageUploadCancellation(key, row, this.lifetime.signal))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
      return { kind, slot, pending, packet };
    });
  }
  async verifyRenewalUploadCancellation(
    record: PendingUploadCancellation,
    value: Json,
  ): Promise<{ outcome: "saved" | "cancelled" }> {
    const g = this.generation;
    await this.started;
    this.assert(g);
    if (!this.renewalOnly) throw new VaultError("invalid_operation");
    const key = this.uploadCancellationKey(record.kind, record.slot),
      saved = await this.storage.get(key);
    this.assert(g);
    this.checkUploadCancellationRow(key, saved);
    if (
      !sameEncryptedRecord(saved.packet, record.packet) ||
      !sameEncryptedRecord(saved.original.pending, record.pending)
    )
      throw new VaultError("operation_conflict");
    const result = await this.rpc("verifyUploadCancellationReceipt", {
      kind: record.kind,
      pending: record.pending,
      packet: record.packet,
      value,
    });
    this.assert(g);
    return result;
  }
  finishRenewalUploadCancellation(
    record: PendingUploadCancellation,
    value: Json,
    evidence?: any,
  ): Promise<void> {
    const expected = structuredClone(record),
      reply = structuredClone(value),
      proof = structuredClone(evidence);
    return this.serial(async () => {
      const g = this.generation;
      const outcome = await this.verifyRenewalUploadCancellation(expected, reply);
      this.assert(g);
      if (outcome.outcome === "saved") {
        if (expected.kind === "task")
          await this.rpc("verifyRenewalTaskReceipt", {
            pending: expected.pending,
            value: proof?.task,
          });
        else
          await this.rpc("verifyRenewalHoldingsReceipt", {
            pending: expected.pending,
            receipt: proof?.receipt,
            value: proof?.snapshot,
          });
        this.assert(g);
      }
      const key = this.uploadCancellationKey(expected.kind, expected.slot),
        saved = await this.storage.get(key);
      this.assert(g);
      this.checkUploadCancellationRow(key, saved);
      if (
        !sameEncryptedRecord(saved.packet, expected.packet) ||
        !sameEncryptedRecord(saved.original.pending, expected.pending)
      )
        throw new VaultError("operation_conflict");
      if (
        !this.storage.finishUploadCancellation ||
        !(await this.storage.finishUploadCancellation(key, saved, this.lifetime.signal))
      )
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  private checkRenewalTaskRow(row: any, taskId: string) {
    this.checkTaskRow(row, taskId, "outbox");
    if (row) {
      const fields = [
        "ownerSubject",
        "vaultId",
        "slot",
        "kind",
        "revision",
        row.deleted === true ? "deleted" : "pending",
      ];
      if (
        Object.keys(row).length !== fields.length ||
        fields.some((name) => !Object.hasOwn(row, name)) ||
        (row.deleted !== true && row.pending?.taskId !== taskId)
      )
        throw new VaultError("binding_mismatch");
    }
  }
  private async renewalTaskRow(taskId: string) {
    const g = this.generation;
    await this.started;
    this.assert(g);
    if (!this.renewalOnly) throw new VaultError("invalid_operation");
    const key = this.taskKey("outbox", taskId),
      row = await this.storage.get(key);
    this.assert(g);
    this.checkRenewalTaskRow(row, taskId);
    return { key, row };
  }
  async loadRenewalTaskOutbox(taskId: string): Promise<PendingTask | null> {
    const g = this.generation,
      { row } = await this.renewalTaskRow(taskId);
    if (!row || row.deleted === true) return null;
    const result = await this.rpc("inspectRenewalTaskPending", { pending: row.pending });
    this.assert(g);
    return result;
  }
  async listRenewalTaskOutbox(): Promise<PendingTask[]> {
    const g = this.generation;
    await this.started;
    this.assert(g);
    if (!this.renewalOnly) throw new VaultError("invalid_operation");
    const prefix = this.taskKey("outbox", "prefix").slice(0, -6),
      rows = await this.storage.list(prefix),
      result: PendingTask[] = [];
    this.assert(g);
    for (const { key, value } of rows) {
      const taskId = key.slice(prefix.length);
      if (this.taskKey("outbox", taskId) !== key) throw new VaultError("wrong_account");
      this.checkRenewalTaskRow(value, taskId);
    }
    // Bound one UI review batch. Remaining original rows continue to block renewal.
    for (const { key } of rows.filter(({ value }) => value.deleted !== true).slice(0, 32)) {
      const pending = await this.loadRenewalTaskOutbox(key.slice(prefix.length));
      this.assert(g);
      if (pending) result.push(pending);
    }
    return result;
  }
  async verifyRenewalTaskReceipt(pending: PendingTask, value: EncryptedTask): Promise<void> {
    const g = this.generation,
      packet = structuredClone({ pending, value }),
      { row } = await this.renewalTaskRow(packet.pending?.taskId);
    if (!row || row.deleted === true || !sameEncryptedRecord(row.pending, packet.pending))
      throw new VaultError("operation_conflict");
    await this.rpc("verifyRenewalTaskReceipt", packet);
    this.assert(g);
  }
  reconcileRenewalTaskOutbox(pending: PendingTask, value: EncryptedTask): Promise<void> {
    const packet = structuredClone({ pending, value });
    return this.serial(async () => {
      const g = this.generation,
        { key, row } = await this.renewalTaskRow(packet.pending?.taskId);
      if (!row || row.deleted === true || !sameEncryptedRecord(row.pending, packet.pending))
        throw new VaultError("operation_conflict");
      await this.rpc("verifyRenewalTaskReceipt", packet);
      this.assert(g);
      if (!this.storage.reconcileTaskOutbox) throw new VaultError("storage_unavailable");
      if (!(await this.storage.reconcileTaskOutbox(key, row, this.lifetime.signal)))
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  async saveTaskDraft(args: {
    slot: string;
    expectedRevision: number;
    baseVersion: number;
    taskId: string;
    draft: TaskDraft;
  }): Promise<TaskDraftSummary> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      const key = this.taskKey("draft", args.slot),
        row = await this.storage.get(key);
      this.assert(g);
      this.checkTaskRow(row, args.slot, "draft");
      const currentRevision = row?.revision ?? 0;
      if (
        args.expectedRevision !== currentRevision &&
        !(args.expectedRevision === 0 && row?.deleted)
      )
        throw new VaultError("draft_conflict");
      const summary = {
        slot: args.slot,
        revision: currentRevision + 1,
        baseVersion: args.baseVersion,
        taskId: args.taskId,
      };
      const sealed = await this.rpc("sealDraft", { ...summary, draft: args.draft });
      this.assert(g);
      if (
        !(await this.storage.compareTaskRecord(
          key,
          {
            ownerSubject: this.owner,
            vaultId: this.vaultId,
            slot: args.slot,
            kind: "draft",
            revision: summary.revision,
            sealed,
          },
          currentRevision,
        ))
      )
        throw new VaultError("draft_conflict");
      this.assert(g);
      return summary;
    });
  }
  async loadTaskDraft(slot: string): Promise<TaskDraftRecord | null> {
    const g = this.generation;
    await this.started;
    const row = await this.storage.get(this.taskKey("draft", slot));
    this.assert(g);
    this.checkTaskRow(row, slot, "draft");
    if (!row || row.deleted) return null;
    if (row.sealed?.slot !== slot || row.sealed.revision !== row.revision)
      throw new VaultError("binding_mismatch");
    const result = await this.rpc("openDraft", { record: row.sealed });
    this.assert(g);
    return result;
  }
  async listTaskDrafts(): Promise<TaskDraftSummary[]> {
    const g = this.generation;
    await this.started;
    const prefix = this.taskKey("draft", "prefix").slice(0, -6),
      rows = await this.storage.list(prefix);
    this.assert(g);
    return rows
      .filter(({ value }) => !value.deleted)
      .map(({ key, value }) => {
        const slot = key.slice(prefix.length);
        this.checkTaskRow(value, slot, "draft");
        if (value.sealed?.slot !== slot || value.sealed.revision !== value.revision)
          throw new VaultError("binding_mismatch");
        return {
          slot,
          revision: value.revision,
          baseVersion: value.sealed.baseVersion,
          taskId: value.sealed.taskId,
        };
      });
  }
  async clearTaskDraft(slot: string, expectedRevision: number): Promise<void> {
    return this.serial(async () => {
      const g = this.generation;
      await this.started;
      const key = this.taskKey("draft", slot),
        row = await this.storage.get(key);
      this.assert(g);
      this.checkTaskRow(row, slot, "draft");
      if (!row || row.deleted) return;
      if (
        row.revision !== expectedRevision ||
        !(await this.storage.compareTaskRecord(
          key,
          {
            ownerSubject: this.owner,
            vaultId: this.vaultId,
            slot,
            kind: "draft",
            revision: row.revision + 1,
            deleted: true,
          },
          row.revision,
        ))
      )
        throw new VaultError("draft_conflict");
      this.assert(g);
    });
  }
  async sealSnapshot(args: {
    content: Json;
    source: Source;
    expectedRevision: number;
    snapshotId?: string;
    operationId?: string;
  }): Promise<PendingSnapshot> {
    const job = this.saving.then(async () => {
      const g = this.generation;
      if (await this.loadOutbox(args.source.resourceRef.resourceId))
        throw new VaultError("pending_upload");
      const value = await this.rpc("sealSnapshot", args);
      this.assert(g);
      if (
        !(await this.storage.stageDevice(
          this.owner + ":outbox:" + args.source.resourceRef.resourceId,
          {
            ownerSubject: this.owner,
            vaultId: this.vaultId,
            pending: value,
          },
          null,
          this.sourceMutationKey(args.source.resourceRef.resourceId),
        ))
      )
        throw new VaultError("pending_upload");
      this.assert(g);
      return value;
    });
    this.saving = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
  async openSnapshot(value: SnapshotResponse, source: Source): Promise<Json> {
    return this.rpc("openSnapshot", { value, source });
  }
  async verifyReceipt(pending: PendingSnapshot, receipt: unknown): Promise<void> {
    return this.rpc("verifyReceipt", { pending, receipt });
  }
  async loadOutbox(sourceId: string): Promise<PendingSnapshot | null> {
    const g = this.generation;
    await this.started;
    const row = await this.storage.get(this.owner + ":outbox:" + sourceId);
    this.assert(g);
    if (!row) return null;
    if (
      row.ownerSubject !== this.owner ||
      row.vaultId !== this.vaultId ||
      row.pending?.source?.resourceRef?.resourceId !== sourceId
    )
      throw new VaultError("wrong_account");
    return this.rpc("validatePending", { pending: row.pending });
  }
  async clearOutbox(sourceId: string, operationId: string): Promise<void> {
    if (await this.storage.get(this.uploadCancellationKey("holdings", sourceId)))
      throw new VaultError("upload_cancellation_pending");
    const row = await this.loadOutbox(sourceId);
    if (row && row.operationId !== operationId) throw new VaultError("operation_conflict");
    if (!(await this.storage.removeOperation(this.owner + ":outbox:" + sourceId, operationId)))
      throw new VaultError("operation_conflict");
  }
  private async renewalHoldingsRow(sourceId: string) {
    const g = this.generation;
    await this.started;
    this.assert(g);
    if (!this.renewalOnly) throw new VaultError("invalid_operation");
    if (!this.vaultId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sourceId))
      throw new VaultError("invalid_data");
    const key = this.owner + ":outbox:" + sourceId,
      row = await this.storage.get(key);
    this.assert(g);
    if (
      row &&
      (row.ownerSubject !== this.owner ||
        row.vaultId !== this.vaultId ||
        row.pending?.source?.resourceRef?.kind !== "holdings" ||
        row.pending?.source?.resourceRef?.sourceService !== "portfolio" ||
        row.pending?.source?.resourceRef?.resourceId !== sourceId ||
        Object.keys(row).length !== 3)
    )
      throw new VaultError("wrong_account");
    return { key, row };
  }
  async loadRenewalHoldingsOutbox(sourceId: string): Promise<PendingSnapshot | null> {
    const g = this.generation,
      { row } = await this.renewalHoldingsRow(sourceId);
    if (!row) return null;
    const result = await this.rpc("inspectRenewalHoldingsPending", { pending: row.pending });
    this.assert(g);
    return result;
  }
  async verifyRenewalHoldingsReceipt(
    pending: PendingSnapshot,
    receipt: unknown,
    value: SnapshotResponse,
  ): Promise<void> {
    const g = this.generation,
      packet = structuredClone({ pending, receipt, value }),
      { row } = await this.renewalHoldingsRow(packet.pending?.source?.resourceRef?.resourceId);
    if (!row || !sameEncryptedRecord(row.pending, packet.pending))
      throw new VaultError("operation_conflict");
    await this.rpc("verifyRenewalHoldingsReceipt", packet);
    this.assert(g);
  }
  reconcileRenewalHoldingsOutbox(
    pending: PendingSnapshot,
    receipt: unknown,
    value: SnapshotResponse,
  ): Promise<void> {
    const packet = structuredClone({ pending, receipt, value });
    return this.serial(async () => {
      const g = this.generation,
        { key, row } = await this.renewalHoldingsRow(
          packet.pending?.source?.resourceRef?.resourceId,
        );
      if (!row || !sameEncryptedRecord(row.pending, packet.pending))
        throw new VaultError("operation_conflict");
      await this.rpc("verifyRenewalHoldingsReceipt", packet);
      this.assert(g);
      if (!this.storage.reconcileHoldingsOutbox) throw new VaultError("storage_unavailable");
      if (!(await this.storage.reconcileHoldingsOutbox(key, row, this.lifetime.signal)))
        throw new VaultError("operation_conflict");
      this.assert(g);
    });
  }
  release() {
    this.close(true);
  }
  lock() {
    this.close(false);
  }
  private close(detach: boolean) {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.lifetime.abort();
    if (detach && this.worker.release) this.worker.release();
    else this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new VaultError("locked"));
    this.pending.clear();
  }
}
