/** Public worker bridge: returned objects contain public controls/ciphertext only. */
import { BrowserEncryptedStorage, type EncryptedStorage } from "./encrypted-storage";
import {
  VaultError,
  type Vault,
  type PasskeyMaterial,
  type Source,
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
} from "./encrypted-types";
export type {
  Vault,
  Source,
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
export class EncryptedVaultSession {
  private readonly worker: Worker;
  private readonly storage: EncryptedStorage;
  private readonly started: Promise<void>;
  private owner = "";
  private vaultId = "";
  private generation = 0;
  private next = 0;
  private closed = false;
  private saving: Promise<void> = Promise.resolve();
  private pending = new Map<
    number,
    { generation: number; resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  constructor(
    uid: string,
    options: { storage?: EncryptedStorage; workerFactory?: () => Worker } = {},
  ) {
    this.storage = options.storage ?? new BrowserEncryptedStorage();
    this.worker =
      options.workerFactory?.() ??
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
    this.worker.onerror = () => this.lock();
    this.started = this.send("init", { uid }).then((value) => {
      this.owner = value.ownerSubject;
    });
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
    return this.send(method, args, transfer);
  }
  private assert(generation: number) {
    if (this.closed || generation !== this.generation) throw new VaultError("locked");
  }
  private async local(vaultId: string) {
    const g = this.generation;
    await this.started;
    const record = await this.storage.get(this.owner + ":device:" + vaultId),
      pin = await this.storage.get(this.owner + ":pin");
    const pending = await this.storage.get(this.owner + ":pending-device:" + vaultId);
    this.assert(g);
    if (record && record.ownerSubject !== this.owner) throw new VaultError("wrong_account");
    if (pin && pin.ownerSubject !== this.owner) throw new VaultError("wrong_account");
    if (pending && pending.ownerSubject !== this.owner) throw new VaultError("wrong_account");
    return { pin: pin ?? undefined, device: record?.device, pending: pending?.pending };
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
      const local = await this.local(vault.vaultId);
      const value = await this.rpc("unlock", { vault, material, local }, [material.secret]);
      this.assert(g);
      this.vaultId = vault.vaultId;
      return value;
    } finally {
      if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
    }
  }
  async prepareDeviceRegistration(vault: Vault): Promise<Registration> {
    const g = this.generation;
    const { localPending, previousPending, ...result } = await this.rpc(
      "prepareDeviceRegistration",
      { vault },
    );
    this.assert(g);
    if (
      !(await this.storage.stageDevice(
        this.owner + ":pending-device:" + vault.vaultId,
        { ownerSubject: this.owner, pending: localPending },
        previousPending,
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
      const local = await this.local(vault.vaultId);
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
        !(await this.storage.insert(this.owner + ":outbox:" + args.source.resourceRef.resourceId, {
          ownerSubject: this.owner,
          vaultId: this.vaultId,
          pending: value,
        }))
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
    const row = await this.loadOutbox(sourceId);
    if (row && row.operationId !== operationId) throw new VaultError("operation_conflict");
    if (!(await this.storage.removeOperation(this.owner + ":outbox:" + sourceId, operationId)))
      throw new VaultError("operation_conflict");
  }
  lock() {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new VaultError("locked"));
    this.pending.clear();
  }
}
