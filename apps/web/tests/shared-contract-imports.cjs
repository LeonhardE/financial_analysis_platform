const path = require("node:path");
const { pathToFileURL } = require("node:url");
// Temporary ESM fixtures execute the actual shared implementation. An explicit ignored candidate
// can exercise an ordered foundation prerequisite before that artifact reaches this worktree.
exports.rewrite = (code) => {
  const core = path.resolve(__dirname, "../../../packages/encrypted-workspace/dist/core.mjs");
  const target = process.env.FOLIOVIEW_TEST_REGISTRY_CORE
    ? path.resolve(process.env.FOLIOVIEW_TEST_REGISTRY_CORE)
    : core;
  return code
    .replace(
      /(["'])\.\.\/\.\.\/\.\.\/packages\/encrypted-workspace\/dist\/core\.mjs\1/g,
      JSON.stringify(pathToFileURL(target).href),
    )
    .replaceAll(
      JSON.stringify(pathToFileURL(core).href),
      JSON.stringify(pathToFileURL(target).href),
    )
    .replace(
      /(["'])\.\.\/\.\.\/\.\.\/packages\/encrypted-workspace\/valuation\/dist\/holdings\.mjs\1/g,
      JSON.stringify(
        pathToFileURL(
          path.resolve(
            __dirname,
            "../../../packages/encrypted-workspace/valuation/dist/holdings.mjs",
          ),
        ).href,
      ),
    );
};
