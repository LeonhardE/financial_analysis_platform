import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import standalone from "ajv/dist/standalone/index.js";
import { build } from "esbuild";
import prettier from "prettier";

const root = dirname(fileURLToPath(import.meta.url));
const format = (text, parser = "babel") => prettier.format(text, { parser, printWidth: 100 });
const source = await readFile(
  resolve(root, "../../../services/common/folioview_shared/valuation_schemas.json"),
);
await writeFile(resolve(root, "schemas.json"), source);
const schema = JSON.parse(source),
  mapping = {};
const ajv = new Ajv({
  strict: false,
  messages: false,
  allErrors: false,
  code: { source: true, optimize: 2 },
  inlineRefs: false,
});
ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);
ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
ajv.addSchema(schema);
for (const name of [
  "Currency",
  "Date",
  "Timestamp",
  "QuoteRequest",
  "FxRequest",
  "QuoteBatch",
  "FxBatch",
  "UiPreferencesSnapshotV1",
  "CurrencyPreferencesSnapshot",
  "CurrencyPreferencesUpdate",
  "FxPreferences",
  "FxPreferencesSnapshot",
  "FxPreferencesUpdate",
]) {
  const id = "valuation:" + name;
  ajv.addSchema({ $ref: schema.$id + "#/$defs/" + name }, id);
  mapping[name] = id;
}
await writeFile(
  resolve(root, "src/validators.cjs"),
  await format((standalone.default ?? standalone)(ajv, mapping)),
);
ajv.addSchema({ $ref: schema.$id + "#/$defs/HoldingsFactsContent" }, "holdings-only");
await writeFile(
  resolve(root, "src/holdings-validators.cjs"),
  await format((standalone.default ?? standalone)(ajv, { HoldingsFactsContent: "holdings-only" })),
);
await mkdir(resolve(root, "dist"), { recursive: true });
for (const entry of ["index", "holdings"]) {
  const out = await build({
    absWorkingDir: root,
    entryPoints: ["src/" + entry + ".mjs"],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["es2022"],
    write: false,
    minify: true,
    legalComments: "none",
    external: ["../../dist/core.mjs"],
  });
  await writeFile(resolve(root, "dist/" + entry + ".mjs"), await format(out.outputFiles[0].text));
}
const hash = (data) => createHash("sha256").update(data).digest("hex");
const files = {};
await writeFile(
  resolve(root, "reference-vectors.json"),
  await format(await readFile(resolve(root, "reference-vectors.json"), "utf8"), "json"),
);
for (const file of [
  "build.mjs",
  "README.md",
  "schemas.json",
  "src/index.mjs",
  "src/decimal.mjs",
  "src/holdings.mjs",
  "src/validation.mjs",
  "src/holdings-validators.cjs",
  "src/validators.cjs",
  "dist/index.mjs",
  "dist/index.d.mts",
  "dist/holdings.mjs",
  "dist/holdings.d.mts",
  "reference-vectors.json",
  "reference-vectors.py",
  "../tests/valuation.test.mjs",
])
  files[file] = hash(await readFile(resolve(root, file)));
await writeFile(
  resolve(root, "integrity.json"),
  await format(
    JSON.stringify({
      contractVersion: "folioview.valuation.v1",
      factsProfile: "folioview.holdings-facts.v2",
      frozenCoreSha256: hash(await readFile(resolve(root, "../dist/core.mjs"))),
      schemaSha256: hash(source),
      files,
    }),
    "json",
  ),
);
