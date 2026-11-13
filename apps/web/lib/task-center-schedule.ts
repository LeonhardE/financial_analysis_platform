/** Display hint only; never registers or attests an Agent schedule. */
export function nextCenterOccurrence(
  rule: { frequency: string; days: number[]; localTime: string; timeZone: string },
  now = new Date(),
): string | null {
  try {
    if (
      !["daily", "weekly"].includes(rule.frequency) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.localTime) ||
      !Array.isArray(rule.days) ||
      rule.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7) ||
      (rule.frequency === "weekly" && !rule.days.length)
    )
      return null;
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: rule.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = (ms: number) =>
      Object.fromEntries(
        f
          .formatToParts(new Date(ms))
          .filter((p) => p.type !== "literal")
          .map((p) => [p.type, Number(p.value)]),
      );
    const today = parts(now.getTime()),
      [hour, minute] = rule.localTime.split(":").map(Number);
    for (let day = 0; day <= 8; day++) {
      const target = new Date(Date.UTC(today.year, today.month - 1, today.day + day, hour, minute));
      if (rule.frequency === "weekly" && !rule.days.includes(target.getUTCDay() || 7)) continue;
      let instant = target.getTime();
      for (let n = 0; n < 4; n++) {
        const p = parts(instant);
        instant +=
          target.getTime() - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      }
      const matches = [-7200000, -3600000, 0, 3600000, 7200000]
        .map((o) => instant + o)
        .filter((ms) => {
          const p = parts(ms);
          return (
            p.year === target.getUTCFullYear() &&
            p.month === target.getUTCMonth() + 1 &&
            p.day === target.getUTCDate() &&
            p.hour === hour &&
            p.minute === minute
          );
        })
        .sort((a, b) => a - b);
      // A fold has one selected occurrence, even if the second wall time is future.
      if (matches.length && matches[0] > now.getTime()) return new Date(matches[0]).toISOString();
    }
  } catch {}
  return null;
}
