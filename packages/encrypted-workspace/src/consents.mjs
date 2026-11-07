/** Reconstruct authority from original signed controls, never an unsigned aggregate. */
import {
  BINDING,
  CONTRACT,
  deny,
  same,
  canonical,
  bytes,
  parsed,
  validate,
  integer,
  unique,
  verify,
  fingerprint,
  digest,
  reference,
} from "./crypto.mjs";
export const CONSENT_PROFILE = "folioview.persistent-resource-consent.v1";
const bind = (value, identity) => {
  for (const k of BINDING) if (!same(value[k], identity[k])) deny("recipient_binding_mismatch");
};
function history(item) {
  unique(item.selectedHistory);
  if (
    !same(
      item.selectedHistory,
      [...item.selectedHistory].sort((a, b) => a - b),
    ) ||
    item.selectedHistory.some((v) => v >= item.fromRevision)
  )
    deny("invalid_history");
}
export function shape(value) {
  validate("PersistentResourceConsent", value);
  if (value.createdAt > value.updatedAt) deny("invalid_consent");
  const refs = [];
  unique(value.permissions.map((p) => p.permissionId));
  if (
    !same(
      value.permissions.map((p) => p.permissionId),
      value.permissions.map((p) => p.permissionId).sort(),
    )
  )
    deny("invalid_consent");
  for (const p of value.permissions) {
    reference(p.ref);
    history(p);
    if (p.approvedAt < value.createdAt || p.approvedAt > value.updatedAt) deny("invalid_consent");
    if (p.status === "active") {
      if (p.revokedAt !== null || p.revocationFingerprint !== null) deny("invalid_consent");
      refs.push(new TextDecoder().decode(canonical(p.ref)));
    } else if (
      p.permissionEpoch < 2 ||
      p.revokedAt === null ||
      p.revocationFingerprint === null ||
      p.revokedAt < p.approvedAt ||
      p.revokedAt > value.updatedAt
    )
      deny("invalid_consent");
  }
  unique(refs);
  if (refs.length > 10) deny("invalid_consent");
  return value;
}
export async function applyConsent(signed, current, identity, registry, sourceStates) {
  const payload = parsed(bytes(signed.payload), true),
    approval = payload.artifactType === "persistent_resource_approval";
  validate(
    approval ? "PersistentResourceApprovalPayload" : "PersistentResourceRevocationPayload",
    payload,
  );
  if (canonical(signed).length > 65536) deny("payload_too_large");
  bind(payload, identity);
  const snap = registry.snapshots.get(payload.registrySequence);
  if (
    !snap ||
    snap.digest !== payload.checkpointDigest ||
    snap.keyEpoch !== payload.keyEpoch ||
    payload.issuedAt < snap.issuedAt
  )
    deny("registry_conflict");
  const h = parsed(bytes(signed.protected));
  let key = registry.anchor.rootJwk;
  if (h.kid !== registry.anchor.rootKeyId) {
    if (approval) deny("key_authorization_required");
    const cert = registry.cert(
      h.kid,
      "device_sig",
      null,
      payload.issuedAt,
      payload.registrySequence,
    );
    if (!cert.capabilities.includes("control_write")) deny("key_authorization_required");
    key = cert.publicJwk;
  }
  await verify(signed, key, "fv-control+jws");
  if (payload.authorKeyId !== h.kid) deny("recipient_binding_mismatch");
  if (current) {
    shape(current);
    bind(current, identity);
    if (current.consentId !== payload.consentId) deny("recipient_binding_mismatch");
  }
  if (
    payload.expectedVersion !== (current?.version ?? 0) ||
    payload.expectedConsentDigest !== (current ? await digest(current) : null) ||
    payload.issuedAt < (current?.updatedAt ?? identity.registeredAt)
  )
    deny("version_conflict");
  const permissions = new Map(
    (current?.permissions ?? []).map((p) => [p.permissionId, structuredClone(p)]),
  );
  const fp = await fingerprint(signed);
  if (approval) {
    registry.agent(identity, payload.issuedAt, payload.registrySequence);
    if (!Array.isArray(sourceStates) || sourceStates.length !== payload.resources.length)
      deny("invalid_sources");
    const sources = new Map();
    for (const s of sourceStates) {
      validate("ConsentSourceState", s);
      if (s.ownerSubject !== identity.ownerSubject || s.vaultId !== identity.vaultId)
        deny("recipient_binding_mismatch");
      const ref = new TextDecoder().decode(canonical(s.ref));
      if (sources.has(ref)) deny("invalid_sources");
      sources.set(ref, s);
    }
    unique(payload.resources.map((p) => p.permissionId));
    unique(payload.resources.map((p) => new TextDecoder().decode(canonical(p.ref))));
    for (const p of payload.resources) {
      history(p);
      const source = sources.get(new TextDecoder().decode(canonical(p.ref)));
      if (
        !source ||
        source.state !== "active" ||
        source.sourceEpoch !== p.sourceEpoch ||
        source.currentRevision === null ||
        p.fromRevision > source.currentRevision
      )
        deny("source_unavailable");
      const old = permissions.get(p.permissionId);
      if (!old) {
        if (
          p.expectedPermissionEpoch !== 0 ||
          p.fromRevision !== source.currentRevision ||
          [...permissions.values()].some((v) => v.status === "active" && same(v.ref, p.ref))
        )
          deny("version_conflict");
        const { permissionId, ref, sourceEpoch, fromRevision, selectedHistory } = p;
        permissions.set(p.permissionId, {
          permissionId,
          ref,
          sourceEpoch,
          fromRevision,
          selectedHistory,
          versionPolicy: "current_and_future",
          permissionEpoch: 1,
          status: "active",
          approvedAt: payload.issuedAt,
          approvalFingerprint: fp,
          revokedAt: null,
          revocationFingerprint: null,
        });
      } else {
        if (
          old.status !== "active" ||
          old.permissionEpoch !== p.expectedPermissionEpoch ||
          !["ref", "sourceEpoch", "fromRevision"].every((k) => same(old[k], p[k])) ||
          old.selectedHistory.some((v) => !p.selectedHistory.includes(v))
        )
          deny("version_conflict");
        if (!same(old.selectedHistory, p.selectedHistory))
          permissions.set(p.permissionId, {
            ...old,
            selectedHistory: p.selectedHistory,
            permissionEpoch: integer(old.permissionEpoch + 1, 1),
            approvedAt: payload.issuedAt,
            approvalFingerprint: fp,
          });
      }
    }
  } else {
    if (!current) deny("not_found");
    unique(payload.targets.map((t) => t.permissionId));
    for (const t of payload.targets) {
      const p = permissions.get(t.permissionId);
      if (
        !p ||
        p.status !== "active" ||
        p.permissionEpoch !== t.expectedPermissionEpoch ||
        !same(p.ref, t.ref)
      )
        deny("version_conflict");
      permissions.set(t.permissionId, {
        ...p,
        status: "revoked",
        permissionEpoch: integer(p.permissionEpoch + 1, 1),
        revokedAt: payload.issuedAt,
        revocationFingerprint: fp,
      });
    }
  }
  return shape({
    contractVersion: CONTRACT,
    profile: CONSENT_PROFILE,
    ...Object.fromEntries(BINDING.map((k) => [k, identity[k]])),
    consentId: payload.consentId,
    purpose: "analysis",
    version: integer(payload.expectedVersion + 1, 1),
    createdAt: current?.createdAt ?? payload.issuedAt,
    updatedAt: payload.issuedAt,
    lastOperationId: payload.stableOperationId,
    lastControlFingerprint: fp,
    permissions: [...permissions.values()].sort((a, b) =>
      a.permissionId < b.permissionId ? -1 : 1,
    ),
  });
}
export async function verifyConsentChain({ consent, receipts, identity, registry, pin = null }) {
  if (consent === null) {
    if (receipts.length || pin) deny("consent_rollback");
    return null;
  }
  if (!Array.isArray(receipts) || receipts.length !== consent.version || receipts.length > 96)
    deny("invalid_consent_chain");
  unique(receipts.map((r) => r.operationId));
  let state = null,
    pinSeen = pin === null;
  for (const receipt of receipts) {
    state = await applyConsent(receipt.command, state, identity, registry, receipt.sourceStates);
    if (
      receipt.operationId !== state.lastOperationId ||
      !same(receipt.consent, state) ||
      receipt.priorDigest !==
        (state.version === 1
          ? null
          : parsed(bytes(receipt.command.payload), true).expectedConsentDigest) ||
      receipt.fingerprint !== state.lastControlFingerprint
    )
      deny("invalid_consent_receipt");
    if (pin && state.version === pin.version) {
      if ((await digest(state)) !== pin.digest) deny("consent_rollback");
      pinSeen = true;
    }
  }
  if (!pinSeen || !same(state, consent)) deny("consent_rollback");
  return state;
}
export function permissionFor(consent, c) {
  const p = consent?.permissions.find((p) => p.permissionId === c.permissionId);
  if (
    !p ||
    p.status !== "active" ||
    p.permissionEpoch !== c.permissionEpoch ||
    p.sourceEpoch !== c.sourceEpoch ||
    !same(p.ref, c.ref) ||
    (c.sourceRevision < p.fromRevision && !p.selectedHistory.includes(c.sourceRevision))
  )
    deny("insufficient_scope");
  return p;
}
