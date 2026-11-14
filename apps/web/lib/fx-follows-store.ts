import {
  applyFxIntent,
  FX_FOLLOWS_PATH,
  fxSnapshot,
  samePreferences,
  type FxIntent,
  type FxSnapshot,
} from "./fx-follows";
import { readPublicValuation } from "./public-market-json";
type Request = (
  path: string,
  options: { method: "GET" | "PUT"; signal: AbortSignal; json?: unknown },
) => Promise<Response>;
export type FxFollowState = Readonly<{
  owner: string;
  snapshot: FxSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: boolean;
  uncertain: boolean;
  readAt: number;
}>;
/** Account memory only. Resolve an uncertain CAS before another mutation. */
export class FxFollowStore {
  readonly owner: string;
  #state: FxFollowState;
  #request: Request;
  #publish: (state: FxFollowState) => void;
  #active = true;
  #running = false;
  #controller: AbortController | null = null;
  #intent: FxIntent | null = null;
  constructor(owner: string, request: Request, publish: (state: FxFollowState) => void) {
    this.owner = owner;
    this.#request = request;
    this.#publish = publish;
    this.#state = {
      owner,
      snapshot: null,
      loading: false,
      saving: false,
      error: false,
      uncertain: false,
      readAt: 0,
    };
  }
  get state() {
    return this.#state;
  }
  #emit(value: Partial<FxFollowState>) {
    if (this.#active) {
      this.#state = { ...this.#state, ...value };
      this.#publish(this.#state);
    }
  }
  dispose() {
    this.#active = false;
    this.#controller?.abort();
  }
  load() {
    if (!this.#running) void this.#run(true);
  }
  change(intent: FxIntent) {
    if (
      !this.#active ||
      this.#running ||
      !this.#state.snapshot ||
      this.#state.uncertain ||
      this.#state.error
    )
      return;
    try {
      applyFxIntent(this.#state.snapshot, intent);
    } catch {
      this.#emit({ error: true });
      return;
    }
    this.#intent = structuredClone(intent);
    void this.#run(false);
  }
  async #call(method: "GET" | "PUT", json?: unknown) {
    const controller = new AbortController();
    this.#controller = controller;
    let rejectAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(Error("cancelled"));
    });
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      return await Promise.race([
        cancelled,
        (async () => {
          const response = await this.#request(FX_FOLLOWS_PATH, {
            method,
            signal: controller.signal,
            ...(json === undefined ? {} : { json }),
          });
          if (!this.#active || controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            throw Error("cancelled");
          }
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            return { status: response.status, snapshot: null };
          }
          return {
            status: response.status,
            snapshot: await readPublicValuation(response, fxSnapshot, controller.signal),
          };
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", rejectAbort);
      controller.abort();
      if (this.#controller === controller) this.#controller = null;
    }
  }
  async #run(read: boolean) {
    if (!this.#active || this.#running) return;
    this.#running = true;
    this.#emit({ loading: read, saving: Boolean(this.#intent), error: false });
    try {
      if (read || !this.#state.snapshot || this.#state.uncertain) {
        const result = await this.#call("GET");
        if (!result.snapshot) throw Error("fx_read_failed");
        this.#emit({
          snapshot: result.snapshot,
          loading: false,
          uncertain: false,
          readAt: Date.now(),
        });
      }
      for (let conflicts = 0; this.#active && this.#intent; conflicts++) {
        if (conflicts > 2) throw Error("fx_conflict");
        const before = this.#state.snapshot!,
          desired = applyFxIntent(before, this.#intent);
        if (samePreferences(before.preferences, desired)) {
          this.#intent = null;
          break;
        }
        this.#emit({ saving: true, uncertain: true });
        const result = await this.#call("PUT", {
          expectedVersion: before.version,
          preferences: desired,
        });
        if (result.status === 409) {
          const refreshed = await this.#call("GET");
          if (!refreshed.snapshot) throw Error("fx_read_failed");
          this.#emit({ snapshot: refreshed.snapshot, uncertain: false, readAt: Date.now() });
          continue;
        }
        if (
          !result.snapshot ||
          result.snapshot.version !== before.version + 1 ||
          !samePreferences(result.snapshot.preferences, desired)
        )
          throw Error("fx_write_failed");
        this.#intent = null;
        this.#emit({ snapshot: result.snapshot, uncertain: false, readAt: Date.now() });
      }
      this.#emit({ loading: false, saving: false, error: false });
    } catch {
      this.#emit({ loading: false, saving: false, error: true });
    } finally {
      this.#running = false;
    }
  }
}
