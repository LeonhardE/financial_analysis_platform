import { ConnectionError, exact } from "./agent-connections";

export type AgentLinkConfiguration = {
  schemaVersion: 1;
  enabled: boolean;
  hubOrigin: string | null;
};
export function readAgentLinkConfiguration(value: unknown): AgentLinkConfiguration {
  if (
    !exact(value, ["schemaVersion", "enabled", "hubOrigin"]) ||
    value.schemaVersion !== 1 ||
    typeof value.enabled !== "boolean" ||
    (value.enabled
      ? typeof value.hubOrigin !== "string" ||
        !/^https:\/\/agent-hub-api-[0-9]{1,20}\.[a-z]+(?:-[a-z0-9]+)+[0-9]\.run\.app$/.test(
          value.hubOrigin,
        )
      : value.hubOrigin !== null)
  )
    throw new ConnectionError("invalid_response");
  return value as AgentLinkConfiguration;
}

export async function loadAgentLinkConfiguration(
  signal?: AbortSignal,
): Promise<AgentLinkConfiguration> {
  const response = await fetch("/api/private/agent-link/config", {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
    headers: { Accept: "application/json" },
  });
  if (signal?.aborted) throw new ConnectionError("cancelled");
  if (
    response.status !== 200 ||
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json" ||
    !response.body
  )
    throw new ConnectionError("invalid_response");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const part = await reader.read();
      if (signal?.aborted) throw new ConnectionError("cancelled");
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw new ConnectionError("invalid_response");
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return readAgentLinkConfiguration(JSON.parse(text));
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError("invalid_response");
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}
