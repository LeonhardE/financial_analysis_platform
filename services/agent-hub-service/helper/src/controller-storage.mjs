/** Public ciphertext-only recovery records. No keys, tokens or private payloads. */
import canonicalize from "canonicalize";
import validators from "./controller-validators.cjs";
export const CONTRACT = "folioview.agent-workspace.v2.0";
export const CONTROLLER_PROFILE = "folioview.foreground-controller.v1";
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
export class ControllerDenied extends Error {
  constructor(code = "controller_rejected") {
    super(code);
    this.code = code;
  }
}
export function reject(code) {
  throw new ControllerDenied(code);
}
export function exact(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")
  )
    reject("invalid_fields");
}
export function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    reject("invalid_identifier");
  return value;
}
export function canonical(value) {
  let text;
  try {
    text = canonicalize(value);
  } catch {
    reject("invalid_json");
  }
  if (typeof text !== "string") reject("invalid_json");
  return text;
}
export function bounded(value, max = 1048576) {
  const text = canonical(value);
  if (encoder.encode(text).length > max) reject("payload_too_large");
  return text;
}
function validate(name, value) {
  if (!validators[name]?.(value)) reject("invalid_record");
}
function decode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 786432)
    reject("invalid_record");
  let bytes;
  try {
    const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    reject("invalid_record");
  }
  // Round-trip without a spread over a large byte array.
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  if (btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") !== value)
    reject("invalid_record");
  return bytes;
}
function jsonBytes(value, jcs = false) {
  try {
    const text = decoder.decode(decode(value)),
      parsed = JSON.parse(text);
    // Producer objects are compact JSON (JCS for the signed payload). This rejects
    // duplicate members rather than silently taking a replacement identity.
    if ((jcs ? canonical(parsed) : JSON.stringify(parsed)) !== text) reject("invalid_record");
    return parsed;
  } catch {
    reject("invalid_record");
  }
}
export async function fingerprint(carrier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(carrier.signedObject.protected + "." + carrier.signedObject.payload),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function checkedScope(scope) {
  exact(scope, ["ownerSubject", "vaultId", "connectionId", "agentPrincipalId", "taskId"]);
  for (const value of Object.values(scope)) identifier(value);
  return structuredClone(scope);
}
export function scopeKey(scope) {
  return canonical(checkedScope(scope));
}
export async function checkedPacket(packet, scope) {
  bounded(packet, 589824);
  checkedScope(scope);
  exact(packet, [
    "contractVersion",
    "runId",
    "resultId",
    "revision",
    "expectedRevision",
    "stableOperationId",
    "envelopeFingerprint",
    "envelope",
  ]);
  for (const name of ["runId", "resultId", "stableOperationId"]) identifier(packet[name]);
  if (
    packet.contractVersion !== CONTRACT ||
    !Number.isSafeInteger(packet.expectedRevision) ||
    packet.expectedRevision < 0 ||
    packet.expectedRevision >= 32 ||
    packet.revision !== packet.expectedRevision + 1 ||
    !/^[a-f0-9]{64}$/.test(packet.envelopeFingerprint)
  )
    reject("invalid_record");
  validate("Carrier", packet.envelope);
  if (packet.envelope.contractVersion !== CONTRACT) reject("invalid_record");
  const signed = packet.envelope.signedObject,
    header = jsonBytes(signed.protected),
    message = jsonBytes(signed.payload, true);
  exact(header, ["alg", "typ", "kid", "cty"]);
  validate("ObjectMessage", message);
  const context = message.context,
    binding = context.binding;
  if (
    header.alg !== "ES256" ||
    header.typ !== "fv-object+jws" ||
    header.cty !== "application/json" ||
    header.kid !== context.authorSigningKeyId ||
    decode(signed.signature).length !== 64 ||
    context.contractVersion !== CONTRACT ||
    context.profileId !== "P1" ||
    context.objectType !== "result_revision" ||
    context.objectId !== packet.resultId ||
    context.ownerSubject !== scope.ownerSubject ||
    context.vaultId !== scope.vaultId ||
    binding.connectionId !== scope.connectionId ||
    binding.taskId !== scope.taskId ||
    binding.runId !== packet.runId ||
    context.revision !== packet.revision ||
    context.expectedRevision !== packet.expectedRevision ||
    context.stableOperationId !== packet.stableOperationId ||
    context.operationType !== (packet.expectedRevision === 0 ? "submit_result" : "revise_result") ||
    context.deliveryRevision !== 1 ||
    context.resourceBindings.length ||
    context.priorEnvelopeFingerprint !== null
  )
    reject("record_binding_mismatch");
  if ((await fingerprint(packet.envelope)) !== packet.envelopeFingerprint)
    reject("record_fingerprint_mismatch");
  return { packet: structuredClone(packet), context };
}
export function checkedReceipt(receipt, packet, scope, context, runCreatedAt) {
  validate("ResultReceipt", receipt);
  const expected = {
    contractVersion: CONTRACT,
    vaultId: scope.vaultId,
    runId: packet.runId,
    taskId: scope.taskId,
    resultId: packet.resultId,
    revision: packet.revision,
    deliveryRevision: context.deliveryRevision,
    stableOperationId: packet.stableOperationId,
    envelopeFingerprint: packet.envelopeFingerprint,
    resultPath: `/results/${packet.resultId}?revision=${packet.revision}`,
  };
  if (
    Object.keys(expected).some((key) => receipt[key] !== expected[key]) ||
    !Number.isFinite(Date.parse(receipt.receivedAt)) ||
    Date.parse(receipt.receivedAt) < Date.parse(runCreatedAt)
  )
    reject("receipt_binding_mismatch");
  return structuredClone(receipt);
}
export async function checkedRecord(value, scope) {
  bounded(value);
  exact(value, ["profile", "scope", "packet", "receipt", "runCreatedAt"]);
  if (
    value.profile !== CONTROLLER_PROFILE ||
    scopeKey(value.scope) !== scopeKey(scope) ||
    typeof value.runCreatedAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value.runCreatedAt) ||
    !Number.isFinite(Date.parse(value.runCreatedAt))
  )
    reject("record_binding_mismatch");
  const checked = await checkedPacket(value.packet, scope);
  if (value.receipt !== null)
    checkedReceipt(value.receipt, value.packet, scope, checked.context, value.runCreatedAt);
  return structuredClone(value);
}
function recordKey(scope, operation) {
  return scopeKey(scope) + ":" + identifier(operation);
}
function storeError(error) {
  return error instanceof ControllerDenied ? error : new ControllerDenied("storage_unavailable");
}
export class CiphertextOutbox {
  #factory;
  #database;
  constructor({ indexedDB = globalThis.indexedDB } = {}) {
    this.#factory = indexedDB;
  }
  async #open() {
    if (!this.#factory) reject("storage_unavailable");
    if (!this.#database)
      this.#database = new Promise((resolve, rejectPromise) => {
        const request = this.#factory.open("folioview-agent-ciphertext-outbox-v1", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("outbox", { keyPath: "key" });
        request.onerror = () => rejectPromise(new ControllerDenied("storage_unavailable"));
        request.onblocked = () => rejectPromise(new ControllerDenied("storage_unavailable"));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.#database = undefined;
          };
          resolve(db);
        };
      }).catch((error) => {
        this.#database = undefined;
        throw storeError(error);
      });
    return this.#database;
  }
  async #transaction(mode, action) {
    const db = await this.#open();
    return new Promise((resolve, rejectPromise) => {
      let result, failure;
      const transaction = db.transaction("outbox", mode),
        store = transaction.objectStore("outbox");
      const fail = (error) => {
        failure = storeError(error);
        try {
          transaction.abort();
        } catch {}
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () =>
        rejectPromise(failure ?? new ControllerDenied("storage_unavailable"));
      try {
        action(
          store,
          (value) => {
            result = value;
          },
          fail,
        );
      } catch (error) {
        fail(error);
      }
    });
  }
  async list(scope) {
    const prefix = scopeKey(scope),
      rows = await this.#transaction("readonly", (store, done, fail) => {
        const request = store.getAll();
        request.onerror = () => fail(request.error);
        request.onsuccess = () => done(request.result);
      });
    if (!Array.isArray(rows) || rows.length > 256) reject("invalid_record");
    const selected = rows.filter((row) => row.scope === prefix);
    if (selected.length > 32) reject("invalid_record");
    const records = [];
    for (const row of selected) {
      const record = await checkedRecord(row.value, scope);
      if (row.key !== recordKey(scope, record.packet.stableOperationId)) reject("invalid_record");
      records.push(record);
    }
    return records;
  }
  async get(scope, operation) {
    return (
      (await this.list(scope)).find(
        (record) => record.packet.stableOperationId === identifier(operation),
      ) ?? null
    );
  }
  async stage(scope, value) {
    const record = await checkedRecord(value, scope),
      key = recordKey(scope, record.packet.stableOperationId),
      namespace = scopeKey(scope),
      encoded = bounded(record);
    if (record.receipt !== null) reject("invalid_record");
    return this.#transaction("readwrite", (store, done, fail) => {
      const request = store.getAll();
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        try {
          const rows = request.result;
          if (!Array.isArray(rows) || rows.length > 256) reject("invalid_record");
          const old = rows.find((row) => row.key === key);
          if (old) {
            if (old.scope !== namespace || canonical({ ...old.value, receipt: null }) !== encoded)
              reject("outbox_conflict");
            done(structuredClone(old.value));
            return;
          }
          if (rows.length >= 256 || rows.filter((row) => row.scope === namespace).length >= 32)
            reject("outbox_capacity");
          store.add({ key, scope: namespace, value: record });
          done(structuredClone(record));
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  async accept(scope, operation, expectedFingerprint, receipt) {
    const saved = await this.get(scope, operation);
    if (!saved || saved.packet.envelopeFingerprint !== expectedFingerprint)
      reject("outbox_conflict");
    const { context } = await checkedPacket(saved.packet, scope),
      accepted = checkedReceipt(receipt, saved.packet, scope, context, saved.runCreatedAt);
    const key = recordKey(scope, operation),
      original = canonical(saved);
    return this.#transaction("readwrite", (store, done, fail) => {
      const request = store.get(key);
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        try {
          const row = request.result;
          if (!row || row.scope !== scopeKey(scope)) reject("outbox_conflict");
          if (canonical(row.value) !== original) {
            if (
              canonical({ ...row.value, receipt: null }) ===
                canonical({ ...saved, receipt: null }) &&
              canonical(row.value.receipt) === canonical(accepted)
            ) {
              done(structuredClone(row.value));
              return;
            }
            reject("outbox_conflict");
          }
          if (row.value.receipt !== null && canonical(row.value.receipt) !== canonical(accepted))
            reject("receipt_replacement");
          row.value.receipt = accepted;
          store.put(row);
          done(structuredClone(row.value));
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  async discard(scope, operation, expectedFingerprint) {
    const key = recordKey(scope, operation);
    return this.#transaction("readwrite", (store, done, fail) => {
      const request = store.get(key);
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        try {
          const row = request.result;
          if (
            row &&
            (row.scope !== scopeKey(scope) ||
              row.value.packet?.envelopeFingerprint !== expectedFingerprint)
          )
            reject("outbox_conflict");
          if (row) store.delete(key);
          done(null);
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  async close() {
    if (this.#database) {
      (await this.#database).close();
      this.#database = undefined;
    }
  }
}
