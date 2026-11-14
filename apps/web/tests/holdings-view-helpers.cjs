const { compile } = require("./resource-library-helpers.cjs");
module.exports = compile("../lib/holdings-view.ts", {
  "./task-types": compile("../lib/task-types.ts"),
});
