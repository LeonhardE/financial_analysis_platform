import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const { bytes, parsed, sign } = await import(root + "packages/encrypted-workspace/dist/core.mjs");
const file = root + "services/common/tests/fixtures/agent_credentials.json";
const v = JSON.parse(await readFile(file, "utf8"));
const p = parsed(bytes(v.pythonApproval.payload), true);
const cert = v.registryBundle.entries
  .map((e) => parsed(bytes(e.certificate.payload), true))
  .find((e) => e.keyId === p.deviceSigningKeyId);
const key = await crypto.subtle.importKey(
  "jwk",
  {
    ...cert.publicJwk,
    d: Buffer.from(BigInt(v.deviceTestScalar).toString(16).padStart(64, "0"), "hex").toString(
      "base64url",
    ),
  },
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign"],
);
v.nodeApproval = await sign(p, key, p.deviceSigningKeyId, "fv-control+jws");
await writeFile(file, JSON.stringify(v, null, 2) + "\n");
