/** Apply the decrypted task's private policy to each independently verified resource. */
import { deny } from "./crypto.mjs";

export function checkInputPolicy(policy, resource, now) {
  if (!policy.allowPartial && resource.coverage.state !== "complete") deny("input_policy_partial");
  if (!policy.allowUnknownAsOf && resource.sourceAsOf === null) deny("input_policy_asof");
  const age = now - Date.parse(resource.fetchedAt) / 1000;
  // Public server time is in whole seconds; allow only the same two-second
  // precision tolerance used by owner publication verification.
  if (!Number.isFinite(age) || age < -2 || age > policy.maxFetchedAgeSeconds)
    deny("input_policy_fetched_age");
  if (
    resource.freshness === "stale" ||
    (resource.freshness === "unknown" && !policy.allowUnknownAsOf)
  )
    deny("input_policy_freshness");
}
