import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import standalone from "ajv/dist/standalone/index.js";
import { build } from "esbuild";
import prettier from "prettier";
const root = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(await readFile(resolve(root, "schemas.json"), "utf8"));
const ajv = new Ajv({
  strict: false,
  messages: false,
  allErrors: false,
  code: { source: true, optimize: 2 },
  inlineRefs: false,
});
ajv.addSchema(schema);
const mapping = {};
for (const name of Object.keys(schema.$defs).filter((n) => n.startsWith("Executor"))) {
  const id = "executor:" + name;
  ajv.addSchema({ $ref: schema.$id + "#/$defs/" + name }, id);
  mapping[name] = id;
}
const format = (text, parser = "babel") => prettier.format(text, { parser, printWidth: 100 });
await writeFile(
  resolve(root, "src/validators.cjs"),
  await format((standalone.default ?? standalone)(ajv, mapping)),
);
await mkdir(resolve(root, "dist"), { recursive: true });
const output = await build({
  absWorkingDir: root,
  entryPoints: ["src/core.mjs"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  minify: true,
  write: false,
  legalComments: "none",
});
await writeFile(resolve(root, "dist/core.mjs"), await format(output.outputFiles[0].text));
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(resolve(root, path)))
    .digest("hex");
const files = {};
for (const name of [
  "package.json",
  "package-lock.json",
  "schemas.json",
  "build.mjs",
  "THIRD_PARTY_NOTICES.md",
  "src/core.mjs",
  "src/executor-trust.mjs",
  "dist/core.mjs",
  "dist/core.d.mts",
  "README.md",
  "tests/executor-trust-fixture.mjs",
  "tests/generate-executor-trust-fixture.mjs",
])
  files[name] = await hash(name);
await writeFile(
  resolve(root, "integrity.json"),
  await format(
    JSON.stringify({
      browserContractVersion: "1.0.0",
      contractVersion: "folioview.agent-workspace.v2.0",
      profile: "folioview.executor-trust.v1",
      baseContract: {
        name: "@folioview/encrypted-workspace",
        bundleSha256: await hash("../encrypted-workspace/dist/core.mjs"),
        integritySha256: await hash("../encrypted-workspace/integrity.json"),
      },
      files,
    }),
    "json",
  ),
);
