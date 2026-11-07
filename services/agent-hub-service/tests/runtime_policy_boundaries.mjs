import assert from "node:assert/strict";
import { checkInputPolicy } from "../runtime/src/policy.mjs";

const policy = { allowPartial: false, allowUnknownAsOf: false, maxFetchedAgeSeconds: 300 };
const resource = {
  coverage: { state: "complete" },
  sourceAsOf: "1970-01-01T00:16:40Z",
  fetchedAt: "1970-01-01T00:16:40Z",
  freshness: "fresh",
};
const reject = (code, p = policy, r = resource, now = 1000) =>
  assert.throws(
    () => checkInputPolicy(p, r, now),
    (error) => error.code === code,
  );
checkInputPolicy(policy, resource, 1000);
checkInputPolicy(policy, resource, 1300);
checkInputPolicy(policy, resource, 998);
reject("input_policy_fetched_age", policy, resource, 997.9);
reject("input_policy_fetched_age", policy, resource, 1300.1);
reject("input_policy_fetched_age", policy, { ...resource, fetchedAt: "invalid" });
reject("input_policy_partial", policy, { ...resource, coverage: { state: "partial" } });
reject("input_policy_asof", policy, { ...resource, sourceAsOf: null });
reject("input_policy_freshness", policy, { ...resource, freshness: "unknown" });
reject(
  "input_policy_freshness",
  { ...policy, allowUnknownAsOf: true },
  { ...resource, freshness: "stale" },
);
checkInputPolicy(
  { ...policy, allowPartial: true, allowUnknownAsOf: true },
  { ...resource, coverage: { state: "partial" }, sourceAsOf: null, freshness: "unknown" },
  1000,
);
