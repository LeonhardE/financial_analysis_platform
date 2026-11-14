import {
  CURRENCY_PREFERENCES_PATH,
  effectivePortfolioCurrency,
  portfolioCurrency,
  readCurrencyResponse,
  type CurrencyPreferencesSnapshot,
  type PortfolioCurrency,
} from "./currency-preferences";

export type CurrencyPreferenceState = Readonly<{
  owner: string;
  snapshot: CurrencyPreferencesSnapshot | null;
  selected: PortfolioCurrency;
  status: "loading" | "saving" | "saved" | "error";
  error: "load" | "save" | null;
}>;
type Request = (
  path: string,
  options: { method: "GET" | "PUT"; signal: AbortSignal; json?: unknown },
) => Promise<Response>;

/** One account/session. Unknown writes are read back before any further save. */
export class CurrencyPreferenceStore {
  readonly owner: string;
  #request: Request;
  #publish: (state: CurrencyPreferenceState) => void;
  #state: CurrencyPreferenceState;
  #active = true;
  #running = false;
  #intent: PortfolioCurrency | null = null;
  #needsRead = true;
  #conflicts = 0;
  #controller: AbortController | null = null;
  #timeout: number;
  constructor(
    owner: string,
    request: Request,
    publish: (state: CurrencyPreferenceState) => void,
    timeoutMs = 20_000,
  ) {
    this.owner = owner;
    this.#request = request;
    this.#publish = publish;
    this.#timeout = timeoutMs;
    this.#state = { owner, snapshot: null, selected: "USD", status: "loading", error: null };
  }
  get state() {
    return this.#state;
  }
  #emit(changes: Partial<CurrencyPreferenceState>) {
    if (!this.#active) return;
    this.#state = { ...this.#state, ...changes };
    this.#publish(this.#state);
  }
  start() {
    this.#run();
  }
  select(value: unknown) {
    const currency = portfolioCurrency(value);
    if (!this.#active || !this.#state.snapshot || currency === this.#state.selected) return;
    this.#intent = currency;
    this.#conflicts = 0;
    this.#emit({ selected: currency, error: null });
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
      rejectAborted = () => reject(new Error("Currency request cancelled"));
    });
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    try {
      return await Promise.race([
        (async () => {
          const response = await this.#request(CURRENCY_PREFERENCES_PATH, {
            method,
            signal: controller.signal,
            ...(json === undefined ? {} : { json }),
          });
          if (!this.#active || controller.signal.aborted)
            throw new Error("Currency request cancelled");
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            return { status: response.status, snapshot: null };
          }
          const snapshot = await readCurrencyResponse(response, controller.signal);
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
    this.#emit({ status: "loading", error: null });
    const reply = await this.#call("GET");
    if (!reply.snapshot) throw new Error("Currency read failed");
    const snapshot = reply.snapshot,
      confirmed = effectivePortfolioCurrency(snapshot);
    if (this.#intent === confirmed) this.#intent = null;
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
      let phase: "load" | "save" = this.#state.snapshot ? "save" : "load";
      try {
        if (this.#needsRead) await this.#load();
        while (this.#active && this.#intent && this.#state.snapshot) {
          phase = "save";
          const before = this.#state.snapshot,
            desired = this.#intent;
          if (desired === effectivePortfolioCurrency(before)) {
            this.#intent = null;
            this.#emit({ status: "saved" });
            break;
          }
          this.#emit({ status: "saving", error: null });
          // Assume an unknown commit until a complete valid response or explicit conflict arrives.
          this.#needsRead = true;
          const reply = await this.#call("PUT", {
            expectedVersion: before.version,
            defaultPortfolioCurrency: desired,
          });
          if (reply.status === 409) {
            if (++this.#conflicts > 2) throw new Error("Currency conflict");
            await this.#load();
            continue;
          }
          const saved = reply.snapshot;
          const changed = before.preferences?.defaultPortfolioCurrency !== desired;
          if (
            !saved ||
            saved.preferences?.defaultPortfolioCurrency !== desired ||
            saved.version !== before.version + 1 ||
            saved.currencyGeneration !== before.currencyGeneration + Number(changed)
          )
            throw new Error("Invalid saved currency");
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
