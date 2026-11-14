import type { ChartRange } from "@/lib/market-data";
import type { UiLanguage } from "./language-preferences";

export type Preferences = {
  theme: "system" | "light" | "dark";
  language: UiLanguage;
  defaultChartRange: ChartRange;
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  language: "en",
  defaultChartRange: "1m",
};

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid preferences response");
  }
  const preferences = value as Record<string, unknown>;
  if (
    Object.keys(preferences).length !== 3 ||
    !["system", "light", "dark"].includes(preferences.theme as string) ||
    !["en", "zh", "zh-Hant"].includes(preferences.language as string) ||
    !["1d", "1w", "1m", "3m", "1y"].includes(preferences.defaultChartRange as string)
  ) {
    throw new Error("Invalid preferences response");
  }
  return {
    theme: preferences.theme as Preferences["theme"],
    language: preferences.language as Preferences["language"],
    defaultChartRange: preferences.defaultChartRange as ChartRange,
  };
}

export type PreferencesSnapshot = { preferences: Preferences | null; version: number };

export function readPreferences(value: unknown): PreferencesSnapshot {
  if (
    !value ||
    typeof value !== "object" ||
    !("preferences" in value) ||
    !("version" in value) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 0 ||
    (value.preferences === null ? value.version !== 0 : value.version === 0)
  ) {
    throw new Error("Invalid preferences response");
  }
  const preferences = value.preferences === null ? null : validatePreferences(value.preferences);
  // This reader is exclusively for the frozen v1 endpoint.
  if (preferences?.language === "zh-Hant") throw new Error("Invalid preferences response");
  return {
    preferences,
    version: value.version as number,
  };
}

export const legacyPreferences = (preferences: Preferences): Preferences => ({
  ...preferences,
  language: preferences.language === "zh-Hant" ? "zh" : preferences.language,
});

export function samePreferences(left: Preferences, right: Preferences): boolean {
  return (
    left.theme === right.theme &&
    left.language === right.language &&
    left.defaultChartRange === right.defaultChartRange
  );
}
