import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import standalone from "ajv/dist/standalone/index.js";
import { build } from "esbuild";
import prettier from "prettier";
const root = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(await readFile(resolve(root, "schemas.json"), "utf8"));
const defs = schema.$defs;
const ajv = new Ajv({
  strict: false,
  messages: false,
  allErrors: false,
  code: { source: true, optimize: 2 },
  inlineRefs: false,
});
ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);
ajv.addFormat("iana-timezone", /^[A-Za-z0-9_+./-]{1,80}$/);
ajv.addFormat("uri", /^https:\/\/[^\s\\]+$/);
ajv.addSchema(schema);
const mapping = {};
for (const name of [
  "PublicJWK",
  "Identifier",
  "KeyId",
  "Digest",
  "TaskMetadata",
  "OperationIdentifier",
  "RegistryBundle",
  "RegistryCheckpointPayload",
  "KeyCertificatePayload",
  "AgentCredentialApproval",
  "AgentCredentialLease",
  "PersistentAgentIdentity",
  "PersistentAgentBindingPayload",
  "PersistentContentContext",
  "ResourceRef",
  "PersistentPrivatePayload",
  "PersistentContentCarrier",
  "PersistentContentProofPayload",
  "ResultContent",
  "PersistentResourceConsent",
  "PersistentResourceApprovalPayload",
  "PersistentResourceRevocationPayload",
  "ConsentSourceState",
  "PersistentAgentRequestPayload",
  "PersistentRunManifest",
]) {
  const id = "runtime:" + name;
  ajv.addSchema({ $ref: schema.$id + "#/$defs/" + name }, id);
  mapping[name] = id;
}
const format = (text, parser = "babel") => prettier.format(text, { parser, printWidth: 100 });
await writeFile(
  resolve(root, "src/validators.cjs"),
  await format((standalone.default ?? standalone)(ajv, mapping)),
);
await mkdir(resolve(root, "dist"), { recursive: true });
for (const entry of ["core"]) {
  const out = await build({
    absWorkingDir: root,
    entryPoints: ["src/" + entry + ".mjs"],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["es2022"],
    minify: true,
    write: false,
    legalComments: "none",
  });
  await writeFile(resolve(root, "dist/" + entry + ".mjs"), await format(out.outputFiles[0].text));
}

const { createHash } = await import("node:crypto");
const files = [
  "package.json",
  "package-lock.json",
  "schemas.json",
  "build.mjs",
  "THIRD_PARTY_NOTICES.md",
  "src/core.mjs",
  "src/crypto.mjs",
  "src/registry.mjs",
  "src/consents.mjs",
  "src/authority.mjs",
  "src/leases.mjs",
  "tests/leases.test.mjs",
  "tests/registry-memo.test.mjs",
  "dist/core.mjs",
  "dist/core.d.mts",
  "README.md",
  "tests/contracts.test.mjs",
];
const hashes = {};
for (const file of files)
  hashes[file] = createHash("sha256")
    .update(await readFile(resolve(root, file)))
    .digest("hex");
await writeFile(
  resolve(root, "integrity.json"),
  await format(
    JSON.stringify({
      browserContractVersion: "1.0.0",
      contractVersion: "folioview.agent-workspace.v2.0",
      profile: "folioview.persistent-content.v1",
      files: hashes,
    }),
    "json",
  ),
);
