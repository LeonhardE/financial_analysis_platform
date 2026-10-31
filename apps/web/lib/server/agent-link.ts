import "server-only";
import { hubConfiguration } from "./hub-owner";

/** A configured destination is not proof that Muse connection issuance is enabled. */
export function agentLinkConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const configuration = hubConfiguration(env);
  return {
    schemaVersion: 1,
    enabled: configuration !== null,
    hubOrigin: configuration?.origin ?? null,
  };
}
