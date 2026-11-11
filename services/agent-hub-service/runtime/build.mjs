import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import prettier from "prettier";
import { createHash } from "node:crypto";
const root = dirname(fileURLToPath(import.meta.url));
const sharedRoot = resolve(root, "../../../packages/encrypted-workspace");
const sharedIntegrity = await readFile(resolve(sharedRoot, "integrity.json"));
const shared = JSON.parse(sharedIntegrity);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sharedBundleHash = sha256(await readFile(resolve(sharedRoot, "dist/core.mjs")));
if (shared.browserContractVersion !== "1.0.0" || shared.files["dist/core.mjs"] !== sharedBundleHash)
  throw new Error("Shared browser contract integrity mismatch");
const format = (text, parser = "babel") => prettier.format(text, { parser, printWidth: 100 });
await mkdir(resolve(root, "dist"), { recursive: true });
// Lock the reviewed source dependency for this independently distributed runtime.
await writeFile(resolve(root, "shared-contract.integrity.json"), sharedIntegrity);
for (const entry of [
  "core",
  "session",
  "worker",
  "controller",
  "controller-page",
  "account-bridge",
  "account-consent-page",
]) {
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
    external: entry === "controller-page" ? ["./controller.mjs"] : [],
  });
  await writeFile(resolve(root, "dist/" + entry + ".mjs"), await format(out.outputFiles[0].text));
}

const files = [
  "package.json",
  "package-lock.json",
  "build.mjs",
  "shared-contract.integrity.json",
  "THIRD_PARTY_NOTICES.md",
  "src/core.mjs",
  "src/crypto.mjs",
  "src/registry.mjs",
  "src/consents.mjs",
  "src/authority.mjs",
  "src/storage.mjs",
  "src/recovery.mjs",
  "dist/core.mjs",
  "src/session.mjs",
  "src/schedule.mjs",
  "src/policy.mjs",
  "src/worker.mjs",
  "src/controller.mjs",
  "src/controller-page.mjs",
  "src/account-bridge.mjs",
  "src/account-consent-page.mjs",
  "dist/session.mjs",
  "dist/worker.mjs",
  "dist/controller.mjs",
  "dist/controller-page.mjs",
  "dist/account-bridge.mjs",
  "dist/account-consent-page.mjs",
  "static/controller.html",
  "static/account-consent.html",
  "static/runtime.css",
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
      runtimeVersion: "1.0.0",
      contractVersion: "folioview.agent-workspace.v2.0",
      profile: "folioview.persistent-content.v1",
      sharedLibrary: {
        name: "@folioview/encrypted-workspace",
        version: shared.browserContractVersion,
        integritySha256: sha256(sharedIntegrity),
        bundleSha256: sharedBundleHash,
      },
      files: hashes,
    }),
    "json",
  ),
);
