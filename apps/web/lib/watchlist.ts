import type { Instrument } from "@/lib/market-data";

export type WatchlistItem = Instrument & { addedAt: string };
export type WatchlistResponse = { items: WatchlistItem[]; limit: number };

export function readWatchlist(value: unknown): WatchlistResponse {
  if (!value || typeof value !== "object") throw new Error("Invalid watchlist response");
  const result = value as Record<string, unknown>;
  if (
    !Number.isInteger(result.limit) ||
    (result.limit as number) < 1 ||
    (result.limit as number) > 50 ||
    !Array.isArray(result.items) ||
    result.items.length > (result.limit as number)
  ) {
    throw new Error("Invalid watchlist response");
  }
  const symbols = new Set<string>();
  for (const item of result.items) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.symbol !== "string" ||
      !/^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?$/.test(item.symbol) ||
      symbols.has(item.symbol) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 200 ||
      !["stock", "index"].includes(item.instrumentType) ||
      item.currency !== "USD" ||
      typeof item.addedAt !== "string" ||
      !Number.isFinite(Date.parse(item.addedAt))
    ) {
      throw new Error("Invalid watchlist response");
    }
    symbols.add(item.symbol);
  }
  return result as WatchlistResponse;
}

export function watchlistError(status: number) {
  if (status === 409) return "Your watchlist is full. Remove an item before adding another.";
  if (status === 404) return "This instrument could not be saved. Try searching for it again.";
  if (status === 429) return "Too many requests. Wait a moment before trying again.";
  return "Your watchlist is temporarily unavailable. Please try again.";
}
