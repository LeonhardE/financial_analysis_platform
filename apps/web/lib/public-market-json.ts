/** Stream bound is enforced before shared validation; fixed errors never echo provider input. */
export async function readPublicValuation<T>(
  response: Response,
  validate: (value: unknown) => T,
  signal: AbortSignal,
): Promise<T> {
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) {
    void response.body?.cancel().catch(() => {});
    throw Error("prices_unavailable");
  }
  const limit = 128 * 1024,
    length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    void response.body?.cancel().catch(() => {});
    throw Error("prices_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("prices_unavailable");
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    let text = "",
      bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (;;) {
      if (signal.aborted) throw Error("cancelled");
      const next = await reader.read();
      if (signal.aborted) throw Error("cancelled");
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw Error("prices_unavailable");
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return validate(JSON.parse(text));
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
