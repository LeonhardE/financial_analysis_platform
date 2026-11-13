const test = require("node:test"),
  assert = require("node:assert/strict");
const { nextCenterOccurrence: next } = require("./resource-library-helpers.cjs").compile(
  "../lib/task-center-schedule.ts",
  {},
  { Intl, Date },
);
test("task center preserves chosen weekdays, time and zone without a fixed daily time", () => {
  const r = { frequency: "weekly", days: [1, 3, 5], localTime: "18:42", timeZone: "Asia/Shanghai" };
  assert.equal(next(r, new Date("2026-11-13T10:43Z")), "2026-11-16T10:42:00.000Z");
  assert.equal(next({ ...r, localTime: "99:01" }), null);
  assert.equal(next({ ...r, timeZone: "invalid" }), null);
});
test("schedule hint skips DST gaps and never falls back to the second fold occurrence", () => {
  const r = { frequency: "daily", days: [], localTime: "02:30", timeZone: "America/Toronto" };
  assert.equal(next(r, new Date("2027-03-14T05:00Z")), "2027-03-15T06:30:00.000Z");
  assert.equal(
    next({ ...r, localTime: "01:30" }, new Date("2026-11-01T06:00Z")),
    "2026-11-02T06:30:00.000Z",
  );
});
