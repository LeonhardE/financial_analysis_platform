// Fixture authoring only. Never imported by application code.
// All recipient keys correspond to publicly known test scalars, not deployment keys.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = process.env.FOLIOVIEW_INTEROP_MODULES
  ? path.resolve(process.env.FOLIOVIEW_INTEROP_MODULES)
  : path.join(here, "node_modules");
const jose = await import(pathToFileURL(path.join(modules, "jose/dist/webapi/index.js")));
const canonicalize = (
  await import(pathToFileURL(path.join(modules, "canonicalize/lib/canonicalize.js")))
).default;
const utf8 = new TextEncoder();
const canonical = (value) => utf8.encode(canonicalize(value));
const b64u = (value) => Buffer.from(value).toString("base64url");
const hexCoordinate = (value) => Buffer.from(value, "hex").toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const CONTRACT = "folioview.agent-workspace.v2.0";

// Optional reverse-direction test: trusted synthetic material arrives only on
// stdin and is never printed or written. No application-facing RPC is exposed.
if (process.argv[2] === "--verify-python") {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk.toString("utf8");
      if (Buffer.byteLength(input) > 1048576) throw new Error("test_input_limit");
    }
    const value = JSON.parse(input);
    const signerKey = await jose.importJWK(value.signerPublicJwk, "ES256");
    const verified = await jose.flattenedVerify(value.carrier.signedObject, signerKey, {
      algorithms: ["ES256"],
    });
    const object = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(verified.payload));
    const privateKey = await jose.importJWK(value.recipientPrivateJwk, "ECDH-ES+A256KW");
    const opened = await jose.generalDecrypt(object.jwe, privateKey, {
      keyManagementAlgorithms: ["ECDH-ES+A256KW"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    const plaintext = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext),
    );
    const result = {
      ok: true,
      jwsVerified: true,
      jweDecrypted: true,
      aadMatches: Buffer.from(opened.additionalAuthenticatedData).equals(canonical(value.context)),
      payloadMatches: Buffer.from(canonical(plaintext)).equals(canonical(value.privatePayload)),
      canonicalSigningPayloadMatches: Buffer.from(verified.payload).equals(canonical(object)),
      typMatches: verified.protectedHeader.typ === "fv-object+jws",
    };
    console.log(JSON.stringify(result));
    process.exit(Object.values(result).every((entry) => entry === true) ? 0 : 1);
  } catch {
    console.log(JSON.stringify({ ok: false }));
    process.exit(1);
  }
}

// P-256 points G and 2G. The optional Python tests reconstruct scalars 1 and 2
// in memory through cryptography. No private JWK is written into a vector.
const testRecipients = [
  {
    testScalar: 1,
    role: "device_enc",
    principalId: "test_device",
    publicJwk: {
      kty: "EC",
      crv: "P-256",
      x: hexCoordinate("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
      y: hexCoordinate("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"),
    },
  },
  {
    testScalar: 2,
    role: "recovery_enc",
    principalId: "test_recovery",
    publicJwk: {
      kty: "EC",
      crv: "P-256",
      x: hexCoordinate("7cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc47669978"),
      y: hexCoordinate("07775510db8ed040293d9ac69f7430dbba7dade63ce982299e04b79d227873d1"),
    },
  },
];
for (const recipient of testRecipients) {
  recipient.keyId = await jose.calculateJwkThumbprint(recipient.publicJwk);
}
testRecipients.sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));

const signer = await jose.generateKeyPair("ES256", { extractable: true });
const root = await jose.generateKeyPair("ES256", { extractable: true });
const signerPublicJwk = await jose.exportJWK(signer.publicKey);
const rootPublicJwk = await jose.exportJWK(root.publicKey);
const authorKeyId = await jose.calculateJwkThumbprint(signerPublicJwk);
const rootKeyId = await jose.calculateJwkThumbprint(rootPublicJwk);
const binding = {
  taskId: "test_task",
  taskVersion: 1,
  runId: "test_run",
  manifestId: "test_manifest",
  taskEnvelopeFingerprint: "1".repeat(64),
  manifestFingerprint: "2".repeat(64),
  connectionId: "test_connection",
  grantId: "test_grant",
  grantEpoch: 1,
  executionEpoch: 1,
  resourceRef: null,
  sourceRevision: null,
  sourceEpoch: null,
};
const context = {
  contractVersion: CONTRACT,
  profileId: "P1",
  ownerSubject: "test_owner",
  vaultId: "test_vault",
  rootKeyId,
  rootEpoch: 1,
  registrySequence: 1,
  checkpointDigest: "3".repeat(64),
  keyEpoch: 1,
  objectId: "test_result",
  objectType: "result_revision",
  revision: 1,
  deliveryRevision: 1,
  priorEnvelopeFingerprint: null,
  expectedRevision: 0,
  stableOperationId: "test_operation_00000000000000000000000000000001",
  operationType: "submit_result",
  authorSigningKeyId: authorKeyId,
  binding,
  resourceBindings: [],
  recipients: testRecipients.map((entry) => ({
    keyId: entry.keyId,
    role: entry.role,
    principalId: entry.principalId,
    connectionId: null,
    keyEpoch: 1,
  })),
};
const privatePayload = {
  privateSchemaVersion: 2,
  objectId: context.objectId,
  objectType: context.objectType,
  revision: context.revision,
  binding,
  payload: {
    title: "Synthetic cross-runtime report",
    summary: "Unicode evidence: 测试 🧪; preserve é without normalization.",
    sections: [
      { sectionId: "findings", markdown: "A synthetic result, generated for protocol tests." },
      { sectionId: "limits", markdown: "No real holdings, account, video or investment advice." },
    ],
    citations: [],
    limitations: ["Public test fixture only."],
  },
};
const encryptor = new jose.GeneralEncrypt(canonical(privatePayload))
  .setProtectedHeader({
    alg: "ECDH-ES+A256KW",
    enc: "A256GCM",
    typ: "fv-private+jwe",
    cty: "application/json",
  })
  .setAdditionalAuthenticatedData(canonical(context));
for (const recipient of testRecipients) {
  const key = await jose.importJWK(recipient.publicJwk, "ECDH-ES+A256KW");
  encryptor.addRecipient(key).setUnprotectedHeader({ kid: recipient.keyId });
}
const encrypted = await encryptor.encrypt();
const signedObject = await new jose.FlattenedSign(canonical({ context, jwe: encrypted }))
  .setProtectedHeader({
    alg: "ES256",
    kid: authorKeyId,
    typ: "fv-object+jws",
    cty: "application/json",
  })
  .sign(signer.privateKey);
const signObject = async (object) =>
  new jose.FlattenedSign(canonical(object))
    .setProtectedHeader({
      alg: "ES256",
      kid: authorKeyId,
      typ: "fv-object+jws",
      cty: "application/json",
    })
    .sign(signer.privateKey);
const flipped = (value) => {
  const bytes = Buffer.from(value, "base64url");
  bytes[0] ^= 1;
  return bytes.toString("base64url");
};
const invalidTag = structuredClone(encrypted);
invalidTag.tag = flipped(invalidTag.tag);
const wrongAad = structuredClone(encrypted);
wrongAad.aad = b64u(canonical({ wrong: true }));
const invalidSignature = { ...signedObject, signature: flipped(signedObject.signature) };
const signature = Buffer.from(signedObject.signature, "base64url");
const order = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const alternateS = order - BigInt("0x" + signature.subarray(32).toString("hex"));
const alternateSignature = {
  ...signedObject,
  signature: Buffer.concat([
    signature.subarray(0, 32),
    Buffer.from(alternateS.toString(16).padStart(64, "0"), "hex"),
  ]).toString("base64url"),
};
await jose.flattenedVerify(alternateSignature, signer.publicKey, { algorithms: ["ES256"] });
const vector = {
  generatedBy: {
    runtime: "Node.js WebCrypto",
    jose: "6.2.13",
    canonicalize: "5.1.0",
    privateKeysStored: false,
    recipients: "PUBLIC TEST ONLY: known P-256 scalars 1 and 2; never use for real data.",
  },
  contractVersion: CONTRACT,
  signerPublicJwk,
  rootPublicJwk,
  recipientKeys: testRecipients,
  context,
  privatePayload,
  carrier: { contractVersion: CONTRACT, signedObject },
  variants: {
    validSignatureInvalidTag: {
      contractVersion: CONTRACT,
      signedObject: await signObject({ context, jwe: invalidTag }),
    },
    validSignatureWrongAad: {
      contractVersion: CONTRACT,
      signedObject: await signObject({ context, jwe: wrongAad }),
    },
    invalidSignature: { contractVersion: CONTRACT, signedObject: invalidSignature },
    alternateValidSignature: { contractVersion: CONTRACT, signedObject: alternateSignature },
  },
  expected: {
    contextCanonicalBase64url: b64u(canonical(context)),
    privateCanonicalBase64url: b64u(canonical(privatePayload)),
    signingInputSha256: hash(`${signedObject.protected}.${signedObject.payload}`),
    signatureBytes: Buffer.from(signedObject.signature, "base64url").length,
    ivBytes: Buffer.from(encrypted.iv, "base64url").length,
    tagBytes: Buffer.from(encrypted.tag, "base64url").length,
    wrappedKeyBytes: encrypted.recipients.map(
      (entry) => Buffer.from(entry.encrypted_key, "base64url").length,
    ),
  },
};
const output = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, "../fixtures/encrypted_v2_node.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(vector, null, 2) + "\n");
console.log(JSON.stringify({ fixtureWritten: output, recipients: 2, privateKeysStored: false }));
