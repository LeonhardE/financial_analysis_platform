/** Root-authenticated append-only authority, adapted from the reviewed helper. */
import {
  BINDING,
  deny,
  exact,
  canonical,
  same,
  bytes,
  parsed,
  integer,
  digestString,
  digest,
  fingerprint,
  array,
  unique,
  keyId,
  verify,
  validate,
} from "./crypto.mjs";
const ROLES = ["root_sig", "device_sig", "device_enc", "agent_sig", "agent_enc", "recovery_enc"];
// The private generic mode exercises the defensive byte bound independently of
// the certificate schema. Production callers use the fixed-profile factory below.
function certificateVerifier(root, expectedRootKeyId, staticCertificate = false) {
  const rootJwk = structuredClone(root),
    rootKeyId = expectedRootKeyId,
    typ = "fv-control+jws",
    certificates = new Map(),
    decoder = new TextDecoder();
  let certificateBytes = 0,
    rootChecked = false;
  return async (input) => {
    // Key and verification use these same private inputs across every await.
    const signed = structuredClone(input),
      keyBytes = canonical([rootJwk, rootKeyId, typ, signed]),
      key = decoder.decode(keyBytes),
      cached = certificates.get(key);
    if (cached !== undefined) return structuredClone(cached);
    if (staticCertificate && !rootChecked) {
      if ((await keyId(rootJwk)) !== rootKeyId) deny("root_pin_mismatch");
      rootChecked = true;
    }
    const payload = await verify(signed, rootJwk, typ);
    let result = payload;
    if (staticCertificate) {
      validate("KeyCertificatePayload", payload);
      result = {
        payload,
        publicKeyId: await keyId(payload.publicJwk),
        payloadDigest: await digest(payload),
      };
    }
    // Include static metadata in the same bound as the complete input and payload.
    const size = keyBytes.length + canonical(result).length;
    if (!certificates.has(key) && certificates.size < 128 && certificateBytes + size <= 1_048_576) {
      certificates.set(key, structuredClone(result));
      certificateBytes += size;
    }
    return result;
  };
}
/** One history attempt only. This proves static certificate integrity, never authority. */
export function createRegistryCertificateVerifier(root, expectedRootKeyId) {
  return certificateVerifier(root, expectedRootKeyId, true);
}
export class Registry {
  constructor(anchor) {
    this.anchor = structuredClone(anchor);
    this.sequence = 0;
    this.current = null;
    this.history = new Map();
    this.localEpochs = new Map();
    this.snapshots = new Map();
  }
  checkIdentity(value) {
    if (value.ownerSubject !== this.anchor.ownerSubject || value.vaultId !== this.anchor.vaultId)
      deny("recipient_binding_mismatch");
  }
  async load(bundles, now) {
    // Keep the key and verification inputs on the same private snapshot across
    // awaits. Neither callers nor mutable Registry snapshots can seed the memo.
    array(bundles, 32, 1);
    const providedBundles = [...bundles],
      rootJwk = structuredClone(this.anchor.rootJwk),
      rootKeyId = this.anchor.rootKeyId,
      verifyCertificate = createRegistryCertificateVerifier(rootJwk, rootKeyId);
    if ((await keyId(rootJwk)) !== rootKeyId) deny("root_pin_mismatch");
    for (const provided of providedBundles) {
      validate("RegistryBundle", provided);
      if (canonical(provided).length > 131072) deny("payload_too_large");
      // Bound each JSON bundle before copying; use its private rows throughout
      // checkpoint and certificate awaits. Later entries cannot change this row.
      const b = structuredClone(provided);
      validate("RegistryBundle", b);
      if (canonical(b).length > 131072) deny("payload_too_large");
      const cp = await verify(b.checkpoint, rootJwk, "fv-control+jws");
      validate("RegistryCheckpointPayload", cp);
      this.checkIdentity(cp);
      if (
        cp.rootKeyId !== rootKeyId ||
        cp.rootEpoch !== this.anchor.rootEpoch ||
        cp.issuedAt > now ||
        (this.sequence === 0 && (cp.rootEpoch !== 1 || cp.keyEpoch !== 1))
      )
        deny("root_pin_mismatch");
      const d = await digest(cp);
      if (this.history.has(cp.registrySequence)) {
        if (this.history.get(cp.registrySequence) !== d) deny("registry_rollback");
        continue;
      }
      if (
        cp.registrySequence !== this.sequence + 1 ||
        cp.registrySequence > 32 ||
        cp.previousDigest !== (this.current?.digest ?? null)
      )
        deny("registry_chain_mismatch");
      if (
        this.current &&
        (cp.keyEpoch < this.current.keyEpoch ||
          cp.issuedAt < this.current.issuedAt ||
          [...this.current.revoked].some((k) => !cp.revokedKeyIds.includes(k)))
      )
        deny("registry_rollback");
      const keys = new Map(),
        ids = [],
        descriptions = [],
        generations = new Set();
      for (const row of b.entries) {
        const { payload: c, publicKeyId, payloadDigest } = await verifyCertificate(row.certificate);
        this.checkIdentity(c);
        if (
          c.issuerKeyId !== rootKeyId ||
          c.keyId !== publicKeyId ||
          keys.has(c.keyId) ||
          c.expiresAt <= c.notBefore ||
          !ROLES.includes(c.role) ||
          c.role.startsWith("agent_") !== (c.connectionId !== null) ||
          row.active === cp.revokedKeyIds.includes(c.keyId) ||
          (c.role === "root_sig") !== (c.keyId === rootKeyId)
        )
          deny("invalid_certificate");
        const permitted =
          c.role === "device_sig"
            ? ["object_write", "task_grant", "control_write"]
            : c.role === "agent_sig"
              ? ["run_request", "result_write"]
              : [];
        if (c.capabilities.some((x) => !permitted.includes(x))) deny("invalid_certificate");
        const identity = [c.principalId, c.role, c.connectionId].join("/"),
          generation = identity + "/" + c.keyEpoch;
        if (generations.has(generation)) deny("key_epoch_conflict");
        generations.add(generation);
        const old = this.current?.keys.get(c.keyId);
        if (old && !same(Object.fromEntries(Object.keys(c).map((k) => [k, old[k]])), c))
          deny("registry_conflict");
        if (!old && this.current && c.keyEpoch <= (this.localEpochs.get(identity) ?? 0))
          deny("key_epoch_conflict");
        keys.set(c.keyId, { ...c, active: row.active });
        ids.push(c.certificateId);
        descriptions.push({
          certificateId: c.certificateId,
          payloadDigest,
          active: row.active,
        });
      }
      unique(ids);
      if (
        (await digest(
          descriptions.sort((a, b) =>
            a.certificateId < b.certificateId ? -1 : a.certificateId > b.certificateId ? 1 : 0,
          ),
        )) !== cp.entriesDigest
      )
        deny("registry_digest_mismatch");
      if (
        cp.registrySequence === this.anchor.registrySequence &&
        d !== this.anchor.checkpointDigest
      )
        deny("checkpoint_pin_mismatch");
      for (const c of keys.values()) {
        const identity = [c.principalId, c.role, c.connectionId].join("/");
        this.localEpochs.set(identity, Math.max(c.keyEpoch, this.localEpochs.get(identity) ?? 0));
      }
      this.sequence = cp.registrySequence;
      this.history.set(cp.registrySequence, d);
      this.current = {
        keys,
        revoked: new Set(cp.revokedKeyIds),
        digest: d,
        keyEpoch: cp.keyEpoch,
        issuedAt: cp.issuedAt,
      };
      this.snapshots.set(cp.registrySequence, {
        ...this.current,
        localEpochs: new Map(this.localEpochs),
      });
    }

    if (
      this.sequence < this.anchor.registrySequence ||
      this.history.get(this.anchor.registrySequence) !== this.anchor.checkpointDigest
    )
      deny("registry_rollback");
    return this;
  }
  cert(kid, role, connection, now, sequence = this.sequence) {
    const snapshot = this.snapshots.get(sequence),
      c = snapshot?.keys.get(kid);
    if (
      !c ||
      !c.active ||
      snapshot.revoked.has(kid) ||
      c.role !== role ||
      c.connectionId !== connection ||
      !(c.notBefore <= now && now < c.expiresAt) ||
      c.keyEpoch !== snapshot.localEpochs.get([c.principalId, c.role, c.connectionId].join("/"))
    )
      deny("key_authorization_required");
    return c;
  }
  agent(identity, now, sequence = this.sequence) {
    validate("PersistentAgentIdentity", identity);
    this.checkIdentity(identity);
    if (
      identity.status !== "active" ||
      identity.identityEpoch !== 1 ||
      identity.rootKeyId !== this.anchor.rootKeyId ||
      identity.registeredAt > now
    )
      deny("key_authorization_required");
    const sig = this.cert(
        identity.agentSigningKeyId,
        "agent_sig",
        identity.connectionId,
        now,
        sequence,
      ),
      enc = this.cert(
        identity.agentEncryptionKeyId,
        "agent_enc",
        identity.connectionId,
        now,
        sequence,
      );
    if (
      sig.principalId !== identity.agentId ||
      enc.principalId !== identity.agentId ||
      sig.keyEpoch !== enc.keyEpoch ||
      !sig.capabilities.includes("run_request")
    )
      deny("recipient_binding_mismatch");
    return { sig, enc };
  }
  pin() {
    return {
      rootKeyId: this.anchor.rootKeyId,
      registrySequence: this.sequence,
      checkpointDigest: this.current.digest,
    };
  }
  async binding(signed, identity, actor, now) {
    validate("PersistentAgentIdentity", identity);
    const payload = parsed(bytes(signed.payload), true);
    validate("PersistentAgentBindingPayload", payload);
    const snap = this.snapshots.get(payload.registrySequence);
    if (!snap || snap.digest !== payload.checkpointDigest || snap.keyEpoch !== payload.keyEpoch)
      deny("registry_conflict");
    const author = this.cert(
      payload.deviceSigningKeyId,
      "device_sig",
      null,
      payload.issuedAt,
      payload.registrySequence,
    );
    if (!author.capabilities.includes("control_write")) deny("key_authorization_required");
    await verify(signed, author.publicJwk, "fv-control+jws");
    for (const k of ["ownerSubject", "vaultId", "connectionId", "clientId"])
      if (payload[k] !== actor[k] || identity[k] !== actor[k]) deny("recipient_binding_mismatch");
    for (const k of BINDING.filter((k) => k !== "bindingFingerprint"))
      if (payload[k] !== identity[k]) deny("recipient_binding_mismatch");
    if (
      identity.bindingFingerprint !== (await fingerprint(signed)) ||
      identity.registeredAt !== payload.issuedAt ||
      payload.issuedAt < snap.issuedAt ||
      payload.issuedAt < author.notBefore
    )
      deny("recipient_binding_mismatch");
    this.agent(identity, now);
    return identity;
  }
}
