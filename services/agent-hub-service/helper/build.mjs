/** Reproducible offline build after npm ci; no network or key material is used. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import standalone from "ajv/dist/standalone/index.js";
import { build } from "esbuild";
import prettier from "prettier";

const root = dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const read = (path) => readFile(resolve(root, path));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const config = {
  printWidth: 100,
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "all",
};
const format = (source, parser = "babel") => prettier.format(source, { ...config, parser });
const schemas = JSON.parse(await read("schemas.json"));
const ajv = new Ajv({
  strict: false,
  messages: false,
  allErrors: false,
  code: { source: true, optimize: 2 },
  inlineRefs: false,
  validateFormats: true,
});
// Runtime semantic format checks use browser Intl/URL/Date, not dynamic code.
ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);
ajv.addFormat("iana-timezone", /^[A-Za-z0-9_+./-]{1,80}$/);
ajv.addFormat("uri", /^https:\/\/[^\s\\]+$/);
ajv.addSchema(schemas, "https://folioview.invalid/formal");
const names = [
  "Identifier",
  "KeyId",
  "PublicJWK",
  "SignedObject",
  "RegistryBundle",
  "RegistryCheckpointPayload",
  "KeyCertificatePayload",
  "AgentKeyGrantPayload",
  "Carrier",
  "ObjectMessage",
  "Context",
  "TaskMetadata",
  "PrivatePayload",
  "BeginRunIntentPayload",
  "RunDescriptor",
  "ManifestDescriptor",
  "ManifestComponentPage",
  "ResultContent",
  "ResultReceipt",
];
const mapping = {};
for (const name of names) {
  const id = "helper:" + name;
  ajv.addSchema({ $ref: "https://folioview.invalid/formal#/$defs/" + name }, id);
  mapping[name] = id;
}
await writeFile(
  "src/validators.cjs",
  await format(standalone.default ? standalone.default(ajv, mapping) : standalone(ajv, mapping)),
);
await mkdir("dist", { recursive: true });
for (const [entry, outfile, mode] of [["src/worker.mjs", "dist/worker.mjs", "esm"]]) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    format: mode,
    platform: "browser",
    target: ["es2022"],
    write: false,
    minify: true,
    legalComments: "none",
  });
  await writeFile(outfile, await format(result.outputFiles[0].text));
}
const packages = [
  "jose",
  "canonicalize",
  "ajv",
  "esbuild",
  "prettier",
  "fast-deep-equal",
  "fast-uri",
  "json-schema-traverse",
  "require-from-string",
];
let licenses = "# Third-party build/runtime dependency notices\n\n";
for (const name of packages) {
  const pkg = JSON.parse(await read(`node_modules/${name}/package.json`));
  let text = "";
  for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT.txt"]) {
    try {
      text = (await read(`node_modules/${name}/${file}`)).toString();
      break;
    } catch {}
  }
  if (!text) throw new Error("Missing license: " + name);
  licenses += `## ${name} ${pkg.version}\n\n\`\`\`text\n${text.trim()}\n\`\`\`\n\n`;
}
await writeFile("THIRD_PARTY_NOTICES.md", await format(licenses, "markdown"));
const files = [
  "package.json",
  "package-lock.json",
  "protocol.json",
  "schemas.json",
  "build.mjs",
  "src/session.mjs",
  "src/worker.mjs",
  "dist/worker.mjs",
  "THIRD_PARTY_NOTICES.md",
];
const hashes = {};
for (const path of files) hashes[path] = sha(await read(path));
await writeFile(
  "integrity.json",
  await format(
    JSON.stringify({
      helperVersion: "1.2.0",
      contractVersion: "folioview.agent-workspace.v2.0",
      profile: "folioview.agent-preparation.v1",
      assets: { worker: "dist/worker.mjs" },
      files: hashes,
    }),
    "json",
  ),
);
console.log("Built fixed helper assets; integrity hashes updated.");
