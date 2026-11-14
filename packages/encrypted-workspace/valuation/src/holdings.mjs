/** Holdings-only entry point for size-bounded Agent clients. No valuation/network code. */
import {
  canonical,
  same,
  exact,
  deny,
  parsed,
  inspect,
  context,
  privatePayload,
  jose,
  JWE_HEADER,
  CONTRACT,
  PROFILE,
  sign,
  digest,
} from "../../dist/core.mjs";
import validators from "./holdings-validators.cjs";
import { need, unique, time, validateShape } from "./validation.mjs";
export const HOLDINGS_FACTS_PROFILE = "folioview.holdings-facts.v2";
export function holdingsFacts(value, { snapshotId = null, revision = null } = {}) {
  const result = validateShape(validators.HoldingsFactsContent, value, 196608),
    d = result.data;
  if (revision !== null) need(Number.isSafeInteger(revision) && revision >= 1);
  if (snapshotId !== null) need(d.snapshotId === snapshotId);
  unique(d.accounts.map((a) => a.accountId));
  need(d.accounts.reduce((count, a) => count + a.positions.length, 0) <= 1000);
  need(result.sourceAsOf === null || time(result.sourceAsOf) <= time(result.fetchedAt));
  need(d.reportDate === null || d.reportDate <= result.fetchedAt.slice(0, 10));
  if (revision !== null) {
    if (d.previousSnapshot !== null)
      need(
        d.previousSnapshot.sourceRevision < revision &&
          d.previousSnapshot.snapshotId !== d.snapshotId,
      );
    if (d.importSnapshot !== null)
      need(
        d.importSnapshot.sourceRevision <= revision &&
          (d.importSnapshot.sourceRevision === revision) ===
            (d.importSnapshot.snapshotId === d.snapshotId),
      );
  }
  if (d.editKind === "import")
    need(
      d.importSnapshot !== null &&
        (revision === null ||
          same(d.importSnapshot, { snapshotId: d.snapshotId, sourceRevision: revision })),
    );
  if (d.editKind === "manual") need(d.importSnapshot === null);
  if (d.editKind === "edit") need(d.previousSnapshot !== null);
  for (const a of d.accounts) {
    unique(a.balances.map((b) => b.currency));
    unique(a.positions.map((p) => p.assetId));
    for (const p of a.positions) {
      need(d.importSnapshot !== null || p.reportedValues === null);
      for (const field of ["unitCost", "bookCost", "bookCostCad"])
        need(
          p[field] === null ||
            p[field].currency === (field === "bookCostCad" ? "CAD" : p.instrument.currency),
        );
      for (const [field, provenance] of Object.entries(p.provenance)) {
        const { recordedAt: recorded, lastEditedAt: edited, sourceDate, origin } = provenance;
        need(recorded === null || time(recorded) <= time(result.fetchedAt));
        need(edited === null || (recorded !== null && time(edited) <= time(recorded)));
        need(sourceDate === null || sourceDate <= result.fetchedAt.slice(0, 10));
        if (origin === "manual") need(recorded !== null && edited === recorded);
        if (origin === "unknown") need(recorded === null && edited === null && sourceDate === null);
        if (["unitCost", "bookCost", "bookCostCad"].includes(field) && p[field] !== null)
          need(origin !== "unknown");
      }
    }
  }
  return result;
}
function holdingsContext(c) {
  context(c);
  need(
    c.objectType === "holdings_snapshot" &&
      c.ref.kind === "holdings" &&
      c.ref.sourceService === "portfolio",
  );
}
/** Validates only a new facts wrapper, after authenticated decryption. */
export function holdingsPrivate(value, c) {
  holdingsContext(c);
  exact(value, [
    "privateSchemaVersion",
    "profile",
    "objectId",
    "objectType",
    "revision",
    "payload",
  ]);
  need(value.privateSchemaVersion === 1 && value.profile === PROFILE);
  for (const key of ["objectId", "objectType", "revision"]) need(value[key] === c[key]);
  if (canonical(value).length > 196608) deny("payload_too_large");
  return holdingsFacts(value.payload, { snapshotId: c.objectId, revision: c.revision });
}
/** Caller MUST first verify Root signature, registry/identity and authorization. */
export async function openHoldings(value, privateKey, expectedContext) {
  holdingsContext(expectedContext);
  const checked = inspect(value);
  need(same(checked.context, expectedContext));
  const out = await jose.generalDecrypt(value.jwe, privateKey, {
    keyManagementAlgorithms: ["ECDH-ES+A256KW"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  need(
    same(out.protectedHeader, JWE_HEADER) &&
      same(Array.from(out.additionalAuthenticatedData), Array.from(canonical(expectedContext))),
  );
  const wrapper = parsed(out.plaintext, true);
  // Unknown profiles never fall back to a permissive reader.
  return wrapper?.payload?.data?.profile === HOLDINGS_FACTS_PROFILE
    ? holdingsPrivate(wrapper, expectedContext)
    : privatePayload(wrapper, expectedContext);
}
/** Owner-side opt-in writer; selecting it is a consumer decision, never automatic. */
export async function sealHoldingsFacts(payload, c, publicKeys, rootPrivateKey) {
  holdingsContext(c);
  const wrapper = {
    privateSchemaVersion: 1,
    profile: PROFILE,
    objectId: c.objectId,
    objectType: c.objectType,
    revision: c.revision,
    payload,
  };
  holdingsPrivate(wrapper, c);
  const encrypt = new jose.GeneralEncrypt(canonical(wrapper))
    .setProtectedHeader(JWE_HEADER)
    .setAdditionalAuthenticatedData(canonical(c));
  for (const recipient of c.recipients)
    encrypt
      .addRecipient(await jose.importJWK(publicKeys[recipient.keyId], "ECDH-ES+A256KW"))
      .setUnprotectedHeader({ kid: recipient.keyId });
  const jwe = await encrypt.encrypt();
  const proof = await sign(
    {
      contractVersion: CONTRACT,
      profile: PROFILE,
      artifactType: "persistent_content_publication",
      context: c,
      ciphertextDigest: await digest(jwe),
    },
    rootPrivateKey,
    c.rootKeyId,
    "fv-control+jws",
  );
  const value = { contractVersion: CONTRACT, profile: PROFILE, proof, jwe };
  inspect(value);
  return value;
}
