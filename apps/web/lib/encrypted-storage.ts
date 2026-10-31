/** Browser-owned ciphertext and public pins only; every shared mutation is atomic. */
import { VaultError } from "./encrypted-types";
export interface EncryptedStorage {
  setArchiveContext?(
    owner: string,
    credentialId: string,
    prfSalt: string,
    archiveIv?: string,
  ): void;
  stageKeyRenewal?(owner: string, record: any): Promise<boolean>;
  updateKeyRenewal?(owner: string, record: any, previous: any): Promise<void>;
  finishKeyRenewal?(
    owner: string,
    pin: any,
    archive: any,
    record: any,
    pending: any,
  ): Promise<void>;
  commitLifecycle?(owner: string, pin: any, archive: any, registryRecord?: any): Promise<void>;
  stageArchiveChange?(owner: string, record: any): Promise<boolean>;
  finishArchiveChange?(
    owner: string,
    pin: any,
    archive: any,
    record: any,
    operationId: string,
  ): Promise<void>;
  discardArchiveChange?(owner: string, pin: any, archive: any, operationId: string): Promise<void>;
  updateArchiveChange?(owner: string, record: any, previous: any): Promise<void>;
  get(key: string): Promise<any>;
  put(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
  insert(key: string, value: any): Promise<boolean>;
  removeOperation(key: string, operationId: string): Promise<boolean>;
  reconcileHoldingsOutbox?(key: string, expected: any, signal?: AbortSignal): Promise<boolean>;
  stageDevice(key: string, record: any, expected: any, blockedByKey?: string): Promise<boolean>;
  commitVault(owner: string, record: any): Promise<void>;
  list(prefix: string): Promise<{ key: string; value: any }[]>;
  compareTaskRecord(key: string, value: any, expectedRevision: number): Promise<boolean>;
}
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
// Unlike serialization equality, preserve every own field when comparing a saved row.
export const sameEncryptedRecord = (a: any, b: any): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== b.length) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameEncryptedRecord(a[key], b[key]))
  );
};
const archiveBinding = (archive: any) => ({
  credentialId: archive.credentialId,
  prfSalt: archive.prfSalt,
  archiveIv: archive.iv,
});
const matchesArchive = (binding: any, context: any) =>
  !binding ||
  (binding.credentialId === context.credentialId &&
    binding.prfSalt === context.prfSalt &&
    (!binding.archiveIv || binding.archiveIv === context.archiveIv));
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
  private archiveContext?: {
    owner: string;
    credentialId: string;
    prfSalt: string;
    archiveIv?: string;
  };
  setArchiveContext(owner: string, credentialId: string, prfSalt: string, archiveIv?: string) {
    this.archiveContext = { owner, credentialId, prfSalt, archiveIv };
  }
  private guarded<T>(
    key: string,
    action: (s: IDBObjectStore, done: (v: T) => void, fail: (e: unknown) => void) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.atomic<T>((s, done, fail) => {
      const context = this.archiveContext;
      if (!context || !key.startsWith(context.owner + ":")) {
        action(s, done, fail);
        return;
      }
      const renewal = s.get(context.owner + ":key-renewal");
      renewal.onsuccess = () => {
        if (renewal.result) fail(new VaultError("key_renewal_pending"));
      };
      const pending = s.get(context.owner + ":archive-change");
      pending.onsuccess = () => {
        if (pending.result) {
          fail(new VaultError("archive_change_pending"));
          return;
        }
        const binding = s.get(context.owner + ":archive-binding");
        binding.onsuccess = () => {
          if (!matchesArchive(binding.result, context)) {
            fail(new VaultError("archive_session_stale"));
            return;
          }
          action(s, done, fail);
        };
      };
    }, signal);
  }
  private lifecycleAdvance(current: any, pin: any) {
    if (
      !pin ||
      !Array.isArray(pin.fingerprints) ||
      pin.fingerprints.length !== pin.lifecycleVersion
    )
      throw new VaultError("untrusted_lifecycle");
    if (
      current &&
      (current.ownerSubject !== pin.ownerSubject ||
        current.vaultId !== pin.vaultId ||
        current.rootKeyId !== pin.rootKeyId ||
        current.lifecycleVersion > pin.lifecycleVersion ||
        current.archiveRevision > pin.archiveRevision ||
        current.fingerprints.some((v: string, i: number) => v !== pin.fingerprints[i]) ||
        (current.lifecycleVersion === pin.lifecycleVersion &&
          current.archiveDigest !== pin.archiveDigest))
    )
      throw new VaultError("rollback_detected");
  }
  commitLifecycle(owner: string, pin: any, archive: any, registryRecord?: any) {
    return this.atomic<void>((s, done, fail) => {
      const req = s.get(owner + ":lifecycle");
      req.onsuccess = () => {
        try {
          if (pin.ownerSubject !== owner || archive.ownerSubject !== owner)
            throw new VaultError("wrong_account");
          this.lifecycleAdvance(req.result, pin);
          const commit = () => {
            s.put(pin, owner + ":lifecycle");
            // A known archive may advance during a pending operation; its outbox remains intact.
            s.put(archiveBinding(archive), owner + ":archive-binding");
            done();
          };
          if (registryRecord) {
            const previous = s.get(owner + ":pin");
            previous.onsuccess = () => {
              try {
                if (
                  registryRecord.pin?.ownerSubject !== owner ||
                  registryRecord.pin.vaultId !== pin.vaultId ||
                  registryRecord.pin.rootKeyId !== pin.rootKeyId ||
                  Object.keys(registryRecord).some((key) => !["pin", "history"].includes(key))
                )
                  throw new VaultError("untrusted_vault");
                assertPinAdvance(previous.result, registryRecord);
                s.put(registryRecord.pin, owner + ":pin");
                commit();
              } catch (e) {
                fail(e);
              }
            };
          } else commit();
        } catch (e) {
          fail(e);
        }
      };
    });
  }
  stageArchiveChange(owner: string, record: any) {
    return this.atomic<boolean>((s, done, fail) => {
      const renewal = s.get(owner + ":key-renewal");
      renewal.onsuccess = () => {
        if (renewal.result) fail(new VaultError("key_renewal_pending"));
      };
      if (record.ownerSubject !== owner) {
        fail(new VaultError("wrong_account"));
        return;
      }
      const current = s.get(owner + ":archive-change");
      current.onsuccess = () => {
        if (current.result) {
          done(same(current.result, record));
          return;
        }
        const context = this.archiveContext,
          binding = s.get(owner + ":archive-binding");
        binding.onsuccess = () => {
          if (context && !matchesArchive(binding.result, context)) {
            fail(new VaultError("archive_session_stale"));
            return;
          }
          const cursor = s.openCursor(IDBKeyRange.bound(owner + ":", owner + ":\uffff"));
          let blocked = false;
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (row) {
              const key = String(row.key),
                v = row.value;
              if (
                key.includes(":pending-device:") ||
                key.includes(":device-change:") ||
                key.includes(":agent-registration:") ||
                key.includes(":agent-approval:") ||
                key.includes(":agent-preparation:") ||
                (key.includes(":task-draft:") && !v.deleted)
              )
                blocked = true;
              row.continue();
            } else if (blocked) fail(new VaultError("archive_local_pending"));
            else {
              s.put(record, owner + ":archive-change");
              done(true);
            }
          };
        };
      };
    });
  }
  finishArchiveChange(owner: string, pin: any, archive: any, record: any, operationId: string) {
    return this.atomic<void>((s, done, fail) => {
      const pending = s.get(owner + ":archive-change");
      pending.onsuccess = () => {
        if (pending.result?.operationId !== operationId) {
          fail(new VaultError("operation_conflict"));
          return;
        }
        const current = s.get(owner + ":lifecycle");
        current.onsuccess = () => {
          try {
            this.lifecycleAdvance(current.result, pin);
            const pinRead = s.get(owner + ":pin");
            pinRead.onsuccess = () => {
              try {
                assertPinAdvance(pinRead.result, record);
                if (record.device)
                  s.put(
                    { ownerSubject: owner, device: record.device },
                    owner + ":device:" + pin.vaultId,
                  );
                else s.delete(owner + ":device:" + pin.vaultId);
                s.put(record.pin, owner + ":pin");
                s.put(pin, owner + ":lifecycle");
                s.put(archiveBinding(archive), owner + ":archive-binding");
                s.delete(owner + ":archive-change");
                done();
              } catch (e) {
                fail(e);
              }
            };
          } catch (e) {
            fail(e);
          }
        };
      };
    });
  }
  discardArchiveChange(owner: string, pin: any, archive: any, operationId: string) {
    return this.atomic<void>((s, done, fail) => {
      const pending = s.get(owner + ":archive-change");
      pending.onsuccess = () => {
        if (pending.result?.operationId !== operationId) {
          fail(new VaultError("operation_conflict"));
          return;
        }
        const current = s.get(owner + ":lifecycle");
        current.onsuccess = () => {
          try {
            this.lifecycleAdvance(current.result, pin);
            s.put(pin, owner + ":lifecycle");
            s.put(archiveBinding(archive), owner + ":archive-binding");
            s.delete(owner + ":archive-change");
            done();
          } catch (e) {
            fail(e);
          }
        };
      };
    });
  }
  updateArchiveChange(owner: string, record: any, previous: any) {
    return this.atomic<void>((s, done, fail) => {
      const req = s.get(owner + ":archive-change");
      req.onsuccess = () => {
        if (record.ownerSubject !== owner || !same(req.result, previous)) {
          fail(new VaultError("operation_conflict"));
          return;
        }
        s.put(record, owner + ":archive-change");
        done();
      };
    });
  }
  stageKeyRenewal(owner: string, record: any) {
    return this.atomic<boolean>((s, done, fail) => {
      if (record.ownerSubject !== owner || !record.operationId || !record.pending) {
        fail(new VaultError("wrong_account"));
        return;
      }
      const current = s.get(owner + ":key-renewal");
      current.onsuccess = () => {
        if (current.result) {
          done(same(current.result, record));
          return;
        }
        const binding = s.get(owner + ":archive-binding");
        binding.onsuccess = () => {
          if (
            !this.archiveContext ||
            this.archiveContext.owner !== owner ||
            !matchesArchive(binding.result, this.archiveContext)
          ) {
            fail(new VaultError("archive_session_stale"));
            return;
          }
          const cursor = s.openCursor(IDBKeyRange.bound(owner + ":", owner + ":\uffff"));
          let blocked = false;
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (row) {
              const key = String(row.key),
                v = row.value;
              if (
                key === owner + ":archive-change" ||
                key.includes(":pending-device:") ||
                key.includes(":device-change:") ||
                key.includes(":agent-registration:") ||
                key.includes(":agent-approval:") ||
                key.includes(":agent-preparation:") ||
                key.includes(":outbox:") ||
                (key.includes(":task-outbox:") && !v.deleted)
              )
                blocked = true;
              row.continue();
            } else if (blocked) fail(new VaultError("key_renewal_local_pending"));
            else {
              s.put(record, owner + ":key-renewal");
              done(true);
            }
          };
        };
      };
    });
  }
  updateKeyRenewal(owner: string, record: any, previous: any) {
    return this.atomic<void>((s, done, fail) => {
      const current = s.get(owner + ":key-renewal");
      current.onsuccess = () => {
        if (
          record.ownerSubject !== owner ||
          record.vaultId !== previous.vaultId ||
          record.operationId !== previous.operationId ||
          !same(current.result, previous)
        ) {
          fail(new VaultError("operation_conflict"));
          return;
        }
        s.put(record, owner + ":key-renewal");
        done();
      };
    });
  }
  finishKeyRenewal(owner: string, pin: any, archive: any, record: any, pending: any) {
    return this.atomic<void>((s, done, fail) => {
      const current = s.get(owner + ":key-renewal");
      current.onsuccess = () => {
        if (
          !same(current.result, pending) ||
          pending.ownerSubject !== owner ||
          pin.ownerSubject !== owner ||
          archive.ownerSubject !== owner ||
          record.pin?.ownerSubject !== owner ||
          pin.vaultId !== pending.vaultId ||
          record.pin.vaultId !== pin.vaultId ||
          archive.vaultId !== pin.vaultId ||
          record.pin.rootKeyId !== pin.rootKeyId ||
          archive.rootKeyId !== pin.rootKeyId
        ) {
          fail(new VaultError("operation_conflict"));
          return;
        }
        const previousLife = s.get(owner + ":lifecycle");
        previousLife.onsuccess = () => {
          try {
            this.lifecycleAdvance(previousLife.result, pin);
            const previousPin = s.get(owner + ":pin");
            previousPin.onsuccess = () => {
              try {
                assertPinAdvance(previousPin.result, record);
                if (record.device)
                  s.put(
                    { ownerSubject: owner, device: record.device },
                    owner + ":device:" + pin.vaultId,
                  );
                else s.delete(owner + ":device:" + pin.vaultId);
                s.put(record.pin, owner + ":pin");
                s.put(pin, owner + ":lifecycle");
                s.put(archiveBinding(archive), owner + ":archive-binding");
                s.delete(owner + ":key-renewal");
                done();
              } catch (e) {
                fail(e);
              }
            };
          } catch (e) {
            fail(e);
          }
        };
      };
    });
  }
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
    signal?: AbortSignal,
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
      const abort = () => {
        try {
          fail(new VaultError("locked"));
        } catch (failure) {
          // Completion may precede delivery of oncomplete. A finished transaction
          // cannot be rolled back; let its existing handlers settle normally.
          if (!(failure instanceof Error) || failure.name !== "InvalidStateError") throw failure;
        }
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        cleanup();
        resolve(result);
      };
      tx.onabort = tx.onerror = () => {
        cleanup();
        reject(error instanceof VaultError ? error : new VaultError("storage_unavailable"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
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
    await this.guarded<void>(key, (s, done) => {
      s.put(value, key);
      done();
    });
  }
  async list(prefix: string) {
    const db = await this.open();
    return new Promise<{ key: string; value: any }[]>((resolve, reject) => {
      const tx = db.transaction("records", "readonly"),
        rows: { key: string; value: any }[] = [];
      const req = tx
        .objectStore("records")
        .openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          rows.push({ key: String(cursor.key), value: cursor.value });
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(rows);
      tx.onabort = tx.onerror = () => reject(new VaultError("storage_unavailable"));
    });
  }
  compareTaskRecord(key: string, value: any, expectedRevision: number) {
    return this.guarded<boolean>(key, (s, done, fail) => {
      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        value?.revision !== expectedRevision + 1
      ) {
        fail(new VaultError("operation_conflict"));
        return;
      }
      const req = s.get(key);
      req.onsuccess = () => {
        if ((req.result?.revision ?? 0) !== expectedRevision) {
          done(false);
          return;
        }
        s.put(value, key);
        done(true);
      };
    });
  }
  async remove(key: string) {
    await this.guarded<void>(key, (s, done) => {
      s.delete(key);
      done();
    });
  }
  insert(key: string, value: any) {
    return this.guarded<boolean>(key, (s, done) => {
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
    return this.guarded<boolean>(key, (s, done) => {
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
  reconcileHoldingsOutbox(key: string, expected: any, signal?: AbortSignal) {
    const context = this.archiveContext,
      source = expected?.pending?.source?.resourceRef;
    if (
      !context ||
      expected?.ownerSubject !== context.owner ||
      typeof expected?.vaultId !== "string" ||
      !expected.vaultId ||
      source?.kind !== "holdings" ||
      source.sourceService !== "portfolio" ||
      typeof source.resourceId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(source.resourceId) ||
      key !== context.owner + ":outbox:" + source.resourceId ||
      Object.keys(expected).length !== 3 ||
      !Object.hasOwn(expected, "pending")
    )
      return Promise.reject(new VaultError("wrong_account"));
    return this.guarded<boolean>(
      key,
      (s, done, fail) => {
        const req = s.get(key);
        req.onsuccess = () => {
          try {
            if (this.archiveContext !== context) {
              fail(new VaultError("archive_session_stale"));
              return;
            }
            if (!sameEncryptedRecord(req.result, expected)) {
              done(false);
              return;
            }
            s.delete(key);
            done(true);
          } catch (error) {
            fail(error);
          }
        };
      },
      signal,
    );
  }
  stageDevice(key: string, record: any, expected: any, blockedByKey?: string) {
    return this.guarded<boolean>(key, (s, done) => {
      const stage = () => {
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
      };
      if (blockedByKey) {
        const blocked = s.get(blockedByKey);
        blocked.onsuccess = () => (blocked.result === undefined ? stage() : done(false));
      } else stage();
    });
  }
  async commitVault(owner: string, record: any) {
    await this.guarded<void>(owner + ":pin", (s, done, fail) => {
      const pinKey = owner + ":pin",
        pendingKey = owner + ":pending-device:" + record.pin.vaultId;
      const req = s.get(pinKey);
      req.onsuccess = () => {
        try {
          if (record.pin.ownerSubject !== owner) throw new VaultError("wrong_account");
          assertPinAdvance(req.result, record);
          const commit = () => {
            // Historical reads only advance public pins. Explicit promotion is
            // separately fenced against another tab's different local device.
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
          };
          if (record.device !== undefined && record.deviceReplacementKeyIds !== undefined) {
            const ids = record.deviceReplacementKeyIds;
            if (
              !Array.isArray(ids) ||
              ids.length !== 2 ||
              ids.some((id: unknown) => typeof id !== "string")
            )
              throw new VaultError("operation_conflict");
            const existing = s.get(owner + ":device:" + record.pin.vaultId);
            existing.onsuccess = () => {
              const old = existing.result?.device;
              if (
                old &&
                !same(old, record.device) &&
                !same([old.signingKeyId, old.encryptionKeyId].sort(), [...ids].sort())
              ) {
                fail(new VaultError("operation_conflict"));
                return;
              }
              commit();
            };
          } else commit();
        } catch (e) {
          fail(e);
        }
      };
    });
  }
}
