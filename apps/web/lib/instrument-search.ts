import { PORTFOLIO_CURRENCIES } from "./currency-preferences";
import type { ConfirmedInstrument } from "./holdings-facts";
export const MARKET_LABELS: Record<string, string> = {
  XNAS: "Nasdaq",
  XNYS: "NYSE",
  ARCX: "NYSE Arca",
  XASE: "NYSE American",
  XTSE: "TSX",
  XTSX: "TSX Venture",
  CNSX: "CSE",
  NEOE: "Cboe Canada",
};
export type InstrumentSearch = {
  profile: "folioview.instrument-search.v1";
  items: ConfirmedInstrument[];
  complete: boolean;
  fetchedAt: string | null;
  status: "available" | "stale" | "missing";
  reason: null | "unavailable" | "not_cached" | "busy" | "limited";
};
function exact(v: any, keys: string[]) {
  return (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).sort().join() === [...keys].sort().join()
  );
}
export function instrumentSearch(value: any): InstrumentSearch {
  if (
    !exact(value, ["profile", "items", "complete", "fetchedAt", "status", "reason"]) ||
    value.profile !== "folioview.instrument-search.v1" ||
    !Array.isArray(value.items) ||
    value.items.length > 4 ||
    typeof value.complete !== "boolean" ||
    !["available", "stale", "missing"].includes(value.status) ||
    ![null, "unavailable", "not_cached", "busy", "limited"].includes(value.reason) ||
    (value.fetchedAt !== null &&
      (typeof value.fetchedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(value.fetchedAt) ||
        !Number.isFinite(Date.parse(value.fetchedAt)))) ||
    (value.status === "missing"
      ? value.items.length !== 0 || value.complete || value.fetchedAt !== null
      : value.fetchedAt === null)
  )
    throw new Error("invalid_search");
  const seen = new Set<string>();
  for (const item of value.items) {
    if (
      !exact(item, ["symbol", "market", "currency", "name", "assetType"]) ||
      typeof item.symbol !== "string" ||
      !/^[A-Z0-9][A-Z0-9.-]{0,24}$/.test(item.symbol) ||
      typeof item.market !== "string" ||
      !Object.hasOwn(MARKET_LABELS, item.market) ||
      !PORTFOLIO_CURRENCIES.includes(item.currency) ||
      !["stock", "etf"].includes(item.assetType) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 180 ||
      /[\u0000-\u001f]/.test(item.name)
    )
      throw new Error("invalid_search");
    const key = JSON.stringify([item.market, item.symbol, item.currency]);
    if (seen.has(key)) throw new Error("invalid_search");
    seen.add(key);
  }
  return value;
}
export async function readInstrumentSearch(response: Response, signal: AbortSignal) {
  if (
    !response.ok ||
    !response.body ||
    response.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  ) {
    void response.body?.cancel().catch(() => {});
    throw new Error("search_failed");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new Error("cancelled");
      const next = await reader.read();
      if (signal.aborted) throw new Error("cancelled");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 16384) throw new Error("invalid_search");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return instrumentSearch(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}
