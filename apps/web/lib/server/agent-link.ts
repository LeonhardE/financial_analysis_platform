import "server-only";
import { hubConfiguration } from "./hub-owner";

/** Public protocol destination only; the existing owner capability profile stays unchanged. */
export function agentLinkConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const configuration = hubConfiguration(env);
  return {
    schemaVersion: 1,
    enabled: configuration !== null,
    hubOrigin: configuration?.origin ?? null,
  };
}
