/** Deterministic calendar slots; native schedules trigger this operation, never an open-page timer. */
import { deny, digest, integer } from "./crypto.mjs";
const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export async function dueSlot(actor, taskId, delivery, now) {
  integer(now, 0);
  if (delivery === null) return null;
  if (
    !delivery ||
    !["daily", "weekdays", "weekly"].includes(delivery.cadence) ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(delivery.localTime) ||
    !Number.isSafeInteger(delivery.graceMinutes) ||
    delivery.graceMinutes < 0 ||
    delivery.graceMinutes > 1440 ||
    (delivery.cadence === "weekly") !== Object.hasOwn(delivery, "weekday") ||
    (delivery.cadence === "weekly" &&
      (!Number.isSafeInteger(delivery.weekday) || delivery.weekday < 0 || delivery.weekday > 6))
  )
    deny("invalid_schedule");
  let format;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: delivery.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    deny("invalid_schedule");
  }
  const minute = Math.floor(now / 60);
  for (let offset = 0; offset <= delivery.graceMinutes; offset++) {
    const at = minute - offset,
      p = Object.fromEntries(
        format
          .formatToParts(new Date(at * 60000))
          .filter((v) => v.type !== "literal")
          .map((v) => [v.type, v.value]),
      );
    if (p.hour + ":" + p.minute !== delivery.localTime) continue;
    const day = weekdays[p.weekday];
    if (
      (delivery.cadence === "weekdays" && (day === 0 || day === 6)) ||
      (delivery.cadence === "weekly" && day !== delivery.weekday)
    )
      continue;
    const localDate = `${p.year}-${p.month}-${p.day}`;
    const slot = {
      cadence: delivery.cadence,
      timeZone: delivery.timeZone,
      localDate,
      localTime: delivery.localTime,
      ...(delivery.cadence === "weekly" ? { weekday: delivery.weekday } : {}),
    };
    // Independent of retries, task version, recipient connection, UTC offset and DST fold.
    const triggerId =
      "schedule_" + (await digest([actor.ownerSubject, actor.vaultId, taskId, slot]));
    return { triggerId, slot, scheduledAt: at * 60 };
  }
  return null;
}
