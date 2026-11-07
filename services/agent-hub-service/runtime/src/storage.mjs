/** Only nonextractable CryptoKey objects, public pins and original ciphertext survive. */
import { deny, exact, same, digest, keyId, publicKey } from "./crypto.mjs";
const DB = "folioview.persistent-runtime.v1",
  STORE = "profiles";
function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(Error("runtime_storage_unavailable"));
  });
}
async function database(factory) {
  const r = factory.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  return request(r);
}
function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(Error("runtime_storage_unavailable"));
  });
}
export class RuntimeStorage {
  constructor(factory = globalThis.indexedDB) {
    if (!factory) deny("runtime_storage_unavailable");
    this.factory = factory;
  }
  async transact(key, change) {
    const db = await database(this.factory);
    try {
      const tx = db.transaction(STORE, "readwrite"),
        done = finished(tx),
        store = tx.objectStore(STORE);
      let result, error;
      const read = store.get(key);
      read.onsuccess = () => {
        try {
          const next = change(read.result ?? null);
          result = next.result;
          if (next.write !== undefined) store.put(next.write, key);
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      try {
        await done;
      } catch (e) {
        throw error ?? e;
      }
      return result;
    } finally {
      db.close();
    }
  }
  async profileKey(actor) {
    exact(actor, ["issuer", "ownerSubject", "vaultId", "connectionId", "clientId"]);
    return "profile:" + (await digest(actor));
  }
  async profile(actor, { create = false } = {}) {
    const key = await this.profileKey(actor);
    let existing = await this.transact(key, (v) => ({ result: v }));
    if (!existing && create) {
      // Generation happens outside the IDB transaction. A concurrent creator's original wins.
      const sign = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
        "sign",
        "verify",
      ]);
      const enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
        "deriveBits",
      ]);
      const clean = (k) => Object.fromEntries(["kty", "crv", "x", "y"].map((n) => [n, k[n]]));
      const signingPublicJwk = clean(await crypto.subtle.exportKey("jwk", sign.publicKey)),
        encryptionPublicJwk = clean(await crypto.subtle.exportKey("jwk", enc.publicKey));
      const candidate = {
        version: 1,
        actor: structuredClone(actor),
        signingPrivateKey: sign.privateKey,
        encryptionPrivateKey: enc.privateKey,
        signingPublicJwk,
        encryptionPublicJwk,
        pins: null,
        identity: null,
      };
      existing = await this.transact(key, (v) =>
        v ? { result: v } : { write: candidate, result: candidate },
      );
    }
    if (!existing) deny("lost_private_keys");
    await this.verifyProfile(existing, actor);
    return existing;
  }
  async verifyProfile(p, actor) {
    if (!same(p.actor, actor) || p.version !== 1) deny("invalid_runtime_profile");
    for (const [key, name, usages] of [
      [p.signingPrivateKey, "ECDSA", ["sign"]],
      [p.encryptionPrivateKey, "ECDH", ["deriveBits"]],
    ])
      if (
        !(key instanceof CryptoKey) ||
        key.extractable ||
        key.type !== "private" ||
        key.algorithm.name !== name ||
        key.algorithm.namedCurve !== "P-256" ||
        !same(key.usages, usages)
      )
        deny("invalid_runtime_profile");
    await publicKey(p.signingPublicJwk);
    await publicKey(p.encryptionPublicJwk);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      p.signingPrivateKey,
      challenge,
    );
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        await crypto.subtle.importKey(
          "jwk",
          p.signingPublicJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        ),
        signature,
        challenge,
      ))
    )
      deny("invalid_runtime_profile");
    const probe = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]);
    const ownPublic = await crypto.subtle.importKey(
      "jwk",
      p.encryptionPublicJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const left = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: probe.publicKey },
        p.encryptionPrivateKey,
        256,
      ),
    );
    const right = new Uint8Array(
      await crypto.subtle.deriveBits({ name: "ECDH", public: ownPublic }, probe.privateKey, 256),
    );
    if (!same([...left], [...right])) deny("invalid_runtime_profile");
    return p;
  }
  async bind(actor, identity, pins) {
    const checked = await this.profile(actor);
    if (
      identity.agentSigningKeyId !== (await keyId(checked.signingPublicJwk)) ||
      identity.agentEncryptionKeyId !== (await keyId(checked.encryptionPublicJwk))
    )
      deny("recipient_binding_mismatch");
    const key = await this.profileKey(actor);
    return this.transact(key, (p) => {
      if (!p) deny("lost_private_keys");
      if (p.identity && !same(p.identity, identity)) deny("identity_conflict");
      if (
        p.pins &&
        (pins.rootKeyId !== p.pins.rootKeyId ||
          pins.registrySequence < p.pins.registrySequence ||
          (pins.registrySequence === p.pins.registrySequence &&
            pins.checkpointDigest !== p.pins.checkpointDigest))
      )
        deny("registry_rollback");
      const next = { ...p, identity: structuredClone(identity), pins: structuredClone(pins) };
      return { write: next, result: next };
    });
  }
  async originalCiphertext(actor, operation, candidate) {
    // Exact retry storage accepts only a validated encrypted carrier supplied by the closed runtime.
    const { inspect } = await import("./crypto.mjs");
    inspect(candidate);
    const key = "outbox:" + (await digest([actor, operation]));
    return this.transact(key, (v) =>
      v ? { result: v } : { write: structuredClone(candidate), result: structuredClone(candidate) },
    );
  }
  async outbox(actor, operation) {
    return this.transact("outbox:" + (await digest([actor, operation])), (v) => ({ result: v }));
  }
}
