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
  type TaskContent,
  type TaskDraft,
  type TaskDraftSummary,
  type TaskDraftRecord,
  type TaskAction,
  type EncryptedTask,
  type PendingTask,
  type SealTaskArgs,
  type TaskOutboxSummary,
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
