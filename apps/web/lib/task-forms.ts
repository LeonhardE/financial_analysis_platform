import type { ResourceBindingMetadata, TaskContent } from "./encrypted-types";
import { bindingKey } from "./task-types";

export type TaskPreview = {
  valid: boolean;
  errors: string[];
  nextExpectedAt: string | null;
  resourceCount: number;
};
export function defaultTask(template: "brief" | "custom" = "brief"): TaskContent {
  return {
    name: "",
    template,
    goal: "",
    inputPolicy: { allowPartial: false, allowUnknownAsOf: false, maxFetchedAgeSeconds: 86400 },
    outputSpec: {
      label: "Report",
      sections: [{ sectionId: "overview", title: "Overview", instructions: "" }],
      language: "en",
      verbosity: "standard",
    },
    deliveryExpectation: null,
  };
}
const text = (value: unknown, min: number, max: number) =>
  typeof value === "string" && value.trim().length >= min && value.length <= max;
const number = (value: unknown, min: number, max: number) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
export function reviewTask(
  content: TaskContent,
  bindings: ResourceBindingMetadata[],
  now = new Date(),
): TaskPreview {
  const errors: string[] = [];
  if (!text(content.name, 1, 80)) errors.push("name");
  if (!text(content.goal, 1, 2000)) errors.push("goal");
  if (!["brief", "custom"].includes(content.template)) errors.push("template");
  if (
    bindings.length > 10 ||
    new Set(bindings.map(bindingKey)).size !== bindings.length ||
    (content.template === "brief" && bindings.length === 0)
  )
    errors.push("resources");
  if (
    typeof content.inputPolicy.allowPartial !== "boolean" ||
    typeof content.inputPolicy.allowUnknownAsOf !== "boolean" ||
    !number(content.inputPolicy.maxFetchedAgeSeconds, 60, 604800)
  )
    errors.push("inputPolicy");
  const output = content.outputSpec;
  if (
    !text(output.label, 1, 40) ||
    !["zh", "en"].includes(output.language) ||
    !["concise", "standard"].includes(output.verbosity)
  )
    errors.push("output");
  if (
    output.sections.length < 1 ||
    output.sections.length > 8 ||
    new Set(output.sections.map((part) => part.sectionId)).size !== output.sections.length ||
    output.sections.some(
      (part) =>
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(part.sectionId) ||
        !text(part.title, 1, 120) ||
        !text(part.instructions, 0, 1000),
    )
  )
    errors.push("sections");
  const expectation = content.deliveryExpectation;
  if (expectation !== null) {
    let zone = true;
    try {
      new Intl.DateTimeFormat("en", { timeZone: expectation.timeZone }).format(now);
    } catch {
      zone = false;
    }
    if (
      !["daily", "weekdays", "weekly"].includes(expectation.cadence) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(expectation.localTime) ||
      !text(expectation.timeZone, 1, 80) ||
      !zone ||
      !number(expectation.graceMinutes, 0, 1440) ||
      (expectation.cadence === "weekly"
        ? !number(expectation.weekday, 0, 6)
        : Object.hasOwn(expectation, "weekday"))
    )
      errors.push("expectation");
  }
  return {
    valid: errors.length === 0,
    errors,
    resourceCount: bindings.length,
    nextExpectedAt: errors.includes("expectation") ? null : nextExpected(content, now),
  };
}
/** Local display hint only. This never registers or checks any provider schedule. */
export function nextExpected(content: TaskContent, now = new Date()): string | null {
  const rule = content.deliveryExpectation;
  if (!rule) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: rule.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = (date: Date) =>
      Object.fromEntries(
        formatter
          .formatToParts(date)
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
      );
    const today = parts(now),
      [hour, minute] = rule.localTime.split(":").map(Number);
    for (let day = 0; day <= 8; day++) {
      const target = new Date(Date.UTC(today.year, today.month - 1, today.day + day, hour, minute));
      const weekday = target.getUTCDay();
      if (
        (rule.cadence === "weekdays" && (weekday === 0 || weekday === 6)) ||
        (rule.cadence === "weekly" && weekday !== rule.weekday)
      )
        continue;
      let instant = target.getTime();
      for (let attempt = 0; attempt < 4; attempt++) {
        const local = parts(new Date(instant));
        const represented = Date.UTC(
          local.year,
          local.month - 1,
          local.day,
          local.hour,
          local.minute,
          local.second,
        );
        instant += target.getTime() - represented;
      }
      // DST folds can have two instants; skip nonexistent wall times rather than inventing a schedule.
      const candidates = [-7200000, -3600000, 0, 3600000, 7200000]
        .map((offset) => instant + offset)
        .sort((a, b) => a - b);
      for (const candidate of candidates) {
        const local = parts(new Date(candidate));
        if (
          candidate > now.getTime() &&
          local.year === target.getUTCFullYear() &&
          local.month === target.getUTCMonth() + 1 &&
          local.day === target.getUTCDate() &&
          local.hour === hour &&
          local.minute === minute
        )
          return new Date(candidate).toISOString();
      }
    }
  } catch {
    return null;
  }
  return null;
}
