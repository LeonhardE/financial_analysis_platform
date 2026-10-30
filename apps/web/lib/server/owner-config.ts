import "server-only";

import { hubConfiguration } from "./hub-owner";
import { portfolioConfiguration } from "./portfolio-owner";

export function ownerCapabilities(env: NodeJS.ProcessEnv = process.env) {
  return {
    schemaVersion: 1,
    flags: {
      portfolio: portfolioConfiguration(env) !== null,
      agentHub: hubConfiguration(env) !== null,
    },
  };
}
