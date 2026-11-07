/** Fixed persistent content checks. Context expectations come from verified owner authority. */
import {
  BINDING,
  CONTRACT,
  PROFILE,
  deny,
  same,
  canonical,
  bytes,
  integer,
  validate,
  digest,
  fingerprint,
  keyId,
  verify,
  sign,
  inspect,
} from "./crypto.mjs";
import { permissionFor } from "./consents.mjs";
const TASK = ["taskId", "taskVersion", "executionEpoch", "authorityId", "authorityVersion"];
export function matchBinding(value, identity) {
  for (const k of BINDING) if (!same(value[k], identity[k])) deny("recipient_binding_mismatch");
}
export async function verifyEnvelope(
  carrier,
  { registry, identity, expected, now, purpose = "agent_read" },
) {
  if (!["agent_read", "new_publication", "owner_history"].includes(purpose))
    deny("invalid_purpose");
  const { context: c, payload } = inspect(carrier);
  matchBinding(c, identity);
  matchBinding(expected, identity);
  // Expectation must include the exact type, object, revision, recipient list and all business fields.
  const fields = [
    "objectType",
    "objectId",
    "revision",
    "recipients",
    ...(c.objectType === "task"
      ? [
          ...TASK,
          "expectedAuthorityVersion",
          "expectedAuthorityDigest",
          "resultPolicy",
          "ownerTaskFingerprint",
          "resourceBindings",
        ]
      : c.objectType === "result_revision"
        ? [...TASK, "runId", "manifestFingerprint"]
        : [
            "ref",
            "sourceEpoch",
            "sourceRevision",
            "permissionId",
            "permissionEpoch",
            "ownerEnvelopeFingerprint",
          ]),
  ];
  for (const k of fields)
    if (!Object.hasOwn(expected, k) || !same(c[k], expected[k])) deny("recipient_binding_mismatch");
  const cp = registry.snapshots.get(c.registrySequence);
  if (!cp || cp.digest !== c.checkpointDigest || cp.keyEpoch !== c.keyEpoch)
    deny("registry_conflict");
  if (c.issuedAt < identity.registeredAt || c.issuedAt > now) deny("key_authorization_required");
  if (
    purpose === "new_publication" &&
    (c.registrySequence !== registry.sequence ||
      c.issuedAt < Math.max(registry.current.issuedAt, now - 300))
  )
    deny("registry_conflict");
  const when = purpose === "owner_history" ? c.issuedAt : now,
    { sig } = registry.agent(identity, when);
  if (c.objectType === "result_revision") {
    if (!sig.capabilities.includes("result_write") || c.issuedAt < sig.notBefore)
      deny("key_authorization_required");
    for (const r of c.recipients) registry.cert(r.keyId, r.role, null, when);
    await verify(carrier.proof, sig.publicJwk, "fv-control+jws");
  } else {
    if (purpose !== "agent_read")
      for (const r of c.recipients)
        if (r.role === "recovery_enc") registry.cert(r.keyId, r.role, null, when);
    await verify(carrier.proof, registry.anchor.rootJwk, "fv-control+jws");
  }
  if (payload.ciphertextDigest !== (await digest(carrier.jwe))) deny("recipient_binding_mismatch");
  return { context: structuredClone(c), fingerprint: await fingerprint(carrier.proof) };
}
export async function requestProof({ identity, audience, path, request, now, privateKey }) {
  const parsed = new URL(audience);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    parsed.origin !== audience
  )
    deny("invalid_audience");
  const payload = {
    contractVersion: CONTRACT,
    profile: PROFILE,
    artifactType: "persistent_agent_request",
    purpose: "authenticated_request",
    ...Object.fromEntries(BINDING.map((k) => [k, identity[k]])),
    audience,
    method: "POST",
    path,
    bodyDigest: await digest(request),
    requestId: crypto.randomUUID(),
    nonce: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", ""),
    issuedAt: integer(now, 1),
    expiresAt: integer(now + 120, 1),
  };
  validate("PersistentAgentRequestPayload", payload);
  if (path.includes("//") || path.split("/").some((p) => p === "." || p === ".."))
    deny("invalid_path");
  return sign(payload, privateKey, identity.agentSigningKeyId, "fv-control+jws");
}
export async function verifyManifest(
  manifest,
  { identity, taskContext, taskFingerprint, consent, now },
) {
  validate("PersistentRunManifest", manifest);
  matchBinding(manifest, identity);
  if (!(
    manifest.createdAt <= now &&
    now < manifest.expiresAt &&
    manifest.createdAt < manifest.expiresAt &&
    manifest.expiresAt <= manifest.createdAt + 7200
  ))
    deny("run_expired");
  if (
    manifest.runId !==
    "prun_" +
      (await digest([manifest.ownerSubject, manifest.vaultId, manifest.taskId, manifest.triggerId]))
  )
    deny("recipient_binding_mismatch");
  for (const k of TASK) if (!same(manifest[k], taskContext[k])) deny("version_conflict");
  if (
    manifest.taskPublicationFingerprint !== taskFingerprint ||
    manifest.resultPolicy !== taskContext.resultPolicy
  )
    deny("recipient_binding_mismatch");
  const sorted = [...manifest.inputs].sort((a, b) =>
    new TextDecoder().decode(canonical(a.ref)) < new TextDecoder().decode(canonical(b.ref))
      ? -1
      : 1,
  );
  if (
    !same(sorted, manifest.inputs) ||
    !same(
      manifest.inputs.map((i) => ({ ref: i.ref, sourceEpoch: i.sourceEpoch })),
      [...taskContext.resourceBindings].sort((a, b) =>
        new TextDecoder().decode(canonical(a.ref)) < new TextDecoder().decode(canonical(b.ref))
          ? -1
          : 1,
      ),
    )
  )
    deny("recipient_binding_mismatch");
  for (const i of manifest.inputs) permissionFor(consent, i);
  return { manifest: structuredClone(manifest), fingerprint: await digest(manifest) };
}
