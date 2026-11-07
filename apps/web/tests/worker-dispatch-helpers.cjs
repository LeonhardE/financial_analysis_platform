const { readFileSync } = require("node:fs");
const path = require("node:path");
const { transformSync } = require("next/dist/build/swc");

// Execute both production modules in the test's existing clock/crypto realm.
function compileVaultWorker() {
  const compile = (name) => {
    const filename = path.resolve(__dirname, "../lib/" + name + ".ts");
    return transformSync(readFileSync(filename, "utf8"), {
      filename,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" },
    }).code;
  };
  return (
    "const __vaultKernel = (() => { const module = { exports: {} }; const exports = module.exports;\n" +
    compile("encrypted-vault-engine") +
    "\nreturn module.exports; })();\n" +
    compile("encrypted-vault.worker").replace(
      'require("./encrypted-vault-engine")',
      "__vaultKernel",
    )
  );
}
module.exports = { compileVaultWorker };
