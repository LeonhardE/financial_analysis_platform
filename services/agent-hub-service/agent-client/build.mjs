import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import prettier from "prettier";
const root = dirname(fileURLToPath(import.meta.url)),
  shared = resolve(root, "../../../packages/encrypted-workspace");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const lock = await readFile(shared + "/integrity.json"),
  meta = JSON.parse(lock);
if (meta.files["dist/core.mjs"] !== sha(await readFile(shared + "/dist/core.mjs")))
  throw Error("Shared integrity mismatch");
await mkdir(root + "/dist", { recursive: true });
await writeFile(root + "/shared-contract.integrity.json", lock);
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
  "dist/index.mjs",
  "dist/cli.mjs",
];
const hashes = {};
for (const file of files) hashes[file] = sha(await readFile(root + "/" + file));
await writeFile(
  root + "/integrity.json",
  await prettier.format(
    JSON.stringify({
      clientVersion: "1.0.1",
      nodeMinimum: "24.12.0",
      contractVersion: "folioview.agent-workspace.v2.0",
      profile: "folioview.agent-credential.v1",
      sharedLibrary: { integritySha256: sha(lock), bundleSha256: meta.files["dist/core.mjs"] },
      files: hashes,
    }),
    { parser: "json", printWidth: 100 },
  ),
);
