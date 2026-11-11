/** Dependency-free account-link window; contains no Agent crypto or storage. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("./", import.meta.url),
  files = {};
await mkdir(new URL("dist/", root), { recursive: true });
for (const name of ["account-bridge.mjs", "account-consent-page.mjs"]) {
  const source = await readFile(new URL("src/" + name, root));
  await writeFile(new URL("dist/" + name, root), source);
  for (const path of ["src/" + name, "dist/" + name])
    files[path] = createHash("sha256").update(source).digest("hex");
}
for (const path of ["static/consent.html", "static/account.css", "build.mjs"]) {
  files[path] = createHash("sha256")
    .update(await readFile(new URL(path, root)))
    .digest("hex");
}
await writeFile(
  new URL("integrity.json", root),
  JSON.stringify({ accountLinkVersion: "1.0.0", files }, null, 2) + "\n",
);
