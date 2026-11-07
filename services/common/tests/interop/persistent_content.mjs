// Synthetic interoperability test only; never imported by application code.
// Private test JWKs arrive on stdin and are never emitted or written.
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
const modules = process.env.FOLIOVIEW_INTEROP_MODULES;
if (!modules) throw new Error("fixture_dependencies_required");
const jose = await import(pathToFileURL(path.join(modules, "jose/dist/webapi/index.js")));
const canonicalize = (
  await import(pathToFileURL(path.join(modules, "canonicalize/lib/canonicalize.js")))
).default;
const bytes = (value) => new TextEncoder().encode(canonicalize(value));
const hash = (value) => createHash("sha256").update(bytes(value)).digest("hex");
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
    if (Buffer.byteLength(input) > 1048576) throw new Error("fixture_limit");
  }
  const value = JSON.parse(input);
  if (process.argv[2] === "--verify-python") {
    const pub = await jose.importJWK(value.signerPublicJwk, "ES256");
    const signed = await jose.flattenedVerify(value.carrier.proof, pub, {
      algorithms: ["ES256"],
      typ: "fv-control+jws",
    });
    const proof = JSON.parse(new TextDecoder().decode(signed.payload));
    const priv = await jose.importJWK(value.recipientPrivateJwk, "ECDH-ES+A256KW");
    const opened = await jose.generalDecrypt(value.carrier.jwe, priv, {
      keyManagementAlgorithms: ["ECDH-ES+A256KW"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    const result = {
      signature: true,
      digestMatches: proof.ciphertextDigest === hash(value.carrier.jwe),
      aadMatches: Buffer.from(opened.additionalAuthenticatedData).equals(
        Buffer.from(bytes(value.context)),
      ),
      plaintextMatches: Buffer.from(opened.plaintext).equals(
        Buffer.from(bytes(value.privatePayload)),
      ),
      profileMatches: opened.protectedHeader.typ === "fv-persistent-private+jwe",
    };
    process.stdout.write(JSON.stringify(result));
    process.exit(Object.values(result).every((v) => v === true) ? 0 : 1);
  }
  const encryption = new jose.GeneralEncrypt(bytes(value.privatePayload))
    .setProtectedHeader({
      alg: "ECDH-ES+A256KW",
      enc: "A256GCM",
      typ: "fv-persistent-private+jwe",
      cty: "application/json",
    })
    .setAdditionalAuthenticatedData(bytes(value.context));
  for (const item of value.context.recipients) {
    const key = await jose.importJWK(value.recipientPublicKeys[item.keyId], "ECDH-ES+A256KW");
    encryption.addRecipient(key).setUnprotectedHeader({ kid: item.keyId });
  }
  const encrypted = await encryption.encrypt();
  const proof = {
    contractVersion: value.context.contractVersion,
    profile: value.context.profile,
    artifactType: "persistent_content_publication",
    context: value.context,
    ciphertextDigest: hash(encrypted),
  };
  const signer = await jose.importJWK(value.signerPrivateJwk, "ES256");
  const kid = await jose.calculateJwkThumbprint(value.signerPrivateJwk);
  const signed = await new jose.FlattenedSign(bytes(proof))
    .setProtectedHeader({ alg: "ES256", kid, typ: "fv-control+jws", cty: "application/json" })
    .sign(signer);
  process.stdout.write(
    JSON.stringify({
      contractVersion: value.context.contractVersion,
      profile: value.context.profile,
      proof: signed,
      jwe: encrypted,
    }),
  );
} catch {
  process.stdout.write(JSON.stringify({ ok: false }));
  process.exit(1);
}
