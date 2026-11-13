/** Page-memory display data only. Never used as an authority or a write precondition. */
export class DisplayLru<T> {
  private rows = new Map<string, { value: T; bytes: number }>();
  private used = 0;
  constructor(
    readonly limit: number,
    readonly maxBytes: number,
  ) {}
  get size() {
    return this.rows.size;
  }
  get bytes() {
    return this.used;
  }
  keys() {
    return this.rows.keys();
  }
  get(key: string): T | undefined {
    const row = this.rows.get(key);
    if (!row) return;
    this.rows.delete(key);
    this.rows.set(key, row);
    return row.value;
  }
  set(key: string, value: T) {
    this.delete(key);
    const text = JSON.stringify(value);
    if (typeof text !== "string") return false;
    const bytes =
      key.length * 2 +
      new TextEncoder().encode(text).byteLength +
      text.length * 2 +
      (text.match(/[\[{]/g)?.length ?? 0) * 64;
    if (bytes > this.maxBytes) return false;
    this.rows.set(key, { value, bytes });
    this.used += bytes;
    while (this.rows.size > this.limit || this.used > this.maxBytes)
      this.delete(this.rows.keys().next().value!);
    return true;
  }
  delete(key: string) {
    const row = this.rows.get(key);
    if (row) {
      this.used -= row.bytes;
      this.rows.delete(key);
    }
    return Boolean(row);
  }
  clear() {
    this.rows.clear();
    this.used = 0;
  }
}

export class WorkspaceDisplayCache {
  scope: string | null = null;
  readonly taskNames = new DisplayLru<string>(32, 128 * 1024);
  readonly reports = new DisplayLru<unknown>(10, 16 * 1024 * 1024);
  readonly holdings = new DisplayLru<unknown>(2, 32 * 1024 * 1024);
  bind(scope: string | null) {
    if (scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
  }
  clear() {
    this.taskNames.clear();
    this.reports.clear();
    this.holdings.clear();
  }
}

/** In-flight GETs only, opt-in for display reads. Each subscriber owns its cancellation. */
export class DisplayReadPool {
  private rows = new Map<
    string,
    { controller: AbortController; promise: Promise<Response>; users: number; settled: boolean }
  >();
  run(
    key: string,
    send: (signal: AbortSignal) => Promise<Response>,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (signal?.aborted) return Promise.reject(new Error("cancelled"));
    let row = this.rows.get(key);
    if (!row) {
      if (this.rows.size >= 16) return Promise.reject(new Error("read_capacity"));
      const controller = new AbortController();
      row = {
        controller,
        promise: Promise.resolve().then(() => send(controller.signal)),
        users: 0,
        settled: false,
      };
      this.rows.set(key, row);
      const current = row;
      void row.promise
        .then((response) => {
          current.settled = true;
          void Promise.resolve().then(() => response.body?.cancel().catch(() => {}));
        })
        .catch(() => {});
      void row.promise
        .finally(() => {
          if (this.rows.get(key) === current) this.rows.delete(key);
        })
        .catch(() => {});
    }
    if (row.users >= 8) return Promise.reject(new Error("read_capacity"));
    row.users++;
    const current = row;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true;
        signal?.removeEventListener("abort", cancel);
        current.users--;
        if (current.users === 0) {
          if (this.rows.get(key) === current) this.rows.delete(key);
          if (!current.settled) current.controller.abort();
        }
        return true;
      };
      const cancel = () => {
        if (finish()) reject(new Error("cancelled"));
      };
      signal?.addEventListener("abort", cancel, { once: true });
      current.promise.then(
        (response) => {
          if (!done) {
            try {
              const copy = response.clone();
              finish();
              resolve(copy);
            } catch (error) {
              if (finish()) reject(error);
            }
          }
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
      if (signal?.aborted) cancel();
    });
  }
  clear() {
    for (const row of this.rows.values()) row.controller.abort();
    this.rows.clear();
  }
}
