/** Owner-authenticated first-key handoff; only opaque public packets leave the host. */
import { randomBytes } from "node:crypto";
import {
  deny,
  exact,
  canonical,
  bytes,
  parsed,
  same,
  identifier,
  keyId,
  sign,
  digest,
  validate,
  requireCurrentCredential,
} from "../../../../packages/encrypted-workspace/dist/core.mjs";
import { importProfile } from "./files.mjs";
import { AgentClient } from "./client.mjs";

const PROFILE = "folioview.agent-pairing.v1";
const FIELDS = [
  "setupIntentId",
  "ownerSubject",
  "vaultId",
  "connectionId",
  "clientId",
  "authorizationId",
  "issuedAt",
  "expiresAt",
  "expectedGeneration",
  "expectedCredentialFingerprint",
];
const encode = (value) => Buffer.from(value).toString("base64url");
export function context(bootstrap) {
  const { issuer, provider, actor, setup } = bootstrap;
  const origin = new URL(issuer);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== issuer ||
    !["muse", "chatgpt"].includes(provider)
  )
    deny("invalid_runtime_origin");
  exact(actor, ["ownerSubject", "vaultId", "connectionId", "clientId"]);
  for (const k of Object.keys(actor)) {
    identifier(actor[k]);
    if (setup[k] !== actor[k]) deny("recipient_binding_mismatch");
  }
  for (const k of ["setupIntentId", "authorizationId"]) identifier(setup[k]);
  if (
    ![setup.issuedAt, setup.expiresAt, setup.expectedGeneration].every(Number.isSafeInteger) ||
    setup.issuedAt < 0 ||
    setup.expiresAt !== setup.issuedAt + 600 ||
    setup.expectedGeneration < 0 ||
    (setup.expectedGeneration === 0) !== (setup.expectedCredentialFingerprint === null)
  )
    deny("invalid_fields");
  if (setup.expectedCredentialFingerprint !== null)
    validate("Digest", setup.expectedCredentialFingerprint);
  return {
    profile: PROFILE,
    issuer,
    provider,
    ...Object.fromEntries(FIELDS.map((k) => [k, setup[k]])),
  };
}
export async function packet(secret, phase, binding, value = undefined) {
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    { name: "AES-GCM" },
    false,
    value === undefined ? ["decrypt"] : ["encrypt"],
  );
  if (bytes(secret).length !== 32) deny("invalid_fields");
  const aad = canonical({ ...binding, phase });
  if (value === undefined) deny("invalid_operation");
  const iv = randomBytes(12),
    plaintext = canonical(value);
  if (plaintext.length + 16 > 8192) deny("payload_too_large");
  return {
    version: 1,
    iv: encode(iv),
    ciphertext: encode(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plaintext),
    ),
  };
}
export async function unpack(secret, phase, binding, value) {
  exact(value, ["version", "iv", "ciphertext"]);
  if (
    value.version !== 1 ||
    bytes(secret).length !== 32 ||
    bytes(value.iv).length !== 12 ||
    bytes(value.ciphertext).length > 8192
  )
    deny("invalid_fields");
  try {
    const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "AES-GCM" }, false, [
      "decrypt",
    ]);
    return parsed(
      new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: bytes(value.iv),
            additionalData: canonical({ ...binding, phase }),
          },
          key,
          bytes(value.ciphertext),
        ),
      ),
    );
  } catch {
    deny("reauthorization_required");
  }
}
async function freshProfile(storage) {
  const clean = (jwk) => Object.fromEntries(["kty", "crv", "x", "y", "d"].map((k) => [k, jwk[k]]));
  const sig = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  return {
    origin: storage.origin,
    actor: storage.actor,
    provider: storage.provider,
    signingPrivateJwk: clean(await crypto.subtle.exportKey("jwk", sig.privateKey)),
    encryptionPrivateJwk: clean(await crypto.subtle.exportKey("jwk", enc.privateKey)),
  };
}
export async function prepare(storage, bootstrap, { clock = () => Date.now() / 1000 } = {}) {
  const binding = context(bootstrap),
    now = Math.floor(clock());
  if (
    storage.origin !== binding.issuer ||
    storage.provider !== binding.provider ||
    !same(storage.actor, bootstrap.actor) ||
    now < binding.issuedAt - 60 ||
    now >= binding.expiresAt
  )
    deny("reauthorization_required");
  const owner = new URL(bootstrap.ownerUrl);
  if (
    owner.protocol !== "https:" ||
    owner.pathname !== "/agents" ||
    owner.search ||
    owner.hash ||
    owner.username ||
    owner.password
  )
    deny("invalid_owner_origin");
  let existing;
  try {
    existing = await storage.update((v) => ({ result: v.pending }), { create: true });
  } catch (error) {
    if (error.code !== "credential_store_corrupt") throw error;
    await storage.resetCorruptForAuthorization();
    existing = await storage.update((v) => ({ result: v.pending }), { create: true });
  }
  let candidate = existing;
  if (!candidate || candidate.context.setupIntentId !== binding.setupIntentId) {
    const profile = await freshProfile(storage),
      imported = await importProfile(profile, { issuer: storage.origin, ...storage.actor });
    const secret = encode(randomBytes(32));
    const signingId = await keyId(imported.signingPublicJwk);
    const offer = {
      contractVersion: "folioview.agent-workspace.v2.0",
      profile: "folioview.agent-key-offer.v1",
      artifactType: "agent_key_offer",
      ...Object.fromEntries(Object.entries(binding).filter(([k]) => k !== "profile")),
      agentId: "agent_" + signingId,
      signingPublicJwk: imported.signingPublicJwk,
      encryptionPublicJwk: imported.encryptionPublicJwk,
    };
    const proof = await sign(offer, imported.signingPrivateKey, signingId, "fv-control+jws");
    candidate = {
      profile,
      secret,
      context: binding,
      offer: await packet(secret, "offer", binding, proof),
    };
  }
  const pending = await storage.update(
    (v) => {
      if (
        v.active?.activation?.lease &&
        binding.expectedGeneration < v.active.activation.lease.generation
      )
        deny("registry_rollback");
      if (v.pending?.context.setupIntentId === binding.setupIntentId) {
        if (!same(v.pending.context, binding)) deny("recipient_binding_mismatch");
        return { result: v.pending };
      }
      if (now + 2 < v.timeFloor) deny("reauthorization_required");
      v.pending = candidate;
      v.timeFloor = Math.max(v.timeFloor, now);
      return { write: true, result: v.pending };
    },
    { create: true },
  );
  await importProfile(pending.profile, { issuer: storage.origin, ...storage.actor });
  owner.hash =
    "agent_authorization=" +
    encode(
      canonical({
        version: 1,
        issuer: binding.issuer,
        vaultId: binding.vaultId,
        connectionId: binding.connectionId,
        setupIntentId: binding.setupIntentId,
        secret: pending.secret,
      }),
    );
  return {
    setupIntentId: binding.setupIntentId,
    offer: pending.offer,
    authorizationUrl: owner.href,
  };
}
class CandidateStorage {
  constructor(record, clock) {
    this.record = record;
    this.records = {};
    this.clock = clock;
  }
  async noteTime(now) {
    if (now < this.record.activation.lease.issuedAt) deny("reauthorization_required");
  }
  async active() {
    return this.record;
  }
  async profile(actor) {
    return importProfile(this.record, actor);
  }
  async transact(key, change) {
    const next = change(this.records[key] ?? null);
    if (next.write !== undefined) this.records[key] = next.write;
    return next.result;
  }
  async bind(actor, identity, pins) {
    if (!same(identity, this.record.activation.identity)) deny("recipient_binding_mismatch");
    this.record.pins = pins;
    return this.profile(actor);
  }
}
export async function activate(
  storage,
  response,
  { fetch = globalThis.fetch.bind(globalThis), clock = () => Date.now() / 1000 } = {},
) {
  exact(response, ["setupIntentId", "state", "activation"]);
  if (response.state !== "approved" || !response.activation) deny("authorization_pending");
  const packetDigest = await digest(response);
  const state = await storage.update((v) => ({ result: structuredClone(v) }));
  if (!state.pending) {
    if (state.active?.activationPacketDigest !== packetDigest) deny("reauthorization_required");
    return new AgentClient({ origin: storage.origin, storage, fetch, clock }).initialize();
  }
  const pending = state.pending;
  if (response.setupIntentId !== pending.context.setupIntentId) deny("recipient_binding_mismatch");
  const value = await unpack(pending.secret, "activation", pending.context, response.activation);
  exact(value, [
    "contractVersion",
    "profile",
    "setupIntentId",
    "issuer",
    "provider",
    "actor",
    "rootJwk",
    "rootKeyId",
    "anchor",
    "identity",
    "binding",
    "lease",
    "approval",
    "previousLease",
  ]);
  if (
    value.contractVersion !== "folioview.agent-workspace.v2.0" ||
    value.profile !== "folioview.agent-activation.v1" ||
    value.setupIntentId !== response.setupIntentId ||
    value.issuer !== storage.origin ||
    value.provider !== storage.provider ||
    !same(value.actor, storage.actor) ||
    (await keyId(value.rootJwk)) !== value.rootKeyId ||
    value.anchor.rootKeyId !== value.rootKeyId ||
    value.lease.generation !== pending.context.expectedGeneration + 1 ||
    value.lease.previousCredentialFingerprint !== pending.context.expectedCredentialFingerprint
  )
    deny("recipient_binding_mismatch");
  validate("PersistentAgentIdentity", value.identity);
  exact(value.binding, ["protected", "payload", "signature"]);
  exact(value.approval, ["protected", "payload", "signature"]);
  const profile = await importProfile(pending.profile, {
    issuer: storage.origin,
    ...storage.actor,
  });
  if (
    value.identity.agentId !== "agent_" + (await keyId(profile.signingPublicJwk)) ||
    value.identity.agentSigningKeyId !== (await keyId(profile.signingPublicJwk)) ||
    value.identity.agentEncryptionKeyId !== (await keyId(profile.encryptionPublicJwk))
  )
    deny("recipient_binding_mismatch");
  requireCurrentCredential(value.lease, {
    identity: value.identity,
    audience: storage.origin,
    now: Math.floor(clock()),
  });
  const record = { ...pending.profile, activation: value, activationPacketDigest: packetDigest };
  const candidate = new CandidateStorage(record, clock);
  const result = await new AgentClient({
    origin: storage.origin,
    storage: candidate,
    fetch,
    clock,
  }).initialize();
  await storage.update((v) => {
    if (!same(v.pending, pending) || !same(v.active, state.active)) deny("version_conflict");
    v.active = record;
    v.pending = null;
    v.records = candidate.records;
    return { write: true };
  });
  return result;
}
