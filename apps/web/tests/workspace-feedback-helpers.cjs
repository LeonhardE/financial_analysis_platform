const { compile } = require("./resource-library-helpers.cjs");
function component(name, imports = {}) {
  return compile(`../components/${name.replace(/^\.\//, "")}.tsx`, {
    react: imports.react ?? require("react"),
    "react/jsx-runtime": imports["react/jsx-runtime"] ?? require("react/jsx-runtime"),
    "./WorkspaceFeedback.module.css": {
      __esModule: true,
      default: new Proxy({}, { get: (_, key) => String(key) }),
    },
  });
}
module.exports = { component };
