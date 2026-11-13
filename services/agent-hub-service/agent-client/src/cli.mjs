/** Agent-only CLI: private material never appears in arguments or stdout. */
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { AgentClient, HostStorage, prepare, activate } from "./index.mjs";
import { exact, parsed, canonical, deny } from "./crypto.mjs";

export function clientFailure(error) {
  const code = error?.code;
  const failure = (error, message) => ({ ok: false, error, message });
  if (code === "agent_busy")
    return failure("agent_busy", "Retry after the current Agent operation finishes.");
  if (code === "authorization_pending")
    return failure("authorization_pending", "Wait for the user to authorize in FolioView.");
  if (
    [
      "input_policy_partial",
      "input_policy_asof",
      "input_policy_fetched_age",
      "input_policy_freshness",
    ].includes(code)
  )
    return failure(
      "input_policy_rejected",
      "Stop this task. Its inputs do not meet the approved data rules. Ask the user to review the task rules or update its shared data in FolioView; reauthorization is not required for this error.",
    );
  if (code === "insufficient_scope")
    return failure(
      "task_access_required",
      "Stop this task. Ask the user to review its assigned Agent and shared resources in FolioView.",
    );
  if (code === "version_conflict")
    return failure(
      "operation_conflict",
      "Stop this task. Check the original operation and current state in FolioView before continuing the same intended work.",
    );
  if (code === "invalid_report")
    return failure(
      "invalid_report",
      "Stop this submission. Correct the report format before submitting the same intended run again; reauthorization is not required for this error.",
    );
  if (code === "run_expired")
    return failure(
      "run_unavailable",
      "Stop this task. The run's time window could not be verified. Check the host time and saved run before retrying the same intended operation.",
    );
  if (["runtime_network_unavailable", "runtime_service_unavailable"].includes(code))
    return failure(
      "service_unavailable",
      "Stop this task while the service is unavailable. Keep the original pending operation and verify its receipt before retrying; do not create a replacement authorization.",
    );
  return failure(
    "reauthorization_required",
    "Stop this task. Ask the user to sign in to FolioView and authorize this Agent again. Keep private credentials out of chat and uploads.",
  );
}

export async function execute(
  value,
  {
    directory = process.env.FOLIOVIEW_AGENT_DIRECTORY ??
      homedir() + "/.local/share/folioview-agent",
    fetch = globalThis.fetch.bind(globalThis),
  } = {},
) {
  exact(value, ["origin", "provider", "actor", "operation", "arguments"]);
  const storage = new HostStorage({
    directory,
    origin: value.origin,
    provider: value.provider,
    actor: value.actor,
  });
  if (value.operation === "prepare") {
    exact(value.arguments, ["bootstrap"]);
    return prepare(storage, value.arguments.bootstrap);
  }
  if (value.operation === "activate") {
    exact(value.arguments, ["response"]);
    return activate(storage, value.arguments.response, { fetch });
  }
  const allowed = [
    "status",
    "tasks",
    "due",
    "begin",
    "input",
    "submit",
    "receipt",
    "planStatus",
    "reportPlan",
    "retryPlanReport",
    "taskCenterState",
    "dueAssigned",
    "beginAssigned",
    "pendingManual",
    "beginManual",
    "reportPlanAssigned",
  ];
  if (!allowed.includes(value.operation)) deny("invalid_operation");
  const fields = {
    status: [],
    tasks: [],
    due: [],
    begin: ["taskId", "triggerId"],
    input: ["runId", "publicationId"],
    submit: ["runId", "report"],
    receipt: ["runId"],
    planStatus: ["taskId"],
    reportPlan: ["taskId", "status", "planReference"],
    retryPlanReport: ["taskId"],
    taskCenterState: ["taskId"],
    dueAssigned: [],
    beginAssigned: ["taskId", "baseTriggerId"],
    pendingManual: ["taskId"],
    beginManual: ["taskId", "requestId"],
    reportPlanAssigned: ["taskId", "status", "planReference"],
  };
  exact(value.arguments, fields[value.operation]);
  const client = new AgentClient({ origin: value.origin, storage, fetch });
  await client.initialize();
  try {
    return await client[value.operation](value.arguments);
  } finally {
    client.clear();
  }
}
async function main() {
  try {
    if (process.argv.length !== 2) deny("invalid_operation");
    let size = 0;
    const parts = [];
    for await (const part of process.stdin) {
      size += part.length;
      if (size > 4194304) deny("payload_too_large");
      parts.push(part);
    }
    const value = parsed(new Uint8Array(Buffer.concat(parts)));
    const result = await execute(value);
    process.stdout.write(new TextDecoder().decode(canonical({ ok: true, result })) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify(clientFailure(error)) + "\n");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
