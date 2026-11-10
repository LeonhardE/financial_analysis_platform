import "server-only";
import { independentConfiguration } from "../independent-agent";

export function independentAgentConfiguration(env: NodeJS.ProcessEnv = process.env) {
  try {
    if (env.FOLIOVIEW_INDEPENDENT_AGENT_ENABLED !== "true") throw new Error();
    const raw = env.FOLIOVIEW_INDEPENDENT_AGENT_CONFIG ?? "";
    if (Buffer.byteLength(raw) > 16384) throw new Error();
    return {
      schemaVersion: 1,
      enabled: true,
      configuration: independentConfiguration(JSON.parse(raw)),
    };
  } catch {
    return { schemaVersion: 1, enabled: false, configuration: null };
  }
}
