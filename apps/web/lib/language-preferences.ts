/** Closed account language preference; legacy UI preferences remain independently versioned. */
export const UI_LANGUAGES = ["en", "zh", "zh-Hant"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const LANGUAGE_PREFERENCES_PATH = "/api/v2/preferences/language";
export type LanguagePreferencesSnapshot = Readonly<{
  preferences: Readonly<{ language: UiLanguage }> | null;
  version: number;
}>;
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...keys].sort().join("|"),
  );
}
export function uiLanguage(value: unknown): UiLanguage {
  if (typeof value !== "string" || !UI_LANGUAGES.includes(value as UiLanguage))
    throw new Error("Invalid language preferences");
  return value as UiLanguage;
}
export function languageUpdate(value: unknown) {
  if (
    !exact(value, ["language", "expectedVersion"]) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    (value.expectedVersion as number) < 0
  )
    throw new Error("Invalid language preferences");
  return { language: uiLanguage(value.language), expectedVersion: value.expectedVersion as number };
}
export function readLanguagePreferences(value: unknown): LanguagePreferencesSnapshot {
  if (
    !exact(value, ["preferences", "version"]) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 0 ||
    (value.preferences === null) !== (value.version === 0) ||
    (value.preferences !== null && !exact(value.preferences, ["language"]))
  )
    throw new Error("Invalid language preferences");
  return Object.freeze({
    preferences:
      value.preferences === null
        ? null
        : Object.freeze({
            language: uiLanguage((value.preferences as Record<string, unknown>).language),
          }),
    version: value.version as number,
  });
}
export const effectiveLanguage = (
  snapshot: LanguagePreferencesSnapshot,
  fallback: UiLanguage = "en",
) => snapshot.preferences?.language ?? fallback;
export const languageTag = (language: UiLanguage) => (language === "zh" ? "zh-CN" : language);

export async function readLanguageResponse(response: Response, signal: AbortSignal) {
  if (
    !response.body ||
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json"
  ) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Invalid language response");
  }
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) {
    void response.body.cancel().catch(() => {});
    throw new Error("Invalid language response");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("Language request cancelled");
      const next = await reader.read();
      if (signal.aborted) throw new Error("Language request cancelled");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) {
        cancel();
        throw new Error("Invalid language response");
      }
      chunks.push(next.value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return readLanguagePreferences(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)),
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}
