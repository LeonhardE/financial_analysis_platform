/** Test-only clock: explicit elapsed time runs the real callbacks at their deadlines. */
export function logicalClock(initial = 0) {
  let now = initial,
    next = 0;
  const timers = new Map();
  globalThis.performance = { now: () => now };
  globalThis.setTimeout = (callback, milliseconds = 0, ...args) => {
    const id = ++next;
    timers.set(id, { at: now + Math.max(0, milliseconds), callback, args });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const set = (value) => {
    if (!Number.isSafeInteger(value) || value < now) throw Error("invalid_synthetic_clock");
    now = value;
    for (let count = 0; count < 10000; count++) {
      const due = [...timers]
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!due.length) return;
      const [id, timer] = due[0];
      timers.delete(id);
      timer.callback(...timer.args);
    }
    throw Error("synthetic_timer_loop");
  };
  return { now: () => now, set, advance: (elapsed) => set(now + elapsed) };
}
