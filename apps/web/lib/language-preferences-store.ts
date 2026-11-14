import {
  LANGUAGE_PREFERENCES_PATH,
  effectiveLanguage,
  uiLanguage,
  readLanguageResponse,
  type LanguagePreferencesSnapshot,
  type UiLanguage,
} from "./language-preferences";

export type LanguagePreferenceState = Readonly<{
  owner: string;
  snapshot: LanguagePreferencesSnapshot | null;
  selected: UiLanguage;
  status: "loading" | "saving" | "saved" | "error";
  error: "load" | "save" | null;
  hasIntent: boolean;
}>;
type Request = (
  path: string,
  options: { method: "GET" | "PUT"; signal: AbortSignal; json?: unknown },
) => Promise<Response>;

/** One account/session. Unknown writes are read back before any further save. */
export class LanguagePreferenceStore {
  readonly owner: string;
  #request: Request;
  #publish: (state: LanguagePreferenceState) => void;
  #state: LanguagePreferenceState;
  #active = true;
  #running = false;
  #intent: UiLanguage | null = null;
  #needsRead = true;
  #conflicts = 0;
  #controller: AbortController | null = null;
  #timeout: number;
  #fallback: UiLanguage = "en";
  constructor(
    owner: string,
    request: Request,
    publish: (state: LanguagePreferenceState) => void,
    timeoutMs = 20_000,
  ) {
    this.owner = owner;
    this.#request = request;
    this.#publish = publish;
    this.#timeout = timeoutMs;
    this.#state = {
      owner,
      snapshot: null,
      selected: "en",
      status: "loading",
      error: null,
      hasIntent: false,
    };
  }
  get state() {
    return this.#state;
  }
  #emit(changes: Partial<LanguagePreferenceState>) {
    if (!this.#active) return;
    this.#state = { ...this.#state, ...changes, hasIntent: Boolean(this.#intent) };
    this.#publish(this.#state);
  }
  start() {
    this.#run();
  }
  fallback(value: UiLanguage) {
    this.#fallback = uiLanguage(value);
    if (this.#active && !this.#state.snapshot?.preferences && !this.#intent)
      this.#emit({ selected: this.#fallback });
  }
  select(value: unknown) {
    const language = uiLanguage(value);
    if (
      !this.#active ||
      !this.#state.snapshot ||
      (language === this.#state.selected && this.#state.snapshot.preferences !== null)
    )
      return;
    this.#intent = language;
    this.#conflicts = 0;
    this.#emit({ selected: language, error: null });
    this.#run();
  }
  retry() {
    if (!this.#active || this.#running || !this.#state.error) return;
    this.#needsRead = true;
    this.#conflicts = 0;
    this.#emit({ error: null });
    this.#run();
  }
  dispose() {
    this.#active = false;
    this.#controller?.abort();
  }
  async #call(method: "GET" | "PUT", json?: unknown) {
    const controller = new AbortController();
    this.#controller = controller;
    let rejectAborted: () => void = () => {};
    const abandoned = new Promise<never>((_, reject) => {
      rejectAborted = () => reject(new Error("Language request cancelled"));
    });
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    try {
      return await Promise.race([
        (async () => {
          const response = await this.#request(LANGUAGE_PREFERENCES_PATH, {
            method,
            signal: controller.signal,
            ...(json === undefined ? {} : { json }),
          });
          if (!this.#active || controller.signal.aborted)
            throw new Error("Language request cancelled");
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            return { status: response.status, snapshot: null };
          }
          const snapshot = await readLanguageResponse(response, controller.signal);
          return { status: response.status, snapshot };
        })(),
        abandoned,
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", rejectAborted);
      controller.abort();
      if (this.#controller === controller) this.#controller = null;
    }
  }
  async #load() {
    this.#emit({ status: "loading", error: null, hasIntent: false });
    const reply = await this.#call("GET");
    if (!reply.snapshot) throw new Error("Language read failed");
    const snapshot = reply.snapshot,
      confirmed = effectiveLanguage(snapshot, this.#fallback);
    if (snapshot.preferences && this.#intent === confirmed) this.#intent = null;
    this.#needsRead = false;
    this.#emit({
      snapshot,
      selected: this.#intent ?? confirmed,
      status: this.#intent ? "saving" : "saved",
    });
  }
  #run() {
    if (!this.#active || this.#running) return;
    this.#running = true;
    void (async () => {
      let phase: "load" | "save" = this.#intent ? "save" : "load";
      try {
        if (this.#needsRead) await this.#load();
        while (this.#active && this.#intent && this.#state.snapshot) {
          phase = "save";
          const before = this.#state.snapshot,
            desired = this.#intent;
          if (before.preferences && desired === effectiveLanguage(before, this.#fallback)) {
            this.#intent = null;
            this.#emit({ status: "saved" });
            break;
          }
          this.#emit({ status: "saving", error: null });
          // Assume an unknown commit until a complete valid response or explicit conflict arrives.
          this.#needsRead = true;
          const reply = await this.#call("PUT", {
            expectedVersion: before.version,
            language: desired,
          });
          if (reply.status === 409) {
            if (++this.#conflicts > 2) throw new Error("Language conflict");
            await this.#load();
            continue;
          }
          const saved = reply.snapshot;
          if (
            !saved ||
            saved.preferences?.language !== desired ||
            saved.version !== before.version + 1
          )
            throw new Error("Invalid saved language");
          this.#needsRead = false;
          this.#conflicts = 0;
          if (this.#intent === desired) this.#intent = null;
          this.#emit({
            snapshot: saved,
            selected: this.#intent ?? desired,
            status: this.#intent ? "saving" : "saved",
          });
        }
      } catch {
        this.#emit({ status: "error", error: phase });
      } finally {
        this.#running = false;
      }
    })();
  }
}
