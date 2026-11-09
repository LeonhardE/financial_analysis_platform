/** No installed packages: public synthetic test keys and Node's built-in ES256 signer. */
import { createECDH, createHash, createPrivateKey, sign } from "node:crypto";
import { canonical, keyId } from "../../encrypted-workspace/dist/core.mjs";
export const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
export const signingFingerprint = (s) =>
  createHash("sha256")
    .update(s.protected + "." + s.payload)
    .digest("hex");
export function publicTestKey(scalar) {
  const d = Buffer.alloc(32);
  d.writeUInt32BE(scalar, 28);
  const curve = createECDH("prime256v1");
  curve.setPrivateKey(d);
  const p = curve.getPublicKey(null, "uncompressed");
  return {
    kty: "EC",
    crv: "P-256",
    x: p.subarray(1, 33).toString("base64url"),
    y: p.subarray(33).toString("base64url"),
    d: d.toString("base64url"),
  };
}
export function publicPart(value) {
  const { d, ...p } = value;
  return p;
}
export const testKeyId = async (scalar) => keyId(publicPart(publicTestKey(scalar)));
export async function nodeSign(payload, scalar) {
  const key = publicTestKey(scalar);
  const protectedHeader = Buffer.from(
    canonical({
      alg: "ES256",
      kid: await testKeyId(scalar),
      typ: "fv-control+jws",
      cty: "application/json",
    }),
  ).toString("base64url");
  const encoded = Buffer.from(canonical(payload)).toString("base64url");
  return {
    protected: protectedHeader,
    payload: encoded,
    signature: sign("sha256", Buffer.from(protectedHeader + "." + encoded), {
      key: createPrivateKey({ key, format: "jwk" }),
      dsaEncoding: "ieee-p1363",
    }).toString("base64url"),
  };
}
