const assert = require("node:assert/strict"),
  test = require("node:test");
const { compile } = require("./resource-library-helpers.cjs");
const { hooks, jsx, all } = require("./resource-ui-harness.cjs");

test("real TasksPanel requests executors for creation, editing and selected details while preserving full list and unread reads", () => {
  const h = hooks(),
    demands = [],
    resultReads = [],
    taskReads = [];
  let active = true;
  const workspace = { authenticated: true, owner: "owner_A", phase: "unlocked" };
  const model = { owner: "owner_A", unlocked: true, selected: null, form: null, openTask() {} };
  const results = { unreadCounts: { task_A: 7 }, partial: true, detail: null };
  const TaskCenterView = () => null;
  const { default: TasksPanel } = compile(
    "../components/TasksPanel.tsx",
    {
      react: h.react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next-intl": { useLocale: () => "en", useTranslations: () => (v) => v },
      "./useTasks": {
        useTasks: (_workspace, options) => {
          taskReads.push(options.active);
          return model;
        },
      },
      "./useTaskCenter": { useTaskCenter: () => ({ manual: {} }) },
      "./useTaskResults": {
        useTaskResults: (_workspace, _persistent, _model, enabled) => {
          resultReads.push(enabled);
          return results;
        },
      },
      "./TaskResultsPanel": { TaskResultsPanel: () => null },
      "./TaskCenterPanel": { TaskCenterView },
      "./PasskeyHelp": { PasskeyHelp: () => null },
      "@/lib/task-forms": { defaultTask: () => ({}) },
      "@/lib/task-types": { bindingKey: JSON.stringify },
      "./TasksPanel.module.css": { __esModule: true, default: {} },
    },
    { window: { location: { hash: "" }, addEventListener() {}, removeEventListener() {} } },
  );
  const onAgentConnectionsNeeded = (needed) => demands.push(needed);
  const draw = () => h.render(() => TasksPanel({ workspace, active, onAgentConnectionsNeeded }));
  let tree = draw();
  assert.equal(demands.at(-1), false);
  assert.equal(resultReads.at(-1), true);
  assert.equal(taskReads.at(-1), true);
  assert.equal(
    all(tree, (n) => n.type === TaskCenterView)[0].props.unreadCounts,
    results.unreadCounts,
  );
  assert.equal(all(tree, (n) => n.type === TaskCenterView)[0].props.unreadPartial, true);
  model.form = { name: "New task" };
  draw();
  assert.equal(demands.at(-1), true, "new task executor selection is enabled");
  active = false;
  draw();
  assert.equal(demands.at(-1), false);
  active = true;
  draw();
  assert.equal(demands.at(-1), true, "returning draft retains demand");
  model.selected = { taskId: "task_A" };
  model.dirty = true;
  draw();
  assert.equal(demands.at(-1), true, "editing preserves executor demand");
  model.dirty = false;
  draw();
  assert.equal(demands.at(-1), true, "detail assignments remain enabled");
  model.form = null;
  model.selected = null;
  draw();
  assert.equal(demands.at(-1), false);
  model.form = { name: "OLD" };
  workspace.owner = "owner_B";
  draw();
  assert.equal(demands.at(-1), false);
  workspace.owner = "owner_A";
  draw();
  assert.equal(demands.at(-1), true);
  h.close();
  assert.equal(demands.at(-1), false, "unmount releases display demand");
});
