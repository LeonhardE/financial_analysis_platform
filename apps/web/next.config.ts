import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { NextConfig } from "next";

// Keep compatible documents on one memory broker; changed crypto/runtime code
// gets a separate worker name rather than colliding with an older script URL.
const runtimeHash = createHash("sha256");
for (const name of readdirSync(path.join(__dirname, "lib")).sort()) {
  if (/^encrypted-.*\.(?:ts|json)$/.test(name))
    runtimeHash.update(name).update(readFileSync(path.join(__dirname, "lib", name)));
}
runtimeHash.update(readFileSync(path.join(__dirname, "../../package-lock.json")));
runtimeHash.update(
  readFileSync(path.join(__dirname, "../../packages/encrypted-workspace/integrity.json")),
);
runtimeHash.update(
  readFileSync(path.join(__dirname, "../../packages/executor-trust/integrity.json")),
);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_OWNER_UNLOCK_VERSION: runtimeHash.digest("hex") },
  agentRules: false,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async headers() {
    return [{ source: "/agents", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};

export default nextConfig;
