const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
function compile(file, imports = {}, globals = {}) {
  const { code } = transformSync(readFileSync(path.join(__dirname, file), "utf8"), {
    filename: file,
    jsc: {
      parser: { syntax: "typescript", tsx: file.endsWith("tsx") },
      target: "es2022",
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), name);
      return imports[name];
    },
    TextEncoder,
    TextDecoder,
    AbortController,
    Response,
    Uint8Array,
    ...globals,
  });
  return module.exports;
}
const watchlist = compile("../lib/watchlist.ts");
const contracts = compile("../lib/resource-library.ts", { "./watchlist": watchlist });
const at = "2026-10-30T10:00:00Z";
const ref = (kind, id = kind) => ({
  kind,
  sourceService: kind === "holdings" ? "portfolio" : "user",
  resourceId: id,
  incarnation: "incarnation_A",
});
const item = (kind, patch = {}) => ({
  ref: ref(kind),
  revision: 1,
  sourceEpoch: 1,
  state: kind === "holdings" ? "active" : "ready",
  snapshotId: kind === "holdings" ? "snapshot_A" : null,
  updatedAt: kind === "holdings" ? null : at,
  encryptedEvidence: kind === "holdings" ? "not_checked" : "not_prepared",
  ...patch,
});
const catalogue = () => ({
  contractVersion: contracts.RESOURCE_CONTRACT,
  profile: "folioview.owner-resource-discovery.v1",
  readAt: at,
  groups: ["holdings", "watchlist", "channel_follows"].map((kind) => ({
    kind,
    sourceService: kind === "holdings" ? "portfolio" : "user",
    status: "available",
    items: [item(kind)],
  })),
});
const channels = (name = "Synthetic Creator", revision = 1) => ({
  revision,
  items: [
    {
      name,
      handleOrUrl: "https://www.youtube.com/@synthetic",
      note: "Manual note",
      followId: "follow_A",
      verification: "user_provided",
      addedAt: at,
    },
  ],
  limit: 50,
});
const stocks = (symbol = "SYNTH") => ({
  items: [{ symbol, name: "Synthetic Inc", instrumentType: "stock", currency: "USD", addedAt: at }],
  limit: 50,
});
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
};
module.exports = {
  compile,
  contracts,
  catalogue,
  channels,
  stocks,
  item,
  ref,
  at,
  response,
  settle,
  deferred,
};
