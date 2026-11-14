import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import prettier from "prettier";
import Ajv from "ajv/dist/2020.js";
import standalone from "ajv/dist/standalone/index.js";
const root = dirname(fileURLToPath(import.meta.url)),
  shared = resolve(root, "../../../packages/encrypted-workspace");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const lock = await readFile(shared + "/integrity.json"),
  meta = JSON.parse(lock);
if (meta.files["dist/core.mjs"] !== sha(await readFile(shared + "/dist/core.mjs")))
  throw Error("Shared integrity mismatch");
const valuationLock = await readFile(shared + "/valuation/integrity.json"),
  valuationMeta = JSON.parse(valuationLock);
if (valuationMeta.frozenCoreSha256 !== meta.files["dist/core.mjs"])
  throw Error("Valuation core pin mismatch");
for (const file of ["dist/holdings.mjs", "schemas.json"])
  if (valuationMeta.files[file] !== sha(await readFile(shared + "/valuation/" + file)))
    throw Error("Valuation integrity mismatch");
if (
  valuationMeta.schemaSha256 !==
  sha(await readFile(resolve(root, "../../common/folioview_shared/valuation_schemas.json")))
)
  throw Error("Valuation schema mismatch");
// Consume the released foundation schema; do not mutate the frozen shared browser bundle.
const common = resolve(root, "../../common/folioview_shared/encrypted");
const center = JSON.parse(await readFile(common + "/task_center.json"));
const provider = JSON.parse(await readFile(common + "/provider_connections.json"));
const legacy = JSON.parse(await readFile(shared + "/schemas.json"));
center.$defs = { ...legacy.$defs, ...provider.$defs, ...center.$defs };
center.$defs.CenterAgentRequestPayload = structuredClone(
  legacy.$defs.PersistentAgentRequestPayload,
);
Object.assign(center.$defs.CenterAgentRequestPayload.properties, {
  profile: { const: "folioview.task-center.v1" },
  artifactType: { const: "task_center_agent_request" },
  path: {
    type: "string",
    pattern:
      "^/agent/v3/persistent/owners/[A-Za-z0-9_-]{1,128}/vaults/[A-Za-z0-9_-]{1,128}/connections/[A-Za-z0-9_-]{1,128}/task-center/(context|prepare|plans/report|manual/query)$",
  },
});
const ajv = new Ajv({
  strict: false,
  messages: false,
  code: { source: true, optimize: 2 },
  inlineRefs: false,
});
ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);
ajv.addFormat("iana-timezone", /^[A-Za-z0-9_+./-]{1,80}$/);
ajv.addFormat("uri", /^https:\/\/[^\s\\]+$/);
ajv.addSchema(center);
const mapping = {};
for (const name of [
  "CenterSchedule",
  "CenterTaskDefinition",
  "CenterAssignment",
  "CenterOwnerControl",
  "CenterAgentRequestPayload",
]) {
  const id = "task-center:" + name;
  ajv.addSchema({ $ref: center.$id + "#/$defs/" + name }, id);
  mapping[name] = id;
}
// Ajv standalone validators can still reference tiny Ajv runtime helpers.
// Bundle those now so source consumers/tests also need no runtime npm install.
const validators = await build({
  absWorkingDir: root,
  stdin: { contents: (standalone.default ?? standalone)(ajv, mapping), resolveDir: root },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24.12",
  write: false,
  legalComments: "none",
});
await writeFile(
  root + "/src/task-center-validators.cjs",
  await prettier.format(validators.outputFiles[0].text, { parser: "babel", printWidth: 100 }),
);
await mkdir(root + "/dist", { recursive: true });
await writeFile(root + "/shared-contract.integrity.json", lock);
await writeFile(root + "/valuation-contract.integrity.json", valuationLock);
for (const entry of ["index", "cli"]) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/" + entry + ".mjs"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24.12",
    minify: true,
    write: false,
    legalComments: "none",
  });
  await writeFile(
    root + "/dist/" + entry + ".mjs",
    await prettier.format(result.outputFiles[0].text, { parser: "babel", printWidth: 100 }),
  );
}
const files = [
  "package.json",
  "package-lock.json",
  "build.mjs",
  "shared-contract.integrity.json",
  "valuation-contract.integrity.json",
  "THIRD_PARTY_NOTICES.md",
  "src/cli.mjs",
  "src/index.mjs",
  "src/client.mjs",
  "src/files.mjs",
  "src/pairing.mjs",
  "src/crypto.mjs",
  "src/registry.mjs",
  "src/consents.mjs",
  "src/authority.mjs",
  "src/schedule.mjs",
  "src/policy.mjs",
  "src/task-center.mjs",
  "src/task-center-validators.cjs",
  "dist/index.mjs",
  "dist/cli.mjs",
];
const hashes = {};
for (const file of files) hashes[file] = sha(await readFile(root + "/" + file));
await writeFile(
  root + "/integrity.json",
  await prettier.format(
    JSON.stringify({
      clientVersion: "1.3.0",
      nodeMinimum: "24.12.0",
      contractVersion: "folioview.agent-workspace.v2.0",
      profile: "folioview.agent-credential.v1",
      sharedLibrary: { integritySha256: sha(lock), bundleSha256: meta.files["dist/core.mjs"] },
      valuationLibrary: {
        integritySha256: sha(valuationLock),
        holdingsSha256: valuationMeta.files["dist/holdings.mjs"],
        schemaSha256: valuationMeta.schemaSha256,
      },
      files: hashes,
    }),
    { parser: "json", printWidth: 100 },
  ),
);
