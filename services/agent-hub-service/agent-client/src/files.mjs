/** Private host files are readable by this Agent's tools; they are not a TEE. */
import { constants } from "node:fs";
import { mkdir, open, lstat, unlink } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  RuntimeDenied,
  deny,
  exact,
  same,
  digest,
  parsed,
  canonical,
  keyId,
  publicKey,
} from "./crypto.mjs";

const MAX = 12 * 1024 * 1024;
function owned(stat, directory = false) {
  if (
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid() ||
    (!directory && stat.nlink !== 1)
  )
    deny("private_storage_unavailable");
}
export async function privateDirectory(path) {
  if (!isAbsolute(path)) deny("private_storage_unavailable");
  await mkdir(path, { recursive: true, mode: 0o700 });
  owned(await lstat(path), true);
  return resolve(path);
}
export async function importProfile(record, actor) {
  if (!record || !same({ issuer: record.origin, ...record.actor }, actor))
    deny("reauthorization_required");
  const signing = record.signingPrivateJwk,
    encryption = record.encryptionPrivateJwk;
  for (const jwk of [signing, encryption]) {
    exact(jwk, ["kty", "crv", "x", "y", "d"]);
    await publicKey(Object.fromEntries(["kty", "crv", "x", "y"].map((k) => [k, jwk[k]])));
  }
  const signingPublicJwk = Object.fromEntries(["kty", "crv", "x", "y"].map((k) => [k, signing[k]]));
  const encryptionPublicJwk = Object.fromEntries(
    ["kty", "crv", "x", "y"].map((k) => [k, encryption[k]]),
  );
  if ((await keyId(signingPublicJwk)) === (await keyId(encryptionPublicJwk)))
    deny("reauthorization_required");
  let signingPrivateKey, encryptionPrivateKey;
  try {
    signingPrivateKey = await crypto.subtle.importKey(
      "jwk",
      signing,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    encryptionPrivateKey = await crypto.subtle.importKey(
      "jwk",
      encryption,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const challenge = randomBytes(32);
    const sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingPrivateKey,
      challenge,
    );
    const pub = await crypto.subtle.importKey(
      "jwk",
      signingPublicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, challenge)))
      deny("reauthorization_required");
    const probe = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]);
    const own = await crypto.subtle.importKey(
      "jwk",
      encryptionPublicJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const left = await crypto.subtle.deriveBits(
      { name: "ECDH", public: probe.publicKey },
      encryptionPrivateKey,
      256,
    );
    const right = await crypto.subtle.deriveBits(
      { name: "ECDH", public: own },
      probe.privateKey,
      256,
    );
    if (!same([...new Uint8Array(left)], [...new Uint8Array(right)]))
      deny("reauthorization_required");
  } catch {
    deny("reauthorization_required");
  }
  return {
    signingPrivateKey,
    encryptionPrivateKey,
    signingPublicJwk,
    encryptionPublicJwk,
    pins: record.pins ?? record.activation?.anchor ?? null,
    identity: record.activation?.identity ?? null,
  };
}
export class HostStorage {
  constructor({ directory, origin, actor, provider }) {
    exact(actor, ["ownerSubject", "vaultId", "connectionId", "clientId"]);
    if (!["muse", "chatgpt"].includes(provider)) deny("recipient_binding_mismatch");
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) deny("invalid_runtime_origin");
    this.directory = directory;
    this.origin = origin;
    this.actor = structuredClone(actor);
    this.provider = provider;
  }
  async folder() {
    const root = await privateDirectory(this.directory);
    return privateDirectory(root + "/" + (await digest([this.origin, this.actor, this.provider])));
  }
  async update(change, { create = false } = {}) {
    const folder = await this.folder(),
      path = folder + "/credentials.sqlite";
    let file, db;
    try {
      file = await open(
        path,
        constants.O_RDWR | constants.O_NOFOLLOW | (create ? constants.O_CREAT : 0),
        0o600,
      );
      const stat = await file.stat();
      owned(stat);
      if (stat.size > 20 * 1024 * 1024) deny("private_storage_unavailable");
      await file.close();
      file = null;
      db = new DatabaseSync(path);
      // SQLite serializes competing processes and recovers interrupted writes;
      // there is no stale user-managed lock/recovery file after a host restart.
      db.exec(
        "PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA max_page_count=4096;",
      );
      db.exec("BEGIN IMMEDIATE");
      if (create)
        db.exec(
          "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
        );
      const row = db.prepare("SELECT value FROM state WHERE id=1").get();
      let current = null;
      try {
        current = row ? parsed(new TextEncoder().encode(row.value)) : null;
      } catch {
        deny("credential_store_corrupt");
      }
      if (current === null && !create) deny("reauthorization_required");
      if (current !== null) {
        try {
          exact(current, [
            "version",
            "origin",
            "actor",
            "provider",
            "active",
            "pending",
            "records",
            "timeFloor",
          ]);
          if (
            current.version !== 1 ||
            current.origin !== this.origin ||
            current.provider !== this.provider ||
            !same(current.actor, this.actor) ||
            !Number.isSafeInteger(current.timeFloor) ||
            current.timeFloor < 0 ||
            !current.records ||
            typeof current.records !== "object" ||
            Array.isArray(current.records) ||
            (current.pending !== null &&
              (!current.pending?.context || !current.pending?.profile)) ||
            (current.active !== null && !current.active?.activation?.lease)
          )
            deny("credential_store_corrupt");
        } catch {
          deny("credential_store_corrupt");
        }
      }
      const value = current ?? {
        version: 1,
        origin: this.origin,
        actor: this.actor,
        provider: this.provider,
        active: null,
        pending: null,
        records: {},
        timeFloor: 0,
      };
      const next = await change(value);
      if (next.write) {
        const encoded = canonical(value);
        if (encoded.length > MAX) deny("private_storage_unavailable");
        db.prepare(
          "INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        ).run(new TextDecoder().decode(encoded));
      }
      db.exec("COMMIT");
      return next.result;
    } catch (error) {
      try {
        db?.exec("ROLLBACK");
      } catch {}
      if (error instanceof RuntimeDenied) throw error;
      if (error.errcode === 5) deny("agent_busy");
      if (
        [11, 26].includes(error.errcode) ||
        (error.errcode === 1 && /no such table/.test(error.message))
      )
        deny("credential_store_corrupt");
      deny("reauthorization_required");
    } finally {
      await file?.close();
      db?.close();
    }
  }
  async resetCorruptForAuthorization() {
    // Explicit prepare only. Normal task loading never deletes/repairs or creates
    // credentials. This is an Agent-private local file, not a user recovery file.
    const path = (await this.folder()) + "/credentials.sqlite";
    const stat = await lstat(path);
    owned(stat);
    await unlink(path);
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      try {
        const side = await lstat(path + suffix);
        owned(side);
        await unlink(path + suffix);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  async noteTime(now) {
    // Do not create a missing profile in ordinary load-only operations.
    return this.update((v) => {
      if (!Number.isSafeInteger(v.timeFloor) || v.timeFloor < 0 || now + 2 < v.timeFloor)
        deny("reauthorization_required");
      v.timeFloor = Math.max(now, v.timeFloor);
      return { write: true };
    });
  }
  async active(origin) {
    if (origin !== this.origin) deny("recipient_binding_mismatch");
    return this.update((v) => {
      if (!v.active) deny("reauthorization_required");
      return { result: structuredClone(v.active) };
    });
  }
  async profile(actor) {
    const { issuer, ...scope } = actor;
    if (issuer !== this.origin || !same(scope, this.actor)) deny("recipient_binding_mismatch");
    return importProfile(await this.active(this.origin), actor);
  }
  async transact(key, change) {
    return this.update((v) => {
      if (!v.active) deny("reauthorization_required");
      const next = change(v.records[key] ?? null);
      if (next.write !== undefined) v.records[key] = next.write;
      return { write: next.write !== undefined, result: next.result };
    });
  }
  async bind(actor, identity, pins) {
    await this.profile(actor);
    await this.update((v) => {
      const old = v.active.pins ?? v.active.activation.anchor;
      if (
        !same(identity, v.active.activation.identity) ||
        pins.rootKeyId !== old.rootKeyId ||
        pins.registrySequence < old.registrySequence ||
        (pins.registrySequence === old.registrySequence &&
          pins.checkpointDigest !== old.checkpointDigest)
      )
        deny("registry_rollback");
      v.active.pins = structuredClone(pins);
      return { write: true };
    });
    return this.profile(actor);
  }
  async originalCiphertext(actor, operation, candidate) {
    const { inspect } = await import("./crypto.mjs");
    inspect(candidate);
    const key = "outbox:" + (await digest([actor, operation]));
    return this.transact(key, (v) => ({ write: v ?? candidate, result: v ?? candidate }));
  }
  async outbox(actor, operation) {
    return this.transact("outbox:" + (await digest([actor, operation])), (v) => ({ result: v }));
  }
}
