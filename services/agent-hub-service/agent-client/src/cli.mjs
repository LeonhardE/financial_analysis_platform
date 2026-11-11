/** Agent-only CLI: private material never appears in arguments or stdout. */
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { AgentClient, HostStorage, prepare, activate } from "./index.mjs";
import { exact, parsed, canonical, deny } from "./crypto.mjs";

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
    const retry = error.code === "agent_busy",
      pending = error.code === "authorization_pending";
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: retry
          ? "agent_busy"
          : pending
            ? "authorization_pending"
            : "reauthorization_required",
        message: retry
          ? "Retry after the current Agent operation finishes."
          : pending
            ? "Wait for the user to authorize in FolioView."
            : "Stop this task. Ask the user to sign in to FolioView and authorize this Agent again. Keep private credentials out of chat and uploads.",
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
