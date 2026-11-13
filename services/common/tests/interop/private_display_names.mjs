/** Independent native WebCrypto interoperability, synthetic pipe input only. */
import { webcrypto } from "node:crypto";
const { subtle } = webcrypto;
const text = new TextEncoder();
const b64 = (value) => Buffer.from(value).toString("base64url");
const raw = (value) => Buffer.from(value, "base64url");
const concat = (...values) => Buffer.concat(values.map((v) => Buffer.from(v)));
const u32 = (value) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value);
  return b;
};
const canonical = (value) => JSON.stringify(ordered(value));
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, ordered(value[k])]),
    );
  return value;
}
const importEc = (jwk, usages) =>
  subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, usages);
async function kek(privateKey, publicJwk) {
  const z = await subtle.deriveBits(
    { name: "ECDH", public: await importEc(publicJwk, []) },
    privateKey,
    256,
  );
  const alg = text.encode("ECDH-ES+A256KW");
  const key = await subtle.digest(
    "SHA-256",
    concat(u32(1), z, u32(alg.length), alg, u32(0), u32(0), u32(256)),
  );
  return subtle.importKey("raw", key, "AES-KW", false, ["wrapKey", "unwrapKey"]);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const f = JSON.parse(input),
  recipient = f.envelope.recipients[0];
const header = JSON.parse(raw(f.envelope.protected));
const ownerKey = await importEc(f.privateJwk, ["deriveBits"]);
const wrapping = await kek(ownerKey, header.epk ?? recipient.header.epk);
const contentKey = await subtle.unwrapKey(
  "raw",
  raw(recipient.encrypted_key),
  wrapping,
  "AES-KW",
  "AES-GCM",
  false,
  ["decrypt"],
);
const plaintext = await subtle.decrypt(
  {
    name: "AES-GCM",
    iv: raw(f.envelope.iv),
    tagLength: 128,
    additionalData: text.encode(f.envelope.protected + "." + f.envelope.aad),
  },
  contentKey,
  concat(raw(f.envelope.ciphertext), raw(f.envelope.tag)),
);
const plain = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const publicKey = await subtle.exportKey("jwk", pair.publicKey);
const epk = Object.fromEntries(["kty", "crv", "x", "y"].map((k) => [k, publicKey[k]]));
const newWrapping = await kek(pair.privateKey, f.publicJwk);
const newContent = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
const wrapped = await subtle.wrapKey("raw", newContent, newWrapping, "AES-KW");
const protectedHeader = b64(
  text.encode(
    canonical({
      alg: "ECDH-ES+A256KW",
      enc: "A256GCM",
      typ: "fv-owner-display-name+jwe",
      cty: "application/json",
      epk,
    }),
  ),
);
const aad = b64(text.encode(canonical(f.context))),
  iv = webcrypto.getRandomValues(new Uint8Array(12));
const sealed = Buffer.from(
  await subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
      additionalData: text.encode(protectedHeader + "." + aad),
    },
    newContent,
    text.encode(canonical(plain)),
  ),
);
process.stdout.write(
  JSON.stringify({
    name: plain.displayName,
    envelope: {
      protected: protectedHeader,
      aad,
      iv: b64(iv),
      ciphertext: b64(sealed.subarray(0, -16)),
      tag: b64(sealed.subarray(-16)),
      recipients: [{ header: { kid: f.context.recipientKeyId }, encrypted_key: b64(wrapped) }],
    },
  }),
);
