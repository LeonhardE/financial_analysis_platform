import test from "node:test";
import assert from "node:assert/strict";
import { clientFailure } from "../src/cli.mjs";

test("input policy failures ask for task/data review without replacing authorization", () => {
  const invalidFacts = clientFailure({ code: "invalid_valuation", message: "PRIVATE_SENTINEL" });
  assert.equal(invalidFacts.error, "input_format_rejected");
  assert.match(invalidFacts.message, /reauthorization is not required/);
  assert.equal(JSON.stringify(invalidFacts).includes("PRIVATE_SENTINEL"), false);
  for (const code of [
    "input_policy_partial",
    "input_policy_asof",
    "input_policy_fetched_age",
    "input_policy_freshness",
  ]) {
    const result = clientFailure({ code });
    assert.equal(result.ok, false);
    assert.equal(result.error, "input_policy_rejected");
    assert.match(result.message, /task rules or update its shared data/);
    assert.match(result.message, /reauthorization is not required/);
  }
});

test("run and state failures preserve the same intended work instead of fresh authorization", () => {
  assert.equal(clientFailure({ code: "version_conflict" }).error, "operation_conflict");
  assert.equal(clientFailure({ code: "run_expired" }).error, "run_unavailable");
  assert.match(clientFailure({ code: "run_expired" }).message, /host time and saved run/);
});

test("network and service failures preserve the original pending operation and receipt", () => {
  for (const code of ["runtime_network_unavailable", "runtime_service_unavailable"]) {
    const result = clientFailure({ code });
    assert.equal(result.error, "service_unavailable");
    assert.match(result.message, /original pending operation/);
    assert.match(result.message, /verify its receipt/);
  }
});

test("invalid report formatting keeps the same run without unnecessary reauthorization", () => {
  const result = clientFailure({ code: "invalid_report" });
  assert.equal(result.error, "invalid_report");
  assert.match(result.message, /Correct the report format/);
  assert.match(result.message, /same intended run/);
  assert.match(result.message, /reauthorization is not required/);
});

test("credential and unknown failures remain closed and never expose arbitrary diagnostics", () => {
  for (const code of [
    "reauthorization_required",
    "runtime_authorization_required",
    "key_revoked",
    "input_policy_PRIVATE_SENTINEL",
    "unknown_PRIVATE_SENTINEL",
    undefined,
  ]) {
    const result = clientFailure({ code, message: "PRIVATE_SENTINEL", stack: "PRIVATE_SENTINEL" });
    assert.equal(result.error, "reauthorization_required");
    assert.equal(JSON.stringify(result).includes("PRIVATE_SENTINEL"), false);
  }
  assert.equal(clientFailure(null).error, "reauthorization_required");
});

test("busy and pending authorization retain their existing distinct recovery paths", () => {
  assert.equal(clientFailure({ code: "agent_busy" }).error, "agent_busy");
  assert.equal(clientFailure({ code: "authorization_pending" }).error, "authorization_pending");
});
