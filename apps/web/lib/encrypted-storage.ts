/** Browser-owned ciphertext and public pins only; every shared mutation is atomic. */
import { VaultError } from "./encrypted-types";
export interface EncryptedStorage {
  get(key: string): Promise<any>;
  put(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
  insert(key: string, value: any): Promise<boolean>;
  removeOperation(key: string, operationId: string): Promise<boolean>;
  stageDevice(key: string, record: any, expected: any): Promise<boolean>;
  commitVault(owner: string, record: any): Promise<void>;
}
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
export function assertPinAdvance(current: any, record: any) {
  const pin = record.pin;
  if (!pin || typeof pin.ownerSubject !== "string" || !Array.isArray(record.history))
    throw new VaultError("untrusted_vault");
  if (!current) return;
  if (
    current.ownerSubject !== pin.ownerSubject ||
    current.vaultId !== pin.vaultId ||
    current.rootKeyId !== pin.rootKeyId
  )
    throw new VaultError("untrusted_vault");
  if (
    !Number.isSafeInteger(current.registrySequence) ||
    !Number.isSafeInteger(current.keyEpoch) ||
    current.registrySequence > pin.registrySequence ||
    current.keyEpoch > pin.keyEpoch
  )
    throw new VaultError("rollback_detected");
  if (
    !record.history.some(
      (p: any) =>
        p.registrySequence === current.registrySequence &&
        p.checkpointDigest === current.checkpointDigest &&
        p.keyEpoch === current.keyEpoch,
    )
  )
    throw new VaultError("registry_conflict");
}
export class BrowserEncryptedStorage implements EncryptedStorage {
  private database?: Promise<IDBDatabase>;
  private open() {
    if (typeof indexedDB === "undefined") throw new VaultError("storage_unavailable");
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folioview.encrypted.v1", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("records"))
          request.result.createObjectStore("records");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(new VaultError("storage_unavailable"));
      request.onblocked = () => reject(new VaultError("storage_unavailable"));
    }));
  }
  private async atomic<T>(
    action: (store: IDBObjectStore, done: (v: T) => void, fail: (e: unknown) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      let result: T;
      let error: unknown;
      const fail = (e: unknown) => {
        error = e;
        tx.abort();
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(error instanceof VaultError ? error : new VaultError("storage_unavailable"));
      try {
        action(
          tx.objectStore("records"),
          (v) => {
            result = v;
          },
          fail,
        );
      } catch (e) {
        fail(e);
      }
    });
  }
  async get(key: string) {
    const db = await this.open();
    return new Promise<any>((resolve, reject) => {
      const tx = db.transaction("records", "readonly"),
        req = tx.objectStore("records").get(key);
      let result: any;
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result ?? null);
      tx.onabort = tx.onerror = () => reject(new VaultError("storage_unavailable"));
    });
  }
  async put(key: string, value: any) {
    await this.atomic<void>((s, done) => {
      s.put(value, key);
      done();
    });
  }
  async remove(key: string) {
    await this.atomic<void>((s, done) => {
      s.delete(key);
      done();
    });
  }
  insert(key: string, value: any) {
    return this.atomic<boolean>((s, done) => {
      const req = s.get(key);
      req.onsuccess = () => {
        if (req.result !== undefined) {
          done(false);
          return;
        }
        s.put(value, key);
        done(true);
      };
    });
  }
  removeOperation(key: string, operationId: string) {
    return this.atomic<boolean>((s, done) => {
      const req = s.get(key);
      req.onsuccess = () => {
        if (req.result === undefined) {
          done(true);
          return;
        }
        if (req.result.pending?.operationId !== operationId) {
          done(false);
          return;
        }
        s.delete(key);
        done(true);
      };
    });
  }
  stageDevice(key: string, record: any, expected: any) {
    return this.atomic<boolean>((s, done) => {
      const req = s.get(key);
      req.onsuccess = () => {
        const current = req.result?.pending ?? null;
        if (!same(current, expected ?? null) && !same(current, record.pending)) {
          done(false);
          return;
        }
        s.put(record, key);
        done(true);
      };
    });
  }
  async commitVault(owner: string, record: any) {
    await this.atomic<void>((s, done, fail) => {
      const pinKey = owner + ":pin",
        pendingKey = owner + ":pending-device:" + record.pin.vaultId;
      const req = s.get(pinKey);
      req.onsuccess = () => {
        try {
          if (record.pin.ownerSubject !== owner) throw new VaultError("wrong_account");
          assertPinAdvance(req.result, record);
          // A historical-only reader may not have a device. Its public pin update
          // must not erase a sealed device enrolled concurrently by another tab.
          if (record.device !== undefined)
            s.put(
              { ownerSubject: owner, device: record.device },
              owner + ":device:" + record.pin.vaultId,
            );
          s.put(record.pin, pinKey);
          const pending = s.get(pendingKey);
          pending.onsuccess = () => {
            if (record.pending && same(pending.result?.pending, record.pending))
              s.delete(pendingKey);
            done();
          };
        } catch (e) {
          fail(e);
        }
      };
    });
  }
}
