import test from "node:test";
import assert from "node:assert/strict";
import { assignedDue, assignedTrigger, centerRequestProof } from "../src/task-center.mjs";
import { digest } from "../src/crypto.mjs";
const d = {
  ownerSubject: "owner_A",
  vaultId: "vault_A",
  taskId: "task_A",
  ruleVersion: 3,
  schedule: {
    frequency: "weekly",
    days: [1, 3, 5],
    localTime: "13:47",
    timeZone: "America/Toronto",
    graceMinutes: 5,
    effectiveFrom: 0,
    dstGap: "skip",
    dstFold: "first",
  },
};
test("task schedule preserves arbitrary time, multi-day week and nullable manual mode", async () => {
  const now = Date.parse("2026-11-13T18:48:00Z") / 1000;
  const got = await assignedDue(d, now);
  assert.equal(got.scheduledAt, Date.parse("2026-11-13T18:47:00Z") / 1000);
  assert.equal(got.sourceAttested, false);
  assert.equal(
    got.baseTriggerId,
    "schedule_" +
      (await digest([
        d.ownerSubject,
        d.vaultId,
        d.taskId,
        d.ruleVersion,
        "2026-11-13",
        d.schedule,
      ])),
  );
  assert.equal(await assignedDue({ ...d, schedule: null }, now), null);
  assert.equal(await assignedDue(d, Date.parse("2026-11-12T18:48:00Z") / 1000), null);
});
test("DST gap skips and repeated hour uses first occurrence only", async () => {
  const daily = {
    ...d,
    schedule: { ...d.schedule, frequency: "daily", days: [], localTime: "02:30" },
  };
  assert.equal(await assignedDue(daily, Date.parse("2026-03-08T07:31:00Z") / 1000), null);
  daily.schedule.localTime = "01:30";
  assert.equal(
    (await assignedDue(daily, Date.parse("2026-11-01T05:31:00Z") / 1000)).scheduledAt,
    Date.parse("2026-11-01T05:30:00Z") / 1000,
  );
  assert.equal(await assignedDue(daily, Date.parse("2026-11-01T06:31:00Z") / 1000), null);
});
test("cross-midnight grace and effective rule boundary are exact", async () => {
  const daily = {
    ...d,
    schedule: { ...d.schedule, frequency: "daily", days: [], localTime: "23:59" },
  };
  assert.equal(
    (await assignedDue(daily, Date.parse("2026-11-14T05:01:00Z") / 1000)).scheduledAt,
    Date.parse("2026-11-14T04:59:00Z") / 1000,
  );
  daily.schedule.effectiveFrom = Date.parse("2026-11-14T05:00:00Z") / 1000;
  assert.equal(await assignedDue(daily, Date.parse("2026-11-14T05:01:00Z") / 1000), null);
});
test("same calendar slot separates assignments and generations without claiming provenance", async () => {
  const a = { ...d, assignmentId: "assignment_A", assignmentVersion: 1, lifecycleEpoch: 1 };
  const first = await assignedTrigger(a, "shared_base_trigger_0001");
  assert.notEqual(
    first,
    await assignedTrigger({ ...a, assignmentId: "assignment_B" }, "shared_base_trigger_0001"),
  );
  assert.notEqual(
    first,
    await assignedTrigger({ ...a, assignmentVersion: 2 }, "shared_base_trigger_0001"),
  );
  assert.equal(
    first,
    "tc_" +
      (await digest([
        a.ownerSubject,
        a.vaultId,
        a.taskId,
        a.assignmentId,
        1,
        3,
        1,
        "legacy_unknown",
        "shared_base_trigger_0001",
      ])),
  );
});
test("new proof paths remain closed", async () => {
  await assert.rejects(() =>
    centerRequestProof({
      identity: {},
      audience: "https://synthetic.example",
      path: "/oauth/token",
      request: {},
      now: 1000,
      privateKey: null,
    }),
  );
});
