const path = require("node:path");
const { pathToFileURL } = require("node:url");
// Temporary ESM fixtures must exercise the real additive shared validator/sealer.
exports.rewrite = (code) =>
  code.replace(
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
