/** Bounded Owner approvals; storage consumers enforce atomic replacement and replay fences. */
import {
  BINDING,
  canonical,
  deny,
  integer,
  validate,
  verify,
  fingerprint,
  bytes,
  parsed,
} from "./crypto.mjs";
import { Registry } from "./registry.mjs";
export const AGENT_CREDENTIAL_PROFILE = "folioview.agent-credential.v1";
export const DEFAULT_CREDENTIAL_SECONDS = 90 * 24 * 60 * 60;
export const CREDENTIAL_NOTICE_SECONDS = 7 * 24 * 60 * 60;
export function credentialStatus(lease, now) {
  validate("AgentCredentialLease", lease);
  integer(now);
  if (!(
    lease.issuedAt < lease.expiresAt &&
    lease.expiresAt <= lease.issuedAt + DEFAULT_CREDENTIAL_SECONDS
  ))
    deny("invalid_fields");
  if (lease.status === "revoked") return "revoked";
  if (now >= lease.expiresAt) return "expired";
  if (now < lease.issuedAt) deny("key_authorization_required");
  return lease.expiresAt - now <= CREDENTIAL_NOTICE_SECONDS ? "expiring" : "active";
}
export function requireCurrentCredential(lease, { identity, audience, now }) {
  validate("PersistentAgentIdentity", identity);
  if (
    !["active", "expiring"].includes(credentialStatus(lease, now)) ||
    identity.status !== "active" ||
    lease.audience !== audience
  )
    deny("key_authorization_required");
  for (const k of BINDING) if (identity[k] !== lease[k]) deny("recipient_binding_mismatch");
  return lease;
}
export async function approveCredential(
  signed,
  { registry, identity, currentLease = null, setupIntentId, audience, now },
) {
  integer(now);
  if (canonical(signed).length > 16384) deny("payload_too_large");
  if (!(registry instanceof Registry)) deny("key_authorization_required");
  registry.agent(identity, now);
  let url;
  try {
    url = new URL(audience);
  } catch {
    deny("recipient_binding_mismatch");
  }
  if (
    (url.port && url.port !== "443") ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname ||
    /[\s\\]/.test(audience)
  )
    deny("recipient_binding_mismatch");
  const p = parsed(bytes(signed.payload), true);
  validate("AgentCredentialApproval", p);
  const author = registry.cert(p.deviceSigningKeyId, "device_sig", null, now);
  await verify(signed, author.publicJwk, "fv-control+jws");
  if (
    !author.capabilities.includes("control_write") ||
    p.issuedAt > now ||
    p.issuedAt < Math.max(author.notBefore, registry.current.issuedAt, now - 300)
  )
    deny("key_authorization_required");
  if (
    p.registrySequence !== registry.sequence ||
    p.checkpointDigest !== registry.current.digest ||
    p.keyEpoch !== registry.current.keyEpoch
  )
    deny("registry_conflict");
  for (const k of BINDING) if (identity[k] !== p[k]) deny("recipient_binding_mismatch");
  if (p.audience !== audience || p.setupIntentId !== setupIntentId)
    deny("recipient_binding_mismatch");
  let generation = 1,
    previous = null;
  if (currentLease !== null) {
    validate("AgentCredentialLease", currentLease);
    for (const k of ["ownerSubject", "vaultId", "rootKeyId", "connectionId", "clientId"])
      if (currentLease[k] !== identity[k]) deny("recipient_binding_mismatch");
    for (const k of ["agentId", "agentSigningKeyId", "agentEncryptionKeyId", "bindingFingerprint"])
      if (currentLease[k] === identity[k]) deny("key_authorization_required");
    generation = currentLease.generation + 1;
    previous = currentLease.credentialFingerprint;
  }
  if (p.generation !== generation || p.previousCredentialFingerprint !== previous)
    deny("version_conflict");
  const { sig, enc } = registry.agent(identity, now);
  if (
    !(
      now < p.expiresAt &&
      p.expiresAt <= Math.min(p.issuedAt + DEFAULT_CREDENTIAL_SECONDS, sig.expiresAt, enc.expiresAt)
    ) ||
    p.issuedAt < identity.registeredAt
  )
    deny("key_authorization_required");
  const omitted = new Set([
    "artifactType",
    "deviceSigningKeyId",
    "stableOperationId",
    "registrySequence",
    "checkpointDigest",
    "keyEpoch",
  ]);
  const lease = {
    ...Object.fromEntries(Object.entries(p).filter(([k]) => !omitted.has(k))),
    credentialFingerprint: await fingerprint(signed),
    status: "active",
  };
  validate("AgentCredentialLease", lease);
  return requireCurrentCredential(lease, { identity, audience, now });
}
